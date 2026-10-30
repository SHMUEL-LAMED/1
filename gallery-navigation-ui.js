// gallery-navigation-ui.js — הניווט בדף הגלריה: קיצורי המקלדת וחלון
// "קיצורי מקלדת", וזיכרון הגלילה — חזרה לאותו מקום ולאותו פריט אחרי התצוגה
// המלאה, עמוד האירוע או אלבום של אדם (#person/<id>, גם ב"חזור" של הדפדפן).
//
// ההיגיון (איזה מקש, מתי לשתוק, לאן לגלול) ב-gallery-navigation.js, בלי DOM.
// "/" לחיפוש נשאר ב-app.js, והחצים, הרווח ו-Escape ב-gallery.js — כאן נוספים
// "?" (רשימת הקיצורים), ובתצוגה המלאה D (הורדה) ו-F (מועדף). שני האחרונים
// לוחצים על הכפתורים שבסרגל התצוגה המלאה, כך שהם עוברים בדיוק באותו מסלול
// של לחיצה בעכבר — כולל הכפתור המושבת של פריט בלי קובץ והודעת "למשתמשים
// מאושרים בלבד".
//
// למה צריך זיכרון גלילה, אם החלונות צפים מעל הדף: גלגלת מעל התצוגה המלאה,
// רווח ו-PageDown, וגלילה עד סוף התוכן של עמוד האירוע גוללים את הגלריה
// שמאחור. ו-F בתצוגה המלאה בונה מחדש את הכרטיס של הפריט, כך שהכפתור שממנו
// נפתחה כבר אינו בדף כשהיא נסגרת, והפוקוס היה הולך לאיבוד. אלבום של אדם
// מחליף את הרשת כולה, והחזרה ממנו מתחילה מהמנה הראשונה בראש הרשת.
import {
    GALLERY_SHORTCUTS, isTypingTarget, resolveGalleryShortcut,
    galleryViewKey, scrollRestoreTarget
} from './gallery-navigation.js';

const HELP_MODAL_ID = 'shortcutsHelpModal';
// החלונות שהגלריה חוזרת מהם למקומה, והמשבצת של כל אחד בזיכרון.
const REMEMBERED_MODALS = [['lightboxModal', 'lightbox'], ['eventPageModal', 'event']];

let installed = false;
let helpRendered = false;
const memory = new Map();
const modalWasOpen = new Map();
// המקום בגלריה לפני מעבר לאלבום של אדם. left מסומן כשהאלבום באמת הוצג
// ברשת; עד אז (רשימת האנשים פתוחה, האלבום נטען) אין ממה לחזור.
let routeMemory = null;

function isShown(node) {
    return Boolean(node) && !node.hidden && !node.classList.contains('hidden') && !node.hasAttribute('inert');
}

// חלון מודאלי פתוח שאינו התצוגה המלאה. המגירה הסגורה נשארת בדף כ-inert.
function otherModalOpen() {
    return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'))
        .some(node => node.id !== 'lightboxModal' && isShown(node));
}

// --- קיצורי המקלדת ---

function handleKeyDown(event) {
    if (event.defaultPrevented) return;
    const action = resolveGalleryShortcut(event, {
        typing: isTypingTarget(event.target),
        lightboxOpen: isShown(document.getElementById('lightboxModal')),
        otherModalOpen: otherModalOpen()
    });
    if (!action) return;
    if (action === 'help') {
        event.preventDefault();
        openShortcutsHelp();
        return;
    }
    // "מסך גדול" (big-screen.js) מסתיר את ההורדה והמועדף: המקלדת שליד המסך
    // באולם אינה מורידה קבצים ואינה מסמנת מועדפים בחשבון של מי שהפעיל אותו.
    if (document.getElementById('lightboxModal')?.classList.contains('is-big-screen')) return;
    const button = document.getElementById(action === 'download' ? 'lightboxDownload' : 'lightboxFavorite');
    if (!button || button.disabled) return;
    event.preventDefault();
    button.click();
}

function renderShortcutsHelp() {
    const list = document.getElementById('shortcutsHelpList');
    if (!list || helpRendered) return;
    helpRendered = true;
    list.replaceChildren(...GALLERY_SHORTCUTS.map(group => {
        const section = document.createElement('section');
        section.className = 'shortcuts-group';
        const heading = document.createElement('h4');
        heading.textContent = group.title;
        const items = document.createElement('dl');
        group.items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'shortcuts-row';
            const keys = document.createElement('dt');
            item.keys.forEach(key => {
                const kbd = document.createElement('kbd');
                kbd.textContent = key;
                keys.append(kbd);
            });
            const label = document.createElement('dd');
            label.textContent = item.label;
            row.append(keys, label);
            items.append(row);
        });
        section.append(heading, items);
        return section;
    }));
}

