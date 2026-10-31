// תיוג ידני של אדם בתמונה שבה זיהוי הפנים לא מצא אותו (face_manual_tags):
// רק מנהל מתייג ומסיר, רק אדם מאושר עם שם, והתיוג מופיע באלבום של האדם
// (מסומן ידני), ברשימת האנשים ובתוצאות "התמונות שלי" (source: manual). וגם
// התמונה הראשית של אדם (cover) — שהמנהל בוחר — היא זו שמוצגת ברשימה ובאלבום.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.bindings = []; }
  bind(...values) {
    this.bindings = values.map(value => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value));
    return this;
  }
  async first() { return this.database.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class D1 {
  constructor() { this.database = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Statement(this.database, sql); }
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

const database = new D1();
const sql = database.database;
const environment = {
  GALLERY_DB: database,
  GALLERY_BUCKET: {
    async list() { return { objects: [] }; },
    async head() { return null; },
    async get() { return null; },
    async put() { return {}; },
    async delete() {}
  }
};

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

const originalFetch = globalThis.fetch;
test.before(async () => {
  delete globalThis.caches;
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const account = ACCOUNTS[new URL(href).searchParams.get("id_token")];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(request("/health", "GET", undefined, ""), environment);
  assert.ok((await health.json()).features.includes("face-manual-tags"));
});
test.after(() => { globalThis.fetch = originalFetch; });

function descriptor(shift) {
  const vector = new Array(128).fill(0.08);
  vector[1] += shift;
  return vector.map(value => Math.round(value * 1e6) / 1e6);
}

test.beforeEach(() => {
  for (const table of ["face_people", "face_persons", "face_cluster_marks", "image_face_descriptors", "image_face_index_state",
    "face_manual_tags", "gallery_documents", "request_rate_limits", "user_email_index"]) {
    sql.exec(`DELETE FROM ${table}`);
  }
  sql.exec("DELETE FROM gallery_schema_meta WHERE schema_key <> 'gallery'");
  for (const [uid, email, role] of [
    ["google-viewer", "viewer@example.com", "viewer"],
    ["google-uploader", "uploader@example.com", "uploader"],
    ["google-admin", "admin@example.com", "admin"],
    ["google-super", "super@example.com", "super_admin"]
  ]) putDocument("userProfiles", uid, { uid, email, role, status: "approved" }, uid);
  // דנה: מאושרת עם שם, זוהתה ב-seen1 וב-seen2. יוסי: מאושר אך מוסתר. אדם מוצע בלי שם.
  for (const id of ["seen1", "seen2", "missed1", "missed2", "missed3"]) {
    putDocument("images", id, { id, title: id, url: `https://media.example/${id}.jpg`, takenAt: Date.UTC(2026, 0, Number(id.at(-1))) });
  }
  const insertFace = sql.prepare("INSERT INTO image_face_descriptors (image_id, face_index, descriptor_json, model_version, box_json, created_at, updated_at) VALUES (?, 0, ?, ?, ?, 1, 1)");
  const link = sql.prepare("INSERT INTO face_people (image_id, face_index, model_version, descriptor_json, person_id, source, assigned_at) VALUES (?, 0, ?, ?, 'dana', 'auto', 1)");
  for (const [id, shift] of [["seen1", 0], ["seen2", 0.01]]) {
    const json = JSON.stringify(descriptor(shift));
    insertFace.run(id, json, MODEL_VERSION, JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2, a: 1 }));
    link.run(id, MODEL_VERSION, json);
  }
  const person = sql.prepare(`INSERT INTO face_persons (person_id, model_version, name, status, hidden, face_count, image_count, cover_image_id, cover_face_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`);
  person.run("dana", MODEL_VERSION, "דנה", "approved", 0, 2, 2, "seen1", 0);
  person.run("yossi", MODEL_VERSION, "יוסי", "approved", 1, 0, 0, "", -1);
  person.run("suggested", MODEL_VERSION, "", "suggested", 0, 0, 0, "", -1);
  person.run("only_manual", MODEL_VERSION, "רק ידני", "approved", 0, 0, 0, "", -1);
});

function putDocument(collection, id, data, owner = "google-admin") {
  sql.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), owner);
}

