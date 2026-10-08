// בדיקות ניטור השגיאות ב-Worker: קיבוץ לפי טביעת אצבע, מגבלת קצב, ניקוי
// אסימונים וכתובות דוא״ל, רישום כשלונות פנימיים והרשאות המסך.
// המסד כאן הוא SQLite אמיתי בזיכרון, כמו בבדיקות טביעות הפנים, כך
// שה-upsert, האינדקס ושאילתות RETURNING נבדקים בפועל ולא מול חיקוי.
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
    const statement = this.database.prepare(this.sql);
    if (/RETURNING/i.test(this.sql)) statement.get(...this.bindings);
    else statement.run(...this.bindings);
    return { success: true };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }
}

const database = new SqliteD1();
let bucketListFails = false;

const environment = {
  GALLERY_DB: database,
  GALLERY_BUCKET: {
    async list() {
      if (bucketListFails) throw new Error("R2 exploded");
      return { objects: [] };
    }
  }
};

const ACCOUNTS = {
  "viewer-token": { sub: "google-viewer", email: "viewer@example.com", name: "Viewer" },
  "admin-token": { sub: "google-admin", email: "admin@example.com", name: "Admin" },
  "super-token": { sub: "google-super", email: "super@example.com", name: "Super" }
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

// הקריאה הראשונה ל-Worker יוצרת את הסכימה, כולל טבלת השגיאות.
test.before(async () => {
  const health = await worker.fetch(apiRequest("/health"), environment);
  assert.equal(health.status, 200);
});

test.after(() => { globalThis.fetch = originalFetch; });

function seedProfile(uid, email, role, status) {
  const now = Date.now();
  database.database.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES ('userProfiles', ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json`
  ).run(uid, JSON.stringify({ uid, email, role, status }), uid, now, now);
}

test.beforeEach(() => {
  bucketListFails = false;
  for (const table of ["client_errors", "request_rate_limits", "gallery_documents", "user_email_index"]) {
    database.database.exec(`DELETE FROM ${table}`);
  }
  seedProfile("google-viewer", "viewer@example.com", "viewer", "approved");
  seedProfile("google-admin", "admin@example.com", "admin", "approved");
  seedProfile("google-super", "super@example.com", "super_admin", "approved");
});

function apiRequest(path, { method = "GET", body, token = "", ip = "203.0.113.7", headers = {} } = {}) {
  const hasBody = body !== undefined;
  // גוף שנמסר כמחרוזת נשלח בלי Content-Type, כמו Blob של sendBeacon.
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: {
      Origin: "https://shmuel-lamed.github.io",
      "CF-Connecting-IP": ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(hasBody && typeof body !== "string" ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
  });
}

async function call(path, options) {
  const response = await worker.fetch(apiRequest(path, options), environment);
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = {}; }
  return { status: response.status, payload, text };
}

const SAMPLE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  "    at renderImages (https://shmuel-lamed.github.io/1/gallery.js:120:9)",
  "    at HTMLDocument.<anonymous> (https://shmuel-lamed.github.io/1/app.js:1240:5)"
].join("\n");

function sampleReport(overrides = {}) {
  return {
    message: "Cannot read properties of undefined (reading 'map')",
    stack: SAMPLE_STACK,
    url: "https://shmuel-lamed.github.io/1/",
    userAgent: "Mozilla/5.0 (Test)",
    extra: { version: "v43", scope: "gallery" },
    ...overrides
  };
}

function storedErrors() {
  return database.database.prepare("SELECT * FROM client_errors ORDER BY first_seen, message").all();
}

function postReport(body, options = {}) {
  return call("/telemetry/errors", { method: "POST", body, ...options });
}

function resolveError(fingerprint, token = "super-token") {
  return call("/telemetry/errors/resolve", { method: "POST", body: { fingerprint }, token });
}

test("דיווח ראשון יוצר שורה, ודיווח חוזר מגדיל את המונה ושומר את המופע הראשון", async () => {
  const first = await postReport(sampleReport());
  assert.equal(first.status, 200, first.text);
  assert.equal(first.payload.success, true);

  let rows = storedErrors();
  assert.equal(rows.length, 1);
  assert.match(rows[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(rows[0].source, "site");
  assert.equal(rows[0].message, "gallery: Cannot read properties of undefined (reading 'map')");
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].last_uid, "", "דיווח בלי אסימון אינו מזהה משתמש");
  assert.equal(rows[0].resolved_at, null);
  assert.ok(rows[0].stack.includes("at renderImages"));
  assert.ok(rows[0].stack.includes('"version":"v43"'), "גרסת האתר נשמרת בבלוק ההקשר");
  assert.equal(rows[0].url, "https://shmuel-lamed.github.io/1/");
  assert.equal(rows[0].user_agent, "Mozilla/5.0 (Test)");
  const firstSeen = rows[0].first_seen;

  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await postReport(sampleReport(), { token: "admin-token" });
  assert.equal(second.status, 200, second.text);

  rows = storedErrors();
  assert.equal(rows.length, 1, "אותה שגיאה חייבת להישאר שורה אחת");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].first_seen, firstSeen, "המופע הראשון אינו משתנה");
  assert.ok(rows[0].last_seen >= firstSeen);
  assert.equal(rows[0].last_uid, "google-admin", "דיווח עם אסימון תקף רושם את המשתמש");
});

test("מספרי שורה אינם מפצלים תקלה אחת, אך הודעה או מסלול אחרים מקבלים שורה משלהם", async () => {
  await postReport(sampleReport());
  await postReport(sampleReport({ stack: SAMPLE_STACK.replace("gallery.js:120:9", "gallery.js:131:17") }));
  assert.equal(storedErrors().length, 1, "פריסה שמזיזה שורות אינה יוצרת שורה חדשה");
  assert.equal(storedErrors()[0].count, 2);

  await postReport(sampleReport({ message: "Failed to fetch" }));
  assert.equal(storedErrors().length, 2);

  await postReport(sampleReport({ extra: { scope: "upload" } }));
  assert.equal(storedErrors().length, 3, "אותה הודעה במסלול אחר היא תקלה אחרת");
});

test("דיווח מתקבל גם בלי אסימון וגם עם אסימון פסול, וגוף בלי Content-Type נקרא כ-JSON", async () => {
  const beacon = await postReport(JSON.stringify(sampleReport()));
  assert.equal(beacon.status, 200, beacon.text);

  const bogus = await postReport(sampleReport(), { token: "bogus-token" });
  assert.equal(bogus.status, 200, "אסימון פסול אינו דוחה את הדיווח");

  const rows = storedErrors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].last_uid, "");
});

test("מגבלת קצב: 30 דיווחים לשעה לכל כתובת, ואחריהם 429", async () => {
  for (let index = 0; index < 30; index += 1) {
    const response = await postReport(sampleReport({ message: `error ${index}` }));
    assert.equal(response.status, 200, `דיווח ${index} נדחה: ${response.text}`);
  }
  const blocked = await postReport(sampleReport({ message: "one too many" }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.payload.code, "client_error_rate_limit");
  assert.equal(storedErrors().length, 30);

  const otherAddress = await postReport(sampleReport({ message: "from elsewhere" }), { ip: "198.51.100.9" });
  assert.equal(otherAddress.status, 200, "כתובת אחרת אינה מוגבלת");
});

test("גבולות גודל, וניקוי אסימונים וכתובות דוא״ל לפני השמירה", async () => {
  const response = await postReport(sampleReport({
    message: `Request failed for user@example.com with Bearer secret.token.value ${"x".repeat(900)}`,
    stack: `Error: boom v1.abcdefghij.klmnopqrst\n    at upload (https://shmuel-lamed.github.io/1/gallery.js:1:1)\n${"y".repeat(10000)}`,
    url: `https://shmuel-lamed.github.io/1/?id_token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl#${"z".repeat(800)}`,
    userAgent: "a".repeat(1000),
    extra: { scope: "upload", note: "token ya29.abc-def for admin@example.com" }
  }));
  assert.equal(response.status, 200, response.text);

  const [row] = storedErrors();
  assert.ok(row.message.length <= 500, `ההודעה ארוכה מדי: ${row.message.length}`);
  assert.ok(row.stack.length <= 4000, `המחסנית ארוכה מדי: ${row.stack.length}`);
  assert.ok(row.url.length <= 500, `הכתובת ארוכה מדי: ${row.url.length}`);
  assert.ok(row.user_agent.length <= 300);
  assert.ok(row.message.startsWith("upload: Request failed for"));
  for (const text of [row.message, row.stack, row.url]) {
    assert.ok(!text.includes("example.com"), "כתובת דוא״ל נשמרה");
    assert.ok(!text.includes("secret.token.value"), "אסימון Bearer נשמר");
    assert.ok(!text.includes("abcdefghij.klmnopqrst"), "אסימון התחברות נשמר");
    assert.ok(!text.includes("eyJhbGciOiJSUzI1NiJ9"), "id_token נשמר בכתובת");
    assert.ok(!text.includes("ya29.abc-def"), "אסימון Google נשמר בהקשר");
  }
  assert.ok(row.stack.includes("[דוא״ל הוסר]"));
});

