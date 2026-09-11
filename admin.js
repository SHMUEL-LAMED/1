// admin.js — ממשק הניהול, משתמשים, דרגות והרשאות
// לוגיקת הצ׳אט הועברה ל-chat.js כדי לשמור על מודולים קטנים וברורים יותר.

// --- 3. Admin UI Update Routing ---
// ממשק המגירה: האזור האישי של משתמש רגיל ולוח הניהול. כל מה שכאן נוגע
// אך ורק למרקאפ שבתוך המגירה, ולכן הוא רשאי להיטען מאוחר — שער הגישה,
// הכותרת וכרטיס הפרופיל מצוירים כבר על ידי session-ui.js.
window.updateAdminPanelUI = function() {
    const statusBadge = document.getElementById('sidebarLockStatus');
    // המגירה עדיין לא בדף. אין מה לצייר, ושאר הממשק אינו תלוי בכך.
    if (!statusBadge) return;

    const userArea = document.getElementById('userActionArea');
    const adminPanel = document.getElementById('sidebarAdminPanel');
    const uploadCard = document.getElementById('userUploadAccessCard');
    const uploadTitle = document.getElementById('userUploadAccessTitle');
    const uploadText = document.getElementById('userUploadAccessText');
    const uploadModeText = document.getElementById('userUploadModeText');
    const uploadSubmitButton = document.getElementById('userUploadSubmitBtn');
    const superAdminChatsCard = document.getElementById('superAdminChatsCard');
    const superAdminUsersCard = document.getElementById('superAdminUsersCard');
    const superAdminDeletionRequestsCard = document.getElementById('superAdminDeletionRequestsCard');
    const superAdminOnlyElements = document.querySelectorAll('#sidebarAdminPanel .super-admin-only');
    const rejectPendingButton = document.getElementById('rejectPendingBtn');

    const currentUser = window.state.currentUser;
    const approvalStatus = window.state.userApprovalStatus;
    const role = window.state.userRole;

    if (userArea) userArea.classList.add('hidden');
    if (adminPanel) adminPanel.classList.add('hidden');
    if (uploadCard) uploadCard.classList.add('hidden');
    superAdminOnlyElements.forEach(element => element.classList.add('hidden'));
    if (superAdminChatsCard) superAdminChatsCard.classList.add('hidden');
    if (superAdminUsersCard) superAdminUsersCard.classList.add('hidden');
    if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.add('hidden');

    // כרטיס ההעלאה מוצג רק לחשבון מאושר שאינו מנהל: דרגה 2 מעלה ישירות,
    // ודרגה 1 שולחת לאישור. חשבון ממתין, נדחה או חסום אינו מעלה כלל.
    const signedInWithGoogle = Boolean(window.state.isGoogleUser && currentUser);
    const uploadModes = {
        uploader: {
            title: 'העלאה ישירה לגלריה',
            text: 'דרגה 2 מאפשרת להעלות תמונות ללא המתנה לאישור.',
            mode: 'התמונות יעלו ישירות לגלריה ללא אישור נוסף.',
            submit: 'העלה לגלריה'
        },
        viewer: {
            title: 'שליחת תמונות לאישור',
            text: 'דרגה 1 מאפשרת להעלות תמונות לאחר אישור מנהל.',
            mode: 'התמונות יישלחו לבדיקה ויופיעו בגלריה לאחר אישור מנהל.',
            submit: 'שלח לאישור'
        }
    };
    const blockedStatuses = ['pending', 'rejected', 'blocked'];
    const adminRoles = ['admin', 'super_admin'];
    if (signedInWithGoogle && !blockedStatuses.includes(approvalStatus) && !adminRoles.includes(role)) {
        const mode = uploadModes[role === 'uploader' ? 'uploader' : 'viewer'];
        if (uploadCard) uploadCard.classList.remove('hidden');
        if (uploadTitle) uploadTitle.textContent = mode.title;
        if (uploadText) uploadText.textContent = mode.text;
        if (uploadModeText) uploadModeText.textContent = mode.mode;
        if (uploadSubmitButton) uploadSubmitButton.textContent = mode.submit;
    }

    if (window.state.isAdminLoggedIn) {
        if (adminPanel) adminPanel.classList.remove('hidden');
        statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
        statusBadge.innerText = window.state.isSuperAdmin ? "ניהול־על פעיל" : "ניהול פעיל";
        const adminName = document.getElementById('adminCurrentUserName');
        const adminEmail = document.getElementById('adminCurrentUserEmail');
        const adminPhoto = document.getElementById('adminCurrentUserPhoto');
        const adminFallback = document.getElementById('adminCurrentUserFallback');
        const adminGrade = document.getElementById('adminCurrentUserGrade');
        if (adminName) adminName.textContent = currentUser?.displayName || 'מנהל המערכת';
        if (adminEmail) adminEmail.textContent = currentUser?.email || '';
        if (adminPhoto && adminFallback) {
            const adminPhotoUrl = window.safeImageUrl(currentUser?.photoURL);
            adminPhoto.classList.toggle('hidden', !adminPhotoUrl);
            adminFallback.classList.toggle('hidden', Boolean(adminPhotoUrl));
            if (adminPhotoUrl) adminPhoto.src = adminPhotoUrl;
        }
        if (adminGrade) {
            adminGrade.textContent = window.state.isSuperAdmin ? 'דרגה 4 — מנהל־על' : 'דרגה 3 — מנהל';
            adminGrade.className = window.state.isSuperAdmin
                ? 'text-[9px] px-2 py-1 rounded-full font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20'
                : 'text-[9px] px-2 py-1 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        }
        if (window.state.isSuperAdmin) {
            superAdminOnlyElements.forEach(element => element.classList.remove('hidden'));
            if (superAdminChatsCard) superAdminChatsCard.classList.remove('hidden');
            if (superAdminUsersCard) superAdminUsersCard.classList.remove('hidden');
            if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.remove('hidden');
        }
        if (rejectPendingButton) rejectPendingButton.textContent = window.state.isSuperAdmin ? 'מחק לצמיתות' : 'בקש מחיקה';
        window.renderPendingImages();
        window.updatePendingBadge();
        window.renderPendingUsers();
        window.updatePendingUsersBadge();
        window.renderManagedUsers();
        window.renderDeletionRequests();
    } else {
        if (userArea) userArea.classList.remove('hidden');
        if (window.state.isGoogleUser) {
            if (approvalStatus === 'approved' && role === 'uploader') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
                statusBadge.innerText = "הרשאת העלאה";
            } else if (approvalStatus === 'approved') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-white/5 text-slate-300 border border-white/10";
                statusBadge.innerText = "צופה מאושר";
            } else if (approvalStatus === 'blocked') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20";
                statusBadge.innerText = "חשבון חסום";
            } else if (approvalStatus === 'rejected') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20";
                statusBadge.innerText = "לא אושר";
            } else {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
                statusBadge.innerText = "ממתין לאישור";
            }
        } else {
            statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
            statusBadge.innerText = "מצב אורח";
        }
    }
    window.scheduleIconRefresh();
    if (window.state.isAdminLoggedIn) {
        window.setTimeout(() => window.maybeStartInitialFaceIndexing?.(), 1800);
    }
};

