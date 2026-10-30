// download-privacy.js — הורדה ששומרת על פרטיות: הסרת המיקום (GPS) מקובץ JPEG
// לפני שהוא נשמר אצל הצופה, וההחלטות של סימן המים. בלי DOM, נבדק ב-Node
// (download-privacy.test.mjs); הפענוח והציור ב-Canvas ב-download-privacy-ui.js.
//
// למה עריכת בתים ולא קידוד מחדש: קידוד ב-Canvas היה מוחק את כל ה-EXIF, אבל
// גם מוריד איכות, מאבד את פרופיל הצבע ומכפיל את זמן ההורדה בטלפון. כאן
// התמונה עצמה (הנתונים שאחרי SOS) לעולם אינה נוגעת, ורק המטא־דאטה משתנה:
//
// * מצב 'gps' (ברירת המחדל) עורך במקום, בלי לשנות את אורך הקובץ: הרשומה
//   שמצביעה על ה-GPS IFD יוצאת מ-IFD0 (הרשומות שאחריה זזות 12 בתים אחורה,
//   כך שהסדר והמצביעים האחרים נשארים תקפים), וה-GPS IFD עצמו והערכים שלו
//   מתאפסים — כדי שהקואורדינטות לא יישארו בקובץ גם בלי מצביע. מאפייני GPS
//   ב-XMP (כמו exif:GPSLatitude) מוחלפים ברווחים, וה-XML נשאר תקין. כיוון
//   שהאורך אינו משתנה, גם היסטים שנמדדים מסוף הקובץ (Motion Photo) או
//   מכותרת MPF (תמונה משנית, למשל מפת עומק) נשארים נכונים; תמונה משנית
//   שהיא JPEG עוברת את אותו ניקוי, ובסרטון של Motion Photo תיבת המיקום
//   (©xyz) הופכת לתיבת free ריקה.
// * מצב 'all' בונה מחדש את הכותרות: נשארים רק JFIF (APP0), פרופיל הצבע
//   (ICC ב-APP2) ו-Adobe (APP14), שבלעדיהם הצבעים משתנים; כל השאר — EXIF,
//   XMP, IPTC, הערות ו-MPF — יוצא, וה-EXIF מוחלף ב-EXIF זעיר שבו רק הכיוון,
//   כדי שהתמונה לא תתהפך. מה שאחרי סוף התמונה (EOI) נחתך.
//
// כל קובץ שאינו נקרא עד הסוף כמבנה JPEG תקין חוזר כפי שהוא (changed: false),
// כי עדיף קובץ שלם עם מטא־דאטה מקובץ שבור. PNG, WebP, HEIC, GIF וסרטונים אינם
// עוברים כאן כלל — ראו README, "הורדה בלי מיקום וסימן מים".

export const JPEG_PRIVACY_MODES = Object.freeze(['gps', 'all']);

// --- קריאת בתים ---

const u16be = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];

function tiffReader(bytes, start, end) {
    if (end - start < 8) return null;
    const order = u16be(bytes, start);
    const little = order === 0x4949;
    if (!little && order !== 0x4D4D) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const inside = (offset, length) => offset >= start && length >= 0 && offset + length <= end;
    const reader = {
        start,
        end,
        little,
        inside,
        u16: offset => view.getUint16(offset, little),
        u32: offset => view.getUint32(offset, little),
        setU16: (offset, value) => view.setUint16(offset, value, little)
    };
    if (!inside(start, 8) || reader.u16(start + 2) !== 42) return null;
    return reader;
}

// הגודל בבתים של כל סוג ערך ב-TIFF (BYTE, ASCII, SHORT, LONG, RATIONAL...).
const TIFF_TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

const TAG_ORIENTATION = 0x0112;
const TAG_GPS_IFD = 0x8825;

