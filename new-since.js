// new-since.js — "חדש מאז הביקור הקודם" והתמונות האחרונות של תיקייה.
//
// מודול טהור, בלי DOM, ונבדק ב-Node (new-since.test.mjs). הסימונים עצמם —
// תג "חדש" על כרטיס ועל תיקייה, והבאנר #newUpdatesBanner — ב-gallery.js,
// והתצוגה המקדימה של תיקייה בריחוף ב-folder-preview.js.
//
// "ביקור" אינו טעינת דף: רענון, או חזרה ללשונית אחרי כמה דקות, הם המשך של
// אותו ביקור, ולכן התגים אינם נעלמים בהם. ביקור חדש מתחיל רק אחרי הפסקה של
// VISIT_GAP_MS מאז שהדף נראה לאחרונה. נקודת הייחוס ("הביקור הקודם") היא
// הרגע שבו הביקור הקודם הסתיים, והיא נקבעת פעם אחת בתחילת הביקור — כל מה
// שנוסף אחריה מסומן כחדש עד סוף הביקור הנוכחי.
//
// האחסון הוא localStorage, במפתח נפרד לכל משתמש מחובר. בלי משתמש אין נקודת
// ייחוס ואין סימון. בביקור הראשון (אין רשומה) שום דבר אינו "חדש" — אחרת כל
// הארכיון היה מסומן. אחסון חסום, מלא או פגום לעולם אינו זורק: בלעדיו פשוט
// אין סימונים.
import { pickCardSource } from './media-variants.js';

export const LAST_VISIT_STORAGE_PREFIX = 'simchas_gallery_last_visit_v1';
// הפסקה ארוכה מזה בין שתי צפיות פותחת ביקור חדש.
export const VISIT_GAP_MS = 30 * 60 * 1000;
// שעון המכשיר עשוי לזוז מעט; רשומה "מהעתיד" מעבר לזה נחשבת פגומה.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
// כמה תמונות מתחלפות בתצוגה המקדימה של תיקייה.
export const FOLDER_PREVIEW_FRAMES = 4;

const SAFE_ID_PATTERN = /[^a-zA-Z0-9_-]/g;

function safeId(value, max = 120) {
    return String(value ?? '').replace(SAFE_ID_PATTERN, '').slice(0, max);
}