window.changeUserRole = async function(uid, role, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    const allowedRoles = ['viewer', 'uploader', 'admin', 'super_admin'];
    if (!allowedRoles.includes(role) || !uid || uid === window.state.currentUser?.uid) return;
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    const roleLabels = { viewer: 'דרגה 1', uploader: 'דרגה 2', admin: 'דרגה 3', super_admin: 'דרגה 4' };
    if (!confirmed) {
        window.showConfirm(
            'שינוי דרגת משתמש',
            `לשנות את הדרגה של ${profile?.displayName || profile?.email || 'המשתמש'} ל־${roleLabels[role]}?`,
            () => window.changeUserRole(uid, role, true)
        );
        return;
    }
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), {
            status: 'approved',
            role,
            roleChangedAt: Date.now(),
            roleChangedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        await window.logActivity('changed_role', 'user', uid, profile?.displayName || profile?.email || uid, `דרגה חדשה: ${role}`);
        if (profile) { profile.status = 'approved'; profile.role = role; }
        window.renderManagedUsers?.();
        window.showNotification('דרגת המשתמש עודכנה בהצלחה.');
    } catch (error) {
        console.error('changeUserRole failed:', error);
        window.showNotification('שינוי דרגת המשתמש נכשל.', false);
    }
};

window.toggleUserBlock = async function(uid, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    if (!uid || uid === window.state.currentUser?.uid) {
        window.showNotification('לא ניתן לחסום את חשבון מנהל־העל הפעיל.', false);
        return;
    }
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    if (!profile) return;
    const isBlocked = profile.status === 'blocked';
    if (!confirmed) {
        window.showConfirm(
            isBlocked ? 'הסרת חסימה' : 'חסימת משתמש',
            isBlocked
                ? `להחזיר ל־${profile.displayName || profile.email || 'המשתמש'} את הגישה לגלריה?`
                : `לחסום את ${profile.displayName || profile.email || 'המשתמש'}? הגישה שלו לגלריה תופסק.`,
            () => window.toggleUserBlock(uid, true)
        );
        return;
    }
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), isBlocked ? {
            status: 'approved',
            role: ['viewer', 'uploader', 'admin', 'super_admin'].includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : 'viewer',
            unblockedAt: Date.now(),
            unblockedBy: window.state.currentUser?.uid || ''
        } : {
            status: 'blocked',
            roleBeforeBlock: profile.role || 'viewer',
            blockedAt: Date.now(),
            blockedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        await window.logActivity('changed_block', 'user', uid, profile.displayName || profile.email || uid, isBlocked ? 'החסימה הוסרה' : 'המשתמש נחסם');
        if (isBlocked) {
            profile.status = 'approved';
            profile.role = ['viewer', 'uploader', 'admin', 'super_admin'].includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : 'viewer';
        } else {
            profile.roleBeforeBlock = profile.role || 'viewer';
            profile.status = 'blocked';
        }
        window.renderManagedUsers?.();
        window.showNotification(isBlocked ? 'חסימת המשתמש הוסרה.' : 'המשתמש נחסם.');
    } catch (error) {
        console.error('toggleUserBlock failed:', error);
        window.showNotification('שינוי סטטוס המשתמש נכשל.', false);
    }
};

