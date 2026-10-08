// capture-date.js — תאריך הצילום האמיתי של תמונה או סרטון.
//
// הקורא קטן וכתוב ביד, בלי תלות חיצונית, וקורא רק את הבתים שהוא צריך:
//   • JPEG — מקטע APP1 "Exif" שבראש הקובץ.
//   • WebP — מקטע EXIF שבמכולת RIFF (בדרך כלל בסוף הקובץ; מדלגים לשם).
//   • HEIC/HEIF/AVIF — פריט ה-Exif שב-meta (iinf + iloc), במקום שבו הוא בקובץ.
//   • MP4/MOV — creation_time שב-moov/mvhd (שניות מ-1904, UTC).
// מה-EXIF נלקחים DateTimeOriginal ואחריו CreateDate (DateTimeDigitized),
// עם OffsetTimeOriginal / OffsetTimeDigitized / OffsetTime כשקיימים.
//
// המקור הוא { size, read(offset, length) } — Blob בהעלאה (blobSource), או
// קריאת טווח מה-Worker בריצת ההשלמה. כך סרטון של 100MB אינו נקרא כולו.
//
// הרשומה מקבלת:
//   takenAt        — חותמת זמן (ms) של רגע הצילום.
//   takenDate      — "YYYY-MM-DD" כפי שהשעון של המצלמה הראה (תאריך קלנדרי).
//   takenAtOffset  — "+03:00" כשהקובץ מציין אזור זמן, אחרת ריק.
//   takenAtSource  — exif / video / drive, או none כשנבדק ולא נמצא תאריך.
// רשומה בלי takenAt ממוינת ומוצגת לפי זמן ההעלאה (createdAt), כמו קודם.

import { hebrewDateFromDateKey } from './hebrew-date.js';

export const TAKEN_AT_MIN = Date.UTC(1971, 0, 1);
// שעון מצלמה שמקדים מעט אינו סיבה לזרוק את התאריך; יותר מיומיים — כן.
export const TAKEN_AT_FUTURE_SLACK_MS = 2 * 86400000;
export const CAPTURE_SOURCES = Object.freeze(['exif', 'video', 'drive', 'none']);
// כמה בתים נקראים מראש. EXIF של JPEG ו-meta של HEIC נמצאים כמעט תמיד כאן.
export const CAPTURE_HEAD_BYTES = 256 * 1024;
const MAX_BOX_READ = 4 * 1024 * 1024;
const MAX_EXIF_READ = 256 * 1024;
// שניות בין 1904-01-01 (בסיס QuickTime) ל-1970-01-01.
const QUICKTIME_EPOCH_OFFSET_S = 2082844800;

export function isValidTakenAt(value, now = Date.now()) {
    return typeof value === 'number' && Number.isFinite(value)
        && value >= TAKEN_AT_MIN && value <= now + TAKEN_AT_FUTURE_SLACK_MS;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isValidDateKey(value) {
    const match = DATE_KEY_PATTERN.exec(String(value || ''));
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad = value => String(value).padStart(2, '0');

// התאריך הקלנדרי של רגע מסוים: באזור הזמן שצוין, או המקומי של הדפדפן.
export function dateKeyFromTimestamp(ms, timeZone = '') {
    if (!Number.isFinite(ms)) return '';
    const date = new Date(ms);
    if (timeZone) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date).map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseOffset(text) {
    const value = String(text || '').replace(/\0/g, '').trim();
    if (value === 'Z') return { minutes: 0, label: '+00:00' };
    const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[2]), minutes = Number(match[3]);
    if (hours > 14 || minutes > 59) return null;
    const total = (hours * 60 + minutes) * (match[1] === '-' ? -1 : 1);
    return { minutes: total, label: `${match[1]}${match[2]}:${match[3]}` };
}

// "2026:09:28 19:33:12" (+ "+03:00") → { takenAt, takenDate, takenAtOffset }.
// בלי אזור זמן השעה מתפרשת כשעון המקומי של הדפדפן — זה מה שמצלמה בלי
// הגדרת אזור זמן רושמת.
export function parseExifDateTime(text, offsetText = '', { now = Date.now() } = {}) {
    const value = String(text || '').replace(/\0/g, '').trim();
    const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part || 0));
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const takenDate = `${match[1]}-${match[2]}-${match[3]}`;
    if (!isValidDateKey(takenDate)) return null;
    const offset = parseOffset(offsetText) || parseOffset(value.slice(match[0].length));
    const takenAt = offset
        ? Date.UTC(year, month - 1, day, hour, minute, second) - offset.minutes * 60000
        : new Date(year, month - 1, day, hour, minute, second).getTime();
    if (!isValidTakenAt(takenAt, now)) return null;
    return { takenAt, takenDate, takenAtOffset: offset ? offset.label : '' };
}

