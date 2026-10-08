// בדיקות שכבת הנתונים של ה-Worker: סינון לפי תיקייה, מונים, דפדוף בסמנים,
// ETag/304 ומטמון הקצה. המסד כאן הוא SQLite אמיתי בזיכרון, כך שכל
// שאילתה — כולל השוואת הצמד של הסמן וה-CAST של json_extract — רצה בפועל
// ולא מול חיקוי.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./cloudflare-worker.js";

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
    this.database.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: 1 } };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.queries = [];
  }
  prepare(sql) {
    this.queries.push(sql);
    return new SqliteD1Statement(this.database, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  // כמה שאילתות רשימה או ספירה באמת הגיעו ל-D1 — המדד להצלחת המטמון.
  listQueryCount() {
    return this.queries.filter(sql => /FROM gallery_documents/.test(sql) && /(ORDER BY|COUNT\(\*\))/.test(sql)).length;
  }
}

// חיקוי של Cache API: שומר גוף וכותרות, ומחזיר Response חדש בכל פגיעה.
class MockCache {
  constructor() {
    this.entries = new Map();
    this.puts = [];
  }
  static keyOf(key) {
    return typeof key === "string" ? key : key.url;
  }
  async match(key) {
    const entry = this.entries.get(MockCache.keyOf(key));
    return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
  }
  async put(key, response) {
    const url = MockCache.keyOf(key);
    this.puts.push(url);
    this.entries.set(url, { body: await response.text(), headers: [...response.headers.entries()] });
  }
}

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "viewer2-token": { sub: "google-viewer-2", email: "viewer2@example.com", name: "Viewer Two" },
  "uploader-token": { sub: "google-uploader", email: "uploader@example.com", name: "Uploader" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" },
  "pending-token": { sub: "google-pending", email: "pending@example.com", name: "Pending" }
};

const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      const token = decodeURIComponent(new URL(href).searchParams.get("id_token") || "");
      const account = ACCOUNTS[token];
      if (!account) return new Response("invalid", { status: 400 });
      return Response.json({
        ...account,
        email_verified: "true",
        aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com"
      });
    }
    return new Response("not mocked", { status: 500 });
  };
});
test.after(() => { globalThis.fetch = originalFetch; });

const deletedObjectKeys = [];
function environment(database) {
  return {
    GALLERY_DB: database,
    GALLERY_BUCKET: {
      async list() { return { objects: [] }; },
      async head() { return null; },
      async get(key) {
        return key.startsWith("pending/")
          ? { body: "data", httpMetadata: {}, customMetadata: {} }
          : null;
      },
      async put() { return {}; },
      async delete(key) { deletedObjectKeys.push(key); }
    }
  };
}

function apiRequest(path, method = "GET", body, token = "viewer-token", headers = {}) {
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

function seedProfile(database, uid, email, status, role) {
  database.database.prepare(
    "INSERT OR REPLACE INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES ('userProfiles', ?, ?, ?, ?, ?)"
  ).run(uid, JSON.stringify({ uid, email, status, role }), uid, Date.now(), Date.now());
}

const GALLERY_SIZE = 1500;
const FOLDER_COUNT = 7;

function seedGallery(database, count = GALLERY_SIZE) {
  const insert = database.database.prepare(
    "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES ('images', ?, ?, 'google-admin', 1, 1)"
  );
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `image-${String(index).padStart(5, "0")}`;
    ids.push(id);
    insert.run(id, JSON.stringify({
      id,
      folderId: `folder-${index % FOLDER_COUNT}`,
      title: `תמונה ${index}`,
      // ערכים חוזרים בכוונה: זה בדיוק המצב שבו דפדוף ללא שובר־שוויון נשבר.
      createdAt: 1_700_000_000_000 + Math.floor(index / 100)
    }));
  }
  return ids;
}

// ה-Worker זוכר שהסכימה כבר נוצרה (דגל ברמת המודול), ולכן מסד אחד משרת
// את כל הבדיקות: הקריאה הראשונה ל-/health יוצרת את הטבלאות, וכל בדיקה
// מתחילה ממסד ריק ומזריעה אותו מחדש.
const sharedDatabase = new SqliteD1();
test.before(async () => {
  const health = await worker.fetch(apiRequest("/health", "GET", undefined, ""), environment(sharedDatabase));
  assert.equal(health.status, 200);
});

