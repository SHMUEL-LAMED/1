// בדיקות התיקיות המקוננות, תמונת השער, הסדר הידני והעריכה הלא הורסת ב-Worker:
// כל שדה חדש נבדק בשרת (סוג, טווח, מזהים קיימים, עומק ומעגלים), רק מנהל
// משנה אותו, ורשומה ישנה בלי השדות — או דפדפן ישן שכותב רשומה שלמה בלעדיהם —
// מתנהגת בדיוק כמו קודם. המסד הוא SQLite אמיתי בזיכרון (כולל json_set ו-batch
// כטרנזקציה), ו-R2 מדומה במפה.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

class SqliteD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.bindings = [];
  }
  bind(...values) {
    this.bindings = values.map(normalizeBinding);
    return this;
  }
  async first() {
    const row = this.database.prepare(this.sql).get(...this.bindings);
    return row === undefined ? null : row;
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.bindings) };
  }
  async run() {
    const statement = this.database.prepare(this.sql);
    if (this.failOn && this.failOn(this)) throw new Error("simulated D1 failure");
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.failOn = null;
  }
  prepare(sql) {
    const statement = new SqliteD1Statement(this.database, sql);
    statement.failOn = this.failOn;
    return statement;
  }
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
  async put(key, body, options = {}) {
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { key, bytes, customMetadata: { ...(options.customMetadata || {}) } });
    return {};
  }
  async get(key) { return this.objects.get(key) || null; }
  async head(key) { return this.objects.get(key) || null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.values()].filter(item => item.key.startsWith(prefix)), truncated: false };
  }
}

const database = new SqliteD1();
const bucket = new MockR2();
const environment = { GALLERY_DB: database, GALLERY_BUCKET: bucket };

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "pending-admin-token": { sub: "google-pending-admin", email: "pending-admin@example.com", name: "Pending Admin" }
};

const originalFetch = globalThis.fetch;

function headersFor(token, extra = {}) {
  return { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function jsonRequest(path, method = "GET", body, token = "admin-token") {
  return new Request(`${API}${path}`, {
    method,
    headers: headersFor(token, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}

function multipartRequest(path, fields, token = "admin-token") {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof Blob) form.append(name, value, value.name || name);
    else form.append(name, String(value));
  }
  return new Request(`${API}${path}`, { method: "POST", headers: headersFor(token), body: form });
}

async function call(request) {
  const response = await worker.fetch(request, environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

function putDocument(collection, id, data, { ownerUid = "google-admin", updatedAt = Date.now() } = {}) {
  database.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
  ).run(collection, id, JSON.stringify(data), ownerUid, updatedAt, updatedAt);
}

function readDocument(collection, id) {
  const row = database.database
    .prepare("SELECT data_json, updated_at FROM gallery_documents WHERE collection_name = ? AND document_id = ?")
    .get(collection, id);
  return row ? JSON.parse(row.data_json) : null;
}

function updatedAtOf(collection, id) {
  return Number(database.database
    .prepare("SELECT updated_at FROM gallery_documents WHERE collection_name = ? AND document_id = ?")
    .get(collection, id)?.updated_at) || 0;
}

function seedProfile(uid, email, role, status = "approved") {
  putDocument("userProfiles", uid, { uid, email, role, status }, { ownerUid: uid });
}

const putFolder = (id, data, token = "admin-token") => call(jsonRequest(`/data/folders/${id}`, "PUT", { data: { id, ...data } }, token));
const putImage = (id, data, token = "admin-token", merge = false) => call(jsonRequest(`/data/images/${id}`, "PUT", { data: { id, ...data }, merge }, token));
const saveOrder = (body, token = "admin-token") => call(jsonRequest("/order", "POST", body, token));

test.before(async () => {
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const token = decodeURIComponent(new URL(href).searchParams.get("id_token") || "");
      const account = ACCOUNTS[token];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(jsonRequest("/health", "GET", undefined, ""), environment);
  assert.equal(health.status, 200);
});

test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  database.failOn = null;
  bucket.objects.clear();
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "media_variant_files"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer");
  seedProfile("google-uploader", "uploader@example.com", "uploader");
  seedProfile("google-admin", "admin@example.com", "admin");
  seedProfile("google-super", "super@example.com", "super_admin");
  seedProfile("google-pending-admin", "pending-admin@example.com", "admin", "pending");
});

// --- תיקיות מקוננות ---

test("תיקייה מקבלת תיקיית אב קיימת, ו-null מחזיר אותה לרמה העליונה", async () => {
  putDocument("folders", "year", { id: "year", name: "תשפ״ו" });
  const created = await putFolder("event", { name: "שמחת תורה", parentId: "year" });
  assert.equal(created.status, 200, created.text);
  assert.equal(readDocument("folders", "event").parentId, "year");

  const cleared = await putFolder("event", { name: "שמחת תורה", parentId: null });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal("parentId" in readDocument("folders", "event"), false);
});

test("דפדפן ישן שכותב תיקייה שלמה בלי השדות החדשים אינו מוחק אותם", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "event" });
  putDocument("folders", "year", { id: "year", name: "תשפ״ו" });
  putDocument("folders", "event", { id: "event", name: "אירוע", parentId: "year", coverImageId: "img-1", order: 2048, manualOrder: true });

  // בדיוק מה ש-saveFolderToCloud הישן שולח בשינוי שם: הרשומה בלי השדות.
  const renamed = await putFolder("event", { name: "אירוע מחודש", icon: "calendar", isDefault: false });
  assert.equal(renamed.status, 200, renamed.text);
  assert.deepEqual(readDocument("folders", "event"), {
    id: "event", name: "אירוע מחודש", icon: "calendar", isDefault: false,
    parentId: "year", coverImageId: "img-1", order: 2048, manualOrder: true
  });
});

