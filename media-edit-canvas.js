// media-edit-canvas.js — החלת סיבוב וחיתוך של תמונה ב-Canvas, בדפדפן.
//
// משמש שלושה מקומות: הורדה של תמונה ערוכה (JPEG מקודד מחדש באיכות גבוהה),
// יצירת התצוגות המקדימות הערוכות אחרי שמנהל שמר עריכה (media-edit-ui.js), ותצוגה
// של תמונה ערוכה שהתצוגות שלה עוד לא נוצרו מחדש — אז הגלריה מציירת את העריכה
// על המקור (editedObjectUrl). ההיגיון והחשבון ב-media-edit.js (בלי DOM).
//
// הפענוח עובר דרך decodeImageBlob של media-variants-generate.js, שמיישם את
// הכיוון שב-EXIF — אותה תמונה שהמנהל ראה כשערך. קידוד ב-Canvas אינו כותב EXIF,
// ולכן גם אין בו מיקום (GPS).
import { drawEdited, editTransform, normalizeEdit } from './media-edit.js';

let generateModule = null;
function variantsGenerator() {
    generateModule ||= import('./media-variants-generate.js').catch(error => {
        generateModule = null;
        throw error;
    });
    return generateModule;
}

// הורדת התמונה מה-Worker. תמונה מאושרת ציבורית; אסימון נשלח כשיש, כמו בהורדה.
export async function fetchImageBlob(url, { signal } = {}) {
    const safeUrl = window.safeImageUrl?.(url) || '';
    if (!safeUrl) throw new Error('כתובת התמונה אינה תקינה.');
    const headers = new Headers();
    if (safeUrl.startsWith(window.R2_WORKER_BASE_URL || '\u0000') && safeUrl.includes('/media/pending/')) {
        try {
            const token = await window.getFirebaseIdToken?.();
            if (token) headers.set('Authorization', `Bearer ${token}`);
        } catch {
            // בלי אסימון — ננסה בכל זאת.
        }
    }
    const response = await fetch(safeUrl, { headers, mode: 'cors', signal });
    if (!response.ok) throw new Error(`הורדת התמונה נכשלה (${response.status}).`);
    return response.blob();
}

// קנבס עם העריכה, מתמונה שכבר פוענחה. maxSide מגביל את הצלע הארוכה.
export function drawEditedCanvas(decoded, edit, maxSide = Infinity) {
    const plan = editTransform(decoded.width, decoded.height, edit, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('הדפדפן אינו תומך ב-Canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    drawEdited(context, decoded.source, plan);
    return canvas;
}

// Blob חדש של התמונה אחרי העריכה. type ו-quality של הקידוד; JPEG כברירת מחדל.
export async function renderEditedBlob(blob, editValue, { maxSide = Infinity, type = 'image/jpeg', quality = 0.92 } = {}) {
    const edit = normalizeEdit(editValue);
    if (!edit) return blob;
    const { decodeImageBlob, canvasToBlob } = await variantsGenerator();
    const decoded = await decodeImageBlob(blob);
    try {
        if (!decoded.width || !decoded.height) throw new Error('לתמונה אין ממדים.');
        const canvas = drawEditedCanvas(decoded, edit, maxSide);
        try {
            return await canvasToBlob(canvas, type, quality);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    } finally {
        decoded.release?.();
    }
}

// התצוגה של תמונה ערוכה שהתצוגות שלה עוד אינן ערוכות: המקור עם העריכה, ככתובת
// blob: שנשמרת לפי הכתובת ומזהה העריכה. מעט רשומות אחרונות בלבד, כדי שהזיכרון
// לא יגדל בגלילה ארוכה.
const EDITED_URL_LIMIT = 24;
const editedUrls = new Map();

export function editedObjectUrl(url, editValue, { maxSide = 2048 } = {}) {
    const edit = normalizeEdit(editValue);
    if (!edit || !url) return Promise.resolve('');
    const key = `${url}\n${edit.rev}\n${maxSide}`;
    if (editedUrls.has(key)) {
        const entry = editedUrls.get(key);
        editedUrls.delete(key);
        editedUrls.set(key, entry);
        return entry;
    }
    const entry = fetchImageBlob(url)
        .then(blob => renderEditedBlob(blob, edit, { maxSide, type: 'image/jpeg', quality: 0.9 }))
        .then(blob => URL.createObjectURL(blob));
    entry.catch(() => editedUrls.delete(key));
    editedUrls.set(key, entry);
    while (editedUrls.size > EDITED_URL_LIMIT) {
        const [oldestKey, oldest] = editedUrls.entries().next().value;
        editedUrls.delete(oldestKey);
        oldest.then(objectUrl => URL.revokeObjectURL(objectUrl), () => {});
    }
    return entry;
}

// תמונה ב-DOM (כרטיס או תצוגה מלאה) שמציגה את המקור של תמונה ערוכה: מקבלת את
// הגרסה הערוכה ברגע שהיא מוכנה. מסומנת כדי שלא תעובד פעמיים.
export async function applyEditToImage(image, url, editValue, { maxSide = 2048 } = {}) {
    const edit = normalizeEdit(editValue);
    if (!image || !edit) return false;
    const marker = `${edit.rev}`;
    if (image.dataset.mediaEditApplied === marker) return true;
    image.dataset.mediaEditApplied = marker;
    try {
        const objectUrl = await editedObjectUrl(url, edit, { maxSide });
        if (!objectUrl || image.dataset.mediaEditApplied !== marker) return false;
        image.closest('picture')?.querySelector('source')?.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.srcset = `${objectUrl} 1x`;
        image.src = objectUrl;
        return true;
    } catch (error) {
        console.warn('Media edit preview failed:', error);
        delete image.dataset.mediaEditApplied;
        return false;
    }
}
