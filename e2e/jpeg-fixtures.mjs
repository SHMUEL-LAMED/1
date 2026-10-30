// e2e/jpeg-fixtures.mjs — קובצי JPEG אמיתיים עם מיקום, לבדיקות ההורדה בלי GPS.
//
// הבסיס הוא JPEG תקין שנוצר פעם אחת (320×160, אפור אחיד 128, baseline, בלי
// מטא־דאטה). עליו נבנים כאן קטעי EXIF עם GPS IFD (בשני סדרי הבתים), XMP עם
// קואורדינטות, ICC, הערה ו-MPF עם תמונה משנית — בדיוק כפי שמצלמה או טלפון
// כותבים אותם. משמש גם את download-privacy.test.mjs (Node) וגם את בדיקות
// הדפדפן ב-e2e/download-privacy.spec.mjs.

export const BASE_JPEG_WIDTH = 320;
export const BASE_JPEG_HEIGHT = 160;
export const BASE_JPEG_GRAY = 128;

const BASE_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCACgAUADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z';

export function baseJpeg() {
    return new Uint8Array(Buffer.from(BASE_JPEG_BASE64, 'base64'));
}

// הקואורדינטות של המיקום המזויף (ירושלים), כ-RATIONAL: מעלות, דקות, שניות.
// ערכים ייחודיים, כדי שהבדיקה תוכל לחפש את הבתים שלהם בקובץ שיצא.
export const FAKE_GPS = Object.freeze({
    latitude: [[31, 1], [46, 1], [3012, 100]],
    latitudeRef: 'N',
    longitude: [[35, 1], [13, 1], [4521, 100]],
    longitudeRef: 'E'
});

const TYPES = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };

function encodeValue(type, value, little) {
    if (type === TYPES.ASCII) return Buffer.from(`${value}\0`, 'latin1');
    if (type === TYPES.BYTE || type === TYPES.UNDEFINED) return Buffer.from(value);
    const width = { [TYPES.SHORT]: 2, [TYPES.LONG]: 4, [TYPES.RATIONAL]: 8 }[type];
    const list = type === TYPES.RATIONAL ? value : [].concat(value);
    const out = Buffer.alloc(list.length * width);
    list.forEach((item, index) => {
        if (type === TYPES.SHORT) little ? out.writeUInt16LE(item, index * 2) : out.writeUInt16BE(item, index * 2);
        if (type === TYPES.LONG) little ? out.writeUInt32LE(item, index * 4) : out.writeUInt32BE(item, index * 4);
        if (type === TYPES.RATIONAL) {
            const write = (number, at) => (little ? out.writeUInt32LE(number, at) : out.writeUInt32BE(number, at));
            write(item[0], index * 8);
            write(item[1], index * 8 + 4);
        }
    });
    return out;
}

const blockSize = entries => 2 + entries.length * 12 + 4
    + entries.reduce((sum, entry) => sum + (entry.data.length > 4 ? entry.data.length + (entry.data.length % 2) : 0), 0);

// IFD אחד ואחריו אזור הערכים שלו, בהיסט start מתחילת ה-TIFF.
function ifdBlock(entries, start, little, next = 0) {
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    const out = Buffer.alloc(blockSize(sorted));
    const u16 = (value, at) => (little ? out.writeUInt16LE(value, at) : out.writeUInt16BE(value, at));
    const u32 = (value, at) => (little ? out.writeUInt32LE(value, at) : out.writeUInt32BE(value, at));
    u16(sorted.length, 0);
    let dataAt = 2 + sorted.length * 12 + 4;
    sorted.forEach((entry, index) => {
        const at = 2 + index * 12;
        u16(entry.tag, at);
        u16(entry.type, at + 2);
        u32(entry.count, at + 4);
        if (entry.data.length <= 4) {
            entry.data.copy(out, at + 8);
        } else {
            u32(start + dataAt, at + 8);
            entry.data.copy(out, dataAt);
            dataAt += entry.data.length + (entry.data.length % 2);
        }
    });
    u32(next, 2 + sorted.length * 12);
    return out;
}

function entry(tag, type, value, little) {
    const data = encodeValue(type, value, little);
    const count = type === TYPES.ASCII || type === TYPES.BYTE || type === TYPES.UNDEFINED
        ? data.length
        : type === TYPES.RATIONAL ? value.length : [].concat(value).length;
    return { tag, type, count, data };
}

