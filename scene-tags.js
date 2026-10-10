// scene-tags.js — כיתובים ותיוג סצנה לתמונות: הטקסונומיה הקבועה ועזרים טהורים.
//
// כל תמונה מאושרת מקבלת מה־AI, באותה קריאה שנותנת לה שם (ראו
// generateImageDescription ב־cloudflare-worker.js), גם כיתוב קצר בעברית
// (`caption`, עד 140 תווים) ועד ארבע תגיות "סוג הרגע" (`sceneTags`). השדות
// נשמרים בתוך רשומת המדיה ב־D1, ולכן החיפוש הרגיל בגלריה מוצא אותם מיד, בלי
// שום קריאה ל־AI בזמן החיפוש.
//
// התגיות נשמרות כמזהים קבועים באנגלית (`dance`), והתווית העברית היא מה
// שמוצג, מה שהחיפוש מתאים ומה שהמודל מקבל ברשימה הסגורה. ה־Worker נפרס כקובץ
// יחיד, ולכן הרשימה מועתקת אליו (SCENE_TAGS שם); scene-tags.test.mjs נועל את
// ההתאמה בין שני העותקים. אין DOM בקובץ: הוא נבדק ב־Node.

// סדר הרשימה הוא סדר התצוגה בשבבי הסינון ובחלון העריכה. "אחר" תמיד אחרון,
// ומשמש רק כששום תגית אחרת אינה מתאימה.
export const SCENE_TAGS = Object.freeze([
    Object.freeze({ id: 'dance', label: 'ריקוד', hint: 'רוקדים, במעגל או בשורה' }),
    Object.freeze({ id: 'hakafot', label: 'הקפות', hint: 'הקפות סביב הבימה, בדרך כלל עם ספרי תורה' }),
    Object.freeze({ id: 'torah', label: 'ספר תורה', hint: 'ספר תורה נראה בתמונה: נשיאה, הוצאה, קריאה או הגבהה' }),
    Object.freeze({ id: 'lesson', label: 'שיעור או דרשה', hint: 'אדם מוסר שיעור או נואם מול קהל' }),
    Object.freeze({ id: 'study', label: 'לימוד', hint: 'לומדים מתוך ספרים, לבד או בחברותא' }),
    Object.freeze({ id: 'prayer', label: 'תפילה', hint: 'מתפללים בבית הכנסת או במניין' }),
    Object.freeze({ id: 'meal', label: 'סעודה', hint: 'שולחנות ערוכים, אוכל או כיבוד' }),
    Object.freeze({ id: 'music', label: 'נגינה', hint: 'כלי נגינה, תזמורת או שירה משותפת' }),
    Object.freeze({ id: 'group', label: 'תמונה קבוצתית', hint: 'קבוצה שמצטלמת יחד ופונה למצלמה' }),
    Object.freeze({ id: 'children', label: 'ילדים', hint: 'פעילות שבמרכזה ילדים' }),
    Object.freeze({ id: 'preparations', label: 'הכנות', hint: 'סידור המקום, קישוט או הכנות לפני האירוע' }),
    Object.freeze({ id: 'overview', label: 'מבט כללי', hint: 'האולם, המקום או הקהל כולו ממרחק' }),
    Object.freeze({ id: 'other', label: 'אחר', hint: 'רק כששום תגית אחרת אינה מתאימה' })
]);

export const SCENE_TAG_OTHER = 'other';
// עד ארבע תגיות לתמונה: מספיק לרגע מורכב (הקפות עם ספר תורה וריקוד), ולא
// כל כך הרבה שהסינון מאבד משמעות.
export const SCENE_TAG_MAX = 4;
export const CAPTION_MAX_LENGTH = 140;
// גרסת הכיתוב של ה־AI. העלאה שלה מחזירה לתור ההשלמה כל תמונה שהכיתוב שלה
// נוצר בגרסה קודמת (כיתוב שנערך ידנית לעולם אינו נדרס).
export const AI_CAPTION_VERSION = 1;

const TAG_BY_KEY = new Map();
for (const tag of SCENE_TAGS) {
    TAG_BY_KEY.set(tag.id, tag);
    TAG_BY_KEY.set(tag.label, tag);
}

export function sceneTagById(value) {
    return TAG_BY_KEY.get(String(value ?? '').trim()) || null;
}

