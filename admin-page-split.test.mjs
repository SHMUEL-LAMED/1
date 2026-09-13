// בדיקות ההפרדה בין דף הגלריה לדף הניהול.
//
// עד השינוי הזה מודול הניהול נטען בכל כניסה לאתר, משום ש-updateAdminUI
// שב-admin.js ציירה גם את שער הגישה, את נעילת הגלריה ואת כרטיס הפרופיל —
// כלומר כל אורח נאלץ להוריד את הניהול רק כדי לראות מסך התחברות.
//
// עכשיו הניהול חי ב-admin.html בלבד. הבדיקות כאן נועלות את שני הצדדים:
// שדף הגלריה באמת אינו טוען ואינו מכיל ניהול, ושדף הניהול שלם בלי לחזור
// להישען על markup שנשאר בגלריה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const indexHtml = read("index.html");
const adminHtml = read("admin.html");
const appJs = read("app.js");
const adminAppJs = read("admin-app.js");
const adminJs = read("admin.js");
const sessionUiJs = read("session-ui.js");
const swJs = read("sw.js");
const driveSyncJs = read("drive-sync.js");
const sessionAuthJs = read("session-auth.js");
const chatJs = read("chat.js");

// מרקאפ ניהול שאסור שיישאר בדף הגלריה. כל אחד מאלה גרר בעבר גם את הקוד
// שמצייר אותו.
const ADMIN_MARKUP_IDS = [
  "sidebarAdminPanel",
  "adminTaskModal",
  "adminCategoryModal",
  "adminMessagesCenterModal",
  "backupRestoreModal",
  "advancedAnalyticsModal",
  "directEmailModal"
];

test("דף הגלריה אינו מכיל את מרקאפ הניהול", () => {
  for (const id of ADMIN_MARKUP_IDS) {
    assert.ok(
      !indexHtml.includes(`id="${id}"`),
      `${id} עדיין ב-index.html — הניהול אמור לחיות ב-admin.html בלבד`
    );
    assert.ok(adminHtml.includes(`id="${id}"`), `${id} חסר ב-admin.html`);
  }
});

