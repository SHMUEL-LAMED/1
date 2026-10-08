// מכונת המצבים של ההעלאה בחלקים (upload-resumable.js): חלוקה לחלקים, טביעת
// קובץ, והמשך מהחלק האחרון אחרי ניתוק, ניסיון חוזר או "רענון" — מול Worker
// מדומה בזיכרון שמתנהג כמו נתיבי /upload/multipart/*.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RESUMABLE_PART_SIZE,
  shouldUseResumableUpload,
  planParts,
  pendingParts,
  uploadedBytes,
  fingerprintFile,
  createMemoryStore,
  findSavedUpload,
  listSavedUploads,
  uploadResumable,
  abortResumableUpload,
  RESUMABLE_STATE_TTL_MS
} from "./upload-resumable.js";

const PART = 1000;

function makeBlob(size, seed = 1) {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * seed) % 251;
  return new Blob([bytes], { type: "video/mp4" });
}

// Worker מדומה: אותו חוזה כמו resumableUploadApi שב-app.js.
function fakeApi({ partSize = PART } = {}) {
  const uploads = new Map();
  const calls = [];
  let counter = 0;
  let failPart = null;
  const api = {
    calls,
    uploads,
    failOn(partNumber, times = 1) { failPart = { partNumber, times }; },
    async create(meta) {
      calls.push(["create", meta.imageId]);
      counter += 1;
      const uploadId = `u${counter}`;
      uploads.set(uploadId, { meta, parts: new Map(), status: "uploading", partSize });
      return { uploadId, partSize, key: `approved/u/${meta.imageId}.mp4`, imageId: meta.imageId };
    },
    async status(uploadId) {
      calls.push(["status", uploadId]);
      const upload = uploads.get(uploadId);
      if (!upload) { const error = new Error("not found"); error.status = 404; throw error; }
      return { uploadId, partSize: upload.partSize, status: upload.status, parts: [...upload.parts.keys()].map(partNumber => ({ partNumber, etag: `e${partNumber}` })) };
    },
    async uploadPart(uploadId, partNumber, blob, { onProgress } = {}) {
      calls.push(["part", partNumber]);
      if (failPart && failPart.partNumber === partNumber && failPart.times > 0) {
        failPart.times -= 1;
        onProgress?.(0.5);
        const error = new Error("network down");
        throw error;
      }
      const upload = uploads.get(uploadId);
      upload.parts.set(partNumber, new Uint8Array(await blob.arrayBuffer()));
      onProgress?.(1);
      return { partNumber, etag: `e${partNumber}` };
    },
    async complete(uploadId, extras) {
      calls.push(["complete", uploadId]);
      const upload = uploads.get(uploadId);
      if (upload.status === "completed") return { ...upload.result };
      const ordered = [...upload.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, bytes]) => bytes);
      upload.bytes = new Uint8Array(ordered.reduce((sum, bytes) => sum + bytes.length, 0));
      let offset = 0;
      for (const bytes of ordered) { upload.bytes.set(bytes, offset); offset += bytes.length; }
      upload.status = "completed";
      upload.extras = typeof extras === "function" ? "appender" : extras;
      upload.result = { success: true, key: `approved/u/${upload.meta.imageId}.mp4`, url: `https://api/media/${upload.meta.imageId}` };
      return { ...upload.result };
    },
    async abort(uploadId) {
      calls.push(["abort", uploadId]);
      uploads.delete(uploadId);
    }
  };
  return api;
}

test("חלוקה לחלקים: כל החלקים באותו גודל מלבד האחרון, והספירה של מה שנשאר", () => {
  assert.deepEqual(planParts(2500, 1000), [
    { partNumber: 1, start: 0, end: 1000 },
    { partNumber: 2, start: 1000, end: 2000 },
    { partNumber: 3, start: 2000, end: 2500 }
  ]);
  assert.equal(planParts(1000, 1000).length, 1);
  assert.equal(planParts(RESUMABLE_PART_SIZE * 3 + 1).length, 4);
  assert.throws(() => planParts(0, 1000));
  assert.throws(() => planParts(10, 0));
  const plan = planParts(2500, 1000);
  assert.deepEqual(pendingParts(plan, [1, 3]).map(part => part.partNumber), [2]);
  assert.equal(uploadedBytes(plan, [1, 3]), 1500);
  assert.equal(shouldUseResumableUpload(RESUMABLE_PART_SIZE), false);
  assert.equal(shouldUseResumableUpload(RESUMABLE_PART_SIZE + 1), true);
});

