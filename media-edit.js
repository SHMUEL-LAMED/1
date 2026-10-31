// media-edit.js — סיבוב וחיתוך לא הורסים של תמונה: ההיגיון הטהור, בלי DOM
// (נבדק ב-Node).
//
// הקובץ המקורי ב-R2 לעולם אינו משתנה. ברשומת התמונה נשמר רק תיאור העריכה:
//   edit: { rotate: 0|90|180|270, crop: { x, y, w, h } | null, rev }
// הסיבוב (בכיוון השעון) קודם, והחיתוך מנורמל (0..1) ביחס לתמונה שאחרי הסיבוב —
// בדיוק מה שהמנהל רואה בעורך. rev הוא מזהה העריכה: התצוגות המקדימות שנוצרו
// ממנה נושאות `editRev` זהה (ה-Worker מוסיף אותו), ורק אז הן "אפויות" — כבר
// ערוכות. כשאינן (היצירה נכשלה, או טרם הסתיימה), הדפדפן מחיל את העריכה בעצמו
// על המקור, שתמיד אינו ערוך. ביטול עריכה יוצר את התצוגות מחדש מהמקור עם מזהה
// שמתחיל ב-"o", ורק אחר כך מוחק את edit.

export const EDIT_ROTATIONS = Object.freeze([0, 90, 180, 270]);
// חייב להתאים ל-MEDIA_EDIT_MIN_CROP ול-MEDIA_EDIT_REVISION_PATTERN שב-Worker.
export const MIN_CROP = 0.02;
const REVISION_PATTERN = /^[a-z0-9]{1,24}$/;
export const ORIGINAL_REVISION_PREFIX = 'o';

