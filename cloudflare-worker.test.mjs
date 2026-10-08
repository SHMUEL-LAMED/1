import test from "node:test";
import assert from "node:assert/strict";
import worker from "./cloudflare-worker.js";

// חיקוי של D1 שמפרש את צורות ה-SQL הספורות שה-Worker מנסח לאוספים:
// סינון json_extract לפי שדה, רשימת מזהים, השוואת הצמד של סמן הדפדוף,
// ספירה, ספירה מקובצת וגרסאות הנתונים. הסדר וה-LIMIT מחושבים באמת, כדי
// שהדפדוף ייבדק בפועל ולא יאושר על סמך תשובה קבועה.
class MockD1 {
  constructor() { this.rows = new Map(); this.secrets = new Map(); this.meta = new Map(); }
  key(collection, id) { return `${collection}/${id}`; }
  // שורות האוסף אחרי הסינונים שבשאילתה. מחזיר גם את מיקום הכריכה הבאה.
  filteredRows(sql, bindings) {
    const collection = bindings[0];
    let cursor = 1;
    let rows = [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${collection}/`))
      .map(([, row]) => ({ ...row }));
    for (const match of sql.matchAll(/AND CAST\(json_extract\(data_json, '\$\.(\w+)'\) AS TEXT\) = \?/g)) {
      const field = match[1];
      const expected = String(bindings[cursor++]);
      rows = rows.filter(row => {
        const value = JSON.parse(row.data_json || "{}")?.[field];
        return value !== undefined && value !== null && String(value) === expected;
      });
    }
    const idList = /AND document_id IN \(([?, ]+)\)/.exec(sql);
    if (idList) {
      const count = idList[1].split(",").length;
      const ids = new Set(bindings.slice(cursor, cursor + count).map(String));
      cursor += count;
      rows = rows.filter(row => ids.has(String(row.document_id)));
    }
    return { rows, cursor };
  }
  prepare(sql) {
    const database = this;
    let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() {
        if (sql.includes("SELECT 1 AS connected")) return { connected: 1 };
        if (sql.includes("FROM auth_secrets")) {
          const secret = database.secrets.get("session_signing");
          return secret ? { secret_value: secret } : null;
        }
        if (sql.includes("FROM gallery_schema_meta")) {
          const key = sql.includes("schema_key = ?") ? String(bindings[0]) : "gallery";
          return database.meta.has(key) ? { schema_version: database.meta.get(key) } : null;
        }
        if (sql.includes("COUNT(*) AS count")) {
          return { count: database.filteredRows(sql, bindings).rows.length };
        }
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
        if (sql.includes("GROUP BY value")) {
          // ספירה מקובצת: COALESCE(CAST(json_extract(data_json, '$.שדה') AS TEXT), '')
          const field = /json_extract\(data_json, '\$\.(\w+)'\) AS TEXT\), ''\)/.exec(sql)?.[1] || "folderId";
          const grouped = new Map();
          for (const row of database.filteredRows(sql, bindings).rows) {
            const value = JSON.parse(row.data_json || "{}")?.[field];
            const key = value === undefined || value === null ? "" : String(value);
            grouped.set(key, (grouped.get(key) || 0) + 1);
          }
          return { results: [...grouped.entries()].map(([value, count]) => ({ value, count })) };
        }
        // מחקה את ORDER BY / סמן / LIMIT / OFFSET של D1 כדי שהדפדוף ייבדק באמת.
        const { rows: filtered, cursor } = database.filteredRows(sql, bindings);
        const orderField = /COALESCE\(json_extract\(data_json, '\$\.(\w+)'\), 0\) AS REAL\)/.exec(sql)?.[1] || "updatedAt";
        const descending = /AS REAL\) DESC/.test(sql);
        const orderValue = row => Number(JSON.parse(row.data_json || "{}")?.[orderField]) || 0;
        let rows = filtered
          .map(row => ({ ...row, order_value: orderValue(row) }))
          .sort((left, right) => {
            if (left.order_value !== right.order_value) {
              return descending ? right.order_value - left.order_value : left.order_value - right.order_value;
            }
            return String(left.document_id) < String(right.document_id) ? -1 : 1;
          });
        let next = cursor;
        const tuple = /AND \(CAST\(.*?\) (<|>) \? OR \(CAST\(.*?\) = \? AND document_id > \?\)\)/.exec(sql);
        if (tuple) {
          const afterValue = Number(bindings[next]);
          const afterId = String(bindings[next + 2]);
          next += 3;
          rows = rows.filter(row => (tuple[1] === "<" ? row.order_value < afterValue : row.order_value > afterValue)
            || (row.order_value === afterValue && String(row.document_id) > afterId));
        }
        const size = Number(bindings[next]);
        const start = Math.max(0, Number(bindings[next + 1]) || 0);
        return { results: Number.isFinite(size) ? rows.slice(start, start + size) : rows.slice(start) };
      },
      async run() {
        if (sql.trim().startsWith("INSERT INTO auth_secrets")) {
          // ON CONFLICT DO NOTHING: המפתח הראשון שנשמר הוא הקובע.
          if (!database.secrets.has("session_signing")) {
            database.secrets.set("session_signing", String(bindings[0]));
          }
        } else if (sql.trim().startsWith("INSERT INTO gallery_schema_meta")) {
          // גרסת הנתונים: MAX(הקודמת + 1, Date.now()); גרסת הסכימה נכתבת כמות שהיא.
          const key = sql.includes("VALUES ('gallery'") ? "gallery" : String(bindings[0]);
          const value = Number(sql.includes("VALUES ('gallery'") ? bindings[0] : bindings[1]) || 0;
          const previous = database.meta.get(key);
          database.meta.set(key, sql.includes("MAX(") && previous !== undefined ? Math.max(previous + 1, value) : value);
        } else if (sql.trim().startsWith("INSERT INTO gallery_documents")) {
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

function sessionRequest(path, sessionToken, method = "GET", body) {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      Authorization: `Bearer ${sessionToken}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function signIn(database) {
  const response = await worker.fetch(request("/auth/session", "POST"), env(database));
  assert.equal(response.status, 200);
  return response.json();
}

test("signing in returns a long lived session token instead of the hour long Google token", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);

  const payload = await signIn(database);
  assert.equal(typeof payload.sessionToken, "string");
  assert.match(payload.sessionToken, /^v1\.[\w-]+\.[\w-]+$/);

  // אסימון Google תקף כשעה. אסימון ההתחברות חייב להחזיק הרבה מעבר לכך,
  // אחרת המשתמש ינותק בזמן השימוש ויידרש להתחבר שוב. התוקף הוא שנה ומתגלגל
  // בכל ביקור, כדי שגם מי שנכנס לאתר רק סביב החגים יישאר מחובר.
  const remainingDays = (payload.sessionExpiresAt - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(remainingDays > 364, `session should last about a year, got ${remainingDays} days`);

  // זמן ההנפקה נמצא באסימון עצמו: הדפדפן נשען עליו כדי להחליט מתי לחדש.
  const [, encodedPayload] = payload.sessionToken.split(".");
  const tokenPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  assert.equal(typeof tokenPayload.iat, "number");
  assert.ok(Math.abs(tokenPayload.iat * 1000 - Date.now()) < 60 * 1000);
});

test("a session token authenticates later requests without asking Google again", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const { sessionToken } = await signIn(database);

  // כל פנייה ל־Google תיכשל מכאן ואילך: הבקשה חייבת להסתמך על האסימון בלבד.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/tokeninfo")) {
      throw new Error("the worker must not re-verify a session token against Google");
    }
    return previousFetch(url);
  };

