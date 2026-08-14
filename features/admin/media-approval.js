// אישור ודחייה של מדיה ובקשות מחיקה
// פוצל מתוך admin.js. הקוד עצמו לא שונה — רק מיקומו.


window.requestContentDeletion = async function(targetType, targetId, targetName) {
    if (!window.checkAdminPermission()) return;
    if (window.state.isSuperAdmin) throw new Error('מנהל־על יכול לבצע את המחיקה ישירות.');
    const allowedTypes = ['image', 'folder', 'pendingImage'];
    const safeTargetId = window.safeRecordId(targetId);
    if (!allowedTypes.includes(targetType) || !safeTargetId) throw new Error('בקשת המחיקה אינה תקינה.');
    const duplicate = (window.state.deletionRequests || []).some(request =>
        request.status === 'pending' && request.targetType === targetType && window.safeRecordId(request.targetId) === safeTargetId
    );
    if (duplicate) throw new Error('כבר קיימת בקשת מחיקה ממתינה עבור פריט זה.');

    const requestId = `delete_${crypto.randomUUID()}`;
    const { doc, setDoc } = window.firestoreModules;
    const newRequest = {
        id: requestId,
        targetType,
        targetId: safeTargetId,
        targetName: String(targetName || 'פריט').slice(0, 120),
        status: 'pending',
        requestedAt: Date.now(),
        requestedBy: window.state.currentUser?.uid || '',
        requestedByName: window.state.currentUser?.displayName || '',
        requestedByEmail: window.state.currentUser?.email || ''
    };
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'deletionRequests', requestId), newRequest);
    window.state.deletionRequests = [newRequest, ...(window.state.deletionRequests || [])];
};

window.renderDeletionRequests = function() {
    const list = document.getElementById('deletionRequestsList');
    const badge = document.getElementById('deletionRequestsCountBadge');
    if (badge) badge.textContent = String((window.state.deletionRequests || []).length);
    if (!list) return;
    list.innerHTML = '';
    const requests = window.state.deletionRequests || [];
    if (requests.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין בקשות מחיקה ממתינות.';
        list.appendChild(empty);
        return;
    }
    const typeLabels = { image: 'תמונה', folder: 'תיקייה', pendingImage: 'תמונה ממתינה' };
    requests.forEach(request => {
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-red-500/15 bg-red-500/5 p-3 space-y-2';
        const title = document.createElement('p');
        title.className = 'text-[11px] font-bold text-slate-100';
        title.textContent = `${typeLabels[request.targetType] || 'פריט'}: ${request.targetName || request.targetId}`;
        const meta = document.createElement('p');
        meta.className = 'text-[9px] text-slate-400';
        meta.textContent = `נשלח על ידי ${request.requestedByName || request.requestedByEmail || 'מנהל דרגה 3'}`;
        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'flex-1 py-2 rounded-lg bg-red-600 text-white text-[10px] font-bold';
        approve.textContent = 'אשר מחיקה';
        approve.onclick = () => window.showConfirm('אישור מחיקה', 'האם לבצע את המחיקה לצמיתות?', () => window.resolveDeletionRequest(request.id, true));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'flex-1 py-2 rounded-lg border border-slate-600 text-slate-300 text-[10px] font-bold';
        reject.textContent = 'דחה בקשה';
        reject.onclick = () => window.resolveDeletionRequest(request.id, false);
        actions.append(approve, reject);
        card.append(title, meta, actions);
        list.appendChild(card);
    });
};

window.resolveDeletionRequest = async function(requestId, approved) {
    if (!window.checkSuperAdminPermission()) return;
    const request = (window.state.deletionRequests || []).find(item => item.id === requestId);
    if (!request) return;
    try {
        if (approved) {
            if (request.targetType === 'image') {
                await window.moveImageToTrash(request.targetId);
            } else if (request.targetType === 'pendingImage') {
                await window.movePendingImageToTrash(request.targetId);
            } else if (request.targetType === 'folder') {
                await window.moveFolderToTrash(request.targetId);
            }
        }
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'deletionRequests', requestId), {
            status: approved ? 'approved' : 'rejected',
            resolvedAt: Date.now(),
            resolvedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        window.state.deletionRequests = (window.state.deletionRequests || []).filter(item => item.id !== requestId);
        window.renderDeletionRequests?.();
        window.showNotification(approved ? 'בקשת המחיקה אושרה והפריט הועבר לסל המחזור.' : 'בקשת המחיקה נדחתה.');
    } catch (error) {
        console.error('resolveDeletionRequest failed:', error);
        window.showNotification('הטיפול בבקשה נכשל.', false);
    }
};

