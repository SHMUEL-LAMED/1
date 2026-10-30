// מצב מהיר באישור העלאות (pending-swipe-model.js): כיוון ההחלקה לפי כיוון
// הקריאה, הסף להחלטה, המקשים, פרטי הכרטיס ותור ההחלטות עם חלון הביטול.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SWIPE_UNDO_MS, SWIPE_DECIDE_MIN, swipeActionForDx, decideCardSwipe, swipeProgress,
    keyAction, mergeQueueOrder, pendingCardDetails, createSwipeSession
} from './pending-swipe-model.js';

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

// ההבטחה של commit נפתרת רק אחרי סבב של microtasks.
const flush = () => new Promise(resolve => setImmediate(resolve));

function session(options = {}) {
    const clock = fakeClock();
    const calls = [];
    const errors = [];
    let changes = 0;
    const api = createSwipeSession({
        commit: async (id, action, meta) => { calls.push({ id, action, meta }); },
        onChange: () => { changes += 1; },
        onError: (error, entry) => errors.push({ message: error.message, ...entry }),
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        now: clock.now,
        ...options
    });
    return { api, clock, calls, errors, changes: () => changes };
}

test('גרירה ימינה מאשרת באתר העברי, ושמאלה דוחה; ב-LTR ההפך', () => {
    assert.equal(swipeActionForDx(120, 'rtl'), 'approve');
    assert.equal(swipeActionForDx(-120, 'rtl'), 'reject');
    assert.equal(swipeActionForDx(-120, 'ltr'), 'approve');
    assert.equal(swipeActionForDx(120, 'ltr'), 'reject');
    assert.equal(swipeActionForDx(0, 'rtl'), null);
});

test('ההחלטה: רחוק מספיק, או הנפה מהירה לכיוון הגרירה; אנכי אינו מחליט', () => {
    // כרטיס צר: הסף הוא המינימום ולא רבע מהרוחב.
    assert.equal(decideCardSwipe({ dx: SWIPE_DECIDE_MIN, dy: 4, width: 200 }), 'approve');
    assert.equal(decideCardSwipe({ dx: SWIPE_DECIDE_MIN - 1, dy: 0, width: 200 }), null);
    // כרטיס רחב: 28% מהרוחב.
    assert.equal(decideCardSwipe({ dx: -120, dy: 0, width: 600 }), null);
    assert.equal(decideCardSwipe({ dx: -170, dy: 0, width: 600 }), 'reject');
    // הנפה: קצרה אבל מהירה — ורק כשהיד עדיין נעה לאותו כיוון.
    assert.equal(decideCardSwipe({ dx: 64, dy: 0, vx: 0.9, width: 400 }), 'approve');
    assert.equal(decideCardSwipe({ dx: 64, dy: 0, vx: -0.9, width: 400 }), null);
    assert.equal(decideCardSwipe({ dx: 40, dy: 0, vx: 2, width: 400 }), null);
    // גלילה אנכית, גם ארוכה, אינה אישור.
    assert.equal(decideCardSwipe({ dx: 90, dy: 200, width: 300 }), null);
    assert.equal(decideCardSwipe({ dx: 3, dy: 2, width: 300 }), null);
    assert.equal(decideCardSwipe({ dx: 200, dy: 0, width: 300, direction: 'ltr' }), 'reject');
});

test('ההתקדמות לחותמת: 0 במקום, 1 בסף ומעבר לו', () => {
    assert.equal(swipeProgress(0, 300), 0);
    assert.equal(swipeProgress(SWIPE_DECIDE_MIN / 2, 100), 0.5);
    assert.equal(swipeProgress(-1000, 300), 1);
    assert.equal(swipeProgress(NaN, 300), 0);
});

