// המעבר מגרסת סכימה 6 ל-7 על מסד ייצור: הטבלאות של ההעלאה בחלקים
// (upload_sessions, upload_session_parts) ושל Stream (stream_videos) נוצרות
// בבקשה הראשונה, הגרסה עולה ל-7, גרסאות הנתונים והרשומות אינן משתנות —
// והעלאה בחלקים עובדת מיד על המסד שעבר. קובץ נפרד, כי ה-Worker זוכר בזיכרון
// שהסכימה כבר הוכנה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";

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
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

// R2 מינימלי עם העלאה בחלקים.
class R2 {
  constructor() { this.objects = new Map(); this.uploads = new Map(); }
  async put(key, body, options = {}) { this.objects.set(key, { key, body, options }); }
  async get(key) { return this.objects.get(key) || null; }
  async head(key) { return this.objects.get(key) || null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list() { return { objects: [], truncated: false }; }
  async createMultipartUpload(key, options) {
    const uploadId = `up-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, { key, options });
    return { key, uploadId };
  }
  resumeMultipartUpload() { return { async abort() {} }; }
}

const ACCOUNTS = { "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" } };

function databaseAtVersion6() {
  const d1 = new D1();
  d1.database.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  for (const table of ["upload_sessions", "upload_session_parts", "stream_videos"]) d1.database.exec(`DROP TABLE ${table}`);
  d1.database.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  d1.database.exec("CREATE TABLE user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const insertMeta = d1.database.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  insertMeta.run("gallery", 6);
  insertMeta.run("data_version:images", 1000);
  const insertDoc = d1.database.prepare(
    "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)"
  );
  insertDoc.run("userProfiles", "google-uploader", JSON.stringify({ uid: "google-uploader", email: "uploader@example.com", role: "uploader", status: "approved" }), "google-uploader");
  d1.database.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run("uploader@example.com", "google-uploader");
  insertDoc.run("images", "old-1", JSON.stringify({ id: "old-1", title: "ישנה", takenAt: 5 }), "google-uploader");
  return d1;
}

const originalFetch = globalThis.fetch;
test.before(() => {
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
});
test.after(() => { globalThis.fetch = originalFetch; });

test("מסד בגרסה 6 עולה לגרסה הנוכחית (8), דרך 7: טבלאות ההעלאה בחלקים ו-Stream נוצרות, הנתונים נשמרים, וההעלאה בחלקים עובדת", async () => {
  const d1 = databaseAtVersion6();
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: new R2() };
  const meta = key => d1.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;

  const first = await worker.fetch(new Request(`${API}/data/images`, { headers: { Origin: ORIGIN, Authorization: "Bearer uploader-token" } }), env);
  assert.equal(first.status, 200, await first.clone().text());
  const names = d1.database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of ["upload_sessions", "idx_upload_sessions_owner", "upload_session_parts", "stream_videos", "idx_gallery_documents_taken_at"]) {
    assert.ok(names.includes(name), `${name} חסר אחרי המיגרציה`);
  }
  assert.equal(meta("gallery"), 8);
  assert.equal(meta("data_version:images"), 1000);
  assert.match(await first.text(), /"old-1"/);

  const created = await worker.fetch(new Request(`${API}/upload/multipart/create`, {
    method: "POST",
    headers: { Origin: ORIGIN, Authorization: "Bearer uploader-token", "Content-Type": "application/json" },
    body: JSON.stringify({ imageId: "vid-1", mimeType: "video/mp4", size: 20 * 1024 * 1024 })
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal((await created.json()).totalParts, 3);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS n FROM upload_sessions").get().n, 1);
});
