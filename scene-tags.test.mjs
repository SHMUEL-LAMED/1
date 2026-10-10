// בדיקות הכיתובים ותגיות הסצנה בצד הלקוח (scene-tags.js), הנעילה בין
// הטקסונומיה של הלקוח לזו של ה-Worker, מדיניות הקצב של ריצת ההשלמה
// (ai-titles-admin.js), והרישום של המודולים החדשים במעטפת ובבדיקת התחביר.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCENE_TAGS, SCENE_TAG_MAX, CAPTION_MAX_LENGTH, AI_CAPTION_VERSION,
  normalizeSceneTags, normalizeCaption, sceneTagLabel, isSceneTagId, recordSceneTags,
  recordHasSceneTag, descriptionSearchText, sceneTagCounts, needsAiDescription,
  isAiDescribable, hasDescription
} from "./scene-tags.js";
import {
  sceneTagTaxonomy, normalizeSceneTags as workerNormalizeSceneTags,
  normalizeImageCaption as workerNormalizeCaption, imageDescriptionPrompt
} from "./cloudflare-worker.js";
import { classifyDescribeError, retryDelayMs, AI_DESCRIBE_RETRY_DELAYS_MS, AI_DESCRIBE_INTERVAL_MS } from "./ai-titles-admin.js";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");

test("the taxonomy is fixed, Hebrew, unique, and ends with 'other'", () => {
  assert.ok(SCENE_TAGS.length >= 10);
  const ids = SCENE_TAGS.map(tag => tag.id);
  const labels = SCENE_TAGS.map(tag => tag.label);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(labels).size, labels.length);
  for (const tag of SCENE_TAGS) {
    assert.match(tag.id, /^[a-z-]+$/);
    assert.match(tag.label, /^[֐-׿ ]+$/, `${tag.label} חייבת להיות בעברית בלבד`);
    assert.match(tag.hint, /[֐-׿]/);
  }
  for (const label of ["ריקוד", "הקפות", "שיעור או דרשה", "תפילה", "סעודה", "תמונה קבוצתית", "נגינה", "ילדים", "ספר תורה", "הכנות", "אחר"]) {
    assert.ok(labels.includes(label), `${label} חסרה בטקסונומיה`);
  }
  assert.equal(ids.at(-1), "other");
  assert.ok(Object.isFrozen(SCENE_TAGS) && Object.isFrozen(SCENE_TAGS[0]));
  assert.equal(SCENE_TAG_MAX, 4);
  assert.equal(CAPTION_MAX_LENGTH, 140);
});

test("the Worker and the client share exactly the same taxonomy", () => {
  assert.deepEqual(sceneTagTaxonomy(), SCENE_TAGS.map(tag => ({ ...tag })));
  // ההנחיה למודל מציגה כל תגית עם ההסבר שלה.
  const prompt = imageDescriptionPrompt();
  for (const tag of SCENE_TAGS) assert.ok(prompt.includes(`- ${tag.label}: ${tag.hint}`));
});

test("tags normalize to known ids: labels or ids, no duplicates, at most four, 'other' only alone", () => {
  assert.deepEqual(normalizeSceneTags(["ריקוד", "dance", "הקפות"]), ["dance", "hakafot"]);
  assert.deepEqual(normalizeSceneTags(["unknown", 7, null, " סעודה "]), ["meal"]);
  assert.deepEqual(normalizeSceneTags(["אחר", "תפילה"]), ["prayer"]);
  assert.deepEqual(normalizeSceneTags(["אחר"]), ["other"]);
  assert.deepEqual(normalizeSceneTags(["dance", "hakafot", "torah", "music", "group", "children"]), ["dance", "hakafot", "torah", "music"]);
  assert.deepEqual(normalizeSceneTags("dance"), []);
  assert.deepEqual(normalizeSceneTags(undefined), []);
  assert.equal(sceneTagLabel("lesson"), "שיעור או דרשה");
  assert.equal(sceneTagLabel("nope"), "");
  assert.ok(isSceneTagId("overview"));
  assert.ok(!isSceneTagId("מבט כללי"), "המזהה, לא התווית");
});

