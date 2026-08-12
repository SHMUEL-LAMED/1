import test from "node:test";
import assert from "node:assert/strict";
import worker from "./cloudflare-worker.js";

class MockD1 {
  constructor() { this.rows = new Map(); }
  key(collection, id) { return `${collection}/${id}`; }
  prepare(sql) {
    const database = this;
    let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() {
        if (sql.includes("SELECT 1 AS connected")) return { connected: 1 };
        if (sql.includes("json_extract")) {
          const email = String(bindings[0] || "").toLowerCase();
          for (const [key, row] of database.rows) {
            if (!key.startsWith("userProfiles/")) continue;
            if (String(JSON.parse(row.data_json).email || "").toLowerCase() === email) return row;
          }
          return null;
        }
        const row = database.rows.get(database.key(bindings[0], bindings[1]));
        return row ? { ...row } : null;
      },
      async all() {
        if (sql.includes("PRAGMA")) return { results: [] };
        const [collection, rowLimit, offset] = bindings;
        // מחקה את ORDER BY / LIMIT / OFFSET של D1 כדי שהדפדוף ייבדק באמת.
        const orderField = /json_extract\(data_json, '\$\.([^']+)'\)/.exec(sql)?.[1] || "updatedAt";
        const descending = /AS REAL\) DESC/.test(sql);
        const rows = [...database.rows.entries()]
          .filter(([key]) => key.startsWith(`${collection}/`))
          .map(([, row]) => ({ ...row }))
          .sort((left, right) => {
            const a = Number(JSON.parse(left.data_json)?.[orderField]) || 0;
            const b = Number(JSON.parse(right.data_json)?.[orderField]) || 0;
            if (a !== b) return descending ? b - a : a - b;
            return String(left.document_id).localeCompare(String(right.document_id));
          });
        const start = Math.max(0, Number(offset) || 0);
        const size = Number(rowLimit);
        return { results: Number.isFinite(size) ? rows.slice(start, start + size) : rows.slice(start) };
      },
      async run() {
        if (sql.trim().startsWith("INSERT INTO gallery_documents")) {
          const hasFixedCollection = sql.includes("VALUES ('userProfiles'");
          const [collection, id, dataJson, ownerUid, createdAt, updatedAt] = hasFixedCollection
            ? ["userProfiles", ...bindings]
            : bindings;
          database.rows.set(database.key(collection, id), {
            document_id: id,
            data_json: dataJson,
            owner_uid: ownerUid,
            created_at: createdAt,
            updated_at: updatedAt
          });
        } else if (sql.trim().startsWith("DELETE FROM gallery_documents")) {
          const hasFixedCollection = sql.includes("collection_name = 'userProfiles'");
          const [collection, id] = hasFixedCollection ? ["userProfiles", bindings[0]] : bindings;
          database.rows.delete(database.key(collection, id));
        }
        return { success: true };
      }
    };
  }
}

const originalFetch = globalThis.fetch;

const DEFAULT_TOKEN_INFO = {
  sub: "google-user-1",
  email: "user@example.com",
  email_verified: "true",
  aud: "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com",
  name: "Test User",
  picture: "https://lh3.googleusercontent.com/test"
};
let tokenInfo = DEFAULT_TOKEN_INFO;

test.beforeEach(() => { tokenInfo = DEFAULT_TOKEN_INFO; });

test.before(() => {
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      return Response.json(tokenInfo);
    }
    return new Response("not mocked", { status: 500 });
  };
});

test.after(() => { globalThis.fetch = originalFetch; });

function env(database) {
  return {
    GALLERY_DB: database,
    GALLERY_BUCKET: { async list() { return { objects: [] }; } }
  };
}

function request(path, method = "GET", body) {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      Authorization: "Bearer google-token",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test("new users cannot approve or promote themselves", async () => {
  const database = new MockD1();
  const response = await worker.fetch(request("/data/userProfiles/google-user-1", "PUT", {
    data: { displayName: "Test", email: "user@example.com", status: "approved", role: "super_admin" }
  }), env(database));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.status, "pending");
  assert.equal(payload.data.role, "viewer");
});

test("approved uploader can create image metadata but cannot delete it", async () => {
  const database = new MockD1();
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "approved", role: "uploader" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
  const create = await worker.fetch(request("/data/images/image-1", "PUT", {
    data: { id: "image-1", title: "Test image", uploadedBy: "google-user-1" }
  }), env(database));
  assert.equal(create.status, 200);

  const remove = await worker.fetch(request("/data/images/image-1", "DELETE"), env(database));
  assert.equal(remove.status, 403);
});

