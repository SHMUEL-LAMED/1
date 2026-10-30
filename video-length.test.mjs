// סינון סרטונים לפי אורך (video-length.js): הקטגוריות והגבולות שלהן, האורך
// מהרשומה או מהבדיקה, המטמון בדפדפן, והתור המוגבל של בדיקות המטא-דאטה.
import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_LENGTHS,
  VIDEO_LENGTH_LABELS,
  normalizeVideoLength,
  validDuration,
  videoLengthBucket,
  recordDuration,
  parseDurationCache,
  serializeDurationCache,
  createDurationProbe,
  DURATION_CACHE_VERSION,
  DURATION_PROBE_LIMIT
} from "./video-length.js";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("שלוש קטגוריות עם תוויות בעברית, וערך זר אינו מסנן", () => {
  assert.deepEqual([...VIDEO_LENGTHS], ["short", "medium", "long"]);
  assert.equal(VIDEO_LENGTH_LABELS.short, "קצרים (עד דקה)");
  assert.equal(VIDEO_LENGTH_LABELS.medium, "בינוניים (1–5 דקות)");
  assert.equal(VIDEO_LENGTH_LABELS.long, "ארוכים (מעל 5 דקות)");
  assert.equal(normalizeVideoLength("long"), "long");
  assert.equal(normalizeVideoLength("Long"), "");
  assert.equal(normalizeVideoLength(undefined), "");
});

test("הגבולות: עד דקה כולל, עד חמש דקות כולל, ומעליהן ארוך", () => {
  assert.equal(videoLengthBucket(1), "short");
  assert.equal(videoLengthBucket(60), "short");
  assert.equal(videoLengthBucket(61), "medium");
  assert.equal(videoLengthBucket(300), "medium");
  assert.equal(videoLengthBucket(301), "long");
  assert.equal(videoLengthBucket(3 * 3600), "long");
  // אורך לא ידוע או פסול — בלי קטגוריה.
  for (const bad of [0, -5, NaN, Infinity, "abc", null, undefined, 25 * 3600]) {
    assert.equal(videoLengthBucket(bad), "", String(bad));
    assert.equal(validDuration(bad), 0, String(bad));
  }
  assert.equal(validDuration("42"), 42);
});

test("האורך מהרשומה גובר, ובלעדיו — מהבדיקה בדפדפן", () => {
  const known = new Map([["v1", 400], ["v2", 30]]);
  assert.equal(recordDuration({ id: "v1", duration: 45 }, known), 45);
  assert.equal(recordDuration({ id: "v1" }, known), 400);
  assert.equal(recordDuration({ id: "v1", duration: 0 }, known), 400);
  assert.equal(recordDuration({ id: "v3" }, known), 0);
  assert.equal(recordDuration({ id: "v2" }), 0);
  assert.equal(recordDuration(null, known), 0);
});

test("המטמון בדפדפן: נקרא בזהירות, ונשמר עד התקרה — האחרונים שנמצאו", () => {
  assert.equal(parseDurationCache(null).size, 0);
  assert.equal(parseDurationCache("not json").size, 0);
  assert.equal(parseDurationCache(JSON.stringify({ v: 99, d: { a: 5 } })).size, 0);
  const parsed = parseDurationCache(JSON.stringify({ v: DURATION_CACHE_VERSION, d: { ok_1: 75, bad: -1, "bad id!": 9, zero: 0 } }));
  assert.deepEqual([...parsed.entries()], [["ok_1", 75]]);

  const map = new Map([["a", 10], ["b", 20], ["c", 0], ["d", 40]]);
  const text = serializeDurationCache(map, 2);
  assert.deepEqual(JSON.parse(text), { v: DURATION_CACHE_VERSION, d: { b: 20, d: 40 } });
  assert.deepEqual([...parseDurationCache(serializeDurationCache(map)).keys()], ["a", "b", "d"]);
});

test("התור: לכל היותר שתי בדיקות במקביל, כל מזהה פעם אחת, ותקרה לביקור", async () => {
  const calls = [];
  const resolvers = new Map();
  let running = 0;
  let peak = 0;
  const settled = [];
  const probe = createDurationProbe({
    probe: url => {
      calls.push(url);
      running += 1;
      peak = Math.max(peak, running);
      return new Promise(resolve => resolvers.set(url, value => { running -= 1; resolve(value); }));
    },
    concurrency: 2,
    limit: 3,
    onSettle: (id, seconds) => settled.push([id, seconds])
  });
  const items = ["a", "b", "c", "d"].map(id => ({ id, url: `https://x/${id}.mp4` }));
  assert.equal(probe.request(items), 3, "התקרה עוצרת את הרביעי");
  await flush();
  assert.deepEqual(calls, ["https://x/a.mp4", "https://x/b.mp4"]);
  assert.equal(probe.status("a"), "pending");
  assert.equal(probe.status("c"), "pending");
  assert.equal(probe.status("d"), "unprobed");
  assert.equal(probe.pendingCount, 3);
  // בקשה חוזרת לאותם פריטים אינה מוסיפה דבר.
  assert.equal(probe.request(items), 0);

  resolvers.get("https://x/a.mp4")(75);
  await flush();
  await flush();
  assert.equal(probe.status("a"), "known");
  assert.equal(probe.known.get("a"), 75);
  assert.deepEqual(calls, ["https://x/a.mp4", "https://x/b.mp4", "https://x/c.mp4"]);

  resolvers.get("https://x/b.mp4")(0);
  resolvers.get("https://x/c.mp4")(Number.NaN);
  await flush();
  await flush();
  assert.equal(probe.status("b"), "failed");
  assert.equal(probe.status("c"), "failed");
  assert.equal(probe.pendingCount, 0);
  assert.equal(probe.remaining, 0);
  assert.ok(peak <= 2, `במקביל: ${peak}`);
  assert.deepEqual(settled, [["a", 75], ["b", 0], ["c", 0]]);
  // כישלון אינו נבדק שוב באותו ביקור.
  assert.equal(probe.request([{ id: "b", url: "https://x/b.mp4" }]), 0);
});

test("התור: אורך שכבר ידוע (מהמטמון) אינו נבדק, ובדיקה שנזרקה נחשבת לכישלון", async () => {
  const known = new Map([["cached", 30]]);
  const calls = [];
  const probe = createDurationProbe({
    known,
    probe: url => {
      calls.push(url);
      throw new Error("network");
    },
    onSettle: () => { throw new Error("מאזין שבור"); }
  });
  assert.equal(probe.status("cached"), "known");
  assert.equal(probe.request([{ id: "cached", url: "u1" }, { id: "", url: "u2" }, { id: "x", url: "" }, { id: "boom", url: "u3" }]), 1);
  await flush();
  await flush();
  assert.deepEqual(calls, ["u3"]);
  assert.equal(probe.status("boom"), "failed");
  assert.equal(probe.remaining, DURATION_PROBE_LIMIT - 1);
});