test("רשומת תיקייה ישנה בלי parentId נשארת כפי שהייתה בכתיבה רגילה", async () => {
  putDocument("folders", "legacy", { id: "legacy", name: "ישנה", driveDepth: 2, parentFolderId: "drivefolder_x" });
  const saved = await putFolder("legacy", { name: "ישנה", driveDepth: 2, parentFolderId: "drivefolder_x" });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(readDocument("folders", "legacy"), { id: "legacy", name: "ישנה", driveDepth: 2, parentFolderId: "drivefolder_x" });
});

test("תיקיית אב שאינה קיימת, תיקייה כהורה של עצמה ומזהה פסול נדחים", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  assert.equal((await putFolder("a", { name: "א", parentId: "missing" })).payload.code, "folder_parent_not_found");
  assert.equal((await putFolder("a", { name: "א", parentId: "a" })).payload.code, "folder_cycle");
  for (const parentId of ["../x", "a b", 7, { id: "x" }, "all", "favorites"]) {
    const result = await putFolder("a", { name: "א", parentId });
    assert.equal(result.status, 400, `parentId ${JSON.stringify(parentId)}`);
    assert.equal(result.payload.code, "invalid_folder_parent");
  }
  assert.equal("parentId" in readDocument("folders", "a"), false);
});

test("העברת תיקייה אל תוך תת־תיקייה שלה (מעגל) נדחית", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  putDocument("folders", "b", { id: "b", name: "ב", parentId: "a" });
  putDocument("folders", "c", { id: "c", name: "ג", parentId: "b" });
  const loop = await putFolder("a", { name: "א", parentId: "c" });
  assert.equal(loop.status, 400);
  assert.equal(loop.payload.code, "folder_cycle");
  assert.equal("parentId" in readDocument("folders", "a"), false);
});

test("עומק מרבי של שלוש רמות, כולל תת־התיקיות שכבר בתוך התיקייה שעוברת", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  putDocument("folders", "b", { id: "b", name: "ב", parentId: "a" });
  putDocument("folders", "c", { id: "c", name: "ג", parentId: "b" });
  putDocument("folders", "x", { id: "x", name: "ש" });
  putDocument("folders", "y", { id: "y", name: "ת", parentId: "x" });

  const fourth = await putFolder("d", { name: "ד", parentId: "c" });
  assert.equal(fourth.status, 400);
  assert.equal(fourth.payload.code, "folder_too_deep");
  assert.equal(readDocument("folders", "d"), null);

  // x עם הילד שלה (גובה 2) תחת b (עומק 2) — ארבע רמות.
  const deepSubtree = await putFolder("x", { name: "ש", parentId: "b" });
  assert.equal(deepSubtree.payload.code, "folder_too_deep");
  // תחת a (עומק 1) — שלוש רמות, מותר.
  const fits = await putFolder("x", { name: "ש", parentId: "a" });
  assert.equal(fits.status, 200, fits.text);
});

