// ציר הזמן העברי (gallery-timeline.js): קיבוץ לחודשים לפי סדר התצוגה עם
// הפריט הראשון של כל חודש, מתי הציר מוצג, החודש הפעיל והיעד של הקפיצה.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHebrewTimeline, timelineAvailable, timelineSignature, timelineMonthLabel,
  firstIndexBelowLine, activeMonthIndex, timelineScrollTop, timelineMonthKey,
  TIMELINE_SORTS, TIMELINE_MIN_MONTHS, TIMELINE_JUMP_GAP
} from "./gallery-timeline.js";

// רשומה עם יום צילום; בלי takenDate — יום ההעלאה (date), כמו captureDateKey.
const taken = (id, takenDate) => ({ id, takenAt: Date.parse(`${takenDate}T10:00:00Z`), takenDate, takenAtSource: "exif" });
const uploaded = (id, date) => ({ id, date, createdAt: Date.parse(`${date}T10:00:00Z`) });

test("פריטים ממוינים מהחדש לישן → חודשים לפי סדר ההופעה, עם הפריט הראשון והמונה", () => {
  const items = [
    taken("a", "2026-09-28"), // י״ז בתשרי תשפ״ז
    taken("b", "2026-09-20"), // ט׳ בתשרי תשפ״ז
    uploaded("c", "2026-09-01"), // י״ט באלול תשפ״ו — יום ההעלאה
    taken("d", "2024-03-24"), // י״ד באדר ב׳ תשפ״ד
    taken("e", "2024-02-15") // ו׳ באדר א׳ תשפ״ד
  ];
  const timeline = buildHebrewTimeline(items);
  assert.deepEqual(timeline.months.map(month => month.label), ["תשרי תשפ״ז", "אלול תשפ״ו", "אדר ב׳ תשפ״ד", "אדר א׳ תשפ״ד"]);
  assert.deepEqual(timeline.months.map(month => month.firstId), ["a", "c", "d", "e"]);
  assert.deepEqual(timeline.months.map(month => month.firstIndex), [0, 2, 3, 4]);
  assert.deepEqual(timeline.months.map(month => month.count), [2, 1, 1, 1]);
  assert.deepEqual(timeline.months.map(month => month.monthKey), ["tishrei", "elul", "adar2", "adar1"]);
  assert.deepEqual(timeline.months.map(month => month.key), ["5787-tishrei", "5786-elul", "5784-adar2", "5784-adar1"]);
  assert.deepEqual(timeline.monthIndexAt, [0, 0, 1, 2, 3]);
  // השנים לפי סדר ההופעה, וכל חודש תחת השנה שלו (אותם אובייקטים).
  assert.deepEqual(timeline.years.map(year => year.label), ["תשפ״ז", "תשפ״ו", "תשפ״ד"]);
  assert.deepEqual(timeline.years.map(year => year.months.map(month => month.monthName)), [["תשרי"], ["אלול"], ["אדר ב׳", "אדר א׳"]]);
  assert.equal(timeline.years[0].months[0], timeline.months[0]);
});

test("מהישן לחדש: אותם חודשים בסדר הפוך, והפריט הראשון הוא הישן ביותר בחודש", () => {
  const items = [taken("x", "2025-10-01"), taken("y", "2025-10-15"), taken("z", "2025-11-30")];
  const timeline = buildHebrewTimeline(items);
  // 1.10.2025 = ט׳ בתשרי תשפ״ו; 15.10 = כ״ג בתשרי; 30.11 = ט׳ בכסלו.
  assert.deepEqual(timeline.months.map(month => [month.label, month.firstId, month.count]), [
    ["תשרי תשפ״ו", "x", 2],
    ["כסלו תשפ״ו", "z", 1]
  ]);
});

test("ראש השנה מפריד בין שנים, ושנה פשוטה מקבלת 'אדר' ולא 'אדר א׳'", () => {
  // ראש השנה תשפ״ז: 12.9.2026. כ״ט באלול תשפ״ו: 11.9.2026.
  const timeline = buildHebrewTimeline([taken("new", "2026-09-12"), taken("old", "2026-09-11"), taken("adar", "2025-03-10")]);
  assert.deepEqual(timeline.months.map(month => month.label), ["תשרי תשפ״ז", "אלול תשפ״ו", "אדר תשפ״ה"]);
  assert.equal(timeline.months[2].monthKey, "adar");
  assert.deepEqual(timeline.years.map(year => year.year), [5787, 5786, 5785]);
});

test("פריט בלי תאריך או בלי מזהה אינו פותח חודש ואינו נספר", () => {
  const items = [
    taken("a", "2026-09-28"),
    { id: "nodate" },
    { title: "בלי מזהה", takenDate: "2024-03-24", takenAt: Date.parse("2024-03-24T10:00:00Z") },
    taken("b", "2024-03-24")
  ];
  const timeline = buildHebrewTimeline(items);
  assert.deepEqual(timeline.months.map(month => month.firstId), ["a", "b"]);
  assert.deepEqual(timeline.monthIndexAt, [0, -1, -1, 1]);
  assert.equal(timeline.months[1].firstIndex, 3);
});

test("חודש שחוזר אחרי שכן (גבול של אזור זמן) נשאר במקומו הראשון", () => {
  const items = [taken("a", "2026-09-28"), taken("b", "2026-09-01"), taken("c", "2026-09-28")];
  const timeline = buildHebrewTimeline(items);
  assert.deepEqual(timeline.months.map(month => [month.monthKey, month.firstId, month.count]), [["tishrei", "a", 2], ["elul", "b", 1]]);
  assert.deepEqual(timeline.monthIndexAt, [0, 1, 0]);
});