// --- קריאת בתים ---
const ascii = (bytes, offset, length) => {
    let text = '';
    for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
        text += String.fromCharCode(bytes[offset + index]);
    }
    return text;
};
const u16 = (bytes, offset, little = false) => little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
const u32 = (bytes, offset, little = false) => little
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000
    : bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
const u64 = (bytes, offset) => u32(bytes, offset) * 0x100000000 + u32(bytes, offset + 4);
const uintN = (bytes, offset, size) => (size === 8 ? u64(bytes, offset) : size === 4 ? u32(bytes, offset) : size === 2 ? u16(bytes, offset) : 0);

export function blobSource(blob) {
    return {
        size: Number(blob?.size) || 0,
        read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
    };
}

export function bytesSource(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return { size: data.length, read: async (offset, length) => data.subarray(offset, offset + length) };
}

// קורא עם זיכרון של הראש: בקשה שנמצאת בתוך הבתים שכבר נקראו אינה פונה למקור.
function makeReader(source, head) {
    const size = Number(source.size) || head.length;
    return {
        size,
        async bytes(offset, length) {
            const end = Math.min(size, offset + length);
            if (offset < 0 || offset >= end) return new Uint8Array(0);
            if (end <= head.length) return head.subarray(offset, end);
            try {
                return await source.read(offset, end - offset);
            } catch (error) {
                // כשל בקריאה (רשת) אינו "אין תאריך": הוא עובר הלאה לניסיון חוזר.
                const failure = error instanceof Error ? error : new Error(String(error));
                failure.captureReadFailure = true;
                throw failure;
            }
        }
    };
}

// --- EXIF (TIFF) ---
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_CREATE_DATE = 0x9004;
const TAG_OFFSET_TIME = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

function readIfd(tiff, ifdOffset, little) {
    const entries = new Map();
    if (ifdOffset + 2 > tiff.length) return entries;
    const count = Math.min(u16(tiff, ifdOffset, little), 512);
    for (let index = 0; index < count; index += 1) {
        const entry = ifdOffset + 2 + index * 12;
        if (entry + 12 > tiff.length) break;
        const tag = u16(tiff, entry, little);
        const type = u16(tiff, entry + 2, little);
        const valueCount = u32(tiff, entry + 4, little);
        if (type === 2) {
            const valueOffset = valueCount <= 4 ? entry + 8 : u32(tiff, entry + 8, little);
            entries.set(tag, ascii(tiff, valueOffset, Math.min(valueCount, 64)).replace(/\0.*$/s, ''));
        } else if (type === 4 || type === 13) {
            entries.set(tag, u32(tiff, entry + 8, little));
        }
    }
    return entries;
}

// תוכן TIFF (מתחיל ב-"II*\0" או "MM\0*") → התאריכים הגולמיים.
export function readExifDates(tiff) {
    if (!tiff || tiff.length < 8) return null;
    const order = ascii(tiff, 0, 2);
    if (order !== 'II' && order !== 'MM') return null;
    const little = order === 'II';
    if (u16(tiff, 2, little) !== 42) return null;
    const ifd0 = readIfd(tiff, u32(tiff, 4, little), little);
    const exifPointer = ifd0.get(TAG_EXIF_IFD);
    const exif = typeof exifPointer === 'number' ? readIfd(tiff, exifPointer, little) : new Map();
    return {
        dateTimeOriginal: exif.get(TAG_DATE_TIME_ORIGINAL) || '',
        createDate: exif.get(TAG_CREATE_DATE) || '',
        offsetTime: exif.get(TAG_OFFSET_TIME) || '',
        offsetTimeOriginal: exif.get(TAG_OFFSET_TIME_ORIGINAL) || '',
        offsetTimeDigitized: exif.get(TAG_OFFSET_TIME_DIGITIZED) || ''
    };
}

export function captureFromTiff(tiff, options = {}) {
    const dates = readExifDates(tiff);
    if (!dates) return null;
    const capture = parseExifDateTime(dates.dateTimeOriginal, dates.offsetTimeOriginal || dates.offsetTime, options)
        || parseExifDateTime(dates.createDate, dates.offsetTimeDigitized || dates.offsetTime, options);
    return capture ? { ...capture, takenAtSource: 'exif' } : null;
}

