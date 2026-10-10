// חיפושים אחרונים ושמורים (search-history.js): כפילויות, תקרה, סדר, הפרדה בין
// משתמשים, אחסון פגום או חסום, שמירה בכוכב והמיזוג עם הרשימה מהענן.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSearchHistoryStore,
  normalizeFilters,
  normalizeSearch,
  searchId,
  searchSignature,
  storageKeyFor,
  userStorageKey,
  parseHistoryState,
  describeSearch,
  SEARCH_HISTORY_STORAGE_PREFIX,
  ANONYMOUS_USER_KEY,
  RECENT_SEARCH_LIMIT,
  SAVED_SEARCH_LIMIT,
  RECENT_COLLAPSE_MS
} from "./search-history.js";

// localStorage מדומה: Map עם אותו ממשק.
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}

function clock(start = Date.UTC(2026, 9, 10, 12)) {
  let time = start;
  const now = () => time;
  now.advance = ms => { time += ms; };
  return now;
}

// כל הוספה מתקדמת דקה וחצי — מעבר לחלון האיחוד של המשך הקלדה.
function addAll(store, now, queries) {
  for (const query of queries) {
    now.advance(RECENT_COLLAPSE_MS + 30_000);
    store.addRecent({ query });
  }
}

test("חיפוש אחרון: החדש ראשון, וכפילות עולה לראש בלי להיספר פעמיים", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  addAll(store, now, ["ברכה", "סעודה", "ריקודים"]);
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["ריקודים", "סעודה", "ברכה"]);

  // אותו חיפוש — גם עם רווחים ורישיות אחרים — אינו נוסף שוב אלא עולה לראש.
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "  ברכה " });
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["ברכה", "ריקודים", "סעודה"]);
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "Simcha" });
  store.addRecent({ query: "simcha" });
  assert.equal(store.getRecent().filter(entry => entry.query.toLowerCase() === "simcha").length, 1);
});

test("אותו טקסט עם סינון אחר הוא חיפוש אחר; אותו סינון בסדר אחר — אותו חיפוש", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  store.addRecent({ query: "ברכה", filters: { folderId: "2" } });
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "ברכה", filters: { folderId: "3", mediaType: "video" } });
  assert.equal(store.getRecent().length, 2);

  assert.equal(
    searchId({ query: "ברכה", filters: { tags: ["ב", "א"], mediaType: "video" } }),
    searchId({ query: "ברכה ", filters: { mediaType: "video", tags: ["א", "ב", "א"] } })
  );
  // "כל התמונות" אינה סינון.
  assert.equal(searchId({ query: "x", filters: { folderId: "all" } }), searchId({ query: "x" }));
});

test("תקרה של עשרה חיפושים אחרונים: הישן ביותר נופל", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  const queries = Array.from({ length: RECENT_SEARCH_LIMIT + 3 }, (_, index) => `חיפוש ${index + 1}`);
  addAll(store, now, queries);
  const recent = store.getRecent();
  assert.equal(RECENT_SEARCH_LIMIT, 10);
  assert.equal(recent.length, RECENT_SEARCH_LIMIT);
  assert.equal(recent[0].query, "חיפוש 13");
  assert.equal(recent.at(-1).query, "חיפוש 4");
});

test("המשך הקלדה תוך דקה מחליף את החיפוש הקודם במקום להוסיף שלב", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  store.addRecent({ query: "בר" });
  now.advance(5_000);
  store.addRecent({ query: "בר מצווה" });
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["בר מצווה"]);
  // אחרי חלון הזמן — חיפוש חדש נשמר לצד הקודם.
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "בר מצווה של יוסי" });
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["בר מצווה של יוסי", "בר מצווה"]);
  // חיפוש שאינו המשך — לא מחליף.
  now.advance(1_000);
  store.addRecent({ query: "סיום" });
  assert.equal(store.getRecent().length, 3);
});