test("דיווח לא תקין נענה ב-400 ולא ב-500, ובלי שורה במסד", async () => {
  const broken = await postReport("not json at all");
  assert.equal(broken.status, 400);
  assert.equal(broken.payload.code, "invalid_error_report");

  const empty = await postReport({ message: "   " });
  assert.equal(empty.status, 400);
  assert.equal(storedErrors().length, 0);
});

test("כשלון פנימי של ה-Worker נרשם כשגיאת שרת, ותשובת 4xx אינה נרשמת", async () => {
  bucketListFails = true;
  const pending = [];
  const ctx = { waitUntil: promise => pending.push(promise) };
  const response = await worker.fetch(apiRequest("/health"), environment, ctx);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "internal_error");
  assert.equal(pending.length, 1, "הרישום חייב לרוץ דרך ctx.waitUntil, אחרי התשובה");
  await Promise.all(pending);
  bucketListFails = false;

  const rows = storedErrors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "worker");
  assert.equal(rows[0].message, "GET /health: R2 exploded");
  assert.equal(rows[0].url, "https://simchas-gallery-api.example/health");
  assert.ok(rows[0].stack.includes('"status":"500"'));

  // חוסר הרשאה הוא תשובה צפויה, לא תקלה.
  const unauthenticated = await call("/face/people");
  assert.equal(unauthenticated.status, 401);
  const forbidden = await call("/telemetry/errors", { token: "viewer-token" });
  assert.equal(forbidden.status, 403);
  const missing = await call("/no-such-route");
  assert.equal(missing.status, 404);
  assert.equal(storedErrors().length, 1, "תשובות 4xx אינן נרשמות");
});

