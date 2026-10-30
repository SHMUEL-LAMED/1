// "חדש מאז הביקור הקודם" (new-since.js): ביקור ראשון, המשך של אותו ביקור,
// ביקור חדש אחרי הפסקה, הפרדה בין משתמשים, אחסון פגום או חסום, הסיכום לפי
// תיקייה, ובחירת התמונות לתצוגה המקדימה של תיקייה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  beginVisit,
  touchVisit,
  isNewSince,
  newSinceSummary,
  newSinceLabel,
  pickFolderPreviewFrames,
  parseVisitRecord,
  lastVisitStorageKey,
  updatesSeenStorageKey,
  readUpdatesSeen,
  markUpdatesSeen,
  newUpdatesBannerState,
  NEW_UPDATES_DEFAULT_TEXT,
  UPDATES_SEEN_STORAGE_KEY,
  LAST_VISIT_STORAGE_PREFIX,
  VISIT_GAP_MS,
  FOLDER_PREVIEW_FRAMES
} from "./new-since.js";

// localStorage מדומה: Map עם אותו ממשק.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); }
  };
}

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 12);

function item(id, createdAt, extra = {}) {
  return { id, folderId: "1", createdAt, url: `https://example.test/${id}.jpg`, ...extra };
}

test("ביקור ראשון: אין נקודת ייחוס, ושום דבר אינו חדש", () => {
  const storage = memoryStorage();
  assert.equal(beginVisit({ storage, userId: "u1", now: T0 }), 0);
  assert.equal(isNewSince(item("a", T0 + 1), 0), false);
  // הרשומה נכתבה לביקור הבא.
  const record = JSON.parse(storage.map.get(`${LAST_VISIT_STORAGE_PREFIX}:u1`));
  assert.deepEqual(record, { previousVisit: 0, lastSeenAt: T0 });
  // רענון באותו ביקור עדיין אינו מסמן דבר.
  assert.equal(beginVisit({ storage, userId: "u1", now: T0 + 60_000 }), 0);
});

test("ביקור חדש אחרי הפסקה: נקודת הייחוס היא סוף הביקור הקודם", () => {
  const storage = memoryStorage();
  beginVisit({ storage, userId: "u1", now: T0 });
  // הדף נראה עד שעה אחרי הכניסה.
  touchVisit({ storage, userId: "u1", now: T0 + HOUR });
  const since = beginVisit({ storage, userId: "u1", now: T0 + 5 * HOUR });
  assert.equal(since, T0 + HOUR);
  assert.equal(isNewSince(item("old", T0 + HOUR - 1), since), false);
  assert.equal(isNewSince(item("same", T0 + HOUR), since), false);
  assert.equal(isNewSince(item("new", T0 + 2 * HOUR), since), true);
});

test("רענון באמצע הביקור שומר את נקודת הייחוס, כדי שהתגים לא ייעלמו", () => {
  const storage = memoryStorage();
  beginVisit({ storage, userId: "u1", now: T0 });
  const first = beginVisit({ storage, userId: "u1", now: T0 + 3 * HOUR });
  assert.equal(first, T0);
  // סגירת הדף ורענון אחרי כמה דקות — המשך של אותו ביקור.
  touchVisit({ storage, userId: "u1", now: T0 + 3 * HOUR + 10 * 60_000 });
  const again = beginVisit({ storage, userId: "u1", now: T0 + 3 * HOUR + 15 * 60_000 });
  assert.equal(again, first);
  // הפסקה ארוכה מ-VISIT_GAP_MS — ביקור חדש.
  const later = beginVisit({ storage, userId: "u1", now: T0 + 3 * HOUR + 15 * 60_000 + VISIT_GAP_MS + 1 });
  assert.equal(later, T0 + 3 * HOUR + 15 * 60_000);
});

test("כל משתמש לעצמו, ובלי משתמש אין רשומה", () => {
  const storage = memoryStorage();
  beginVisit({ storage, userId: "u1", now: T0 });
  assert.equal(beginVisit({ storage, userId: "u2", now: T0 + 2 * HOUR }), 0);
  assert.equal(beginVisit({ storage, userId: "u1", now: T0 + 2 * HOUR }), T0);
  assert.equal(beginVisit({ storage, userId: "", now: T0 }), 0);
  assert.equal(touchVisit({ storage, userId: null, now: T0 }), false);
  assert.equal(lastVisitStorageKey(""), "");
  // מזהה עם תווים חריגים מנוקה, כמו בשאר המפתחות באתר.
  assert.equal(lastVisitStorageKey("a/b:c"), `${LAST_VISIT_STORAGE_PREFIX}:abc`);
  assert.deepEqual([...storage.map.keys()].sort(), [`${LAST_VISIT_STORAGE_PREFIX}:u1`, `${LAST_VISIT_STORAGE_PREFIX}:u2`]);
});