test("idOf ו-dateKeyOf מוחלפים: המזהה הבטוח של הדף ותאריך חיצוני", () => {
  const timeline = buildHebrewTimeline([{ key: "k1", day: "2026-09-28" }, { key: "k2", day: "2026-09-01" }], {
    idOf: item => item.key,
    dateKeyOf: item => item.day
  });
  assert.deepEqual(timeline.months.map(month => month.firstId), ["k1", "k2"]);
  assert.deepEqual(buildHebrewTimeline(null), { months: [], years: [], monthIndexAt: [] });
});

test("הציר מוצג רק במיון לפי תאריך ומשני חודשים ומעלה", () => {
  const two = buildHebrewTimeline([taken("a", "2026-09-28"), taken("b", "2026-09-01")]);
  const one = buildHebrewTimeline([taken("a", "2026-09-28"), taken("b", "2026-09-20")]);
  assert.deepEqual(TIMELINE_SORTS, ["newest", "oldest"]);
  assert.equal(TIMELINE_MIN_MONTHS, 2);
  assert.equal(timelineAvailable("newest", two), true);
  assert.equal(timelineAvailable("oldest", two), true);
  assert.equal(timelineAvailable("name", two), false);
  assert.equal(timelineAvailable("random", two), false);
  assert.equal(timelineAvailable("newest", one), false);
  assert.equal(timelineAvailable("newest", null), false);
});

test("החתימה משתנה כשחודש, מונה או פריט ראשון משתנים — ולא אחרת", () => {
  const base = [taken("a", "2026-09-28"), taken("b", "2026-09-01")];
  const signature = timelineSignature(buildHebrewTimeline(base));
  assert.equal(signature, timelineSignature(buildHebrewTimeline([...base])));
  assert.notEqual(signature, timelineSignature(buildHebrewTimeline([...base, taken("c", "2026-09-02")])));
  assert.notEqual(signature, timelineSignature(buildHebrewTimeline([taken("z", "2026-09-29"), ...base])));
  assert.equal(timelineSignature(null), "");
});

test("התווית הנגישה של חודש: שם, שנה ומספר הפריטים ביחיד וברבים", () => {
  assert.equal(timelineMonthLabel({ label: "תשרי תשפ״ז", count: 12 }), "תשרי תשפ״ז, 12 פריטים");
  assert.equal(timelineMonthLabel({ label: "אלול תשפ״ו", count: 1 }), "אלול תשפ״ו, פריט אחד");
  assert.equal(timelineMonthLabel(null), "");
});

test("החיפוש הבינארי מוצא את הכרטיס הראשון שתחתיתו מתחת לקו", () => {
  // שורות של שלושה כרטיסים בגובה 100: תחתיות 100,100,100,200,200,200,300…
  const bottoms = Array.from({ length: 12 }, (_, index) => (Math.floor(index / 3) + 1) * 100 - 250);
  const bottomAt = index => bottoms[index];
  let calls = 0;
  const counted = index => { calls += 1; return bottomAt(index); };
  assert.equal(firstIndexBelowLine(bottoms.length, counted, 0), 6, "השורה השלישית חוצה את הקו");
  assert.ok(calls <= 5, `נמדדו ${calls} כרטיסים`);
  assert.equal(firstIndexBelowLine(bottoms.length, bottomAt, -1000), 0);
  assert.equal(firstIndexBelowLine(bottoms.length, bottomAt, 1000), 12);
  assert.equal(firstIndexBelowLine(0, bottomAt, 0), 0);
});

test("החודש הפעיל לפי הכרטיס שבראש המסך; כרטיס בלי חודש לוקח את השכן", () => {
  const timeline = { monthIndexAt: [-1, 0, 0, -1, 1, 1] };
  assert.equal(activeMonthIndex(timeline, 0), 0, "בראש הרשימה — הבא אחריו");
  assert.equal(activeMonthIndex(timeline, 2), 0);
  assert.equal(activeMonthIndex(timeline, 3), 0, "הקודם לו");
  assert.equal(activeMonthIndex(timeline, 4), 1);
  assert.equal(activeMonthIndex(timeline, 99), 1, "מעבר לסוף — האחרון");
  assert.equal(activeMonthIndex(timeline, -5), 0);
  assert.equal(activeMonthIndex({ monthIndexAt: [-1, -1] }, 1), -1);
  assert.equal(activeMonthIndex(null, 0), -1);
});

test("יעד הקפיצה: ראש הכרטיס מתחת לכותרת ולסרגל הדבוק, ועוד מרווח לתווית", () => {
  assert.equal(TIMELINE_JUMP_GAP, 24);
  assert.equal(timelineScrollTop({ scrollY: 1000, cardTop: 600, obstruction: 150 }), 1000 + 600 - 150 - 24);
  assert.equal(timelineScrollTop({ scrollY: 1000, cardTop: -400.4, obstruction: 150, gap: 0 }), 450);
  assert.equal(timelineScrollTop({ scrollY: 0, cardTop: 50, obstruction: 150 }), 0, "לא מעל ראש הדף");
  assert.equal(timelineScrollTop(), 0);
});

test("מפתח החודש זהה למפתח של תווית הקבוצה בכרטיס (שנה-חודש)", () => {
  assert.equal(timelineMonthKey({ year: 5787, monthKey: "tishrei" }), "5787-tishrei");
  assert.equal(timelineMonthKey(null), "");
  assert.equal(timelineMonthKey({ year: 5787 }), "");
});