test("captions are cleaned and cut to 140 characters without breaking a word", () => {
  assert.equal(normalizeCaption("  שורה\nשנייה\t‮הפוכה  "), "שורה שנייה הפוכה");
  assert.equal(normalizeCaption(null), "");
  const sentences = `${"מעגל ריקודים גדול באולם הישיבה בשעת ערב. ".repeat(2)}${"הקהל עומד סביב ".repeat(10)}`;
  const bySentence = normalizeCaption(sentences);
  assert.ok(bySentence.length <= CAPTION_MAX_LENGTH);
  assert.ok(bySentence.endsWith("."), bySentence);
  const words = "מילה ".repeat(60);
  const byWord = normalizeCaption(words);
  assert.ok(byWord.length <= CAPTION_MAX_LENGTH);
  assert.ok(byWord.endsWith("מילה…"), byWord);
  const unbroken = "א".repeat(200);
  assert.equal(normalizeCaption(unbroken).length, CAPTION_MAX_LENGTH);
});

test("the Worker normalizes captions and tags exactly like the client", () => {
  const captions = [
    "", "  כיתוב קצר  ", "שורה\u0000עם‏תווים",
    `${"מעגל ריקודים גדול באולם הישיבה בשעת ערב. ".repeat(2)}${"הקהל עומד סביב ".repeat(10)}`,
    "מילה ".repeat(60), "א".repeat(200), "מישהו אמר! ואז כולם שרו? ".repeat(8)
  ];
  for (const caption of captions) assert.equal(workerNormalizeCaption(caption), normalizeCaption(caption));
  const tagLists = [["ריקוד", "dance"], ["אחר", "x"], ["other"], ["dance", "hakafot", "torah", "music", "group"], "dance", null];
  for (const tags of tagLists) assert.deepEqual(workerNormalizeSceneTags(tags), normalizeSceneTags(tags));
});

test("search text, tag filters and counts read the stored description", () => {
  const records = [
    { id: "a", caption: "מעגל ריקודים סביב הבימה", sceneTags: ["dance", "hakafot"] },
    { id: "b", sceneTags: ["dance", "unknown"] },
    { id: "c", caption: "שולחנות ערוכים" },
    { id: "d" }
  ];
  assert.equal(descriptionSearchText(records[0]), "מעגל ריקודים סביב הבימה ריקוד הקפות");
  assert.equal(descriptionSearchText(records[3]), "");
  assert.deepEqual(recordSceneTags(records[1]), ["dance"]);
  assert.ok(recordHasSceneTag(records[0], "hakafot"));
  assert.ok(!recordHasSceneTag(records[2], "meal"));
  assert.deepEqual(sceneTagCounts(records), [
    { id: "dance", label: "ריקוד", count: 2 },
    { id: "hakafot", label: "הקפות", count: 1 }
  ]);
  assert.ok(hasDescription(records[2]));
  assert.ok(!hasDescription(records[3]));
});

test("the backfill picks approved photos missing an AI title or an AI caption, never manual captions or videos", () => {
  const approved = { r2Key: "approved/u/x.jpg", mediaType: "image" };
  assert.ok(needsAiDescription({ ...approved }));
  assert.ok(needsAiDescription({ ...approved, aiTitleVersion: 1 }), "חסר כיתוב");
  assert.ok(needsAiDescription({ ...approved, aiCaptionVersion: AI_CAPTION_VERSION }), "חסר שם");
  assert.ok(!needsAiDescription({ ...approved, aiTitleVersion: 1, aiCaptionVersion: AI_CAPTION_VERSION }));
  assert.ok(!needsAiDescription({ ...approved, aiTitleVersion: 1, captionSource: "manual" }));
  assert.ok(needsAiDescription({ ...approved, captionSource: "manual" }), "השם עדיין חסר");
  assert.ok(!needsAiDescription({ ...approved, mediaType: "video" }));
  assert.ok(!needsAiDescription({ r2Key: "pending/u/x.jpg", mediaType: "image" }));
  assert.ok(!isAiDescribable({ url: "https://example.com/x.jpg" }));
  assert.ok(!needsAiDescription(null));
});