// IFD בכתובת יחסית לכותרת ה-TIFF: מספר הרשומות, היכן הן ומה גבולותיו.
// IFD שאינו נכנס במלואו לקטע מוחזר כ-null.
function readIfd(tiff, relativeOffset) {
    const at = tiff.start + relativeOffset;
    if (relativeOffset < 8 || !tiff.inside(at, 2)) return null;
    const count = tiff.u16(at);
    const entriesEnd = at + 2 + count * 12;
    if (!tiff.inside(at, entriesEnd - at)) return null;
    // המצביע ל-IFD הבא (4 בתים) חסר בקבצים פגומים מסוימים; אז הוא אינו חלק מה-IFD.
    const end = tiff.inside(entriesEnd, 4) ? entriesEnd + 4 : entriesEnd;
    const entries = [];
    for (let i = 0; i < count; i += 1) {
        const offset = at + 2 + i * 12;
        const type = tiff.u16(offset + 2);
        const valueCount = tiff.u32(offset + 4);
        const size = (TIFF_TYPE_SIZES[type] || 0) * valueCount;
        entries.push({ offset, tag: tiff.u16(offset), type, count: valueCount, size });
    }
    return { at, count, entriesEnd, end, entries };
}

// הערך של רשומה שאינו נכנס בה (מעל 4 בתים) יושב בכתובת שהרשומה מצביעה עליה.
function entryValueRange(tiff, entry) {
    if (entry.size <= 4 || !Number.isFinite(entry.size)) return null;
    const at = tiff.start + tiff.u32(entry.offset + 8);
    return tiff.inside(at, entry.size) ? { at, end: at + entry.size } : null;
}

const overlaps = (a, b) => a.at < b.end && b.at < a.end;

// --- מבנה ה-JPEG ---

export function isJpegBytes(bytes) {
    return Boolean(bytes) && bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
}

// הקטעים שלפני הנתונים הדחוסים (SOS). כל קטע: הסמן, תחילתו (כולל FF),
// תחילת התוכן וסופו. מבנה שאינו נקרא עד SOS — null.
export function readJpegSegments(bytes) {
    if (!isJpegBytes(bytes)) return null;
    const segments = [];
    let pos = 2;
    while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 0xFF) return null;
        const start = pos;
        // בתי מילוי (FF נוספים) לפני הסמן מותרים.
        while (bytes[pos + 1] === 0xFF && pos + 2 < bytes.length) pos += 1;
        const marker = bytes[pos + 1];
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) {
            pos += 2;
            continue;
        }
        if (marker === 0xD9) return null; // EOI לפני SOS: אין כאן תמונה
        if (pos + 4 > bytes.length) return null;
        const length = u16be(bytes, pos + 2);
        const end = pos + 2 + length;
        if (length < 2 || end > bytes.length) return null;
        if (marker === 0xDA) return { segments, scanStart: start };
        segments.push({ marker, start, dataStart: pos + 4, end });
        pos = end;
    }
    return null;
}

const ascii = (bytes, start, text) => {
    if (start + text.length > bytes.length) return false;
    for (let i = 0; i < text.length; i += 1) if (bytes[start + i] !== text.charCodeAt(i)) return false;
    return true;
};

const XMP_NAMESPACES = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'];

function segmentKind(bytes, segment) {
    const { marker, dataStart } = segment;
    if (marker === 0xE1 && ascii(bytes, dataStart, 'Exif\0')) return 'exif';
    if (marker === 0xE1 && XMP_NAMESPACES.some(ns => ascii(bytes, dataStart, ns))) return 'xmp';
    if (marker === 0xE2 && ascii(bytes, dataStart, 'ICC_PROFILE\0')) return 'icc';
    if (marker === 0xE2 && ascii(bytes, dataStart, 'MPF\0')) return 'mpf';
    if (marker === 0xE0) return 'jfif';
    if (marker === 0xEE) return 'adobe';
    if (marker === 0xED) return 'iptc';
    if (marker === 0xFE) return 'comment';
    if (marker >= 0xE0 && marker <= 0xEF) return 'app';
    return 'image'; // DQT, SOF, DHT, DRI — חלק מהתמונה עצמה
}

