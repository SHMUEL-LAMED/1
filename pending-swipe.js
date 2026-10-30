// pending-swipe.js — "מצב מהיר" באישור העלאות: פריט ממתין אחד בכל פעם,
// בתצוגה גדולה, עם החלקה, כפתורים או מקלדת. נטען עצלה מ-admin.js רק כשמנהל
// לוחץ "מצב מהיר".
//
// אין כאן נתיב חדש בשרת: ההחלטה נשמרת דרך window.approvePendingImage
// ו-window.rejectPendingImage שב-admin.js — אותו אישור, אותו יעד ואותה
// דחייה (סל המחזור למנהל־על, בקשת מחיקה למנהל) כמו "אשר נבחרים". הביטול
// אינו מחזיר דבר מהשרת: ההחלטה ממתינה כמה שניות ונשלחת רק אחר כך
// (createSwipeSession ב-pending-swipe-model.js), ו"בטל" פשוט מוותר עליה.

import { pickLightboxSource, pickPosterSource } from './media-variants.js';
import { lockAxis, velocityFromSamples } from './lightbox-math.js';
import {
    SWIPE_UNDO_MS, decideCardSwipe, swipeActionForDx, swipeProgress, keyAction,
    mergeQueueOrder, pendingCardDetails, createSwipeSession
} from './pending-swipe-model.js';

const { escapeHtml, safeRecordId, safeImageUrl, isVideoRecord, formatDate, scheduleIconRefresh } = window;

// הכרטיס עף מהמסך בזמן הזה, ורק אז מגיע הבא. בלי תנועה — מיד.
const FLY_OUT_MS = 220;
// כרטיס בטלפון תופס את כל הרוחב; במסך רחב — עד 560px.
const CARD_IMAGE_SIZES = '(max-width: 640px) 100vw, 560px';

const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

let order = [];
let currentId = '';
let isOpen = false;
let leaving = false;
let drag = null;
let previousFocus = null;
// הכותרת של כל פריט שהוחלט, כדי שהודעת הביטול תדע מה לכתוב גם אחרי
// שהפריט כבר יצא מהרשימה.
const decidedTitles = new Map();

const $ = id => document.getElementById(id);

const SESSION_ENDED = 'pending_swipe_session_ended';

function currentUid() {
    return String(window.state?.currentUser?.uid || '');
}

// ההחלטה שייכת לחשבון שקיבל אותה. שמירה שמגיע תורה אחרי התנתקות, החלפת
// חשבון או אובדן הרשאת ניהול אינה נשלחת: אחרת היא הייתה יוצאת בשם המבקר
// (ונכשלת עם טוסט שמציג לו את שם ההעלאה), או נשמרת בשם מנהל אחר.
function commitDecision(id, action, meta) {
    if (!meta?.uid || meta.uid !== currentUid() || !window.canViewAdminData?.()) {
        throw Object.assign(new Error('החשבון שקיבל את ההחלטה כבר אינו מחובר.'), { code: SESSION_ENDED });
    }
    return action === 'approve'
        ? window.approvePendingImage(id, meta.folder || 'auto')
        : window.rejectPendingImage(id);
}

// המפגש אחד לכל הדף: פריט שנשלחה עליו בקשת מחיקה נשאר ב-pendingImages
// (רק מנהל־על מוחק), ולא אמור לחזור לתור כשהמצב המהיר נפתח שוב. בסוף
// החיבור (resetPendingSwipe) הוא מתאפס, וחשבון אחר מתחיל ממנו מחדש.
const session = createSwipeSession({
    undoMs: SWIPE_UNDO_MS,
    commit: commitDecision,
    onChange: () => render(),
    onError: (error, entry) => {
        // מי שמול המסך עכשיו אינו מי שהחליט: בלי טוסט ובלי שם הפריט.
        if (error?.code === SESSION_ENDED) {
            console.warn('Pending swipe decision dropped after the session ended:', entry.id);
            return;
        }
        console.warn('Pending swipe action failed:', entry.id, error);
        const title = decidedTitles.get(entry.id) || 'הפריט';
        const failed = entry.action === 'approve' ? `האישור של "${title}" נכשל` : `הדחייה של "${title}" נכשלה`;
        window.showNotification(`${failed}: ${error?.message || 'שגיאה לא ידועה'}. הפריט חזר לתור.`, false);
    }
});

