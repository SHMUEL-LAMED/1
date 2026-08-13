// בדיקות אינדוקס וחיפוש טביעות הפנים ב-Worker.
// המסד כאן הוא SQLite אמיתי בזיכרון, כך שכל שאילתה, מפתח ראשי ואינדקס
// נבדקים בפועל ולא מול חיקוי.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const DESCRIPTOR_LENGTH = 128;
const MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

// מעטפת בסגנון D1 מעל node:sqlite: prepare().bind().first()/all()/run() ו-batch.
class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }
  bind(...values) {
    this.bindings = values.map(normalizeBinding);
    return this;
  }
  async first() {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    return row === undefined ? null : row;
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
  async run() {
    const statement = this.database.prepare(this.sql);
    // ב-node:sqlite שורות מוחזרות נקראות עם get(); run() מתאים לשאר.
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const database = new SqliteD1();
const deletedObjectKeys = [];

const environment = {
  GALLERY_DB: database,
  GALLERY_BUCKET: {
    async list() { return { objects: [] }; },
    async head() { return null; },
    async get() { return null; },
    async put() { return {}; },
    async delete(key) { deletedObjectKeys.push(key); }
  }
};

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" }
};

const originalFetch = globalThis.fetch;

test.before(() => {
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const token = decodeURIComponent(new URL(href).searchParams.get("id_token") || "");
      const account = ACCOUNTS[token];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({
        ...account,
        email_verified: "true",
        aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com"
      });
    }
    return new Response("not mocked", { status: 500 });
  };
});

