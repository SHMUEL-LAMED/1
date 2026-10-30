// הניווט בדף הגלריה (gallery-navigation.js): איזה מקש עושה מה ומתי הקיצורים
// שותקים, הסף של "חזרה למעלה", מפתח התצוגה וחשבון החזרה למקום בגלילה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GALLERY_SHORTCUTS, isTypingTarget, resolveGalleryShortcut,
  backToTopThreshold, backToTopVisible, BACK_TO_TOP_MIN_PX,
  galleryViewKey, scrollRestoreTarget
} from "./gallery-navigation.js";

const key = (value, extra = {}) => ({ key: value, code: "", ...extra });
const inLightbox = { lightboxOpen: true };

test("שדה טקסט: input, textarea, select ותוכן עריך — ולא כפתור או div", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) assert.equal(isTypingTarget({ tagName }), true, tagName);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  for (const tagName of ["BUTTON", "DIV", "BODY", "VIDEO"]) assert.equal(isTypingTarget({ tagName }), false, tagName);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget("INPUT"), false);
});

test("? פותח את רשימת הקיצורים בגלריה ובתצוגה המלאה, גם עם Shift", () => {
  assert.equal(resolveGalleryShortcut(key("?", { shiftKey: true })), "help");
  assert.equal(resolveGalleryShortcut(key("?"), inLightbox), "help");
  // פריסה שבה Shift+/ אינו מפיק "?" — לפי המקש הפיזי.
  assert.equal(resolveGalleryShortcut(key(".", { code: "Slash", shiftKey: true })), "help");
  assert.equal(resolveGalleryShortcut(key("/", { code: "Slash" })), null, "/ שייך לחיפוש ב-app.js");
});

test("D ו-F פועלים רק בתצוגה המלאה, באותיות קטנות וגדולות ובפריסה עברית", () => {
  assert.equal(resolveGalleryShortcut(key("d")), null);
  assert.equal(resolveGalleryShortcut(key("f")), null);
  assert.equal(resolveGalleryShortcut(key("d", { code: "KeyD" }), inLightbox), "download");
  assert.equal(resolveGalleryShortcut(key("D", { code: "KeyD", shiftKey: true }), inLightbox), "download");
  assert.equal(resolveGalleryShortcut(key("f", { code: "KeyF" }), inLightbox), "favorite");
  assert.equal(resolveGalleryShortcut(key("F", { code: "KeyF" }), inLightbox), "favorite");
  // עברית: המקש D מפיק "ג" ו-F מפיק "כ".
  assert.equal(resolveGalleryShortcut(key("ג", { code: "KeyD" }), inLightbox), "download");
  assert.equal(resolveGalleryShortcut(key("כ", { code: "KeyF" }), inLightbox), "favorite");
  // פריסה לטינית אחרת: האות שהוקלדה קובעת, לא מיקום המקש.
  assert.equal(resolveGalleryShortcut(key("e", { code: "KeyD" }), inLightbox), null);
  assert.equal(resolveGalleryShortcut(key("d", { code: "KeyH" }), inLightbox), "download");
});

test("הקיצורים שותקים בשדה טקסט, בחלון אחר, עם מקשי שינוי, בהקלדה מורכבת ובהקשה חוזרת", () => {
  const download = key("d", { code: "KeyD" });
  assert.equal(resolveGalleryShortcut(download, { ...inLightbox, typing: true }), null);
  assert.equal(resolveGalleryShortcut(download, { ...inLightbox, otherModalOpen: true }), null);
  assert.equal(resolveGalleryShortcut(key("?"), { otherModalOpen: true }), null);
  assert.equal(resolveGalleryShortcut(key("?"), { typing: true }), null);
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    assert.equal(resolveGalleryShortcut({ ...download, [modifier]: true }, inLightbox), null, modifier);
  }
  assert.equal(resolveGalleryShortcut({ ...download, isComposing: true }, inLightbox), null);
  assert.equal(resolveGalleryShortcut({ ...download, repeat: true }, inLightbox), null);
  assert.equal(resolveGalleryShortcut(null, inLightbox), null);
});

test("החצים ו-Escape אינם מטופלים כאן — הם ב-gallery.js — אבל מופיעים ברשימה", () => {
  for (const value of ["ArrowLeft", "ArrowRight", "Escape", " "]) {
    assert.equal(resolveGalleryShortcut(key(value), inLightbox), null, value);
  }
  const keys = GALLERY_SHORTCUTS.flatMap(group => group.items.flatMap(item => item.keys));
  for (const expected of ["/", "?", "←", "→", "D", "F", "Esc"]) assert.ok(keys.includes(expected), expected);
  // מימין לשמאל: חץ שמאלה הוא הבא.
  const lightbox = GALLERY_SHORTCUTS.find(group => group.title === "בתצוגה המלאה");
  assert.equal(lightbox.items.find(item => item.keys[0] === "←").label, "הפריט הבא");
  assert.equal(lightbox.items.find(item => item.keys[0] === "→").label, "הפריט הקודם");
  assert.ok(Object.isFrozen(GALLERY_SHORTCUTS) && Object.isFrozen(lightbox.items));
});

test("חזרה למעלה מופיעה אחרי כשני מסכים, ולא מתחת ל-480 פיקסלים", () => {
  assert.equal(backToTopThreshold(900), 1800);
  assert.equal(backToTopThreshold(150), BACK_TO_TOP_MIN_PX);
  assert.equal(backToTopThreshold(undefined), BACK_TO_TOP_MIN_PX);
  assert.equal(backToTopVisible(1800, 900), false);
  assert.equal(backToTopVisible(1801, 900), true);
  assert.equal(backToTopVisible(500, 100), true);
  assert.equal(backToTopVisible(Number.NaN, 900), false);
});

