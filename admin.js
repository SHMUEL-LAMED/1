// admin.js — ממשק הניהול, משתמשים, דרגות והרשאות
// לוגיקת הצ׳אט הועברה ל-chat.js כדי לשמור על מודולים קטנים וברורים יותר.

// --- 3. Admin UI Update Routing ---
window.updateAdminUI = function() {
    const userArea = document.getElementById('userActionArea');
    const adminPanel = document.getElementById('sidebarAdminPanel');
    const statusBadge = document.getElementById('sidebarLockStatus');
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
    const superAdminMessageLaunchers = document.querySelectorAll('[data-super-admin-messages-launcher]');
    const adminProfileLaunchers = document.querySelectorAll('[data-admin-profile-launcher]');
    const contactManagerButton = document.getElementById('contactManagerButton');

    if (!statusBadge) return;

    if (userArea) userArea.classList.add('hidden');
    if (adminPanel) adminPanel.classList.add('hidden');
    if (uploadCard) uploadCard.classList.add('hidden');
    superAdminOnlyElements.forEach(element => element.classList.add('hidden'));
    if (superAdminChatsCard) superAdminChatsCard.classList.add('hidden');
    if (superAdminUsersCard) superAdminUsersCard.classList.add('hidden');
    if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.add('hidden');
    superAdminMessageLaunchers.forEach(button => {
        button.classList.toggle('hidden', !window.state.isSuperAdmin);
        button.classList.toggle('flex', window.state.isSuperAdmin);
    });
    adminProfileLaunchers.forEach(button => {
        button.classList.toggle('hidden', !window.state.isAdminLoggedIn);
        button.classList.toggle('flex', window.state.isAdminLoggedIn);
    });
    if (contactManagerButton) contactManagerButton.classList.toggle('hidden', window.state.isSuperAdmin);

    const googleSignedOutView = document.getElementById('googleSignedOutView');
    const googleSignedInView = document.getElementById('googleSignedInView');
    const googleUserName = document.getElementById('googleUserName');
    const googleUserEmail = document.getElementById('googleUserEmail');
    const googleUserPhoto = document.getElementById('googleUserPhoto');
    const googleUserRoleBadge = document.getElementById('googleUserRoleBadge');
    const googleUserApprovalText = document.getElementById('googleUserApprovalText');
    const currentUser = window.state.currentUser;
    const approvalStatus = window.state.userApprovalStatus;
    const role = window.state.userRole;
    const hasGalleryAccess = window.state.isAdminLoggedIn || (
        window.state.isGoogleUser && approvalStatus === 'approved'
    );
    const accessGate = document.getElementById('galleryAccessGate');
    const accessGateTitle = document.getElementById('galleryAccessGateTitle');
    const accessGateText = document.getElementById('galleryAccessGateText');
    const headerConnectionStatus = document.getElementById('headerConnectionStatus');

    document.body.classList.toggle('gallery-locked', !hasGalleryAccess);
    if (accessGate) accessGate.classList.toggle('hidden', hasGalleryAccess);
    if (headerConnectionStatus) headerConnectionStatus.textContent = hasGalleryAccess ? 'גישה מאושרת' : 'נדרשת הרשאה';
    // מסך טרם ההתחברות מציג מצב אחד בכל רגע: כפתור Google למי שטרם נכנס,
    // מסך המתנה למי שכבר ביקש אישור, והודעה ברורה לחשבון שנדחה או נחסם.
    if (!hasGalleryAccess && accessGateTitle && accessGateText) {
        const accessGateChip = document.getElementById('galleryAccessGateChip');
        const gateStates = {
            pending: {
                state: 'pending',
                chip: 'ממתין לאישור מנהל',
                title: 'בקשת ההצטרפות ממתינה לאישור',
                text: 'המנהל קיבל את הבקשה שלך. לאחר שיבחר עבורך דרגה, הגלריה תיפתח כאן אוטומטית.'
            },
            rejected: {
                state: 'blocked',
                chip: 'הבקשה נדחתה',
                title: 'בקשת ההצטרפות לא אושרה',
                text: 'החשבון אינו מורשה לצפות בגלריה. ניתן לפנות למנהל האתר.'
            },
            blocked: {
                state: 'blocked',
                chip: 'החשבון חסום',
                title: 'החשבון חסום',
                text: 'מנהל־העל חסם את החשבון. ניתן לפנות אליו לבירור.'
            }
        };
        const gate = gateStates[approvalStatus] || {
            state: 'signed-out',
            chip: 'כניסה מאובטחת',
            title: 'התחבר כדי לצפות בגלריה',
            text: 'התחבר באמצעות Google. לאחר מכן תישלח למנהל בקשה לאישור החשבון.'
        };
        if (accessGate) accessGate.dataset.gateState = gate.state;
        if (accessGateChip) accessGateChip.textContent = gate.chip;
        accessGateTitle.textContent = gate.title;
        accessGateText.textContent = gate.text;
    }

    if (googleSignedOutView && googleSignedInView) {
        const signedInWithGoogle = Boolean(window.state.isGoogleUser && currentUser);
        googleSignedOutView.classList.toggle('hidden', signedInWithGoogle);
        googleSignedInView.classList.toggle('hidden', !signedInWithGoogle);
        if (signedInWithGoogle) {

            // Sync Floating Panel Profiles
            const floatingUserPhoto = document.getElementById('floatingUserPhoto');
            const floatingUserFallback = document.getElementById('floatingUserFallback');
            const floatingUserPanelPhoto = document.getElementById('floatingUserPanelPhoto');
            const floatingUserPanelName = document.getElementById('floatingUserPanelName');
            const floatingUserPanelEmail = document.getElementById('floatingUserPanelEmail');
            const floatingUserPanelBadge = document.getElementById('floatingUserPanelBadge');
            const floatingSignedOutView = document.getElementById('floatingSignedOutView');
            const floatingSignedInView = document.getElementById('floatingSignedInView');

            const photoUrl = window.safeImageUrl(currentUser.photoURL);
            if (photoUrl) {
                if(floatingUserPhoto) { floatingUserPhoto.src = photoUrl; floatingUserPhoto.classList.remove('hidden'); }
                if(floatingUserFallback) floatingUserFallback.classList.add('hidden');
                if(floatingUserPanelPhoto) { floatingUserPanelPhoto.src = photoUrl; floatingUserPanelPhoto.classList.remove('hidden'); }
            } else {
                if(floatingUserPhoto) floatingUserPhoto.classList.add('hidden');
                if(floatingUserFallback) floatingUserFallback.classList.remove('hidden');
                if(floatingUserPanelPhoto) floatingUserPanelPhoto.classList.add('hidden');
            }

            if(floatingUserPanelName) floatingUserPanelName.textContent = currentUser.displayName || 'משתמש Google';
            if(floatingUserPanelEmail) floatingUserPanelEmail.textContent = currentUser.email || '';
            if(floatingSignedOutView) floatingSignedOutView.classList.add('hidden');
            if(floatingSignedInView) floatingSignedInView.classList.remove('hidden');

            // Floating Panel badge styles based on roles
            if (floatingUserPanelBadge) {
                floatingUserPanelBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold border';
                if (approvalStatus === 'pending') {
                    floatingUserPanelBadge.className += ' bg-amber-500/10 text-amber-400 border-amber-500/20';
                    floatingUserPanelBadge.textContent = 'ממתין לאישור מנהל';
                } else if (approvalStatus === 'blocked') {
                    floatingUserPanelBadge.className += ' bg-red-500/10 text-red-400 border-red-500/20';
                    floatingUserPanelBadge.textContent = 'חשבון חסום';
                } else if (role === 'super_admin') {
                    floatingUserPanelBadge.className += ' bg-purple-500/10 text-purple-400 border-purple-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 4 — מנהל־על';
                } else if (role === 'admin') {
                    floatingUserPanelBadge.className += ' bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 3 — מנהל';
                } else if (role === 'uploader') {
                    floatingUserPanelBadge.className += ' bg-amber-500/10 text-amber-400 border-amber-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 2 — מעלה תמונות';
                } else {
                    floatingUserPanelBadge.className += ' bg-white/5 text-slate-300 border-white/10';
                    floatingUserPanelBadge.textContent = 'דרגה 1 — צופה רגיל';
                }
            }

            // Render floating inbox messages
            window.renderFloatingInbox();
            window.renderActiveConversation?.();
    
            if (googleUserName) googleUserName.textContent = currentUser.displayName || 'משתמש Google';
            if (googleUserEmail) googleUserEmail.textContent = currentUser.email || '';
            if (googleUserPhoto) {
                const photoUrl = window.safeImageUrl(currentUser.photoURL);
                if (photoUrl) { googleUserPhoto.src = photoUrl; googleUserPhoto.classList.remove('hidden'); }
                else { googleUserPhoto.removeAttribute('src'); googleUserPhoto.classList.add('hidden'); }
            }

            if (googleUserRoleBadge && googleUserApprovalText) {
                if (approvalStatus === 'pending') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20';
                    googleUserRoleBadge.textContent = 'ממתין לאישור';
                    googleUserApprovalText.textContent = 'בקשת ההצטרפות שלך נשלחה וממתינה לבחירת דרגה על ידי מנהל.';
                } else if (approvalStatus === 'rejected') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20';
                    googleUserRoleBadge.textContent = 'הבקשה לא אושרה';
                    googleUserApprovalText.textContent = 'בקשת ההצטרפות לא אושרה. ניתן לפנות למנהל האתר.';
                } else if (approvalStatus === 'blocked') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20';
                    googleUserRoleBadge.textContent = 'חשבון חסום';
                    googleUserApprovalText.textContent = 'הגישה לחשבון נחסמה על ידי מנהל־העל.';
                } else if (role === 'uploader') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 2 — מעלה תמונות';
                    googleUserApprovalText.textContent = 'החשבון מאושר ויכול להעלות תמונות ישירות לגלריה.';
                    if (uploadCard) uploadCard.classList.remove('hidden');
                    if (uploadTitle) uploadTitle.textContent = 'העלאה ישירה לגלריה';
                    if (uploadText) uploadText.textContent = 'דרגה 2 מאפשרת להעלות תמונות ללא המתנה לאישור.';
                    if (uploadModeText) uploadModeText.textContent = 'התמונות יעלו ישירות לגלריה ללא אישור נוסף.';
                    if (uploadSubmitButton) uploadSubmitButton.textContent = 'העלה לגלריה';
                } else if (role === 'super_admin') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 4 — מנהל־על';
                    googleUserApprovalText.textContent = 'לחשבון יש הרשאות ניהול מלאות.';
                } else if (role === 'admin') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 3 — מנהל';
                    googleUserApprovalText.textContent = 'החשבון מאושר כמנהל המערכת.';
                } else {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/5 text-slate-350 border border-white/10';
                    googleUserRoleBadge.textContent = 'דרגה 1 — צופה רגיל';
                    googleUserApprovalText.textContent = 'החשבון מאושר לצפייה ולהגשת תמונות לאישור.';
                    if (uploadCard) uploadCard.classList.remove('hidden');
                    if (uploadTitle) uploadTitle.textContent = 'שליחת תמונות לאישור';
                    if (uploadText) uploadText.textContent = 'דרגה 1 מאפשרת להעלות תמונות לאחר אישור מנהל.';
                    if (uploadModeText) uploadModeText.textContent = 'התמונות יישלחו לבדיקה ויופיעו בגלריה לאחר אישור מנהל.';
                    if (uploadSubmitButton) uploadSubmitButton.textContent = 'שלח לאישור';
                }
            }
        }
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
}


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
    