// כותרת ה-TIFF שבתוך קטע EXIF מתחילה אחרי "Exif\0\0".
const exifTiff = (bytes, segment) => tiffReader(bytes, segment.dataStart + 6, segment.end);

// סוף התמונה (אחרי EOI), בסריקה של הנתונים הדחוסים מ-SOS. בתוך הנתונים FF
// מופיע רק כ-FF00 או כסמן RST; קטעים שבין סריקות (JPEG מתקדם) מדולגים לפי
// האורך שלהם. -1 כשלא נמצא EOI.
export function findJpegEnd(bytes, scanStart) {
    let pos = scanStart;
    while (pos + 1 < bytes.length) {
        if (bytes[pos] !== 0xFF) { pos += 1; continue; }
        const next = bytes[pos + 1];
        if (next === 0x00 || next === 0xFF || (next >= 0xD0 && next <= 0xD7)) { pos += 1; continue; }
        if (next === 0xD9) return pos + 2;
        if (pos + 4 > bytes.length) return -1;
        pos += 2 + u16be(bytes, pos + 2);
    }
    return -1;
}

// --- GPS ב-EXIF ---

// מסיר את המצביע ל-GPS מ-IFD0 ומאפס את ה-GPS IFD והערכים שלו, במקום.
function removeExifGps(bytes, segment) {
    const tiff = exifTiff(bytes, segment);
    if (!tiff) return false;
    const ifd0 = readIfd(tiff, tiff.u32(tiff.start + 4));
    if (!ifd0) return false;
    const index = ifd0.entries.findIndex(entry => entry.tag === TAG_GPS_IFD);
    if (index === -1) return false;
    const pointer = ifd0.entries[index];
    // IFD0 עצמו מוגן: ערך GPS שמצביע לתוכו (קובץ פגום) אינו מאופס.
    const protectedRange = { at: ifd0.at, end: ifd0.end };

    const gps = readIfd(tiff, tiff.u32(pointer.offset + 8));
    if (gps && !overlaps(gps, protectedRange)) {
        for (const entry of gps.entries) {
            const range = entryValueRange(tiff, entry);
            if (range && !overlaps(range, protectedRange)) bytes.fill(0, range.at, range.end);
        }
        bytes.fill(0, gps.at, gps.end);
    }

    // הרשומות שאחרי המצביע, והמצביע ל-IFD הבא, זזות 12 בתים אחורה; 12 הבתים
    // שהתפנו בסוף מתאפסים. שום נתון אחר אינו זז, ולכן כל ההיסטים נשארים.
    bytes.copyWithin(pointer.offset, pointer.offset + 12, ifd0.end);
    bytes.fill(0, ifd0.end - 12, ifd0.end);
    tiff.setU16(ifd0.at, ifd0.count - 1);
    return true;
}

function exifHasGps(bytes, segment) {
    const tiff = exifTiff(bytes, segment);
    const ifd0 = tiff && readIfd(tiff, tiff.u32(tiff.start + 4));
    return Boolean(ifd0?.entries.some(entry => entry.tag === TAG_GPS_IFD));
}

function exifOrientation(bytes, segment) {
    const tiff = exifTiff(bytes, segment);
    const ifd0 = tiff && readIfd(tiff, tiff.u32(tiff.start + 4));
    const entry = ifd0?.entries.find(item => item.tag === TAG_ORIENTATION && item.type === 3 && item.count >= 1);
    if (!entry) return 0;
    const value = tiff.u16(entry.offset + 8);
    return value >= 1 && value <= 8 ? value : 0;
}

// --- GPS ב-XMP ---

