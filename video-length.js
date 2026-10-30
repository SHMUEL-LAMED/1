// video-length.js — סינון סרטונים לפי אורך: קצרים, בינוניים וארוכים.
//
// מודול טהור, בלי DOM, ונבדק ב-Node (video-length.test.mjs). הבורר
// (#galleryVideoLengthFilter) והבדיקה בדפדפן — ב-gallery.js.
//
// מאיפה מגיע האורך: העלאה מהאתר רושמת ברשומה duration (שניות שלמות, מ-<video>
// בזמן ההעלאה; inspectVideoFile ב-gallery.js), וה-Worker שומר אותו כמו שהוא.
// לסרטונים שהגיעו מסנכרון Drive, או שהועלו לפני שנרשם האורך, אין duration.
// להם — ורק כשהסינון לפי אורך פעיל — האורך נקרא מהמטא-דאטה של הסרטון עצמו
// (<video preload="metadata">: הדפדפן מוריד רק את הכותרת), במגבלה: שתי
// בדיקות במקביל, תקרה לכל ביקור, ומטמון לפי מזהה (createDurationProbe). אורך
// שנמצא נשמר בדפדפן (localStorage) לביקור הבא; כישלון נזכר עד סוף הביקור בלבד.
// סרטון שהאורך שלו עדיין אינו ידוע אינו נכלל כשהסינון פעיל, וגלריה מציגה כמה
// כאלה יש — כמו בסינון לפי כיוון.

export const VIDEO_LENGTHS = Object.freeze(['short', 'medium', 'long']);
// "קצרים (עד דקה)": עד 60 שניות כולל. "בינוניים (1–5 דקות)": מעל דקה ועד 5
// דקות כולל. "ארוכים": מעל 5 דקות. האורך ברשומה מעוגל לשנייה, ולכן סרטון של
// 60.4 שניות (נרשם 60) הוא קצר.
export const SHORT_VIDEO_MAX_SECONDS = 60;
export const MEDIUM_VIDEO_MAX_SECONDS = 5 * 60;
// מעל יממה — ערך פסול (סרטון שידור חי, או Infinity שנעגל) ואינו נחשב לאורך.
export const MAX_VIDEO_SECONDS = 24 * 60 * 60;

export const VIDEO_LENGTH_LABELS = Object.freeze({
    short: 'קצרים (עד דקה)',
    medium: 'בינוניים (1–5 דקות)',
    long: 'ארוכים (מעל 5 דקות)'
});

// כמה סרטונים נבדקים במקביל, וכמה לכל היותר בביקור אחד. בדיקה היא בקשת
// טווח קטנה, אבל תיקייה עם מאות סרטונים ישנים לא תפתח מאות חיבורים.
export const DURATION_PROBE_CONCURRENCY = 2;
export const DURATION_PROBE_LIMIT = 60;
export const DURATION_PROBE_TIMEOUT_MS = 10000;

export const DURATION_CACHE_KEY = 'simchat-gallery-video-durations';
export const DURATION_CACHE_VERSION = 1;
export const DURATION_CACHE_LIMIT = 400;

export function normalizeVideoLength(value) {
    return VIDEO_LENGTHS.includes(value) ? value : '';
}

// אורך תקין בשניות, או 0 כשאינו ידוע.
export function validDuration(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_VIDEO_SECONDS ? seconds : 0;
}

// הקטגוריה של אורך, או '' כשאינו ידוע.
export function videoLengthBucket(seconds) {
    const value = validDuration(seconds);
    if (!value) return '';
    if (value <= SHORT_VIDEO_MAX_SECONDS) return 'short';
    if (value <= MEDIUM_VIDEO_MAX_SECONDS) return 'medium';
    return 'long';
}

// האורך של סרטון: מהרשומה, ובלעדיה מהבדיקה בדפדפן (known: מזהה → שניות).
export function recordDuration(record, known = null) {
    const stored = validDuration(record?.duration);
    if (stored) return stored;
    const id = String(record?.id || '');
    return id && known && typeof known.get === 'function' ? validDuration(known.get(id)) : 0;
}

// --- המטמון בדפדפן ---

// התוכן השמור: { v, d: { [id]: שניות } }. פגום או מגרסה אחרת — מטמון ריק.
export function parseDurationCache(text) {
    const result = new Map();
    let parsed = null;
    try {
        parsed = typeof text === 'string' ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.v !== DURATION_CACHE_VERSION || !parsed.d || typeof parsed.d !== 'object') return result;
    for (const [id, seconds] of Object.entries(parsed.d)) {
        const value = validDuration(seconds);
        if (id && /^[a-zA-Z0-9_-]{1,120}$/.test(id) && value) result.set(id, value);
    }
    return result;
}

// רק האחרונים שנמצאו (סדר ההכנסה של Map), עד התקרה — המטמון לא יגדל בלי סוף.
export function serializeDurationCache(map, limit = DURATION_CACHE_LIMIT) {
    const entries = [...(map || new Map()).entries()]
        .filter(([id, seconds]) => id && validDuration(seconds))
        .slice(-limit);
    return JSON.stringify({ v: DURATION_CACHE_VERSION, d: Object.fromEntries(entries) });
}

// --- הבדיקה המוגבלת ---

// תור לבדיקת אורך בדפדפן. probe(url) מחזיר Promise לשניות (0 / דחייה =
// לא נמצא); onSettle(id, seconds) נקרא אחרי כל בדיקה. כל מזהה נבדק פעם אחת
// לכל היותר בביקור, ואחרי limit בדיקות התור אינו מקבל עוד.
export function createDurationProbe({
    probe,
    known = new Map(),
    concurrency = DURATION_PROBE_CONCURRENCY,
    limit = DURATION_PROBE_LIMIT,
    onSettle = () => {}
} = {}) {
    const failed = new Set();
    const pending = new Set();
    const queue = [];
    let started = 0;
    let running = 0;

    function pump() {
        while (running < concurrency && queue.length) {
            const { id, url } = queue.shift();
            running += 1;
            Promise.resolve()
                .then(() => probe(url))
                .catch(() => 0)
                .then(result => {
                    const seconds = validDuration(result);
                    if (seconds) known.set(id, seconds);
                    else failed.add(id);
                    pending.delete(id);
                    running -= 1;
                    try { onSettle(id, seconds); } catch { /* מאזין שנכשל אינו עוצר את התור */ }
                    pump();
                });
        }
    }

    // מבקש בדיקה לפריטים ({ id, url }). מחזיר כמה נוספו לתור.
    function request(items) {
        let added = 0;
        for (const item of items || []) {
            const id = String(item?.id || '');
            const url = String(item?.url || '');
            if (!id || !url || known.has(id) || failed.has(id) || pending.has(id)) continue;
            if (started >= limit) break;
            started += 1;
            pending.add(id);
            queue.push({ id, url });
            added += 1;
        }
        pump();
        return added;
    }

    // 'known' | 'pending' | 'failed' | 'unprobed' — האחרון כולל גם "מעבר לתקרה".
    function status(id) {
        const key = String(id || '');
        if (validDuration(known.get(key))) return 'known';
        if (pending.has(key)) return 'pending';
        if (failed.has(key)) return 'failed';
        return 'unprobed';
    }

    return {
        known,
        request,
        status,
        get pendingCount() { return pending.size; },
        get remaining() { return Math.max(0, limit - started); }
    };
}