test("sign-in verifies the Google token and stores a pending profile", async () => {
  const database = new MockD1();
  const response = await worker.fetch(request("/auth/session", "POST"), env(database));
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.isNewUser, true);
  assert.equal(payload.user.status, "pending");
  assert.equal(payload.user.role, "viewer");
  assert.equal(payload.user.email, "user@example.com");
  assert.equal(payload.user.displayName, "Test User");
  assert.equal(payload.user.photoURL, "https://lh3.googleusercontent.com/test");

  const stored = JSON.parse(database.rows.get("userProfiles/google-user-1").data_json);
  assert.equal(stored.status, "pending");
});

test("sign-in keeps the approved status and role of an existing user", async () => {
  const database = new MockD1();
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "approved", role: "admin" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
  const response = await worker.fetch(request("/auth/session", "POST"), env(database));
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.isNewUser, false);
  assert.equal(payload.user.status, "approved");
  assert.equal(payload.user.role, "admin");
});

test("sign-in rejects a Google token issued for another client id", async () => {
  tokenInfo = { ...DEFAULT_TOKEN_INFO, aud: "999999-someone-else.apps.googleusercontent.com" };
  const response = await worker.fetch(request("/auth/session", "POST"), env(new MockD1()));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "account_unavailable");
});

test("sign-in rejects an unverified Google email", async () => {
  tokenInfo = { ...DEFAULT_TOKEN_INFO, email_verified: "false" };
  const response = await worker.fetch(request("/auth/session", "POST"), env(new MockD1()));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "email_not_verified");
});

test("sign-in rejects a blocked account", async () => {
  const database = new MockD1();
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "blocked", role: "viewer" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
  const response = await worker.fetch(request("/auth/session", "POST"), env(database));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "account_blocked");
});

test("health reports both D1 and R2", async () => {
  const response = await worker.fetch(request("/health"), env(new MockD1()));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.databaseConnected, true);
  assert.equal(payload.bucketConnected, true);
});

// גלריה גדולה. הערכים החוזרים ב-uploadedAt הם העיקר: בלי שובר־שוויון
// יציב במיון, OFFSET מחזיר שורות כפולות ומדלג על אחרות.
const LARGE_GALLERY_SIZE = 1500;

function seedApprovedViewer(database) {
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "approved", role: "viewer" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
}

function seedImages(database, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `image-${String(index).padStart(5, "0")}`;
    ids.push(id);
    database.rows.set(`images/${id}`, {
      document_id: id,
      data_json: JSON.stringify({ id, title: `תמונה ${index}`, uploadedAt: 1_700_000_000_000 + Math.floor(index / 100) }),
      owner_uid: "google-user-1",
      created_at: Date.now(),
      updated_at: Date.now()
    });
  }
  return ids;
}

test("listing pages through a large collection with offset and hasMore", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  seedImages(database, LARGE_GALLERY_SIZE);

  const first = await (await worker.fetch(
    request("/data/images?orderBy=uploadedAt&direction=desc&limit=1000&offset=0"), env(database)
  )).json();
  assert.equal(first.documents.length, 1000);
  assert.equal(first.hasMore, true);

  const second = await (await worker.fetch(
    request("/data/images?orderBy=uploadedAt&direction=desc&limit=1000&offset=1000"), env(database)
  )).json();
  assert.equal(second.documents.length, LARGE_GALLERY_SIZE - 1000);
  assert.equal(second.hasMore, false);

  const firstIds = new Set(first.documents.map(item => item.id));
  assert.equal(second.documents.some(item => firstIds.has(item.id)), false);
});

test("the client loads every image of a 1500 image gallery without duplicates", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const seededIds = seedImages(database, LARGE_GALLERY_SIZE);

  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "google-user-1",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  const idToken = `${header}.${payload}.signature`;

  const store = new Map([["simchas_gallery_google_id_token", idToken]]);
  globalThis.window = {};
  globalThis.document = { readyState: "loading", addEventListener() {} };
  globalThis.sessionStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  // הלקוח פונה ל־Worker דרך fetch; כאן הבקשה מנותבת ישירות אליו.
  const mockedFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (!href.includes("workers.dev")) return mockedFetch(url, options);
    requestCount += 1;
    const headers = new Headers(options.headers || {});
    headers.set("Origin", "https://shmuel-lamed.github.io");
    return worker.fetch(new Request(href, { method: options.method || "GET", headers, body: options.body }), env(database));
  };

  try {
    const client = await import("./cloudflare-client.js");
    const snapshot = await client.getDocs(
      client.query(client.collection(null, "images"), client.orderBy("uploadedAt", "desc"))
    );

    assert.equal(snapshot.size, LARGE_GALLERY_SIZE);
    const loadedIds = snapshot.docs.map(item => item.id);
    assert.equal(new Set(loadedIds).size, LARGE_GALLERY_SIZE);
    assert.deepEqual([...loadedIds].sort(), [...seededIds].sort());
    // 1500 מסמכים בעמודים של 1000: שני עמודים, לא בקשה אחת ולא לולאה אינסופית.
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = mockedFetch;
  }
});
