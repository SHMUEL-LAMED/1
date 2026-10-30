// "מדריך למנהלים" (admin-guide.js): המבנה של הסעיפים, הכתובת #guide/<סעיף>,
// ההדגשה, החיפוש בתוך המדריך — והקשר לקוד: כל "?" ב-admin.html וכל מסך
// שהמדריך מפנה אליו קיימים, ומה שהמדריך מונה (כלי הפופ-אפ, סוג הרגע) תואם
// את המודולים עצמם. מדריך שמתאר מסך שנמחק גרוע מבלי מדריך.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GUIDE_SECTIONS,
  GUIDE_VIEW_ID,
  guideSectionIds,
  findGuideSection,
  guideSectionsForView,
  guideHash,
  parseGuideHash,
  splitEmphasis,
  guideSectionText,
  filterGuideSections,
  guideFilterMessage
} from "./admin-guide.js";
import { SCENE_TAGS, CAPTION_MAX_LENGTH } from "./scene-tags.js";
import { ALBUM_MAX_ITEMS } from "./print-album.js";
import { SWIPE_UNDO_MS, keyAction, swipeActionForDx } from "./pending-swipe-model.js";
import {
  DEFAULT_WATERMARK_TEXT, WATERMARK_TEXT_MAX, shouldWatermark, watermarkOutputType, stripJpegMetadata
} from "./download-privacy.js";

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const adminHtml = read("admin.html");
const adminUiJs = read("admin-ui.js");

// הרשומות של ADMIN_VIEWS: המזהה, ואם המסך פתוח רק למנהל־על. כל רשומה
// מתחילה ב-"id:" בהזחה של שמונה רווחים, והדגל שלה יושב לפני ה-id הבא.
function registeredViews() {
  const block = adminUiJs.slice(adminUiJs.indexOf("const ADMIN_VIEWS = ["), adminUiJs.indexOf("const VIEW_GROUPS"));
  const starts = [...block.matchAll(/^\s{8}id: '([\w-]+)',/gm)];
  return starts.map((match, index) => {
    const body = block.slice(match.index, starts[index + 1]?.index ?? block.length);
    return { id: match[1], superAdminOnly: /^\s{8}superAdminOnly: true,/m.test(body) };
  });
}

function registeredViewIds() {
  return registeredViews().map(view => view.id);
}

function allTexts(section) {
  return [section.title, section.summary, ...section.blocks.flatMap(block => block.items || [block.text])];
}

test("לכל סעיף מזהה ייחודי, כותרת עברית, תקציר ותוכן", () => {
  const ids = guideSectionIds();
  assert.equal(new Set(ids).size, ids.length, "מזהה סעיף חוזר פעמיים");
  for (const section of GUIDE_SECTIONS) {
    assert.match(section.id, /^[a-z]+$/, `${section.id}: מזהה חייב להיות אותיות לטיניות קטנות (הוא חלק מהכתובת)`);
    assert.match(section.title, /[א-ת]/, `${section.id}: כותרת בלי עברית`);
    assert.match(section.summary, /[א-ת]/, `${section.id}: תקציר בלי עברית`);
    assert.ok(section.blocks.length > 0, `${section.id}: סעיף ריק`);
    for (const block of section.blocks) {
      assert.ok(["p", "h", "list", "steps", "note"].includes(block.type), `${section.id}: סוג בלוק לא מוכר ${block.type}`);
      if (block.items) assert.ok(block.items.length > 0, `${section.id}: רשימה ריקה`);
      else assert.ok(String(block.text).trim(), `${section.id}: בלוק בלי טקסט`);
    }
  }
});

test("המדריך מכסה את כל הנושאים שהוא אמור להסביר", () => {
  for (const id of ["start", "uploads", "drive", "folders", "people", "ai", "backfills", "popup", "downloads", "users", "errors", "features"]) {
    assert.ok(findGuideSection(id), `הסעיף ${id} חסר במדריך`);
  }
});

