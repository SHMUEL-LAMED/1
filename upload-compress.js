// upload-compress.js — הקטנה וקידוד מחדש של תמונה ענקית לפני ההעלאה.
//
// תמונה מטלפון חדש היא 12–50 מגה־פיקסל ו־5–15MB. בגלריה אין צורך ביותר
// מ־3840 פיקסלים בצלע הארוכה (מסך 4K), ולכן תמונה גדולה מזה מוקטנת בדפדפן
// ומקודדת מחדש באיכות 0.85 — בדרך כלל פי 3–5 פחות נפח, בלי הבדל שנראה לעין.
// תמונה שכבר בגבולות האלה ואינה כבדה במיוחד עולה כמות שהיא.
//
// * הכיוון שב-EXIF נשמר: הפענוח (createImageBitmap עם imageOrientation:
//   'from-image') מסובב את הפיקסלים, והקובץ החדש כבר עומד נכון.
// * תאריך הצילום נשמר: קידוד ב-Canvas מוחק את ה-EXIF, ולכן התאריך נקרא
//   מהמקור לפני כן ונשלח כשדה נפרד (capturedAt) ברשומה ובמטא-דאטה שב-R2.
// * מנהל יכול לבחור "שלח את הקובץ המקורי" — אז לא נוגעים בקובץ כלל.
// * GIF אינו מקודד מחדש (אנימציה), וכישלון בפענוח או בקידוד לעולם אינו
//   עוצר העלאה: המקור עולה במקומו.
//
// החישובים (ממדים, החלטה, קריאת EXIF) טהורים ונבדקים ב-Node
// (upload-compress.test.mjs); הקידוד עצמו רץ רק בדפדפן.

export const COMPRESS_MAX_EDGE = 3840;
export const COMPRESS_QUALITY = 0.85;
// מתחת לנפח הזה תמונה בגבולות הממדים עולה כמות שהיא; מעליו — מקודדת מחדש.
export const COMPRESS_MIN_BYTES = 3 * 1024 * 1024;

// לעולם לא מגדילים; הצלע הארוכה מוגבלת ל-maxEdge והיחס נשמר.
export function computeTargetDimensions(width, height, maxEdge = COMPRESS_MAX_EDGE) {
    const w = Math.max(1, Math.round(Number(width) || 0));
    const h = Math.max(1, Math.round(Number(height) || 0));
    const longEdge = Math.max(w, h);
    if (longEdge <= maxEdge) return { width: w, height: h, scaled: false, scale: 1 };
    const scale = maxEdge / longEdge;
    return {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
        scaled: true,
        scale
    };
}

// הסוגים שה-Worker מקבל כקובץ גלריה. תמונה בסוג אחר (למשל HEIC מאייפון)
// חייבת לעבור קידוד מחדש — גם כשמנהל ביקש את המקור — אחרת לא תתקבל.
export const UPLOADABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// האם לקודד מחדש: לא כשהמנהל ביקש את המקור, לא GIF/SVG, כן כשהממדים חורגים
// או כשהקובץ כבד מהסף, וכן תמיד כשהסוג אינו נתמך בגלריה.
export function shouldCompressImage({ type = '', size = 0, width = 0, height = 0 } = {}, {
    sendOriginal = false,
    maxEdge = COMPRESS_MAX_EDGE,
    minBytes = COMPRESS_MIN_BYTES
} = {}) {
    const mime = String(type).toLowerCase();
    if (!mime.startsWith('image/') || mime === 'image/gif' || mime === 'image/svg+xml') return false;
    if (!UPLOADABLE_IMAGE_TYPES.has(mime)) return true;
    if (sendOriginal) return false;
    if (Math.max(Number(width) || 0, Number(height) || 0) > maxEdge) return true;
    return Number(size) > minBytes;
}

// סוג הפלט: PNG או WebP — שעשויים להכיל שקיפות — מקודדים ל-WebP כשהדפדפן
// יודע, וכל השאר (JPEG, HEIC) ל-JPEG: הקובץ שיורד מהגלריה מוכר לכל תוכנה.
export function chooseOutputType(inputType, canWebp) {
    const mime = String(inputType || '').toLowerCase();
    if (mime === 'image/png' || mime === 'image/webp') return canWebp ? 'image/webp' : 'image/jpeg';
    return 'image/jpeg';
}

// --- תאריך הצילום מתוך EXIF ---

function readAscii(view, offset, length) {
    let text = '';
    for (let index = 0; index < length && offset + index < view.byteLength; index += 1) {
        const code = view.getUint8(offset + index);
        if (code === 0) break;
        text += String.fromCharCode(code);
    }
    return text;
}

// "2024:05:12 18:30:05" → "2024-05-12T18:30:05"; ערך שאינו תאריך → ''.
export function normalizeExifDate(value) {
    const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value || '').trim());
    if (!match) return '';
    const [, year, month, day, hour, minute, second = '00'] = match;
    if (year === '0000' || month === '00' || day === '00') return '';
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    return Number.isFinite(Date.parse(`${iso}Z`)) ? iso : '';
}

function readIfdEntries(view, tiffStart, ifdOffset, little) {
    const start = tiffStart + ifdOffset;
    if (start + 2 > view.byteLength) return [];
    const count = view.getUint16(start, little);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        const entry = start + 2 + index * 12;
        if (entry + 12 > view.byteLength) break;
        entries.push({
            tag: view.getUint16(entry, little),
            type: view.getUint16(entry + 2, little),
            count: view.getUint32(entry + 4, little),
            valueOffset: view.getUint32(entry + 8, little),
            entryOffset: entry
        });
    }
    return entries;
}