function isVideoRecord(record) {
    return record?.mediaType === 'video'
        || /^video\//i.test(String(record?.mimeType || ''))
        || /\.(?:mp4|webm|mov)(?:[?#].*)?$/i.test(String(record?.url || ''));
}

const round = value => Math.round(value * 1e6) / 1e6;

export function clampCrop(crop) {
    if (!crop || typeof crop !== 'object') return null;
    const values = ['x', 'y', 'w', 'h'].map(key => Number(crop[key]));
    if (values.some(value => !Number.isFinite(value))) return null;
    let [x, y, w, h] = values;
    w = Math.min(1, Math.max(MIN_CROP, w));
    h = Math.min(1, Math.max(MIN_CROP, h));
    x = Math.min(1 - w, Math.max(0, x));
    y = Math.min(1 - h, Math.max(0, y));
    const result = { x: round(x), y: round(y), w: round(w), h: round(h) };
    const full = result.x <= 1e-6 && result.y <= 1e-6 && result.w >= 1 - 1e-6 && result.h >= 1 - 1e-6;
    return full ? null : result;
}

// העריכה ברשומה, מנורמלת; null כשאין (או כשהיא פסולה — אז מציגים את המקור).
export function normalizeEdit(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rotate = EDIT_ROTATIONS.includes(value.rotate) ? value.rotate : (value.rotate === undefined ? 0 : null);
    if (rotate === null) return null;
    const crop = value.crop ? clampCrop(value.crop) : null;
    const rev = typeof value.rev === 'string' && REVISION_PATTERN.test(value.rev) ? value.rev : '';
    if (!rev || (rotate === 0 && !crop)) return null;
    return { rotate, crop, rev };
}

export function recordEdit(record) {
    return isVideoRecord(record) ? null : normalizeEdit(record?.edit);
}

export function isEditIdentity(edit) {
    return !edit || ((Number(edit.rotate) || 0) % 360 === 0 && !clampCrop(edit.crop));
}

export function newEditRevision(now = Date.now(), random = Math.random) {
    const stamp = Math.max(0, Math.trunc(Number(now) || 0)).toString(36);
    const noise = Math.trunc((Number(random()) || 0) * 36 ** 4).toString(36).padStart(4, '0');
    return `${stamp}${noise}`.slice(0, 20);
}

export function originalRevision(now = Date.now(), random = Math.random) {
    return `${ORIGINAL_REVISION_PREFIX}${newEditRevision(now, random)}`.slice(0, 24);
}

// סיבוב ברבע: step=1 בכיוון השעון, ‎-1 נגדו. החיתוך עובר יחד עם התמונה, כך
// שהאזור שנבחר נשאר אותו אזור בתמונה: נקודה (u, v) עוברת ל-(1 − v, u).
export function rotateEdit(edit, step) {
    const rotate = Number(edit?.rotate) || 0;
    const turns = ((Math.trunc(step) % 4) + 4) % 4;
    let crop = clampCrop(edit?.crop);
    for (let index = 0; index < turns; index += 1) {
        if (crop) crop = { x: round(1 - crop.y - crop.h), y: crop.x, w: crop.h, h: crop.w };
    }
    return { ...(edit || {}), rotate: (rotate + turns * 90) % 360, crop: crop ? clampCrop(crop) : null };
}

// הממדים אחרי סיבוב.
export function rotatedSize(width, height, rotate) {
    return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

// כל מה שצריך כדי לצייר את העריכה על Canvas: גודל הקנבס ומה לצייר בו.
// srcWidth/srcHeight — ממדי התמונה כפי שהיא מוצגת (אחרי כיוון ה-EXIF).
export function editTransform(srcWidth, srcHeight, edit, maxSide = Infinity) {
    const rotate = EDIT_ROTATIONS.includes(edit?.rotate) ? edit.rotate : 0;
    const rotated = rotatedSize(srcWidth, srcHeight, rotate);
    const crop = clampCrop(edit?.crop) || { x: 0, y: 0, w: 1, h: 1 };
    const cropX = crop.x * rotated.width;
    const cropY = crop.y * rotated.height;
    const cropWidth = Math.max(1, crop.w * rotated.width);
    const cropHeight = Math.max(1, crop.h * rotated.height);
    const limit = Number(maxSide) > 0 ? Number(maxSide) : Infinity;
    const scale = Math.min(1, limit / Math.max(cropWidth, cropHeight));
    return {
        width: Math.max(1, Math.round(cropWidth * scale)),
        height: Math.max(1, Math.round(cropHeight * scale)),
        scale,
        cropX,
        cropY,
        rotatedWidth: rotated.width,
        rotatedHeight: rotated.height,
        radians: (rotate * Math.PI) / 180,
        sourceWidth: srcWidth,
        sourceHeight: srcHeight
    };
}

// ציור על הקשר דו־ממדי (או כל אובייקט עם אותן פעולות): הזזה לאזור החיתוך,
// ואז סיבוב סביב מרכז התמונה המסובבת.
export function drawEdited(context, source, plan) {
    context.save();
    context.scale(plan.scale, plan.scale);
    context.translate(-plan.cropX, -plan.cropY);
    context.translate(plan.rotatedWidth / 2, plan.rotatedHeight / 2);
    context.rotate(plan.radians);
    context.drawImage(source, -plan.sourceWidth / 2, -plan.sourceHeight / 2, plan.sourceWidth, plan.sourceHeight);
    context.restore();
}

// האם התצוגות המקדימות של הרשומה כבר נוצרו מהעריכה הנוכחית.
export function variantsMatchEdit(record, names = ['thumb', 'medium']) {
    const edit = recordEdit(record);
    const entries = names.map(name => record?.variants?.[name]).filter(entry => entry && entry.url);
    if (!edit) return true;
    return entries.length > 0 && entries.every(entry => entry.editRev === edit.rev);
}

// מה מציגים לתמונה ערוכה: התצוגות כשהן אפויות, אחרת המקור ועליו העריכה.
//   { edit: null } — אין עריכה; מציגים כרגיל.
//   { edit, baked: true } — התצוגות ערוכות; אין לחזור למקור (הוא אינו ערוך).
//   { edit, baked: false } — יש להחיל את העריכה בדפדפן, על המקור.
export function editDisplay(record) {
    const edit = recordEdit(record);
    if (!edit) return { edit: null, baked: false };
    return { edit, baked: variantsMatchEdit(record) };
}

// הורדה: הגרסה הערוכה כברירת מחדל ל-JPEG; קבצים אחרים — המקור.
export function shouldDownloadEdited(record, mimeType, { original = false } = {}) {
    if (original || !recordEdit(record)) return false;
    return /^image\/jpe?g$/i.test(String(mimeType || '').split(';')[0].trim());
}
