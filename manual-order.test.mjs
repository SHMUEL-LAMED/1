// בדיקות הסדר הידני (manual-order.js): מדורגים קודם, לא מדורגים אחריהם בסדר
// שלהם, והזזה שולחת רק את מה שהשתנה.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ORDER_STEP, chunkOrderChanges, clearRanks, compareByManualRank, moveItem,
    rankChanges, rankOf, sortByManualRank
} from './manual-order.js';

const byTaken = (a, b) => a.takenAt - b.takenAt;
const apply = (items, changes) => {
    const map = new Map(changes.map(change => [change.id, change.order]));
    return items.map(item => (map.has(item.id) ? { ...item, order: map.get(item.id) ?? undefined } : item));
};
const ids = list => list.map(item => item.id);

test('מדורגים קודם, ואחריהם הלא מדורגים לפי תאריך הצילום', () => {
    const items = [
        { id: 'c', takenAt: 3 }, { id: 'r2', takenAt: 9, order: 2048 },
        { id: 'a', takenAt: 1 }, { id: 'r1', takenAt: 8, order: 1024 }
    ];
    assert.deepEqual(ids(sortByManualRank(items, byTaken)), ['r1', 'r2', 'a', 'c']);
    assert.equal(rankOf({ order: '5' }), null);
    assert.equal(rankOf({ order: null }), null);
    assert.equal(compareByManualRank({ order: 1 }, {}), -1);
});

test('בלי דירוגים ובלי שינוי — אין מה לכתוב', () => {
    const items = [{ id: 'a', takenAt: 1 }, { id: 'b', takenAt: 2 }];
    assert.deepEqual(rankChanges(items, { fallback: byTaken }), []);
});

test('הזזה ראשונה: רק הפריטים שעד המקום החדש מקבלים דירוג', () => {
    const items = [{ id: 'a', takenAt: 1 }, { id: 'b', takenAt: 2 }, { id: 'c', takenAt: 3 }, { id: 'd', takenAt: 4 }];
    const moved = moveItem(items, 2, 0); // c, a, b, d
    const changes = rankChanges(moved, { fallback: byTaken });
    assert.deepEqual(changes, [{ id: 'c', order: ORDER_STEP }]);
    assert.deepEqual(ids(sortByManualRank(apply(items, changes), byTaken)), ['c', 'a', 'b', 'd']);
});

test('הזזה בין שני מדורגים משנה רק את הפריט שזז', () => {
    const items = [
        { id: 'a', order: 1024, takenAt: 1 }, { id: 'b', order: 2048, takenAt: 2 },
        { id: 'c', order: 3072, takenAt: 3 }, { id: 'd', order: 4096, takenAt: 4 }
    ];
    const moved = moveItem(items, 3, 1); // a, d, b, c
    const changes = rankChanges(moved, { fallback: byTaken });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].id, 'd');
    assert.ok(changes[0].order > 1024 && changes[0].order < 2048);
    assert.deepEqual(ids(sortByManualRank(apply(items, changes), byTaken)), ['a', 'd', 'b', 'c']);
});

test('פריט לא מדורג שזז אל אמצע הזנב מדרג גם את מי שלפניו', () => {
    const items = [{ id: 'r', order: 10, takenAt: 0 }, { id: 'a', takenAt: 1 }, { id: 'b', takenAt: 2 }, { id: 'c', takenAt: 3 }];
    const moved = moveItem(items, 3, 2); // r, a, c, b
    const changes = rankChanges(moved, { fallback: byTaken });
    assert.deepEqual(ids(sortByManualRank(apply(items, changes), byTaken)), ['r', 'a', 'c', 'b']);
    assert.equal(changes.some(change => change.id === 'r'), false, 'הדירוג הקיים נשמר');
    assert.equal(changes.some(change => change.id === 'b'), false, 'הזנב נשאר בלי דירוג');
});

test('אין רווח בין שכנים — הקטע מקבל דירוג חדש מלא ועדיין נכון', () => {
    const items = [{ id: 'a', order: 1, takenAt: 1 }, { id: 'b', order: 1 + 1e-9, takenAt: 2 }, { id: 'c', takenAt: 3 }];
    const moved = moveItem(items, 2, 1); // a, c, b
    const changes = rankChanges(moved, { fallback: byTaken });
    assert.deepEqual(ids(sortByManualRank(apply(items, changes), byTaken)), ['a', 'c', 'b']);
    assert.ok(changes.every(change => Number.isFinite(change.order)));
});

test('סדר אקראי של מאות פריטים תמיד מתקבל בדיוק', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let items = Array.from({ length: 300 }, (_, index) => ({ id: `i${index}`, takenAt: index, ...(random() < 0.3 ? { order: Math.round(random() * 1e6) } : {}) }));
    for (let round = 0; round < 40; round += 1) {
        const current = sortByManualRank(items, byTaken);
        const target = moveItem(current, Math.floor(random() * current.length), Math.floor(random() * current.length));
        const changes = rankChanges(target, { fallback: byTaken });
        items = apply(items, changes);
        assert.deepEqual(ids(sortByManualRank(items, byTaken)), ids(target), `סבב ${round}`);
    }
});

test('איפוס, וחלוקה לבקשות של עד 500', () => {
    assert.deepEqual(clearRanks([{ id: 'a', order: 1 }, { id: 'b' }]), [{ id: 'a', order: null }]);
    const chunks = chunkOrderChanges(Array.from({ length: 1001 }, (_, index) => ({ id: `i${index}`, order: index })));
    assert.deepEqual(chunks.map(chunk => chunk.length), [500, 500, 1]);
});
