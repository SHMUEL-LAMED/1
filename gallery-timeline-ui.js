// gallery-timeline-ui.js — ציר הזמן העברי שליד רשת הגלריה: השנים והחודשים
// העבריים שבתצוגה, לחיצה על חודש גוללת לכרטיס הראשון שלו, ובזמן הגלילה
// החודש שבראש המסך מסומן (aria-current).
//
// ההיגיון (קיבוץ, מתי מוצג, איזה חודש פעיל, לאן לגלול) ב-gallery-timeline.js,
// בלי DOM. הנתונים הם אותה רשימה מסוננת וממוינת שממנה נבנית הרשת:
// gallery.js קורא ל-updateGalleryTimeline בכל ציור, ולכן הציר יודע רק את מה
// שנטען — כמו בוררי השנה והחודש העבריים. עמוד נוסף מהענן מוסיף לו חודשים.
//
// שתי צורות לאותו סימון: במסך רחב — עמודה דבוקה בצד הסוף של הגלריה (משמאל,
// כי הדף מימין לשמאל). במסך צר אין מקום לעמודה קבועה, ובמקומה כפתור צף
// "קפיצה לתאריך" שמציג את החודש הנוכחי ופותח את אותה רשימה כחלונית קטנה.
// ה-CSS קובע איזו צורה מוצגת; כאן נבדק רק אם החלונית היא חלונית (לסגירה).
import {
    buildHebrewTimeline, timelineAvailable, timelineSignature, timelineMonthLabel,
    firstIndexBelowLine, activeMonthIndex, timelineScrollTop
} from './gallery-timeline.js';
import { layoutTop } from './gallery-navigation-ui.js';

// חייב להתאים ל-@media שב-styles.css (.gallery-timeline).
const COMPACT_QUERY = '(max-width: 1199px)';
// מדידת החודש הפעיל לכל היותר פעם ב-120ms: בחיפוש בינארי היא זולה, אבל
// גלילה מהירה מפיקה עשרות אירועים בשנייה, ואין טעם לסמן חודש שחלף.
const MEASURE_INTERVAL_MS = 120;
// אחרי קפיצה הגלילה החלקה חוצה את החודשים שבדרך; עד שהיא נגמרת (scrollend,
// ובדפדפן בלעדיו — אחרי הזמן הזה) החודש שנבחר נשאר מסומן, במקום שהסימון
// "ירוץ" לאורך הציר. גם אחר כך הוא נשאר כל עוד הדף לא זז: חודש אחרון קצר
// אינו מגיע לראש המסך, והכרטיס שבראש המסך שייך לחודש שלפניו.
const JUMP_PIN_MS = 1200;

let installed = false;
let nav = null;
let panel = null;
let list = null;
let toggle = null;
let current = null;
let timeline = null;
let available = false;
let renderedSignature = '';
let activeIndex = -1;
let measureQueued = false;
let lastMeasureAt = 0;
let pinnedIndex = -1;
let pinnedUntil = 0;
// היכן הקפיצה נעצרה; null — הגלילה החלקה עוד בדרך.
let pinnedRestY = null;

const compactQuery = typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : { matches: false };
const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// --- הרשימה ---

function renderList() {
    const signature = timelineSignature(timeline);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    activeIndex = -1;
    // עמוד נוסף מהענן בונה את הרשימה מחדש; מי שעומד עליה במקלדת היה מאבד את
    // הפוקוס לגוף הדף. הוא חוזר לאותו חודש (לפי המפתח) ברשימה החדשה.
    const focusedKey = list.contains(document.activeElement) ? document.activeElement.dataset.monthKey : '';
    list.replaceChildren(...timeline.years.map(year => {
        const item = document.createElement('li');
        item.className = 'gallery-timeline-year';
        const heading = document.createElement('span');
        heading.className = 'gallery-timeline-year-label';
        heading.id = `galleryTimelineYear${year.year}`;
        heading.textContent = year.label;
        const months = document.createElement('ol');
        months.className = 'gallery-timeline-months';
        months.setAttribute('aria-labelledby', heading.id);
        year.months.forEach(month => {
            const row = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gallery-timeline-month';
            // האינדקס ב-months ולא מונה רץ: החודשים מקובצים כאן לפי שנה.
            button.dataset.monthIndex = String(timeline.months.indexOf(month));
            button.dataset.monthKey = month.key;
            button.setAttribute('aria-label', timelineMonthLabel(month));
            const name = document.createElement('span');
            name.className = 'gallery-timeline-month-name';
            name.textContent = month.monthName;
            const count = document.createElement('span');
            count.className = 'gallery-timeline-count';
            count.setAttribute('aria-hidden', 'true');
            count.textContent = String(month.count);
            button.append(name, count);
            row.append(button);
            months.append(row);
        });
        item.append(heading, months);
        return item;
    }));
    if (focusedKey) monthButtons().find(button => button.dataset.monthKey === focusedKey)?.focus({ preventScroll: true });
}

