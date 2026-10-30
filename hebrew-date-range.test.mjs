// טווח תאריכים עברי (hebrew-date-range.js): גבולות קנוניים, אדר בשנה מעוברת
// ובפשוטה, היפוך טווח, הימים הלועזיים של כל גבול, הבדיקה והתיאור בעברית.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  monthsForYear,
  parseRangeBound,
  rangeBoundToken,
  rangeBoundStartKey,
  rangeBoundEndKey,
  normalizeDateRange,
  hasDateRange,
  dateRangeBounds,
  dateKeyInRange,
  formatRangeBound,
  describeDateRange
} from "./hebrew-date-range.js";
import { hebrewDateFromDateKey } from "./hebrew-date.js";

test("החודשים לבחירה לפי השנה: אדר א׳ ואדר ב׳ רק בשנה מעוברת", () => {
  // תשפ״ד (5784) מעוברת, תשפ״ו (5786) פשוטה.
  assert.deepEqual(monthsForYear(5784).slice(4, 8), ["shevat", "adar1", "adar2", "nisan"]);
  assert.equal(monthsForYear(5784).length, 13);
  assert.ok(!monthsForYear(5784).includes("adar"));
  assert.deepEqual(monthsForYear(5786).slice(4, 7), ["shevat", "adar", "nisan"]);
  assert.equal(monthsForYear(5786).length, 12);
  assert.equal(monthsForYear(5786)[0], "tishrei");
  assert.equal(monthsForYear(5786).at(-1), "elul");
  assert.deepEqual(monthsForYear(0), []);
  assert.deepEqual(monthsForYear("x"), []);
});

test("גבול: שנה לבד או שנה וחודש; שנה פסולה פוסלת, חודש פסול מושמט", () => {
  assert.deepEqual(parseRangeBound("5786"), { year: 5786, month: "" });
  assert.deepEqual(parseRangeBound("5786-kislev"), { year: 5786, month: "kislev" });
  assert.deepEqual(parseRangeBound({ year: "5786", month: "av" }), { year: 5786, month: "av" });
  assert.deepEqual(parseRangeBound(5786), { year: 5786, month: "" });
  assert.deepEqual(parseRangeBound("5786-nope"), { year: 5786, month: "" });
  for (const bad of ["", "abc", "786", "4999", "7000", "5786-", null, undefined, {}, []]) {
    assert.equal(parseRangeBound(bad), null, String(bad));
  }
  assert.equal(rangeBoundToken({ year: 5786, month: "" }), "5786");
  assert.equal(rangeBoundToken({ year: 5784, month: "adar2" }), "5784-adar2");
  assert.equal(rangeBoundToken(null), "");
});

test("אדר: בשנה פשוטה אדר א׳/ב׳ הם אדר, ובמעוברת אדר הוא כל העונה", () => {
  assert.deepEqual(parseRangeBound("5786-adar1"), { year: 5786, month: "adar" });
  assert.deepEqual(parseRangeBound("5786-adar2", "to"), { year: 5786, month: "adar" });
  assert.deepEqual(parseRangeBound("5784-adar", "from"), { year: 5784, month: "adar1" });
  assert.deepEqual(parseRangeBound("5784-adar", "to"), { year: 5784, month: "adar2" });
  // "אדר תשפ״ד" עד "אדר תשפ״ד" — מא׳ באדר א׳ עד כ״ט באדר ב׳.
  assert.deepEqual(normalizeDateRange({ from: "5784-adar", to: "5784-adar" }), { from: "5784-adar1", to: "5784-adar2" });
  assert.deepEqual(dateRangeBounds({ from: "5784-adar", to: "5784-adar" }), { fromKey: "2024-02-10", toKey: "2024-04-08" });
});

test("הימים של כל גבול: א׳ בחודש עד יומו האחרון, והשנה כולה מתשרי עד אלול", () => {
  // תשפ״ו: א׳ בתשרי = 23.09.2025, כ״ט באלול = 11.09.2026.
  assert.equal(rangeBoundStartKey(parseRangeBound("5786")), "2025-09-23");
  assert.equal(rangeBoundEndKey(parseRangeBound("5786")), "2026-09-11");
  // חשוון תשפ״ו חסר (29 יום), כסלו תשפ״ו מלא (30 יום).
  assert.equal(rangeBoundEndKey(parseRangeBound("5786-cheshvan")), "2025-11-20");
  assert.equal(rangeBoundStartKey(parseRangeBound("5786-kislev")), "2025-11-21");
  assert.equal(rangeBoundEndKey(parseRangeBound("5786-kislev")), "2025-12-20");
  assert.equal(rangeBoundStartKey(null), "");
  assert.equal(rangeBoundEndKey(null), "");
  // כל יום בתוך הגבולות שייך לחודש — לפי אותה המרה שהכרטיס מציג.
  assert.equal(hebrewDateFromDateKey("2025-11-20").monthKey, "cheshvan");
  assert.equal(hebrewDateFromDateKey("2025-11-21").monthKey, "kislev");
  assert.equal(hebrewDateFromDateKey("2024-02-10").monthKey, "adar1");
  assert.equal(hebrewDateFromDateKey("2024-04-08").monthKey, "adar2");
  assert.equal(hebrewDateFromDateKey("2024-04-09").monthKey, "nisan");
});

