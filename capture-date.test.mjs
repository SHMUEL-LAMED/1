// קורא תאריך הצילום (capture-date.js): קובצי בדיקה נבנים כאן בית אחר בית —
// TIFF/EXIF בשני סדרי הבתים, JPEG, WebP, HEIC (iinf + iloc) ו-MP4/MOV
// (mvhd בגרסה 0 ו-1, moov לפני ואחרי mdat) — ובודקים גם את המיון לפי
// takenAt ואת הנפילה לזמן ההעלאה.
import test from "node:test";
import assert from "node:assert/strict";
import {
    parseExifDateTime, readExifDates, captureFromTiff, readCaptureDate, bytesSource,
    captureFromMvhd, captureFromDriveMetadata, captureTime, compareCaptureDesc, compareCaptureAsc,
    captureDateKey, recordHebrewDate, needsCaptureDate, captureFields, isValidTakenAt,
    dateKeyFromTimestamp, locateHeifExif
} from "./capture-date.js";
import { formatHebrewDate } from "./hebrew-date.js";

const NOW = Date.UTC(2026, 9, 8, 12);

// --- בוני קבצים ---
const enc = text => [...text].map(ch => ch.charCodeAt(0));
function u16(value, little) { return little ? [value & 255, value >> 8] : [value >> 8, value & 255]; }
function u32(value, little) {
    const b = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    return little ? b.reverse() : b;
}
function u64(value) { return [...u32(Math.floor(value / 2 ** 32)), ...u32(value >>> 0)]; }

// TIFF עם IFD0 שמצביע ל-Exif IFD, ובו שדות ASCII.
function makeTiff(fields, { little = true } = {}) {
    const tags = Object.entries(fields).map(([tag, value]) => ({ tag: Number(tag), bytes: [...enc(value), 0] }));
    const ifd0Offset = 8;
    const exifOffset = ifd0Offset + 2 + 12 + 4;
    const exifSize = 2 + tags.length * 12 + 4;
    let dataOffset = exifOffset + exifSize;
    const head = [...enc(little ? "II" : "MM"), ...u16(42, little), ...u32(ifd0Offset, little)];
    const ifd0 = [...u16(1, little), ...u16(0x8769, little), ...u16(4, little), ...u32(1, little), ...u32(exifOffset, little), ...u32(0, little)];
    const entries = [];
    const data = [];
    for (const { tag, bytes } of tags) {
        entries.push(...u16(tag, little), ...u16(2, little), ...u32(bytes.length, little));
        if (bytes.length <= 4) {
            entries.push(...bytes, ...new Array(4 - bytes.length).fill(0));
        } else {
            entries.push(...u32(dataOffset, little));
            data.push(...bytes);
            dataOffset += bytes.length;
        }
    }
    const exif = [...u16(tags.length, little), ...entries, ...u32(0, little)];
    return Uint8Array.from([...head, ...ifd0, ...exif, ...data]);
}

const ORIGINAL = 0x9003, CREATE = 0x9004, OFFSET = 0x9010, OFFSET_ORIGINAL = 0x9011;

