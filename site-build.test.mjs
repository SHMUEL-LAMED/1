// בדיקות לתוסף הבנייה (site-build.mjs): רשימת המעטפת של ה-Service Worker
// שנבנית ממניפסט Vite, ו-version.json שנכתב בזמן הבנייה במקום Jekyll.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATIC_FILES,
  keepStaticLinks,
  collectEntryFiles,
  findEntryKey,
  readAppShell,
  buildPrecacheList,
  renderServiceWorker,
  renderVersionJson,
  resolveRevision
} from "./site-build.mjs";
import { isRenderedVersion, parseVersion } from "./auto-update.js";

const read = file => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

// מניפסט בצורה ש-Vite מפיק לאתר: נקודת הגלריה מוזגה לנתח המשותף, ולוח
// הניהול מייבא אותו. face-search ו-chat הם נתחים דינמיים.
const MANIFEST = {
  "_app-AAAA.js": {
    file: "assets/app-AAAA.js",
    name: "app",
    dynamicImports: ["face-search.js", "chat.js"],
    css: ["assets/app-CSS1.css"]
  },
  "_app-CSS1.css": { file: "assets/app-CSS1.css", src: "_app-CSS1.css" },
  "admin.html": {
    file: "assets/admin-BBBB.js",
    src: "admin.html",
    isEntry: true,
    imports: ["_app-AAAA.js"],
    dynamicImports: ["admin-errors.js"]
  },
  "admin-errors.js": { file: "assets/admin-errors-CCCC.js", src: "admin-errors.js", isDynamicEntry: true },
  "face-search.js": { file: "assets/face-search-DDDD.js", src: "face-search.js", isDynamicEntry: true, imports: ["_app-AAAA.js"] },
  "chat.js": { file: "assets/chat-EEEE.js", src: "chat.js", isDynamicEntry: true }
};
const BUILT_INDEX = '<head><script type="module" crossorigin src="./assets/app-AAAA.js"></script>'
  + '<link rel="stylesheet" crossorigin href="./assets/app-CSS1.css"></head>';

test("קישורי ה-manifest והסמלים מסומנים כך ש-Vite לא יגבב אותם", () => {
  const html = '<link rel="icon" href="./favicon-32.png"><link rel="manifest" href="./manifest.webmanifest">'
    + '<link rel="apple-touch-icon" href="./icon-192.png"><link rel="stylesheet" href="./styles.css">';
  const out = keepStaticLinks(html);
  assert.equal((out.match(/<link vite-ignore/g) || []).length, 3);
  assert.match(out, /<link rel="stylesheet" href="\.\/styles\.css">/, "גיליון הסגנון עובר דרך Vite");
  assert.equal(keepStaticLinks(out), out, "סימון כפול אינו מתווסף");
  for (const page of ["index.html", "admin.html"]) {
    assert.match(keepStaticLinks(read(page)), /<link vite-ignore rel="icon"/, `${page}: הסמל נשאר בכתובתו`);
  }
  assert.match(keepStaticLinks(read("index.html")), /<link vite-ignore rel="manifest"/);
});

test("נקודת הדף מזוהה גם כש-Rollup מיזג אותה לנתח המשותף", () => {
  assert.equal(findEntryKey(MANIFEST, "admin.html"), "admin.html");
  assert.equal(findEntryKey(MANIFEST, "index.html", BUILT_INDEX), "_app-AAAA.js");
  assert.throws(() => findEntryKey(MANIFEST, "index.html", "<p>ללא סקריפט</p>"), /index\.html/);
});

test("הקבצים הסטטיים של דף נאספים ברקורסיה, בלי ייבוא דינמי", () => {
  assert.deepEqual(collectEntryFiles(MANIFEST, "admin.html"), {
    scripts: ["assets/admin-BBBB.js", "assets/app-AAAA.js"],
    styles: ["assets/app-CSS1.css"]
  });
  assert.throws(() => collectEntryFiles(MANIFEST, "missing.js"), /missing\.js/);
});

test("רשימת המעטפת של הבנייה: הגלריה בשמות מגובבים, בלי מודולי ניהול", () => {
  const list = buildPrecacheList(MANIFEST, {
    page: "index.html",
    html: BUILT_INDEX,
    sourceShell: ["./", "./index.html", "./app.js", "./face-search.js", "./styles.css"]
  });
  assert.deepEqual(list, [
    "./",
    "./index.html",
    "./assets/app-CSS1.css",
    "./assets/app-AAAA.js",
    "./assets/face-search-DDDD.js",
    "./manifest.webmanifest",
    "./favicon-32.png",
    "./icon-192.png",
    "./icon-512.png"
  ]);
  for (const forbidden of ["admin-BBBB", "admin-errors", "chat-EEEE", "admin.html"]) {
    assert.ok(!list.some(entry => entry.includes(forbidden)), `${forbidden} אינו אמור לרדת מראש למבקר רגיל`);
  }
  // נתח דינמי שאינו במעטפת המקור נשאר בחוץ.
  assert.ok(!buildPrecacheList(MANIFEST, { html: BUILT_INDEX }).includes("./assets/face-search-DDDD.js"));
});

