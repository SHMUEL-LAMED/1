// בדיקות ההעלאה בחלקים (R2 multipart) ו-Cloudflare Stream ב-Worker.
// R2 מדומה כולל createMultipartUpload / resumeMultipartUpload, והמסד הוא
// SQLite אמיתי בזיכרון. Stream מדומה דרך fetch: בלי הסודות אסור שתהיה אליו
// אף קריאה, ועם הסודות — העתקה מכתובת המדיה, ומחיקה יחד עם הסרטון.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

const ORIGIN = "https://shmuel-lamed.github.io";
const API = "https://simchas-gallery-api.example";
const PART = 8 * 1024 * 1024;

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

async function toBytes(body) {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

// R2 מדומה עם העלאה בחלקים, כמו ב-Workers: חלק שנשלח שוב מחליף את הקודם,
// complete דורש את ה-etag של כל חלק, ו-abort מבטל.
class MultipartR2 {
  constructor() {
    this.objects = new Map();
    this.uploads = new Map();
    this.counter = 0;
  }
  async put(key, body, options = {}) {
    this.objects.set(key, { key, bytes: await toBytes(body), httpMetadata: { ...(options.httpMetadata || {}) }, customMetadata: { ...(options.customMetadata || {}) } });
    return {};
  }
  wrap(stored, withBody) {
    return {
      key: stored.key,
      size: stored.bytes.length,
      httpEtag: `"${stored.key}"`,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      body: withBody ? stored.bytes : undefined,
      writeHttpMetadata(headers) { if (stored.httpMetadata.contentType) headers.set("Content-Type", stored.httpMetadata.contentType); }
    };
  }
  async get(key) { const stored = this.objects.get(key); return stored ? this.wrap(stored, true) : null; }
  async head(key) { const stored = this.objects.get(key); return stored ? this.wrap(stored, false) : null; }
  async delete(keys) { for (const key of [].concat(keys)) this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.values()].filter(object => object.key.startsWith(prefix)).map(object => ({ key: object.key, size: object.bytes.length })), truncated: false };
  }
  async createMultipartUpload(key, options = {}) {
    this.counter += 1;
    const uploadId = `upload-${this.counter}`;
    this.uploads.set(uploadId, { key, options, parts: new Map(), state: "open" });
    return { key, uploadId };
  }
  resumeMultipartUpload(key, uploadId) {
    const bucket = this;
    const open = () => {
      const upload = bucket.uploads.get(uploadId);
      if (!upload || upload.key !== key || upload.state !== "open") throw new Error("NoSuchUpload");
      return upload;
    };
    return {
      key,
      uploadId,
      async uploadPart(partNumber, body) {
        const upload = open();
        const bytes = await toBytes(body);
        const etag = `etag-${partNumber}-${bytes.length}-${upload.parts.size}`;
        upload.parts.set(partNumber, { bytes, etag });
        return { partNumber, etag };
      },
      async complete(parts) {
        const upload = open();
        const ordered = [...parts].sort((first, second) => first.partNumber - second.partNumber);
        const chunks = ordered.map(part => {
          const stored = upload.parts.get(part.partNumber);
          if (!stored || stored.etag !== part.etag) throw new Error(`etag mismatch for part ${part.partNumber}`);
          return stored.bytes;
        });
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
        await bucket.put(key, joined, upload.options);
        upload.state = "completed";
        return bucket.wrap(bucket.objects.get(key), false);
      },
      async abort() {
        const upload = bucket.uploads.get(uploadId);
        if (upload) upload.state = "aborted";
      }
    };
  }
}

const database = new D1();
const bucket = new MultipartR2();
const plainEnv = { GALLERY_DB: database, GALLERY_BUCKET: bucket };
const streamEnv = { ...plainEnv, STREAM_ACCOUNT_ID: "acct123", STREAM_API_TOKEN: "stream-secret" };

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "viewer2-token": { sub: "google-viewer-2", email: "viewer2@example.com", name: "Viewer Two" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
};

