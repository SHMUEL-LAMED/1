// big-screen-model.js — ההיגיון של "מסך גדול", בלי DOM: מתי בודקים אם נוספו
// פריטים (ולא יותר מפעם בדקה, ובלי בדיקה כשהלשונית מוסתרת), אילו פריטים
// חדשים ואיפה הם נכנסים לסבב, אילו פריטים יוצאים ממנו (נמחקו או שאישורם
// בוטל), מתי הפקדים והסמן נעלמים, והשעון שבפינה.
// big-screen.js מחבר אותו לדף, והבדיקות (big-screen-model.test.mjs) בודקות
// אותו ישירות עם שעונים מוזרקים — כמו createSlideshowScheduler ב-lightbox-math.js.

// מסך באולם דולק שעות. בדיקה בכל דקה מספיקה כדי שתמונה שאושרה תופיע תוך
// זמן קצר, וזולה: הבקשה היא העמוד הראשון של התיקייה, ו-ETag מחזיר 304 ריק
// כשלא השתנה דבר (cloudflare-client.js).
export const BIG_SCREEN_POLL_MIN_MS = 60_000;
// אחרי כמה זמן בלי עכבר או מקלדת הפקדים והסמן נעלמים.
export const BIG_SCREEN_IDLE_MS = 3_000;

export function normalizePollInterval(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return BIG_SCREEN_POLL_MIN_MS;
    return Math.max(BIG_SCREEN_POLL_MIN_MS, Math.round(ms));
}

const defaultIdOf = item => String(item?.id ?? '');

// הפריטים שבתצוגה ועדיין לא בסבב, בסדר שבו הם בתצוגה ובלי כפילויות. seen
// הוא כל מה שכבר היה בסבב פעם: פריט שנמחק ושב (או שהוחלף ברשומה מעודכנת)
// אינו נחשב "חדש" שוב.
export function newRotationItems(rotation, candidates, { idOf = defaultIdOf, seen = null } = {}) {
    const known = new Set((rotation || []).map(idOf));
    if (seen) for (const id of seen) known.add(id);
    const fresh = [];
    for (const item of candidates || []) {
        const id = idOf(item);
        if (!id || known.has(id)) continue;
        known.add(id);
        fresh.push(item);
    }
    return fresh;
}

// מזהי הפריטים שבסבב ואינם עוד בתצוגה — נמחקו, הועברו או שאישורם בוטל מאז
// שהמסך עלה. בסדר הסבב ובלי כפילויות. התצוגה היא מה שנטען אחרי הבדיקה
// האחרונה, ולכן פריט שאינו בה אינו אמור לרוץ באולם.
export function removedRotationIds(rotation, candidates, { idOf = defaultIdOf } = {}) {
    const present = new Set((candidates || []).map(idOf));
    const gone = [];
    const listed = new Set();
    for (const item of rotation || []) {
        const id = idOf(item);
        if (!id || present.has(id) || listed.has(id)) continue;
        listed.add(id);
        gone.push(id);
    }
    return gone;
}

// מוציא מהסבב את הפריטים שב-ids, ומחזיר { items, index, removed, currentRemoved }:
// הרשימה החדשה (המקורית אינה משתנה), איפה השקופית הנוכחית בה עכשיו, כמה
// הוסרו, והאם הנוכחית עצמה הוסרה. אז index הוא הפריט שנשאר אחריה (ובסוף
// הסבב — מההתחלה), ועדיף אחד שהמצגת מציגה (isEligible; סרטון כשמדלגים על
// סרטונים אינו כזה) — כמו המעבר הרגיל לשקופית הבאה. כשלא נשאר דבר index הוא -1.
export function removeFromRotation(rotation, index, ids, { idOf = defaultIdOf, isEligible = () => true } = {}) {
    const list = Array.isArray(rotation) ? rotation : [];
    const drop = new Set(ids || []);
    const current = Math.trunc(Number(index));
    const valid = Number.isFinite(current) && current >= 0 && current < list.length;
    const items = [];
    let nextIndex = -1;
    let before = 0;
    list.forEach((item, position) => {
        if (drop.has(idOf(item))) return;
        if (position === current) nextIndex = items.length;
        if (position < current) before += 1;
        items.push(item);
    });
    const removed = list.length - items.length;
    const currentRemoved = valid && nextIndex === -1;
    if (!items.length) return { items, index: -1, removed, currentRemoved };
    if (nextIndex === -1) {
        // before הוא בדיוק מקומו של הפריט שבא אחרי הנוכחי ברשימה החדשה.
        const start = valid ? before % items.length : 0;
        nextIndex = start;
        for (let step = 0; step < items.length; step += 1) {
            const position = (start + step) % items.length;
            if (isEligible(items[position])) { nextIndex = position; break; }
        }
    }
    return { items, index: nextIndex, removed, currentRemoved };
}

