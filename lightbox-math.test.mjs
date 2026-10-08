// החשבון של התצוגה המלאה: זום סביב עוגן ומגבלות הזזה, ההחלטה על החלקה
// (מרחק, מהירות, כיוון מימין לשמאל, קצוות), ומתזמן המצגת עם שעונים מזויפים.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    clampScale, zoomAt, clampPan, panLimits, toggleZoomAt, pinchView, isZoomed, wheelZoomFactor,
    ZOOM_MIN, ZOOM_MAX, DOUBLE_TAP_ZOOM,
    lockAxis, swipeStep, decideSwipe, rubberBand, velocityFromSamples,
    createSlideshowScheduler, normalizeSlideshowInterval, SLIDESHOW_INTERVALS
} from "./lightbox-math.js";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

// --- זום ---

test("הזום מוגבל בין 1x ל-5x", () => {
    assert.equal(ZOOM_MIN, 1);
    assert.equal(ZOOM_MAX, 5);
    assert.equal(clampScale(0.3), 1);
    assert.equal(clampScale(12), 5);
    assert.equal(clampScale(2.2), 2.2);
    assert.equal(clampScale(Number.NaN), 1);
});

test("זום סביב עוגן: הנקודה שמתחת לסמן נשארת במקומה", () => {
    const view = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 100, y: -40 };
    const next = zoomAt(view, 2, anchor);
    assert.equal(next.scale, 2);
    // הנקודה u שהייתה מתחת לעוגן: p = x + s·u.
    const u = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale };
    close(next.x + next.scale * u.x, anchor.x, "x של העוגן");
    close(next.y + next.scale * u.y, anchor.y, "y של העוגן");
    // ומשם עוד הגדלה סביב עוגן אחר.
    const further = zoomAt(next, 4, { x: -30, y: 20 });
    const u2 = { x: (-30 - next.x) / next.scale, y: (20 - next.y) / next.scale };
    close(further.x + 4 * u2.x, -30, "x אחרי הגדלה שנייה");
    close(further.y + 4 * u2.y, 20, "y אחרי הגדלה שנייה");
});

test("זום סביב המרכז אינו מזיז, וזום מתחת ל-1x חוזר למצב ההתחלתי", () => {
    assert.deepEqual(zoomAt({ scale: 1, x: 0, y: 0 }, 3, { x: 0, y: 0 }), { scale: 3, x: 0, y: 0 });
    assert.deepEqual(zoomAt({ scale: 3, x: 50, y: 10 }, 0.5, { x: 5, y: 5 }), { scale: 1, x: 0, y: 0 });
    // מעבר ל-5x נעצר ב-5x, והעוגן עדיין נשמר.
    const capped = zoomAt({ scale: 4, x: 0, y: 0 }, 9, { x: 40, y: 0 });
    assert.equal(capped.scale, 5);
    close(capped.x + 5 * (40 / 4), 40, "העוגן נשמר גם בתקרה");
});

test("גבולות ההזזה: עד שקצה התמונה נוגע בקצה הבמה, וציר צר נשאר ממורכז", () => {
    const content = { width: 400, height: 300 };
    const viewport = { width: 500, height: 500 };
    assert.deepEqual(panLimits(1, content, viewport), { x: 0, y: 0 });
    assert.deepEqual(panLimits(2, content, viewport), { x: 150, y: 50 });
    assert.deepEqual(clampPan({ scale: 2, x: 999, y: -999 }, content, viewport), { scale: 2, x: 150, y: -50 });
    assert.deepEqual(clampPan({ scale: 2, x: -20, y: 10 }, content, viewport), { scale: 2, x: -20, y: 10 });
    // 1.5x: הגובה (450) עדיין קטן מהבמה — אין הזזה אנכית.
    assert.deepEqual(clampPan({ scale: 1.5, x: 0, y: 80 }, content, viewport), { scale: 1.5, x: 0, y: 0 });
    // לא מוגדל — תמיד ממורכז.
    assert.deepEqual(clampPan({ scale: 1, x: 30, y: 30 }, content, viewport), { scale: 1, x: 0, y: 0 });
});

test("לחיצה כפולה: 2.5x סביב הנקודה (בגבולות), ושוב — חזרה ל-1x", () => {
    const content = { width: 400, height: 400 };
    const viewport = { width: 400, height: 400 };
    const zoomed = toggleZoomAt({ scale: 1, x: 0, y: 0 }, { x: 100, y: 0 }, content, viewport);
    assert.equal(zoomed.scale, DOUBLE_TAP_ZOOM);
    assert.equal(DOUBLE_TAP_ZOOM, 2.5);
    close(zoomed.x, 100 - 2.5 * 100, "x אחרי לחיצה כפולה");
    // לחיצה בפינה מתרחקת יותר מהמותר — נחתכת לגבול.
    const corner = toggleZoomAt({ scale: 1, x: 0, y: 0 }, { x: -200, y: -200 }, content, viewport);
    assert.deepEqual(corner, { scale: 2.5, x: 300, y: 300 });
    assert.deepEqual(toggleZoomAt(zoomed, { x: 0, y: 0 }, content, viewport), { scale: 1, x: 0, y: 0 });
    assert.ok(isZoomed(zoomed));
    assert.ok(!isZoomed({ scale: 1.005, x: 0, y: 0 }));
});