// --- JPEG ---
async function jpegCapture(reader, options) {
    let position = 2;
    for (let segments = 0; segments < 64 && position + 4 <= reader.size; segments += 1) {
        const header = await reader.bytes(position, 4);
        if (header.length < 4 || header[0] !== 0xff) return null;
        const marker = header[1];
        if (marker === 0xff) { position += 1; continue; }
        if (marker === 0xda || marker === 0xd9) return null; // תחילת הנתונים: אין עוד מטא-דאטה
        if (marker >= 0xd0 && marker <= 0xd7) { position += 2; continue; }
        const length = u16(header, 2);
        if (length < 2) return null;
        if (marker === 0xe1) {
            const segment = await reader.bytes(position + 4, length - 2);
            if (ascii(segment, 0, 6) === 'Exif\0\0') {
                const capture = captureFromTiff(segment.subarray(6), options);
                if (capture) return capture;
            }
        }
        position += 2 + length;
    }
    return null;
}

// --- WebP ---
async function webpCapture(reader, options) {
    let position = 12;
    for (let chunks = 0; chunks < 64 && position + 8 <= reader.size; chunks += 1) {
        const header = await reader.bytes(position, 8);
        if (header.length < 8) return null;
        const type = ascii(header, 0, 4);
        const length = u32(header, 4, true);
        if (type === 'VP8X') {
            const flags = (await reader.bytes(position + 8, 1))[0] || 0;
            if (!(flags & 0x08)) return null; // הדגל אומר שאין EXIF בקובץ
        }
        if (type === 'EXIF') {
            let payload = await reader.bytes(position + 8, Math.min(length, MAX_EXIF_READ));
            if (ascii(payload, 0, 6) === 'Exif\0\0') payload = payload.subarray(6);
            return captureFromTiff(payload, options);
        }
        position += 8 + length + (length % 2);
    }
    return null;
}

// --- ISO BMFF (HEIC/AVIF, MP4/MOV) ---
async function readBoxHeader(reader, position, limit) {
    if (position + 8 > limit) return null;
    const header = await reader.bytes(position, 16);
    if (header.length < 8) return null;
    let size = u32(header, 0);
    const type = ascii(header, 4, 4);
    let headerSize = 8;
    if (size === 1) {
        if (header.length < 16) return null;
        size = u64(header, 8);
        headerSize = 16;
    } else if (size === 0) {
        size = limit - position;
    }
    if (size < headerSize) return null;
    return { type, start: position, size, headerSize, end: Math.min(limit, position + size) };
}

async function listBoxes(reader, start, end, maxBoxes = 256) {
    const boxes = [];
    let position = start;
    while (position < end && boxes.length < maxBoxes) {
        const box = await readBoxHeader(reader, position, end);
        if (!box) break;
        boxes.push(box);
        position = box.start + box.size;
    }
    return boxes;
}

function boxesIn(bytes, start, end) {
    const boxes = [];
    let position = start;
    while (position + 8 <= end && boxes.length < 512) {
        let size = u32(bytes, position);
        const type = ascii(bytes, position + 4, 4);
        let headerSize = 8;
        if (size === 1) { size = u64(bytes, position + 8); headerSize = 16; }
        else if (size === 0) size = end - position;
        if (size < headerSize) break;
        boxes.push({ type, start: position, headerSize, end: Math.min(end, position + size) });
        position += size;
    }
    return boxes;
}