test("נתונים פגומים עם מעגל קיים אינם תוקעים את ה-Worker", async () => {
  putDocument("folders", "p", { id: "p", name: "פ", parentId: "q" });
  putDocument("folders", "q", { id: "q", name: "ק", parentId: "p" });
  putDocument("folders", "n", { id: "n", name: "נ" });
  const result = await putFolder("n", { name: "נ", parentId: "p" });
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, "folder_tree_corrupt");
});

test("רק מנהל מאושר כותב תיקיות — גם תיקיית אב ושער", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  for (const token of ["viewer-token", "uploader-token", "pending-admin-token"]) {
    const result = await putFolder("b", { name: "ב", parentId: "a" }, token);
    assert.equal(result.status, 403, token);
  }
  assert.equal(readDocument("folders", "b"), null);
});

test("מחיקת תיקייה שיש בה תת־תיקיות נדחית בעברית; אחרי העברת הילד היא נמחקת", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  putDocument("folders", "b", { id: "b", name: "ב", parentId: "a" });
  const refused = await call(jsonRequest("/data/folders/a", "DELETE", undefined, "super-token"));
  assert.equal(refused.status, 409);
  assert.equal(refused.payload.code, "folder_has_children");
  assert.match(refused.payload.message, /תת־תיקיות/);
  assert.ok(readDocument("folders", "a"));

  assert.equal((await putFolder("b", { name: "ב", parentId: null })).status, 200);
  const deleted = await call(jsonRequest("/data/folders/a", "DELETE", undefined, "super-token"));
  assert.equal(deleted.status, 200, deleted.text);
  assert.equal(readDocument("folders", "a"), null);
});

// --- תמונת שער ---

test("תמונת שער: תמונה קיימת או תמונה בסל המחזור; מזהה לא קיים או פסול נדחה", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  putDocument("images", "img-1", { id: "img-1", folderId: "a" });
  assert.equal((await putFolder("a", { name: "א", coverImageId: "img-1" })).status, 200);
  assert.equal(readDocument("folders", "a").coverImageId, "img-1");

  const missing = await putFolder("a", { name: "א", coverImageId: "img-404" });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.code, "cover_image_not_found");
  assert.equal(readDocument("folders", "a").coverImageId, "img-1");

  for (const coverImageId of ["img 1", 5, ["img-1"]]) {
    assert.equal((await putFolder("a", { name: "א", coverImageId })).payload.code, "invalid_cover_image");
  }

  putDocument("trashItems", "trash_1", { id: "trash_1", originalCollection: "images", originalId: "img-trashed" });
  assert.equal((await putFolder("a", { name: "א", coverImageId: "img-trashed" })).status, 200);

  assert.equal((await putFolder("a", { name: "א", coverImageId: null })).status, 200);
  assert.equal("coverImageId" in readDocument("folders", "a"), false);
});

test("שער שהתמונה שלו נמחקה נשאר ברשומה בכתיבה רגילה (הדפדפן חוזר להתנהגות של היום)", async () => {
  putDocument("folders", "a", { id: "a", name: "א", coverImageId: "img-gone" });
  const renamed = await putFolder("a", { name: "שם חדש", coverImageId: "img-gone" });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(readDocument("folders", "a").coverImageId, "img-gone");
});

test("order ו-manualOrder של תיקייה נבדקים", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  assert.equal((await putFolder("a", { name: "א", order: "1" })).payload.code, "invalid_order");
  assert.equal((await putFolder("a", { name: "א", order: 1e16 })).payload.code, "invalid_order");
  assert.equal((await putFolder("a", { name: "א", manualOrder: "yes" })).payload.code, "invalid_manual_order");
  assert.equal((await putFolder("a", { name: "א", order: -512.5, manualOrder: true })).status, 200);
  assert.deepEqual(readDocument("folders", "a"), { id: "a", name: "א", order: -512.5, manualOrder: true });
  assert.equal((await putFolder("a", { name: "א", manualOrder: false })).status, 200);
  assert.equal("manualOrder" in readDocument("folders", "a"), false);
});

// --- order ו-edit של תמונה ---

const EDIT = { rotate: 90, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, rev: "k3x9a" };

