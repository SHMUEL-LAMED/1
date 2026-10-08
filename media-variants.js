// media-variants.js — תצוגות מקדימות למדיה: ההיגיון הטהור, בלי DOM.
//
// לכל פריט מדיה נשמרות לצד המקור גרסאות מוקטנות ("תצוגות") שנוצרות בדפדפן:
// לתמונה — thumb (צלע ארוכה 480px) ו-medium (1280px); לסרטון — poster (פריים
// מתוך הסרטון, 1280px) ו-thumb מאותו פריים. הן נשמרות ב-R2 תחת
// variants/<imageId>/<שם>.<webp|jpg>, והרשומה מקבלת שדה `variants`.
// דפדפן שיודע לקודד AVIF מוסיף לכל תצוגה גם עותק AVIF (קטן יותר), שנשמר
// ב-variants/<imageId>/<שם>.avif ונרשם בתוך התצוגה כ-`avif: { key, url }`.
// הגלריה מציעה אותו ב-<picture> עם <source type="image/avif">, כך שדפדפן
// שאינו מפענח AVIF מקבל את ה-WebP/JPEG כרגיל.
// המקור נשמר תמיד: הורדה וזום משתמשים בו, והתצוגות רק מאיצות את הגלריה.
//
// הקובץ הזה מחזיק רק את מה שאפשר לבדוק ב-Node: בחירת המקור להצגה ובחירת
// הפריטים שעדיין חסרות להם תצוגות. יצירת התצוגות עצמה (Canvas) נמצאת
// ב-media-variants-generate.js, וריצת ההשלמה מלוח הניהול ב-media-variants-admin.js.

export const MEDIA_VARIANTS_VERSION = 1;
// חייב להיות זהה ל-MAX_VARIANT_BYTES שב-Worker.
export const MEDIA_VARIANT_MAX_BYTES = 2 * 1024 * 1024;
export const MEDIA_VARIANT_SPECS = Object.freeze({
    thumb: Object.freeze({ maxSide: 480, quality: 0.8 }),
    medium: Object.freeze({ maxSide: 1280, quality: 0.85 }),
    poster: Object.freeze({ maxSide: 1280, quality: 0.85 })
});
// רוחב הכרטיס בגלריה, בקירוב לעמודות של #photosGrid (styles.css): בטלפון
// שתי עמודות, ובמסך רחב עמודות של 250px ומעלה. בצפיפות פיקסלים כפולה
// מסך רחב מקבל את medium, ומסך רגיל וטלפון את thumb.
export const CARD_IMAGE_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 360px';
export const IMAGE_VARIANT_NAMES = Object.freeze(['thumb', 'medium']);
export const VIDEO_VARIANT_NAMES = Object.freeze(['poster', 'thumb']);

// ברירת המחדל לניקוי כתובות: רק https. גלריה שמכירה גם כתובות Drive או
// תצוגות blob: מעבירה את safeImageUrl שלה במקום.
function secureUrl(value) {
    const url = String(value ?? '').trim();
    return /^https:\/\//i.test(url) ? url : '';
}

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

