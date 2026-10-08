import test from "node:test";
import assert from "node:assert/strict";
import worker, { isAllowedOrigin } from "./cloudflare-worker.js";

// סביבת הניסוי: ה-Worker מדווח על הסביבה שלו ב-/health, מרשה ב-CORS את אתר
// הניסוי ב-Cloudflare Pages (כולל פריסות תצוגה מקדימה) דרך בדיקת סיומת
// בטוחה, ומסרב לרוץ מול מסד שמסומן כשייך לסביבה האחרת.

// מסד מזערי: מספיק ל-/health ולשורת הסימון של הסביבה, וזוכר מה נכתב בו.
class MarkerD1 {
  constructor(marker = "") {
    this.marker = marker;
    this.inserts = 0;
  }
  prepare(sql) {
    const database = this;
    let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() {
        if (sql.includes("SELECT 1 AS connected")) return { connected: 1 };
        if (sql.includes("FROM gallery_environment")) return database.marker ? { environment: database.marker } : null;
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (sql.includes("INSERT INTO gallery_environment")) {
          database.inserts += 1;
          if (!database.marker) database.marker = String(bindings[0]);
        }
        return { success: true };
      }
    };
  }
}

function env(overrides = {}, database = new MarkerD1()) {
  return {
    GALLERY_DB: database,
    GALLERY_BUCKET: { async list() { return { objects: [] }; } },
    ...overrides
  };
}

function request(path, { origin = "https://shmuel-lamed.github.io", method = "GET" } = {}) {
  return new Request(`https://simchas-gallery-api.example${path}`, {
    method,
    headers: origin ? { Origin: origin } : {}
  });
}

const PRODUCTION = {};
const STAGING = { ENVIRONMENT: "staging" };
const STAGING_SITE = "https://simchas-gallery-staging.pages.dev";
const STAGING_PREVIEW = "https://a1b2c3d4.simchas-gallery-staging.pages.dev";

test("מקורות הייצור הקבועים מורשים בשתי הסביבות", () => {
  for (const origin of [
    "https://shmuel-lamed.github.io",
    "https://0534169095-star.github.io",
    "https://xn--4dbjbascrao3i.com",
    "https://www.xn--4dbjbascrao3i.com"
  ]) {
    assert.equal(isAllowedOrigin(origin, PRODUCTION), true, origin);
    assert.equal(isAllowedOrigin(origin, STAGING), true, origin);
  }
});

test("אתר הניסוי ופריסות התצוגה המקדימה שלו מורשים לפי סיומת בטוחה", () => {
  for (const origin of [STAGING_SITE, STAGING_PREVIEW, "https://staging.simchas-gallery-staging.pages.dev"]) {
    assert.equal(isAllowedOrigin(origin, PRODUCTION), true, origin);
    assert.equal(isAllowedOrigin(origin, STAGING), true, origin);
  }
});

test("מקורות שמנסים להיראות כמו אתר הניסוי נדחים", () => {
  const rejected = [
    "https://evil.com/?x=.pages.dev",
    "https://evil.com?x=.simchas-gallery-staging.pages.dev",
    "https://evil.com/#.simchas-gallery-staging.pages.dev",
    "https://evil.com/simchas-gallery-staging.pages.dev",
    "https://simchas-gallery-staging.pages.dev.evil.com",
    "https://evilsimchas-gallery-staging.pages.dev",
    "https://other-project.pages.dev",
    "https://pages.dev",
    "http://simchas-gallery-staging.pages.dev",
    "https://simchas-gallery-staging.pages.dev:443",
    "https://user:pass@simchas-gallery-staging.pages.dev",
    "https://shmuel-lamed.github.io/",
    "null",
    "",
    null,
    undefined,
    "not a url",
    "javascript:alert(1)"
  ];
  for (const origin of rejected) {
    assert.equal(isAllowedOrigin(origin, PRODUCTION), false, String(origin));
    assert.equal(isAllowedOrigin(origin, STAGING), false, String(origin));
  }
});

test("localhost מורשה רק בסביבת הניסוי", () => {
  for (const origin of ["http://localhost:8080", "http://127.0.0.1:5500", "https://localhost", "http://localhost"]) {
    assert.equal(isAllowedOrigin(origin, PRODUCTION), false, origin);
    assert.equal(isAllowedOrigin(origin, STAGING), true, origin);
  }
  assert.equal(isAllowedOrigin("ftp://localhost", STAGING), false);
  assert.equal(isAllowedOrigin("http://localhost.evil.com", STAGING), false);
  assert.equal(isAllowedOrigin("http://shmuel-lamed.github.io", STAGING), false, "http אינו מורשה גם בניסוי");
});

