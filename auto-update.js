// auto-update.js — עדכון כפוי: ברגע שעולה גרסה חדשה של האתר, הדף מתרענן.
//
// האתר מוגש מ-GitHub Pages, וכל פריסה משנה את version.json: Jekyll ממלא בו
// את זמן הבנייה ואת ה-commit. הדף טוען את הקובץ בכניסה ושומר את תוכנו, ובודק
// אותו שוב כל דקה כשהלשונית גלויה, וגם בכל חזרה ללשונית, במיקוד ובחזרת הרשת.
// תוכן שונה פירושו גרסה חדשה. אם הקובץ אינו מעובד (למשל בשרת סטטי בלי
// Jekyll) הבדיקה נופלת ל-ETag של index.html. בנוסף, Service Worker חדש שתופס
// שליטה בדף מפעיל את אותו מסלול.
//
// הרענון מיידי כשאין מה להפריע: לשונית מוסתרת מתרעננת בשקט, ולשונית פעילה
// מתרעננת מיד — אלא אם המשתמש באמצע העלאה, הקלדה או צפייה בסרטון. אז מופיעה
// הודעה קצרה והרענון מתבצע ברגע שהפעולה מסתיימת (בדיקה כל חמש שניות).
//
// הגנה מלולאה: הגרסה שבגללה רוענן הדף נשמרת ב-sessionStorage, ואם אחרי
// הרענון השרת עדיין מגיש את הגרסה הקודמת (למשל מטמון CDN שטרם התעדכן) לא
// מרעננים שוב בשתי הדקות הקרובות.

export const VERSION_FILE = './version.json';
export const FALLBACK_FILE = './index.html';
export const RELOAD_GUARD_KEY = 'simchas_gallery_reloaded_for';
export const CHECK_INTERVAL_MS = 60 * 1000;
export const MIN_CHECK_GAP_MS = 15 * 1000;
export const BUSY_RETRY_MS = 5 * 1000;
export const RELOAD_GUARD_WINDOW_MS = 2 * 60 * 1000;
export const UPDATE_MESSAGE = 'עלתה גרסה חדשה של האתר. הדף יתרענן ברגע שתסיים.';

// פעולות ארוכות (העלאה, סנכרון) מסמנות שהדף עסוק, והרענון ממתין להן.
const busyReasons = new Set();
export function markSiteBusy(reason = 'busy') { busyReasons.add(String(reason)); }
export function clearSiteBusy(reason = 'busy') { busyReasons.delete(String(reason)); }
export function isSiteBusy() { return busyReasons.size > 0; }

// version.json שלא עבר עיבוד מכיל עדיין את ה-front matter ואת תגי התבנית.
export function isRenderedVersion(text) {
    const value = String(text || '').trim();
    if (!value || value.startsWith('---') || value.includes('{{')) return false;
    const parsed = parseVersion(value);
    return Boolean(parsed && (parsed.builtAt || parsed.revision));
}