test("דף הגלריה טוען רק את app.js, ו-app.js אינו מייבא שום מודול ניהול", () => {
  assert.match(indexHtml, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.ok(!indexHtml.includes("admin-app.js"), "דף הגלריה אינו אמור לטעון את נקודת הכניסה של הניהול");

  // ייבוא סטטי של מודול ניהול היה גורר אותו לכל מבקר.
  const staticImports = [...appJs.matchAll(/^import\s[^\n]*from\s+'([^']+)'/gm)].map(match => match[1]);
  for (const module of ["./admin.js", "./admin-ui.js", "./admin-app.js", "./drive-sync.js", "./chat-admin.js", "./popup-admin.js"]) {
    assert.ok(
      !staticImports.includes(module),
      `app.js מייבא סטטית את ${module} — זו בדיוק הטעינה שהשינוי בא למנוע`
    );
  }

  // chat-admin.js מוזכר ב-app.js רק בתוך הענף של דף הניהול, כייבוא עצל.
  const adminBranch = appJs.slice(appJs.indexOf("if (PAGE_MODE === 'admin') {"));
  const mentionsOutsideBranch = appJs.slice(0, appJs.indexOf("if (PAGE_MODE === 'admin') {")).includes("chat-admin.js");
  assert.ok(!mentionsOutsideBranch, "chat-admin.js אינו אמור להופיע מחוץ לענף של דף הניהול");
  assert.ok(adminBranch.includes("import('./chat-admin.js')"), "בדף הניהול המודול נטען עצלה");
});

test("דף הניהול טוען את נקודת הכניסה שלו, והיא מושכת את התשתית ואת הניהול", () => {
  assert.match(adminHtml, /<script type="module" src="\.\/admin-app\.js"><\/script>/);
  assert.match(adminHtml, /<html[^>]*data-page="admin"/, "דף הניהול חייב לסמן את עצמו כדי ש-drive-sync ידע היכן הוא רץ");
  for (const module of ["./app.js", "./admin.js", "./admin-ui.js", "./drive-sync.js", "./popup-admin.js"]) {
    assert.ok(adminAppJs.includes(module), `admin-app.js חייב לייבא את ${module}`);
  }
});

test("שכבת ההתחברות עובדת בלי מודול ה-Drive", () => {
  // drive-sync.js נטען רק בדף הניהול, ולכן כל קריאה אליו משכבת ההתחברות
  // חייבת להיות אופציונלית — אחרת הגלריה נופלת על התחברות או התנתקות.
  for (const call of ["clearDriveConnection", "restoreDriveConnection", "startAdminListeners", "stopAdminListeners"]) {
    const direct = new RegExp(`(?<![\\w.?])${call}\\(`, "g");
    const hits = [...sessionAuthJs.matchAll(direct)];
    assert.equal(hits.length, 0, `${call} נקראת ישירות ב-session-auth.js — חייב window.${call}?.()`);
    assert.ok(sessionAuthJs.includes(`window.${call}?.(`), `${call} אמורה להיקרא באופן אופציונלי`);
  }
  // ומנגד: המודול הניהולי חייב לחשוף אותן.
  for (const name of ["startAdminListeners", "stopAdminListeners", "clearDriveConnection"]) {
    assert.match(driveSyncJs, new RegExp(`window\\.${name}\\s*=`), `drive-sync.js חייב לחשוף את ${name}`);
  }
});

test("מרכז ההודעות הניהולי נפרד מהצ׳אט של המשתמש", () => {
  const chatAdminJs = read("chat-admin.js");
  for (const name of ["renderAdminMessageUsers", "sendAdminBulkMessages", "openAdminMessagesCenter"]) {
    assert.ok(chatAdminJs.includes(`window.${name}`), `${name} אמורה לחיות ב-chat-admin.js`);
    assert.ok(!chatJs.includes(`window.${name} =`), `${name} עדיין מוגדרת ב-chat.js`);
  }
  // תיבת ההודעות של המשתמש והתג נשארו בצד המשותף.
  assert.ok(chatJs.includes("window.renderFloatingInbox"), "תיבת ההודעות שייכת לכל משתמש מחובר");
  assert.ok(chatJs.includes("window.openUserConversation"), "פנייה למנהל שייכת לכל משתמש מחובר");
  // המעטפת העצלה של מרכז ההודעות נרשמת רק בדף הניהול.
  const gate = appJs.slice(appJs.indexOf("ensureChatAdminModule"));
  assert.match(appJs, /if \(PAGE_MODE === 'admin'\) \{/, "המעטפת הניהולית נרשמת רק בדף הניהול");
  assert.ok(gate.includes("chat-admin.js"));
});

test("עריכת הודעת הפופ-אפ נפרדה מהצגתה", () => {
  const popupJs = read("popup-announcement.js");
  const popupAdminJs = read("popup-admin.js");
  for (const name of ["savePopupAnnouncement", "renderPopupAnnouncementAdmin", "deletePopupAnnouncement", "updatePopupLinkTypeUI"]) {
    assert.ok(popupAdminJs.includes(`window.${name}`), `${name} אמורה לחיות ב-popup-admin.js`);
    assert.ok(!popupJs.includes(`window.${name} =`), `${name} עדיין מוגדרת במודול הצופה`);
  }
  // הבדיקה popup-feature-targets.test.mjs מייבאת את אלה מהמודול הצופה.
  for (const name of ["POPUP_FEATURE_TARGETS", "resolvePopupFeature", "popupAnnouncementActionInfo"]) {
    assert.ok(popupJs.includes(`export const ${name}`) || popupJs.includes(`export function ${name}`),
      `${name} חייב להישאר מיוצא מ-popup-announcement.js`);
  }
  assert.ok(popupJs.includes("window.showPopupAnnouncement"), "הצגת ההודעה למבקר נשארת במודול הצופה");
});

test("שער הגישה ונעילת הגלריה אינם תלויים עוד במודול הניהול", () => {
  // זה הלב של התקלה הישנה: updateAdminUI יצאה מיד אם #sidebarLockStatus
  // חסר, וכל מה שמתחת — כולל שער הגישה — לא רץ. הפונקציה הראשית חייבת
  // להגיע לעדכון השער בלי שום יציאה מוקדמת לפניו.
  const entry = sessionUiJs.slice(
    sessionUiJs.indexOf("function updateSessionUI()"),
    sessionUiJs.indexOf("window.updateSessionUI = updateSessionUI;")
  );
  assert.ok(entry.includes("updateAccessGate("), "הפונקציה הראשית חייבת לעדכן את שער הגישה");
  assert.ok(
    !/\breturn\b/.test(entry.slice(0, entry.indexOf("updateAccessGate("))),
    "אסור ליציאה מוקדמת לחסום את עדכון שער הגישה"
  );

  assert.match(sessionUiJs, /gallery-locked/);
  assert.match(sessionUiJs, /galleryAccessGate/);
  assert.match(sessionUiJs, /window\.updateAdminUI\s*=\s*updateSessionUI/, "השם הישן חייב להמשיך לעבוד עבור drive-sync.js");

  // והצד השני: admin.js כבר אינו מגדיר את updateAdminUI ואינו מצייר את השער.
  assert.ok(!adminJs.includes("window.updateAdminUI ="), "admin.js אינו אמור להגדיר יותר את updateAdminUI");
  assert.ok(!adminJs.includes("galleryAccessGate"), "שער הגישה אינו עניינו של מודול הניהול");
  assert.match(adminJs, /window\.updateAdminPanelUI\s*=\s*function/);
});

test("לוח הניהול מצויר רק כשהמרקאפ שלו קיים בדף", () => {
  const start = adminJs.indexOf("window.updateAdminPanelUI = function");
  const head = adminJs.slice(start, start + 400);
  assert.match(head, /if \(!adminPanel\) return;/, "בדף שאין בו לוח ניהול הפונקציה חייבת לצאת בשקט");
});

test("אוספי הניהול נקראים רק בדף הניהול", () => {
  const start = driveSyncJs.indexOf("function startAdminListeners()");
  assert.ok(start > -1);
  const head = driveSyncJs.slice(start, start + 500);
  assert.match(head, /window\.PAGE_MODE !== 'admin'/, "בדף הגלריה אין מי שיצייר את נתוני הניהול");
  assert.match(appJs, /window\.PAGE_MODE = PAGE_MODE/);
});

test("כל משימת ניהול מוצאת את הכרטיס שלה בדף הניהול", () => {
  // openAdminTaskWindow מעביר את הכרטיס עצמו לתוך חלון המשימה. אם הכרטיס
  // נשאר מאחור בדף הגלריה, החלון נפתח ריק.
  const adminUiJs = read("admin-ui.js");
  const block = adminUiJs.slice(
    adminUiJs.indexOf("const adminTaskDefinitions"),
    adminUiJs.indexOf("let activeAdminTask")
  );
  const taskIds = [...block.matchAll(/^ {4}(acc\w+):/gm)].map(match => match[1]);
  assert.ok(taskIds.length >= 10, "רשימת המשימות לא נקראה כראוי");
  for (const id of taskIds) {
    assert.ok(adminHtml.includes(`id="${id}"`), `הכרטיס ${id} חסר ב-admin.html`);
  }
});

test("המנהל מגיע ללוח מהאתר, ומרכז ההודעות מנווט אליו גם הוא", () => {
  assert.ok(indexHtml.includes('href="./admin.html"'), "לאתר חייב להיות קישור אל לוח הניהול");
  assert.match(appJs, /window\.location\.assign\('\.\/admin\.html'\)/);
  assert.match(appJs, /window\.location\.assign\('\.\/admin\.html#messages'\)/);
  assert.ok(
    !indexHtml.includes("openAdminMessagesCenter()"),
    "מרכז ההודעות חי בדף הניהול, ולכן הגלריה רק מנווטת אליו"
  );
});

test("ה-Service Worker מכיר יותר מדף אחד", () => {
  // הגרסה הקודמת שמרה כל ניווט תחת ./index.html, כך שבקשה ל-admin.html
  // הייתה מוגשת מהמטמון כדף הגלריה.
  assert.match(swJs, /function navigationCacheKey\(url\)/);
  const handler = swJs.slice(swJs.indexOf('request.mode === "navigate"'));
  assert.ok(
    !/cache\.put\("\.\/index\.html"/.test(handler),
    "אסור לשמור כל ניווט תחת index.html"
  );

  const shell = swJs.slice(swJs.indexOf("const APP_SHELL"), swJs.indexOf("];", swJs.indexOf("const APP_SHELL")));
  assert.ok(shell.includes('"./session-ui.js"'), "שכבת הסשן נדרשת לכל מבקר");
  assert.ok(shell.includes('"./session-auth.js"'), "שכבת ההתחברות נדרשת לכל מבקר");
  for (const asset of [
    '"./admin.html"', '"./admin.js"', '"./admin-ui.js"', '"./admin-app.js"',
    '"./drive-sync.js"', '"./chat-admin.js"', '"./popup-admin.js"'
  ]) {
    assert.ok(!shell.includes(asset), `${asset} אינו אמור לרדת מראש למבקר רגיל`);
  }
});

test("הקבצים החדשים נכללים בבנייה ובבדיקת התחביר", () => {
  const tailwind = read("tailwind.config.js");
  const pkg = read("package.json");
  for (const file of ["session-ui.js", "admin-ui.js", "admin-app.js", "session-auth.js", "chat-admin.js", "popup-admin.js"]) {
    assert.ok(tailwind.includes(file), `${file} חסר בסריקת Tailwind`);
    assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
  }
  assert.ok(tailwind.includes("admin.html"), "admin.html חסר בסריקת Tailwind — הדף היה נטען בלי עיצוב");
});
