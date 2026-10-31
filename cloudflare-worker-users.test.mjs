// משתמשים: "ההעלאות שלי" (ממתין / אושר / נדחה, עם סיבה), זיהוי כפילויות לפני
// העלאה וקישורי הזמנה לאירוע. המסד הוא SQLite אמיתי בזיכרון. הבדיקות נועלות
// בעיקר את הפרטיות: משתמש לעולם אינו רואה העלאה, סיבת דחייה או כתובת של
// משתמש אחר, ואסימון ההזמנה אינו נשמר ואינו מוחזר אחרי היצירה.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { normalizeContentHash } from "./cloudflare-worker.js";

const DAY = 24 * 60 * 60 * 1000;

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

const database = new D1();
const sql = database.database;
const environment = {
  GALLERY_DB: database,
  GALLERY_BUCKET: {
    async list() { return { objects: [] }; },
    async head() { return null; },
    async get() { return null; },
    async put() { return {}; },
    async delete() {}
  }
};

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "other-token": { sub: "google-other", email: "other@example.com", name: "Other" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "admin2-token": { sub: "google-admin2", email: "admin2@example.com", name: "Admin Two" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" },
  "pending2-token": { sub: "google-pending2", email: "pending2@example.com", name: "Pending Two" },
  "rejected-token": { sub: "google-rejected", email: "rejected@example.com", name: "Rejected" },
  "blocked-token": { sub: "google-blocked", email: "blocked@example.com", name: "Blocked" },
  "noprofile-token": { sub: "google-noprofile", email: "noprofile@example.com", name: "No Profile" }
};

const originalFetch = globalThis.fetch;
test.before(async () => {
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
  const health = await worker.fetch(request("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
  const features = (await health.json()).features;
  for (const feature of ["my-uploads", "upload-duplicates", "event-invites"]) assert.ok(features.includes(feature), feature);
});
test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "upload_rejections", "invite_links"]) {
    sql.exec(`DELETE FROM ${table}`);
  }
  for (const [uid, email, role, status] of [
    ["google-viewer", "viewer@example.com", "viewer", "approved"],
    ["google-other", "other@example.com", "viewer", "approved"],
    ["google-uploader", "uploader@example.com", "uploader", "approved"],
    ["google-admin", "admin@example.com", "admin", "approved"],
    ["google-admin2", "admin2@example.com", "admin", "approved"],
    ["google-super", "super@example.com", "super_admin", "approved"],
    ["google-pending", "pending@example.com", "viewer", "pending"],
    ["google-pending2", "pending2@example.com", "viewer", "pending"],
    ["google-rejected", "rejected@example.com", "viewer", "rejected"],
    ["google-blocked", "blocked@example.com", "viewer", "blocked"]
  ]) putDocument("userProfiles", uid, { uid, email, role, status, displayName: email.split("@")[0] }, uid);
  putDocument("folders", "f_event", { id: "f_event", name: "חתונת כהן" });
  putDocument("folders", "f_other", { id: "f_other", name: "בר מצווה" });
});

