// print-album.js — אלבום להדפסה: ההיגיון הטהור, בלי DOM.
//
// האלבום נבנה מתיקייה (עמוד האירוע) או מהפריטים הנבחרים (סרגל הבחירה
// המרובה): עמוד שער — שם האירוע, התאריך העברי ומספר התמונות — ואחריו
// התמונות, 1, 2 או 4 בכל עמוד A4, כל אחת עם השם והכיתוב שלה. ה-PDF עצמו
// הוא של הדפדפן ("שמירה כ־PDF" בחלון ההדפסה), ולכן אין כאן ספרייה: המודול
// מחליט רק מה נכנס, באיזה סדר ואיך הוא מתחלק לעמודים. הבנייה, הטעינה
// וההדפסה — ב-print-album-ui.js, והבדיקות ב-print-album.test.mjs.
import { pickPosterSource, variantEntry, isVideoLikeRecord } from './media-variants.js';
import { compareCaptureAsc, captureDateKey, hasCaptureDate } from './capture-date.js';
import { formatHebrewDate, hebrewDateFromDateKey } from './hebrew-date.js';
import { normalizeCaption } from './scene-tags.js';

// הבחירה נשמרת לכל צופה (readGalleryPreference ב-gallery-layout.js).
export const ALBUM_PER_PAGE_KEY = 'simchat-gallery-album-per-page';
export const ALBUM_PER_PAGE_OPTIONS = Object.freeze([1, 2, 4]);
// שתיים בעמוד: גדולות מספיק כדי לראות פנים, וחצי מכמות הדפים של אחת בעמוד.
export const DEFAULT_ALBUM_PER_PAGE = 2;
// תקרת הפריטים באלבום אחד. כל תמונה בינונית (1280px) נטענת לזיכרון לפני
// ההדפסה, ומעבר לכמה מאות חלון ההדפסה של הטלפון נתקע; תיקייה גדולה יותר
// מודפסת בחלקים מתוך בחירה מרובה.
export const ALBUM_MAX_ITEMS = 300;

// ברירת המחדל לניקוי כתובות: רק https, כמו ב-media-variants.js.
function secureUrl(value) {
    const url = String(value ?? '').trim();
    return /^https:\/\//i.test(url) ? url : '';
}

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function formatDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

export function normalizeAlbumPerPage(value) {
    const number = Number(value);
    return ALBUM_PER_PAGE_OPTIONS.includes(number) ? number : DEFAULT_ALBUM_PER_PAGE;
}

// הפריטים בקבוצות של perPage, לפי הסדר. העמוד האחרון יכול להיות חלקי.
export function paginateAlbum(items, perPage) {
    const size = normalizeAlbumPerPage(perPage);
    const list = Array.isArray(items) ? items : [];
    const pages = [];
    for (let index = 0; index < list.length; index += size) pages.push(list.slice(index, index + size));
    return pages;
}

// כמה עמודים יודפסו: השער ועמודי התמונות. אלבום ריק אינו מודפס כלל.
export function albumPageCount(itemCount, perPage) {
    const count = Math.max(0, Math.trunc(Number(itemCount)) || 0);
    return count ? 1 + Math.ceil(count / normalizeAlbumPerPage(perPage)) : 0;
}

// המקור להדפסה: התצוגה הבינונית (1280px) — חדה מספיק לחצי עמוד A4 וקלה
// בהרבה מהמקור; בלעדיה המקור עצמו. התצוגה הקטנה (480px) אינה ברירה: היא
// מטושטשת על נייר. סרטון — הפוסטר שלו; סרטון בלי פוסטר אינו נכנס.
export function pickAlbumSource(record, sanitize = secureUrl) {
    if (isVideoLikeRecord(record)) return pickPosterSource(record, sanitize);
    return variantEntry(record, 'medium')?.url || sanitize(record?.url);
}