function finiteTime(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function createdTime(item) {
    return finiteTime(item?.createdAt);
}

// localStorage של הדפדפן, או null כשהגישה אליו עצמה נחסמת.
function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

// --- מפתח האחסון והרשומה ---

// מפתח לכל משתמש. בלי משתמש — מחרוזת ריקה, ואז אין קריאה ואין כתיבה.
export function lastVisitStorageKey(userId) {
    const id = safeId(userId, 128);
    return id ? `${LAST_VISIT_STORAGE_PREFIX}:${id}` : '';
}

// { previousVisit, lastSeenAt }. previousVisit 0 — עדיין אין ביקור קודם.
export function parseVisitRecord(text, now = Date.now()) {
    if (typeof text !== 'string' || !text) return null;
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const lastSeenAt = finiteTime(parsed.lastSeenAt);
    if (!lastSeenAt || lastSeenAt > now + CLOCK_SKEW_MS) return null;
    const previousVisit = finiteTime(parsed.previousVisit);
    return { previousVisit: previousVisit <= lastSeenAt ? previousVisit : 0, lastSeenAt };
}

function readRecord(storage, key, now) {
    if (!storage || !key) return null;
    try {
        return parseVisitRecord(storage.getItem(key), now);
    } catch {
        return null;
    }
}

function writeRecord(storage, key, record) {
    if (!storage || !key) return false;
    try {
        storage.setItem(key, JSON.stringify(record));
        return true;
    } catch {
        return false;
    }
}

// תחילת הביקור: מחזירה את נקודת הייחוס (0 בביקור הראשון) ורושמת שהדף נראה
// עכשיו. נקראת פעם אחת לכל משתמש בכל טעינת דף; המשך של אותו ביקור (רענון)
// מקבל את אותה נקודה שקיבל קודם.
export function beginVisit({ storage, userId, now = Date.now(), gapMs = VISIT_GAP_MS } = {}) {
    const backend = storage === undefined ? defaultStorage() : storage;
    const key = lastVisitStorageKey(userId);
    if (!key) return 0;
    const time = finiteTime(now);
    const record = readRecord(backend, key, time);
    let previousVisit = 0;
    if (record) previousVisit = time - record.lastSeenAt < gapMs ? record.previousVisit : record.lastSeenAt;
    writeRecord(backend, key, { previousVisit, lastSeenAt: time });
    return previousVisit;
}

// הדף עדיין נראה (או נסגר עכשיו): מקדם את lastSeenAt בלי לגעת בנקודת הייחוס,
// כדי שהביקור הבא יימדד מסוף הביקור הזה ולא מתחילתו.
export function touchVisit({ storage, userId, now = Date.now() } = {}) {
    const backend = storage === undefined ? defaultStorage() : storage;
    const key = lastVisitStorageKey(userId);
    if (!key) return false;
    const time = finiteTime(now);
    const record = readRecord(backend, key, time);
    return writeRecord(backend, key, {
        previousVisit: record ? record.previousVisit : 0,
        lastSeenAt: Math.max(time, record?.lastSeenAt || 0)
    });
}

// --- מה חדש ---

// פריט חדש: נוסף לגלריה אחרי הביקור הקודם. בלי נקודת ייחוס — שום דבר.
export function isNewSince(item, since) {
    const baseline = finiteTime(since);
    return Boolean(baseline) && createdTime(item) > baseline;
}

// כמה פריטים חדשים יש ברשימות שהתקבלו (פריט שמופיע בכמה מהן נספר פעם אחת),
// ובאילו תיקיות. complete=false כשכל הרשימה הראשונה — "החדשות ביותר" בארכיון,
// שאילתת limit — חדשה כולה: ייתכן שיש עוד פריטים חדשים מעבר לה. אלא אם השרת
// אמר שאין אחריה עוד (latestHasMore=false): בארכיון קטן שכולו חדש אין "ויותר".
export function newSinceSummary(lists, since, { latest = null, latestHasMore = true } = {}) {
    const baseline = finiteTime(since);
    const seen = new Set();
    const folderIds = new Set();
    let count = 0;
    let newest = 0;
    for (const list of Array.isArray(lists) ? lists : []) {
        for (const item of Array.isArray(list) ? list : []) {
            const id = safeId(item?.id);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (!isNewSince(item, baseline)) continue;
            count += 1;
            newest = Math.max(newest, createdTime(item));
            const folderId = safeId(item.folderId);
            if (folderId) folderIds.add(folderId);
        }
    }
    const latestList = Array.isArray(latest) ? latest : [];
    const complete = !latestList.length
        || latestHasMore === false
        || !latestList.every(item => isNewSince(item, baseline));
    return { count, folderIds, newest, complete };
}

// הטקסט של באנר העדכונים (#newUpdatesBanner) כשיש נקודת ייחוס. כשהרשימה
// הקטנה חדשה כולה הספירה היא גבול תחתון ("24 ויותר").
export function newSinceLabel({ count = 0, complete = true } = {}) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    if (!total) return '';
    if (total === 1 && complete) return 'נוסף פריט אחד מאז הביקור הקודם שלך.';
    return `נוספו ${total}${complete ? '' : ' ויותר'} פריטים מאז הביקור הקודם שלך.`;
}

// --- באנר העדכונים: מה מוצג, ו"סגור" לכל משתמש ---

// הטקסט שבבאנר ב-index.html: בלי ביקור קודם — "השבוע האחרון".
export const NEW_UPDATES_DEFAULT_TEXT = 'נוספו תמונות חדשות בשבוע האחרון.';
export const NEW_UPDATES_RECENT_MS = 7 * 24 * 60 * 60 * 1000;
// המפתח הגלובלי הישן של "סגור"/"צפה עכשיו". הוא היה משותף לכל החשבונות
// בדפדפן, ולכן משתמש אחד שסגר את הבאנר הסתיר אותו גם ממשתמש אחר. עכשיו לכל
// משתמש מפתח משלו, והמפתח הישן נשאר רק כשאין משתמש מחובר.
export const UPDATES_SEEN_STORAGE_KEY = 'yeshiva_last_seen_update';