function readingDirection() {
    const dialog = $('pendingSwipe');
    return dialog && getComputedStyle(dialog).direction === 'ltr' ? 'ltr' : 'rtl';
}

function targetFolderId() {
    return $('pendingTargetFolder')?.value || 'auto';
}

// מה שבתור: הרשומות הממתינות בסדר הרשימה. מנהל שאינו מנהל־על אינו רואה
// שוב פריט שכבר שלח עליו בקשת מחיקה — אצלו הדחייה היא הבקשה.
function sourceIds() {
    const requested = new Set();
    if (!window.state.isSuperAdmin) {
        for (const request of window.state.deletionRequests || []) {
            if (request?.status === 'pending' && request.targetType === 'pendingImage') requested.add(safeRecordId(request.targetId));
        }
    }
    return (window.state.pendingImages || [])
        .filter(image => !image.status || image.status === 'pending')
        .map(image => safeRecordId(image.id))
        .filter(id => id && !requested.has(id));
}

function findRecord(id) {
    return (window.state.pendingImages || []).find(image => safeRecordId(image.id) === id) || null;
}

function countLabel(count) {
    if (count === 0) return 'לא נותרו פריטים';
    if (count === 1) return 'נותר פריט אחד';
    return `נותרו ${count}`;
}

function cardTitle(record) {
    return pendingCardDetails(record, { isVideo: isVideoRecord(record) }).title;
}

// לאן הדחייה מובילה — התיאור הנגיש של "דחה" (aria-describedby). השם
// הנגיש נשאר המילה שעל הכפתור, כדי שמי שאומר "דחה" לתוכנת שליטה קולית
// יגיע אליו (WCAG 2.5.3).
function rejectDescription() {
    return window.state.isSuperAdmin ? 'העברה לסל המחזור' : 'שליחת בקשת מחיקה למנהל־העל';
}

function decidedMessage(action, title) {
    if (action === 'approve') return `אושר: ${title}`;
    return window.state.isSuperAdmin ? `נדחה ויועבר לסל המחזור: ${title}` : `תישלח בקשת מחיקה: ${title}`;
}

function mediaMarkup(record, title) {
    const safeTitle = escapeHtml(title);
    if (isVideoRecord(record)) {
        const poster = pickPosterSource(record, safeImageUrl);
        const source = safeImageUrl(record.url);
        // controls לצפייה לפני ההחלטה; גרירה שמתחילה על הסרטון אינה החלקה.
        return `<video class="pending-swipe-video" controls playsinline preload="metadata"${poster ? ` poster="${escapeHtml(poster)}"` : ''} src="${escapeHtml(source)}" aria-label="${safeTitle}"></video>`;
    }
    const source = pickLightboxSource(record, safeImageUrl);
    const attr = (name, value) => (value ? ` ${name}="${escapeHtml(value)}"` : '');
    return `<img src="${escapeHtml(source.url)}"${attr('srcset', source.srcset)}${source.srcset ? attr('sizes', CARD_IMAGE_SIZES) : ''}${attr('data-fallback-src', source.fallbackUrl)} alt="${safeTitle}" decoding="async" draggable="false" onerror="window.handleImageError(this)">`;
}

