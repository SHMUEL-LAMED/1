// admin-tools.js — מסך "תחזוקה ואבחון" בלוח הניהול: ניקוי המטמון המקומי
// (וטעינת הדף מחדש) והעתקת נתוני האבחון.
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (checkAdminPermission, showConfirm, R2_WORKER_BASE_URL)
// נקראים מ-window בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא
// ישבור אותם.

export function clearClientCaches(confirmed = false) {
    const { checkAdminPermission, showConfirm } = window;
    if (!checkAdminPermission()) return;
    if (!confirmed) {
        showConfirm(
            'ניקוי מטמון האתר',
            'לנקות את המטמון המקומי ולטעון את הדף מחדש? הנתונים שבענן אינם מושפעים.',
            () => window.clearClientCaches(true)
        );
        return;
    }
    (async () => {
        if (window.caches?.keys) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map(key => window.caches.delete(key)));
        }
        const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(registrations.map(registration => registration.unregister()));
    })()
        .catch(error => console.warn('Cache clearing failed:', error))
        .finally(() => window.location.reload());
}
window.clearClientCaches = clearClientCaches;

export async function copyAdminDiagnostics() {
    const { R2_WORKER_BASE_URL } = window;
    const box = document.getElementById('adminDiagnostics');
    const report = [
        `תאריך: ${new Date().toISOString()}`,
        `דפדפן: ${navigator.userAgent}`,
        `מצב תצוגה: ${document.documentElement.dataset.theme}`,
        `משתמש: ${window.state?.currentUser?.email || 'לא מחובר'}`,
        `דרגה: ${window.state?.isSuperAdmin ? 'מנהל־על' : window.state?.isAdminLoggedIn ? 'מנהל' : 'רגיל'}`,
        `פריטים: ${(window.state?.images || []).length}`,
        `תיקיות: ${(window.state?.folders || []).length}`,
        `ממתינים: ${(window.state?.pendingImages || []).length}`,
        `סביבת API: ${window.API_ENVIRONMENT || 'production'}`,
        `Worker: ${R2_WORKER_BASE_URL}`
    ].join('\n');

    if (box) {
        box.textContent = report;
        box.style.whiteSpace = 'pre-wrap';
        box.style.textAlign = 'start';
    }
    try {
        await navigator.clipboard.writeText(report);
        window.showNotification('נתוני האבחון הועתקו.', true);
    } catch (error) {
        window.showNotification('הנתונים מוצגים כאן — אפשר להעתיק אותם ידנית.', false);
    }
}
window.copyAdminDiagnostics = copyAdminDiagnostics;
