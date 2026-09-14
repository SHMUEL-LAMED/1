// session-ui.js — כל מה שמבקר רואה על עצמו: שער הגישה, נעילת הגלריה,
// סטטוס החיבור בכותרת, כרטיס הפרופיל והרשאת ההעלאה.
//
// הקוד הזה ישב קודם בתוך updateAdminUI שב-admin.js, ולכן מודול הניהול
// נאלץ להיטען בכל כניסה לאתר — גם לאורח שלעולם לא ייגע בניהול. הפרדתו
// לכאן היא מה שמאפשר לדף הגלריה לוותר על admin.js לגמרי, ולניהול לחיות
// בדף נפרד (admin.html).
//
// המודול הזה נטען בשני הדפים. אין בו שום פעולה ניהולית: הוא רק מצייר את
// מצב החשבון. החלק הניהולי נמצא ב-updateAdminPanelUI שב-admin.js, והוא
// נקרא כאן רק אם הוא קיים בדף הנוכחי.

// כל אלמנט נבדק בנפרד. אין כאן יציאה מוקדמת: הגרסה הקודמת יצאה מיד אם
// #sidebarLockStatus היה חסר, וכך שער הגישה ונעילת הגלריה לא התעדכנו
// בשום דף שאין בו את מגירת הניהול.
function updateSessionUI() {
    const state = window.state || {};
    const currentUser = state.currentUser;
    const approvalStatus = state.userApprovalStatus;
    const role = state.userRole;
    const hasGalleryAccess = state.isAdminLoggedIn || (state.isGoogleUser && approvalStatus === 'approved');

    updateAccessGate(hasGalleryAccess, approvalStatus);
    updateLaunchers(state);
    updateIdentityCards(currentUser, approvalStatus, role, state);
    updateUploadAccess(role, approvalStatus, state);
    updateSessionStatusBadge(state, approvalStatus, role);

    // לוח הניהול עצמו חי רק בדף הניהול. בדף הגלריה הפונקציה אינה מוגדרת,
    // וזה בדיוק המצב הרצוי — הגלריה אינה טוענת את מודול הניהול.
    window.updateAdminPanelUI?.();
    window.scheduleIconRefresh?.();
}
window.updateSessionUI = updateSessionUI;
// drive-sync.js קורא ל-updateAdminUI בכל שינוי מצב התחברות. השם נשמר כדי
// שלא יהיה צורך לשנות כל קורא, אך הוא מצביע עכשיו על שכבת הסשן.
window.updateAdminUI = updateSessionUI;

// מסך טרם ההתחברות מציג מצב אחד בכל רגע: כפתור Google למי שטרם נכנס,
// מסך המתנה למי שכבר ביקש אישור, והודעה ברורה לחשבון שנדחה או נחסם.
function updateAccessGate(hasGalleryAccess, approvalStatus) {
    const accessGate = document.getElementById('galleryAccessGate');
    const accessGateTitle = document.getElementById('galleryAccessGateTitle');
    const accessGateText = document.getElementById('galleryAccessGateText');
    const headerConnectionStatus = document.getElementById('headerConnectionStatus');

    document.body.classList.toggle('gallery-locked', !hasGalleryAccess);
    if (accessGate) accessGate.classList.toggle('hidden', hasGalleryAccess);
    if (headerConnectionStatus) {
        headerConnectionStatus.textContent = hasGalleryAccess ? 'גישה מאושרת' : 'נדרשת הרשאה';
        // הצבע נגזר מהמצב ב-CSS, ולכן אין כאן רשימת מחלקות שיש לתחזק פעמיים.
        headerConnectionStatus.dataset.state = hasGalleryAccess ? 'online' : 'locked';
    }
    if (hasGalleryAccess || !accessGateTitle || !accessGateText) return;

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

// כפתורים שמובילים לניהול מוצגים למי שרשאי. הם קיימים גם בדף הגלריה
// (בחירה מרובה, עריכת אירוע, מעבר ללוח הניהול) ולכן נשארים כאן.
function updateLaunchers(state) {
    document.querySelectorAll('[data-super-admin-messages-launcher]').forEach(button => {
        button.classList.toggle('hidden', !state.isSuperAdmin);
        button.classList.toggle('flex', Boolean(state.isSuperAdmin));
    });
    document.querySelectorAll('[data-admin-profile-launcher]').forEach(button => {
        button.classList.toggle('hidden', !state.isAdminLoggedIn);
        button.classList.toggle('flex', Boolean(state.isAdminLoggedIn));
    });
    const contactManagerButton = document.getElementById('contactManagerButton');
    if (contactManagerButton) contactManagerButton.classList.toggle('hidden', Boolean(state.isSuperAdmin));
}

function applyRoleBadge(badge, approvalStatus, role, baseClass) {
    if (!badge) return;
    const variants = {
        pending: ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'ממתין לאישור מנהל'],
        rejected: ['bg-red-500/10 text-red-400 border-red-500/20', 'הבקשה לא אושרה'],
        blocked: ['bg-red-500/10 text-red-400 border-red-500/20', 'חשבון חסום'],
        super_admin: ['bg-purple-500/10 text-purple-400 border-purple-500/20', 'דרגה 4 — מנהל־על'],
        admin: ['bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'דרגה 3 — מנהל'],
        uploader: ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'דרגה 2 — מעלה תמונות'],
        viewer: ['bg-white/5 text-slate-300 border-white/10', 'דרגה 1 — צופה רגיל']
    };
    const key = ['pending', 'rejected', 'blocked'].includes(approvalStatus)
        ? approvalStatus
        : (variants[role] ? role : 'viewer');
    const [classes, label] = variants[key];
    badge.className = `${baseClass} ${classes}`;
    badge.textContent = label;
}