function monthButtons() {
    return Array.from(list.querySelectorAll('.gallery-timeline-month'));
}

// גלילה של הרשימה עצמה (ולא של הדף) כך שהחודש הפעיל נראה בה.
function keepInList(button) {
    if (!button || panel.scrollHeight <= panel.clientHeight) return;
    const box = panel.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (rect.top < box.top) panel.scrollTop -= box.top - rect.top + 8;
    else if (rect.bottom > box.bottom) panel.scrollTop += rect.bottom - box.bottom + 8;
}

function setActive(index) {
    const month = timeline?.months[index];
    if (current) current.textContent = month ? month.label : '';
    toggle?.setAttribute('aria-label', month ? `קפיצה לתאריך (כעת: ${month.label})` : 'קפיצה לתאריך');
    if (index === activeIndex) return;
    activeIndex = index;
    let activeButton = null;
    monthButtons().forEach(button => {
        const isActive = Number(button.dataset.monthIndex) === index;
        button.classList.toggle('is-active', isActive);
        if (isActive) {
            button.setAttribute('aria-current', 'true');
            activeButton = button;
        } else {
            button.removeAttribute('aria-current');
        }
    });
    keepInList(activeButton);
}

// --- מדידה בזמן גלילה ---

// כמה מראש המסך מוסתר מאחורי הכותרת הצפה וסרגל הכלים הדבוק. נמדד לפי
// המקום שבו הם נצמדים (top ב-CSS) ולא לפי מיקומם הרגעי: בראש הדף הסרגל עוד
// אינו דבוק, אבל אחרי הקפיצה הוא יהיה.
function stickyObstruction() {
    let bottom = 0;
    for (const selector of ['.site-header', '.gallery-toolbar']) {
        const node = document.querySelector(selector);
        if (!node || node.getClientRects().length === 0) continue;
        const style = window.getComputedStyle(node);
        if (style.position !== 'sticky' && style.position !== 'fixed') continue;
        bottom = Math.max(bottom, (parseFloat(style.top) || 0) + node.offsetHeight);
    }
    return bottom;
}

function gridInView(grid) {
    if (!grid || grid.getClientRects().length === 0) return false;
    const rect = grid.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
}

function measure() {
    measureQueued = false;
    lastMeasureAt = now();
    if (!available) return;
    const grid = document.getElementById('photosGrid');
    // הכפתור הצף מופיע רק כשהרשת על המסך, לא מעל רצועת הכניסה. חלונית
    // שנשארה פתוחה הייתה נעלמת איתו ומופיעה שוב פתוחה, ולכן היא נסגרת.
    const inView = gridInView(grid);
    nav.toggleAttribute('data-in-view', inView);
    if (!inView && isCompact() && isOpen()) setOpen(false);
    if (pinnedIndex >= 0) {
        if (pinnedRestY === null && pinnedUntil > lastMeasureAt) {
            setActive(pinnedIndex);
            scheduleMeasure(pinnedUntil - lastMeasureAt);
            return;
        }
        if (pinnedRestY === null) pinnedRestY = window.scrollY;
        // גלילה של המשתמש מאז שהקפיצה נעצרה משחררת את הסימון.
        if (Math.abs(window.scrollY - pinnedRestY) < 2) {
            setActive(pinnedIndex);
            return;
        }
        unpin();
    }
    const cards = grid ? grid.children : [];
    if (!cards.length) return;
    // הכרטיסים ברשת הם בדיוק הפריטים לפי הסדר (syncGalleryCards), ולכן
    // האינדקס של הכרטיס הוא האינדקס ברשימה שממנה נבנה הציר.
    const line = stickyObstruction() + 1;
    const index = firstIndexBelowLine(cards.length, i => layoutTop(cards[i]) + cards[i].offsetHeight, line);
    setActive(activeMonthIndex(timeline, Math.min(index, cards.length - 1)));
}

function unpin() {
    pinnedIndex = -1;
    pinnedUntil = 0;
    pinnedRestY = null;
}

function scheduleMeasure(delay = null) {
    if (measureQueued) return;
    measureQueued = true;
    const wait = delay ?? Math.max(0, MEASURE_INTERVAL_MS - (now() - lastMeasureAt));
    setTimeout(() => requestAnimationFrame(measure), wait);
}

// --- החלונית במסך צר ---

function isCompact() {
    return compactQuery.matches;
}

function isOpen() {
    return nav.dataset.open === 'true';
}

function setOpen(open, { focus = false } = {}) {
    nav.dataset.open = open ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
        const target = list.querySelector('.gallery-timeline-month[aria-current="true"]') || list.querySelector('.gallery-timeline-month');
        keepInList(target);
        target?.focus({ preventScroll: true });
    } else if (focus) {
        toggle.focus({ preventScroll: true });
    }
}

function toggleGalleryTimeline() {
    if (!available) return;
    setOpen(!isOpen());
}

// --- הקפיצה ---

