// מוני השימוש בדפדפן: מה נצבר, מתי נשלח, ומה יורד אחרי שליחה. החלק הטהור של
// usage-beacon.js — בלי DOM ובלי רשת.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsageCount, normalizeUsageEntry, shouldSendUsage, markUsageSent, emptyUsageEntry, usageDayKey,
  USAGE_FLUSH_INTERVAL_MS, USAGE_RETRY_MS, USAGE_PENDING_MAX
} from "./usage-beacon.js";

const NOW = Date.UTC(2026, 9, 30, 12);

test("מונים מצטברים רק למדדים של הדפדפן, שלמים וחיוביים, עד התקרה", () => {
  let entry = emptyUsageEntry();
  entry = addUsageCount(entry, "views");
  entry = addUsageCount(entry, "views", 2);
  entry = addUsageCount(entry, "zipItems", 7.9);
  entry = addUsageCount(entry, "uploads", 5);
  entry = addUsageCount(entry, "downloads", -3);
  assert.deepEqual(entry.pending, { views: 3, zipItems: 7 });
  entry = addUsageCount(entry, "views", 10 ** 9);
  assert.equal(entry.pending.views, USAGE_PENDING_MAX.views);
});

test("רשומה פגומה מ-localStorage מתחילה מאפס", () => {
  assert.deepEqual(normalizeUsageEntry(null), emptyUsageEntry());
  assert.deepEqual(normalizeUsageEntry({ visitDay: "<script>", lastFlushAt: "x", pending: { views: "abc", evil: 3 } }), emptyUsageEntry());
});

test("שולחים בביקור הראשון של היום, ואחר כך לכל היותר פעם בעשר דקות", () => {
  assert.equal(shouldSendUsage(emptyUsageEntry(), NOW), true, "ביקור ראשון היום — גם בלי מונים");
  const sent = markUsageSent(emptyUsageEntry(), {}, NOW);
  assert.equal(sent.visitDay, usageDayKey(NOW));
  assert.equal(shouldSendUsage(sent, NOW + 1000), false, "אין מה לדווח");
  const withViews = addUsageCount(sent, "views", 4);
  assert.equal(shouldSendUsage(withViews, NOW + USAGE_FLUSH_INTERVAL_MS - 1), false);
  assert.equal(shouldSendUsage(withViews, NOW + USAGE_FLUSH_INTERVAL_MS), true);
  // יום חדש — שוב ביקור, גם בלי מונים.
  assert.equal(shouldSendUsage(sent, NOW + 24 * 60 * 60 * 1000), true);
});

test("ניסיון שנכשל אינו חוזר בכל מעבר לשונית", () => {
  const failed = { ...emptyUsageEntry(), lastFlushAt: NOW };
  assert.equal(shouldSendUsage(failed, NOW + 5000), false);
  assert.equal(shouldSendUsage(failed, NOW + USAGE_RETRY_MS), true);
});

test("מה שנשלח יורד; מה שנוסף בזמן השליחה נשאר לדיווח הבא", () => {
  const before = addUsageCount(addUsageCount(emptyUsageEntry(), "views", 3), "downloads", 1);
  const during = addUsageCount(before, "views", 2);
  const after = markUsageSent(during, { views: 3, downloads: 1 }, NOW);
  assert.deepEqual(after.pending, { views: 2 });
  assert.equal(after.lastFlushAt, NOW);
});