// כרטיס הזהות מופיע בשני מקומות: הפאנל הצף שבכותרת וכרטיס החשבון
// שבאזור האישי. שניהם מוצגים לכל משתמש מחובר, ולא רק למנהל.
function updateIdentityCards(currentUser, approvalStatus, role, state) {
    const googleSignedOutView = document.getElementById('googleSignedOutView');
    const googleSignedInView = document.getElementById('googleSignedInView');
    const signedInWithGoogle = Boolean(state.isGoogleUser && currentUser);

    if (googleSignedOutView) googleSignedOutView.classList.toggle('hidden', signedInWithGoogle);
    if (googleSignedInView) googleSignedInView.classList.toggle('hidden', !signedInWithGoogle);

    const floatingSignedOutView = document.getElementById('floatingSignedOutView');
    const floatingSignedInView = document.getElementById('floatingSignedInView');
    if (!signedInWithGoogle) {
        if (floatingSignedOutView) floatingSignedOutView.classList.remove('hidden');
        if (floatingSignedInView) floatingSignedInView.classList.add('hidden');
        return;
    }

    const photoUrl = window.safeImageUrl?.(currentUser.photoURL) || '';
    const floatingUserPhoto = document.getElementById('floatingUserPhoto');
    const floatingUserFallback = document.getElementById('floatingUserFallback');
    const floatingUserPanelPhoto = document.getElementById('floatingUserPanelPhoto');
    if (photoUrl) {
        if (floatingUserPhoto) { floatingUserPhoto.src = photoUrl; floatingUserPhoto.classList.remove('hidden'); }
        if (floatingUserFallback) floatingUserFallback.classList.add('hidden');
        if (floatingUserPanelPhoto) { floatingUserPanelPhoto.src = photoUrl; floatingUserPanelPhoto.classList.remove('hidden'); }
    } else {
        if (floatingUserPhoto) floatingUserPhoto.classList.add('hidden');
        if (floatingUserFallback) floatingUserFallback.classList.remove('hidden');
        if (floatingUserPanelPhoto) floatingUserPanelPhoto.classList.add('hidden');
    }

    const floatingUserPanelName = document.getElementById('floatingUserPanelName');
    const floatingUserPanelEmail = document.getElementById('floatingUserPanelEmail');
    if (floatingUserPanelName) floatingUserPanelName.textContent = currentUser.displayName || 'משתמש Google';
    if (floatingUserPanelEmail) floatingUserPanelEmail.textContent = currentUser.email || '';
    if (floatingSignedOutView) floatingSignedOutView.classList.add('hidden');
    if (floatingSignedInView) floatingSignedInView.classList.remove('hidden');
    applyRoleBadge(
        document.getElementById('floatingUserPanelBadge'),
        approvalStatus,
        role,
        'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold border'
    );

    // תיבת ההודעות של המשתמש מצוירת רק אחרי שמודול הצ׳אט ירד.
    window.refreshChatUI?.();
    window.renderActiveConversation?.();

    const googleUserName = document.getElementById('googleUserName');
    const googleUserEmail = document.getElementById('googleUserEmail');
    const googleUserPhoto = document.getElementById('googleUserPhoto');
    if (googleUserName) googleUserName.textContent = currentUser.displayName || 'משתמש Google';
    if (googleUserEmail) googleUserEmail.textContent = currentUser.email || '';
    if (googleUserPhoto) {
        if (photoUrl) { googleUserPhoto.src = photoUrl; googleUserPhoto.classList.remove('hidden'); }
        else { googleUserPhoto.removeAttribute('src'); googleUserPhoto.classList.add('hidden'); }
    }
    applyRoleBadge(
        document.getElementById('googleUserRoleBadge'),
        approvalStatus,
        role,
        'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold border'
    );

    const googleUserApprovalText = document.getElementById('googleUserApprovalText');
    if (!googleUserApprovalText) return;
    const approvalTexts = {
        pending: 'בקשת ההצטרפות שלך נשלחה וממתינה לבחירת דרגה על ידי מנהל.',
        rejected: 'בקשת ההצטרפות לא אושרה. ניתן לפנות למנהל האתר.',
        blocked: 'הגישה לחשבון נחסמה על ידי מנהל־העל.',
        super_admin: 'לחשבון יש הרשאות ניהול מלאות.',
        admin: 'החשבון מאושר כמנהל המערכת.',
        uploader: 'החשבון מאושר ויכול להעלות תמונות ישירות לגלריה.',
        viewer: 'החשבון מאושר לצפייה ולהגשת תמונות לאישור.'
    };
    const key = ['pending', 'rejected', 'blocked'].includes(approvalStatus)
        ? approvalStatus
        : (approvalTexts[role] ? role : 'viewer');
    googleUserApprovalText.textContent = approvalTexts[key];
}

