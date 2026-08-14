// משתמשים: אישור, דרגה, חסימה, מחיקה ורשימות
// פוצל מתוך admin.js. הקוד עצמו לא שונה — רק מיקומו.


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
        window.renderAdminMessageUsers();
        window.renderAdminMessageReplies();
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

window.renderPendingUsers = function() {
    const list = document.getElementById('pendingUsersList');
    if (!list) return;
    list.innerHTML = '';
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

window.updatePendingUsersBadge = function() {
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
