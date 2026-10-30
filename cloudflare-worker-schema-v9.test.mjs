// המעבר מגרסת סכימה 8 ל-9 על מסד ייצור קיים: שתי טבלאות חדשות בלבד —
// usage_daily (מוני שימוש) ו-admin_user_notes (הערות פנימיות על משתמש) —
// נוצרות בבקשה הראשונה, הגרסה עולה ל-9, ושום טבלה, עמודה או רשומה קיימת
// אינה משתנה. Worker ישן (גרסה 8) שיפרס שוב אינו מוריד את הגרסה.
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

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

// מסד כפי שהוא בייצור בגרסה 8: כל הטבלאות של היום, בלי שתי החדשות.
function databaseAtVersion8() {
  const d1 = new D1();
  const db = d1.database;
  db.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  db.exec("DROP TABLE usage_daily");
  db.exec("DROP TABLE admin_user_notes");
  db.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const meta = db.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  meta.run("gallery", 8);
  meta.run("data_version:images", 1000);
  meta.run("data_version:userProfiles", 2000);
  const doc = db.prepare("INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)");
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-super", "super@example.com", "super_admin"]]) {
    doc.run("userProfiles", uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
    db.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
  doc.run("images", "old-1", JSON.stringify({ id: "old-1", title: "ישנה", url: "https://media.example/old-1.jpg", variants: { thumb: { url: "https://media.example/t.webp" } } }), "google-super");
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

async function call(env, path, method = "GET", body, token = "viewer-token") {
  const response = await worker.fetch(new Request(`${API}${path}`, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env);
  const text = await response.text();
  return { status: response.status, text, payload: JSON.parse(text || "{}") };
}

test("מסד בגרסה 8 עולה ל-9: שתי הטבלאות החדשות נוצרות, וכל השאר נשאר בדיוק כפי שהיה", async () => {
  const d1 = databaseAtVersion8();
  const db = d1.database;
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: { async list() { return { objects: [] }; } } };
  const meta = key => db.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
  const tablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const documentsBefore = db.prepare("SELECT * FROM gallery_documents ORDER BY collection_name, document_id").all();

  const first = await call(env, "/data/images");
  assert.equal(first.status, 200, first.text);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of ["usage_daily", "admin_user_notes", "idx_admin_user_notes_target"]) assert.ok(names.includes(name), `${name} חסר אחרי המיגרציה`);
  assert.equal(meta("gallery"), 9);
  assert.equal(meta("data_version:images"), 1000);
  assert.equal(meta("data_version:userProfiles"), 2000);

  // כל טבלה שהייתה — באותה הגדרה בדיוק; אף רשומה לא השתנתה.
  // (טבלאות שה-Worker יוצר תמיד ואינן בקובץ הסכימה — auth_secrets ו-request_rate_limits — אינן בהשוואה.)
  const existedBefore = new Set(tablesBefore.map(row => row.name));
  const tablesAfter = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    .filter(row => existedBefore.has(row.name));
  assert.deepEqual(tablesAfter, tablesBefore);
  assert.deepEqual(db.prepare("SELECT * FROM gallery_documents ORDER BY collection_name, document_id").all(), documentsBefore);
  assert.deepEqual(db.prepare("PRAGMA table_info(usage_daily)").all().map(row => row.name), ["day", "metric", "count", "updated_at"]);
  assert.deepEqual(db.prepare("PRAGMA table_info(admin_user_notes)").all().map(row => row.name), ["note_id", "target_uid", "author_uid", "author_name", "body", "created_at"]);

  // התכונות החדשות עובדות מיד על המסד שעלה.
  const beacon = await call(env, "/stats/beacon", "POST", { counts: { views: 2 } });
  assert.equal(beacon.status, 200, beacon.text);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usage_daily").get().n, 2);
  const note = await call(env, "/admin/user-notes", "POST", { uid: "google-viewer", body: "הערה ראשונה" }, "super-token");
  assert.equal(note.status, 200, note.text);

  // Worker ישן (גרסה 8) אינו מוריד את הגרסה: הכתיבה היא MAX.
  db.prepare(
    `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES ('gallery', 8, 2)
     ON CONFLICT(schema_key) DO UPDATE SET schema_version = MAX(gallery_schema_meta.schema_version, excluded.schema_version)`
  ).run();
  assert.equal(meta("gallery"), 9);
});