test('מקשים: חצים לפי הכיוון, A/R לפי המקש הפיזי, Enter, ביטול ויציאה', () => {
    assert.equal(keyAction({ key: 'ArrowRight' }), 'approve');
    assert.equal(keyAction({ key: 'ArrowLeft' }), 'reject');
    assert.equal(keyAction({ key: 'ArrowRight' }, 'ltr'), 'reject');
    assert.equal(keyAction({ key: 'Enter' }), 'approve');
    assert.equal(keyAction({ key: 'Enter', shiftKey: true }), null);
    // מקלדת בעברית: המקש הפיזי A מפיק ש, R מפיק ר.
    assert.equal(keyAction({ key: 'ש', code: 'KeyA' }), 'approve');
    assert.equal(keyAction({ key: 'ר', code: 'KeyR' }), 'reject');
    assert.equal(keyAction({ key: 'a' }), 'approve');
    assert.equal(keyAction({ key: 'R' }), 'reject');
    assert.equal(keyAction({ key: 'z', code: 'KeyZ' }), 'undo');
    assert.equal(keyAction({ key: 'Backspace' }), 'undo');
    assert.equal(keyAction({ key: 'z', code: 'KeyZ', ctrlKey: true }), 'undo');
    assert.equal(keyAction({ key: 'z', code: 'KeyZ', metaKey: true }), 'undo');
    assert.equal(keyAction({ key: 'Escape' }), 'close');
    // קיצורים של הדפדפן נשארים שלו.
    assert.equal(keyAction({ key: 'r', code: 'KeyR', ctrlKey: true }), null);
    assert.equal(keyAction({ key: 'a', code: 'KeyA', metaKey: true }), null);
    assert.equal(keyAction({ key: 'ArrowRight', altKey: true }), null);
    assert.equal(keyAction({ key: 'x', code: 'KeyX' }), null);
    assert.equal(keyAction(), null);
});

test('סדר התור: נשמר לאורך המפגש, מה שנעלם יוצא ומה שחדש נכנס לסוף', () => {
    assert.deepEqual(mergeQueueOrder([], ['c', 'b', 'a']), ['c', 'b', 'a']);
    // פריט חדש מגיע לראש הרשימה הממוינת, אבל בתור הוא אחרון.
    assert.deepEqual(mergeQueueOrder(['c', 'b', 'a'], ['d', 'c', 'b', 'a']), ['c', 'b', 'a', 'd']);
    // מנהל אחר אישר את b.
    assert.deepEqual(mergeQueueOrder(['c', 'b', 'a', 'd'], ['d', 'c', 'a']), ['c', 'a', 'd']);
    // כפילויות וערכים ריקים אינם נכנסים.
    assert.deepEqual(mergeQueueOrder(['a', 'a'], ['a', '', null, 'b', 'b']), ['a', 'b']);
    assert.deepEqual(mergeQueueOrder(null, null), []);
});

test('פרטי הכרטיס: מעלה, תיקייה מקורית, יעד ותאריכים', () => {
    const folders = [{ id: '1', name: 'אירועים ופעילויות' }, { id: '4', name: 'כללי' }];
    const record = {
        title: 'ריקוד', uploadedByName: 'דוד כהן', uploadedByEmail: 'david@example.com',
        originalFolderName: 'הקפות', createdAt: 1_700_000_000_000, takenAt: 1_690_000_000_000
    };
    const auto = pendingCardDetails(record, { folders });
    assert.equal(auto.title, 'ריקוד');
    assert.equal(auto.kind, 'תמונה');
    assert.equal(auto.uploader, 'דוד כהן');
    assert.equal(auto.uploaderEmail, 'david@example.com');
    assert.equal(auto.sourceFolder, 'הקפות');
    // "אוטומטי": תיקייה בשם המקורי, שתיווצר כי אינה קיימת.
    assert.equal(auto.destination, 'הקפות');
    assert.equal(auto.createsFolder, true);
    assert.equal(auto.uploadedAt, 1_700_000_000_000);
    assert.equal(auto.takenAt, 1_690_000_000_000);

    const chosen = pendingCardDetails(record, { folders, targetFolderId: '1' });
    assert.equal(chosen.destination, 'אירועים ופעילויות');
    assert.equal(chosen.createsFolder, false);

    // בלי שם תיקייה מקורית האישור שומר ב"כללי", שכבר קיימת.
    const bare = pendingCardDetails({ uploadedByEmail: 'x@example.com', createdAt: 'לא תאריך' }, { folders, isVideo: true });
    assert.equal(bare.title, 'סרטון ללא שם');
    assert.equal(bare.kind, 'סרטון');
    assert.equal(bare.uploader, 'x@example.com');
    assert.equal(bare.uploaderEmail, '');
    assert.equal(bare.destination, 'כללי');
    assert.equal(bare.createsFolder, false);
    assert.equal(bare.uploadedAt, null);
    assert.equal(bare.takenAt, null);
    assert.equal(pendingCardDetails(null).uploader, 'מעלה לא ידוע');
});