function makeJpeg(tiff, { padBefore = 0 } = {}) {
    const app0 = [0xff, 0xe0, ...u16(16), ...enc("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const filler = padBefore ? [0xff, 0xe2, ...u16(padBefore + 2), ...new Array(padBefore).fill(7)] : [];
    const app1Body = [...enc("Exif"), 0, 0, ...tiff];
    const app1 = [0xff, 0xe1, ...u16(app1Body.length + 2), ...app1Body];
    const sos = [0xff, 0xda, ...u16(8), 1, 1, 0, 0, 63, 0, 9, 9, 9, 0xff, 0xd9];
    return Uint8Array.from([0xff, 0xd8, ...app0, ...filler, ...app1, ...sos]);
}

function riffChunk(type, body) {
    return [...enc(type), ...u32(body.length, true), ...body, ...(body.length % 2 ? [0] : [])];
}
function makeWebp(tiff, { exifFlag = true, withHeader = false, imageBytes = 40 } = {}) {
    const vp8x = [exifFlag ? 0x08 : 0, 0, 0, 0, 9, 0, 0, 9, 0, 0];
    const chunks = [
        ...riffChunk("VP8X", vp8x),
        ...riffChunk("VP8 ", new Array(imageBytes).fill(1)),
        ...riffChunk("EXIF", [...(withHeader ? [...enc("Exif"), 0, 0] : []), ...tiff])
    ];
    return Uint8Array.from([...enc("RIFF"), ...u32(chunks.length + 4, true), ...enc("WEBP"), ...chunks]);
}

function box(type, body) { return [...u32(body.length + 8), ...enc(type), ...body]; }
function fullBox(type, version, body) { return box(type, [version, 0, 0, 0, ...body]); }

// HEIC מינימלי: ftyp, meta (hdlr, iinf עם infe לתמונה ול-Exif, iloc), mdat.
// iloc בגרסה 1 עם offset_size 4 ו-length_size 4, ופריט ה-Exif יושב ב-mdat
// אחרי כמה בתי "תמונה" — כמו בקבצים מהטלפון.
function makeHeic(tiff, { exifInIdat = false, imageBytes = 100 } = {}) {
    const exifItem = [...u32(6), ...enc("Exif"), 0, 0, ...tiff];
    const ftyp = box("ftyp", [...enc("heic"), 0, 0, 0, 0, ...enc("mif1"), ...enc("heic")]);
    const hdlr = fullBox("hdlr", 0, [0, 0, 0, 0, ...enc("pict"), ...new Array(12).fill(0), 0]);
    const infeImage = fullBox("infe", 2, [...u16(1), ...u16(0), ...enc("hvc1"), 0]);
    const infeExif = fullBox("infe", 2, [...u16(2), ...u16(0), ...enc("Exif"), 0]);
    const iinf = fullBox("iinf", 0, [...u16(2), ...infeImage, ...infeExif]);
    const buildIloc = (imageOffset, exifOffset, method) => fullBox("iloc", 1, [
        0x44, 0x00, ...u16(2),
        ...u16(1), ...u16(0), ...u16(0), ...u16(1), ...u32(imageOffset), ...u32(imageBytes),
        ...u16(2), ...u16(method), ...u16(0), ...u16(1), ...u32(exifOffset), ...u32(exifItem.length)
    ]);
    const idat = exifInIdat ? box("idat", exifItem) : [];
    // אורך ה-meta אינו תלוי בערכי ההיסט, ולכן מחשבים פעם אחת ומציבים.
    const metaLength = fullBox("meta", 0, [...hdlr, ...iinf, ...buildIloc(0, 0, 0), ...idat]).length;
    const mdatStart = ftyp.length + metaLength;
    const imageOffset = mdatStart + 8;
    const exifOffset = exifInIdat ? 0 : imageOffset + imageBytes;
    const meta = fullBox("meta", 0, [...hdlr, ...iinf, ...buildIloc(imageOffset, exifOffset, exifInIdat ? 1 : 0), ...idat]);
    const mdat = box("mdat", [...new Array(imageBytes).fill(5), ...(exifInIdat ? [] : exifItem)]);
    return Uint8Array.from([...ftyp, ...meta, ...mdat]);
}

function makeMp4(seconds, { version = 0, moovAtEnd = false, mdatBytes = 64, largeMdat = false } = {}) {
    const ftyp = box("ftyp", [...enc("isom"), 0, 0, 2, 0, ...enc("isom"), ...enc("mp41")]);
    const times = version === 1
        ? [...u64(seconds), ...u64(seconds), ...u32(1000), ...u64(5000)]
        : [...u32(seconds), ...u32(seconds), ...u32(1000), ...u32(5000)];
    const mvhd = fullBox("mvhd", version, [...times, ...new Array(80).fill(0)]);
    const moov = box("moov", [...mvhd, ...box("trak", new Array(16).fill(0))]);
    const mdatBody = new Array(mdatBytes).fill(3);
    const mdat = largeMdat
        ? [...u32(1), ...enc("mdat"), ...u64(mdatBody.length + 16), ...mdatBody]
        : box("mdat", mdatBody);
    return Uint8Array.from(moovAtEnd ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat]);
}

// מקור שסופר כמה פעמים ואילו טווחים נקראו — כדי לוודא שלא נקרא הקובץ כולו.
function countingSource(bytes) {
    const reads = [];
    return {
        reads,
        size: bytes.length,
        read: async (offset, length) => { reads.push([offset, length]); return bytes.subarray(offset, offset + length); }
    };
}

const QT = date => Math.round(date / 1000) + 2082844800;
const opts = { now: NOW, timeZone: "UTC" };

// --- מחרוזות EXIF ---
test("מחרוזת EXIF עם אזור זמן הופכת לרגע מדויק ולתאריך קלנדרי של המצלמה", () => {
    const capture = parseExifDateTime("2026:09:28 23:30:00", "+03:00", { now: NOW });
    assert.equal(capture.takenAt, Date.UTC(2026, 8, 28, 20, 30));
    assert.equal(capture.takenDate, "2026-09-28");
    assert.equal(capture.takenAtOffset, "+03:00");
    assert.equal(parseExifDateTime("2026:09:28 07:15:00", "-0500", { now: NOW }).takenAt, Date.UTC(2026, 8, 28, 12, 15));
    assert.equal(parseExifDateTime("2026:09:28 07:15:00", "Z", { now: NOW }).takenAtOffset, "+00:00");
});

test("בלי אזור זמן השעה היא השעון המקומי, ותאריכים פסולים נדחים", () => {
    const capture = parseExifDateTime("2026:09:28 19:33:12\0", "", { now: NOW });
    assert.equal(capture.takenAt, new Date(2026, 8, 28, 19, 33, 12).getTime());
    assert.equal(capture.takenAtOffset, "");
    for (const bad of ["0000:00:00 00:00:00", "    :  :     :  :  ", "2026:02:30 10:00:00", "2026:13:01 10:00:00", "1904:01:01 00:00:00", "2031:01:01 00:00:00", "", "garbage"]) {
        assert.equal(parseExifDateTime(bad, "", { now: NOW }), null, bad);
    }
    // היסט פסול פשוט אינו בשימוש.
    assert.equal(parseExifDateTime("2026:09:28 10:00:00", "+99:00", { now: NOW }).takenAtOffset, "");
});

// --- TIFF ---
test("TIFF בשני סדרי הבתים: DateTimeOriginal ו-OffsetTimeOriginal", () => {
    for (const little of [true, false]) {
        const tiff = makeTiff({ [ORIGINAL]: "2025:10:15 18:05:00", [OFFSET_ORIGINAL]: "+03:00", [CREATE]: "2025:10:16 09:00:00" }, { little });
        const dates = readExifDates(tiff);
        assert.equal(dates.dateTimeOriginal, "2025:10:15 18:05:00");
        assert.equal(dates.createDate, "2025:10:16 09:00:00");
        const capture = captureFromTiff(tiff, opts);
        assert.equal(capture.takenAt, Date.UTC(2025, 9, 15, 15, 5));
        assert.equal(capture.takenDate, "2025-10-15");
        assert.equal(capture.takenAtSource, "exif");
    }
});

test("בלי DateTimeOriginal נלקח CreateDate עם OffsetTime הכללי", () => {
    const tiff = makeTiff({ [CREATE]: "2024:04:22 12:00:00", [OFFSET]: "+02:00" });
    const capture = captureFromTiff(tiff, opts);
    assert.equal(capture.takenAt, Date.UTC(2024, 3, 22, 10));
    assert.equal(capture.takenAtOffset, "+02:00");
    assert.equal(captureFromTiff(makeTiff({}), opts), null);
    assert.equal(captureFromTiff(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), opts), null);
});