// הפריטים החדשים נכנסים מיד אחרי הנוכחי: הם השקופיות הבאות, ואחריהן הסבב
// ממשיך מאיפה שהיה. מחזיר מערך חדש; המקורי אינו משתנה.
export function insertAfterIndex(rotation, index, items) {
    const list = Array.isArray(rotation) ? rotation : [];
    const add = Array.isArray(items) ? items : [];
    const at = Math.min(list.length, Math.max(0, Math.trunc(Number(index)) + 1 || 0));
    return [...list.slice(0, at), ...add, ...list.slice(at)];
}

// לולאת הבדיקה. הבדיקה הראשונה אחרי מרווח שלם (הסבב נבנה עכשיו מנתונים
// טריים); בדיקה אינה מתחילה כשקודמתה עוד רצה; כשהלשונית מוסתרת הלולאה
// נעצרת לגמרי, ובחזרה בודקת מיד רק אם עבר מרווח מאז הבדיקה האחרונה —
// אחרת ממתינה ליתרה. כך גם החלפת לשוניות מהירה אינה מוסיפה בקשות.
export function createPollLoop({
    interval = BIG_SCREEN_POLL_MIN_MS,
    poll = async () => {},
    isHidden = () => false,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    now = () => Date.now()
} = {}) {
    const period = normalizePollInterval(interval);
    let running = false;
    let timer = null;
    let inFlight = false;
    let lastPollAt = 0;
    let count = 0;

    const disarm = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
    const arm = ms => {
        disarm();
        timer = setTimer(fire, Math.max(0, ms));
    };
    async function run() {
        inFlight = true;
        lastPollAt = now();
        count += 1;
        try {
            await poll();
        } catch {
            // תקלה ברשת אינה עוצרת את המסך; הבדיקה הבאה בזמנה.
        } finally {
            inFlight = false;
            if (running && !isHidden()) arm(period);
        }
    }
    function fire() {
        timer = null;
        if (!running || inFlight) return;
        // מוסתרת: אין בדיקה ואין טיימר; visibilityChanged ממשיך מכאן.
        if (isHidden()) return;
        run();
    }

    return {
        get running() { return running; },
        get pollCount() { return count; },
        get armed() { return timer !== null; },
        start() {
            running = true;
            lastPollAt = now();
            if (isHidden()) disarm();
            else arm(period);
        },
        stop() {
            running = false;
            disarm();
        },
        visibilityChanged() {
            if (!running) return;
            if (isHidden()) { disarm(); return; }
            if (inFlight) return;
            const elapsed = now() - lastPollAt;
            if (elapsed >= period) { disarm(); run(); } else arm(period - elapsed);
        }
    };
}

// הפקדים והסמן: כל תנועה או מקש מחזירים אותם ומתחילים את הספירה מחדש.
export function createIdleTimer({
    delay = BIG_SCREEN_IDLE_MS,
    onIdle = () => {},
    onActive = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id)
} = {}) {
    let timer = null;
    let idle = false;
    let running = false;
    const disarm = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
    const arm = () => {
        disarm();
        timer = setTimer(() => {
            timer = null;
            if (!running) return;
            idle = true;
            onIdle();
        }, delay);
    };
    return {
        get idle() { return idle; },
        start() {
            running = true;
            idle = false;
            arm();
        },
        poke() {
            if (!running) return;
            if (idle) {
                idle = false;
                onActive();
            }
            arm();
        },
        stop() {
            running = false;
            idle = false;
            disarm();
        }
    };
}

// השעון שבפינה: שעות ודקות, 24 שעות, בספרות רגילות (קריא מרחוק).
export function formatClock(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

// כמה זמן עד תחילת הדקה הבאה, כדי שהשעון יתחלף בדיוק כשהדקה מתחלפת.
export function msUntilNextMinute(nowMs) {
    const value = Number(nowMs);
    if (!Number.isFinite(value)) return 60_000;
    const rest = 60_000 - (((value % 60_000) + 60_000) % 60_000);
    return rest || 60_000;
}
