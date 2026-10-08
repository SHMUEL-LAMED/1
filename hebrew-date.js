// hebrew-date.js — הלוח העברי, מקומית ובלי רשת.
//
// החישוב הוא האלגוריתם האריתמטי של הלוח העברי הקבוע (מולד תשרי ודחיות
// ראש השנה: לא אד״ו ראש, מולד זקן, גטר״ד ובטו תקפ״ט), כפי שהוא מתואר
// ב-Calendrical Calculations. אין כאן תלות ב-Intl: גם דפדפן בלי לוח עברי
// מקבל תאריך נכון. הבדיקות (hebrew-date.test.mjs) משוות אותו מול
// Intl.DateTimeFormat('he-u-ca-hebrew') על פני עשרות שנים, כולל שנים
// מעוברות (אדר א׳/אדר ב׳) וגבולות ראש השנה.
//
// התאריך מחושב מתאריך לועזי קלנדרי בלבד (שנה, חודש, יום). אין תיקון
// שקיעה: תמונה שצולמה בליל שבת אחרי השקיעה מקבלת את התאריך של יום שישי.

// מספר היום הקבוע (R.D.) של א׳ בתשרי שנה 1.
const HEBREW_EPOCH_RD = -1373427;
// מספר היום הקבוע של 1 בינואר 1970.
const UNIX_EPOCH_RD = 719163;
const DAY_MS = 86400000;

// מספור החודשים הפנימי: 1 = ניסן … 7 = תשרי … 12 = אדר (אדר א׳ במעוברת),
// 13 = אדר ב׳. המפתחות יציבים ומשמשים גם בסינון.
const MONTHS = {
    1: { key: 'nisan', name: 'ניסן' },
    2: { key: 'iyar', name: 'אייר' },
    3: { key: 'sivan', name: 'סיוון' },
    4: { key: 'tammuz', name: 'תמוז' },
    5: { key: 'av', name: 'אב' },
    6: { key: 'elul', name: 'אלול' },
    7: { key: 'tishrei', name: 'תשרי' },
    8: { key: 'cheshvan', name: 'חשוון' },
    9: { key: 'kislev', name: 'כסלו' },
    10: { key: 'tevet', name: 'טבת' },
    11: { key: 'shevat', name: 'שבט' },
    12: { key: 'adar', name: 'אדר' },
    13: { key: 'adar2', name: 'אדר ב׳' }
};
const ADAR_1 = { key: 'adar1', name: 'אדר א׳' };

// סדר החודשים בשנה האזרחית העברית, מתשרי עד אלול — גם הסדר ברשימת הסינון.
export const HEBREW_MONTH_ORDER = Object.freeze([
    'tishrei', 'cheshvan', 'kislev', 'tevet', 'shevat', 'adar', 'adar1', 'adar2',
    'nisan', 'iyar', 'sivan', 'tammuz', 'av', 'elul'
]);
const MONTH_NAME_BY_KEY = Object.freeze({
    ...Object.fromEntries(Object.values(MONTHS).map(month => [month.key, month.name])),
    [ADAR_1.key]: ADAR_1.name
});

export function hebrewMonthName(key) {
    return MONTH_NAME_BY_KEY[key] || '';
}

export function isHebrewLeapYear(year) {
    return ((7 * year + 1) % 19 + 19) % 19 < 7;
}

function lastMonthOfYear(year) {
    return isHebrewLeapYear(year) ? 13 : 12;
}

// ימים שחלפו מהבריאה עד מולד תשרי של השנה, עם דחיית "לא אד״ו ראש".
function elapsedDays(year) {
    const monthsElapsed = Math.floor((235 * year - 234) / 19);
    const partsElapsed = 12084 + 13753 * monthsElapsed;
    const days = 29 * monthsElapsed + Math.floor(partsElapsed / 25920);
    return ((3 * (days + 1)) % 7 + 7) % 7 < 3 ? days + 1 : days;
}

// דחיות גטר״ד ובטו תקפ״ט: שנה באורך 356 או שנה קודמת באורך 382 אסורות.
function yearLengthCorrection(year) {
    const ny0 = elapsedDays(year - 1);
    const ny1 = elapsedDays(year);
    const ny2 = elapsedDays(year + 1);
    if (ny2 - ny1 === 356) return 2;
    if (ny1 - ny0 === 382) return 1;
    return 0;
}

const newYearCache = new Map();
function newYear(year) {
    let value = newYearCache.get(year);
    if (value === undefined) {
        value = HEBREW_EPOCH_RD + elapsedDays(year) + yearLengthCorrection(year);
        if (newYearCache.size > 4000) newYearCache.clear();
        newYearCache.set(year, value);
    }
    return value;
}

export function hebrewYearLength(year) {
    return newYear(year + 1) - newYear(year);
}

