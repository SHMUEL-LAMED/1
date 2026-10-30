// folder-preview.js — תצוגה מקדימה של תיקייה בריחוף או במיקוד ב-#folderList.
//
// כשהעכבר עומד על תיקייה, או כשהמקלדת מגיעה אליה, ריבוע הסמל שלה מציג כמה
// מהתמונות האחרונות שבה, מתחלפות בעמעום. התמונות הן התצוגות הקטנות (thumb)
// שהכרטיסים בגלריה כבר מציגים, ולכן לרוב הן כבר במטמון הדפדפן. מי שביקש
// פחות תנועה רואה תמונה אחת קבועה, בלי החלפה. במכשיר מגע בלבד אין דבר: שם
// אין "ריחוף", ולחיצה פותחת ממילא את התיקייה.
//
// רשת: התמונות נוצרות רק בריחוף, ורשימת הפריטים מגיעה ממה שכבר נטען בביקור
// (framesFor). רק לתיקייה שעוד לא נטען ממנה דבר מתבקש העמוד הראשון שלה
// (loadFrames), אחרי השהיה קצרה — כך מעבר מהיר של העכבר על הרשימה אינו פונה
// לשרת, ותיקייה שלא ריחפו עליה לעולם אינה מבקשת דבר. ההיגיון של בחירת
// התמונות (pickFolderPreviewFrames) ב-new-since.js, בלי DOM.
//
// מאזין אחד לכל הרשימה (האצלה), כמו video-hover-preview.js, כי #folderList
// נבנה מחדש בכל רינדור. הכרטיס מסומן ב-data-folder-id.
import { canHover, prefersReducedMotion } from './video-hover-preview.js';

export const FOLDER_PREVIEW_START_DELAY_MS = 220;
export const FOLDER_PREVIEW_INTERVAL_MS = 1100;
const CARD_SELECTOR = '.collection-card[data-folder-id]';
const SLOT_SELECTOR = '.collection-card-icon';

