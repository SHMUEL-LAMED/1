// הורדה בלי מיקום: הסרת ה-GPS מ-JPEG אמיתי בלי לגעת בתמונה, והחלטות סימן
// המים. קובצי ה-JPEG נבנים ב-e2e/jpeg-fixtures.mjs על בסיס JPEG תקין, עם EXIF,
// XMP ו-MPF כפי שטלפון כותב אותם.
import test from "node:test";
import assert from "node:assert/strict";
import {
    stripJpegMetadata, inspectJpegMetadata, readJpegOrientation, readJpegSegments, findJpegEnd,
    isJpegBytes, orientationOnlyExif, normalizeDownloadSettings, normalizeWatermarkText,
    watermarkTextFor, shouldWatermark, watermarkOutputType, watermarkLayout,
    DEFAULT_WATERMARK_TEXT, WATERMARK_TEXT_MAX, WATERMARK_MIN_FONT
} from "./download-privacy.js";
import {
    baseJpeg, jpegWithGps, jpegWithSegments, exifSegment, xmpSegment, iccSegment, commentSegment,
    segment, jpegWithMpfSecondary, jpegWithMotionVideo, FAKE_VIDEO_LOCATION, containsBytes, gpsRationalBytes, scanData
} from "./e2e/jpeg-fixtures.mjs";

const sameBytes = (a, b) => assert.ok(Buffer.from(a).equals(Buffer.from(b)), "הבתים שונים");

test("JPEG עם GPS ב-EXIF (big-endian ו-little-endian): המיקום יוצא, השאר נשאר", () => {
    for (const little of [false, true]) {
        const source = jpegWithGps({ little, orientation: 6, xmp: false });
        const before = inspectJpegMetadata(source);
        assert.equal(before.hasGpsIfd, true);

        const result = stripJpegMetadata(source);
        assert.equal(result.changed, true);
        assert.deepEqual(result.removed, { exifGps: true, xmpGps: false, secondary: 0, video: 0 });
        const after = inspectJpegMetadata(result.bytes);
        assert.equal(after.isJpeg, true);
        assert.equal(after.hasGpsIfd, false);
        assert.equal(after.orientation, 6, "הכיוון נשמר");
        // עריכה במקום: אותו אורך, ואותם נתונים דחוסים בדיוק — התמונה לא קודדה מחדש.
        assert.equal(result.bytes.length, source.length);
        sameBytes(scanData(result.bytes), scanData(source));
        // הקואורדינטות עצמן נמחקו מהקובץ, לא רק המצביע אליהן.
        assert.ok(containsBytes(source, gpsRationalBytes(little)));
        assert.ok(!containsBytes(result.bytes, gpsRationalBytes(little)));
        // יצרן, דגם ותאריך הצילום נשארו.
        assert.ok(containsBytes(result.bytes, Buffer.from("E2E Camera")));
        assert.ok(containsBytes(result.bytes, Buffer.from("2026:09:01 10:00:00")));
        // הקלט אינו משתנה.
        assert.equal(inspectJpegMetadata(source).hasGpsIfd, true);
    }
});

test("GPS ב-XMP (מאפיין ואלמנט מקונן) מוחלף ברווחים, ושאר ה-XMP נשאר", () => {
    const source = jpegWithGps();
    assert.equal(inspectJpegMetadata(source).hasXmpGps, true);
    const result = stripJpegMetadata(source);
    assert.deepEqual(result.removed, { exifGps: true, xmpGps: true, secondary: 0, video: 0 });
    const after = inspectJpegMetadata(result.bytes);
    assert.equal(after.hasXmp, true);
    assert.equal(after.hasXmpGps, false);
    const text = Buffer.from(result.bytes).toString("utf8");
    assert.ok(!/GPS/.test(text), "לא נשאר שום מאפיין GPS");
    assert.ok(text.includes('xmp:Rating="5"'));
    assert.ok(text.includes("הקפות בבית הכנסת"), "התיאור בעברית נשאר שלם");
    assert.equal(result.bytes.length, source.length);
});

test("קובץ בלי מיקום חוזר כמות שהוא", () => {
    for (const source of [baseJpeg(), jpegWithSegments([exifSegment({ gps: null }), xmpSegment({ gps: false })])]) {
        const result = stripJpegMetadata(source);
        assert.equal(result.changed, false);
        assert.equal(result.reason, "no_location");
        sameBytes(result.bytes, source);
    }
});

