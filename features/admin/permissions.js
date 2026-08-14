// הצגה והסתרה של הממשק לפי דרגה: מנהל ומנהל־על
// פוצל מתוך admin.js. הקוד עצמו לא שונה — רק מיקומו.


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
};