export function sceneTagLabel(value) {
    return sceneTagById(value)?.label || '';
}

export function isSceneTagId(value) {
    return SCENE_TAGS.some(tag => tag.id === value);
}

// מזהים או תוויות → רשימת מזהים תקינה: בלי כפילויות, בלי מה שאינו
// בטקסונומיה, עד ארבע, ו"אחר" רק כשאין שום תגית אחרת. הסדר שנמסר נשמר — המודל
// מתבקש לפתוח בתגית הבולטת ביותר.
export function normalizeSceneTags(value) {
    const ids = [];
    for (const item of Array.isArray(value) ? value : []) {
        const tag = sceneTagById(item);
        if (tag && !ids.includes(tag.id)) ids.push(tag.id);
    }
    const specific = ids.filter(id => id !== SCENE_TAG_OTHER);
    return (specific.length ? specific : ids).slice(0, SCENE_TAG_MAX);
}

// תווי בקרה ותווי כיווניות מוסתרים (RLO וכדומה) אינם שייכים לכיתוב: הם
// היו יכולים להפוך את סדר הטקסט בתצוגה.
const CAPTION_STRIP_PATTERN = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g;

// כיתוב ארוך מהמגבלה נחתך בסוף המשפט האחרון שנכנס בה, ואם אין כזה — ברווח
// האחרון, עם שלוש נקודות. כך אף פעם לא נשארת מילה קטועה.
export function normalizeCaption(value) {
    const text = String(value ?? '').replace(CAPTION_STRIP_PATTERN, ' ').replace(/\s+/g, ' ').trim();
    if (text.length <= CAPTION_MAX_LENGTH) return text;
    let sentenceEnd = -1;
    for (const match of text.slice(0, CAPTION_MAX_LENGTH + 1).matchAll(/[.!?](?=\s)/g)) {
        if (match.index < CAPTION_MAX_LENGTH) sentenceEnd = match.index + 1;
    }
    if (sentenceEnd >= 40) return text.slice(0, sentenceEnd).trim();
    const space = text.lastIndexOf(' ', CAPTION_MAX_LENGTH - 1);
    const end = space >= 40 ? space : CAPTION_MAX_LENGTH - 1;
    return `${text.slice(0, end).trim()}…`;
}

// התגיות של רשומה, כפי שהן מוצגות: גם רשומה ישנה או פגומה מקבלת רשימה תקינה.
export function recordSceneTags(record) {
    return normalizeSceneTags(record?.sceneTags);
}

export function recordHasSceneTag(record, id) {
    return recordSceneTags(record).includes(id);
}

// הטקסט שהחיפוש הרגיל מתאים מעבר לשם: הכיתוב והתוויות העבריות של התגיות.
export function descriptionSearchText(record) {
    return [normalizeCaption(record?.caption), ...recordSceneTags(record).map(sceneTagLabel)]
        .filter(Boolean)
        .join(' ');
}

// כמה פריטים יש מכל תגית, בסדר הטקסונומיה, רק לתגיות שיש להן פריטים.
export function sceneTagCounts(records) {
    const counts = new Map();
    for (const record of records || []) {
        for (const id of recordSceneTags(record)) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return SCENE_TAGS.filter(tag => counts.has(tag.id)).map(tag => ({ id: tag.id, label: tag.label, count: counts.get(tag.id) }));
}

// תמונה מאושרת ששמורה ב־R2 של הגלריה — רק אותה ה־Worker יכול לשלוח למודל.
export function isAiDescribable(record) {
    return Boolean(record) && record.mediaType !== 'video' && String(record.r2Key || '').startsWith('approved/');
}

// האם ריצת ההשלמה צריכה לשלוח את התמונה: חסר לה שם AI, או שחסרים לה כיתוב
// ותגיות מהגרסה הנוכחית ואיש לא ערך אותם ידנית.
export function needsAiDescription(record) {
    if (!isAiDescribable(record)) return false;
    const needsTitle = record.aiTitleVersion !== 1;
    const needsCaption = record.aiCaptionVersion !== AI_CAPTION_VERSION && record.captionSource !== 'manual';
    return needsTitle || needsCaption;
}

export function hasDescription(record) {
    return Boolean(normalizeCaption(record?.caption)) || recordSceneTags(record).length > 0;
}