test("צביטה: יחס המרחקים קובע את הזום, ונקודת האמצע מזיזה", () => {
    const start = { scale: 1, x: 0, y: 0 };
    const view = pinchView(start, 100, 200, { x: 0, y: 0 }, { x: 10, y: -5 });
    assert.deepEqual(view, { scale: 2, x: 10, y: -5 });
    const shrink = pinchView({ scale: 2, x: 10, y: 0 }, 200, 50, { x: 0, y: 0 }, { x: 0, y: 0 });
    assert.deepEqual(shrink, { scale: 1, x: 0, y: 0 });
});

test("גלגלת: למעלה מגדילה, למטה מקטינה, ושורות מתורגמות לפיקסלים", () => {
    assert.ok(wheelZoomFactor(-100) > 1);
    assert.ok(wheelZoomFactor(100) < 1);
    close(wheelZoomFactor(-100) * wheelZoomFactor(100), 1, "סימטריה");
    close(wheelZoomFactor(-3, 1), wheelZoomFactor(-48, 0), "שורות");
    // תקרה לאירוע בודד.
    close(wheelZoomFactor(-5000), wheelZoomFactor(-200), "תקרה");
});

// --- החלקה ---

test("נעילת ציר אחרי סף קטן", () => {
    assert.equal(lockAxis(4, 3), null);
    assert.equal(lockAxis(20, 5), "x");
    assert.equal(lockAxis(-3, 30), "y");
});

test("כיוון: מימין לשמאל גרירה ימינה היא הבא, משמאל לימין — ההפך", () => {
    assert.equal(swipeStep(120, "rtl"), 1);
    assert.equal(swipeStep(-120, "rtl"), -1);
    assert.equal(swipeStep(120, "ltr"), -1);
    assert.equal(swipeStep(-120, "ltr"), 1);
    assert.equal(swipeStep(0, "rtl"), 0);
});

test("החלטת החלקה לפי מרחק", () => {
    const base = { width: 400, height: 800, direction: "rtl" };
    assert.equal(decideSwipe({ ...base, dx: 100, dy: 4 }), "next");
    assert.equal(decideSwipe({ ...base, dx: -100, dy: 4 }), "prev");
    // פחות מחמישית מהרוחב, ולאט — חוזר למקום.
    assert.equal(decideSwipe({ ...base, dx: 60, dy: 2, vx: 0.1 }), "none");
    assert.equal(decideSwipe({ ...base, dx: 100, dy: 4, direction: "ltr" }), "prev");
});

test("החלקה לפי מהירות: הנפה קצרה ומהירה עוברת, הנפה הפוכה לא", () => {
    const base = { width: 400, height: 800, direction: "rtl" };
    assert.equal(decideSwipe({ ...base, dx: 40, dy: 0, vx: 0.9 }), "next");
    assert.equal(decideSwipe({ ...base, dx: -40, dy: 0, vx: -0.9 }), "prev");
    // האצבע חזרה לאחור בסוף: אין מעבר.
    assert.equal(decideSwipe({ ...base, dx: 40, dy: 0, vx: -0.9 }), "none");
    // מהיר אבל זעיר מדי.
    assert.equal(decideSwipe({ ...base, dx: 20, dy: 0, vx: 2, axis: "x" }), "none");
});

test("בקצוות אין דפדוף (גומייה), ומשיכה למטה סוגרת", () => {
    const base = { width: 400, height: 800, direction: "rtl" };
    assert.equal(decideSwipe({ ...base, dx: 200, dy: 0, atEnd: true }), "none");
    assert.equal(decideSwipe({ ...base, dx: -200, dy: 0, atStart: true }), "none");
    assert.equal(decideSwipe({ ...base, dx: -200, dy: 0, atEnd: true }), "prev");
    assert.equal(decideSwipe({ ...base, dx: 5, dy: 200 }), "close");
    assert.equal(decideSwipe({ ...base, dx: 0, dy: 50, vy: 1 }), "close");
    assert.equal(decideSwipe({ ...base, dx: 0, dy: 60, vy: 0.1 }), "none");
    // משיכה למעלה אינה סוגרת.
    assert.equal(decideSwipe({ ...base, dx: 0, dy: -300, vy: -2 }), "none");
});

test("גומייה: תזוזה מוחלשת, בסימן הגרירה, שלעולם אינה עוברת את הגבול", () => {
    assert.equal(rubberBand(0, 400), 0);
    const small = rubberBand(100, 400);
    assert.ok(small > 0 && small < 100);
    assert.ok(rubberBand(-100, 400) === -small);
    assert.ok(rubberBand(100000, 400) < 400);
    assert.ok(rubberBand(300, 400) > rubberBand(100, 400));
});

