// media-link.js — קישור ישיר לפריט אחד בגלריה (#media/<id>) והשיתוף שלו, בלי DOM.
//
// כפתור "שתף" בתצוגה המלאה משתף את כתובת האתר עם hash של הפריט. מי שפותח
// את הקישור עובר את שער הגישה הרגיל, ורק אחרי שהצפייה אושרה הפריט נפתח
// בתצוגה המלאה (gallery.js). הקישור נושא רק את המזהה: אין בו שם, כתובת קובץ
// או אסימון, והשרת אוכף את ההרשאה כמו בכל בקשה אחרת.
//
// כאן נמצא כל מה שאפשר לבדוק ב-Node: פירוש ה-hash ובנייתו, הכתובת המשותפת,
// מה מוחזר לכתובת בסגירה, ההחלטה בין שיתוף מערכת להעתקה, ובניית רשימת
// הדפדוף לפריט שאינו בתצוגה הנוכחית.

export const MEDIA_HASH_PREFIX = '#media/';
// כמו safeRecordId ב-app.js: אותיות לטיניות, ספרות, קו תחתון ומקף, עד 120.
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

export function isMediaId(value) {
    return MEDIA_ID_PATTERN.test(String(value ?? ''));
}

// '#media/<id>' → { mediaId }; כל דבר אחר (גם מזהה לא תקין) → null.
export function parseMediaRoute(hash) {
    const value = String(hash ?? '');
    if (!value.startsWith(MEDIA_HASH_PREFIX)) return null;
    let mediaId = '';
    try {
        mediaId = decodeURIComponent(value.slice(MEDIA_HASH_PREFIX.length));
    } catch {
        return null;
    }
    return isMediaId(mediaId) ? { mediaId } : null;
}

export function mediaHash(mediaId) {
    return isMediaId(mediaId) ? `${MEDIA_HASH_PREFIX}${mediaId}` : '';
}

// הכתובת המשותפת: מקור האתר והנתיב שלו, ו-hash של הפריט. פרמטרי החיפוש
// (?drive=… שנשאר מחזרה מ-Google וכדומה) אינם נכנסים: הקישור קנוני וזהה
// לכל מי שמשתף את אותו פריט.
export function mediaShareUrl(location, mediaId) {
    const hash = mediaHash(mediaId);
    const origin = String(location?.origin || '');
    if (!hash || !origin || origin === 'null') return '';
    const pathname = String(location?.pathname || '/');
    return `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}${hash}`;
}

// מה נשלח לחלון השיתוף של המערכת. הכותרת היא שם הפריט כפי שמוצג בגלריה.
export function mediaShareData({ title = '', isVideo = false } = {}, url = '') {
    const name = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const kind = isVideo ? 'סרטון' : 'תמונה';
    return {
        title: name || `${kind} מהגלריה`,
        text: name ? `${kind} מהגלריה: ${name}` : `${kind} מהגלריה`,
        url: String(url || '')
    };
}

// חלון השיתוף של המערכת (בעיקר בטלפון) כשהוא קיים ומסכים לשתף את הנתונים
// האלה; אחרת — העתקה ללוח. canShare שזורק נחשב כסירוב.
export function canUseNativeShare(nav, data) {
    if (typeof nav?.share !== 'function') return false;
    if (typeof nav.canShare !== 'function') return true;
    try {
        return Boolean(nav.canShare(data));
    } catch {
        return false;
    }
}

// המשתמש סגר את חלון השיתוף בלי לבחור יעד: זה אינו כישלון, ואין להעתיק
// במקום או להציג הודעה.
export function isShareCancel(error) {
    return error?.name === 'AbortError';
}

// ה-hash שחוזר לכתובת כשהתצוגה המלאה נסגרת: מה שהיה לפני הפתיחה (#person/<id>
// למשל), אבל לעולם לא קישור לפריט — סגירה מנקה אותו.
export function hashToRestore(previousHash) {
    const value = String(previousHash ?? '');
    if (!value || value === '#' || value.startsWith(MEDIA_HASH_PREFIX)) return '';
    return value;
}

// הרשומה הראשונה עם המזהה, מתוך כמה רשימות שכבר נטענו (null ורשימות ריקות מדולגים).
export function findRecordById(lists, mediaId, safeId = String) {
    const id = safeId(mediaId);
    if (!id) return null;
    for (const list of Array.isArray(lists) ? lists : []) {
        if (!Array.isArray(list)) continue;
        const found = list.find(item => safeId(item?.id) === id);
        if (found) return found;
    }
    return null;
}

// רשימת הדפדוף לפריט מקישור: הפריטים של התיקייה שלו שכבר נטענו, ובתוכם
// הרשומה עצמה — גם כשהיא ישנה מכדי להיות בעמוד הראשון. רשומה שכבר ברשימה
// מוחלפת בגרסה שנטענה עכשיו, בלי כפילות. המיון נעשה אחר כך, כמו בגלריה.
export function withRecord(items, record, safeId = String) {
    const id = safeId(record?.id);
    const list = (Array.isArray(items) ? items : []).filter(item => item && safeId(item.id) !== id);
    return id ? [...list, record] : list;
}
