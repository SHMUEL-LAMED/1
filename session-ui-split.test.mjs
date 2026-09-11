import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// עד לפיצול הזה, updateAdminUI שישבה ב-admin.js הייתה זו שציירה את שער
// הגישה, את סטטוס הכותרת ואת נעילת הגלריה — כלומר כל אורח, גם מי שלעולם
// לא ייגע בניהול, נאלץ להוריד את מודול הניהול רק כדי שמסך הכניסה ייראה.
// הבדיקות כאן נועלות את הגבול: שכבת הסשן נטענת תמיד, ומודול המגירה לא.

function withoutComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

const appJs = withoutComments(readFileSync(new URL("./app.js", import.meta.url), "utf8"));
const sessionJs = withoutComments(readFileSync(new URL("./session-ui.js", import.meta.url), "utf8"));
const adminJs = withoutComments(readFileSync(new URL("./admin.js", import.meta.url), "utf8"));
const driveJs = withoutComments(readFileSync(new URL("./drive-sync.js", import.meta.url), "utf8"));
const tailwindConfig = readFileSync(new URL("./tailwind.config.js", import.meta.url), "utf8");

// הרכיבים שכל מבקר רואה — הם חייבים להיות באחריות שכבת הסשן.
const SESSION_ELEMENTS = [
  "galleryAccessGate",
  "headerConnectionStatus",
  "floatingSignedInView",
  "googleSignedInView"
];

// הרכיבים שקיימים רק בתוך המגירה — הם רשאים להיטען מאוחר.
const DRAWER_ELEMENTS = [
  "sidebarAdminPanel",
  "sidebarLockStatus",
  "userUploadAccessCard",
  "superAdminUsersCard"
];

test("app.js אינו מייבא את מודול הניהול סטטית, ומייבא את שכבת הסשן", () => {
  assert.ok(
    !/^import\s+.*from\s+['"]\.\/admin\.js['"]/m.test(appJs),
    "ייבוא סטטי של admin.js מחזיר את המצב שבו כל אורח מוריד את הניהול"
  );
  assert.match(
    appJs,
    /^import\s+['"]\.\/session-ui\.js['"]/m,
    "שכבת הסשן חייבת להיטען תמיד — היא מציירת את מסך הכניסה"
  );
  assert.match(
    appJs,
    /defineLazyModule\(\(\)\s*=>\s*import\(['"]\.\/admin\.js['"]\)/,
    "admin.js חייב לרדת דרך מעטפת הטעינה העצלה"
  );
});

test("שער הגישה ונעילת הגלריה נמצאים בשכבת הסשן ולא במודול הניהול", () => {
  for (const id of SESSION_ELEMENTS) {
    assert.ok(
      sessionJs.includes(id),
      `${id} נראה לכל מבקר, ולכן הוא חייב להיות מטופל ב-session-ui.js`
    );
    assert.ok(
      !adminJs.includes(id),
      `${id} נותר ב-admin.js — מבקר בלי מודול הניהול לא יראה אותו`
    );
  }
  assert.match(
    sessionJs,
    /gallery-locked/,
    "נעילת הגלריה היא החלטת הגישה עצמה, והיא שייכת לשכבת הסשן"
  );
  assert.ok(
    !adminJs.includes("gallery-locked"),
    "נעילת הגלריה לא יכולה להיות תלויה במודול שאולי לא נטען"
  );
});

test("ממשק המגירה נשאר במודול הניהול ואינו נוגע בשכבת הסשן", () => {
  for (const id of DRAWER_ELEMENTS) {
    assert.ok(adminJs.includes(id), `${id} שייך למגירה ולכן נשאר ב-admin.js`);
    assert.ok(
      !sessionJs.includes(id),
      `${id} קיים רק במגירה — שכבת הסשן לא אמורה לגעת בו`
    );
  }
  assert.match(
    adminJs,
    /window\.updateAdminPanelUI\s*=/,
    "ממשק המגירה נחשף כ-updateAdminPanelUI"
  );
  // המגירה עשויה לא להיות בדף כלל, וזה חייב להיות מצב תקין ולא קריסה.
  assert.match(
    adminJs,
    /getElementById\('sidebarLockStatus'\)[\s\S]{0,200}?if\s*\(!statusBadge\)\s*return;/,
    "בלי המגירה בדף, ציור המגירה פשוט אינו קורה"
  );
});

test("שכבת הסשן קוראת לממשק המגירה רק אם הוא כבר נטען", () => {
  assert.match(
    sessionJs,
    /window\.updateAdminPanelUI\?\.\(\)/,
    "קריאה לא מוגנת הייתה קורסת אצל כל מבקר שאין לו את מודול הניהול"
  );
  assert.match(
    sessionJs,
    /window\.updateAdminUI\s*=\s*updateSessionUI/,
    "השם ההיסטורי updateAdminUI נשמר, כי מודולים אחרים עדיין קוראים לו"
  );
});

test("מאזיני הניהול סובלניים למודול שטרם ירד", () => {
  // המאזינים מופעלים ברגע שמתברר שזו כניסת מנהל, ועלולים לרוץ לפני
  // שמודול הניהול הספיק להגיע. קריאה לא מוגנת הייתה מפילה אותם.
  const listeners = driveJs.slice(driveJs.indexOf("function startAdminListeners()"));
  for (const fn of [
    "renderPendingImages",
    "updatePendingBadge",
    "renderPendingUsers",
    "renderManagedUsers",
    "updatePendingUsersBadge",
    "renderDeletionRequests",
    "updateAdminOverview"
  ]) {
    const unguarded = new RegExp(`window\\.${fn}\\(`);
    assert.ok(
      !unguarded.test(listeners),
      `window.${fn}() נקראת בלי הגנה — היא תקרוס לפני שמודול הניהול הגיע`
    );
  }
  assert.match(
    driveJs,
    /ensureAdminModuleForSession\(\)/,
    "כניסת מנהל חייבת למשוך את מודול הניהול ולצייר מחדש"
  );
});

test("שכבת הסשן נסרקת על ידי Tailwind, אחרת תגי הדרגות יאבדו את צבעם", () => {
  assert.match(
    tailwindConfig,
    /["']\.\/session-ui\.js["']/,
    "מחרוזות המחלקות עברו ל-session-ui.js; בלי סריקה הן ייגזרו מהפלט"
  );
});