test("מפתח התצוגה משתנה עם התיקייה, החיפוש, המיון והסינונים בלבד", () => {
  const base = { activeFolderId: "all", searchQuery: "", gallerySort: "newest", hebrewYearFilter: "", hebrewMonthFilter: "", sceneTagFilter: "", mediaTypeFilter: "", orientationFilter: "", dateRangeFrom: "", dateRangeTo: "", videoLengthFilter: "" };
  const keyOf = galleryViewKey(base);
  assert.equal(galleryViewKey({ ...base, images: [1, 2], favorites: new Set(["x"]) }), keyOf);
  for (const [field, value] of [["activeFolderId", "2"], ["searchQuery", "בר"], ["gallerySort", "oldest"], ["hebrewYearFilter", "5787"], ["hebrewMonthFilter", "tishrei"], ["sceneTagFilter", "dancing"], ["mediaTypeFilter", "video"], ["orientationFilter", "portrait"], ["dateRangeFrom", "5786-tishrei"], ["dateRangeTo", "5787"], ["videoLengthFilter", "short"]]) {
    assert.notEqual(galleryViewKey({ ...base, [field]: value }), keyOf, field);
  }
  assert.equal(typeof galleryViewKey(null), "string");
});

test("מפתח התצוגה: 'ערבב מחדש' (זרע אחר) הוא תצוגה חדשה רק במיון אקראי", () => {
  const random = { activeFolderId: "all", gallerySort: "random" };
  assert.equal(galleryViewKey(random, 17), galleryViewKey(random, 17));
  assert.notEqual(galleryViewKey(random, 18), galleryViewKey(random, 17));
  // במיון אחר הזרע אינו משנה דבר — כמו currentViewSignature ב-gallery.js.
  const newest = { ...random, gallerySort: "newest" };
  assert.equal(galleryViewKey(newest, 18), galleryViewKey(newest, 17));
  assert.equal(galleryViewKey(newest, 18), galleryViewKey(newest));
  // זרע חסר או לא מספרי נחשב 0, ולא מפיל את המפתח.
  assert.equal(galleryViewKey(random, undefined), galleryViewKey(random, "x"));
});

test("החזרה למקום: לפי הכרטיס כשהוא בדף, אחרת לפי המספר, ובגבולות הדף", () => {
  const snapshot = { scrollY: 2400, anchor: { mediaId: "img_1", top: 120 } };
  // לא זז דבר: אין צורך לגלול.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 2400, anchorTop: 120, maxScroll: 9000 }), null);
  // הדף נגלל מאחורי התצוגה המלאה: חזרה בדיוק לאותו מקום.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 3000, anchorTop: -480, maxScroll: 9000 }), 2400);
  // משהו מעל הרשת גדל ב-90 פיקסלים: הכרטיס חוזר לאותו מקום על המסך.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 2400, anchorTop: 210, maxScroll: 9000 }), 2490);
  // הרשת התחילה מחדש בראש הדף (חזרה מאלבום): הגלילה עד הכרטיס.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 600, anchorTop: 1920.4, maxScroll: 9000 }), 2400);
  // הכרטיס כבר אינו בדף: המספר שנשמר.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 0, anchorTop: null, maxScroll: 9000 }), 2400);
  assert.equal(scrollRestoreTarget({ scrollY: 2400, anchor: null }, { scrollY: 10, anchorTop: 55 }), 2400);
  // בגבולות הדף.
  assert.equal(scrollRestoreTarget(snapshot, { scrollY: 0, anchorTop: null, maxScroll: 1000 }), 1000);
  assert.equal(scrollRestoreTarget({ scrollY: -50, anchor: null }, { scrollY: 30 }), 0);
  assert.equal(scrollRestoreTarget({ scrollY: 500, anchor: null }, { scrollY: 0, maxScroll: -20 }), null);
  assert.equal(scrollRestoreTarget(null, { scrollY: 0 }), null);
  assert.equal(scrollRestoreTarget({ scrollY: "x", anchor: null }, { scrollY: 0 }), null);
});

test("המודולים במעטפת, בבדיקת התחביר, ב-README, ומחוברים מ-app.js", () => {
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
  const pkg = readFileSync(new URL("./package.json", import.meta.url), "utf8");
  const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
  for (const file of ["gallery-navigation.js", "gallery-navigation-ui.js"]) {
    assert.ok(shell.includes(`"./${file}"`), `${file} חסר במעטפת`);
    assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
    assert.ok(readme.includes(`- \`${file}\``), `${file} חסר ברשימת המודולים ב-README`);
  }
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ initGalleryNavigation \} from '\.\/gallery-navigation-ui\.js'/);
  assert.match(app, /initGalleryNavigation\(\);/);
  // הזרע של הסדר האקראי מגיע ממערבב הגלריה אל מפתח התצוגה של זיכרון הגלילה.
  const gallery = readFileSync(new URL("./gallery.js", import.meta.url), "utf8");
  assert.match(gallery, /window\.galleryRandomSeed = function\(\) \{\s*return randomGalleryOrder\.seed;/);
  const ui = readFileSync(new URL("./gallery-navigation-ui.js", import.meta.url), "utf8");
  assert.match(ui, /galleryViewKey\(window\.state, window\.galleryRandomSeed\?\.\(\)\)/);
  assert.doesNotMatch(ui, /galleryViewKey\(window\.state\)/);
});