// --- JPEG ---
test("JPEG: מקטע APP1 Exif אחרי JFIF, גם כשהוא מעבר לראש שנקרא", async () => {
    const tiff = makeTiff({ [ORIGINAL]: "2026:09:28 19:00:00", [OFFSET_ORIGINAL]: "+03:00" });
    const capture = await readCaptureDate(bytesSource(makeJpeg(tiff)), opts);
    assert.deepEqual(capture, { takenAt: Date.UTC(2026, 8, 28, 16), takenDate: "2026-09-28", takenAtOffset: "+03:00", takenAtSource: "exif" });

    // APP2 גדול לפניו דוחף את ה-Exif אל מעבר ל-256KB הראשונים.
    const far = makeJpeg(tiff, { padBefore: 60000 });
    const padded = Uint8Array.from([...far.subarray(0, 2), ...Array.from({ length: 5 }, () => [0xff, 0xe3, ...u16(60002), ...new Array(60000).fill(0)]).flat(), ...far.subarray(2)]);
    const source = countingSource(padded);
    const farCapture = await readCaptureDate(source, opts);
    assert.equal(farCapture.takenAt, Date.UTC(2026, 8, 28, 16));
    assert.ok(source.reads.length >= 2, "המקטע הרחוק נקרא בבקשה נפרדת");
});