test("טביעת קובץ: יציבה לאותו קובץ, שונה לתוכן, לשם, לתאריך או למשתמש אחר", async () => {
  const bytes = new Uint8Array(600 * 1024).map((_, index) => index % 7);
  const file = new File([bytes], "a.mp4", { type: "video/mp4", lastModified: 1000 });
  const same = new File([bytes], "a.mp4", { type: "video/mp4", lastModified: 1000 });
  const first = await fingerprintFile(file, "uid-1");
  assert.match(first, /^rf1:[0-9a-f]{64}$/);
  assert.equal(await fingerprintFile(same, "uid-1"), first);
  const changedTail = bytes.slice();
  changedTail[changedTail.length - 1] = 99;
  assert.notEqual(await fingerprintFile(new File([changedTail], "a.mp4", { type: "video/mp4", lastModified: 1000 }), "uid-1"), first);
  assert.notEqual(await fingerprintFile(new File([bytes], "b.mp4", { type: "video/mp4", lastModified: 1000 }), "uid-1"), first);
  assert.notEqual(await fingerprintFile(new File([bytes], "a.mp4", { type: "video/mp4", lastModified: 2000 }), "uid-1"), first);
  assert.notEqual(await fingerprintFile(file, "uid-2"), first);
});

test("העלאה מלאה: create, כל החלקים לפי הסדר, complete — והמצב השמור נמחק", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(2500);
  const progress = [];
  const result = await uploadResumable({
    blob, fingerprint: "fp-1", meta: { imageId: "vid-1", mimeType: "video/mp4" }, api, store,
    onProgress: fraction => progress.push(fraction)
  });
  assert.deepEqual(api.calls, [["create", "vid-1"], ["part", 1], ["part", 2], ["part", 3], ["complete", "u1"]]);
  assert.equal(result.imageId, "vid-1");
  assert.equal(result.resumed, false);
  assert.deepEqual(api.uploads.get("u1").bytes, new Uint8Array(await blob.arrayBuffer()));
  assert.equal(progress.at(-1), 1);
  for (let index = 1; index < progress.length; index += 1) assert.ok(progress[index] >= progress[index - 1], "ההתקדמות אינה יורדת");
  assert.equal(await store.get("fp-1"), null);
});

test("ניתוק באמצע: המצב נשמר, והניסיון הבא ממשיך מהחלק שנכשל בלי create חדש", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(2500);
  api.failOn(2);
  await assert.rejects(uploadResumable({ blob, fingerprint: "fp-2", meta: { imageId: "vid-2" }, api, store }), /network down/);
  const saved = await store.get("fp-2");
  assert.equal(saved.uploadId, "u1");
  assert.equal(saved.imageId, "vid-2");
  assert.deepEqual(saved.completedParts, [1]);

  api.calls.length = 0;
  const progress = [];
  const result = await uploadResumable({ blob, fingerprint: "fp-2", meta: { imageId: "vid-2" }, api, store, onProgress: value => progress.push(value) });
  assert.deepEqual(api.calls, [["status", "u1"], ["part", 2], ["part", 3], ["complete", "u1"]]);
  assert.equal(result.resumed, true);
  assert.equal(progress[0], 0.4, "ההתקדמות מתחילה ממה שכבר עלה");
  assert.deepEqual(api.uploads.get("u1").bytes, new Uint8Array(await blob.arrayBuffer()));
  assert.equal(await store.get("fp-2"), null);
});

test("אחרי רענון: המזהה השמור מוחזר לפי הטביעה, וה-Worker הוא המקור לחלקים שהתקבלו", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(3500);
  api.failOn(3);
  await assert.rejects(uploadResumable({ blob, fingerprint: "fp-3", meta: { imageId: "vid-3", fileName: "סרטון.mp4", scope: "uid-1" }, api, store }));
  // "הדף רוענן": תור ההעלאה מחפש העלאה שמורה לפני שהוא מקצה מזהה חדש.
  const saved = await findSavedUpload("fp-3", { store });
  assert.equal(saved.imageId, "vid-3");
  assert.deepEqual((await listSavedUploads({ store, scope: "uid-1" })).map(item => item.name), ["סרטון.mp4"]);
  assert.deepEqual(await listSavedUploads({ store, scope: "uid-2" }), []);
  // הדפדפן "שכח" שחלק 2 התקבל (נסגר לפני שנשמר) — ה-Worker יודע, ולכן הוא לא נשלח שוב.
  await store.set("fp-3", { ...saved, completedParts: [1] });
  api.calls.length = 0;
  await uploadResumable({ blob, fingerprint: "fp-3", meta: { imageId: saved.imageId }, api, store });
  assert.deepEqual(api.calls.map(call => call.join(":")), ["status:u1", "part:3", "part:4", "complete:u1"]);
});

