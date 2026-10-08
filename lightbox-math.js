// lightbox-math.js — החשבון של התצוגה המלאה, בלי DOM: זום ומגבלות הגרירה,
// ההחלטה על החלקה (מרחק, מהירות וכיוון קריאה מימין לשמאל), ומתזמן המצגת
// עם שעונים מוזרקים. lightbox-gestures.js ו-lightbox-slideshow.js מחברים
// אותו לדף, והבדיקות (lightbox-math.test.mjs) בודקות אותו ישירות.

// --- זום ---

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
// לחיצה כפולה / הקשה כפולה מחליפה בין 1x לזום הזה, סביב הנקודה שנלחצה.
export const DOUBLE_TAP_ZOOM = 2.5;
// מתחת לסף הזה התמונה נחשבת לא מוגדלת (שגיאות עיגול של צביטה).
const ZOOM_EPSILON = 0.01;

export function clampScale(scale, min = ZOOM_MIN, max = ZOOM_MAX) {
    const value = Number(scale);
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

export function isZoomed(view) {
    return Boolean(view) && view.scale > ZOOM_MIN + ZOOM_EPSILON;
}

export const IDENTITY_VIEW = Object.freeze({ scale: 1, x: 0, y: 0 });

// התצוגה היא translate(x, y) ואחריו scale(scale) סביב מרכז התמונה. anchor
// הוא נקודה ביחס למרכז התמונה במצב 1x (בפיקסלים של המסך). הנקודה שמתחת
// לעוגן נשארת במקומה: p = x + s·u, ולכן x' = p − (s'/s)·(p − x).
export function zoomAt(view, nextScale, anchor = { x: 0, y: 0 }) {
    const current = view || IDENTITY_VIEW;
    const scale = clampScale(nextScale);
    if (scale <= ZOOM_MIN + ZOOM_EPSILON) return { ...IDENTITY_VIEW };
    const ratio = scale / current.scale;
    return {
        scale,
        x: anchor.x - ratio * (anchor.x - current.x),
        y: anchor.y - ratio * (anchor.y - current.y)
    };
}

// מכפיל זום לגלגלת: deltaY שלילי (גלילה למעלה / פתיחת צביטה במשטח מגע)
// מגדיל. deltaMode 1 הוא שורות ו-2 עמודים, ושניהם מתורגמים לפיקסלים.
export function wheelZoomFactor(deltaY, deltaMode = 0) {
    const pixels = Number(deltaY) * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
    if (!Number.isFinite(pixels)) return 1;
    // תקרה לכל אירוע, כדי שעכבר עם צעדים גסים לא יקפוץ מ-1x ל-5x בבת אחת.
    const bounded = Math.max(-200, Math.min(200, pixels));
    return Math.exp(-bounded * 0.01);
}

// הגבול של ההזזה: כשהתמונה המוגדלת רחבה מהבמה מותר להזיז אותה עד שקצה
// התמונה נוגע בקצה הבמה, ולא מעבר. ציר שבו התמונה צרה מהבמה נשאר ממורכז.
export function panLimits(scale, content, viewport) {
    const width = Math.max(0, Number(content?.width) || 0) * scale;
    const height = Math.max(0, Number(content?.height) || 0) * scale;
    return {
        x: Math.max(0, (width - (Number(viewport?.width) || 0)) / 2),
        y: Math.max(0, (height - (Number(viewport?.height) || 0)) / 2)
    };
}

export function clampPan(view, content, viewport) {
    if (!isZoomed(view)) return { ...IDENTITY_VIEW };
    const limits = panLimits(view.scale, content, viewport);
    const clamp = (value, limit) => Math.min(limit, Math.max(-limit, value)) || 0;
    return { scale: view.scale, x: clamp(view.x, limits.x), y: clamp(view.y, limits.y) };
}

// לחיצה כפולה: מוגדל → חזרה ל-1x; לא מוגדל → DOUBLE_TAP_ZOOM סביב הנקודה.
export function toggleZoomAt(view, anchor, content, viewport) {
    if (isZoomed(view)) return { ...IDENTITY_VIEW };
    return clampPan(zoomAt(view, DOUBLE_TAP_ZOOM, anchor), content, viewport);
}

// צביטה: הזום יחסי למרחק בין האצבעות בתחילת המחווה, העוגן הוא נקודת האמצע
// בתחילתה, והתמונה זזה גם יחד עם נקודת האמצע הנוכחית.
export function pinchView(startView, startDistance, distance, startMid, mid) {
    const base = startView || IDENTITY_VIEW;
    const ratio = startDistance > 0 ? distance / startDistance : 1;
    const zoomed = zoomAt(base, base.scale * ratio, startMid);
    if (!isZoomed(zoomed)) return zoomed;
    return { scale: zoomed.scale, x: zoomed.x + (mid.x - startMid.x), y: zoomed.y + (mid.y - startMid.y) };
}

// --- החלקה ---

// מעבר לסף הזה (בפיקסלים) נקבע הציר של המחווה: אופקי לדפדוף, אנכי לסגירה.
export const SWIPE_AXIS_SLOP = 10;
// דפדוף: גרירה של חמישית מרוחב הבמה, או הנפה מהירה של 30px לפחות.
export const SWIPE_DISTANCE_RATIO = 0.2;
export const SWIPE_MIN_FLICK = 30;
export const SWIPE_FLICK_VELOCITY = 0.4; // px/ms
// סגירה: משיכה למטה של 18% מגובה הבמה, או הנפה מהירה למטה.
export const SWIPE_CLOSE_RATIO = 0.18;

export function lockAxis(dx, dy, slop = SWIPE_AXIS_SLOP) {
    if (Math.hypot(dx, dy) < slop) return null;
    return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

// לאיזה צעד גרירה אופקית מובילה. המוסכמה תואמת את החצים שבתצוגה ואת
// המקלדת: באתר מימין לשמאל הפריט הבא יושב משמאל (כפתור "התמונה הבאה" בצד
// שמאל, וחץ שמאלה במקלדת מתקדם). גרירת האצבע ימינה מושכת אל הבמה את מה
// שמשמאל — כלומר את הפריט הבא — וגרירה שמאלה מחזירה לקודם. בכיוון LTR
// ההפך, כמו בכל גלריה.
export function swipeStep(dx, direction = 'rtl') {
    if (!dx) return 0;
    const forward = direction === 'ltr' ? dx < 0 : dx > 0;
    return forward ? 1 : -1;
}

// ההחלטה בסוף מחווה: 'next', 'prev', 'close' או 'none'.
// vx ו-vy הם מהירות האצבע בסוף המחווה (px/ms), atStart/atEnd — האם הפריט
// הנוכחי הוא הראשון/האחרון (בקצוות אין דפדוף אלא גומייה).
export function decideSwipe({
    dx = 0, dy = 0, vx = 0, vy = 0, width = 0, height = 0,
    direction = 'rtl', axis = lockAxis(dx, dy), atStart = false, atEnd = false
} = {}) {
    if (axis === 'y') {
        const far = dy > Math.max(SWIPE_MIN_FLICK, height * SWIPE_CLOSE_RATIO);
        const flick = dy > SWIPE_MIN_FLICK && vy > SWIPE_FLICK_VELOCITY;
        return far || flick ? 'close' : 'none';
    }
    if (axis !== 'x') return 'none';
    const step = swipeStep(dx, direction);
    if (!step) return 'none';
    const far = Math.abs(dx) > Math.max(SWIPE_MIN_FLICK, width * SWIPE_DISTANCE_RATIO);
    // הנפה נחשבת רק כשהאצבע עדיין נעה לכיוון הגרירה בסוף המחווה.
    const flick = Math.abs(dx) > SWIPE_MIN_FLICK && Math.abs(vx) > SWIPE_FLICK_VELOCITY && Math.sign(vx) === Math.sign(dx);
    if (!far && !flick) return 'none';
    if (step > 0 && atEnd) return 'none';
    if (step < 0 && atStart) return 'none';
    return step > 0 ? 'next' : 'prev';
}

// התנגדות בקצוות: ככל שגוררים רחוק יותר, התמונה זזה פחות. אינה עוברת לעולם
// את limit, ושומרת על הסימן של הגרירה.
export function rubberBand(offset, limit, coefficient = 0.55) {
    if (!offset || !(limit > 0)) return 0;
    const distance = Math.abs(offset);
    const resisted = (1 - 1 / ((distance * coefficient) / limit + 1)) * limit;
    return Math.sign(offset) * resisted;
}

// מהירות מתוך דגימות אחרונות [{x, y, t}], בחלון של windowMs אחרונים.
export function velocityFromSamples(samples, windowMs = 100) {
    if (!Array.isArray(samples) || samples.length < 2) return { vx: 0, vy: 0 };
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (let i = samples.length - 2; i >= 0; i--) {
        first = samples[i];
        if (last.t - samples[i].t >= windowMs) break;
    }
    const dt = last.t - first.t;
    if (!(dt > 0)) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

// --- מצגת ---

export const SLIDESHOW_INTERVALS = Object.freeze([3000, 5000, 8000]);
export const SLIDESHOW_DEFAULT_INTERVAL = 5000;

export function normalizeSlideshowInterval(value) {
    const ms = Number(value);
    return SLIDESHOW_INTERVALS.includes(ms) ? ms : SLIDESHOW_DEFAULT_INTERVAL;
}

// המתזמן של המצגת. השעונים מוזרקים (setTimer/clearTimer/now), ולכן אפשר
// לבדוק אותו בלי זמן אמיתי. המצבים: 'idle', 'playing', 'paused'.
// hold() עוצר את הספירה בזמן שסרטון מתנגן, ו-release() (בסוף הסרטון)
// מתקדם מיד. slideShown() מתחיל ספירה מלאה לשקופית החדשה.
export function createSlideshowScheduler({
    interval = SLIDESHOW_DEFAULT_INTERVAL,
    onAdvance = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    now = () => Date.now()
} = {}) {
    let state = 'idle';
    let period = normalizeSlideshowInterval(interval);
    let timer = null;
    let remaining = period;
    let armedAt = 0;
    let holding = false;

    const disarm = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
    const arm = ms => {
        disarm();
        remaining = Math.max(0, ms);
        armedAt = now();
        timer = setTimer(fire, remaining);
    };
    function fire() {
        timer = null;
        if (state !== 'playing' || holding) return;
        remaining = 0;
        onAdvance();
    }

    return {
        get state() { return state; },
        get interval() { return period; },
        get holding() { return holding; },
        // הזמן שנותר לשקופית הנוכחית (במצב השהיה — הזמן שנשמר).
        remaining() {
            if (state === 'playing' && timer !== null) return Math.max(0, remaining - (now() - armedAt));
            return remaining;
        },
        start() {
            state = 'playing';
            holding = false;
            arm(period);
        },
        pause() {
            if (state !== 'playing') return false;
            if (timer !== null) remaining = Math.max(0, remaining - (now() - armedAt));
            disarm();
            state = 'paused';
            return true;
        },
        resume() {
            if (state !== 'paused') return false;
            state = 'playing';
            if (!holding) arm(remaining);
            return true;
        },
        toggle() {
            return state === 'playing' ? this.pause() : this.resume();
        },
        stop() {
            disarm();
            state = 'idle';
            holding = false;
            remaining = period;
        },
        slideShown() {
            if (state === 'idle') return;
            holding = false;
            if (state === 'playing') arm(period);
            else remaining = period;
        },
        hold() {
            if (state === 'idle') return;
            holding = true;
            disarm();
        },
        release() {
            if (!holding) return false;
            holding = false;
            if (state === 'playing') {
                remaining = 0;
                onAdvance();
                return true;
            }
            remaining = 0;
            return false;
        },
        setInterval(ms) {
            period = normalizeSlideshowInterval(ms);
            if (state === 'idle') { remaining = period; return period; }
            if (holding) return period;
            if (state === 'playing') arm(period);
            else remaining = period;
            return period;
        }
    };
}