// מוצא את מיקום פריט ה-Exif בתוך meta (HEIF): iinf אומר מה מזהה הפריט,
// iloc אומר היכן הוא בקובץ.
export function locateHeifExif(meta) {
    // meta הוא FullBox: ארבעה בתים של גרסה ודגלים לפני הילדים.
    const children = boxesIn(meta, 4, meta.length);
    const iinf = children.find(box => box.type === 'iinf');
    const iloc = children.find(box => box.type === 'iloc');
    const idat = children.find(box => box.type === 'idat');
    if (!iinf || !iloc) return null;

    let exifItemId = -1;
    const iinfVersion = meta[iinf.start + iinf.headerSize];
    const entriesStart = iinf.start + iinf.headerSize + 4 + (iinfVersion === 0 ? 2 : 4);
    for (const infe of boxesIn(meta, entriesStart, iinf.end)) {
        if (infe.type !== 'infe') continue;
        const body = infe.start + infe.headerSize;
        const version = meta[body];
        if (version < 2) continue;
        const idSize = version === 2 ? 2 : 4;
        const itemId = idSize === 2 ? u16(meta, body + 4) : u32(meta, body + 4);
        const itemType = ascii(meta, body + 4 + idSize + 2, 4);
        if (itemType === 'Exif') { exifItemId = itemId; break; }
    }
    if (exifItemId < 0) return null;

    let cursor = iloc.start + iloc.headerSize;
    const version = meta[cursor];
    cursor += 4;
    const offsetSize = meta[cursor] >> 4;
    const lengthSize = meta[cursor] & 0x0f;
    const baseOffsetSize = meta[cursor + 1] >> 4;
    const indexSize = version === 1 || version === 2 ? meta[cursor + 1] & 0x0f : 0;
    cursor += 2;
    const itemCount = version < 2 ? u16(meta, cursor) : u32(meta, cursor);
    cursor += version < 2 ? 2 : 4;
    for (let item = 0; item < itemCount && cursor < iloc.end; item += 1) {
        const itemId = version < 2 ? u16(meta, cursor) : u32(meta, cursor);
        cursor += version < 2 ? 2 : 4;
        let constructionMethod = 0;
        if (version === 1 || version === 2) {
            constructionMethod = u16(meta, cursor) & 0x0f;
            cursor += 2;
        }
        cursor += 2; // data_reference_index
        const baseOffset = uintN(meta, cursor, baseOffsetSize);
        cursor += baseOffsetSize;
        const extentCount = u16(meta, cursor);
        cursor += 2;
        let first = null;
        for (let extent = 0; extent < extentCount; extent += 1) {
            cursor += indexSize;
            const extentOffset = uintN(meta, cursor, offsetSize);
            cursor += offsetSize;
            const extentLength = uintN(meta, cursor, lengthSize);
            cursor += lengthSize;
            if (!first) first = { offset: baseOffset + extentOffset, length: extentLength };
        }
        if (itemId !== exifItemId || !first) continue;
        if (constructionMethod === 1) {
            if (!idat) return null;
            return { inMeta: true, offset: idat.start + idat.headerSize + first.offset, length: first.length };
        }
        if (constructionMethod !== 0) return null;
        return { inMeta: false, offset: first.offset, length: first.length };
    }
    return null;
}

// פריט ה-Exif מתחיל בארבעה בתים: המרחק מסופם עד כותרת ה-TIFF.
function captureFromHeifExifItem(item, options) {
    if (!item || item.length < 8) return null;
    const tiffStart = 4 + u32(item, 0);
    return captureFromTiff(item.subarray(tiffStart), options);
}

async function heifCapture(reader, metaBox, options) {
    const meta = await reader.bytes(metaBox.start + metaBox.headerSize, Math.min(metaBox.end - metaBox.start - metaBox.headerSize, MAX_BOX_READ));
    const location = locateHeifExif(meta);
    if (!location) return null;
    const length = Math.min(location.length || MAX_EXIF_READ, MAX_EXIF_READ);
    const item = location.inMeta
        ? meta.subarray(location.offset, location.offset + length)
        : await reader.bytes(location.offset, length);
    return captureFromHeifExifItem(item, options);
}

// creation_time של mvhd: שניות מ-1904 ב-UTC. אפס = לא נרשם.
export function captureFromMvhd(mvhd, options = {}) {
    if (!mvhd || mvhd.length < 12) return null;
    const version = mvhd[0];
    const seconds = version === 1 ? u64(mvhd, 4) : u32(mvhd, 4);
    if (!seconds) return null;
    const takenAt = (seconds - QUICKTIME_EPOCH_OFFSET_S) * 1000;
    if (!isValidTakenAt(takenAt, options.now ?? Date.now())) return null;
    return {
        takenAt,
        takenDate: dateKeyFromTimestamp(takenAt, options.timeZone || ''),
        takenAtOffset: '',
        takenAtSource: 'video'
    };
}

async function movieCapture(reader, moovBox, options) {
    const children = await listBoxes(reader, moovBox.start + moovBox.headerSize, moovBox.end, 64);
    const mvhd = children.find(box => box.type === 'mvhd');
    if (!mvhd) return null;
    const body = await reader.bytes(mvhd.start + mvhd.headerSize, 20);
    return captureFromMvhd(body, options);
}

