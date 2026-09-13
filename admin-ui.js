// admin-ui.js — ממשק לוח הניהול: תפריט הנושאים, חלונות המשימה, בדיקת
// המערכת, הגיבוי, הניתוח, סל המחזור ויומן הפעילות.
//
// כל מה שכאן ישב קודם ב-app.js, ולכן ירד לדפדפן של כל מבקר בגלריה. מאז
// שהניהול עבר לדף נפרד (admin.html) המודול הזה נטען רק שם, ודף הגלריה
// אינו מוריד אותו כלל.
//
// המודול מסתמך על התשתית המשותפת שב-app.js (state, showNotification,
// openModal, showConfirm, r2Request וכו׳), ולכן admin-app.js טוען קודם
// אותה ורק אחר כך את הקובץ הזה.

const { checkAdminPermission, checkSuperAdminPermission, canViewSuperAdminData } = window;
const { openModal, closeModal, showConfirm, showNotification, scheduleIconRefresh } = window;
const { escapeHtml, safeRecordId, safeIconName, safeImageUrl, isVideoRecord, formatDate, formatBytes, r2Request } = window;
const R2_WORKER_BASE_URL = window.R2_WORKER_BASE_URL;

// --- שליחת דוא״ל מאובטחת דרך ה-Worker ---
window.sendDirectMail = function(recipientEmail, displayName) {
    if (!recipientEmail) {
        window.showNotification('אין כתובת מייל תקינה למשתמש זה.', false);
        return;
    }
    document.getElementById('directEmailTo').value = recipientEmail;
    document.getElementById('directEmailSubject').value = 'עדכון בנוגע לבקשת הגישה שלך לגלריית שמחת התורה';
    document.getElementById('directEmailBody').value = `שלום ${displayName || 'ידיד הישיבה'},

הבקשה שלך לגישה לגלריית שמחת התורה מעובדת כעת על ידי מנהלי המערכת.

בברכה,
צוות גלריית שמחת התורה`;
    openModal('directEmailModal');
};

