// הצעות ההשלמה של שדה החיפוש (search-suggest.js): קיפול העברית (ניקוד, גרש
// וגרשיים, סופיות, מקף, כתיב מלא וחסר), הדירוג והקבוצות, המקורות מהרשומות,
// והחיבור לאתר — מודול ה-UI, מעטפת ה-Service Worker ובדיקת התחביר.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MATCH_RANK,
  MAX_SUGGESTIONS,
  MIN_SUGGEST_QUERY_LENGTH,
  SUGGESTION_GROUPS,
  buildSuggestionIndex,
  countSuggestions,
  folderCandidates,
  foldHebrew,
  hebrewSkeleton,
  itemCountLabel,
  personCandidates,
  rankSuggestions,
  suggestionsMessage,
  tagCandidates,
  uploaderCandidates
} from "./search-suggest.js";

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

// ההצעות כ"סוג:תווית", בסדר התצוגה.
const labels = groups => groups.flatMap(group => group.items.map(item => `${group.kind}:${item.label}`));

function sampleIndex() {
  return buildSuggestionIndex([
    ...folderCandidates([
      { id: "all", name: "כל התמונות" },
      { id: "1", name: "אירועים ופעילויות" },
      { id: "2", name: "טיולים וסיורים" },
      { id: "5", name: "בית־הכנסת הגדול" },
      { id: "6", name: "חב״ד בצ׳רנוביל" }
    ], { counts: { 1: 12, 2: 5, 5: 1, 6: 3 } }),
    ...tagCandidates([{ sceneTags: ["dance", "meal"] }, { sceneTags: ["dance"] }, { sceneTags: ["hakafot"] }]),
    ...personCandidates([
      { personId: "fp_david", name: "דוד כהן", imageCount: 3 },
      { personId: "fp_shimon", name: "שִׁמְעוֹן לוי", imageCount: 1 }
    ]),
    ...uploaderCandidates([{ uploadedByName: "רבקה לוי" }, { uploadedByName: "רבקה  לוי" }, { uploadedByName: "רִבְקָה לוי" }])
  ]);
}

test("קיפול העברית: ניקוד, גרש וגרשיים, סופיות, מקף, פיסוק ו-וו/יי כפולות", () => {
  assert.equal(foldHebrew("שִׁמְעוֹן"), "שמעונ");
  assert.equal(foldHebrew('חב"ד'), foldHebrew("חב״ד"));
  assert.equal(foldHebrew("חב׳ד"), "חבד");
  assert.equal(foldHebrew("צ'ולנט"), foldHebrew("צ׳ולנט"));
  assert.equal(foldHebrew("צ’ולנט"), "צולנט", "גרש של מקלדת לועזית");
  assert.equal(foldHebrew("בית־הכנסת"), "בית הכנסת", "מקף עברי");
  assert.equal(foldHebrew("  ריקודים,  בחצר!  "), "ריקודימ בחצר", "פיסוק ורווחים; ם סופית כ־מ");
  assert.equal(foldHebrew("דוויד"), foldHebrew("דויד"));
  assert.equal(foldHebrew("Hall A"), "hall a");
  assert.equal(foldHebrew(null), "");
  // השלד: בלי ו' ו-י' שאינן בראש המילה.
  assert.equal(hebrewSkeleton(foldHebrew("ריקוד")), hebrewSkeleton(foldHebrew("רִקּוּד")));
  assert.equal(hebrewSkeleton("ויקטור ישראל"), "וקטר ישראל");
});