test("כל מסך בלוח מוסבר בסעיף כלשהו, וסעיף של מסכי מנהל־על מסומן כך", () => {
  // מסך שנוסף ל-ADMIN_VIEWS בלי סעיף הוא מסך שהמדריך שותק עליו.
  const views = registeredViews();
  for (const { id } of views) {
    if (id === GUIDE_VIEW_ID) continue;
    assert.ok(guideSectionsForView(id).length > 0, `המסך ${id} אינו מוסבר באף סעיף במדריך`);
  }
  // סעיף שמסומן "מנהל־על" מסביר רק מסכים של דרגה 4. (סעיף המשתמשים אינו
  // מסומן בכוונה: הדרגות שהוא מסביר נוגעות לכל מנהל.)
  const superOnly = new Set(views.filter(view => view.superAdminOnly).map(view => view.id));
  for (const section of GUIDE_SECTIONS.filter(item => item.superAdminOnly)) {
    for (const view of section.views) assert.ok(superOnly.has(view), `${section.id}: מסומן מנהל־על, אבל ${view} פתוח לכל מנהל`);
  }
  for (const id of ["downloads", "popup"]) {
    assert.ok(superOnly.has(id), `${id} אמור להיות מסך של מנהל־על`);
    assert.equal(findGuideSection(id).superAdminOnly, true, `הסעיף ${id} אינו מסומן מנהל־על`);
  }
});

test("כל הדגשה נסגרת, ואין HTML בתוכן", () => {
  for (const section of GUIDE_SECTIONS) {
    for (const text of allTexts(section)) {
      assert.equal(String(text).split("**").length % 2, 1, `${section.id}: הדגשה שלא נסגרה ב"${text}"`);
      assert.doesNotMatch(String(text), /<[a-z/]/i, `${section.id}: תגית HTML בתוכן — הכול מצויר כטקסט`);
    }
  }
});

test("המסך רשום ב-ADMIN_VIEWS, וכל מסך שהמדריך מפנה אליו קיים", () => {
  const views = new Set(registeredViewIds());
  assert.ok(views.has(GUIDE_VIEW_ID), "המסך guide אינו רשום ב-ADMIN_VIEWS");
  for (const section of GUIDE_SECTIONS) {
    for (const view of section.views) {
      assert.ok(views.has(view), `${section.id} מפנה למסך ${view} שאינו קיים`);
    }
  }
  assert.ok(adminHtml.includes('id="view-guide"') && adminHtml.includes('id="adminGuideRoot"'), "חסר section של המדריך ב-admin.html");
});

test('כל "?" ב-admin.html פותח סעיף קיים, ויש כמה כאלה', () => {
  const targets = [...adminHtml.matchAll(/onclick="openAdminGuide\('([\w-]+)'\)" data-guide-target="([\w-]+)"/g)];
  assert.ok(targets.length >= 5, `נמצאו רק ${targets.length} קישורי "?"`);
  for (const [, onclickTarget, dataTarget] of targets) {
    assert.equal(onclickTarget, dataTarget);
    assert.ok(findGuideSection(onclickTarget), `"?" מפנה לסעיף ${onclickTarget} שאינו קיים`);
  }
  // לכל כפתור יש שם נגיש, והסימן עצמו מוסתר מקוראי מסך.
  const buttons = adminHtml.match(/<button[^>]*class="admin-help-link"[^>]*>.*?<\/button>/g) || [];
  assert.equal(buttons.length, targets.length);
  for (const button of buttons) {
    assert.match(button, /aria-label="הסבר במדריך למנהלים: [^"]+"/);
    assert.match(button, /<span aria-hidden="true">\?<\/span>/);
  }
  // ה-"?" יושב בתוך מסך שהסעיף שלו באמת מסביר, ושם הנגיש הוא כותרת הסעיף.
  for (const match of adminHtml.matchAll(/<button[^>]*class="admin-help-link"[^>]*data-guide-target="([\w-]+)"[^>]*aria-label="הסבר במדריך למנהלים: ([^"]+)"/g)) {
    const before = adminHtml.slice(0, match.index);
    const view = [...before.matchAll(/<section id="view-([\w-]+)"/g)].pop()?.[1];
    const section = findGuideSection(match[1]);
    assert.ok(section.views.includes(view), `"?" במסך ${view} פותח את ${section.id}, שאינו מסביר את המסך הזה`);
    assert.equal(match[2], section.title);
  }
  // למסך "הורדות ופרטיות" יש "?" משלו.
  const downloadsView = adminHtml.slice(adminHtml.indexOf('<section id="view-downloads"'));
  assert.ok(downloadsView.slice(0, downloadsView.indexOf("</section>")).includes('data-guide-target="downloads"'),
    'חסר "?" במסך הורדות ופרטיות');
});

