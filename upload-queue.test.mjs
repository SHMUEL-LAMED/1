// תור ההעלאה (upload-queue.js): השהיה גדלה בין ניסיונות, אילו שגיאות מנוסות
// שוב, מקביליות, ביטול לכל קובץ, ניסיון חוזר ידני וסיכום. ההשהיות מדומות —
// הבדיקה רושמת אותן במקום לחכות להן.
import test from "node:test";
import assert from "node:assert/strict";
import {
  UPLOAD_STATES,
  DEFAULT_RETRY,
  retryDelayMs,
  isRetriableUploadError,
  abortableSleep,
  summarizeItems,
  formatUploadSummary,
  createUploadQueue
} from "./upload-queue.js";

function httpError(status, code = "request_failed") {
  const error = new Error(`HTTP ${status}`);
  error.status = status;
  error.code = code;
  return error;
}

// השהיה מדומה שנרשמת ומסתיימת מיד (ונקטעת בביטול כמו האמיתית).
function recordingSleep(delays) {
  return (ms, signal) => {
    delays.push(ms);
    return abortableSleep(0, signal);
  };
}

test("השהיה גדלה: 1, 2, 4, 8 שניות עד התקרה, והרעד נשאר בתחום", () => {
  const exact = attempt => retryDelayMs(attempt, { jitter: 0 });
  assert.deepEqual([1, 2, 3, 4].map(exact), [1000, 2000, 4000, 8000]);
  assert.equal(retryDelayMs(20, { jitter: 0 }), DEFAULT_RETRY.maxDelayMs);
  assert.equal(retryDelayMs(3, { baseDelayMs: 100, maxDelayMs: 250, jitter: 0 }), 250);
  // רעד של 25%: בין 750 ל-1250 לניסיון הראשון.
  assert.equal(retryDelayMs(1, {}, () => 0), 750);
  assert.equal(retryDelayMs(1, {}, () => 1), 1250);
  for (let index = 0; index < 50; index += 1) {
    const value = retryDelayMs(2);
    assert.ok(value >= 1500 && value <= 2500, String(value));
  }
});

test("מה מנוסה שוב: רשת, זמן קצוב, 429 ו-5xx כן; הרשאה, גודל, סוג וביטול לא", () => {
  assert.equal(isRetriableUploadError(new Error("network")), true);
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isRetriableUploadError(httpError(status)), true, String(status));
  assert.equal(isRetriableUploadError(httpError(409, "upload_incomplete")), true);
  for (const status of [400, 401, 403, 404, 409, 413, 415]) assert.equal(isRetriableUploadError(httpError(status)), false, String(status));
  const aborted = new Error("x");
  aborted.name = "AbortError";
  assert.equal(isRetriableUploadError(aborted), false);
  assert.equal(isRetriableUploadError(null), false);
});

test("כשל זמני מנוסה שוב אחרי השהיה, וההעלאה מצליחה; ההתקדמות מדווחת לממשק", async () => {
  const delays = [];
  const changes = [];
  let calls = 0;
  const queue = createUploadQueue({
    sleep: recordingSleep(delays),
    random: () => 0.5,
    onChange: (item, summary) => changes.push([item.id, item.state, Math.round(item.progress * 100), summary.success]),
    run: async (payload, { onProgress, attempt }) => {
      calls += 1;
      onProgress(0.5);
      if (attempt < 3) throw httpError(503);
      onProgress(1);
      return `ok:${payload}`;
    }
  });
  queue.add({ id: "a", payload: "A", size: 10 });
  const summary = await queue.start();
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(summary.success, 1);
  assert.equal(summary.done, true);
  assert.equal(queue.get("a").result, "ok:A");
  assert.equal(queue.get("a").attempts, 3);
  const states = changes.map(change => change[1]);
  assert.ok(states.includes(UPLOAD_STATES.WAITING));
  assert.equal(states.at(-1), UPLOAD_STATES.SUCCESS);
  assert.ok(changes.some(change => change[2] === 50));
});

