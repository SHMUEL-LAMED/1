// admin-dashboard.js — מסך "סקירה כללית" בלוח הניהול: "ממתין לטיפול",
// הפעולות המהירות, נתוני הסקירה הנוספים (נפח ומשתמשים) ורענון הנתונים.
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (openModal, scheduleIconRefresh, safeIconName, formatBytes,
// canViewSuperAdminData, checkAdminPermission) נקראים מ-window בזמן הקריאה
// ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא ישבור אותם.

const QUICK_ACTIONS = [
    { label: 'העלאת מדיה', hint: 'תמונות וסרטונים חדשים', icon: 'cloud-upload', run: () => window.openModal('userUploadModal') },
    { label: 'אישור העלאות', hint: 'פריטים שממתינים לאישור', icon: 'image-plus', run: () => window.openAdminView('pending') },
    { label: 'סנכרון Drive', hint: 'משיכת תוכן חדש מהדרייב', icon: 'folder-sync', run: () => window.openAdminView('drive') },
    { label: 'תיקייה חדשה', hint: 'פתיחת אירוע חדש בארכיון', icon: 'folder-plus', run: () => window.openAdminView('folders') },
    { label: 'משתמשים', hint: 'אישור בקשות ושינוי דרגות', icon: 'users-round', superAdminOnly: true, run: () => window.openAdminView('users') },
    { label: 'מרכז ההודעות', hint: 'פניות ושליחת הודעות', icon: 'messages-square', superAdminOnly: true, run: () => window.openAdminMessagesCenter?.() },
    { label: 'מעבר לגלריה', hint: 'צפייה באתר כפי שהמשתמשים רואים אותו', icon: 'images', run: () => window.location.assign('./index.html') },
    { label: 'בדיקת תקינות', hint: 'ודאו שכל השירותים מחוברים', icon: 'shield-check', run: () => window.openAdminView('health') }
];

export function renderQuickActions() {
    const { safeIconName, scheduleIconRefresh } = window;
    const container = document.getElementById('adminQuickActions');
    if (!container) return;
    container.replaceChildren();
    QUICK_ACTIONS
        .filter(action => !action.superAdminOnly || window.state?.isSuperAdmin)
        .forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.onclick = action.run;
            button.innerHTML = `<i data-lucide="${safeIconName(action.icon)}"></i>`;
            const label = document.createTextNode(action.label);
            const hint = document.createElement('small');
            hint.textContent = action.hint;
            button.append(label, hint);
            container.appendChild(button);
        });
    scheduleIconRefresh(container);
}

// "ממתין לטיפול" הוא הסיבה העיקרית שמנהל נכנס ללוח, ולכן הוא הדבר הראשון
// שהוא רואה — עם קישור ישיר אל המסך שמטפל בו.
export function renderAdminAttention() {
    const { safeIconName, scheduleIconRefresh } = window;
    const container = document.getElementById('adminAttentionList');
    if (!container) return;
    const isSuper = Boolean(window.state?.isSuperAdmin);

    const items = [
        {
            count: (window.state.pendingImages || []).length,
            label: 'פריטים ממתינים לאישור',
            hint: 'תמונות וסרטונים שהועלו וממתינים לבדיקה',
            icon: 'image-plus',
            view: 'pending'
        },
        isSuper && {
            count: (window.state.pendingUsers || []).length,
            label: 'בקשות הצטרפות',
            hint: 'משתמשים שמחכים לאישור ולבחירת דרגה',
            icon: 'user-plus',
            view: 'users'
        },
        isSuper && {
            count: (window.state.deletionRequests || []).length,
            label: 'בקשות מחיקה',
            hint: 'בקשות שנשלחו ממנהלי דרגה 3',
            icon: 'trash-2',
            view: 'deletions'
        },
        isSuper && {
            count: (window.state.allUsers || []).reduce((sum, user) => sum + (Number(user.adminUnreadCount) || 0), 0),
            label: 'הודעות שלא נקראו',
            hint: 'פניות ממשתמשים שממתינות למענה',
            icon: 'mail-warning',
            view: 'messages'
        },
        {
            count: Number(window.state.clientErrorsSummary?.last24h) || 0,
            label: 'שגיאות ביממה האחרונה',
            hint: 'תקלות שנרשמו באתר או בשרת וממתינות לטיפול',
            icon: 'bug',
            view: 'errors'
        }
    ].filter(Boolean).filter(item => item.count > 0);

    container.replaceChildren();

    if (!items.length) {
        const row = document.createElement('div');
        row.className = 'admin-attention-row';
        row.dataset.tone = 'ok';
        row.innerHTML = `<span class="admin-attention-icon"><i data-lucide="circle-check-big" class="w-4 h-4"></i></span>`;
        const text = document.createElement('div');
        text.innerHTML = '<strong>הכול מטופל</strong><small>אין כרגע פריטים שממתינים לך.</small>';
        row.appendChild(text);
        container.appendChild(row);
        scheduleIconRefresh(container);
        return;
    }

    items.forEach(item => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'admin-attention-row';
        row.onclick = () => window.openAdminView(item.view);
        row.innerHTML = `<span class="admin-attention-icon"><i data-lucide="${safeIconName(item.icon)}" class="w-4 h-4"></i></span>`;
        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('strong');
        title.textContent = item.label;
        const hint = document.createElement('small');
        hint.textContent = item.hint;
        text.append(title, hint);
        const count = document.createElement('span');
        count.className = 'admin-nav-count';
        count.textContent = String(item.count);
        row.append(text, count);
        container.appendChild(row);
    });
    scheduleIconRefresh(container);
}
window.renderAdminAttention = renderAdminAttention;

