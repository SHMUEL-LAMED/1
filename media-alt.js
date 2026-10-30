// media-alt.js — הטקסט החלופי (alt) של תמונה בכרטיס ובתצוגה המלאה, בלי DOM.
//
// קורא מסך מקריא את ה-alt במקום התמונה, ולכן הוא צריך לתאר אותה ולא את
// הקובץ: הכיתוב של ה-AI (או של המנהל) כשיש כזה — זה בדיוק "מה רואים בתמונה";
// בלעדיו השם שלה; ובלי שם — "תמונה שצולמה בי״ז בתשרי תשפ״ז", כדי שגם פריט
// בלי שום מידע לא יוקרא כ"תמונה ללא שם" אחד מתוך מאות זהים.
//
// הטקסט חוזר כפי שהוא, לא מוברח: gallery.js מבריח אותו (window.escapeHtml)
// כשהוא נכנס למרקאפ של הכרטיס, ובתצוגה המלאה הוא נכתב ל-img.alt ישירות.

import { normalizeCaption, CAPTION_MAX_LENGTH } from './scene-tags.js';
import { captureDateKey, hasCaptureDate } from './capture-date.js';
import { formatHebrewDate, hebrewDateFromDateKey } from './hebrew-date.js';

// אותה תקרה כמו הכיתוב עצמו: מספיקה למשפט תיאור שלם, וקורא מסך אינו נתקע
// על פסקה. שם קובץ ארוך נחתך לפי אותם כללים (סוף משפט או מילה, עם "…").
export const ALT_TEXT_MAX_LENGTH = CAPTION_MAX_LENGTH;

// "תמונה שצולמה בי״ז בתשרי תשפ״ז" — או "שהועלתה" כשתאריך הצילום אינו ידוע,
// כמו התאריך שבכרטיס. בלי שום תאריך — "תמונה ללא שם", כמו הכותרת שבכרטיס.
export function genericMediaLabel(record) {
    const isVideo = record?.mediaType === 'video';
    const hebrewText = formatHebrewDate(hebrewDateFromDateKey(captureDateKey(record)));
    if (!hebrewText) return isVideo ? 'סרטון ללא שם' : 'תמונה ללא שם';
    const captured = hasCaptureDate(record);
    const verb = isVideo ? (captured ? 'שצולם' : 'שהועלה') : (captured ? 'שצולמה' : 'שהועלתה');
    return `${isVideo ? 'סרטון' : 'תמונה'} ${verb} ב${hebrewText}`;
}

// כיתוב, אחרת שם, אחרת התווית הכללית עם התאריך העברי. normalizeCaption מסיר
// תווי בקרה ותווי כיווניות, מכווץ רווחים וחותך במקום טבעי — בדיוק מה שצריך
// גם לשם, שמגיע משם הקובץ.
export function mediaAltText(record) {
    return normalizeCaption(record?.caption) || normalizeCaption(record?.title) || genericMediaLabel(record);
}
