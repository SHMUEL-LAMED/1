// פאנל הפרופיל הצף: פתיחה, סגירה ומעבר לניהול
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { toggleAdminDrawer } from './admin-menu.js';
import { scheduleIconRefresh } from './icons.js';

function setFloatingProfileOpen(shouldOpen, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const panel = document.getElementById('floatingProfilePanel');
    if (!panel) return;
    const button = document.getElementById('floatingProfileButton');
    panel.classList.toggle('active', Boolean(shouldOpen));
    button?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        scheduleIconRefresh();
    }
}

window.openFloatingProfile = function(event) {
    setFloatingProfileOpen(true, event);
};

window.closeFloatingProfile = function(event) {
    setFloatingProfileOpen(false, event);
};

window.toggleFloatingProfile = function(event) {
    const panel = document.getElementById('floatingProfilePanel');
    setFloatingProfileOpen(!panel?.classList.contains('active'), event);
};

window.openManagementFromProfile = function() {
    if (!window.state.isAdminLoggedIn) {
        window.showNotification('הכניסה ללוח הניהול זמינה למנהלים בלבד.', false);
        return;
    }
    window.closeFloatingProfile();
    const drawer = document.getElementById('adminDrawer');
    if (drawer && !drawer.classList.contains('translate-x-0')) toggleAdminDrawer();
};