window.updateAdminOverview = function() {
    const values = {
        adminOverviewUsersCount: (window.state.pendingUsers || []).length,
        adminOverviewPendingCount: (window.state.pendingImages || []).length,
        adminOverviewImagesCount: (window.state.images || []).length,
        adminOverviewFoldersCount: (window.state.folders || []).filter(folder => folder.id !== 'all').length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
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
}

window.updatePendingBadge = function() {
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


// =================== POPUP ANNOUNCEMENT ===================

// היעדים שאליהם אפשר להפנות מהפופ-אפ, מעבר לתיקייה ולעדכונים האחרונים.
// כל יעד מפעיל את אותה נקודת כניסה שהמשתמש לוחץ עליה באתר, ולכן בדיקות
// ההרשאה וההודעות למי שאינו מורשה נשארות במקום אחד בלבד — בפיצ׳ר עצמו.
export const POPUP_FEATURE_TARGETS = [
    {
        id: 'faceSearch',
        label: 'חיפוש פנים ב־AI',
        icon: 'scan-face',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openFaceSearchModal?.()
    },
    {
        id: 'aiSearch',
        label: 'חיפוש AI לפי תיאור',
        icon: 'brain-circuit',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openAiImageSearchModal?.()
    },
    {
        id: 'upload',
        label: 'העלאת תמונות וסרטונים',
        icon: 'cloud-upload',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => {
            // openModal עצמו אינו בודק הרשאות, ולכן הבדיקה נעשית כאן.
            if (window.state?.userApprovalStatus !== 'approved') {
                window.showNotification?.('העלאת מדיה זמינה למשתמשים מאושרים בלבד.', false);
                return;
            }
            window.openModal?.('userUploadModal');
        }
    },
    {
        id: 'favorites',
        label: 'המועדפים שלי',
        icon: 'heart',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openFavoritesFromProfile?.()
    },
    {
        id: 'contactManager',
        label: 'צ׳אט עם מנהל הגלריה',
        icon: 'message-circle',
        hint: 'למשתמשים מחוברים בלבד',
        run: () => window.openUserConversation?.()
    },
    {
        id: 'profile',
        label: 'הפרופיל וההתראות',
        icon: 'user-round',
        hint: 'זמין לכולם',
        run: () => window.openFloatingProfile?.()
    }
];

export function resolvePopupFeature(featureId) {
    const id = String(featureId || '');
    return POPUP_FEATURE_TARGETS.find(feature => feature.id === id) || null;
}

// התווית והאייקון של כפתור הפעולה בפופ-אפ. מחזיר null כשאין לאן להפנות,
// וכך גם ההסתרה של הכפתור וגם הטקסט שלו נגזרים מאותו מקום.
export function popupAnnouncementActionInfo(config, folders = window.state?.folders) {
    const linkType = config?.linkType || 'none';
    if (linkType === 'latest') return { label: 'לעדכונים האחרונים', icon: 'sparkles' };
    if (linkType === 'feature') {
        const feature = resolvePopupFeature(config?.featureId);
        return feature ? { label: feature.label, icon: feature.icon } : null;
    }
    if (linkType === 'folder' && config?.folderId) {
        const folder = (folders || []).find(item => String(item.id) === String(config.folderId));
        return { label: folder?.name ? `למעבר אל ${folder.name}` : 'למעבר לתיקייה', icon: 'folder-open' };
    }
    return null;
}

function popupAnnouncementVersion(config) {
    return String(config?.updatedAt || config?.imageUrl || 'current');
}

window.loadPopupAnnouncement = async function(retryCount = 0) {
    if (!window.db || !window.firestoreModules?.doc || !window.firestoreModules?.getDoc) {
        if (retryCount < 24) {
            clearTimeout(window._popupAnnouncementRetryTimer);
            window._popupAnnouncementRetryTimer = setTimeout(
                () => window.loadPopupAnnouncement?.(retryCount + 1),
                Math.min(3000, 250 + retryCount * 150)
            );
        } else {
            console.warn('Popup load skipped: cloud connection was not ready.');
        }
        return;
    }
    if (window._popupAnnouncementLoadPromise) return window._popupAnnouncementLoadPromise;
    window._popupAnnouncementLoadPromise = (async () => {
        try {
            const { doc, getDoc } = window.firestoreModules;
            const snap = await getDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
            const config = snap.exists() ? snap.data() : null;
            window.state.popupAnnouncementConfig = config || null;
            window.renderPopupAnnouncementAdmin?.();
            if (config?.enabled) window.showPopupAnnouncement(config);
        } catch (e) {
            console.warn('Popup load failed:', e);
            if (retryCount < 3) {
                clearTimeout(window._popupAnnouncementRetryTimer);
                window._popupAnnouncementRetryTimer = setTimeout(
                    () => window.loadPopupAnnouncement?.(retryCount + 1),
                    1000 * (retryCount + 1)
                );
            }
        } finally {
            window._popupAnnouncementLoadPromise = null;
        }
    })();
    return window._popupAnnouncementLoadPromise;
};

window.showPopupAnnouncement = function(config) {
    if (!config || !config.enabled || !config.imageUrl) return;
    const version = popupAnnouncementVersion(config);
    try {
        if (sessionStorage.getItem('popupAnnouncementDismissedVersion') === version) return;
    } catch (e) { /* ignore */ }

    if (config.audience === 'approved') {
        const status = window.state?.userApprovalStatus;
        if (status !== 'approved') return;
    }

    const modal = document.getElementById('popupAnnouncementModal');
    const img = document.getElementById('popupAnnouncementDisplayImg');
    if (!modal || !img) return;

    const action = popupAnnouncementActionInfo(config);
    img.style.cursor = action ? 'pointer' : 'default';
    renderPopupAnnouncementActionButton(action);
    img.onload = () => {
        modal.classList.remove('hidden');
        window.scheduleIconRefresh();
    };
    img.onerror = () => {
        modal.classList.add('hidden');
        console.warn('Popup image failed to load.');
    };
    img.src = config.imageUrl;
    if (img.complete && img.naturalWidth > 0) img.onload();
};

window.closePopupAnnouncement = function() {
    const modal = document.getElementById('popupAnnouncementModal');
    if (!modal) return;
    modal.classList.add('hidden');
    try {
        sessionStorage.setItem(
            'popupAnnouncementDismissedVersion',
            popupAnnouncementVersion(window.state?.popupAnnouncementConfig)
        );
        sessionStorage.removeItem('popupAnnouncementDismissed');
    } catch (e) { /* ignore */ }
};

// כפתור הפעולה מציג למשתמש לאן הפופ-אפ מפנה, במקום להסתמך על לחיצה
// על התמונה בלבד. התוכן נבנה ב-DOM ולא כ-HTML, כדי ששם תיקייה לא יוכל
// להזריק תגיות.
function renderPopupAnnouncementActionButton(action) {
    const button = document.getElementById('popupAnnouncementActionButton');
    if (!button) return;
    button.classList.toggle('hidden', !action);
    button.classList.toggle('flex', !!action);
    if (!action) {
        button.replaceChildren();
        return;
    }
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', action.icon || 'arrow-left');
    icon.className = 'w-4 h-4';
    const label = document.createElement('span');
    label.textContent = action.label;
    button.replaceChildren(icon, label);
}

window.handlePopupAnnouncementClick = function() {
    const config = window.state?.popupAnnouncementConfig;
    if (!config || !config.linkType || config.linkType === 'none') return;
    // הפופ-אפ נסגר תחילה: הוא יושב מעל כל החלונות, ואילו נשאר פתוח היה
    // מסתיר את הפיצ׳ר או את התיקייה שנפתחו זה עתה.
    window.closePopupAnnouncement();
    if (config.linkType === 'latest') {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder('all');
        window.state.gallerySort = 'newest';
        window.renderImages?.();
    } else if (config.linkType === 'folder' && config.folderId) {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder(config.folderId);
    } else if (config.linkType === 'feature') {
        const feature = resolvePopupFeature(config.featureId);
        if (feature) feature.run();
        else window.showNotification?.('הפנייה של ההודעה אינה זמינה יותר.', false);
    }
};

// הצגה או הסתרה של אזורי הבחירה לפי סוג הפנייה שנבחר. אותה פונקציה
// משמשת גם את כפתורי הרדיו ב-HTML וגם את טעינת ההגדרות השמורות.
window.updatePopupLinkTypeUI = function() {
    const linkType = document.querySelector('input[name="popupLinkType"]:checked')?.value || 'none';
    document.getElementById('popupFolderSelectorArea')?.classList.toggle('hidden', linkType !== 'folder');
    document.getElementById('popupFeatureSelectorArea')?.classList.toggle('hidden', linkType !== 'feature');
    const hint = document.getElementById('popupFeatureHint');
    if (hint) {
        const feature = resolvePopupFeature(document.getElementById('popupFeatureSelect')?.value);
        hint.textContent = linkType === 'feature' && feature ? feature.hint || '' : '';
    }
};

window.renderPopupAnnouncementAdmin = function() {
    const config = window.state?.popupAnnouncementConfig;

    const preview = document.getElementById('popupAnnouncementPreview');
    const previewImg = document.getElementById('popupAnnouncementPreviewImg');
    const statusEl = document.getElementById('popupAnnouncementStatus');
    const audienceEl = document.getElementById('popupAnnouncementAudienceLabel');
    const linkEl = document.getElementById('popupAnnouncementLinkLabel');
    const enabledCb = document.getElementById('popupEnabled');

    if (config && config.imageUrl) {
        if (preview) preview.classList.remove('hidden');
        if (previewImg) previewImg.src = config.imageUrl;
        if (statusEl) statusEl.textContent = config.enabled ? 'פעיל' : 'כבוי';
        if (audienceEl) audienceEl.textContent = config.audience === 'approved' ? 'מורשים בלבד' : 'כולם';
        if (linkEl) {
            const action = popupAnnouncementActionInfo(config);
            linkEl.textContent = action ? `מפנה אל: ${action.label}` : 'ללא פנייה — רק תמונה';
        }
    } else {
        if (preview) preview.classList.add('hidden');
    }

    if (enabledCb) enabledCb.checked = config ? !!config.enabled : true;

    const linkType = config?.linkType || 'none';
    document.querySelectorAll('input[name="popupLinkType"]').forEach(r => { r.checked = r.value === linkType; });

    const audience = config?.audience || 'all';
    document.querySelectorAll('input[name="popupAudience"]').forEach(r => { r.checked = r.value === audience; });

    const folderSelect = document.getElementById('popupFolderSelect');
    if (folderSelect) {
        folderSelect.innerHTML = (window.state.folders || [])
            .filter(f => f.id !== 'all')
            .map(f => `<option value="${f.id}"${String(config?.folderId) === String(f.id) ? ' selected' : ''}>${f.name || f.id}</option>`)
            .join('');
    }

    const featureSelect = document.getElementById('popupFeatureSelect');
    if (featureSelect) {
        featureSelect.replaceChildren(...POPUP_FEATURE_TARGETS.map(feature => {
            const option = document.createElement('option');
            option.value = feature.id;
            option.textContent = feature.label;
            option.selected = String(config?.featureId) === feature.id;
            return option;
        }));
    }

    window.updatePopupLinkTypeUI();
};

window.savePopupAnnouncement = async function() {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    const statusEl = document.getElementById('popupSaveStatus');
    const saveButton = document.getElementById('popupSaveButton');
    if (saveButton?.disabled) return;
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'מכין...';
    }
    if (statusEl) statusEl.textContent = 'מכין את התמונה להעלאה מהירה...';

    try {
        const fileInput = document.getElementById('popupImageInput');
        const file = fileInput?.files?.[0];
        const linkType = document.querySelector('input[name="popupLinkType"]:checked')?.value || 'none';
        const audience = document.querySelector('input[name="popupAudience"]:checked')?.value || 'all';
        const enabled = document.getElementById('popupEnabled')?.checked !== false;
        const folderId = linkType === 'folder' ? (document.getElementById('popupFolderSelect')?.value || '') : '';
        const featureId = linkType === 'feature' ? (document.getElementById('popupFeatureSelect')?.value || '') : '';
        if (linkType === 'folder' && !folderId) throw new Error('יש לבחור תיקייה לפנייה.');
        if (linkType === 'feature' && !resolvePopupFeature(featureId)) throw new Error('יש לבחור פיצ׳ר לפנייה.');

        let imageUrl = window.state.popupAnnouncementConfig?.imageUrl || '';
        let r2Key = window.state.popupAnnouncementConfig?.r2Key || '';

        if (file) {
            if (!String(file.type || '').startsWith('image/')) throw new Error('יש לבחור קובץ תמונה תקין.');
            if (file.size > 20 * 1024 * 1024) throw new Error('גודל התמונה חייב להיות עד 20MB.');
            const compressedDataUrl = await Promise.race([
                window.compressAndConvertImage(file, 1280, 1280, 0.78),
                new Promise((_, reject) => setTimeout(() => reject(new Error('הכנת התמונה נתקעה. נסה קובץ JPG או PNG אחר.')), 20000))
            ]);
            if (!compressedDataUrl) throw new Error('לא ניתן היה להכין את התמונה להעלאה.');
            const uploadBlob = window.dataUrlToBlob(compressedDataUrl);
            if (statusEl) statusEl.textContent = `מעלה תמונה ממוטבת (${Math.max(1, Math.round(uploadBlob.size / 1024))}KB)...`;
            if (saveButton) saveButton.textContent = 'מעלה...';
            const popupId = 'popup_announcement_' + Date.now();
            const uploaded = await window.uploadMediaToR2(uploadBlob, popupId, 'popup-announcement');
            if (!uploaded?.url) throw new Error('העלאת התמונה נכשלה.');
            if (r2Key && r2Key !== uploaded.r2Key) {
                await window.deleteImageFromR2({ r2Key }).catch(() => {});
            }
            imageUrl = uploaded.url;
            r2Key = uploaded.r2Key || '';
        }

        if (!imageUrl) throw new Error('יש לבחור תמונה לפופ-אפ.');

        const config = { imageUrl, r2Key, linkType, folderId, featureId, audience, enabled, updatedAt: Date.now() };
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'), config);
        window.state.popupAnnouncementConfig = config;
        if (fileInput) fileInput.value = '';
        window.renderPopupAnnouncementAdmin();
        try {
            sessionStorage.removeItem('popupAnnouncementDismissed');
            sessionStorage.removeItem('popupAnnouncementDismissedVersion');
        } catch (error) {}
        if (statusEl) statusEl.textContent = 'נשמר בהצלחה!';
        window.showNotification('הפופ-אפ נשמר ופורסם.', true);
        setTimeout(() => window.showPopupAnnouncement?.(config), 350);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'שמירה נכשלה');
        window.showNotification('שגיאה בשמירת הפופ-אפ: ' + (e.message || ''), false);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'שמור ופרסם';
        }
    }
};