window.deleteManagedUser = async function(uid, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    if (!uid || uid === window.state.currentUser?.uid) {
        window.showNotification('לא ניתן למחוק את חשבון מנהל־העל הפעיל.', false);
        return;
    }
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    if (!profile) return;
    if (!confirmed) {
        window.showConfirm(
            'מחיקת משתמש',
            `למחוק את ${profile.displayName || profile.email || 'המשתמש'} מרשימת המשתמשים? הפרופיל וכל ההודעות האישיות שלו יימחקו מהאתר.`,
            () => window.deleteManagedUser(uid, true)
        );
        return;
    }
    try {
        await window.moveUserToTrash(uid);
        adminMessageRecipients.delete(window.safeRecordId(uid));
        window.state.allUsers = (window.state.allUsers || []).filter(user => user.uid !== uid);
        window.state.pendingUsers = (window.state.pendingUsers || []).filter(user => user.uid !== uid);
        window.renderManagedUsers();
        window.renderPendingUsers();
        window.renderAdminMessageUsers?.();
        window.renderAdminMessageReplies?.();
        window.updatePendingUsersBadge();
        window.showNotification('המשתמש הועבר לסל המחזור.');
    } catch (error) {
        console.error('deleteManagedUser failed:', error);
        window.showNotification('מחיקת המשתמש נכשלה.', false);
    }
};

window.forceRefreshUsers = async function() {
    if (!window.db || !window.state.isSuperAdmin) return;
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snap = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles'));
        const allProfiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        window.state.allUsers = allProfiles.sort((a, b) =>
            String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || ''), 'he')
        );
        window.state.pendingUsers = allProfiles
            .filter(p => p.status === 'pending')
            .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
        window.renderManagedUsers?.();
        window.renderPendingUsers?.();
        window.renderAdminMessageUsers?.();
        window.updatePendingUsersBadge?.();
    } catch (e) {
        console.warn('forceRefreshUsers failed:', e);
        window.showNotification('טעינת רשימת המשתמשים נכשלה: ' + (e.message || ''), false);
    }
};