// דרגה 1 שולחת לאישור, דרגה 2 מעלה ישירות. הניסוח של הכרטיס ושל חלון
// ההעלאה נגזר מהדרגה, ולכן הוא חלק ממה שכל משתמש רואה.
function updateUploadAccess(role, approvalStatus, state) {
    const uploadCard = document.getElementById('userUploadAccessCard');
    const uploadTitle = document.getElementById('userUploadAccessTitle');
    const uploadText = document.getElementById('userUploadAccessText');
    const uploadModeText = document.getElementById('userUploadModeText');
    const uploadSubmitButton = document.getElementById('userUploadSubmitBtn');

    const signedInWithGoogle = Boolean(state.isGoogleUser && state.currentUser);
    const isApprovedViewer = signedInWithGoogle && approvalStatus === 'approved' && role === 'viewer';
    const isApprovedUploader = signedInWithGoogle && approvalStatus === 'approved' && role === 'uploader';

    if (uploadCard) uploadCard.classList.toggle('hidden', !(isApprovedViewer || isApprovedUploader));
    if (isApprovedUploader) {
        if (uploadTitle) uploadTitle.textContent = 'העלאה ישירה לגלריה';
        if (uploadText) uploadText.textContent = 'דרגה 2 מאפשרת להעלות תמונות ללא המתנה לאישור.';
        if (uploadModeText) uploadModeText.textContent = 'התמונות יעלו ישירות לגלריה ללא אישור נוסף.';
        if (uploadSubmitButton) uploadSubmitButton.textContent = 'העלה לגלריה';
    } else if (isApprovedViewer) {
        if (uploadTitle) uploadTitle.textContent = 'שליחת תמונות לאישור';
        if (uploadText) uploadText.textContent = 'דרגה 1 מאפשרת להעלות תמונות לאחר אישור מנהל.';
        if (uploadModeText) uploadModeText.textContent = 'התמונות יישלחו לבדיקה ויופיעו בגלריה לאחר אישור מנהל.';
        if (uploadSubmitButton) uploadSubmitButton.textContent = 'שלח לאישור';
    }
}

// תג המצב שבראש האזור האישי. למנהל הוא מציג "ניהול פעיל", אך הכיתוב
// עצמו שייך לאזור האישי ולכן נשאר כאן.
function updateSessionStatusBadge(state, approvalStatus, role) {
    const statusBadge = document.getElementById('sidebarLockStatus');
    const userArea = document.getElementById('userActionArea');
    if (userArea) userArea.classList.remove('hidden');
    if (!statusBadge) return;

    const baseClass = 'text-[10px] px-2 py-0.5 rounded-full font-bold';
    if (state.isAdminLoggedIn) {
        statusBadge.className = `${baseClass} bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`;
        statusBadge.innerText = state.isSuperAdmin ? 'ניהול־על פעיל' : 'ניהול פעיל';
        return;
    }
    if (!state.isGoogleUser) {
        statusBadge.className = `${baseClass} bg-amber-500/10 text-amber-400 border border-amber-500/20`;
        statusBadge.innerText = 'מצב אורח';
        return;
    }
    if (approvalStatus === 'approved') {
        const isUploader = role === 'uploader';
        statusBadge.className = isUploader
            ? `${baseClass} bg-amber-500/10 text-amber-400 border border-amber-500/20`
            : `${baseClass} bg-white/5 text-slate-300 border border-white/10`;
        statusBadge.innerText = isUploader ? 'הרשאת העלאה' : 'צופה מאושר';
        return;
    }
    const labels = { blocked: 'חשבון חסום', rejected: 'לא אושר' };
    const isDenied = Boolean(labels[approvalStatus]);
    statusBadge.className = isDenied
        ? `${baseClass} bg-red-500/10 text-red-400 border border-red-500/20`
        : `${baseClass} bg-amber-500/10 text-amber-400 border border-amber-500/20`;
    statusBadge.innerText = labels[approvalStatus] || 'ממתין לאישור';
}

export function initSessionUI() {
    updateSessionUI();
}