function cardMarkup(record) {
    const isVideo = isVideoRecord(record);
    const details = pendingCardDetails(record, { folders: window.state.folders || [], targetFolderId: targetFolderId(), isVideo });
    const dates = [
        details.uploadedAt ? `הועלה ${escapeHtml(formatDate(details.uploadedAt))}` : '',
        details.takenAt ? `צולם ${escapeHtml(formatDate(details.takenAt))}` : ''
    ].filter(Boolean).join(' · ');
    const folder = details.sourceFolder && details.sourceFolder !== details.destination
        ? `${escapeHtml(details.sourceFolder)} ← ${escapeHtml(details.destination)}`
        : escapeHtml(details.destination || details.sourceFolder || '—');
    return `
        <div class="pending-swipe-media">
            ${mediaMarkup(record, details.title)}
            <span class="pending-swipe-kind"><i data-lucide="${isVideo ? 'video' : 'image'}" class="w-3.5 h-3.5"></i> ${details.kind}</span>
            <span class="pending-swipe-stamp" data-stamp="approve" aria-hidden="true">אשר</span>
            <span class="pending-swipe-stamp" data-stamp="reject" aria-hidden="true">דחה</span>
        </div>
        <div class="pending-swipe-meta" id="pendingSwipeCardMeta">
            <h4 id="pendingSwipeCardTitle">${escapeHtml(details.title)}</h4>
            <dl>
                <div><dt><i data-lucide="user" class="w-3.5 h-3.5"></i> הועלה על ידי</dt><dd>${escapeHtml(details.uploader)}${details.uploaderEmail ? ` <span class="pending-swipe-email">${escapeHtml(details.uploaderEmail)}</span>` : ''}</dd></div>
                <div><dt><i data-lucide="folder" class="w-3.5 h-3.5"></i> תיקייה</dt><dd>${folder}${details.createsFolder ? ' <span class="pending-swipe-new">תיקייה חדשה</span>' : ''}</dd></div>
                ${dates ? `<div><dt><i data-lucide="calendar" class="w-3.5 h-3.5"></i> תאריך</dt><dd>${dates}</dd></div>` : ''}
            </dl>
        </div>`;
}

// הכרטיס הבא מציץ מאחורי הנוכחי — וגם נטען מראש, כדי שהמעבר יהיה מיידי.
function renderNext(id) {
    const next = $('pendingSwipeNext');
    if (!next) return;
    const record = id ? findRecord(id) : null;
    if (!record) { next.replaceChildren(); next.hidden = true; return; }
    next.hidden = false;
    const url = isVideoRecord(record) ? pickPosterSource(record, safeImageUrl) : pickLightboxSource(record, safeImageUrl).url;
    next.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" decoding="async" draggable="false" onerror="this.remove()">` : '';
}

// מיקום הכרטיס בזמן גרירה: הזזה, הטיה קלה, ועוצמת החותמת (0–1).
function placeCard(card, dx, progress) {
    card.style.setProperty('--swipe-x', `${dx}px`);
    card.style.setProperty('--swipe-rotate', `${Math.max(-14, Math.min(14, dx / 22))}deg`);
    card.style.setProperty('--swipe-progress', String(progress));
}

function resetCardPosition(card, { animate = true } = {}) {
    if (!card) return;
    card.classList.toggle('is-returning', animate);
    card.style.removeProperty('--swipe-x');
    card.style.removeProperty('--swipe-rotate');
    card.style.removeProperty('--swipe-progress');
    delete card.dataset.hint;
    delete card.dataset.leaving;
}

function render() {
    if (!isOpen) return;
    // מי שאינו (או כבר אינו) מנהל אינו רואה את החלון, וההחלטה שבחלון הביטול
    // אינה נשלחת בשמו.
    if (!window.canViewAdminData?.()) { endPendingSwipe(); return; }
    const card = $('pendingSwipeCard');
    const empty = $('pendingSwipeEmpty');
    order = mergeQueueOrder(order, sourceIds());
    const queue = session.queue(order);
    const count = $('pendingSwipeCount');
    if (count) count.textContent = countLabel(queue.length);

    renderUndo();
    // כרטיס שבאמצע היציאה נשאר כמו שהוא; הבא מגיע כשההחלטה נרשמת.
    if (leaving) return;

    const nextId = queue[0] || '';
    const hadFocus = card && card.contains(document.activeElement);
    if (nextId !== currentId) {
        drag = null;
        currentId = nextId;
        const record = nextId ? findRecord(nextId) : null;
        if (record && card) {
            card.innerHTML = cardMarkup(record);
            resetCardPosition(card, { animate: false });
            card.hidden = false;
            scheduleIconRefresh(card);
        } else if (card) {
            card.replaceChildren();
            card.hidden = true;
        }
        renderNext(queue[1]);
        const live = $('pendingSwipeLive');
        if (live) live.textContent = record ? `${cardTitle(record)}. ${countLabel(queue.length)}.` : 'אין עוד פריטים לאישור.';
    }
    const hasCard = Boolean(currentId);
    if (empty) empty.classList.toggle('hidden', hasCard);
    const approve = $('pendingSwipeApprove');
    const reject = $('pendingSwipeReject');
    if (approve) approve.disabled = !hasCard;
    if (reject) reject.disabled = !hasCard;
    const rejectHint = $('pendingSwipeRejectHint');
    if (rejectHint) rejectHint.textContent = rejectDescription();
    // הפוקוס אינו נשאר על כרטיס שהוסתר: הוא עובר לכרטיס הבא או למסך הריק.
    if (hasCard && hadFocus && document.activeElement !== card && !card.contains(document.activeElement)) {
        card.focus({ preventScroll: true });
    } else if (!hasCard && (hadFocus || document.activeElement === document.body || document.activeElement?.disabled)) {
        empty?.querySelector('button')?.focus({ preventScroll: true });
    }
}