test("אחסון חסום, מלא או פגום אינו זורק ואינו מסמן", () => {
  const throwing = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("QuotaExceededError"); }
  };
  assert.equal(beginVisit({ storage: throwing, userId: "u1", now: T0 }), 0);
  assert.equal(touchVisit({ storage: throwing, userId: "u1", now: T0 }), false);
  assert.equal(beginVisit({ storage: null, userId: "u1", now: T0 }), 0);

  const key = lastVisitStorageKey("u1");
  for (const text of ["not json", "null", "[]", '{"lastSeenAt":"x"}', JSON.stringify({ lastSeenAt: T0 + 10 * HOUR })]) {
    const storage = memoryStorage({ [key]: text });
    assert.equal(beginVisit({ storage, userId: "u1", now: T0 }), 0, text);
  }
  // נקודת ייחוס אחרי lastSeenAt אינה הגיונית — מתאפסת.
  assert.deepEqual(parseVisitRecord(JSON.stringify({ previousVisit: T0 + 1, lastSeenAt: T0 }), T0), { previousVisit: 0, lastSeenAt: T0 });
});

test("הסיכום: ספירה בלי כפילויות, תיקיות, והאם הרשימה הקטנה מכסה הכול", () => {
  const since = T0;
  const latest = [item("n1", T0 + 3, { folderId: "2" }), item("n2", T0 + 2), item("o1", T0 - 1, { folderId: "3" })];
  const loaded = [item("n2", T0 + 2), item("n3", T0 + 1, { folderId: "4" }), item("o2", T0 - 5)];
  const summary = newSinceSummary([latest, loaded], since, { latest });
  assert.equal(summary.count, 3);
  assert.deepEqual([...summary.folderIds].sort(), ["1", "2", "4"]);
  assert.equal(summary.newest, T0 + 3);
  assert.equal(summary.complete, true);

  // כל "החדשות ביותר" חדשות — ייתכן שיש עוד מעבר לגבול השאילתה.
  const allNew = [item("n1", T0 + 3), item("n2", T0 + 2)];
  assert.equal(newSinceSummary([allNew], since, { latest: allNew }).complete, false);
  // ...אלא אם השרת אמר שאין אחריה עוד: ארכיון קטן שכולו חדש.
  assert.equal(newSinceSummary([allNew], since, { latest: allNew, latestHasMore: false }).complete, true);
  assert.equal(newSinceSummary([allNew], since, { latest: allNew, latestHasMore: true }).complete, false);
  // בלי נקודת ייחוס — אפס.
  const none = newSinceSummary([latest], 0, { latest });
  assert.equal(none.count, 0);
  assert.equal(none.folderIds.size, 0);
});

test("טקסט הבאנר: יחיד, רבים, וגבול תחתון כשהרשימה הקטנה חדשה כולה", () => {
  assert.equal(newSinceLabel({ count: 0 }), "");
  assert.equal(newSinceLabel({ count: 1, complete: true }), "נוסף פריט אחד מאז הביקור הקודם שלך.");
  assert.equal(newSinceLabel({ count: 5, complete: true }), "נוספו 5 פריטים מאז הביקור הקודם שלך.");
  assert.equal(newSinceLabel({ count: 24, complete: false }), "נוספו 24 ויותר פריטים מאז הביקור הקודם שלך.");
});

test('"סגור" על הבאנר נשמר לכל משתמש לעצמו; המפתח הגלובלי הישן רק בלי משתמש', () => {
  assert.equal(updatesSeenStorageKey("u1"), `${UPDATES_SEEN_STORAGE_KEY}:u1`);
  assert.equal(updatesSeenStorageKey("a/b:c"), `${UPDATES_SEEN_STORAGE_KEY}:abc`);
  assert.equal(updatesSeenStorageKey(""), UPDATES_SEEN_STORAGE_KEY);
  assert.equal(updatesSeenStorageKey(null), UPDATES_SEEN_STORAGE_KEY);

  // ערך ישן במפתח הגלובלי אינו חל על משתמש מחובר.
  const storage = memoryStorage({ [UPDATES_SEEN_STORAGE_KEY]: String(T0) });
  assert.equal(readUpdatesSeen({ storage, userId: "u1" }), 0);
  assert.equal(readUpdatesSeen({ storage, userId: "" }), T0);

  assert.equal(markUpdatesSeen({ storage, userId: "u1", now: T0 + HOUR }), true);
  assert.equal(readUpdatesSeen({ storage, userId: "u1" }), T0 + HOUR);
  // משתמש אחד שסגר אינו מסתיר את הבאנר של אחר.
  assert.equal(readUpdatesSeen({ storage, userId: "u2" }), 0);
  assert.equal(storage.map.get(UPDATES_SEEN_STORAGE_KEY), String(T0));

  // אחסון חסום, חסר או פגום אינו זורק.
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(readUpdatesSeen({ storage: throwing, userId: "u1" }), 0);
  assert.equal(markUpdatesSeen({ storage: throwing, userId: "u1", now: T0 }), false);
  assert.equal(readUpdatesSeen({ storage: null, userId: "u1" }), 0);
  assert.equal(markUpdatesSeen({ storage: null, userId: "u1", now: T0 }), false);
  assert.equal(readUpdatesSeen({ storage: memoryStorage({ [`${UPDATES_SEEN_STORAGE_KEY}:u1`]: "garbage" }), userId: "u1" }), 0);
});

