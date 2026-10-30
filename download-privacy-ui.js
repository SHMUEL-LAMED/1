// download-privacy-ui.js — הכנת קובץ להורדה מהגלריה: בלי מיקום, ועם סימן מים
// כשמנהל־העל הפעיל אותו. נטען עצלה בהורדה הראשונה (downloadGalleryMedia
// ו-downloadSelectedMedia שב-gallery.js), ולכן אינו מאט את פתיחת האתר.
//
// ההחלטות והעבודה על הבתים ב-download-privacy.js (בלי DOM, נבדק ב-Node). כאן
// רק מה שדורש דפדפן: קריאת ההגדרה מהמסמך systemMeta/downloadPrivacy, פענוח
// התמונה וציור סימן המים ב-Canvas.
//
// כישלון כאן לעולם אינו עוצר הורדה: הגדרה שלא נטענה היא "בלי סימן מים", וסימן
// מים שלא צויר (תמונה ענקית מדי ל-Canvas, פורמט שהדפדפן אינו מפענח) נופל
// לקובץ בלי המיקום. הסרת המיקום עצמה אינה תלויה בהגדרה ותמיד רצה.

import {
    DOWNLOAD_SETTINGS_DOC_ID, normalizeDownloadSettings, normalizeMimeType, isJpegBytes,
    stripJpegMetadata, shouldWatermark, watermarkOutputType, watermarkLayout, watermarkTextFor
} from './download-privacy.js';

// ההגדרה נקראת פעם אחת לכמה דקות, ולא לכל קובץ ב-ZIP.
const SETTINGS_TTL_MS = 5 * 60 * 1000;
let settingsCache = null;

export function loadDownloadSettings({ refresh = false } = {}) {
    if (!refresh && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.promise;
    const promise = (async () => {
        const { doc, getDoc } = window.firestoreModules || {};
        if (!window.db || !doc || !getDoc) return normalizeDownloadSettings(null);
        try {
            const snap = await getDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', DOWNLOAD_SETTINGS_DOC_ID));
            return normalizeDownloadSettings(snap.exists() ? snap.data() : null);
        } catch (error) {
            console.warn('Download settings load failed:', error);
            settingsCache = null; // ניסיון חוזר בהורדה הבאה
            return normalizeDownloadSettings(null);
        }
    })();
    settingsCache = { at: Date.now(), promise };
    return promise;
}

async function sniffJpeg(blob) {
    try {
        return isJpegBytes(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
    } catch {
        return false;
    }
}

// סימני מים מצוירים אחד אחרי השני: ב-ZIP שלושה פריטים יורדים במקביל, ושלוש
// תמונות של 48 מגה־פיקסל מפוענחות יחד היו מפילות דפדפן בטלפון.
let watermarkQueue = Promise.resolve();

function drawWatermark(context, width, height, text) {
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim() || 'sans-serif';
    const fontFor = size => `600 ${size}px ${fontFamily}`;
    const layout = watermarkLayout(width, height, size => {
        context.font = fontFor(size);
        return context.measureText(text).width;
    });
    context.save();
    context.font = fontFor(layout.fontSize);
    // הטקסט עברי ומצויר מימין לשמאל; העוגן הוא קצהו השמאלי, בפינה התחתונה.
    context.direction = 'rtl';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    // לבן שקוף עם צל עדין: נקרא על רקע בהיר וכהה, ואינו משתלט על התמונה.
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = Math.max(2, Math.round(layout.fontSize * 0.18));
    context.shadowOffsetY = Math.max(1, Math.round(layout.fontSize * 0.04));
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.fillText(text, layout.x, layout.y);
    context.restore();
}

async function watermarkBlob(blob, mimeType, text) {
    const output = watermarkOutputType(mimeType);
    if (!output) return null;
    const { decodeImageBlob, canvasToBlob } = await import('./media-variants-generate.js');
    // הפענוח מיישם את הכיוון שב-EXIF, ולכן התמונה שנוצרת עומדת נכון גם
    // בלי EXIF (קידוד ב-Canvas אינו כותב אותו, וגם לא את המיקום).
    const decoded = await decodeImageBlob(blob);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('הדפדפן אינו תומך ב-Canvas.');
        context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
        drawWatermark(context, decoded.width, decoded.height, text);
        const result = await canvasToBlob(canvas, output.type, output.quality);
        canvas.width = 0;
        canvas.height = 0;
        return result;
    } finally {
        decoded.release?.();
    }
}

function queuedWatermark(blob, mimeType, text) {
    const run = watermarkQueue.then(() => watermarkBlob(blob, mimeType, text));
    watermarkQueue = run.catch(() => {});
    return run;
}

// הקובץ שיורד בפועל. מחזיר Blob (אותו אחד כשאין מה לשנות).
export async function prepareDownloadBlob(blob, item = {}) {
    const mimeType = normalizeMimeType(blob?.type || item?.mimeType);
    if (!blob || mimeType.startsWith('video/')) return blob;
    const settings = await loadDownloadSettings();

    if (shouldWatermark(settings, { isAdmin: Boolean(window.state?.isAdminLoggedIn), mimeType })) {
        try {
            const marked = await queuedWatermark(blob, mimeType, watermarkTextFor(settings));
            if (marked) return marked;
        } catch (error) {
            console.warn('Watermark failed, downloading without it:', error);
        }
    }

    if (mimeType !== 'image/jpeg' && !(await sniffJpeg(blob))) return blob;
    const result = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()), {
        mode: settings.stripAllMetadata ? 'all' : 'gps'
    });
    return result.changed ? new Blob([result.bytes], { type: 'image/jpeg' }) : blob;
}