window.renderManagedUsers = function() {
    const list = document.getElementById('managedUsersList');
    if (!list) return;
    list.innerHTML = '';
    // רשימת המשתמשים והדרגות — מנהל־על בלבד.
    if (!window.canViewSuperAdminData?.()) return;
    const users = (window.state.allUsers || []).filter(profile => profile.status !== 'pending');
    if (users.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין משתמשים נוספים במערכת.';
        list.appendChild(empty);
        return;
    }

    const roleOptions = [
        ['viewer', 'דרגה 1 — העלאה באישור'],
        ['uploader', 'דרגה 2 — העלאה ישירה'],
        ['admin', 'דרגה 3 — מנהל'],
        ['super_admin', 'דרגה 4 — מנהל־על']
    ];
    users.forEach(profile => {
        const isCurrentUser = profile.uid === window.state.currentUser?.uid;
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-slate-200 bg-white/5 p-3 space-y-2';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';
        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[11px] font-bold text-slate-100 truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'text-[9px] text-slate-400 truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        const status = document.createElement('span');
        status.className = profile.status === 'blocked'
            ? 'text-[9px] px-2 py-1 rounded-full bg-red-500/10 text-red-300'
            : 'text-[9px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300';
        status.textContent = profile.status === 'blocked' ? 'חסום' : 'פעיל';
        header.append(identity, status);

        const controls = document.createElement('div');
        controls.className = 'flex gap-2';
        const roleSelect = document.createElement('select');
        roleSelect.className = 'flex-1 text-[10px] border border-slate-700 rounded-lg py-2 px-2 bg-slate-950 text-slate-100';
        roleOptions.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = (profile.status === 'blocked' ? profile.roleBeforeBlock : profile.role) === value;
            roleSelect.appendChild(option);
        });
        roleSelect.disabled = isCurrentUser || profile.status === 'blocked';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'px-3 rounded-lg bg-cyan-600 text-white text-[10px] font-bold disabled:opacity-40';
        save.textContent = 'שמור דרגה';
        save.disabled = isCurrentUser || profile.status === 'blocked';
        save.onclick = () => window.changeUserRole(profile.uid, roleSelect.value);

        const block = document.createElement('button');
        block.type = 'button';
        block.className = profile.status === 'blocked'
            ? 'px-3 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-bold'
            : 'px-3 rounded-lg border border-red-500/30 text-red-300 text-[10px] font-bold';
        block.textContent = profile.status === 'blocked' ? 'בטל חסימה' : 'חסום';
        block.disabled = isCurrentUser;
        block.onclick = () => window.toggleUserBlock(profile.uid);
        controls.append(roleSelect, save, block);

        const linkedActions = document.createElement('div');
        linkedActions.className = 'grid grid-cols-2 gap-2';
        const message = document.createElement('button');
        message.type = 'button';
        message.className = 'py-2 rounded-lg btn-primary-gold text-[10px] font-bold flex items-center justify-center gap-1.5';
        message.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i> שלח הודעה';
        message.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-red-300 text-[10px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40';
        remove.innerHTML = '<i data-lucide="user-x" class="w-3.5 h-3.5"></i> מחק משתמש';
        remove.disabled = isCurrentUser;
        remove.onclick = () => window.deleteManagedUser(profile.uid);
        linkedActions.append(message, remove);

        card.append(header, controls, linkedActions);
        list.appendChild(card);
    });
    window.scheduleIconRefresh();
};

