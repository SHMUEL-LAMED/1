// הרקע המטושטש (placeholder) של פריט מדיה: איזה ערך עובר — אותו כלל בדפדפן
// (media-variants.js) וב-Worker — איך הוא מוצב כ-CSS, ואילו פריטים צריכים
// השלמה בריצת "תצוגות מקדימות". בלי DOM.
import test from "node:test";
import assert from "node:assert/strict";
import {
    normalizePlaceholder, pickPlaceholder, placeholderCssUrl, needsPlaceholder, selectPlaceholderCandidates,
    PLACEHOLDER_MAX_LENGTH, PLACEHOLDER_TARGET_LENGTH, PLACEHOLDER_MAX_SIDE, encodePlaceholderBmp
} from "./media-variants.js";
import { normalizeMediaPlaceholder } from "./cloudflare-worker.js";
import { readFileSync } from "node:fs";

const TINY = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

test("רק data URL קטן ונקי עובר, וזהה בדפדפן וב-Worker", () => {
    const samples = [
        TINY, ` ${TINY} `, "data:image/png;base64,iVBORw0KGgo=", "data:image/bmp;base64,Qk0=", "data:image/jpeg;base64,/9j/4AAQ",
        "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", `${TINY}")`, "data:image/webp,raw",
        `data:image/webp;base64,${"A".repeat(PLACEHOLDER_MAX_LENGTH)}`, 42, null
    ];
    for (const value of samples) assert.equal(normalizePlaceholder(value), normalizeMediaPlaceholder(value), String(value).slice(0, 40));
    assert.equal(normalizePlaceholder(TINY), TINY);
    assert.equal(normalizePlaceholder("data:image/svg+xml;base64,PHN2Zz4="), "");
    assert.ok(PLACEHOLDER_TARGET_LENGTH < PLACEHOLDER_MAX_LENGTH);
});

test("הערך ל-CSS, ואילו פריטים צריכים השלמה", () => {
    assert.equal(placeholderCssUrl({ placeholder: TINY }), `url("${TINY}")`);
    assert.equal(placeholderCssUrl({ placeholder: "x" }), "");
    assert.equal(pickPlaceholder(null), "");
    const thumb = { thumb: { url: "https://media.example/t.webp", width: 480, height: 320 } };
    assert.equal(needsPlaceholder({ id: "a", variants: thumb }), true);
    assert.equal(needsPlaceholder({ id: "a", variants: thumb, placeholder: TINY }), false);
    assert.equal(needsPlaceholder({ id: "a" }), false, "בלי תצוגה אין ממה ליצור — ריצת התצוגות תיצור את שניהם");
    const candidates = selectPlaceholderCandidates([
        { id: "a", variants: thumb }, { id: "a", variants: thumb }, { id: "b", variants: { poster: { url: "https://media.example/p.webp" } } },
        { id: "c", variants: thumb, placeholder: TINY }, { id: "d", variants: thumb }
    ], { limit: 2 });
    assert.deepEqual(candidates.map(candidate => [candidate.imageId, candidate.url]), [["a", "https://media.example/t.webp"], ["b", "https://media.example/p.webp"]]);
});

test("הכרטיס והתצוגה המלאה מציבים את הרקע, ו-CSS מכבד הפחתת תנועה", () => {
    const gallery = readFileSync(new URL("./gallery.js", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(gallery, /placeholderCssUrl\(img\)/);
    assert.match(gallery, /--media-placeholder:\$\{window\.escapeHtml\(placeholderUrl\)\}/);
    assert.match(styles, /\.gallery-media\.has-placeholder\.is-loaded::before[^{]*\{ opacity: 0; \}/);
    assert.match(styles, /prefers-reduced-motion: reduce\) \{\s*\.gallery-media\.has-placeholder::before \{ transition: none; \}/);
});

test("BMP של רשת הצבעים: כותרת תקינה, שורות מלמטה למעלה ב-BGR, ונכנס ביעד", () => {
    // 2×2: אדום, ירוק / כחול, לבן.
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const url = encodePlaceholderBmp(rgba, 2, 2);
    assert.equal(normalizePlaceholder(url), url);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    assert.equal(bytes.toString("ascii", 0, 2), "BM");
    assert.equal(bytes.readUInt32LE(2), bytes.length);
    assert.equal(bytes.readInt32LE(18), 2);
    assert.equal(bytes.readInt32LE(22), 2);
    assert.equal(bytes.readUInt16LE(28), 24);
    // שורה ראשונה בקובץ = השורה התחתונה בתמונה (כחול, לבן), מרופדת ל-8 בתים.
    assert.deepEqual([...bytes.subarray(54, 60)], [255, 0, 0, 255, 255, 255]);
    assert.deepEqual([...bytes.subarray(62, 68)], [0, 0, 255, 0, 255, 0]);
    // רשת של 8×6 (תמונה לרוחב) נכנסת ביעד; 8×8 כבר לא, ולכן הקוד יורד ל-6×6.
    const pixels = (w, h) => new Uint8Array(w * h * 4).fill(128);
    assert.equal(PLACEHOLDER_MAX_SIDE, 8);
    assert.ok(encodePlaceholderBmp(pixels(8, 6), 8, 6).length <= PLACEHOLDER_TARGET_LENGTH);
    assert.ok(encodePlaceholderBmp(pixels(8, 8), 8, 8).length > PLACEHOLDER_TARGET_LENGTH);
    assert.ok(encodePlaceholderBmp(pixels(6, 6), 6, 6).length <= PLACEHOLDER_TARGET_LENGTH);
    assert.equal(encodePlaceholderBmp(pixels(2, 2), 0, 2), "");
    assert.equal(encodePlaceholderBmp(new Uint8Array(4), 2, 2), "");
});
