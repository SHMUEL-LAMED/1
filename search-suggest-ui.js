// search-suggest-ui.js — המקורות והפעולות של הצעות ההשלמה בשדה החיפוש של
// הגלריה. ההתאמה והדירוג ב-search-suggest.js (בלי DOM); התפריט עצמו — אותו
// combobox של החיפושים האחרונים והשמורים, בלי חלון שני — ב-search-history-ui.js.
//
// מאיפה ההצעות:
//   תיקיות ואירועים — state.folders, עם המונים מהשרת (folderCounts).
//   סוג הרגע — תגיות הסצנה שיש להן פריטים במה שנטען, כמו שבבי הסינון.
//   אנשים — רק למשתמש מחובר ומאושר: people.js נטען עצלה בהקלדה הראשונה, ומחזיר
//     את השמות שהשרת מתיר לצופה (מאושרים, עם שם ובלי הסתרה). חיתוכי הפנים
//     ומנוע זיהוי הפנים אינם נטענים בשביל ההצעות.
//   מעלים — uploadedByName של הפריטים שנטענו.
//
// בחירה בהצעה מחליפה את הטקסט שהוקלד בסינון המתאים: תיקייה נפתחת, תגית מפעילה
// את שבב סוג הרגע, אדם פותח את האלבום שלו (#person/<id>), ושם של מעלה נכתב
// בשדה ומחופש כטקסט.
import {
    buildSuggestionIndex, folderCandidates, itemCountLabel, personCandidates, rankSuggestions,
    tagCandidates, uploaderCandidates
} from './search-suggest.js';
import { imageCountLabel, parsePeopleRoute, personHash } from './people-model.js';

// רשימת האנשים נשמרת לביקור, ומתרעננת לכל היותר פעם בחמש דקות (people.js
// עצמו שומר אותה דקה, ולכן רענון כזה פונה לשרת רק כשבאמת עבר זמן).
const PEOPLE_SUGGEST_TTL_MS = 5 * 60 * 1000;

const people = { uid: '', list: [], loadedAt: 0, pending: null };
let cachedIndex = { sources: [], index: [] };

function currentUserId() {
    const state = window.state;
    return state?.isGoogleUser && state.currentUser?.uid ? String(state.currentUser.uid) : '';
}

function canSuggestPeople() {
    return Boolean(window.state?.isGoogleUser && window.state?.userApprovalStatus === 'approved');
}

function visiblePeople() {
    return canSuggestPeople() && people.uid === currentUserId() ? people.list : [];
}

// התנתקות, החלפת חשבון: השמות של משתמש אחד אינם מוצעים לבא אחריו.
export function resetSuggestionSources() {
    people.uid = '';
    people.list = [];
    people.loadedAt = 0;
    people.pending = null;
    cachedIndex = { sources: [], index: [] };
}

// טוען (פעם אחת, ברקע) את רשימת האנשים. מחזיר true כשהרשימה התחדשה, כדי
// שהתפריט יחשב את ההצעות מחדש.
export function loadPeopleSuggestions() {
    if (!canSuggestPeople()) return Promise.resolve(false);
    const uid = currentUserId();
    if (people.uid === uid && people.pending) return people.pending;
    if (people.uid === uid && Date.now() - people.loadedAt < PEOPLE_SUGGEST_TTL_MS) return Promise.resolve(false);
    if (people.uid !== uid) people.list = [];
    people.uid = uid;
    const request = (async () => {
        await window.ensurePeopleModule?.();
        const list = typeof window.listPeopleForSearch === 'function' ? await window.listPeopleForSearch() : [];
        if (people.uid !== uid || people.pending !== request) return false;
        people.list = Array.isArray(list) ? list : [];
        people.loadedAt = Date.now();
        return true;
    })().catch(error => {
        // שרת ישן בלי /face/persons, או תקלה רגעית: בלי הצעות של אנשים, ובלי
        // לנסות שוב בכל הקשה.
        console.warn('People suggestions failed to load:', error);
        if (people.uid === uid && people.pending === request) people.loadedAt = Date.now();
        return false;
    }).finally(() => {
        if (people.pending === request) people.pending = null;
    });
    people.pending = request;
    return request;
}

