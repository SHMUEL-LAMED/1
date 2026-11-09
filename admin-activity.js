// admin-activity.js — מסך "מרכז פעילות" בלוח הניהול: כרטיסי תמונת המצב,
// סינון יומן הפעולות לפי סוג, הרשימה עצמה וייצוא היומן ל-CSV (מנהל־על בלבד).
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (canViewSuperAdminData, checkSuperAdminPermission, formatDate,
// scheduleIconRefresh) נקראים מ-window בזמן הקריאה ולא בטעינת המודול, כדי
// שסדר הטעינה העצלה לא ישבור אותם.

import { downloadCsv } from './admin-csv.js';

export const ACTIVITY_LABELS = {
    moved_to_trash: 'העביר לסל המחזור',
    restored: 'שחזר פריט',
    purged: 'מחק לצמיתות',
    approved_user: 'אישר משתמש',
    changed_role: 'שינה דרגה',
    changed_block: 'שינה חסימה',
    approved_images: 'אישר תמונות',
    uploaded_images: 'העלה תמונות',
    synced_drive: 'סנכרן Drive',
    resolved_support: 'סימן פנייה כטופלה',
    reopened_support: 'פתח פנייה מחדש',
    sent_email: 'שלח דוא״ל',
    restored_backup: 'שחזר גיבוי'
};

let activityFilter = 'all';

export function setActivityFilter(filter) {
    activityFilter = filter || 'all';
    window.renderActivityLogs();
}
window.setActivityFilter = setActivityFilter;

export function renderActivityLogs() {
    const { canViewSuperAdminData, formatDate, scheduleIconRefresh } = window;
    const list = document.getElementById('activityLogList');
    const summary = document.getElementById('activitySummary');
    const filters = document.getElementById('activityFilters');
    // יומן הפעולות — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (summary) summary.replaceChildren();
        if (list) list.replaceChildren();
        if (filters) filters.replaceChildren();
        return;
    }

    const logs = window.state.activityLogs || [];

    if (summary) {
        const cards = [
            ['user-plus', (window.state.pendingUsers || []).length, 'בקשות הצטרפות', 'violet'],
            ['image-plus', (window.state.pendingImages || []).length, 'ממתינים לאישור', 'gold'],
            ['trash-2', (window.state.deletionRequests || []).length, 'בקשות מחיקה', 'danger'],
            ['archive-restore', (window.state.trashItems || []).length, 'בסל המחזור', 'cyan']
        ];
        summary.innerHTML = cards.map(([icon, value, label, tone]) => `
            <div class="admin-stat" data-tone="${tone}">
                <span class="admin-stat-icon"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
                <div><strong>${value}</strong><span>${label}</span></div>
            </div>`).join('');
    }

    if (filters) {
        const actions = ['all', ...new Set(logs.map(log => log.action).filter(Boolean))];
        filters.replaceChildren();
        actions.slice(0, 12).forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-filter-chip ${action === activityFilter ? 'is-active' : ''}`;
            button.textContent = action === 'all' ? 'הכול' : (ACTIVITY_LABELS[action] || action);
            button.onclick = () => window.setActivityFilter(action);
            filters.appendChild(button);
        });
    }

    if (!list) return;
    list.replaceChildren();
    const visible = logs.filter(log => activityFilter === 'all' || log.action === activityFilter);

    if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'עדיין אין פעולות מתועדות.';
        list.appendChild(empty);
    } else {
        visible.slice(0, 80).forEach(log => {
            const row = document.createElement('article');
            row.className = 'admin-row';
            row.innerHTML = '<span class="admin-stat-icon" data-tone="cyan"><i data-lucide="history" class="w-4 h-4"></i></span>';
            const text = document.createElement('div');
            text.className = 'min-w-0 flex-1';
            const title = document.createElement('p');
            title.className = 'admin-row-title';
            title.textContent = `${log.actorName || 'משתמש'} — ${ACTIVITY_LABELS[log.action] || log.action || 'פעולה'}`;
            const meta = document.createElement('p');
            meta.className = 'admin-row-meta';
            meta.textContent = `${log.targetName || log.targetId || ''}${log.details ? ` · ${log.details}` : ''} · ${formatDate(log.createdAt)}`;
            text.append(title, meta);
            row.appendChild(text);
            list.appendChild(row);
        });
    }
    scheduleIconRefresh();
}
window.renderActivityLogs = renderActivityLogs;

export function exportActivityCsv() {
    const { checkSuperAdminPermission, formatDate } = window;
    if (!checkSuperAdminPermission()) return;
    const rows = [['תאריך', 'מבצע', 'פעולה', 'יעד', 'פרטים']];
    (window.state.activityLogs || []).forEach(log => {
        rows.push([
            formatDate(log.createdAt),
            log.actorName || '',
            ACTIVITY_LABELS[log.action] || log.action || '',
            log.targetName || log.targetId || '',
            log.details || ''
        ]);
    });
    downloadCsv(rows, `simchas-gallery-activity-${new Date().toISOString().slice(0, 10)}.csv`);
    window.showNotification('יומן הפעילות הורד.', true);
}
window.exportActivityCsv = exportActivityCsv;
