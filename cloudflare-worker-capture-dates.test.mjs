// תאריך הצילום ב-Worker: מעבר הסכימה מגרסה 5 ל-6 (אינדקס המיון), בדיקת
// השדות בכתיבת רשומת מדיה, המיון ?orderBy=takenAt, קריאת טווח בתים
// (/media/probe) ועדכון בקבוצות (/media/taken-at) של ריצת ההשלמה.
// המסד הוא SQLite אמיתי בזיכרון, כדי שגם האינדקס על הביטוי ייבדק באמת.
// קובץ נפרד, כי ה-Worker זוכר בזיכרון שהסכימה כבר הוכנה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { normalizeCaptureFields } from "./cloudflare-worker.js";

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

// R2 מדומה שמכבד range ב-get, כמו R2 האמיתי.
class R2 {
  constructor() { this.objects = new Map(); this.rangeReads = []; }
  async put(key, body, options = {}) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { key, bytes, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
  }
  wrap(stored, bytes) {
    return { key: stored.key, size: stored.bytes.length, body: bytes, httpMetadata: stored.httpMetadata, customMetadata: stored.customMetadata, httpEtag: `"${stored.key}"`, writeHttpMetadata() {} };
  }
  async get(key, options = {}) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const range = options.range;
    if (range) this.rangeReads.push([key, range.offset, range.length]);
    const bytes = range ? stored.bytes.subarray(range.offset, range.offset + range.length) : stored.bytes;
    return this.wrap(stored, bytes);
  }
  async head(key) { const stored = this.objects.get(key); return stored ? this.wrap(stored) : null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.values()].filter(object => object.key.startsWith(prefix)), truncated: false };
  }
}

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" }
};

// מסד כפי שהוא בייצור לפני הענף: כל הקובץ חוץ מהאינדקס החדש, גרסת סכימה 5.
function databaseAtVersion5() {
  const d1 = new D1();
  d1.database.exec(readFileSync(new URL("./cloudflare-d1-schema.sql", import.meta.url), "utf8"));
  d1.database.exec("DROP INDEX idx_gallery_documents_taken_at");
  // גם הטבלאות של גרסה 7 (העלאה בחלקים ו-Stream) לא היו קיימות אז.
  for (const table of ["upload_sessions", "upload_session_parts", "stream_videos"]) d1.database.exec(`DROP TABLE ${table}`);
  d1.database.exec("CREATE TABLE gallery_schema_meta (schema_key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  d1.database.exec("CREATE TABLE user_email_index (normalized_email TEXT PRIMARY KEY, document_id TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const insertMeta = d1.database.prepare("INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, 1)");
  insertMeta.run("gallery", 5);
  insertMeta.run("data_version:images", 1000);
  insertMeta.run("data_version:pendingImages", 500);
  return d1;
}

const d1 = databaseAtVersion5();
const bucket = new R2();
const env = { GALLERY_DB: d1, GALLERY_BUCKET: bucket };

function putDocument(collection, id, data, ownerUid = "google-admin") {
  d1.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), ownerUid);
}
function readDocument(collection, id) {
  const row = d1.database.prepare("SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?").get(collection, id);
  return row ? JSON.parse(row.data_json) : null;
}
function meta(key) {
  return d1.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(key)?.schema_version;
}
function seedProfiles() {
  for (const [uid, email, role] of [["google-viewer", "viewer@example.com", "viewer"], ["google-uploader", "uploader@example.com", "uploader"], ["google-admin", "admin@example.com", "admin"]]) {
    putDocument("userProfiles", uid, { uid, email, role, status: "approved" }, uid);
    d1.database.prepare("INSERT OR REPLACE INTO user_email_index VALUES (?, ?, 1)").run(email, uid);
  }
}