// המפתח נבנה מחדש רק כשאחד המקורות התחלף או גדל (עמוד נוסף של פריטים,
// תיקייה חדשה, מונים מהשרת, רשימת אנשים).
function suggestionIndex() {
    const state = window.state || {};
    const folders = Array.isArray(state.folders) ? state.folders : [];
    const items = Array.isArray(state.images) ? state.images : [];
    const personList = visiblePeople();
    const sources = [folders, folders.length, items, items.length, state.folderCounts || null, personList];
    if (sources.length === cachedIndex.sources.length && sources.every((value, index) => value === cachedIndex.sources[index])) {
        return cachedIndex.index;
    }
    const safe = value => (window.safeRecordId ? window.safeRecordId(value) : String(value ?? ''));
    const index = buildSuggestionIndex([
        ...folderCandidates(folders.map(folder => ({ id: safe(folder?.id), name: folder?.name })), {
            counts: state.folderCounts && typeof state.folderCounts === 'object' ? state.folderCounts : null,
            items
        }),
        ...tagCandidates(items),
        ...personCandidates(personList),
        ...uploaderCandidates(items)
    ]);
    cachedIndex = { sources, index };
    return index;
}

function metaFor(item) {
    if (item.kind === 'person') return item.count ? imageCountLabel(item.count) : '';
    return itemCountLabel(item.count);
}

// ההצעות לטקסט שבשדה, בקבוצות ובסדר התצוגה, עם שורת הפרטים של כל אחת.
export function suggestionsFor(text) {
    return rankSuggestions(suggestionIndex(), text).map(group => ({
        ...group,
        items: group.items.map(item => ({ ...item, meta: metaFor(item) }))
    }));
}

function clearSearchText() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    window.handleSearch?.('');
}

// אלבום של אדם שמוצג עכשיו נסגר לפני מעבר לתיקייה או לסוג רגע — אחרת ה-hash
// היה נשאר #person/<id> מעל גלריה אחרת. כשה-hash כזה, people.js כבר נטען.
function leavePersonAlbum() {
    if (parsePeopleRoute(window.location.hash)?.view === 'person') window.closePeopleAlbum?.();
}

// מפעיל הצעה; מחזיר את ההודעה לקוראי מסך.
export async function applySuggestion(item) {
    const label = String(item?.label || '');
    const snapshot = typeof window.getGallerySearchSnapshot === 'function'
        ? window.getGallerySearchSnapshot()
        : { filters: {} };
    switch (item?.kind) {
        case 'folder':
            leavePersonAlbum();
            // הסינונים האחרים (שנה, חודש, סוג המדיה, סוג הרגע) נשארים; הטקסט
            // שהוקלד הוחלף בתיקייה.
            await window.applyGallerySearch?.({ query: '', filters: { ...snapshot.filters, folderId: item.id } });
            return `נפתחה התיקייה „${label}”.`;
        case 'tag':
            leavePersonAlbum();
            await window.applyGallerySearch?.({ query: '', filters: { ...snapshot.filters, tags: [item.id] } });
            return `מוצגים פריטים מסוג ${label}.`;
        case 'person': {
            const hash = personHash(item.id);
            if (!hash) return '';
            // בלי הטקסט, שהיה מסנן את האלבום לפי שם האדם עצמו.
            clearSearchText();
            if (window.location.hash === hash) window.handlePeopleRoute?.(hash);
            else window.location.hash = hash;
            return `נפתח האלבום של ${label}.`;
        }
        case 'uploader': {
            const input = document.getElementById('searchInput');
            if (input) input.value = label;
            window.handleSearch?.(label);
            return `החיפוש „${label}” הופעל.`;
        }
        default:
            return '';
    }
}
