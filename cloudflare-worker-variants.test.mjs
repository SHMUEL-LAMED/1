// בדיקות התצוגות המקדימות (variants) ב-Worker: העלאה עם תצוגות, צירוף
// תצוגות לפריט קיים, הרשאות הצפייה וההגשה, ומחיקה יחד עם המקור.
// המסד הוא SQLite אמיתי בזיכרון, ו-R2 מדומה במפה עם list לפי prefix.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

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
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); }
  prepare(sql) { return new SqliteD1Statement(this.database, sql); }
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

// R2 מדומה: אותם קריאות שה-Worker משתמש בהן, כולל list עם prefix.
class MockR2 {
  constructor() { this.objects = new Map(); }
  async toBytes(body) {
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (typeof body === "string") return new TextEncoder().encode(body);
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  async put(key, body, options = {}) {
    this.objects.set(key, {
      key,
      bytes: await this.toBytes(body),
      httpMetadata: { ...(options.httpMetadata || {}) },
      customMetadata: { ...(options.customMetadata || {}) }
    });
    return {};
  }
  wrap(stored, withBody) {
    return {
      key: stored.key,
      size: stored.bytes.length,
      httpEtag: `"${stored.key}"`,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      body: withBody ? stored.bytes : undefined,
      writeHttpMetadata(headers) {
        if (stored.httpMetadata.contentType) headers.set("Content-Type", stored.httpMetadata.contentType);
      }
    };
  }
  async get(key) {
    const stored = this.objects.get(key);
    return stored ? this.wrap(stored, true) : null;
  }
  async head(key) {
    const stored = this.objects.get(key);
    return stored ? this.wrap(stored, false) : null;
  }
  async delete(keys) {
    for (const key of [].concat(keys)) this.objects.delete(key);
  }
  async list({ prefix = "" } = {}) {
    const objects = [...this.objects.values()]
      .filter(stored => stored.key.startsWith(prefix))
      .map(stored => ({ key: stored.key, size: stored.bytes.length, customMetadata: stored.customMetadata }));
    return { objects, truncated: false };
  }
  keys() { return [...this.objects.keys()].sort(); }
}

const database = new SqliteD1();
const bucket = new MockR2();
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket };

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "viewer2-token": { sub: "google-viewer-2", email: "viewer2@example.com", name: "Viewer Two" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

const originalFetch = globalThis.fetch;

test.before(async () => {
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
  // הקריאה הראשונה יוצרת את הסכימה.
  const health = await worker.fetch(jsonRequest("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.ok(payload.features.includes("media-variants"));
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  bucket.objects.clear();
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "face_people", "image_face_descriptors", "image_face_index_state", "media_variant_files"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer");
  seedProfile("google-viewer-2", "viewer2@example.com", "viewer");
  seedProfile("google-uploader", "uploader@example.com", "uploader");
  seedProfile("google-admin", "admin@example.com", "admin");
  seedProfile("google-super", "super@example.com", "super_admin");
});

function putDocument(collection, id, data, ownerUid = "google-admin") {
  const now = Date.now();
  database.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), ownerUid, now, now);
}

function readDocument(collection, id) {
  const row = database.database
    .prepare("SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?")
    .get(collection, id);
  return row ? JSON.parse(row.data_json) : null;
}

function seedProfile(uid, email, role) {
  putDocument("userProfiles", uid, { uid, email, role, status: "approved" }, uid);
}

function headersFor(token, extra = {}) {
  return { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function jsonRequest(path, method = "GET", body, token = "admin-token") {
  return new Request(`${API}${path}`, {
    method,
    headers: headersFor(token, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}

// בקשת multipart כמו שהדפדפן שולח: קבצים כ-File, שאר השדות כמחרוזות.
function multipartRequest(path, fields, token = "admin-token") {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(name, value, value.name || name);
    else form.append(name, String(value));
  }
  return new Request(`${API}${path}`, { method: "POST", headers: headersFor(token), body: form });
}

async function call(request) {
  const response = await worker.fetch(request, environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text, headers: response.headers };
}

function bytes(size, fill = 1) {
  return new Uint8Array(size).fill(fill);
}

function webp(name = "thumb.webp", size = 1200) {
  return new File([bytes(size)], name, { type: "image/webp" });
}

function jpeg(name = "original.jpg", size = 5000) {
  return new File([bytes(size, 7)], name, { type: "image/jpeg" });
}

function avif(name = "thumb.avif", size = 600) {
  return new File([bytes(size, 3)], name, { type: "image/avif" });
}

function ledgerRows(imageId) {
  return database.database
    .prepare("SELECT object_key, variant_name, format, content_type, width, height, size_bytes FROM media_variant_files WHERE image_id = ? ORDER BY object_key")
    .all(imageId)
    .map(row => ({ ...row }));
}

const META = JSON.stringify({ thumb: { width: 480, height: 320 }, medium: { width: 1280, height: 853 }, poster: { width: 1280, height: 720 } });

async function uploadWithVariants(imageId, token, extraFields = {}) {
  return call(multipartRequest("/upload", {
    file: jpeg(`${imageId}.jpg`),
    imageId,
    title: "תמונה",
    variant_thumb: webp("thumb.webp"),
    variant_medium: webp("medium.webp", 20000),
    variantsMeta: META,
    ...extraFields
  }, token));
}

test("העלאה עם תצוגות שומרת שלושה קבצים ומחזירה variants שהלקוח רושם ברשומה", async () => {
  const upload = await uploadWithVariants("img-1", "uploader-token");
  assert.equal(upload.status, 201, upload.text);
  assert.deepEqual(bucket.keys(), [
    "approved/google-uploader/img-1.jpg",
    "variants/img-1/medium.webp",
    "variants/img-1/thumb.webp"
  ]);

  const { variants, variantsVersion } = upload.payload;
  assert.equal(variantsVersion, 1);
  assert.equal(variants.thumb.key, "variants/img-1/thumb.webp");
  assert.equal(variants.thumb.url, `${API}/media/variants/img-1/thumb.webp`);
  assert.equal(variants.thumb.type, "image/webp");
  assert.equal(variants.thumb.width, 480);
  assert.equal(variants.thumb.height, 320);
  assert.equal(variants.medium.width, 1280);
  assert.equal(variants.poster, undefined);

  const stored = bucket.objects.get("variants/img-1/thumb.webp");
  assert.equal(stored.httpMetadata.contentType, "image/webp");
  assert.equal(stored.customMetadata.state, "approved");
  assert.equal(stored.customMetadata.ownerUid, "google-uploader");

  // הלקוח כותב את הרשומה אחרי ההעלאה ומעתיק אליה את variants מהתשובה.
  const write = await call(jsonRequest("/data/images/img-1", "PUT", {
    data: { id: "img-1", title: "תמונה", uploadedBy: "google-uploader", url: upload.payload.url, variants, variantsVersion }
  }, "uploader-token"));
  assert.equal(write.status, 200, write.text);
  assert.deepEqual(readDocument("images", "img-1").variants, variants);
});

test("תצוגה של פריט מאושר מוגשת לכולם עם סוג התוכן הנכון ומטמון ארוך", async () => {
  const upload = await uploadWithVariants("img-2", "uploader-token");
  assert.equal(upload.status, 201, upload.text);

  const anonymous = await worker.fetch(new Request(`${API}/media/variants/img-2/thumb.webp`, { headers: { Origin: ORIGIN } }), environment);
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.get("Content-Type"), "image/webp");
  assert.equal(anonymous.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(anonymous.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await anonymous.arrayBuffer()).byteLength, 1200);

  // מפתח תצוגה שאינו במבנה המוכר נדחה.
  const bogus = await call(jsonRequest("/media/variants/img-2/huge.webp", "GET", undefined, ""));
  assert.equal(bogus.status, 400);
  assert.equal(bogus.payload.code, "invalid_object_key");
});

test("תצוגה של פריט ממתין: בעלים ומנהל בלבד, ואחרי האישור ציבורית", async () => {
  const upload = await call(multipartRequest("/upload", {
    file: jpeg("img-3.jpg"),
    imageId: "img-3",
    title: "ממתינה",
    variant_thumb: webp(),
    variantsMeta: META
  }, "viewer-token"));
  assert.equal(upload.status, 201, upload.text);
  assert.equal(upload.payload.state, "pending");
  assert.equal(bucket.objects.get("variants/img-3/thumb.webp").customMetadata.state, "pending");

  const path = "/media/variants/img-3/thumb.webp";
  assert.equal((await call(jsonRequest(path, "GET", undefined, ""))).status, 401);
  assert.equal((await call(jsonRequest(path, "GET", undefined, "viewer2-token"))).status, 403);
  const owner = await call(jsonRequest(path, "GET", undefined, "viewer-token"));
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await call(jsonRequest(path, "GET", undefined, "admin-token"))).status, 200);

  // האישור מעביר את המקור ומסמן גם את התצוגות כמאושרות.
  const approve = await call(jsonRequest("/approve", "POST", { key: upload.payload.key }, "admin-token"));
  assert.equal(approve.status, 200, approve.text);
  assert.equal(bucket.objects.get("variants/img-3/thumb.webp").customMetadata.state, "approved");
  const anonymous = await call(jsonRequest(path, "GET", undefined, ""));
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

test("תצוגה שהמטא-דאטה שלה נשאר 'ממתין' מוגשת כשרשומת images כבר קיימת", async () => {
  await bucket.put("variants/img-4/thumb.webp", bytes(10), {
    httpMetadata: { contentType: "image/webp" },
    customMetadata: { state: "pending", ownerUid: "google-viewer" }
  });
  assert.equal((await call(jsonRequest("/media/variants/img-4/thumb.webp", "GET", undefined, ""))).status, 401);
  putDocument("images", "img-4", { id: "img-4", uploadedBy: "google-viewer" });
  const served = await call(jsonRequest("/media/variants/img-4/thumb.webp", "GET", undefined, ""));
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

test("/media/variants — מטריצת הרשאות: צופה שאינו הבעלים נדחה, מנהל והבעלים מורשים", async () => {
  putDocument("images", "img-a", { id: "img-a", title: "פעילה", uploadedBy: "google-uploader" }, "google-uploader");
  const attach = (token, fields = {}) => call(multipartRequest("/media/variants", {
    imageId: "img-a",
    variant_thumb: webp(),
    variant_medium: webp("medium.webp", 3000),
    variantsMeta: META,
    ...fields
  }, token));

  const stranger = await attach("viewer-token");
  assert.equal(stranger.status, 403);
  assert.equal(stranger.payload.code, "permission_denied");
  assert.deepEqual(bucket.keys(), []);

  const owner = await attach("uploader-token");
  assert.equal(owner.status, 200, owner.text);
  assert.deepEqual(owner.payload.updated, ["images"]);
  assert.equal(bucket.objects.get("variants/img-a/thumb.webp").customMetadata.state, "approved");
  assert.deepEqual(readDocument("images", "img-a").variants, owner.payload.variants);
  assert.equal(readDocument("images", "img-a").variantsVersion, 1);

  // מנהל רשאי גם לפריט של אחר; תצוגה שלא נשלחה שוב נשמרת מהסבב הקודם.
  const admin = await attach("admin-token", { variant_medium: "" });
  assert.equal(admin.status, 200, admin.text);
  assert.equal(admin.payload.variants.medium.key, "variants/img-a/medium.webp");
  assert.equal(admin.payload.variants.thumb.key, "variants/img-a/thumb.webp");

  const anonymous = await call(multipartRequest("/media/variants", { imageId: "img-a", variant_thumb: webp() }, ""));
  assert.equal(anonymous.status, 401);
});

test("/media/variants — פריט ממתין: הבעלים רשאי כל עוד הוא ממתין, ואחרים לא", async () => {
  putDocument("pendingImages", "img-p", { id: "img-p", status: "pending", uploadedBy: "google-viewer" }, "google-viewer");
  const attach = (imageId, token) => call(multipartRequest("/media/variants", { imageId, variant_thumb: webp(), variantsMeta: META }, token));

  assert.equal((await attach("img-p", "viewer2-token")).status, 403);
  const owner = await attach("img-p", "viewer-token");
  assert.equal(owner.status, 200, owner.text);
  assert.deepEqual(owner.payload.updated, ["pendingImages"]);
  assert.equal(bucket.objects.get("variants/img-p/thumb.webp").customMetadata.state, "pending");
  assert.equal(readDocument("pendingImages", "img-p").variants.thumb.key, "variants/img-p/thumb.webp");

  // רשומה ממתינה שכבר טופלה אינה פתוחה למעלה שלה — אבל כן למנהל.
  putDocument("pendingImages", "img-q", { id: "img-q", status: "rejected", uploadedBy: "google-viewer" }, "google-viewer");
  assert.equal((await attach("img-q", "viewer-token")).status, 403);
  assert.equal((await attach("img-q", "admin-token")).status, 200);

  const missing = await attach("img-none", "admin-token");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.code, "not_found");
});

test("/media/variants — בדיקת החלקים: חסר, גדול מדי וסוג לא נתמך", async () => {
  putDocument("images", "img-v", { id: "img-v", uploadedBy: "google-admin" });
  const attach = fields => call(multipartRequest("/media/variants", { imageId: "img-v", ...fields }, "admin-token"));

  const empty = await attach({});
  assert.equal(empty.status, 400);
  assert.equal(empty.payload.code, "variant_missing");

  const huge = await attach({ variant_thumb: webp("thumb.webp", 2 * 1024 * 1024 + 1) });
  assert.equal(huge.status, 413);
  assert.equal(huge.payload.code, "variant_too_large");

  const png = await attach({ variant_thumb: new File([bytes(10)], "thumb.png", { type: "image/png" }) });
  assert.equal(png.status, 415);
  assert.equal(png.payload.code, "unsupported_variant_type");

  const text = await attach({ variant_thumb: "not-a-file" });
  assert.equal(text.status, 400);
  assert.equal(text.payload.code, "invalid_variant");

  assert.deepEqual(bucket.keys(), []);
  assert.equal(readDocument("images", "img-v").variants, undefined);
});

test("העלאה עם תצוגה פסולה נכשלת לפני שנשמר דבר, וקובץ צ׳אט מתעלם מתצוגות", async () => {
  const bad = await call(multipartRequest("/upload", {
    file: jpeg("img-5.jpg"),
    imageId: "img-5",
    title: "x",
    variant_thumb: new File([bytes(10)], "thumb.gif", { type: "image/gif" })
  }, "uploader-token"));
  assert.equal(bad.status, 415);
  assert.deepEqual(bucket.keys(), []);

  const chat = await call(multipartRequest("/upload", {
    file: jpeg("img-6.jpg"),
    imageId: "img-6",
    context: "chat",
    conversationUid: "google-uploader",
    variant_thumb: webp()
  }, "uploader-token"));
  assert.equal(chat.status, 201, chat.text);
  assert.equal(chat.payload.variants, undefined);
  assert.deepEqual(bucket.keys(), ["chat/google-uploader/google-uploader/img-6.jpg"]);
});

test("תצוגה בפורמט JPEG מחליפה גרסה קודמת בפורמט WebP של אותו פריט", async () => {
  putDocument("images", "img-j", { id: "img-j", uploadedBy: "google-admin" });
  const first = await call(multipartRequest("/media/variants", { imageId: "img-j", variant_thumb: webp() }, "admin-token"));
  assert.equal(first.status, 200, first.text);
  const second = await call(multipartRequest("/media/variants", {
    imageId: "img-j",
    variant_thumb: new File([bytes(50)], "thumb.jpg", { type: "image/jpeg" })
  }, "admin-token"));
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(bucket.keys(), ["variants/img-j/thumb.jpg"]);
  assert.equal(second.payload.variants.thumb.type, "image/jpeg");
  assert.equal(readDocument("images", "img-j").variants.thumb.key, "variants/img-j/thumb.jpg");
});

async function seedVariantObjects(imageId, state = "approved") {
  for (const name of ["thumb", "medium"]) {
    await bucket.put(`variants/${imageId}/${name}.webp`, bytes(5), {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { state, ownerUid: "google-uploader" }
    });
  }
}

test("מחיקת רשומת תמונה מוחקת את קובצי התצוגות שלה", async () => {
  putDocument("images", "img-d", { id: "img-d", uploadedBy: "google-uploader" });
  await seedVariantObjects("img-d");
  await seedVariantObjects("img-other");

  const remove = await call(jsonRequest("/data/images/img-d", "DELETE", undefined, "admin-token"));
  assert.equal(remove.status, 200, remove.text);
  assert.deepEqual(bucket.keys(), ["variants/img-other/medium.webp", "variants/img-other/thumb.webp"]);
});

test("מחיקת הרשומה הממתינה של תמונה שאושרה אינה נוגעת בתצוגות של התמונה הפעילה", async () => {
  putDocument("images", "img-k", { id: "img-k", uploadedBy: "google-viewer" });
  putDocument("pendingImages", "img-k", { id: "img-k", status: "approved", uploadedBy: "google-viewer" });
  await seedVariantObjects("img-k");

  const removePending = await call(jsonRequest("/data/pendingImages/img-k", "DELETE", undefined, "admin-token"));
  assert.equal(removePending.status, 200, removePending.text);
  assert.equal(bucket.keys().length, 2);

  // רשומה ממתינה בלי תמונה פעילה: התצוגות נמחקות.
  putDocument("pendingImages", "img-l", { id: "img-l", status: "pending", uploadedBy: "google-viewer" });
  await seedVariantObjects("img-l", "pending");
  const removeLonely = await call(jsonRequest("/data/pendingImages/img-l", "DELETE", undefined, "admin-token"));
  assert.equal(removeLonely.status, 200, removeLonely.text);
  assert.deepEqual(bucket.keys(), ["variants/img-k/medium.webp", "variants/img-k/thumb.webp"]);
});

test("מחיקת קובץ המקור מ-R2 מוחקת גם את התצוגות, ומחיקת תצוגה בודדת אינה נוגעת בשאר", async () => {
  await bucket.put("approved/google-uploader/img-e.jpg", bytes(3), { httpMetadata: { contentType: "image/jpeg" } });
  await seedVariantObjects("img-e");
  await seedVariantObjects("img-f");

  const remove = await call(jsonRequest("/media/approved/google-uploader/img-e.jpg", "DELETE", undefined, "super-token"));
  assert.equal(remove.status, 200, remove.text);
  assert.deepEqual(bucket.keys(), ["variants/img-f/medium.webp", "variants/img-f/thumb.webp"]);

  const single = await call(jsonRequest("/media/variants/img-f/thumb.webp", "DELETE", undefined, "super-token"));
  assert.equal(single.status, 200, single.text);
  assert.deepEqual(bucket.keys(), ["variants/img-f/medium.webp"]);

  // קובץ ממתין של תמונה שכבר אושרה: התצוגות של התמונה הפעילה נשארות.
  putDocument("images", "img-g", { id: "img-g", uploadedBy: "google-viewer" });
  await bucket.put("pending/google-viewer/img-g.jpg", bytes(3), { httpMetadata: { contentType: "image/jpeg" } });
  await seedVariantObjects("img-g");
  const removePending = await call(jsonRequest("/media/pending/google-viewer/img-g.jpg", "DELETE", undefined, "super-token"));
  assert.equal(removePending.status, 200, removePending.text);
  assert.deepEqual(bucket.keys(), ["variants/img-f/medium.webp", "variants/img-g/medium.webp", "variants/img-g/thumb.webp"]);
});

test("כתיבת רשומה מעותק ישן בלי variants אינה מוחקת את התצוגות שנרשמו", async () => {
  const variants = { thumb: { key: "variants/img-w/thumb.webp", url: `${API}/media/variants/img-w/thumb.webp`, width: 480, height: 320, type: "image/webp" } };
  putDocument("images", "img-w", { id: "img-w", title: "ישן", uploadedBy: "google-admin", variants, variantsVersion: 1 });

  const write = await call(jsonRequest("/data/images/img-w", "PUT", {
    data: { id: "img-w", title: "חדש", uploadedBy: "google-admin", folderId: "f2" }
  }, "admin-token"));
  assert.equal(write.status, 200, write.text);
  const stored = readDocument("images", "img-w");
  assert.equal(stored.title, "חדש");
  assert.deepEqual(stored.variants, variants);
  assert.equal(stored.variantsVersion, 1);
});

test("עותק AVIF נשמר לצד התצוגה, נרשם בתוכה, ומוגש עם סוג התוכן הנכון", async () => {
  const upload = await uploadWithVariants("img-avif", "admin-token", { variant_thumb_avif: avif(), variant_medium_avif: avif("medium.avif", 9000) });
  assert.equal(upload.status, 201, upload.text);
  const { thumb, medium } = upload.payload.variants;
  assert.deepEqual(thumb.avif, {
    key: "variants/img-avif/thumb.avif",
    url: `${API}/media/variants/img-avif/thumb.avif`,
    type: "image/avif"
  });
  assert.equal(medium.avif.key, "variants/img-avif/medium.avif");
  assert.equal(thumb.type, "image/webp");
  assert.deepEqual(bucket.keys(), [
    "approved/google-admin/img-avif.jpg",
    "variants/img-avif/medium.avif",
    "variants/img-avif/medium.webp",
    "variants/img-avif/thumb.avif",
    "variants/img-avif/thumb.webp"
  ]);

  putDocument("images", "img-avif", { id: "img-avif", uploadedBy: "google-admin", variants: upload.payload.variants });
  const served = await worker.fetch(new Request(`${API}/media/variants/img-avif/thumb.avif`, { headers: { Origin: ORIGIN } }), environment);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Content-Type"), "image/avif");
  assert.equal(served.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal((await served.arrayBuffer()).byteLength, 600);
});

test("AVIF בלי תצוגה רגילה, או בסוג אחר, נדחה לפני שנשמר דבר", async () => {
  putDocument("images", "img-av2", { id: "img-av2", uploadedBy: "google-admin" });
  const attach = fields => call(multipartRequest("/media/variants", { imageId: "img-av2", variantsMeta: META, ...fields }, "admin-token"));

  const orphan = await attach({ variant_thumb: webp(), variant_medium_avif: avif("medium.avif") });
  assert.equal(orphan.status, 400);
  assert.equal(orphan.payload.code, "avif_without_variant");

  const wrongType = await attach({ variant_thumb: webp(), variant_thumb_avif: webp("thumb.avif") });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.payload.code, "unsupported_variant_type");

  const huge = await attach({ variant_thumb: webp(), variant_thumb_avif: avif("thumb.avif", 2 * 1024 * 1024 + 1) });
  assert.equal(huge.status, 413);

  assert.deepEqual(bucket.keys(), []);
  assert.deepEqual(ledgerRows("img-av2"), []);
});

test("תצוגה חדשה בלי AVIF מוחקת את עותק ה-AVIF הישן שאינו תואם לה", async () => {
  putDocument("images", "img-av3", { id: "img-av3", uploadedBy: "google-admin" });
  const first = await call(multipartRequest("/media/variants", {
    imageId: "img-av3", variantsMeta: META, variant_thumb: webp(), variant_thumb_avif: avif()
  }, "admin-token"));
  assert.equal(first.status, 200, first.text);
  assert.ok(bucket.objects.has("variants/img-av3/thumb.avif"));

  const second = await call(multipartRequest("/media/variants", {
    imageId: "img-av3", variantsMeta: META, variant_thumb: new File([bytes(900)], "thumb.jpg", { type: "image/jpeg" })
  }, "admin-token"));
  assert.equal(second.status, 200, second.text);
  assert.deepEqual(bucket.keys(), ["variants/img-av3/thumb.jpg"]);
  assert.equal(readDocument("images", "img-av3").variants.thumb.avif, undefined);
  assert.deepEqual(ledgerRows("img-av3").map(row => row.object_key), ["variants/img-av3/thumb.jpg"]);
});

test("טבלת media_variant_files רושמת כל קובץ, ומתנקה במחיקת הפריט", async () => {
  const upload = await uploadWithVariants("img-led", "admin-token", { variant_thumb_avif: avif() });
  assert.equal(upload.status, 201, upload.text);
  assert.deepEqual(ledgerRows("img-led"), [
    { object_key: "variants/img-led/medium.webp", variant_name: "medium", format: "webp", content_type: "image/webp", width: 1280, height: 853, size_bytes: 20000 },
    { object_key: "variants/img-led/thumb.avif", variant_name: "thumb", format: "avif", content_type: "image/avif", width: 480, height: 320, size_bytes: 600 },
    { object_key: "variants/img-led/thumb.webp", variant_name: "thumb", format: "webp", content_type: "image/webp", width: 480, height: 320, size_bytes: 1200 }
  ]);

  const single = await call(jsonRequest("/media/variants/img-led/thumb.avif", "DELETE", undefined, "super-token"));
  assert.equal(single.status, 200, single.text);
  assert.deepEqual(ledgerRows("img-led").map(row => row.object_key), ["variants/img-led/medium.webp", "variants/img-led/thumb.webp"]);

  const removed = await call(jsonRequest("/media/approved/google-admin/img-led.jpg", "DELETE", undefined, "super-token"));
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(bucket.keys(), []);
  assert.deepEqual(ledgerRows("img-led"), []);
});

test("GET /media/variants/stats — סיכום לפי פורמט, למנהלים בלבד", async () => {
  await uploadWithVariants("img-s1", "admin-token", { variant_thumb_avif: avif() });
  await uploadWithVariants("img-s2", "admin-token");

  const denied = await call(jsonRequest("/media/variants/stats", "GET", undefined, "viewer-token"));
  assert.equal(denied.status, 403);

  const stats = await call(jsonRequest("/media/variants/stats", "GET", undefined, "admin-token"));
  assert.equal(stats.status, 200, stats.text);
  assert.equal(stats.payload.files, 5);
  assert.equal(stats.payload.images, 2);
  assert.equal(stats.payload.bytes, 2 * (1200 + 20000) + 600);
  assert.deepEqual(stats.payload.byFormat, {
    avif: { files: 1, bytes: 600 },
    webp: { files: 4, bytes: 42400 }
  });
});