// מה שאפשר להגיע אליו ב-Tab בתוך חלון.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// חלון הקיצורים מודאלי (aria-modal), אבל הדף שמאחוריו — והתצוגה המלאה, כשהוא
// נפתח מעליה — אינו inert: בלי זה Tab מהכפתור היחיד שבו היה יוצא אל הגלריה,
// והמשתמש היה מקליד מאחורי חלון שעדיין פתוח. Tab ו-Shift+Tab מסתובבים בתוכו,
// ופוקוס שנפל ממנו (לחיצה על הרשימה עצמה) חוזר אליו בהקשה הבאה.
// הלכידה רק בחלון הזה ולא ב-openModal לכל החלונות: לחלונות האחרים כבר יש
// סדר פוקוס משלהם (התצוגה המלאה, עמוד האירוע, חלונות מעל חלונות), ושינוי
// כללי כזה היה צריך להיבדק בכל אחד מהם.
function trapHelpFocus(event) {
    if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const dialog = document.getElementById(HELP_MODAL_ID);
    if (!isShown(dialog)) return;
    const controls = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(node => node.getClientRects().length > 0);
    const active = document.activeElement;
    const inside = dialog.contains(active);
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (inside && controls.length && active !== edge) return;
    event.preventDefault();
    (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
}

function openShortcutsHelp() {
    renderShortcutsHelp();
    window.openModal?.(HELP_MODAL_ID);
    window.scheduleIconRefresh?.();
}

// --- זיכרון הגלילה ---

// המרחק של כרטיס מראש המסך לפי הפריסה, בלי ה-transform של אנימציית הכניסה:
// כרטיס שנבנה מחדש (חזרה מאלבום, לב שנלחץ) עולה למקומו מ-20 פיקסלים מתחתיו,
// ומדידה באמצע התנועה הייתה משאירה את הגלריה מוזזת בדיוק בהפרש הזה.
// גם ציר הזמן העברי (gallery-timeline-ui.js) מודד בה את הכרטיסים.
export function layoutTop(node) {
    const parent = node.offsetParent;
    if (!parent) return node.getBoundingClientRect().top;
    return parent.getBoundingClientRect().top + parent.clientTop + node.offsetTop;
}

// הכרטיס הראשון שראשו בתוך המסך. הכרטיסים ברשת לפי סדר השורות, ולכן ראשיהם
// עולים בסדר הדף, וחיפוש בינארי מוצא אותו בלי למדוד אלפי כרטיסים.
function captureAnchor() {
    const grid = document.getElementById('photosGrid');
    if (!grid || !isShown(grid)) return null;
    const cards = grid.querySelectorAll('.gallery-card[data-media-id]');
    let low = 0;
    let high = cards.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (layoutTop(cards[middle]) >= 0) high = middle;
        else low = middle + 1;
    }
    const card = cards[low];
    // כרטיס שמתחת למסך אינו עוגן: עמוד אירוע שנפתח מחפיסת התיקיות שמעל הרשת
    // חוזר לפי המספר, ולא לפי כרטיס שלא נראה — אחרת פסיפס שנטען בינתיים מעל
    // הרשת היה מזיז את הדף כולו, ואת הכפתור שפתח אל מחוץ למסך.
    const top = card ? layoutTop(card) : Infinity;
    return top < window.innerHeight ? { mediaId: card.dataset.mediaId, top } : null;
}

// הזרע של הסדר האקראי אינו ב-state; gallery.js חושף אותו.
function currentViewKey() {
    return galleryViewKey(window.state, window.galleryRandomSeed?.());
}

function captureSnapshot(opener) {
    // body (אחרי לחיצה על משהו שאינו ממקד) אינו "מי שפתח".
    const element = opener instanceof Element && opener !== document.body && opener !== document.documentElement ? opener : null;
    return {
        scrollY: window.scrollY,
        anchor: captureAnchor(),
        viewKey: currentViewKey(),
        results: window.state?.tempSearchResults ?? null,
        opener: element,
        focusMediaId: element?.closest('[data-media-id]')?.dataset.mediaId || '',
        eventFolder: element?.closest('[data-event-folder]')?.dataset.eventFolder || ''
    };
}

function sameView(saved) {
    return saved.viewKey === currentViewKey() && saved.results === (window.state?.tempSearchResults ?? null);
}

function cardFor(mediaId) {
    if (!mediaId) return null;
    const node = window.ensureGalleryCardRendered?.(mediaId);
    return node?.isConnected ? node : null;
}

function focusIsLost() {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected || Boolean(active.closest('.hidden, [inert], [hidden]'));
}

// הפוקוס חוזר רק כשהלך לאיבוד: אם closeModal כבר החזיר אותו לכפתור שפתח,
// והכפתור עדיין בדף, אין מה לתקן.
function restoreFocus(saved, { fallbackToAnchor = false } = {}) {
    if (!focusIsLost()) return;
    let target = saved.opener?.isConnected && !saved.opener.closest('.hidden, [inert], [hidden]') ? saved.opener : null;
    if (!target && saved.focusMediaId) target = cardFor(saved.focusMediaId)?.querySelector('.gallery-media') || null;
    if (!target && saved.eventFolder) {
        target = Array.from(document.querySelectorAll('[data-event-folder]'))
            .find(node => node.dataset.eventFolder === saved.eventFolder) || null;
    }
    if (!target && fallbackToAnchor && saved.anchor) target = cardFor(saved.anchor.mediaId)?.querySelector('.gallery-media') || null;
    target?.focus({ preventScroll: true });
}

