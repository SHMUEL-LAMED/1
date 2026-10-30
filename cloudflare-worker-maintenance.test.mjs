// התחזוקה בשרת: הרשאות systemMeta, גיבוי D1 יומי ל-R2, מחיקה לצמיתות מסל
// המחזור אחרי 30 יום, התראה למנהלי־העל ובדיקת הקישורים השבורים. כל הנתיבים
// כאן נקראים מתהליך התחזוקה עם הרשאת OIDC של GitHub (כמו תהליך הרקע), והבדיקות
// נועלות שאף אחד אחר אינו מפעיל אותם ושאף קובץ בשימוש אינו נמחק.
import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";
import { backupToSql, readBackupFile } from "./scripts/backup-to-sql.mjs";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";
const DAY = 24 * 60 * 60 * 1000;

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

class SqliteD1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.bindings = []; }
  bind(...values) { this.bindings = values.map(normalizeBinding); return this; }
  async first() {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    return row === undefined ? null : row;
  }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) }; }
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

// R2 מדומה עם list אמיתי: limit, cursor ו-truncated, ותאריך העלאה לכל קובץ.
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
      key, bytes: await this.toBytes(body),
      httpMetadata: { ...(options.httpMetadata || {}) },
      customMetadata: { ...(options.customMetadata || {}) },
      uploaded: options.uploaded || new Date()
    });
    return {};
  }
  seed(key, body = "x", { uploaded = new Date(Date.now() - 10 * DAY), customMetadata = {} } = {}) {
    this.objects.set(key, { key, bytes: new TextEncoder().encode(body), httpMetadata: {}, customMetadata, uploaded });
  }
  wrap(stored, withBody) {
    return {
      key: stored.key, size: stored.bytes.length, httpEtag: `"${stored.key}"`, uploaded: stored.uploaded,
      httpMetadata: stored.httpMetadata, customMetadata: stored.customMetadata,
      body: withBody ? stored.bytes : undefined,
      async arrayBuffer() { return stored.bytes.slice().buffer; },
      writeHttpMetadata(headers) { if (stored.httpMetadata.contentType) headers.set("Content-Type", stored.httpMetadata.contentType); }
    };
  }
  async get(key) { const stored = this.objects.get(key); return stored ? this.wrap(stored, true) : null; }
  async head(key) { const stored = this.objects.get(key); return stored ? this.wrap(stored, false) : null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const all = [...this.objects.values()].filter(stored => stored.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
    const start = Number(cursor) || 0;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return {
      objects: page.map(stored => ({ key: stored.key, size: stored.bytes.length, uploaded: stored.uploaded, customMetadata: stored.customMetadata })),
      truncated, ...(truncated ? { cursor: String(start + limit) } : {})
    };
  }
  keys() { return [...this.objects.keys()].sort(); }
}

const database = new SqliteD1();
const bucket = new MockR2();
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket, SESSION_SIGNING_SECRET: "maintenance-test-signing-secret-long" };
let oidcKeys;
let emails = [];
let emailStatus = 200;

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

const originalFetch = globalThis.fetch;

test.before(async () => {
  oidcKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === "https://token.actions.githubusercontent.com/.well-known/jwks") {
      return Response.json({ keys: [{ ...await crypto.subtle.exportKey("jwk", oidcKeys.publicKey), kid: "test-maintenance" }] });
    }
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const account = ACCOUNTS[decodeURIComponent(new URL(href).searchParams.get("id_token") || "")];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    if (href === "https://api.resend.com/emails") {
      emails.push(JSON.parse(options.body));
      return emailStatus === 200 ? Response.json({ id: `email-${emails.length}` }) : Response.json({ message: "rejected" }, { status: emailStatus });
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(request("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
  const features = (await health.json()).features;
  for (const feature of ["d1-daily-backups", "trash-auto-purge", "maintenance-alerts", "broken-links-report"]) assert.ok(features.includes(feature), feature);
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  emails = [];
  emailStatus = 200;
  delete environment.RESEND_API_KEY;
  delete environment.EMAIL_FROM;
  bucket.objects.clear();
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "client_errors", "image_face_descriptors", "image_face_index_state", "media_variant_files"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer");
  seedProfile("google-admin", "admin@example.com", "admin");
  seedProfile("google-super", "super@example.com", "super_admin");
});

function putDocument(collection, id, data, { ownerUid = "google-admin", createdAt = Date.now() } = {}) {
  database.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), ownerUid, createdAt, createdAt);
}