test("readAppShell קורא את רשימת המעטפת של sw.js במקור", () => {
  const shell = readAppShell(read("sw.js"));
  assert.ok(shell.includes("./app.js"));
  assert.ok(shell.includes("./face-search.js"));
  assert.ok(!shell.includes("./admin.html"));
});

test("sw.js של הבנייה: מעטפת חדשה, וכל השאר — כולל CACHE_VERSION — כפי שהוא", () => {
  const source = read("sw.js");
  const list = ["./", "./index.html", "./assets/app-$&.js"];
  const built = renderServiceWorker(source, list);
  assert.deepEqual(readAppShell(built), list, "שם עם $ אינו מתפרש כתבנית החלפה");
  assert.ok(!built.includes('"./gallery.js"'), "קובצי המקור אינם נשארים במעטפת");
  const cacheVersion = s => /const CACHE_VERSION = "([^"]+)";/.exec(s)?.[1];
  assert.equal(cacheVersion(built), cacheVersion(source));
  const siteVersion = /const SITE_VERSION = '([^']+)';/.exec(read("app.js"))?.[1];
  assert.equal(cacheVersion(built), siteVersion, "גרסת המטמון בבנייה תואמת ל-SITE_VERSION");
  // מחוץ למערך, הקובץ זהה למקור.
  const outside = s => s.replace(/const APP_SHELL = \[[\s\S]*?\n\];/, "");
  assert.equal(outside(built), outside(source));
  assert.throws(() => renderServiceWorker("const x = 1;", list), /APP_SHELL/);
  assert.throws(() => renderServiceWorker(source, []), /ריקה/);
});

test("version.json של הבנייה מכיל commit וזמן אמיתיים ומזוהה כמעובד", () => {
  const text = renderVersionJson({ revision: "abc123", builtAt: new Date("2026-10-08T09:30:00Z") });
  assert.equal(text, '{"revision":"abc123","builtAt":"2026-10-08T09:30:00.000Z"}\n');
  assert.ok(isRenderedVersion(text), "auto-update.js מזהה את הקובץ כגרסה אמיתית");
  assert.deepEqual(parseVersion(text), { revision: "abc123", builtAt: "2026-10-08T09:30:00.000Z" });
  assert.notEqual(text, renderVersionJson({ revision: "def456", builtAt: "2026-10-08T09:30:00Z" }), "commit חדש = גרסה חדשה");
  assert.equal(parseVersion(renderVersionJson({})).revision, "local");
  assert.throws(() => renderVersionJson({ revision: "x", builtAt: "not a date" }), /זמן/);
});

test("ה-commit נלקח מ-GITHUB_SHA כשהוא קיים", () => {
  assert.equal(resolveRevision({ GITHUB_SHA: "0123abcd" }), "0123abcd");
  assert.match(resolveRevision({}, "/nonexistent-dir-for-test"), /^local$/);
});

test("הקבצים שמועתקים לבנייה קיימים, ו-version.json במקור נשאר תבנית Jekyll", () => {
  for (const file of STATIC_FILES) {
    assert.doesNotThrow(() => readFileSync(new URL(`./${file}`, import.meta.url)), `${file} חסר`);
  }
  const manifest = JSON.parse(read("manifest.webmanifest"));
  for (const icon of manifest.icons) {
    assert.ok(STATIC_FILES.includes(icon.src.replace(/^\.\//, "")), `${icon.src} חייב להיות מועתק לבנייה`);
  }
  // הפריסה מהענף עדיין נשענת על Jekyll עד המעבר ל-Actions.
  assert.ok(read("version.json").startsWith("---\n---\n"));
  assert.match(read(".gitignore"), /^dist\/$/m);
});

test("הגדרות הבנייה: שני הדפים, בסיס יחסי, והפריסה ל-Pages", () => {
  const config = read("vite.config.mjs");
  assert.match(config, /base: '\.\/'/);
  assert.match(config, /page\('index\.html'\)/);
  assert.match(config, /page\('admin\.html'\)/);
  assert.match(config, /siteBuildPlugin\(\)/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.build, "vite build");
  assert.match(pkg.devDependencies.vite, /^\d+\.\d+\.\d+$/, "גרסת Vite נעוצה במדויק");
  const pages = read(".github/workflows/pages.yml");
  assert.match(pages, /actions\/upload-pages-artifact@/);
  assert.match(pages, /actions\/deploy-pages@/);
  assert.match(pages, /path: dist/);
  assert.match(pages, /pages: write/);
  assert.match(pages, /id-token: write/);
  const checks = read(".github/workflows/checks.yml");
  assert.match(checks, /npm run build/);
  assert.match(checks, /E2E_ROOT: dist/);
});