function request(path, method = "GET", body, token = "admin-token") {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(path, method = "GET", body, token = "admin-token") {
  const response = await worker.fetch(request(path, method, body, token), environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

const tag = (imageId, personId, extra = {}, token = "admin-token") =>
  call("/face/tags", "POST", { action: "add", imageId, personId, ...extra }, token);

function dataVersion() {
  return Number(sql.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'data_version:facePeople'").get()?.schema_version || 0);
}

test("תיוג ידני: רק מנהל קורא, מתייג ומסיר; צופה ומעלה נדחים", async () => {
  for (const token of ["viewer-token", "uploader-token", ""]) {
    assert.ok([401, 403].includes((await tag("missed1", "dana", {}, token)).status), token);
    assert.ok([401, 403].includes((await call("/face/tags?imageId=missed1", "GET", undefined, token)).status), token);
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_manual_tags").get().n, 0);
  const before = dataVersion();
  const added = await tag("missed1", "dana", { box: { x: 0.2, y: 0.3, w: 0.25, h: 0.3, a: 1.5 } });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.payload.tags.map(item => [item.personId, item.name, item.box?.w]), [["dana", "דנה", 0.25]]);
  assert.ok(dataVersion() > before, "המטמון של האנשים מתיישן");
  const read = await call("/face/tags?imageId=missed1");
  assert.equal(read.payload.tags.length, 1);
  const removed = await call("/face/tags", "POST", { action: "remove", imageId: "missed1", personId: "dana" }, "super-token");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.payload.tags, []);
});

test("תיוג ידני: בדיקת קלט — אדם מאושר עם שם בלבד, תמונה קיימת, מלבן תקין ותקרה לתמונה", async () => {
  assert.equal((await tag("missed1", "suggested")).status, 400);
  assert.equal((await tag("missed1", "nobody")).status, 400);
  assert.equal((await tag("missed1", "bad id!")).status, 400);
  assert.equal((await tag("no_such_image", "dana")).status, 404);
  assert.equal((await tag("missed1", "dana", { box: { x: 0.9, y: 0, w: 0.5, h: 0.5, a: 1 } })).status, 400);
  assert.equal((await tag("missed1", "dana", { box: "<svg>" })).status, 400);
  assert.equal((await call("/face/tags", "POST", { action: "delete-all", imageId: "missed1", personId: "dana" })).status, 400);
  // תיוג חוזר מעדכן את המלבן, אינו מוסיף שורה.
  assert.equal((await tag("missed1", "dana")).status, 200);
  assert.equal((await tag("missed1", "dana", { box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1, a: 1 } })).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_manual_tags").get().n, 1);
  const insert = sql.prepare("INSERT INTO face_manual_tags (image_id, person_id, created_at) VALUES ('missed2', ?, 1)");
  for (let index = 0; index < 30; index += 1) insert.run(`filler_${index}`);
  const tooMany = await tag("missed2", "dana");
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.payload.code, "too_many_tags");
});

test("האלבום: תמונה מתויגת ידנית מצטרפת לפי המיון ומסומנת ב-manualImageIds; הרשימה סופרת אותה", async () => {
  await tag("missed3", "dana");
  await tag("seen2", "dana");
  await tag("missed2", "only_manual");
  const album = await call("/face/persons/dana", "GET", undefined, "viewer-token");
  assert.equal(album.status, 200, album.text);
  assert.deepEqual(album.payload.imageIds, ["missed3", "seen2", "seen1"]);
  assert.deepEqual(album.payload.manualImageIds, ["missed3"], "תמונה שזוהתה גם בפנים אינה 'ידנית'");
  const list = await call("/face/persons", "GET", undefined, "viewer-token");
  const counts = Object.fromEntries(list.payload.persons.map(person => [person.personId, person.imageCount]));
  assert.deepEqual(counts, { dana: 3, only_manual: 1 });
  // התמונה הראשית שהמנהל בחר (cover) היא זו שמוצגת ברשימה ובאלבום.
  assert.equal(list.payload.persons.find(person => person.personId === "dana").cover.imageId, "seen1");
  await call("/face/groups", "POST", { action: "cover", personId: "dana", face: { imageId: "seen2", faceIndex: 0, updatedAt: 1 } });
  const afterCover = await call("/face/persons/dana", "GET", undefined, "viewer-token");
  assert.equal(afterCover.payload.person.cover.imageId, "seen2");
  const onlyManual = await call("/face/persons/only_manual", "GET", undefined, "viewer-token");
  assert.deepEqual(onlyManual.payload.imageIds, ["missed2"]);
  assert.deepEqual(onlyManual.payload.manualImageIds, ["missed2"]);
});

test("אדם מוסתר: התיוג אינו פותח לצופים את האלבום ואינו מרחיב את החיפוש", async () => {
  await tag("missed1", "yossi");
  assert.equal((await call("/face/persons/yossi", "GET", undefined, "viewer-token")).status, 404);
  const list = await call("/face/persons", "GET", undefined, "viewer-token");
  assert.ok(!list.payload.persons.some(person => person.personId === "yossi"));
});

test("התמונות שלי: תמונה שבה האדם תויג ידנית חוזרת עם source: manual, בלי אחוז התאמה", async () => {
  await tag("missed2", "dana");
  const search = await call("/face/search", "POST", { descriptor: descriptor(0), modelVersion: MODEL_VERSION }, "viewer-token");
  assert.equal(search.status, 200, search.text);
  const byId = Object.fromEntries(search.payload.matches.map(match => [match.imageId, match]));
  assert.deepEqual(Object.keys(byId).sort(), ["missed2", "seen1", "seen2"]);
  assert.equal(byId.missed2.source, "manual");
  assert.equal(byId.missed2.confidence, null);
  assert.equal(byId.seen1.source, "biometric");
});

test("מחיקת תמונה, מיזוג אנשים ואיפוס האינדוקס מטפלים גם בתיוגים", async () => {
  await tag("missed1", "dana");
  await tag("missed2", "only_manual");
  await tag("missed3", "only_manual");
  await tag("missed3", "dana");
  // מחיקת תמונה מוחקת את התיוגים שלה.
  assert.equal((await call("/data/images/missed1", "DELETE", undefined, "super-token")).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_manual_tags WHERE image_id = 'missed1'").get().n, 0);
  // מיזוג: התיוגים עוברים לאדם שנשאר, בלי כפילות.
  const merged = await call("/face/groups", "POST", { action: "merge", targetId: "dana", sourceId: "only_manual" });
  assert.equal(merged.status, 200, merged.text);
  assert.deepEqual(sql.prepare("SELECT image_id, person_id FROM face_manual_tags ORDER BY image_id").all().map(row => [row.image_id, row.person_id]),
    [["missed2", "dana"], ["missed3", "dana"]]);
  assert.equal((await call("/face/index/reset", "POST", { scope: "all" }, "super-token")).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM face_manual_tags").get().n, 0);
});
