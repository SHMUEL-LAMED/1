// הקטנה לפני העלאה (upload-compress.js): חישוב הממדים, ההחלטה מתי לקודד
// מחדש, סוג הפלט, וקריאת תאריך הצילום מ-EXIF — כדי שלא יאבד כשה-Canvas
// מוחק את ה-EXIF. הקידוד עצמו נבדק בדפדפן (e2e).
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPRESS_MAX_EDGE,
  COMPRESS_MIN_BYTES,
  computeTargetDimensions,
  shouldCompressImage,
  chooseOutputType,
  normalizeExifDate,
  readExifCaptureDate,
  readCaptureDateFromFile,
  prepareImageForUpload
} from "./upload-compress.js";

test("ממדי היעד: הצלע הארוכה מוגבלת ל-3840, היחס נשמר, ואין הגדלה", () => {
  assert.equal(COMPRESS_MAX_EDGE, 3840);
  assert.deepEqual(computeTargetDimensions(8000, 6000), { width: 3840, height: 2880, scaled: true, scale: 0.48 });
  // תמונה לאורך: הגובה הוא הצלע הארוכה.
  const portrait = computeTargetDimensions(3024, 4032);
  assert.equal(portrait.height, 3840);
  assert.equal(portrait.width, 2880);
  assert.deepEqual(computeTargetDimensions(1920, 1080), { width: 1920, height: 1080, scaled: false, scale: 1 });
  assert.equal(computeTargetDimensions(3840, 100).scaled, false);
  assert.equal(computeTargetDimensions(12000, 10, 3840).height, 3);
  assert.equal(computeTargetDimensions(0, 0).width, 1);
});

test("מתי לקודד מחדש: ממדים חורגים או קובץ כבד; לא GIF, לא כשמנהל ביקש מקור; HEIC תמיד", () => {
  const big = { type: "image/jpeg", size: 2 * 1024 * 1024, width: 6000, height: 4000 };
  assert.equal(shouldCompressImage(big), true);
  assert.equal(shouldCompressImage(big, { sendOriginal: true }), false);
  assert.equal(shouldCompressImage({ type: "image/jpeg", size: 1024 * 1024, width: 3000, height: 2000 }), false);
  assert.equal(shouldCompressImage({ type: "image/jpeg", size: COMPRESS_MIN_BYTES + 1, width: 3000, height: 2000 }), true);
  assert.equal(shouldCompressImage({ type: "image/gif", size: 50 * 1024 * 1024, width: 9000, height: 9000 }), false);
  assert.equal(shouldCompressImage({ type: "video/mp4", size: 50 * 1024 * 1024 }), false);
  // סוג שה-Worker אינו מקבל חייב לעבור קידוד, גם כשמנהל ביקש את המקור.
  assert.equal(shouldCompressImage({ type: "image/heic", size: 100, width: 10, height: 10 }, { sendOriginal: true }), true);
});

test("סוג הפלט: JPEG ו-HEIC ל-JPEG; PNG ו-WebP ל-WebP כשאפשר", () => {
  assert.equal(chooseOutputType("image/jpeg", true), "image/jpeg");
  assert.equal(chooseOutputType("image/heic", true), "image/jpeg");
  assert.equal(chooseOutputType("image/png", true), "image/webp");
  assert.equal(chooseOutputType("image/png", false), "image/jpeg");
  assert.equal(chooseOutputType("image/webp", true), "image/webp");
});

// בונה JPEG מינימלי עם מקטע APP1/Exif: IFD0 עם DateTime ומצביע ל-Exif IFD
// עם DateTimeOriginal. littleEndian קובע את סדר הבתים (II או MM).
function jpegWithExif({ original = "2024:05:12 18:30:05", fileDate = "2025:01:01 00:00:00", littleEndian = true, withOriginal = true } = {}) {
  const tiff = [];
  const u16 = value => (littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = value => (littleEndian
    ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
    : [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  const ascii = text => [...Buffer.from(text, "ascii"), 0];
  // מבנה: header(8) | IFD0: count(2) + 2 entries(24) + next(4) = 30 → 38 | ExifIFD: 2+12+4 = 18 → 56 | strings
  const ifd0Offset = 8;
  const exifOffset = 38;
  const fileDateOffset = 56;
  const originalOffset = fileDateOffset + 20;
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0Offset));
  tiff.push(...u16(2));
  tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(fileDateOffset));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifOffset));
  tiff.push(...u32(0));
  tiff.push(...u16(withOriginal ? 1 : 0));
  if (withOriginal) tiff.push(...u16(0x9003), ...u16(2), ...u32(20), ...u32(originalOffset));
  else tiff.push(...new Array(12).fill(0));
  tiff.push(...u32(0));
  tiff.push(...ascii(fileDate));
  tiff.push(...ascii(original));
  const app1 = [...Buffer.from("Exif\0\0", "binary"), ...tiff];
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xd9]);
}

test("תאריך הצילום נקרא מ-EXIF בשני סדרי הבתים, עם נפילה ל-DateTime של הקובץ", () => {
  assert.equal(readExifCaptureDate(jpegWithExif().buffer), "2024-05-12T18:30:05");
  assert.equal(readExifCaptureDate(jpegWithExif({ littleEndian: false }).buffer), "2024-05-12T18:30:05");
  assert.equal(readExifCaptureDate(jpegWithExif({ withOriginal: false }).buffer), "2025-01-01T00:00:00");
  assert.equal(readExifCaptureDate(jpegWithExif({ original: "0000:00:00 00:00:00", withOriginal: true, fileDate: "bad" }).buffer), "");
  // לא JPEG, או JPEG בלי EXIF — אין תאריך, ואין חריגה.
  assert.equal(readExifCaptureDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), "");
  assert.equal(readExifCaptureDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), "");
  assert.equal(readExifCaptureDate(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]).buffer), "");
});

test("נרמול תאריך EXIF", () => {
  assert.equal(normalizeExifDate("2023:10:08 09:15:00"), "2023-10-08T09:15:00");
  assert.equal(normalizeExifDate("2023:10:08 09:15"), "2023-10-08T09:15:00");
  assert.equal(normalizeExifDate("2023:13:40 09:15:00"), "");
  assert.equal(normalizeExifDate(""), "");
});

test("קריאה מקובץ: רק JPEG, ורק תחילת הקובץ", async () => {
  const file = new File([jpegWithExif(), new Uint8Array(1024)], "photo.jpg", { type: "image/jpeg" });
  assert.equal(await readCaptureDateFromFile(file), "2024-05-12T18:30:05");
  assert.equal(await readCaptureDateFromFile(new File([jpegWithExif()], "x.png", { type: "image/png" })), "");
});

test("מנהל ששולח מקור, או קובץ קטן: הקובץ עולה כמות שהוא, עם תאריך הצילום", async () => {
  const file = new File([jpegWithExif()], "small.jpg", { type: "image/jpeg" });
  const original = await prepareImageForUpload(file, { sendOriginal: true });
  assert.equal(original.blob, file);
  assert.equal(original.compressed, false);
  assert.equal(original.captureDate, "2024-05-12T18:30:05");
  const gif = new File([new Uint8Array(10)], "a.gif", { type: "image/gif" });
  assert.equal((await prepareImageForUpload(gif)).blob, gif);
});