test("תמונה משנית ב-MPF (מפת עומק) מנוקה גם היא, וההיסטים נשארים נכונים", () => {
    const { bytes, primaryLength } = jpegWithMpfSecondary();
    assert.equal(inspectJpegMetadata(bytes.subarray(primaryLength)).hasGpsIfd, true);
    const result = stripJpegMetadata(bytes);
    assert.deepEqual(result.removed, { exifGps: true, xmpGps: false, secondary: 1, video: 0 });
    assert.equal(result.bytes.length, bytes.length);
    const secondary = result.bytes.subarray(primaryLength);
    assert.equal(isJpegBytes(secondary), true, "התמונה המשנית עדיין במקומה");
    assert.equal(inspectJpegMetadata(secondary).hasGpsIfd, false);
});

test("Motion Photo: המיקום שבסרטון המצורף (©xyz) יוצא, והסרטון נשאר במקומו ובאורכו", () => {
    const { bytes, primaryLength, videoLength } = jpegWithMotionVideo();
    assert.ok(containsBytes(bytes, Buffer.from(FAKE_VIDEO_LOCATION, "latin1")));
    const result = stripJpegMetadata(bytes);
    assert.deepEqual(result.removed, { exifGps: true, xmpGps: false, secondary: 0, video: 1 });
    assert.equal(result.bytes.length, bytes.length);
    assert.ok(!containsBytes(result.bytes, Buffer.from(FAKE_VIDEO_LOCATION, "latin1")));
    assert.ok(!containsBytes(result.bytes, Buffer.from("©xyz", "latin1")));
    // הסרטון מתחיל באותו מקום, התיבות שלו באותם גדלים, ונתוני היצרן שאחריו לא נגעו.
    const video = Buffer.from(result.bytes.subarray(primaryLength, primaryLength + videoLength));
    assert.equal(video.toString("latin1", 4, 8), "ftyp");
    assert.ok(video.includes(Buffer.from("free", "latin1")));
    sameBytes(result.bytes.subarray(primaryLength + videoLength), bytes.subarray(primaryLength + videoLength));
    // סרטון בלי מיקום, או נתונים שרק נראים כמו ftyp — לא נוגעים בהם.
    const plain = jpegWithSegments([], new Uint8Array([...baseJpeg(), 0, 0, 0, 3, 0x66, 0x74, 0x79, 0x70, 1, 2]));
    assert.equal(stripJpegMetadata(plain).reason, "no_location");
    // מצב 'all' חותך את הסרטון כולו.
    assert.ok(!containsBytes(stripJpegMetadata(bytes, { mode: "all" }).bytes, Buffer.from("ftyp", "latin1")));
});

test("קבצים פגומים, חתוכים או שאינם JPEG — לעולם לא נזרק, והקובץ חוזר כמות שהוא", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);
    assert.equal(stripJpegMetadata(png).reason, "not_jpeg");
    sameBytes(stripJpegMetadata(png).bytes, png);
    assert.equal(stripJpegMetadata(new Uint8Array(0)).changed, false);
    assert.equal(stripJpegMetadata(null).changed, false);

    const full = jpegWithGps();
    // חיתוך באמצע הכותרות (לפני SOS) — המבנה אינו נקרא עד הסוף.
    for (const cut of [5, 30, 200]) {
        const truncated = full.subarray(0, cut);
        const result = stripJpegMetadata(truncated);
        assert.equal(result.changed, false);
        sameBytes(result.bytes, truncated);
    }

    // EXIF שבור: היסט IFD0 מחוץ לקטע, וסדר בתים לא חוקי.
    const brokenOffset = segment(0xE1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from([0x4D, 0x4D, 0, 42, 0x7F, 0xFF, 0xFF, 0xFF])]));
    const brokenOrder = segment(0xE1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from([0x41, 0x41, 0, 42, 0, 0, 0, 8])]));
    for (const broken of [brokenOffset, brokenOrder]) {
        const source = jpegWithSegments([broken]);
        const result = stripJpegMetadata(source);
        assert.equal(result.changed, false);
        sameBytes(result.bytes, source);
    }

    // GPS IFD שמצביע אל מחוץ לקטע: המצביע עדיין יוצא מ-IFD0, ושום דבר אחר לא נשבר.
    const tiff = Buffer.from(exifSegment().subarray(10));
    const gpsEntryAt = tiff.indexOf(Buffer.from([0x88, 0x25]));
    tiff.writeUInt32BE(0x00FFFFF0, gpsEntryAt + 8);
    const dangling = jpegWithSegments([segment(0xE1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]))]);
    const result = stripJpegMetadata(dangling);
    assert.equal(result.removed.exifGps, true);
    assert.equal(inspectJpegMetadata(result.bytes).hasGpsIfd, false);
    assert.ok(containsBytes(result.bytes, Buffer.from("E2E Camera")));
});

