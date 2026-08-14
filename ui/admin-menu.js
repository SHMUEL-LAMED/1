// מגירת הניהול, קטגוריות, חלונות משימות וחיפוש בתפריט
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { checkAdminPermission, checkSuperAdminPermission } from '../core/permissions.js';
import { safeIconName } from '../core/utils.js';
import { scheduleIconRefresh } from './icons.js';
import { closeModal, openModal } from './modals.js';

export function toggleAdminDrawer() {
    const drawer = document.getElementById('adminDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const trigger = document.querySelector('.settings-trigger');
    if (!drawer || !overlay) return;
    const isOpen = drawer.classList.contains('translate-x-0');
    if (isOpen) {
        drawer.classList.remove('translate-x-0');
        drawer.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
        drawer.setAttribute('inert', '');
        overlay.setAttribute('aria-hidden', 'true');
        if (trigger) {
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus({ preventScroll: true });
        }
    } else {
        drawer.classList.remove('-translate-x-full');
        drawer.classList.add('translate-x-0');
        overlay.classList.remove('hidden');
        drawer.removeAttribute('inert');
        overlay.setAttribute('aria-hidden', 'false');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        if (window.updateAdminUI) window.updateAdminUI();
        const closeButton = drawer.querySelector('button');
        if (closeButton) requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
    }
    scheduleIconRefresh();
}

window.toggleAdminDrawer = toggleAdminDrawer;

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
            { label: 'סל מחזור', description: 'שחזור תמונות ותיקיות או מחיקה סופית', icon: 'archive-restore', type: 'task', target: 'accTrash', superAdminOnly: true },
            { label: 'הודעת פופ-אפ', description: 'הצגת תמונה עם פנייה לתיקייה למבקרי האתר', icon: 'megaphone', type: 'task', target: 'accPopupAnnouncement', superAdminOnly: true }
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
            { label: 'הודעת פופ-אפ', description: 'הצגת תמונה עם פנייה לתיקייה למבקרי האתר', icon: 'megaphone', type: 'task', target: 'accPopupAnnouncement', superAdminOnly: true }
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
            { label: 'הכן חיפוש פנים בענן', description: 'סריקה חד־פעמית ששומרת טביעות פנים ומייתרת סריקה בכל חיפוש', icon: 'scan-face', type: 'task', target: 'accFaceIndex' },
            { label: 'בדיקת תקינות המערכת', description: 'בדיקת Cloudflare, האחסון, זיהוי פנים ו־Drive', icon: 'shield-check', type: 'task', target: 'accSystemHealth' }
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
                    const drawer = document.getElementById('adminDrawer');
                    if (drawer && drawer.classList.contains('translate-x-0')) toggleAdminDrawer();
                    document.getElementById('photosGrid')?.scrollIntoView({ behavior: 'auto', block: 'start' });
                    window.showNotification('בכרטיסי התמונות אפשר להעביר תיקייה או לבחור מחיקה.', true);
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

const adminTaskDefinitions = {
    accUserApprovals: {
        title: 'ניהול משתמשים ובקשות',
        description: 'אישור משתמשים, שינוי דרגות וחסימת חשבונות',
        icon: 'users-round',
        superAdminOnly: true
    },
    accDeletionRequests: {
        title: 'בקשות מחיקה',
        description: 'בדיקה ואישור של בקשות למחיקת תוכן',
        icon: 'trash-2',
        superAdminOnly: true
    },
    accActivityCenter: {
        title: 'מרכז פעילות',
        description: 'תמונת מצב ויומן הפעולות האחרונות במערכת',
        icon: 'activity',
        superAdminOnly: true
    },
    accTrash: {
        title: 'סל מחזור',
        description: 'שחזור פריטים או מחיקה סופית מהמערכת',
        icon: 'archive-restore',
        superAdminOnly: true
    },
    accPending: {
        title: 'אישור תמונות',
        description: 'בחירת תמונות וסרטונים ממתינים והעברתם לגלריה',
        icon: 'images'
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
    accPopupAnnouncement: {
        title: 'הודעת פופ-אפ',
        description: 'ניהול תמונת הפופ-אפ שמוצגת למבקרי האתר',
        icon: 'megaphone',
        superAdminOnly: true
    }
};

let activeAdminTask = null;

export function restoreAdminTaskContent() {
    if (!activeAdminTask) return;
    const { content, parent, nextSibling } = activeAdminTask;
    content.classList.remove('active');
    if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(content, nextSibling);
    else parent.appendChild(content);
    activeAdminTask = null;
}

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
        window.renderFaceIndexPanel?.();
        window.refreshFaceIndexSummary?.();
    }
    if (contentId === 'accDriveSync') {
        window.restoreDriveConnection?.().then(() => window.loadDriveFolders?.()).catch(() => window.loadDriveFolders?.());
    }
    if (contentId === 'accPopupAnnouncement') window.renderPopupAnnouncementAdmin?.();
    scheduleIconRefresh();
};