// מאפיין GPS בכל קידומת (exif:, exifEX: ...), כמאפיין של תגית או כאלמנט
// שלם (גם אלמנט עם תוכן מקונן, כמו GPSVersionID עם rdf:Seq).
const XMP_GPS_ATTRIBUTE = /\s[A-Za-z_][\w.-]*:GPS\w*\s*=\s*(?:"[^"]*"|'[^']*')/g;
const XMP_GPS_ELEMENT = /<([A-Za-z_][\w.-]*:GPS\w*)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g;

// הטקסט כמחרוזת "בינארית" — תו לכל בית — כדי שהמיקומים שנמצאים בביטוי
// הרגולרי יהיו בדיוק מיקומי הבתים, גם כשיש בטקסט עברית ב-UTF-8.
function binaryString(bytes, start, end) {
    let text = '';
    for (let i = start; i < end; i += 8192) {
        text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 8192)));
    }
    return text;
}

function xmpGpsRanges(bytes, segment) {
    const text = binaryString(bytes, segment.dataStart, segment.end);
    const ranges = [];
    for (const pattern of [XMP_GPS_ELEMENT, XMP_GPS_ATTRIBUTE]) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
            ranges.push({ at: segment.dataStart + match.index, end: segment.dataStart + match.index + match[0].length });
        }
    }
    return ranges;
}

function removeXmpGps(bytes, segment) {
    const ranges = xmpGpsRanges(bytes, segment);
    for (const range of ranges) bytes.fill(0x20, range.at, range.end);
    return ranges.length > 0;
}

// --- MPF: תמונות משניות באותו קובץ ---

const TAG_MP_ENTRY = 0xB002;

// התמונות המשניות שכותרת ה-MPF מצביעה עליהן (ההיסט נמדד מכותרת ה-TIFF שלה).
function mpfSecondaryRanges(bytes, segment) {
    const tiff = tiffReader(bytes, segment.dataStart + 4, segment.end);
    const ifd = tiff && readIfd(tiff, tiff.u32(tiff.start + 4));
    const entry = ifd?.entries.find(item => item.tag === TAG_MP_ENTRY && item.type === 7);
    const table = entry && entryValueRange(tiff, entry);
    if (!table) return [];
    const ranges = [];
    for (let at = table.at; at + 16 <= table.end; at += 16) {
        const size = tiff.u32(at + 4);
        const offset = tiff.u32(at + 8);
        // ההיסט 0 הוא התמונה הראשית עצמה.
        if (!offset || !size) continue;
        const start = tiff.start + offset;
        if (start + size <= bytes.length) ranges.push({ at: start, end: start + size });
    }
    return ranges;
}

// --- וידאו מוטמע (Motion Photo) ---

// Motion Photo (Samsung, Google) מצרף אחרי סוף ה-JPEG סרטון MP4 קצר, וטלפון
// ששומר מיקום כותב אותו גם בסרטון, בתיבת ©xyz שב-moov/udta. התיבה מקבלת את
// הסוג 'free' והתוכן שלה מתאפס: האורך אינו משתנה, וכל נגן מדלג על free. רק
// מבנה תיבות שנקרא עד הסוף נוגע — רצף בתים מקרי בנתונים הדחוסים אינו נערך.
const MP4_CONTAINERS = new Set(['moov', 'trak', 'udta']);
const MP4_LOCATION = '©xyz';
const MP4_FREE = [0x66, 0x72, 0x65, 0x65]; // "free"

const boxType = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32be = (bytes, at) => ((bytes[at] << 24) >>> 0) + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);

