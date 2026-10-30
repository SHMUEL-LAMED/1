// כלי הניהול החדשים בשרת: מוני השימוש (/stats), סיכום האחסון והסף שלו
// (/maintenance/storage*), פעולה על כמה משתמשים (/admin/users/batch) עם ההגנה
// על מנהל־העל, הערות פנימיות על משתמש (/admin/user-notes) והרקע המטושטש של
// פריט מדיה (placeholder). הבדיקות נועלות בעיקר את ההרשאות ואת הפרטיות: מי
// רואה מה, ושמשתמש לעולם אינו קורא הערות על עצמו.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, {
  normalizeUsageCounts, normalizeStorageBudget, storageBudgetStatus, cleanUserNote,
  normalizeMediaPlaceholder, superAdminRetentionProblem
} from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";
const DAY = 24 * 60 * 60 * 1000;
const PLACEHOLDER = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

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
    if (/RETURNING/i.test(this.sql)) {
      statement.get(...this.bindings);
      return { success: true };
    }
    const result = statement.run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); this.writes = 0; }
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

class MockR2 {
  constructor() { this.objects = new Map(); }
  async toBytes(body) {
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (typeof body === "string") return new TextEncoder().encode(body);
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  async put(key, body, options = {}) {
    this.objects.set(key, { key, bytes: await this.toBytes(body), httpMetadata: { ...(options.httpMetadata || {}) }, customMetadata: { ...(options.customMetadata || {}) }, uploaded: new Date() });
    return {};
  }
  seed(key, size) { this.objects.set(key, { key, bytes: new Uint8Array(size), httpMetadata: {}, customMetadata: {}, uploaded: new Date(Date.now() - 10 * DAY) }); }
  wrap(stored, withBody) {
    return {
      key: stored.key, size: stored.bytes.length, httpEtag: `"${stored.key}"`, uploaded: stored.uploaded,
      httpMetadata: stored.httpMetadata, customMetadata: stored.customMetadata, body: withBody ? stored.bytes : undefined,
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
    return { objects: page.map(stored => ({ key: stored.key, size: stored.bytes.length, uploaded: stored.uploaded })), truncated, ...(truncated ? { cursor: String(start + limit) } : {}) };
  }
}

const database = new SqliteD1();
const bucket = new MockR2();
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket, SESSION_SIGNING_SECRET: "admin-management-test-signing-secret" };
let oidcKeys;
let emails = [];

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "admin2-token": { sub: "google-admin2", email: "admin2@example.com", name: "Admin Two" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "super2-token": { sub: "google-super2", email: "super2@example.com", name: "Super Two" }
};

const originalFetch = globalThis.fetch;

test.before(async () => {
  delete globalThis.caches;
  oidcKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href === "https://token.actions.githubusercontent.com/.well-known/jwks") {
      return Response.json({ keys: [{ ...await crypto.subtle.exportKey("jwk", oidcKeys.publicKey), kid: "test-admin" }] });
    }
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const account = ACCOUNTS[decodeURIComponent(new URL(href).searchParams.get("id_token") || "")];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    if (href === "https://api.resend.com/emails") {
      emails.push(JSON.parse(options.body));
      return Response.json({ id: `email-${emails.length}` });
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(request("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
  const features = (await health.json()).features;
  for (const feature of ["usage-stats", "storage-report", "users-batch", "admin-user-notes", "media-placeholders"]) assert.ok(features.includes(feature), feature);
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  emails = [];
  delete environment.RESEND_API_KEY;
  delete environment.EMAIL_FROM;
  bucket.objects.clear();
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "usage_daily", "admin_user_notes", "media_variant_files", "image_face_index_state"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer");
  seedProfile("google-pending", "pending@example.com", "viewer", "pending");
  seedProfile("google-admin", "admin@example.com", "admin");
  seedProfile("google-admin2", "admin2@example.com", "admin");
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

function seedProfile(uid, email, role, status = "approved", extra = {}) {
  putDocument("userProfiles", uid, { uid, email, role, status, displayName: email.split("@")[0], ...extra }, { ownerUid: uid });
}

function request(path, method = "GET", body, token = "admin-token") {
  return new Request(`${API}${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body))
  });
}

async function call(path, method = "GET", body, token = "admin-token") {
  const response = await worker.fetch(request(path, method, body, token), environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text, headers: response.headers };
}

function multipart(path, fields, token) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(name, value, value.name || name);
    else form.append(name, String(value));
  }
  return worker.fetch(new Request(`${API}${path}`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` }, body: form }), environment)
    .then(async response => ({ status: response.status, payload: JSON.parse(await response.text() || "{}") }));
}

const usage = () => Object.fromEntries(database.database.prepare("SELECT metric, SUM(count) AS total FROM usage_daily GROUP BY metric").all().map(row => [row.metric, row.total]));

const encode = data => Buffer.from(JSON.stringify(data)).toString("base64url");
async function oidc() {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256", kid: "test-admin" });
  const payload = encode({
    iss: "https://token.actions.githubusercontent.com", aud: `${API}/background`, repository: "SHMUEL-LAMED/1",
    repository_id: "1308950667", repository_owner_id: "295421676",
    workflow_ref: "SHMUEL-LAMED/1/.github/workflows/background-jobs.yml@refs/heads/main", ref: "refs/heads/main",
    event_name: "schedule", iat: now, exp: now + 300, run_id: "778"
  });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", oidcKeys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

async function backgroundToken() {
  const response = await call("/background/session", "POST", undefined, await oidc());
  assert.equal(response.status, 200, response.text);
  return response.payload.token;
}

// --- 1. מוני השימוש ---

test("דיווח שימוש: ביקור אחד ביום לכל משתמש, מונים חתוכים, ואין בטבלה דבר מלבד מספרים", async () => {
  const first = await call("/stats/beacon", "POST", { counts: { views: 3, downloads: 1, zipDownloads: 1, zipItems: 12, evil: 99, uploads: 50 } }, "viewer-token");
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.payload, { success: true, accepted: true, visit: true });
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  const second = await call("/stats/beacon", "POST", { counts: { views: 100000 } }, "viewer-token");
  assert.deepEqual(second.payload, { success: true, accepted: true, visit: false });
  await call("/stats/beacon", "POST", {}, "admin-token");
  // מדד שאינו ברשימה, ומדד שרק השרת סופר (uploads), אינם נכנסים מהדפדפן.
  assert.deepEqual(usage(), { visits: 2, views: 503, downloads: 1, zipDownloads: 1, zipItems: 12 });
  const columns = database.database.prepare("PRAGMA table_info(usage_daily)").all().map(row => row.name);
  assert.deepEqual(columns, ["day", "metric", "count", "updated_at"]);
});

test("דיווח שימוש: רק משתמש מאושר; גוף פגום או גדול נדחה; מעבר לתקרה היומית אינו כותב", async () => {
  assert.equal((await call("/stats/beacon", "POST", {}, "pending-token")).status, 403);
  assert.equal((await call("/stats/beacon", "POST", {}, "")).status, 401);
  assert.equal((await call("/stats/beacon", "POST", "{not json", "viewer-token")).status, 400);
  assert.equal((await call("/stats/beacon", "POST", { counts: { views: 1 }, pad: "x".repeat(3000) }, "viewer-token")).status, 413);
  for (let index = 0; index < 48; index += 1) await call("/stats/beacon", "POST", { counts: { views: 1 } }, "viewer-token");
  const over = await call("/stats/beacon", "POST", { counts: { views: 1 } }, "viewer-token");
  assert.deepEqual(over.payload, { success: true, accepted: false, visit: false });
  assert.equal(usage().views, 48);
  // תהליך הרקע אינו מדווח בשם משתמשים.
  assert.equal((await call("/stats/beacon", "POST", {}, await backgroundToken())).status, 403);
});

test("ביקור ביום חדש נספר שוב, והמשתמשים הפעילים נספרים משורת היום האחרון", async () => {
  const yesterday = Date.now() - DAY;
  const dayStart = time => { const date = new Date(time); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); };
  database.database.prepare("INSERT INTO request_rate_limits VALUES ('usage-day:google-viewer', ?, 5)").run(dayStart(yesterday));
  database.database.prepare("INSERT INTO request_rate_limits VALUES ('usage-day:google-admin', ?, 1)").run(dayStart(Date.now() - 20 * DAY));
  database.database.prepare("INSERT INTO request_rate_limits VALUES ('usage-day:google-old', ?, 1)").run(dayStart(Date.now() - 90 * DAY));
  database.database.prepare("INSERT INTO request_rate_limits VALUES ('upload:google-viewer', ?, 1)").run(Date.now());
  const beacon = await call("/stats/beacon", "POST", {}, "viewer-token");
  assert.equal(beacon.payload.visit, true);
  const stats = await call("/stats/usage?days=30", "GET", undefined, "super-token");
  assert.equal(stats.status, 200, stats.text);
  assert.deepEqual(stats.payload.activeUsers, { today: 1, last7: 1, last30: 2 });
  assert.equal(stats.payload.days.length, 1);
  assert.equal(stats.payload.days[0].visits, 1);
  // התשובה מכילה מספרים ותאריכים בלבד — אף מזהה משתמש.
  assert.doesNotMatch(stats.text, /google-/);
  assert.equal(stats.headers.get("Cache-Control"), "private, no-store");
});

test("קריאת הסטטיסטיקות: מנהל־על אנושי בלבד", async () => {
  for (const token of ["viewer-token", "admin-token", "pending-token"]) assert.equal((await call("/stats/usage", "GET", undefined, token)).status, 403, token);
  assert.equal((await call("/stats/usage", "GET", undefined, "")).status, 401);
  assert.equal((await call("/stats/usage", "GET", undefined, await backgroundToken())).status, 403);
  const ok = await call("/stats/usage?days=9999", "GET", undefined, "super-token");
  assert.equal(ok.status, 200);
  assert.ok(ok.payload.metrics.includes("visits"));
});

test("העלאה, אישור ודחייה נספרים בשרת; מחיקת רשומת תיעוד של פריט מאושר אינה דחייה", async () => {
  const jpeg = new File([new Uint8Array(500).fill(7)], "a.jpg", { type: "image/jpeg" });
  const pending = await multipart("/upload", { file: jpeg, imageId: "img-p", title: "ממתינה" }, "viewer-token");
  assert.equal(pending.status, 201);
  const direct = await multipart("/upload", { file: jpeg, imageId: "img-d", title: "ישירה" }, "admin-token");
  assert.equal(direct.status, 201);
  assert.deepEqual(usage(), { uploads: 2, uploadsPending: 1 });
  const approved = await call("/approve", "POST", { key: pending.payload.key }, "admin-token");
  assert.equal(approved.status, 200, approved.text);
  putDocument("pendingImages", "img-r", { id: "img-r", status: "pending" });
  putDocument("pendingImages", "img-done", { id: "img-done", status: "approved" });
  assert.equal((await call("/data/pendingImages/img-r", "DELETE", undefined, "super-token")).status, 200);
  assert.equal((await call("/data/pendingImages/img-done", "DELETE", undefined, "super-token")).status, 200);
  assert.deepEqual(usage(), { uploads: 2, uploadsPending: 1, approvals: 1, rejections: 1 });
});

test("normalizeUsageCounts: רק המדדים של הדפדפן, שלמים חיוביים, עד התקרה", () => {
  assert.deepEqual(normalizeUsageCounts({ views: "4", downloads: -1, zipItems: 1e9, visits: 3, x: 1 }), { views: 4, zipItems: 2000 });
  assert.deepEqual(normalizeUsageCounts(null), {});
  assert.deepEqual(normalizeUsageCounts([1, 2]), {});
});

// --- 2. אחסון ועלויות ---

test("סריקת האחסון: רק תהליך התחזוקה, בעמודים עם סמן, סיכום לפי קידומת — ופעם ביום", async () => {
  for (let index = 0; index < 1500; index += 1) bucket.seed(`approved/u/${String(index).padStart(5, "0")}.jpg`, 10);
  for (let index = 0; index < 600; index += 1) bucket.seed(`variants/i${index}/thumb.webp`, 2);
  bucket.seed("backups/d1/2026-10-01.json.gz", 1000);
  bucket.seed("chat/u/u/a.pdf", 5);
  bucket.seed("private/drive-oauth/credentials/x.json", 3);
  bucket.seed("pending/u/p.jpg", 7);
  for (const token of ["super-token", "admin-token", "viewer-token"]) assert.equal((await call("/maintenance/storage-scan", "POST", {}, token)).status, 403, token);
  const runner = await backgroundToken();
  const steps = [];
  for (let index = 0; index < 5; index += 1) {
    const step = await call("/maintenance/storage-scan", "POST", {}, runner);
    assert.equal(step.status, 200, step.text);
    steps.push(step.payload);
    if (step.payload.done) break;
  }
  assert.deepEqual(steps.map(step => step.done), [false, false, true]);
  const again = await call("/maintenance/storage-scan", "POST", {}, runner);
  assert.equal(again.payload.idle, true);
  const report = (await call("/maintenance/storage", "GET", undefined, "super-token")).payload.report;
  assert.equal(report.objects, 2104);
  assert.equal(report.bytes, 15000 + 1200 + 1000 + 5 + 3 + 7);
  assert.deepEqual(report.byPrefix.approved, { objects: 1500, bytes: 15000 });
  assert.deepEqual(report.byPrefix.variants, { objects: 600, bytes: 1200 });
  assert.deepEqual(report.byPrefix.other, { objects: 1, bytes: 3 });
  assert.ok(report.d1Bytes > 0, "גודל D1 מ-page_count");
  assert.equal(typeof report.jobs.aiDescriptions, "number");
  assert.ok(report.completedAt > 0);
});

test("דוח האחסון והסף: מנהל־על בלבד, והמסמכים הפנימיים אינם ברשימה של אחרים", async () => {
  for (const token of ["admin-token", "viewer-token"]) {
    assert.equal((await call("/maintenance/storage", "GET", undefined, token)).status, 403, token);
    assert.equal((await call("/data/systemMeta/storageBudget", "PUT", { data: { r2QuotaGb: 1 } }, token)).status, 403, token);
    assert.equal((await call("/data/systemMeta/maintenanceStorage", "GET", undefined, token)).status, 403, token);
  }
  assert.equal((await call("/maintenance/storage", "GET", undefined, await backgroundToken())).status, 403);
  assert.equal((await call("/data/systemMeta/storageBudget", "PUT", { data: { r2QuotaGb: 10, warnPercent: 70 } }, "super-token")).status, 200);
  putDocument("systemMeta", "maintenanceStorage", { report: { bytes: 8 * 1024 ** 3, completedAt: Date.now() } });
  const listed = (await call("/data/systemMeta", "GET", undefined, "admin-token")).payload.documents.map(item => item.id);
  assert.ok(!listed.includes("storageBudget") && !listed.includes("maintenanceStorage"));
  const view = await call("/maintenance/storage", "GET", undefined, "super-token");
  assert.equal(view.payload.budget.r2QuotaGb, 10);
  assert.equal(view.payload.status.r2.percent, 80);
  assert.equal(view.payload.status.over, true);
});

test("התראת אחסון: מייל אחד לכל דוח נפח, עם אחוזים וקישור למסך הסטטיסטיקות בלבד", async () => {
  environment.RESEND_API_KEY = "re_test";
  environment.EMAIL_FROM = "gallery@example.com";
  const reportAt = Date.now() - 1000;
  putDocument("systemMeta", "maintenanceStorage", { report: { bytes: 9 * 1024 ** 3, d1Bytes: 100, completedAt: reportAt } });
  putDocument("systemMeta", "storageBudget", { r2QuotaGb: 10, warnPercent: 80 });
  const runner = await backgroundToken();
  const first = await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, runner);
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.payload.reasons, ["storage"]);
  assert.equal(emails.length, 1);
  assert.match(emails[0].text, /90%/);
  assert.match(emails[0].text, /admin\.html#stats/);
  // אחרי שש שעות (הנעילה שוחררה) — אותו דוח אינו שולח שוב.
  const state = readDocument("systemMeta", "maintenanceAlert");
  putDocument("systemMeta", "maintenanceAlert", { ...state, lastAlertAt: Date.now() - 7 * 60 * 60 * 1000 });
  const second = await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, runner);
  assert.deepEqual(second.payload.reasons, []);
  assert.equal(emails.length, 1);
  // דוח חדש שעדיין מעל הסף — מייל נוסף.
  putDocument("systemMeta", "maintenanceStorage", { report: { bytes: 9 * 1024 ** 3, completedAt: reportAt + 5000 } });
  const third = await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, runner);
  assert.deepEqual(third.payload.reasons, ["storage"]);
  assert.equal(emails.length, 2);
});

