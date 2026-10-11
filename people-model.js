// people-model.js — ההיגיון הטהור של "אנשים בגלריה" ו"התמונות שלי", בלי DOM.
//
// כאן נמצא כל מה שאפשר לבדוק ב-Node: פירוש נתיב ה-hash של האלבום, חישוב
// החיתוך של פרצוף מתוך התמונה, נרמול תשובות ה-Worker, מיון וסינון לפי שם,
// והגדלת תמונת הפרופיל של Google. הממשק עצמו נמצא ב-people.js (הגלריה)
// וב-face-people.js (לוח הניהול).

export const PEOPLE_DIRECTORY_HASH = '#people';
export const PERSON_HASH_PREFIX = '#person/';
const PERSON_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// גודל החיתוך ביחס לפרצוף: מעט רקע סביב הפנים, כמו בתמונת פרופיל.
export const FACE_CROP_PADDING = 1.6;

// ההסבר הקצר שמוצג בחלון "התמונות שלי" — מקור אחד לטקסט, כדי שהבדיקות
// יוודאו שהוא מבטיח בדיוק את מה שהקוד עושה.
export const FIND_ME_PRIVACY_NOTE = 'הזיהוי נעשה בדפדפן שלך. לשרת נשלחת רק טביעה מספרית של הפנים — לא התמונה — '
    + 'לצורך ההשוואה, והיא אינה נשמרת, אלא אם סימנת „זכור אותי”. אפשר למחוק אותה בכל עת ב„שכח אותי”. '
    + 'סלפי שתבחר מעובד במכשיר בלבד ואינו מועלה.';

export function isPersonId(value) {
    return PERSON_ID_PATTERN.test(String(value ?? ''));
}

// '#people' → רשימת האנשים; '#person/<id>' → האלבום של אדם; אחרת null.
export function parsePeopleRoute(hash) {
    const value = String(hash ?? '');
    if (value === PEOPLE_DIRECTORY_HASH) return { view: 'directory' };
    if (value.startsWith(PERSON_HASH_PREFIX)) {
        let personId = '';
        try {
            personId = decodeURIComponent(value.slice(PERSON_HASH_PREFIX.length));
        } catch {
            return null;
        }
        return isPersonId(personId) ? { view: 'person', personId } : null;
    }
    return null;
}

export function personHash(personId) {
    return isPersonId(personId) ? `${PERSON_HASH_PREFIX}${personId}` : '';
}

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

// מיקום הפרצוף (x, y, w, h יחסיים לתמונה; a = רוחב/גובה של התמונה) הופך
// למיקום של <img> בתוך מסגרת ריבועית עם overflow: hidden, כך שריבוע סביב
// הפנים ממלא את המסגרת. אותה תמונה קטנה משמשת לכל גודל תצוגה. בלי מיקום
// תקין מוחזר null והתמונה מוצגת כולה (object-fit: cover).
export function faceCropStyle(box, padding = FACE_CROP_PADDING) {
    if (!box || typeof box !== 'object') return null;
    const x = finite(box.x);
    const y = finite(box.y);
    const w = finite(box.w);
    const h = finite(box.h);
    const a = finite(box.a);
    if ([x, y, w, h, a].some(Number.isNaN) || w <= 0 || h <= 0 || a <= 0 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
    // צלע הריבוע, ביחידות של גובה התמונה ושל רוחבה. ריבוע גדול מהתמונה
    // מוקטן כדי שהחיתוך לא יחרוג ממנה.
    let sideHeight = padding * Math.max(w * a, h);
    let sideWidth = sideHeight / a;
    const overflow = Math.max(sideWidth, sideHeight);
    if (overflow > 1) {
        sideWidth /= overflow;
        sideHeight /= overflow;
    }
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const left = Math.min(Math.max(centerX - sideWidth / 2, 0), 1 - sideWidth);
    const top = Math.min(Math.max(centerY - sideHeight / 2, 0), 1 - sideHeight);
    return {
        width: `${round(100 / sideWidth)}%`,
        height: `${round(100 / sideHeight)}%`,
        left: `${round(-(left / sideWidth) * 100)}%`,
        top: `${round(-(top / sideHeight) * 100)}%`
    };
}

// מיקום הפרצוף מתוך תוצאת הזיהוי של face-api ומידות התמונה.
export function boxFromDetection(detectionBox, width, height) {
    const naturalWidth = Number(width);
    const naturalHeight = Number(height);
    if (!detectionBox || !(naturalWidth > 0) || !(naturalHeight > 0)) return null;
    const clamp = value => Math.min(1, Math.max(0, value));
    const x = clamp(Number(detectionBox.x) / naturalWidth);
    const y = clamp(Number(detectionBox.y) / naturalHeight);
    const w = Math.min(1 - x, Number(detectionBox.width) / naturalWidth);
    const h = Math.min(1 - y, Number(detectionBox.height) / naturalHeight);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    const r4 = value => Math.floor(value * 10000) / 10000;
    return { x: r4(x), y: r4(y), w: r4(w), h: r4(h), a: Math.round((naturalWidth / naturalHeight) * 10000) / 10000 };
}

// תמונת הפרופיל של Google מגיעה בדרך כלל ב-96px (=s96-c). לזיהוי פנים
// מבקשים גרסה גדולה יותר של אותה תמונה, באותה כתובת.
export function largerGooglePhotoUrl(url, size = 512) {
    const value = String(url ?? '').trim();
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return '';
    }
    if (parsed.protocol !== 'https:') return '';
    if (!/(^|\.)googleusercontent\.com$/i.test(parsed.hostname)) return parsed.href;
    if (/=s\d+(-c)?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/=s\d+(-c)?$/i, `=s${size}-c`);
    } else if (/\/s\d+(-c)?\//i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/s\d+(-c)?\//i, `/s${size}-c/`);
    } else if (!parsed.pathname.includes('=')) {
        parsed.pathname = `${parsed.pathname}=s${size}-c`;
    }
    return parsed.href;
}

