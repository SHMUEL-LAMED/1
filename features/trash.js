// סל המחזור: העברה, שחזור, מחיקה סופית והצגה
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { checkSuperAdminPermission } from '../core/permissions.js';
import { formatDate, safeRecordId } from '../core/utils.js';
import { showConfirm } from '../ui/modals.js';

const trashCollectionByType = {
    image: 'images',
    pendingImage: 'pendingImages',
    folder: 'folders',
    user: 'userProfiles'
};

window.moveRecordToTrash = async function(type, record, options = {}) {
    if (!checkSuperAdminPermission()) return;
    const collectionName = trashCollectionByType[type];
    const originalId = safeRecordId(type === 'user' ? record?.uid : record?.id);
    if (!collectionName || !originalId || !record) throw new Error('הפריט למחיקה אינו תקין.');

    const { doc, setDoc, deleteDoc } = window.firestoreModules;
    const trashId = safeRecordId(options.trashId) || `trash_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const trashRecord = {
        id: trashId,
        originalType: type,
        originalId,
        originalCollection: collectionName,
        targetName: String(options.targetName || record.title || record.name || record.displayName || record.email || 'פריט').slice(0, 160),
        record,
        relatedImageIds: Array.isArray(options.relatedImageIds) ? options.relatedImageIds.map(safeRecordId).filter(Boolean) : [],
        relatedTrashIds: Array.isArray(options.relatedTrashIds) ? options.relatedTrashIds.map(safeRecordId).filter(Boolean) : [],
        parentTrashGroupId: safeRecordId(options.parentTrashGroupId),
        deletedAt: Date.now(),
        deletedBy: window.state.currentUser?.uid || '',
        deletedByName: window.state.currentUser?.displayName || window.state.currentUser?.email || 'מנהל־על'
    };

    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', trashId), trashRecord);
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', collectionName, originalId));
    window.state.trashItems = [trashRecord, ...(window.state.trashItems || [])];
    // Update local state immediately so the UI reflects the deletion without waiting for the next snapshot
    if (type === 'image') {
        window.state.images = (window.state.images || []).filter(item => safeRecordId(item.id) !== originalId);
        window.renderImages();
        window.renderFolders();
    } else if (type === 'pendingImage') {
        window.state.pendingImages = (window.state.pendingImages || []).filter(item => safeRecordId(item.id) !== originalId);
        window.renderPendingImages?.();
        window.updatePendingBadge?.();
    } else if (type === 'folder') {
        window.state.folders = (window.state.folders || []).filter(item => safeRecordId(item.id) !== originalId);
        if (window.state.activeFolderId === originalId) window.state.activeFolderId = 'all';
        window.renderFolders();
        window.renderImages();
    }
    window.renderTrashItems?.();
    await window.logActivity('moved_to_trash', type, originalId, trashRecord.targetName);
    return trashRecord;
};

window.moveImageToTrash = async function(id) {
    const image = (window.state.images || []).find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!image) throw new Error('התמונה לא נמצאה.');
    await window.moveRecordToTrash('image', image);
};

window.movePendingImageToTrash = async function(id) {
    const image = (window.state.pendingImages || []).find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!image) throw new Error('התמונה הממתינה לא נמצאה.');
    await window.moveRecordToTrash('pendingImage', image);
};

window.moveFolderToTrash = async function(id) {
    const folderId = safeRecordId(id);
    const folder = (window.state.folders || []).find(item => safeRecordId(item.id) === folderId);
    if (!folder) throw new Error('התיקייה לא נמצאה.');
    const relatedImages = (window.state.images || []).filter(image => safeRecordId(image.folderId) === folderId);
    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'gallery'), {
        foldersInitialized: true,
        updatedAt: Date.now()
    }, { merge: true });
    const folderTrashId = `trash_folder_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const relatedTrashItems = [];
    for (const image of relatedImages) {
        const trashItem = await window.moveRecordToTrash('image', image, { parentTrashGroupId: folderTrashId });
        if (trashItem) relatedTrashItems.push(trashItem);
    }
    await window.moveRecordToTrash('folder', folder, {
        trashId: folderTrashId,
        relatedImageIds: relatedImages.map(image => image.id),
        relatedTrashIds: relatedTrashItems.map(item => item.id)
    });
    if (window.state.activeFolderId === folderId) window.state.activeFolderId = 'all';
};

window.moveUserToTrash = async function(uid) {
    const profile = (window.state.allUsers || []).find(user => safeRecordId(user.uid) === safeRecordId(uid));
    if (!profile) throw new Error('המשתמש לא נמצא.');
    await window.moveRecordToTrash('user', profile);
};