test("בלי סף שהוגדר אין התראת אחסון", async () => {
  environment.RESEND_API_KEY = "re_test";
  environment.EMAIL_FROM = "gallery@example.com";
  putDocument("systemMeta", "maintenanceStorage", { report: { bytes: 9 * 1024 ** 4, completedAt: Date.now() } });
  const result = await call("/maintenance/alert-check", "POST", { health: { ok: true, status: 200 } }, await backgroundToken());
  assert.deepEqual(result.payload.reasons, []);
  assert.equal(emails.length, 0);
});

test("normalizeStorageBudget ו-storageBudgetStatus", () => {
  assert.deepEqual(normalizeStorageBudget({ r2QuotaGb: "abc", d1QuotaMb: -5, warnPercent: 3 }), { r2QuotaGb: 0, d1QuotaMb: 0, warnPercent: 80 });
  assert.deepEqual(normalizeStorageBudget({ r2QuotaGb: 1e9, warnPercent: 95 }).r2QuotaGb, 100000);
  const budget = normalizeStorageBudget({ r2QuotaGb: 1, d1QuotaMb: 100, warnPercent: 50 });
  const status = storageBudgetStatus({ bytes: 512 * 1024 ** 2, d1Bytes: 10 * 1024 ** 2, completedAt: 1 }, budget);
  assert.equal(status.r2.percent, 50);
  assert.equal(status.r2.over, true);
  assert.equal(status.d1.over, false);
  assert.equal(storageBudgetStatus(null, budget).over, false);
});