test("סעיף לפי מסך", () => {
  assert.deepEqual(guideSectionsForView("drive").map(section => section.id), ["drive"]);
  assert.deepEqual(guideSectionsForView("capturedates").map(section => section.id), ["backfills"]);
  assert.deepEqual(guideSectionsForView("nope"), []);
});

test("הכתובת #guide/<סעיף>: בנייה ופירוש", () => {
  assert.equal(guideHash("drive"), "#guide/drive");
  assert.equal(guideHash(""), "#guide");
  assert.equal(guideHash("nope"), "#guide", "מזהה לא מוכר נופל למדריך כולו");

  assert.deepEqual(parseGuideHash("#guide/drive"), { section: "drive" });
  assert.deepEqual(parseGuideHash("guide/people"), { section: "people" });
  assert.deepEqual(parseGuideHash("#guide"), { section: "" });
  assert.deepEqual(parseGuideHash("#guide/nope"), { section: "" });
  assert.deepEqual(parseGuideHash("#guide/%E0%A4%A"), { section: "" }, "קידוד שבור אינו זורק");
  assert.equal(parseGuideHash("#drive"), null);
  assert.equal(parseGuideHash("#guides/drive"), null);
  assert.equal(parseGuideHash(""), null);
  for (const id of guideSectionIds()) assert.deepEqual(parseGuideHash(guideHash(id)), { section: id });
});

test("הדגשה: חלקים מודגשים ורגילים, וסימן שלא נסגר נשאר טקסט", () => {
  assert.deepEqual(splitEmphasis("לוחצים **אשר נבחרים** ומסיימים"), [
    { text: "לוחצים ", strong: false },
    { text: "אשר נבחרים", strong: true },
    { text: " ומסיימים", strong: false }
  ]);
  assert.deepEqual(splitEmphasis("**הכול**"), [{ text: "הכול", strong: true }]);
  assert.deepEqual(splitEmphasis("בלי הדגשה"), [{ text: "בלי הדגשה", strong: false }]);
  assert.deepEqual(splitEmphasis("**פתוח בלי סוף"), [{ text: "**פתוח בלי סוף", strong: false }]);
  assert.deepEqual(splitEmphasis("א **ב** ג **ד"), [
    { text: "א ", strong: false },
    { text: "ב", strong: true },
    { text: " ג **ד", strong: false }
  ]);
  assert.deepEqual(splitEmphasis(null), []);
});

test("טקסט הסעיף לחיפוש: בלי סימני הדגשה, עם הכותרת, התקציר והרשימות", () => {
  const text = guideSectionText(findGuideSection("uploads"));
  assert.ok(!text.includes("**"));
  assert.ok(text.includes("העלאות ואישור תוכן"));
  assert.ok(text.includes("נסה שוב קבצים שנכשלו"));
  assert.equal(guideSectionText(null), "");
});

