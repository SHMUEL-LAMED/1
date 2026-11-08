// admin-users.js — ניהול המשתמשים בלוח הניהול: בקשות הצטרפות, דרגות,
// חסימה ומחיקה (מנהל־על בלבד).
//
// פוצל מ-admin.js כדי שכל קובץ יעסוק בעניין אחד. המודול אינו נוגע ב-DOM
// בזמן הטעינה ואינו רושם דבר על window: admin.js מייבא אותו ורושם את
// הפונקציות בשמותיהן הקיימים (window.renderManagedUsers וכו׳), כך
// שטעינה חוזרת של נקודת הכניסה רושמת אותן מחדש על ה-window הנוכחי.
// עזרי window (showConfirm, logActivity, escapeHtml…) נקראים בזמן הקריאה.

export async function changeUserRole(uid, role, confirmed = false) {
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
}

export async function toggleUserBlock(uid, confirmed = false) {
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
}

export async function deleteManagedUser(uid, confirmed = false) {
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
}

export async function forceRefreshUsers() {
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
}

export function renderManagedUsers() {
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
        // המזהה משמש את הבחירה המרובה ואת ההערות (admin-users-bulk.js).
        card.dataset.uid = profile.uid;
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
    window.decorateUserCards?.(list);
    window.scheduleIconRefresh();
}

export function renderPendingUsers() {
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
        card.dataset.uid = profile.uid;

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
        // השם המלא שהמבקש כתב בטופס הבקשה (access-request.js) קודם לשם Google,
        // שהוא לעיתים כינוי. שם Google נשאר בשורת הדוא"ל, להשוואה.
        const requestedName = String(profile.requestedName || '').trim();
        name.textContent = requestedName || profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'admin-row-meta truncate';
        const googleName = String(profile.displayName || '').trim();
        email.textContent = requestedName && googleName && googleName !== requestedName
            ? `${profile.email || ''} · ב-Google: ${googleName}`
            : (profile.email || '');
        identity.append(name, email);
        header.appendChild(identity);

        card.appendChild(header);

        if (!requestedName) {
            const missing = document.createElement('p');
            missing.className = 'admin-row-meta';
            missing.textContent = 'עדיין לא מילא שם מלא בטופס הבקשה.';
            identity.appendChild(missing);
        }
        if (profile.requestNote) {
            const noteBox = document.createElement('p');
            noteBox.className = 'p-2.5 rounded-lg bg-amber-400/10 border border-amber-400/25 text-[11px] leading-relaxed';
            const label = document.createElement('strong');
            label.textContent = 'קשר לישיבה: ';
            noteBox.append(label, document.createTextNode(String(profile.requestNote)));
            card.appendChild(noteBox);
        }

        // הגיע מקישור הזמנה לאירוע: השרת לבדו כותב את השדה (POST /invites/redeem).
        if (profile.inviteFolderName) {
            const flag = document.createElement('span');
            flag.className = 'chip is-cyan invite-flag';
            flag.textContent = `הגיע מהזמנה לאירוע ${profile.inviteFolderName}`;
            identity.appendChild(flag);
        }

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

    window.decorateUserCards?.(list);
    window.scheduleIconRefresh();
}

// מונה בקשות ההצטרפות — נתון של מנהל־על בלבד.
export function updatePendingUsersBadge() {
    if (!window.canViewSuperAdminData?.()) {
        window.clearAdminOutput?.('pendingUsersCountBadge', '0');
        window.updateAdminOverview();
        return;
    }
    const badge = document.getElementById('pendingUsersCountBadge');
    if (badge) badge.textContent = String((window.state.pendingUsers || []).length);
    window.updateAdminOverview();
}

export async function approveUserAccess(uid, role, confirmed = false) {
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
}

export function rejectUserAccess(uid) {
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
}