// --- 3. פעולה על כמה משתמשים ---

test("פעולה מרובה: מנהל־על בלבד, וקלט פסול נדחה לפני שמשתנה דבר", async () => {
  for (const token of ["admin-token", "viewer-token"]) {
    assert.equal((await call("/admin/users/batch", "POST", { action: "block", uids: ["google-viewer"] }, token)).status, 403, token);
  }
  assert.equal((await call("/admin/users/batch", "POST", { action: "nuke", uids: ["google-viewer"] }, "super-token")).status, 400);
  assert.equal((await call("/admin/users/batch", "POST", { action: "role", role: "god", uids: ["google-viewer"] }, "super-token")).status, 400);
  assert.equal((await call("/admin/users/batch", "POST", { action: "block", uids: [] }, "super-token")).status, 400);
  assert.equal((await call("/admin/users/batch", "POST", { action: "block", uids: ["../x"] }, "super-token")).status, 400);
  assert.equal((await call("/admin/users/batch", "POST", { action: "block", uids: Array.from({ length: 101 }, (_, i) => `u${i}`) }, "super-token")).status, 400);
  assert.equal(readDocument("userProfiles", "google-viewer").status, "approved");
});

test("פעולה מרובה: אישור, חסימה, שינוי דרגה וביטול חסימה — עם דוח לכל משתמש ויומן פעילות", async () => {
  seedProfile("google-p2", "p2@example.com", "viewer", "pending");
  const approve = await call("/admin/users/batch", "POST", { action: "approve", role: "uploader", uids: ["google-pending", "google-p2", "google-viewer", "google-ghost"] }, "super-token");
  assert.equal(approve.status, 200, approve.text);
  assert.equal(approve.payload.succeeded, 2);
  assert.deepEqual(approve.payload.results.map(result => [result.uid, result.ok, result.code || ""]), [
    ["google-pending", true, ""], ["google-p2", true, ""], ["google-viewer", false, "not_pending"], ["google-ghost", false, "not_found"]
  ]);
  assert.equal(readDocument("userProfiles", "google-pending").role, "uploader");
  assert.equal(readDocument("userProfiles", "google-pending").approvedBy, "google-super");

  const block = await call("/admin/users/batch", "POST", { action: "block", uids: ["google-viewer", "google-admin"] }, "super-token");
  assert.equal(block.payload.succeeded, 2);
  assert.equal(readDocument("userProfiles", "google-admin").status, "blocked");
  assert.equal(readDocument("userProfiles", "google-admin").roleBeforeBlock, "admin");
  // המשתמש החסום נדחה מיד בבקשה הבאה שלו.
  assert.equal((await call("/data/folders", "GET", undefined, "admin-token")).status, 403);

  const unblock = await call("/admin/users/batch", "POST", { action: "unblock", uids: ["google-admin"] }, "super-token");
  assert.equal(unblock.payload.succeeded, 1);
  assert.equal(readDocument("userProfiles", "google-admin").role, "admin");

  const role = await call("/admin/users/batch", "POST", { action: "role", role: "admin", uids: ["google-admin", "google-pending"] }, "super-token");
  assert.deepEqual(role.payload.results.map(result => result.code || "ok"), ["unchanged", "ok"]);
  const logs = database.database.prepare("SELECT data_json FROM gallery_documents WHERE collection_name = 'activityLogs'").all().map(row => JSON.parse(row.data_json));
  assert.equal(logs.length, 6);
  assert.ok(logs.every(log => log.actorUid === "google-super" && log.targetType === "user"));
});