test("חיפוש במדריך: כל מילה חייבת להופיע, ועברית מקופלת", () => {
  assert.deepEqual(filterGuideSections(""), guideSectionIds());
  assert.deepEqual(filterGuideSections("   "), guideSectionIds());
  assert.ok(filterGuideSections("Drive").includes("drive"));
  assert.ok(filterGuideSections("מוסיף ומעדכן").includes("drive"));
  // אות סופית וגרשיים אינם משנים: "מנהל-על" ו"מנהל־על" שווים.
  assert.ok(filterGuideSections("מנהל-על").includes("users"));
  assert.ok(filterGuideSections("zip").includes("features"));
  assert.ok(filterGuideSections("פופאפ").includes("popup"));
  assert.deepEqual(filterGuideSections("מילה שאין בשום מקום"), []);
  // שתי מילים — רק סעיפים שבהם שתיהן.
  const both = filterGuideSections("סרטון פוסטר");
  assert.ok(both.length > 0);
  for (const id of both) {
    const text = guideSectionText(findGuideSection(id));
    assert.ok(text.includes("סרטון") && text.includes("פוסטר"), id);
  }
});

test("ההודעה אחרי חיפוש", () => {
  assert.equal(guideFilterMessage(12, 12, ""), "12 סעיפים במדריך.");
  assert.equal(guideFilterMessage(0, 12, "x"), "לא נמצא סעיף מתאים. נסו מילה אחרת.");
  assert.equal(guideFilterMessage(1, 12, "x"), "נמצא סעיף אחד.");
  assert.equal(guideFilterMessage(3, 12, "x"), "נמצאו 3 סעיפים.");
});

test("מה שהמדריך מונה תואם את הקוד", () => {
  // סוג הרגע, אורך הכיתוב ותקרת האלבום נקראים מהמודולים עצמם.
  const ai = guideSectionText(findGuideSection("ai"));
  for (const tag of SCENE_TAGS) assert.ok(ai.includes(tag.label), `התגית ${tag.label} חסרה במדריך`);
  assert.ok(ai.includes(String(CAPTION_MAX_LENGTH)));
  assert.ok(guideSectionText(findGuideSection("features")).includes(String(ALBUM_MAX_ITEMS)));

  // כלי הפופ-אפ: כל תווית ב-POPUP_FEATURE_TARGETS מופיעה בסעיף, כפי שהיא.
  const popupJs = read("popup-announcement.js");
  const targets = popupJs.slice(popupJs.indexOf("POPUP_FEATURE_TARGETS = ["), popupJs.indexOf("export function resolvePopupFeature"));
  const labels = [...targets.matchAll(/label: '([^']+)'/g)].map(match => match[1]);
  assert.equal(labels.length, 6);
  const popup = guideSectionText(findGuideSection("popup"));
  for (const label of labels) assert.ok(popup.includes(label), `הכלי "${label}" חסר בסעיף הפופ-אפ`);

  // שמות הכפתורים שהמדריך מצטט קיימים במרקאפ של הלוח.
  for (const button of ["אשר נבחרים", "בקש מחיקה", "סמן הכל", "חבר Google Drive", "סנכרן את התיקייה וכל תיקיות המשנה",
    "שמור הגדרות", "סנכרן עכשיו", "התחל או המשך אינדוקס", "שמור ופרסם", "הפעל את הפופ-אפ", "ייצוא CSV",
    "מצב מהיר", "חזרה לרשימה", "להסיר את כל נתוני המצלמה, ולא רק את המיקום", "סימן מים בתמונות שיורדות",
    "טקסט סימן המים"]) {
    assert.ok(adminHtml.includes(button), `הכפתור "${button}" שמוזכר במדריך אינו ב-admin.html`);
    assert.ok(GUIDE_SECTIONS.some(section => guideSectionText(section).includes(button)), `"${button}" כבר אינו מצוטט במדריך`);
  }
  // כפתורים קצרים (אשר, דחה, בטל, שמור) נבדקים כתוכן מלא של הכפתור, ולא
  // כמחרוזת שמופיעה איפשהו בדף.
  for (const [id, label] of [["pendingSwipeApprove", "אשר"], ["pendingSwipeReject", "דחה"], ["pendingSwipeUndoBtn", "בטל"], ["downloadPrivacySaveButton", "שמור"]]) {
    assert.match(adminHtml, new RegExp(`id="${id}"[^>]*>(?:<i [^>]*></i>)?\\s*${label}</button>`), `הכפתור ${id} אינו נקרא "${label}"`);
  }

  // אצל מנהל־על admin.js מחליף את שם הכפתור "בקש מחיקה", ולכן המדריך מצטט
  // גם את השם שהוא רואה — אחרת מנהל־על מחפש כפתור שאינו על המסך.
  assert.match(read("admin.js"), /'מחק לצמיתות' : 'בקש מחיקה'/);
  assert.ok(guideSectionText(findGuideSection("uploads")).includes("מחק לצמיתות"));

  // הסנכרון מוסיף בלבד — וכך גם מצהיר המסך עצמו.
  assert.match(guideSectionText(findGuideSection("drive")), /מוסיף ומעדכן בלבד/);
  assert.match(adminHtml, /הסנכרון מוסיף ומעדכן בלבד/);
});

