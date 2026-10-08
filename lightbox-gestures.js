// lightbox-gestures.js — מחוות בתצוגה המלאה, על Pointer Events בלבד (בלי ספרייה):
//
//   • זום: צביטה בשתי אצבעות, וגלגלת עם Ctrl/⌘ (כך גם צביטה במשטח מגע) —
//     1x עד 5x סביב הנקודה שמתחת לאצבעות/לסמן. לחיצה כפולה או הקשה כפולה
//     מחליפות בין 1x ל-2.5x סביב הנקודה. כשהתמונה מוגדלת גרירה מזיזה אותה,
//     בגבולות הבמה, וגלגלת רגילה גוללת בתוכה. עם ההגדלה הראשונה התמונה
//     מתחלפת לקובץ המקורי ברזולוציה מלאה (במקום התצוגה הבינונית). כל מעבר
//     פריט מאפס את הזום.
//   • החלקה (מגע): התמונה עוקבת אחרי האצבע; ההחלטה (lightbox-math.js) לפי
//     מרחק ומהירות. בכיוון הקריאה מימין לשמאל הפריט הבא נמצא משמאל, כמו
//     כפתור "התמונה הבאה" וחץ שמאלה במקלדת — ולכן גרירת האצבע ימינה מושכת
//     אותו פנימה ועוברת לבא, וגרירה שמאלה חוזרת לקודם. בקצוות הרשימה התמונה
//     נמתחת כגומייה וחוזרת. משיכה למטה סוגרת. בזמן זום אין החלקה.
//
// מצב הזום מסומן על הבמה: data-zoom ו-.is-zoomed (הבדיקות נשענות עליהם).
import {
    IDENTITY_VIEW, isZoomed, zoomAt, clampPan, toggleZoomAt, pinchView,
    wheelZoomFactor, lockAxis, swipeStep, decideSwipe, rubberBand, velocityFromSamples
} from './lightbox-math.js';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;
const TAP_SLOP = 10;
const SWIPE_OUT_MS = 180;
const SETTLE_MS = 240;
// כמה זמן לכל היותר מחכים לפענוח הפריט הבא לפני שמכניסים אותו לבמה.
const ENTER_WAIT_MS = 1500;

let deps = null;
let stage = null;
let image = null;
let view = { ...IDENTITY_VIEW };
const pointers = new Map();
let gesture = null;
let lastTap = null;
let lastTouchDoubleTapAt = 0;
let originalToken = 0;
let originalRequested = false;
let committing = false;

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function readingDirection() {
    const dir = globalThis.document?.documentElement?.dir || globalThis.document?.dir || 'rtl';
    return String(dir).toLowerCase() === 'ltr' ? 'ltr' : 'rtl';
}

function contentSize() {
    return { width: image?.offsetWidth || 0, height: image?.offsetHeight || 0 };
}

function viewportSize() {
    return { width: stage?.clientWidth || 0, height: stage?.clientHeight || 0 };
}

function applyView() {
    if (!image || !stage) return;
    const zoomed = isZoomed(view);
    if (image.style) {
        image.style.translate = zoomed ? `${view.x}px ${view.y}px` : '';
        image.style.scale = zoomed ? String(view.scale) : '';
    }
    stage.classList?.toggle('is-zoomed', zoomed);
    if (stage.dataset) stage.dataset.zoom = zoomed ? view.scale.toFixed(2) : '1';
}

// נקודה במסך → ביחס למרכז התמונה במצב 1x. המרכז המקורי הוא מרכז המלבן
// המוצג פחות ההזזה הנוכחית (ההגדלה עצמה סביב המרכז ואינה מזיזה אותו).
function anchorFrom(clientX, clientY) {
    const rect = image.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2 - view.x;
    const centerY = rect.top + rect.height / 2 - view.y;
    return { x: clientX - centerX, y: clientY - centerY };
}

function setView(next) {
    view = clampPan(next, contentSize(), viewportSize());
    applyView();
    if (isZoomed(view)) ensureOriginal();
}

// בהגדלה הראשונה של פריט: הקובץ המקורי נטען ברקע, מפוענח, ורק אז מחליף את
// התצוגה הבינונית — בלי הבזק. גם מקור ה-AVIF שב-<picture> מתנקה, אחרת
// הדפדפן היה ממשיך להעדיף אותו.
function ensureOriginal() {
    if (originalRequested || !deps) return;
    originalRequested = true;
    const url = deps.getOriginalUrl?.();
    if (!url || image.getAttribute?.('src') === url) return;
    if (typeof Image !== 'function') return;
    const token = originalToken;
    const loader = new Image();
    loader.decoding = 'async';
    const swap = () => {
        if (token !== originalToken || !image) return;
        const avif = globalThis.document?.getElementById?.('lightboxImageAvif');
        avif?.removeAttribute?.('srcset');
        avif?.removeAttribute?.('sizes');
        image.removeAttribute('sizes');
        image.srcset = `${url} 1x`;
        image.src = url;
        image.dataset.zoomSource = 'original';
        // הממדים של המקור עשויים להיות שונים מעט; הגבולות מחושבים מחדש.
        const reclamp = () => { if (token === originalToken) setView(view); };
        if (image.complete) reclamp();
        else image.addEventListener('load', reclamp, { once: true });
    };
    loader.addEventListener('load', () => {
        if (typeof loader.decode === 'function') loader.decode().then(swap, swap);
        else swap();
    }, { once: true });
    loader.src = url;
}

