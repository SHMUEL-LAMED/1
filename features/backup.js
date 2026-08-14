// גיבוי הגלריה: ייצוא, תצוגה מקדימה ושחזור
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { checkSuperAdminPermission } from '../core/permissions.js';
import { safeRecordId } from '../core/utils.js';
import { showConfirm } from '../ui/modals.js';

let selectedBackupPayload = null;

window.exportGalleryBackup = function() {
    if (!checkSuperAdminPermission()) return;
    const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        appId: window.appId,
        folders: (window.state.folders || []).filter(folder => safeRecordId(folder.id) !== 'all'),
        images: window.state.images || [],
        pendingImages: window.state.pendingImages || [],
        userProfiles: window.state.allUsers || [],
        deletionRequests: window.state.deletionRequests || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `simchas-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    window.showNotification('קובץ הגיבוי הורד בהצלחה.', true);
};

window.previewBackupFile = async function(input) {
    selectedBackupPayload = null;
    const status = document.getElementById('backupRestoreStatus');
    const submit = document.getElementById('backupRestoreSubmit');
    try {
        const file = input?.files?.[0];
        if (!file || file.size > 20 * 1024 * 1024) throw new Error('יש לבחור קובץ JSON תקין בגודל עד 20MB.');
        const payload = JSON.parse(await file.text());
        if (!Number.isFinite(payload.version) || !Array.isArray(payload.folders) || !Array.isArray(payload.images)) {
            throw new Error('מבנה קובץ הגיבוי אינו תקין.');
        }
        selectedBackupPayload = payload;
        if (status) status.textContent = `מוכן לשחזור: ${payload.folders.length} תיקיות ו־${payload.images.length} פריטי מדיה.`;
        if (submit) submit.disabled = false;
    } catch (error) {
        if (status) status.textContent = error.message || 'קריאת קובץ הגיבוי נכשלה.';
        if (submit) submit.disabled = true;
    }
};

window.restoreGalleryBackup = function(confirmed = false) {
    if (!checkSuperAdminPermission() || !selectedBackupPayload) return;
    if (!confirmed) {
        showConfirm('שחזור גיבוי', 'לשחזר את כל הנתונים שבקובץ? נתונים בעלי אותו מזהה יעודכנו, אך קבצים קיימים אחרים לא יימחקו.', () => window.restoreGalleryBackup(true));
        return;
    }
    (async () => {
        const status = document.getElementById('backupRestoreStatus');
        const { doc, setDoc } = window.firestoreModules;
        const base = ['artifacts', window.appId, 'public', 'data'];
        const collections = [
            ['folders', selectedBackupPayload.folders || [], 'id', false],
            ['images', selectedBackupPayload.images || [], 'id', false],
            ['pendingImages', selectedBackupPayload.pendingImages || [], 'id', false],
            ['userProfiles', selectedBackupPayload.userProfiles || [], 'uid', true],
            ['deletionRequests', selectedBackupPayload.deletionRequests || [], 'id', false]
        ];
        let restored = 0;
        for (const [collectionName, records, idField, merge] of collections) {
            for (const record of records.slice(0, 10000)) {
                const id = safeRecordId(record?.[idField]);
                if (!id || (collectionName === 'folders' && id === 'all')) continue;
                await setDoc(doc(window.db, ...base, collectionName, id), record, merge ? { merge: true } : undefined);
                restored++;
                if (status) status.textContent = `משחזר נתונים… ${restored} פריטים הושלמו`;
            }
        }
        if (status) status.textContent = `השחזור הושלם בהצלחה: ${restored} רשומות.`;
        await window.logActivity('restored_backup', 'system', '', 'גיבוי גלריה', `${restored} רשומות`);
        window.showNotification('שחזור הגיבוי הושלם.', true);
    })().catch(error => {
        document.getElementById('backupRestoreStatus').textContent = error.message || 'שחזור הגיבוי נכשל.';
        window.showNotification(error.message || 'שחזור הגיבוי נכשל.', false);
    });
};
