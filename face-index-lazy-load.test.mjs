import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// face-index.js נטען עצלה. הפונקציות שהוא מגדיר על window אינן קיימות עד
// שהמודול יורד בפועל, ולכן כל קריאה אליהן חייבת להמתין ל-ensureFaceIndexModule.
// בלי ההמתנה `window.refreshFaceIndexSummary?.()` הוא no-op שמחזיר undefined:
// בדיקת המערכת דיווחה "מצב האינדוקס אינו זמין" גם כשהאינדוקס תקין לחלוטין,
// ולוח האינדוקס נתקע לנצח על "טוען את מצב האינדוקס…".

// ההערות מוסרות לפני הניתוח: הערה שמזכירה שם פונקציה אינה קריאה אליה,
// והיא הייתה משבשת את בדיקת הסדר שבין טעינת המודול לשימוש בו.
function withoutComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

// המעטפת העצלה נשארה בתשתית המשותפת (app.js), אבל לוח האינדוקס ובדיקת
// המערכת עברו לדף הניהול הנפרד ולכן נבדקים ב-admin-ui.js.
const appJs = withoutComments(readFileSync(new URL("./app.js", import.meta.url), "utf8"));
const adminUiJs = withoutComments(readFileSync(new URL("./admin-ui.js", import.meta.url), "utf8"));
const faceIndexJs = readFileSync(new URL("./face-index.js", import.meta.url), "utf8");
const faceIndexCode = withoutComments(faceIndexJs);

// שמות הפונקציות שמוגדרות על window רק בתוך המודול העצל.
function lazyDefinedNames() {
  return [...faceIndexCode.matchAll(/^window\.(\w+)\s*=/gm)].map(match => match[1]);
}

// רשימת ה-placeholders שהמעטפת רושמת מראש על window עבור face-index.js.
function registeredPlaceholders() {
  const start = appJs.indexOf("const ensureFaceIndexModule = defineLazyModule(");
  assert.ok(start > -1, "ensureFaceIndexModule לא נמצאה ב-app.js");
  const block = appJs.slice(start, appJs.indexOf("]);", start));
  return [...block.matchAll(/'(\w+)'/g)].map(match => match[1]);
}

// קטע הקוד שמטפל בפתיחת לוח האינדוקס בלוח הניהול.
function faceIndexPanelBlock() {
  const start = adminUiJs.indexOf("if (viewId === 'faceindex')");
  assert.ok(start > -1, "מסלול פתיחת מסך האינדוקס לא נמצא ב-admin-ui.js");
  return adminUiJs.slice(start, start + 700);
}

// בדיקת "אינדוקס פנים בענן" שבמסך בדיקת המערכת.
function healthCheckBlock() {
  const start = adminUiJs.indexOf("label: 'אינדוקס פנים בענן'");
  assert.ok(start > -1, "בדיקת אינדוקס הפנים לא נמצאה ב-admin-ui.js");
  return adminUiJs.slice(start, start + 700);
}

test("refreshFaceIndexSummary מוגדרת רק במודול העצל, ולכן חייבת המתנה לטעינה", () => {
  const defined = lazyDefinedNames();
  assert.ok(
    defined.includes("refreshFaceIndexSummary"),
    "refreshFaceIndexSummary אמורה להיות מוגדרת בתוך face-index.js"
  );
  assert.ok(
    defined.includes("renderFaceIndexPanel"),
    "renderFaceIndexPanel אמורה להיות מוגדרת בתוך face-index.js"
  );

  // אלה בדיוק השמות שאינם רשומים כ-placeholders, ומכאן מקור התקלה.
  const placeholders = registeredPlaceholders();
  assert.ok(
    !placeholders.includes("refreshFaceIndexSummary"),
    "אם השם נרשם כ-placeholder, המעטפת מחזירה undefined ולא את המצב עצמו"
  );
});

test("בדיקת המערכת טוענת את מודול האינדוקס לפני שהיא קוראת את המצב", () => {
  const block = healthCheckBlock();
  const ensureAt = block.indexOf("ensureFaceIndexModule");
  const readAt = block.indexOf("refreshFaceIndexSummary");

  assert.ok(ensureAt > -1, "בלי ensureFaceIndexModule הבדיקה תדווח 'מצב האינדוקס אינו זמין' תמיד");
  assert.ok(readAt > -1, "הבדיקה אמורה לקרוא את מצב האינדוקס");
  assert.ok(ensureAt < readAt, "טעינת המודול חייבת להקדים את קריאת המצב");
  assert.match(
    block.slice(ensureAt - 20, readAt),
    /await\s+window\.ensureFaceIndexModule/,
    "יש להמתין לטעינה בפועל, אחרת הקריאה עדיין תרוץ לפני שהמודול קיים"
  );
});

test("פתיחת לוח האינדוקס טוענת את המודול לפני הציור והקריאה", () => {
  const block = faceIndexPanelBlock();
  const ensureAt = block.indexOf("ensureFaceIndexModule");
  const renderAt = block.indexOf("renderFaceIndexPanel");
  const readAt = block.indexOf("refreshFaceIndexSummary");

  assert.ok(ensureAt > -1, "בלי טעינת המודול הלוח נתקע על 'טוען את מצב האינדוקס…'");
  assert.ok(ensureAt < renderAt, "טעינת המודול חייבת להקדים את ציור הלוח");
  assert.ok(ensureAt < readAt, "טעינת המודול חייבת להקדים את קריאת המצב");
});

test("כישלון בקריאת המצב מוצג כתקלה, ולא כטעינה שנמשכת לנצח", () => {
  assert.match(
    faceIndexCode,
    /faceIndexSummaryError\s*=\s*error/,
    "יש לשמור את תקלת הקריאה כדי שאפשר יהיה להציג אותה"
  );
  assert.match(
    faceIndexCode,
    /faceIndexSummaryError\s*\?[\s\S]{0,120}טוען את מצב האינדוקס/,
    "הלוח אמור להבחין בין תקלת קריאה לבין טעינה שעדיין נמשכת"
  );

  // ניקוי המטמון מאפס גם את התקלה, אחרת יוצג "לא ניתן לטעון" לפני ניסיון חדש.
  const invalidation = faceIndexCode.slice(faceIndexCode.indexOf("faceIndexSummaryCache = null;", 200));
  assert.match(
    invalidation.slice(0, 200),
    /faceIndexSummaryError\s*=\s*null/,
    "ניקוי המטמון חייב לאפס גם את תקלת הקריאה האחרונה"
  );
});