window.submitDirectEmail = async function(event) {
    event?.preventDefault();
    if (!checkSuperAdminPermission()) return;
    const button = document.getElementById('directEmailSubmit');
    const payload = {
        to: document.getElementById('directEmailTo').value.trim(),
        subject: document.getElementById('directEmailSubject').value.trim(),
        text: document.getElementById('directEmailBody').value.trim()
    };
    if (button) button.disabled = true;
    try {
        await r2Request('/send-email', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        closeModal('directEmailModal');
        window.showNotification('הדוא״ל נשלח בהצלחה.', true);
        await window.logActivity('sent_email', 'user', '', payload.to, payload.subject);
    } catch (error) {
        window.showNotification(error.message || 'שליחת הדוא״ל נכשלה.', false);
    } finally {
        if (button) button.disabled = false;
    }
};

// סדר תפריט הניהול נשמר במקום אחד: כל פעולה שייכת לנושא אחד בלבד, והסדר כאן
// זהה לסדר הכרטיסים ב-index.html ולסדר adminTaskDefinitions שמזין את החיפוש.
const adminCategoryDefinitions = {
    gallery: {
        title: 'תמונות ותיקיות',
        description: 'כל הפעולות הקשורות לתוכן הגלריה במקום אחד',
        icon: 'images',
        actions: [
            { label: 'העלאת תמונות וסרטונים', description: 'העלאת קבצים בודדים או תיקייה שלמה', icon: 'cloud-upload', type: 'modal', target: 'userUploadModal' },
            { label: 'בקשות העלאה לאישור', description: 'בדיקה ואישור של קבצים שנשלחו ממשתמשים', icon: 'image-plus', type: 'task', target: 'accPending' },
            { label: 'סנכרון Google Drive', description: 'ייבוא תמונות, סרטונים ותיקיות מחשבון Drive', icon: 'folder-sync', type: 'task', target: 'accDriveSync' },
            { label: 'יצירת תיקייה חדשה', description: 'הוספת תיקייה חדשה וסמל מתאים לגלריה', icon: 'folder-plus', type: 'task', target: 'accEmptyFolder' },
            { label: 'ניהול ומחיקת מדיה', description: 'מעבר לגלריה להעברה בין תיקיות או למחיקה', icon: 'image-minus', type: 'gallery' },
            { label: 'בקשות מחיקה', description: 'אישור בקשות מחיקה שנשלחו ממנהלי דרגה 3', icon: 'trash-2', type: 'task', target: 'accDeletionRequests', superAdminOnly: true },
            { label: 'סל מחזור', description: 'שחזור תמונות ותיקיות או מחיקה סופית', icon: 'archive-restore', type: 'task', target: 'accTrash', superAdminOnly: true }
        ]
    },
    users: {
        title: 'משתמשים ותקשורת',
        description: 'ניהול חשבונות, הרשאות, הודעות ופניות',
        icon: 'users-round',
        superAdminOnly: true,
        actions: [
            { label: 'ניהול משתמשים ובקשות', description: 'אישור משתמשים, שינוי דרגות וחסימת חשבונות', icon: 'user-cog', type: 'task', target: 'accUserApprovals' },
            { label: 'שיחות ופניות', description: 'קריאת פניות והמשך שיחה עם משתמשים', icon: 'messages-square', type: 'messages' },
            { label: 'הודעת פופ-אפ', description: 'הצגת תמונה עם פנייה לתיקייה למבקרי האתר', icon: 'megaphone', type: 'task', target: 'accPopupAnnouncement' }
        ]
    },
    system: {
        title: 'פעילות ומערכת',
        description: 'מעקב אחר פעילות ובדיקת שירותי הגלריה',
        icon: 'activity',
        actions: [
            { label: 'מרכז פעילות', description: 'יומן הפעולות האחרונות ותמונת מצב ניהולית', icon: 'chart-no-axes-combined', type: 'task', target: 'accActivityCenter', superAdminOnly: true },
            { label: 'ניתוח נתונים מתקדם', description: 'צפיות, נפח אחסון, סוגי מדיה והפריטים המובילים', icon: 'chart-column-big', type: 'analytics', superAdminOnly: true },
            { label: 'גיבוי ושחזור', description: 'ייצוא נתוני הגלריה לקובץ ושחזור מגיבוי', icon: 'database-backup', type: 'modal', target: 'backupRestoreModal', superAdminOnly: true },
            { label: 'בדיקת תקינות המערכת', description: 'בדיקת Cloudflare, האחסון, זיהוי פנים ו־Drive', icon: 'shield-check', type: 'task', target: 'accSystemHealth' },
            { label: 'הכן חיפוש פנים בענן', description: 'סריקה חד־פעמית ששומרת טביעות פנים ומייתרת סריקה בכל חיפוש', icon: 'scan-face', type: 'task', target: 'accFaceIndex' }
        ]
    }
};

let activeAdminCategoryId = '';

window.closeAdminCategoryWindow = function() {
    activeAdminCategoryId = '';
    closeModal('adminCategoryModal');
};

window.openAdminCategory = function(categoryId) {
    if (!checkAdminPermission()) return;
    const definition = adminCategoryDefinitions[categoryId];
    if (!definition) return;
    if (definition.superAdminOnly && !checkSuperAdminPermission()) return;
    activeAdminCategoryId = categoryId;

    const title = document.getElementById('adminCategoryTitle');
    const description = document.getElementById('adminCategoryDescription');
    const icon = document.getElementById('adminCategoryIcon');
    const actionsContainer = document.getElementById('adminCategoryActions');
    if (!actionsContainer) return;

    if (title) title.textContent = definition.title;
    if (description) description.textContent = definition.description;
    if (icon) icon.innerHTML = `<i data-lucide="${definition.icon}" class="w-5 h-5"></i>`;

    actionsContainer.replaceChildren();
    definition.actions
        .filter(action => !action.superAdminOnly || window.state.isSuperAdmin)
        .forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'admin-category-action';

            const actionIcon = document.createElement('span');
            actionIcon.innerHTML = `<i data-lucide="${action.icon}" class="w-5 h-5"></i>`;
            const actionText = document.createElement('span');
            actionText.className = 'min-w-0 flex-1';
            const actionTitle = document.createElement('strong');
            actionTitle.textContent = action.label;
            const actionDescription = document.createElement('small');
            actionDescription.textContent = action.description;
            const arrow = document.createElement('i');
            arrow.setAttribute('data-lucide', 'arrow-left');
            arrow.className = 'w-4 h-4 text-slate-500 shrink-0';
            actionText.append(actionTitle, actionDescription);
            button.append(actionIcon, actionText, arrow);

            button.onclick = () => {
                closeModal('adminCategoryModal');
                if (action.type === 'modal') {
                    openModal(action.target);
                } else if (action.type === 'task') {
                    window.openAdminTaskWindow(action.target);
                } else if (action.type === 'messages') {
                    window.openAdminMessagesCenter();
                } else if (action.type === 'gallery') {
                    // ניהול המדיה עצמו נעשה על כרטיסי הגלריה, שנמצאים בדף האתר.
                    window.showNotification('מעבר לגלריה: בכרטיסי התמונות אפשר להעביר תיקייה או לבחור מחיקה.', true);
                    window.location.assign('./index.html');
                } else if (action.type === 'analytics') {
                    openModal('advancedAnalyticsModal');
                    window.loadAdvancedAnalytics();
                }
            };
            actionsContainer.appendChild(button);
        });

    openModal('adminCategoryModal');
    scheduleIconRefresh();
};