test("מנהל קובע סדר ועריכה לתמונה; עריכת זהות אינה נשמרת ו-null מנקה", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", title: "תמונה" });
  const saved = await putImage("img-1", { folderId: "a", title: "תמונה", order: 3, edit: EDIT });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(readDocument("images", "img-1").edit, EDIT);
  assert.equal(readDocument("images", "img-1").order, 3);

  assert.equal((await putImage("img-1", { edit: { rotate: 0, crop: null, rev: "abc" } }, "admin-token", true)).status, 200);
  assert.equal("edit" in readDocument("images", "img-1"), false);
  assert.equal((await putImage("img-1", { edit: { rotate: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, rev: "abc" } }, "admin-token", true)).status, 200);
  assert.equal("edit" in readDocument("images", "img-1"), false);

  assert.equal((await putImage("img-1", { edit: EDIT }, "admin-token", true)).status, 200);
  assert.equal((await putImage("img-1", { edit: null, order: null }, "admin-token", true)).status, 200);
  const cleared = readDocument("images", "img-1");
  assert.equal("edit" in cleared, false);
  assert.equal("order" in cleared, false);
});

test("עריכה פסולה נדחית: סיבוב חלקי, חיתוך מחוץ לתמונה, קטן מדי או בלי מזהה", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a" });
  const invalid = [
    { rotate: 45, rev: "a1" },
    { rotate: "90", rev: "a1" },
    { rotate: 90 },
    { rotate: 90, rev: "UPPER" },
    { rotate: 90, rev: "x".repeat(25) },
    { rotate: 0, crop: { x: 0.6, y: 0, w: 0.5, h: 0.5 }, rev: "a1" },
    { rotate: 0, crop: { x: -0.1, y: 0, w: 0.5, h: 0.5 }, rev: "a1" },
    { rotate: 0, crop: { x: 0, y: 0, w: 0.01, h: 0.5 }, rev: "a1" },
    { rotate: 0, crop: { x: 0, y: 0, w: "0.5", h: 0.5 }, rev: "a1" },
    { rotate: 0, crop: [0, 0, 1, 1], rev: "a1" },
    "rotate"
  ];
  for (const edit of invalid) {
    const result = await putImage("img-1", { edit }, "admin-token", true);
    assert.equal(result.status, 400, JSON.stringify(edit));
    assert.equal(result.payload.code, "invalid_media_edit", JSON.stringify(edit));
  }
  assert.equal("edit" in readDocument("images", "img-1"), false);
});

test("עריכה של סרטון נדחית", async () => {
  putDocument("images", "vid-1", { id: "vid-1", folderId: "a", mediaType: "video" });
  const result = await putImage("vid-1", { edit: EDIT }, "admin-token", true);
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "media_edit_unsupported");
});

test("מעלה אינו קובע סדר או עריכה, ועותק שלו בלי השדות אינו מוחק את מה שהמנהל קבע", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", title: "ישן", order: 7, edit: EDIT, uploadedBy: "google-uploader" });
  const write = await putImage("img-1", { folderId: "a", title: "חדש", uploadedBy: "google-uploader", order: 1, edit: { rotate: 180, rev: "zz" } }, "uploader-token");
  assert.equal(write.status, 200, write.text);
  const stored = readDocument("images", "img-1");
  assert.equal(stored.title, "חדש");
  assert.equal(stored.order, 7);
  assert.deepEqual(stored.edit, EDIT);

  const stale = await putImage("img-1", { folderId: "a", title: "בלי שדות", uploadedBy: "google-uploader" }, "uploader-token");
  assert.equal(stale.status, 200);
  assert.equal(readDocument("images", "img-1").order, 7);

  // רשומה ממתינה: מעלה אינו יכול להכניס עריכה שתעבור לגלריה באישור.
  const pending = await call(jsonRequest("/data/pendingImages/pend-1", "PUT", { data: { id: "pend-1", edit: EDIT, order: 1 } }, "uploader-token"));
  assert.equal(pending.status, 200, pending.text);
  const pendingStored = readDocument("pendingImages", "pend-1");
  assert.equal("edit" in pendingStored, false);
  assert.equal("order" in pendingStored, false);
});

test("דפדפן ישן של מנהל שכותב תמונה שלמה בלי השדות שומר את הסדר והעריכה", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", title: "ישן", order: 7, edit: EDIT });
  const write = await putImage("img-1", { folderId: "a", title: "כיתוב חדש" });
  assert.equal(write.status, 200, write.text);
  assert.equal(readDocument("images", "img-1").order, 7);
  assert.deepEqual(readDocument("images", "img-1").edit, EDIT);
});