// תיבות המיקום שבטווח (לעומק). ברמה העליונה הסריקה נעצרת בתיבה הראשונה שאינה
// תקינה — אחרי הסרטון יכולים לבוא נתונים אחרים של היצרן (Samsung); בתוך
// תיבה מכילה, מבנה שבור הוא null ושום דבר בו אינו נערך.
function mp4LocationBoxes(bytes, start, end, depth = 0) {
    const found = [];
    let pos = start;
    while (pos + 8 <= end) {
        let size = u32be(bytes, pos);
        let header = 8;
        if (size === 1) {
            // גודל של 64 ביט; סרטון מעל 4GB ממילא אינו בתוך JPEG.
            size = pos + 16 <= end && u32be(bytes, pos + 8) === 0 ? u32be(bytes, pos + 12) : 0;
            header = 16;
        } else if (size === 0 && depth === 0) {
            size = end - pos; // התיבה האחרונה נמשכת עד סוף הקובץ
        }
        const inner = size >= header && pos + size <= end;
        const type = inner ? boxType(bytes, pos + 4) : '';
        const children = MP4_CONTAINERS.has(type) && depth < 4
            ? mp4LocationBoxes(bytes, pos + header, pos + size, depth + 1)
            : [];
        if (!inner || !children) {
            if (depth > 0) return null;
            break;
        }
        if (type === MP4_LOCATION) found.push({ at: pos, end: pos + size, header });
        found.push(...children);
        pos += size;
    }
    return depth > 0 || pos > start ? found : null;
}

const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"

// הסרטון הראשון שאחרי סוף התמונה (מתחיל בתיבת ftyp). מחזיר כמה תיבות מיקום נוקו.
function removeTrailerVideoLocation(bytes, imageEnd) {
    for (let at = bytes.indexOf(FTYP[0], imageEnd + 4); at !== -1 && at + 4 <= bytes.length; at = bytes.indexOf(FTYP[0], at + 1)) {
        if (bytes[at + 1] !== FTYP[1] || bytes[at + 2] !== FTYP[2] || bytes[at + 3] !== FTYP[3]) continue;
        const boxes = mp4LocationBoxes(bytes, at - 4, bytes.length);
        if (!boxes) continue;
        for (const box of boxes) {
            bytes.set(MP4_FREE, box.at + 4);
            bytes.fill(0, box.at + box.header, box.end);
        }
        return boxes.length;
    }
    return 0;
}

// --- הניקוי ---

// ניקוי המיקום במקום, על המערך שהתקבל. depth מגביל את הירידה לתמונות משניות.
function stripLocationInPlace(bytes, depth = 0) {
    const parsed = readJpegSegments(bytes);
    if (!parsed) return { ok: false, exifGps: false, xmpGps: false, secondary: 0, video: 0 };
    const result = { ok: true, exifGps: false, xmpGps: false, secondary: 0, video: 0 };
    for (const segment of parsed.segments) {
        const kind = segmentKind(bytes, segment);
        if (kind === 'exif' && removeExifGps(bytes, segment)) result.exifGps = true;
        if (kind === 'xmp' && removeXmpGps(bytes, segment)) result.xmpGps = true;
        if (kind === 'mpf' && depth === 0) {
            for (const range of mpfSecondaryRanges(bytes, segment)) {
                const inner = stripLocationInPlace(bytes.subarray(range.at, range.end), depth + 1);
                if (inner.exifGps || inner.xmpGps) result.secondary += 1;
            }
        }
    }
    if (depth === 0) {
        const imageEnd = findJpegEnd(bytes, parsed.scanStart);
        if (imageEnd > 0 && imageEnd < bytes.length) result.video = removeTrailerVideoLocation(bytes, imageEnd);
    }
    return result;
}

// מה יש בקובץ: לבדיקות, ולהחלטה אם יש בכלל מה לנקות.
export function inspectJpegMetadata(input) {
    const bytes = toBytes(input);
    const parsed = readJpegSegments(bytes);
    const summary = { isJpeg: Boolean(parsed), hasExif: false, hasGpsIfd: false, hasXmp: false, hasXmpGps: false, orientation: 0, kinds: [] };
    if (!parsed) return summary;
    for (const segment of parsed.segments) {
        const kind = segmentKind(bytes, segment);
        summary.kinds.push(kind);
        if (kind === 'exif') {
            summary.hasExif = true;
            summary.hasGpsIfd ||= exifHasGps(bytes, segment);
            summary.orientation ||= exifOrientation(bytes, segment);
        }
        if (kind === 'xmp') {
            summary.hasXmp = true;
            summary.hasXmpGps ||= xmpGpsRanges(bytes, segment).length > 0;
        }
    }
    return summary;
}