test("backfill pacing: provider overload is retried with growing waits, quota and outages stop, single-photo problems are skipped", () => {
  assert.ok(AI_DESCRIBE_INTERVAL_MS >= 1000, "בקשה אחת לשנייה לכל היותר");
  assert.equal(classifyDescribeError({ status: 429, code: "openai_rate_limited" }), "retry");
  assert.equal(classifyDescribeError({ status: 429, code: "ai_title_rate_limit" }), "stop");
  assert.equal(classifyDescribeError({ status: 503, code: "openai_key_missing" }), "stop");
  assert.equal(classifyDescribeError({ status: 503, code: "openai_quota_exhausted" }), "stop");
  assert.equal(classifyDescribeError({ status: 502, code: "ai_title_failed" }), "stop");
  assert.equal(classifyDescribeError({ status: 502, code: "invalid_ai_title" }), "skip");
  assert.equal(classifyDescribeError({ status: 502, code: "invalid_ai_response" }), "skip");
  assert.equal(classifyDescribeError({ status: 403, code: "permission_denied" }), "stop");
  assert.equal(classifyDescribeError(new Error("לא ניתן להתחבר לשרת האחסון.")), "stop");
  assert.equal(classifyDescribeError({ status: 404, code: "request_failed" }), "stop");
  assert.equal(classifyDescribeError({ status: 404, code: "not_found" }), "skip");
  assert.equal(classifyDescribeError({ status: 409, code: "document_write_conflict" }), "skip");
  assert.equal(classifyDescribeError({ status: 400, code: "image_too_large" }), "skip");
  const delays = AI_DESCRIBE_RETRY_DELAYS_MS.map((_, attempt) => retryDelayMs(attempt));
  assert.deepEqual(delays, [...delays].sort((a, b) => a - b));
  assert.equal(retryDelayMs(AI_DESCRIBE_RETRY_DELAYS_MS.length), null, "אחרי הניסיון האחרון — מוותרים");
});

test("the new modules are in the app shell, the syntax check and the Tailwind scan", () => {
  const sw = read("./sw.js");
  const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
  const pkg = read("./package.json");
  for (const file of ["scene-tags.js", "media-description.js"]) {
    assert.ok(shell.includes(`"./${file}"`), `${file} חסר ב-APP_SHELL: gallery.js מייבא אותו סטטית`);
    assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
  }
  assert.ok(read("./tailwind.config.js").includes("./media-description.js"));
  assert.match(read("./gallery.js"), /from '\.\/scene-tags\.js'/);
  assert.match(read("./gallery.js"), /from '\.\/media-description\.js'/);
  assert.match(read("./ai-titles-admin.js"), /from '\.\/scene-tags\.js'/);
});

test("the gallery markup has the filter chips, the lightbox description and the admin editor", () => {
  const html = read("./index.html");
  assert.match(html, /id="gallerySceneFilter"[^>]*role="group"[^>]*aria-label="סינון לפי סוג הרגע"/);
  assert.match(html, /id="gallerySceneFilterStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="lightboxDescription"/);
  assert.match(html, /id="lightboxCaption"/);
  assert.match(html, /id="lightboxTags"/);
  assert.match(html, /id="lightboxEditDescription"[^>]*aria-label="[^"]+"[^>]*hidden/);
  assert.match(html, /id="lightboxCaptionEmpty"[^>]*hidden/);
  assert.match(html, /id="mediaDescriptionModal"[^>]*role="dialog"/);
  assert.match(html, /id="mediaDescriptionCaption" maxlength="140"/);
  // סינון התאריך הקיים לא השתנה.
  assert.match(html, /id="galleryHebrewYearFilter"/);
  assert.match(html, /id="galleryHebrewMonthFilter"/);
});