// החיפוש בתפריט הניהול מוצא כל משימת ניהול לפי שם או תיאור — גם משימות
// שאינן מוצגות ככרטיס בתפריט — ופותח אותה בלחיצה אחת.
function adminSearchableTasks() {
    return Object.entries(adminTaskDefinitions)
        .filter(([, definition]) => !definition.superAdminOnly || window.state.isSuperAdmin)
        .map(([id, definition]) => ({ id, ...definition }));
}

window.filterAdminMenu = function(value = '') {
    const panel = document.getElementById('sidebarAdminPanel');
    if (!panel) return;
    const query = String(value).trim().toLocaleLowerCase('he');
    const results = document.getElementById('adminMenuResults');
    const empty = document.getElementById('adminMenuNoResults');

    // הכרטיסים והקיצורים שבתפריט מסוננים במקום, כדי שהמבנה יישאר מוכר.
    let visibleMatches = 0;
    panel.querySelectorAll('.admin-topic-card, .admin-quick-grid button').forEach(item => {
        const matches = !query || item.textContent.toLocaleLowerCase('he').includes(query);
        item.classList.toggle('admin-search-hidden', !matches);
        if (matches && !item.classList.contains('hidden')) visibleMatches += 1;
    });

    if (!results) return;
    results.replaceChildren();
    if (!query) {
        results.classList.add('hidden');
        if (empty) empty.classList.add('hidden');
        return;
    }

    const matchedTasks = adminSearchableTasks().filter(task =>
        `${task.title} ${task.description}`.toLocaleLowerCase('he').includes(query)
    );
    matchedTasks.forEach(task => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-menu-result';
        button.onclick = () => window.openAdminTaskWindow(task.id);
        const icon = document.createElement('span');
        icon.className = 'admin-menu-result-icon';
        icon.innerHTML = `<i data-lucide="${safeIconName(task.icon)}" class="w-4 h-4"></i>`;
        const text = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = task.title;
        const description = document.createElement('small');
        description.textContent = task.description;
        text.append(title, description);
        button.append(icon, text);
        results.appendChild(button);
    });

    results.classList.toggle('hidden', matchedTasks.length === 0);
    if (empty) empty.classList.toggle('hidden', matchedTasks.length > 0 || visibleMatches > 0);
    scheduleIconRefresh();
};

window.clearAdminMenuSearch = function() {
    const input = document.getElementById('adminMenuSearch');
    if (input) {
        input.value = '';
        input.focus();
    }
    window.filterAdminMenu('');
};

