// בדיקות שכבת הנתונים בדפדפן (cloudflare-client.js) מול fetch מדומה:
// ETag ו-304, מעקב אחרי סמני דפדוף, סינון בשרת, מונים ורשימות מזהים.
import test from "node:test";
import assert from "node:assert/strict";

const TOKEN_KEY = "simchas_gallery_google_id_token";

function sessionToken() {
  const body = Buffer.from(JSON.stringify({
    sub: "google-user-1",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  })).toString("base64url");
  return `v1.${body}.signature`;
}

function makeStorage(map) {
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

let moduleCounter = 0;
const restoreGlobals = [];
test.afterEach(() => {
  while (restoreGlobals.length) restoreGlobals.pop()();
});

// כל בדיקה מקבלת עותק נקי של המודול, כדי שמטמון ה-ETag של בדיקה אחת לא
// ידלוף לבדיקה הבאה.
async function loadClient(fetchImpl) {
  globalThis.localStorage = makeStorage(new Map([[TOKEN_KEY, sessionToken()]]));
  globalThis.sessionStorage = makeStorage(new Map());
  globalThis.document = { readyState: "loading", addEventListener() {}, visibilityState: "visible" };
  globalThis.window = {};
  const originalFetch = globalThis.fetch;
  restoreGlobals.push(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = fetchImpl;
  moduleCounter += 1;
  return import(`./cloudflare-client.js?data=${moduleCounter}`);
}

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("apiRequest שולח If-None-Match בבקשה חוזרת ומחזיר את התשובה השמורה על 304", async () => {
  const calls = [];
  const client = await loadClient(async (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    calls.push({ url: String(url), ifNoneMatch: headers.get("If-None-Match") });
    if (headers.get("If-None-Match") === '"etag-one"') {
      return new Response(null, { status: 304, headers: { ETag: '"etag-one"' } });
    }
    return jsonResponse({ success: true, id: "image-1", data: { id: "image-1", title: "ראשונה" } }, { ETag: '"etag-one"' });
  });

  const reference = client.doc(null, "artifacts", "app", "public", "data", "images", "image-1");
  const first = await client.getDoc(reference);
  assert.equal(first.data().title, "ראשונה");
  assert.equal(calls[0].ifNoneMatch, null, "the first request has nothing to compare against");

  const second = await client.getDoc(reference);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].ifNoneMatch, '"etag-one"');
  assert.equal(second.exists(), true);
  assert.equal(second.data().title, "ראשונה", "a 304 must resolve to the cached payload");
});

test("מטמון ה-ETag תחום: אחרי 200 כתובות הישנה ביותר נשכחת", async () => {
  const seenIfNoneMatch = new Map();
  const client = await loadClient(async (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    seenIfNoneMatch.set(String(url), headers.get("If-None-Match"));
    const id = new URL(String(url)).pathname.split("/").pop();
    return jsonResponse({ success: true, id, data: { id } }, { ETag: `"etag-${id}"` });
  });
  const reference = id => client.doc(null, "artifacts", "app", "public", "data", "images", id);
  for (let index = 0; index < 201; index += 1) await client.getDoc(reference(`image-${index}`));
  await client.getDoc(reference("image-0"));
  assert.equal(seenIfNoneMatch.get("https://simchas-gallery-api.0534169095.workers.dev/data/images/image-0"), null, "image-0 was evicted and must be fetched plainly");
  await client.getDoc(reference("image-200"));
  assert.equal(seenIfNoneMatch.get("https://simchas-gallery-api.0534169095.workers.dev/data/images/image-200"), '"etag-image-200"');
});

test("getDocs עוקב אחרי nextCursor עד שהוא null, בלי OFFSET", async () => {
  const requested = [];
  const client = await loadClient(async url => {
    const parsed = new URL(String(url));
    requested.push(parsed);
    const after = parsed.searchParams.get("after");
    if (!after) {
      return jsonResponse({ success: true, documents: [{ id: "a", data: { id: "a" } }, { id: "b", data: { id: "b" } }], hasMore: true, nextCursor: "cursor-1" });
    }
    if (after === "cursor-1") {
      return jsonResponse({ success: true, documents: [{ id: "c", data: { id: "c" } }, { id: "b", data: { id: "b" } }], hasMore: true, nextCursor: "cursor-2" });
    }
    return jsonResponse({ success: true, documents: [{ id: "d", data: { id: "d" } }], hasMore: false, nextCursor: null });
  });

  const snapshot = await client.getDocs(client.query(
    client.collection(null, "artifacts", "app", "public", "data", "images"),
    client.orderBy("createdAt", "desc")
  ));
  assert.deepEqual(snapshot.docs.map(item => item.id), ["a", "b", "c", "d"], "duplicates across pages stay filtered");
  assert.equal(requested.length, 3);
  assert.deepEqual(requested.map(url => url.searchParams.get("after")), [null, "cursor-1", "cursor-2"]);
  assert.ok(requested.every(url => !url.searchParams.has("offset")));
  assert.equal(requested[0].searchParams.get("orderBy"), "createdAt");
  assert.equal(requested[0].searchParams.get("direction"), "desc");
});

