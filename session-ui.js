// session-ui.js — מה שכל מבקר רואה: שער הגישה, סטטוס הכותרת, נעילת הגלריה
// וכרטיס הפרופיל. עד כה הקוד הזה ישב בתוך admin.js, ולכן כל אורח — גם מי
// שלעולם לא ייגע בניהול — היה חייב להוריד את מודול הניהול כדי שמסך הכניסה
// בכלל יצויר. כאן הוא עומד בנפרד ונטען תמיד, וממשק המגירה נטען רק כשצריך.

// הדרגות מוצגות בשני מקומות (כרטיס הפרופיל והחלונית הצפה) באותו נוסח,
// ולכן הן מוגדרות פעם אחת.
const ROLE_BADGES = {
    super_admin: { text: 'דרגה 4 — מנהל־על', tone: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    admin: { text: 'דרגה 3 — מנהל', tone: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    uploader: { text: 'דרגה 2 — מעלה תמונות', tone: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    viewer: { text: 'דרגה 1 — צופה רגיל', tone: 'bg-white/5 text-slate-300 border-white/10' }
};

const STATUS_BADGES = {
    pending: { text: 'ממתין לאישור מנהל', tone: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    blocked: { text: 'חשבון חסום', tone: 'bg-red-500/10 text-red-400 border-red-500/20' }
};

const GATE_STATES = {
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

const SIGNED_OUT_GATE = {
    state: 'signed-out',
    chip: 'כניסה מאובטחת',
    title: 'התחבר כדי לצפות בגלריה',
    text: 'התחבר באמצעות Google. לאחר מכן תישלח למנהל בקשה לאישור החשבון.'
};

const APPROVAL_NOTES = {
    pending: { badge: 'ממתין לאישור', tone: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', note: 'בקשת ההצטרפות שלך נשלחה וממתינה לבחירת דרגה על ידי מנהל.' },
    rejected: { badge: 'הבקשה לא אושרה', tone: 'bg-red-500/10 text-red-400 border border-red-500/20', note: 'בקשת ההצטרפות לא אושרה. ניתן לפנות למנהל האתר.' },
    blocked: { badge: 'חשבון חסום', tone: 'bg-red-500/10 text-red-400 border border-red-500/20', note: 'הגישה לחשבון נחסמה על ידי מנהל־העל.' }
};

const ROLE_NOTES = {
    uploader: { badge: 'דרגה 2 — מעלה תמונות', tone: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', note: 'החשבון מאושר ויכול להעלות תמונות ישירות לגלריה.' },
    super_admin: { badge: 'דרגה 4 — מנהל־על', tone: 'bg-purple-500/10 text-purple-400 border border-purple-500/20', note: 'לחשבון יש הרשאות ניהול מלאות.' },
    admin: { badge: 'דרגה 3 — מנהל', tone: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', note: 'החשבון מאושר כמנהל המערכת.' },
    viewer: { badge: 'דרגה 1 — צופה רגיל', tone: 'bg-white/5 text-slate-350 border border-white/10', note: 'החשבון מאושר לצפייה ולהגשת תמונות לאישור.' }
};

// האם החשבון רשאי לראות את הגלריה. זהו החישוב היחיד ששולט על הנעילה,
// ולכן הוא נשאר במקום אחד ומשמש גם את המגירה.
export function hasGalleryAccess() {
    return window.state.isAdminLoggedIn || (
        window.state.isGoogleUser && window.state.userApprovalStatus === 'approved'
    );
}
window.hasGalleryAccess = hasGalleryAccess;

function updateAccessGate() {
    const accessGate = document.getElementById('galleryAccessGate');
    const accessGateTitle = document.getElementById('galleryAccessGateTitle');
    const accessGateText = document.getElementById('galleryAccessGateText');
    const accessGateChip = document.getElementById('galleryAccessGateChip');
    const headerConnectionStatus = document.getElementById('headerConnectionStatus');
    const allowed = hasGalleryAccess();

    document.body.classList.toggle('gallery-locked', !allowed);
    if (accessGate) accessGate.classList.toggle('hidden', allowed);
    if (headerConnectionStatus) headerConnectionStatus.textContent = allowed ? 'גישה מאושרת' : 'נדרשת הרשאה';

    // מסך טרם ההתחברות מציג מצב אחד בכל רגע: כפתור Google למי שטרם נכנס,
    // מסך המתנה למי שכבר ביקש אישור, והודעה ברורה לחשבון שנדחה או נחסם.
    if (allowed || !accessGateTitle || !accessGateText) return;
    const gate = GATE_STATES[window.state.userApprovalStatus] || SIGNED_OUT_GATE;
    if (accessGate) accessGate.dataset.gateState = gate.state;
    if (accessGateChip) accessGateChip.textContent = gate.chip;
    accessGateTitle.textContent = gate.title;
    accessGateText.textContent = gate.text;
}

function updateProfileLaunchers() {
    document.querySelectorAll('[data-super-admin-messages-launcher]').forEach(button => {
        button.classList.toggle('hidden', !window.state.isSuperAdmin);
        button.classList.toggle('flex', window.state.isSuperAdmin);
    });
    document.querySelectorAll('[data-admin-profile-launcher]').forEach(button => {
        button.classList.toggle('hidden', !window.state.isAdminLoggedIn);
        button.classList.toggle('flex', window.state.isAdminLoggedIn);
    });
    const contactManagerButton = document.getElementById('contactManagerButton');
    if (contactManagerButton) contactManagerButton.classList.toggle('hidden', window.state.isSuperAdmin);
}

function updateFloatingProfile(currentUser) {
    const photo = document.getElementById('floatingUserPhoto');
    const fallback = document.getElementById('floatingUserFallback');
    const panelPhoto = document.getElementById('floatingUserPanelPhoto');
    const panelName = document.getElementById('floatingUserPanelName');
    const panelEmail = document.getElementById('floatingUserPanelEmail');
    const panelBadge = document.getElementById('floatingUserPanelBadge');
    const signedOutView = document.getElementById('floatingSignedOutView');
    const signedInView = document.getElementById('floatingSignedInView');

    const photoUrl = window.safeImageUrl(currentUser.photoURL);
    if (photoUrl) {
        if (photo) { photo.src = photoUrl; photo.classList.remove('hidden'); }
        if (fallback) fallback.classList.add('hidden');
        if (panelPhoto) { panelPhoto.src = photoUrl; panelPhoto.classList.remove('hidden'); }
    } else {
        if (photo) photo.classList.add('hidden');
        if (fallback) fallback.classList.remove('hidden');
        if (panelPhoto) panelPhoto.classList.add('hidden');
    }

    if (panelName) panelName.textContent = currentUser.displayName || 'משתמש Google';
    if (panelEmail) panelEmail.textContent = currentUser.email || '';
    if (signedOutView) signedOutView.classList.add('hidden');
    if (signedInView) signedInView.classList.remove('hidden');

    if (panelBadge) {
        const badge = STATUS_BADGES[window.state.userApprovalStatus]
            || ROLE_BADGES[window.state.userRole]
            || ROLE_BADGES.viewer;
        panelBadge.className = `inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold border ${badge.tone}`;
        panelBadge.textContent = badge.text;
    }
}

function updateGoogleIdentityCard(currentUser) {
    const name = document.getElementById('googleUserName');
    const email = document.getElementById('googleUserEmail');
    const photo = document.getElementById('googleUserPhoto');
    const roleBadge = document.getElementById('googleUserRoleBadge');
    const approvalText = document.getElementById('googleUserApprovalText');

    if (name) name.textContent = currentUser.displayName || 'משתמש Google';
    if (email) email.textContent = currentUser.email || '';
    if (photo) {
        const photoUrl = window.safeImageUrl(currentUser.photoURL);
        if (photoUrl) { photo.src = photoUrl; photo.classList.remove('hidden'); }
        else { photo.removeAttribute('src'); photo.classList.add('hidden'); }
    }

    if (!roleBadge || !approvalText) return;
    const note = APPROVAL_NOTES[window.state.userApprovalStatus]
        || ROLE_NOTES[window.state.userRole]
        || ROLE_NOTES.viewer;
    roleBadge.className = `inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold ${note.tone}`;
    roleBadge.textContent = note.badge;
    approvalText.textContent = note.note;
}

// עדכון כל מה שאינו תלוי במגירת הניהול. נקרא בכל טעינה ובכל שינוי התחברות.
export function updateSessionUI() {
    const currentUser = window.state.currentUser;
    const signedInWithGoogle = Boolean(window.state.isGoogleUser && currentUser);

    updateAccessGate();
    updateProfileLaunchers();

    const googleSignedOutView = document.getElementById('googleSignedOutView');
    const googleSignedInView = document.getElementById('googleSignedInView');
    if (googleSignedOutView && googleSignedInView) {
        googleSignedOutView.classList.toggle('hidden', signedInWithGoogle);
        googleSignedInView.classList.toggle('hidden', !signedInWithGoogle);
        if (signedInWithGoogle) {
            updateFloatingProfile(currentUser);
            window.refreshChatUI?.();
            window.renderActiveConversation?.();
            updateGoogleIdentityCard(currentUser);
        }
    }

    // ממשק המגירה — האזור האישי והניהול — מצויר רק אם המודול שלו כבר נטען.
    window.updateAdminPanelUI?.();
    window.scheduleIconRefresh?.();
}

// השם ההיסטורי נשמר: קוד קיים בכל המודולים קורא ל-window.updateAdminUI.
window.updateAdminUI = updateSessionUI;
window.updateSessionUI = updateSessionUI;