test("מהירות מהדגימות האחרונות", () => {
    const samples = [{ x: 0, y: 0, t: 0 }, { x: 10, y: 0, t: 100 }, { x: 60, y: 20, t: 150 }, { x: 110, y: 40, t: 200 }];
    const { vx, vy } = velocityFromSamples(samples);
    close(vx, 1, "vx");
    close(vy, 0.4, "vy");
    assert.deepEqual(velocityFromSamples([{ x: 0, y: 0, t: 0 }]), { vx: 0, vy: 0 });
});

// --- מתזמן המצגת ---

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

function makeScheduler(interval = 5000) {
    const clock = fakeClock();
    let advances = 0;
    const scheduler = createSlideshowScheduler({
        interval,
        onAdvance: () => { advances += 1; scheduler.slideShown(); },
        setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: clock.now
    });
    return { clock, scheduler, advances: () => advances };
}

test("הזמנים המותרים: 3, 5 או 8 שניות; ערך אחר חוזר ל-5", () => {
    assert.deepEqual([...SLIDESHOW_INTERVALS], [3000, 5000, 8000]);
    assert.equal(normalizeSlideshowInterval("8000"), 8000);
    assert.equal(normalizeSlideshowInterval(1234), 5000);
    assert.equal(normalizeSlideshowInterval(null), 5000);
});

test("המצגת מתקדמת בכל פרק זמן, ועוצרת ב-stop", () => {
    const { clock, scheduler, advances } = makeScheduler(3000);
    assert.equal(scheduler.state, "idle");
    scheduler.start();
    assert.equal(scheduler.state, "playing");
    clock.advance(2999);
    assert.equal(advances(), 0);
    clock.advance(1);
    assert.equal(advances(), 1);
    clock.advance(6000);
    assert.equal(advances(), 3);
    scheduler.stop();
    assert.equal(scheduler.state, "idle");
    assert.equal(clock.pending(), 0);
    clock.advance(30000);
    assert.equal(advances(), 3);
});

test("השהיה שומרת את הזמן שנותר, והמשך משלים אותו בלבד", () => {
    const { clock, scheduler, advances } = makeScheduler(5000);
    scheduler.start();
    clock.advance(2000);
    assert.equal(scheduler.pause(), true);
    assert.equal(scheduler.state, "paused");
    assert.equal(scheduler.remaining(), 3000);
    clock.advance(60000);
    assert.equal(advances(), 0);
    assert.equal(scheduler.resume(), true);
    clock.advance(2999);
    assert.equal(advances(), 0);
    clock.advance(1);
    assert.equal(advances(), 1);
    // toggle משהה וממשיך.
    scheduler.toggle();
    assert.equal(scheduler.state, "paused");
    scheduler.toggle();
    assert.equal(scheduler.state, "playing");
});

test("סרטון: hold עוצר את הספירה, ו-release בסוף הסרטון מתקדם מיד", () => {
    const { clock, scheduler, advances } = makeScheduler(3000);
    scheduler.start();
    scheduler.hold();
    clock.advance(20000);
    assert.equal(advances(), 0);
    assert.equal(scheduler.release(), true);
    assert.equal(advances(), 1);
    // השקופית הבאה מקבלת זמן מלא.
    clock.advance(3000);
    assert.equal(advances(), 2);
});

test("סרטון שהסתיים בזמן השהיה: ההמשך מתקדם מיד", () => {
    const { clock, scheduler, advances } = makeScheduler(5000);
    scheduler.start();
    scheduler.hold();
    scheduler.pause();
    assert.equal(scheduler.release(), false);
    assert.equal(advances(), 0);
    scheduler.resume();
    clock.advance(0);
    assert.equal(advances(), 1);
});

test("שינוי הזמן לשקופית מתחיל ספירה חדשה, ומעבר ידני נותן זמן מלא", () => {
    const { clock, scheduler, advances } = makeScheduler(5000);
    scheduler.start();
    clock.advance(4000);
    scheduler.setInterval(8000);
    assert.equal(scheduler.interval, 8000);
    clock.advance(7999);
    assert.equal(advances(), 0);
    clock.advance(1);
    assert.equal(advances(), 1);
    clock.advance(6000);
    scheduler.slideShown();
    clock.advance(7999);
    assert.equal(advances(), 1);
    clock.advance(1);
    assert.equal(advances(), 2);
});

test("המודולים החדשים במעטפת, בבדיקת התחביר ובסריקת Tailwind", () => {
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    const shell = sw.slice(sw.indexOf("const APP_SHELL"), sw.indexOf("];", sw.indexOf("const APP_SHELL")));
    const pkg = readFileSync(new URL("./package.json", import.meta.url), "utf8");
    for (const file of ["lightbox-math.js", "lightbox-gestures.js", "lightbox-slideshow.js"]) {
        assert.ok(shell.includes(`"./${file}"`), `${file} חסר במעטפת`);
        assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
    }
    assert.ok(readFileSync(new URL("./tailwind.config.js", import.meta.url), "utf8").includes("./lightbox-slideshow.js"));
});