test("מצב הבאנר: תמיד עם טקסט, ומוסתר כשאף תנאי אינו מתקיים", () => {
  const summary = { count: 2, newest: T0 - HOUR, complete: true };
  // ביקור חוזר עם פריטים חדשים שלא נסגרו.
  assert.deepEqual(newUpdatesBannerState({ since: T0 - 5 * HOUR, summary, lastSeen: 0, now: T0 }),
    { visible: true, text: "נוספו 2 פריטים מאז הביקור הקודם שלך." });
  // המשתמש כבר סגר אחרי החדש ביותר: מוסתר, והטקסט חוזר לברירת המחדל.
  assert.deepEqual(newUpdatesBannerState({ since: T0 - 5 * HOUR, summary, lastSeen: T0, now: T0 }),
    { visible: false, text: NEW_UPDATES_DEFAULT_TEXT });
  // ביקור חוזר בלי שום דבר חדש.
  assert.deepEqual(newUpdatesBannerState({ since: T0 - 5 * HOUR, summary: { count: 0, newest: 0 }, now: T0 }),
    { visible: false, text: NEW_UPDATES_DEFAULT_TEXT });
  // ביקור ראשון: "השבוע האחרון", תמיד עם טקסט ברירת המחדל.
  assert.deepEqual(newUpdatesBannerState({ since: 0, newest: T0 - HOUR, lastSeen: 0, now: T0 }),
    { visible: true, text: NEW_UPDATES_DEFAULT_TEXT });
  assert.equal(newUpdatesBannerState({ since: 0, newest: T0 - 8 * 24 * HOUR, now: T0 }).visible, false);
  assert.equal(newUpdatesBannerState({ since: 0, newest: T0 - HOUR, lastSeen: T0, now: T0 }).visible, false);
  assert.deepEqual(newUpdatesBannerState(), { visible: false, text: NEW_UPDATES_DEFAULT_TEXT });
  // טקסט ברירת המחדל הוא זה שבבאנר ב-index.html, שאליו האיפוס מחזיר.
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`<p id="newUpdatesBannerText" class="text-[11px] leading-tight text-slate-400">${NEW_UPDATES_DEFAULT_TEXT}</p>`));
});

test("תצוגה מקדימה של תיקייה: האחרונות, בלי כפילויות, עם התצוגה הקטנה", () => {
  const withThumb = id => ({
    variants: { thumb: { url: `https://example.test/variants/${id}/thumb.webp`, width: 480, height: 320 } },
    variantsVersion: 1
  });
  const lists = [
    [item("a", 5, withThumb("a")), item("b", 9), item("x", 20, { folderId: "2" })],
    [item("a", 5, withThumb("a")), item("c", 7, withThumb("c")), item("d", 1), item("e", 3), item("f", 2)]
  ];
  const frames = pickFolderPreviewFrames(lists, "1");
  assert.equal(frames.length, FOLDER_PREVIEW_FRAMES);
  assert.deepEqual(frames.map(frame => frame.id), ["b", "c", "a", "e"]);
  assert.equal(frames[1].url, "https://example.test/variants/c/thumb.webp");
  assert.equal(frames[1].isVariant, true);
  assert.equal(frames[0].isVariant, false);

  // "all" — מכל התיקיות; limit קובע כמה.
  assert.deepEqual(pickFolderPreviewFrames(lists, "all", { limit: 2 }).map(frame => frame.id), ["x", "b"]);
  // סרטון בלי פוסטר ובלי תצוגה אינו מקבל מסגרת.
  const video = item("v", 50, { mediaType: "video", url: "https://example.test/v.mp4" });
  assert.deepEqual(pickFolderPreviewFrames([[video]], "1"), []);
  // מקור שאינו https נפסל, אלא אם הגלריה מעבירה ניקוי משלה.
  assert.deepEqual(pickFolderPreviewFrames([[item("h", 1, { url: "http://example.test/h.jpg" })]], "1"), []);
  assert.equal(pickFolderPreviewFrames([[item("h", 1, { url: "blob:local" })]], "1", { sanitize: value => value }).length, 1);
  assert.deepEqual(pickFolderPreviewFrames(lists, ""), []);
});
