// admin.js — ממשק הניהול, משתמשים, דרגות והרשאות
// לוגיקת הצ׳אט הועברה ל-chat.js כדי לשמור על מודולים קטנים וברורים יותר.

// --- 3. Admin panel UI ---
// כאן נשאר רק מה ששייך ללוח הניהול עצמו. כל מה שמשתמש רגיל רואה — שער
// הגישה, נעילת הגלריה, סטטוס הכותרת וכרטיס הפרופיל — עבר ל-session-ui.js,
// שנטען בכל דף. כך דף הגלריה אינו נזקק למודול הזה כלל.
window.updateAdminPanelUI = function() {
    const adminPanel = document.getElementById('sidebarAdminPanel');
    if (!adminPanel) return;

    const superAdminOnlyElements = adminPanel.querySelectorAll('.super-admin-only');
    const superAdminChatsCard = document.getElementById('superAdminChatsCard');
    const superAdminUsersCard = document.getElementById('superAdminUsersCard');
    const superAdminDeletionRequestsCard = document.getElementById('superAdminDeletionRequestsCard');
    const rejectPendingButton = document.getElementById('rejectPendingBtn');

    adminPanel.classList.toggle('hidden', !window.state.isAdminLoggedIn);
    superAdminOnlyElements.forEach(element => element.classList.add('hidden'));
    if (superAdminChatsCard) superAdminChatsCard.classList.add('hidden');
    if (superAdminUsersCard) superAdminUsersCard.classList.add('hidden');
    if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.add('hidden');
    if (!window.state.isAdminLoggedIn) return;

    const currentUser = window.state.currentUser;
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
        // הצבע מגיע מהאסימונים שב-styles.css, ולכן הוא נכון בשני מצבי התצוגה.
        adminGrade.className = 'admin-grade-badge';
        adminGrade.dataset.grade = window.state.isSuperAdmin ? 'super' : 'admin';
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
    // התפריט נבנה מחדש בכל שינוי הרשאה: מסכי מנהל־על נוספים או נעלמים.
    window.renderAdminNavigation?.();
    window.updateAdminOverviewExtras?.();
    window.scheduleIconRefresh();
    // האינדוקס הראשוני מתחיל רק בדף הניהול, ורק אחרי שהלוח כבר מצויר.
    window.setTimeout(() => window.maybeStartInitialFaceIndexing?.(), 1800);
};


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
        empty.className = 'admin-empty';
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
        card.className = 'admin-row flex-col items-stretch gap-2';
        // הסינון שבמסך המשתמשים קורא את הדרגה מכאן, ולכן היא נשמרת על הכרטיס.
        card.dataset.userRole = profile.status === 'blocked' ? (profile.roleBeforeBlock || profile.role || '') : (profile.role || '');

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';
        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'admin-row-title truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'admin-row-meta truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        const status = document.createElement('span');
        status.className = profile.status === 'blocked' ? 'chip is-danger' : 'chip is-green';
        status.textContent = profile.status === 'blocked' ? 'חסום' : 'פעיל';
        header.append(identity, status);

        const controls = document.createElement('div');
        controls.className = 'flex gap-2';
        const roleSelect = document.createElement('select');
        roleSelect.className = 'flex-1 text-[11px] py-1.5 px-2';
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
        save.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        save.textContent = 'שמירת דרגה';
        save.disabled = isCurrentUser || profile.status === 'blocked';
        save.onclick = () => window.changeUserRole(profile.uid, roleSelect.value);

        const block = document.createElement('button');
        block.type = 'button';
        block.className = profile.status === 'blocked' ? 'btn-secondary-dark px-3 py-1.5 text-[11px]' : 'btn-danger-soft px-3 py-1.5 text-[11px]';
        block.textContent = profile.status === 'blocked' ? 'ביטול חסימה' : 'חסימה';
        block.disabled = isCurrentUser;
        block.onclick = () => window.toggleUserBlock(profile.uid);
        controls.append(roleSelect, save, block);

        const linkedActions = document.createElement('div');
        linkedActions.className = 'grid grid-cols-2 gap-2';
        const message = document.createElement('button');
        message.type = 'button';
        message.className = 'btn-secondary-dark py-2 text-[11px]';
        message.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i> שליחת הודעה';
        message.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-danger-soft py-2 text-[11px]';
        remove.innerHTML = '<i data-lucide="user-x" class="w-3.5 h-3.5"></i> מחיקת משתמש';
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
        empty.className = 'admin-empty';
        empty.textContent = 'אין בקשות הצטרפות ממתינות.';
        list.appendChild(empty);
        return;
    }

    pendingUsers.forEach(profile => {
        const card = document.createElement('div');
        card.className = 'admin-row flex-col items-stretch gap-2.5';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2.5';

        const photoUrl = window.safeImageUrl(profile.photoURL);
        if (photoUrl) {
            const photo = document.createElement('img');
            photo.src = photoUrl;
            photo.alt = '';
            photo.className = 'w-9 h-9 rounded-full object-cover border border-white/15';
            photo.onerror = () => window.handleImageError(photo);
            header.appendChild(photo);
        } else {
            const icon = document.createElement('div');
            icon.className = 'admin-stat-icon w-9 h-9 rounded-full';
            icon.innerHTML = '<i data-lucide="user" class="w-4 h-4"></i>';
            header.appendChild(icon);
        }

        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'admin-row-title truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'admin-row-meta truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        header.appendChild(identity);

        card.appendChild(header);

        // Show submitted details if available
        if (profile.requestDetails) {
            const detailsBox = document.createElement('div');
            detailsBox.className = 'p-2.5 rounded-lg bg-amber-400/10 border border-amber-400/25 text-[11px] leading-relaxed';
            detailsBox.innerHTML = `<strong>פרטי בקשה:</strong> ${window.escapeHtml(profile.requestDetails)}`;
            card.appendChild(detailsBox);
        }

        const roleSelect = document.createElement('select');
        roleSelect.className = 'w-full text-[11px] py-1.5 px-2';
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
        approve.className = 'btn-primary-gold flex-1 py-2 text-[11px]';
        approve.textContent = 'אישור';
        approve.onclick = () => window.approveUserAccess(profile.uid, roleSelect.value);

        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'btn-danger-soft px-3 py-2 text-[11px]';
        reject.textContent = 'דחייה';
        reject.onclick = () => window.rejectUserAccess(profile.uid);

        const msgBtn = document.createElement('button');
        msgBtn.type = 'button';
        msgBtn.className = 'btn-secondary-dark px-3 py-2 text-[11px]';
        msgBtn.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i>';
        msgBtn.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const emailBtn = document.createElement('button');
        emailBtn.type = 'button';
        emailBtn.className = 'btn-secondary-dark px-3 py-2 text-[11px]';
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
    if (pending.length === 0) { list.innerHTML = '<p class="admin-empty">אין קבצי מדיה ממתינים לאישור.</p>'; return; }
    const parts = [];
    pending.forEach(img => {
        const imageId = window.safeRecordId(img.id);
        if (!imageId) return;
        const imageUrl = window.safeImageUrl(img.url);
        const isVideo = window.isVideoRecord(img);
        const preview = isVideo
            ? '<span class="admin-stat-icon" data-tone="violet"><i data-lucide="video" class="w-4 h-4"></i></span>'
            : `<img src="${window.escapeHtml(imageUrl)}" loading="lazy" decoding="async" alt="" class="w-10 h-10 shrink-0 object-cover rounded-lg border border-white/10" onerror="window.handleImageError(this)">`;
        parts.push(`
            <label class="admin-row cursor-pointer">
                <input type="checkbox" name="pendingImgCheck" value="${imageId}" checked>
                ${preview}
                <div class="flex-1 min-w-0">
                    <p class="admin-row-title truncate">${window.escapeHtml(img.title)}</p>
                    <p class="admin-row-meta truncate">${isVideo ? 'סרטון' : 'תמונה'} · תיקייה מקורית: ${window.escapeHtml(img.originalFolderName)}</p>
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

// נקודת האתחול של המודול. admin-app.js קורא לה פעם אחת בטעינת דף הניהול.
// שכבת הסשן מצוירת בנפרד, ולכן כאן מצויר רק הלוח עצמו.
export function initAdmin() {
    window.updateAdminPanelUI?.();
}