test("מצב 'all': נשאר רק הכיוון, ופרופיל הצבע ו-JFIF נשמרים", () => {
    const source = jpegWithSegments([exifSegment({ orientation: 8 }), iccSegment(), xmpSegment(), commentSegment(), segment(0xED, Buffer.from("Photoshop 3.0\0IPTC"))]);
    const result = stripJpegMetadata(source, { mode: "all" });
    assert.equal(result.changed, true);
    assert.equal(result.mode, "all");
    const after = inspectJpegMetadata(result.bytes);
    assert.deepEqual(after.kinds.filter(kind => kind !== "image"), ["jfif", "exif", "icc"]);
    assert.equal(after.orientation, 8);
    assert.equal(after.hasGpsIfd, false);
    assert.ok(!containsBytes(result.bytes, Buffer.from("E2E Camera")));
    assert.ok(!containsBytes(result.bytes, Buffer.from("צולם בבית הכנסת")));
    sameBytes(scanData(result.bytes), scanData(source));

    // בלי כיוון (או כיוון 1) — אין EXIF בכלל.
    const upright = stripJpegMetadata(jpegWithGps({ orientation: 1 }), { mode: "all" });
    assert.deepEqual(inspectJpegMetadata(upright.bytes).kinds.filter(kind => kind !== "image"), ["jfif"]);
    assert.equal(readJpegOrientation(upright.bytes), 1);
});

test("מצב 'all' חותך את מה שאחרי סוף התמונה (MPF, וידאו של Motion Photo)", () => {
    const { bytes, primaryLength } = jpegWithMpfSecondary();
    const result = stripJpegMetadata(bytes, { mode: "all" });
    const parsed = readJpegSegments(result.bytes);
    assert.equal(findJpegEnd(result.bytes, parsed.scanStart), result.bytes.length);
    assert.ok(result.bytes.length < primaryLength);
    assert.ok(!inspectJpegMetadata(result.bytes).kinds.includes("mpf"));
});

test("EXIF זעיר של כיוון בלבד הוא TIFF תקין", () => {
    const tiny = orientationOnlyExif(3);
    const source = jpegWithSegments([tiny]);
    assert.equal(readJpegOrientation(source), 3);
    assert.equal(inspectJpegMetadata(source).hasExif, true);
});

test("findJpegEnd מדלג על FF00, RST וקטעים שבין סריקות", () => {
    const base = baseJpeg();
    const parsed = readJpegSegments(base);
    assert.equal(findJpegEnd(base, parsed.scanStart), base.length);
    const withTrailer = new Uint8Array([...base, 1, 2, 3]);
    assert.equal(findJpegEnd(withTrailer, parsed.scanStart), base.length);
    // סריקה מלאכותית: נתונים עם FF00 ו-RST0, DHT באמצע, ואז EOI.
    const synthetic = new Uint8Array([0xFF, 0xDA, 0, 2, 0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56, 0xFF, 0xC4, 0, 4, 0xFF, 0xD9, 0x78, 0xFF, 0xD9]);
    assert.equal(findJpegEnd(synthetic, 0), synthetic.length);
});

test("הגדרות ההורדה: נרמול, טקסט ברירת מחדל ותווי כיווניות", () => {
    assert.deepEqual(normalizeDownloadSettings(null), { watermarkEnabled: false, watermarkText: "", stripAllMetadata: false });
    assert.deepEqual(
        normalizeDownloadSettings({ watermarkEnabled: "true", watermarkText: "  שמחת   תורה\n2026 ", stripAllMetadata: true }),
        { watermarkEnabled: false, watermarkText: "שמחת תורה 2026", stripAllMetadata: true }
    );
    assert.equal(normalizeWatermarkText("‮גלריה‬"), "גלריה");
    assert.equal(normalizeWatermarkText("א".repeat(100)).length, WATERMARK_TEXT_MAX);
    assert.equal(watermarkTextFor({ watermarkText: "   " }), DEFAULT_WATERMARK_TEXT);
    assert.equal(watermarkTextFor({ watermarkText: "© משפחת כהן" }), "© משפחת כהן");
});

