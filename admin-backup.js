// admin-backup.js — מסך "גיבוי ושחזור" בלוח הניהול: ייצוא נתוני הגלריה לקובץ
// JSON, בדיקת קובץ גיבוי שנבחר ושחזור ממנו (מנהל־על בלבד).
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (checkSuperAdminPermission, safeRecordId, showConfirm)
// נקראים מ-window בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא
// ישבור אותם.

// קובץ הגיבוי שנבחר ונבדק (previewBackupFile); restoreGalleryBackup משחזר ממנו.
let selectedBackupPayload = null;

export function exportGalleryBackup() {
    const { checkSuperAdminPermission, safeRecordId } = window;
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
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(link.href);
    }, 100);
    window.showNotification('קובץ הגיבוי הורד בהצלחה.', true);
}
window.exportGalleryBackup = exportGalleryBackup;

export async function previewBackupFile(input) {
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
}
window.previewBackupFile = previewBackupFile;

// סדר שחזור התיקיות: כל תיקייה אחרי ההורה שלה. הורה שאינו בגיבוי ואינו
// בגלריה — התיקייה חוזרת כעליונה. מעגל (נתונים פגומים) נשבר באותה דרך.
export function orderFoldersForRestore(folders) {
    const { safeRecordId } = window;
    const list = (Array.isArray(folders) ? folders : []).filter(folder => folder && typeof folder === 'object');
    const inBackup = new Set(list.map(folder => safeRecordId(folder.id)));
    const existing = new Set((window.state.folders || []).map(folder => safeRecordId(folder.id)));
    const placed = new Set();
    const ordered = [];
    let pending = list;
    while (pending.length) {
        const next = [];
        for (const folder of pending) {
            const parent = safeRecordId(folder.parentId);
            if (!parent || placed.has(parent) || (!inBackup.has(parent) && existing.has(parent))) {
                ordered.push(folder);
                placed.add(safeRecordId(folder.id));
            } else if (!inBackup.has(parent)) {
                ordered.push({ ...folder, parentId: null });
                placed.add(safeRecordId(folder.id));
            } else {
                next.push(folder);
            }
        }
        if (next.length === pending.length) {
            for (const folder of next) ordered.push({ ...folder, parentId: null });
            break;
        }
        pending = next;
    }
    return ordered;
}

export function restoreGalleryBackup(confirmed = false) {
    const { checkSuperAdminPermission, safeRecordId, showConfirm } = window;
    if (!checkSuperAdminPermission() || !selectedBackupPayload) return;
    if (!confirmed) {
        showConfirm('שחזור גיבוי', 'לשחזר את כל הנתונים שבקובץ? נתונים בעלי אותו מזהה יעודכנו, אך קבצים קיימים אחרים לא יימחקו.', () => window.restoreGalleryBackup(true));
        return;
    }
    (async () => {
        const status = document.getElementById('backupRestoreStatus');
        const { doc, setDoc } = window.firestoreModules;
        const base = ['artifacts', window.appId, 'public', 'data'];
        // תיקיות: ההורים לפני הילדים (ה-Worker דוחה הורה שעוד לא קיים), ובלי
        // תמונת השער — היא נקבעת בסבב שני, אחרי שהתמונות עצמן שוחזרו.
        const backupFolders = orderFoldersForRestore(selectedBackupPayload.folders || []);
        const covers = backupFolders.filter(folder => safeRecordId(folder?.coverImageId));
        const collections = [
            ['folders', backupFolders.map(folder => {
                if (!folder || typeof folder !== 'object' || folder.coverImageId === undefined) return folder;
                const { coverImageId, ...rest } = folder;
                return rest;
            }), 'id', false],
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
        for (const folder of covers) {
            const id = safeRecordId(folder.id);
            if (!id || id === 'all') continue;
            try {
                await setDoc(doc(window.db, ...base, 'folders', id), { coverImageId: folder.coverImageId }, { merge: true });
            } catch (error) {
                // תמונה שאינה בגיבוי: התיקייה נשארת עם הסמל, כמו היום.
                console.warn('Folder cover restore skipped:', id, error);
            }
        }
        if (status) status.textContent = `השחזור הושלם בהצלחה: ${restored} רשומות.`;
        await window.logActivity('restored_backup', 'system', '', 'גיבוי גלריה', `${restored} רשומות`);
        window.showNotification('שחזור הגיבוי הושלם.', true);
    })().catch(error => {
        const status = document.getElementById('backupRestoreStatus');
        if (status) status.textContent = error.message || 'שחזור הגיבוי נכשל.';
        window.showNotification(error.message || 'שחזור הגיבוי נכשל.', false);
    });
}
window.restoreGalleryBackup = restoreGalleryBackup;