test("מצב מהיר: מה שהמדריך אומר על ההחלקה, המקשים והביטול תואם את pending-swipe-model.js", () => {
  const uploads = findGuideSection("uploads");
  assert.ok(uploads.views.includes("pending"), 'ה-"?" שליד "מצב מהיר" פותח את uploads');
  const text = guideSectionText(uploads);
  assert.ok(text.includes("מצב מהיר"), "סעיף ההעלאות אינו מזכיר את המצב המהיר");

  // החלקה ימינה מאשרת ושמאלה דוחה — בכיוון של הלוח (RTL).
  assert.match(adminHtml, /<html[^>]*dir="rtl"/);
  assert.equal(swipeActionForDx(1, "rtl"), "approve");
  assert.equal(swipeActionForDx(-1, "rtl"), "reject");
  assert.ok(text.includes("החלקה ימינה") && text.includes("החלקה שמאלה"));

  // המקשים שהמדריך מונה, וכל אחד עושה את מה שכתוב לידו.
  const keys = [
    [{ key: "ArrowRight" }, "approve"], [{ key: "a", code: "KeyA" }, "approve"], [{ key: "Enter" }, "approve"],
    [{ key: "ArrowLeft" }, "reject"], [{ key: "r", code: "KeyR" }, "reject"],
    // מקלדת עברית: המקש הפיזי של A הוא ש, ושל R הוא ר.
    [{ key: "ש", code: "KeyA" }, "approve"], [{ key: "ר", code: "KeyR" }, "reject"],
    [{ key: "z", code: "KeyZ" }, "undo"], [{ key: "z", code: "KeyZ", ctrlKey: true }, "undo"],
    [{ key: "Escape" }, "close"]
  ];
  for (const [event, action] of keys) assert.equal(keyAction(event, "rtl"), action, JSON.stringify(event));
  for (const phrase of ["→ / A / Enter", "← / R", "Z או Ctrl+Z", "Esc"]) {
    assert.ok(text.includes(phrase), `המקשים "${phrase}" חסרים בסעיף`);
  }

  // חלון הביטול נקרא מהקבוע, ולא מועתק.
  assert.ok(text.includes(`${SWIPE_UNDO_MS / 1000} שניות`), "משך הביטול במדריך אינו SWIPE_UNDO_MS");

  // דחייה: סל המחזור אצל מנהל־על, בקשת מחיקה אצל מנהל — כמו rejectPendingRecord.
  const adminJs = read("admin.js");
  const reject = adminJs.slice(adminJs.indexOf("async function rejectPendingRecord"), adminJs.indexOf("function rejectSelectedPending"));
  assert.match(reject, /isSuperAdmin\) \{\s*await window\.movePendingImageToTrash/);
  assert.match(reject, /requestContentDeletion\('pendingImage'/);
  assert.match(read("pending-swipe.js"), /window\.rejectPendingImage\(id\)/);
  assert.ok(text.includes("אצל מנהל־על") && text.includes("לסל המחזור") && text.includes("בקשת מחיקה"));
});

test("הורדות ופרטיות: סעיף למנהל־על שתואם את download-privacy.js", () => {
  const section = findGuideSection("downloads");
  assert.ok(section, "חסר סעיף למסך הורדות ופרטיות");
  assert.deepEqual(section.views, ["downloads"]);
  assert.equal(section.superAdminOnly, true);
  const text = guideSectionText(section);

  // הטקסט של סימן המים: התקרה וברירת המחדל נקראות מהמודול.
  assert.ok(text.includes(String(WATERMARK_TEXT_MAX)));
  assert.ok(text.includes(DEFAULT_WATERMARK_TEXT));

  // סימן מים: רק JPEG, PNG ו-WebP, ומנהלים מורידים בלעדיו.
  const on = { watermarkEnabled: true };
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.ok(watermarkOutputType(type));
    assert.equal(shouldWatermark(on, { isAdmin: false, mimeType: type }), true);
    assert.equal(shouldWatermark(on, { isAdmin: true, mimeType: type }), false);
  }
  for (const type of ["image/heic", "image/gif", "video/mp4"]) assert.equal(watermarkOutputType(type), null);
  assert.ok(text.includes("JPEG, PNG ו־WebP") && text.includes("מנהלים מורידים בלי סימן מים"));

  // המיקום יוצא מ-JPEG בלבד; כל קובץ אחר חוזר כמות שהוא.
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(stripJpegMetadata(webp).changed, false);
  assert.equal(stripJpegMetadata(webp).reason, "not_jpeg");
  assert.ok(text.includes("WebP") && text.includes("HEIC"));

  // ההגדרה נקראת מחדש לכל היותר פעם בחמש דקות.
  assert.match(read("download-privacy-ui.js"), /SETTINGS_TTL_MS = 5 \* 60 \* 1000/);
  assert.ok(text.includes("חמש דקות"));
});

