// admin.js — ממשק הניהול, משתמשים, דרגות והרשאות
// לוגיקת הצ׳אט הועברה ל-chat.js כדי לשמור על מודולים קטנים וברורים יותר.

// --- 3. Admin UI Update Routing ---


import './features/admin/permissions.js';
import './features/admin/media-approval.js';
import './features/admin/users.js';
import './features/admin/dashboard.js';
import './features/admin/announcements.js';

export function initAdmin() {
    window.updateAdminUI?.();
}
