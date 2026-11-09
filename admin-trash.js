// admin-trash.js — מסך "סל מחזור" בלוח הניהול: רשימת הפריטים שנמחקו, שחזור,
// מחיקה סופית וריקון הסל כולו (מנהל־על בלבד).
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (canViewSuperAdminData, checkSuperAdminPermission, formatDate,
// scheduleIconRefresh, showConfirm) נקראים מ-window בזמן הקריאה ולא בטעינת
// המודול, כדי שסדר הטעינה העצלה לא ישבור אותם.

import { trashPurgeLabel } from './maintenance-model.js';

export function renderTrashItems() {
    const { canViewSuperAdminData, formatDate, scheduleIconRefresh } = window;
    const list = document.getElementById('trashItemsList');
    const badge = document.getElementById('trashItemsCountBadge');
    // סל המחזור — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (badge) badge.textContent = '0';
        if (list) list.replaceChildren();
        return;
    }
    const allItems = window.state.trashItems || [];
    const items = allItems.filter(item => !item.parentTrashGroupId);
    if (badge) badge.textContent = String(items.length);
    if (!list) return;

    list.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'סל המחזור ריק.';
        list.appendChild(empty);
        return;
    }

    const typeLabels = { image: 'תמונה', pendingImage: 'תמונה ממתינה', folder: 'תיקייה', user: 'משתמש' };
    items.forEach(item => {
        const row = document.createElement('article');
        row.className = 'admin-row';
        row.innerHTML = '<span class="admin-stat-icon" data-tone="gold"><i data-lucide="archive" class="w-4 h-4"></i></span>';

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'admin-row-title truncate';
        title.textContent = `${typeLabels[item.originalType] || 'פריט'} — ${item.targetName || item.originalId}`;
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        // הניקוי היומי בענן מוחק לצמיתות אחרי TRASH_RETENTION_DAYS; הספירה כאן מאותו קבוע.
        const purgeLabel = trashPurgeLabel(item.deletedAt);
        meta.textContent = `${formatDate(item.deletedAt)} · נמחק על ידי ${item.deletedByName || 'מנהל־על'}${purgeLabel ? ` · ${purgeLabel}` : ''}`;
        text.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        restore.textContent = 'שחזור';
        restore.onclick = () => window.restoreTrashItem(item.id);
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'btn-danger-soft px-3 py-1.5 text-[11px]';
        purge.textContent = 'מחיקה סופית';
        purge.onclick = () => window.purgeTrashItem(item.id);
        actions.append(restore, purge);

        row.append(text, actions);
        list.appendChild(row);
    });
    scheduleIconRefresh(list);
}
window.renderTrashItems = renderTrashItems;

export function purgeEntireTrash(confirmed = false) {
    const { checkSuperAdminPermission, showConfirm } = window;
    if (!checkSuperAdminPermission()) return;
    const items = (window.state.trashItems || []).filter(item => !item.parentTrashGroupId);
    if (!items.length) {
        window.showNotification('סל המחזור כבר ריק.', false);
        return;
    }
    if (!confirmed) {
        showConfirm(
            'ריקון סל המחזור',
            `למחוק לצמיתות ${items.length} פריטים? הפעולה אינה הפיכה.`,
            () => window.purgeEntireTrash(true)
        );
        return;
    }
    (async () => {
        for (const item of items) {
            // purgeTrashItem מבקש אישור משלו, ולכן נשלח לו אישור מראש.
            await window.purgeTrashItem?.(item.id, true);
        }
        window.renderTrashItems();
        window.showNotification('סל המחזור רוקן.', true);
    })().catch(error => window.showNotification(error.message || 'ריקון סל המחזור נכשל.', false));
}
window.purgeEntireTrash = purgeEntireTrash;