function jumpToMonth(index) {
    const month = timeline?.months[index];
    if (!month) return;
    // כרטיס שעוד לא נבנה (הרינדור ההדרגתי) נבנה עכשיו, עם המנות שלפניו,
    // מהפריטים שבזיכרון בלבד — בלי בקשה לענן.
    const card = window.ensureGalleryCardRendered?.(month.firstId);
    if (!card) return;
    const top = timelineScrollTop({ scrollY: window.scrollY, cardTop: layoutTop(card), obstruction: stickyObstruction() });
    const instant = reducedMotionQuery.matches;
    pinnedIndex = index;
    pinnedUntil = now() + JUMP_PIN_MS;
    pinnedRestY = null;
    setActive(index);
    window.scrollTo({ top, left: 0, behavior: instant ? 'instant' : 'smooth' });
    // גלילה מיידית כבר הגיעה, גם אם נעצרה לפני היעד בתחתית הדף.
    if (instant) pinnedRestY = window.scrollY;
    if (isCompact() && isOpen()) setOpen(false);
    // כמו קישור בתוך הדף: הפוקוס עובר ליעד, כדי שמי שקפץ במקלדת או בקורא
    // מסך ימשיך מהכרטיס שאליו הגיע ולא מראש הרשימה.
    card.querySelector('.gallery-media')?.focus({ preventScroll: true });
    scheduleMeasure(instant ? 0 : JUMP_PIN_MS);
}

// --- מקלדת ---

// חצים למעלה ולמטה, Home ו-End בין החודשים; Escape סוגר את החלונית ומחזיר
// לכפתור שפתח אותה.
function handleKeyDown(event) {
    if (event.key === 'Escape' && isCompact() && isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false, { focus: true });
        return;
    }
    const button = event.target.closest?.('.gallery-timeline-month');
    if (!button || event.ctrlKey || event.metaKey || event.altKey) return;
    const buttons = monthButtons();
    const position = buttons.indexOf(button);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, position + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, position - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
}

// --- מהגלריה ---

// נקרא מ-gallery.js בכל ציור של הרשת, עם הרשימה המלאה שממנה היא נבנית.
function updateGalleryTimeline(items) {
    if (!nav) return;
    timeline = buildHebrewTimeline(items, { idOf: item => window.safeRecordId(item?.id) });
    available = timelineAvailable(window.state?.gallerySort, timeline);
    // תצוגה אחרת (מיון, סינון): החודש שנבחר קודם אינו בהכרח באותו מקום ברשימה.
    if (timelineSignature(timeline) !== renderedSignature) unpin();
    nav.hidden = !available;
    document.querySelector('.gallery-layout')?.toggleAttribute('data-timeline', available);
    if (!available) {
        if (isOpen()) setOpen(false, { focus: nav.contains(document.activeElement) });
        renderedSignature = '';
        activeIndex = -1;
        list.replaceChildren();
        return;
    }
    renderList();
    scheduleMeasure(0);
}

// --- התקנה ---

export function initGalleryTimeline() {
    if (installed) return;
    if (window.PAGE_MODE && window.PAGE_MODE !== 'gallery') return;
    nav = document.getElementById('galleryTimeline');
    panel = document.getElementById('galleryTimelinePanel');
    list = document.getElementById('galleryTimelineList');
    toggle = document.getElementById('galleryTimelineToggle');
    current = document.getElementById('galleryTimelineCurrent');
    if (!nav || !panel || !list || !toggle) return;
    installed = true;
    list.addEventListener('click', event => {
        const button = event.target.closest('.gallery-timeline-month');
        if (button) jumpToMonth(Number(button.dataset.monthIndex));
    });
    nav.addEventListener('keydown', handleKeyDown);
    // לחיצה מחוץ לחלונית סוגרת אותה, בלי להזיז את הפוקוס.
    document.addEventListener('pointerdown', event => {
        if (isOpen() && !nav.contains(event.target)) setOpen(false);
    });
    // וכך גם Tab שיוצא ממנה: חלונית פתוחה שאין בה פוקוס הייתה נשארת צפה מעל
    // הכרטיסים שאליהם עבר המשתמש.
    nav.addEventListener('focusout', event => {
        if (isCompact() && isOpen() && event.relatedTarget && !nav.contains(event.relatedTarget)) setOpen(false);
    });
    window.addEventListener('scroll', () => scheduleMeasure(), { passive: true });
    window.addEventListener('scrollend', () => {
        if (pinnedIndex >= 0 && pinnedRestY === null) pinnedRestY = window.scrollY;
        scheduleMeasure(0);
    }, { passive: true });
    window.addEventListener('resize', () => scheduleMeasure(), { passive: true });
    // מעבר בין הצורות (סיבוב הטלפון, הקטנת החלון) סוגר את החלונית.
    compactQuery.addEventListener?.('change', () => {
        if (isOpen()) setOpen(false);
        scheduleMeasure(0);
    });
    window.toggleGalleryTimeline = toggleGalleryTimeline;
    window.updateGalleryTimeline = updateGalleryTimeline;
}
