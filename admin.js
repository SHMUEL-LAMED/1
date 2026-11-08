// admin.js — נקודת הכניסה של לוח הניהול: פתיחת הלוח, סינון לפי דרגה
// והפצה לציירים.
//
// הקובץ פוצל למודולים ממוקדים, וכאן נשארו רק המעטפת והרישום על window:
//   admin-pending.js   — תור ההעלאות הממתינות, המונים וסיכום הנתונים
//   admin-users.js     — בקשות הצטרפות, דרגות, חסימה ומחיקת משתמשים
//   admin-deletions.js — בקשות מחיקה (דרגה 3 מבקשת, מנהל־על מכריע)
// לוגיקת הצ׳אט חיה ב-chat.js וב-chat-admin.js.
//
// המודולים מייצאים פונקציות בלבד ואינם נוגעים ב-window בזמן הטעינה; הרישום
// על window (לטובת מטפלי onclick שב-HTML ולקריאות בין מודולים) נעשה כאן,
// בסוף הקובץ, כך שייבוא של admin.js לבדו מגדיר את כל השמות — גם כשנקודת
// הכניסה נטענת מחדש מול window אחר, כמו בבדיקות.

import {
    renderPendingImages, updatePendingBadge, updateAdminOverview, toggleSelectAllPending,
    approveSelectedPending, approvePendingImage, openPendingSwipe
} from './admin-pending.js';
import {
    changeUserRole, toggleUserBlock, deleteManagedUser, forceRefreshUsers,
    renderManagedUsers, renderPendingUsers, updatePendingUsersBadge,
    approveUserAccess, rejectUserAccess
} from './admin-users.js';
import { requestContentDeletion, renderDeletionRequests, resolveDeletionRequest } from './admin-deletions.js';

// --- 3. Admin panel UI ---
// כאן נשאר רק מה ששייך ללוח הניהול עצמו. כל מה שמשתמש רגיל רואה — שער
// הגישה, נעילת הגלריה, סטטוס הכותרת וכרטיס הפרופיל — עבר ל-session-ui.js,
// שנטען בכל דף. כך דף הגלריה אינו נזקק למודול הזה כלל.
window.updateAdminPanelUI = function() {
    const adminPanel = document.getElementById('sidebarAdminPanel');
    if (!adminPanel) return;

    const superAdminOnlyElements = adminPanel.querySelectorAll('.super-admin-only');
    const superAdminChatsCard = document.getElementById('superAdminChatsCard');
    const superAdminUsersCard = document.getElementById('superAdminUsersCard');
    const superAdminDeletionRequestsCard = document.getElementById('superAdminDeletionRequestsCard');
    const rejectPendingButton = document.getElementById('rejectPendingBtn');

    adminPanel.classList.toggle('hidden', !window.state.isAdminLoggedIn);
    superAdminOnlyElements.forEach(element => element.classList.add('hidden'));
    if (superAdminChatsCard) superAdminChatsCard.classList.add('hidden');
    if (superAdminUsersCard) superAdminUsersCard.classList.add('hidden');
    if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.add('hidden');
    // מי שאיבד את הרשאת הניהול: "מצב מהיר" (אם פתוח) נסגר ב-render שלו, בלי
    // לשלוח את ההחלטה שבחלון הביטול.
    if (!window.state.isAdminLoggedIn) { window.refreshPendingSwipe?.(); return; }

    const currentUser = window.state.currentUser;
    const adminName = document.getElementById('adminCurrentUserName');
    const adminEmail = document.getElementById('adminCurrentUserEmail');
    const adminPhoto = document.getElementById('adminCurrentUserPhoto');
    const adminFallback = document.getElementById('adminCurrentUserFallback');
    const adminGrade = document.getElementById('adminCurrentUserGrade');
    if (adminName) adminName.textContent = currentUser?.displayName || 'מנהל המערכת';
    if (adminEmail) adminEmail.textContent = currentUser?.email || '';
    if (adminPhoto && adminFallback) {
        const adminPhotoUrl = window.safeImageUrl(currentUser?.photoURL);
        adminPhoto.classList.toggle('hidden', !adminPhotoUrl);
        adminFallback.classList.toggle('hidden', Boolean(adminPhotoUrl));
        if (adminPhotoUrl) adminPhoto.src = adminPhotoUrl;
    }
    if (adminGrade) {
        adminGrade.textContent = window.state.isSuperAdmin ? 'דרגה 4 — מנהל־על' : 'דרגה 3 — מנהל';
        // הצבע מגיע מהאסימונים שב-styles.css, ולכן הוא נכון בשני מצבי התצוגה.
        adminGrade.className = 'admin-grade-badge';
        adminGrade.dataset.grade = window.state.isSuperAdmin ? 'super' : 'admin';
    }
    if (window.state.isSuperAdmin) {
        superAdminOnlyElements.forEach(element => element.classList.remove('hidden'));
        if (superAdminChatsCard) superAdminChatsCard.classList.remove('hidden');
        if (superAdminUsersCard) superAdminUsersCard.classList.remove('hidden');
        if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.remove('hidden');
    }
    if (rejectPendingButton) rejectPendingButton.textContent = window.state.isSuperAdmin ? 'מחק לצמיתות' : 'בקש מחיקה';

    window.renderPendingImages();
    window.updatePendingBadge();
    window.renderPendingUsers();
    window.updatePendingUsersBadge();
    window.renderManagedUsers();
    window.renderDeletionRequests();
    // התפריט נבנה מחדש בכל שינוי הרשאה: מסכי מנהל־על נוספים או נעלמים.
    window.renderAdminNavigation?.();
    window.updateAdminOverviewExtras?.();
    window.scheduleIconRefresh();
    // האינדוקס הראשוני מתחיל רק בדף הניהול, ורק אחרי שהלוח כבר מצויר.
    window.setTimeout(() => window.maybeStartInitialFaceIndexing?.(), 1800);
};