// קריאה ראשונה ל-Worker יוצרת את הסכימה, כולל טבלאות טביעות הפנים.
test.before(async () => {
  const health = await worker.fetch(apiRequest("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  deletedObjectKeys.length = 0;
  for (const table of ["image_face_descriptors", "image_face_index_state", "gallery_documents", "request_rate_limits", "user_email_index"]) {
    try {
      database.database.exec(`DELETE FROM ${table}`);
    } catch {
      // הטבלה נוצרת בקריאה הראשונה ל-Worker.
    }
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer", "approved");
  seedProfile("google-admin", "admin@example.com", "admin", "approved");
  seedProfile("google-super", "super@example.com", "super_admin", "approved");
  seedProfile("google-pending", "pending@example.com", "viewer", "pending");
});

function putDocument(collection, id, data, ownerUid = "google-admin") {
  const now = Date.now();
  database.database
    .prepare(
      `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
    )
    .run(collection, id, JSON.stringify(data), ownerUid, now, now);
}

function seedProfile(uid, email, role, status) {
  try {
    putDocument("userProfiles", uid, { uid, email, role, status }, uid);
  } catch {
    // לפני הקריאה הראשונה ל-Worker הטבלה עדיין לא קיימת; נזרע שוב בהמשך.
  }
}

function seedImage(imageId, extra = {}) {
  putDocument("images", imageId, { id: imageId, title: imageId, uploadedAt: 1, ...extra });
}

function apiRequest(path, method = "GET", body, token = "admin-token", extraHeaders = {}) {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(path, method, body, token, extraHeaders) {
  const response = await worker.fetch(apiRequest(path, method, body, token, extraHeaders), environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

// טביעה סינתטית: וקטור בסיס אחיד, ושינוי במימד אחד יוצר מרחק אוקלידי ידוע.
function descriptorAtDistance(distance = 0) {
  const descriptor = new Array(DESCRIPTOR_LENGTH).fill(0.08);
  descriptor[0] += distance;
  return descriptor;
}

async function seedIndexedImage(imageId, faces, token = "admin-token") {
  seedImage(imageId);
  const result = await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId, faces }]
  }, token);
  assert.equal(result.status, 200, result.text);
  return result;
}

function countDescriptors(imageId) {
  return database.database
    .prepare("SELECT COUNT(*) AS total FROM image_face_descriptors WHERE image_id = ?")
    .get(imageId).total;
}

test("descriptor לא תקין נדחה בכתיבה ובחיפוש", async () => {
  seedImage("image-1");
  const invalidDescriptors = [
    new Array(127).fill(0.08),
    new Array(129).fill(0.08),
    new Array(DESCRIPTOR_LENGTH).fill(0),
    Array.from({ length: DESCRIPTOR_LENGTH }, (_, index) => (index === 3 ? "0.08" : 0.08)),
    Array.from({ length: DESCRIPTOR_LENGTH }, (_, index) => (index === 3 ? null : 0.08)),
    Array.from({ length: DESCRIPTOR_LENGTH }, (_, index) => (index === 3 ? 99 : 0.08)),
    "not-an-array"
  ];

  for (const descriptor of invalidDescriptors) {
    const write = await call("/face/index", "POST", {
      modelVersion: MODEL_VERSION,
      images: [{ imageId: "image-1", faces: [descriptor] }]
    }, "admin-token");
    assert.equal(write.status, 400, `כתיבה עם טביעה פסולה נענתה ב-${write.status}`);
    assert.equal(write.payload.code, "invalid_face_descriptor");

    const search = await call("/face/search", "POST", { modelVersion: MODEL_VERSION, descriptor }, "viewer-token");
    assert.equal(search.status, 400);
    assert.equal(search.payload.code, "invalid_face_descriptor");
  }

  // אף טביעה פסולה לא נשמרה במסד.
  assert.equal(countDescriptors("image-1"), 0);
});

test("רק משתמש מאושר יכול לחפש, ורק מנהל יכול לכתוב טביעות", async () => {
  await seedIndexedImage("image-1", [descriptorAtDistance(0)]);
  const descriptor = descriptorAtDistance(0);

  const anonymous = await call("/face/search", "POST", { descriptor }, "");
  assert.equal(anonymous.status, 401);

  const pending = await call("/face/search", "POST", { descriptor }, "pending-token");
  assert.equal(pending.status, 403);
  assert.equal(pending.payload.code, "approval_required");

  const pendingWrite = await call("/face/index", "POST", {
    images: [{ imageId: "image-1", faces: [descriptor] }]
  }, "pending-token");
  assert.equal(pendingWrite.status, 403);

  const viewerSearch = await call("/face/search", "POST", { descriptor }, "viewer-token");
  assert.equal(viewerSearch.status, 200, viewerSearch.text);

  const viewerWrite = await call("/face/index", "POST", {
    images: [{ imageId: "image-1", faces: [descriptor] }]
  }, "viewer-token");
  assert.equal(viewerWrite.status, 403);
  assert.equal(viewerWrite.payload.code, "permission_denied");

  const viewerPending = await call("/face/index/pending", "POST", { imageIds: ["image-1"] }, "viewer-token");
  assert.equal(viewerPending.status, 403);

  const viewerReset = await call("/face/index/reset", "POST", { scope: "all" }, "viewer-token");
  assert.equal(viewerReset.status, 403);
});

test("תהליך אינדוקס עם אסימון ייעודי רשאי לכתוב", async () => {
  seedImage("image-1");
  const environmentWithToken = { ...environment, FACE_INDEX_TOKEN: "index-secret-token" };

  const allowed = await worker.fetch(apiRequest("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId: "image-1", faces: [descriptorAtDistance(0)] }]
  }, "", { "X-Face-Index-Token": "index-secret-token" }), environmentWithToken);
  assert.equal(allowed.status, 200);
  assert.equal(countDescriptors("image-1"), 1);

  const rejected = await worker.fetch(apiRequest("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: [{ imageId: "image-1", faces: [descriptorAtDistance(0)] }]
  }, "", { "X-Face-Index-Token": "wrong-token" }), environmentWithToken);
  assert.equal(rejected.status, 403);
});

test("נשמרות כמה פנים לאותה תמונה וכל אחת מהן מאתרת אותה", async () => {
  const faces = [descriptorAtDistance(0), descriptorAtDistance(1.4), descriptorAtDistance(2.2)];
  await seedIndexedImage("image-group", faces);
  assert.equal(countDescriptors("image-group"), 3);

  const state = database.database
    .prepare("SELECT face_count, status, model_version FROM image_face_index_state WHERE image_id = ?")
    .get("image-group");
  assert.equal(state.face_count, 3);
  assert.equal(state.status, "indexed");
  assert.equal(state.model_version, MODEL_VERSION);

  for (const face of faces) {
    const search = await call("/face/search", "POST", { descriptor: face }, "viewer-token");
    assert.equal(search.status, 200, search.text);
    assert.deepEqual(search.payload.matches.map(match => match.imageId), ["image-group"]);
  }

  // אינדוקס חוזר עם פחות פנים מסיר את השורות המיותרות.
  await seedIndexedImage("image-group", [descriptorAtDistance(0)]);
  assert.equal(countDescriptors("image-group"), 1);
});

test("החיפוש מחזיר רק התאמות מחמירות לפי הסף ובסדר הנכון", async () => {
  await seedIndexedImage("image-strong", [descriptorAtDistance(0.2)]);
  await seedIndexedImage("image-possible", [descriptorAtDistance(0.47)]);
  await seedIndexedImage("image-wrong-person", [descriptorAtDistance(0.55)]);
  await seedIndexedImage("image-far", [descriptorAtDistance(0.9)]);
  await seedIndexedImage("image-empty", []);

  const search = await call("/face/search", "POST", {
    modelVersion: MODEL_VERSION,
    descriptor: descriptorAtDistance(0)
  }, "viewer-token");
  assert.equal(search.status, 200, search.text);

  const matches = search.payload.matches;
  assert.deepEqual(matches.map(match => match.imageId), ["image-strong", "image-possible"]);
  assert.equal(matches[0].strength, "strong");
  assert.equal(matches[1].strength, "strong");
  assert.ok(Math.abs(matches[0].distance - 0.2) < 0.0002);
  assert.ok(Math.abs(matches[1].distance - 0.47) < 0.0002);
  assert.ok(matches[0].confidence > matches[1].confidence);
  assert.equal(search.payload.thresholds.match, 0.48);
  assert.equal(search.payload.thresholds.strong, 0.48);
  assert.equal(matches.some(match => match.imageId === "image-wrong-person"), false);

  // הסף עצמו חוסם: מעט מעבר ל-0.48 אינו נכלל, ומעט מתחתיו כן.
  await seedIndexedImage("image-over-threshold", [descriptorAtDistance(0.4805)]);
  await seedIndexedImage("image-under-threshold", [descriptorAtDistance(0.4795)]);
  const borderline = await call("/face/search", "POST", {
    descriptor: descriptorAtDistance(0)
  }, "viewer-token");
  const borderlineIds = borderline.payload.matches.map(match => match.imageId);
  assert.equal(borderlineIds.includes("image-over-threshold"), false);
  assert.equal(borderlineIds.includes("image-under-threshold"), true);

  // הגבלת מספר התוצאות נשמרת.
  const limited = await call("/face/search", "POST", {
    descriptor: descriptorAtDistance(0),
    limit: 1
  }, "viewer-token");
  assert.equal(limited.payload.matches.length, 1);
  assert.equal(limited.payload.matches[0].imageId, "image-strong");
});

test("descriptors אינם מוחזרים ללקוח באף תשובה", async () => {
  const face = descriptorAtDistance(0.1);
  const write = await seedIndexedImage("image-1", [face]);
  const search = await call("/face/search", "POST", { descriptor: descriptorAtDistance(0) }, "viewer-token");
  const summary = await call(`/face/index/summary?modelVersion=${MODEL_VERSION}`, "GET", undefined, "viewer-token");
  const pending = await call("/face/index/pending", "POST", { imageIds: ["image-1"] }, "admin-token");

  for (const response of [write, search, summary, pending]) {
    assert.equal(/descriptor/i.test(response.text), false, `נמצא descriptor בתשובה: ${response.text.slice(0, 200)}`);
    assert.equal(response.text.includes("0.18"), false);
  }
  assert.deepEqual(Object.keys(search.payload.matches[0]).sort(), ["confidence", "distance", "imageId", "strength"]);
});

test("מחיקת תמונה מוחקת גם את כל טביעות הפנים שלה", async () => {
  await seedIndexedImage("image-1", [descriptorAtDistance(0), descriptorAtDistance(1.5)]);
  await seedIndexedImage("image-2", [descriptorAtDistance(0.1)]);
  assert.equal(countDescriptors("image-1"), 2);

  const removed = await call("/data/images/image-1", "DELETE", undefined, "super-token");
  assert.equal(removed.status, 200, removed.text);
  assert.equal(countDescriptors("image-1"), 0);
  assert.equal(
    database.database.prepare("SELECT COUNT(*) AS total FROM image_face_index_state WHERE image_id = ?").get("image-1").total,
    0
  );
  assert.equal(countDescriptors("image-2"), 1);

  // גם מחיקת הקובץ עצמו מ-R2 מנקה את הטביעות.
  const removedMedia = await call("/media/approved/google-admin/image-2.jpg", "DELETE", undefined, "super-token");
  assert.equal(removedMedia.status, 200, removedMedia.text);
  assert.equal(countDescriptors("image-2"), 0);
  assert.deepEqual(deletedObjectKeys, ["approved/google-admin/image-2.jpg"]);

  // תמונה שנמחקה אינה מוחזרת יותר בחיפוש.
  const search = await call("/face/search", "POST", { descriptor: descriptorAtDistance(0) }, "viewer-token");
  assert.deepEqual(search.payload.matches, []);
});

test("ניקוי רשומה ממתינה של תמונה שאושרה אינו מוחק את הטביעות שלה", async () => {
  await seedIndexedImage("image-1", [descriptorAtDistance(0.1)]);
  putDocument("pendingImages", "image-1", { id: "image-1", status: "approved" });

  const removedPending = await call("/data/pendingImages/image-1", "DELETE", undefined, "super-token");
  assert.equal(removedPending.status, 200, removedPending.text);
  assert.equal(countDescriptors("image-1"), 1);

  // גם מחיקת הקובץ הממתין שנשאר מאחור אינה פוגעת בתמונה הפעילה.
  const removedPendingMedia = await call("/media/pending/google-admin/image-1.jpg", "DELETE", undefined, "super-token");
  assert.equal(removedPendingMedia.status, 200, removedPendingMedia.text);
  assert.equal(countDescriptors("image-1"), 1);

  // כשאין תמונה פעילה עם אותו מזהה, הטביעות כן נמחקות.
  await call("/data/images/image-1", "DELETE", undefined, "super-token");
  assert.equal(countDescriptors("image-1"), 0);
});

test("תמונה שכבר אונדקסה נידלגת, גם כשאין בה פנים", async () => {
  ["image-1", "image-2", "image-3"].forEach(id => seedImage(id));
  await seedIndexedImage("image-1", [descriptorAtDistance(0)]);
  // תמונה ללא פנים נשמרת כמעובדת כדי שלא תיסרק שוב.
  await seedIndexedImage("image-2", []);

  const pending = await call("/face/index/pending", "POST", {
    modelVersion: MODEL_VERSION,
    imageIds: ["image-1", "image-2", "image-3"]
  }, "admin-token");
  assert.equal(pending.status, 200, pending.text);
  assert.deepEqual(pending.payload.pending, ["image-3"]);
  assert.equal(pending.payload.skipped, 2);

  // החלפת גרסת המודל מחזירה את כל התמונות לתור.
  const afterModelChange = await call("/face/index/pending", "POST", {
    modelVersion: "faceapi-2.0.0-next",
    imageIds: ["image-1", "image-2", "image-3"]
  }, "admin-token");
  assert.deepEqual(afterModelChange.payload.pending, ["image-1", "image-2", "image-3"]);

  // כישלון חוזר על אותה תמונה מפסיק להיכנס לתור אחרי שלושה ניסיונות.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failed = await call("/face/index", "POST", {
      modelVersion: MODEL_VERSION,
      images: [{ imageId: "image-3", status: "failed", errorCode: "image_scan_failed" }]
    }, "admin-token");
    assert.equal(failed.status, 200, failed.text);
  }
  const afterFailures = await call("/face/index/pending", "POST", {
    modelVersion: MODEL_VERSION,
    imageIds: ["image-3"]
  }, "admin-token");
  assert.deepEqual(afterFailures.payload.pending, []);
});

test("אפשר להמשיך אינדוקס אחרי עצירה, ולאפס אותו לפני אינדוקס מחדש", async () => {
  const imageIds = Array.from({ length: 6 }, (_, index) => `image-${index}`);
  imageIds.forEach(id => seedImage(id));

  const firstPending = await call("/face/index/pending", "POST", { imageIds }, "admin-token");
  assert.deepEqual(firstPending.payload.pending, imageIds);

  // ריצה שנעצרה באמצע: רק שלוש התמונות הראשונות נשמרו.
  const saved = await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: imageIds.slice(0, 3).map(imageId => ({ imageId, faces: [descriptorAtDistance(0.1)] }))
  }, "admin-token");
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.payload.saved.length, 3);

  const resumed = await call("/face/index/pending", "POST", { imageIds }, "admin-token");
  assert.deepEqual(resumed.payload.pending, imageIds.slice(3));

  const summary = await call(`/face/index/summary?modelVersion=${MODEL_VERSION}`, "GET", undefined, "admin-token");
  assert.equal(summary.payload.totalImages, 6);
  assert.equal(summary.payload.indexedImages, 3);
  assert.equal(summary.payload.remainingImages, 3);
  assert.equal(summary.payload.ready, false);

  await call("/face/index", "POST", {
    modelVersion: MODEL_VERSION,
    images: imageIds.slice(3).map(imageId => ({ imageId, faces: [] }))
  }, "admin-token");
  const completed = await call(`/face/index/summary?modelVersion=${MODEL_VERSION}`, "GET", undefined, "viewer-token");
  assert.equal(completed.payload.remainingImages, 0);
  assert.equal(completed.payload.ready, true);

  const reset = await call("/face/index/reset", "POST", { scope: "all" }, "super-token");
  assert.equal(reset.status, 200, reset.text);
  const afterReset = await call("/face/index/pending", "POST", { imageIds }, "admin-token");
  assert.deepEqual(afterReset.payload.pending, imageIds);
});

test("סרטונים אינם נספרים כתמונות הממתינות לאינדוקס", async () => {
  seedImage("image-1");
  seedImage("video-1", { mediaType: "video" });
  const summary = await call(`/face/index/summary?modelVersion=${MODEL_VERSION}`, "GET", undefined, "admin-token");
  assert.equal(summary.payload.totalImages, 1);
});
