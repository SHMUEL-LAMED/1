// הלוח העברי (hebrew-date.js): המרה מתאריך לועזי, אותיות עם גרש וגרשיים,
// שנים מעוברות (אדר א׳ / אדר ב׳), גבולות ראש השנה — והשוואה מול
// Intl.DateTimeFormat('he-u-ca-hebrew') ומול מימוש עצמאי של הדחיות.
import test from "node:test";
import assert from "node:assert/strict";
import {
    gregorianToHebrew, hebrewToGregorian, formatHebrewDate, formatHebrewMonthYear, hebrewNumeral,
    isHebrewLeapYear, hebrewYearLength, hebrewDateFromDateKey, HEBREW_MONTH_ORDER, hebrewMonthName
} from "./hebrew-date.js";

const he = (y, m, d) => formatHebrewDate(gregorianToHebrew(y, m, d));

test("תאריכים ידועים", () => {
    assert.equal(he(2026, 9, 28), "י״ז בתשרי תשפ״ז");
    assert.equal(he(2023, 10, 7), "כ״ב בתשרי תשפ״ד"); // שמחת תורה תשפ״ד
    assert.equal(he(2024, 4, 23), "ט״ו בניסן תשפ״ד"); // פסח
    assert.equal(he(2025, 4, 13), "ט״ו בניסן תשפ״ה");
    assert.equal(he(2025, 12, 15), "כ״ה בכסלו תשפ״ו"); // חנוכה
    assert.equal(he(1948, 5, 14), "ה׳ באייר תש״ח");
    assert.equal(he(2000, 1, 1), "כ״ג בטבת תש״ס");
    assert.equal(he(2026, 1, 1), "י״ב בטבת תשפ״ו");
    assert.equal(he(2026, 10, 3), "כ״ב בתשרי תשפ״ז");
});

test("ט״ו וט״ז נכתבים כך ולא י״ה וי״ו, ומספר בן אות אחת מקבל גרש", () => {
    assert.equal(hebrewNumeral(15), "ט״ו");
    assert.equal(hebrewNumeral(16), "ט״ז");
    assert.equal(hebrewNumeral(1), "א׳");
    assert.equal(hebrewNumeral(10), "י׳");
    assert.equal(hebrewNumeral(30), "ל׳");
    assert.equal(hebrewNumeral(5787), "תשפ״ז");
    assert.equal(hebrewNumeral(5800), "ת״ת");
    assert.equal(hebrewNumeral(5770), "תש״ע");
    assert.equal(hebrewNumeral(5715), "תשט״ו");
    assert.equal(hebrewNumeral(0), "");
});

test("שנה מעוברת: אדר א׳ ואדר ב׳; שנה פשוטה: אדר", () => {
    assert.equal(isHebrewLeapYear(5784), true);
    assert.equal(isHebrewLeapYear(5785), false);
    assert.equal(isHebrewLeapYear(5787), true);
    assert.equal(he(2024, 2, 15), "ו׳ באדר א׳ תשפ״ד");
    assert.equal(he(2024, 3, 24), "י״ד באדר ב׳ תשפ״ד"); // פורים בשנה מעוברת
    assert.equal(he(2025, 3, 14), "י״ד באדר תשפ״ה"); // פורים בשנה פשוטה
    assert.equal(he(2027, 3, 23), "י״ד באדר ב׳ תשפ״ז"); // פורים תשפ״ז
    assert.equal(gregorianToHebrew(2024, 2, 15).monthKey, "adar1");
    assert.equal(gregorianToHebrew(2024, 3, 24).monthKey, "adar2");
    assert.equal(gregorianToHebrew(2025, 3, 14).monthKey, "adar");
    assert.equal(hebrewYearLength(5784), 383);
    assert.equal(hebrewYearLength(5785), 355);
});

test("גבולות ראש השנה: ערב ראש השנה שייך לשנה הקודמת", () => {
    const cases = [
        [[2023, 9, 15], "כ״ט באלול תשפ״ג"], [[2023, 9, 16], "א׳ בתשרי תשפ״ד"],
        [[2024, 10, 2], "כ״ט באלול תשפ״ד"], [[2024, 10, 3], "א׳ בתשרי תשפ״ה"],
        [[2025, 9, 22], "כ״ט באלול תשפ״ה"], [[2025, 9, 23], "א׳ בתשרי תשפ״ו"],
        [[2026, 9, 11], "כ״ט באלול תשפ״ו"], [[2026, 9, 12], "א׳ בתשרי תשפ״ז"],
        [[2027, 10, 1], "כ״ט באלול תשפ״ז"], [[2027, 10, 2], "א׳ בתשרי תשפ״ח"]
    ];
    for (const [[y, m, d], expected] of cases) assert.equal(he(y, m, d), expected, `${y}-${m}-${d}`);
});