test("סימן מים: רק לצופה, רק כשמופעל, ורק ל-JPEG/PNG/WebP", () => {
    const on = { watermarkEnabled: true };
    assert.equal(shouldWatermark(on, { mimeType: "image/jpeg" }), true);
    assert.equal(shouldWatermark(on, { mimeType: "image/jpg" }), true);
    assert.equal(shouldWatermark(on, { mimeType: "image/png" }), true);
    assert.equal(shouldWatermark(on, { mimeType: "image/webp; charset=binary" }), true);
    assert.equal(shouldWatermark(on, { mimeType: "image/jpeg", isAdmin: true }), false, "מנהל מוריד בלי סימן מים");
    assert.equal(shouldWatermark({ watermarkEnabled: false }, { mimeType: "image/jpeg" }), false);
    for (const mimeType of ["image/gif", "image/heic", "image/avif", "video/mp4", ""]) {
        assert.equal(shouldWatermark(on, { mimeType }), false, mimeType);
    }
    assert.deepEqual(watermarkOutputType("image/jpeg"), { type: "image/jpeg", quality: 0.92 });
    assert.deepEqual(watermarkOutputType("image/png"), { type: "image/png" });
    assert.equal(watermarkOutputType("video/mp4"), null);
});

test("מיקום סימן המים: יחסי לצלע הקצרה, בפינה התחתונה, וטקסט ארוך מוקטן", () => {
    assert.deepEqual(watermarkLayout(4000, 3000), { fontSize: 96, margin: 72, x: 72, y: 2928 });
    assert.deepEqual(watermarkLayout(1280, 853), { fontSize: 34, margin: 26, x: 26, y: 827 });
    // תמונה קטנה: לא מתחת לגופן המינימלי.
    assert.equal(watermarkLayout(100, 80).fontSize, WATERMARK_MIN_FONT);
    // טקסט ברוחב 20 פיקסלים לכל פיקסל גופן אינו נכנס ב-1280 — מוקטן עד שנכנס.
    const layout = watermarkLayout(1280, 853, size => size * 20);
    assert.ok(layout.fontSize * 20 <= 1280 - layout.margin * 2);
    assert.ok(layout.fontSize >= WATERMARK_MIN_FONT);
    // מידות לא תקינות אינן מפילות.
    assert.equal(watermarkLayout(NaN, undefined).fontSize, WATERMARK_MIN_FONT);
});

// --- מיקום ב-XMP של רחפנים ויצרנים אחרים ---

// חבילת XMP ראשית סביב תיאור אחד, ו-XMP מורחב (ExtendedXMP) שמחולק לקטעים:
// "http://ns.adobe.com/xmp/extension/\0", GUID של 32 תווים, האורך המלא וההיסט.
const xmpPacket = body => '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + body + '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
const mainXmp = xml => segment(0xE1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xml, "utf8")]));
const EXTENDED_GUID = "0123456789ABCDEF0123456789ABCDEF";
function extendedXmp(xml, cuts) {
    const full = Buffer.from(xml, "utf8");
    const bounds = [0, ...cuts, full.length];
    return bounds.slice(0, -1).map((from, index) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(full.length, 0);
        head.writeUInt32BE(from, 4);
        return segment(0xE1, Buffer.concat([
            Buffer.from("http://ns.adobe.com/xmp/extension/\0", "latin1"), Buffer.from(EXTENDED_GUID, "latin1"), head,
            full.subarray(from, bounds[index + 1])
        ]));
    });
}

// בדיקת מבנה גסה: כל תגית שנפתחה נסגרת בסדר הנכון, ושום תגית לא נחתכה באמצע.
function assertBalancedXml(text) {
    const stack = [];
    for (const [, close, name, selfClose] of text.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)\b[^<>]*?(\/?)>/g)) {
        if (selfClose) continue;
        if (!close) { stack.push(name); continue; }
        assert.equal(stack.pop(), name, `תגית סוגרת ${name} בלי פותחת מתאימה`);
    }
    assert.deepEqual(stack, [], "תגיות שלא נסגרו");
    assert.ok(!/<[^<>]*</.test(text.replace(/<\?xpacket[^>]*\?>/g, "")), "תגית נחתכה באמצע");
}