window.renderPendingImages = function() {
    const list = document.getElementById('pendingList'); if (!list) return;
    const pending = window.state.pendingImages || [];
    if (pending.length === 0) { list.innerHTML = '<p class="text-xs text-center text-slate-500 py-4">אין קבצי מדיה ממתינים לאישור.</p>'; return; }
    const parts = [];
    pending.forEach(img => {
        const imageId = window.safeRecordId(img.id);
        if (!imageId) return;
        const imageUrl = window.safeImageUrl(img.url);
        const isVideo = window.isVideoRecord(img);
        const preview = isVideo
            ? '<span class="w-10 h-10 shrink-0 rounded-lg border border-slate-200 bg-slate-900 text-white flex items-center justify-center"><i data-lucide="video" class="w-4 h-4"></i></span>'
            : `<img src="${window.escapeHtml(imageUrl)}" loading="lazy" decoding="async" alt="" class="w-10 h-10 object-cover rounded-lg border border-slate-200" onerror="window.handleImageError(this)">`;
        parts.push(`
            <label class="flex items-center gap-3 p-2 hover:bg-amber-100/50 border border-amber-100 rounded-xl cursor-pointer transition-all bg-white shadow-sm">
                <input type="checkbox" name="pendingImgCheck" value="${imageId}" class="rounded text-amber-500 focus:ring-amber-500 bg-white border-slate-200" checked>
                ${preview}
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] font-bold text-slate-800 truncate">${window.escapeHtml(img.title)}</p>
                    <p class="text-[9px] text-slate-500 truncate">${isVideo ? 'סרטון' : 'תמונה'} · תיקייה מקורית: ${window.escapeHtml(img.originalFolderName)}</p>
                </div>
            </label>`);
    });
    list.innerHTML = parts.join('');
    window.scheduleIconRefresh(list);
};

window.updatePendingBadge = function() {
    const badge = document.getElementById('pendingCountBadge');
    if (badge) badge.innerText = (window.state.pendingImages || []).length;
    window.updateAdminOverview();
};

function toggleSelectAllPending() {
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]');
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = anyUnchecked);
}

async function approveSelectedPending(confirmed = false) {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) { window.showNotification('לא נבחרו תמונות לאישור', false); return; }
    const targetFolderEl = document.getElementById('pendingTargetFolder');
    const targetFolderId = targetFolderEl ? targetFolderEl.value : 'auto';
    if (!confirmed) {
        window.showConfirm(
            'אישור תמונות',
            `לאשר ${checkboxes.length} תמונות ולהעביר אותן לגלריה הפעילה?`,
            () => approveSelectedPending(true)
        );
        return;
    }
    let approvedCount = 0;
    let failedCount = 0;

    const approvedIds = new Set();
    for(let cb of checkboxes) {
        const img = window.state.pendingImages.find(i => i.id === cb.value);
        if (img) {
            try {
                let finalFolderId = targetFolderId;
                if (targetFolderId === 'auto') {
                    const fName = img.originalFolderName || 'כללי'; let existing = window.state.folders.find(f => f.name === fName);
                    if (!existing) {
                        existing = { id: 'folder_' + crypto.randomUUID(), name: fName, icon: 'folder', isDefault: false };
                        await window.saveFolderToCloud(existing);
                    }
                    finalFolderId = existing.id;
                }
                const activeImage = await window.approveImageInR2({
                    ...img,
                    folderId: finalFolderId,
                    createdAt: Date.now(),
                    status: 'active'
                });
                await window.saveImageToCloud(activeImage);
                // שומרים תיעוד של האישור במקום למחוק, כדי שמנהל דרגה 3 לא יקבל הרשאת מחיקה עקיפה.
                const { doc, setDoc } = window.firestoreModules;
                await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', img.id), {
                    status: 'approved',
                    approvedAt: Date.now(),
                    approvedBy: window.state.currentUser?.uid || ''
                }, { merge: true });
                approvedIds.add(window.safeRecordId(img.id));
                approvedCount++;
            } catch (error) {
                failedCount++;
                console.warn('Approve pending image failed:', window.safeRecordId(img.id), error);
            }
        }
    }
    // Remove approved items from local pendingImages state immediately
    if (approvedIds.size) {
        window.state.pendingImages = (window.state.pendingImages || []).filter(img => !approvedIds.has(window.safeRecordId(img.id)));
        window.renderPendingImages?.();
        window.updatePendingBadge?.();
    }
    if (approvedCount) await window.logActivity('approved_images', 'image', '', `${approvedCount} תמונות`);
    window.showNotification(
        failedCount
            ? `אושרו ${approvedCount} תמונות; ${failedCount} נכשלו.`
            : `אושרו ${approvedCount} תמונות בהצלחה לענן!`,
        !failedCount
    );
}

function rejectSelectedPending() {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) return;
    if (!window.state.isSuperAdmin) {
        window.showConfirm('שליחת בקשת מחיקה', 'לשלוח למנהל־העל בקשת מחיקה עבור התמונות שנבחרו?', async () => {
            try {
                await Promise.all(Array.from(checkboxes, cb => {
                    const image = window.state.pendingImages.find(item => window.safeRecordId(item.id) === window.safeRecordId(cb.value));
                    return window.requestContentDeletion('pendingImage', cb.value, image?.title || 'תמונה ממתינה');
                }));
                window.showNotification('בקשות המחיקה נשלחו למנהל־העל.');
            } catch (error) {
                console.error('requestContentDeletion failed:', error);
                window.showNotification(error.message || 'שליחת הבקשה נכשלה.', false);
            }
        });
        return;
    }
    window.showConfirm('דחיית תמונות', 'להעביר את התמונות הממתינות לסל המחזור?', async () => {
        try {
            await Promise.all(Array.from(checkboxes, cb => window.movePendingImageToTrash(cb.value)));
            window.showNotification('התמונות הועברו לסל המחזור.');
        } catch (error) {
            console.error('movePendingImageToTrash failed:', error);
            window.showNotification('העברה לסל המחזור נכשלה.', false);
        }
    });
}

window.approveSelectedPending = approveSelectedPending;

window.rejectSelectedPending = rejectSelectedPending;

window.toggleSelectAllPending = toggleSelectAllPending;
