// gallery-navigation.js — ההיגיון של הניווט בדף הגלריה, בלי DOM: קיצורי
// המקלדת (איזה מקש עושה מה, ומתי הם שותקים), הסף של כפתור "חזרה למעלה",
// וחשבון החזרה למקום בגלילה אחרי תצוגה מלאה, עמוד אירוע או אלבום של אדם.
//
// מודול טהור, נבדק ב-Node (gallery-navigation.test.mjs). החיבור לדף — המאזין
// למקלדת, חלון הקיצורים וזיכרון הגלילה — ב-gallery-navigation-ui.js.
//
// כיוון החצים: האתר נקרא מימין לשמאל, ולכן חץ שמאלה הוא "הבא" וחץ ימינה הוא
// "הקודם" — כמו כפתורי החצים שבתצוגה המלאה וכמו ההחלקה (lightbox-math.js).
// החצים, הרווח של המצגת ו-Escape מטופלים כבר ב-gallery.js וב-lightbox-slideshow.js;
// כאן הם מופיעים רק ברשימה שמוצגת למשתמש, כדי שתהיה רשימה אחת לכל הקיצורים.

// הרשימה שמוצגת בחלון "קיצורי מקלדת". keys הם התוויות שעל המקשים.
export const GALLERY_SHORTCUTS = Object.freeze([
    Object.freeze({
        title: 'בגלריה',
        items: Object.freeze([
            Object.freeze({ keys: Object.freeze(['/']), label: 'מעבר לשדה החיפוש' }),
            Object.freeze({ keys: Object.freeze(['?']), label: 'פתיחת רשימת הקיצורים' })
        ])
    }),
    Object.freeze({
        title: 'בתצוגה המלאה',
        items: Object.freeze([
            Object.freeze({ keys: Object.freeze(['←']), label: 'הפריט הבא' }),
            Object.freeze({ keys: Object.freeze(['→']), label: 'הפריט הקודם' }),
            Object.freeze({ keys: Object.freeze(['D']), label: 'הורדת הפריט' }),
            Object.freeze({ keys: Object.freeze(['F']), label: 'הוספה למועדפים או הסרה מהם' }),
            Object.freeze({ keys: Object.freeze(['רווח']), label: 'השהיה והמשך של מצגת פעילה' }),
            Object.freeze({ keys: Object.freeze(['Esc']), label: 'סגירה (ובמצגת — עצירתה)' })
        ])
    })
]);

// שדה שמקלידים בו: כל מקש בו שייך לטקסט, ואף קיצור אינו פועל. כמו "/"
// שב-app.js, כל INPUT נחשב שדה — גם תיבת סימון, כדי שהכלל יהיה פשוט ואחיד.
export function isTypingTarget(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.isContentEditable === true) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(String(node.tagName || '').toUpperCase());
}

// אות לטינית לפי המקש, ובפריסה שאינה לטינית (עברית: D הוא "ג" ו-F הוא "כ")
// לפי המקש הפיזי. בפריסה לטינית אחרת (Dvorak) קובעת האות שהוקלדה, לא המיקום.
function matchesLetter(event, letter) {
    const key = String(event.key || '');
    if (/^[a-z]$/i.test(key)) return key.toLowerCase() === letter;
    return event.code === `Key${letter.toUpperCase()}`;
}

// מה לעשות עם הקשה, או null כשהיא אינה קיצור שלנו.
//   typing          — הפוקוס בשדה טקסט.
//   lightboxOpen    — התצוגה המלאה פתוחה.
//   otherModalOpen  — חלון אחר פתוח (גם מעל התצוגה המלאה): הקיצורים שותקים.
// מקש שנלחץ ברציפות (repeat) אינו חוזר על הפעולה — הורדה אחת, לא עשר.
export function resolveGalleryShortcut(event, { typing = false, lightboxOpen = false, otherModalOpen = false } = {}) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    if (typing || otherModalOpen || event.repeat) return null;
    const key = String(event.key || '');
    if (key === '?' || (event.shiftKey && event.code === 'Slash' && !/^[a-z]$/i.test(key))) return 'help';
    if (!lightboxOpen) return null;
    if (matchesLetter(event, 'd')) return 'download';
    if (matchesLetter(event, 'f')) return 'favorite';
    return null;
}