test("JPEG בלי EXIF, או קובץ שאינו מוכר, מחזירים null", async () => {
    const plain = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...enc("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9]);
    assert.equal(await readCaptureDate(bytesSource(plain), opts), null);
    assert.equal(await readCaptureDate(bytesSource(Uint8Array.from(enc("GIF89a............"))), opts), null);
    assert.equal(await readCaptureDate(bytesSource(new Uint8Array(4)), opts), null);
});

// --- WebP ---
test("WebP: מקטע EXIF אחרי נתוני התמונה, עם ובלי הכותרת Exif\\0\\0", async () => {
    const tiff = makeTiff({ [ORIGINAL]: "2023:03:07 08:00:00", [OFFSET_ORIGINAL]: "+02:00" }, { little: false });
    for (const withHeader of [false, true]) {
        const capture = await readCaptureDate(bytesSource(makeWebp(tiff, { withHeader })), opts);
        assert.equal(capture.takenAt, Date.UTC(2023, 2, 7, 6), `withHeader=${withHeader}`);
    }
    // דגל ה-EXIF כבוי ב-VP8X: אין טעם לחפש.
    assert.equal(await readCaptureDate(bytesSource(makeWebp(tiff, { exifFlag: false })), opts), null);
});

// --- HEIC ---
test("HEIC: פריט ה-Exif נמצא דרך iinf ו-iloc, גם ב-mdat וגם ב-idat", async () => {
    const tiff = makeTiff({ [ORIGINAL]: "2026:03:14 21:10:00", [OFFSET_ORIGINAL]: "+02:00" });
    const heic = makeHeic(tiff);
    const capture = await readCaptureDate(bytesSource(heic), opts);
    assert.equal(capture.takenAt, Date.UTC(2026, 2, 14, 19, 10));
    assert.equal(capture.takenDate, "2026-03-14");
    const inIdat = await readCaptureDate(bytesSource(makeHeic(tiff, { exifInIdat: true })), opts);
    assert.equal(inIdat.takenAt, Date.UTC(2026, 2, 14, 19, 10));
    // פריט Exif רחוק (mdat גדול לפניו) נקרא בבקשה ממוקדת ולא כל הקובץ.
    const big = makeHeic(tiff, { imageBytes: 600000 });
    const source = countingSource(big);
    assert.equal((await readCaptureDate(source, opts)).takenAt, Date.UTC(2026, 2, 14, 19, 10));
    assert.ok(source.reads.every(([, length]) => length <= 256 * 1024), "אף קריאה אינה גדולה מ-256KB");
});

test("HEIC בלי פריט Exif מחזיר null", async () => {
    const heic = makeHeic(makeTiff({}));
    assert.equal(await readCaptureDate(bytesSource(heic), opts), null);
    assert.equal(locateHeifExif(Uint8Array.from([0, 0, 0, 0])), null);
});

// --- MP4/MOV ---
test("MP4: creation_time של mvhd בגרסה 0 ו-1, ו-moov שבסוף הקובץ", async () => {
    const when = Date.UTC(2026, 8, 30, 17, 45, 10);
    for (const variant of [{}, { version: 1 }, { moovAtEnd: true }, { moovAtEnd: true, largeMdat: true, mdatBytes: 700000 }]) {
        const source = countingSource(makeMp4(QT(when), variant));
        const capture = await readCaptureDate(source, opts);
        assert.deepEqual(capture, { takenAt: when, takenDate: "2026-09-30", takenAtOffset: "", takenAtSource: "video" }, JSON.stringify(variant));
        assert.ok(source.reads.every(([, length]) => length <= 256 * 1024), "הסרטון אינו נקרא כולו");
    }
    // התאריך הקלנדרי של סרטון נקבע באזור הזמן שהתבקש.
    const late = Date.UTC(2026, 8, 30, 22, 30);
    assert.equal((await readCaptureDate(bytesSource(makeMp4(QT(late))), { now: NOW, timeZone: "Asia/Jerusalem" })).takenDate, "2026-10-01");
});

test("MP4 בלי זמן (אפס) או עם זמן מחוץ לטווח מחזיר null", async () => {
    assert.equal(await readCaptureDate(bytesSource(makeMp4(0)), opts), null);
    assert.equal(captureFromMvhd(Uint8Array.from([0, 0, 0, 0, ...u32(100)]), opts), null);
    assert.equal(await readCaptureDate(bytesSource(makeMp4(QT(Date.UTC(2035, 0, 1)))), opts), null);
});

test("כשל קריאה (רשת) אינו נבלע כ'אין תאריך'", async () => {
    const bytes = makeMp4(QT(Date.UTC(2026, 0, 1)), { moovAtEnd: true, mdatBytes: 400000 });
    const failing = { size: bytes.length, read: async (offset, length) => {
        if (offset > 0) throw new Error("network down");
        return bytes.subarray(offset, offset + length);
    } };
    await assert.rejects(readCaptureDate(failing, opts), /network down/);
});

// --- Drive ---
test("Drive: imageMediaMetadata.time הופך לתאריך צילום, וסרטון בלי זמן מחזיר null", () => {
    const capture = captureFromDriveMetadata({ imageMediaMetadata: { time: "2026:09:28 19:33:12" } }, { now: NOW });
    assert.equal(capture.takenAtSource, "drive");
    assert.equal(capture.takenDate, "2026-09-28");
    assert.equal(captureFromDriveMetadata({ videoMediaMetadata: { durationMillis: "1000" } }), null);
    assert.equal(captureFromDriveMetadata(null), null);
});

// --- רשומות ומיון ---
test("המיון לפי takenAt, עם זמן ההעלאה כשובר שוויון ונפילה אליו כשאין takenAt", () => {
    const records = [
        { id: "a", createdAt: Date.UTC(2026, 9, 1), takenAt: Date.UTC(2020, 0, 1) },
        { id: "b", createdAt: Date.UTC(2026, 9, 2) },
        { id: "c", createdAt: Date.UTC(2026, 9, 3), takenAt: Date.UTC(2025, 5, 1) },
        { id: "d", createdAt: Date.UTC(2026, 9, 4), takenAt: Date.UTC(2025, 5, 1) },
        { id: "e", createdAt: Date.UTC(2026, 9, 5), takenAt: "not-a-number" },
        { id: "f", createdAt: Date.UTC(2026, 9, 6), takenAt: Date.UTC(1950, 0, 1) }
    ];
    assert.deepEqual([...records].sort(compareCaptureDesc).map(r => r.id), ["f", "e", "b", "d", "c", "a"]);
    assert.deepEqual([...records].sort(compareCaptureAsc).map(r => r.id), ["a", "c", "d", "b", "e", "f"]);
    assert.equal(captureTime({ createdAt: 5 }), 5);
    assert.equal(captureTime({}), 0);
});

test("התאריך המוצג: יום הצילום של המצלמה, ובלעדיו יום ההעלאה — והתאריך העברי שלו", () => {
    const shot = { takenAt: Date.UTC(2026, 8, 28, 20, 30), takenDate: "2026-09-28", date: "2026-10-05", createdAt: Date.UTC(2026, 9, 5) };
    assert.equal(captureDateKey(shot), "2026-09-28");
    assert.equal(formatHebrewDate(recordHebrewDate(shot)), "י״ז בתשרי תשפ״ז");
    assert.equal(captureDateKey({ date: "2026-10-05", createdAt: 1 }), "2026-10-05");
    assert.equal(captureDateKey({ createdAt: Date.UTC(2026, 9, 5, 12) }), dateKeyFromTimestamp(Date.UTC(2026, 9, 5, 12)));
    assert.equal(captureDateKey({}), "");
    assert.equal(recordHebrewDate({}), null);
});

test("ריצת ההשלמה בוחרת רק רשומות שלא נבדקו, וכותבת none כשאין תאריך", () => {
    assert.equal(needsCaptureDate({ id: "x" }), true);
    assert.equal(needsCaptureDate({ id: "x", takenAtSource: "none" }), false);
    assert.equal(needsCaptureDate({ id: "x", takenAt: Date.UTC(2025, 0, 1) }), false);
    assert.deepEqual(captureFields(null), { takenAtSource: "none" });
    assert.deepEqual(captureFields({ takenAt: Date.UTC(2025, 0, 1, 10), takenDate: "2025-01-01", takenAtOffset: "+02:00", takenAtSource: "exif" }), {
        takenAt: Date.UTC(2025, 0, 1, 10), takenDate: "2025-01-01", takenAtOffset: "+02:00", takenAtSource: "exif"
    });
    assert.equal(isValidTakenAt(Date.UTC(1970, 5, 1)), false);
    assert.equal(isValidTakenAt(Date.now() + 10 * 86400000), false);
});