function readAsciiEntry(view, tiffStart, entry) {
    if (!entry || entry.type !== 2) return '';
    // מחרוזת של עד ארבעה תווים יושבת בתוך הרשומה עצמה; ארוכה ממנה — בהיסט.
    const offset = entry.count <= 4 ? entry.entryOffset + 8 : tiffStart + entry.valueOffset;
    return readAscii(view, offset, entry.count);
}

// מחפש את תאריך הצילום ב-JPEG: DateTimeOriginal (0x9003), אחריו
// DateTimeDigitized (0x9004), ולבסוף DateTime של הקובץ (0x0132).
export function readExifCaptureDate(buffer) {
    try {
        const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
        if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return '';
        let offset = 2;
        while (offset + 4 <= view.byteLength) {
            if (view.getUint8(offset) !== 0xff) return '';
            const marker = view.getUint8(offset + 1);
            if (marker === 0xda || marker === 0xd9) return '';
            const length = view.getUint16(offset + 2);
            if (marker === 0xe1 && readAscii(view, offset + 4, 4) === 'Exif') {
                const tiffStart = offset + 10;
                const order = view.getUint16(tiffStart);
                const little = order === 0x4949;
                if (!little && order !== 0x4d4d) return '';
                const ifd0 = readIfdEntries(view, tiffStart, view.getUint32(tiffStart + 4, little), little);
                const exifPointer = ifd0.find(entry => entry.tag === 0x8769);
                const exif = exifPointer ? readIfdEntries(view, tiffStart, exifPointer.valueOffset, little) : [];
                for (const [entries, tag] of [[exif, 0x9003], [exif, 0x9004], [ifd0, 0x0132]]) {
                    const value = normalizeExifDate(readAsciiEntry(view, tiffStart, entries.find(entry => entry.tag === tag)));
                    if (value) return value;
                }
                return '';
            }
            offset += 2 + length;
        }
    } catch (error) {
        // EXIF פגום אינו סיבה להיכשל: פשוט אין תאריך.
    }
    return '';
}

// ה-EXIF נמצא בתחילת הקובץ; אין צורך לקרוא את כולו.
export async function readCaptureDateFromFile(file) {
    const type = String(file?.type || '').toLowerCase();
    if (!(file instanceof Blob) || !(type === 'image/jpeg' || type === 'image/jpg' || /\.jpe?g$/i.test(file.name || ''))) return '';
    try {
        return readExifCaptureDate(await file.slice(0, 256 * 1024).arrayBuffer());
    } catch (error) {
        return '';
    }
}

// --- הקידוד בדפדפן ---

// מחזיר { blob, compressed, width, height, captureDate, originalSize }.
// blob הוא הקובץ שיעלה: המקור, או הגרסה המוקטנת כשהיא באמת קטנה ממנו.
export async function prepareImageForUpload(file, {
    sendOriginal = false,
    maxEdge = COMPRESS_MAX_EDGE,
    quality = COMPRESS_QUALITY,
    minBytes = COMPRESS_MIN_BYTES
} = {}) {
    const captureDate = await readCaptureDateFromFile(file);
    const keep = extra => ({ blob: file, compressed: false, captureDate, originalSize: file.size, ...extra });
    if (!shouldCompressImage({ type: file.type, size: file.size, width: 1, height: 1 }, { sendOriginal, minBytes: 0 })) {
        return keep();
    }
    const mustReencode = !UPLOADABLE_IMAGE_TYPES.has(String(file.type || '').toLowerCase());
    let decoded = null;
    try {
        const generator = await import('./media-variants-generate.js');
        decoded = await generator.decodeImageBlob(file);
        if (!shouldCompressImage({ type: file.type, size: file.size, width: decoded.width, height: decoded.height }, { sendOriginal, maxEdge, minBytes })) {
            return keep({ width: decoded.width, height: decoded.height });
        }
        const target = computeTargetDimensions(decoded.width, decoded.height, maxEdge);
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext('2d');
        if (!context) return keep({ width: decoded.width, height: decoded.height });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const type = chooseOutputType(file.type, await generator.canEncodeWebp());
        if (type === 'image/jpeg') {
            // JPEG אינו יודע שקיפות: רקע לבן במקום שחור לפיקסלים שקופים.
            context.fillStyle = 'white';
            context.fillRect(0, 0, target.width, target.height);
        }
        context.drawImage(decoded.source, 0, 0, target.width, target.height);
        let blob;
        try {
            blob = await generator.canvasToBlob(canvas, type, quality);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
        // קידוד שלא הקטין (תמונה דחוסה היטב שלא הוקטנה) — המקור עדיף.
        if (!blob || !blob.size || (!mustReencode && !target.scaled && blob.size >= file.size)) {
            return keep({ width: decoded.width, height: decoded.height });
        }
        return {
            blob,
            compressed: true,
            width: target.width,
            height: target.height,
            captureDate,
            originalSize: file.size
        };
    } catch (error) {
        console.warn('הקטנת התמונה נכשלה; המקור יועלה כמות שהוא:', error);
        return keep();
    } finally {
        decoded?.release?.();
    }
}