// כפתור "חזרה למעלה" מופיע אחרי כשני מסכים של גלילה — לא מיד, כדי שלא
// יסתיר כרטיסים בתחילת הגלריה. מסך נמוך מאוד (או מדידה חסרה) לא יוריד את
// הסף מתחת ל-480 פיקסלים, הסף הקודם.
export const BACK_TO_TOP_SCREENS = 2;
export const BACK_TO_TOP_MIN_PX = 480;

export function backToTopThreshold(viewportHeight) {
    const height = Number(viewportHeight);
    return Math.max(BACK_TO_TOP_MIN_PX, Number.isFinite(height) ? height * BACK_TO_TOP_SCREENS : 0);
}

export function backToTopVisible(scrollY, viewportHeight) {
    const y = Number(scrollY);
    return Number.isFinite(y) && y > backToTopThreshold(viewportHeight);
}

// "תצוגה" של הגלריה לצורך זיכרון הגלילה: תיקייה, חיפוש, מיון וסינונים —
// אותם שדות כמו currentViewSignature ב-gallery.js, שלפיה הרשת חוזרת למנה
// הראשונה. מקום שנשמר בתצוגה אחת אינו משוחזר באחרת — אם המשתמש עבר תיקייה
// מתוך עמוד האירוע, או בחר כיוון בתוך אלבום של אדם וחזר, הוא רוצה את ראש
// התצוגה החדשה ולא את המקום הישן ברשת שהשתנתה מתחתיו.
//   randomSeed — הזרע של הסדר האקראי (window.galleryRandomSeed ב-gallery.js).
//                הוא אינו ב-state, ונחשב רק במיון אקראי: "ערבב מחדש" הוא
//                תצוגה חדשה, אבל במיון אחר הזרע אינו משנה את הסדר.
export function galleryViewKey(state, randomSeed = 0) {
    const source = state && typeof state === 'object' ? state : {};
    const seed = source.gallerySort === 'random' ? (Number(randomSeed) || 0) : 0;
    return JSON.stringify([
        String(source.activeFolderId ?? 'all'),
        String(source.searchQuery ?? ''),
        String(source.gallerySort ?? ''),
        String(source.hebrewYearFilter ?? ''),
        String(source.hebrewMonthFilter ?? ''),
        String(source.sceneTagFilter ?? ''),
        String(source.mediaTypeFilter ?? ''),
        String(source.orientationFilter ?? ''),
        seed
    ]);
}

// לאן לגלול כדי לחזור למקום שנשמר, או null כשאין צורך לזוז.
//   snapshot — { scrollY, anchor: { mediaId, top } | null }: הגלילה, והכרטיס
//              הראשון שנראה בראש המסך עם המרחק שלו מראש המסך.
//   measure  — { scrollY, anchorTop, maxScroll }: הגלילה עכשיו, המרחק של אותו
//              כרטיס מראש המסך עכשיו (null כשאינו בדף), והגלילה המרבית.
// הכרטיס עדיף על המספר: אם משהו מעל הרשת שינה גובה בינתיים (באנר, תמונות
// שנטענו), אותו כרטיס חוזר לאותו מקום על המסך. בלעדיו — המספר שנשמר.
export function scrollRestoreTarget(snapshot, measure = {}) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const current = Number(measure.scrollY) || 0;
    const anchorTop = Number(measure.anchorTop);
    const savedTop = Number(snapshot.anchor?.top);
    let target;
    if (measure.anchorTop !== null && measure.anchorTop !== undefined && Number.isFinite(anchorTop) && Number.isFinite(savedTop)) {
        target = current + (anchorTop - savedTop);
    } else {
        target = Number(snapshot.scrollY);
    }
    if (!Number.isFinite(target)) return null;
    const max = Number(measure.maxScroll);
    const limit = Number.isFinite(max) ? Math.max(0, max) : Infinity;
    target = Math.round(Math.min(limit, Math.max(0, target)));
    return Math.abs(target - current) < 1 ? null : target;
}