// מסך השגיאות (admin-errors.js) מרענן את מונה השגיאות שבתפריט. אם המעטפת
// כבר חושפת את הטעינה העצלה שלה (window.ensureAdminErrorsModule) משתמשים בה;
// אחרת המודול נטען מכאן — מופע מודול ES הוא יחיד לכל כתובת, ולכן אין כפילות.
let adminErrorsModulePromise = null;
function ensureAdminErrorsModule() {
    if (typeof window.ensureAdminErrorsModule === 'function') return window.ensureAdminErrorsModule();
    return (adminErrorsModulePromise ||= import('./admin-errors.js'));
}

// נתוני הסקירה שאינם נספרים ב-admin.js — נפח ומספר משתמשים.
export function updateAdminOverviewExtras() {
    const { formatBytes, canViewSuperAdminData } = window;
    const storage = document.getElementById('adminOverviewStorage');
    const members = document.getElementById('adminOverviewMembersCount');
    if (storage) {
        const bytes = (window.state.images || []).reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        storage.textContent = bytes ? formatBytes(bytes) : '—';
    }
    if (members) members.textContent = String(canViewSuperAdminData() ? (window.state.allUsers || []).length : 0);
    window.refreshAdminNavBadges?.();
    // מונה השגיאות שבתפריט מגיע מהשרת; המודול מרענן אותו לכל היותר פעם בדקה.
    if (window.canViewAdminData?.()) {
        ensureAdminErrorsModule()
            .then(() => window.refreshClientErrorsSummary?.())
            .catch(error => console.warn('Errors module failed to load:', error));
    }
}
window.updateAdminOverviewExtras = updateAdminOverviewExtras;

export async function refreshAdminData() {
    const { checkAdminPermission } = window;
    if (!checkAdminPermission()) return;
    try {
        await window.forceRefreshUsers?.();
    } catch (error) {
        console.warn('User refresh failed:', error);
    }
    window.updateAdminPanelUI?.();
    window.updateAdminOverviewExtras();
    // המסך הפעיל טוען את הנתונים שלו מחדש; את runViewHook(activeViewId) של
    // המעטפת חושף admin-ui.js כ-window.rerunActiveAdminView.
    window.rerunActiveAdminView?.();
    window.showNotification('הנתונים רועננו.', true);
}
window.refreshAdminData = refreshAdminData;

// ציור מסך הסקירה כולו — מה ש-runViewHook('dashboard') עשה במעטפת.
export function renderDashboard() {
    renderAdminAttention();
    renderQuickActions();
    window.updateAdminOverview?.();
}