test("הרישום רץ גם בלי ctx, ותשובת ה-Worker אינה משתנה כשהמסד שבור", async () => {
  const brokenDatabase = {
    prepare(sql) {
      if (sql.includes("client_errors")) throw new Error("D1 unavailable");
      return database.prepare(sql);
    }
  };
  const brokenEnvironment = { ...environment, GALLERY_DB: brokenDatabase };

  bucketListFails = true;
  const failure = await worker.fetch(apiRequest("/health"), brokenEnvironment);
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).code, "internal_error");
  bucketListFails = false;

  // גם דיווח מהאתר אינו נכשל כלפי הדפדפן כשהשמירה עצמה אינה אפשרית.
  const report = await worker.fetch(
    apiRequest("/telemetry/errors", { method: "POST", body: sampleReport() }),
    brokenEnvironment
  );
  assert.equal(report.status, 200);
  assert.deepEqual(await report.json(), { success: true, stored: false });
  assert.equal(storedErrors().length, 0);
});

test("הרשאות: צופה אינו רואה את הרשימה, מנהל רואה, ורק מנהל־על מסמן שטופל", async () => {
  await postReport(sampleReport());
  const [{ fingerprint }] = storedErrors();

  const viewerList = await call("/telemetry/errors", { token: "viewer-token" });
  assert.equal(viewerList.status, 403);
  assert.equal(viewerList.payload.code, "permission_denied");
  const viewerSummary = await call("/telemetry/errors/summary", { token: "viewer-token" });
  assert.equal(viewerSummary.status, 403);
  const anonymousList = await call("/telemetry/errors");
  assert.equal(anonymousList.status, 401);

  const adminList = await call("/telemetry/errors?status=open&limit=50", { token: "admin-token" });
  assert.equal(adminList.status, 200, adminList.text);
  assert.equal(adminList.payload.errors.length, 1);
  assert.equal(adminList.payload.errors[0].fingerprint, fingerprint);
  assert.equal(adminList.payload.errors[0].count, 1);
  assert.equal(adminList.payload.errors[0].source, "site");
  assert.equal(adminList.payload.errors[0].resolvedAt, null);
  const adminSummary = await call("/telemetry/errors/summary", { token: "admin-token" });
  assert.equal(adminSummary.status, 200);
  assert.equal(adminSummary.payload.open, 1);
  assert.equal(adminSummary.payload.last24h, 1);

  const adminResolve = await resolveError(fingerprint, "admin-token");
  assert.equal(adminResolve.status, 403);
  const adminReopen = await call("/telemetry/errors/reopen", { method: "POST", body: { fingerprint }, token: "admin-token" });
  assert.equal(adminReopen.status, 403);
  const adminClear = await call("/telemetry/errors/clear", { method: "POST", token: "admin-token" });
  assert.equal(adminClear.status, 403);
  assert.equal(storedErrors()[0].resolved_at, null, "מנהל דרגה 3 אינו משנה את מצב השגיאה");

  const superResolve = await resolveError(fingerprint);
  assert.equal(superResolve.status, 200, superResolve.text);
  assert.equal((await call("/telemetry/errors", { token: "admin-token" })).payload.errors.length, 0);
  const resolvedList = await call("/telemetry/errors?status=resolved", { token: "admin-token" });
  assert.equal(resolvedList.payload.errors.length, 1);
  assert.ok(resolvedList.payload.errors[0].resolvedAt > 0);
  const afterResolve = await call("/telemetry/errors/summary", { token: "admin-token" });
  assert.equal(afterResolve.payload.open, 0);
  assert.equal(afterResolve.payload.last24h, 0);

  const resolveAgain = await resolveError(fingerprint);
  assert.equal(resolveAgain.status, 404);
  assert.equal(resolveAgain.payload.code, "error_not_found");

  const reopen = await call("/telemetry/errors/reopen", { method: "POST", body: { fingerprint }, token: "super-token" });
  assert.equal(reopen.status, 200, reopen.text);
  assert.equal((await call("/telemetry/errors", { token: "admin-token" })).payload.errors.length, 1);

  const invalid = await resolveError("nope");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "invalid_fingerprint");
});

