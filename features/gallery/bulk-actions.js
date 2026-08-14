// בחירה מרובה: סימון, העברה בין תיקיות ומחיקה
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.

import { getFilteredSortedImages } from './media-grid.js';

function updateBulkSelectionBar() {
    const bar = document.getElementById('bulkSelectionBar');
    const count = document.getElementById('bulkSelectedCount');
    if (count) count.textContent = String(window.state.selectedMediaIds.size);
    if (bar) {
        bar.classList.toggle('hidden', !window.state.bulkSelectionMode);
        bar.classList.toggle('flex', window.state.bulkSelectionMode);
    }
}

window.toggleBulkSelectionMode = function(forceState) {
    if (!window.state.isAdminLoggedIn) return;
    window.state.bulkSelectionMode = typeof forceState === 'boolean' ? forceState : !window.state.bulkSelectionMode;
    if (!window.state.bulkSelectionMode) window.state.selectedMediaIds.clear();
    updateBulkSelectionBar();
    window.renderImages();
};

window.toggleMediaSelection = function(event, mediaId) {
    event?.preventDefault();
    event?.stopPropagation();
    const id = window.safeRecordId(mediaId);
    if (!window.state.bulkSelectionMode || !id) return;
    if (window.state.selectedMediaIds.has(id)) window.state.selectedMediaIds.delete(id);
    else window.state.selectedMediaIds.add(id);
    updateBulkSelectionBar();
    window.renderImages();
};

window.toggleSelectAllVisibleMedia = function() {
    if (!window.state.bulkSelectionMode) return;
    const visibleIds = getFilteredSortedImages().map(item => window.safeRecordId(item.id)).filter(Boolean);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => window.state.selectedMediaIds.has(id));
    visibleIds.forEach(id => allSelected ? window.state.selectedMediaIds.delete(id) : window.state.selectedMediaIds.add(id));
    updateBulkSelectionBar();
    window.renderImages();
};

window.openBulkMoveDialog = function() {
    if (!window.state.isAdminLoggedIn || window.state.selectedMediaIds.size === 0) {
        window.showNotification('לא נבחרו פריטים להעברה.', false);
        return;
    }
    const select = document.getElementById('moveFolderSelect');
    const submit = document.getElementById('moveFolderSubmitBtn');
    if (!select || !submit) return;
    select.replaceChildren();
    window.state.folders.filter(folder => folder.id !== 'all').forEach(folder => {
        const option = document.createElement('option');
        option.value = window.safeRecordId(folder.id);
        option.textContent = folder.name;
        select.appendChild(option);
    });
    submit.onclick = () => {
        const targetFolderId = window.safeRecordId(select.value);
        const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
        window.showConfirm('העברת פריטים', `להעביר ${selected.length} פריטים לתיקייה שנבחרה?`, async () => {
            let movedCount = 0;
            let failedCount = 0;
            for (const item of selected) {
                try {
                    await window.saveImageToCloud({ ...item, folderId: targetFolderId });
                    movedCount++;
                } catch (err) {
                    failedCount++;
                    console.warn('Bulk move failed for item:', window.safeRecordId(item.id), err);
                }
            }
            window.closeModal('moveFolderModal');
            window.state.selectedMediaIds.clear();
            updateBulkSelectionBar();
            window.renderImages();
            window.showNotification(
                failedCount
                    ? `${movedCount} פריטים הועברו; ${failedCount} נכשלו.`
                    : `${movedCount} פריטים הועברו בהצלחה.`,
                !failedCount
            );
        });
    };
    window.openModal('moveFolderModal');
};

window.deleteSelectedMedia = function() {
    if (!window.state.isAdminLoggedIn || window.state.selectedMediaIds.size === 0) {
        window.showNotification('לא נבחרו פריטים למחיקה.', false);
        return;
    }
    const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    const title = window.state.isSuperAdmin ? 'העברת פריטים לסל' : 'שליחת בקשות מחיקה';
    const message = window.state.isSuperAdmin
        ? `להעביר ${selected.length} פריטים לסל המחזור?`
        : `לשלוח למנהל־העל ${selected.length} בקשות מחיקה?`;
    window.showConfirm(title, message, async () => {
        for (const item of selected) {
            if (window.state.isSuperAdmin) await window.moveImageToTrash(item.id);
            else await window.requestContentDeletion('image', item.id, item.title || 'קובץ מדיה');
        }
        window.state.selectedMediaIds.clear();
        updateBulkSelectionBar();
        window.renderImages();
        window.showNotification(window.state.isSuperAdmin ? 'הפריטים הועברו לסל.' : 'בקשות המחיקה נשלחו.');
    });
};
