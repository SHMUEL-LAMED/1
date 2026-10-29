// הסדר האקראי של הגלריה ו"תמונה אקראית": ערבוב לפי זרע, סדר שנשאר יציב
// בין ציורים ועמודים, ערבוב מחדש, ובחירה שאינה חוזרת על הפריט הקודם.
import test from "node:test";
import assert from "node:assert/strict";
import {
    seededRandom, seededShuffle, createRandomSeed, createStableShuffle, pickRandomItem
} from "./gallery-random.js";

const items = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => ({ id: `img-${from + index}` }));
const ids = list => list.map(item => item.id);

test("המחולל: אותו זרע — אותה סדרה, בטווח [0, 1)", () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const other = seededRandom(43);
    const a = Array.from({ length: 50 }, () => first());
    const b = Array.from({ length: 50 }, () => second());
    const c = Array.from({ length: 50 }, () => other());
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.ok(a.every(value => value >= 0 && value < 1));
});

test("זרע חדש נגזר מ-random ונשאר מספר שלם חיובי של 32 ביט", () => {
    assert.equal(createRandomSeed(() => 0), 0);
    assert.equal(createRandomSeed(() => 0.5), 2147483648);
    assert.equal(createRandomSeed(() => 0.999999999999), 4294967295);
});

test("ערבוב לפי זרע: פרמוטציה של אותם פריטים, דטרמיניסטי, ואינו משנה את המקור", () => {
    const source = ids(items(1, 30));
    const frozen = [...source];
    const shuffled = seededShuffle(source, 7);
    assert.deepEqual(source, frozen);
    assert.deepEqual([...shuffled].sort(), [...source].sort());
    assert.deepEqual(seededShuffle(source, 7), shuffled);
    assert.notDeepEqual(shuffled, source);
    assert.notDeepEqual(seededShuffle(source, 8), shuffled);
    assert.deepEqual(seededShuffle(null, 1), []);
});

test("הערבוב מפזר: כל פריט מגיע לכל מקום בתדירות דומה", () => {
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    for (let seed = 1; seed <= 4000; seed += 1) {
        seededShuffle([0, 1, 2, 3], seed).forEach((value, position) => { counts[value][position] += 1; });
    }
    for (const row of counts) for (const count of row) assert.ok(count > 850 && count < 1150, `התפלגות לא אחידה: ${row}`);
});

test("סדר יציב: ציור חוזר באותו סדר, ואותו זרע נותן אותו סדר בלי תלות בסדר הקלט", () => {
    const shuffle = createStableShuffle({ seed: 99 });
    const list = items(1, 40);
    const first = ids(shuffle.order(list, "all"));
    assert.notDeepEqual(first, ids(list));
    assert.deepEqual(ids(shuffle.order(list, "all")), first);
    assert.deepEqual(ids(shuffle.order([...list].reverse(), "all")), first);
    assert.deepEqual(ids(createStableShuffle({ seed: 99 }).order([...list].reverse(), "all")), first);
});

test("עמוד נוסף בגלילה אינו מערבב את מה שכבר מוצג: החדשים נוספים בסוף", () => {
    const shuffle = createStableShuffle({ seed: 5 });
    const firstPage = ids(shuffle.order(items(1, 30), "all"));
    const withSecond = ids(shuffle.order([...items(1, 30), ...items(31, 60)], "all"));
    assert.deepEqual(withSecond.slice(0, 30), firstPage);
    assert.deepEqual([...withSecond.slice(30)].sort(), ids(items(31, 60)).sort());
    assert.notDeepEqual(withSecond.slice(30), ids(items(31, 60)), "גם העמוד החדש מעורבב");
});

test("סינון וביטולו שומרים על הסדר היחסי, כשכל התיקייה דורגה מראש", () => {
    const shuffle = createStableShuffle({ seed: 11 });
    const all = items(1, 20);
    shuffle.include(all, "1");
    const full = ids(shuffle.order(all, "1"));
    const even = all.filter((_, index) => index % 2 === 0);
    assert.deepEqual(ids(shuffle.order(even, "1")), full.filter(id => ids(even).includes(id)));
    assert.deepEqual(ids(shuffle.order(all, "1")), full);
});

test("כל תיקייה מדורגת בנפרד", () => {
    const shuffle = createStableShuffle({ seed: 3 });
    const folder = items(1, 10);
    shuffle.order(folder, "1");
    const all = ids(shuffle.order(items(1, 40), "all"));
    // ב"כל הארכיון" פריטי התיקייה הקודמת אינם מקובצים בראש הרשימה.
    assert.notDeepEqual([...all.slice(0, 10)].sort(), ids(folder).sort());
});

test("פריט בלי מזהה נשאר בסוף, בסדר שבו הגיע", () => {
    const shuffle = createStableShuffle({ seed: 1 });
    const result = shuffle.order([{ id: "" }, ...items(1, 5), { title: "בלי מזהה" }], "all");
    assert.deepEqual(result.slice(-2), [{ id: "" }, { title: "בלי מזהה" }]);
});

test("ערבוב מחדש: זרע חדש וסדר חדש, ואז שוב יציב", () => {
    const shuffle = createStableShuffle({ seed: 21 });
    const list = items(1, 30);
    const before = ids(shuffle.order(list, "all"));
    assert.equal(shuffle.seed, 21);
    assert.equal(shuffle.reshuffle(22), 22);
    assert.equal(shuffle.seed, 22);
    const after = ids(shuffle.order(list, "all"));
    assert.notDeepEqual(after, before);
    assert.deepEqual(ids(shuffle.order(list, "all")), after);
    assert.equal(typeof shuffle.reshuffle(), "number");
});

test("תמונה אקראית: אינה חוזרת על הקודמת, אלא כשהיא היחידה", () => {
    const list = items(1, 3);
    for (let draw = 0; draw < 200; draw += 1) {
        const pick = pickRandomItem(list, { excludeKey: "img-2" });
        assert.notEqual(pick.id, "img-2");
    }
    assert.equal(pickRandomItem(items(1, 1), { excludeKey: "img-1" }).id, "img-1");
    assert.equal(pickRandomItem([], { excludeKey: "img-1" }), null);
    assert.equal(pickRandomItem(null), null);
    assert.equal(pickRandomItem([{ id: "" }, { title: "x" }]), null);
});

test("תמונה אקראית: random קובע את הבחירה, וקצוות הטווח בטוחים", () => {
    const list = items(1, 4);
    assert.equal(pickRandomItem(list, { random: () => 0 }).id, "img-1");
    assert.equal(pickRandomItem(list, { random: () => 0.9999 }).id, "img-4");
    assert.equal(pickRandomItem(list, { random: () => 1 }).id, "img-4");
    assert.equal(pickRandomItem(list, { random: () => Number.NaN }).id, "img-1");
    // בלי הקודמת המאגר מצטמצם, והמיקום נמדד בו.
    assert.equal(pickRandomItem(list, { excludeKey: "img-1", random: () => 0 }).id, "img-2");
    // מפתח שאינו ברשימה אינו מצמצם דבר.
    assert.equal(pickRandomItem(list, { excludeKey: "img-9", random: () => 0 }).id, "img-1");
});