export function installFolderHoverPreview(root, {
    framesFor = () => [],
    loadFrames = null,
    win = globalThis.window,
    startDelayMs = FOLDER_PREVIEW_START_DELAY_MS,
    intervalMs = FOLDER_PREVIEW_INTERVAL_MS
} = {}) {
    if (!root || root.__folderHoverPreview) return root?.__folderHoverPreview || null;
    const doc = root.ownerDocument || win.document;
    let activeCard = null;
    let activeFolderId = '';
    let startTimer = 0;
    let cycleTimer = 0;
    // כל התחלה מקבלת מספר; תשובה מהרשת שהגיעה אחרי שהעכבר כבר עבר הלאה נזרקת.
    let token = 0;

    const folderIdOf = card => String(card?.dataset?.folderId || '');

    const clearPreview = card => {
        if (!card) return;
        card.querySelector('.folder-preview')?.remove();
        card.classList.remove('is-previewing');
        delete card.dataset.previewing;
    };

    const stop = () => {
        win.clearTimeout(startTimer);
        win.clearInterval(cycleTimer);
        token += 1;
        clearPreview(activeCard);
        activeCard = null;
        activeFolderId = '';
    };

    const show = (card, frames) => {
        const slot = card.querySelector(SLOT_SELECTOR);
        if (!slot || !frames.length) return;
        clearPreview(card);
        const layer = doc.createElement('span');
        layer.className = 'folder-preview';
        layer.setAttribute('aria-hidden', 'true');
        frames.forEach((frame, index) => {
            const image = doc.createElement('img');
            image.alt = '';
            image.decoding = 'async';
            image.className = index === 0 ? 'is-current' : '';
            image.dataset.frameId = frame.id;
            // תמונה שלא נטענה יוצאת מהסבב; אם לא נשארה אף אחת — חוזרים לסמל.
            image.onerror = () => {
                const wasCurrent = image.classList.contains('is-current');
                image.remove();
                const rest = layer.querySelectorAll('img');
                if (!rest.length) { clearPreview(card); return; }
                if (wasCurrent) rest[0].classList.add('is-current');
            };
            image.src = frame.url;
            layer.appendChild(image);
        });
        slot.appendChild(layer);
        card.classList.add('is-previewing');
        card.dataset.previewing = 'true';
        win.clearInterval(cycleTimer);
        if (frames.length < 2 || prefersReducedMotion(win)) return;
        cycleTimer = win.setInterval(() => {
            if (!layer.isConnected) { win.clearInterval(cycleTimer); return; }
            const images = [...layer.querySelectorAll('img')];
            if (images.length < 2) return;
            const current = Math.max(0, images.findIndex(image => image.classList.contains('is-current')));
            images[current].classList.remove('is-current');
            images[(current + 1) % images.length].classList.add('is-current');
        }, intervalMs);
    };

    const start = card => {
        if (!canHover(win)) return;
        const folderId = folderIdOf(card);
        if (!folderId) return;
        if (activeCard && activeCard !== card) stop();
        activeCard = card;
        activeFolderId = folderId;
        const current = ++token;
        win.clearTimeout(startTimer);
        startTimer = win.setTimeout(async () => {
            if (current !== token || !card.isConnected) return;
            let frames = framesFor(folderId) || [];
            if (!frames.length && typeof loadFrames === 'function') {
                try {
                    frames = (await loadFrames(folderId)) || [];
                } catch {
                    frames = [];
                }
                if (current !== token) return;
            }
            // ייתכן שבינתיים הרשימה נבנתה מחדש: מציגים על הכרטיס הנוכחי של התיקייה.
            const target = card.isConnected ? card : findCard(folderId);
            if (!target) return;
            activeCard = target;
            show(target, frames);
        }, startDelayMs);
    };

    const findCard = folderId => [...root.querySelectorAll(CARD_SELECTOR)].find(card => folderIdOf(card) === folderId) || null;
    const cardFrom = target => target?.closest?.(CARD_SELECTOR) || null;
    // מיקוד מהמקלדת בלבד: לחיצת עכבר ממקדת את הכפתור ופותחת את התיקייה, ושם
    // אין צורך בתצוגה מקדימה.
    const keyboardFocus = element => {
        try {
            return Boolean(element?.matches?.(':focus-visible'));
        } catch {
            return true;
        }
    };

    const onPointerOver = event => {
        if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        const card = cardFrom(event.target);
        if (card && card !== activeCard) start(card);
    };
    const onPointerOut = event => {
        const card = cardFrom(event.target);
        if (!card || card !== activeCard) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        // המיקוד מהמקלדת עדיין בתוך הכרטיס — התצוגה נשארת.
        if (card.contains(doc.activeElement) && keyboardFocus(doc.activeElement)) return;
        stop();
    };
    const onFocusIn = event => {
        const card = cardFrom(event.target);
        if (card && card !== activeCard && keyboardFocus(event.target)) start(card);
    };
    const onFocusOut = event => {
        const card = cardFrom(event.target);
        if (!card || card !== activeCard) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        if (card.matches(':hover')) return;
        stop();
    };
    // לחיצה פותחת את התיקייה עצמה; אין טעם בתצוגה מקדימה (או בבקשה לרשת) עבורה.
    const onPointerDown = event => {
        if (cardFrom(event.target)) stop();
    };

    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('pointerout', onPointerOut);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('pointerdown', onPointerDown, true);

    const controller = {
        stop,
        get activeFolderId() { return activeFolderId; },
        // אחרי רינדור מחדש של הרשימה: הכרטיס שהוצג הוחלף באלמנט חדש באותו
        // מקום, מתחת לאותו עכבר. התצוגה עוברת אליו בלי השהיה נוספת; היציאה
        // ממנו תעצור אותה כרגיל. (מצב :hover של אלמנט שזה עתה נוצר מתעדכן רק
        // בתזוזה הבאה של העכבר, ולכן אינו נבדק כאן.)
        refresh() {
            if (!activeFolderId || activeCard?.isConnected) return;
            const card = findCard(activeFolderId);
            if (!card) { stop(); return; }
            activeCard = card;
            const frames = framesFor(activeFolderId) || [];
            if (frames.length) show(card, frames);
        },
        destroy() {
            stop();
            root.removeEventListener('pointerover', onPointerOver);
            root.removeEventListener('pointerout', onPointerOut);
            root.removeEventListener('focusin', onFocusIn);
            root.removeEventListener('focusout', onFocusOut);
            root.removeEventListener('pointerdown', onPointerDown, true);
            delete root.__folderHoverPreview;
        }
    };
    root.__folderHoverPreview = controller;
    return controller;
}