// הסדר כאן הוא גם סדר תוצאות החיפוש בתפריט הניהול, ולכן הוא הולך לפי הנושאים:
// תוכן הגלריה, אחר כך משתמשים ותקשורת, ולבסוף כלי המערכת.
const adminTaskDefinitions = {
    accPending: {
        title: 'אישור תמונות',
        description: 'בחירת תמונות וסרטונים ממתינים והעברתם לגלריה',
        icon: 'images'
    },
    accDriveSync: {
        title: 'סנכרון Google Drive',
        description: 'ייבוא תמונות, סרטונים ותיקיות מחשבון Drive',
        icon: 'folder-sync'
    },
    accEmptyFolder: {
        title: 'יצירת תיקייה',
        description: 'הוספת תיקייה חדשה לארכיון',
        icon: 'folder-plus'
    },
    accDeletionRequests: {
        title: 'בקשות מחיקה',
        description: 'בדיקה ואישור של בקשות למחיקת תוכן',
        icon: 'trash-2',
        superAdminOnly: true
    },
    accTrash: {
        title: 'סל מחזור',
        description: 'שחזור פריטים או מחיקה סופית מהמערכת',
        icon: 'archive-restore',
        superAdminOnly: true
    },
    accUserApprovals: {
        title: 'ניהול משתמשים ובקשות',
        description: 'אישור משתמשים, שינוי דרגות וחסימת חשבונות',
        icon: 'users-round',
        superAdminOnly: true
    },
    accPopupAnnouncement: {
        title: 'הודעת פופ-אפ',
        description: 'ניהול תמונת הפופ-אפ שמוצגת למבקרי האתר',
        icon: 'megaphone',
        superAdminOnly: true
    },
    accActivityCenter: {
        title: 'מרכז פעילות',
        description: 'תמונת מצב ויומן הפעולות האחרונות במערכת',
        icon: 'activity',
        superAdminOnly: true
    },
    accSystemHealth: {
        title: 'בדיקת תקינות',
        description: 'בדיקת החיבורים והשירותים של הגלריה',
        icon: 'shield-check'
    },
    accFaceIndex: {
        title: 'הכן חיפוש פנים בענן',
        description: 'סריקה חד־פעמית של הגלריה ושמירת טביעות הפנים ב־D1',
        icon: 'scan-face'
    }
};
let activeAdminTask = null;

// app.js קורא לזה בסגירת חלון המשימה, ולכן הוא נחשף על window.
function restoreAdminTaskContent() {
    if (!activeAdminTask) return;
    const { content, parent, nextSibling } = activeAdminTask;
    content.classList.remove('active');
    if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(content, nextSibling);
    else parent.appendChild(content);
    activeAdminTask = null;
}
window.restoreAdminTaskContent = restoreAdminTaskContent;

window.closeAdminTaskWindow = function() {
    closeModal('adminTaskModal');
    if (activeAdminCategoryId) {
        window.openAdminCategory(activeAdminCategoryId);
    }
};

window.openAdminTaskWindow = function(contentId) {
    const definition = adminTaskDefinitions[contentId];
    const content = document.getElementById(contentId);
    const body = document.getElementById('adminTaskBody');
    if (!definition || !content || !body) return;
    if (definition.superAdminOnly) {
        if (!checkSuperAdminPermission()) return;
    } else if (!checkAdminPermission()) {
        return;
    }

    restoreAdminTaskContent();
    activeAdminTask = {
        content,
        parent: content.parentNode,
        nextSibling: content.nextSibling
    };
    body.replaceChildren(content);
    content.classList.add('active');

    const title = document.getElementById('adminTaskTitle');
    const description = document.getElementById('adminTaskDescription');
    const icon = document.getElementById('adminTaskIcon');
    if (title) title.textContent = definition.title;
    if (description) description.textContent = definition.description;
    if (icon) icon.innerHTML = `<i data-lucide="${definition.icon}" class="w-5 h-5"></i>`;

    openModal('adminTaskModal');

    if (contentId === 'accPending') window.renderPendingImages?.();
    if (contentId === 'accUserApprovals') {
        window.renderPendingUsers?.();
        window.renderManagedUsers?.();
        window.forceRefreshUsers?.();
    }
    if (contentId === 'accDeletionRequests') window.renderDeletionRequests?.();
    if (contentId === 'accActivityCenter') window.renderActivityLogs?.();
    if (contentId === 'accTrash') window.renderTrashItems?.();
    if (contentId === 'accSystemHealth') window.runSystemHealthCheck?.();
    if (contentId === 'accFaceIndex') {
        // renderFaceIndexPanel ו-refreshFaceIndexSummary מוגדרות רק בתוך
        // face-index.js, והוא נטען עצלה. בלי ההמתנה לטעינה שתי הקריאות
        // היו no-op, והלוח היה נתקע על "טוען את מצב האינדוקס…".
        window.ensureFaceIndexModule?.()
            .then(() => {
                window.renderFaceIndexPanel?.();
                return window.refreshFaceIndexSummary?.();
            })
            .catch(error => console.error('Face index module failed to load:', error));
    }
    if (contentId === 'accDriveSync') {
        window.restoreDriveConnection?.().then(() => window.loadDriveFolders?.()).catch(() => window.loadDriveFolders?.());
    }
    if (contentId === 'accPopupAnnouncement') window.renderPopupAnnouncementAdmin?.();
    scheduleIconRefresh();
};