// ההכרזה על ההחלטה עוברת דרך אזור sr-only שנמצא בעץ הנגישות מההתחלה
// (pendingSwipeUndoLive), ולא דרך הפס עצמו: אזור חי שנחשף ומתמלא באותה
// משימה לא תמיד מוכרז, ואז ההחלטה הראשונה עוברת בשקט. האזור מתרוקן מיד
// ומתמלא בפריים הבא, כך שגם אותו טקסט פעמיים (ביטול ושוב אותה החלטה) מוכרז.
let undoAnnounceFrame = 0;
function announceUndo(message) {
    const live = $('pendingSwipeUndoLive');
    if (!live) return;
    cancelAnimationFrame(undoAnnounceFrame);
    live.textContent = '';
    undoAnnounceFrame = message ? requestAnimationFrame(() => {
        undoAnnounceFrame = 0;
        live.textContent = message;
    }) : 0;
}

let undoShownFor = '';
function renderUndo() {
    const bar = $('pendingSwipeUndo');
    const text = $('pendingSwipeUndoText');
    if (!bar || !text) return;
    const pending = session.pending;
    if (!pending) {
        if (undoShownFor) announceUndo('');
        bar.hidden = true;
        undoShownFor = '';
        return;
    }
    const key = `${pending.id}:${pending.action}:${pending.deadline}`;
    if (undoShownFor === key) return;
    undoShownFor = key;
    bar.hidden = false;
    bar.dataset.action = pending.action;
    text.textContent = decidedMessage(pending.action, decidedTitles.get(pending.id) || 'פריט');
    announceUndo(text.textContent);
    // פס הזמן מתחיל מחדש לכל החלטה.
    const progress = bar.querySelector('.pending-swipe-undo-bar');
    if (progress) {
        progress.style.setProperty('--undo-ms', `${SWIPE_UNDO_MS}ms`);
        progress.classList.remove('is-running');
        void progress.offsetWidth;
        progress.classList.add('is-running');
    }
}

// החלטה: הכרטיס עף לכיוון הכפתור שלו, ורק אז נכנס לתור ההמתנה.
function decide(action) {
    if (!currentId || leaving) return;
    const id = currentId;
    const record = findRecord(id);
    if (!record) return;
    decidedTitles.set(id, cardTitle(record));
    // מי החליט: השמירה תצא רק אם זה עדיין החשבון המחובר (commitDecision).
    const uid = currentUid();
    const card = $('pendingSwipeCard');
    const recordDecision = () => {
        leaving = false;
        if (!isOpen) return;
        if (currentId !== id || !session.decide(id, action, { folder: targetFolderId(), uid })) {
            resetCardPosition(card, { animate: false });
            render();
        }
    };
    if (reducedMotionQuery.matches || !card) { recordDecision(); return; }
    leaving = true;
    card.querySelector('video')?.pause();
    card.classList.add('is-returning');
    card.dataset.leaving = action;
    card.dataset.hint = action;
    // הכיוון שאליו הכרטיס עף הוא הכיוון של ההחלקה שמובילה לאותה החלטה.
    const towardPositive = swipeActionForDx(1, readingDirection()) === action;
    const width = Math.max(window.innerWidth, card.offsetWidth) * 1.3;
    placeCard(card, towardPositive ? width : -width, 1);
    window.setTimeout(recordDecision, FLY_OUT_MS);
}

