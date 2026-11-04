// אלבום PDF בענן (worker/album.js): POST /album/pdf ו-GET /album/file/<uid>/<token>.
// Browser Rendering מוחלף בזיוף שרושם את ה-HTML ומחזיר PDF זעיר. הבדיקות
// נועלות: רק משתמש מאושר יוצר אלבום; רק פריטים מאושרים בגלריה נכנסים; טקסט
// של משתמשים מוברח; בלי השירות — 409 album_cloud_unavailable (הדפדפן חוזר
// לחלון ההדפסה); הקישור אינו ניתן לניחוש ופג אחרי שבעה ימים.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";
import { buildAlbumHtml, albumFileName, renderAlbumPdf, serveAlbumPdf, ALBUM_TTL_MS } from "./worker/album.js";

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

class Bucket {
  constructor() { this.objects = new Map(); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, customMetadata: value.customMetadata })) };
  }
  async head(key) { return this.objects.get(key) || null; }
  async get(key) {
    const stored = this.objects.get(key);
    return stored ? { ...stored, body: stored.bytes } : null;
  }
  async put(key, bytes, options = {}) { this.objects.set(key, { bytes, customMetadata: options.customMetadata || {} }); return {}; }
  async delete(key) { this.objects.delete(key); }
}

const PDF = new TextEncoder().encode("%PDF-1.7 fake");
const rendered = [];
const database = new D1();
const sql = database.database;
const bucket = new Bucket();
const browser = { async quickAction(action, options) { rendered.push({ action, options }); return PDF; } };
const withBrowser = { GALLERY_DB: database, GALLERY_BUCKET: bucket, BROWSER: browser, PUBLIC_API_ORIGIN: "https://api.example" };
const withoutBrowser = { GALLERY_DB: database, GALLERY_BUCKET: bucket };

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" }
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
  const health = await worker.fetch(request("/health", "GET", undefined, ""), withBrowser);
  assert.equal(health.status, 200);
});
test.after(() => { globalThis.fetch = originalFetch; });

function putDocument(collection, id, data, owner = "google-admin") {
  sql.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(collection, id, JSON.stringify(data), owner);
}

test.beforeEach(() => {
  for (const table of ["gallery_documents", "request_rate_limits", "user_email_index"]) sql.exec(`DELETE FROM ${table}`);
  bucket.objects.clear();
  rendered.length = 0;
  putDocument("userProfiles", "google-viewer", { uid: "google-viewer", email: "viewer@example.com", role: "viewer", status: "approved" }, "google-viewer");
  putDocument("userProfiles", "google-pending", { uid: "google-pending", email: "pending@example.com", role: "viewer", status: "pending" }, "google-pending");
  putDocument("images", "img_1", { title: "פתיחה", url: "https://api.example/media/approved/u/img_1.jpg", createdAt: 1700000002000,
    variants: { medium: { url: "https://api.example/media/variants/img_1/medium.webp" } } });
  putDocument("images", "img_2", { title: '<img src=x onerror="alert(1)">', caption: "ריקודים", url: "https://api.example/media/approved/u/img_2.jpg", createdAt: 1700000001000 });
  putDocument("images", "img_3", { title: "לא מאובטח", url: "http://insecure.example/x.jpg", createdAt: 1700000003000 });
  putDocument("pendingImages", "img_4", { title: "ממתין", url: "https://api.example/media/pending/u/img_4.jpg" });
});

function request(path, method = "GET", body, token = "viewer-token") {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(env, path, method = "GET", body, token) {
  const response = await worker.fetch(request(path, method, body, token), env);
  return { status: response.status, payload: await response.json().catch(() => ({})), response };
}

test("יצירת אלבום: רק פריטים מאושרים ומאובטחים, לפי סדר הצילום, וקישור להורדה", async () => {
  const { status, payload } = await call(withBrowser, "/album/pdf", "POST",
    { title: "חתונת כהן", eventDate: "2025-10-15", perPage: 2, ids: ["img_1", "img_2", "img_3", "img_4", "missing"] });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.items, 2);
  assert.equal(payload.pages, 2);
  assert.equal(payload.fileName, "חתונת כהן.pdf");
  assert.match(payload.url, /^https:\/\/api\.example\/album\/file\/google-viewer\/[a-f0-9]{32}$/);

  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].action, "pdf");
  const html = rendered[0].options.html;
  assert.equal(rendered[0].options.pdfOptions.format, "a4");
  // סדר הצילום: img_2 (נוצר קודם) לפני img_1; התצוגה הבינונית במקום המקור.
  assert.ok(html.indexOf("img_2.jpg") < html.indexOf("variants/img_1/medium.webp"));
  assert.ok(!html.includes("insecure.example"));
  assert.ok(!html.includes("img_4"));
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));

  const download = await worker.fetch(request(new URL(payload.url).pathname, "GET", undefined, ""), withBrowser);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("Content-Type"), "application/pdf");
  assert.match(download.headers.get("Content-Disposition"), /attachment/);
  assert.equal(new TextDecoder().decode(new Uint8Array(await download.arrayBuffer())), "%PDF-1.7 fake");
});