window.renderDeletionRequests = function() {
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


window.renderPendingUsers = function() {
    const list = document.getElementById('pendingUsersList');
    if (!list) return;
    list.innerHTML = '';
    // בקשות הצטרפות — מנהל־על בלבד.
    if (!window.canViewSuperAdminData?.()) return;
    const pendingUsers = window.state.pendingUsers || [];

    if (pendingUsers.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין בקשות הצטרפות ממתינות.';
        list.appendChild(empty);
        return;
    }

    pendingUsers.forEach(profile => {
        const card = document.createElement('div');
        card.className = 'bg-white/5 border border-white/10 rounded-xl p-3 shadow-sm space-y-2.5';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2.5';

        const photoUrl = window.safeImageUrl(profile.photoURL);
        if (photoUrl) {
            const photo = document.createElement('img');
            photo.src = photoUrl;
            photo.alt = '';
            photo.className = 'w-9 h-9 rounded-full object-cover border border-slate-700';
            photo.onerror = () => window.handleImageError(photo);
            header.appendChild(photo);
        } else {
            const icon = document.createElement('div');
            icon.className = 'w-9 h-9 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/25';
            icon.innerHTML = '<i data-lucide="user" class="w-4 h-4"></i>';
            header.appendChild(icon);
        }

        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[11px] font-bold text-white truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'text-[9px] text-slate-400 truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        header.appendChild(identity);

        card.appendChild(header);

        // Show submitted details if available
        if (profile.requestDetails) {
            const detailsBox = document.createElement('div');
            detailsBox.className = 'p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[10px] text-slate-300 leading-relaxed';
            detailsBox.innerHTML = `<strong>פרטי בקשה:</strong> ${window.escapeHtml(profile.requestDetails)}`;
            card.appendChild(detailsBox);
        }

        const roleSelect = document.createElement('select');
        roleSelect.className = 'w-full text-[10px] border border-white/10 rounded-lg py-2 px-2 bg-slate-950 text-white';
        [
            ['viewer', 'דרגה 1 — העלאה לאחר אישור'],
            ['uploader', 'דרגה 2 — העלאת תמונות ללא אישור'],
            ['admin', 'דרגה 3 — מנהל'],
            ['super_admin', 'דרגה 4 — מנהל־על']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        });
        card.appendChild(roleSelect);

        // Action triggers
        const actions = document.createElement('div');
        actions.className = 'flex gap-1.5';
        
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] py-2 rounded-lg font-bold';
        approve.textContent = 'אשר';
        approve.onclick = () => window.approveUserAccess(profile.uid, roleSelect.value);

        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        reject.textContent = 'דחה';
        reject.onclick = () => window.rejectUserAccess(profile.uid);

        const msgBtn = document.createElement('button');
        msgBtn.type = 'button';
        msgBtn.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        msgBtn.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i>';
        msgBtn.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const emailBtn = document.createElement('button');
        emailBtn.type = 'button';
        emailBtn.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        emailBtn.innerHTML = '<i data-lucide="mail" class="w-3.5 h-3.5"></i>';
        emailBtn.onclick = () => window.sendDirectMail(profile.email, profile.displayName);

        actions.append(approve, msgBtn, emailBtn, reject);
        card.appendChild(actions);
        list.appendChild(card);
    });

    window.scheduleIconRefresh();
};
    

