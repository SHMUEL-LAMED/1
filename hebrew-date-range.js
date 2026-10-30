// hebrew-date-range.js — "טווח תאריכים" בגלריה: מחודש ושנה עבריים עד חודש ושנה עבריים.
//
// מודול טהור, בלי DOM, ונבדק ב-Node (hebrew-date-range.test.mjs). הבוררים
// שבסרגל הכלים ב-gallery.js (renderDateRangeControl), והשמירה עם החיפוש
// ב-search-history.js (filters.dateFrom / filters.dateTo).
//
// גבול של טווח הוא שנה עברית, ואפשר גם חודש בתוכה. הוא נשמר כמחרוזת קצרה
// ויציבה — "5786" (כל השנה) או "5786-adar2" — כדי שהחתימה של חיפוש שמור
// תהיה זהה בכל מכשיר. הגבול התחתון הוא היום הראשון של החודש (או א׳ בתשרי),
// והעליון הוא היום האחרון של החודש (או כ״ט באלול). ההשוואה נעשית על התאריך
// הלועזי הקלנדרי (YYYY-MM-DD) שממנו נגזר התאריך העברי של הפריט (captureDateKey
// ב-capture-date.js), כך שהטווח מסכים בדיוק עם התאריך שהכרטיס מציג — גם
// בלי תיקון שקיעה, כמו בשאר הגלריה.
import {
    HEBREW_MONTH_ORDER, hebrewMonthName, formatHebrewYear, isHebrewLeapYear, hebrewToGregorian
} from './hebrew-date.js';

export const MIN_RANGE_YEAR = 5000;
export const MAX_RANGE_YEAR = 6999;

const BOUND_PATTERN = /^(\d{4})(?:-([a-z0-9]+))?$/;

function validYear(value) {
    const year = Number(value);
    return Number.isInteger(year) && year >= MIN_RANGE_YEAR && year <= MAX_RANGE_YEAR ? year : 0;
}

// החודשים שאפשר לבחור בשנה מסוימת, מתשרי עד אלול: בשנה מעוברת אדר א׳ ואדר ב׳,
// ובשנה פשוטה אדר אחד. בלי שנה — אין חודשים (החודש תמיד בתוך שנה).
export function monthsForYear(year) {
    const valid = validYear(year);
    if (!valid) return [];
    const leap = isHebrewLeapYear(valid);
    return HEBREW_MONTH_ORDER.filter(key => (leap ? key !== 'adar' : key !== 'adar1' && key !== 'adar2'));
}

// אדר בשנה שאינה מתאימה לו מתורגם לחודש הקיים באותה שנה: אדר א׳ / אדר ב׳
// בשנה פשוטה הם "אדר", ו"אדר" בשנה מעוברת הוא כל עונת אדר — מאדר א׳ כשהוא
// תחילת הטווח, ועד אדר ב׳ כשהוא סופו. כך חיפוש שמור אינו נופל לחודש שאינו קיים.
function canonicalMonth(year, month, edge) {
    if (!HEBREW_MONTH_ORDER.includes(month)) return '';
    const leap = isHebrewLeapYear(year);
    if (!leap && (month === 'adar1' || month === 'adar2')) return 'adar';
    if (leap && month === 'adar') return edge === 'to' ? 'adar2' : 'adar1';
    return month;
}

// "5786-adar2" / { year, month } → { year, month } מנורמל, או null. חודש
// פסול מושמט (נשארת השנה כולה); שנה פסולה פוסלת את הגבול.
export function parseRangeBound(raw, edge = 'from') {
    let year = 0;
    let month = '';
    if (raw && typeof raw === 'object') {
        year = validYear(raw.year);
        month = String(raw.month || '');
    } else if (typeof raw === 'string' || typeof raw === 'number') {
        const match = BOUND_PATTERN.exec(String(raw).trim());
        if (match) {
            year = validYear(match[1]);
            month = match[2] || '';
        }
    }
    if (!year) return null;
    return { year, month: canonicalMonth(year, month, edge) };
}

export function rangeBoundToken(bound) {
    if (!bound || !validYear(bound.year)) return '';
    return bound.month ? `${bound.year}-${bound.month}` : String(bound.year);
}