test("פעולה מרובה: לעולם לא על החשבון שלך, ומנהל־על אחר כן — כל עוד נשאר מנהל־על", async () => {
  seedProfile("google-super2", "super2@example.com", "super_admin");
  const self = await call("/admin/users/batch", "POST", { action: "role", role: "viewer", uids: ["google-super", "google-super2"] }, "super-token");
  assert.deepEqual(self.payload.results.map(result => result.code || "ok"), ["self_forbidden", "ok"]);
  assert.equal(readDocument("userProfiles", "google-super").role, "super_admin");
  assert.equal(readDocument("userProfiles", "google-super2").role, "viewer");
  const block = await call("/admin/users/batch", "POST", { action: "block", uids: ["google-super"] }, "super-token");
  assert.equal(block.payload.results[0].code, "self_forbidden");
  assert.equal(readDocument("userProfiles", "google-super").status, "approved");
});

test("ב-/data: מנהל־על אינו מוריד, חוסם או מוחק את עצמו", async () => {
  const demote = await call("/data/userProfiles/google-super", "PUT", { data: { role: "viewer" }, merge: true }, "super-token");
  assert.equal(demote.status, 403);
  assert.equal(demote.payload.code, "self_lockout");
  const block = await call("/data/userProfiles/google-super", "PUT", { data: { status: "blocked" }, merge: true }, "super-token");
  assert.equal(block.payload.code, "self_lockout");
  assert.equal((await call("/data/userProfiles/google-super", "DELETE", undefined, "super-token")).payload.code, "self_lockout");
  assert.equal(readDocument("userProfiles", "google-super").role, "super_admin");
  // עדכון רגיל של הפרופיל של עצמו (בלי שינוי דרגה) ממשיך לעבוד.
  assert.equal((await call("/data/userProfiles/google-super", "PUT", { data: { lastLoginAt: 5 }, merge: true }, "super-token")).status, 200);
  // ומנהל־על אחר — מותר, כשנשאר לפחות מנהל־על אחד.
  seedProfile("google-super2", "super2@example.com", "super_admin");
  assert.equal((await call("/data/userProfiles/google-super2", "PUT", { data: { role: "admin" }, merge: true }, "super-token")).status, 200);
});

