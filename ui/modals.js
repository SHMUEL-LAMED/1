// חלונות: פתיחה, סגירה, Escape, החזרת focus, הודעות ואישורים
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { escapeHtml } from '../core/utils.js';
import { restoreAdminTaskContent } from './admin-menu.js';
import { scheduleIconRefresh } from './icons.js';

export function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m._previousActiveElement = document.activeElement;
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
    const firstControl = m.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstControl) requestAnimationFrame(() => firstControl.focus({ preventScroll: true }));
}

window.openModal = openModal;

export function closeModal(id) {
    if (id === 'adminTaskModal') restoreAdminTaskContent();
    const m = document.getElementById(id);
    if (m) {
        m.classList.add('hidden');
        m.setAttribute('aria-hidden', 'true');
        if (m._previousActiveElement && typeof m._previousActiveElement.focus === 'function') {
            m._previousActiveElement.focus({ preventScroll: true });
        }
    }
    if (id === 'conversationModal') {
        window.clearConversationAttachment?.();
        window.toggleConversationEmojiPicker?.(false);
        window.toggleConversationStickerPicker?.(false);
        const status = document.getElementById('conversationUploadStatus');
        if (status) status.textContent = 'תמונות וקבצים עד 25MB';
    }
    if (id === 'faceCameraModal') {
        if (typeof window.stopFaceCamera === 'function') window.stopFaceCamera();
    }
    if (id === 'userUploadModal') {
        window.resetUploadPauseState?.();
    }
}

window.closeModal = closeModal;

function toggleAccordion(id) {
    const content = document.getElementById(id);
    if (!content) return;
    const isAct = content.classList.contains('active');
    document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('[id$="Arrow"]').forEach(a => {
        a.setAttribute('data-lucide', 'chevron-down');
        a.style.transform = 'rotate(0deg)';
    });
    if (!isAct) {
        content.classList.add('active');
        const arrow = document.getElementById(id + 'Arrow');
        if (arrow) {
            arrow.setAttribute('data-lucide', 'chevron-up');
            arrow.style.transform = 'rotate(180deg)';
        }
    }
    scheduleIconRefresh();
}

window.toggleAccordion = toggleAccordion;

let notificationTimer = null;

export function showNotification(msg, isSuccess = true, tone = null) {
    const alertEl = document.getElementById('customAlert');
    const iconEl = document.getElementById('customAlertIcon');
    const msgEl = document.getElementById('customAlertMessage');
    if (!alertEl || !iconEl || !msgEl) return;

    // מיפוי הודעות נפוצות להעשרת תוכן ההסבר והמשמעות הקהילתית של הפעולה (Impact)
    let enrichedMessage = msg;
    let impactDesc = "";

    if (msg.includes('התחברת בהצלחה')) {
        impactDesc = "חיבור בטוח ומאובטח המאפשר צפייה ושמירה על פרטיות זיכרונות הישיבה.";
    } else if (msg.includes('הועלו') && msg.includes('תמונות')) {
        impactDesc = "התמונות הועברו לענן בבטחה ומשמרות את הווי הישיבה והשמחה לדורות הבאים.";
    } else if (msg.includes('נשלחו לאישור')) {
        impactDesc = "החומרים בבדיקה אצל מנהל כדי לוודא שכל תמונה המוצגת עומדת בסטנדרט של הישיבה.";
    } else if (msg.includes('נוצרה בענן')) {
        impactDesc = "תיקייה חדשה מארגנת כעת את הארכיון ומאפשרת למשתמשים למצוא אירועים בקלות.";
    } else if (msg.includes('עודכן בהצלחה')) {
        impactDesc = "התמונות סווגו מחדש ויופיעו תחת הקטגוריה המעודכנת בזמן אמת.";
    } else if (msg.includes('סנכרון Drive הושלם')) {
        impactDesc = "התמונות בענן ובישיבה סונכרנו באופן מלא! הארכיון כעת שלם ומעודכן לחלוטין.";
    } else if (msg.includes('בקשת המחיקה')) {
        impactDesc = "הפריטים הוסרו כדי להבטיח את איכות ודיוק התוכן המוצג לציבור.";
    } else if (msg.includes('דרגת המשתמש עודכנה')) {
        impactDesc = "הרשאות המשתמש הותאמו לפעילותו השוטפת לשמירה על סדר וארגון בגלריה.";
    } else if (msg.includes('ההודעה האישית נשלחה')) {
        impactDesc = "המשתמש קיבל התראה אישית ישירות לתיבת ההודעות שלו בפרופיל.";
    } else if (msg.includes('מפעיל את אפליקציית הדוא"ל')) {
        impactDesc = "יוזם קשר ישיר עם חבר הקהילה לבירור וקידום הבקשה.";
    } else if (msg.includes('הפרטים נשמרו בהצלחה')) {
        impactDesc = "פרטי הזיהוי שלך נשלחו למנהל ומקדמים את פתיחת הגלריה האישית עבורך!";
    } else if (msg.includes('אין לך הרשאה')) {
        impactDesc = "פעולה זו מוגנת ומיועדת למורשי ניהול בלבד כדי לשמור על הארכיון הקדוש.";
    }

    if (impactDesc) {
        msgEl.innerHTML = `<div class="flex flex-col gap-1 text-right">
            <span class="font-black text-xs tracking-wide text-white">${escapeHtml(msg)}</span>
            <span class="text-[9px] text-amber-300 font-semibold leading-normal opacity-90">${escapeHtml(impactDesc)}</span>
        </div>`;
    } else {
        msgEl.textContent = msg;
    }

    if (tone === 'warning') {
        iconEl.innerHTML = `<i data-lucide="triangle-alert" class="w-6 h-6 text-amber-300"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-amber-400/30 max-w-[340px]";
    } else if (isSuccess) {
        iconEl.innerHTML = `<i data-lucide="check-circle" class="w-6 h-6 text-emerald-400"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-emerald-500/20 max-w-[340px]";
    } else {
        iconEl.innerHTML = `<i data-lucide="alert-circle" class="w-6 h-6 text-red-400"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-red-500/20 max-w-[340px]";
    }
    scheduleIconRefresh();

    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-md text-white px-5 py-3.5 rounded-2xl shadow-2xl z-50 flex items-center gap-2.5 transform translate-y-20 opacity-0 transition-all duration-300 border border-white/10";
    }, 5500);
}

window.showNotification = showNotification;

let pendingConfirmAction = null;

let confirmActionRunning = false;

function resetConfirmButtons() {
    const approveBtn = document.getElementById('confirmApproveBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (approveBtn) approveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    confirmActionRunning = false;
}

function cancelConfirmAction() {
    if (confirmActionRunning) return;
    pendingConfirmAction = null;
    resetConfirmButtons();
    closeModal('confirmModal');
}

window.cancelConfirmAction = cancelConfirmAction;

async function approveConfirmAction() {
    if (confirmActionRunning || typeof pendingConfirmAction !== 'function') return;
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    confirmActionRunning = true;

    const approveBtn = document.getElementById('confirmApproveBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (approveBtn) approveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
        await action();
        closeModal('confirmModal');
    } catch (error) {
        console.error('Confirmed action failed:', error);
        showNotification('הפעולה נכשלה. נסה שוב.', false);
    } finally {
        resetConfirmButtons();
    }
}

window.approveConfirmAction = approveConfirmAction;

export function showConfirm(title, message, onApprove) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    pendingConfirmAction = typeof onApprove === 'function' ? onApprove : null;
    resetConfirmButtons();
    openModal('confirmModal');
    scheduleIconRefresh();
}

window.showConfirm = showConfirm;
