import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  API_ENVIRONMENT_STORAGE_KEY,
  PRODUCTION_API_BASE_URL,
  STAGING_API_BASE_URL,
  isStagingHostname,
  resolveApiBaseUrl,
  resolveApiEnvironment
} from "./api-environment.js";

// כתובת ה-Worker נקבעת במקום אחד, api-environment.js. הבדיקות כאן נועלות את
// טבלת ההחלטה: לפי המארח, לפי ‎?api= ולפי מה שנשמר ללשונית — ואת העובדה
// שאף מודול אחר אינו מחזיק כתובת משלו.

function makeStorage(map = new Map()) {
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("כתובת הייצור לא השתנתה, ולניסוי יש כתובת משלו", () => {
  assert.equal(PRODUCTION_API_BASE_URL, "https://simchas-gallery-api.0534169095.workers.dev");
  assert.equal(STAGING_API_BASE_URL, "https://simchas-gallery-api-staging.0534169095.workers.dev");
});

test("הסביבה נגזרת מהמארח שממנו האתר מוגש", () => {
  const table = [
    ["shmuel-lamed.github.io", "production"],
    ["0534169095-star.github.io", "production"],
    ["xn--4dbjbascrao3i.com", "production"],
    ["www.xn--4dbjbascrao3i.com", "production"],
    ["simchas-gallery-staging.pages.dev", "staging"],
    ["a1b2c3d4.simchas-gallery-staging.pages.dev", "staging"],
    ["staging.simchas-gallery-staging.pages.dev", "staging"],
    ["localhost", "staging"],
    ["127.0.0.1", "staging"],
    ["LOCALHOST", "staging"],
    ["pages.dev", "production"],
    ["evil-pages.dev", "production"],
    ["simchas-gallery-staging.pages.dev.evil.com", "production"],
    ["localhost.evil.com", "production"],
    ["", "production"]
  ];
  for (const [hostname, expected] of table) {
    const label = hostname || "(מארח ריק)";
    assert.equal(resolveApiEnvironment({ hostname, search: "", storage: null }), expected, label);
    assert.equal(
      resolveApiBaseUrl({ hostname, search: "", storage: null }),
      expected === "staging" ? STAGING_API_BASE_URL : PRODUCTION_API_BASE_URL,
      label
    );
    assert.equal(isStagingHostname(hostname), expected === "staging", label);
  }
});

test("‎?api= גובר על המארח ונשמר ללשונית", () => {
  const storage = makeStorage();
  assert.equal(resolveApiEnvironment({ hostname: "shmuel-lamed.github.io", search: "?api=staging", storage }), "staging");
  assert.equal(storage.map.get(API_ENVIRONMENT_STORAGE_KEY), "staging");
  // בלי הפרמטר — הבחירה השמורה ממשיכה לחול, גם אחרי ניווט פנימי.
  assert.equal(resolveApiEnvironment({ hostname: "shmuel-lamed.github.io", search: "", storage }), "staging");
  assert.equal(resolveApiBaseUrl({ hostname: "shmuel-lamed.github.io", search: "", storage }), STAGING_API_BASE_URL);

  assert.equal(resolveApiEnvironment({ hostname: "simchas-gallery-staging.pages.dev", search: "?x=1&api=Production", storage }), "production");
  assert.equal(storage.map.get(API_ENVIRONMENT_STORAGE_KEY), "production");
  assert.equal(resolveApiEnvironment({ hostname: "simchas-gallery-staging.pages.dev", search: "", storage }), "production");
  assert.equal(resolveApiBaseUrl({ hostname: "simchas-gallery-staging.pages.dev", search: "", storage }), PRODUCTION_API_BASE_URL);
});

test("ערך לא מוכר ב-‎?api= מתעלמים ממנו, והוא אינו נשמר", () => {
  const storage = makeStorage();
  assert.equal(resolveApiEnvironment({ hostname: "shmuel-lamed.github.io", search: "?api=evil", storage }), "production");
  assert.equal(resolveApiEnvironment({ hostname: "simchas-gallery-staging.pages.dev", search: "?api=", storage }), "staging");
  assert.equal(storage.map.size, 0);
  // ערך שמור שאינו תקין (נכתב ידנית) אינו משנה את ההחלטה.
  storage.setItem(API_ENVIRONMENT_STORAGE_KEY, "https://evil.example");
  assert.equal(resolveApiEnvironment({ hostname: "shmuel-lamed.github.io", search: "", storage }), "production");
});

test("‎?api=auto מוחק את הבחירה השמורה וחוזר להחלטה לפי המארח", () => {
  const storage = makeStorage(new Map([[API_ENVIRONMENT_STORAGE_KEY, "staging"]]));
  assert.equal(resolveApiEnvironment({ hostname: "shmuel-lamed.github.io", search: "?api=auto", storage }), "production");
  assert.equal(storage.map.has(API_ENVIRONMENT_STORAGE_KEY), false);
});

test("אחסון חסום או היעדר location אינם מפילים את ההחלטה", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.equal(resolveApiEnvironment({ hostname: "simchas-gallery-staging.pages.dev", search: "?api=production", storage: blocked }), "production");
  assert.equal(resolveApiEnvironment({ hostname: "simchas-gallery-staging.pages.dev", search: "", storage: blocked }), "staging");
  // בלי location בכלל (כמו כאן, ב-Node) — ייצור.
  assert.equal(resolveApiEnvironment(), "production");
  assert.equal(resolveApiBaseUrl(), PRODUCTION_API_BASE_URL);
});

