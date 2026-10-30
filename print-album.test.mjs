// האלבום להדפסה (print-album.js): חלוקה לעמודים של 1/2/4, ספירת העמודים עם
// השער, בחירת המקור (בינונית, מקור, פוסטר), הסדר, התקרה והטקסטים שבשער.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_PER_PAGE_OPTIONS,
  DEFAULT_ALBUM_PER_PAGE,
  ALBUM_MAX_ITEMS,
  normalizeAlbumPerPage,
  paginateAlbum,
  albumPageCount,
  pickAlbumSource,
  albumItemText,
  prepareAlbumItems,
  albumCoverDate,
  albumCountLabel
} from "./print-album.js";

const variant = (id, name) => ({ url: `https://api.example/media/variants/${id}/${name}.webp`, width: 1280, height: 853 });

function photo(index, overrides = {}) {
  const id = `img_${index}`;
  return {
    id,
    title: `תמונה ${index}`,
    url: `https://api.example/media/${id}.jpg`,
    mediaType: "image",
    mimeType: "image/jpeg",
    createdAt: Date.UTC(2026, 8, 1) + index * 60_000,
    ...overrides
  };
}

test("נרמול מספר התמונות בעמוד: 1, 2 או 4, וכל השאר חוזר לברירת המחדל", () => {
  assert.deepEqual([...ALBUM_PER_PAGE_OPTIONS], [1, 2, 4]);
  for (const value of [1, 2, 4, "1", "4"]) assert.equal(normalizeAlbumPerPage(value), Number(value));
  for (const value of [0, 3, 5, "", null, undefined, "abc", 2.5, {}]) assert.equal(normalizeAlbumPerPage(value), DEFAULT_ALBUM_PER_PAGE);
});

test("חלוקה לעמודים: קבוצות מלאות בסדר המקורי, והאחרונה חלקית", () => {
  const items = Array.from({ length: 7 }, (_, index) => index + 1);
  assert.deepEqual(paginateAlbum(items, 1), items.map(item => [item]));
  assert.deepEqual(paginateAlbum(items, 2), [[1, 2], [3, 4], [5, 6], [7]]);
  assert.deepEqual(paginateAlbum(items, 4), [[1, 2, 3, 4], [5, 6, 7]]);
  // ערך לא חוקי — ברירת המחדל (2).
  assert.deepEqual(paginateAlbum(items, 3), [[1, 2], [3, 4], [5, 6], [7]]);
  assert.deepEqual(paginateAlbum([], 4), []);
  assert.deepEqual(paginateAlbum(null, 4), []);
  // המערך המקורי אינו משתנה.
  assert.equal(items.length, 7);
});

test("מספר העמודים כולל את השער; אלבום ריק — אפס", () => {
  assert.equal(albumPageCount(0, 1), 0);
  assert.equal(albumPageCount(1, 4), 2);
  assert.equal(albumPageCount(4, 4), 2);
  assert.equal(albumPageCount(5, 4), 3);
  assert.equal(albumPageCount(5, 2), 4);
  assert.equal(albumPageCount(5, 1), 6);
  for (const count of [1, 2, 3, 7, 8, 9, 13]) {
    for (const perPage of ALBUM_PER_PAGE_OPTIONS) {
      assert.equal(albumPageCount(count, perPage), 1 + paginateAlbum(Array(count).fill(0), perPage).length);
    }
  }
});

test("המקור להדפסה: התצוגה הבינונית, בלעדיה המקור — לעולם לא התצוגה הקטנה", () => {
  const withMedium = photo(1, { variants: { thumb: variant("img_1", "thumb"), medium: variant("img_1", "medium") } });
  assert.equal(pickAlbumSource(withMedium), "https://api.example/media/variants/img_1/medium.webp");
  const thumbOnly = photo(2, { variants: { thumb: variant("img_2", "thumb") } });
  assert.equal(pickAlbumSource(thumbOnly), "https://api.example/media/img_2.jpg");
  assert.equal(pickAlbumSource(photo(3)), "https://api.example/media/img_3.jpg");
  assert.equal(pickAlbumSource(photo(4, { url: "javascript:alert(1)" })), "");
  // sanitize של הגלריה מתקבל כפי שהוא.
  assert.equal(pickAlbumSource(photo(5, { url: "blob:local" }), value => value), "blob:local");
});

test("סרטון מודפס כפוסטר שלו; סרטון בלי פוסטר — אין מקור", () => {
  const video = { id: "vid_1", mediaType: "video", url: "https://api.example/media/vid_1.mp4", variants: { poster: variant("vid_1", "poster"), thumb: variant("vid_1", "thumb") } };
  assert.equal(pickAlbumSource(video), "https://api.example/media/variants/vid_1/poster.webp");
  assert.equal(pickAlbumSource({ ...video, variants: undefined, thumbnailUrl: "https://api.example/old-poster.jpg" }), "https://api.example/old-poster.jpg");
  assert.equal(pickAlbumSource({ ...video, variants: undefined }), "");
});