function putDocument(collection, id, data, owner = "google-admin", time = 1) {
  sql.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json, owner_uid = excluded.owner_uid`
  ).run(collection, id, JSON.stringify(data), owner, time, time);
}

function readDocument(collection, id) {
  const row = sql.prepare("SELECT data_json, owner_uid FROM gallery_documents WHERE collection_name = ? AND document_id = ?").get(collection, id);
  return row ? { ...JSON.parse(row.data_json), _owner: row.owner_uid } : null;
}

function request(path, method = "GET", body, token = "admin-token", headers = {}) {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(path, method = "GET", body, token = "admin-token", headers = {}) {
  const response = await worker.fetch(request(path, method, body, token, headers), environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function pending(id, uploader, extra = {}) {
  putDocument("pendingImages", id, {
    id, title: `העלאה ${id}`, status: "pending", uploadedBy: uploader,
    uploadedByEmail: `${uploader}@example.com`, uploadedByName: uploader, createdAt: 1000, ...extra
  }, uploader, 1000);
}

// --- 1. "ההעלאות שלי" ---

test("ההעלאות שלי: ממתין, אושר (עם התיקייה) ונדחה (עם סיבה) — רק של המשתמש עצמו, בלי דוא\"ל", async () => {
  pending("p_wait", "google-viewer");
  pending("p_ok", "google-viewer", { status: "approved", approvedAt: 5000, approvedBy: "google-admin" });
  putDocument("images", "p_ok", { id: "p_ok", title: "העלאה p_ok", uploadedBy: "google-viewer", uploadedByEmail: "viewer@example.com", folderId: "f_event", url: "https://media.example/p_ok.jpg", createdAt: 4000 }, "google-viewer", 4000);
  pending("p_no", "google-viewer");
  pending("someone_else", "google-other", { title: "סוד של אחר" });
  const rejected = await call("/pending/reject", "POST", { imageId: "p_no", reason: "  לא קשור‮לאירוע  " });
  assert.equal(rejected.status, 200, rejected.text);
  assert.equal(rejected.payload.recorded, true);
  await call("/pending/reject", "POST", { imageId: "someone_else", reason: "סיבה פרטית של אחר" });

  const mine = await call("/my-uploads", "GET", undefined, "viewer-token");
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.payload.counts, { pending: 1, approved: 1, rejected: 1 });
  const byId = Object.fromEntries(mine.payload.uploads.map(item => [item.id, item]));
  assert.deepEqual(Object.keys(byId).sort(), ["p_no", "p_ok", "p_wait"]);
  assert.equal(byId.p_wait.status, "pending");
  assert.equal(byId.p_ok.status, "approved");
  assert.equal(byId.p_ok.folderId, "f_event");
  assert.equal(byId.p_ok.folderName, "חתונת כהן");
  assert.equal(byId.p_ok.decidedAt, 5000);
  assert.equal(byId.p_ok.thumbUrl, "https://media.example/p_ok.jpg");
  assert.equal(byId.p_no.status, "rejected");
  assert.equal(byId.p_no.reason, "לא קשור לאירוע", "תווי כיווניות נמחקים");
  assert.doesNotMatch(mine.text, /@example\.com/, "אין כתובות דוא\"ל בתשובה");
  assert.doesNotMatch(mine.text, /סוד של אחר|סיבה פרטית/);

  const other = await call("/my-uploads", "GET", undefined, "other-token");
  assert.deepEqual(other.payload.uploads.map(item => item.id), ["someone_else"]);
  assert.equal(other.payload.uploads[0].reason, "סיבה פרטית של אחר");
  assert.doesNotMatch(other.text, /p_wait|p_no|p_ok/);
});

test("ההעלאות שלי: רק למחובר ומאושר; אין פרמטר שמאפשר לבקש משתמש אחר", async () => {
  assert.equal((await call("/my-uploads", "GET", undefined, "")).status, 401);
  assert.equal((await call("/my-uploads", "GET", undefined, "pending-token")).status, 403);
  pending("x1", "google-other");
  const forged = await call("/my-uploads?uid=google-other&uploadedBy=google-other", "GET", undefined, "viewer-token");
  assert.equal(forged.status, 200);
  assert.deepEqual(forged.payload.uploads, []);
});

test("ההעלאות שלי: מעלה בדרגה 2 רואה את מה שהעלה ישירות כ\"אושר\", בלי פריטים מ-Drive של מנהל", async () => {
  putDocument("images", "direct1", { id: "direct1", title: "ישיר", uploadedBy: "google-uploader", folderId: "f_other" }, "google-uploader", 10);
  putDocument("images", "drive1", { id: "drive1", title: "drive", driveFileId: "abc", folderId: "f_other" }, "google-uploader", 11);
  const mine = await call("/my-uploads", "GET", undefined, "uploader-token");
  assert.deepEqual(mine.payload.uploads.map(item => [item.id, item.status, item.folderName, item.decidedAt]), [["direct1", "approved", "בר מצווה", 0]]);
});

test("צופה כותב רק רשומה ממתינה משלו: המעלה נקבע בשרת, ורשומה של אחר אינה נדרסת", async () => {
  const put = await call("/data/pendingImages/p_new", "PUT", { data: { id: "p_new", title: "x", uploadedBy: "google-other", status: "approved", uid: "google-other" } }, "viewer-token");
  assert.equal(put.status, 200, put.text);
  const stored = readDocument("pendingImages", "p_new");
  assert.equal(stored.uploadedBy, "google-viewer");
  assert.equal(stored.status, "pending");
  assert.equal(stored._owner, "google-viewer");
  assert.equal(stored.uid, undefined);
  pending("p_theirs", "google-other");
  const overwrite = await call("/data/pendingImages/p_theirs", "PUT", { data: { id: "p_theirs", title: "חטוף" } }, "viewer-token");
  assert.equal(overwrite.status, 403);
  assert.equal(readDocument("pendingImages", "p_theirs").title, "העלאה p_theirs");
  // רשומה שלו שכבר אושרה אינה חוזרת לתור.
  pending("p_done", "google-viewer", { status: "approved" });
  assert.equal((await call("/data/pendingImages/p_done", "PUT", { data: { id: "p_done", title: "שוב" } }, "viewer-token")).status, 409);
  assert.equal(readDocument("pendingImages", "p_done").status, "approved");
  // מנהל ממשיך לכתוב "אושר" במיזוג, כמו approvePendingRecord.
  const approve = await call("/data/pendingImages/p_theirs", "PUT", { data: { status: "approved", approvedAt: 9 }, merge: true });
  assert.equal(approve.status, 200, approve.text);
  assert.equal(readDocument("pendingImages", "p_theirs").uploadedBy, "google-other");
});

test("דחייה: רק מנהל; סיבה אופציונלית ומקוצרת; פריט שאושר אינו נדחה", async () => {
  pending("r1", "google-viewer");
  assert.equal((await call("/pending/reject", "POST", { imageId: "r1", reason: "x" }, "viewer-token")).status, 403);
  assert.equal((await call("/pending/reject", "POST", { imageId: "r1", reason: "x" }, "uploader-token")).status, 403);
  assert.equal((await call("/pending/reject", "POST", { imageId: "r1", reason: 5 })).status, 400);
  assert.equal((await call("/pending/reject", "POST", { imageId: "missing" })).status, 404);
  const ok = await call("/pending/reject", "POST", { imageId: "r1", reason: "א".repeat(500) });
  assert.equal(ok.status, 200);
  assert.equal([...sql.prepare("SELECT reason FROM upload_rejections WHERE image_id = 'r1'").get().reason].length, 300);
  const noReason = await call("/pending/reject", "POST", { imageId: "r1" }, "super-token");
  assert.equal(noReason.status, 200);
  assert.equal(sql.prepare("SELECT reason FROM upload_rejections WHERE image_id = 'r1'").get().reason, "");
  pending("r2", "google-viewer", { status: "approved" });
  assert.equal((await call("/pending/reject", "POST", { imageId: "r2" })).status, 409);
});

test("מחיקת פריט ממתין (סל המחזור) משאירה תיעוד דחייה מינימלי, והסיבה שנכתבה קודם נשמרת", async () => {
  pending("d1", "google-viewer");
  pending("d2", "google-viewer");
  pending("d3", "google-viewer", { status: "approved" });
  await call("/pending/reject", "POST", { imageId: "d1", reason: "מטושטש" }, "super-token");
  for (const id of ["d1", "d2", "d3"]) {
    assert.equal((await call(`/data/pendingImages/${id}`, "DELETE", undefined, "super-token")).status, 200);
  }
  const rows = sql.prepare("SELECT image_id, uploader_uid, title, reason, rejected_by FROM upload_rejections ORDER BY image_id").all().map(row => ({ ...row }));
  assert.deepEqual(rows, [
    { image_id: "d1", uploader_uid: "google-viewer", title: "העלאה d1", reason: "מטושטש", rejected_by: "google-super" },
    { image_id: "d2", uploader_uid: "google-viewer", title: "העלאה d2", reason: "", rejected_by: "google-super" }
  ]);
  const mine = await call("/my-uploads", "GET", undefined, "viewer-token");
  assert.deepEqual(mine.payload.uploads.map(item => [item.id, item.status, item.reason || ""]).sort(), [["d1", "rejected", "מטושטש"], ["d2", "rejected", ""]]);
  // שחזור מסל המחזור (מנהל־על כותב את הרשומה מחדש): הפריט שוב ממתין.
  const restore = await call("/data/pendingImages/d1", "PUT", { data: { id: "d1", title: "העלאה d1", status: "pending", uploadedBy: "google-viewer" } }, "super-token");
  assert.equal(restore.status, 200);
  const after = await call("/my-uploads", "GET", undefined, "viewer-token");
  assert.equal(after.payload.uploads.find(item => item.id === "d1").status, "pending");
  assert.equal(after.payload.uploads.find(item => item.id === "d1").reason, undefined);
});

test("תיעוד דחייה בן יותר מ-60 יום אינו מוצג", async () => {
  sql.prepare("INSERT INTO upload_rejections (image_id, uploader_uid, title, reason, rejected_by, rejected_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("ancient", "google-viewer", "ישן", "", "google-admin", Date.now() - 61 * DAY);
  const mine = await call("/my-uploads", "GET", undefined, "viewer-token");
  assert.deepEqual(mine.payload.uploads, []);
});

// --- 2. כפילויות ---

test("contentHash: רק טביעה תקינה נשמרת, באותיות קטנות; עותק בלי השדה אינו מוחק אותו", async () => {
  assert.deepEqual(normalizeContentHash({ contentHash: HASH_A.toUpperCase() }), { contentHash: HASH_A });
  assert.deepEqual(normalizeContentHash({ contentHash: `s1:${HASH_B}` }), { contentHash: `s1:${HASH_B}` });
  assert.deepEqual(normalizeContentHash({ contentHash: "<script>" }), {});
  assert.deepEqual(normalizeContentHash({ contentHash: "" }), {});
  assert.deepEqual(normalizeContentHash({ title: "x" }, { contentHash: HASH_C }), { title: "x", contentHash: HASH_C });
  const put = await call("/data/images/h1", "PUT", { data: { id: "h1", title: "x", contentHash: "zz" } }, "admin-token");
  assert.equal(put.status, 200);
  assert.equal(readDocument("images", "h1").contentHash, undefined);
});

test("כפילויות: פריט מאושר מוחזר עם מזהה; ממתין של אחר — רק 'קיים'; ממתין שלי ומנהל — עם מזהה", async () => {
  putDocument("images", "img_a", { id: "img_a", contentHash: HASH_A, uploadedBy: "google-other" }, "google-other");
  pending("pend_other", "google-other", { contentHash: HASH_B });
  pending("pend_mine", "google-viewer", { contentHash: HASH_C });
  pending("approved_record", "google-other", { contentHash: "d".repeat(64), status: "approved" });
  const hashes = [HASH_A, HASH_B, HASH_C, "d".repeat(64), "e".repeat(64)];
  const viewer = await call("/duplicates", "POST", { hashes }, "viewer-token");
  assert.equal(viewer.status, 200, viewer.text);
  assert.deepEqual(viewer.payload.results, [
    { hash: HASH_A, exists: true, imageId: "img_a", state: "approved" },
    { hash: HASH_B, exists: true },
    { hash: HASH_C, exists: true, imageId: "pend_mine", state: "pending" },
    { hash: "d".repeat(64), exists: false },
    { hash: "e".repeat(64), exists: false }
  ]);
  assert.doesNotMatch(viewer.text, /pend_other/);
  const admin = await call("/duplicates", "POST", { hashes: [HASH_B] });
  assert.deepEqual(admin.payload.results, [{ hash: HASH_B, exists: true, imageId: "pend_other", state: "pending" }]);
});

test("כפילויות: טביעה ישנה (s1:) נמצאת, קלט פסול נדחה, ורק למחובר ומאושר", async () => {
  putDocument("images", "big_video", { id: "big_video", contentHash: `s1:${HASH_A}` });
  const legacy = await call("/duplicates", "POST", { hashes: [HASH_B, `S1:${HASH_A.toUpperCase()}`] }, "viewer-token");
  assert.deepEqual(legacy.payload.results.map(result => result.exists), [false, true]);
  assert.equal((await call("/duplicates", "POST", { hashes: ["not-a-hash"] }, "viewer-token")).status, 400);
  assert.equal((await call("/duplicates", "POST", { hashes: HASH_A }, "viewer-token")).status, 400);
  assert.equal((await call("/duplicates", "POST", { hashes: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, "0")) }, "viewer-token")).status, 400);
  assert.equal((await call("/duplicates", "POST", { hashes: [HASH_A] }, "pending-token")).status, 403);
  assert.equal((await call("/duplicates", "POST", { hashes: [HASH_A] }, "")).status, 401);
});

test("כפילויות: השאילתה משתמשת באינדקס של contentHash", () => {
  const plan = sql.prepare(
    `EXPLAIN QUERY PLAN SELECT document_id FROM gallery_documents
     WHERE collection_name IN ('images', 'pendingImages') AND json_extract(data_json, '$.contentHash') IN (?, ?)`
  ).all(HASH_A, HASH_B).map(row => row.detail).join(" ");
  assert.match(plan, /idx_gallery_documents_content_hash/);
  // האינדקס חלקי: כתיבה לאוסף אחר אינה נכנסת אליו.
  const definition = sql.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_gallery_documents_content_hash'").get().sql;
  assert.match(definition, /WHERE collection_name IN \('images', 'pendingImages'\)/);
});

// --- 3. קישורי הזמנה ---

async function createInvite(body = {}, token = "super-token") {
  return call("/invites", "POST", { folderId: "f_event", days: 7, ...body }, token);
}

test("הזמנה: נוצרת רק בידי מנהל; אישור אוטומטי רק למנהל־על; קלט נבדק", async () => {
  assert.equal((await createInvite({}, "viewer-token")).status, 403);
  assert.equal((await createInvite({}, "uploader-token")).status, 403);
  assert.equal((await createInvite({ autoApprove: true }, "admin-token")).status, 403);
  assert.equal((await createInvite({ days: 3 })).status, 400);
  assert.equal((await createInvite({ maxUses: -1 })).status, 400);
  assert.equal((await createInvite({ maxUses: 1.5 })).status, 400);
  assert.equal((await createInvite({ maxUses: 1001 })).status, 400);
  assert.equal((await createInvite({ autoApprove: "yes" })).status, 400);
  assert.equal((await createInvite({ folderId: "missing" })).status, 404);
  assert.equal((await createInvite({ folderId: "all" })).status, 404);
  const created = await createInvite({ maxUses: 3 }, "admin-token");
  assert.equal(created.status, 201, created.text);
  assert.equal(created.payload.invite.folderName, "חתונת כהן");
  assert.equal(created.payload.invite.autoApprove, false);
  assert.equal(created.payload.invite.maxUses, 3);
  assert.equal(created.payload.invite.status, "active");
  assert.ok(Math.abs(created.payload.invite.expiresAt - created.payload.invite.createdAt - 7 * DAY) < 5);
});

test("הזמנה: האסימון (256 ביט) מוחזר פעם אחת, נשמר רק כגיבוב, ואינו מופיע ברשימה", async () => {
  const created = await createInvite();
  const { token, invite } = created.payload;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = sql.prepare("SELECT * FROM invite_links WHERE invite_id = ?").get(invite.inviteId);
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  assert.equal(row.token_hash, expected);
  const everything = JSON.stringify(sql.prepare("SELECT * FROM invite_links").all()) + JSON.stringify(sql.prepare("SELECT data_json FROM gallery_documents").all());
  assert.ok(!everything.includes(token), "האסימון עצמו אינו נשמר באף מקום");
  const list = await call("/invites", "GET", undefined, "admin-token");
  assert.equal(list.status, 200);
  assert.equal(list.payload.invites.length, 1);
  assert.ok(!list.text.includes(token) && !list.text.includes(expected), "אין אסימון ואין גיבוב ברשימה");
  assert.equal(list.payload.invites[0].mine, false);
  assert.equal(list.payload.canAutoApprove, false);
  assert.equal((await call("/invites", "GET", undefined, "viewer-token")).status, 403);
  const two = await createInvite();
  assert.notEqual(two.payload.token, token);
});

test("הזמנה: משתמש ממתין שמממש מסומן 'הגיע מהזמנה', ואינו מאושר בלי אישור אוטומטי", async () => {
  const { token } = (await createInvite()).payload;
  const redeemed = await call("/invites/redeem", "POST", { token }, "pending-token");
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.deepEqual({ ...redeemed.payload }, { success: true, folderId: "f_event", folderName: "חתונת כהן", status: "pending", autoApproved: false });
  const profile = readDocument("userProfiles", "google-pending");
  assert.equal(profile.status, "pending");
  assert.equal(profile.inviteFolderName, "חתונת כהן");
  assert.equal(profile.inviteFolderId, "f_event");
  assert.equal(profile.inviteAutoApproved, false);
  const logs = sql.prepare("SELECT data_json FROM gallery_documents WHERE collection_name = 'activityLogs'").all().map(row => JSON.parse(row.data_json));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "invite_redeemed");
  assert.ok(!JSON.stringify(logs).includes(token));
  // משתמש מאושר אינו מקבל גישה לתוכן הממתינים, ומאושר אינו נספר כשימוש.
  const approved = await call("/invites/redeem", "POST", { token }, "viewer-token");
  assert.equal(approved.payload.alreadyApproved, true);
  assert.equal(sql.prepare("SELECT use_count FROM invite_links").get().use_count, 1);
});

test("הזמנה עם אישור אוטומטי: ממתין מאושר כצופה בלבד; מי שנדחה רק מסומן; חסום נדחה", async () => {
  putDocument("userProfiles", "google-pending2", { uid: "google-pending2", email: "pending2@example.com", role: "admin", status: "pending" }, "google-pending2");
  const { token } = (await createInvite({ autoApprove: true })).payload;
  const auto = await call("/invites/redeem", "POST", { token }, "pending2-token");
  assert.equal(auto.status, 200, auto.text);
  assert.equal(auto.payload.status, "approved");
  assert.equal(auto.payload.autoApproved, true);
  const profile = readDocument("userProfiles", "google-pending2");
  assert.equal(profile.status, "approved");
  assert.equal(profile.role, "viewer", "אישור דרך קישור לעולם אינו מעניק יותר מצופה");
  assert.match(profile.approvedBy, /^invite:/);
  // עכשיו הוא צופה רגיל — ורק זה.
  assert.equal((await call("/data/pendingImages", "GET", undefined, "pending2-token")).status, 403);
  assert.equal((await call("/data/images", "GET", undefined, "pending2-token")).status, 200);

  const rejected = await call("/invites/redeem", "POST", { token }, "rejected-token");
  assert.equal(rejected.payload.status, "rejected");
  assert.equal(readDocument("userProfiles", "google-rejected").status, "rejected");
  assert.equal((await call("/invites/redeem", "POST", { token }, "blocked-token")).status, 403);
  assert.equal(readDocument("userProfiles", "google-blocked").inviteId, undefined);
});

test("הזמנה: פג תוקף, בוטל או נוצל עד הסוף — נדחה; אותו משתמש פעמיים אינו צורך שימוש", async () => {
  const limited = (await createInvite({ maxUses: 1 })).payload;
  assert.equal((await call("/invites/redeem", "POST", { token: limited.token }, "pending-token")).status, 200);
  assert.equal((await call("/invites/redeem", "POST", { token: limited.token }, "pending-token")).status, 200, "חזרה של אותו משתמש");
  const exhausted = await call("/invites/redeem", "POST", { token: limited.token }, "pending2-token");
  assert.equal(exhausted.status, 410);
  assert.equal(exhausted.payload.code, "invite_exhausted");
  assert.equal(sql.prepare("SELECT use_count FROM invite_links WHERE invite_id = ?").get(limited.invite.inviteId).use_count, 1);

  const expiring = (await createInvite()).payload;
  sql.prepare("UPDATE invite_links SET expires_at = ? WHERE invite_id = ?").run(Date.now() - 1, expiring.invite.inviteId);
  const expired = await call("/invites/redeem", "POST", { token: expiring.token }, "pending2-token");
  assert.equal(expired.status, 410);
  assert.equal(expired.payload.code, "invite_expired");

  const revocable = (await createInvite({}, "admin-token")).payload;
  assert.equal((await call("/invites/revoke", "POST", { inviteId: revocable.invite.inviteId }, "admin2-token")).status, 403, "מנהל אחר אינו מבטל");
  assert.equal((await call("/invites/revoke", "POST", { inviteId: revocable.invite.inviteId }, "viewer-token")).status, 403);
  const revoked = await call("/invites/revoke", "POST", { inviteId: revocable.invite.inviteId }, "admin-token");
  assert.equal(revoked.status, 200);
  assert.equal(revoked.payload.invite.status, "revoked");
  const denied = await call("/invites/redeem", "POST", { token: revocable.token }, "pending2-token");
  assert.equal(denied.status, 410);
  assert.equal(denied.payload.code, "invite_revoked");
  // מנהל־על מבטל כל קישור.
  const other = (await createInvite({}, "admin-token")).payload;
  assert.equal((await call("/invites/revoke", "POST", { inviteId: other.invite.inviteId }, "super-token")).status, 200);
  assert.equal((await call("/invites/revoke", "POST", { inviteId: "bad id" }, "super-token")).status, 400);
});

test("הזמנה: אסימון פסול או לא קיים — אותה תשובה כללית; בלי התחברות — 401", async () => {
  await createInvite();
  for (const token of ["", "short", "x".repeat(43), 12345]) {
    const result = await call("/invites/redeem", "POST", { token }, "pending-token");
    assert.equal(result.status, 404, String(token));
    assert.equal(result.payload.code, "invite_invalid");
  }
  assert.equal((await call("/invites/redeem", "POST", { token: "x".repeat(43) }, "")).status, 401);
  assert.equal((await call("/invites/redeem", "POST", { token: "x".repeat(43) }, "noprofile-token")).status, 404, "אסימון לא תקף נבדק לפני הפרופיל");
});

test("הזמנה: מימוש מוגבל בקצב לחשבון (10 בשעה) ולכתובת IP (30 בשעה)", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await call("/invites/redeem", "POST", { token: "y".repeat(43) }, "pending-token", { "CF-Connecting-IP": "203.0.113.1" })).status, 404);
  }
  const limited = await call("/invites/redeem", "POST", { token: "y".repeat(43) }, "pending-token", { "CF-Connecting-IP": "203.0.113.1" });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.code, "invite_rate_limit");
  // אותה כתובת, חשבונות אחרים: עד 30 בשעה לכתובת.
  sql.exec("DELETE FROM request_rate_limits");
  const tokens = ["pending-token", "pending2-token", "rejected-token", "viewer-token"];
  let status = 0;
  for (let attempt = 0; attempt < 31; attempt += 1) {
    status = (await call("/invites/redeem", "POST", { token: "z".repeat(43) }, tokens[attempt % tokens.length], { "CF-Connecting-IP": "203.0.113.9" })).status;
  }
  assert.equal(status, 429);
});

test("הזמנה: המשתמש אינו יכול לסמן את עצמו כמוזמן דרך עריכת הפרופיל", async () => {
  const put = await call("/data/userProfiles/google-pending", "PUT", {
    data: { uid: "google-pending", displayName: "x", inviteFolderName: "אירוע מזויף", inviteId: "forged", inviteAutoApproved: true }
  }, "pending-token");
  assert.equal(put.status, 200, put.text);
  const profile = readDocument("userProfiles", "google-pending");
  assert.equal(profile.inviteFolderName, undefined);
  assert.equal(profile.inviteId, undefined);
  // שדה אמיתי שהשרת כתב נשמר גם אחרי עריכה של המשתמש.
  const { token } = (await createInvite()).payload;
  await call("/invites/redeem", "POST", { token }, "pending-token");
  await call("/data/userProfiles/google-pending", "PUT", { data: { uid: "google-pending", displayName: "y", inviteFolderName: "שונה" } }, "pending-token");
  assert.equal(readDocument("userProfiles", "google-pending").inviteFolderName, "חתונת כהן");
});

test("הזמנה: עד 100 קישורים פעילים, ומעבר לזה נדרש לבטל", async () => {
  const insert = sql.prepare(`INSERT INTO invite_links (invite_id, token_hash, folder_id, folder_name, created_by, created_at, expires_at)
    VALUES (?, ?, 'f_event', 'x', 'google-super', ?, ?)`);
  for (let index = 0; index < 100; index += 1) insert.run(`seeded_invite_${index}`, `hash_${index}`, Date.now(), Date.now() + DAY);
  const tooMany = await createInvite();
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.payload.code, "too_many_invites");
});