export function readJpegOrientation(input) {
    return inspectJpegMetadata(input).orientation || 1;
}

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return new Uint8Array(0);
}

// EXIF זעיר, big-endian, שבו רשומה אחת: הכיוון.
export function orientationOnlyExif(orientation) {
    const segment = new Uint8Array(36);
    const view = new DataView(segment.buffer);
    view.setUint16(0, 0xFFE1);
    view.setUint16(2, 34);
    segment.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
    segment.set([0x4D, 0x4D, 0, 42, 0, 0, 0, 8], 10); // "MM", 42, IFD0 בהיסט 8
    view.setUint16(18, 1);
    view.setUint16(20, TAG_ORIENTATION);
    view.setUint16(22, 3); // SHORT
    view.setUint32(24, 1);
    view.setUint16(28, orientation);
    view.setUint32(32, 0); // אין IFD נוסף
    return segment;
}

const KEEP_IN_STRIP_ALL = new Set(['jfif', 'icc', 'adobe', 'image']);

function stripAllMetadata(bytes) {
    const parsed = readJpegSegments(bytes);
    if (!parsed) return null;
    const orientation = inspectJpegMetadata(bytes).orientation;
    const kept = parsed.segments.filter(segment => KEEP_IN_STRIP_ALL.has(segmentKind(bytes, segment)));
    const imageEnd = findJpegEnd(bytes, parsed.scanStart);
    const scan = bytes.subarray(parsed.scanStart, imageEnd > 0 ? imageEnd : bytes.length);
    // JFIF חייב להיות הקטע הראשון, ולכן ה-EXIF הזעיר בא אחריו.
    const leadingJfif = kept[0] && segmentKind(bytes, kept[0]) === 'jfif' ? 1 : 0;
    const parts = [bytes.subarray(0, 2)];
    kept.forEach((segment, index) => {
        if (index === leadingJfif && orientation > 1) parts.push(orientationOnlyExif(orientation));
        parts.push(bytes.subarray(segment.start, segment.end));
    });
    if (kept.length === leadingJfif && orientation > 1) parts.push(orientationOnlyExif(orientation));
    parts.push(scan);
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}

// הפונקציה הראשית. מחזירה תמיד עותק חדש (או את הקלט כשאין מה לעשות), וזורקת
// לעולם לא: בכל ספק — הקובץ המקורי ו-changed: false.
export function stripJpegMetadata(input, options = {}) {
    const mode = options.mode === 'all' ? 'all' : 'gps';
    const bytes = toBytes(input);
    const unchanged = reason => ({ bytes, changed: false, mode, reason, removed: { exifGps: false, xmpGps: false, secondary: 0, video: 0 } });
    if (!isJpegBytes(bytes)) return unchanged('not_jpeg');
    try {
        if (mode === 'all') {
            const before = inspectJpegMetadata(bytes);
            if (!before.isJpeg) return unchanged('malformed');
            const out = stripAllMetadata(bytes);
            if (!out || !inspectJpegMetadata(out).isJpeg) return unchanged('malformed');
            return {
                bytes: out,
                changed: out.length !== bytes.length || out.some((value, index) => value !== bytes[index]),
                mode,
                removed: { exifGps: before.hasGpsIfd, xmpGps: before.hasXmpGps, secondary: 0, video: 0 }
            };
        }
        const copy = bytes.slice();
        const result = stripLocationInPlace(copy);
        if (!result.ok) return unchanged('malformed');
        const removed = { exifGps: result.exifGps, xmpGps: result.xmpGps, secondary: result.secondary, video: result.video };
        const changed = removed.exifGps || removed.xmpGps || removed.secondary > 0 || removed.video > 0;
        return changed ? { bytes: copy, changed, mode, removed } : unchanged('no_location');
    } catch {
        return unchanged('error');
    }
}