test("getDocs ממשיך ב-OFFSET מול Worker ישן שאינו מחזיר סמן", async () => {
  const offsets = [];
  const client = await loadClient(async url => {
    const parsed = new URL(String(url));
    offsets.push(parsed.searchParams.get("offset"));
    const offset = Number(parsed.searchParams.get("offset") || 0);
    return jsonResponse(offset === 0
      ? { success: true, documents: [{ id: "a", data: {} }, { id: "b", data: {} }], hasMore: true }
      : { success: true, documents: [{ id: "c", data: {} }], hasMore: false });
  });
  const snapshot = await client.getDocs(client.collection(null, "artifacts", "app", "public", "data", "images"));
  assert.deepEqual(snapshot.docs.map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(offsets, [null, "2"]);
});

test("where על שדה נתמך הופך לפרמטר סינון בשרת, ו-getDocsPage מבקש עמוד אחד", async () => {
  const requested = [];
  const client = await loadClient(async url => {
    requested.push(new URL(String(url)));
    return jsonResponse({ success: true, documents: [{ id: "x", data: { id: "x", folderId: "folder-7" } }], hasMore: true, nextCursor: "next" });
  });
  const page = await client.getDocsPage(client.query(
    client.collection(null, "artifacts", "app", "public", "data", "images"),
    client.where("folderId", "==", "folder-7"),
    client.orderBy("createdAt", "desc"),
    client.limit(120)
  ));
  assert.equal(requested.length, 1);
  assert.equal(requested[0].pathname, "/data/images");
  assert.equal(requested[0].searchParams.get("folderId"), "folder-7");
  assert.equal(requested[0].searchParams.get("limit"), "120");
  assert.equal(requested[0].searchParams.has("where"), false);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "next");
  assert.deepEqual(page.docs.map(item => item.id), ["x"]);

  const next = await client.getDocsPage(client.query(
    client.collection(null, "artifacts", "app", "public", "data", "images"),
    client.where("folderId", "==", "folder-7"),
    client.orderBy("createdAt", "desc")
  ), { after: "next", pageSize: 50 });
  assert.equal(requested[1].searchParams.get("after"), "next");
  assert.equal(requested[1].searchParams.get("limit"), "50");
  assert.equal(next.size, 1);
});

test("getCount ו-getCounts פונים לנקודות הקצה של המונים", async () => {
  const requested = [];
  const client = await loadClient(async url => {
    const parsed = new URL(String(url));
    requested.push(parsed);
    if (parsed.pathname.endsWith("/count")) return jsonResponse({ success: true, count: 42 });
    return jsonResponse({ success: true, by: "folderId", total: 7, counts: { "1": 3, "folder-x": 4 } });
  });
  const images = client.collection(null, "artifacts", "app", "public", "data", "images");
  assert.equal(await client.getCount(client.query(images, client.where("folderId", "==", "1"), client.orderBy("createdAt", "desc"))), 42);
  assert.equal(requested[0].pathname, "/data/images/count");
  assert.equal(requested[0].searchParams.get("folderId"), "1");
  assert.equal(requested[0].searchParams.has("orderBy"), false, "ordering is meaningless for a count");

  const counts = await client.getCounts(images, "folderId");
  assert.equal(requested[1].pathname, "/data/images/counts");
  assert.equal(requested[1].searchParams.get("by"), "folderId");
  assert.deepEqual(counts, { total: 7, counts: { "1": 3, "folder-x": 4 } });
});

test("getDocsByIds שולח את המזהים בקבוצות של 100", async () => {
  const requested = [];
  const client = await loadClient(async url => {
    const parsed = new URL(String(url));
    requested.push(parsed);
    const ids = parsed.searchParams.get("ids").split(",");
    return jsonResponse({ success: true, documents: ids.map(id => ({ id, data: { id } })), hasMore: false, nextCursor: null });
  });
  const ids = Array.from({ length: 150 }, (_, index) => `media-${index}`);
  const snapshot = await client.getDocsByIds(client.collection(null, "artifacts", "app", "public", "data", "images"), [...ids, "media-0"]);
  assert.equal(snapshot.size, 150);
  assert.equal(requested.length, 2);
  assert.equal(requested[0].searchParams.get("ids").split(",").length, 100);
  assert.equal(requested[1].searchParams.get("ids").split(",").length, 50);
  assert.equal(requested[0].searchParams.get("limit"), "100");
});