function restoreScroll(saved) {
    const anchorNode = saved.anchor ? cardFor(saved.anchor.mediaId) : null;
    const root = document.documentElement;
    const target = scrollRestoreTarget(saved, {
        scrollY: window.scrollY,
        anchorTop: anchorNode ? layoutTop(anchorNode) : null,
        maxScroll: root.scrollHeight - window.innerHeight
    });
    if (target !== null) window.scrollTo({ top: target, left: 0, behavior: 'instant' });
}

// חלון שנפתח: נרשם המקום. חלון שנסגר: חוזרים אליו — אלא אם הסגירה עצמה
// העבירה לתצוגה אחרת (פתיחת תמונות האירוע, תגית סצנה מהתצוגה המלאה), ואז
// ראש התצוגה החדשה הוא המקום הנכון.
function watchModals() {
    if (typeof MutationObserver !== 'function') return;
    const nodes = REMEMBERED_MODALS
        .map(([id, slot]) => [document.getElementById(id), slot])
        .filter(([node]) => node);
    if (!nodes.length) return;
    nodes.forEach(([node, slot]) => modalWasOpen.set(slot, isShown(node)));
    const observer = new MutationObserver(() => {
        nodes.forEach(([node, slot]) => {
            const open = isShown(node);
            if (open === modalWasOpen.get(slot)) return;
            modalWasOpen.set(slot, open);
            if (open) {
                // openModal שומר את מי שהיה בפוקוס לפני הפתיחה.
                memory.set(slot, captureSnapshot(node._previousActiveElement || document.activeElement));
                return;
            }
            const saved = memory.get(slot);
            memory.delete(slot);
            if (!saved || !sameView(saved)) return;
            restoreFocus(saved);
            restoreScroll(saved);
        });
    });
    nodes.forEach(([node]) => observer.observe(node, { attributes: true, attributeFilter: ['class'] }));
}

// פעולה שסוגרת את החלון כדי להעביר את המשתמש למקום אחר בכוונה ("פתח את
// תמונות האירוע" של התיקייה שכבר פעילה — התצוגה לא השתנתה, אבל הוא ביקש את
// ראש הרשת): המקום שנרשם בפתיחה נשכח, והסגירה אינה מחזירה אליו.
function forgetGalleryScrollMemory(slot) {
    memory.delete(slot);
}

// נקרא מ-app.js בכל שינוי של נתיב האנשים, לפני שהאלבום מתחיל להיטען.
function noteGalleryRoute(isPeopleRoute) {
    const plain = (window.state?.tempSearchResults ?? null) === null;
    if (isPeopleRoute) {
        // מאלבום לאלבום (#person/a ← #person/b) נשאר המקום שבגלריה המלאה.
        if (plain && !routeMemory?.left) routeMemory = { ...captureSnapshot(document.activeElement), left: false };
        return;
    }
    // רשימת האנשים נסגרה בלי שאלבום הוצג: הגלריה לא זזה, ואין מה לשחזר.
    if (routeMemory && !routeMemory.left && plain) routeMemory = null;
}

// נקרא מ-gallery.js בסוף כל ציור של הרשת. ציור של אלבום מסמן שהגלריה
// המלאה הוחלפה; הציור הראשון שבו היא חוזרת — באותה תצוגה — מחזיר למקום.
function noteGalleryRendered() {
    if (!routeMemory) return;
    if ((window.state?.tempSearchResults ?? null) !== null) {
        // רק אלבום של אדם (#person/<id>) הוא צעד שחוזרים ממנו. רשימת האנשים
        // שנסגרה ב-Escape משאירה #people בכתובת; תוצאות אחרות שמופיעות אחר כך
        // ("עדכונים אחרונים", חיפוש פנים) אינן האלבום, והמקום מלפני הרשימה כבר
        // ישן — שחזורו ב"חזור לגלריה" היה מקפיץ את הגלריה למקום שהמשתמש עזב.
        if (routeMemory.left || /^#person\//.test(window.location.hash)) routeMemory.left = true;
        else routeMemory = null;
        return;
    }
    if (!routeMemory.left) return;
    const saved = routeMemory;
    routeMemory = null;
    if (!sameView(saved)) return;
    restoreFocus(saved, { fallbackToAnchor: true });
    restoreScroll(saved);
}

// --- התקנה ---

export function initGalleryNavigation() {
    if (installed) return;
    if (window.PAGE_MODE && window.PAGE_MODE !== 'gallery') return;
    installed = true;
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', trapHelpFocus);
    watchModals();
    window.openShortcutsHelp = openShortcutsHelp;
    window.noteGalleryRoute = noteGalleryRoute;
    window.noteGalleryRendered = noteGalleryRendered;
    window.forgetGalleryScrollMemory = forgetGalleryScrollMemory;
}
