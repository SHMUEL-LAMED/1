// מסך גדול (big-screen-model.js): מרווח הבדיקה (לא פחות מדקה), עצירה כשהלשונית
// מוסתרת, אילו פריטים חדשים ואיפה הם נכנסים לסבב, הסתרת הפקדים והשעון.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BIG_SCREEN_POLL_MIN_MS, BIG_SCREEN_IDLE_MS, normalizePollInterval, newRotationItems,
    insertAfterIndex, createPollLoop, createIdleTimer, formatClock, msUntilNextMinute
} from './big-screen-model.js';

// שעון מזויף: טיימרים לפי זמן, ו-advance מריץ את מה שהגיע זמנו בסדר.
function fakeClock() {
    let time = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        now: () => time,
        setTimer(fn, ms) { const id = nextId++; timers.set(id, { fn, at: time + ms }); return id; },
        clearTimer(id) { timers.delete(id); },
        pending: () => timers.size,
        advance(ms) {
            const end = time + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                time = due[1].at;
                due[1].fn();
            }
            time = end;
        }
    };
}

// ההבטחה של poll נפתרת רק אחרי סבב של microtasks.
const flush = () => new Promise(resolve => setImmediate(resolve));

const item = id => ({ id });
const ids = list => list.map(entry => entry.id);

test('מרווח הבדיקה: לעולם לא פחות מדקה', () => {
    assert.equal(BIG_SCREEN_POLL_MIN_MS, 60_000);
    assert.equal(normalizePollInterval(5_000), 60_000);
    assert.equal(normalizePollInterval(0), 60_000);
    assert.equal(normalizePollInterval(-1), 60_000);
    assert.equal(normalizePollInterval('abc'), 60_000);
    assert.equal(normalizePollInterval(undefined), 60_000);
    assert.equal(normalizePollInterval(90_000), 90_000);
    assert.equal(normalizePollInterval('120000'), 120_000);
});

test('פריטים חדשים: מה שבתצוגה ואינו בסבב, בסדר התצוגה ובלי כפילויות', () => {
    const rotation = [item('a'), item('b'), item('c')];
    const view = [item('d'), item('a'), item('e'), item('d'), item('b'), { id: '' }, null];
    assert.deepEqual(ids(newRotationItems(rotation, view)), ['d', 'e']);
    assert.deepEqual(newRotationItems(rotation, rotation), []);
    assert.deepEqual(newRotationItems(rotation, null), []);
    assert.deepEqual(ids(newRotationItems(null, [item('x')])), ['x']);
});

test('פריט שכבר היה בסבב פעם אינו "חדש" שוב', () => {
    const seen = new Set(['old']);
    assert.deepEqual(ids(newRotationItems([item('a')], [item('old'), item('new')], { seen })), ['new']);
});

test('מזהה מותאם (safeRecordId) משמש להשוואה', () => {
    const idOf = entry => String(entry?.id ?? '').trim().toLowerCase();
    assert.deepEqual(ids(newRotationItems([item('A ')], [item('a'), item('b')], { idOf })), ['b']);
});

test('הכנסה לסבב: מיד אחרי הנוכחי, בלי לשנות את המקור', () => {
    const rotation = [item('a'), item('b'), item('c')];
    const result = insertAfterIndex(rotation, 1, [item('x'), item('y')]);
    assert.deepEqual(ids(result), ['a', 'b', 'x', 'y', 'c']);
    assert.deepEqual(ids(rotation), ['a', 'b', 'c']);
    // בשקופית האחרונה: בסוף, ואז הסבב חוזר להתחלה.
    assert.deepEqual(ids(insertAfterIndex(rotation, 2, [item('x')])), ['a', 'b', 'c', 'x']);
    // אינדקס לא תקין: בתחילה.
    assert.deepEqual(ids(insertAfterIndex(rotation, -1, [item('x')])), ['x', 'a', 'b', 'c']);
    assert.deepEqual(ids(insertAfterIndex(rotation, Number.NaN, [item('x')])), ['x', 'a', 'b', 'c']);
    assert.deepEqual(ids(insertAfterIndex(rotation, 99, [item('x')])), ['a', 'b', 'c', 'x']);
    assert.deepEqual(ids(insertAfterIndex(null, 0, [item('x')])), ['x']);
});

test('לולאת הבדיקה: הבדיקה הראשונה אחרי מרווח שלם, ואחריה כל מרווח', async () => {
    const clock = fakeClock();
    let polls = 0;
    const loop = createPollLoop({ interval: 1_000, poll: async () => { polls += 1; }, ...clock });
    loop.start();
    // מרווח קצר מדי מתוקן לדקה.
    clock.advance(59_999);
    assert.equal(polls, 0);
    clock.advance(1);
    assert.equal(polls, 1);
    await flush();
    clock.advance(60_000);
    assert.equal(polls, 2);
    await flush();
    loop.stop();
    clock.advance(600_000);
    assert.equal(polls, 2);
    assert.equal(clock.pending(), 0);
    assert.equal(loop.running, false);
});