const streamCalls = [];
let streamResponse = () => Response.json({
  success: true,
  result: { uid: "abc123def", playback: { hls: "https://customer-xyz.cloudflarestream.com/abc123def/manifest/video.m3u8" } }
});
const originalFetch = globalThis.fetch;

test.before(async () => {
  delete globalThis.caches;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const account = ACCOUNTS[new URL(href).searchParams.get("id_token")];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({ ...account, email_verified: "true", aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com" });
    }
    if (href.startsWith("https://api.cloudflare.com/")) {
      streamCalls.push({ url: href, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
      if ((init.method || "GET") === "DELETE") return Response.json({ success: true });
      return streamResponse();
    }
    return new Response("not mocked", { status: 500 });
  };
  const health = await worker.fetch(new Request(`${API}/health`, { headers: { Origin: ORIGIN } }), plainEnv);
  assert.equal(health.status, 200);
});
test.after(() => { globalThis.fetch = originalFetch; });

test.beforeEach(() => {
  bucket.objects.clear();
  bucket.uploads.clear();
  streamCalls.length = 0;
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index", "upload_sessions", "upload_session_parts", "stream_videos"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  for (const [uid, email, role] of [
    ["google-viewer", "viewer@example.com", "viewer"],
    ["google-viewer-2", "viewer2@example.com", "viewer"],
    ["google-uploader", "uploader@example.com", "uploader"],
    ["google-admin", "admin@example.com", "admin"],
    ["google-super", "super@example.com", "super_admin"]
  ]) {
    database.database.prepare(
      "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES ('userProfiles', ?, ?, ?, 1, 1)"
    ).run(uid, JSON.stringify({ uid, email, role, status: "approved" }), uid);
  }
});

