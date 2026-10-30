// usage-beacon.js — מוני השימוש של הביקור: ביקור, צפיות והורדות.
//
// הדפדפן אינו מדווח על כל צפייה או הורדה בנפרד. המונים מצטברים כאן, ב-
// localStorage של אותו משתמש, ונשלחים לשרת בדיווח אחד (POST /stats/beacon):
// בתחילת הביקור הראשון של היום — כדי שהביקור ייספר — ואחר כך לכל היותר פעם
// בעשר דקות, כשהלשונית מוסתרת. ה-Worker מוסיף כל מונה ב-UPSERT אחד לשורה של
// אותו יום (ראו receiveUsageBeacon), כך שעשרות צפיות עולות כמה כתיבות בודדות.
// הדיווח מכיל מספרים בלבד: אין בו מזהה פריט, כתובת דף או זמן מדויק.
//
// החלק העליון טהור (בלי DOM), ונבדק ב-Node ב-usage-beacon.test.mjs.

export const USAGE_CLIENT_METRICS = Object.freeze(['views', 'downloads', 'zipDownloads', 'zipItems']);
// כמו USAGE_BEACON_LIMITS ב-Worker: מעבר לזה השרת ממילא חותך.
export const USAGE_PENDING_MAX = Object.freeze({ views: 500, downloads: 200, zipDownloads: 50, zipItems: 2000 });
export const USAGE_FLUSH_INTERVAL_MS = 10 * 60 * 1000;
// דיווח הביקור שנכשל (ניתוק, Worker ישן) אינו חוזר בכל מעבר לשונית — רק אחרי דקה.
export const USAGE_RETRY_MS = 60 * 1000;
export const USAGE_STORAGE_PREFIX = 'gallery_usage_v1:';
// הניסיונות אחרי טעינת הדף: ההתחברות והאישור מגיעים מהשרת אחרי כמה שניות.
const START_DELAYS_MS = [8000, 45000, 120000];

export function usageDayKey(time = Date.now()) {
    return new Date(time).toISOString().slice(0, 10);
}

export function emptyUsageEntry() {
    return { visitDay: '', lastFlushAt: 0, pending: {} };
}

// רשומה מ-localStorage, אחרי בדיקה: ערך פגום (או של גרסה אחרת) מתחיל מאפס.
export function normalizeUsageEntry(value) {
    const entry = emptyUsageEntry();
    if (!value || typeof value !== 'object') return entry;
    if (typeof value.visitDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.visitDay)) entry.visitDay = value.visitDay;
    const lastFlushAt = Number(value.lastFlushAt);
    if (Number.isFinite(lastFlushAt) && lastFlushAt > 0) entry.lastFlushAt = lastFlushAt;
    for (const metric of USAGE_CLIENT_METRICS) {
        const amount = Math.trunc(Number(value.pending?.[metric]));
        if (Number.isFinite(amount) && amount > 0) entry.pending[metric] = Math.min(USAGE_PENDING_MAX[metric], amount);
    }
    return entry;
}

export function addUsageCount(entry, metric, amount = 1) {
    if (!USAGE_CLIENT_METRICS.includes(metric)) return entry;
    const value = Math.trunc(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return entry;
    const next = normalizeUsageEntry(entry);
    next.pending[metric] = Math.min(USAGE_PENDING_MAX[metric], (next.pending[metric] || 0) + value);
    return next;
}

// האם לשלוח עכשיו: כשהביקור של היום עוד לא נספר (ולא היה ניסיון בדקה
// האחרונה); אחרת רק כשיש מה לדווח ועברו לפחות עשר דקות מהדיווח הקודם.
export function shouldSendUsage(entry, now = Date.now()) {
    const current = normalizeUsageEntry(entry);
    if (current.visitDay !== usageDayKey(now)) return now - current.lastFlushAt >= USAGE_RETRY_MS;
    const hasCounts = Object.keys(current.pending).length > 0;
    return hasCounts && now - current.lastFlushAt >= USAGE_FLUSH_INTERVAL_MS;
}

// מה שנשלח יורד מהמונים; מה שנוסף בזמן השליחה נשאר לדיווח הבא.
export function markUsageSent(entry, sent, now = Date.now()) {
    const next = normalizeUsageEntry(entry);
    for (const [metric, amount] of Object.entries(sent || {})) {
        const remaining = (next.pending[metric] || 0) - (Number(amount) || 0);
        if (remaining > 0) next.pending[metric] = remaining;
        else delete next.pending[metric];
    }
    next.visitDay = usageDayKey(now);
    next.lastFlushAt = now;
    return next;
}

// --- החיבור לדף ---

let installed = false;
let sending = false;

function currentApprovedUid() {
    const state = window.state;
    const uid = String(state?.currentUser?.uid || '');
    if (!uid) return '';
    const approved = state.userApprovalStatus === 'approved' || state.isInitialSuperAdminAccount === true;
    return approved ? uid : '';
}

function storageKey(uid) {
    return `${USAGE_STORAGE_PREFIX}${uid}`;
}

function readEntry(uid) {
    try {
        return normalizeUsageEntry(JSON.parse(localStorage.getItem(storageKey(uid)) || 'null'));
    } catch {
        return emptyUsageEntry();
    }
}

function writeEntry(uid, entry) {
    try {
        localStorage.setItem(storageKey(uid), JSON.stringify(entry));
    } catch {
        // אחסון חסום: המונים של הביקור פשוט אינם נשמרים.
    }
}

// נקרא מהגלריה בכל צפייה או הורדה. בלי משתמש מאושר — לא נספר דבר.
export function countUsage(metric, amount = 1) {
    const uid = currentApprovedUid();
    if (!uid) return;
    writeEntry(uid, addUsageCount(readEntry(uid), metric, amount));
}

// leaving=true: הלשונית מוסתרת. אז הבקשה יוצאת עם keepalive והמונים יורדים
// מראש — עדיף לאבד דיווח אחד מלספור אותו פעמיים כשהתשובה לא תגיע לדף.
export async function flushUsage({ leaving = false } = {}) {
    const uid = currentApprovedUid();
    if (!uid || sending || typeof window.r2Request !== 'function') return false;
    const now = Date.now();
    const entry = readEntry(uid);
    if (!shouldSendUsage(entry, now)) return false;
    const counts = { ...entry.pending };
    sending = true;
    if (leaving) writeEntry(uid, markUsageSent(entry, counts, now));
    try {
        await window.r2Request('/stats/beacon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counts }),
            keepalive: true,
            timeoutMs: 15000
        });
        if (!leaving) writeEntry(uid, markUsageSent(readEntry(uid), counts, now));
        return true;
    } catch (error) {
        // Worker ישן (404), חשבון שעדיין אינו מאושר או ניתוק: מנסים שוב בביקור הבא,
        // אבל לא יותר מפעם בעשר דקות.
        if (!leaving) writeEntry(uid, { ...readEntry(uid), lastFlushAt: now });
        return false;
    } finally {
        sending = false;
    }
}

export function installUsageBeacon() {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.countUsage = countUsage;
    for (const delay of START_DELAYS_MS) {
        window.setTimeout(() => { flushUsage().catch(() => {}); }, delay);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushUsage({ leaving: true }).catch(() => {});
    });
}