window.runSystemHealthCheck = async function() {
    const container = document.getElementById('systemHealthResults');
    if (!container) return;
    container.innerHTML = '<p class="text-xs text-cyan-300 text-center py-3">בודק את שירותי המערכת…</p>';

    const checks = [
        {
            label: 'Cloudflare D1 והתחברות',
            run: async () => {
                if (!window.db) throw new Error('מסד הנתונים עדיין לא מחובר');
                if (!window.state.currentUser) throw new Error('אין משתמש מחובר');
                return 'מחובר';
            }
        },
        {
            label: 'הרשאות מסד הנתונים',
            run: async () => {
                if (!window.state.isSuperAdmin) return 'בדיקה מלאה זמינה למנהל־על';
                const { collection, getDocs } = window.firestoreModules;
                await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems'));
                return 'סל המחזור מורשה';
            }
        },
        {
            label: 'Cloudflare R2',
            run: async () => {
                const response = await fetch(`${R2_WORKER_BASE_URL}/health`);
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.bucketConnected !== true || payload.databaseConnected !== true) throw new Error(payload.message || 'האחסון אינו זמין');
                return 'R2 ו־D1 מחוברים';
            }
        },
        {
            label: 'זיהוי פנים',
            run: async () => typeof window.faceapi === 'undefined'
                ? 'ייטען בעת פתיחת חיפוש הפנים'
                : 'הספרייה נטענה'
        },
        {
            label: 'אינדוקס פנים בענן',
            run: async () => {
                // בלי טעינת המודול refreshFaceIndexSummary אינה קיימת,
                // והבדיקה הייתה מדווחת "אינו זמין" גם כשהאינדוקס תקין.
                await window.ensureFaceIndexModule?.();
                const summary = await window.refreshFaceIndexSummary?.();
                if (!summary) throw new Error('מצב האינדוקס אינו זמין');
                return summary.ready
                    ? `מוכן — ${summary.indexedImages} תמונות, ${summary.faceCount} פרצופים`
                    : `נותרו ${summary.remainingImages} תמונות להכנה`;
            }
        },
        {
            label: 'Google Drive',
            run: async () => window.driveConnectionActive ? 'מחובר כעת' : 'לא מחובר — חבר בעת הצורך'
        }
    ];

    const results = [];
    for (const check of checks) {
        try {
            results.push({ label: check.label, ok: true, message: await check.run() });
        } catch (error) {
            results.push({ label: check.label, ok: false, message: error.message || 'הבדיקה נכשלה' });
        }
    }
    container.replaceChildren();
    results.forEach(result => {
        const row = document.createElement('div');
        row.className = `flex items-center gap-3 rounded-xl border p-3 ${result.ok ? 'border-emerald-400/15 bg-emerald-400/5' : 'border-red-400/20 bg-red-400/5'}`;
        row.innerHTML = `<i data-lucide="${result.ok ? 'circle-check' : 'circle-alert'}" class="w-4 h-4 ${result.ok ? 'text-emerald-300' : 'text-red-300'}"></i>`;
        const text = document.createElement('div');
        text.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'text-[10px] font-bold text-slate-100';
        title.textContent = result.label;
        const detail = document.createElement('p');
        detail.className = `text-[9px] ${result.ok ? 'text-emerald-200/70' : 'text-red-200/70'}`;
        detail.textContent = result.message;
        text.append(title, detail);
        row.appendChild(text);
        container.appendChild(row);
    });
    scheduleIconRefresh();
};

let selectedBackupPayload = null;