// TIFF של EXIF: IFD0 (יצרן, דגם, כיוון, מצביעים ל-Exif IFD ול-GPS IFD),
// Exif IFD (תאריך הצילום) ו-GPS IFD. gps: null — בלי GPS בכלל.
export function buildExifTiff({ little = false, orientation = 1, make = 'E2E Camera', model = 'Privacy 1', dateTimeOriginal = '2026:09:01 10:00:00', gps = FAKE_GPS } = {}) {
    const exifEntries = [entry(0x9003, TYPES.ASCII, dateTimeOriginal, little)];
    const gpsEntries = gps ? [
        entry(0x0000, TYPES.BYTE, [2, 3, 0, 0], little),
        entry(0x0001, TYPES.ASCII, gps.latitudeRef, little),
        entry(0x0002, TYPES.RATIONAL, gps.latitude, little),
        entry(0x0003, TYPES.ASCII, gps.longitudeRef, little),
        entry(0x0004, TYPES.RATIONAL, gps.longitude, little)
    ] : [];
    const ifd0Entries = offsets => [
        entry(0x010F, TYPES.ASCII, make, little),
        entry(0x0110, TYPES.ASCII, model, little),
        entry(0x0112, TYPES.SHORT, orientation, little),
        entry(0x8769, TYPES.LONG, offsets.exif, little),
        ...(gps ? [entry(0x8825, TYPES.LONG, offsets.gps, little)] : [])
    ];
    const ifd0Size = blockSize(ifd0Entries({ exif: 0, gps: 0 }));
    const exifAt = 8 + ifd0Size;
    const gpsAt = exifAt + blockSize(exifEntries);
    const header = Buffer.alloc(8);
    header.write(little ? 'II' : 'MM', 0, 'latin1');
    little ? header.writeUInt16LE(42, 2) : header.writeUInt16BE(42, 2);
    little ? header.writeUInt32LE(8, 4) : header.writeUInt32BE(8, 4);
    return Buffer.concat([
        header,
        ifdBlock(ifd0Entries({ exif: exifAt, gps: gpsAt }), 8, little),
        ifdBlock(exifEntries, exifAt, little),
        ...(gps ? [ifdBlock(gpsEntries, gpsAt, little)] : [])
    ]);
}

export function segment(marker, payload) {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(0xFF00 | marker, 0);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, Buffer.from(payload)]);
}

export function exifSegment(options = {}) {
    return segment(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buildExifTiff(options)]));
}

// XMP כמו של Lightroom או של טלפון: GPS גם כמאפיין וגם כאלמנט מקונן, לצד
// מאפיינים אחרים שחייבים להישאר (דירוג, תוכנה, תיאור בעברית).
export function xmpSegment({ gps = true } = {}) {
    const gpsAttributes = gps ? ' exif:GPSLatitude="31,46.502N" exif:GPSLongitude=\'35,13.7535E\'' : '';
    const gpsElements = gps ? '<exif:GPSVersionID><rdf:Seq><rdf:li>2</rdf:li><rdf:li>3</rdf:li></rdf:Seq></exif:GPSVersionID><exifEX:GPSAltitudeRef>0</exifEX:GPSAltitudeRef>' : '';
    const xml = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:exifEX="http://cipa.jp/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
        + ` xmp:Rating="5" xmp:CreatorTool="E2E"${gpsAttributes}>`
        + `${gpsElements}<dc:description><rdf:Alt><rdf:li xml:lang="x-default">הקפות בבית הכנסת</rdf:li></rdf:Alt></dc:description>`
        + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
    return segment(0xE1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xml, 'utf8')]));
}

export function iccSegment() {
    return segment(0xE2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), Buffer.alloc(32, 0x11)]));
}

export function commentSegment(text = 'צולם בבית הכנסת') {
    return segment(0xFE, Buffer.from(text, 'utf8'));
}

// JPEG עם הקטעים הנתונים, מיד אחרי ה-JFIF של הבסיס (כמו בקובץ של מצלמה).
export function jpegWithSegments(segments, base = baseJpeg()) {
    const bytes = Buffer.from(base);
    const jfifEnd = 2 + 2 + bytes.readUInt16BE(4);
    return new Uint8Array(Buffer.concat([bytes.subarray(0, jfifEnd), ...segments.map(item => Buffer.from(item)), bytes.subarray(jfifEnd)]));
}

// JPEG עם מיקום, כפי שטלפון שומר אותו: EXIF עם GPS ו-XMP עם GPS.
export function jpegWithGps({ little = false, orientation = 1, xmp = true } = {}) {
    return jpegWithSegments([exifSegment({ little, orientation }), ...(xmp ? [xmpSegment()] : [])]);
}