test("כל משתמש מקבל מפתח נפרד, ומי שאינו מחובר — מפתח אנונימי", () => {
  const storage = memoryStorage();
  const now = clock();
  const first = createSearchHistoryStore({ storage, userId: "google-user-1", now });
  const second = createSearchHistoryStore({ storage, userId: "google-user-2", now });
  const anonymous = createSearchHistoryStore({ storage, userId: "", now });
  first.addRecent({ query: "של הראשון" });
  first.saveSearch({ query: "של הראשון" });
  second.addRecent({ query: "של השני" });
  anonymous.addRecent({ query: "של האורח" });

  assert.deepEqual(first.getRecent().map(entry => entry.query), ["של הראשון"]);
  assert.deepEqual(second.getRecent().map(entry => entry.query), ["של השני"]);
  assert.deepEqual(second.getSaved(), []);
  assert.deepEqual(anonymous.getRecent().map(entry => entry.query), ["של האורח"]);
  assert.deepEqual([...storage.map.keys()].sort(), [
    `${SEARCH_HISTORY_STORAGE_PREFIX}:${ANONYMOUS_USER_KEY}`,
    `${SEARCH_HISTORY_STORAGE_PREFIX}:google-user-1`,
    `${SEARCH_HISTORY_STORAGE_PREFIX}:google-user-2`
  ]);
  // מזהה משתמש עם תווים חריגים אינו בורח מהמרחב שלו.
  assert.equal(storageKeyFor("a:b/../c"), `${SEARCH_HISTORY_STORAGE_PREFIX}:abc`);
  assert.equal(userStorageKey(null), ANONYMOUS_USER_KEY);
  assert.equal(userStorageKey("::"), ANONYMOUS_USER_KEY);
});

test("אחסון פגום: JSON שבור, גרסה זרה ורשומות פסולות אינם מפילים דבר", () => {
  const key = storageKeyFor("u1");
  for (const corrupted of ["{not json", "null", "[]", "42", JSON.stringify({ v: 99, recent: [{ query: "x" }] })]) {
    const storage = memoryStorage({ [key]: corrupted });
    const store = createSearchHistoryStore({ storage, userId: "u1", now: clock() });
    assert.deepEqual(store.getRecent(), [], `תוכן פגום: ${corrupted}`);
    assert.deepEqual(store.getSaved(), []);
    // הכתיבה הבאה מחליפה את הפגום בתוכן תקין.
    store.addRecent({ query: "חדש" });
    assert.equal(JSON.parse(storage.getItem(key)).recent[0].query, "חדש");
    assert.equal(store.persistent, true);
  }

  const mixed = JSON.stringify({
    v: 1,
    recent: [
      { query: "תקין", filters: { folderId: "2", hebrewYear: 5785, hebrewMonth: "adar2", mediaType: "video" }, at: 5 },
      null, "מחרוזת", { query: "" }, { query: 12345 }, { query: { evil: true } },
      { query: "סינון פסול", filters: { folderId: "<script>", hebrewYear: 99999, hebrewMonth: "march", mediaType: "pdf", tags: "x" }, at: "NaN" },
      { query: "תקין", filters: { mediaType: "video", hebrewMonth: "adar2", hebrewYear: 5785, folderId: "2" }, at: 9 }
    ],
    saved: { not: "an array" },
    savedUpdatedAt: "x"
  });
  const store = createSearchHistoryStore({ storage: memoryStorage({ [key]: mixed }), userId: "u1", now: clock() });
  const recent = store.getRecent();
  assert.deepEqual(recent.map(entry => entry.query), ["תקין", "12345", "סינון פסול"]);
  assert.deepEqual(recent[0].filters, { folderId: "2", hebrewYear: 5785, hebrewMonth: "adar2", mediaType: "video" });
  assert.deepEqual(recent[2].filters, { folderId: "script" });
  assert.equal(recent[2].at, 0);
  assert.deepEqual(store.getSaved(), []);
  assert.deepEqual(parseHistoryState(undefined).recent, []);
});