window.restoreTrashItem = async function(trashId, confirmed = false) {
    if (!checkSuperAdminPermission()) return;
    const item = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(trashId));
    if (!item) return;
    if (!confirmed) {
        showConfirm('שחזור פריט', `לשחזר את "${item.targetName || 'הפריט'}" למקום המקורי?`, () => window.restoreTrashItem(trashId, true));
        return;
    }
    const collectionName = trashCollectionByType[item.originalType];
    if (!collectionName || !item.record) throw new Error('נתוני השחזור אינם תקינים.');
    const { doc, setDoc, deleteDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', collectionName, safeRecordId(item.originalId)), item.record);
    if (item.originalType === 'folder' && Array.isArray(item.relatedTrashIds)) {
        for (const childTrashId of item.relatedTrashIds) {
            const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
            if (!child?.record) continue;
            await setDoc(
                doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', safeRecordId(child.originalId)),
                { ...child.record, folderId: item.originalId }
            );
            await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(child.id)));
        }
    }
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(item.id)));
    window.state.trashItems = (window.state.trashItems || []).filter(entry => entry.id !== item.id);
    // Update local state immediately so restored items appear without waiting for the next snapshot
    if (item.originalType === 'image' && item.record) {
        if (!(window.state.images || []).some(img => safeRecordId(img.id) === safeRecordId(item.originalId))) {
            window.state.images = [item.record, ...(window.state.images || [])];
            window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        window.renderImages();
        window.renderFolders();
    } else if (item.originalType === 'folder' && item.record) {
        if (!(window.state.folders || []).some(f => safeRecordId(f.id) === safeRecordId(item.originalId))) {
            window.state.folders = [...(window.state.folders || []), item.record];
        }
        // Restore related images
        if (Array.isArray(item.relatedTrashIds)) {
            for (const childTrashId of item.relatedTrashIds) {
                const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
                if (child?.record && !(window.state.images || []).some(img => safeRecordId(img.id) === safeRecordId(child.originalId))) {
                    window.state.images = [{ ...child.record, folderId: item.originalId }, ...(window.state.images || [])];
                }
            }
            window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            window.state.trashItems = (window.state.trashItems || []).filter(entry => !item.relatedTrashIds.includes(entry.id));
        }
        window.renderFolders();
        window.renderImages();
    }
    window.renderTrashItems();
    await window.logActivity('restored', item.originalType, item.originalId, item.targetName);
    window.showNotification('הפריט שוחזר בהצלחה.');
};

window.purgeTrashItem = async function(trashId, confirmed = false) {
    if (!checkSuperAdminPermission()) return;
    const item = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(trashId));
    if (!item) return;
    if (!confirmed) {
        showConfirm('מחיקה סופית', `למחוק לצמיתות את "${item.targetName || 'הפריט'}"? לאחר מכן לא יהיה אפשר לשחזר.`, () => window.purgeTrashItem(trashId, true));
        return;
    }
    try {
        if (['image', 'pendingImage'].includes(item.originalType) && item.record?.r2Key) {
            await window.deleteImageFromR2(item.record);
        }
        const { doc, deleteDoc } = window.firestoreModules;
        const purgedChildIds = new Set();
        if (item.originalType === 'folder' && Array.isArray(item.relatedTrashIds)) {
            for (const childTrashId of item.relatedTrashIds) {
                const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
                if (child?.record?.r2Key) await window.deleteImageFromR2(child.record);
                await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(childTrashId)));
                purgedChildIds.add(safeRecordId(childTrashId));
            }
        }
        await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(item.id)));
        window.state.trashItems = (window.state.trashItems || []).filter(entry =>
            entry.id !== item.id && !purgedChildIds.has(safeRecordId(entry.id))
        );
        window.renderTrashItems();
        await window.logActivity('purged', item.originalType, item.originalId, item.targetName);
        window.showNotification('הפריט נמחק לצמיתות.');
    } catch (error) {
        console.error('purgeTrashItem failed:', error);
        window.showNotification('מחיקה לצמיתות נכשלה.', false);
    }
};

window.renderTrashItems = function() {
    const list = document.getElementById('trashItemsList');
    const badge = document.getElementById('trashItemsCountBadge');
    const allItems = window.state.trashItems || [];
    const items = allItems.filter(item => !item.parentTrashGroupId);
    if (badge) badge.textContent = String(items.length);
    if (!list) return;
    list.innerHTML = '';
    if (!items.length) {
        list.innerHTML = '<p class="text-xs text-center text-slate-500 py-6">סל המחזור ריק.</p>';
        return;
    }
    const typeLabels = { image: 'תמונה', pendingImage: 'תמונה ממתינה', folder: 'תיקייה', user: 'משתמש' };
    items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'rounded-xl border border-orange-400/15 bg-orange-400/5 p-3 space-y-2';
        const title = document.createElement('p');
        title.className = 'text-[11px] font-bold text-slate-100';
        title.textContent = `${typeLabels[item.originalType] || 'פריט'} — ${item.targetName || item.originalId}`;
        const meta = document.createElement('p');
        meta.className = 'text-[9px] text-slate-400';
        meta.textContent = `${formatDate(item.deletedAt)} · נמחק על ידי ${item.deletedByName || 'מנהל־על'}`;
        const actions = document.createElement('div');
        actions.className = 'grid grid-cols-2 gap-2';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-bold';
        restore.textContent = 'שחזר';
        restore.onclick = () => window.restoreTrashItem(item.id);
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'py-2 rounded-lg border border-red-500/30 text-red-300 text-[10px] font-bold';
        purge.textContent = 'מחק לצמיתות';
        purge.onclick = () => window.purgeTrashItem(item.id);
        actions.append(restore, purge);
        card.append(title, meta, actions);
        list.appendChild(card);
    });
};
