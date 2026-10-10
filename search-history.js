// search-history.js — חיפושים אחרונים וחיפושים שמורים (בכוכב), לכל משתמש בנפרד.
//
// מודול טהור, בלי DOM, ונבדק ב-Node (search-history.test.mjs). הממשק — התפריט
// שנפתח מתחת לשדה החיפוש — ב-search-history-ui.js.
//
// "חיפוש" הוא טקסט החיפוש יחד עם הסינון הפעיל: תיקייה, שנה וחודש עבריים, סוג
// המדיה ותגיות (כשיש). שני חיפושים זהים כשהטקסט (בלי הבדלי רישיות ורווחים)
// וכל הסינונים זהים, ולכן מזהה החיפוש נגזר מהתוכן שלו: אותו חיפוש מקבל את
// אותו מזהה ברשימת האחרונים וברשימת השמורים.
//
// האחסון הוא localStorage, במפתח נפרד לכל משתמש מחובר (ומפתח "anonymous" למי
// שאינו מחובר). אחסון חסום, מלא או פגום לעולם אינו זורק: הרשימה ממשיכה לעבוד
// בזיכרון עד רענון הדף, ו-persistent מדווח שהיא אינה נשמרת.
//
// החיפושים השמורים מסונכרנים גם למסמך userPreferences של המשתמש ב-Worker
// (השדות savedSearches ו-savedSearchesUpdatedAt). החיפושים האחרונים נשארים
// בדפדפן בלבד. ראו mergeRemoteSaved.
import { HEBREW_MONTH_ORDER, hebrewMonthName, formatHebrewYear } from './hebrew-date.js';

export const SEARCH_HISTORY_STORAGE_PREFIX = 'simchas_gallery_searches_v1';
export const ANONYMOUS_USER_KEY = 'anonymous';
export const SEARCH_HISTORY_VERSION = 1;
export const RECENT_SEARCH_LIMIT = 10;
export const SAVED_SEARCH_LIMIT = 20;
export const MAX_QUERY_LENGTH = 120;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;
export const MEDIA_TYPES = Object.freeze(['image', 'video']);
// חיפוש שמתחדד בהקלדה ("בר" ואז "בר מצווה") תוך דקה מחליף את הקודם, כדי
// שהרשימה לא תתמלא בשלבי ההקלדה של אותו חיפוש.
export const RECENT_COLLAPSE_MS = 60 * 1000;

const SAFE_ID_PATTERN = /[^a-zA-Z0-9_-]/g;

function safeId(value, max = 120) {
    return String(value ?? '').replace(SAFE_ID_PATTERN, '').slice(0, max);
}

function cleanText(value, max) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function finiteTime(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function lower(text) {
    return String(text || '').toLocaleLowerCase('he');
}

// --- נרמול ---

export function normalizeQuery(value) {
    return cleanText(value, MAX_QUERY_LENGTH);
}

// רק סינונים פעילים נשמרים, ובצורה קבועה: אובייקט בלי מפתחות ריקים. "all"
// היא "בלי תיקייה". ערך פסול מושמט ואינו מפיל את החיפוש כולו.
export function normalizeFilters(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const filters = {};
    const folderId = safeId(source.folderId);
    if (folderId && folderId !== 'all') filters.folderId = folderId;
    const year = Number(source.hebrewYear);
    if (Number.isInteger(year) && year >= 5000 && year < 7000) filters.hebrewYear = year;
    if (HEBREW_MONTH_ORDER.includes(source.hebrewMonth)) filters.hebrewMonth = source.hebrewMonth;
    if (MEDIA_TYPES.includes(source.mediaType)) filters.mediaType = source.mediaType;
    if (Array.isArray(source.tags)) {
        const seen = new Set();
        const tags = [];
        for (const tag of source.tags) {
            const text = cleanText(tag, MAX_TAG_LENGTH);
            const key = lower(text);
            if (!text || seen.has(key)) continue;
            seen.add(key);
            tags.push(text);
        }
        tags.sort((a, b) => a.localeCompare(b, 'he'));
        if (tags.length) filters.tags = tags.slice(0, MAX_TAGS);
    }
    return filters;
}

// { query, filters } מנורמל, או null כשאין בו דבר לחפש.
export function normalizeSearch(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const query = normalizeQuery(raw.query);
    const filters = normalizeFilters(raw.filters);
    if (!query && !Object.keys(filters).length) return null;
    return { query, filters };
}

// חתימה קנונית לזיהוי כפילויות: הטקסט באותיות קטנות וכל הסינונים בסדר קבוע.
export function searchSignature(raw) {
    const search = normalizeSearch(raw);
    if (!search) return '';
    const f = search.filters;
    return JSON.stringify([
        lower(search.query), f.folderId || '', f.hebrewYear || 0, f.hebrewMonth || '',
        f.mediaType || '', (f.tags || []).map(lower)
    ]);
}

// FNV-1a בשני זרעים — 64 ביט בסך הכול, יותר ממספיק לכמה עשרות חיפושים.
function fnv1a(text, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).padStart(7, '0');
}

