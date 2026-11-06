import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    fillHeroTiles, HERO_MOSAIC_LIMIT, mergeHeroPool, nextHeroSwap, pickRandomHeroItems,
} from "./hero-mosaic.js";

const items = count => Array.from({ length: count }, (_, index) => ({ id: `p${index}` }));
const ids = list => list.map(item => item.id);
// מחולל קבוע לבדיקות: סדרה חוזרת של ערכים.
const sequence = values => { let index = 0; return () => values[index++ % values.length]; };

test("mergeHeroPool מאחד רשימות בלי כפילויות ובלי פריטים בלי מזהה", () => {
    const pool = mergeHeroPool([[{ id: "a" }, { id: "b" }], [{ id: "b" }, {}, { id: "c" }], null]);
    assert.deepEqual(ids(pool), ["a", "b", "c"]);
});

test("pickRandomHeroItems בוחר פריטים שונים, מכבד exclude ו-usable", () => {
    const pool = items(20);
    const picked = pickRandomHeroItems(pool, 5, { exclude: new Set(["p0", "p1"]), usable: item => item.id !== "p2" });
    assert.equal(picked.length, 5);
    assert.equal(new Set(ids(picked)).size, 5);
    for (const id of ["p0", "p1", "p2"]) assert.ok(!ids(picked).includes(id));
});

test("pickRandomHeroItems אקראי: לא תמיד החדשות ביותר", () => {
    const pool = items(50);
    const firsts = new Set();
    for (let round = 0; round < 40; round += 1) firsts.add(pickRandomHeroItems(pool, 1)[0].id);
    assert.ok(firsts.size > 5, "הבחירה צריכה להתפזר על פני המאגר");
});

test("pickRandomHeroItems במאגר קטן מחזיר מה שיש", () => {
    assert.equal(pickRandomHeroItems(items(3), 5).length, 3);
    assert.deepEqual(pickRandomHeroItems([], 5), []);
});

test("fillHeroTiles שומר אריחים קיימים וממלא רק את החסר", () => {
    const pool = items(30);
    const tiles = fillHeroTiles(["p7", "p3", "gone"], pool);
    assert.equal(tiles.length, HERO_MOSAIC_LIMIT);
    assert.deepEqual(ids(tiles).slice(0, 2), ["p7", "p3"]);
    assert.equal(new Set(ids(tiles)).size, HERO_MOSAIC_LIMIT);
    assert.ok(!ids(tiles).includes("gone"));
});

test("fillHeroTiles יציב: אותם אריחים כשהמאגר לא השתנה", () => {
    const pool = items(30);
    const first = ids(fillHeroTiles([], pool));
    assert.deepEqual(ids(fillHeroTiles(first, pool)), first);
});

test("nextHeroSwap מחליף אריח בפריט שאינו מוצג, ולא את האריח הקודם", () => {
    const pool = items(10);
    const shown = ["p0", "p1", "p2", "p3", "p4"];
    for (let round = 0; round < 30; round += 1) {
        const swap = nextHeroSwap(shown, pool, { lastSlot: 2 });
        assert.ok(swap);
        assert.notEqual(swap.slot, 2);
        assert.ok(swap.slot >= 0 && swap.slot < shown.length);
        assert.ok(!shown.includes(swap.item.id));
    }
});

test("nextHeroSwap מחזיר null כשאין תמונה חדשה להציג", () => {
    assert.equal(nextHeroSwap(["p0", "p1"], items(2)), null);
    assert.equal(nextHeroSwap([], items(5)), null);
});

test("nextHeroSwap עם אריח יחיד יכול להחליף אותו שוב", () => {
    const swap = nextHeroSwap(["p0"], items(3), { lastSlot: 0, random: sequence([0]) });
    assert.equal(swap.slot, 0);
});

test("hero-mosaic.js במעטפת של ה-Service Worker ובבדיקת התחביר", () => {
    assert.match(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), /"\.\/hero-mosaic\.js"/);
    assert.match(readFileSync(new URL("./package.json", import.meta.url), "utf8"), /node --check hero-mosaic\.js/);
});