window.exportGalleryBackup = function() {
    if (!checkSuperAdminPermission()) return;
    const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        appId: window.appId,
        folders: (window.state.folders || []).filter(folder => safeRecordId(folder.id) !== 'all'),
        images: window.state.images || [],
        pendingImages: window.state.pendingImages || [],
        userProfiles: window.state.allUsers || [],
        deletionRequests: window.state.deletionRequests || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `simchas-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(link.href);
    }, 100);
    window.showNotification('קובץ הגיבוי הורד בהצלחה.', true);
};

window.previewBackupFile = async function(input) {
    selectedBackupPayload = null;
    const status = document.getElementById('backupRestoreStatus');
    const submit = document.getElementById('backupRestoreSubmit');
    try {
        const file = input?.files?.[0];
        if (!file || file.size > 20 * 1024 * 1024) throw new Error('יש לבחור קובץ JSON תקין בגודל עד 20MB.');
        const payload = JSON.parse(await file.text());
        if (!Number.isFinite(payload.version) || !Array.isArray(payload.folders) || !Array.isArray(payload.images)) {
            throw new Error('מבנה קובץ הגיבוי אינו תקין.');
        }
        selectedBackupPayload = payload;
        if (status) status.textContent = `מוכן לשחזור: ${payload.folders.length} תיקיות ו־${payload.images.length} פריטי מדיה.`;
        if (submit) submit.disabled = false;
    } catch (error) {
        if (status) status.textContent = error.message || 'קריאת קובץ הגיבוי נכשלה.';
        if (submit) submit.disabled = true;
    }
};

window.restoreGalleryBackup = function(confirmed = false) {
    if (!checkSuperAdminPermission() || !selectedBackupPayload) return;
    if (!confirmed) {
        showConfirm('שחזור גיבוי', 'לשחזר את כל הנתונים שבקובץ? נתונים בעלי אותו מזהה יעודכנו, אך קבצים קיימים אחרים לא יימחקו.', () => window.restoreGalleryBackup(true));
        return;
    }
    (async () => {
        const status = document.getElementById('backupRestoreStatus');
        const { doc, setDoc } = window.firestoreModules;
        const base = ['artifacts', window.appId, 'public', 'data'];
        const collections = [
            ['folders', selectedBackupPayload.folders || [], 'id', false],
            ['images', selectedBackupPayload.images || [], 'id', false],
            ['pendingImages', selectedBackupPayload.pendingImages || [], 'id', false],
            ['userProfiles', selectedBackupPayload.userProfiles || [], 'uid', true],
            ['deletionRequests', selectedBackupPayload.deletionRequests || [], 'id', false]
        ];
        let restored = 0;
        for (const [collectionName, records, idField, merge] of collections) {
            for (const record of records.slice(0, 10000)) {
                const id = safeRecordId(record?.[idField]);
                if (!id || (collectionName === 'folders' && id === 'all')) continue;
                await setDoc(doc(window.db, ...base, collectionName, id), record, merge ? { merge: true } : undefined);
                restored++;
                if (status) status.textContent = `משחזר נתונים… ${restored} פריטים הושלמו`;
            }
        }
        if (status) status.textContent = `השחזור הושלם בהצלחה: ${restored} רשומות.`;
        await window.logActivity('restored_backup', 'system', '', 'גיבוי גלריה', `${restored} רשומות`);
        window.showNotification('שחזור הגיבוי הושלם.', true);
    })().catch(error => {
        document.getElementById('backupRestoreStatus').textContent = error.message || 'שחזור הגיבוי נכשל.';
        window.showNotification(error.message || 'שחזור הגיבוי נכשל.', false);
    });
};

window.openAnalyticsMedia = function(mediaId) {
    const id = safeRecordId(mediaId);
    if (!id || !(window.state.images || []).some(item => safeRecordId(item.id) === id)) {
        window.showNotification('הפריט הזה כבר אינו קיים בגלריה.', false);
        return;
    }
    closeModal('advancedAnalyticsModal');
    // התצוגה המלאה היא חלק מהגלריה. מדף הניהול פותחים את הפריט שם.
    if (typeof window.openLightbox === 'function') window.openLightbox(id);
    else window.location.assign(`./index.html#media-${encodeURIComponent(id)}`);
};

