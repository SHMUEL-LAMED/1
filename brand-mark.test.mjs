import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBrandOptions, brandMarkLayout, drawBrandMark, BRAND_MIN_FONT } from "./brand-mark.js";

test("הגדרות הלוגו: ברירות מחדל, ערכים לא מוכרים ואטימות בטווח", () => {
    assert.deepEqual(normalizeBrandOptions(null), { style: "seal", position: "bottom-left", size: "m", opacity: 0.82 });
    assert.deepEqual(
        normalizeBrandOptions({ watermarkStyle: "badge", watermarkPosition: "center", watermarkSize: "l", watermarkOpacity: 0.1 }),
        { style: "badge", position: "center", size: "l", opacity: 0.25 }
    );
    assert.equal(normalizeBrandOptions({ watermarkStyle: "evil", watermarkOpacity: "x" }).style, "seal");
});

test("מיקום הלוגו: בתוך התמונה בכל פינה, וטקסט ארוך מוקטן", () => {
    const measure = size => size * 10;
    for (const position of ["bottom-left", "bottom-right", "top-left", "top-right", "center"]) {
        for (const style of ["seal", "badge", "text"]) {
            const layout = brandMarkLayout(1600, 900, { position, style }, measure);
            assert.ok(layout.x >= 0 && layout.y >= 0, `${position}/${style}`);
            assert.ok(layout.x + layout.width <= 1600 && layout.y + layout.height <= 900, `${position}/${style}`);
        }
    }
    const left = brandMarkLayout(1600, 900, { position: "bottom-left" }, measure);
    const right = brandMarkLayout(1600, 900, { position: "bottom-right" }, measure);
    assert.ok(left.x < right.x);
    const long = brandMarkLayout(200, 200, {}, size => size * 40);
    assert.ok(long.fontSize >= BRAND_MIN_FONT);
    const large = brandMarkLayout(2000, 2000, { size: "l" }, measure);
    const small = brandMarkLayout(2000, 2000, { size: "s" }, measure);
    assert.ok(large.fontSize > small.fontSize);
});

test("הציור: חותם וטקסט מימין לשמאל, באטימות שנבחרה", () => {
    const calls = [];
    const context = new Proxy({ measureText: text => ({ width: text.length * 8 }) }, {
        get(target, key) {
            if (key in target) return target[key];
            return (...args) => { calls.push([key, ...args]); return { addColorStop() {} }; };
        },
        set(target, key, value) { calls.push(["set", key, value]); target[key] = value; return true; }
    });
    const layout = drawBrandMark(context, 1200, 800, "גלריה", { watermarkOpacity: 0.5 }, "Assistant");
    assert.ok(calls.some(([name, text]) => name === "fillText" && text === "גלריה"));
    assert.ok(calls.some(([name, key, value]) => name === "set" && key === "globalAlpha" && value === 0.5));
    assert.ok(calls.some(([name, key, value]) => name === "set" && key === "direction" && value === "rtl"));
    assert.ok(calls.some(([name]) => name === "arc"), "החותם מצויר");
    assert.equal(layout.style, "seal");
});
