// המעבר מגרסת סכימה 7 ל-8 על מסד ייצור עם נתוני פנים קיימים: טבלאות האנשים
// (face_persons, face_cluster_marks, face_user_descriptors) נוצרות בבקשה
// הראשונה, העמודות החדשות נוספות לטבלאות הקיימות, הגרסה עולה ל-8 — והנתונים
// הקיימים אינם משתנים: הטביעות, השיוכים הידניים, הרשומות וגרסאות הנתונים.
// קבוצה ידנית קיימת מקבלת רשומת אדם, וממשיכה להרחיב את החיפוש כמו קודם.
// קובץ נפרד, כי ה-Worker זוכר בזיכרון שהסכימה כבר הוכנה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";
const MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";
const LEGACY_PERSON = "3f1c2b7e-0a4d-4c2e-9b1a-5d6e7f809a1b";

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

function descriptor(shift) {
  const vector = new Array(128).fill(0.08);
  vector[0] += shift;
  return JSON.stringify(vector.map(value => Math.round(value * 1e6) / 1e6));
}

// מסד כפי שהוא בייצור בגרסה 7: טבלאות הפנים בצורתן הישנה (בלי box_json,
// source ו-assigned_at), בלי טבלאות האנשים, עם קבוצה ידנית אחת.
function databaseAtVersion7() {
  const d1 = new D1();
  const db = d1.database;
  db.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  for (const table of ["face_persons", "face_cluster_marks", "face_user_descriptors", "face_people", "image_face_descriptors"]) {
    db.exec(`DROP TABLE ${table}`);
  }
  db.exec(`CREATE TABLE image_face_descriptors (
    image_id TEXT NOT NULL, face_index INTEGER NOT NULL, descriptor_json TEXT NOT NULL,
    model_version TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (image_id, face_index))`);
  db.exec(`CREATE TABLE face_people (
    image_id TEXT NOT NULL, face_index INTEGER NOT NULL,
    model_version TEXT NOT NULL, descriptor_json TEXT NOT NULL,
    person_id TEXT NOT NULL, PRIMARY KEY (image_id, face_index))`);
  db.exec("CREATE INDEX idx_face_people_person ON face_people(person_id)");
  db.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const meta = db.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  meta.run("gallery", 7);
  meta.run("data_version:images", 1000);
  meta.run("data_version:userProfiles", 2000);
  const doc = db.prepare("INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)");
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-admin", "admin@example.com", "admin"]]) {
    doc.run("userProfiles", uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
    db.prepare("INSERT INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
  const insertFace = db.prepare("INSERT INTO image_face_descriptors VALUES (?, 0, ?, ?, 10, 20)");
  const link = db.prepare("INSERT INTO face_people VALUES (?, 0, ?, ?, ?)");
  // old-a ו-old-b רחוקות זו מזו (0.8), ומנהל איחד אותן ידנית לפני הענף.
  for (const [id, shift] of [["old-a", 0], ["old-b", 0.8], ["old-c", 1.6]]) {
    doc.run("images", id, JSON.stringify({ id, title: id, url: `https://media.example/${id}.jpg` }), "google-admin");
    insertFace.run(id, descriptor(shift), MODEL_VERSION);
  }
  link.run("old-a", MODEL_VERSION, descriptor(0), LEGACY_PERSON);
  link.run("old-b", MODEL_VERSION, descriptor(0.8), LEGACY_PERSON);
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

test("מסד בגרסה 7 עולה ל-8: טבלאות האנשים נוצרות, הנתונים הקיימים לא משתנים, והקבוצה הידנית ממשיכה לעבוד", async () => {
  const d1 = databaseAtVersion7();
  const db = d1.database;
  const env = { GALLERY_DB: d1, GALLERY_BUCKET: { async list() { return { objects: [] }; } } };
  const meta = key => db.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
  const descriptorsBefore = db.prepare("SELECT image_id, face_index, descriptor_json, model_version, created_at, updated_at FROM image_face_descriptors ORDER BY image_id").all();
  const linksBefore = db.prepare("SELECT image_id, face_index, model_version, descriptor_json, person_id FROM face_people ORDER BY image_id").all();

  const first = await call(env, "/data/images");
  assert.equal(first.status, 200, first.text);

  const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name);
  for (const name of ["face_persons", "idx_face_persons_status", "face_cluster_marks", "idx_face_cluster_marks_mark", "face_user_descriptors"]) {
    assert.ok(names.includes(name), `${name} חסר אחרי המיגרציה`);
  }
  const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  assert.ok(columns("face_people").includes("source"));
  assert.ok(columns("face_people").includes("assigned_at"));
  assert.ok(columns("image_face_descriptors").includes("box_json"));

  assert.equal(meta("gallery"), 8);
  assert.equal(meta("data_version:images"), 1000);
  assert.equal(meta("data_version:userProfiles"), 2000);

  // הנתונים הקיימים כפי שהיו: אותן טביעות, אותם שיוכים, והשיוך הישן מסומן ידני.
  assert.deepEqual(
    db.prepare("SELECT image_id, face_index, descriptor_json, model_version, created_at, updated_at FROM image_face_descriptors ORDER BY image_id").all(),
    descriptorsBefore
  );
  assert.deepEqual(
    db.prepare("SELECT image_id, face_index, model_version, descriptor_json, person_id FROM face_people ORDER BY image_id").all(),
    linksBefore
  );
  assert.deepEqual(db.prepare("SELECT DISTINCT source FROM face_people").all().map(row => row.source), ["manual"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM image_face_descriptors WHERE box_json <> ''").get().n, 0);
  const legacy = db.prepare("SELECT status, name, hidden FROM face_persons WHERE person_id = ?").get(LEGACY_PERSON);
  assert.deepEqual({ ...legacy }, { status: "suggested", name: "", hidden: 0 });

  // החיפוש עדיין מרחיב לפי הקבוצה הידנית, בדיוק כמו לפני הענף.
  const search = await call(env, "/face/search", "POST", { descriptor: JSON.parse(descriptor(0)), modelVersion: MODEL_VERSION });
  assert.equal(search.status, 200, search.text);
  assert.deepEqual(search.payload.matches.map(match => match.imageId).sort(), ["old-a", "old-b"]);

  // המנהל רואה את הקבוצה הישנה כהצעה שממתינה לשם, עוד לפני ריצת קיבוץ.
  const groups = await call(env, "/face/groups?view=suggested", "GET", undefined, "admin-token");
  assert.equal(groups.status, 200, groups.text);
  assert.equal(groups.payload.persons.length, 1);
  assert.equal(groups.payload.persons[0].personId, LEGACY_PERSON);
  assert.equal(groups.payload.persons[0].faceCount, 2);
  assert.equal(groups.payload.counts.unclustered, 1, "רק old-c עוד לא עבר קיבוץ");

  // הקיבוץ הראשון אינו נוגע בשיוכים הידניים.
  const run = await call(env, "/face/clusters/run", "POST", {}, "admin-token");
  assert.equal(run.status, 200, run.text);
  assert.equal(run.payload.processed, 1);
  assert.deepEqual(
    db.prepare("SELECT image_id, person_id FROM face_people ORDER BY image_id").all().map(row => [row.image_id, row.person_id]),
    [["old-a", LEGACY_PERSON], ["old-b", LEGACY_PERSON]]
  );
});