test("המרה הלוך ושוב לכל יום בין 1990 ל-2060", () => {
    for (let t = Date.UTC(1990, 0, 1); t < Date.UTC(2060, 0, 1); t += 86400000) {
        const date = new Date(t);
        const hebrew = gregorianToHebrew(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
        assert.deepEqual(
            hebrewToGregorian(hebrew.year, hebrew.monthKey, hebrew.day),
            { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
        );
    }
});

// ICU (שעליו נשען Intl) טועה בשנה אחת בטווח: הוא מאריך את תשרי–חשון תתק״ו
// (נובמבר 2045 עד נובמבר 2046) ביום. ראש השנה תתק״ז חל ביום שני, 1 באוקטובר
// 2046 — מולד תשרי ביום ראשון 17 שעות ו-87 חלקים, אד״ו דוחה ליום שני, ואין
// דחייה נוספת. המימוש העצמאי שבבדיקה הבאה מאשר זאת לכל השנים.
const ICU_KNOWN_WRONG = [Date.UTC(2045, 10, 10), Date.UTC(2046, 10, 30)];
const INTL_MONTHS = {
    Tishri: "tishrei", Heshvan: "cheshvan", Kislev: "kislev", Tevet: "tevet", Shevat: "shevat",
    "Adar I": "adar1", Adar: "adar", "Adar II": "adar2", Nisan: "nisan", Iyar: "iyar",
    Sivan: "sivan", Tamuz: "tammuz", Av: "av", Elul: "elul"
};

test("זהה ל-Intl (he-u-ca-hebrew) בכל יום בין 1900 ל-2100", () => {
    const formatter = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
    const hebrewFormatter = new Intl.DateTimeFormat("he-u-ca-hebrew", { timeZone: "UTC", month: "long" });
    let compared = 0;
    for (let t = Date.UTC(1900, 0, 1); t < Date.UTC(2100, 0, 1); t += 86400000) {
        if (t >= ICU_KNOWN_WRONG[0] && t < ICU_KNOWN_WRONG[1]) continue;
        const date = new Date(t);
        const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
        const ours = gregorianToHebrew(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
        assert.equal(ours.year, Number(parts.year), date.toISOString());
        assert.equal(ours.monthKey, INTL_MONTHS[parts.month], date.toISOString());
        assert.equal(ours.day, Number(parts.day), date.toISOString());
        compared += 1;
    }
    assert.ok(compared > 72000);
    // גם שמות החודשים זהים לשמות של ICU בעברית.
    for (const [y, m, d] of [[2024, 2, 15], [2024, 3, 24], [2025, 11, 1], [2026, 6, 1]]) {
        const date = new Date(Date.UTC(y, m - 1, d));
        assert.equal(gregorianToHebrew(y, m, d).monthName, hebrewFormatter.format(date));
    }
});

// מימוש שני ובלתי תלוי: מולד בחלקים (BigInt) ודחיות ראש השנה כפי שהן
// כתובות בהלכות קידוש החודש — מולד זקן, גטר״ד, בטו תקפ״ט ולא אד״ו ראש.
function roshHashanaDayNumber(year) {
    const leap = y => ((7 * y + 1) % 19) < 7;
    const DAY = 25920n, MONTH = 29n * DAY + 12n * 1080n + 793n, BAHARAD = DAY + 5n * 1080n + 204n;
    const parts = BigInt(Math.floor((235 * year - 234) / 19)) * MONTH + BAHARAD;
    let day = parts / DAY;
    const hour = Number(parts % DAY);
    const weekday = Number(day % 7n);
    if (hour >= 18 * 1080) day += 1n;
    else if (weekday === 2 && hour >= 9 * 1080 + 204 && !leap(year)) day += 1n;
    else if (weekday === 1 && hour >= 15 * 1080 + 589 && leap(year - 1)) day += 1n;
    if ([0, 3, 5].includes(Number(day % 7n))) day += 1n;
    return day;
}

test("ראש השנה זהה למימוש עצמאי של הדחיות, לכל שנה בין תר״ס לתתק״ס", () => {
    const anchorYear = 5787;
    const anchor = roshHashanaDayNumber(anchorYear);
    const anchorMs = Date.UTC(2026, 8, 12);
    for (let year = 5660; year <= 5860; year += 1) {
        const expected = new Date(anchorMs + Number(roshHashanaDayNumber(year) - anchor) * 86400000);
        assert.deepEqual(hebrewToGregorian(year, "tishrei", 1), {
            year: expected.getUTCFullYear(), month: expected.getUTCMonth() + 1, day: expected.getUTCDate()
        }, `ראש השנה ${year}`);
    }
    assert.deepEqual(hebrewToGregorian(5807, "tishrei", 1), { year: 2046, month: 10, day: 1 });
});

test("עזרים: מפתח תאריך, חודש ושנה, סדר החודשים", () => {
    assert.equal(formatHebrewDate(hebrewDateFromDateKey("2026-09-28")), "י״ז בתשרי תשפ״ז");
    assert.equal(hebrewDateFromDateKey("2026-9-28"), null);
    assert.equal(hebrewDateFromDateKey(""), null);
    assert.equal(formatHebrewMonthYear(gregorianToHebrew(2024, 3, 24)), "אדר ב׳ תשפ״ד");
    assert.equal(HEBREW_MONTH_ORDER[0], "tishrei");
    assert.equal(HEBREW_MONTH_ORDER.at(-1), "elul");
    assert.equal(hebrewMonthName("adar1"), "אדר א׳");
    assert.equal(hebrewMonthName("nope"), "");
    assert.equal(gregorianToHebrew(2026, 13, 1), null);
});
