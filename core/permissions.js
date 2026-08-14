// בדיקות דרגה: מנהל ומנהל־על
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { showNotification } from '../ui/modals.js';

export function checkAdminPermission() {
    if (!window.state.isAdminLoggedIn) {
        showNotification("אין לך הרשאה לבצע פעולה זו. התחבר כמנהל תחילה.", false);
        return false;
    }
    return true;
}

window.checkAdminPermission = checkAdminPermission;

export function checkSuperAdminPermission() {
    if (!window.state.isSuperAdmin) {
        showNotification("הפעולה זמינה רק למנהל־על בדרגה 4.", false);
        return false;
    }
    return true;
}

window.checkSuperAdminPermission = checkSuperAdminPermission;