test("אחסון חסום: קריאה וכתיבה שזורקות — הרשימה עובדת בזיכרון ומדווחת שאינה נשמרת", () => {
  const blocked = {
    getItem() { throw new DOMException("blocked", "SecurityError"); },
    setItem() { throw new DOMException("blocked", "SecurityError"); }
  };
  const store = createSearchHistoryStore({ storage: blocked, userId: "u1", now: clock() });
  assert.doesNotThrow(() => store.addRecent({ query: "בזיכרון" }));
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["בזיכרון"]);
  assert.equal(store.persistent, false);
  assert.equal(store.saveSearch({ query: "בזיכרון" }).ok, true);
  assert.equal(store.isSaved(searchId({ query: "בזיכרון" })), true);

  // אין localStorage בכלל (null), או שהגישה אליו עצמה זורקת.
  const none = createSearchHistoryStore({ storage: null, userId: "u1", now: clock() });
  none.addRecent({ query: "א" });
  assert.equal(none.getRecent().length, 1);
  assert.equal(none.persistent, false);

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  try {
    const fallback = createSearchHistoryStore({ userId: "u1", now: clock() });
    assert.doesNotThrow(() => fallback.addRecent({ query: "ב" }));
    assert.equal(fallback.getRecent()[0].query, "ב");
    assert.equal(fallback.persistent, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("מכסה מלאה: כתיבה שנכשלה אינה נמחקת בקריאה הבאה מהאחסון הישן", () => {
  const storage = memoryStorage();
  const now = clock();
  const store = createSearchHistoryStore({ storage, userId: "u1", now });
  store.addRecent({ query: "לפני" });
  storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "אחרי" });
  assert.deepEqual(store.getRecent().map(entry => entry.query), ["אחרי", "לפני"]);
  assert.equal(store.persistent, false);
});

test("שתי לשוניות: כל פעולה קוראת מחדש מהאחסון ואינה דורסת את האחרת", () => {
  const storage = memoryStorage();
  const now = clock();
  const tabA = createSearchHistoryStore({ storage, userId: "u1", now });
  const tabB = createSearchHistoryStore({ storage, userId: "u1", now });
  tabA.addRecent({ query: "מלשונית א" });
  now.advance(RECENT_COLLAPSE_MS + 1);
  tabB.addRecent({ query: "מלשונית ב" });
  assert.deepEqual(tabA.getRecent().map(entry => entry.query), ["מלשונית ב", "מלשונית א"]);
});

test("כוכב: שמירה, ביטול, הסרה, ניקוי ותקרה", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  const search = { query: "ריקודים", filters: { mediaType: "video" } };
  store.addRecent(search);
  assert.equal(store.toggleSaved(search).saved, true);
  assert.equal(store.isSaved(search), true);
  assert.equal(store.getSaved()[0].query, "ריקודים");
  // שמירה חוזרת אינה יוצרת כפילות.
  assert.equal(store.saveSearch(search).existed, true);
  assert.equal(store.getSaved().length, 1);
  assert.equal(store.toggleSaved(searchId(search)).saved, false);
  assert.equal(store.getSaved().length, 0);
  assert.equal(store.getRecent().length, 1, "ביטול הכוכב משאיר את החיפוש באחרונים");

  // חיפוש בלי טקסט אינו נשמר.
  assert.deepEqual(store.saveSearch({ query: "", filters: { mediaType: "video" } }), { ok: false, reason: "empty" });

  // ניקוי האחרונים משאיר את השמורים; הסרה מורידה משתי הרשימות.
  store.saveSearch(search);
  now.advance(RECENT_COLLAPSE_MS + 1);
  store.addRecent({ query: "אחר" });
  store.clearRecent();
  assert.deepEqual(store.getRecent(), []);
  assert.equal(store.getSaved().length, 1);
  store.addRecent(search);
  assert.equal(store.removeSearch(searchId(search)), true);
  assert.deepEqual(store.getRecent(), []);
  assert.deepEqual(store.getSaved(), []);
  assert.equal(store.removeRecent("missing"), false);

  for (let index = 0; index < SAVED_SEARCH_LIMIT; index += 1) {
    assert.equal(store.saveSearch({ query: `שמור ${index}` }).ok, true);
  }
  assert.deepEqual(store.saveSearch({ query: "אחד יותר מדי" }), { ok: false, reason: "limit" });
  assert.equal(store.getSaved().length, SAVED_SEARCH_LIMIT);
  store.clearAll();
  assert.deepEqual(store.getSaved(), []);
  assert.deepEqual(store.getRecent(), []);
});

test("סינונים: רק ערכים תקינים, בצורה קבועה, ובלי 'כל התמונות'", () => {
  assert.deepEqual(normalizeFilters({ folderId: "all", hebrewYear: "5786", hebrewMonth: "tishrei", mediaType: "image", tags: [" בר  מצווה ", "", 7, "בר מצווה"] }),
    { hebrewYear: 5786, hebrewMonth: "tishrei", mediaType: "image", tags: ["7", "בר מצווה"] });
  assert.deepEqual(normalizeFilters({ hebrewYear: 5786.5, hebrewMonth: "Tishrei", mediaType: "VIDEO" }), {});
  assert.deepEqual(normalizeFilters(null), {});
  assert.deepEqual(normalizeFilters({ tags: Array.from({ length: 20 }, (_, index) => `t${String(index).padStart(2, "0")}`) }).tags.length, 10);
  assert.equal(normalizeSearch({ query: "   " }), null);
  assert.deepEqual(normalizeSearch({ query: "", filters: { folderId: "favorites" } }), { query: "", filters: { folderId: "favorites" } });
  assert.equal(normalizeSearch({ query: "x".repeat(500) }).query.length, 120);
  assert.equal(searchSignature(null), "");
});