function headersFor(token, extra = {}) {
  return { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function call(request, env = plainEnv) {
  const response = await worker.fetch(request, env);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

function postJson(path, body, token, env) {
  return call(new Request(`${API}${path}`, { method: "POST", headers: headersFor(token, { "Content-Type": "application/json" }), body: JSON.stringify(body) }), env);
}

function getJson(path, token, env) {
  return call(new Request(`${API}${path}`, { headers: headersFor(token) }), env);
}

function putPart(uploadId, partNumber, bytes, token, env) {
  return call(new Request(`${API}/upload/multipart/part?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, {
    method: "PUT",
    headers: headersFor(token, { "Content-Type": "application/octet-stream" }),
    body: bytes
  }), env);
}

function complete(uploadId, token, env, extra = {}) {
  const form = new FormData();
  form.append("uploadId", uploadId);
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return call(new Request(`${API}/upload/multipart/complete`, { method: "POST", headers: headersFor(token), body: form }), env);
}

// קובץ של שני חלקים מלאים ועוד שארית, עם תוכן שונה בכל חלק.
function fileBytes(size = PART * 2 + 1000) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 4096) bytes[index] = (index / 4096) % 251;
  return bytes;
}

function slicePart(bytes, partNumber) {
  return bytes.slice((partNumber - 1) * PART, Math.min(bytes.length, partNumber * PART));
}

async function startUpload(token = "uploader-token", overrides = {}, env = plainEnv) {
  return postJson("/upload/multipart/create", {
    imageId: "vid-1",
    title: "סרטון ארוך",
    fileName: "long.mp4",
    mimeType: "video/mp4",
    size: PART * 2 + 1000,
    ...overrides
  }, token, env);
}

test("העלאה בחלקים: פתיחה, שליחת החלקים, השלמה — והקובץ ב-R2 זהה בייט לבייט", async () => {
  const bytes = fileBytes();
  const created = await startUpload();
  assert.equal(created.status, 201, created.text);
  assert.equal(created.payload.key, "approved/google-uploader/vid-1.mp4");
  assert.equal(created.payload.partSize, PART);
  assert.equal(created.payload.totalParts, 3);
  assert.deepEqual(created.payload.parts, []);
  const { uploadId } = created.payload;

  for (const partNumber of [1, 2, 3]) {
    const part = await putPart(uploadId, partNumber, slicePart(bytes, partNumber), "uploader-token");
    assert.equal(part.status, 200, part.text);
    assert.equal(part.payload.partNumber, partNumber);
  }
  const done = await complete(uploadId, "uploader-token");
  assert.equal(done.status, 201, done.text);
  assert.equal(done.payload.key, "approved/google-uploader/vid-1.mp4");
  assert.equal(done.payload.mediaType, "video");
  assert.equal(done.payload.url, `${API}/media/approved/google-uploader/vid-1.mp4`);
  assert.equal(done.payload.uploadMode, "multipart");
  assert.equal(done.payload.stream, undefined, "בלי סודות Stream אין שדה stream");

  const stored = bucket.objects.get("approved/google-uploader/vid-1.mp4");
  assert.deepEqual(stored.bytes, bytes);
  assert.equal(stored.httpMetadata.contentType, "video/mp4");
  assert.equal(stored.customMetadata.ownerUid, "google-uploader");
  assert.equal(stored.customMetadata.uploadMode, "multipart");
  assert.equal(database.database.prepare("SELECT COUNT(*) AS n FROM upload_session_parts").get().n, 0, "החלקים נשכחים אחרי ההשלמה");
  assert.equal(streamCalls.length, 0, "בלי הסודות אין שום קריאה ל-Stream");
});

test("המשך אחרי ניתוק: status מחזיר את החלקים שהתקבלו, ושליחה חוזרת של חלק מחליפה אותו", async () => {
  const bytes = fileBytes();
  const { uploadId } = (await startUpload()).payload;
  assert.equal((await putPart(uploadId, 1, slicePart(bytes, 1), "uploader-token")).status, 200);

  // "רענון": הלקוח שואל מה כבר התקבל.
  const status = await getJson(`/upload/multipart/status?uploadId=${encodeURIComponent(uploadId)}`, "uploader-token");
  assert.equal(status.status, 200, status.text);
  assert.deepEqual(status.payload.parts.map(part => part.partNumber), [1]);
  assert.equal(status.payload.totalParts, 3);
  assert.equal(status.payload.status, "uploading");

  // השלמה לפני שכל החלקים הגיעו נדחית ב-409 שאפשר לנסות שוב.
  const early = await complete(uploadId, "uploader-token");
  assert.equal(early.status, 409);
  assert.equal(early.payload.code, "upload_incomplete");

  // חלק 2 נשלח פעמיים (הראשון "אבד" ברשת): השני מחליף.
  assert.equal((await putPart(uploadId, 2, slicePart(bytes, 2), "uploader-token")).status, 200);
  assert.equal((await putPart(uploadId, 2, slicePart(bytes, 2), "uploader-token")).status, 200);
  assert.equal((await putPart(uploadId, 3, slicePart(bytes, 3), "uploader-token")).status, 200);
  const done = await complete(uploadId, "uploader-token");
  assert.equal(done.status, 201, done.text);
  assert.deepEqual(bucket.objects.get("approved/google-uploader/vid-1.mp4").bytes, bytes);

  // השלמה חוזרת (התשובה אבדה) מחזירה את אותה תשובה בלי לגעת שוב ב-R2.
  const again = await complete(uploadId, "uploader-token");
  assert.equal(again.status, 200, again.text);
  assert.equal(again.payload.key, done.payload.key);
  const afterStatus = await getJson(`/upload/multipart/status?uploadId=${encodeURIComponent(uploadId)}`, "uploader-token");
  assert.equal(afterStatus.payload.status, "completed");
});

test("חלק בגודל שגוי, מספר חלק מחוץ לתחום, וסוג או גודל לא מותרים — נדחים", async () => {
  const { uploadId } = (await startUpload()).payload;
  const wrongSize = await putPart(uploadId, 1, new Uint8Array(PART - 1), "uploader-token");
  assert.equal(wrongSize.status, 400);
  assert.equal(wrongSize.payload.code, "part_size_mismatch");
  const lastWrong = await putPart(uploadId, 3, new Uint8Array(999), "uploader-token");
  assert.equal(lastWrong.payload.code, "part_size_mismatch");
  const outOfRange = await putPart(uploadId, 4, new Uint8Array(10), "uploader-token");
  assert.equal(outOfRange.status, 400);
  assert.equal(outOfRange.payload.code, "invalid_part_number");

  const badType = await startUpload("uploader-token", { mimeType: "application/zip" });
  assert.equal(badType.status, 415);
  const tooBig = await startUpload("uploader-token", { size: 1024 * 1024 * 1024 + 1 });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.payload.code, "file_too_large");
  const imageTooBig = await startUpload("uploader-token", { mimeType: "image/jpeg", size: 50 * 1024 * 1024 + 1 });
  assert.equal(imageTooBig.status, 413);
});

test("הרשאות: בלי התחברות 401, צופה מעלה ל-pending/, ומשתמש אחר אינו יכול להמשיך, להשלים או לבטל", async () => {
  assert.equal((await startUpload("")).status, 401);

  const viewer = await startUpload("viewer-token", { imageId: "vid-pending" });
  assert.equal(viewer.status, 201, viewer.text);
  assert.equal(viewer.payload.key, "pending/google-viewer/vid-pending.mp4");
  assert.equal(viewer.payload.state, "pending");
  const { uploadId } = viewer.payload;

  const foreignPart = await putPart(uploadId, 1, slicePart(fileBytes(), 1), "viewer2-token");
  assert.equal(foreignPart.status, 403);
  assert.equal((await getJson(`/upload/multipart/status?uploadId=${encodeURIComponent(uploadId)}`, "admin-token")).status, 403);
  assert.equal((await complete(uploadId, "viewer2-token")).status, 403);
  assert.equal((await postJson("/upload/multipart/abort", { uploadId }, "viewer2-token")).status, 403);

  const missing = await getJson("/upload/multipart/status?uploadId=nope", "viewer-token");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.code, "upload_session_not_found");
});

test("ביטול מוחק את ההעלאה ב-R2 ובמסד; ביטול חוזר מצליח בלי לעשות דבר", async () => {
  const { uploadId } = (await startUpload()).payload;
  assert.equal((await putPart(uploadId, 1, slicePart(fileBytes(), 1), "uploader-token")).status, 200);
  const aborted = await postJson("/upload/multipart/abort", { uploadId }, "uploader-token");
  assert.equal(aborted.status, 200, aborted.text);
  assert.equal(aborted.payload.aborted, true);
  assert.equal(bucket.uploads.get(uploadId).state, "aborted");
  assert.equal(database.database.prepare("SELECT COUNT(*) AS n FROM upload_sessions").get().n, 0);
  assert.equal(database.database.prepare("SELECT COUNT(*) AS n FROM upload_session_parts").get().n, 0);
  const again = await postJson("/upload/multipart/abort", { uploadId }, "uploader-token");
  assert.equal(again.status, 200);
  assert.equal(again.payload.aborted, false);
  assert.equal((await getJson(`/upload/multipart/status?uploadId=${encodeURIComponent(uploadId)}`, "uploader-token")).status, 404);
});

test("העלאה נטושה ישנה מנוקה כשאותו משתמש פותח העלאה חדשה", async () => {
  const { uploadId } = (await startUpload()).payload;
  database.database.prepare("UPDATE upload_sessions SET updated_at = ?").run(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const fresh = await startUpload("uploader-token", { imageId: "vid-2" });
  assert.equal(fresh.status, 201);
  assert.equal(bucket.uploads.get(uploadId).state, "aborted");
  assert.deepEqual(database.database.prepare("SELECT upload_id FROM upload_sessions").all().map(row => row.upload_id), [fresh.payload.uploadId]);
});

test("השלמה עם תצוגות מקדימות ותאריך צילום: התצוגות נשמרות, והתאריך במטא-דאטה", async () => {
  const bytes = fileBytes();
  const { uploadId } = (await startUpload("uploader-token", { imageId: "vid-3", capturedAt: "2025-10-14T19:05:00" })).payload;
  for (const partNumber of [1, 2, 3]) await putPart(uploadId, partNumber, slicePart(bytes, partNumber), "uploader-token");
  const done = await complete(uploadId, "uploader-token", plainEnv, {
    variant_poster: new File([new Uint8Array(900).fill(2)], "poster.webp", { type: "image/webp" }),
    variantsMeta: JSON.stringify({ poster: { width: 1280, height: 720 } })
  });
  assert.equal(done.status, 201, done.text);
  assert.equal(done.payload.variants.poster.key, "variants/vid-3/poster.webp");
  assert.equal(done.payload.variants.poster.width, 1280);
  assert.ok(bucket.objects.has("variants/vid-3/poster.webp"));
  assert.equal(bucket.objects.get("approved/google-uploader/vid-3.mp4").customMetadata.capturedAt, "2025-10-14T19:05:00");
});

test("העלאה רגילה (בקשה אחת) שומרת את תאריך הצילום ומתעלמת מתאריך פגום", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(500).fill(4)], "a.jpg", { type: "image/jpeg" }));
  form.append("imageId", "img-date");
  form.append("capturedAt", "2024-05-12T18:30:05");
  const ok = await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: form }));
  assert.equal(ok.status, 201, ok.text);
  assert.equal(bucket.objects.get("approved/google-uploader/img-date.jpg").customMetadata.capturedAt, "2024-05-12T18:30:05");

  const bad = new FormData();
  bad.append("file", new File([new Uint8Array(500).fill(4)], "b.jpg", { type: "image/jpeg" }));
  bad.append("imageId", "img-bad-date");
  bad.append("capturedAt", "<script>");
  assert.equal((await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: bad }))).status, 201);
  assert.equal(bucket.objects.get("approved/google-uploader/img-bad-date.jpg").customMetadata.capturedAt, undefined);
});

// --- Cloudflare Stream (רשות) ---

test("בלי סודות Stream: /health מדווח כבוי, וסרטון מאושר אינו נשלח לשום מקום", async () => {
  const health = await getJson("/health", "");
  assert.equal(health.payload.streamEnabled, false);
  assert.ok(health.payload.features.includes("resumable-uploads"));
  assert.ok(!health.payload.features.includes("cloudflare-stream"));

  const form = new FormData();
  form.append("file", new File([new Uint8Array(2000)], "v.mp4", { type: "video/mp4" }));
  form.append("imageId", "vid-plain");
  const upload = await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: form }));
  assert.equal(upload.status, 201, upload.text);
  assert.equal(upload.payload.stream, undefined);
  assert.equal(streamCalls.length, 0);
});

test("עם סודות Stream: סרטון מאושר נשלח בהעתקה מכתובת המדיה, והתשובה נושאת את כתובות ה-HLS", async () => {
  const health = await getJson("/health", "", streamEnv);
  assert.equal(health.payload.streamEnabled, true);
  assert.ok(health.payload.features.includes("cloudflare-stream"));

  const form = new FormData();
  form.append("file", new File([new Uint8Array(2000)], "v.mp4", { type: "video/mp4" }));
  form.append("imageId", "vid-stream");
  form.append("title", "הקפות");
  const upload = await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: form }), streamEnv);
  assert.equal(upload.status, 201, upload.text);
  assert.deepEqual(upload.payload.stream, {
    uid: "abc123def",
    hls: "https://customer-xyz.cloudflarestream.com/abc123def/manifest/video.m3u8",
    iframe: "https://customer-xyz.cloudflarestream.com/abc123def/iframe"
  });
  assert.equal(streamCalls.length, 1);
  const [copy] = streamCalls;
  assert.equal(copy.url, "https://api.cloudflare.com/client/v4/accounts/acct123/stream/copy");
  assert.equal(copy.method, "POST");
  assert.equal(copy.headers.Authorization, "Bearer stream-secret");
  assert.equal(copy.body.url, `${API}/media/approved/google-uploader/vid-stream.mp4`);
  assert.equal(copy.body.meta.imageId, "vid-stream");
  assert.equal(database.database.prepare("SELECT stream_uid FROM stream_videos WHERE image_id = 'vid-stream'").get().stream_uid, "abc123def");

  // תמונה אינה נשלחת ל-Stream.
  const image = new FormData();
  image.append("file", new File([new Uint8Array(500)], "a.jpg", { type: "image/jpeg" }));
  image.append("imageId", "img-no-stream");
  await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: image }), streamEnv);
  assert.equal(streamCalls.length, 1);

  // מחיקת הסרטון מוחקת גם את העותק ב-Stream.
  const removed = await call(new Request(`${API}/media/approved/google-uploader/vid-stream.mp4`, { method: "DELETE", headers: headersFor("super-token") }), streamEnv);
  assert.equal(removed.status, 200, removed.text);
  assert.equal(streamCalls.at(-1).method, "DELETE");
  assert.equal(streamCalls.at(-1).url, "https://api.cloudflare.com/client/v4/accounts/acct123/stream/abc123def");
  assert.equal(database.database.prepare("SELECT COUNT(*) AS n FROM stream_videos").get().n, 0);
});

test("עם סודות Stream: סרטון ממתין נשלח רק באישור, וכשל של Stream אינו מכשיל דבר", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(2000)], "v.mp4", { type: "video/mp4" }));
  form.append("imageId", "vid-wait");
  const upload = await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("viewer-token"), body: form }), streamEnv);
  assert.equal(upload.status, 201, upload.text);
  assert.equal(upload.payload.state, "pending");
  assert.equal(upload.payload.stream, undefined);
  assert.equal(streamCalls.length, 0, "סרטון ממתין אינו יוצא מהגלריה לפני האישור");

  const approve = await postJson("/approve", { key: upload.payload.key }, "admin-token", streamEnv);
  assert.equal(approve.status, 200, approve.text);
  assert.equal(approve.payload.stream.uid, "abc123def");
  assert.equal(streamCalls[0].body.url, `${API}/media/approved/google-viewer/vid-wait.mp4`);

  // Stream מחזיר שגיאה: ההעלאה עדיין מצליחה, בלי שדה stream.
  const previous = streamResponse;
  streamResponse = () => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 });
  try {
    const failing = new FormData();
    failing.append("file", new File([new Uint8Array(2000)], "v.mp4", { type: "video/mp4" }));
    failing.append("imageId", "vid-stream-down");
    const result = await call(new Request(`${API}/upload`, { method: "POST", headers: headersFor("uploader-token"), body: failing }), streamEnv);
    assert.equal(result.status, 201, result.text);
    assert.equal(result.payload.stream, undefined);
    assert.ok(bucket.objects.has("approved/google-uploader/vid-stream-down.mp4"));
  } finally {
    streamResponse = previous;
  }
});

test("עם סודות Stream: השלמת העלאה בחלקים של סרטון שולחת אותו ל-Stream", async () => {
  const bytes = fileBytes();
  const { uploadId } = (await startUpload("uploader-token", { imageId: "vid-big" }, streamEnv)).payload;
  for (const partNumber of [1, 2, 3]) await putPart(uploadId, partNumber, slicePart(bytes, partNumber), "uploader-token", streamEnv);
  const done = await complete(uploadId, "uploader-token", streamEnv);
  assert.equal(done.status, 201, done.text);
  assert.equal(done.payload.stream.uid, "abc123def");
  assert.equal(streamCalls.length, 1);
  assert.equal(streamCalls[0].body.url, `${API}/media/approved/google-uploader/vid-big.mp4`);
});