export function updatesSeenStorageKey(userId) {
    const id = safeId(userId, 128);
    return id ? `${UPDATES_SEEN_STORAGE_KEY}:${id}` : UPDATES_SEEN_STORAGE_KEY;
}

// מתי המשתמש סגר את הבאנר (או צפה בעדכונים) לאחרונה; 0 — מעולם לא, או
// שהאחסון חסום.
export function readUpdatesSeen({ storage, userId } = {}) {
    const backend = storage === undefined ? defaultStorage() : storage;
    if (!backend) return 0;
    try {
        return finiteTime(parseInt(backend.getItem(updatesSeenStorageKey(userId)) || '0', 10));
    } catch {
        return 0;
    }
}

export function markUpdatesSeen({ storage, userId, now = Date.now() } = {}) {
    const backend = storage === undefined ? defaultStorage() : storage;
    if (!backend) return false;
    try {
        backend.setItem(updatesSeenStorageKey(userId), String(finiteTime(now)));
        return true;
    } catch {
        return false; // מצב פרטי: אין שמירה
    }
}

// מה הבאנר מציג. תמיד מחזיר טקסט — גם בלי ביקור קודם — כדי שטקסט שנכתב
// למשתמש אחד ("נוספו 5 פריטים מאז הביקור הקודם שלך") לא יישאר על המסך
// למשתמש הבא; וכשאף תנאי אינו מתקיים הבאנר מוסתר, לא רק "לא נפתח".
//   since   — נקודת הייחוס של הביקור הקודם (0 בביקור הראשון)
//   summary — newSinceSummary מול נקודת הייחוס
//   newest  — הפריט החדש ביותר שנטען, לביקור הראשון
//   lastSeen — readUpdatesSeen של המשתמש הנוכחי
export function newUpdatesBannerState({ since = 0, summary = null, newest = 0, lastSeen = 0, now = Date.now() } = {}) {
    const seen = finiteTime(lastSeen);
    if (finiteTime(since)) {
        const count = Math.max(0, Math.floor(Number(summary?.count) || 0));
        const visible = count > 0 && finiteTime(summary?.newest) > seen;
        return { visible, text: visible ? newSinceLabel(summary) : NEW_UPDATES_DEFAULT_TEXT };
    }
    const latest = finiteTime(newest);
    const visible = latest > seen && finiteTime(now) - latest < NEW_UPDATES_RECENT_MS;
    return { visible, text: NEW_UPDATES_DEFAULT_TEXT };
}

// --- התצוגה המקדימה של תיקייה ---

// עד limit מהתמונות האחרונות של התיקייה ("all" — מכל הארכיון), מהחדשה לישנה,
// כל אחת פעם אחת, עם המקור שהכרטיס בגלריה היה מציג (התצוגה הקטנה thumb
// כשקיימת — ראו pickCardSource). פריט בלי מקור להצגה (סרטון בלי פוסטר) נידלג.
export function pickFolderPreviewFrames(lists, folderId, { limit = FOLDER_PREVIEW_FRAMES, sanitize } = {}) {
    const target = safeId(folderId);
    if (!target) return [];
    const seen = new Set();
    const candidates = [];
    for (const list of Array.isArray(lists) ? lists : []) {
        for (const item of Array.isArray(list) ? list : []) {
            const id = safeId(item?.id);
            if (!id || seen.has(id)) continue;
            if (target !== 'all' && safeId(item.folderId) !== target) continue;
            seen.add(id);
            candidates.push(item);
        }
    }
    candidates.sort((a, b) => createdTime(b) - createdTime(a));
    const frames = [];
    for (const item of candidates) {
        if (frames.length >= Math.max(0, limit)) break;
        const source = sanitize ? pickCardSource(item, sanitize) : pickCardSource(item);
        if (!source.url) continue;
        frames.push({ id: safeId(item.id), url: source.url, isVariant: source.isVariant });
    }
    return frames;
}