test("superAdminRetentionProblem: עצמי, האחרון, ומה שאינו נוגע בדרגה 4", () => {
  const superAdmin = { status: "approved", role: "super_admin" };
  assert.equal(superAdminRetentionProblem({ existing: superAdmin, next: { ...superAdmin, role: "admin" }, documentId: "a", actorUid: "a" }), "self_lockout");
  assert.equal(superAdminRetentionProblem({ existing: superAdmin, next: { ...superAdmin, status: "blocked" }, documentId: "b", actorUid: "a", otherSuperAdmins: 0 }), "last_super_admin");
  assert.equal(superAdminRetentionProblem({ existing: superAdmin, next: {}, documentId: "b", actorUid: "a", otherSuperAdmins: 1 }), "");
  assert.equal(superAdminRetentionProblem({ existing: { status: "approved", role: "admin" }, next: { status: "blocked" }, documentId: "a", actorUid: "a", otherSuperAdmins: 0 }), "");
  assert.equal(superAdminRetentionProblem({ existing: superAdmin, next: superAdmin, documentId: "a", actorUid: "a", otherSuperAdmins: 0 }), "");
});

// --- 4. הערות פנימיות ---

test("הערות: מנהל ומנהל־על כותבים וקוראים; צופה, ממתין ותהליך הרקע — לא", async () => {
  const added = await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "  ביקש גישה לתיקיית הילדים\n" }, "admin-token");
  assert.equal(added.status, 200, added.text);
  assert.equal(added.payload.note.body, "ביקש גישה לתיקיית הילדים");
  assert.equal(added.payload.note.authorUid, "google-admin");
  assert.equal(added.headers.get("Cache-Control"), "private, no-store");
  const read = await call("/admin/user-notes?uid=google-viewer", "GET", undefined, "super-token");
  assert.equal(read.payload.notes.length, 1);
  assert.equal(read.payload.notes[0].canDelete, true);
  for (const token of ["viewer-token", "pending-token"]) {
    assert.equal((await call("/admin/user-notes?uid=google-admin", "GET", undefined, token)).status, 403, token);
    assert.equal((await call("/admin/user-notes", "POST", { uid: "google-admin", body: "x" }, token)).status, 403, token);
  }
  assert.equal((await call("/admin/user-notes?uid=google-viewer", "GET", undefined, await backgroundToken())).status, 403);
});