test("תמונה שעברה תיקייה עם הדירוג הישן מאבדת אותו; דירוג חדש מפורש נשמר", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", order: 7 });
  assert.equal((await putImage("img-1", { folderId: "b", order: 7 })).status, 200);
  assert.equal("order" in readDocument("images", "img-1"), false);
  assert.equal((await putImage("img-1", { folderId: "c", order: 11 })).status, 200);
  assert.equal(readDocument("images", "img-1").order, 11);
});

// --- POST /order ---

test("POST /order כותב רק את order, ב-batch אחד, ומשאיר את שאר השדות", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", title: "א", caption: "כיתוב", order: 5 }, { updatedAt: 1000 });
  putDocument("images", "img-2", { id: "img-2", folderId: "a", title: "ב" }, { updatedAt: 1000 });
  const result = await saveOrder({ collection: "images", items: [{ id: "img-2", order: 1024 }, { id: "img-1", order: null }] });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.payload.updated, 2);
  assert.deepEqual(readDocument("images", "img-2"), { id: "img-2", folderId: "a", title: "ב", order: 1024 });
  assert.deepEqual(readDocument("images", "img-1"), { id: "img-1", folderId: "a", title: "א", caption: "כיתוב" });
  assert.ok(updatedAtOf("images", "img-2") > 1000, "updated_at מתקדם, כך שכתיבה ישנה מקבילה תזוהה");

  // הרשימה מחזירה את הסדר החדש (גרסת הנתונים התקדמה).
  const list = await call(jsonRequest("/data/images?folderId=a", "GET", undefined, "viewer-token"));
  assert.equal(list.status, 200);
  assert.equal(list.payload.documents.find(doc => doc.id === "img-2").data.order, 1024);
});

test("POST /order לתיקיות", async () => {
  putDocument("folders", "a", { id: "a", name: "א" });
  putDocument("folders", "b", { id: "b", name: "ב", parentId: "a" });
  const result = await saveOrder({ collection: "folders", items: [{ id: "a", order: 2 }, { id: "b", order: 1.5 }] });
  assert.equal(result.status, 200, result.text);
  assert.equal(readDocument("folders", "a").order, 2);
  assert.deepEqual(readDocument("folders", "b"), { id: "b", name: "ב", parentId: "a", order: 1.5 });
});

test("POST /order: רק מנהל מאושר", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a" });
  for (const token of ["viewer-token", "uploader-token", "pending-admin-token"]) {
    const result = await saveOrder({ collection: "images", items: [{ id: "img-1", order: 1 }] }, token);
    assert.equal(result.status, 403, token);
  }
  assert.equal((await saveOrder({ collection: "images", items: [{ id: "img-1", order: 1 }] }, "")).status, 401);
  assert.equal("order" in readDocument("images", "img-1"), false);
});

test("POST /order: בקשה פסולה נדחית לפני שנכתב דבר", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a" });
  putDocument("folders", "f", { id: "f" });
  const cases = [
    [{ collection: "userProfiles", items: [{ id: "img-1", order: 1 }] }, 400, "invalid_order_collection"],
    [{ collection: "images", items: [] }, 400, "order_items_missing"],
    [{ collection: "images", items: "img-1" }, 400, "order_items_missing"],
    [{ collection: "images", items: [{ id: "img-1", order: "1" }] }, 400, "invalid_order"],
    [{ collection: "images", items: [{ id: "img-1" }] }, 400, "invalid_order"],
    [{ collection: "images", items: [{ id: "../img", order: 1 }] }, 400, "invalid_order_id"],
    [{ collection: "images", items: [{ id: "img-1", order: 1 }, { id: "img-1", order: 2 }] }, 400, "duplicate_order_id"],
    [{ collection: "folders", items: [{ id: "all", order: 1 }] }, 400, "invalid_order_id"],
    [{ collection: "images", items: Array.from({ length: 501 }, (_, index) => ({ id: `i${index}`, order: index })) }, 400, "too_many_order_items"],
    [{ collection: "images", items: [{ id: "img-1", order: 1 }, { id: "img-missing", order: 2 }] }, 409, "order_items_not_found"]
  ];
  for (const [body, status, code] of cases) {
    const result = await saveOrder(body);
    assert.equal(result.status, status, `${code}: ${result.text}`);
    assert.equal(result.payload.code, code);
  }
  assert.equal("order" in readDocument("images", "img-1"), false);
});