test('לולאת הבדיקה: בדיקה איטית אינה חופפת לבאה, והמרווח נמדד מסופה', async () => {
    const clock = fakeClock();
    let release;
    let polls = 0;
    const loop = createPollLoop({
        poll: () => { polls += 1; return new Promise(resolve => { release = resolve; }); },
        ...clock
    });
    loop.start();
    clock.advance(60_000);
    assert.equal(polls, 1);
    // הבקשה עוד רצה: אין טיימר ואין בקשה שנייה.
    clock.advance(180_000);
    assert.equal(polls, 1);
    assert.equal(loop.armed, false);
    release();
    await flush();
    assert.equal(loop.armed, true);
    clock.advance(59_999);
    assert.equal(polls, 1);
    clock.advance(1);
    assert.equal(polls, 2);
});

test('לולאת הבדיקה: תקלה ברשת אינה עוצרת את הלולאה', async () => {
    const clock = fakeClock();
    let polls = 0;
    const loop = createPollLoop({ poll: async () => { polls += 1; throw new Error('offline'); }, ...clock });
    loop.start();
    clock.advance(60_000);
    await flush();
    clock.advance(60_000);
    assert.equal(polls, 2);
    assert.equal(loop.pollCount, 2);
});

test('לשונית מוסתרת: אין בדיקות ואין טיימר; בחזרה — מיד רק אם עברה דקה', async () => {
    const clock = fakeClock();
    let hidden = false;
    let polls = 0;
    const loop = createPollLoop({ poll: async () => { polls += 1; }, isHidden: () => hidden, ...clock });
    loop.start();
    clock.advance(20_000);
    hidden = true;
    loop.visibilityChanged();
    assert.equal(loop.armed, false);
    clock.advance(10 * 60_000);
    assert.equal(polls, 0);
    // חזרה אחרי יותר מדקה מהבדיקה (או מההתחלה): בודקים מיד.
    hidden = false;
    loop.visibilityChanged();
    assert.equal(polls, 1);
    await flush();
    // חזרה מהירה אחרי הסתרה קצרה: ממתינים ליתרה, לא בודקים שוב.
    clock.advance(10_000);
    hidden = true;
    loop.visibilityChanged();
    clock.advance(5_000);
    hidden = false;
    loop.visibilityChanged();
    assert.equal(polls, 1);
    clock.advance(44_999);
    assert.equal(polls, 1);
    clock.advance(1);
    assert.equal(polls, 2);
});

test('לשונית מוסתרת כשהטיימר פוקע: הבדיקה נדחית עד החזרה', async () => {
    const clock = fakeClock();
    let hidden = false;
    let polls = 0;
    const loop = createPollLoop({ poll: async () => { polls += 1; }, isHidden: () => hidden, ...clock });
    loop.start();
    hidden = true; // בלי visibilitychange — למשל אירוע שטרם הגיע
    clock.advance(60_000);
    assert.equal(polls, 0);
    assert.equal(loop.armed, false);
    hidden = false;
    loop.visibilityChanged();
    assert.equal(polls, 1);
});

test('לולאה שנעצרה אינה מגיבה לחזרה ללשונית', () => {
    const clock = fakeClock();
    let polls = 0;
    const loop = createPollLoop({ poll: async () => { polls += 1; }, ...clock });
    loop.start();
    loop.stop();
    clock.advance(120_000);
    loop.visibilityChanged();
    assert.equal(polls, 0);
    assert.equal(clock.pending(), 0);
});

test('פקדים וסמן: נעלמים אחרי שקט, חוזרים בתנועה, ונספרים מחדש', () => {
    const clock = fakeClock();
    const events = [];
    const idle = createIdleTimer({ onIdle: () => events.push('idle'), onActive: () => events.push('active'), ...clock });
    assert.equal(BIG_SCREEN_IDLE_MS, 3_000);
    idle.start();
    clock.advance(2_000);
    idle.poke(); // תנועה לפני הזמן: הספירה מתחילה מחדש, בלי אירוע
    clock.advance(2_999);
    assert.deepEqual(events, []);
    clock.advance(1);
    assert.deepEqual(events, ['idle']);
    assert.equal(idle.idle, true);
    idle.poke();
    assert.deepEqual(events, ['idle', 'active']);
    assert.equal(idle.idle, false);
    idle.stop();
    clock.advance(10_000);
    idle.poke();
    assert.deepEqual(events, ['idle', 'active']);
    assert.equal(clock.pending(), 0);
});

test('שעון: שעות ודקות ב-24 שעות, וזמן עד הדקה הבאה', () => {
    assert.equal(formatClock(new Date(2026, 9, 30, 9, 5, 59)), '09:05');
    assert.equal(formatClock(new Date(2026, 9, 30, 21, 40)), '21:40');
    assert.equal(formatClock(new Date(2026, 9, 30, 0, 0)), '00:00');
    assert.equal(formatClock('not a date'), '');
    assert.equal(formatClock(new Date(2026, 9, 30, 13, 7).getTime()), '13:07');
    assert.equal(msUntilNextMinute(Date.UTC(2026, 9, 30, 12, 0, 0)), 60_000);
    assert.equal(msUntilNextMinute(Date.UTC(2026, 9, 30, 12, 0, 45, 500)), 14_500);
    assert.equal(msUntilNextMinute(Date.UTC(2026, 9, 30, 12, 0, 59, 999)), 1);
    assert.equal(msUntilNextMinute(Number.NaN), 60_000);
});