// מסלול הדחייה של פריט ממתין. הוא נשאר כאן, ולא ב-admin-pending.js, משום
// ש-admin-guide.test.mjs קורא את ההכרעה (סל המחזור למנהל־על, בקשת מחיקה
// לדרגה 3) מתוך admin.js ומשווה אותה לטקסט המדריך.

// סיבת הדחייה (רשות) נרשמת קודם בשרת (POST /pending/reject): המעלה רואה
// אותה ב"ההעלאות שלי", ורק הוא. Worker ישן (404) — הדחייה ממשיכה בלי סיבה;
// גם כשל אחר אינו עוצר את הדחייה עצמה, והפריט נרשם כנדחה כשהוא נמחק מהתור.
async function recordRejectReason(imageId, reason) {
    try {
        await window.r2Request('/pending/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId: window.safeRecordId(imageId), reason: String(reason || '').slice(0, 300) })
        });
    } catch (error) {
        if (error?.status !== 404) console.warn('Recording the rejection reason failed:', error?.code || error);
    }
}

// דחיית פריט ממתין אחד: מנהל־על מעביר לסל המחזור (וממנו אפשר לשחזר),
// ומנהל דרגה 3 שולח בקשת מחיקה — בדיוק כמו "בקש מחיקה" שבמסך. מחזיר
// 'trash' או 'request', כדי שהמצב המהיר ידע מה לכתוב.
async function rejectPendingRecord(imageId, { reason = '' } = {}) {
    await recordRejectReason(imageId, reason);
    if (window.state.isSuperAdmin) {
        await window.movePendingImageToTrash(imageId);
        return 'trash';
    }
    const image = (window.state.pendingImages || []).find(item => window.safeRecordId(item.id) === window.safeRecordId(imageId));
    await window.requestContentDeletion('pendingImage', imageId, image?.title || 'תמונה ממתינה');
    return 'request';
}

export function rejectSelectedPending() {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) return;
    // הסיבה (רשות) חלה על כל הפריטים שנבחרו, ומתרוקנת אחרי הדחייה.
    const reasonField = document.getElementById('pendingRejectReason');
    const reason = String(reasonField?.value || '').trim();
    const clearReason = () => { if (reasonField) reasonField.value = ''; };
    if (!window.state.isSuperAdmin) {
        window.showConfirm('שליחת בקשת מחיקה', 'לשלוח למנהל־העל בקשת מחיקה עבור התמונות שנבחרו?', async () => {
            try {
                await Promise.all(Array.from(checkboxes, cb => rejectPendingRecord(cb.value, { reason })));
                clearReason();
                window.showNotification('בקשות המחיקה נשלחו למנהל־העל.');
            } catch (error) {
                console.error('requestContentDeletion failed:', error);
                window.showNotification(error.message || 'שליחת הבקשה נכשלה.', false);
            }
        });
        return;
    }
    window.showConfirm('דחיית תמונות', 'להעביר את התמונות הממתינות לסל המחזור?', async () => {
        try {
            await Promise.all(Array.from(checkboxes, cb => rejectPendingRecord(cb.value, { reason })));
            clearReason();
            window.showNotification('התמונות הועברו לסל המחזור.');
        } catch (error) {
            console.error('movePendingImageToTrash failed:', error);
            window.showNotification('העברה לסל המחזור נכשלה.', false);
        }
    });
}

export async function rejectPendingImage(imageId, options = {}) {
    if (!window.checkAdminPermission()) throw new Error('אין הרשאה לדחות תוכן.');
    return rejectPendingRecord(imageId, options);
}

// הרישום על window — שמות וחתימות זהים לאלה שהיו כאן לפני הפיצול. מטפלי
// onclick שנשארו ב-HTML, pending-swipe.js, chat-admin.js ו-admin-ui.js
// קוראים לפונקציות דרך השמות האלה.
window.renderPendingImages = renderPendingImages;
window.updatePendingBadge = updatePendingBadge;
window.updateAdminOverview = updateAdminOverview;
window.toggleSelectAllPending = toggleSelectAllPending;
window.approveSelectedPending = approveSelectedPending;
window.rejectSelectedPending = rejectSelectedPending;
window.approvePendingImage = approvePendingImage;
window.rejectPendingImage = rejectPendingImage;
window.openPendingSwipe = openPendingSwipe;

window.changeUserRole = changeUserRole;
window.toggleUserBlock = toggleUserBlock;
window.deleteManagedUser = deleteManagedUser;
window.forceRefreshUsers = forceRefreshUsers;
window.renderManagedUsers = renderManagedUsers;
window.renderPendingUsers = renderPendingUsers;
window.updatePendingUsersBadge = updatePendingUsersBadge;
window.approveUserAccess = approveUserAccess;
window.rejectUserAccess = rejectUserAccess;

window.requestContentDeletion = requestContentDeletion;
window.renderDeletionRequests = renderDeletionRequests;
window.resolveDeletionRequest = resolveDeletionRequest;

// נקודת האתחול של המודול. admin-app.js קורא לה פעם אחת בטעינת דף הניהול.
// שכבת הסשן מצוירת בנפרד, ולכן כאן מצויר רק הלוח עצמו.
export function initAdmin() {
    window.updateAdminPanelUI?.();
}