async function bmffCapture(reader, options) {
    const boxes = await listBoxes(reader, 0, reader.size, 64);
    const meta = boxes.find(box => box.type === 'meta');
    if (meta) {
        const capture = await heifCapture(reader, meta, options);
        if (capture) return capture;
    }
    const moov = boxes.find(box => box.type === 'moov');
    if (moov) return movieCapture(reader, moov, options);
    return null;
}

// הכניסה הראשית: מקור כלשהו → תאריך הצילום, או null. לעולם אינה זורקת על
// קובץ פגום — רק על כשל בקריאה עצמה (רשת), כדי שהקורא יוכל לנסות שוב.
export async function readCaptureDate(source, options = {}) {
    if (!source || typeof source.read !== 'function') return null;
    const size = Number(source.size) || 0;
    if (size < 12) return null;
    const head = await source.read(0, Math.min(size, CAPTURE_HEAD_BYTES));
    const reader = makeReader({ ...source, size }, head);
    try {
        if (head[0] === 0xff && head[1] === 0xd8) return await jpegCapture(reader, options);
        if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return await webpCapture(reader, options);
        if (ascii(head, 4, 4) === 'ftyp') return await bmffCapture(reader, options);
    } catch (error) {
        if (error?.captureReadFailure) throw error;
        return null;
    }
    return null;
}

export async function readCaptureDateFromBlob(blob, options = {}) {
    if (!blob || typeof blob.slice !== 'function') return null;
    return readCaptureDate(blobSource(blob), options);
}

// Drive: imageMediaMetadata.time הוא מחרוזת EXIF ("2026:09:28 19:33:12").
// ל-videoMediaMetadata אין זמן צילום ב-API, ולכן סרטון נקרא מהבתים עצמם.
export function captureFromDriveMetadata(file, options = {}) {
    const time = file?.imageMediaMetadata?.time;
    const capture = time ? parseExifDateTime(time, '', options) : null;
    return capture ? { ...capture, takenAtSource: 'drive' } : null;
}

// --- עזרים לרשומות ---

// הזמן שלפיו ממיינים: רגע הצילום, ובלעדיו — זמן ההעלאה.
export function captureTime(record) {
    const takenAt = Number(record?.takenAt);
    return isValidTakenAt(takenAt) ? takenAt : (Number(record?.createdAt) || 0);
}

// "החדש ביותר": לפי רגע הצילום, ובשוויון — לפי זמן ההעלאה ואז המזהה,
// כך שהסדר יציב גם לתמונות רצף שצולמו באותה שנייה.
export function compareCaptureDesc(a, b) {
    return (captureTime(b) - captureTime(a))
        || ((Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0))
        || String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function compareCaptureAsc(a, b) {
    return (captureTime(a) - captureTime(b))
        || ((Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0))
        || String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function hasCaptureDate(record) {
    return isValidTakenAt(Number(record?.takenAt));
}

// התאריך הקלנדרי שמוצג לפריט: יום הצילום; בלעדיו — יום ההעלאה.
export function captureDateKey(record) {
    if (hasCaptureDate(record)) {
        return isValidDateKey(record.takenDate) ? record.takenDate : dateKeyFromTimestamp(Number(record.takenAt));
    }
    if (isValidDateKey(record?.date)) return record.date;
    const createdAt = Number(record?.createdAt);
    return createdAt > 0 ? dateKeyFromTimestamp(createdAt) : '';
}

export function recordHebrewDate(record) {
    return hebrewDateFromDateKey(captureDateKey(record));
}

// ריצת ההשלמה בודקת רק רשומה שמעולם לא נבדקה: takenAtSource נקבע גם כשלא
// נמצא תאריך ('none'), ולכן ההמשך אחרי עצירה מדלג על מה שכבר טופל.
export function needsCaptureDate(record) {
    return Boolean(record) && !CAPTURE_SOURCES.includes(record.takenAtSource) && !hasCaptureDate(record);
}

// השדות שנכתבים לרשומה מתוצאת הקריאה.
export function captureFields(capture) {
    if (!capture || !isValidTakenAt(capture.takenAt)) return { takenAtSource: 'none' };
    return {
        takenAt: Math.round(capture.takenAt),
        takenDate: isValidDateKey(capture.takenDate) ? capture.takenDate : dateKeyFromTimestamp(capture.takenAt),
        ...(capture.takenAtOffset ? { takenAtOffset: capture.takenAtOffset } : {}),
        takenAtSource: CAPTURE_SOURCES.includes(capture.takenAtSource) ? capture.takenAtSource : 'exif'
    };
}
