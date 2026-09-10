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

const appJs = withoutComments(readFileSync(new URL("./app.js", import.meta.url), "utf8"));
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

// קטע הקוד שמטפל בפתיחת לוח האינדוקס במגירת הניהול.
function faceIndexPanelBlock() {
  const start = appJs.indexOf("if (contentId === 'accFaceIndex')");
  assert.ok(start > -1, "מסלול פתיחת לוח האינדוקס לא נמצא ב-app.js");
  return appJs.slice(start, start + 700);
}

// בדיקת "אינדוקס פנים בענן" שבמסך בדיקת המערכת.
function healthCheckBlock() {
  const start = appJs.indexOf("label: 'אינדוקס פנים בענן'");
  assert.ok(start > -1, "בדיקת אינדוקס הפנים לא נמצאה ב-app.js");
  return appJs.slice(start, start + 700);
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

// loadFaceApi מוגדרת ב-face-search.js ואינה רשומה כ-placeholder, אבל
// face-index.js משתמש בה כדי לטעון את מנוע הזיהוי. אינדוקס שהתחיל לפני
// שנפתח כלי חיפוש הפנים נעצר על "window.loadFaceApi is not a function".
const faceSearchJs = withoutComments(readFileSync(new URL("./face-search.js", import.meta.url), "utf8"));

function faceSearchPlaceholders() {
  const start = appJs.indexOf("const ensureFaceSearchModule = defineLazyModule(");
  assert.ok(start > -1, "ensureFaceSearchModule לא נמצאה ב-app.js");
  const block = appJs.slice(start, appJs.indexOf("]);", start));
  return [...block.matchAll(/'(\w+)'/g)].map(match => match[1]);
}

test("loadFaceApi מגיעה ממודול עצל אחר, ולכן אינדוקס הפנים חייב לטעון אותו", () => {
  assert.match(
    faceSearchJs,
    /^window\.loadFaceApi\s*=/m,
    "loadFaceApi אמורה להיות מוגדרת ב-face-search.js"
  );
  assert.ok(
    !faceSearchPlaceholders().includes("loadFaceApi"),
    "loadFaceApi אינה placeholder, ולכן היא פשוט אינה קיימת עד לטעינת המודול"
  );

  // אין קריאה ישירה ל-window.loadFaceApi בלי טעינת המודול שלפניה.
  const direct = [...faceIndexCode.matchAll(/await\s+window\.loadFaceApi\s*\(/g)];
  assert.equal(
    direct.length,
    0,
    "קריאה ישירה ל-window.loadFaceApi נכשלת כשכלי חיפוש הפנים עוד לא נפתח"
  );
});

test("עוזר טעינת המנוע ממתין ל-ensureFaceSearchModule ומדווח בבירור על כישלון", () => {
  const start = faceIndexCode.indexOf("async function loadFaceApiEngine()");
  assert.ok(start > -1, "loadFaceApiEngine חסרה — אין מי שיטען את מנוע הזיהוי");
  const body = faceIndexCode.slice(start, start + 400);

  const ensureAt = body.indexOf("ensureFaceSearchModule");
  const callAt = body.indexOf("window.loadFaceApi()");
  assert.ok(ensureAt > -1, "העוזר חייב לטעון את face-search.js לפני השימוש");
  assert.ok(ensureAt < callAt, "הטעינה חייבת להקדים את הקריאה למנוע");
  assert.match(
    body,
    /typeof\s+window\.loadFaceApi\s*!==\s*'function'/,
    "אם המנוע עדיין חסר, יש לדווח הודעה ברורה ולא TypeError"
  );

  // שני מסלולי האינדוקס — הידני והאוטומטי — עוברים דרך אותו עוזר.
  const uses = [...faceIndexCode.matchAll(/await\s+loadFaceApiEngine\s*\(/g)];
  assert.equal(uses.length, 2, "גם האינדוקס הידני וגם האוטומטי חייבים לעבור דרך העוזר");
});
