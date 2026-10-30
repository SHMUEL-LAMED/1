// גודל הכרטיסים ופריסת הגלריה (gallery-layout.js): נרמול הבחירות, היחס של פריט
// מתוך הרשומה, הגבולות, ההחלטה מתי לתקן לפי התמונה שנטענה, ואחסון חסום.
import test from "node:test";
import assert from "node:assert/strict";
import {
  GALLERY_DENSITY_KEY,
  GALLERY_LAYOUT_KEY,
  DEFAULT_GALLERY_DENSITY,
  DEFAULT_GALLERY_LAYOUT,
  MIN_MEDIA_RATIO,
  MAX_MEDIA_RATIO,
  normalizeGalleryDensity,
  normalizeGalleryLayout,
  aspectRatioFrom,
  mediaAspectRatio,
  ratioNeedsUpdate,
  readGalleryPreference,
  writeGalleryPreference
} from "./gallery-layout.js";

// localStorage מדומה: Map עם אותו ממשק.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); }
  };
}

const throwingStorage = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); }
};

test("נרמול הבחירות: ערך מוכר נשמר, כל השאר חוזר לברירת המחדל", () => {
  for (const value of ["compact", "comfortable", "large"]) assert.equal(normalizeGalleryDensity(value), value);
  for (const value of [null, undefined, "", "huge", "COMPACT", 3, {}]) assert.equal(normalizeGalleryDensity(value), DEFAULT_GALLERY_DENSITY);
  assert.equal(DEFAULT_GALLERY_DENSITY, "comfortable");

  for (const value of ["grid", "masonry"]) assert.equal(normalizeGalleryLayout(value), value);
  for (const value of [null, undefined, "", "columns", "Masonry"]) assert.equal(normalizeGalleryLayout(value), DEFAULT_GALLERY_LAYOUT);
  assert.equal(DEFAULT_GALLERY_LAYOUT, "grid");
});

test("המפתחות נשארו כמו לפני מתג הפריסה, כדי שבחירה שנשמרה לא תאבד", () => {
  assert.equal(GALLERY_DENSITY_KEY, "simchat-gallery-density");
  assert.equal(GALLERY_LAYOUT_KEY, "simchat-gallery-layout");
});

test("יחס מרוחב וגובה: מעוגל לשלוש ספרות, מוגבל לטווח, ו-0 כשחסר", () => {
  assert.equal(aspectRatioFrom(480, 320), 1.5);
  assert.equal(aspectRatioFrom(1280, 853), 1.501);
  assert.equal(aspectRatioFrom(320, 480), 0.667);
  assert.equal(aspectRatioFrom("1920", "1080"), 1.778);
  // פנורמה ותמונת מסך צרה נעצרות בגבול.
  assert.equal(aspectRatioFrom(6000, 1000), MAX_MEDIA_RATIO);
  assert.equal(aspectRatioFrom(500, 2000), MIN_MEDIA_RATIO);
  for (const [w, h] of [[0, 100], [100, 0], [-5, 10], [NaN, 4], [undefined, undefined], ["abc", 3], [Infinity, 3]]) {
    assert.equal(aspectRatioFrom(w, h), 0, `${w}×${h}`);
  }
});

test("היחס של פריט: התצוגה הקטנה קודם, אחריה הבינונית והפוסטר, ובסוף width/height של הרשומה", () => {
  assert.equal(mediaAspectRatio({ variants: { thumb: { width: 480, height: 320 }, medium: { width: 853, height: 1280 } } }), 1.5);
  // תצוגה בלי מידות (רשומה ישנה) אינה עוצרת את החיפוש.
  assert.equal(mediaAspectRatio({ variants: { thumb: { url: "x" }, medium: { width: 853, height: 1280 } } }), 0.666);
  assert.equal(mediaAspectRatio({ variants: { poster: { width: 1280, height: 720 } } }), 1.778);
  assert.equal(mediaAspectRatio({ width: 3000, height: 4000 }), 0.75);
  assert.equal(mediaAspectRatio({ variants: { thumb: { width: 480, height: 270 } }, width: 3000, height: 4000 }), 1.778,
    "התצוגה המקדימה נוצרה אחרי הסיבוב שב-EXIF, ולכן גוברת");
});

test("רשומה בלי מידות, או שאינה רשומה, מחזירה 0 (היחס יגיע מהתמונה כשתיטען)", () => {
  for (const record of [null, undefined, "img", 7, {}, { variants: null }, { variants: "x" }, { width: 100 }, { variants: { thumb: { width: 0, height: 0 } } }]) {
    assert.equal(mediaAspectRatio(record), 0);
  }
});

test("תיקון לפי התמונה שנטענה: רק כשאין יחס או כשההפרש גדול מהסבולת", () => {
  assert.equal(ratioNeedsUpdate("", 1.5), true);
  assert.equal(ratioNeedsUpdate(undefined, 0.75), true);
  assert.equal(ratioNeedsUpdate(1.5, 1.501), false);
  assert.equal(ratioNeedsUpdate("1.5", 1.52), false);
  assert.equal(ratioNeedsUpdate(1.5, 0.667), true);
  assert.equal(ratioNeedsUpdate(1.333, 1), true);
  // מדידה פגומה (תמונה שעוד לא פוענחה, naturalWidth 0) אינה מוחקת יחס קיים.
  assert.equal(ratioNeedsUpdate(1.5, 0), false);
  assert.equal(ratioNeedsUpdate(1.5, NaN), false);
});

test("העדפות הצופה: קריאה ושמירה, ואחסון חסום או ריק אינו זורק", () => {
  const storage = memoryStorage({ [GALLERY_LAYOUT_KEY]: "masonry", [GALLERY_DENSITY_KEY]: "bogus" });
  assert.equal(readGalleryPreference(GALLERY_LAYOUT_KEY, normalizeGalleryLayout, storage), "masonry");
  assert.equal(readGalleryPreference(GALLERY_DENSITY_KEY, normalizeGalleryDensity, storage), "comfortable");
  assert.equal(writeGalleryPreference(GALLERY_DENSITY_KEY, "compact", storage), true);
  assert.equal(storage.map.get(GALLERY_DENSITY_KEY), "compact");

  assert.equal(readGalleryPreference(GALLERY_LAYOUT_KEY, normalizeGalleryLayout, throwingStorage), "grid");
  assert.equal(writeGalleryPreference(GALLERY_LAYOUT_KEY, "masonry", throwingStorage), false);
  assert.equal(readGalleryPreference(GALLERY_LAYOUT_KEY, normalizeGalleryLayout, null), "grid");
  assert.equal(writeGalleryPreference(GALLERY_LAYOUT_KEY, "masonry", null), false);
});

test("בלי localStorage בכלל (Node) ברירת המחדל עובדת", () => {
  assert.equal(readGalleryPreference(GALLERY_LAYOUT_KEY, normalizeGalleryLayout), "grid");
});
