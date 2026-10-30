// big-screen.js — "מסך גדול": הגלריה על מסך באולם בזמן האירוע.
//
// אין כאן מצגת שנייה. הכפתור (בסרגל הגלריה ובדף האירוע) פותח את התצוגה
// המלאה על התצוגה הנוכחית ומפעיל את המצגת הקיימת (lightbox-slideshow.js):
// אותו מתזמן, אותו מסך מלא (וכשאין Fullscreen API — התצוגה המלאה ממילא
// מכסה את החלון), אותו Wake Lock ואותו Ken Burns, שמתבטל עם
// prefers-reduced-motion. מה שנוסף כאן:
//   - #lightboxModal מקבל .is-big-screen: כיתוב גדול, ושם האירוע ושעון בפינה.
//   - אחרי שלוש שניות בלי עכבר או מקלדת הפקדים והסמן נעלמים (.is-idle),
//     וכל תנועה או מקש מחזירים אותם.
//   - פעם בדקה לכל היותר נטען מחדש העמוד הראשון של התיקייה (ETag — בלי גוף
//     כשלא השתנה דבר), ופריטים חדשים נכנסים מיד אחרי השקופית הנוכחית עם תג
//     "חדש". כשהלשונית מוסתרת אין בדיקות. ה-Worker מחזיר באוסף images רק
//     פריטים מאושרים, ולכן ממתין לאישור אינו מגיע למסך.
//   - ה-Wake Lock נשאר גם בהשהיה, עד היציאה.
//   - Escape (או "עצור", יציאה ממסך מלא, סגירה) יוצא בבת אחת מהמצגת ומהתצוגה.
// ההיגיון הטהור ב-big-screen-model.js.
import { startSlideshow, stopSlideshow, isSlideshowActive, onSlideshowStop } from './lightbox-slideshow.js';
import {
    BIG_SCREEN_POLL_MIN_MS, BIG_SCREEN_IDLE_MS, createPollLoop, createIdleTimer,
    newRotationItems, formatClock, msUntilNextMinute
} from './big-screen-model.js';

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];

let deps = null;
let active = false;
let pollLoop = null;
let idleTimer = null;
let clockTimer = null;
let removeStopListener = null;
let lastShownId = '';
// כל מה שהיה בסבב (כדי שפריט לא ייחשב "חדש" פעמיים), ומה שנוסף ועוד לא הוצג.
const seenIds = new Set();
const freshIds = new Set();
const el = {};

const doc = () => globalThis.document;

function idOf(item) {
    return deps?.idOf ? deps.idOf(item) : String(item?.id ?? '');
}

function isHidden() {
    return doc()?.visibilityState === 'hidden';
}

function announce(text) {
    if (!el.status) return;
    el.status.textContent = '';
    setTimeout(() => { if (el.status) el.status.textContent = text; }, 30);
}

// --- שעון ---

function tickClock() {
    clearTimeout(clockTimer);
    if (!active) return;
    const now = new Date();
    if (el.clock) {
        el.clock.textContent = formatClock(now);
        el.clock.setAttribute('datetime', now.toISOString());
    }
    clockTimer = setTimeout(tickClock, msUntilNextMinute(now.getTime()));
}

// --- פקדים וסמן ---

function setIdle(idle) {
    el.modal?.classList.toggle('is-idle', idle);
}

function onActivity() {
    idleTimer?.poke();
}

// --- פריטים חדשים ---

async function pollForNewItems() {
    if (!active) return;
    try {
        await deps.refreshView();
    } catch (error) {
        // מסך באולם אינו מציג הודעות שגיאה; הבדיקה הבאה בעוד דקה.
        console.warn('Big screen refresh failed:', error);
        return;
    }
    if (!active) return;
    const fresh = newRotationItems(deps.getItems(), deps.getViewItems(), { idOf, seen: seenIds });
    if (!fresh.length) return;
    const added = deps.insertNext(fresh);
    for (const item of fresh) {
        seenIds.add(idOf(item));
        freshIds.add(idOf(item));
    }
    if (added) announce(added === 1 ? 'נוסף פריט חדש למצגת.' : `נוספו ${added} פריטים חדשים למצגת.`);
}