// MPF: תמונה ראשית ואחריה תמונה משנית (למשל מפת עומק) עם EXIF ו-GPS משלה.
// ההיסט של התמונה המשנית נמדד מכותרת ה-TIFF שבתוך קטע ה-MPF.
export function jpegWithMpfSecondary() {
    const secondary = jpegWithSegments([exifSegment({ little: true })]);
    const build = secondaryOffset => {
        const mpEntries = Buffer.alloc(32);
        mpEntries.writeUInt32BE(0x00030000, 0); // התמונה הראשית
        mpEntries.writeUInt32BE(0, 4);
        mpEntries.writeUInt32BE(0, 8);
        mpEntries.writeUInt32BE(0x00000000, 16);
        mpEntries.writeUInt32BE(secondary.length, 20);
        mpEntries.writeUInt32BE(secondaryOffset, 24);
        const tiffHeader = Buffer.from([0x4D, 0x4D, 0, 42, 0, 0, 0, 8]);
        const ifd = ifdBlock([
            { tag: 0xB000, type: TYPES.UNDEFINED, count: 4, data: Buffer.from('0100', 'latin1') },
            { tag: 0xB001, type: TYPES.LONG, count: 1, data: encodeValue(TYPES.LONG, 2, false) },
            { tag: 0xB002, type: TYPES.UNDEFINED, count: 32, data: mpEntries }
        ], 8, false);
        const mpf = segment(0xE2, Buffer.concat([Buffer.from('MPF\0', 'latin1'), tiffHeader, ifd]));
        return { mpf, primary: jpegWithSegments([exifSegment(), mpf]) };
    };
    // ההיסט תלוי במיקום כותרת ה-MPF בתמונה הראשית, ולכן נבנה פעמיים.
    const first = build(0);
    const mpfAt = Buffer.from(first.primary).indexOf(Buffer.from('MPF\0', 'latin1'));
    const tiffStart = mpfAt + 4;
    const { primary } = build(first.primary.length - tiffStart);
    return { bytes: new Uint8Array(Buffer.concat([Buffer.from(primary), Buffer.from(secondary)])), primaryLength: primary.length, secondaryLength: secondary.length };
}

// Motion Photo: JPEG ואחריו סרטון MP4 קצר, ובו המיקום בתיבת ©xyz שב-moov/udta
// (כמו ש-MediaMuxer של Android כותב אותו), ואחרי הסרטון נתוני יצרן (Samsung).
export const FAKE_VIDEO_LOCATION = '+31.7754+035.2209/';

function box(type, ...children) {
    const payload = Buffer.concat(children.map(child => Buffer.from(child)));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(payload.length + 8, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, payload]);
}

export function jpegWithMotionVideo() {
    const location = Buffer.alloc(4 + FAKE_VIDEO_LOCATION.length);
    location.writeUInt16BE(FAKE_VIDEO_LOCATION.length, 0);
    location.writeUInt16BE(0x15C7, 2);
    location.write(FAKE_VIDEO_LOCATION, 4, 'latin1');
    const video = Buffer.concat([
        box('ftyp', Buffer.from('mp42\0\0\0\0isommp42', 'latin1')),
        box('moov', box('mvhd', Buffer.alloc(100)), box('trak', box('tkhd', Buffer.alloc(84))), box('udta', box('©xyz', location))),
        box('mdat', Buffer.alloc(64, 0x5A))
    ]);
    const trailer = Buffer.from('SEFHmotion-photo-trailer', 'latin1');
    const primary = jpegWithGps({ xmp: false });
    return {
        bytes: new Uint8Array(Buffer.concat([Buffer.from(primary), video, trailer])),
        primaryLength: primary.length,
        videoLength: video.length
    };
}

// חיפוש רצף בתים (לבדיקה שהקואורדינטות באמת נמחקו, ולא רק המצביע אליהן).
export function containsBytes(haystack, needle) {
    return Buffer.from(haystack).indexOf(Buffer.from(needle)) !== -1;
}

export function gpsRationalBytes(little = false) {
    return encodeValue(TYPES.RATIONAL, FAKE_GPS.latitude, little);
}

// הנתונים הדחוסים (מ-SOS ועד הסוף) — חייבים להישאר זהים בהסרת המיקום.
export function scanData(bytes) {
    const buffer = Buffer.from(bytes);
    return buffer.subarray(buffer.indexOf(Buffer.from([0xFF, 0xDA])));
}