function renderAnalyticsMedia(stats) {
    const container = document.getElementById('advancedAnalyticsTop');
    const count = document.getElementById('advancedAnalyticsMediaCount');
    if (!container) return;

    const ordered = [...stats]
        .sort((first, second) => (Number(second.views) || 0) - (Number(first.views) || 0))
        .slice(0, 30);
    if (count) count.textContent = `${ordered.length} פריטים`;
    container.replaceChildren();

    if (!ordered.length) {
        const empty = document.createElement('p');
        empty.className = 'analytics-media-empty';
        empty.textContent = 'נתוני הצפייה יופיעו כאן לאחר פתיחת תמונות וסרטונים.';
        container.appendChild(empty);
        return;
    }

    const mediaById = new Map((window.state.images || []).map(item => [safeRecordId(item.id), item]));
    const foldersById = new Map((window.state.folders || []).map(folder => [safeRecordId(folder.id), folder]));
    ordered.forEach((entry, index) => {
        const id = safeRecordId(entry.id);
        const media = mediaById.get(id);
        const folder = media ? foldersById.get(safeRecordId(media.folderId)) : null;
        const isVideo = media ? isVideoRecord(media) : false;
        const previewUrl = media ? safeImageUrl(isVideo ? (media.thumbnailUrl || '') : media.url) : '';
        const card = document.createElement(media ? 'button' : 'article');
        if (media) card.type = 'button';
        card.className = `analytics-media-card${media ? '' : ' is-missing'}`;
        if (media) {
            card.onclick = () => window.openAnalyticsMedia(id);
            card.setAttribute('aria-label', `פתיחת ${media.title || 'פריט מדיה'}, ${Number(entry.views) || 0} צפיות`);
        }

        const preview = document.createElement('span');
        preview.className = 'analytics-media-preview';
        if (previewUrl) {
            const image = document.createElement('img');
            image.src = previewUrl;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.onerror = () => {
                image.remove();
                preview.classList.add('has-fallback');
            };
            preview.appendChild(image);
        } else {
            preview.classList.add('has-fallback');
        }
        const rank = document.createElement('span');
        rank.className = 'analytics-media-rank';
        rank.textContent = String(index + 1);
        const typeIcon = document.createElement('span');
        typeIcon.className = 'analytics-media-type';
        typeIcon.innerHTML = `<i data-lucide="${media ? (isVideo ? 'video' : 'image') : 'image-off'}" class="w-4 h-4"></i>`;
        preview.append(rank, typeIcon);

        const details = document.createElement('span');
        details.className = 'analytics-media-details';
        const title = document.createElement('strong');
        title.textContent = media?.title || 'פריט שנמחק מהגלריה';
        const folderName = document.createElement('small');
        folderName.textContent = media
            ? `${isVideo ? 'סרטון' : 'תמונה'} · ${folder?.name || 'ללא תיקייה'}`
            : `מזהה ישן: ${id || 'לא ידוע'}`;
        const lastViewed = document.createElement('small');
        lastViewed.className = 'analytics-media-last-viewed';
        lastViewed.textContent = entry.lastViewedAt
            ? `צפייה אחרונה: ${window.formatDate(entry.lastViewedAt)}`
            : 'אין תאריך צפייה';
        details.append(title, folderName, lastViewed);

        const views = document.createElement('span');
        views.className = 'analytics-media-views';
        const viewsNumber = document.createElement('strong');
        viewsNumber.textContent = String(Number(entry.views) || 0);
        const viewsLabel = document.createElement('small');
        viewsLabel.textContent = 'צפיות';
        views.append(viewsNumber, viewsLabel);
        card.append(preview, details, views);
        container.appendChild(card);
    });
    scheduleIconRefresh(container);
}

window.loadAdvancedAnalytics = async function() {
    if (!checkSuperAdminPermission()) return;
    const cards = document.getElementById('advancedAnalyticsCards');
    const top = document.getElementById('advancedAnalyticsTop');
    if (cards) cards.innerHTML = '<p class="text-xs text-slate-400">טוען…</p>';
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats'));
        const stats = snapshot.docs.map(entry => entry.data());
        const totalViews = stats.reduce((sum, entry) => sum + (Number(entry.views) || 0), 0);
        const videos = (window.state.images || []).filter(isVideoRecord).length;
        const storage = (window.state.images || []).reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        const values = [
            ['פריטי מדיה', window.state.images.length, 'images'],
            ['סרטונים', videos, 'video'],
            ['משתמשים', window.state.allUsers.length, 'users'],
            ['צפיות', totalViews, 'eye'],
            ['תיקיות', window.state.folders.filter(folder => folder.id !== 'all').length, 'folders'],
            ['נפח מקורי', formatBytes(storage), 'hard-drive'],
            ['מועדפים שלך', window.state.favorites.size, 'heart'],
            ['ממתינים לאישור', window.state.pendingImages.length, 'clock']
        ];
        if (cards) cards.innerHTML = values.map(([label, value, icon]) => `<div class="rounded-2xl border border-white/10 bg-white/5 p-4"><i data-lucide="${icon}" class="w-4 h-4 text-amber-300"></i><strong class="block text-2xl text-white mt-3">${escapeHtml(value)}</strong><span class="text-[10px] text-slate-400">${label}</span></div>`).join('');
        renderAnalyticsMedia(stats);
        scheduleIconRefresh();
    } catch (error) {
        if (top) top.textContent = error.message || 'טעינת הנתונים נכשלה.';
    }
};

