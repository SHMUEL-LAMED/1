// gallery-timeline.js — ציר הזמן העברי של הגלריה, בלי DOM: קיבוץ הפריטים
// שבתצוגה לחודשים עבריים לפי הסדר שבו הם מוצגים, עם הפריט הראשון של כל חודש
// (אליו קופצים), מתי הציר מוצג בכלל, איזה חודש פעיל לפי הכרטיס שבראש המסך,
// ולאן לגלול כדי שהכרטיס ייעצר מתחת לכותרת הצפה.
//
// מודול טהור, נבדק ב-Node (gallery-timeline.test.mjs). הציור, הגלילה והמקלדת
// ב-gallery-timeline-ui.js.
//
// החודש של פריט הוא אותו חודש שבתווית "תשרי תשפ״ז" שעל הכרטיס הראשון של כל
// חודש (placeDateGroupLabel ב-gallery.js) ובבורר החודש העברי: יום הצילום,
// ובלעדיו יום ההעלאה (captureDateKey), בלי תיקון שקיעה. אדר א׳, אדר ב׳ ואדר
// הם חודשים נפרדים, כמו בסינון.
import { captureDateKey } from './capture-date.js';
import { hebrewDateFromDateKey, formatHebrewYear, formatHebrewMonthYear } from './hebrew-date.js';

// הציר שימושי רק כשהסדר הוא סדר הזמן. במיון לפי שם או אקראי החודשים
// מתפזרים לאורך כל הרשת, ו"קפיצה לתשרי" לא הייתה מגיעה לשום מקום מוגדר.
export const TIMELINE_SORTS = Object.freeze(['newest', 'oldest']);
// חודש אחד אינו ציר: אין לאן לקפוץ.
export const TIMELINE_MIN_MONTHS = 2;

export function timelineMonthKey(hebrew) {
    return hebrew && hebrew.year && hebrew.monthKey ? `${hebrew.year}-${hebrew.monthKey}` : '';
}

function defaultIdOf(item) {
    return item && item.id !== undefined && item.id !== null ? String(item.id) : '';
}

// הפריטים בסדר שבו הם מוצגים → החודשים לפי סדר הופעתם, והשנים שמעליהם.
//   months      — { key, year, monthKey, monthName, label, firstId, firstIndex, count } לכל חודש.
//   years       — { year, label, months } לפי סדר ההופעה; months הם אותם אובייקטים.
//   monthIndexAt — לכל אינדקס ברשימה: אינדקס החודש שלו ב-months, או -1 לפריט בלי
//                  תאריך או בלי מזהה (אין לו כרטיס, ראו _doRenderImages).
// המיון לפי תאריך הוא לפי takenAt, והחודש נגזר מ-takenDate; בגבול של אזור זמן
// שני אלה עשויים לא להסכים, וחודש יופיע שוב אחרי שכן. חודש כזה אינו נפתח
// פעמיים: הוא נשאר במקומו הראשון, והקפיצה אליו מגיעה לפריט הראשון שלו.
export function buildHebrewTimeline(items, { idOf = defaultIdOf, dateKeyOf = captureDateKey } = {}) {
    const list = Array.isArray(items) ? items : [];
    const months = [];
    const years = [];
    const monthIndexByKey = new Map();
    const yearByValue = new Map();
    const monthIndexAt = new Array(list.length).fill(-1);
    list.forEach((item, index) => {
        const id = idOf(item);
        if (!id) return;
        const hebrew = hebrewDateFromDateKey(dateKeyOf(item));
        const key = timelineMonthKey(hebrew);
        if (!key) return;
        let monthIndex = monthIndexByKey.get(key);
        if (monthIndex === undefined) {
            const month = {
                key,
                year: hebrew.year,
                monthKey: hebrew.monthKey,
                monthName: hebrew.monthName,
                label: formatHebrewMonthYear(hebrew),
                firstId: id,
                firstIndex: index,
                count: 0
            };
            monthIndex = months.length;
            monthIndexByKey.set(key, monthIndex);
            months.push(month);
            let year = yearByValue.get(hebrew.year);
            if (!year) {
                year = { year: hebrew.year, label: formatHebrewYear(hebrew.year), months: [] };
                yearByValue.set(hebrew.year, year);
                years.push(year);
            }
            year.months.push(month);
        }
        months[monthIndex].count += 1;
        monthIndexAt[index] = monthIndex;
    });
    return { months, years, monthIndexAt };
}

export function timelineAvailable(sort, timeline) {
    return TIMELINE_SORTS.includes(sort) && (timeline?.months?.length || 0) >= TIMELINE_MIN_MONTHS;
}

// חתימה של מה שמצויר ברשימה: אותה חתימה — אין צורך לבנות אותה מחדש. גם
// המונה בכל חודש חלק ממנה, כי הוא בתווית הנגישה.
export function timelineSignature(timeline) {
    return (timeline?.months || []).map(month => `${month.key}:${month.count}:${month.firstId}`).join('|');
}

// השם שקורא המסך אומר לכפתור של חודש: "תשרי תשפ״ז, 12 פריטים".
export function timelineMonthLabel(month) {
    if (!month) return '';
    const count = Number(month.count) || 0;
    return `${month.label}, ${count === 1 ? 'פריט אחד' : `${count} פריטים`}`;
}

// האינדקס הראשון שהתחתית שלו מתחת לקו (bottomAt(i) > line), או count כשאין.
// הכרטיסים ברשת לפי סדר השורות, ולכן התחתיות עולות בסדר הרשימה, וחיפוש
// בינארי מוצא את הכרטיס שבראש המסך בלי למדוד אלפי כרטיסים בכל גלילה.
export function firstIndexBelowLine(count, bottomAt, line) {
    let low = 0;
    let high = Math.max(0, Number(count) || 0);
    while (low < high) {
        const middle = (low + high) >> 1;
        if (bottomAt(middle) > line) high = middle;
        else low = middle + 1;
    }
    return low;
}

// החודש הפעיל כשהכרטיס שבראש המסך הוא itemIndex. כרטיס בלי חודש (אין תאריך)
// לוקח את החודש של הקודם לו, ובראש הרשימה — של הבא אחריו.
export function activeMonthIndex(timeline, itemIndex) {
    const at = timeline?.monthIndexAt || [];
    if (!at.length) return -1;
    const start = Math.min(Math.max(0, Math.floor(Number(itemIndex) || 0)), at.length - 1);
    for (let index = start; index >= 0; index -= 1) {
        if (at[index] >= 0) return at[index];
    }
    for (let index = start + 1; index < at.length; index += 1) {
        if (at[index] >= 0) return at[index];
    }
    return -1;
}

// לאן לגלול כדי שראש הכרטיס ייעצר מתחת לכותרת הצפה ולסרגל הכלים הדבוק
// (obstruction, בפיקסלים מראש המסך), ועוד מרווח לתווית החודש שיושבת על
// הכרטיס הראשון שלו.
export const TIMELINE_JUMP_GAP = 24;

export function timelineScrollTop({ scrollY = 0, cardTop = 0, obstruction = 0, gap = TIMELINE_JUMP_GAP } = {}) {
    const target = (Number(scrollY) || 0) + (Number(cardTop) || 0) - (Number(obstruction) || 0) - (Number(gap) || 0);
    return Math.max(0, Math.round(target));
}