function undo() {
    const restored = session.undo();
    if (!restored) return;
    // הכרטיס חוזר לראש התור, וזה הסימן הנראה. בלי טוסט: בטלפון הוא יושב
    // בדיוק מעל כפתורי "אשר" ו"דחה" וחוסם אותם לכמה שניות.
    const live = $('pendingSwipeLive');
    if (live) live.textContent = `הפעולה בוטלה: ${decidedTitles.get(restored.id) || 'הפריט'}.`;
    $('pendingSwipeCard')?.focus({ preventScroll: true });
}

// --- גרירה ---

function onPointerDown(event) {
    if (!event.isPrimary || event.button > 0 || drag || leaving || !currentId) return;
    if (event.target.closest('video, button, a, input, select, textarea')) return;
    const card = event.currentTarget;
    drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dx: 0,
        dy: 0,
        axis: null,
        samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }]
    };
    card.classList.remove('is-returning');
    card.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const card = event.currentTarget;
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    drag.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    if (drag.samples.length > 12) drag.samples.shift();
    if (!drag.axis) drag.axis = lockAxis(drag.dx, drag.dy);
    if (drag.axis === 'y') {
        // גלילה אנכית (פרטי הכרטיס במסך נמוך) — לא החלקה.
        drag = null;
        resetCardPosition(card);
        return;
    }
    if (drag.axis !== 'x') return;
    event.preventDefault();
    const hint = swipeActionForDx(drag.dx, readingDirection());
    placeCard(card, drag.dx, swipeProgress(drag.dx, card.offsetWidth));
    if (hint) card.dataset.hint = hint; else delete card.dataset.hint;
}

function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const card = event.currentTarget;
    const gesture = drag;
    drag = null;
    if (card.hasPointerCapture?.(event.pointerId)) card.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel' || gesture.axis !== 'x') { resetCardPosition(card); return; }
    const { vx } = velocityFromSamples(gesture.samples);
    const action = decideCardSwipe({ dx: gesture.dx, dy: gesture.dy, vx, width: card.offsetWidth, direction: readingDirection() });
    if (action) decide(action);
    else resetCardPosition(card);
}

// --- מקלדת ומלכודת פוקוס ---