test("הערות: משתמש לעולם אינו קורא הערות על עצמו — לא ישירות, לא דרך /data ולא בפרופיל", async () => {
  await call("/admin/user-notes", "POST", { uid: "google-admin", body: "הערה סודית על המנהל" }, "super-token");
  await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "הערה סודית על הצופה" }, "admin-token");
  await call("/admin/user-notes", "POST", { uid: "google-super", body: "הערה על מנהל־העל" }, "admin-token");
  // המנהל עצמו — אף שהוא מנהל — אינו קורא את ההערה עליו, וגם מנהל־העל לא.
  const own = await call("/admin/user-notes?uid=google-admin", "GET", undefined, "admin-token");
  assert.equal(own.status, 403);
  assert.equal(own.payload.code, "notes_about_self");
  assert.doesNotMatch(own.text, /סודית/);
  assert.equal((await call("/admin/user-notes?uid=google-super", "GET", undefined, "super-token")).status, 403);
  assert.equal((await call("/admin/user-notes", "POST", { uid: "google-admin", body: "על עצמי" }, "admin-token")).status, 403);
  // הצופה קורא את הפרופיל שלו — ואין בו זכר להערות.
  const profile = await call("/data/userProfiles/google-viewer", "GET", undefined, "viewer-token");
  assert.equal(profile.status, 200);
  assert.doesNotMatch(profile.text, /סודית|note/i);
  const adminProfile = await call("/data/userProfiles/google-admin", "GET", undefined, "admin-token");
  assert.doesNotMatch(adminProfile.text, /סודית/);
  // ההערות אינן אוסף של /data.
  assert.equal((await call("/data/admin_user_notes", "GET", undefined, "super-token")).status, 404);
  assert.equal((await call("/data/adminUserNotes", "GET", undefined, "super-token")).status, 404);
});