export function searchId(raw) {
    const signature = searchSignature(raw);
    return signature ? `s${fnv1a(signature, 0x811c9dc5)}${fnv1a(signature, 0x9747b28c)}` : '';
}

// רשומה ברשימה: התוכן המנורמל, מזהה שנגזר ממנו (מזהה שמור אינו נאמן — הוא
// מחושב מחדש) וזמן.
function normalizeEntry(raw, timeField) {
    const search = normalizeSearch(raw);
    if (!search) return null;
    return { id: searchId(search), query: search.query, filters: search.filters, [timeField]: finiteTime(raw[timeField]) };
}

function normalizeList(list, timeField, max) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const result = [];
    for (const raw of list) {
        const entry = normalizeEntry(raw, timeField);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        result.push(entry);
        if (result.length >= max) break;
    }
    return result;
}

function emptyState() {
    return { v: SEARCH_HISTORY_VERSION, recent: [], saved: [], savedUpdatedAt: 0, savedSyncedAt: 0 };
}

// קריאת התוכן השמור. JSON פגום, גרסה אחרת או מבנה זר — מתחילים מרשימה ריקה;
// רשומות בודדות פסולות מושמטות והשאר נשמרות.
export function parseHistoryState(text, { recentLimit = RECENT_SEARCH_LIMIT, savedLimit = SAVED_SEARCH_LIMIT } = {}) {
    let parsed = null;
    try {
        parsed = typeof text === 'string' ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.v !== SEARCH_HISTORY_VERSION) return emptyState();
    return {
        v: SEARCH_HISTORY_VERSION,
        recent: normalizeList(parsed.recent, 'at', recentLimit),
        saved: normalizeList(parsed.saved, 'savedAt', savedLimit),
        savedUpdatedAt: finiteTime(parsed.savedUpdatedAt),
        savedSyncedAt: finiteTime(parsed.savedSyncedAt)
    };
}

// --- מפתח האחסון ---

export function userStorageKey(userId) {
    return safeId(userId, 128) || ANONYMOUS_USER_KEY;
}

export function storageKeyFor(userId) {
    return `${SEARCH_HISTORY_STORAGE_PREFIX}:${userStorageKey(userId)}`;
}

// localStorage של הדפדפן, או null כשהגישה אליו עצמה נחסמת (Safari במצב פרטי
// ישן, עוגיות חסומות — אז כבר הקריאה ל-window.localStorage זורקת).
function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

// --- תיאור לתצוגה ---

const MEDIA_TYPE_LABELS = { image: 'תמונות בלבד', video: 'סרטונים בלבד' };

// הפרטים שמוצגים מתחת לטקסט החיפוש, בעברית. folderName מקבל מזהה ומחזיר את
// שם התיקייה (או מחרוזת ריקה כשהיא אינה קיימת עוד).
export function describeSearch(raw, { folderName = () => '' } = {}) {
    const search = normalizeSearch(raw);
    if (!search) return { query: '', details: [] };
    const f = search.filters;
    const details = [];
    if (f.folderId === 'favorites') details.push('המועדפים');
    else if (f.folderId) details.push(`תיקייה: ${folderName(f.folderId) || 'תיקייה שאינה קיימת עוד'}`);
    if (f.hebrewYear) details.push(`שנת ${formatHebrewYear(f.hebrewYear)}`);
    if (f.hebrewMonth) details.push(`חודש ${hebrewMonthName(f.hebrewMonth)}`);
    if (f.mediaType) details.push(MEDIA_TYPE_LABELS[f.mediaType]);
    if (f.tags?.length) details.push(`תגיות: ${f.tags.join(', ')}`);
    return { query: search.query, details };
}