function canZoom() {
    return Boolean(deps && image && !image.hidden && deps.canZoom?.() !== false);
}

function canSwipe() {
    return Boolean(deps && !committing && deps.canSwipe?.() !== false);
}

// איפוס הזום — בכל מעבר פריט, בפתיחה ובסגירה.
export function resetLightboxZoom() {
    originalToken += 1;
    originalRequested = false;
    view = { ...IDENTITY_VIEW };
    if (gesture && gesture.type !== 'swipe') gesture = null;
    if (image?.dataset) delete image.dataset.zoomSource;
    applyView();
}

export function getLightboxZoom() {
    return view.scale;
}

function isControlTarget(target, clientY) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('button, a, input, select, textarea')) return true;
    // פס הפקדים של הסרטון (החלק התחתון) שייך לסרטון, לא למחוות.
    if (target.tagName === 'VIDEO') {
        const rect = target.getBoundingClientRect();
        return clientY > rect.bottom - 56;
    }
    return false;
}

function setStageOffset(x, y, opacity = 1, transition = '') {
    if (!stage?.style) return;
    stage.style.transition = transition;
    stage.style.translate = x || y ? `${x}px ${y}px` : '';
    stage.style.opacity = opacity < 1 ? String(Math.max(0, opacity)) : '';
}

const settleTransition = ms => `translate ${ms}ms cubic-bezier(.2,.8,.2,1), opacity ${ms}ms ease`;

function settleStage() {
    setStageOffset(0, 0, 1, settleTransition(SETTLE_MS));
    setTimeout(() => { if (!gesture && !committing && stage?.style) stage.style.transition = ''; }, SETTLE_MS + 20);
}

function haptic() {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8);
    } catch { /* אין רטט — לא נורא */ }
}