// זהה ל-isVideoRecord שב-app.js; משוכפל כאן כדי שהמודול יישאר בלי תלות ב-window.
export function isVideoLikeRecord(record) {
    return record?.mediaType === 'video'
        || /^video\/(?:mp4|webm)$/i.test(String(record?.mimeType || ''))
        || /\.(?:mp4|webm)(?:[?#].*)?$/i.test(String(record?.url || record?.title || ''));
}

// רשומת תצוגה אחת מתוך record.variants, רק אם יש לה כתובת מאובטחת.
export function variantEntry(record, name) {
    const entry = record?.variants?.[name];
    const url = secureUrl(entry?.url);
    if (!url) return null;
    const avifUrl = secureUrl(entry?.avif?.url);
    return {
        url,
        key: String(entry.key || ''),
        type: String(entry.type || ''),
        width: Math.max(0, Math.trunc(Number(entry.width)) || 0),
        height: Math.max(0, Math.trunc(Number(entry.height)) || 0),
        avifUrl
    };
}

// srcset לפי רוחב מתוך כמה תצוגות; format='avif' בונה את אותה רשימה מעותקי
// ה-AVIF, ורק אם לכל התצוגות שברשימה יש עותק כזה — אחרת דפדפן שתומך ב-AVIF
// היה מקבל רשימה חלקית ובוחר תצוגה קטנה מדי.
function widthSrcset(entries, format = '') {
    const usable = entries.filter(entry => entry && entry.width > 0);
    if (!usable.length) return '';
    if (format === 'avif') {
        if (!usable.every(entry => entry.avifUrl)) return '';
        return usable.map(entry => `${entry.avifUrl} ${entry.width}w`).join(', ');
    }
    return usable.map(entry => `${entry.url} ${entry.width}w`).join(', ');
}

export function requiredVariantNames(record) {
    return isVideoLikeRecord(record) ? ['poster'] : ['thumb', 'medium'];
}

// האם הפריט עדיין זקוק לריצת ההשלמה. זה מה שהופך אותה לאידמפוטנטית: פריט
// שכבר קיבל את התצוגות הנדרשות לסוגו נידלג בריצה הבאה.
export function needsMediaVariants(record) {
    if (!record || typeof record !== 'object') return false;
    if (!record.variants || typeof record.variants !== 'object') return true;
    if (Number(record.variantsVersion) !== MEDIA_VARIANTS_VERSION) return true;
    return requiredVariantNames(record).some(name => !variantEntry(record, name));
}

// כרטיס בגלריה: תמונה — thumb, ואם אין medium, ואם אין המקור. כשיש גם
// thumb וגם medium הכרטיס מקבל srcset של שתיהן עם sizes לפי רוחב העמודה,
// כך שמסך צפוף פיקסלים או עמודה רחבה מקבלים את הבינונית במקום להימתח.
// סרטון — thumb או poster כתמונת הפוסטר, ואם אין התמונה המקדימה הישנה.
export function pickCardSource(record, sanitize = secureUrl) {
    const original = sanitize(record?.url);
    if (isVideoLikeRecord(record)) {
        const entry = variantEntry(record, 'thumb') || variantEntry(record, 'poster');
        return { url: entry?.url || sanitize(record?.thumbnailUrl), srcset: '', avifSrcset: '', sizes: '', original, fallbackUrl: '', isVariant: Boolean(entry) };
    }
    const thumb = variantEntry(record, 'thumb');
    const medium = variantEntry(record, 'medium');
    const entry = thumb || medium;
    const url = entry?.url || original;
    const entries = [thumb, medium].filter(Boolean);
    const srcset = entries.length > 1 ? widthSrcset(entries) : '';
    const avifSrcset = entries.length > 1 ? widthSrcset(entries, 'avif') : (entry?.avifUrl || '');
    return {
        url,
        srcset,
        avifSrcset,
        sizes: srcset ? CARD_IMAGE_SIZES : '',
        original,
        fallbackUrl: entry && original && original !== url ? original : '',
        isVariant: Boolean(entry)
    };
}

// התצוגה המלאה: medium עם srcset של thumb ו-medium, כך שהדפדפן בוחר לפי
// רוחב המסך וצפיפות הפיקסלים. הורדה וזום נשארים על המקור (original).
export function pickLightboxSource(record, sanitize = secureUrl) {
    const original = sanitize(record?.url);
    const medium = isVideoLikeRecord(record) ? null : variantEntry(record, 'medium');
    if (!medium) return { url: original, srcset: '', avifSrcset: '', sizes: '', original, fallbackUrl: '' };
    const thumb = variantEntry(record, 'thumb');
    const srcset = widthSrcset([thumb, medium]);
    const avifSrcset = srcset ? widthSrcset([thumb, medium], 'avif') : (medium.avifUrl || '');
    return {
        url: medium.url,
        srcset,
        avifSrcset,
        sizes: srcset ? '100vw' : '',
        original,
        fallbackUrl: original && original !== medium.url ? original : ''
    };
}

// פוסטר לסרטון: בתצוגה המלאה poster, ובכרטיס (small) קודם thumb.
export function pickPosterSource(record, sanitize = secureUrl, { small = false } = {}) {
    if (!isVideoLikeRecord(record)) return '';
    const order = small ? ['thumb', 'poster'] : ['poster', 'thumb'];
    for (const name of order) {
        const entry = variantEntry(record, name);
        if (entry) return entry.url;
    }
    return sanitize(record?.thumbnailUrl);
}

// ההשתקפות המטושטשת ברקע התצוגה המלאה: מספיקה התצוגה הקטנה ביותר שקיימת.
export function pickBackdropSource(record, sanitize = secureUrl) {
    for (const name of ['thumb', 'poster', 'medium']) {
        const entry = variantEntry(record, name);
        if (entry) return entry.url;
    }
    return isVideoLikeRecord(record) ? sanitize(record?.thumbnailUrl) : sanitize(record?.url);
}

// הפריטים שריצת ההשלמה תעבד: בלי כפילויות, רק מי שיש לו מקור חוקי ועדיין
// חסרות לו תצוגות. isSupported מאפשר לסנן מקורות שאי אפשר לעבד (למשל קישור
// חיצוני בלי CORS); הם נספרים בנפרד ואינם נכנסים לריצה.
export function selectVariantCandidates(records, { sanitize = secureUrl, isSupported = () => true } = {}) {
    const candidates = [];
    const unsupported = [];
    const seen = new Set();
    for (const record of Array.isArray(records) ? records : []) {
        const imageId = safeId(record?.id);
        const url = sanitize(record?.url);
        if (!imageId || !url || seen.has(imageId)) continue;
        seen.add(imageId);
        if (!needsMediaVariants(record)) continue;
        const candidate = { imageId, url, isVideo: isVideoLikeRecord(record), title: String(record?.title || '') };
        (isSupported(candidate) ? candidates : unsupported).push(candidate);
    }
    return { candidates, unsupported };
}

// הלולאה של ריצת ההשלמה: מספר מסלולים מקבילים מוגבל, עצירה בין פריטים,
// וכישלון של פריט אחד אינו עוצר את השאר. processItem מקבל מועמד ומחזיר
// Promise; מה שהוא עושה (הורדה, יצירה, שליחה) אינו מעניין את הלולאה.
export async function runVariantBackfill(candidates, processItem, options = {}) {
    const list = Array.isArray(candidates) ? candidates : [];
    const concurrency = Math.max(1, Math.trunc(Number(options.concurrency)) || 1);
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const summary = { total: list.length, processed: 0, succeeded: 0, failed: 0, remaining: list.length, stopped: false, failures: [] };
    let cursor = 0;

    const lane = async () => {
        while (cursor < list.length) {
            if (shouldStop()) {
                summary.stopped = true;
                return;
            }
            const candidate = list[cursor];
            cursor += 1;
            try {
                await processItem(candidate);
                summary.succeeded += 1;
            } catch (error) {
                summary.failed += 1;
                summary.failures.push({ imageId: candidate.imageId, title: candidate.title || '', message: String(error?.message || error || 'שגיאה לא ידועה') });
            }
            summary.processed += 1;
            summary.remaining = list.length - summary.processed;
            onProgress({ ...summary, candidate });
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, lane));
    return summary;
}
