// המעבר מגרסת סכימה 9 לגרסה 11 על מסד ייצור קיים — כפי שיהיה אם ניהול המשתמשים
// (גרסה 9) נפרס לפני המיזוג עם "משתמשים ואנשים": טבלאות 9 (usage_daily,
// admin_user_notes) כבר קיימות ויש בהן נתונים. בבקשה הראשונה נוספות טבלאות 11
// ואינדקס contentHash, הגרסה עולה ל-11, ומה שבטבלאות 9 נשאר בדיוק כפי שהיה.
// ואחר כך: דחייה של פריט ממתין נספרת פעם אחת ב-usage_daily, בין שנרשמה לה סיבה
// ב-/pending/reject ובין שלא, ותיעוד הדחייה נשמר עם הסיבה.
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

// מסד בגרסה 9: כל הטבלאות של 9 (עם נתונים), בלי טבלאות 11 ובלי האינדקס החדש.
function databaseAtVersion9() {
  const d1 = new D1();
  const db = d1.database;
  db.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  for (const table of ["upload_rejections", "face_manual_tags", "invite_links"]) db.exec(`DROP TABLE ${table}`);
  db.exec("DROP INDEX idx_gallery_documents_content_hash");
  db.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const meta = db.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  meta.run("gallery", 9);
  meta.run("data_version:images", 1000);
  const doc = db.prepare("INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)");
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-super", "super@example.com", "super_admin"]]) {
    doc.run("userProfiles", uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
    db.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
  for (const id of ["pend_a", "pend_b"]) {
    doc.run("pendingImages", id, JSON.stringify({ id, title: `ממתין ${id}`, status: "pending", uploadedBy: "google-viewer" }), "google-viewer");
  }
  // נתונים שנצברו בגרסה 9 ואמורים לשרוד את המעבר.
  db.prepare("INSERT INTO usage_daily (day, metric, count, updated_at) VALUES ('2026-10-01', 'views', 42, 1)").run();
  db.prepare("INSERT INTO usage_daily (day, metric, count, updated_at) VALUES ('2026-10-01', 'rejections', 3, 1)").run();
  db.prepare(`INSERT INTO admin_user_notes (note_id, target_uid, author_uid, author_name, body, created_at)
    VALUES ('note_00000000-0000-0000-0000-000000000001', 'google-viewer', 'google-super', 'Super', 'הערה מגרסה 9', 1)`).run();
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

test("מסד בגרסה 9 עם טבלאות 9 ונתונים בהן עולה ל-11: טבלאות 11 נוספות, נתוני 9 נשמרים, ודחייה נספרת פעם אחת", async () => {
  const d1 = databaseAtVersion9();
  const db = d1.database;
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: { async list() { return { objects: [] }; } } };
  const meta = key => db.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
  const usageBefore = db.prepare("SELECT * FROM usage_daily ORDER BY day, metric").all();
  const notesBefore = db.prepare("SELECT * FROM admin_user_notes").all();
  const v9TablesBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('usage_daily', 'admin_user_notes', 'idx_admin_user_notes_target') ORDER BY name").all();

  const first = await call(env, "/data/images");
  assert.equal(first.status, 200, first.text);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of ["usage_daily", "admin_user_notes", "idx_admin_user_notes_target",
    "upload_rejections", "idx_upload_rejections_uploader", "idx_upload_rejections_time", "face_manual_tags",
    "idx_face_manual_tags_person", "invite_links", "idx_invite_links_expires", "idx_gallery_documents_content_hash"]) {
    assert.ok(names.includes(name), `${name} חסר אחרי המיגרציה`);
  }
  assert.equal(meta("gallery"), 11);
  assert.equal(meta("data_version:images"), 1000);
  assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('usage_daily', 'admin_user_notes', 'idx_admin_user_notes_target') ORDER BY name").all(), v9TablesBefore);
  assert.deepEqual(db.prepare("SELECT * FROM usage_daily ORDER BY day, metric").all(), usageBefore);
  assert.deepEqual(db.prepare("SELECT * FROM admin_user_notes").all(), notesBefore);

  // ההערה מגרסה 9 נקראת דרך הנתיב של 9 גם אחרי המעבר.
  const notes = await call(env, "/admin/user-notes?uid=google-viewer", "GET", undefined, "super-token");
  assert.equal(notes.status, 200, notes.text);
  assert.deepEqual(notes.payload.notes.map(note => note.body), ["הערה מגרסה 9"]);

  const todayRejections = () => db.prepare(
    "SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily WHERE metric = 'rejections' AND day <> '2026-10-01'"
  ).get().n;

  // דחייה עם סיבה: /pending/reject רושם את הסיבה בלבד, ואינו סופר.
  const reasoned = await call(env, "/pending/reject", "POST", { imageId: "pend_a", reason: "מטושטש" }, "super-token");
  assert.equal(reasoned.status, 200, reasoned.text);
  assert.equal(todayRejections(), 0);
  // המחיקה מהתור היא הדחייה עצמה: נספרת פעם אחת, והסיבה שנרשמה נשארת.
  const deletedA = await call(env, "/data/pendingImages/pend_a", "DELETE", undefined, "super-token");
  assert.equal(deletedA.status, 200, deletedA.text);
  assert.equal(todayRejections(), 1);
  assert.equal(db.prepare("SELECT reason FROM upload_rejections WHERE image_id = 'pend_a'").get().reason, "מטושטש");

  // דחייה בלי סיבה (Worker/אתר ישן): המחיקה סופרת פעם אחת ויוצרת תיעוד בלי סיבה.
  const deletedB = await call(env, "/data/pendingImages/pend_b", "DELETE", undefined, "super-token");
  assert.equal(deletedB.status, 200, deletedB.text);
  assert.equal(todayRejections(), 2);
  assert.equal(db.prepare("SELECT reason FROM upload_rejections WHERE image_id = 'pend_b'").get().reason, "");

  // המעלה רואה את שתי הדחיות ב"ההעלאות שלי".
  const mine = await call(env, "/my-uploads");
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.payload.uploads.map(item => [item.id, item.status]).sort(), [["pend_a", "rejected"], ["pend_b", "rejected"]]);
});