  try {
    const response = await worker.fetch(sessionRequest("/data/images", sessionToken), env(database));
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the browser stays signed in after the Google token behind it expired", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const { sessionToken } = await signIn(database);

  // Google פוסלת את האסימון המקורי — בדיוק מה שקורה כשעה אחרי ההתחברות.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("invalid token", { status: 400 });

  try {
    const response = await worker.fetch(sessionRequest("/data/images", sessionToken), env(database));
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a session token can be renewed with itself, without a fresh Google sign-in", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const first = await signIn(database);

  const response = await worker.fetch(
    sessionRequest("/auth/session", first.sessionToken, "POST"),
    env(database)
  );
  assert.equal(response.status, 200);
  const renewed = await response.json();
  assert.match(renewed.sessionToken, /^v1\.[\w-]+\.[\w-]+$/);
  assert.equal(renewed.user.uid, "google-user-1");
  assert.ok(renewed.sessionExpiresAt >= first.sessionExpiresAt);
});

test("a tampered session token is rejected", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const { sessionToken } = await signIn(database);

  const [prefix, payload, signature] = sessionToken.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({
    sub: "attacker", email: "attacker@example.com", email_verified: true,
    name: "Attacker", picture: "", iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");

  const forged = [
    `${prefix}.${forgedPayload}.${signature}`,
    `${prefix}.${payload}.${signature.slice(0, -2)}xy`,
    `${prefix}.${payload}.`
  ];

  for (const token of forged) {
    const response = await worker.fetch(sessionRequest("/data/images", token), env(database));
    assert.equal(response.status, 401, `forged token was accepted: ${token.slice(0, 24)}…`);
  }
});

test("blocking an account revokes a session token that was already issued", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const { sessionToken } = await signIn(database);

  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "blocked", role: "viewer" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const response = await worker.fetch(sessionRequest("/data/images", sessionToken), env(database));
  assert.equal(response.status, 403);
});

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
  const requestedUrls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (!href.includes("workers.dev")) return mockedFetch(url, options);
    requestedUrls.push(new URL(href));
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
    assert.equal(requestedUrls.length, 2);
    // העמוד השני ממשיך בסמן של השורה האחרונה, לא ב-OFFSET.
    assert.equal(requestedUrls[0].searchParams.has("after"), false);
    assert.equal(typeof requestedUrls[1].searchParams.get("after"), "string");
    assert.equal(requestedUrls[1].searchParams.has("offset"), false);
  } finally {
    globalThis.fetch = mockedFetch;
  }
});

