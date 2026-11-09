// admin-users-view.js — במסך "משתמשים והרשאות" בלוח הניהול: סינון רשימת
// המשתמשים, ייצוא הרשימה ל-CSV ושליחת דוא״ל ישיר למשתמש.
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (checkSuperAdminPermission, openModal, closeModal, r2Request)
// נקראים מ-window בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא
// ישבור אותם.

// ייצוא CSV שמנטרל נוסחאות (=, +, -, @) — שמות המשתמשים מגיעים מחשבונות Google.
import { userCsvRows } from './admin-users-model.js';
import { downloadCsv } from './admin-csv.js';

// ==========================================================================
// משתמשים — סינון וייצוא
// ==========================================================================

export function filterManagedUsers() {
    const query = String(document.getElementById('adminUserSearch')?.value || '').trim().toLocaleLowerCase('he');
    const role = String(document.getElementById('adminUserRoleFilter')?.value || '');
    const list = document.getElementById('managedUsersList');
    if (!list) return;

    [...list.children].forEach(card => {
        const text = card.textContent.toLocaleLowerCase('he');
        const matchesQuery = !query || text.includes(query);
        const matchesRole = !role || card.dataset.userRole === role;
        card.classList.toggle('hidden', !(matchesQuery && matchesRole));
    });
}
window.filterManagedUsers = filterManagedUsers;

// ייצוא רשימת המשתמשים — מנהל־על בלבד, ורק ממה שכבר נטען למסך שלו
// (state.allUsers). אין כאן בקשה לשרת: הקובץ נבנה בדפדפן.
export function exportUsersCsv() {
    const { checkSuperAdminPermission } = window;
    if (!checkSuperAdminPermission()) return;
    downloadCsv(userCsvRows(window.state.allUsers || []), `simchas-gallery-users-${new Date().toISOString().slice(0, 10)}.csv`);
    window.showNotification('קובץ המשתמשים הורד.', true);
}
window.exportUsersCsv = exportUsersCsv;

// ==========================================================================
// דוא״ל ישיר
// ==========================================================================

export function sendDirectMail(recipientEmail, displayName) {
    const { openModal } = window;
    if (!recipientEmail) {
        window.showNotification('אין כתובת מייל תקינה למשתמש זה.', false);
        return;
    }
    document.getElementById('directEmailTo').value = recipientEmail;
    document.getElementById('directEmailSubject').value = 'עדכון בנוגע לבקשת הגישה שלך לגלריית שמחת התורה';
    document.getElementById('directEmailBody').value = `שלום ${displayName || 'ידיד הישיבה'},

הבקשה שלך לגישה לגלריית שמחת התורה מעובדת כעת על ידי מנהלי המערכת.

בברכה,
צוות גלריית שמחת התורה`;
    openModal('directEmailModal');
}
window.sendDirectMail = sendDirectMail;

export async function submitDirectEmail(event) {
    const { checkSuperAdminPermission, closeModal, r2Request } = window;
    event?.preventDefault();
    if (!checkSuperAdminPermission()) return;
    const button = document.getElementById('directEmailSubmit');
    const payload = {
        to: document.getElementById('directEmailTo').value.trim(),
        subject: document.getElementById('directEmailSubject').value.trim(),
        text: document.getElementById('directEmailBody').value.trim()
    };
    if (button) button.disabled = true;
    try {
        await r2Request('/send-email', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        closeModal('directEmailModal');
        window.showNotification('הדוא״ל נשלח בהצלחה.', true);
        await window.logActivity('sent_email', 'user', '', payload.to, payload.subject);
    } catch (error) {
        window.showNotification(error.message || 'שליחת הדוא״ל נכשלה.', false);
    } finally {
        if (button) button.disabled = false;
    }
}
window.submitDirectEmail = submitDirectEmail;