function dateKeyOf(date) {
    if (!date) return '';
    const pad = value => String(value).padStart(2, '0');
    return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}

// היום הראשון של הגבול (YYYY-MM-DD): א׳ בחודש, או א׳ בתשרי לשנה כולה.
export function rangeBoundStartKey(bound) {
    if (!bound) return '';
    return dateKeyOf(hebrewToGregorian(bound.year, bound.month || 'tishrei', 1));
}

// היום האחרון של הגבול: ל׳ בחודש מלא, כ״ט בחסר; לשנה כולה — כ״ט באלול.
export function rangeBoundEndKey(bound) {
    if (!bound) return '';
    const month = bound.month || 'elul';
    return dateKeyOf(hebrewToGregorian(bound.year, month, 30) || hebrewToGregorian(bound.year, month, 29));
}

// { from, to } כמחרוזות קנוניות ('' כשהגבול פתוח). טווח הפוך ("מאדר עד
// תשרי שלפניו") מתהפך, כדי שבחירה בסדר הלא נכון לא תחזיר גלריה ריקה, ושני
// הסדרים יקבלו אותה חתימה בחיפוש השמור.
export function normalizeDateRange(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    let fromRaw = source.from;
    let toRaw = source.to;
    const from = parseRangeBound(fromRaw, 'from');
    const to = parseRangeBound(toRaw, 'to');
    if (from && to && rangeBoundStartKey(from) > rangeBoundEndKey(to)) {
        // ההיפוך נעשה על הקלט המקורי, כדי ש"אדר" בשנה מעוברת יקבל את התפקיד
        // של מקומו החדש (מתחילת העונה / עד סופה).
        [fromRaw, toRaw] = [toRaw, fromRaw];
    }
    return { from: rangeBoundToken(parseRangeBound(fromRaw, 'from')), to: rangeBoundToken(parseRangeBound(toRaw, 'to')) };
}

export function hasDateRange(range) {
    const normalized = normalizeDateRange(range);
    return Boolean(normalized.from || normalized.to);
}

// הגבולות כתאריכים לועזיים לסינון: { fromKey, toKey }, '' לגבול פתוח.
export function dateRangeBounds(range) {
    const normalized = normalizeDateRange(range);
    return {
        fromKey: rangeBoundStartKey(parseRangeBound(normalized.from, 'from')),
        toKey: rangeBoundEndKey(parseRangeBound(normalized.to, 'to'))
    };
}

// האם יום (YYYY-MM-DD) בטווח. פריט בלי תאריך אינו בטווח פעיל.
export function dateKeyInRange(dateKey, bounds) {
    const { fromKey = '', toKey = '' } = bounds || {};
    if (!fromKey && !toKey) return true;
    const key = String(dateKey || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    return (!fromKey || key >= fromKey) && (!toKey || key <= toKey);
}

// "אדר ב׳ תשפ״ד" / "תשפ״ד"
export function formatRangeBound(raw, edge = 'from') {
    const bound = parseRangeBound(raw, edge);
    if (!bound) return '';
    const year = formatHebrewYear(bound.year);
    return bound.month ? `${hebrewMonthName(bound.month)} ${year}` : year;
}

// התיאור בעברית, לכפתור שבסרגל הכלים ולפרטי החיפוש השמור:
// "מתשרי תשפ״ו עד אדר תשפ״ז", "משנת תשפ״ו ואילך", "עד סוף שנת תשפ״ז".
export function describeDateRange(range) {
    const normalized = normalizeDateRange(range);
    const from = parseRangeBound(normalized.from, 'from');
    const to = parseRangeBound(normalized.to, 'to');
    const fromText = from ? (from.month ? `מ${formatRangeBound(normalized.from, 'from')}` : `משנת ${formatHebrewYear(from.year)}`) : '';
    const toText = to ? (to.month ? `עד ${formatRangeBound(normalized.to, 'to')}` : `עד סוף שנת ${formatHebrewYear(to.year)}`) : '';
    if (fromText && toText) return `${fromText} ${toText}`;
    if (fromText) return `${fromText} ואילך`;
    return toText;
}