// השם והכיתוב שמתחת לתמונה. כיתוב זהה לשם אינו מודפס פעמיים.
export function albumItemText(record) {
    const isVideo = isVideoLikeRecord(record);
    const title = String(record?.title ?? '').replace(/\s+/g, ' ').trim() || (isVideo ? 'סרטון ללא שם' : 'תמונה ללא שם');
    const caption = normalizeCaption(record?.caption);
    return { title, caption: caption && caption !== title ? caption : '' };
}

// הפריטים שייכנסו לאלבום: בלי כפילויות, לפי סדר הצילום (מהמוקדם למאוחר —
// אלבום מספר את האירוע מתחילתו), רק מי שיש לו מה להדפיס, ועד max.
// skipped — סרטונים בלי פוסטר וקישורים לא תקינים; truncated — מה שנחתך בתקרה.
export function prepareAlbumItems(records, { sanitize = secureUrl, max = ALBUM_MAX_ITEMS } = {}) {
    const seen = new Set();
    const unique = [];
    for (const record of Array.isArray(records) ? records : []) {
        const id = safeId(record?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(record);
    }
    unique.sort(compareCaptureAsc);
    const items = [];
    let skipped = 0;
    for (const record of unique) {
        const src = pickAlbumSource(record, sanitize);
        if (!src) {
            skipped += 1;
            continue;
        }
        const dateKey = captureDateKey(record);
        items.push({
            id: safeId(record.id),
            src,
            isVideo: isVideoLikeRecord(record),
            ...albumItemText(record),
            dateText: formatHebrewDate(hebrewDateFromDateKey(dateKey))
        });
    }
    const limit = Math.max(1, Math.trunc(Number(max)) || ALBUM_MAX_ITEMS);
    return { items: items.slice(0, limit), skipped, truncated: Math.max(0, items.length - limit) };
}

// התאריך שבשער: תאריך האירוע שהוזן, בעברית ובלועזית; בלעדיו — טווח ימי
// הצילום של הפריטים (כמו בכותרת עמוד האירוע); ובלי שניהם — ריק.
export function albumCoverDate({ eventDate = '', records = [] } = {}) {
    const eventKey = /^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || '')) ? String(eventDate) : '';
    if (eventKey) {
        return { hebrew: formatHebrewDate(hebrewDateFromDateKey(eventKey)), gregorian: formatDateKey(eventKey) };
    }
    const keys = (Array.isArray(records) ? records : []).filter(hasCaptureDate).map(captureDateKey).filter(Boolean).sort();
    if (!keys.length) return { hebrew: '', gregorian: '' };
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (first === last) return { hebrew: formatHebrewDate(hebrewDateFromDateKey(first)), gregorian: formatDateKey(first) };
    return {
        hebrew: `${formatHebrewDate(hebrewDateFromDateKey(first))} – ${formatHebrewDate(hebrewDateFromDateKey(last))}`,
        gregorian: `${formatDateKey(first)} – ${formatDateKey(last)}`
    };
}

function countPhrase(count, one, many) {
    return count === 1 ? one : `${count} ${many}`;
}

// "12 תמונות", "תמונה אחת", "10 תמונות ו־2 סרטונים" — לשער ולחלון.
export function albumCountLabel(items) {
    const list = Array.isArray(items) ? items : [];
    const videos = list.filter(item => item?.isVideo).length;
    const photos = list.length - videos;
    if (!videos) return countPhrase(photos, 'תמונה אחת', 'תמונות');
    if (!photos) return countPhrase(videos, 'סרטון אחד', 'סרטונים');
    // ו' החיבור צמודה למילה, ולפני ספרה — עם מקף: "וסרטון אחד", "ו־2 סרטונים".
    const second = countPhrase(videos, 'סרטון אחד', 'סרטונים');
    return `${countPhrase(photos, 'תמונה אחת', 'תמונות')} ${/^\d/.test(second) ? 'ו־' : 'ו'}${second}`;
}
