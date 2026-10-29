// gallery-layout.js — גודל הכרטיסים ופריסת רשת הגלריה (רשת / פסיפס).
//
// מודול טהור, בלי DOM, ונבדק ב-Node (gallery-layout.test.mjs). המתגים שבסרגל
// הכלים — window.setGalleryDensity ו-window.setGalleryLayout — ב-app.js, והיחס
// של כל כרטיס נכתב עליו ב-gallery.js (buildGalleryCard, handleCardImageLoad).
//
// "רשת" היא הרשת הקיימת: משבצות בגודל אחיד והתמונה נחתכת אליהן. "פסיפס"
// שומר על יחס הרוחב-גובה של כל תמונה ואינו חותך דבר: שורות מוצדקות (כמו אלבום
// תמונות), שבהן לכל כרטיס flex-grow ו-flex-basis ביחס לרוחב התמונה, ולכן כל
// הכרטיסים בשורה מקבלים אותו גובה. לא עמודות CSS: שם הסדר רץ מלמעלה למטה, כל
// מנה שנוספת בגלילה הייתה מערבבת מחדש את כל העמודות, וסדר המיקוד במקלדת לא
// היה תואם את מה שרואים. בשורות הסדר נשאר סדר הקריאה, ומנה חדשה רק ממשיכה
// את השורה האחרונה.
//
// היחס נלקח מהרשומה כשהוא ידוע (מידות התצוגות המקדימות, ואחריהן width/height
// שההעלאה רושמת לתמונה שהוקטנה), ואחרת מהתמונה עצמה כשהיא נטענת.

// אותם מפתח וערכים כמו לפני שנוסף מתג הפריסה, כדי שבחירה שכבר נשמרה תישאר.
export const GALLERY_DENSITY_KEY = 'simchat-gallery-density';
export const GALLERY_DENSITIES = Object.freeze(['compact', 'comfortable', 'large']);
export const DEFAULT_GALLERY_DENSITY = 'comfortable';

export const GALLERY_LAYOUT_KEY = 'simchat-gallery-layout';
export const GALLERY_LAYOUTS = Object.freeze(['grid', 'masonry']);
export const DEFAULT_GALLERY_LAYOUT = 'grid';

// גבולות היחס בפסיפס. פנורמה של 6:1 הייתה תופסת שורה שלמה בגובה של פס דק,
// ותמונת מסך אנכית — עמודה צרה וגבוהה; מחוץ לטווח הכרטיס נעצר בגבול והתמונה
// מוצגת בשלמותה בתוכו (object-fit: contain), עדיין בלי חיתוך.
export const MIN_MEDIA_RATIO = 0.5;
export const MAX_MEDIA_RATIO = 2.5;
// הפרש יחסי שמתחתיו אין טעם לתקן יחס שנלקח מהרשומה לפי התמונה שנטענה: עיגול
// של תצוגה מקדימה (480×319 מול 3:2) אינו שווה תזוזה של שורה שלמה.
export const MEDIA_RATIO_TOLERANCE = 0.02;

// סדר המקורות למידות: התצוגות המקדימות נוצרות מהתמונה אחרי הסיבוב שב-EXIF
// (ולסרטון — מפריים שלו), ולכן הן המקור הנאמן. width/height שבראש הרשומה
// נרשמים רק לתמונה שהוקטנה לפני ההעלאה.
const VARIANT_ORDER = ['thumb', 'medium', 'poster'];

export function normalizeGalleryDensity(value) {
    return GALLERY_DENSITIES.includes(value) ? value : DEFAULT_GALLERY_DENSITY;
}

export function normalizeGalleryLayout(value) {
    return GALLERY_LAYOUTS.includes(value) ? value : DEFAULT_GALLERY_LAYOUT;
}

function positiveDimension(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

// רוחב חלקי גובה, בתוך הגבולות ובשלוש ספרות אחרי הנקודה (הערך נכתב למרקאפ,
// ומרקאפ יציב הוא מה שמאפשר לרינדור מחדש לדלג על כרטיס שלא השתנה). 0 — לא ידוע.
export function aspectRatioFrom(width, height) {
    const w = positiveDimension(width);
    const h = positiveDimension(height);
    if (!w || !h) return 0;
    const ratio = Math.min(MAX_MEDIA_RATIO, Math.max(MIN_MEDIA_RATIO, w / h));
    return Math.round(ratio * 1000) / 1000;
}

// היחס של פריט לפי הרשומה בלבד, או 0 כשאין בה מידות.
export function mediaAspectRatio(record) {
    if (!record || typeof record !== 'object') return 0;
    const variants = record.variants && typeof record.variants === 'object' ? record.variants : {};
    for (const name of VARIANT_ORDER) {
        const ratio = aspectRatioFrom(variants[name]?.width, variants[name]?.height);
        if (ratio) return ratio;
    }
    return aspectRatioFrom(record.width, record.height);
}

// האם יחס שנמדד מהתמונה שנטענה שונה מספיק מזה שכבר על הכרטיס כדי לתקן.
export function ratioNeedsUpdate(current, measured, tolerance = MEDIA_RATIO_TOLERANCE) {
    const next = Number(measured);
    if (!Number.isFinite(next) || next <= 0) return false;
    const previous = Number(current);
    if (!Number.isFinite(previous) || previous <= 0) return true;
    return Math.abs(next - previous) / previous > tolerance;
}

// --- העדפות הצופה (localStorage) ---

// localStorage של הדפדפן, או null כשהגישה אליו עצמה נחסמת (עוגיות חסומות,
// מצב פרטי ישן — אז כבר הקריאה ל-window.localStorage זורקת).
function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

// בחירה שמורה, מנורמלת. אחסון חסום, ריק או ערך זר מחזירים את ברירת המחדל.
export function readGalleryPreference(key, normalize, storage = defaultStorage()) {
    let value = null;
    try {
        value = storage?.getItem(key) ?? null;
    } catch {
        value = null;
    }
    return normalize(value);
}

// שמירה שלעולם אינה זורקת; false כשהבחירה לא נשמרה (מכסה מלאה, אחסון חסום) —
// אז היא תקפה עד רענון הדף.
export function writeGalleryPreference(key, value, storage = defaultStorage()) {
    try {
        if (!storage) return false;
        storage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}