test("תיאור החיפוש בעברית: תיקייה, שנה, חודש, סוג ותגיות", () => {
  const description = describeSearch(
    { query: "ריקודים", filters: { folderId: "2", hebrewYear: 5784, hebrewMonth: "adar2", mediaType: "video", tags: ["שמחה"] } },
    { folderName: id => (id === "2" ? "טיולים וסיורים" : "") }
  );
  assert.equal(description.query, "ריקודים");
  assert.deepEqual(description.details, ["תיקייה: טיולים וסיורים", "שנת תשפ״ד", "חודש אדר ב׳", "סרטונים בלבד", "תגיות: שמחה"]);
  assert.deepEqual(describeSearch({ query: "x", filters: { folderId: "9" } }).details, ["תיקייה: תיקייה שאינה קיימת עוד"]);
  assert.deepEqual(describeSearch({ query: "x", filters: { folderId: "favorites" } }).details, ["המועדפים"]);
});

test("סנכרון עם הענן: איחוד בפעם הראשונה, ואחר כך המאוחר גובר", () => {
  const now = clock();
  const store = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  store.saveSearch({ query: "מקומי" });

  // הענן מכיר חיפוש אחר: בפעם הראשונה — איחוד, ודחיפה כי הענן חסר את המקומי.
  now.advance(1000);
  const remote = { savedSearches: [{ query: "מהענן", savedAt: now() - 500 }], savedSearchesUpdatedAt: now() - 500 };
  assert.deepEqual(store.mergeRemoteSaved(remote), { changed: true, push: true });
  assert.deepEqual(store.getSaved().map(entry => entry.query).sort(), ["מהענן", "מקומי"]);
  assert.equal(store.hasSynced(), true);
  const exported = store.exportSaved();
  assert.equal(exported.savedSearches.length, 2);
  assert.ok(exported.savedSearchesUpdatedAt > remote.savedSearchesUpdatedAt);
  assert.ok(exported.savedSearches.every(entry => !("id" in entry)), "המזהה נגזר מהתוכן ואינו נשלח");

  // אותה גרסה בענן — אין מה לעשות.
  assert.deepEqual(store.mergeRemoteSaved(exported), { changed: false, push: false });

  // מכשיר אחר שינה אחר כך: הענן גובר.
  now.advance(1000);
  const newer = { savedSearches: [{ query: "רק זה", savedAt: now() }], savedSearchesUpdatedAt: now() };
  assert.deepEqual(store.mergeRemoteSaved(newer), { changed: true, push: false });
  assert.deepEqual(store.getSaved().map(entry => entry.query), ["רק זה"]);

  // שינוי מקומי חדש יותר מהענן — יש לדחוף.
  now.advance(1000);
  store.saveSearch({ query: "עוד אחד" });
  assert.deepEqual(store.mergeRemoteSaved(newer), { changed: false, push: true });
});

test("סנכרון: ענן בלי רשימה, רשימה פגומה, ומכשיר חדש שמקבל את הרשימה", () => {
  const now = clock();
  const empty = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  assert.deepEqual(empty.mergeRemoteSaved(null), { changed: false, push: false });
  assert.equal(empty.hasSynced(), true);

  const local = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  local.saveSearch({ query: "רק כאן" });
  assert.deepEqual(local.mergeRemoteSaved({ followedFolderIds: ["2"] }), { changed: false, push: true });

  const fresh = createSearchHistoryStore({ storage: memoryStorage(), userId: "u1", now });
  const remote = {
    savedSearches: [{ query: "א", savedAt: 3 }, { query: "" }, "x", { query: "ב", filters: { mediaType: "nope" }, savedAt: 2 }],
    savedSearchesUpdatedAt: 10
  };
  assert.deepEqual(fresh.mergeRemoteSaved(remote), { changed: true, push: false });
  assert.deepEqual(fresh.getSaved().map(entry => entry.query), ["א", "ב"]);
  assert.deepEqual(fresh.getSaved()[1].filters, {});
});

test("המודולים החדשים במעטפת, בבדיקת התחביר, וגרסת האתר עלתה", () => {
  const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
  const pkg = readFileSync(new URL("./package.json", import.meta.url), "utf8");
  for (const file of ["search-history.js", "search-history-ui.js"]) {
    assert.ok(shell.includes(`"./${file}"`), `${file} חסר במעטפת`);
    assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
  }
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ initSearchHistory \} from '\.\/search-history-ui\.js'/);
  assert.match(sw, /const CACHE_VERSION = "v64";/);
  // הסנכרון נשען על המאזין הקיים של userPreferences.
  const sessionAuth = readFileSync(new URL("./session-auth.js", import.meta.url), "utf8");
  assert.match(sessionAuth, /window\.syncSavedSearchesFromPreferences\?\.\(snapshot\.exists\(\) \? snapshot\.data\(\) : null\)/);
});