test("טווח הפוך מתהפך, וגבול פתוח נשאר פתוח", () => {
  assert.deepEqual(normalizeDateRange({ from: "5787-tishrei", to: "5786-av" }), { from: "5786-av", to: "5787-tishrei" });
  // ההיפוך שומר על "אדר" כעונה שלמה במקומו החדש.
  assert.deepEqual(normalizeDateRange({ from: "5787-adar", to: "5786-tishrei" }), { from: "5786-tishrei", to: "5787-adar2" });
  // אותה שנה כגבול ובתוכה חודש — אינו הפוך.
  assert.deepEqual(normalizeDateRange({ from: "5786", to: "5786-adar" }), { from: "5786", to: "5786-adar" });
  assert.deepEqual(normalizeDateRange({ from: "5786-adar", to: "5786" }), { from: "5786-adar", to: "5786" });
  assert.deepEqual(normalizeDateRange({ from: "5786" }), { from: "5786", to: "" });
  assert.deepEqual(normalizeDateRange({ to: "5786-elul" }), { from: "", to: "5786-elul" });
  assert.deepEqual(normalizeDateRange(null), { from: "", to: "" });
  assert.deepEqual(normalizeDateRange({ from: "junk", to: "" }), { from: "", to: "" });
  assert.equal(hasDateRange({ from: "5786" }), true);
  assert.equal(hasDateRange({ from: "x" }), false);
  assert.deepEqual(dateRangeBounds({}), { fromKey: "", toKey: "" });
  assert.deepEqual(dateRangeBounds({ from: "5786-kislev" }), { fromKey: "2025-11-21", toKey: "" });
});

test("בדיקת יום מול הטווח: גבולות כוללים, ופריט בלי תאריך אינו בטווח פעיל", () => {
  const bounds = dateRangeBounds({ from: "5786-kislev", to: "5786-kislev" });
  assert.equal(dateKeyInRange("2025-11-21", bounds), true);
  assert.equal(dateKeyInRange("2025-12-20", bounds), true);
  assert.equal(dateKeyInRange("2025-11-20", bounds), false);
  assert.equal(dateKeyInRange("2025-12-21", bounds), false);
  assert.equal(dateKeyInRange("", bounds), false);
  assert.equal(dateKeyInRange("not a date", bounds), false);
  // בלי טווח — הכול עובר, גם פריט בלי תאריך.
  assert.equal(dateKeyInRange("", { fromKey: "", toKey: "" }), true);
  assert.equal(dateKeyInRange("1990-01-01", dateRangeBounds({ to: "5786" })), true);
  assert.equal(dateKeyInRange("2026-09-12", dateRangeBounds({ to: "5786" })), false);
});

test("התיאור בעברית לכפתור ולחיפוש השמור", () => {
  assert.equal(formatRangeBound("5784-adar2"), "אדר ב׳ תשפ״ד");
  assert.equal(formatRangeBound("5786"), "תשפ״ו");
  assert.equal(formatRangeBound("x"), "");
  assert.equal(describeDateRange({ from: "5786-tishrei", to: "5787-adar" }), "מתשרי תשפ״ו עד אדר ב׳ תשפ״ז");
  assert.equal(describeDateRange({ from: "5786-tishrei", to: "5786-adar" }), "מתשרי תשפ״ו עד אדר תשפ״ו");
  assert.equal(describeDateRange({ from: "5786" }), "משנת תשפ״ו ואילך");
  assert.equal(describeDateRange({ to: "5787" }), "עד סוף שנת תשפ״ז");
  assert.equal(describeDateRange({ from: "5786", to: "5787-kislev" }), "משנת תשפ״ו עד כסלו תשפ״ז");
  assert.equal(describeDateRange({ from: "5784-adar1" }), "מאדר א׳ תשפ״ד ואילך");
  assert.equal(describeDateRange({}), "");
});

test("המודולים החדשים במעטפת ובבדיקת התחביר", () => {
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
  const pkg = readFileSync(new URL("./package.json", import.meta.url), "utf8");
  for (const file of ["hebrew-date-range.js", "video-length.js"]) {
    assert.ok(shell.includes(`"./${file}"`), `${file} חסר במעטפת`);
    assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
  }
});
