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
      async arrayBuffer() { return stored.bytes.slice().buffer; },
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
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket, OPENAI_API_KEY: "mock-key" };
let aiCalls = 0;
let aiResponse = "בחורים רוקדים במעגל";
let aiStatus = 200;
let onAiCall = null;

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
    if (href === "https://api.openai.com/v1/responses") {
      aiCalls += 1;
      if (onAiCall) onAiCall();
      return Response.json(aiStatus >= 400 ? { error: { code: "model_not_found", message: "private provider details must not escape" } } : { output: [{ content: [{ type: "output_text", text: aiResponse }] }] }, { status: aiStatus });
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
  aiCalls = 0; aiResponse = "בחורים רוקדים במעגל"; aiStatus = 200; onAiCall = null;
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


async function seedImage(id = "photo1") {
  putDocument("images", id, { id, title: "IMG_001.jpg", url: `${API}/media/approved/google-admin/${id}.jpg`, r2Key: `approved/google-admin/${id}.jpg`, mediaType: "image" });
  await bucket.put(`approved/google-admin/${id}.jpg`, new Uint8Array([1,2,3]), { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { state: "approved" } });
}
async function titleCall(token = "admin-token", id = "photo1") {
  return worker.fetch(jsonRequest("/ai-title", "POST", { imageId: id }, token), environment);
}

test("AI title is persisted with original title and skipped on repeat", async () => {
  await seedImage();
  const response = await titleCall();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, "בחורים רוקדים במעגל");
  const saved = readDocument("images", "photo1");
  assert.equal(saved.originalTitle, "IMG_001.jpg");
  assert.equal(saved.aiTitleVersion, 1);
  assert.equal((await titleCall()).status, 200);
  assert.equal(aiCalls, 1);
});
test("viewer cannot spend title API quota", async () => {
  await seedImage();
  assert.equal((await titleCall("viewer-token")).status, 403);
  assert.equal(aiCalls, 0);
});
test("external images are rejected before calling AI", async () => {
  await seedImage();
  putDocument("images", "photo1", { id: "photo1", url: "https://example.com/private.jpg", title: "old" });
  assert.equal((await titleCall()).status, 400);
  assert.equal(aiCalls, 0);
});
test("provider errors and non-Hebrew outputs leave titles unchanged", async () => {
  await seedImage();
  aiStatus = 429;
  assert.equal((await titleCall()).status, 429);
  assert.equal(readDocument("images", "photo1").title, "IMG_001.jpg");
  aiStatus = 200; aiResponse = "invalid";
  assert.equal((await titleCall()).status, 502);
  assert.equal(readDocument("images", "photo1").aiTitleVersion, undefined);
});
test("concurrent manual edit is never overwritten", async () => {
  await seedImage();
  onAiCall = () => database.database.prepare("UPDATE gallery_documents SET data_json = json_set(data_json, '$.title', ?), updated_at = updated_at + 1 WHERE collection_name = 'images' AND document_id = 'photo1'").run("שם ידני");
  assert.equal((await titleCall()).status, 409);
  assert.equal(readDocument("images", "photo1").title, "שם ידני");
});
test("new approved image starts a background title task", async () => {
  await seedImage();
  database.database.prepare("DELETE FROM gallery_documents WHERE collection_name = 'images' AND document_id = 'photo1'").run();
  const tasks = [];
  const response = await worker.fetch(jsonRequest("/data/images/photo1", "PUT", { data: { id: "photo1", title: "IMG_001.jpg", url: `${API}/media/approved/google-admin/photo1.jpg`, r2Key: "approved/google-admin/photo1.jpg", mediaType: "image" } }), environment, { waitUntil(task) { tasks.push(task); } });
  assert.equal(response.status, 200);
  assert.equal(tasks.length, 1);
  await Promise.all(tasks);
  assert.equal(readDocument("images", "photo1").aiTitleVersion, 1);
});

test("AI failure exposes only provider status and code for maintenance diagnosis", async () => {
  await seedImage(); aiStatus = 404;
  const response = await titleCall();
  const body = await response.json();
  assert.equal(body.providerCode,"model_not_found");
  assert.equal(body.providerStatus,404);
  assert.equal(JSON.stringify(body).includes("private provider details"),false);
});