test("דירוג: זהה, תחילית, מילים בכל סדר, הכלה, כינוי ושלד — וכל קבוצה בסדר קבוע", () => {
  const index = sampleIndex();
  const rankOf = (text, label) => rankSuggestions(index, text).flatMap(group => group.items).find(item => item.label === label)?.rank;

  assert.equal(rankOf("ריקוד", "ריקוד"), MATCH_RANK.exact);
  assert.equal(rankOf("טיול", "טיולים וסיורים"), MATCH_RANK.prefix);
  assert.equal(rankOf("כהן דוד", "דוד כהן"), MATCH_RANK.words);
  assert.equal(rankOf("הכנסת", "בית־הכנסת הגדול"), MATCH_RANK.words);
  assert.equal(rankOf("בית הכנסת", "בית־הכנסת הגדול"), MATCH_RANK.prefix);
  assert.equal(rankOf("צרנוביל", "חב״ד בצ׳רנוביל"), MATCH_RANK.contains, "אחרי אות השימוש ב'");
  assert.equal(rankOf("רנוביל", "חב״ד בצ׳רנוביל"), undefined, "באמצע מילה — לא");
  // הכינוי של "סעודה" הוא ההסבר שלה ("שולחנות ערוכים, אוכל או כיבוד").
  assert.equal(rankOf("שולחנות", "סעודה"), MATCH_RANK.alias);
  // כתיב חסר בניקוד מול כתיב מלא.
  assert.equal(rankOf("רִקּוּד", "ריקוד"), MATCH_RANK.skeleton);
  // ניקוד, גרש וגרשיים בחיפוש עצמו.
  assert.equal(rankOf("שמעון", "שִׁמְעוֹן לוי"), MATCH_RANK.prefix);
  assert.equal(rankOf("חב'ד", "חב״ד בצ׳רנוביל"), MATCH_RANK.prefix);
  assert.equal(rankOf('חב"ד', "חב״ד בצ׳רנוביל"), MATCH_RANK.prefix);

  // אותו טקסט בכמה קבוצות: תיקיות, סוג הרגע, אנשים, מעלים — תמיד בסדר הזה.
  assert.deepEqual(labels(rankSuggestions(index, "לוי")), ["person:שִׁמְעוֹן לוי", "uploader:רבקה לוי"]);
  const groups = rankSuggestions(index, "לוי");
  assert.deepEqual(groups.map(group => group.label), ["אנשים", "הועלו על ידי"]);
  assert.deepEqual(SUGGESTION_GROUPS.map(group => group.label), ["תיקיות ואירועים", "סוג הרגע", "אנשים", "הועלו על ידי"]);

  // בתוך קבוצה: הדרגה קודם, אחר כך מספר הפריטים.
  const ranked = buildSuggestionIndex([
    { kind: "folder", id: "a", label: "הקפות שניות", count: 1 },
    { kind: "folder", id: "b", label: "ליל הקפות", count: 50 },
    { kind: "folder", id: "c", label: "הקפות", count: 2 },
    { kind: "folder", id: "d", label: "הקפות בחצר", count: 9 }
  ]);
  assert.deepEqual(labels(rankSuggestions(ranked, "הקפות")), ["folder:הקפות", "folder:הקפות בחצר", "folder:הקפות שניות", "folder:ליל הקפות"]);
});

test("בלי טקסט, בטקסט קצר או בלי התאמה — אין הצעות; ויש תקרה לקבוצה ולכלל", () => {
  const index = sampleIndex();
  assert.equal(MIN_SUGGEST_QUERY_LENGTH, 2);
  for (const text of ["", "   ", "ד", "״", "שולחן ארוך מאוד שאין כמוהו"]) assert.deepEqual(rankSuggestions(index, text), [], text);
  // כינוי אינו מתאים משתי אותיות ("או" שבהסבר של "סעודה").
  assert.deepEqual(rankSuggestions(index, "או"), []);

  const many = buildSuggestionIndex([
    ...Array.from({ length: 9 }, (_, index) => ({ kind: "folder", id: `f${index}`, label: `שמחת תורה ${index}`, count: index })),
    ...Array.from({ length: 9 }, (_, index) => ({ kind: "person", id: `p${index}`, label: `שמחה ${index}`, count: 1 })),
    ...Array.from({ length: 9 }, (_, index) => ({ kind: "uploader", id: `u${index}`, label: `שמחה ${index}`, count: 1 }))
  ]);
  const groups = rankSuggestions(many, "שמח");
  assert.deepEqual(groups.map(group => group.items.length), [4, 4, 2]);
  assert.equal(countSuggestions(groups), MAX_SUGGESTIONS);
  // בשוויון דרגה — היותר פריטים קודם.
  assert.equal(groups[0].items[0].label, "שמחת תורה 8");
  assert.equal(countSuggestions(rankSuggestions(many, "שמח", { limit: 3 })), 3);
});

