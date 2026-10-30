// מסך "סטטיסטיקות": השלמת ימים, קיבוץ לשבועות ולחודשים, גיאומטריית הגרף,
// הנצפים ביותר והפעילים ביותר — בלי DOM.
import test from "node:test";
import assert from "node:assert/strict";
import {
  fillDays, bucketize, barChartGeometry, chartSummary, STATS_CHARTS, totalsFor, granularityForRange,
  topViewedItems, topViewedFolders, topActiveUsers, storageRows, quotaLine, budgetFromForm, hebrewDayLabel
} from "./admin-stats-model.js";

test("כל יום בטווח מקבל שורה, גם בלי פעילות; ימים ומדדים זרים נזרקים", () => {
  const days = fillDays([{ day: "2026-10-02", visits: 3, views: "4", evil: 9 }, { day: "garbage", visits: 1 }, { day: "2026-11-01", visits: 1 }], "2026-10-01", "2026-10-03");
  assert.deepEqual(days.map(entry => entry.day), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(days[1].visits, 3);
  assert.equal(days[1].views, 4);
  assert.equal(days[0].visits, 0);
  assert.equal("evil" in days[1], false);
  assert.deepEqual(fillDays([], "2026-10-05", "2026-10-01"), []);
});

test("קיבוץ: שבוע מתחיל ביום ראשון, חודש לפי החודש, והערכים נסכמים", () => {
  const days = fillDays([{ day: "2026-10-03", views: 1 }, { day: "2026-10-04", views: 2 }, { day: "2026-10-10", views: 3 }, { day: "2026-11-01", views: 4 }], "2026-10-03", "2026-11-01");
  const weeks = bucketize(days, "week");
  assert.equal(weeks[0].key, "2026-09-27", "שבת 3.10 שייכת לשבוע שמתחיל בראשון 27.9");
  assert.equal(weeks[1].key, "2026-10-04");
  assert.equal(weeks[1].values.views, 5);
  const months = bucketize(days, "month");
  assert.deepEqual(months.map(month => [month.label, month.values.views]), [["אוקטובר 2026", 6], ["נובמבר 2026", 4]]);
  const dayBuckets = bucketize(days.slice(0, 1), "day");
  assert.equal(dayBuckets[0].label, "3.10");
  assert.ok(dayBuckets[0].hebrew.includes("תשרי"), dayBuckets[0].hebrew);
  assert.equal(granularityForRange(90), "week");
  assert.equal(granularityForRange(7), "day");
  assert.equal(totalsFor(days).views, 10);
  assert.equal(hebrewDayLabel("bad"), "");
});

test("גיאומטריית הגרף: מימין לשמאל, יחסי לשיא, ויום ריק מקבל קו דק", () => {
  const geometry = barChartGeometry([0, 5, 10], { width: 300, height: 100, gap: 0 });
  assert.equal(geometry.max, 10);
  assert.deepEqual(geometry.bars.map(bar => bar.x), [200, 100, 0]);
  assert.deepEqual(geometry.bars.map(bar => bar.height), [1, 50, 100]);
  assert.equal(geometry.bars[2].y, 0);
  assert.ok(barChartGeometry([], {}).bars.length === 0);
});

test("תיאור לקורא מסך: סך הכול והשיא", () => {
  const buckets = bucketize(fillDays([{ day: "2026-10-02", downloads: 2, zipDownloads: 1 }], "2026-10-01", "2026-10-02"), "day");
  const downloads = STATS_CHARTS.find(chart => chart.id === "downloads");
  assert.match(chartSummary(downloads, buckets), /^הורדות: 3 בסך הכול; השיא 3 ב2\.10/);
  const visits = STATS_CHARTS.find(chart => chart.id === "visits");
  assert.equal(chartSummary(visits, buckets), "ביקורים: אין נתונים בטווח הזה.");
});

test("הנצפים ביותר: רק פריטים קיימים, ותיקיות לפי סכום הצפיות", () => {
  const images = [{ id: "a", folderId: "f1", title: "א" }, { id: "b", folderId: "f1" }, { id: "c", folderId: "f2" }];
  const stats = [{ id: "a", views: 5 }, { id: "b", views: 2 }, { id: "c", views: 6 }, { id: "gone", views: 100 }, { id: "x<y", views: 3 }];
  assert.deepEqual(topViewedItems(stats, images).map(item => item.id), ["c", "a", "b"]);
  const folders = topViewedFolders(stats, images, [{ id: "f1", name: "הקפות" }]);
  assert.deepEqual(folders.map(folder => [folder.id, folder.views, folder.name]), [["f1", 7, "הקפות"], ["f2", 6, "תיקייה שנמחקה"]]);
});

test("הפעילים ביותר: מיומן הפעילות, בטווח, בלי תהליך הרקע", () => {
  const logs = [
    { actorUid: "u1", actorName: "רחל", createdAt: 100 },
    { actorUid: "u1", actorName: "רחל", createdAt: 200 },
    { actorUid: "u2", actorName: "משה", createdAt: 300 },
    { actorUid: "background-worker", actorName: "רקע", createdAt: 300 },
    { actorUid: "u2", actorName: "משה", createdAt: 10 }
  ];
  assert.deepEqual(topActiveUsers(logs, { since: 50 }).map(user => [user.name, user.actions]), [["רחל", 2], ["משה", 1]]);
});

test("אחסון: שורה לכל סוג, שורת המכסה, וערכי הטופס", () => {
  const rows = storageRows({ byPrefix: { approved: { objects: 3, bytes: 300 } } });
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { group: "approved", label: "קבצים מאושרים", objects: 3, bytes: 300 });
  assert.equal(quotaLine(null).text, "לא ידוע");
  assert.match(quotaLine({ bytes: 5, quotaBytes: 0 }).text, /לא הוגדרה מכסה/);
  assert.deepEqual(quotaLine({ bytes: 80, quotaBytes: 100, percent: 80, over: true }, value => `${value}B`), { text: "80B מתוך 100B (80%)", over: true, percent: 80 });
  assert.deepEqual(budgetFromForm({ r2QuotaGb: "10", d1QuotaMb: "", warnPercent: "5" }), { r2QuotaGb: 10, d1QuotaMb: 0, warnPercent: 80 });
  assert.deepEqual(budgetFromForm({ r2QuotaGb: "10", d1QuotaMb: "10", warnPercent: "90" }), { r2QuotaGb: 10, d1QuotaMb: 10, warnPercent: 90 });
});