// אותו מבנה קטעים בדיוק (סמן, תחילה וסוף), אותו אורך ואותם נתונים דחוסים.
function assertSameStructure(result, source) {
    assert.equal(result.length, source.length);
    const before = readJpegSegments(source);
    const after = readJpegSegments(result);
    assert.ok(after, "ה-JPEG עדיין נקרא עד SOS");
    assert.deepEqual(after.segments, before.segments);
    assert.equal(after.scanStart, before.scanStart);
    sameBytes(scanData(result), scanData(source));
}

const DJI_NS = 'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/"';
const DJI_COORDINATES = ["31.775412", "35.220934", "+812.53", "+45.10"];

test("XMP של רחפן DJI (מאפיינים): GpsLatitude, GpsLongitude והגובה יוצאים, הזוויות והיצרן נשארים", () => {
    const xml = xmpPacket(`<rdf:Description rdf:about="DJI Meta Data" ${DJI_NS} tiff:Make="DJI" tiff:Model="FC3582"`
        + ' drone-dji:GpsStatus="RTK" drone-dji:GpsLatitude="31.775412" drone-dji:GpsLongtitude="35.220934" drone-dji:GpsLongitude="35.220934"'
        + ' drone-dji:AbsoluteAltitude="+812.53" drone-dji:RelativeAltitude="+45.10" drone-dji:GimbalYawDegree="-90.0" drone-dji:FlightPitchDegree="+2.30"/>');
    const source = jpegWithSegments([mainXmp(xml)]);
    assert.equal(inspectJpegMetadata(source).hasXmpGps, true);
    const result = stripJpegMetadata(source);
    assert.deepEqual(result.removed, { exifGps: false, xmpGps: true, secondary: 0, video: 0 });
    assertSameStructure(result.bytes, source);
    assert.equal(inspectJpegMetadata(result.bytes).hasXmpGps, false);
    const text = Buffer.from(result.bytes).toString("utf8");
    for (const value of DJI_COORDINATES) assert.ok(!text.includes(value), `${value} נשאר בקובץ`);
    assert.ok(!/gps|latitude|longt?itude|altitude/i.test(text), "לא נשאר מאפיין מיקום");
    for (const kept of ['tiff:Make="DJI"', 'tiff:Model="FC3582"', 'drone-dji:GimbalYawDegree="-90.0"', 'drone-dji:FlightPitchDegree="+2.30"', 'xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"']) {
        assert.ok(text.includes(kept), `${kept} נמחק`);
    }
    assertBalancedXml(text.slice(text.indexOf("<?xpacket")));
});

test("XMP של רחפן כאלמנטים, ובאותיות מעורבות (gps, Gps, GPS): הכול יוצא, והמבנה נשאר תקין", () => {
    const xml = xmpPacket(`<rdf:Description rdf:about="" ${DJI_NS} xmlns:Camera="http://pix4d.com/camera/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"`
        + ' exif:gpslatitude="31,46.52N" Camera:gpsXYAccuracy="0.5">'
        + '<drone-dji:GpsLatitude>31.775412</drone-dji:GpsLatitude>'
        + '<drone-dji:GpsLongitude>35.220934</drone-dji:GpsLongitude>'
        + '<drone-dji:AbsoluteAltitude>+812.53</drone-dji:AbsoluteAltitude>'
        + '<drone-dji:RelativeAltitude>+45.10</drone-dji:RelativeAltitude>'
        + '<Camera:GPSZAccuracy/>'
        + '<drone-dji:GimbalRollDegree>+0.00</drone-dji:GimbalRollDegree>'
        + '<tiff:Make>DJI</tiff:Make>'
        + '</rdf:Description>');
    const source = jpegWithSegments([exifSegment(), mainXmp(xml)]);
    const result = stripJpegMetadata(source);
    assert.deepEqual(result.removed, { exifGps: true, xmpGps: true, secondary: 0, video: 0 });
    assertSameStructure(result.bytes, source);
    const text = Buffer.from(result.bytes).toString("utf8");
    for (const value of [...DJI_COORDINATES, "31,46.52N"]) assert.ok(!text.includes(value), `${value} נשאר בקובץ`);
    assert.ok(!/gps|latitude|longt?itude|altitude/i.test(text), "לא נשאר מאפיין מיקום");
    assert.ok(text.includes("<drone-dji:GimbalRollDegree>+0.00</drone-dji:GimbalRollDegree>"));
    assert.ok(text.includes("<tiff:Make>DJI</tiff:Make>"));
    assert.ok(text.includes('xmlns:Camera="http://pix4d.com/camera/1.0/"'), "הצהרת מרחב השמות נשארת");
    assertBalancedXml(text.slice(text.indexOf("<?xpacket")));
});

