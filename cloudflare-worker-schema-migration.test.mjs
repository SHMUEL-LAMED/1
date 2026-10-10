// מסלול המיגרציה של D1 על מסד ייצור קיים: מסד בגרסת סכימה 4, עם גרסאות
// הנתונים של שכבת הנתונים (data_version:<אוסף>) ובלי טבלת התצוגות. הבקשה
// הראשונה של ה-Worker החדש חייבת ליצור את media_variant_files, לעלות לגרסה 5
// (ומשם ל-6, אינדקס תאריך הצילום, ול-7, טבלאות ההעלאה בחלקים ו-Stream — ראו גם cloudflare-worker-capture-dates.test.mjs),
// לא לגעת בגרסאות הנתונים — ושכבת הנתונים (ETag) וצירוף תצוגות עובדים יחד.
// קובץ נפרד, כי ה-Worker זוכר בזיכרון שהסכימה כבר הוכנה.
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

class R2 {
  constructor() { this.objects = new Map(); }
  async put(key, body, options = {}) {
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { key, bytes, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
  }
  async get(key) { return this.objects.get(key) || null; }
  async head(key) { return this.objects.get(key) || null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.values()].filter(object => object.key.startsWith(prefix)), truncated: false };
  }
}

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" }
};

// מסד כפי שהוא בייצור לפני הענף: כל טבלאות הקובץ חוץ מטבלת התצוגות, גרסת
// סכימה 4, וגרסת נתונים שכבר נכתבה לאוסף images.
function productionDatabaseAtVersion4() {
  const d1 = new D1();
  d1.database.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  d1.database.exec("DROP TABLE media_variant_files");
  // הטבלאות של גרסה 7 לא היו קיימות במסד בגרסה 4.
  for (const table of ["upload_sessions", "upload_session_parts", "stream_videos"]) d1.database.exec(`DROP TABLE ${table}`);
  d1.database.exec(`CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  d1.database.exec(`CREATE TABLE user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  const insertMeta = d1.database.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  insertMeta.run("gallery", 4);
  insertMeta.run("data_version:images", 1000);
  insertMeta.run("data_version:userProfiles", 2000);
  const insertDoc = d1.database.prepare(
    "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)"
  );
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-admin", "admin@example.com", "admin"]]) {
    insertDoc.run("userProfiles", uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
    d1.database.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
  insertDoc.run("images", "old-1", JSON.stringify({ id: "old-1", title: "ישנה", uploadedBy: "google-admin", createdAt: 5 }), "google-admin");
  return d1;
}

function request(path, { method = "GET", token = "viewer-token", headers = {}, body } = {}) {
  return new Request(`${API}${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body
  });
}

function meta(d1, key) {
  return d1.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
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

test("מסד ייצור בגרסה 4 עולה לגרסה הנוכחית (8): טבלת התצוגות, אינדקס תאריך הצילום וטבלאות ההעלאה בחלקים נוצרים, גרסאות הנתונים נשמרות, ושכבת הנתונים מתיישנת אחרי צירוף תצוגות", async () => {
  const d1 = productionDatabaseAtVersion4();
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: new R2() };

  // בקשת נתונים רגילה היא הבקשה הראשונה אחרי הפריסה.
  const first = await worker.fetch(request("/data/images"), env);
  assert.equal(first.status, 200, await first.clone().text());
  const etag = first.headers.get("ETag");
  assert.ok(etag);

  const tables = d1.database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of [
    "media_variant_files", "idx_media_variant_files_image", "idx_gallery_documents_taken_at", "gallery_documents", "image_face_descriptors", "client_errors", "gallery_environment",
    "upload_sessions", "idx_upload_sessions_owner", "upload_session_parts", "stream_videos"
  ]) {
    assert.ok(tables.includes(name), `${name} חסר אחרי המיגרציה`);
  }
  // 5 — התצוגות; 6 — אינדקס המיון לפי תאריך הצילום; 7 — ההעלאה בחלקים ו-Stream.
  assert.equal(meta(d1, "gallery"), 8);
  // המיגרציה אינה נוגעת בגרסאות הנתונים של שכבת הנתונים.
  assert.equal(meta(d1, "data_version:images"), 1000);
  assert.equal(meta(d1, "data_version:userProfiles"), 2000);
  // הנתונים הקיימים לא נמחקו.
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS n FROM gallery_documents WHERE collection_name = 'images'").get().n, 1);

  // צירוף תצוגות לתמונה הישנה: נרשם בטבלה החדשה ומקדם את גרסת images.
  const form = new FormData();
  form.append("imageId", "old-1");
  form.append("variant_thumb", new File([new Uint8Array(700).fill(1)], "thumb.webp", { type: "image/webp" }));
  form.append("variantsMeta", JSON.stringify({ thumb: { width: 480, height: 320 } }));
  const attach = await worker.fetch(request("/media/variants", { method: "POST", token: "admin-token", body: form }), env);
  assert.equal(attach.status, 200, await attach.clone().text());
  assert.ok(meta(d1, "data_version:images") > 1000);
  assert.equal(d1.database.prepare("SELECT COUNT(*) AS n FROM media_variant_files WHERE image_id = 'old-1'").get().n, 1);

  // ה-ETag הישן אינו תקף עוד: הרשימה חוזרת במלואה, עם התצוגה.
  const after = await worker.fetch(request("/data/images", { headers: { "If-None-Match": etag } }), env);
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.get("ETag"), etag);
  assert.match(await after.text(), /variants\/old-1\/thumb\.webp/);
});

test("Worker ישן שכתב גרסה נמוכה יותר אינו מוריד את הגרסה הרשומה", async () => {
  // הסכימה כבר הוכנה בתהליך הזה, ולכן בודקים את ההוראה עצמה מול מסד שבו
  // הגרסה הרשומה גבוהה מזו של הקוד (כמו אחרי פריסה של ענף חדש יותר).
  const d1 = productionDatabaseAtVersion4();
  d1.database.prepare("UPDATE gallery_schema_meta SET schema_version = 9 WHERE schema_key = 'gallery'").run();
  const source = readFileSync(new URL("./cloudflare-worker.js", import.meta.url), "utf8");
  const upsert = source.match(/INSERT INTO gallery_schema_meta \(schema_key, schema_version, updated_at\)\s+VALUES \('gallery', \?, \?\)[\s\S]*?updated_at = excluded\.updated_at/)[0];
  d1.database.prepare(upsert).run(5, Date.now());
  assert.equal(meta(d1, "gallery"), 9);
});