test("POST /order: כשל באמצע ה-batch אינו משאיר סדר חלקי", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", order: 1 });
  putDocument("images", "img-2", { id: "img-2", folderId: "a", order: 2 });
  database.failOn = statement => /json_set/.test(statement.sql) && statement.bindings.includes("img-2");
  const result = await saveOrder({ collection: "images", items: [{ id: "img-1", order: 10 }, { id: "img-2", order: 5 }] });
  assert.equal(result.status, 500);
  database.failOn = null;
  assert.equal(readDocument("images", "img-1").order, 1);
  assert.equal(readDocument("images", "img-2").order, 2);
});

// --- תצוגות של תמונה ערוכה ---

function webp(name, size = 1200) {
  return new File([new Uint8Array(size).fill(1)], name, { type: "image/webp" });
}

const VARIANT_META = JSON.stringify({ thumb: { width: 480, height: 320 }, medium: { width: 1280, height: 853 } });

test("תצוגות עם מזהה עריכה: כתובת עם ?v= ו-editRev בכל תצוגה", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", uploadedBy: "google-uploader", edit: EDIT, placeholder: "data:image/webp;base64,AAAA" });
  const result = await call(multipartRequest("/media/variants", {
    imageId: "img-1", editRevision: EDIT.rev,
    variant_thumb: webp("thumb.webp"), variant_medium: webp("medium.webp"), variantsMeta: VARIANT_META
  }));
  assert.equal(result.status, 200, result.text);
  const { variants } = readDocument("images", "img-1");
  assert.equal(variants.thumb.url, `${API}/media/variants/img-1/thumb.webp?v=${EDIT.rev}`);
  assert.equal(variants.thumb.key, "variants/img-1/thumb.webp");
  assert.equal(variants.thumb.editRev, EDIT.rev);
  assert.equal(variants.medium.editRev, EDIT.rev);
  assert.deepEqual(readDocument("images", "img-1").edit, EDIT);
  // ממלא המקום (אם קיים ברשומה) תיאר את התמונה שלפני העריכה.
  assert.equal("placeholder" in readDocument("images", "img-1"), false);

  // רקע מטושטש שנשלח עם התצוגות הערוכות נוצר מהן, ולכן הוא נשמר במקום הישן.
  const withPlaceholder = await call(multipartRequest("/media/variants", {
    imageId: "img-1", editRevision: EDIT.rev, placeholder: "data:image/webp;base64,BBBB",
    variant_thumb: webp("thumb.webp"), variantsMeta: VARIANT_META
  }));
  assert.equal(withPlaceholder.status, 200, withPlaceholder.text);
  assert.equal(readDocument("images", "img-1").placeholder, "data:image/webp;base64,BBBB");

  // תצוגות רגילות (ריצת ההשלמה) — בלי ?v= ובלי editRev, כמו היום.
  const plain = await call(multipartRequest("/media/variants", {
    imageId: "img-1", variant_thumb: webp("thumb.webp"), variantsMeta: VARIANT_META
  }));
  assert.equal(plain.status, 200, plain.text);
  const after = readDocument("images", "img-1").variants;
  assert.equal(after.thumb.url, `${API}/media/variants/img-1/thumb.webp`);
  assert.equal("editRev" in after.thumb, false);
});

test("מזהה עריכה בתצוגות: רק מנהל, בפורמט תקין, ולא לסרטון", async () => {
  putDocument("images", "img-1", { id: "img-1", folderId: "a", uploadedBy: "google-uploader" });
  putDocument("images", "vid-1", { id: "vid-1", folderId: "a", mediaType: "video" });
  const fields = (imageId, editRevision) => ({ imageId, editRevision, variant_thumb: webp("thumb.webp"), variantsMeta: VARIANT_META });
  const byUploader = await call(multipartRequest("/media/variants", fields("img-1", "abc"), "uploader-token"));
  assert.equal(byUploader.status, 403);
  const invalid = await call(multipartRequest("/media/variants", fields("img-1", "../x")));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "invalid_edit_revision");
  const video = await call(multipartRequest("/media/variants", fields("vid-1", "abc")));
  assert.equal(video.payload.code, "media_edit_unsupported");
  assert.equal(readDocument("images", "img-1").variants, undefined);
});
