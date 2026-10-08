// api-environment.js — לאיזה Worker האתר פונה: הייצור או סביבת הניסוי.
//
// הכתובת נקבעת כאן, במקום אחד, לכל המודולים: cloudflare-client.js, app.js,
// drive-sync.js ו-face-search.js מייבאים מכאן ואינם מחזיקים כתובת משלהם.
// הכלל, לפי סדר העדיפות:
//   1. ‎?api=production או ‎?api=staging בכתובת גובר על הכול, ונשמר
//      ב-sessionStorage כדי שיחזיק לאורך הלשונית גם אחרי ניווט פנימי
//      (למשל מהגלריה ללוח הניהול). ‎?api=auto מוחק את הבחירה.
//   2. אתר שמוגש מ-*.pages.dev (אתר הניסוי ב-Cloudflare Pages ופריסות
//      התצוגה המקדימה שלו) או מ-localhost / 127.0.0.1 פונה ל-Worker של הניסוי.
//   3. כל השאר — ובראשו GitHub Pages — פונה לייצור.
//
// הבחירה נשמרת ב-sessionStorage ולא ב-localStorage בכוונה: היא כלי בדיקה
// ללשונית אחת, ואסור שתישאר בדפדפן של מבקר רגיל אחרי שהלשונית נסגרה.

export const PRODUCTION_API_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';
export const STAGING_API_BASE_URL = 'https://simchas-gallery-api-staging.0534169095.workers.dev';
export const API_ENVIRONMENT_STORAGE_KEY = 'simchas_gallery_api_environment';
export const API_BASE_URLS = Object.freeze({
    production: PRODUCTION_API_BASE_URL,
    staging: STAGING_API_BASE_URL
});

const STAGING_HOST_SUFFIX = '.pages.dev';
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

function normalizeEnvironment(value) {
    const name = String(value || '').trim().toLowerCase();
    return Object.hasOwn(API_BASE_URLS, name) ? name : '';
}

function overrideStorage() {
    try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
    } catch { /* הדפדפן חוסם גישה לאחסון */ }
    return null;
}

function currentLocation() {
    const location = globalThis.location;
    return location && typeof location === 'object' ? location : null;
}

// המארח נבדק כמחרוזת שלמה: רק סיומת ".pages.dev" (עם הנקודה, ולא "pages.dev"
// לבדו או "evil-pages.dev") או מארח מקומי נחשבים לסביבת הניסוי.
export function isStagingHostname(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return false;
    if (LOCAL_DEVELOPMENT_HOSTNAMES.has(host)) return true;
    return host.length > STAGING_HOST_SUFFIX.length && host.endsWith(STAGING_HOST_SUFFIX);
}

// מחזירה 'production' או 'staging'. בדפדפן אין צורך בפרמטרים; הבדיקות
// מעבירות hostname, search ו-storage במפורש.
export function resolveApiEnvironment({ hostname, search, storage } = {}) {
    const location = currentLocation();
    const host = hostname ?? location?.hostname ?? '';
    const query = search ?? location?.search ?? '';
    const store = storage === undefined ? overrideStorage() : storage;

    // 1. פרמטר ‎?api= — גובר ונשמר ללשונית. ערך לא מוכר מתעלמים ממנו.
    let requested = '';
    try {
        requested = String(new URLSearchParams(String(query || '')).get('api') || '').trim().toLowerCase();
    } catch { /* שאילתה לא תקינה — ממשיכים בלי דריסה */ }
    if (requested === 'auto') {
        try { store?.removeItem(API_ENVIRONMENT_STORAGE_KEY); } catch { /* אחסון חסום */ }
    } else if (normalizeEnvironment(requested)) {
        try { store?.setItem(API_ENVIRONMENT_STORAGE_KEY, requested); } catch { /* אחסון חסום */ }
        return requested;
    }

    // 2. דריסה שנשמרה קודם באותה לשונית.
    try {
        const stored = normalizeEnvironment(store?.getItem(API_ENVIRONMENT_STORAGE_KEY));
        if (stored) return stored;
    } catch { /* אחסון חסום */ }

    // 3. לפי הכתובת שממנה האתר מוגש.
    return isStagingHostname(host) ? 'staging' : 'production';
}

export function resolveApiBaseUrl(options) {
    return API_BASE_URLS[resolveApiEnvironment(options)];
}