test('פסקת ההורדה ב"החדש בגלריה" אומרת שהמיקום יוצא מ-JPEG, כמו prepareDownloadBlob', () => {
  const ui = read("download-privacy-ui.js");
  const prepare = ui.slice(ui.indexOf("export async function prepareDownloadBlob"));
  // סרטון יוצא מיד, ורק JPEG עובר את הסרת המיקום.
  assert.match(prepare, /mimeType\.startsWith\('video\/'\)\) return blob/);
  assert.match(prepare, /mimeType !== 'image\/jpeg' && !\(await sniffJpeg\(blob\)\)\) return blob/);
  assert.match(prepare, /isAdmin: Boolean\(window\.state\?\.isAdminLoggedIn\)/);
  // ההורדה הבודדת וה-ZIP עוברות שתיהן דרכו.
  const gallery = read("gallery.js");
  assert.equal(gallery.match(/prepareGalleryDownload\(await fetchGalleryMediaBlob\(item\), item\)/g)?.length, 2);

  const features = findGuideSection("features");
  // מה שאחרי הכותרת "הורדה כ־ZIP", עד סוף הסעיף.
  const zip = features.blocks
    .slice(features.blocks.findIndex(block => block.type === "h" && block.text.includes("ZIP")) + 1)
    .map(block => block.text).join(" ");
  for (const phrase of ["המיקום (GPS)", "JPEG", "Motion Photo", "WebP", "HEIC", "מנהלים מורידים בלעדיו"]) {
    assert.ok(zip.includes(phrase), `פסקת ה-ZIP אינה מזכירה "${phrase}"`);
  }
});

test("המודול טהור: אין בו DOM או window", () => {
  const source = read("admin-guide.js");
  assert.doesNotMatch(source, /\b(document|window|localStorage)\b\./);
});