function monthLength(month, year) {
    if ([2, 4, 6, 10, 13].includes(month)) return 29;
    if (month === 12 && !isHebrewLeapYear(year)) return 29;
    const yearLength = hebrewYearLength(year);
    if (month === 8 && yearLength % 10 !== 5) return 29; // חשון חסר, אלא אם השנה שלמה
    if (month === 9 && yearLength % 10 === 3) return 29; // כסלו חסר בשנה חסרה
    return 30;
}

function civilMonths(year) {
    const months = [7, 8, 9, 10, 11, 12];
    if (lastMonthOfYear(year) === 13) months.push(13);
    months.push(1, 2, 3, 4, 5, 6);
    return months;
}

function monthInfo(month, year) {
    if (month === 12 && isHebrewLeapYear(year)) return ADAR_1;
    return MONTHS[month];
}

function rdFromGregorian(year, month, day) {
    const date = new Date(Date.UTC(2000, month - 1, day));
    date.setUTCFullYear(year);
    return Math.floor(date.getTime() / DAY_MS) + UNIX_EPOCH_RD;
}

function hebrewFromRd(rd) {
    const approx = Math.floor((rd - HEBREW_EPOCH_RD) / (35975351 / 98496)) + 1;
    let year = approx - 1;
    while (newYear(year + 1) <= rd) year += 1;
    let start = newYear(year);
    for (const month of civilMonths(year)) {
        const length = monthLength(month, year);
        if (rd < start + length) {
            const info = monthInfo(month, year);
            return { year, month, monthKey: info.key, monthName: info.name, day: rd - start + 1, leap: isHebrewLeapYear(year) };
        }
        start += length;
    }
    throw new Error('hebrew date out of range');
}

// תאריך לועזי קלנדרי (שנה, חודש 1–12, יום) → תאריך עברי.
export function gregorianToHebrew(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return hebrewFromRd(rdFromGregorian(y, m, d));
}

// תאריך עברי → תאריך לועזי { year, month, day }. monthKey כמו ב-HEBREW_MONTH_ORDER.
export function hebrewToGregorian(year, monthKey, day) {
    const leap = isHebrewLeapYear(year);
    let rd = newYear(year);
    for (const month of civilMonths(year)) {
        const info = monthInfo(month, year);
        const matches = info.key === monthKey || (!leap && monthKey === 'adar1' && month === 12) || (leap && monthKey === 'adar' && month === 13);
        if (matches) {
            if (day < 1 || day > monthLength(month, year)) return null;
            const date = new Date((rd + day - 1 - UNIX_EPOCH_RD) * DAY_MS);
            return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
        }
        rd += monthLength(month, year);
    }
    return null;
}

// --- מספרים באותיות ---
const UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];
const GERESH = '׳';
const GERSHAYIM = '״';

// 17 → "י״ז", 15 → "ט״ו", 1 → "א׳", 787 → "תשפ״ז". אלפים אינם נכתבים.
export function hebrewNumeral(value) {
    let n = Math.trunc(Number(value)) % 1000;
    if (!(n > 0)) return '';
    let letters = '';
    let hundreds = Math.floor(n / 100);
    while (hundreds > 4) { letters += 'ת'; hundreds -= 4; }
    letters += HUNDREDS[hundreds];
    const rest = n % 100;
    if (rest === 15) letters += 'טו';
    else if (rest === 16) letters += 'טז';
    else letters += TENS[Math.floor(rest / 10)] + UNITS[rest % 10];
    return letters.length === 1
        ? letters + GERESH
        : `${letters.slice(0, -1)}${GERSHAYIM}${letters.slice(-1)}`;
}

export function formatHebrewYear(year) {
    return hebrewNumeral(year);
}

// "י״ז בתשרי תשפ״ז"
export function formatHebrewDate(hebrew) {
    if (!hebrew) return '';
    return `${hebrewNumeral(hebrew.day)} ב${hebrew.monthName} ${formatHebrewYear(hebrew.year)}`;
}

// "תשרי תשפ״ז" — לכותרות קבוצה.
export function formatHebrewMonthYear(hebrew) {
    if (!hebrew) return '';
    return `${hebrew.monthName} ${formatHebrewYear(hebrew.year)}`;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const fromKeyCache = new Map();

// "2026-09-28" → התאריך העברי, עם מטמון: אותו יום מופיע באלפי כרטיסים.
export function hebrewDateFromDateKey(dateKey) {
    const match = DATE_KEY_PATTERN.exec(String(dateKey || ''));
    if (!match) return null;
    if (fromKeyCache.has(dateKey)) return fromKeyCache.get(dateKey);
    const hebrew = gregorianToHebrew(Number(match[1]), Number(match[2]), Number(match[3]));
    if (fromKeyCache.size > 5000) fromKeyCache.clear();
    fromKeyCache.set(dateKey, hebrew);
    return hebrew;
}