test('החלטה ממתינה עד סוף חלון הביטול, ורק אז נשלחת', async () => {
    const { api, clock, calls } = session();
    assert.deepEqual(api.queue(['a', 'b', 'c']), ['a', 'b', 'c']);
    assert.equal(api.decide('a', 'approve', { folder: 'auto' }), true);
    // הפריט כבר יצא מהתור, אבל עוד לא נשלח.
    assert.deepEqual(api.queue(['a', 'b', 'c']), ['b', 'c']);
    assert.deepEqual(api.pending, { id: 'a', action: 'approve', deadline: SWIPE_UNDO_MS });
    clock.advance(SWIPE_UNDO_MS - 1);
    assert.equal(calls.length, 0);
    clock.advance(1);
    await flush();
    assert.deepEqual(calls, [{ id: 'a', action: 'approve', meta: { folder: 'auto' } }]);
    assert.equal(api.pending, null);
    assert.equal(api.committed, 1);
    assert.deepEqual(api.queue(['a', 'b', 'c']), ['b', 'c']);
});

test('ביטול מחזיר את הפריט לראש התור, ושום דבר אינו נשלח', async () => {
    const { api, clock, calls } = session();
    api.decide('a', 'reject');
    assert.deepEqual(api.undo(), { id: 'a', action: 'reject' });
    assert.deepEqual(api.queue(['a', 'b']), ['a', 'b']);
    assert.equal(clock.pending(), 0);
    clock.advance(SWIPE_UNDO_MS * 2);
    await flush();
    assert.equal(calls.length, 0);
    // אין מה לבטל פעמיים.
    assert.equal(api.undo(), null);
    // ואחרי הביטול אפשר להחליט שוב על אותו פריט.
    assert.equal(api.decide('a', 'approve'), true);
});

test('החלטה חדשה שולחת מיד את הקודמת; "בטל" מחזיר רק את האחרונה', async () => {
    const { api, clock, calls } = session();
    api.decide('a', 'approve');
    clock.advance(1000);
    api.decide('b', 'reject');
    await flush();
    assert.deepEqual(calls.map(call => call.id), ['a']);
    assert.deepEqual(api.undo(), { id: 'b', action: 'reject' });
    assert.deepEqual(api.queue(['a', 'b', 'c']), ['b', 'c']);
    clock.advance(SWIPE_UNDO_MS);
    await flush();
    assert.deepEqual(calls.map(call => call.id), ['a']);
});

test('flush שולח מיד (יציאה מהמצב המהיר), ופריט שכבר הוחלט אינו מוחלט שוב', async () => {
    const { api, clock, calls } = session();
    api.decide('a', 'reject');
    assert.equal(api.decide('a', 'approve'), false);
    assert.equal(api.decide('', 'approve'), false);
    assert.equal(api.decide('b', 'delete'), false);
    await api.flush();
    assert.deepEqual(calls, [{ id: 'a', action: 'reject', meta: undefined }]);
    assert.equal(clock.pending(), 0);
    assert.equal(api.pending, null);
    await api.flush();
    assert.equal(calls.length, 1);
});

test('שמירה שנכשלה מחזירה את הפריט לתור ומדווחת', async () => {
    const { api, clock, errors } = session({
        commit: async id => { if (id === 'bad') throw new Error('השרת סירב'); }
    });
    api.decide('bad', 'approve');
    assert.equal(api.isHandled('bad'), true);
    clock.advance(SWIPE_UNDO_MS);
    assert.equal(api.busy, true);
    await flush();
    assert.equal(api.busy, false);
    assert.deepEqual(errors, [{ message: 'השרת סירב', id: 'bad', action: 'approve' }]);
    assert.deepEqual(api.queue(['bad', 'b']), ['bad', 'b']);
    assert.equal(api.committed, 0);
});

test('commit שזורק באופן סינכרוני מטופל כמו כישלון', async () => {
    const { api, errors } = session({ commit: () => { throw new Error('אין הרשאה'); } });
    api.decide('a', 'approve');
    await api.flush();
    assert.equal(errors.length, 1);
    assert.deepEqual(api.queue(['a']), ['a']);
});

test('כל שינוי מודיע ל-onChange: החלטה, ביטול ושמירה', async () => {
    const { api, clock, changes } = session();
    api.decide('a', 'approve');
    assert.equal(changes(), 1);
    api.undo();
    assert.equal(changes(), 2);
    api.decide('a', 'approve');
    clock.advance(SWIPE_UNDO_MS);
    await flush();
    assert.equal(changes(), 4);
});