test("listing pages through a large collection with cursors, every row exactly once", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  const seededIds = seedImages(database, LARGE_GALLERY_SIZE);

  const seen = [];
  let after = null;
  let pages = 0;
  while (pages < 50) {
    const url = `/data/images?orderBy=uploadedAt&direction=desc&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const payload = await (await worker.fetch(request(url), env(database))).json();
    pages += 1;
    seen.push(...payload.documents.map(item => item.id));
    if (!payload.hasMore) {
      assert.equal(payload.nextCursor, null);
      break;
    }
    after = payload.nextCursor;
  }
  assert.equal(pages, 15);
  assert.equal(seen.length, LARGE_GALLERY_SIZE);
  assert.equal(new Set(seen).size, LARGE_GALLERY_SIZE);
  assert.deepEqual([...seen].sort(), [...seededIds].sort());
});

test("the folderId filter, the count endpoint and the grouped counts run against the mock SQL", async () => {
  const database = new MockD1();
  seedApprovedViewer(database);
  for (let index = 0; index < 30; index += 1) {
    database.rows.set(`images/img-${index}`, {
      document_id: `img-${index}`,
      data_json: JSON.stringify({ id: `img-${index}`, folderId: `folder-${index % 3}`, createdAt: 1000 + index }),
      owner_uid: "google-user-1", created_at: 1, updated_at: 1
    });
  }
  const filtered = await (await worker.fetch(request("/data/images?folderId=folder-1&orderBy=createdAt&direction=desc"), env(database))).json();
  assert.equal(filtered.documents.length, 10);
  assert.ok(filtered.documents.every(item => item.data.folderId === "folder-1"));
  assert.equal(filtered.documents[0].id, "img-28");

  const count = await (await worker.fetch(request("/data/images/count?folderId=folder-2"), env(database))).json();
  assert.deepEqual(count, { success: true, count: 10 });

  const counts = await (await worker.fetch(request("/data/images/counts?by=folderId"), env(database))).json();
  assert.equal(counts.total, 30);
  assert.deepEqual(counts.counts, { "folder-0": 10, "folder-1": 10, "folder-2": 10 });

  const byIds = await (await worker.fetch(request("/data/images?ids=img-3,img-7,nope"), env(database))).json();
  assert.deepEqual(byIds.documents.map(item => item.id).sort(), ["img-3", "img-7"]);
});

test("a pending user still cannot list, filter or count images", async () => {
  const database = new MockD1();
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "pending", role: "viewer" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
  for (const path of ["/data/images", "/data/images?folderId=1", "/data/images/count", "/data/images/counts"]) {
    const response = await worker.fetch(request(path), env(database));
    assert.equal(response.status, 403, path);
  }
});

test("a write bumps the data version that the edge cache key is built from", async () => {
  const database = new MockD1();
  database.rows.set("userProfiles/google-user-1", {
    document_id: "google-user-1",
    data_json: JSON.stringify({ uid: "google-user-1", email: "user@example.com", status: "approved", role: "admin" }),
    created_at: Date.now(),
    updated_at: Date.now()
  });
  assert.equal(database.meta.has("data_version:images"), false);
  const first = await worker.fetch(request("/data/images/img-1", "PUT", { data: { id: "img-1", folderId: "1" } }), env(database));
  assert.equal(first.status, 200);
  const versionAfterCreate = database.meta.get("data_version:images");
  assert.ok(versionAfterCreate > 0);
  const second = await worker.fetch(request("/data/images/img-1", "PUT", { data: { id: "img-1", folderId: "2" } }), env(database));
  assert.equal(second.status, 200);
  assert.ok(database.meta.get("data_version:images") > versionAfterCreate);
  // אוסף אחר אינו מושפע.
  assert.equal(database.meta.has("data_version:folders"), false);
});