async function freshDatabase({ gallery = true } = {}) {
  const database = sharedDatabase;
  for (const table of ["gallery_documents", "gallery_schema_meta", "request_rate_limits", "user_email_index", "face_people", "image_face_descriptors", "image_face_index_state"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile(database, "google-viewer", "viewer@example.com", "approved", "viewer");
  seedProfile(database, "google-viewer-2", "viewer2@example.com", "approved", "viewer");
  seedProfile(database, "google-uploader", "uploader@example.com", "approved", "uploader");
  seedProfile(database, "google-admin", "admin@example.com", "approved", "admin");
  seedProfile(database, "google-super", "super@example.com", "approved", "super_admin");
  seedProfile(database, "google-pending", "pending@example.com", "pending", "viewer");
  const ids = gallery ? seedGallery(database) : [];
  database.queries.length = 0;
  return { database, ids };
}

async function readJson(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus, `unexpected status ${response.status}`);
  return response.json();
}

test.beforeEach(() => {
  deletedObjectKeys.length = 0;
  delete globalThis.caches;
});

test("folderId filter is applied in SQL and returns only that folder", async () => {
  const { database } = await freshDatabase();
  const payload = await readJson(await worker.fetch(
    apiRequest("/data/images?folderId=folder-3&orderBy=createdAt&direction=desc&limit=1000"), environment(database)
  ));
  assert.equal(payload.documents.length, Math.ceil((GALLERY_SIZE - 3) / FOLDER_COUNT));
  assert.ok(payload.documents.every(item => item.data.folderId === "folder-3"));
  assert.equal(payload.hasMore, false);
  assert.equal(payload.nextCursor, null);
  // הסינון רץ במסד ולא בזיכרון: השאילתה עצמה מכילה את התנאי.
  assert.ok(database.queries.some(sql => /json_extract\(data_json, '\$\.folderId'\) AS TEXT\) = \?/.test(sql)));
});

test("a folderId stored as a number still matches the text value from the URL", async () => {
  const { database } = await freshDatabase({ gallery: false });
  database.database.prepare(
    "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES ('images', 'legacy-1', ?, 'x', 1, 1)"
  ).run(JSON.stringify({ id: "legacy-1", folderId: 4, createdAt: 5 }));
  const payload = await readJson(await worker.fetch(apiRequest("/data/images?folderId=4"), environment(database)));
  assert.deepEqual(payload.documents.map(item => item.id), ["legacy-1"]);
});

test("the count endpoint returns a filtered count without the documents", async () => {
  const { database } = await freshDatabase();
  const all = await readJson(await worker.fetch(apiRequest("/data/images/count"), environment(database)));
  assert.equal(all.count, GALLERY_SIZE);
  assert.equal("documents" in all, false);
  const folder = await readJson(await worker.fetch(apiRequest("/data/images/count?folderId=folder-0"), environment(database)));
  assert.equal(folder.count, Math.ceil(GALLERY_SIZE / FOLDER_COUNT));
});

test("the counts endpoint groups by folderId in a single query", async () => {
  const { database } = await freshDatabase();
  const payload = await readJson(await worker.fetch(apiRequest("/data/images/counts?by=folderId"), environment(database)));
  assert.equal(payload.by, "folderId");
  assert.equal(payload.total, GALLERY_SIZE);
  assert.equal(Object.keys(payload.counts).length, FOLDER_COUNT);
  assert.equal(Object.values(payload.counts).reduce((sum, value) => sum + value, 0), GALLERY_SIZE);
  assert.equal(payload.counts["folder-0"], Math.ceil(GALLERY_SIZE / FOLDER_COUNT));
  assert.equal(database.listQueryCount(), 1);

  const rejected = await worker.fetch(apiRequest("/data/images/counts?by=title"), environment(database));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "invalid_group_field");
});