function request(path, { method = "GET", token = "admin-token", body, headers = {} } = {}) {
  return new Request(`${API}${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function call(path, options) {
  const response = await worker.fetch(request(path, options), env);
  const buffer = new Uint8Array(await response.arrayBuffer());
  let payload = {};
  try { payload = JSON.parse(new TextDecoder().decode(buffer)); } catch { payload = {}; }
  return { status: response.status, payload, bytes: buffer, headers: response.headers };
}

const originalFetch = globalThis.fetch;
test.before(() => {
  delete globalThis.caches;
  seedProfiles();
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

const SEPT_28 = Date.UTC(2026, 8, 28, 16, 30);

test("מסד בגרסה 5 עולה לגרסה הנוכחית (7): אינדקס המיון נוצר, גרסאות הנתונים והרשומות נשמרות", async () => {
  putDocument("images", "old-1", { id: "old-1", title: "ישנה", createdAt: 5 });
  const first = await call("/data/images", { token: "viewer-token" });
  assert.equal(first.status, 200);
  const indexes = d1.database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name);
  assert.ok(indexes.includes("idx_gallery_documents_taken_at"));
  assert.equal(meta("gallery"), 7);
  assert.equal(meta("data_version:images"), 1000);
  assert.equal(meta("data_version:pendingImages"), 500);
  assert.deepEqual(readDocument("images", "old-1"), { id: "old-1", title: "ישנה", createdAt: 5 });
  // השאילתה של ?orderBy=takenAt משתמשת באינדקס החדש.
  const plan = d1.database.prepare(
    `EXPLAIN QUERY PLAN SELECT document_id FROM gallery_documents WHERE collection_name = ?
     ORDER BY CAST(COALESCE(json_extract(data_json, '$.takenAt'), json_extract(data_json, '$.createdAt'), 0) AS REAL) DESC, document_id ASC`
  ).all("images").map(row => row.detail).join(" | ");
  assert.match(plan, /idx_gallery_documents_taken_at/);
});

test("כתיבת רשומה: takenAt תקין נשמר, פסול נמחק, takenDate נבדק או נגזר", async () => {
  const write = (id, data) => call(`/data/images/${id}`, { method: "PUT", body: { data: { id, createdAt: Date.UTC(2026, 9, 1), ...data } } });

  let result = await write("a", { takenAt: SEPT_28, takenDate: "2026-09-28", takenAtOffset: "+03:00", takenAtSource: "exif" });
  assert.equal(result.status, 200);
  assert.deepEqual(
    (({ takenAt, takenDate, takenAtOffset, takenAtSource }) => ({ takenAt, takenDate, takenAtOffset, takenAtSource }))(readDocument("images", "a")),
    { takenAt: SEPT_28, takenDate: "2026-09-28", takenAtOffset: "+03:00", takenAtSource: "exif" }
  );

  for (const bad of ["2026-09-28", Date.UTC(1950, 0, 1), Date.now() + 30 * 86400000, null, true, Number.NaN]) {
    await write("b", { takenAt: bad, takenDate: "2026-09-28", takenAtSource: "exif" });
    const stored = readDocument("images", "b");
    for (const field of ["takenAt", "takenDate", "takenAtOffset", "takenAtSource"]) assert.equal(stored[field], undefined, `${String(bad)} → ${field}`);
  }

  // תאריך שאינו מתאים לרגע (יותר מאזור זמן אחד) נגזר מחדש, עם ההיסט כשיש.
  await write("c", { takenAt: Date.UTC(2026, 8, 28, 22, 30), takenDate: "2020-01-01", takenAtOffset: "+03:00", takenAtSource: "video" });
  assert.equal(readDocument("images", "c").takenDate, "2026-09-29");
  await write("d", { takenAt: Date.UTC(2026, 8, 28, 22, 30), takenAtOffset: "+99:00", takenAtSource: "weird" });
  const d = readDocument("images", "d");
  assert.equal(d.takenDate, "2026-09-28");
  assert.equal(d.takenAtOffset, undefined);
  assert.equal(d.takenAtSource, undefined);

  // "נבדק ולא נמצא" נשמר בלי תאריך.
  await write("e", { takenAtSource: "none" });
  assert.equal(readDocument("images", "e").takenAtSource, "none");
  assert.equal(readDocument("images", "e").takenAt, undefined);

  // עותק ישן של הרשומה, בלי שדות הצילום, אינו מוחק את מה שנשמר.
  await write("a", { title: "שם חדש" });
  assert.equal(readDocument("images", "a").takenAt, SEPT_28);
  assert.equal(readDocument("images", "a").title, "שם חדש");
});

test("normalizeCaptureFields: מחרוזת ספרות מתקבלת, גבול העתיד יומיים", () => {
  const now = Date.UTC(2026, 9, 8);
  assert.equal(normalizeCaptureFields({ takenAt: String(SEPT_28) }, {}, now).takenAt, SEPT_28);
  assert.equal(normalizeCaptureFields({ takenAt: now + 86400000 }, {}, now).takenAt, now + 86400000);
  assert.equal(normalizeCaptureFields({ takenAt: now + 3 * 86400000 }, {}, now).takenAt, undefined);
  assert.deepEqual(normalizeCaptureFields({ title: "x" }, {}, now), { title: "x" });
  assert.equal(normalizeCaptureFields({ takenAt: SEPT_28, takenDate: "2026-02-30" }, {}, now).takenDate, "2026-09-28");
});

test("?orderBy=takenAt ממיין לפי רגע הצילום, עם זמן ההעלאה למי שאין לו, ובסמני דפדוף", async () => {
  d1.database.exec("DELETE FROM gallery_documents WHERE collection_name = 'images'");
  putDocument("images", "new-upload-old-shot", { id: "new-upload-old-shot", createdAt: Date.UTC(2026, 9, 5), takenAt: Date.UTC(2019, 0, 1) });
  putDocument("images", "no-shot", { id: "no-shot", createdAt: Date.UTC(2026, 0, 1) });
  putDocument("images", "recent-shot", { id: "recent-shot", createdAt: Date.UTC(2025, 0, 1), takenAt: Date.UTC(2026, 8, 28) });
  const order = [];
  let after = "";
  for (let page = 0; page < 5; page += 1) {
    const result = await call(`/data/images?orderBy=takenAt&direction=desc&limit=1${after ? `&after=${after}` : ""}`, { token: "viewer-token" });
    assert.equal(result.status, 200);
    order.push(...result.payload.documents.map(doc => doc.id));
    if (!result.payload.nextCursor) break;
    after = result.payload.nextCursor;
  }
  assert.deepEqual(order, ["recent-shot", "no-shot", "new-upload-old-shot"]);
});

test("/media/probe מחזיר טווח בתים מהמקור ואת גודל הקובץ — למנהלים בלבד", async () => {
  const bytes = Uint8Array.from({ length: 300000 }, (_, index) => index % 251);
  await bucket.put("approved/google-admin/probe-1.jpg", bytes);
  putDocument("images", "probe-1", { id: "probe-1", r2Key: "approved/google-admin/probe-1.jpg", createdAt: 1 });
  putDocument("pendingImages", "probe-2", { id: "probe-2", r2Key: "pending/google-viewer/probe-2.jpg", createdAt: 1 });
  await bucket.put("pending/google-viewer/probe-2.jpg", Uint8Array.from([1, 2, 3]));
  putDocument("images", "external", { id: "external", url: "https://drive.google.com/x", createdAt: 1 });

  const head = await call("/media/probe/probe-1?offset=0&length=16");
  assert.equal(head.status, 200);
  assert.deepEqual([...head.bytes], [...bytes.subarray(0, 16)]);
  assert.equal(head.headers.get("X-Media-Size"), "300000");
  assert.match(head.headers.get("Access-Control-Expose-Headers"), /X-Media-Size/);
  assert.equal(head.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const tail = await call("/media/probe/probe-1?offset=299990&length=100");
  assert.deepEqual([...tail.bytes], [...bytes.subarray(299990)]);
  // הבקשה מוגבלת ל-256KB גם כשמבקשים יותר.
  const capped = await call("/media/probe/probe-1?offset=0&length=9999999");
  assert.equal(capped.bytes.length, 256 * 1024);
  assert.deepEqual(bucket.rangeReads.at(-1), ["approved/google-admin/probe-1.jpg", 0, 256 * 1024]);
  // מעבר לסוף הקובץ: גוף ריק.
  assert.equal((await call("/media/probe/probe-1?offset=400000")).bytes.length, 0);

  assert.equal((await call("/media/probe/probe-2?length=8")).bytes.length, 3, "גם קובץ ממתין נקרא");
  assert.equal((await call("/media/probe/probe-1", { token: "viewer-token" })).status, 403);
  assert.equal((await call("/media/probe/probe-1", { token: "uploader-token" })).status, 403);
  assert.equal((await call("/media/probe/external")).payload.code, "not_stored");
  assert.equal((await call("/media/probe/missing")).status, 404);
});

test("/media/taken-at מעדכן images ו-pendingImages, מקדם גרסאות נתונים, ואינו מוחק תאריך קיים", async () => {
  putDocument("images", "t-1", { id: "t-1", title: "אחת", createdAt: 10 });
  putDocument("pendingImages", "t-1", { id: "t-1", title: "אחת", createdAt: 10, status: "approved" });
  putDocument("images", "t-2", { id: "t-2", createdAt: 10, takenAt: SEPT_28, takenDate: "2026-09-28", takenAtSource: "exif" });
  putDocument("images", "t-3", { id: "t-3", createdAt: 10 });
  const imagesVersion = meta("data_version:images");
  const pendingVersion = meta("data_version:pendingImages");

  const result = await call("/media/taken-at", { method: "POST", body: { updates: [
    { imageId: "t-1", takenAt: SEPT_28, takenDate: "2026-09-28", takenAtOffset: "+03:00", takenAtSource: "exif" },
    { imageId: "t-2", takenAtSource: "none" },
    { imageId: "t-3", takenAtSource: "none" },
    { imageId: "t-4", takenAt: SEPT_28, takenAtSource: "drive" },
    { imageId: "t-5", takenAt: "yesterday", takenAtSource: "exif" }
  ] } });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload.results.map(entry => entry.status), ["updated", "updated", "updated", "not_found", "invalid"]);
  assert.equal(readDocument("images", "t-1").takenAt, SEPT_28);
  assert.equal(readDocument("images", "t-1").title, "אחת");
  assert.equal(readDocument("pendingImages", "t-1").takenAtSource, "exif");
  assert.equal(readDocument("images", "t-2").takenAt, SEPT_28, "none אינו מוחק תאריך קיים");
  assert.equal(readDocument("images", "t-3").takenAtSource, "none");
  assert.ok(meta("data_version:images") > imagesVersion);
  assert.ok(meta("data_version:pendingImages") > pendingVersion);

  assert.equal((await call("/media/taken-at", { method: "POST", token: "viewer-token", body: { updates: [{ imageId: "t-3", takenAtSource: "none" }] } })).status, 403);
  assert.equal((await call("/media/taken-at", { method: "POST", body: { updates: [] } })).payload.code, "no_updates");
  const tooMany = Array.from({ length: 51 }, (_, index) => ({ imageId: `x${index}`, takenAtSource: "none" }));
  assert.equal((await call("/media/taken-at", { method: "POST", body: { updates: tooMany } })).payload.code, "too_many_updates");
});

test("/health מכריז על היכולת", async () => {
  const health = await call("/health", { token: "" });
  assert.ok(health.payload.features.includes("capture-dates"));
});