function waitForStageReady() {
    return new Promise(resolve => {
        const started = now();
        const tick = () => {
            if (!stage?.classList?.contains('is-loading') || now() - started > ENTER_WAIT_MS) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

// דפדוף שהוחלט: התמונה ממשיכה לצאת לכיוון הגרירה, הפריט מתחלף, והחדש נכנס
// מהצד שממנו הגיע.
function commitSwipe(step, dx) {
    committing = true;
    const width = viewportSize().width || 400;
    const exit = Math.sign(dx || (readingDirection() === 'rtl' ? step : -step)) * width;
    setStageOffset(exit, 0, 0, settleTransition(SWIPE_OUT_MS));
    haptic();
    setTimeout(() => {
        deps.navigate(step);
        setStageOffset(-exit * 0.3, 0, 0, 'none');
        waitForStageReady().then(() => {
            // מחייב חישוב סגנון לפני המעבר, אחרת הדפדפן מדלג על האנימציה.
            void stage.offsetWidth;
            setStageOffset(0, 0, 1, settleTransition(SETTLE_MS));
            setTimeout(() => {
                committing = false;
                if (stage?.style) stage.style.transition = '';
            }, SETTLE_MS + 20);
        });
    }, SWIPE_OUT_MS);
}

function closeBySwipe() {
    committing = true;
    const height = viewportSize().height || 600;
    setStageOffset(0, height * 0.6, 0, settleTransition(SWIPE_OUT_MS));
    haptic();
    setTimeout(() => {
        committing = false;
        setStageOffset(0, 0, 1, 'none');
        deps.close();
    }, SWIPE_OUT_MS);
}

function pointerMid() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

function startSingle(pointerId, x, y, pointerType) {
    gesture = { type: 'pending', pointerId, pointerType, startX: x, startY: y, startView: { ...view }, samples: [{ x, y, t: now() }] };
}

function onPointerDown(event) {
    if (!deps || committing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isControlTarget(event.target, event.clientY)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { stage.setPointerCapture(event.pointerId); } catch { /* מצביע שכבר שוחרר */ }
    if (pointers.size === 2 && canZoom()) {
        if (gesture?.type === 'swipe') settleStage();
        const mid = pointerMid();
        const anchor = anchorFrom(mid.x, mid.y);
        gesture = {
            type: 'pinch',
            startView: { ...view },
            startDistance: mid.distance,
            startMid: anchor,
            // מרכז התמונה ב-1x, בקואורדינטות המסך: ממנו נמדדת נקודת האמצע.
            baseCenter: { x: mid.x - anchor.x, y: mid.y - anchor.y }
        };
        return;
    }
    if (pointers.size === 1) startSingle(event.pointerId, event.clientX, event.clientY, event.pointerType);
}

function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.type === 'pinch') {
        if (pointers.size < 2) return;
        const mid = pointerMid();
        const current = { x: mid.x - gesture.baseCenter.x, y: mid.y - gesture.baseCenter.y };
        setView(pinchView(gesture.startView, gesture.startDistance, mid.distance, gesture.startMid, current));
        event.preventDefault();
        return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.samples.push({ x: event.clientX, y: event.clientY, t: now() });
    if (gesture.samples.length > 12) gesture.samples.shift();

    if (gesture.type === 'pending') {
        if (isZoomed(view)) {
            if (Math.hypot(dx, dy) >= 2) gesture.type = 'pan';
        } else if (gesture.pointerType !== 'mouse' && canSwipe()) {
            const axis = lockAxis(dx, dy);
            if (axis) Object.assign(gesture, { type: 'swipe', axis });
        }
    }
    if (gesture.type === 'pan') {
        setView({ scale: gesture.startView.scale, x: gesture.startView.x + dx, y: gesture.startView.y + dy });
        event.preventDefault();
    } else if (gesture.type === 'swipe') {
        const { width, height } = viewportSize();
        if (gesture.axis === 'x') {
            const step = swipeStep(dx, readingDirection());
            const blocked = (step > 0 && deps.atEnd()) || (step < 0 && deps.atStart());
            setStageOffset(blocked ? rubberBand(dx, width || 400) : dx, 0);
        } else {
            const pull = dy > 0 ? dy : rubberBand(dy, 80);
            setStageOffset(0, pull, 1 - Math.min(0.6, Math.max(0, dy) / Math.max(1, height || 600)));
        }
        event.preventDefault();
    }
}

function handleTap(event) {
    const t = now();
    if (lastTap && t - lastTap.t < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_DISTANCE) {
        lastTap = null;
        lastTouchDoubleTapAt = t;
        if (canZoom()) setView(toggleZoomAt(view, anchorFrom(event.clientX, event.clientY), contentSize(), viewportSize()));
        return;
    }
    lastTap = { x: event.clientX, y: event.clientY, t };
}

function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { stage.releasePointerCapture?.(event.pointerId); } catch { /* כבר שוחרר */ }
    if (!gesture) return;
    const cancelled = event.type === 'pointercancel';

    if (gesture.type === 'pinch') {
        if (pointers.size === 1) {
            // אצבע אחת נשארה: ממשיכים ממנה בהזזה, בלי קפיצה.
            const [[id, point]] = [...pointers.entries()];
            startSingle(id, point.x, point.y, 'touch');
            gesture.type = isZoomed(view) ? 'pan' : 'pending';
        } else {
            gesture = null;
        }
        return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;

    if (current.type === 'swipe') {
        const { vx, vy } = velocityFromSamples(current.samples);
        const { width, height } = viewportSize();
        const decision = cancelled ? 'none' : decideSwipe({
            dx, dy, vx, vy, width, height,
            direction: readingDirection(), axis: current.axis,
            atStart: deps.atStart(), atEnd: deps.atEnd()
        });
        if (decision === 'next') commitSwipe(1, dx);
        else if (decision === 'prev') commitSwipe(-1, dx);
        else if (decision === 'close') closeBySwipe();
        else settleStage();
        return;
    }
    if (current.type === 'pending' && !cancelled && current.pointerType !== 'mouse' && Math.hypot(dx, dy) < TAP_SLOP) {
        handleTap(event);
    }
}

function onDoubleClick(event) {
    // הקשה כפולה במגע כבר טופלה; הדפדפן עשוי לשלוח גם dblclick בעקבותיה.
    if (now() - lastTouchDoubleTapAt < 600) return;
    if (!canZoom() || isControlTarget(event.target, event.clientY) || event.target?.tagName === 'VIDEO') return;
    event.preventDefault();
    setView(toggleZoomAt(view, anchorFrom(event.clientX, event.clientY), contentSize(), viewportSize()));
}

function onWheel(event) {
    if (!canZoom()) return;
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
        setView(zoomAt(view, view.scale * factor, anchorFrom(event.clientX, event.clientY)));
    } else if (isZoomed(view)) {
        event.preventDefault();
        setView({ scale: view.scale, x: view.x - event.deltaX, y: view.y - event.deltaY });
    }
}

// options: navigate(step), close(), atStart(), atEnd(), getOriginalUrl(),
// canZoom(), canSwipe(). נקרא פעם אחת; בסביבה בלי Pointer Events אינו עושה דבר.
export function initLightboxGestures(options) {
    if (deps) return true;
    const doc = globalThis.document;
    const stageElement = doc?.getElementById?.('lightboxStage');
    const imageElement = doc?.getElementById?.('lightboxImage');
    if (!stageElement || !imageElement || typeof stageElement.addEventListener !== 'function') return false;
    if (typeof globalThis.PointerEvent !== 'function') return false;
    deps = options;
    stage = stageElement;
    image = imageElement;
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove, { passive: false });
    stage.addEventListener('pointerup', onPointerEnd);
    stage.addEventListener('pointercancel', onPointerEnd);
    stage.addEventListener('dblclick', onDoubleClick);
    stage.addEventListener('wheel', onWheel, { passive: false });
    // גרירה מקורית של התמונה (שמירה כקובץ) הייתה גונבת את המחווה.
    image.draggable = false;
    image.addEventListener('dragstart', event => event.preventDefault());
    applyView();
    return true;
}
