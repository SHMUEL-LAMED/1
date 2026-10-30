// first-load.js — ההחלטות של הטעינה הראשונה בדף הגלריה, בלי DOM: אילו
// תמונות יורדות מיד ובעדיפות גבוהה, ולאילו מקורות פותחים חיבור מראש.
// app.js ו-gallery.js מחברים אותן לדף, והבדיקות
// (first-load.test.mjs) בודקות אותן ישירות. המדידה שהובילה לכל החלטה —
// scripts/measure-first-load.mjs, והמספרים ב-README ("הטעינה הראשונה").

// --- התמונות שמעל קו הגלילה ---

// תקרה לשורה הראשונה: גם במסך רחב מאוד לא יותר מזה בעדיפות גבוהה, כדי שהן
// לא יתחרו זו בזו על אותו פס.
export const MAX_EAGER_CARDS = 6;
// סטייה מותרת בין ראשי כרטיסים באותה שורה (עיגול של תת־פיקסלים, פסיפס).
const ROW_TOLERANCE_PX = 2;

// כמה כרטיסים מתחילת הרשת יורדים מיד ובעדיפות גבוהה: השורה הראשונה בלבד,
// ורק אם היא נראית במסך. rects הם { top, bottom } של כל כרטיס ביחס לראש
// המסך (getBoundingClientRect), לפי הסדר. בטלפון הרשת מתחילה מתחת לפוסטר,
// ושם התשובה היא 0 — הפס שייך לפסיפס שבפוסטר, שהוא מה שרואים. כך גם כשהמבקר
// גלל מזמן אל מתחת לשורה הראשונה והיא נבנתה מחדש (לב שנלחץ).
export function aboveFoldCardCount(rects, viewportHeight, { max = MAX_EAGER_CARDS } = {}) {
    const list = Array.isArray(rects) ? rects : [];
    const height = Number(viewportHeight);
    const first = list[0];
    const firstTop = Number(first?.top);
    if (!Number.isFinite(firstTop) || !(height > 0)) return 0;
    if (firstTop >= height || !(Number(first.bottom) > 0)) return 0;
    let count = 0;
    for (const rect of list) {
        const top = Number(rect?.top);
        if (count >= max || !Number.isFinite(top) || Math.abs(top - firstTop) > ROW_TOLERANCE_PX) break;
        count += 1;
    }
    return count;
}

// האריח הראשון בפסיפס של הפוסטר הוא הגדול (שתי עמודות על שתי שורות) והוא
// התמונה הראשונה שהמבקר רואה, ולכן הוא היחיד בעדיפות גבוהה. כל האריחים
// יורדים מיד: הפוסטר תמיד בראש הדף.
export const HERO_HIGH_PRIORITY_TILES = 1;

export function heroTileLoading(index) {
    return { loading: 'eager', fetchPriority: index < HERO_HIGH_PRIORITY_TILES ? 'high' : 'auto' };
}

// --- חיבור מראש ל-Worker ---

// הבקשות ל-Worker יוצאות רק אחרי שהקוד של האתר ירד ורץ, ולכן חיבור שנפתח
// מראש חוסך את DNS, TCP ו-TLS מהבקשה הראשונה. נתונים יוצאים ב-fetch במצב
// CORS בלי עוגיות (crossorigin), ותמונות ב-<img> רגיל — בדפדפן אלה שני
// מאגרי חיבורים נפרדים, ולכן שני רמזים לאותו מקור. existing הם הרמזים
// שכבר בדף ({ href, crossOrigin }), כדי שהמקור של הייצור, שכתוב ב-index.html,
// לא יתווסף שוב.
export function preconnectHints(apiBaseUrl, existing = []) {
    let origin = '';
    try {
        const url = new URL(String(apiBaseUrl || ''));
        if (url.protocol === 'https:') origin = url.origin;
    } catch {
        origin = '';
    }
    if (!origin) return [];
    const have = new Set((existing || []).map(hint => `${normalizeOrigin(hint?.href)}|${hint?.crossOrigin ? 'anonymous' : ''}`));
    return [{ href: origin, crossOrigin: 'anonymous' }, { href: origin, crossOrigin: '' }]
        .filter(hint => !have.has(`${hint.href}|${hint.crossOrigin}`));
}

function normalizeOrigin(href) {
    try {
        return new URL(String(href || '')).origin;
    } catch {
        return '';
    }
}