function onVisibilityChange() {
    pollLoop?.visibilityChanged();
}

// --- כניסה ויציאה ---

function exitBigScreen() {
    if (!active) return;
    active = false;
    pollLoop?.stop();
    idleTimer?.stop();
    clearTimeout(clockTimer);
    removeStopListener?.();
    removeStopListener = null;
    const d = doc();
    for (const type of ACTIVITY_EVENTS) d?.removeEventListener?.(type, onActivity, true);
    d?.removeEventListener?.('visibilitychange', onVisibilityChange);
    el.modal?.classList.remove('is-big-screen', 'is-idle');
    if (el.info) el.info.hidden = true;
    if (el.badge) el.badge.hidden = true;
    freshIds.clear();
    seenIds.clear();
    lastShownId = '';
    // המצגת כבר נעצרה (זה המאזין שלה) או שהתצוגה נסגרת עכשיו; בשני המקרים
    // מסך גדול אינו משאיר אחריו תצוגה מלאה פתוחה.
    if (isSlideshowActive()) stopSlideshow({ silent: true });
    if (deps.isOpen()) deps.close();
}

export function isBigScreenActive() {
    return active;
}

// נקרא מ-gallery.js בכל שקופית: תג "חדש" על פריט שנוסף, עד שהסבב עובר הלאה.
export function noteBigScreenSlide(item) {
    if (!active || !el.badge) return;
    const id = idOf(item);
    if (lastShownId && lastShownId !== id) freshIds.delete(lastShownId);
    lastShownId = id;
    el.badge.hidden = !freshIds.has(id);
}

export function startBigScreen() {
    if (!deps || active) return active;
    const items = deps.getViewItems();
    if (!items.length) {
        deps.notify?.('אין פריטים להצגה במסך גדול.', false);
        return false;
    }
    if (el.event) el.event.textContent = deps.getEventName() || '';
    if (el.info) el.info.hidden = false;
    el.modal?.classList.add('is-big-screen');
    active = true;
    // הסבב הוא עותק של התצוגה: הוספה אליו אינה נוגעת ברשימת הגלריה.
    if (!deps.open([...items])) {
        exitBigScreen();
        return false;
    }
    for (const item of items) seenIds.add(idOf(item));
    // מסך מלא נדרש בתוך הלחיצה עצמה, ולכן המצגת מופעלת מיד ובאותה קריאה.
    if (!startSlideshow({ keepAwake: true })) {
        exitBigScreen();
        return false;
    }
    removeStopListener = onSlideshowStop(exitBigScreen);
    const d = doc();
    for (const type of ACTIVITY_EVENTS) d?.addEventListener?.(type, onActivity, { capture: true, passive: true });
    d?.addEventListener?.('visibilitychange', onVisibilityChange);
    idleTimer.start();
    pollLoop = createPollLoop({ interval: BIG_SCREEN_POLL_MIN_MS, poll: pollForNewItems, isHidden });
    pollLoop.start();
    tickClock();
    announce(`מסך גדול: ${deps.getEventName() || 'הגלריה'}. פריטים חדשים יתווספו מעצמם. Escape ליציאה.`);
    return true;
}

// options: getViewItems(), getItems(), open(items), insertNext(items) → מספר,
// refreshView(), getEventName(), isOpen(), close(), notify(text, ok), idOf(item).
export function initBigScreen(options) {
    if (deps) return;
    deps = options;
    const d = doc();
    const byId = id => d?.getElementById?.(id) || null;
    Object.assign(el, {
        modal: byId('lightboxModal'),
        info: byId('bigScreenInfo'),
        event: byId('bigScreenEvent'),
        clock: byId('bigScreenClock'),
        badge: byId('bigScreenNewBadge'),
        exit: byId('bigScreenExit'),
        status: byId('bigScreenStatus')
    });
    idleTimer = createIdleTimer({
        delay: BIG_SCREEN_IDLE_MS,
        onIdle: () => setIdle(true),
        onActive: () => setIdle(false)
    });
    el.exit?.addEventListener?.('click', () => {
        if (isSlideshowActive()) stopSlideshow({ silent: true });
        else exitBigScreen();
    });
}