test("כל המודולים לוקחים את הכתובת מ-api-environment.js ולא מחזיקים כתובת משלהם", () => {
  const scripts = readdirSync(new URL("./", import.meta.url))
    .filter(name => /\.(?:js|mjs)$/.test(name) && name !== "api-environment.js" && !name.endsWith(".test.mjs"));
  for (const name of scripts) {
    assert.ok(!read(name).includes("0534169095.workers.dev"), `${name} מחזיק כתובת Worker משלו במקום לייבא מ-api-environment.js`);
  }
  for (const name of ["cloudflare-client.js", "app.js", "drive-sync.js", "face-search.js"]) {
    assert.match(read(name), /from ["']\.\/api-environment\.js["']/, `${name} אינו מייבא את api-environment.js`);
  }
  assert.match(read("cloudflare-client.js"), /const API_BASE_URL = resolveApiBaseUrl\(\)/);
  const appJs = read("app.js");
  assert.match(appJs, /const R2_WORKER_BASE_URL = resolveApiBaseUrl\(\)/);
  assert.match(appJs, /window\.API_ENVIRONMENT\s*=\s*API_ENVIRONMENT/);
  assert.match(appJs, /dataset\.apiEnvironment\s*=\s*API_ENVIRONMENT/);
});

test("רצועת סביבת הניסוי, ה-Service Worker ובדיקת התחביר מכירים את המודול", () => {
  for (const page of ["index.html", "admin.html"]) {
    assert.ok(read(page).includes('class="env-ribbon"'), `${page} חסר את רצועת סביבת הניסוי`);
  }
  const css = read("styles.css");
  assert.match(css, /html\[data-api-environment="staging"\] \.env-ribbon/);
  // הצבעים מאסימונים בלבד: אין ערך צבע קבוע בכללי הרצועה.
  const ribbonRules = css.slice(css.indexOf(".env-ribbon { display: none; }"), css.indexOf("}", css.indexOf(".env-ribbon::before")));
  assert.doesNotMatch(ribbonRules, /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i, "צבעי הרצועה חייבים להגיע מאסימוני CSS");

  const swJs = read("sw.js");
  const shell = swJs.slice(swJs.indexOf("const APP_SHELL"), swJs.indexOf("];", swJs.indexOf("const APP_SHELL")));
  assert.ok(shell.includes('"./api-environment.js"'), "api-environment.js חייב להיות במעטפת האפליקציה של ה-Service Worker");
  assert.ok(read("package.json").includes("node --check api-environment.js"), "api-environment.js חסר ב-check:syntax");
});