test("XMP מורחב: מיקום בקטע ההמשך, וגם מאפיין שנחתך בין שני קטעים, יוצא; הכותרות של הקטעים לא נוגעות", () => {
    const body = `<rdf:Description rdf:about="" ${DJI_NS} xmlns:GDepth="http://ns.google.com/photos/1.0/depthmap/"`
        + ` GDepth:Data="${"QUJD".repeat(40)}" drone-dji:GpsLatitude="31.775412">`
        + "<drone-dji:GpsLongitude>35.220934</drone-dji:GpsLongitude><drone-dji:AbsoluteAltitude>+812.53</drone-dji:AbsoluteAltitude>"
        + "<tiff:Make>DJI</tiff:Make></rdf:Description>";
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${body}</rdf:RDF></x:xmpmeta>`;
    // החיתוכים: באמצע "drone-dji:GpsLatitude" ובאמצע הערך של GpsLongitude.
    const cuts = [xml.indexOf("GpsLatitude") + 5, xml.indexOf("35.2209") + 3];
    const main = mainXmp(xmpPacket(`<rdf:Description rdf:about="" xmlns:xmpNote="http://ns.adobe.com/xmp/note/" xmpNote:HasExtendedXMP="${EXTENDED_GUID}"/>`));
    const chunks = extendedXmp(xml, cuts);
    assert.equal(chunks.length, 3);
    // הקטעים בסדר הפוך בקובץ: הסדר נקבע לפי ההיסט שבכותרת, לא לפי המיקום.
    const source = jpegWithSegments([main, chunks[2], chunks[0], chunks[1]]);
    assert.equal(inspectJpegMetadata(source).hasXmpGps, true);

    const result = stripJpegMetadata(source);
    assert.deepEqual(result.removed, { exifGps: false, xmpGps: true, secondary: 0, video: 0 });
    assertSameStructure(result.bytes, source);
    assert.equal(inspectJpegMetadata(result.bytes).hasXmpGps, false);
    // החלקים של הערכים שנחתכו אינם נשארים באף קטע.
    const text = Buffer.from(result.bytes).toString("latin1");
    for (const piece of ["31.775412", "35.2", "20934", "+812.53", "Latitude", "GpsLongitude", "AbsoluteAltitude"]) {
        assert.ok(!text.includes(piece), `${piece} נשאר בקובץ`);
    }
    assert.ok(text.includes(EXTENDED_GUID), "ה-GUID נשאר");
    assert.ok(text.includes("<tiff:Make>DJI</tiff:Make>"));
    assert.ok(text.includes("QUJD".repeat(40)), "מפת העומק נשארת");
    // הטקסט המאוחד, לפי סדר ההיסטים, הוא עדיין XML מאוזן.
    const after = readJpegSegments(result.bytes).segments
        .filter(item => Buffer.from(result.bytes.subarray(item.dataStart, item.dataStart + 35)).toString("latin1") === "http://ns.adobe.com/xmp/extension/\0")
        .map(item => ({ offset: Buffer.from(result.bytes).readUInt32BE(item.dataStart + 71), data: Buffer.from(result.bytes.subarray(item.dataStart + 75, item.end)) }))
        .sort((a, b) => a.offset - b.offset);
    assert.equal(after.length, 3);
    assertBalancedXml(Buffer.concat(after.map(item => item.data)).toString("utf8"));
});

test("מאפיין שרק מזכיר מיקום בערך, או קטע XMP מורחב קטוע, אינם נערכים", () => {
    const xml = xmpPacket('<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
        + ' xmp:Label="GPS off" xmp:CreatorTool="Altitude Editor"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">latitude 31</rdf:li></rdf:Alt></dc:title></rdf:Description>');
    const truncated = segment(0xE1, Buffer.from("http://ns.adobe.com/xmp/extension/\0ABC", "latin1"));
    const source = jpegWithSegments([mainXmp(xml), truncated]);
    const result = stripJpegMetadata(source);
    assert.equal(result.reason, "no_location");
    sameBytes(result.bytes, source);
});