test("השם והכיתוב: רווחים מנורמלים, שם חלופי, וכיתוב זהה לשם אינו כפול", () => {
  assert.deepEqual(albumItemText({ title: "  ריקוד\n במעגל ", caption: "קהל גדול מוחא כפיים." }), { title: "ריקוד במעגל", caption: "קהל גדול מוחא כפיים." });
  assert.deepEqual(albumItemText({ title: "" }), { title: "תמונה ללא שם", caption: "" });
  assert.deepEqual(albumItemText({ mediaType: "video" }), { title: "סרטון ללא שם", caption: "" });
  assert.deepEqual(albumItemText({ title: "הקפה ראשונה", caption: "הקפה ראשונה" }), { title: "הקפה ראשונה", caption: "" });
  // הטקסט אינו מוברח כאן: ה-DOM כותב אותו ב-textContent / escapeHtml.
  assert.equal(albumItemText({ title: "<b>x</b>" }).title, "<b>x</b>");
});

test("הכנת הפריטים: בלי כפילויות, לפי סדר הצילום, דילוג על מה שאין לו מקור", () => {
  const records = [
    photo(3, { takenAt: Date.UTC(2025, 9, 15, 12), takenDate: "2025-10-15" }),
    photo(1, { takenAt: Date.UTC(2025, 9, 14, 12), takenDate: "2025-10-14", caption: "תחילת הערב" }),
    photo(1),
    { id: "vid_9", mediaType: "video", url: "https://api.example/media/vid_9.mp4", createdAt: 1 },
    photo(2, { takenAt: Date.UTC(2025, 9, 14, 18), takenDate: "2025-10-14" }),
    { title: "בלי מזהה", url: "https://api.example/x.jpg" }
  ];
  const { items, skipped, truncated } = prepareAlbumItems(records);
  assert.deepEqual(items.map(item => item.id), ["img_1", "img_2", "img_3"]);
  assert.equal(skipped, 1);
  assert.equal(truncated, 0);
  assert.equal(items[0].caption, "תחילת הערב");
  assert.equal(items[0].dateText, "כ״ב בתשרי תשפ״ו");
  assert.equal(items[2].dateText, "כ״ג בתשרי תשפ״ו");
  assert.equal(items[0].isVideo, false);
});

test("התקרה: נשמרים הראשונים לפי הסדר, והחתוכים נספרים", () => {
  const records = Array.from({ length: 12 }, (_, index) => photo(index + 1));
  const { items, truncated } = prepareAlbumItems(records, { max: 5 });
  assert.deepEqual(items.map(item => item.id), ["img_1", "img_2", "img_3", "img_4", "img_5"]);
  assert.equal(truncated, 7);
  assert.equal(prepareAlbumItems(records).truncated, 0);
  assert.ok(ALBUM_MAX_ITEMS >= 100);
  assert.deepEqual(prepareAlbumItems(null), { items: [], skipped: 0, truncated: 0 });
});

test("התאריך שבשער: תאריך האירוע, טווח ימי הצילום, או ריק", () => {
  assert.deepEqual(albumCoverDate({ eventDate: "2025-10-15" }), { hebrew: "כ״ג בתשרי תשפ״ו", gregorian: "15.10.2025" });
  const captured = [
    photo(1, { takenAt: Date.UTC(2025, 9, 15, 12), takenDate: "2025-10-15" }),
    photo(2, { takenAt: Date.UTC(2025, 9, 14, 12), takenDate: "2025-10-14" })
  ];
  assert.deepEqual(albumCoverDate({ records: captured }), { hebrew: "כ״ב בתשרי תשפ״ו – כ״ג בתשרי תשפ״ו", gregorian: "14.10.2025 – 15.10.2025" });
  assert.deepEqual(albumCoverDate({ records: [captured[0]] }), { hebrew: "כ״ג בתשרי תשפ״ו", gregorian: "15.10.2025" });
  // תאריך האירוע גובר על ימי הצילום; ערך לא תקין אינו מתורגם.
  assert.equal(albumCoverDate({ eventDate: "2025-10-15", records: captured }).hebrew, "כ״ג בתשרי תשפ״ו");
  assert.deepEqual(albumCoverDate({ eventDate: "אתמול", records: [photo(3)] }), { hebrew: "", gregorian: "" });
  assert.deepEqual(albumCoverDate(), { hebrew: "", gregorian: "" });
});

test("ספירת התמונות בשער: יחיד, רבים, ותמונות עם סרטונים", () => {
  assert.equal(albumCountLabel([]), "0 תמונות");
  assert.equal(albumCountLabel([{}]), "תמונה אחת");
  assert.equal(albumCountLabel([{}, {}, {}]), "3 תמונות");
  assert.equal(albumCountLabel([{ isVideo: true }]), "סרטון אחד");
  assert.equal(albumCountLabel([{ isVideo: true }, { isVideo: true }]), "2 סרטונים");
  assert.equal(albumCountLabel([{}, {}, { isVideo: true }]), "2 תמונות וסרטון אחד");
  assert.equal(albumCountLabel([{}, { isVideo: true }, { isVideo: true }]), "תמונה אחת ו־2 סרטונים");
});