test("המקורות: תיקיות בלי 'כל הארכיון', תגיות רק עם פריטים, אנשים בשם, ומעלים מאוחדים", () => {
  const items = [
    { folderId: "1", sceneTags: ["dance"], uploadedByName: "יוסי" },
    { folderId: "1", sceneTags: ["dance", "nonsense"], uploadedByName: "יוֹסִי" },
    { folderId: "2", sceneTags: [], uploadedByName: "" },
    { folderId: "2" }
  ];
  // בלי מונים מהשרת — לפי מה שנטען.
  assert.deepEqual(folderCandidates([{ id: "all", name: "כל" }, { id: "1", name: "א" }, { id: "2", name: "ב" }, { id: "3", name: "" }, { id: "1", name: "כפול" }], { items }),
    [{ kind: "folder", id: "1", label: "א", count: 2 }, { kind: "folder", id: "2", label: "ב", count: 2 }]);
  assert.equal(folderCandidates([{ id: "1", name: "א" }], { counts: { 1: 40 }, items }).at(0).count, 40);

  assert.deepEqual(tagCandidates(items).map(tag => [tag.id, tag.label, tag.count]), [["dance", "ריקוד", 2]]);
  assert.deepEqual(personCandidates([{ personId: "fp_1", name: "דוד", imageCount: 2 }, { personId: "fp_2", name: " " }, { personId: "", name: "בלי מזהה" }]),
    [{ kind: "person", id: "fp_1", label: "דוד", count: 2 }]);
  // "יוסי" ו"יוֹסִי" — מעלה אחד, בכתיבה הנפוצה (בשוויון — הראשונה).
  assert.deepEqual(uploaderCandidates(items), [{ kind: "uploader", id: "יוסי", label: "יוסי", count: 2 }]);

  // מה שאינו מסוג מוכר, או בלי שם, אינו נכנס למפתח.
  assert.equal(buildSuggestionIndex([{ kind: "title", id: "x", label: "שם" }, { kind: "folder", id: "y", label: "״" }, null]).length, 0);
});

test("תוויות ומספרים: פריטים והודעת ההצעות לקוראי מסך", () => {
  assert.equal(itemCountLabel(0), "");
  assert.equal(itemCountLabel(1), "פריט אחד");
  assert.equal(itemCountLabel(7.9), "7 פריטים");
  assert.equal(suggestionsMessage(0), "");
  assert.equal(suggestionsMessage(1), "הצעה אחת");
  assert.equal(suggestionsMessage(4), "4 הצעות");
});

test("מהיר: אלפי מועמדים, מאה הקשות", () => {
  const index = buildSuggestionIndex(Array.from({ length: 3000 }, (_, i) => ({ kind: i % 2 ? "folder" : "uploader", id: `x${i}`, label: `אירוע מספר ${i} בבית הכנסת`, count: i })));
  const started = performance.now();
  for (let i = 0; i < 100; i += 1) rankSuggestions(index, `בית הכנ${i % 2 ? "ס" : ""}`);
  assert.ok(performance.now() - started < 1500, "מאה חיפושים על 3000 מועמדים בפחות משנייה וחצי");
});

test("החיבור לאתר: מודול ה-UI, ה-combobox האחד, people.js, המטמון ובדיקת התחביר", () => {
  const ui = read("search-suggest-ui.js");
  assert.match(ui, /from '\.\/search-suggest\.js'/);
  // האנשים נטענים עצלה, דרך המודול של people.js, ורק למי שמאושר.
  assert.match(ui, /ensurePeopleModule/);
  assert.match(ui, /listPeopleForSearch/);
  assert.doesNotMatch(ui, /face\/search|loadFaceApi|ensureFaceSearchModule/, "ההצעות אינן מושכות פנים");
  const people = read("people.js");
  assert.match(people, /window\.listPeopleForSearch = listPeopleForSearch/);
  // ההצעות מוצגות באותו תפריט של החיפושים האחרונים והשמורים — אין חלון שני.
  const history = read("search-history-ui.js");
  assert.match(history, /from '\.\/search-suggest-ui\.js'/);
  assert.doesNotMatch(read("index.html"), /id="searchSuggest/);

  const sw = read("sw.js");
  for (const name of ["search-suggest.js", "search-suggest-ui.js"]) {
    assert.match(sw, new RegExp(`"\\./${name.replace(".", "\\.")}"`), `${name} במעטפת ה-Service Worker`);
    assert.match(JSON.parse(read("package.json")).scripts["check:syntax"], new RegExp(`node --check ${name.replace(".", "\\.")}`));
    assert.match(read("README.md"), new RegExp(`\`${name.replace(".", "\\.")}\``));
  }
});
