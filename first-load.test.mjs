// ההחלטות של הטעינה הראשונה: אילו כרטיסים ואריחים יורדים מיד ובעדיפות
// גבוהה, אילו רמזי חיבור מראש חסרים, והחיבור של כל אחד מהם לדף ולמעטפת.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    aboveFoldCardCount, heroTileLoading, preconnectHints,
    MAX_EAGER_CARDS, HERO_HIGH_PRIORITY_TILES
} from "./first-load.js";
import { PRODUCTION_API_BASE_URL, STAGING_API_BASE_URL } from "./api-environment.js";

// --- השורה הראשונה של הרשת ---

// ראש וגובה לכל כרטיס, כמו getBoundingClientRect.
const row = (tops, height = 300) => tops.map(top => ({ top, bottom: top + height }));

test("רק השורה הראשונה, כשהיא בתוך המסך, יורדת מיד", () => {
    // שלוש עמודות: שלושה כרטיסים באותו גובה, ואז השורה הבאה.
    assert.equal(aboveFoldCardCount(row([686, 686, 686, 1001, 1001, 1001]), 900), 3);
    // שתי עמודות בטלפון כשהרשת בראש המסך (למשל אחרי מעבר לתיקייה).
    assert.equal(aboveFoldCardCount(row([120, 120, 350, 350]), 844), 2);
    // שורה שחלקה כבר נגלל מעל המסך עדיין נראית.
    assert.equal(aboveFoldCardCount(row([-120, -120, 200]), 844), 2);
});

test("רשת שמתחילה מתחת למסך, או שנגללה כולה מעליו, אינה מקבלת עדיפות", () => {
    assert.equal(aboveFoldCardCount(row([1599, 1599, 1830]), 844), 0);
    assert.equal(aboveFoldCardCount(row([844, 844]), 844), 0);
    assert.equal(aboveFoldCardCount(row([-4000, -4000, -3700]), 844), 0);
});

test("סטייה של תת־פיקסלים עדיין נחשבת לאותה שורה, ובפסיפס השורה נעצרת בכרטיס הנמוך", () => {
    assert.equal(aboveFoldCardCount(row([700.4, 701.9, 699.2, 1000]), 900), 3);
    assert.equal(aboveFoldCardCount(row([700, 700, 760, 700]), 900), 2);
});

test("גם במסך רחב מאוד לא יותר מהתקרה", () => {
    const rects = row(Array.from({ length: 12 }, () => 300));
    assert.equal(aboveFoldCardCount(rects, 900), MAX_EAGER_CARDS);
    assert.equal(aboveFoldCardCount(rects, 900, { max: 2 }), 2);
});

test("קלט חסר או שבור אינו נותן עדיפות לאף כרטיס", () => {
    assert.equal(aboveFoldCardCount([], 900), 0);
    assert.equal(aboveFoldCardCount(null, 900), 0);
    assert.equal(aboveFoldCardCount(row([100, 100]), 0), 0);
    assert.equal(aboveFoldCardCount([{ top: Number.NaN, bottom: 10 }, ...row([100])], 900), 0);
    assert.equal(aboveFoldCardCount([...row([100]), { top: Number.NaN }, ...row([100])], 900), 1);
});

// --- הפסיפס שבפוסטר ---

test("כל אריחי הפסיפס יורדים מיד, ורק הראשון בעדיפות גבוהה", () => {
    assert.equal(HERO_HIGH_PRIORITY_TILES, 1);
    assert.deepEqual(heroTileLoading(0), { loading: "eager", fetchPriority: "high" });
    for (const index of [1, 2, 3, 4]) {
        assert.deepEqual(heroTileLoading(index), { loading: "eager", fetchPriority: "auto" });
    }
});

// --- חיבור מראש ---

test("רמזי חיבור מראש: שני מאגרים לאותו מקור — fetch עם crossorigin ו-<img> בלעדיו", () => {
    assert.deepEqual(preconnectHints(`${STAGING_API_BASE_URL}/`), [
        { href: STAGING_API_BASE_URL, crossOrigin: "anonymous" },
        { href: STAGING_API_BASE_URL, crossOrigin: "" }
    ]);
});

test("רמז שכבר בדף אינו מתווסף שוב, גם כשהכתובת בו מסתיימת ב-/", () => {
    const existing = [
        { href: `${PRODUCTION_API_BASE_URL}/`, crossOrigin: "anonymous" },
        { href: "https://fonts.gstatic.com/", crossOrigin: "anonymous" }
    ];
    assert.deepEqual(preconnectHints(PRODUCTION_API_BASE_URL, existing), [
        { href: PRODUCTION_API_BASE_URL, crossOrigin: "" }
    ]);
    // crossOrigin של <link> בלי התכונה הוא null.
    existing.push({ href: PRODUCTION_API_BASE_URL, crossOrigin: null });
    assert.deepEqual(preconnectHints(PRODUCTION_API_BASE_URL, existing), []);
});

test("כתובת שאינה https או שאינה כתובת בכלל אינה נותנת רמז", () => {
    assert.deepEqual(preconnectHints(""), []);
    assert.deepEqual(preconnectHints("not a url"), []);
    assert.deepEqual(preconnectHints("http://example.com"), []);
    assert.deepEqual(preconnectHints("javascript:alert(1)"), []);
});

test("index.html מתחבר מראש ל-Worker של הייצור בשני המאגרים", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    const links = [...html.matchAll(/<link\b[^>]*\brel="preconnect"[^>]*>/g)].map(match => match[0]);
    const toProduction = links.filter(link => link.includes(`href="${PRODUCTION_API_BASE_URL}"`));
    assert.equal(toProduction.length, 2);
    assert.equal(toProduction.filter(link => /\bcrossorigin\b/.test(link)).length, 1);
    // ה-preconnect של הייצור קודם לסקריפט של האתר, אחרת אין בו טעם.
    assert.ok(html.indexOf(PRODUCTION_API_BASE_URL) < html.indexOf('src="./app.js"'));
});

// --- lucide והמעטפת ---

test("lucide נטענת async ולא defer, כדי שלא תעכב את app.js", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    const tag = /<script\b[^>]*lucide[^>]*><\/script>/.exec(html)?.[0] || "";
    assert.match(tag, /\bid="lucideScript"/);
    assert.match(tag, /\basync\b/);
    assert.doesNotMatch(tag, /\bdefer\b/);
    const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
    assert.match(app, /getElementById\('lucideScript'\)\?\.addEventListener\('load'/);
});

test("first-load.js במעטפת של ה-Service Worker, כמו כל מודול של דף הגלריה", () => {
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    assert.match(sw, /"\.\/first-load\.js"/);
});