async function walkWithCursors(database, query, token = "viewer-token") {
  const pages = [];
  let after = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const url = `/data/images?${query}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const payload = await readJson(await worker.fetch(apiRequest(url, "GET", undefined, token), environment(database)));
    pages.push(payload);
    if (!payload.hasMore) {
      assert.equal(payload.nextCursor, null, "the last page must end with a null cursor");
      break;
    }
    assert.equal(typeof payload.nextCursor, "string");
    after = payload.nextCursor;
  }
  return pages;
}

test("cursor paging returns every row of a 1500 row gallery exactly once", async () => {
  const { database, ids } = await freshDatabase();
  const pages = await walkWithCursors(database, "orderBy=createdAt&direction=desc&limit=100");
  assert.equal(pages.length, 15);
  const seen = pages.flatMap(page => page.documents.map(item => item.id));
  assert.equal(seen.length, GALLERY_SIZE);
  assert.equal(new Set(seen).size, GALLERY_SIZE);
  assert.deepEqual([...seen].sort(), [...ids].sort());
  // הסדר נשמר בין העמודים: createdAt יורד, ובתוך ערך שווה — מזהה עולה.
  const ordered = pages.flatMap(page => page.documents.map(item => [item.data.createdAt, item.id]));
  for (let index = 1; index < ordered.length; index += 1) {
    const [previousTime, previousId] = ordered[index - 1];
    const [time, id] = ordered[index];
    assert.ok(time < previousTime || (time === previousTime && id > previousId), `order broke at ${index}`);
  }
  // הסמן הוא JSON ב-base64url של ערך המיון והמזהה האחרונים.
  const cursor = JSON.parse(Buffer.from(pages[0].nextCursor, "base64url").toString("utf8"));
  assert.equal(cursor.id, pages[0].documents.at(-1).id);
  assert.equal(cursor.v, pages[0].documents.at(-1).data.createdAt);
  // השאילתה משווה צמד (ערך, מזהה) כ-OR מפורש, לא בהשוואת שורות.
  assert.ok(database.queries.some(sql => /< \? OR \(CAST\(.*\) = \? AND document_id > \?\)\)/.test(sql)));
});

test("cursor paging also works ascending and together with a folder filter", async () => {
  const { database } = await freshDatabase();
  const ascending = await walkWithCursors(database, "orderBy=createdAt&direction=asc&limit=400");
  const seenAscending = ascending.flatMap(page => page.documents.map(item => item.id));
  assert.equal(new Set(seenAscending).size, GALLERY_SIZE);
  assert.equal(seenAscending[0], "image-00000");

  const filtered = await walkWithCursors(database, "orderBy=createdAt&direction=desc&limit=50&folderId=folder-5");
  const seenFiltered = filtered.flatMap(page => page.documents.map(item => item.id));
  assert.equal(seenFiltered.length, Math.ceil((GALLERY_SIZE - 5) / FOLDER_COUNT));
  assert.equal(new Set(seenFiltered).size, seenFiltered.length);
  assert.ok(filtered.flatMap(page => page.documents).every(item => item.data.folderId === "folder-5"));
});

test("offset paging keeps working for older clients, and a bad cursor is rejected", async () => {
  const { database } = await freshDatabase();
  const second = await readJson(await worker.fetch(
    apiRequest("/data/images?orderBy=createdAt&direction=desc&limit=1000&offset=1000"), environment(database)
  ));
  assert.equal(second.documents.length, GALLERY_SIZE - 1000);
  assert.equal(second.offset, 1000);
  assert.equal(second.hasMore, false);

  const broken = await worker.fetch(apiRequest("/data/images?after=not-a-cursor"), environment(database));
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).code, "invalid_cursor");
});

test("the ids filter returns the requested documents only, and refuses oversized lists", async () => {
  const { database } = await freshDatabase();
  const payload = await readJson(await worker.fetch(
    apiRequest("/data/images?ids=image-00007,image-00123,missing-id,image-00007"), environment(database)
  ));
  assert.deepEqual(payload.documents.map(item => item.id).sort(), ["image-00007", "image-00123"]);

  const tooMany = Array.from({ length: 201 }, (_, index) => `image-${String(index).padStart(5, "0")}`).join(",");
  const rejected = await worker.fetch(apiRequest(`/data/images?ids=${tooMany}`), environment(database));
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "too_many_ids");
});

test("every data GET carries a strong ETag and answers 304 to a matching If-None-Match", async () => {
  const { database } = await freshDatabase();
  for (const path of ["/data/images?limit=5", "/data/images/count", "/data/images/counts", "/data/images/image-00001"]) {
    const first = await worker.fetch(apiRequest(path), environment(database));
    assert.equal(first.status, 200, path);
    const etag = first.headers.get("ETag");
    assert.match(etag, /^"[A-Za-z0-9_-]{22}"$/, `${path} must carry a strong 22 character ETag`);
    assert.equal(first.headers.get("Access-Control-Expose-Headers"), "ETag");
    assert.equal(first.headers.get("Cache-Control"), "no-store");

    const conditional = await worker.fetch(apiRequest(path, "GET", undefined, "viewer-token", { "If-None-Match": etag }), environment(database));
    assert.equal(conditional.status, 304, path);
    assert.equal(conditional.headers.get("ETag"), etag);
    assert.equal(conditional.headers.get("Access-Control-Allow-Origin"), "https://shmuel-lamed.github.io");
    assert.equal(await conditional.text(), "");

    const stale = await worker.fetch(apiRequest(path, "GET", undefined, "viewer-token", { "If-None-Match": '"someOtherEtag000000000"' }), environment(database));
    assert.equal(stale.status, 200, path);
  }
  // הכותרת המותנית חייבת להיות מותרת ב-preflight, אחרת הדפדפן לא ישלח אותה.
  const preflight = await worker.fetch(new Request("https://simchas-gallery-api.example/data/images", {
    method: "OPTIONS",
    headers: { Origin: "https://shmuel-lamed.github.io" }
  }), environment(database));
  assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /If-None-Match/);
});

test("list responses are served from the edge cache with a key that excludes the user and includes the data version", async () => {
  const cache = new MockCache();
  globalThis.caches = { default: cache };
  const { database } = await freshDatabase();

  const first = await readJson(await worker.fetch(apiRequest("/data/images?folderId=folder-1&limit=10"), environment(database)));
  assert.equal(database.listQueryCount(), 1);
  assert.equal(cache.puts.length, 1);
  const key = cache.puts[0];
  assert.ok(key.startsWith("https://simchas-gallery-api.example/__data-cache/images/list?"), key);
  assert.ok(!key.includes("google-viewer"), "the cache key must never contain the user id");
  assert.ok(!key.includes("viewer@example.com"), "the cache key must never contain the user email");
  assert.match(key, /&p=approved-viewer$/);
  assert.match(key, /folderId=folder-1/);
  assert.match(key, /&v=\d+&p=/);
  // העותק במטמון: s-maxage בלבד, בלי כותרות CORS שתלויות במקור הבקשה.
  const stored = cache.entries.get(key);
  const storedHeaders = new Headers(stored.headers);
  assert.equal(storedHeaders.get("Cache-Control"), "s-maxage=300");
  assert.equal(storedHeaders.has("Access-Control-Allow-Origin"), false);
  assert.match(storedHeaders.get("ETag"), /^"[A-Za-z0-9_-]{22}"$/);

  // משתמש אחר מאותה מחלקת הרשאה פוגע באותו עותק; D1 אינו נשאל שוב.
  const second = await worker.fetch(apiRequest("/data/images?limit=10&folderId=folder-1", "GET", undefined, "viewer2-token"), environment(database));
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).documents, first.documents);
  assert.equal(database.listQueryCount(), 1, "the second list must come from the edge cache");
  assert.equal(second.headers.get("Cache-Control"), "no-store");
  assert.equal(second.headers.get("Access-Control-Allow-Origin"), "https://shmuel-lamed.github.io");

  // 304 מתוך המטמון: ה-ETag של העותק השמור משמש להשוואה.
  const conditional = await worker.fetch(
    apiRequest("/data/images?folderId=folder-1&limit=10", "GET", undefined, "viewer2-token", { "If-None-Match": storedHeaders.get("ETag") }),
    environment(database)
  );
  assert.equal(conditional.status, 304);
  assert.equal(database.listQueryCount(), 1);

  // מנהל מקבל מפתח משלו (מחלקת הרשאה אחרת), בלי מזהה משתמש.
  await worker.fetch(apiRequest("/data/images?folderId=folder-1&limit=10", "GET", undefined, "admin-token"), environment(database));
  assert.equal(cache.puts.length, 2);
  assert.match(cache.puts[1], /&p=admin$/);
  assert.ok(!cache.puts[1].includes("google-admin"));
});

test("a write bumps the collection version and invalidates the cached list immediately", async () => {
  const cache = new MockCache();
  globalThis.caches = { default: cache };
  const { database } = await freshDatabase();

  await readJson(await worker.fetch(apiRequest("/data/images?folderId=folder-2&limit=5"), environment(database)));
  const firstKey = cache.puts[0];
  const firstVersion = Number(/&v=(\d+)&/.exec(firstKey)[1]);
  assert.equal(database.listQueryCount(), 1);

  const write = await worker.fetch(apiRequest("/data/images/brand-new", "PUT", {
    data: { id: "brand-new", folderId: "folder-2", createdAt: 9_999_999_999_999, uploadedBy: "google-admin" }
  }, "admin-token"), environment(database));
  assert.equal(write.status, 200);
  const versionRow = database.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'data_version:images'").get();
  assert.ok(Number(versionRow.schema_version) > firstVersion, "the data version must grow on every write");

  const afterWrite = await readJson(await worker.fetch(apiRequest("/data/images?folderId=folder-2&limit=5"), environment(database)));
  assert.equal(afterWrite.documents[0].id, "brand-new", "the fresh list must include the new document");
  assert.equal(database.listQueryCount(), 2, "the stale cached copy must not be served after a write");
  assert.notEqual(cache.puts[1], firstKey);
  assert.ok(/&v=(\d+)&/.exec(cache.puts[1])[1] !== String(firstVersion));

  // גם מחיקה מקדמת את הגרסה.
  const versionBeforeDelete = Number(database.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'data_version:images'").get().schema_version);
  const remove = await worker.fetch(apiRequest("/data/images/brand-new", "DELETE", undefined, "super-token"), environment(database));
  assert.equal(remove.status, 200);
  const versionAfterDelete = Number(database.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'data_version:images'").get().schema_version);
  assert.ok(versionAfterDelete > versionBeforeDelete);
});

test("media routes that change the gallery bump the image versions too", async () => {
  const { database } = await freshDatabase({ gallery: false });
  const readVersion = collection => Number(
    database.database.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?").get(`data_version:${collection}`)?.schema_version || 0
  );

  const form = new FormData();
  form.set("file", new File(["x".repeat(10)], "photo.jpg", { type: "image/jpeg" }));
  form.set("imageId", "uploaded-1");
  const upload = await worker.fetch(new Request("https://simchas-gallery-api.example/upload", {
    method: "POST",
    headers: { Origin: "https://shmuel-lamed.github.io", Authorization: "Bearer viewer-token" },
    body: form
  }), environment(database));
  assert.equal(upload.status, 201);
  assert.ok(readVersion("pendingImages") > 0, "a pending upload bumps pendingImages");

  const imagesBefore = readVersion("images");
  const approve = await worker.fetch(apiRequest("/approve", "POST", { key: "pending/google-viewer/uploaded-1.jpg" }, "admin-token"), environment(database));
  assert.equal(approve.status, 200);
  assert.ok(readVersion("images") > imagesBefore, "approval bumps images");

  const imagesBeforeDelete = readVersion("images");
  const remove = await worker.fetch(apiRequest("/media/approved/google-viewer/uploaded-1.jpg", "DELETE", undefined, "super-token"), environment(database));
  assert.equal(remove.status, 200);
  assert.ok(readVersion("images") > imagesBeforeDelete, "media deletion bumps images");
});

test("permissions are unchanged: a pending user cannot list, count or filter images", async () => {
  const { database } = await freshDatabase();
  for (const path of ["/data/images", "/data/images?folderId=folder-1", "/data/images/count", "/data/images/counts", "/data/images/image-00001"]) {
    const response = await worker.fetch(apiRequest(path, "GET", undefined, "pending-token"), environment(database));
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "permission_denied");
  }
  // צופה מאושר רואה תמונות, אך לא את רשימת המשתמשים — גם לא כמונה.
  for (const path of ["/data/userProfiles", "/data/userProfiles/count", "/data/userProfiles/counts?by=status"]) {
    const response = await worker.fetch(apiRequest(path, "GET", undefined, "viewer-token"), environment(database));
    assert.equal(response.status, 403, path);
  }
  const ownProfile = await worker.fetch(apiRequest("/data/userProfiles/google-viewer", "GET", undefined, "viewer-token"), environment(database));
  assert.equal(ownProfile.status, 200);
  const superList = await worker.fetch(apiRequest("/data/userProfiles/count", "GET", undefined, "super-token"), environment(database));
  assert.equal(superList.status, 200);
  assert.equal((await superList.json()).count, 6);
  // אוספים אישיים אינם ניתנים לרישום ואינם נכנסים למטמון.
  const cache = new MockCache();
  globalThis.caches = { default: cache };
  const favorites = await worker.fetch(apiRequest("/data/userFavorites", "GET", undefined, "viewer-token"), environment(database));
  assert.equal(favorites.status, 403);
  assert.equal(cache.puts.length, 0);
});
