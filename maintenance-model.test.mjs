// maintenance-model.js: הספירה לאחור של סל המחזור, שמות קובצי הגיבוי, והדוח
// של הקישורים השבורים — ושהקבועים זהים לאלה שב-Worker, שאינו יכול לייבא מודול.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRASH_RETENTION_DAYS, BACKUP_RETENTION_DAYS, trashDaysLeft, trashPurgeLabel, backupFileName, isBackupDay,
  formatBackupDay, normalizeBackupList, brokenLinkKindLabel, normalizeBrokenLinksReport, galleryRecordHref
} from "./maintenance-model.js";

const DAY = 24 * 60 * 60 * 1000;
const workerSource = readFileSync(new URL("./cloudflare-worker.js", import.meta.url), "utf8");

test("הקבועים זהים לאלה שב-Worker", () => {
  assert.match(workerSource, new RegExp(`const TRASH_RETENTION_DAYS = ${TRASH_RETENTION_DAYS};`));
  assert.match(workerSource, new RegExp(`const D1_BACKUP_RETENTION_DAYS = ${BACKUP_RETENTION_DAYS};`));
});

test("סל המחזור: כמה ימים נשארו עד המחיקה האוטומטית", () => {
  const now = Date.UTC(2026, 9, 30, 12);
  assert.equal(trashDaysLeft(now, now), 30);
  assert.equal(trashDaysLeft(now - 10 * DAY, now), 20);
  assert.equal(trashDaysLeft(now - 10 * DAY - 1000, now), 20, "חלק של יום נספר כיום שלם");
  assert.equal(trashDaysLeft(now - 31 * DAY, now), 0);
  assert.equal(trashDaysLeft(undefined, now), null);
  assert.equal(trashDaysLeft("not a date", now), null);
  assert.equal(trashPurgeLabel(now - 10 * DAY, now), "יימחק לצמיתות בעוד 20 ימים");
  assert.equal(trashPurgeLabel(now - 29 * DAY, now), "יימחק לצמיתות בעוד יום אחד");
  assert.equal(trashPurgeLabel(now - 40 * DAY, now), "יימחק לצמיתות בניקוי הקרוב");
  assert.equal(trashPurgeLabel(0, now), "");
});

test("גיבויים: שם הקובץ, התאריך והרשימה", () => {
  assert.equal(backupFileName("2026-10-30"), "simchas-gallery-d1-2026-10-30.json.gz");
  assert.equal(backupFileName("2026-10-30", false), "simchas-gallery-d1-2026-10-30.json");
  assert.equal(isBackupDay("2026-10-30"), true);
  assert.equal(isBackupDay("../../x"), false);
  assert.match(formatBackupDay("2026-10-30"), /2026/);
  assert.equal(formatBackupDay("bad"), "");
  assert.deepEqual(normalizeBackupList({ backups: [{ day: "2026-10-30", size: "12" }, { day: "x" }, null] }), [{ day: "2026-10-30", size: 12, compressed: true }]);
  assert.deepEqual(normalizeBackupList(null), []);
});

test("קישורים שבורים: תוויות, קישור לרשומה ונרמול הדוח", () => {
  assert.equal(brokenLinkKindLabel("original"), "הקובץ המקורי");
  assert.equal(brokenLinkKindLabel("medium-avif"), "תצוגה בינונית (AVIF)");
  assert.equal(brokenLinkKindLabel("weird"), "קובץ");
  assert.equal(galleryRecordHref("img_1"), "./#media/img_1");
  assert.equal(galleryRecordHref("<script>"), "./#media/script");
  assert.equal(galleryRecordHref(""), "");
  const normalized = normalizeBrokenLinksReport({
    listMax: 300,
    report: {
      completedAt: 5, checkedRecords: "3", missingCount: 1, orphanCount: 1,
      missing: [{ id: "img_1", title: "x".repeat(200), missing: [{ kind: "original", key: "approved/u/img_1.jpg" }] }, { id: "" }],
      orphans: [{ key: "approved/u/o.jpg", size: 10 }, { key: "" }]
    },
    scanning: { phase: "objects", checkedObjects: 7 }
  });
  assert.equal(normalized.report.checkedRecords, 3);
  assert.equal(normalized.report.missing.length, 1);
  assert.equal(normalized.report.missing[0].title.length, 80);
  assert.equal(normalized.report.orphans.length, 1);
  assert.equal(normalized.scanning.phase, "objects");
  assert.deepEqual(normalizeBrokenLinksReport({}), { report: null, scanning: null, listMax: 300 });
});