test("בלי Browser Rendering בשרת: 409 album_cloud_unavailable, כדי שהדפדפן יחזור לחלון ההדפסה", async () => {
  const { status, payload } = await call(withoutBrowser, "/album/pdf", "POST", { title: "x", ids: ["img_1"] });
  assert.equal(status, 409);
  assert.equal(payload.code, "album_cloud_unavailable");
});

test("משתמש שעוד לא אושר אינו יוצר אלבום", async () => {
  const { status } = await call(withBrowser, "/album/pdf", "POST", { title: "x", ids: ["img_1"] }, "pending-token");
  assert.equal(status, 403);
  assert.equal(rendered.length, 0);
});

test("בקשה ריקה, גדולה מדי או בלי פריטים מאושרים נדחית", async () => {
  assert.equal((await call(withBrowser, "/album/pdf", "POST", { ids: [] })).status, 400);
  assert.equal((await call(withBrowser, "/album/pdf", "POST", { ids: Array.from({ length: 301 }, (_, i) => `i${i}`) })).status, 400);
  assert.equal((await call(withBrowser, "/album/pdf", "POST", { ids: ["img_4"] })).payload.code, "empty_album");
});

test("קישור לא תקין או שפג תוקפו — 404", async () => {
  assert.equal((await worker.fetch(request("/album/file/google-viewer/abc", "GET", undefined, ""), withBrowser)).status, 404);
  const token = "a".repeat(32);
  await bucket.put(`albums/google-viewer/${token}.pdf`, PDF, { customMetadata: { createdAt: "1000" } });
  await assert.rejects(serveAlbumPdf(request(`/album/file/google-viewer/${token}`), withBrowser, `/album/file/google-viewer/${token}`, 1000 + ALBUM_TTL_MS + 1),
    error => error.status === 404);
  assert.equal(bucket.objects.size, 0);
});

test("REST API: נתיב browser-run, ונפילה לנתיב הישן כשהחדש מחזיר 404; תשובה שאינה PDF נכשלת", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("/browser-run/")) return new Response("not found", { status: 404 });
    assert.equal(init.headers.Authorization, "Bearer secret");
    return new Response(PDF, { status: 200 });
  };
  const bytes = await renderAlbumPdf({ BROWSER_RENDERING_TOKEN: "secret", CF_ACCOUNT_ID: "acc" }, "<html></html>", fetchImpl);
  assert.equal(bytes[0], 0x25);
  assert.deepEqual(calls, [
    "https://api.cloudflare.com/client/v4/accounts/acc/browser-run/pdf",
    "https://api.cloudflare.com/client/v4/accounts/acc/browser-rendering/pdf"
  ]);
  await assert.rejects(renderAlbumPdf({ BROWSER: { quickAction: async () => new TextEncoder().encode("{\"error\":1}") } }, ""),
    error => error.code === "album_render_failed");
});

test("HTML ושם קובץ: טקסט מוברח ושם בלי תווים אסורים", () => {
  const html = buildAlbumHtml({ title: "<b>אירוע</b>", description: "a & b", items: [{ id: "x", src: "https://a.example/1.jpg", title: "t", caption: "", dateText: "" }], perPage: 4 });
  assert.ok(html.includes("&lt;b&gt;אירוע&lt;/b&gt;"));
  assert.ok(html.includes("a &amp; b"));
  assert.ok(html.includes('data-per-page="4"'));
  assert.equal(albumFileName('חתונה: "כהן"/לוי'), "חתונה- -כהן-לוי.pdf");
  assert.equal(albumFileName(""), "אלבום.pdf");
});