test("העלאה שפג תוקפה ב-Worker (404) מתחילה מחדש; מצב שמור ישן מדי נזנח", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(1500);
  await store.set("fp-4", { uploadId: "gone", imageId: "vid-4", size: 1500, partSize: PART, completedParts: [1], createdAt: Date.now(), updatedAt: Date.now() });
  const result = await uploadResumable({ blob, fingerprint: "fp-4", meta: { imageId: "vid-4" }, api, store });
  assert.deepEqual(api.calls.map(call => call[0]), ["status", "create", "part", "part", "complete"]);
  assert.equal(result.resumed, false);

  await store.set("fp-old", { uploadId: "u-old", imageId: "x", updatedAt: Date.now() - RESUMABLE_STATE_TTL_MS - 1 });
  assert.equal(await findSavedUpload("fp-old", { store }), null);
  assert.equal(await store.get("fp-old"), null);
});

test("השלמה שהצליחה אך התשובה אבדה: הניסיון הבא מקבל את התוצאה בלי לשלוח חלקים", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(1500);
  const realComplete = api.complete;
  let lose = true;
  api.complete = async (...args) => {
    const result = await realComplete(...args);
    if (lose) { lose = false; throw new Error("response lost"); }
    return result;
  };
  await assert.rejects(uploadResumable({ blob, fingerprint: "fp-5", meta: { imageId: "vid-5" }, api, store }), /response lost/);
  api.calls.length = 0;
  const result = await uploadResumable({ blob, fingerprint: "fp-5", meta: { imageId: "vid-5" }, api, store });
  assert.deepEqual(api.calls.map(call => call[0]), ["status", "complete"]);
  assert.equal(result.key, "approved/u/vid-5.mp4");
  assert.equal(result.imageId, "vid-5");
});

test("ביטול: אות שנקטע עוצר לפני החלק הבא, וביטול מפורש מוחק את ההעלאה בשרת ובדפדפן", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  const blob = makeBlob(3000);
  const controller = new AbortController();
  const originalPart = api.uploadPart;
  api.uploadPart = async (...args) => {
    const result = await originalPart(...args);
    if (args[1] === 1) controller.abort();
    return result;
  };
  await assert.rejects(
    uploadResumable({ blob, fingerprint: "fp-6", meta: { imageId: "vid-6" }, api, store, signal: controller.signal }),
    error => error.name === "AbortError"
  );
  assert.deepEqual(api.calls.map(call => call.join(":")), ["create:vid-6", "part:1"]);
  assert.ok(await store.get("fp-6"), "ביטול אות בלבד משאיר את המצב להמשך");

  assert.equal(await abortResumableUpload("fp-6", { api, store }), true);
  assert.deepEqual(api.calls.at(-1), ["abort", "u1"]);
  assert.equal(await store.get("fp-6"), null);
  assert.equal(await abortResumableUpload("fp-6", { api, store }), false);
});

test("התצוגות המקדימות נוצרות רק לקראת ההשלמה ומצורפות אליה", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  let generated = 0;
  await uploadResumable({
    blob: makeBlob(1200), fingerprint: "fp-7", meta: { imageId: "vid-7" }, api, store,
    completeExtras: async () => { generated += 1; return () => {}; }
  });
  assert.equal(generated, 1);
  assert.equal(api.uploads.get("u1").extras, "appender");
});

test("מצב שמור של קובץ בגודל אחר אינו משמש להמשך", async () => {
  const api = fakeApi();
  const store = createMemoryStore();
  await store.set("fp-8", { uploadId: "u-x", imageId: "vid-8", size: 999, partSize: PART, createdAt: Date.now(), updatedAt: Date.now() });
  await uploadResumable({ blob: makeBlob(1200), fingerprint: "fp-8", meta: { imageId: "vid-8" }, api, store });
  assert.equal(api.calls[0][0], "create");
});
