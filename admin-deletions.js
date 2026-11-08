// admin-deletions.js — בקשות מחיקה: מנהל דרגה 3 מבקש, מנהל־על מכריע.
//
// פוצל מ-admin.js כדי שכל קובץ יעסוק בעניין אחד. המודול אינו נוגע ב-DOM
// בזמן הטעינה ואינו רושם דבר על window: admin.js מייבא אותו ורושם את
// הפונקציות בשמותיהן הקיימים (window.requestContentDeletion וכו׳).
// עזרי window (showConfirm, moveImageToTrash…) נקראים בזמן הקריאה.

export async function requestContentDeletion(targetType, targetId, targetName) {
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
}

export function renderDeletionRequests() {
    const list = document.getElementById('deletionRequestsList');
    const badge = document.getElementById('deletionRequestsCountBadge');
    // בקשות מחיקה — מנהל־על בלבד. המונה מתאפס כדי שלא יישאר ערך ישן.
    if (!window.canViewSuperAdminData?.()) {
        if (badge) badge.textContent = '0';
        if (list) list.innerHTML = '';
        return;
    }
    if (badge) badge.textContent = String((window.state.deletionRequests || []).length);
    if (!list) return;
    list.innerHTML = '';
    const requests = window.state.deletionRequests || [];
    if (requests.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'אין בקשות מחיקה ממתינות.';
        list.appendChild(empty);
        return;
    }
    const typeLabels = { image: 'תמונה', folder: 'תיקייה', pendingImage: 'תמונה ממתינה' };
    requests.forEach(request => {
        const card = document.createElement('div');
        card.className = 'admin-row flex-col items-stretch gap-2';
        const title = document.createElement('p');
        title.className = 'admin-row-title';
        title.textContent = `${typeLabels[request.targetType] || 'פריט'}: ${request.targetName || request.targetId}`;
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        meta.textContent = `נשלח על ידי ${request.requestedByName || request.requestedByEmail || 'מנהל דרגה 3'}`;
        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'btn-danger-soft flex-1 py-2 text-[11px]';
        approve.textContent = 'אישור המחיקה';
        approve.onclick = () => window.showConfirm('אישור מחיקה', 'האם לבצע את המחיקה לצמיתות?', () => window.resolveDeletionRequest(request.id, true));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'btn-secondary-dark flex-1 py-2 text-[11px]';
        reject.textContent = 'דחיית הבקשה';
        reject.onclick = () => window.resolveDeletionRequest(request.id, false);
        actions.append(approve, reject);
        card.append(title, meta, actions);
        list.appendChild(card);
    });
}

export async function resolveDeletionRequest(requestId, approved) {
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
}
