// video-hover-preview.js — תצוגה מקדימה של סרטון במעבר עכבר (או במיקוד).
//
// כרטיס סרטון בגלריה מציג פוסטר (מהתצוגות המקדימות) ו-<video preload="none">,
// כך שאף בייט של הסרטון אינו יורד עד שמישהו מתעניין בו. כשהעכבר עומד על
// הכרטיס, או כשהמקלדת מגיעה אליו, הסרטון מתנגן מושתק ובתוך הכרטיס כמה שניות,
// ונעצר וחוזר לפוסטר ביציאה. כבוי למי שביקש פחות תנועה, ובמכשיר מגע בלבד
// (שם אין "ריחוף", ולחיצה פותחת ממילא את התצוגה המלאה).
//
// מאזין אחד לכל הרשת (האצלה), ולכן כרטיסים שנוספים בגלילה אינם צריכים חיבור.

export const HOVER_PREVIEW_MS = 4000;
export const HOVER_START_DELAY_MS = 180;
const VIDEO_SELECTOR = 'video.gallery-card-img';
const CARD_SELECTOR = '.gallery-card';

export function prefersReducedMotion(win = globalThis.window) {
    try {
        return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

// מכשיר שיש בו עכבר או משטח מגע מדויק. טלפון וטאבלט בלי עכבר — לא.
export function canHover(win = globalThis.window) {
    try {
        return Boolean(win?.matchMedia?.('(any-hover: hover) and (any-pointer: fine)').matches);
    } catch {
        return false;
    }
}

export function hoverPreviewAllowed(win = globalThis.window) {
    return canHover(win) && !prefersReducedMotion(win);
}

export function installVideoHoverPreview(root, {
    win = globalThis.window,
    previewMs = HOVER_PREVIEW_MS,
    startDelayMs = HOVER_START_DELAY_MS
} = {}) {
    if (!root || root.__videoHoverPreview) return root?.__videoHoverPreview || null;
    let activeCard = null;
    let startTimer = 0;
    let stopTimer = 0;

    const videoOf = card => card?.querySelector?.(VIDEO_SELECTOR) || null;

    const stop = card => {
        if (!card) return;
        win.clearTimeout(startTimer);
        win.clearTimeout(stopTimer);
        const video = videoOf(card);
        card.classList.remove('is-previewing');
        delete card.dataset.previewing;
        if (activeCard === card) activeCard = null;
        if (!video) return;
        try {
            video.pause();
            video.preload = 'none';
            // חזרה לפוסטר: בלי load() הפריים האחרון נשאר על המסך.
            if (video.currentTime > 0 || video.readyState > 0) {
                video.currentTime = 0;
                video.load();
            }
        } catch { /* סרטון שכבר נעלם מה-DOM */ }
    };

    const start = card => {
        if (!hoverPreviewAllowed(win)) return;
        const video = videoOf(card);
        if (!video) return;
        if (activeCard && activeCard !== card) stop(activeCard);
        activeCard = card;
        win.clearTimeout(startTimer);
        startTimer = win.setTimeout(() => {
            if (activeCard !== card || !card.isConnected) return;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.loop = false;
            video.preload = 'auto';
            card.classList.add('is-previewing');
            card.dataset.previewing = 'true';
            let playing;
            try {
                playing = video.play();
            } catch (error) {
                stop(card);
                return;
            }
            // דפדפן שחוסם ניגון, או סרטון שלא נטען — פשוט חוזרים לפוסטר.
            Promise.resolve(playing).catch(() => { if (activeCard === card) stop(card); });
            win.clearTimeout(stopTimer);
            stopTimer = win.setTimeout(() => stop(card), previewMs);
        }, startDelayMs);
    };

    const cardFrom = target => target?.closest?.(CARD_SELECTOR) || null;

    const onPointerOver = event => {
        if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        const card = cardFrom(event.target);
        if (card && card !== activeCard && videoOf(card)) start(card);
    };
    const onPointerOut = event => {
        const card = cardFrom(event.target);
        if (!card || card !== activeCard) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        stop(card);
    };
    const onFocusIn = event => {
        const card = cardFrom(event.target);
        if (card && card !== activeCard && videoOf(card)) start(card);
    };
    const onFocusOut = event => {
        const card = cardFrom(event.target);
        if (!card || card !== activeCard) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        stop(card);
    };
    // פתיחת התצוגה המלאה עוצרת את התצוגה המקדימה, כדי ששני סרטונים לא ירוצו.
    const onClick = event => {
        const card = cardFrom(event.target);
        if (card && card === activeCard) stop(card);
    };

    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('pointerout', onPointerOut);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('click', onClick, true);

    const controller = {
        stop: () => stop(activeCard),
        get activeCard() { return activeCard; },
        destroy() {
            stop(activeCard);
            root.removeEventListener('pointerover', onPointerOver);
            root.removeEventListener('pointerout', onPointerOut);
            root.removeEventListener('focusin', onFocusIn);
            root.removeEventListener('focusout', onFocusOut);
            root.removeEventListener('click', onClick, true);
            delete root.__videoHoverPreview;
        }
    };
    root.__videoHoverPreview = controller;
    return controller;
}