function safeHttpsUrl(value, sanitize) {
    const cleaned = typeof sanitize === 'function' ? sanitize(value) : String(value ?? '');
    return /^https:\/\//i.test(String(cleaned || '')) ? String(cleaned) : '';
}

// אדם כפי שהממשק משתמש בו. כל שדה נבדק, כי התשובה מגיעה מהרשת.
export function normalizePerson(raw, sanitize) {
    const personId = String(raw?.personId ?? '');
    if (!isPersonId(personId)) return null;
    const cover = raw?.cover && typeof raw.cover === 'object'
        ? { imageId: String(raw.cover.imageId ?? ''), box: raw.cover.box || null, url: safeHttpsUrl(raw.cover.url, sanitize) }
        : null;
    return {
        personId,
        name: String(raw?.name ?? '').trim(),
        faceCount: Math.max(0, Math.trunc(Number(raw?.faceCount) || 0)),
        imageCount: Math.max(0, Math.trunc(Number(raw?.imageCount) || 0)),
        cover: cover && cover.url ? cover : null
    };
}

export function normalizePersonsResponse(payload, sanitize) {
    const list = Array.isArray(payload?.persons) ? payload.persons : [];
    return sortPeople(list.map(person => normalizePerson(person, sanitize)).filter(person => person && person.name));
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('he', { sensitivity: 'base', numeric: true }) : null;

export function sortPeople(people) {
    return [...people].sort((left, right) => (collator
        ? collator.compare(left.name, right.name)
        : left.name.localeCompare(right.name)) || left.personId.localeCompare(right.personId));
}

// חיפוש שם: בלי ניקוד וטעמים, בלי גרשיים, ובלי הבדל בין אותיות סופיות לרגילות.
export function normalizeNameForSearch(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[֑-ׇ]/g, '')
        .replace(/["'״׳`]/g, '')
        .replace(/[ךםןףץ]/g, letter => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[letter]))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function filterPeople(people, query) {
    const needle = normalizeNameForSearch(query);
    if (!needle) return people;
    return people.filter(person => normalizeNameForSearch(person.name).includes(needle));
}

export function imageCountLabel(count) {
    const value = Math.max(0, Math.trunc(Number(count) || 0));
    if (value === 0) return 'אין תמונות';
    if (value === 1) return 'תמונה אחת';
    return `${value} תמונות`;
}

export function faceCountLabel(count) {
    const value = Math.max(0, Math.trunc(Number(count) || 0));
    return value === 1 ? 'פרצוף אחד' : `${value} פרצופים`;
}

// סדר התוצאות של האלבום נקבע בשרת (מהחדש לישן); הרשומות שהגיעו מהענן
// מסודרות לפיו, ומזהה שאין לו רשומה (נמחק בינתיים) נשמט.
export function orderRecordsByIds(ids, records, safeId = value => String(value ?? '')) {
    const byId = new Map();
    for (const record of records || []) {
        const id = safeId(record?.id);
        if (id && !byId.has(id)) byId.set(id, record);
    }
    return (ids || []).map(id => byId.get(safeId(id))).filter(Boolean);
}

export function chunk(list, size) {
    const result = [];
    for (let offset = 0; offset < list.length; offset += size) result.push(list.slice(offset, offset + size));
    return result;
}