// --- המאגר ---

export function createSearchHistoryStore({
    storage,
    userId = '',
    now = () => Date.now(),
    recentLimit = RECENT_SEARCH_LIMIT,
    savedLimit = SAVED_SEARCH_LIMIT,
    collapseMs = RECENT_COLLAPSE_MS
} = {}) {
    const backend = storage === undefined ? defaultStorage() : storage;
    const key = storageKeyFor(userId);
    const limits = { recentLimit, savedLimit };
    let memory = emptyState();
    // כל כשל קריאה או כתיבה מעביר את המאגר לזיכרון בלבד עד סוף הביקור: כך
    // כתיבה שנכשלה (מכסה מלאה) אינה "נמחקת" בקריאה הבאה מהאחסון הישן.
    let persistent = Boolean(backend && typeof backend.getItem === 'function' && typeof backend.setItem === 'function');

    // נקרא מחדש לפני כל פעולה, כדי שלשונית אחרת שכתבה בינתיים לא תידרס.
    function load() {
        if (!persistent) return memory;
        try {
            const text = backend.getItem(key);
            memory = text === null || text === undefined ? emptyState() : parseHistoryState(text, limits);
        } catch {
            persistent = false;
        }
        return memory;
    }

    function save(state) {
        memory = state;
        if (!persistent) return false;
        try {
            backend.setItem(key, JSON.stringify(state));
            return true;
        } catch {
            persistent = false;
            return false;
        }
    }

    const copy = list => list.map(entry => ({ ...entry, filters: structuredCloneFilters(entry.filters) }));

    function getRecent() {
        return copy(load().recent);
    }

    function getSaved() {
        return copy(load().saved);
    }

    function isSaved(raw) {
        const id = typeof raw === 'string' ? raw : searchId(raw);
        return Boolean(id) && load().saved.some(entry => entry.id === id);
    }

    // מוסיף חיפוש לראש הרשימה. כפילות עולה לראש עם זמן חדש; חיפוש שמרחיב את
    // האחרון (המשך הקלדה) תוך collapseMs מחליף אותו.
    function addRecent(raw) {
        const search = normalizeSearch(raw);
        if (!search) return null;
        const state = load();
        const time = now();
        const entry = { id: searchId(search), query: search.query, filters: search.filters, at: time };
        let recent = state.recent;
        const head = recent[0];
        if (head && head.id !== entry.id && head.query && entry.query
            && time - head.at >= 0 && time - head.at <= collapseMs
            && lower(entry.query).startsWith(lower(head.query))) {
            recent = recent.slice(1);
        }
        recent = [entry, ...recent.filter(item => item.id !== entry.id)].slice(0, recentLimit);
        save({ ...state, recent });
        return { ...entry, filters: structuredCloneFilters(entry.filters) };
    }

    function removeRecent(id) {
        const state = load();
        const recent = state.recent.filter(entry => entry.id !== id);
        if (recent.length === state.recent.length) return false;
        save({ ...state, recent });
        return true;
    }

    function clearRecent() {
        const state = load();
        save({ ...state, recent: [] });
    }

    // שמירה בכוכב. { ok, entry } או { ok: false, reason: 'empty' | 'limit' }.
    function saveSearch(raw) {
        const search = normalizeSearch(raw);
        if (!search || !search.query) return { ok: false, reason: 'empty' };
        const state = load();
        const id = searchId(search);
        const existing = state.saved.find(entry => entry.id === id);
        if (existing) return { ok: true, entry: { ...existing }, existed: true };
        if (state.saved.length >= savedLimit) return { ok: false, reason: 'limit' };
        const time = now();
        const entry = { id, query: search.query, filters: search.filters, savedAt: time };
        save({ ...state, saved: [entry, ...state.saved], savedUpdatedAt: Math.max(time, state.savedUpdatedAt + 1) });
        return { ok: true, entry: { ...entry, filters: structuredCloneFilters(entry.filters) } };
    }

    function unsaveSearch(id) {
        const state = load();
        const saved = state.saved.filter(entry => entry.id !== id);
        if (saved.length === state.saved.length) return false;
        save({ ...state, saved, savedUpdatedAt: Math.max(now(), state.savedUpdatedAt + 1) });
        return true;
    }

    // { saved: true|false, ok, reason } — מצב הכוכב אחרי הלחיצה.
    function toggleSaved(raw) {
        const id = typeof raw === 'string' ? raw : searchId(raw);
        if (id && isSaved(id)) {
            unsaveSearch(id);
            return { ok: true, saved: false };
        }
        const result = saveSearch(raw);
        return { ...result, saved: result.ok };
    }

    // "הסר" בשורה: החיפוש יורד משתי הרשימות.
    function removeSearch(id) {
        const state = load();
        const recent = state.recent.filter(entry => entry.id !== id);
        const saved = state.saved.filter(entry => entry.id !== id);
        if (recent.length === state.recent.length && saved.length === state.saved.length) return false;
        const savedChanged = saved.length !== state.saved.length;
        save({
            ...state, recent, saved,
            savedUpdatedAt: savedChanged ? Math.max(now(), state.savedUpdatedAt + 1) : state.savedUpdatedAt
        });
        return true;
    }

    function clearAll() {
        const state = load();
        save({
            ...state, recent: [], saved: [],
            savedUpdatedAt: state.saved.length ? Math.max(now(), state.savedUpdatedAt + 1) : state.savedUpdatedAt
        });
    }

    // מה שנכתב למסמך userPreferences בענן.
    function exportSaved() {
        const state = load();
        return {
            savedSearches: state.saved.map(({ query, filters, savedAt }) => ({ query, filters: structuredCloneFilters(filters), savedAt })),
            savedSearchesUpdatedAt: state.savedUpdatedAt
        };
    }

    // מיזוג הרשימה מהענן. המדיניות:
    //   - בפעם הראשונה שהדפדפן הזה רואה את הענן: איחוד — שום חיפוש שמור
    //     מקומי או מרוחק אינו הולך לאיבוד; אם האיחוד שונה מהענן, יש לדחוף.
    //   - אחר כך: הגרסה עם savedSearchesUpdatedAt המאוחר גוברת (לכל הרשימה).
    // מחזיר { changed, push }: האם הרשימה המקומית השתנתה, והאם יש לכתוב לענן.
    function mergeRemoteSaved(remote) {
        const state = load();
        const time = now();
        const hasRemote = Boolean(remote && typeof remote === 'object' && Array.isArray(remote.savedSearches));
        if (!hasRemote) {
            save({ ...state, savedSyncedAt: time });
            return { changed: false, push: state.saved.length > 0 };
        }
        const remoteList = normalizeList(remote.savedSearches, 'savedAt', savedLimit);
        const remoteAt = finiteTime(remote.savedSearchesUpdatedAt);
        const sameIds = (first, second) => first.length === second.length && first.every((entry, index) => entry.id === second[index].id);

        if (!state.savedSyncedAt) {
            const seen = new Set();
            const union = [...remoteList, ...state.saved]
                .filter(entry => (seen.has(entry.id) ? false : seen.add(entry.id)))
                .sort((a, b) => b.savedAt - a.savedAt)
                .slice(0, savedLimit);
            const changed = !sameIds(union, state.saved);
            const push = !sameIds(union, remoteList);
            save({
                ...state,
                saved: union,
                savedUpdatedAt: push ? Math.max(time, remoteAt + 1, state.savedUpdatedAt) : Math.max(remoteAt, state.savedUpdatedAt),
                savedSyncedAt: time
            });
            return { changed, push };
        }
        if (remoteAt > state.savedUpdatedAt) {
            const changed = !sameIds(remoteList, state.saved);
            save({ ...state, saved: remoteList, savedUpdatedAt: remoteAt, savedSyncedAt: time });
            return { changed, push: false };
        }
        return { changed: false, push: remoteAt < state.savedUpdatedAt };
    }

    function markSynced() {
        const state = load();
        save({ ...state, savedSyncedAt: now() });
    }

    function hasSynced() {
        return load().savedSyncedAt > 0;
    }

    return {
        key,
        userKey: userStorageKey(userId),
        get persistent() { return persistent; },
        getRecent, getSaved, isSaved,
        addRecent, removeRecent, clearRecent,
        saveSearch, unsaveSearch, toggleSaved, removeSearch, clearAll,
        exportSaved, mergeRemoteSaved, markSynced, hasSynced
    };
}

function structuredCloneFilters(filters) {
    const copy = { ...filters };
    if (Array.isArray(copy.tags)) copy.tags = [...copy.tags];
    return copy;
}