window.renderTrashItems = function() {
    const list = document.getElementById('trashItemsList');
    const badge = document.getElementById('trashItemsCountBadge');
    // סל המחזור — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (badge) badge.textContent = '0';
        if (list) list.innerHTML = '';
        return;
    }
    const allItems = window.state.trashItems || [];
    const items = allItems.filter(item => !item.parentTrashGroupId);
    if (badge) badge.textContent = String(items.length);
    if (!list) return;
    list.innerHTML = '';
    if (!items.length) {
        list.innerHTML = '<p class="text-xs text-center text-slate-500 py-6">סל המחזור ריק.</p>';
        return;
    }
    const typeLabels = { image: 'תמונה', pendingImage: 'תמונה ממתינה', folder: 'תיקייה', user: 'משתמש' };
    items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'rounded-xl border border-orange-400/15 bg-orange-400/5 p-3 space-y-2';
        const title = document.createElement('p');
        title.className = 'text-[11px] font-bold text-slate-100';
        title.textContent = `${typeLabels[item.originalType] || 'פריט'} — ${item.targetName || item.originalId}`;
        const meta = document.createElement('p');
        meta.className = 'text-[9px] text-slate-400';
        meta.textContent = `${formatDate(item.deletedAt)} · נמחק על ידי ${item.deletedByName || 'מנהל־על'}`;
        const actions = document.createElement('div');
        actions.className = 'grid grid-cols-2 gap-2';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-bold';
        restore.textContent = 'שחזר';
        restore.onclick = () => window.restoreTrashItem(item.id);
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'py-2 rounded-lg border border-red-500/30 text-red-300 text-[10px] font-bold';
        purge.textContent = 'מחק לצמיתות';
        purge.onclick = () => window.purgeTrashItem(item.id);
        actions.append(restore, purge);
        card.append(title, meta, actions);
        list.appendChild(card);
    });
};

window.renderActivityLogs = function() {
    const list = document.getElementById('activityLogList');
    const summary = document.getElementById('activitySummary');
    // יומן הפעולות וסיכום המשימות הממתינות — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (summary) summary.innerHTML = '';
        if (list) list.innerHTML = '';
        return;
    }
    const logs = window.state.activityLogs || [];
    if (summary) {
        const cards = [
            ['users', (window.state.pendingUsers || []).length, 'הצטרפות'],
            ['image-plus', (window.state.pendingImages || []).length, 'לאישור'],
            ['trash-2', (window.state.deletionRequests || []).length, 'בקשות מחיקה'],
            ['archive-restore', (window.state.trashItems || []).length, 'בסל']
        ];
        summary.innerHTML = cards.map(([icon, value, label]) => `
            <div class="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                <i data-lucide="${icon}" class="w-4 h-4 mx-auto mb-1 text-cyan-300"></i>
                <strong class="block text-lg text-white">${value}</strong>
                <span class="text-[9px] text-slate-400">${label}</span>
            </div>`).join('');
    }
    if (!list) return;
    list.innerHTML = '';
    if (!logs.length) {
        list.innerHTML = '<p class="text-xs text-center text-slate-500 py-6">עדיין אין פעולות מתועדות.</p>';
    } else {
        const actionLabels = {
            moved_to_trash: 'העביר לסל המחזור',
            restored: 'שחזר פריט',
            purged: 'מחק לצמיתות',
            approved_user: 'אישר משתמש',
            changed_role: 'שינה דרגה',
            changed_block: 'שינה חסימה',
            approved_images: 'אישר תמונות',
            uploaded_images: 'העלה תמונות',
            synced_drive: 'סנכרן Drive',
            resolved_support: 'סימן פנייה כטופלה',
            reopened_support: 'פתח פנייה מחדש'
        };
        logs.slice(0, 50).forEach(log => {
            const row = document.createElement('article');
            row.className = 'rounded-xl border border-white/10 bg-white/5 p-3';
            const title = document.createElement('p');
            title.className = 'text-[11px] font-bold text-slate-100';
            title.textContent = `${log.actorName || 'משתמש'} — ${actionLabels[log.action] || log.action || 'פעולה'}`;
            const meta = document.createElement('p');
            meta.className = 'text-[9px] text-slate-400 mt-1';
            meta.textContent = `${log.targetName || log.targetId || ''}${log.details ? ` · ${log.details}` : ''} · ${formatDate(log.createdAt)}`;
            row.append(title, meta);
            list.appendChild(row);
        });
    }
    scheduleIconRefresh();
};