test("הערות: אימות קלט, מחיקה רק לכותב או למנהל־על, ומחיקת המשתמש מוחקת אותן", async () => {
  assert.equal((await call("/admin/user-notes?uid=../x", "GET", undefined, "admin-token")).status, 400);
  assert.equal((await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "   " }, "admin-token")).payload.code, "empty_note");
  assert.equal((await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "א".repeat(2001) }, "admin-token")).payload.code, "note_too_long");
  assert.equal((await call("/admin/user-notes", "POST", { uid: "google-nobody", body: "x" }, "admin-token")).status, 404);
  const note = (await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "x‮y" }, "admin-token")).payload.note;
  assert.equal(note.body, "xy");
  const other = await call("/admin/user-notes?uid=google-viewer", "GET", undefined, "admin2-token");
  assert.equal(other.payload.notes[0].canDelete, false);
  assert.equal((await call(`/admin/user-notes/${note.id}`, "DELETE", undefined, "admin2-token")).status, 403);
  assert.equal((await call("/admin/user-notes/not-a-note", "DELETE", undefined, "super-token")).status, 400);
  assert.equal((await call(`/admin/user-notes/${note.id}`, "DELETE", undefined, "super-token")).status, 200);
  await call("/admin/user-notes", "POST", { uid: "google-viewer", body: "עוד אחת" }, "admin-token");
  assert.equal((await call("/data/userProfiles/google-viewer", "DELETE", undefined, "super-token")).status, 200);
  assert.equal(database.database.prepare("SELECT COUNT(*) AS n FROM admin_user_notes").get().n, 0);
});

