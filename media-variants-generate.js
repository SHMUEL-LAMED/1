// media-variants-generate.js — יצירת תצוגות מקדימות בדפדפן.
//
// אין כאן שירות תמונות בתשלום: הדפדפן עצמו מקטין את התמונה ב-Canvas ומקודד
// WebP (ובדפדפן שאינו יודע לקודד WebP — JPEG). לסרטון נשלף פריים אחד בסביבות
// השנייה הראשונה, או הפריים הראשון שניתן לפענח, והוא הופך לפוסטר ולתצוגה
// קטנה. שום תצוגה אינה גדולה מהמקור: קובץ קטן נשאר בגודלו ורק מקודד מחדש.
// דפדפן שיודע לקודד AVIF ב-Canvas מוסיף לכל תצוגה גם עותק AVIF, אבל רק אם
// הוא באמת קטן מה-WebP/JPEG; אחרת אין בו טעם והוא אינו נשלח.
//
// המודול נטען עצלה: בהעלאה (uploadMediaToR2 שב-app.js) ובריצת ההשלמה של
// לוח הניהול. כישלון בו לעולם אינו עוצר העלאה — הקובץ עולה בלי תצוגות
// והריצה הבאה משלימה אותן.

import {
    MEDIA_VARIANT_SPECS,
    MEDIA_VARIANT_MAX_BYTES,
    IMAGE_VARIANT_NAMES,
    VIDEO_VARIANT_NAMES
} from './media-variants.js';

// הפריים שנשלף מסרטון: בשנייה הראשונה (או באמצע סרטון קצר מזה).
const VIDEO_FRAME_TIME_SECONDS = 1;
const VIDEO_LOAD_TIMEOUT_MS = 20000;
const VIDEO_SEEK_TIMEOUT_MS = 8000;

let webpSupportPromise = null;
let avifSupportPromise = null;

// Safari ישן מחזיר PNG כשמבקשים ממנו WebP; הבדיקה נעשית פעם אחת לכל דף.
export function canEncodeWebp() {
    if (!webpSupportPromise) {
        webpSupportPromise = new Promise(resolve => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 2;
                canvas.height = 2;
                canvas.toBlob(blob => resolve(Boolean(blob && blob.type === 'image/webp')), 'image/webp', 0.8);
            } catch {
                resolve(false);
            }
        });
    }
    return webpSupportPromise;
}

// רוב הדפדפנים מפענחים AVIF אך אינם יודעים לקודד אותו ב-Canvas: הם מחזירים
// PNG במקום. לכן AVIF הוא תוספת אופציונלית בלבד, שנבדקת פעם אחת לכל דף.
export function canEncodeAvif() {
    if (!avifSupportPromise) {
        avifSupportPromise = new Promise(resolve => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 2;
                canvas.height = 2;
                canvas.toBlob(blob => resolve(Boolean(blob && blob.type === 'image/avif')), 'image/avif', 0.6);
            } catch {
                resolve(false);
            }
        });
    }
    return avifSupportPromise;
}

// עותק AVIF לתצוגה שכבר קודדה, או null כשאינו נתמך, נכשל או אינו קטן יותר.
async function encodeAvifCopy(canvas, quality, primaryBlob) {
    if (!(await canEncodeAvif())) return null;
    try {
        const blob = await canvasToBlob(canvas, 'image/avif', Math.max(0.4, quality - 0.25));
        if (blob.type !== 'image/avif' || blob.size <= 0) return null;
        if (blob.size >= primaryBlob.size || blob.size > MEDIA_VARIANT_MAX_BYTES) return null;
        return { blob, type: 'image/avif', extension: 'avif' };
    } catch (error) {
        console.warn('קידוד AVIF נכשל; התצוגה תישמר בלעדיו:', error);
        return null;
    }
}

// לעולם לא מגדילים: קובץ קטן מהגבול נשאר בממדיו.
export function fitWithin(width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(1, width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

export function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('קידוד התצוגה נכשל.'))), type, quality);
        } catch (error) {
            reject(error);
        }
    });
}

async function encodeCanvas(canvas, quality) {
    const webp = await canEncodeWebp();
    const type = webp ? 'image/webp' : 'image/jpeg';
    let blob = await canvasToBlob(canvas, type, quality);
    // תצוגה שחורגת מהמכסה של ה-Worker מקודדת שוב באיכות נמוכה יותר; אם גם
    // זה לא מספיק — מוותרים עליה, והפריט נשאר עם המקור בלבד.
    if (blob.size > MEDIA_VARIANT_MAX_BYTES) blob = await canvasToBlob(canvas, type, Math.max(0.5, quality - 0.2));
    if (blob.size > MEDIA_VARIANT_MAX_BYTES) throw new Error('התצוגה גדולה מהמכסה המותרת.');
    return { blob, type, extension: webp ? 'webp' : 'jpg' };
}

function drawScaled(source, sourceWidth, sourceHeight, maxSide) {
    const { width, height } = fitWithin(sourceWidth, sourceHeight, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('הדפדפן אינו תומך ב-Canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return canvas;
}

// פענוח תמונה תוך שמירת הכיוון שב-EXIF. createImageBitmap מהיר ואינו חוסם
// את המסך; דפדפן שאינו מכיר את imageOrientation נופל ל-<img>, שממילא
// מיישם את הכיוון בעצמו.
export async function decodeImageBlob(blob) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
        } catch (error) {
            console.warn('createImageBitmap נכשל, עובר לפענוח דרך <img>:', error);
        }
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.decoding = 'async';
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('לא ניתן לפענח את התמונה.'));
            element.src = objectUrl;
        });
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            release: () => URL.revokeObjectURL(objectUrl)
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