function focusableIn(root) {
    return Array.from(root.querySelectorAll('button, [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.disabled && !element.hidden && !element.closest('[hidden], .hidden') && element.getClientRects().length > 0);
}

// המקשים נתפסים ברמת המסמך (capture) כל עוד החלון פתוח, ולא על החלון
// עצמו: לחיצה על חלק שאינו מקבל פוקוס (הכותרת, טקסט ההסבר, המונה) מעבירה
// את הפוקוס ל-body, ומאזין על החלון כבר לא היה שומע את Escape, החצים
// ו-A/R/Z. מקש שמקורו מחוץ לחלון (טוסט, חלון אחר מעליו) אינו שלנו.
function onKeydown(event) {
    if (!isOpen) return;
    const dialog = $('pendingSwipe');
    const target = event.target instanceof Element ? event.target : null;
    const onBody = !target || target === document.body || target === document.documentElement;
    if (!onBody && !dialog.contains(target)) return;
    if (event.key === 'Tab') {
        // aria-modal: הפוקוס נשאר בתוך המצב המהיר עד שיוצאים ממנו.
        const items = focusableIn(dialog);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        // מ-body הפוקוס חוזר לתוך החלון, ולא לדף שמאחוריו.
        if (onBody) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
    }
    // Enter ורווח על כפתור מפעילים אותו בעצמם; בשדות ובסרטון המקשים שלהם.
    if (target?.closest('button, a') && (event.key === 'Enter' || event.key === ' ')) return;
    if (target?.closest('input, select, textarea')) return;
    if (target?.closest('video') && event.key !== 'Escape' && event.code !== 'KeyA' && event.code !== 'KeyR' && event.code !== 'KeyZ') return;
    const action = keyAction(event, readingDirection());
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'close') { closePendingSwipe(); return; }
    if (action === 'undo') { undo(); return; }
    // החזקת מקש אינה מאשרת שורה של פריטים בבת אחת.
    if (event.repeat) return;
    decide(action);
}

// עזיבת הדף באמצע חלון הביטול: ההחלטה נשלחת מיד, ו-beforeunload מבקש
// מהדפדפן לשאול לפני היציאה כדי שהבקשה תספיק לצאת.
function onBeforeUnload(event) {
    if (!session.pending && !session.busy) return;
    session.flush();
    event.preventDefault();
    event.returnValue = '';
}

function onPageHide() {
    session.flush();
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    const dialog = $('pendingSwipe');
    const card = $('pendingSwipeCard');
    document.addEventListener('keydown', onKeydown, true);
    dialog.querySelectorAll('[data-swipe-close]').forEach(button => button.addEventListener('click', () => closePendingSwipe()));
    $('pendingSwipeApprove').addEventListener('click', () => decide('approve'));
    $('pendingSwipeReject').addEventListener('click', () => decide('reject'));
    $('pendingSwipeUndoBtn').addEventListener('click', () => undo());
    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
    card.addEventListener('lostpointercapture', event => {
        if (drag && event.pointerId === drag.pointerId) { drag = null; resetCardPosition(card); }
    });
    // יעד אחר שנבחר ברשימה משנה גם את מה שהכרטיס מציג.
    $('pendingTargetFolder')?.addEventListener('change', () => {
        if (!isOpen || !currentId || leaving) return;
        currentId = '';
        render();
    });
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
}

export function openPendingSwipe() {
    const dialog = $('pendingSwipe');
    if (!dialog || !window.canViewAdminData?.()) return;
    wire();
    if (!isOpen) previousFocus = document.activeElement;
    isOpen = true;
    order = [];
    currentId = '';
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('pending-swipe-open');
    render();
    scheduleIconRefresh(dialog);
    const card = $('pendingSwipeCard');
    requestAnimationFrame(() => {
        if (currentId && card) card.focus({ preventScroll: true });
        else $('pendingSwipeEmpty')?.querySelector('button')?.focus({ preventScroll: true });
    });
}

export function closePendingSwipe() {
    if (!isOpen) return;
    // יציאה אינה מוותרת על ההחלטה האחרונה: היא נשלחת עכשיו.
    session.flush();
    hideDialog();
}

// סוף החיבור — התנתקות (גם מלשונית אחרת), החלפת חשבון או אובדן הרשאת
// ניהול: החלון נסגר בלי לשלוח את ההחלטה שבחלון הביטול, והמפגש נשכח.
// התנתקות מהכפתור כבר שלחה אותה קודם (flushPendingSwipe ב-session-auth.js);
// כאן מגיע מה שלא הספיק — ובמקרה כזה עדיף שהפריט יישאר ממתין מאשר שיישמר
// בשם מי שבא אחרי המנהל.
export function endPendingSwipe() {
    // קודם סוגרים: reset מודיע ל-render, וזה כבר לא יצייר חלון סגור.
    if (isOpen) hideDialog({ restoreFocus: false });
    session.reset();
    decidedTitles.clear();
    announceUndo('');
    // פרטי ההעלאה של החשבון הקודם אינם נשארים גם ב-DOM המוסתר.
    $('pendingSwipeCard')?.replaceChildren();
    $('pendingSwipeNext')?.replaceChildren();
    const undoText = $('pendingSwipeUndoText');
    if (undoText) undoText.textContent = '';
    const live = $('pendingSwipeLive');
    if (live) live.textContent = '';
    order = [];
}

function hideDialog({ restoreFocus = true } = {}) {
    const dialog = $('pendingSwipe');
    if (!dialog) return;
    isOpen = false;
    drag = null;
    leaving = false;
    currentId = '';
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('pending-swipe-open');
    $('pendingSwipeCard')?.querySelector('video')?.pause();
    const opener = previousFocus && document.contains(previousFocus) ? previousFocus : $('pendingSwipeOpenBtn');
    previousFocus = null;
    if (restoreFocus) opener?.focus?.({ preventScroll: true });
}

// ההתנתקות (session-auth.js) מחכה לזה לפני שהאסימון נמחק: ההחלטה שבחלון
// הביטול, וכל שמירה שכבר בדרך, נשלחות בשם המנהל שעדיין מחובר.
export function flushPendingSwipe() {
    return session.drain();
}

window.refreshPendingSwipe = () => render();
window.closePendingSwipe = closePendingSwipe;
window.flushPendingSwipe = flushPendingSwipe;
window.resetPendingSwipe = endPendingSwipe;