test("כשל קבוע אינו מנוסה שוב, ומיצוי הניסיונות מסמן כשל; retryFailed מחזיר לתור", async () => {
  const delays = [];
  let allow = false;
  const queue = createUploadQueue({
    sleep: recordingSleep(delays),
    retry: { maxAttempts: 3 },
    run: async payload => {
      if (payload === "big") throw httpError(413);
      if (!allow) throw new Error("offline");
      return true;
    }
  });
  queue.add([{ id: "big", payload: "big" }, { id: "net", payload: "net" }]);
  const first = await queue.start();
  assert.equal(first.error, 2);
  assert.equal(queue.get("big").attempts, 1, "413 אינו מנוסה שוב");
  assert.equal(queue.get("net").attempts, 3);
  assert.equal(delays.length, 2);
  assert.match(formatUploadSummary(first), /נכשלו 2/);

  allow = true;
  assert.equal(queue.retryFailed(), 2);
  const second = await queue.start();
  assert.equal(second.success, 1);
  assert.equal(second.error, 1);
  assert.equal(queue.get("net").state, UPLOAD_STATES.SUCCESS);
});

test("מקביליות: לא יותר משני קבצים בבת אחת, וכל הקבצים מסתיימים", async () => {
  let active = 0;
  let peak = 0;
  const queue = createUploadQueue({
    concurrency: 2,
    run: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
    }
  });
  queue.add(Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, payload: index, size: 100 })));
  const summary = await queue.start();
  assert.equal(peak, 2);
  assert.equal(summary.success, 6);
  assert.equal(summary.progress, 1);
});

test("ביטול: קובץ בתור אינו מתחיל, קובץ פעיל נקטע דרך האות, וקובץ בהמתנה לניסיון חוזר נעצר", async () => {
  const started = [];
  let releaseActive;
  const queue = createUploadQueue({
    concurrency: 1,
    sleep: (ms, signal) => abortableSleep(60_000, signal),
    run: (payload, { signal }) => {
      started.push(payload);
      if (payload === "active") {
        return new Promise((resolve, reject) => {
          releaseActive = resolve;
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      if (payload === "flaky") return Promise.reject(httpError(503));
      return Promise.resolve();
    }
  });
  queue.add([{ id: "active", payload: "active" }, { id: "queued", payload: "queued" }, { id: "flaky", payload: "flaky" }]);
  queue.cancel("queued");
  const running = queue.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(queue.get("active").state, UPLOAD_STATES.ACTIVE);
  assert.equal(queue.cancel("active"), true);
  // הפריט הבא (flaky) נכשל ונכנס להמתנה של דקה — הביטול קוטע אותה.
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(queue.get("flaky").state, UPLOAD_STATES.WAITING);
  queue.cancel("flaky");
  const summary = await running;
  void releaseActive;
  assert.deepEqual(started, ["active", "flaky"]);
  assert.equal(summary.cancelled, 3);
  assert.equal(summary.done, true);
  assert.equal(queue.cancel("active"), false, "ביטול כפול אינו עושה דבר");
  assert.match(formatUploadSummary(summary), /בוטלו 3/);
});

test("השהיית התור: קובץ חדש אינו מתחיל כל עוד התור מושהה", async () => {
  let paused = true;
  const started = [];
  const queue = createUploadQueue({
    waitWhilePaused: async () => { while (paused) await new Promise(resolve => setTimeout(resolve, 2)); },
    run: async payload => { started.push(payload); }
  });
  queue.add({ id: "x", payload: "x" });
  const running = queue.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(started, []);
  paused = false;
  await running;
  assert.deepEqual(started, ["x"]);
});

test("סיכום: התקדמות לפי נפח, קבצים שבוטלו אינם נספרים בנפח, והכיתוב בעברית", () => {
  const items = [
    { state: "success", size: 100, progress: 1 },
    { state: "active", size: 300, progress: 0.5 },
    { state: "cancelled", size: 1000, progress: 0 },
    { state: "queued", size: 100, progress: 0 }
  ];
  const summary = summarizeItems(items);
  assert.equal(summary.bytesTotal, 500);
  assert.equal(summary.bytesDone, 250);
  assert.equal(summary.progress, 0.5);
  assert.equal(summary.done, false);
  assert.equal(formatUploadSummary(summary), "הושלמו 1 מתוך 4 · בתהליך 2 · בוטלו 1");
  assert.equal(formatUploadSummary(summarizeItems([])), "");
});