export function parseVersion(text) {
    try {
        const parsed = JSON.parse(String(text || ''));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function sessionStorageOrNull() {
    try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
    } catch { /* הדפדפן חוסם גישה לאחסון */ }
    return null;
}

// המשתמש באמצע משהו: העלאה שסומנה, הקלדה בשדה שיש בו טקסט, או סרטון שמתנגן.
export function defaultIsUserBusy(doc) {
    if (isSiteBusy()) return true;
    const active = doc?.activeElement;
    if (active) {
        const tag = String(active.tagName || '').toLowerCase();
        const editable = tag === 'input' || tag === 'textarea' || active.isContentEditable === true;
        const text = editable ? String(active.value ?? active.textContent ?? '').trim() : '';
        if (text) return true;
    }
    const videos = typeof doc?.querySelectorAll === 'function' ? Array.from(doc.querySelectorAll('video')) : [];
    return videos.some(video => video && video.paused === false && video.ended !== true);
}

export function createSiteUpdateWatcher(options = {}) {
    const win = options.window ?? globalThis.window;
    const doc = options.document ?? globalThis.document;
    const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage;
    const reload = options.reload ?? (() => win.location.reload());
    const notify = options.notify ?? (message => win?.showNotification?.(message, true));
    const isUserBusy = options.isUserBusy ?? (() => defaultIsUserBusy(doc));
    const now = options.now ?? (() => Date.now());
    const setTimer = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    const clearTimer = options.clearTimeout ?? (id => globalThis.clearTimeout(id));
    const setRepeating = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;

    let baseline = null;
    let lastCheckAt = -Infinity;
    let checking = null;
    let pendingSignature = '';
    let notified = false;
    let retryTimer = null;
    let registration = null;
    let stopped = false;

    // חתימת הגרסה הנוכחית: תוכן version.json המעובד, ובלעדיו ה-ETag של הדף.
    async function readSignature() {
        try {
            const response = await fetchImpl(VERSION_FILE, { cache: 'no-store', credentials: 'same-origin' });
            if (response?.ok) {
                const text = await response.text();
                if (isRenderedVersion(text)) {
                    return { kind: 'version', signature: text.trim(), build: parseVersion(text) };
                }
            }
        } catch { /* תקלת רשת: ננסה שוב בבדיקה הבאה */ }
        try {
            const response = await fetchImpl(FALLBACK_FILE, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
            if (response?.ok) {
                const tag = response.headers?.get?.('ETag') || response.headers?.get?.('Last-Modified') || '';
                if (tag) return { kind: 'etag', signature: `etag:${tag}`, build: null };
            }
        } catch { /* תקלת רשת */ }
        return null;
    }

    function guardAllows(signature) {
        try {
            const raw = storage?.getItem?.(RELOAD_GUARD_KEY);
            if (!raw) return true;
            const saved = JSON.parse(raw);
            if (saved?.signature !== signature) return true;
            return now() - Number(saved.at || 0) > RELOAD_GUARD_WINDOW_MS;
        } catch {
            return true;
        }
    }

    function rememberReload(signature) {
        try { storage?.setItem?.(RELOAD_GUARD_KEY, JSON.stringify({ signature, at: now() })); } catch { /* אחסון חסום */ }
    }

    function tryReload() {
        if (!pendingSignature || stopped) return false;
        const hidden = doc?.visibilityState === 'hidden';
        if (!hidden && isUserBusy()) {
            if (!notified) {
                notified = true;
                try { notify(UPDATE_MESSAGE); } catch { /* ההודעה אינה חיונית */ }
            }
            clearTimer(retryTimer);
            retryTimer = setTimer(tryReload, BUSY_RETRY_MS);
            return false;
        }
        const signature = pendingSignature;
        pendingSignature = '';
        rememberReload(signature);
        reload();
        return true;
    }

    function requestReload(signature) {
        if (stopped || !guardAllows(signature)) return false;
        pendingSignature = signature;
        return tryReload();
    }

    async function check(force = false) {
        if (stopped) return false;
        if (checking) return checking;
        if (!force && now() - lastCheckAt < MIN_CHECK_GAP_MS) return false;
        checking = (async () => {
            lastCheckAt = now();
            try { await registration?.update?.(); } catch { /* ה-SW יתעדכן בניווט הבא */ }
            const current = await readSignature();
            if (!current) return false;
            if (!baseline || current.kind !== baseline.kind) {
                // בסיס ראשון, או מעבר בין version.json ל-ETag: לא רענון.
                baseline = current;
                if (win && current.build) win.SITE_BUILD = current.build;
                return false;
            }
            if (current.signature === baseline.signature) return false;
            return requestReload(current.signature);
        })().finally(() => { checking = null; });
        return checking;
    }

    // Service Worker חדש שתפס שליטה: הקוד שבמטמון התחלף, הדף חייב להיטען מחדש.
    // בהתקנה הראשונה (לא הייתה שליטה קודם) אין מה לרענן.
    function watchServiceWorker(registrationPromise) {
        const container = win?.navigator?.serviceWorker;
        if (!container) return;
        let hadController = Boolean(container.controller);
        container.addEventListener?.('controllerchange', () => {
            if (!hadController) {
                hadController = true;
                return;
            }
            requestReload(`sw:${now()}`);
        });
        Promise.resolve(registrationPromise).then(value => { registration = value || null; }).catch(() => {});
    }

    function start(registrationPromise = null) {
        watchServiceWorker(registrationPromise);
        check(true).catch(() => {});
        setRepeating(() => {
            if (doc?.visibilityState !== 'hidden') check().catch(() => {});
        }, intervalMs);
        doc?.addEventListener?.('visibilitychange', () => {
            if (doc.visibilityState === 'hidden') {
                if (pendingSignature) tryReload();
            } else {
                check().catch(() => {});
            }
        });
        win?.addEventListener?.('focus', () => { check().catch(() => {}); });
        win?.addEventListener?.('online', () => { check().catch(() => {}); });
    }

    function stop() {
        stopped = true;
        clearTimer(retryTimer);
    }

    return {
        start,
        stop,
        check,
        requestReload,
        get baseline() { return baseline; },
        get pending() { return pendingSignature; }
    };
}

// נקודת הכניסה של app.js: מפעיל את המעקב וחושף את הכלים ב-window.
export function installSiteUpdateWatcher({ registration = null } = {}) {
    const watcher = createSiteUpdateWatcher();
    const win = globalThis.window;
    if (win) {
        win.checkForSiteUpdate = () => watcher.check(true);
        win.markSiteBusy = markSiteBusy;
        win.clearSiteBusy = clearSiteBusy;
    }
    watcher.start(registration);
    return watcher;
}
