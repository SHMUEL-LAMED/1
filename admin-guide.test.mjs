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

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const adminHtml = read("admin.html");
const adminUiJs = read("admin-ui.js");

function registeredViewIds() {
  const block = adminUiJs.slice(adminUiJs.indexOf("const ADMIN_VIEWS = ["), adminUiJs.indexOf("const VIEW_GROUPS"));
  return [...block.matchAll(/^\s{8}id: '([\w-]+)',/gm)].map(match => match[1]);
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
  for (const id of ["start", "uploads", "drive", "folders", "people", "ai", "backfills", "popup", "users", "errors", "features"]) {
    assert.ok(findGuideSection(id), `הסעיף ${id} חסר במדריך`);
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
    "שמור הגדרות", "סנכרן עכשיו", "התחל או המשך אינדוקס", "שמור ופרסם", "הפעל את הפופ-אפ", "ייצוא CSV"]) {
    assert.ok(adminHtml.includes(button), `הכפתור "${button}" שמוזכר במדריך אינו ב-admin.html`);
  }

  // הסנכרון מוסיף בלבד — וכך גם מצהיר המסך עצמו.
  assert.match(guideSectionText(findGuideSection("drive")), /מוסיף ומעדכן בלבד/);
  assert.match(adminHtml, /הסנכרון מוסיף ומעדכן בלבד/);
});

test("המודול טהור: אין בו DOM או window", () => {
  const source = read("admin-guide.js");
  assert.doesNotMatch(source, /\b(document|window|localStorage)\b\./);
});
