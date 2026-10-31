// המעבר לגרסת סכימה 11 על מסד ייצור קיים — בגרסה 9, כפי שיהיה אחרי ענף ניהול
// המשתמשים (המיגרציה כאן אינה תלויה בטבלאות שלו, ולכן זהה גם מגרסה 8): הטבלאות החדשות (upload_rejections,
// face_manual_tags, invite_links) ואינדקס contentHash נוצרים בבקשה הראשונה, הגרסה
// עולה ל-11 — והנתונים הקיימים אינם משתנים: הרשומות, הפרופילים, האנשים, השיוכים
// וגרסאות הנתונים. רשומות ישנות עם contentHash (מאז זיהוי הכפילויות הראשון בדפדפן)
// נמצאות מיד בבדיקת הכפילויות, ורשומות בלי השדה פשוט אינן מזוהות.
// קובץ נפרד, כי ה-Worker זוכר בזיכרון שהסכימה כבר הוכנה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";
const HASH = "f".repeat(64);

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
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" }
};

// מסד כפי שהוא בייצור לפני הענף הזה: בלי טבלאות 11 ובלי האינדקס החדש; בגרסה 8
// גם בלי טבלאות 9 (usage_daily, admin_user_notes), בגרסה 9 — איתן.
function databaseBeforeThisBranch(version = 8) {
  const d1 = new D1();
  const db = d1.database;
  db.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  for (const table of ["upload_rejections", "face_manual_tags", "invite_links"]) db.exec(`DROP TABLE ${table}`);
  db.exec("DROP INDEX idx_gallery_documents_content_hash");
  if (version < 9) for (const table of ["usage_daily", "admin_user_notes"]) db.exec(`DROP TABLE ${table}`);
  db.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const meta = db.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  meta.run("gallery", version);
  meta.run("data_version:images", 1000);
  meta.run("data_version:facePeople", 3000);
  const doc = db.prepare("INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)");
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-admin", "admin@example.com", "admin"]]) {
    doc.run("userProfiles", uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
    db.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
  doc.run("folders", "f1", JSON.stringify({ id: "f1", name: "אירוע" }), "google-admin");
  doc.run("images", "old_hashed", JSON.stringify({ id: "old_hashed", title: "ישן", contentHash: HASH, uploadedBy: "google-viewer", folderId: "f1" }), "google-viewer");
  doc.run("images", "old_plain", JSON.stringify({ id: "old_plain", title: "ישן בלי טביעה" }), "google-admin");
  doc.run("pendingImages", "old_pending", JSON.stringify({ id: "old_pending", title: "ממתין ישן", status: "pending", uploadedBy: "google-viewer" }), "google-viewer");
  db.prepare(`INSERT INTO face_persons (person_id, model_version, name, status, created_at, updated_at)
    VALUES ('p1', 'faceapi-1.7.15-ssd-l68-r1', 'דנה', 'approved', 1, 1)`).run();
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

test(`מסד בגרסה 9 (עם טבלאות 9, בלי טבלאות הענף הזה) עולה ל-11: הטבלאות והאינדקס נוספים, הנתונים הקיימים לא משתנים, והאתר הקיים ממשיך לעבוד`, async () => {
  const d1 = databaseBeforeThisBranch(9);
  const db = d1.database;
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: { async list() { return { objects: [] }; } } };
  const meta = key => db.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
  const documentsBefore = db.prepare("SELECT collection_name, document_id, data_json, owner_uid, created_at, updated_at FROM gallery_documents ORDER BY collection_name, document_id").all();
  const personsBefore = db.prepare("SELECT * FROM face_persons").all();

  const first = await call(env, "/data/images");
  assert.equal(first.status, 200, first.text);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of ["upload_rejections", "idx_upload_rejections_uploader", "idx_upload_rejections_time", "face_manual_tags",
    "idx_face_manual_tags_person", "invite_links", "idx_invite_links_expires", "idx_gallery_documents_content_hash"]) {
    assert.ok(names.includes(name), `${name} חסר אחרי המיגרציה`);
  }
  assert.equal(meta("gallery"), 11);
  assert.equal(meta("data_version:images"), 1000);
  assert.equal(meta("data_version:facePeople"), 3000);
  assert.deepEqual(db.prepare("SELECT collection_name, document_id, data_json, owner_uid, created_at, updated_at FROM gallery_documents ORDER BY collection_name, document_id").all(), documentsBefore);
  assert.deepEqual(db.prepare("SELECT * FROM face_persons").all(), personsBefore);
  for (const table of ["upload_rejections", "face_manual_tags", "invite_links"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} נוצרת ריקה`);
  }

  // רשומה ישנה עם טביעה מזוהה מיד; רשומה בלי טביעה פשוט אינה מזוהה.
  const duplicates = await call(env, "/duplicates", "POST", { hashes: [HASH, "0".repeat(64)] });
  assert.equal(duplicates.status, 200, duplicates.text);
  assert.deepEqual(duplicates.payload.results.map(result => [result.exists, result.imageId || ""]), [[true, "old_hashed"], [false, ""]]);

  // הממתין הישן מופיע ב"ההעלאות שלי", והמאושר עם התיקייה שלו.
  const mine = await call(env, "/my-uploads");
  assert.deepEqual(mine.payload.uploads.map(item => [item.id, item.status, item.folderName || ""]).sort(),
    [["old_hashed", "approved", "אירוע"], ["old_pending", "pending", ""]]);

  // אתר ישן (בלי שדות חדשים) ממשיך לכתוב רשומה ממתינה כמו קודם.
  const legacyWrite = await call(env, "/data/pendingImages/legacy_new", "PUT", {
    data: { id: "legacy_new", title: "x", status: "pending", uploadedBy: "google-viewer", uploadedByName: "Viewer" }
  });
  assert.equal(legacyWrite.status, 200, legacyWrite.text);
  assert.equal(JSON.parse(db.prepare("SELECT data_json FROM gallery_documents WHERE document_id = 'legacy_new'").get().data_json).uploadedBy, "google-viewer");
  // הרשימה והאלבום של אדם עובדים כמו קודם, גם בלי תיוגים ידניים.
  const persons = await call(env, "/face/persons");
  assert.equal(persons.status, 200, persons.text);
});