function readDocument(collection, id) {
  const row = database.database.prepare("SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?").get(collection, id);
  return row ? JSON.parse(row.data_json) : null;
}

function seedProfile(uid, email, role) {
  putDocument("userProfiles", uid, { uid, email, role, status: "approved" }, { ownerUid: uid });
}

function request(path, method = "GET", body, token = "admin-token") {
  return new Request(`${API}${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

const call = (path, method, body, token) => worker.fetch(request(path, method, body, token), environment);

const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
async function oidc(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", kid: "test-maintenance" });
  const payload = encode({
    iss: "https://token.actions.githubusercontent.com", aud: `${API}/background`, repository: "SHMUEL-LAMED/1",
    repository_id: "1308950667", repository_owner_id: "295421676",
    workflow_ref: "SHMUEL-LAMED/1/.github/workflows/background-jobs.yml@refs/heads/main", ref: "refs/heads/main",
    event_name: "schedule", iat: now, exp: now + 300, run_id: "777", ...overrides
  });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", oidcKeys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

async function session() {
  const response = await call("/background/session", "POST", undefined, await oidc());
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).token;
}

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = days => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

// --- 1. systemMeta ---

test("הגדרת ההורדה (סימן מים): מנהל רגיל וצופה נדחים, מנהל־על שומר — ו-updatedBy נקבע בשרת", async () => {
  const settings = { watermarkEnabled: true, watermarkText: "גלריה", stripAllMetadata: false, updatedAt: 1, updatedBy: "someone-else" };
  for (const token of ["admin-token", "viewer-token"]) {
    assert.equal((await call("/data/systemMeta/downloadPrivacy", "PUT", { data: settings }, token)).status, 403, token);
    assert.equal((await call("/data/systemMeta/downloadPrivacy", "DELETE", undefined, token)).status, 403, token);
  }
  assert.equal(readDocument("systemMeta", "downloadPrivacy"), null);
  const saved = await call("/data/systemMeta/downloadPrivacy", "PUT", { data: settings }, "super-token");
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(readDocument("systemMeta", "downloadPrivacy").updatedBy, "google-super");
  assert.equal(readDocument("systemMeta", "downloadPrivacy").watermarkEnabled, true);
  // הגלריה עדיין קוראת את ההגדרה אצל כל צופה מאושר.
  assert.equal((await call("/data/systemMeta/downloadPrivacy", "GET", undefined, "viewer-token")).status, 200);
});

test("הודעת הפופ-אפ למנהל־על בלבד; מסמך gallery נשאר פתוח למנהל, כפי שהלוח כותב אותו", async () => {
  assert.equal((await call("/data/systemMeta/popupAnnouncement", "PUT", { data: { enabled: true } }, "admin-token")).status, 403);
  assert.equal((await call("/data/systemMeta/popupAnnouncement", "PUT", { data: { enabled: true } }, "super-token")).status, 200);
  assert.equal((await call("/data/systemMeta/popupAnnouncement", "GET", undefined, "viewer-token")).status, 200);
  const gallery = await call("/data/systemMeta/gallery", "PUT", { data: { foldersInitialized: true }, merge: true }, "admin-token");
  assert.equal(gallery.status, 200);
  // בלי השדה updatedBy אין מה להחתים: הרשומה נשמרת כפי שנשלחה.
  assert.equal(readDocument("systemMeta", "gallery").updatedBy, undefined);
});

test("מסמכי התחזוקה הפנימיים: רק מנהל־על קורא, והם אינם ברשימה של אחרים", async () => {
  putDocument("systemMeta", "maintenanceBrokenLinks", { report: { missingCount: 1 } });
  putDocument("systemMeta", "popupAnnouncement", { enabled: false });
  assert.equal((await call("/data/systemMeta/maintenanceBrokenLinks", "GET", undefined, "admin-token")).status, 403);
  assert.equal((await call("/data/systemMeta/maintenanceBrokenLinks", "GET", undefined, "viewer-token")).status, 403);
  assert.equal((await call("/data/systemMeta/maintenanceBrokenLinks", "PUT", { data: {} }, "admin-token")).status, 403);
  assert.equal((await call("/data/systemMeta/maintenanceBrokenLinks", "GET", undefined, "super-token")).status, 200);
  const listed = async token => (await (await call("/data/systemMeta", "GET", undefined, token)).json()).documents.map(item => item.id);
  assert.deepEqual(await listed("viewer-token"), ["popupAnnouncement"]);
  assert.deepEqual(await listed("admin-token"), ["popupAnnouncement"]);
  assert.deepEqual((await listed("super-token")).sort(), ["maintenanceBrokenLinks", "popupAnnouncement"]);
});

// --- 2. גיבוי D1 ---

test("הגיבוי נפתח רק לתהליך התחזוקה ולמנהל־על", async () => {
  assert.equal((await call("/maintenance/backup", "POST", {}, "admin-token")).status, 403);
  assert.equal((await call("/maintenance/backup", "POST", {}, "viewer-token")).status, 403);
  assert.equal((await call("/maintenance/backup", "POST", {}, "")).status, 401);
  assert.equal((await call("/background/session", "POST", undefined, await oidc({ workflow_ref: "SHMUEL-LAMED/1/.github/workflows/other.yml@refs/heads/main" }))).status, 403);
  assert.equal(bucket.keys().filter(key => key.startsWith("backups/")).length, 0);
  assert.equal((await call("/maintenance/backup", "POST", {}, "super-token")).status, 200);
  assert.equal(bucket.keys().filter(key => key.startsWith("backups/")).length, 1);
});

test("הגיבוי היומי: כל הטבלאות בעמודים, דחוס, בלי מפתח החתימה — ופעם אחת ביום", async () => {
  for (let index = 0; index < 1203; index += 1) putDocument("images", `img_${String(index).padStart(5, "0")}`, { id: `img_${index}`, title: `תמונה ${index}`, r2Key: `approved/u/img_${index}.jpg` });
  database.database.prepare("INSERT INTO auth_secrets (secret_key, secret_value, created_at) VALUES ('session', 'super-secret-value', 1) ON CONFLICT DO NOTHING").run();
  database.database.prepare("INSERT INTO client_errors (fingerprint, source, message, first_seen, last_seen) VALUES ('fp1', 'site', 'שגיאה', 1, 2)").run();
  const token = await session();
  const first = await call("/maintenance/backup", "POST", {}, token);
  assert.equal(first.status, 200, await first.clone().text());
  const result = await first.json();
  assert.equal(result.created, true);
  assert.equal(result.day, today());
  const key = `backups/d1/${today()}.json.gz`;
  assert.ok(bucket.objects.has(key));
  const text = gunzipSync(Buffer.from(bucket.objects.get(key).bytes)).toString("utf8");
  assert.ok(!text.includes("super-secret-value"), "מפתח החתימה אסור בגיבוי");
  const backup = JSON.parse(text);
  assert.equal(backup.format, "simchas-gallery-d1-backup");
  assert.equal(backup.schemaVersion, 9);
  const names = backup.tables.map(table => table.name);
  for (const name of ["gallery_documents", "client_errors", "face_persons", "media_variant_files", "upload_sessions", "gallery_schema_meta"]) assert.ok(names.includes(name), name);
  assert.ok(!names.includes("auth_secrets") && !names.includes("request_rate_limits"));
  const documents = backup.tables.find(table => table.name === "gallery_documents");
  const expected = database.database.prepare("SELECT * FROM gallery_documents ORDER BY rowid").all();
  assert.equal(documents.rowCount, expected.length);
  assert.ok(documents.rowCount > 1200, "הייצוא חייב לעבור את גבול העמוד");
  const restored = documents.rows.map(row => Object.fromEntries(documents.columns.map((column, index) => [column, row[index]])));
  assert.deepEqual(restored, expected.map(row => ({ ...row })));
  assert.ok(backup.indexes.some(index => index.name === "idx_client_errors_resolved_seen"));
  // קריאה שנייה באותו יום אינה יוצרת עוד קובץ.
  const second = await (await call("/maintenance/backup", "POST", {}, token)).json();
  assert.equal(second.created, false);
  assert.equal(bucket.keys().filter(name => name.startsWith("backups/d1/")).length, 1);
});

test("שחזור ידני: הגיבוי הופך ל-SQL שמחזיר את אותן שורות למסד ריק", async () => {
  putDocument("images", "quote_test", { id: "quote_test", title: "שם עם 'גרש' ו\"מרכאות\"", nothing: null });
  putDocument("folders", "f1", { id: "f1", name: "תיקייה" });
  database.database.prepare("INSERT INTO client_errors (fingerprint, source, message, first_seen, last_seen, resolved_at) VALUES ('fp', 'site', 'it''s', 1, 2, NULL)").run();
  await call("/maintenance/backup", "POST", {}, "super-token");
  const backup = readBackupFile(bucket.objects.get(`backups/d1/${today()}.json.gz`).bytes);
  const restored = new DatabaseSync(":memory:");
  restored.exec(backupToSql(backup));
  for (const table of ["gallery_documents", "client_errors", "gallery_schema_meta", "user_email_index"]) {
    const original = database.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), original, table);
  }
  // הקובץ אינו מוחק דבר, ולכן הרצה שנייה על אותו מסד אינה משנה את התוצאה.
  restored.exec(backupToSql(backup));
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM gallery_documents").get().count,
    database.database.prepare("SELECT COUNT(*) AS count FROM gallery_documents").get().count);
  assert.ok(!/DROP|DELETE/i.test(backupToSql(backup).replace(/'[^']*'/g, "")), "אין מחיקה בקובץ השחזור");
});

test("שמירה של 30 יום: רק גיבויים ישנים בתבנית המדויקת נמחקים", async () => {
  for (const days of [45, 31, 30, 29, 1]) bucket.seed(`backups/d1/${dayBefore(days)}.json.gz`, "old");
  bucket.seed("backups/d1/notes.txt", "keep");
  bucket.seed("backups/other/2000-01-01.json.gz", "keep");
  bucket.seed("approved/u/photo.jpg", "media");
  const result = await (await call("/maintenance/backup", "POST", {}, await session())).json();
  assert.deepEqual(result.pruned.sort(), [dayBefore(45), dayBefore(31), dayBefore(30)].sort());
  const keys = bucket.keys();
  for (const days of [45, 31, 30]) assert.ok(!keys.includes(`backups/d1/${dayBefore(days)}.json.gz`), String(days));
  for (const days of [29, 1]) assert.ok(keys.includes(`backups/d1/${dayBefore(days)}.json.gz`), String(days));
  for (const key of ["backups/d1/notes.txt", "backups/other/2000-01-01.json.gz", "approved/u/photo.jpg", `backups/d1/${today()}.json.gz`]) assert.ok(keys.includes(key), key);
});

test("רשימת הגיבויים וההורדה: מנהל־על בלבד, לא תהליך הרקע", async () => {
  await call("/maintenance/backup", "POST", {}, "super-token");
  bucket.seed(`backups/d1/${dayBefore(3)}.json.gz`, "older");
  for (const token of ["admin-token", "viewer-token", await session()]) {
    assert.equal((await call("/maintenance/backups", "GET", undefined, token)).status, 403);
    assert.equal((await call(`/maintenance/backups/${today()}`, "GET", undefined, token)).status, 403);
  }
  const list = await (await call("/maintenance/backups", "GET", undefined, "super-token")).json();
  assert.deepEqual(list.backups.map(item => item.day), [today(), dayBefore(3)]);
  assert.equal(list.retentionDays, 30);
  assert.ok(list.backups[0].size > 0);
  const download = await call(`/maintenance/backups/${today()}`, "GET", undefined, "super-token");
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("Content-Type"), "application/gzip");
  assert.match(download.headers.get("Content-Disposition"), /attachment; filename="simchas-gallery-d1-\d{4}-\d{2}-\d{2}\.json\.gz"/);
  assert.equal(download.headers.get("Cache-Control"), "private, no-store");
  assert.equal(JSON.parse(gunzipSync(Buffer.from(await download.arrayBuffer())).toString("utf8")).format, "simchas-gallery-d1-backup");
  assert.equal((await call("/maintenance/backups/..%2F..%2Fapproved", "GET", undefined, "super-token")).status, 400);
  assert.equal((await call(`/maintenance/backups/${dayBefore(400)}`, "GET", undefined, "super-token")).status, 404);
});

test("קובץ גיבוי לעולם אינו יוצא דרך נתיבי המדיה הציבוריים", async () => {
  await call("/maintenance/backup", "POST", {}, "super-token");
  const key = `backups/d1/${today()}.json.gz`;
  const paths = [
    `/media/${key}`,
    `/media/${encodeURIComponent(key)}`,
    `/media/${encodeURIComponent(encodeURIComponent(key))}`,
    `/media/backups%2Fd1%2F${today()}.json.gz`,
    `/media/approved/../${key}`,
    "/media/private/drive-oauth/credentials/google-super.json"
  ];
  for (const path of paths) {
    for (const token of ["", "viewer-token", "super-token"]) {
      const response = await call(path, "GET", undefined, token);
      assert.notEqual(response.status, 200, `${path} (${token || "anonymous"})`);
      assert.match(response.headers.get("Content-Type") || "", /application\/json/);
    }
    assert.notEqual((await call(path, "DELETE", undefined, "super-token")).status, 200, path);
  }
  assert.ok(bucket.objects.has(key), "ניסיון מחיקה דרך /media אינו נוגע בגיבוי");
});

test("הגיבוי רץ גם כשמכסת הכתיבה של D1 חסומה (הרשאת קריאה בלבד)", async () => {
  const original = database.prepare.bind(database);
  database.prepare = sql => {
    const statement = original(sql);
    if (/^\s*INSERT INTO request_rate_limits/i.test(sql)) {
      statement.first = async () => { throw new Error("D1 row write limit exceeded"); };
    }
    return statement;
  };
  try {
    const response = await call("/background/session", "POST", undefined, await oidc());
    const { token, writeQuotaExhausted } = await response.json();
    assert.equal(writeQuotaExhausted, true);
    assert.equal((await call("/maintenance/backup", "POST", {}, token)).status, 200);
    assert.equal((await call("/maintenance/broken-links", "POST", {}, token)).status, 403);
  } finally {
    database.prepare = original;
  }
});

// --- 3. סל המחזור ---

function trashItem(id, { days, type = "image", key = "", parent = "", extra = {} } = {}) {
  const deletedAt = Date.now() - days * DAY;
  const record = key ? { id: `${id}_rec`, title: id, r2Key: key } : { uid: `${id}_uid`, email: "gone@example.com" };
  putDocument("trashItems", id, {
    id, originalType: type, originalId: `${id}_rec`, originalCollection: type === "user" ? "userProfiles" : "images",
    targetName: id, record, parentTrashGroupId: parent, deletedAt, ...extra
  }, { createdAt: deletedAt });
}

test("סל המחזור: פריט בן יותר מ-30 יום נמחק לצמיתות עם הקובץ שלו, ופריט צעיר נשאר", async () => {
  trashItem("old_image", { days: 31, key: "approved/u/old_image_rec.jpg" });
  trashItem("young_image", { days: 5, key: "approved/u/young_image_rec.jpg" });
  trashItem("old_user", { days: 40, type: "user" });
  bucket.seed("approved/u/old_image_rec.jpg");
  bucket.seed("approved/u/young_image_rec.jpg");
  bucket.seed("variants/old_image_rec/thumb.webp");
  assert.equal((await call("/maintenance/trash-purge", "POST", {}, "admin-token")).status, 403);
  assert.equal((await call("/maintenance/trash-purge", "POST", {}, "super-token")).status, 403);
  assert.ok(readDocument("trashItems", "old_image"));
  const result = await (await call("/maintenance/trash-purge", "POST", {}, await session())).json();
  assert.equal(result.purged, 2);
  assert.equal(result.deletedObjects, 1);
  assert.equal(readDocument("trashItems", "old_image"), null);
  assert.equal(readDocument("trashItems", "old_user"), null);
  assert.ok(readDocument("trashItems", "young_image"));
  assert.ok(!bucket.objects.has("approved/u/old_image_rec.jpg"));
  assert.ok(!bucket.objects.has("variants/old_image_rec/thumb.webp"), "תצוגות של מזהה שאין לו רשומה נמחקות איתו");
  assert.ok(bucket.objects.has("approved/u/young_image_rec.jpg"));
  const logs = database.database.prepare("SELECT data_json FROM gallery_documents WHERE collection_name = 'activityLogs'").all().map(row => JSON.parse(row.data_json));
  assert.equal(logs.length, 2);
  assert.ok(logs.every(log => log.action === "purged" && log.actorUid === "background-worker"));
});

test("סל המחזור: קובץ שרשומה אחרת עדיין מזכירה אינו נמחק", async () => {
  trashItem("restored_copy", { days: 35, key: "approved/u/shared.jpg" });
  trashItem("twin", { days: 2, key: "approved/u/twin.jpg" });
  trashItem("old_twin", { days: 50, key: "approved/u/twin.jpg" });
  putDocument("images", "shared", { id: "shared", r2Key: "approved/u/shared.jpg" });
  putDocument("systemMeta", "popupAnnouncement", { r2Key: "approved/u/popup.jpg" });
  trashItem("popup_like", { days: 60, key: "approved/u/popup.jpg" });
  for (const key of ["approved/u/shared.jpg", "approved/u/twin.jpg", "approved/u/popup.jpg"]) bucket.seed(key);
  const result = await (await call("/maintenance/trash-purge", "POST", {}, await session())).json();
  assert.equal(result.purged, 3);
  assert.equal(result.deletedObjects, 0);
  assert.equal(result.keptObjects, 3);
  for (const key of ["approved/u/shared.jpg", "approved/u/twin.jpg", "approved/u/popup.jpg"]) assert.ok(bucket.objects.has(key), key);
  assert.ok(readDocument("trashItems", "twin"));
});

test("סל המחזור: תיקייה ישנה נמחקת יחד עם התמונות שבה, ותמונה בתיקייה צעירה מחכה לה", async () => {
  trashItem("folder_old", { days: 33, type: "folder", extra: { relatedTrashIds: ["child_a", "child_b"] } });
  trashItem("child_a", { days: 33, key: "approved/u/child_a.jpg", parent: "folder_old" });
  trashItem("child_b", { days: 33, key: "approved/u/child_b.jpg", parent: "folder_old" });
  trashItem("folder_young", { days: 3, type: "folder" });
  trashItem("child_c", { days: 40, key: "approved/u/child_c.jpg", parent: "folder_young" });
  trashItem("orphan_child", { days: 40, key: "approved/u/orphan_child.jpg", parent: "folder_missing" });
  for (const key of ["approved/u/child_a.jpg", "approved/u/child_b.jpg", "approved/u/child_c.jpg", "approved/u/orphan_child.jpg"]) bucket.seed(key);
  const result = await (await call("/maintenance/trash-purge", "POST", {}, await session())).json();
  assert.equal(result.purged, 2);
  assert.equal(result.purgedChildren, 2);
  for (const id of ["folder_old", "child_a", "child_b", "orphan_child"]) assert.equal(readDocument("trashItems", id), null, id);
  for (const id of ["folder_young", "child_c"]) assert.ok(readDocument("trashItems", id), id);
  assert.deepEqual(bucket.keys(), ["approved/u/child_c.jpg"]);
});

test("סל המחזור: תיקייה גדולה נמחקת בכמה ריצות — התמונות קודם, התיקייה אחרונה", async () => {
  const children = Array.from({ length: 70 }, (_, index) => `big_${String(index).padStart(2, "0")}`);
  trashItem("folder_big", { days: 40, type: "folder", extra: { relatedTrashIds: children } });
  for (const id of children) {
    trashItem(id, { days: 40, key: `approved/u/${id}.jpg`, parent: "folder_big" });
    bucket.seed(`approved/u/${id}.jpg`);
  }
  const token = await session();
  const first = await (await call("/maintenance/trash-purge", "POST", {}, token)).json();
  assert.equal(first.more, true);
  assert.equal(first.purged, 0);
  assert.equal(first.purgedChildren, 60);
  assert.ok(readDocument("trashItems", "folder_big"), "התיקייה נשארת כל עוד יש בה תמונות");
  const second = await (await call("/maintenance/trash-purge", "POST", {}, token)).json();
  assert.equal(second.purgedChildren, 10);
  assert.equal(second.purged, 1);
  assert.equal(readDocument("trashItems", "folder_big"), null);
  assert.deepEqual(bucket.keys(), []);
});

test("סל המחזור: שעון שגוי בדפדפן (deletedAt ישן מדי) אינו מקדים מחיקה", async () => {
  const deletedAt = Date.now() - 400 * DAY;
  putDocument("trashItems", "bad_clock", { id: "bad_clock", originalType: "image", record: { r2Key: "approved/u/bad_clock.jpg" }, deletedAt }, { createdAt: Date.now() - 2 * DAY });
  bucket.seed("approved/u/bad_clock.jpg");
  const result = await (await call("/maintenance/trash-purge", "POST", {}, await session())).json();
  assert.equal(result.purged, 0);
  assert.ok(readDocument("trashItems", "bad_clock"));
  assert.ok(bucket.objects.has("approved/u/bad_clock.jpg"));
});

// --- 4. התראה ---

function addErrors(fingerprint, count, firstSeen = Date.now() - 2 * DAY) {
  database.database.prepare(
    `INSERT INTO client_errors (fingerprint, source, message, url, last_uid, count, first_seen, last_seen)
     VALUES (?, 'site', 'TypeError: secret-user-detail', 'https://x/#media/private', 'google-viewer', ?, ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET count = client_errors.count + excluded.count, last_seen = excluded.last_seen`
  ).run(fingerprint, count, firstSeen, Date.now());
}

test("התראה: בלי RESEND_API_KEY אין שליחה, והסיבה מוחזרת ליומן הריצה", async () => {
  const token = await session();
  const result = await (await call("/maintenance/alert-check", "POST", { health: { ok: false, status: 500 } }, token)).json();
  assert.equal(result.alerted, false);
  assert.equal(result.skipped, "email_not_configured");
  assert.deepEqual(result.reasons, ["health"]);
  assert.equal(emails.length, 0);
  assert.equal((await call("/maintenance/alert-check", "POST", {}, "super-token")).status, 403);
});

test("התראה: מייל אחד למנהלי־העל, בלי פרטים פרטיים, ולכל היותר אחד בשש שעות", async () => {
  Object.assign(environment, { RESEND_API_KEY: "re_test", EMAIL_FROM: "gallery@example.com" });
  seedProfile("google-super-2", "second-super@example.com", "super_admin");
  addErrors("fp-old", 3);
  const token = await session();
  const quiet = await (await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, token)).json();
  assert.equal(quiet.alerted, false);
  assert.deepEqual(quiet.reasons, []);
  assert.equal(emails.length, 0);
  // נקודת הייחוס נשמרה; עכשיו 60 מופעים נוספים בתוך השעה.
  addErrors("fp-old", 60);
  const loud = await (await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, token)).json();
  assert.equal(loud.alerted, true, JSON.stringify(loud));
  assert.deepEqual(loud.reasons, ["errors"]);
  assert.equal(loud.metrics.occurrences, 60);
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to.sort(), ["second-super@example.com", "super@example.com"]);
  assert.ok(!emails[0].to.includes("admin@example.com"));
  assert.ok(!/secret-user-detail|google-viewer|#media\/private/.test(emails[0].text), "המייל אינו נושא את תוכן השגיאות");
  assert.match(emails[0].text, /admin\.html#errors/);
  const again = await (await call("/maintenance/alert-check", "POST", { health: { ok: false, status: 503 } }, token)).json();
  assert.equal(again.suppressed, true);
  assert.equal(emails.length, 1);
});

test("התראה: סוגי שגיאה חדשים רבים בשעה האחרונה, או ספק שנכשל ומשחרר את הנעילה", async () => {
  Object.assign(environment, { RESEND_API_KEY: "re_test", EMAIL_FROM: "gallery@example.com" });
  for (let index = 0; index < 10; index += 1) addErrors(`fp-new-${index}`, 1, Date.now() - 60_000);
  emailStatus = 500;
  const token = await session();
  const failed = await (await call("/maintenance/alert-check", "POST", {}, token)).json();
  assert.equal(failed.failed, "email_send_failed");
  assert.equal(Number(readDocument("systemMeta", "maintenanceAlert").lastAlertAt) || 0, 0);
  emailStatus = 200;
  const sent = await (await call("/maintenance/alert-check", "POST", {}, token)).json();
  assert.equal(sent.alerted, true);
  assert.deepEqual(sent.reasons, ["errors"]);
  assert.equal(emails.length, 2);
});

// --- 5. קישורים שבורים ---

test("קישורים שבורים: רשומות בלי קובץ וקבצים בלי רשומה, בסריקה שממשיכה מהסמן — ושום דבר אינו נמחק", async () => {
  const variants = id => ({ thumb: { key: `variants/${id}/thumb.webp`, url: "x" }, medium: { key: `variants/${id}/medium.webp`, url: "x", avif: { key: `variants/${id}/medium.avif` } } });
  putDocument("images", "ok_photo", { id: "ok_photo", title: "תקין", r2Key: "approved/u/ok_photo.jpg", variants: variants("ok_photo") });
  putDocument("images", "lost_original", { id: "lost_original", title: "בלי מקור", r2Key: "approved/u/lost_original.jpg" });
  putDocument("images", "lost_variant", { id: "lost_variant", title: "בלי תצוגה", r2Key: "approved/u/lost_variant.jpg", variants: variants("lost_variant") });
  putDocument("images", "drive_link", { id: "drive_link", url: "https://drive.google.com/x" });
  for (let index = 0; index < 150; index += 1) {
    putDocument("images", `bulk_${String(index).padStart(3, "0")}`, { id: `bulk_${index}`, r2Key: `approved/u/bulk_${index}.jpg` });
    bucket.seed(`approved/u/bulk_${index}.jpg`);
  }
  putDocument("pendingImages", "waiting", { id: "waiting", r2Key: "pending/u/waiting.jpg" });
  putDocument("systemMeta", "popupAnnouncement", { r2Key: "approved/u/popup.jpg" });
  putDocument("trashItems", "trashed", { originalType: "image", originalId: "trashed_rec", record: { r2Key: "approved/u/trashed_rec.jpg" } });
  for (const key of [
    "approved/u/ok_photo.jpg", "variants/ok_photo/thumb.webp", "variants/ok_photo/medium.webp", "variants/ok_photo/medium.avif",
    "approved/u/lost_variant.jpg", "variants/lost_variant/thumb.webp", "variants/lost_variant/medium.webp",
    "pending/u/waiting.jpg", "approved/u/popup.jpg", "approved/u/trashed_rec.jpg", "variants/trashed_rec/thumb.webp",
    "approved/u/orphan.jpg", "variants/ghost/thumb.webp", "chat/u/c/file.pdf", `backups/d1/${today()}.json.gz`
  ]) bucket.seed(key);
  bucket.seed("approved/u/just_uploaded.jpg", "x", { uploaded: new Date() });
  const before = bucket.keys();

  for (const token of ["admin-token", "super-token"]) assert.equal((await call("/maintenance/broken-links", "POST", {}, token)).status, 403);
  assert.equal((await call("/maintenance/broken-links", "GET", undefined, "admin-token")).status, 403);
  assert.equal((await call("/maintenance/broken-links", "GET", undefined, await session())).status, 403);

  const token = await session();
  let calls = 0;
  let result;
  do {
    result = await (await call("/maintenance/broken-links", "POST", {}, token)).json();
    calls += 1;
    if (calls === 1) {
      const progress = await (await call("/maintenance/broken-links", "GET", undefined, "super-token")).json();
      assert.equal(progress.report, null);
      assert.equal(progress.scanning.phase, "records");
    }
  } while (!result.done && calls < 20);
  assert.equal(result.done, true);
  assert.ok(calls >= 3, "הסריקה מתחלקת לכמה צעדים");
  const { report } = await (await call("/maintenance/broken-links", "GET", undefined, "super-token")).json();
  assert.equal(report.checkedRecords, 154);
  assert.equal(report.notStored, 1);
  assert.equal(report.missingCount, 2);
  const missing = Object.fromEntries(report.missing.map(entry => [entry.id, entry.missing.map(item => item.kind).sort()]));
  assert.deepEqual(missing, { lost_original: ["original"], lost_variant: ["medium-avif"] });
  assert.deepEqual(report.orphans.map(entry => entry.key).sort(), ["approved/u/orphan.jpg", "variants/ghost/thumb.webp"]);
  assert.equal(report.orphanCount, 2);
  assert.deepEqual(bucket.keys(), before, "הבדיקה אינה מוחקת דבר");
  // אחרי סריקה מלאה: עד מחר הקריאה רק בודקת ואינה כותבת.
  const idle = await (await call("/maintenance/broken-links", "POST", {}, token)).json();
  assert.equal(idle.idle, true);
});