test("STAGING_PAGES_PROJECT מחליף את שם הפרויקט, וערך לא תקין חוזר לברירת המחדל", () => {
  const custom = { STAGING_PAGES_PROJECT: " My-Gallery-Test " };
  assert.equal(isAllowedOrigin("https://my-gallery-test.pages.dev", custom), true);
  assert.equal(isAllowedOrigin("https://abc.my-gallery-test.pages.dev", custom), true);
  assert.equal(isAllowedOrigin(STAGING_SITE, custom), false);
  for (const invalid of ["", "   ", "a.b", "../x", "-leading", "trailing-", "x".repeat(70), "evil.com/?"]) {
    assert.equal(isAllowedOrigin(STAGING_SITE, { STAGING_PAGES_PROJECT: invalid }), true, JSON.stringify(invalid));
    assert.equal(isAllowedOrigin("https://a.b.pages.dev", { STAGING_PAGES_PROJECT: invalid }), false, JSON.stringify(invalid));
  }
});

test("/health מדווח על הסביבה", async () => {
  const production = await worker.fetch(request("/health"), env());
  assert.equal(production.status, 200);
  const payload = await production.json();
  assert.equal(payload.environment, "production");
  assert.equal(payload.databaseConnected, true);
  assert.equal(payload.bucketConnected, true);

  const staging = await worker.fetch(request("/health"), env({ ENVIRONMENT: "staging" }));
  assert.equal((await staging.json()).environment, "staging");

  // רווחים ואותיות גדולות אינם משנים; ערך לא מוכר נחשב לייצור.
  const padded = await worker.fetch(request("/health"), env({ ENVIRONMENT: " Staging " }));
  assert.equal((await padded.json()).environment, "staging");
  const unknown = await worker.fetch(request("/health"), env({ ENVIRONMENT: "weird" }));
  assert.equal((await unknown.json()).environment, "production");
});

test("preflight ותשובות JSON נושאים את מקור אתר הניסוי, ודוחים מקור זר", async () => {
  const preflight = await worker.fetch(request("/health", { origin: STAGING_PREVIEW, method: "OPTIONS" }), env());
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), STAGING_PREVIEW);

  const health = await worker.fetch(request("/health", { origin: STAGING_PREVIEW }), env());
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("Access-Control-Allow-Origin"), STAGING_PREVIEW);
  assert.equal(health.headers.get("Vary"), "Origin");

  const evilPreflight = await worker.fetch(request("/health", { origin: "https://evil.com/?x=.pages.dev", method: "OPTIONS" }), env());
  assert.equal(evilPreflight.status, 403);
  const evilHealth = await worker.fetch(request("/health", { origin: "https://evil.com" }), env());
  assert.equal(evilHealth.headers.get("Access-Control-Allow-Origin"), null);

  // localhost: נדחה בייצור, מתקבל בניסוי.
  const localProduction = await worker.fetch(request("/health", { origin: "http://localhost:8080", method: "OPTIONS" }), env());
  assert.equal(localProduction.status, 403);
  const localStaging = await worker.fetch(request("/health", { origin: "http://localhost:8080", method: "OPTIONS" }), env({ ENVIRONMENT: "staging" }));
  assert.equal(localStaging.status, 204);
  assert.equal(localStaging.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");
});

test("מסד ללא סימון מקבל את הסביבה של ה-Worker הראשון שרץ מולו, פעם אחת", async () => {
  const production = new MarkerD1();
  const response = await worker.fetch(request("/health"), env({}, production));
  assert.equal(response.status, 200);
  assert.equal(production.marker, "production");

  const staging = new MarkerD1();
  await worker.fetch(request("/health"), env({ ENVIRONMENT: "staging" }, staging));
  assert.equal(staging.marker, "staging");
  // הבדיקה רצה פעם אחת לכל מסד; בקשות נוספות אינן כותבות שוב.
  await worker.fetch(request("/health"), env({ ENVIRONMENT: "staging" }, staging));
  assert.equal(staging.inserts, 1);
});

test("Worker של הניסוי מסרב לרוץ מול מסד שמסומן כייצור, ולהפך", async () => {
  const productionDatabase = new MarkerD1("production");
  const response = await worker.fetch(request("/health"), env({ ENVIRONMENT: "staging" }, productionDatabase));
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.equal(payload.code, "environment_database_mismatch");

  // גם נתיבי הנתונים חסומים, לא רק /health, והסימון עצמו אינו נדרס.
  const data = await worker.fetch(request("/data/images/image-1"), env({ ENVIRONMENT: "staging" }, productionDatabase));
  assert.equal(data.status, 500);
  assert.equal((await data.json()).code, "environment_database_mismatch");
  assert.equal(productionDatabase.marker, "production");
  assert.equal(productionDatabase.inserts, 0);

  const stagingDatabase = new MarkerD1("staging");
  const reverse = await worker.fetch(request("/health"), env({}, stagingDatabase));
  assert.equal(reverse.status, 500);
  assert.equal((await reverse.json()).code, "environment_database_mismatch");

  // תיקון ה-binding נכנס לתוקף בלי פריסה מחדש: הכישלון אינו ננעל במטמון.
  const fixed = await worker.fetch(request("/health"), env({ ENVIRONMENT: "staging" }, stagingDatabase));
  assert.equal(fixed.status, 200);
  assert.equal((await fixed.json()).environment, "staging");
});