test("cleanUserNote: שורות נשמרות, תווי בקרה וכיווניות נמחקים", () => {
  assert.equal(cleanUserNote("שורה\r\nשנייה\u0007"), "שורה\nשנייה");
  assert.equal(cleanUserNote(5), "");
});

// --- 5. הרקע המטושטש ---

test("placeholder ברשומה: נשמר כשהוא תקין, נזרק כשאינו, ועותק ישן בלי השדה אינו מוחק אותו", async () => {
  const saved = await call("/data/images/img-1", "PUT", { data: { id: "img-1", title: "א", placeholder: PLACEHOLDER } }, "admin-token");
  assert.equal(saved.status, 200, saved.text);
  assert.equal(readDocument("images", "img-1").placeholder, PLACEHOLDER);
  await call("/data/images/img-1", "PUT", { data: { id: "img-1", title: "ב" } }, "admin-token");
  assert.equal(readDocument("images", "img-1").placeholder, PLACEHOLDER);
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", `${PLACEHOLDER}");background:url(x`, `data:image/webp;base64,${"A".repeat(500)}`]) {
    await call("/data/images/img-2", "PUT", { data: { id: "img-2", placeholder: bad } }, "admin-token");
    assert.equal(readDocument("images", "img-2").placeholder, undefined, bad);
  }
});

test("POST /media/variants עם placeholder בלבד מעדכן את הרשומות בלי לגעת בתצוגות; ערך פסול נדחה", async () => {
  const variants = { thumb: { key: "variants/img-3/thumb.webp", url: `${API}/media/variants/img-3/thumb.webp`, width: 480, height: 320, type: "image/webp" } };
  putDocument("images", "img-3", { id: "img-3", uploadedBy: "google-admin", variants, variantsVersion: 1 });
  putDocument("pendingImages", "img-3", { id: "img-3", uploadedBy: "google-admin", status: "approved", variants, variantsVersion: 1 });
  const bad = await multipart("/media/variants", { imageId: "img-3", placeholder: "data:text/html;base64,AAAA" }, "admin-token");
  assert.equal(bad.status, 400);
  assert.equal(bad.payload.code, "invalid_placeholder");
  const empty = await multipart("/media/variants", { imageId: "img-3" }, "admin-token");
  assert.equal(empty.payload.code, "variant_missing");
  const ok = await multipart("/media/variants", { imageId: "img-3", placeholder: PLACEHOLDER }, "admin-token");
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.placeholder, PLACEHOLDER);
  assert.deepEqual(ok.payload.updated, ["images", "pendingImages"]);
  assert.deepEqual(readDocument("images", "img-3").variants, variants);
  assert.equal(readDocument("pendingImages", "img-3").placeholder, PLACEHOLDER);
  // צופה אינו מצרף רקע לפריט של אחר.
  assert.equal((await multipart("/media/variants", { imageId: "img-3", placeholder: PLACEHOLDER }, "viewer-token")).status, 403);
});

test("העלאה עם placeholder מחזירה אותו ללקוח; ערך פסול בהעלאה פשוט אינו נשמר", async () => {
  const jpeg = new File([new Uint8Array(400).fill(3)], "a.jpg", { type: "image/jpeg" });
  const good = await multipart("/upload", { file: jpeg, imageId: "img-u1", title: "א", placeholder: PLACEHOLDER }, "admin-token");
  assert.equal(good.status, 201);
  assert.equal(good.payload.placeholder, PLACEHOLDER);
  const badValue = await multipart("/upload", { file: jpeg, imageId: "img-u2", title: "ב", placeholder: "<svg>" }, "admin-token");
  assert.equal(badValue.status, 201);
  assert.equal(badValue.payload.placeholder, undefined);
});

test("normalizeMediaPlaceholder", () => {
  assert.equal(normalizeMediaPlaceholder(` ${PLACEHOLDER} `), PLACEHOLDER);
  assert.equal(normalizeMediaPlaceholder("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(normalizeMediaPlaceholder("data:image/gif;base64,R0lGOD"), "");
  assert.equal(normalizeMediaPlaceholder({}), "");
});