// --- הגדרות ההורדה (מסמך systemMeta/downloadPrivacy) ---

export const DOWNLOAD_SETTINGS_DOC_ID = 'downloadPrivacy';
export const DEFAULT_WATERMARK_TEXT = 'גלריית שמחת התורה';
export const WATERMARK_TEXT_MAX = 60;

// תווי בקרה ותווי כיווניות (LRE/RLO/LRI...) יוצאים: טקסט סימן המים מצויר
// בכיוון RTL קבוע, ותו כיווניות שנשאר בו היה הופך אותו או מסתיר חלק ממנו.
const WATERMARK_UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

export function normalizeWatermarkText(value) {
    return String(value ?? '')
        .replace(WATERMARK_UNSAFE_CHARS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, WATERMARK_TEXT_MAX)
        .trim();
}

export function normalizeDownloadSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        watermarkEnabled: source.watermarkEnabled === true,
        watermarkText: normalizeWatermarkText(source.watermarkText),
        stripAllMetadata: source.stripAllMetadata === true
    };
}

export function watermarkTextFor(settings) {
    return normalizeWatermarkText(settings?.watermarkText) || DEFAULT_WATERMARK_TEXT;
}

// סוג הפלט של תמונה עם סימן מים: אותו סוג, באיכות גבוהה. GIF (אנימציה),
// HEIC ו-AVIF (פענוח לא אחיד בין דפדפנים) וסרטונים אינם מקבלים סימן מים.
const WATERMARK_OUTPUT = {
    'image/jpeg': { type: 'image/jpeg', quality: 0.92 },
    'image/png': { type: 'image/png' },
    'image/webp': { type: 'image/webp', quality: 0.92 }
};

export function normalizeMimeType(value) {
    const mime = String(value || '').split(';')[0].trim().toLowerCase();
    return mime === 'image/jpg' || mime === 'image/pjpeg' ? 'image/jpeg' : mime;
}

export function watermarkOutputType(mimeType) {
    return WATERMARK_OUTPUT[normalizeMimeType(mimeType)] || null;
}

// מנהל מוריד את המקור בלי סימן מים; צופה — לפי ההגדרה ולפי סוג הקובץ.
export function shouldWatermark(settings, { isAdmin = false, mimeType = '' } = {}) {
    if (isAdmin || !settings?.watermarkEnabled) return false;
    return Boolean(watermarkOutputType(mimeType));
}

export const WATERMARK_MIN_FONT = 11;
export const WATERMARK_MAX_FONT = 96;

// מיקום הטקסט בפינה התחתונה השמאלית (סוף השורה בעברית), בגודל יחסי לצלע
// הקצרה. measure(fontSize) מחזיר את רוחב הטקסט בגופן הזה; טקסט ארוך מהתמונה
// מוקטן עד שהוא נכנס (ולא מתחת למינימום הקריא).
export function watermarkLayout(width, height, measure = () => 0) {
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    let fontSize = Math.round(Math.min(w, h) * 0.04);
    fontSize = Math.max(WATERMARK_MIN_FONT, Math.min(WATERMARK_MAX_FONT, fontSize));
    const margin = Math.max(6, Math.round(fontSize * 0.75));
    const available = Math.max(1, w - margin * 2);
    const textWidth = Number(measure(fontSize)) || 0;
    if (textWidth > available) {
        fontSize = Math.max(WATERMARK_MIN_FONT, Math.floor(fontSize * available / textWidth));
    }
    return { fontSize, margin, x: margin, y: h - margin };
}