test("שגיאה שטופלה ונרשמה שוב חוזרת להיות פתוחה", async () => {
  await postReport(sampleReport());
  const [{ fingerprint }] = storedErrors();
  assert.equal((await resolveError(fingerprint)).status, 200);
  assert.ok(storedErrors()[0].resolved_at > 0);

  await postReport(sampleReport());
  const [row] = storedErrors();
  assert.equal(row.resolved_at, null, "דיווח חוזר פותח מחדש שגיאה שסומנה כטופלה");
  assert.equal(row.count, 2);
});

test("ניקוי מוחק רק שגיאות שטופלו לפני יותר משלושים יום", async () => {
  await postReport(sampleReport({ message: "old resolved" }));
  await postReport(sampleReport({ message: "fresh resolved" }));
  await postReport(sampleReport({ message: "still open" }));
  for (const row of storedErrors().filter(item => item.message !== "gallery: still open")) {
    assert.equal((await resolveError(row.fingerprint)).status, 200);
  }
  database.database.prepare("UPDATE client_errors SET resolved_at = ? WHERE message = ?")
    .run(Date.now() - 31 * 24 * 60 * 60 * 1000, "gallery: old resolved");

  const cleared = await call("/telemetry/errors/clear", { method: "POST", token: "super-token" });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.payload.deleted, 1);
  assert.deepEqual(
    storedErrors().map(row => row.message).sort(),
    ["gallery: fresh resolved", "gallery: still open"]
  );
});

test("הסיכום סופר שגיאות פתוחות בלבד, ובנפרד את אלו שנראו ביממה האחרונה", async () => {
  await postReport(sampleReport({ message: "seen today" }));
  await postReport(sampleReport({ message: "seen last week" }));
  await postReport(sampleReport({ message: "resolved today" }));
  database.database.prepare("UPDATE client_errors SET last_seen = ? WHERE message = ?")
    .run(Date.now() - 7 * 24 * 60 * 60 * 1000, "gallery: seen last week");
  const resolvedRow = storedErrors().find(row => row.message === "gallery: resolved today");
  assert.equal((await resolveError(resolvedRow.fingerprint)).status, 200);

  const summary = await call("/telemetry/errors/summary", { token: "super-token" });
  assert.equal(summary.status, 200);
  assert.equal(summary.payload.open, 2);
  assert.equal(summary.payload.last24h, 1);

  // הרשימה ממוינת מהמופע האחרון לישן.
  const list = await call("/telemetry/errors", { token: "super-token" });
  assert.deepEqual(
    list.payload.errors.map(error => error.message),
    ["gallery: seen today", "gallery: seen last week"]
  );
});