async function variantsFromSource(source, width, height, names) {
    const parts = {};
    for (const name of names) {
        const spec = MEDIA_VARIANT_SPECS[name];
        if (!spec) continue;
        const canvas = drawScaled(source, width, height, spec.maxSide);
        try {
            const encoded = await encodeCanvas(canvas, spec.quality);
            const avif = await encodeAvifCopy(canvas, spec.quality, encoded.blob);
            parts[name] = { ...encoded, width: canvas.width, height: canvas.height, ...(avif ? { avif } : {}) };
        } catch (error) {
            console.warn(`תצוגת ${name} לא נוצרה:`, error);
        } finally {
            // משחרר את זיכרון הקנבס מיד, ולא כשאוסף הזבל יגיע אליו.
            canvas.width = 0;
            canvas.height = 0;
        }
    }
    return parts;
}

export async function generateImageVariants(blob, names = IMAGE_VARIANT_NAMES) {
    const decoded = await decodeImageBlob(blob);
    try {
        if (!decoded.width || !decoded.height) throw new Error('לתמונה אין ממדים.');
        return await variantsFromSource(decoded.source, decoded.width, decoded.height, names);
    } finally {
        decoded.release();
    }
}

// טוען פריים אחד מסרטון. source הוא Blob (בהעלאה) או כתובת https (בריצת
// ההשלמה — הדפדפן מושך אז רק את הטווח שנחוץ לפריים במקום את כל הקובץ).
function loadVideoFrame(source) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : '';
        let settled = false;
        let timer = 0;

        const release = () => {
            window.clearTimeout(timer);
            video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
            video.removeAttribute('src');
            try { video.load(); } catch { /* ניקוי בלבד */ }
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        const fail = message => {
            if (settled) return;
            settled = true;
            release();
            reject(new Error(message));
        };
        const finish = () => {
            if (settled) return;
            if (!video.videoWidth || !video.videoHeight) {
                fail('לא ניתן לפענח את הסרטון.');
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            resolve({ video, width: video.videoWidth, height: video.videoHeight, release });
        };
        // הפריים הראשון שנטען: הגיבוי כשהקפיצה לשנייה הראשונה אינה אפשרית.
        const useFirstFrame = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fail('הסרטון לא נטען בזמן.'), VIDEO_SEEK_TIMEOUT_MS);
            video.onseeked = null;
            if (video.readyState >= 2) {
                finish();
                return;
            }
            video.onloadeddata = finish;
        };

        timer = window.setTimeout(() => fail('הסרטון לא נטען בזמן.'), VIDEO_LOAD_TIMEOUT_MS);
        video.onerror = () => fail('לא ניתן לפענח את הסרטון.');
        video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            // קובץ בלי משך ידוע (למשל הקלטה מהדפדפן) אינו ניתן לקפיצה אמינה.
            if (duration <= 0) {
                useFirstFrame();
                return;
            }
            const target = Math.min(VIDEO_FRAME_TIME_SECONDS, duration / 2);
            timer = window.setTimeout(useFirstFrame, VIDEO_SEEK_TIMEOUT_MS);
            video.onseeked = () => {
                window.clearTimeout(timer);
                if (video.readyState >= 2) finish();
                else {
                    timer = window.setTimeout(useFirstFrame, VIDEO_SEEK_TIMEOUT_MS);
                    video.onloadeddata = finish;
                }
            };
            try {
                video.currentTime = target;
            } catch {
                useFirstFrame();
            }
        };

        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        // כתובת חוצת-מקור: בלי crossOrigin הקנבס "נצבע" ואי אפשר לקודד ממנו.
        if (!objectUrl) video.crossOrigin = 'anonymous';
        video.src = objectUrl || String(source);
        try { video.load(); } catch { /* דפדפנים ישנים */ }
    });
}

export async function generateVideoVariants(source, names = VIDEO_VARIANT_NAMES) {
    const frame = await loadVideoFrame(source);
    try {
        return await variantsFromSource(frame.video, frame.width, frame.height, names);
    } finally {
        frame.release();
    }
}

// נקודת הכניסה: Blob או כתובת, תמונה או סרטון. מחזירה { parts, isVideo }
// כש-parts הוא מפה של שם תצוגה → { blob, type, extension, width, height }.
export async function generateMediaVariants(source, options = {}) {
    const isVideo = typeof options.isVideo === 'boolean'
        ? options.isVideo
        : source instanceof Blob && String(source.type || '').startsWith('video/');
    const parts = isVideo ? await generateVideoVariants(source) : await generateImageVariants(source);
    return { parts, isVideo };
}

// מצרף את התצוגות לטופס ההעלאה בשמות שה-Worker מצפה להם:
// variant_thumb / variant_medium / variant_poster, עותק ה-AVIF של כל אחת
// כ-variant_<שם>_avif, ו-variantsMeta עם הממדים.
export function appendVariantParts(form, generated) {
    const meta = {};
    let count = 0;
    for (const [name, part] of Object.entries(generated?.parts || {})) {
        if (!(part?.blob instanceof Blob)) continue;
        form.append(`variant_${name}`, part.blob, `${name}.${part.extension}`);
        if (part.avif?.blob instanceof Blob) form.append(`variant_${name}_avif`, part.avif.blob, `${name}.avif`);
        meta[name] = { width: part.width, height: part.height };
        count += 1;
    }
    if (count) form.append('variantsMeta', JSON.stringify(meta));
    return count;
}
