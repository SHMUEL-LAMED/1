// הטקסט החלופי של תמונה (media-alt.js): הכיתוב קודם, אחריו השם, ובלי שניהם
// תווית כללית עם התאריך העברי — של הצילום כשידוע, ושל ההעלאה כשלא.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mediaAltText, genericMediaLabel, ALT_TEXT_MAX_LENGTH } from "./media-alt.js";
import { CAPTION_MAX_LENGTH } from "./scene-tags.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
// 28.09.2026 הוא י״ז בתשרי תשפ״ז.
const CAPTURED = { takenAt: Date.UTC(2026, 8, 28, 9), takenDate: "2026-09-28" };
const UPLOADED = { date: "2026-09-28", createdAt: Date.UTC(2026, 8, 28, 9) };

test("כיתוב קודם לשם", () => {
    assert.equal(mediaAltText({ title: "IMG_2041.jpg", caption: "ריקוד במעגל סביב הבימה", ...UPLOADED }), "ריקוד במעגל סביב הבימה");
});

test("בלי כיתוב — השם; כיתוב ריק או רווחים בלבד אינו נחשב", () => {
    assert.equal(mediaAltText({ title: "הקפה שנייה", ...UPLOADED }), "הקפה שנייה");
    assert.equal(mediaAltText({ title: "הקפה שנייה", caption: "   \n ", ...UPLOADED }), "הקפה שנייה");
});

test("בלי כיתוב ובלי שם — תמונה או סרטון עם התאריך העברי", () => {
    assert.equal(mediaAltText({ ...CAPTURED }), "תמונה שצולמה בי״ז בתשרי תשפ״ז");
    assert.equal(mediaAltText({ ...UPLOADED }), "תמונה שהועלתה בי״ז בתשרי תשפ״ז");
    assert.equal(mediaAltText({ title: "  ", mediaType: "video", ...CAPTURED }), "סרטון שצולם בי״ז בתשרי תשפ״ז");
    assert.equal(genericMediaLabel({ mediaType: "video", ...UPLOADED }), "סרטון שהועלה בי״ז בתשרי תשפ״ז");
});

test("בלי שום תאריך — אותה תווית כמו הכותרת שבכרטיס", () => {
    assert.equal(mediaAltText({}), "תמונה ללא שם");
    assert.equal(mediaAltText({ mediaType: "video" }), "סרטון ללא שם");
    assert.equal(mediaAltText(null), "תמונה ללא שם");
});

test("תווי בקרה וכיווניות מוסרים, רווחים מתכווצים", () => {
    assert.equal(mediaAltText({ caption: "שמחה‮ גדולה\n\nבאולם" }), "שמחה גדולה באולם");
    assert.equal(mediaAltText({ title: "‏טיול\t לצפון" }), "טיול לצפון");
});

test("טקסט ארוך נחתך במקום טבעי, עד התקרה", () => {
    assert.equal(ALT_TEXT_MAX_LENGTH, CAPTION_MAX_LENGTH);
    const words = Array.from({ length: 60 }, (_, index) => `מילה${index}`).join(" ");
    for (const record of [{ caption: words }, { title: words }]) {
        const alt = mediaAltText(record);
        assert.ok(alt.length <= ALT_TEXT_MAX_LENGTH, `${alt.length} תווים`);
        assert.ok(alt.endsWith("…"));
        // אין מילה קטועה: כל מה שלפני "…" הוא מילים שלמות מהמקור.
        assert.ok(words.startsWith(alt.slice(0, -1)));
        assert.ok(words.split(" ").includes(alt.slice(0, -1).split(" ").at(-1)));
    }
});

test("הטקסט חוזר כפי שהוא: ההברחה היא של gallery.js, במרקאפ של הכרטיס", () => {
    assert.equal(mediaAltText({ title: 'תמונה "עם" <מרכאות> & סימנים' }), 'תמונה "עם" <מרכאות> & סימנים');
    const gallery = read("./gallery.js");
    assert.match(gallery, /buildCardPicture\(cardSource, window\.escapeHtml\(mediaAltText\(img\)\)\)/);
    assert.match(gallery, /lbImage\.alt = mediaAltText\(img\)/);
});

test("המודול במעטפת האפליקציה ובבדיקת התחביר", () => {
    const sw = read("./sw.js");
    const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
    assert.ok(shell.includes('"./media-alt.js"'), "media-alt.js חסר ב-APP_SHELL: gallery.js מייבא אותו סטטית");
    assert.ok(read("./package.json").includes("node --check media-alt.js"));
});