// סיכום נתוני הניהול. הפונקציה נקראת מכל רינדור של הגלריה, ולכן היא חייבת
// לבדוק הרשאה בעצמה ולא להסתמך על כך שהפאנל מוסתר: משתמש רגיל היה מקבל את
// המספרים כתובים ב-DOM. מונה בקשות ההצטרפות נשאר אפס גם למנהל דרגה 3,
// משום שהוא נתון של מנהל־על.
window.updateAdminOverview = function() {
    const overviewIds = [
        'adminOverviewUsersCount', 'adminOverviewPendingCount',
        'adminOverviewImagesCount', 'adminOverviewFoldersCount'
    ];
    if (!window.canViewAdminData?.()) {
        overviewIds.forEach(id => window.clearAdminOutput?.(id, '0'));
        return;
    }
    const values = {
        adminOverviewUsersCount: window.canViewSuperAdminData?.() ? (window.state.pendingUsers || []).length : 0,
        adminOverviewPendingCount: (window.state.pendingImages || []).length,
        adminOverviewImagesCount: (window.state.images || []).length,
        adminOverviewFoldersCount: (window.state.folders || []).filter(folder => folder.id !== 'all').length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
};

// מונה בקשות ההצטרפות — נתון של מנהל־על בלבד.
window.updatePendingUsersBadge = function() {
    if (!window.canViewSuperAdminData?.()) {
        window.clearAdminOutput?.('pendingUsersCountBadge', '0');
        window.updateAdminOverview();
        return;
    }
    const badge = document.getElementById('pendingUsersCountBadge');
    if (badge) badge.textContent = String((window.state.pendingUsers || []).length);
    window.updateAdminOverview();
};

window.approveUserAccess = async function(uid, role, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    const allowedRoles = ['viewer', 'uploader', 'admin', 'super_admin'];
    const profile = window.state.pendingUsers.find(item => item.uid === uid);
    if (!profile || !allowedRoles.includes(role)) return;
    const roleLabels = { viewer: 'דרגה 1', uploader: 'דרגה 2', admin: 'דרגה 3', super_admin: 'דרגה 4' };
    if (!confirmed) {
        window.showConfirm(
            'אישור משתמש',
            `לאשר את ${profile.displayName || profile.email || 'המשתמש'} בתור ${roleLabels[role]}? ההרשאה תיכנס לתוקף מיד.`,
            () => window.approveUserAccess(uid, role, true)
        );
        return;
    }

    try {
        const { doc, setDoc } = window.firestoreModules;
        const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid);
        await setDoc(profileRef, {
            status: 'approved',
            role,
            approvedAt: Date.now(),
            approvedBy: window.state.currentUser?.uid || 'system-admin'
        }, { merge: true });
        await window.logActivity('approved_user', 'user', uid, profile.displayName || profile.email || uid, roleLabels[role]);
        const approvedProfile = { ...profile, status: 'approved', role };
        window.state.pendingUsers = (window.state.pendingUsers || []).filter(u => u.uid !== uid);
        window.state.allUsers = (window.state.allUsers || []).filter(u => u.uid !== uid);
        window.state.allUsers.push(approvedProfile);
        window.renderPendingUsers?.();
        window.renderManagedUsers?.();
        window.updatePendingUsersBadge?.();
        window.showNotification(`${profile.displayName || 'המשתמש'} אושר בתור ${roleLabels[role]}.`);
    } catch (error) {
        console.error('Approving user failed:', error);
        window.showNotification('אישור המשתמש נכשל. בדוק את הרשאות Cloudflare.', false);
    }
};

window.rejectUserAccess = function(uid) {
    if (!window.checkSuperAdminPermission()) return;
    const profile = window.state.pendingUsers.find(item => item.uid === uid);
    if (!profile) return;
    window.showConfirm('דחיית משתמש', `לדחות את בקשת ההצטרפות של ${profile.displayName || profile.email || 'המשתמש'}?`, async () => {
        try {
            const { doc, setDoc } = window.firestoreModules;
            const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid);
            await setDoc(profileRef, {
                status: 'rejected',
                rejectedAt: Date.now(),
                rejectedBy: window.state.currentUser?.uid || 'system-admin'
            }, { merge: true });
            window.state.pendingUsers = (window.state.pendingUsers || []).filter(u => u.uid !== uid);
            window.renderPendingUsers?.();
            window.updatePendingUsersBadge?.();
            window.showNotification('בקשת המשתמש נדחתה.');
        } catch (error) {
            console.error('rejectUserAccess failed:', error);
            window.showNotification('דחיית הבקשה נכשלה.', false);
        }
    });
};

window.renderPendingImages = function() {
    const list = document.getElementById('pendingList'); if (!list) return;
    // תמונות הממתינות לאישור — מדרגה 3 ומעלה.
    if (!window.canViewAdminData?.()) { list.innerHTML = ''; return; }
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
}

// מונה התמונות הממתינות לאישור — מידע ניהולי מדרגה 3 ומעלה.
window.updatePendingBadge = function() {
    if (!window.canViewAdminData?.()) {
        window.clearAdminOutput?.('pendingCountBadge', '0');
        window.updateAdminOverview();
        return;
    }
    const badge = document.getElementById('pendingCountBadge');
    if (badge) badge.innerText = (window.state.pendingImages || []).length;
    window.updateAdminOverview();
}

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



// חשיפה ל-window עבור מטפלי onclick שנשארו ב-HTML.
window.approveSelectedPending = approveSelectedPending;
window.rejectSelectedPending = rejectSelectedPending;
window.toggleSelectAllPending = toggleSelectAllPending;

// נקודת האתחול של המודול. app.js קורא לה פעם אחת בטעינת האתר.
export function initAdmin() {
    window.updateAdminUI?.();
}