window.deletePopupAnnouncement = async function(confirmed) {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    if (!confirmed) {
        if (!confirm('למחוק את הודעת הפופ-אפ?')) return;
        return window.deletePopupAnnouncement(true);
    }
    const statusEl = document.getElementById('popupSaveStatus');
    if (statusEl) statusEl.textContent = 'מוחק...';
    try {
        const r2Key = window.state.popupAnnouncementConfig?.r2Key;
        if (r2Key) await window.deleteImageFromR2({ r2Key }).catch(() => {});
        const { doc, deleteDoc } = window.firestoreModules;
        await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
        window.state.popupAnnouncementConfig = null;
        window.renderPopupAnnouncementAdmin();
        if (statusEl) statusEl.textContent = '';
        window.showNotification('הפופ-אפ נמחק.', true);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'מחיקה נכשלה');
        window.showNotification('שגיאה במחיקת הפופ-אפ: ' + (e.message || ''), false);
    }
};


// חשיפה ל-window עבור מטפלי onclick שנשארו ב-HTML.
window.approveSelectedPending = approveSelectedPending;
window.rejectSelectedPending = rejectSelectedPending;
window.toggleSelectAllPending = toggleSelectAllPending;

// נקודת האתחול של המודול. app.js קורא לה פעם אחת בטעינת האתר.
export function initAdmin() {
    window.updateAdminUI?.();
}
