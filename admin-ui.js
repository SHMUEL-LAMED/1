// admin-ui.js — שכבת הממשק של לוח הניהול.
//
// הלוח בנוי כדשבורד עם ניווט קבוע: רשימת המסכים (ADMIN_VIEWS) היא המקור
// היחיד גם לתפריט, גם לחיפוש וגם לסדר. כל מסך קיים ב-admin.html פעם אחת
// בלבד, והמעבר בין מסכים הוא החלפת המסך הפעיל — לא העברת רכיבים בין
// הורים, כפי שהיה בגרסת "חלון המשימה". משם הגיעו הכפילויות והמסכים
// שנפתחו ריקים.
//
// המודול נשען על התשתית המשותפת שב-app.js (state, showNotification,
// openModal, showConfirm, r2Request), ולכן admin-app.js טוען קודם אותה.

import { pickCardSource } from './media-variants.js';
import { trashPurgeLabel } from './maintenance-model.js';
// ייצוא CSV שמנטרל נוסחאות (=, +, -, @) — שמות המשתמשים מגיעים מחשבונות Google.
import { csvText, userCsvRows } from './admin-users-model.js';
// עץ התיקיות והסדר הידני שלהן (folder-tree.js, manual-order.js).
import { FOLDER_MAX_DEPTH, buildFolderTree, compareFolders, parentChoices, subtreeCount, validateFolderMove } from './folder-tree.js';
import { chunkOrderChanges, moveItem, rankChanges } from './manual-order.js';

const { checkAdminPermission, checkSuperAdminPermission, canViewSuperAdminData } = window;
const { openModal, closeModal, showConfirm, scheduleIconRefresh } = window;
const { escapeHtml, safeRecordId, safeIconName, safeImageUrl, isVideoRecord, formatDate, formatBytes, r2Request } = window;
const R2_WORKER_BASE_URL = window.R2_WORKER_BASE_URL;

// ==========================================================================
// 1. רשימת המסכים — מקור אחד לתפריט, לחיפוש ולסדר
// ==========================================================================

const ADMIN_VIEWS = [
    {
        id: 'dashboard',
        group: 'סקירה',
        title: 'סקירה כללית',
        description: 'תמונת מצב מהירה של הגלריה ושל מה שממתין לטיפול.',
        icon: 'gauge',
        keywords: 'בית ראשי דשבורד סיכום מצב'
    },
    {
        id: 'guide',
        group: 'סקירה',
        title: 'מדריך למנהלים',
        description: 'איך עובדים עם הלוח: העלאות, Drive, אנשים, AI, הרשאות והכלים החדשים בגלריה.',
        icon: 'book-open',
        keywords: 'מדריך עזרה הסבר הוראות שאלות איך תיעוד'
    },
    {
        id: 'pending',
        group: 'תוכן הגלריה',
        title: 'אישור העלאות',
        description: 'בדיקה ואישור של תמונות וסרטונים שנשלחו ממשתמשים.',
        icon: 'image-plus',
        badge: () => (window.state.pendingImages || []).length,
        keywords: 'ממתינות בקשות תמונות אישור'
    },
    {
        id: 'drive',
        group: 'תוכן הגלריה',
        title: 'סנכרון Google Drive',
        description: 'ייבוא תמונות, סרטונים ותיקיות מחשבון Drive, ידנית או אוטומטית.',
        icon: 'folder-sync',
        keywords: 'דרייב סנכרון ייבוא אוטומטי'
    },
    {
        id: 'folders',
        group: 'תוכן הגלריה',
        title: 'תיקיות ואירועים',
        description: 'יצירת תיקייה חדשה, קישור הזמנה זמני לאירוע ומעבר מהיר לכל תיקייה בגלריה.',
        icon: 'folders',
        keywords: 'תיקייה אירוע יצירה הזמנה קישור מוזמנים'
    },
    {
        id: 'deletions',
        group: 'תוכן הגלריה',
        title: 'בקשות מחיקה',
        description: 'אישור בקשות מחיקה שנשלחו ממנהלי דרגה 3.',
        icon: 'trash-2',
        superAdminOnly: true,
        badge: () => (window.state.deletionRequests || []).length,
        keywords: 'מחיקה בקשות אישור'
    },
    {
        id: 'trash',
        group: 'תוכן הגלריה',
        title: 'סל מחזור',
        description: 'שחזור פריטים שנמחקו או מחיקה סופית שלהם.',
        icon: 'archive-restore',
        superAdminOnly: true,
        keywords: 'אשפה שחזור מחיקה סופית'
    },
    {
        id: 'downloads',
        group: 'תוכן הגלריה',
        title: 'הורדות ופרטיות',
        description: 'הסרת המיקום ונתוני המצלמה מקבצים שיורדים, וסימן מים לצופים.',
        icon: 'shield-check',
        superAdminOnly: true,
        keywords: 'הורדה מיקום gps exif פרטיות סימן מים watermark zip'
    },
    {
        id: 'users',
        group: 'תקשורת ואנשים',
        title: 'משתמשים והרשאות',
        description: 'אישור בקשות הצטרפות, שינוי דרגות וחסימת חשבונות.',
        icon: 'users-round',
        superAdminOnly: true,
        badge: () => (window.state.pendingUsers || []).length,
        keywords: 'משתמשים דרגות הרשאות חסימה הצטרפות'
    },
    {
        id: 'messages',
        group: 'תקשורת ואנשים',
        title: 'הודעות ופניות',
        description: 'קריאת פניות ממשתמשים ושליחת הודעות לכל מי שרשום באתר.',
        icon: 'messages-square',
        superAdminOnly: true,
        keywords: 'צאט שיחות פניות הודעות דיוור'
    },
    {
        id: 'popup',
        group: 'תקשורת ואנשים',
        title: 'הודעת פופ-אפ',
        description: 'תמונה שמוצגת למבקרי האתר, והיעד שאליו הלחיצה מפנה.',
        icon: 'megaphone',
        superAdminOnly: true,
        keywords: 'פופאפ הודעה מודעה באנר'
    },
    {
        id: 'activity',
        group: 'כלי מערכת',
        title: 'מרכז פעילות',
        description: 'יומן הפעולות האחרונות ותמונת מצב ניהולית.',
        icon: 'activity',
        superAdminOnly: true,
        keywords: 'לוג יומן פעולות היסטוריה'
    },
    {
        id: 'analytics',
        group: 'כלי מערכת',
        title: 'ניתוח נתונים',
        description: 'צפיות, נפח אחסון, סוגי מדיה והפריטים המובילים.',
        icon: 'chart-column-big',
        superAdminOnly: true,
        keywords: 'סטטיסטיקה צפיות נתונים אנליטיקס'
    },
    {
        id: 'stats',
        group: 'כלי מערכת',
        title: 'סטטיסטיקות',
        description: 'ביקורים, צפיות, הורדות, העלאות ומשתמשים פעילים לאורך זמן, ואחסון ועלויות.',
        icon: 'chart-line',
        superAdminOnly: true,
        keywords: 'סטטיסטיקה גרף ביקורים צפיות הורדות העלאות משתמשים פעילים אחסון עלות נפח r2 d1 מכסה'
    },
    {
        id: 'backup',
        group: 'כלי מערכת',
        title: 'גיבוי ושחזור',
        description: 'ייצוא נתוני הגלריה לקובץ, ושחזור מגיבוי קיים.',
        icon: 'database-backup',
        superAdminOnly: true,
        keywords: 'גיבוי שחזור ייצוא json'
    },
    {
        id: 'health',
        group: 'כלי מערכת',
        title: 'תקינות המערכת',
        description: 'בדיקת Cloudflare, האחסון, זיהוי הפנים וחיבור Drive.',
        icon: 'shield-check',
        keywords: 'בדיקה תקינות שרת חיבור'
    },
    {
        id: 'brokenlinks',
        group: 'כלי מערכת',
        title: 'קישורים שבורים',
        description: 'תמונות שהקובץ שלהן חסר באחסון, וקבצים באחסון שאין להם רשומה. בדיקה יומית, בלי מחיקה.',
        icon: 'unlink',
        superAdminOnly: true,
        keywords: 'קישור שבור חסר יתום קובץ אחסון r2 בדיקה'
    },
    {
        id: 'errors',
        group: 'כלי מערכת',
        title: 'שגיאות ותקלות',
        description: 'שגיאות שנרשמו באתר ובשרת, מקובצות לפי סוג, לטיפול ולמעקב.',
        icon: 'bug',
        // המונה הוא נתון ניהולי שמגיע מהשרת: נכתב רק למי שמורשה, אפס לכל אחד אחר.
        badge: () => (window.canViewAdminData?.() ? Number(window.state.clientErrorsSummary?.last24h) || 0 : 0),
        keywords: 'שגיאות תקלות באגים ניטור יומן שגיאה'
    },
    {
        id: 'faceindex',
        group: 'כלי מערכת',
        title: 'אנשים, פרצופים ואינדוקס',
        description: 'קיבוץ אוטומטי של פרצופים לאנשים, אישור ושמות, תור לבדיקה, איחוד ידני והכנת חיפוש פנים.',
        icon: 'scan-face',
        keywords: 'פנים אינדוקס חיפוש ai אנשים שמות קיבוץ אלבום'
    },
    {
        id: 'variants',
        group: 'כלי מערכת',
        title: 'תצוגות מקדימות',
        description: 'יצירת תמונות מוקטנות ופוסטרים לסרטונים עבור המדיה הקיימת, כדי שהגלריה תיטען מהר.',
        icon: 'images',
        keywords: 'תצוגה מקדימה ממוזערות thumbnails webp פוסטר סרטון מהירות'
    },
    {
        id: 'capturedates',
        group: 'כלי מערכת',
        title: 'תאריכי צילום',
        description: 'השלמת תאריך הצילום (EXIF או הסרטון) למדיה שהועלתה לפני כן, למיון ולתאריך העברי.',
        icon: 'calendar-clock',
        keywords: 'תאריך צילום exif מיון תאריך עברי takenAt השלמה'
    },
    {
        id: 'aititles',
        group: 'כלי מערכת',
        title: 'שמות, כיתובים ותגיות עם AI',
        description: 'שם, כיתוב קצר ותגיות של סוג הרגע לכל תמונה.',
        icon: 'sparkles',
        keywords: 'שמות תמונות בינה מלאכותית ai כיתוב תיאור תגיות סצנה סוג הרגע'
    },
    {
        id: 'tools',
        group: 'כלי מערכת',
        title: 'תחזוקה ואבחון',
        description: 'ניקוי מטמון, נתוני אבחון וטעינה מחדש של הלוח.',
        icon: 'wrench',
        keywords: 'מטמון cache אבחון תחזוקה'
    }
];

const VIEW_GROUPS = ['סקירה', 'תוכן הגלריה', 'תקשורת ואנשים', 'כלי מערכת'];

// מקטעי התפריט שבצד: "סקירה כללית" בראש בלי כותרת, ואחריה תוכן / אנשים /
// תחזוקה / הגדרות / מדריך. זו חלוקה של התצוגה בלבד — רשימת המסכים, הסדר שלה
// והקבוצות (VIEW_GROUPS, שנבדקות ב-admin-menu-order.test.mjs) נשארים כפי
// שהם. מסך חדש שאינו מופיע כאן נכנס למקטע לפי הקבוצה שלו (NAV_SECTION_BY_GROUP).
const NAV_SECTIONS = [
    { id: 'home', label: '' },
    { id: 'content', label: 'תוכן' },
    { id: 'people', label: 'אנשים' },
    { id: 'maintenance', label: 'תחזוקה' },
    { id: 'settings', label: 'הגדרות' },
    { id: 'guide', label: 'מדריך' }
];
const NAV_SECTION_BY_VIEW = {
    dashboard: 'home',
    guide: 'guide',
    pending: 'content', drive: 'content', folders: 'content', deletions: 'content', trash: 'content',
    aititles: 'content', capturedates: 'content', variants: 'content',
    users: 'people', messages: 'people', faceindex: 'people',
    activity: 'maintenance', analytics: 'maintenance', stats: 'maintenance', backup: 'maintenance', health: 'maintenance',
    brokenlinks: 'maintenance', errors: 'maintenance', tools: 'maintenance',
    downloads: 'settings', popup: 'settings'
};
const NAV_SECTION_BY_GROUP = { 'סקירה': 'home', 'תוכן הגלריה': 'content', 'תקשורת ואנשים': 'people', 'כלי מערכת': 'maintenance' };

function navSectionOf(view) {
    return NAV_SECTION_BY_VIEW[view.id] || NAV_SECTION_BY_GROUP[view.group] || 'maintenance';
}

function viewById(id) {
    return ADMIN_VIEWS.find(view => view.id === id);
}

function viewIsAllowed(view) {
    return !view.superAdminOnly || Boolean(window.state?.isSuperAdmin);
}

function allowedViews() {
    return ADMIN_VIEWS.filter(viewIsAllowed);
}

// המדריך (admin-guide-ui.js) מציג "מעבר למסך" רק למסכים שהמנהל רשאי לפתוח,
// ולכן הוא שואל כאן — רשימת המסכים נשארת במקום אחד.
window.adminViewInfo = function(viewId) {
    const view = viewById(viewId);
    return view ? { id: view.id, title: view.title, allowed: viewIsAllowed(view) } : null;
};

// ==========================================================================
// 2. הניווט
// ==========================================================================

let activeViewId = 'dashboard';

function renderAdminNav() {
    const nav = document.getElementById('adminNav');
    if (!nav) return;
    nav.replaceChildren();

    NAV_SECTIONS.forEach(section => {
        const views = allowedViews().filter(view => navSectionOf(view) === section.id);
        if (!views.length) return;

        if (section.label) {
            const label = document.createElement('p');
            label.className = 'admin-nav-label';
            label.dataset.navSection = section.id;
            label.textContent = section.label;
            nav.appendChild(label);
        }

        views.forEach(view => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-nav-item ${view.id === activeViewId ? 'is-active' : ''}`;
            button.dataset.viewTarget = view.id;
            button.onclick = () => window.openAdminView(view.id);

            const icon = document.createElement('span');
            icon.innerHTML = `<i data-lucide="${safeIconName(view.icon)}" class="w-4 h-4"></i>`;
            const text = document.createElement('span');
            text.textContent = view.title;
            const count = document.createElement('span');
            count.className = 'admin-nav-count';
            count.dataset.viewBadge = view.id;
            count.dataset.empty = 'true';
            count.textContent = '0';

            button.append(icon.firstChild || icon, text, count);
            nav.appendChild(button);
        });
    });

    refreshAdminNavBadges();
    scheduleIconRefresh(nav);
}

// המונים בתפריט נקראים מאותו state שמזין את הכרטיסים, ולכן הם מתעדכנים
// בכל ציור מחדש בלי מקור נתונים נוסף.
function refreshAdminNavBadges() {
    ADMIN_VIEWS.forEach(view => {
        const badge = document.querySelector(`[data-view-badge="${view.id}"]`);
        if (!badge) return;
        const value = typeof view.badge === 'function' && viewIsAllowed(view) ? Number(view.badge()) || 0 : 0;
        badge.textContent = String(value);
        badge.dataset.empty = value > 0 ? 'false' : 'true';
    });
}
window.refreshAdminNavBadges = refreshAdminNavBadges;

window.openAdminView = function(viewId) {
    const view = viewById(viewId) || viewById('dashboard');
    if (!view) return;
    if (view.superAdminOnly && !checkSuperAdminPermission()) return;
    if (!checkAdminPermission()) return;

    activeViewId = view.id;

    document.querySelectorAll('.admin-view').forEach(section => {
        section.classList.toggle('is-active', section.dataset.view === view.id);
    });
    document.querySelectorAll('[data-view-target]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.viewTarget === view.id);
    });

    const title = document.getElementById('adminViewTitle');
    const description = document.getElementById('adminViewDescription');
    const icon = document.getElementById('adminViewIcon');
    if (title) title.textContent = view.title;
    if (description) description.textContent = view.description;
    if (icon) icon.innerHTML = `<i data-lucide="${safeIconName(view.icon)}" class="w-5 h-5"></i>`;

    try {
        // #guide/<סעיף> נשאר כמו שהוא כשהמדריך נפתח שוב: הסעיף הוא חלק מהמסך.
        if (window.location.hash.split('/')[0] !== `#${view.id}`) {
            window.history.replaceState(null, '', `#${view.id}`);
        }
    } catch (error) {
        // דפדפן שחוסם replaceState אינו סיבה לעצור את המעבר בין המסכים.
    }

    runViewHook(view.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    scheduleIconRefresh();
};

// מסך השגיאות חי במודול נפרד, שנטען בפעם הראשונה שצריך אותו: בפתיחת
// המסך, או כשהלוח מרענן את מונה השגיאות שבתפריט.
let adminErrorsModulePromise = null;
function ensureAdminErrorsModule() {
    return (adminErrorsModulePromise ||= import('./admin-errors.js'));
}

// מסך "סטטיסטיקות" (מנהל־על) נטען רק כשנפתח: הגרפים, הטבלאות ו"אחסון ועלויות".
let adminStatsModulePromise = null;
function ensureAdminStatsModule() {
    return (adminStatsModulePromise ||= import('./admin-stats.js'));
}

// הבחירה המרובה וההערות הפנימיות במסך המשתמשים נטענות רק כשהמסך נפתח. הכפתורים
// שב-admin.html קוראים לעטיפות האלה, שמושכות את המודול לפני הקריאה.
let usersBulkModulePromise = null;
function ensureUsersBulkModule() {
    return (usersBulkModulePromise ||= import('./admin-users-bulk.js'));
}
function lazyAdminHandlers(ensure, names, label) {
    for (const name of names) {
        window[name] = (...args) => ensure()
            .then(module => module[name](...args))
            .catch(error => {
                console.error(`${label} module failed to load:`, error);
                window.showNotification('טעינת הרכיב נכשלה. נסה שוב.', false);
            });
    }
}
lazyAdminHandlers(ensureUsersBulkModule, ['selectVisibleUsers', 'clearUserSelection', 'runUsersBulkAction', 'openUserNotes', 'closeUserNotes', 'addUserNote'], 'Users bulk');
lazyAdminHandlers(ensureAdminStatsModule, ['loadAdminStats', 'setAdminStatsRange', 'saveStorageBudget'], 'Stats');

// קישורי ההזמנה לאירוע נטענים רק בפתיחת מסך התיקיות.
let invitesModulePromise = null;
function ensureInvitesModule() {
    return (invitesModulePromise ||= import('./invites-admin.js'));
}

// הגיבויים היומיים והקישורים השבורים (מנהל־על) נטענים רק כשאחד המסכים נפתח.
let maintenanceModulePromise = null;
function ensureMaintenanceModule() {
    return (maintenanceModulePromise ||= import('./maintenance-admin.js'));
}

// גם המדריך למנהלים נטען רק כשפותחים אותו. הסעיף המבוקש מקישור "?" במסך
// אחר נשמר עד שהמודול מגיע; בלעדיו נפתח הסעיף שבכתובת #guide/<מזהה>.
let adminGuideModulePromise = null;
let pendingGuideSection = '';
function ensureAdminGuideModule() {
    return (adminGuideModulePromise ||= import('./admin-guide-ui.js'));
}

function guideSectionFromHash() {
    const [viewPart, ...sectionPart] = String(window.location.hash || '').replace('#', '').split('/');
    return viewPart === 'guide' ? sectionPart.join('/') : '';
}

window.openAdminGuide = function(sectionId = '') {
    pendingGuideSection = String(sectionId || '');
    window.openAdminView('guide');
};

// כל מסך טוען את הנתונים שלו ברגע שנפתח, ולא בטעינת הדף. כך הלוח נפתח מיד
// ואינו מושך מידע שאיש אינו מסתכל עליו.
function runViewHook(viewId) {
    if (viewId === 'dashboard') {
        window.renderAdminAttention();
        renderQuickActions();
        window.updateAdminOverview?.();
    }
    if (viewId === 'guide') {
        const requested = Boolean(pendingGuideSection);
        const section = pendingGuideSection || guideSectionFromHash();
        pendingGuideSection = '';
        ensureAdminGuideModule()
            .then(module => module.renderAdminGuide({ section, requested }))
            .catch(error => {
                console.error('Admin guide module failed to load:', error);
                const root = document.getElementById('adminGuideRoot');
                if (root) root.textContent = 'לא ניתן לטעון את המדריך. רענן ונסה שוב.';
            });
    }
    if (viewId === 'pending') window.renderPendingImages?.();
    if (viewId === 'users') {
        window.renderPendingUsers?.();
        window.renderManagedUsers?.();
        window.forceRefreshUsers?.();
        if (window.state?.isSuperAdmin) {
            ensureUsersBulkModule()
                .then(module => {
                    module.decorateUserCards(document.getElementById('pendingUsersList'));
                    module.decorateUserCards(document.getElementById('managedUsersList'));
                })
                .catch(error => console.error('Users bulk module failed to load:', error));
        }
    }
    if (viewId === 'stats' && window.state?.isSuperAdmin) window.loadAdminStats();
    if (viewId === 'folders') {
        window.renderAdminFolders();
        // קישורי ההזמנה לאירוע נטענים רק כשהמסך נפתח.
        ensureInvitesModule()
            .then(module => module.loadInvites())
            .catch(error => console.error('Invites module failed to load:', error));
    }
    if (viewId === 'deletions') window.renderDeletionRequests?.();
    if (viewId === 'trash') window.renderTrashItems?.();
    if (viewId === 'activity') window.renderActivityLogs?.();
    if (viewId === 'analytics') window.loadAdvancedAnalytics?.();
    if (viewId === 'health') window.runSystemHealthCheck?.();
    if ((viewId === 'backup' || viewId === 'brokenlinks') && window.state?.isSuperAdmin) {
        ensureMaintenanceModule()
            .then(() => (viewId === 'backup' ? window.loadCloudBackups?.() : window.loadBrokenLinksReport?.()))
            .catch(error => console.error('Maintenance module failed to load:', error));
    }
    if (viewId === 'errors') {
        ensureAdminErrorsModule()
            .then(() => window.loadClientErrors?.())
            .catch(error => console.error('Errors module failed to load:', error));
    }
    if (viewId === 'messages') window.renderAdminMessageReplies?.();
    if (viewId === 'popup') window.renderPopupAnnouncementAdmin?.();
    if (viewId === 'downloads') window.renderDownloadPrivacyAdmin?.();
    if (viewId === 'drive') {
        window.restoreDriveConnection?.()
            .then(() => window.loadDriveFolders?.())
            .catch(() => window.loadDriveFolders?.());
    }
    if (viewId === 'faceindex') {
        import('./face-people.js').then(module => { module.openPeopleManager(); module.openFacePeople(); })
            .catch(() => { document.getElementById('facePeopleStatus').textContent = 'לא ניתן לטעון את ניהול הפרצופים. רענן ונסה שוב.'; });
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
    if (['faceindex', 'capturedates', 'aititles', 'variants', 'drive'].includes(viewId)) {
        setTimeout(() => window.refreshCloudBackgroundJobs?.(), 1500);
    }
    if (viewId === 'capturedates') {
        // גם מודול תאריכי הצילום נטען עצלה, רק כשהמסך נפתח.
        window.ensureCaptureDatesModule?.()
            .then(() => {
                window.renderCaptureDatesPanel?.();
                return window.refreshCaptureDatesSummary?.();
            })
            .catch(error => console.error('Capture dates module failed to load:', error));
    }
    if (viewId === 'aititles') {
        import('./ai-titles-admin.js').then(module => module.openAiTitles()).catch(() => {
            document.getElementById('aiTitlesStatus').textContent = 'לא ניתן לטעון את הכלי. רענן ונסה שוב.';
        });
    }
    if (viewId === 'variants') {
        // גם מודול התצוגות נטען עצלה; המונה והכפתורים מצוירים רק אחרי שהוא הגיע.
        window.ensureMediaVariantsModule?.()
            .then(() => {
                window.renderMediaVariantsPanel?.();
                return window.refreshMediaVariantsSummary?.();
            })
            .catch(error => console.error('Media variants module failed to load:', error));
    }
}

// שמות ישנים שנשארו בקריאות אחרות בקוד. שניהם מובילים למסך המתאים, ולכן
// אין יותר שני מסלולים שונים לאותו תוכן.
const LEGACY_TASK_TO_VIEW = {
    accPending: 'pending',
    accDriveSync: 'drive',
    accEmptyFolder: 'folders',
    accDeletionRequests: 'deletions',
    accTrash: 'trash',
    accUserApprovals: 'users',
    accPopupAnnouncement: 'popup',
    accActivityCenter: 'activity',
    accSystemHealth: 'health',
    accFaceIndex: 'faceindex'
};
window.openAdminTaskWindow = function(contentId) {
    window.openAdminView(LEGACY_TASK_TO_VIEW[contentId] || contentId);
};
window.openAdminCategory = function(categoryId) {
    const map = { gallery: 'pending', users: 'users', system: 'activity' };
    window.openAdminView(map[categoryId] || 'dashboard');
};
window.closeAdminTaskWindow = function() {};
window.closeAdminCategoryWindow = function() {};

// ==========================================================================
// 3. חיפוש בתפריט
// ==========================================================================

window.filterAdminMenu = function(value = '') {
    const query = String(value).trim().toLocaleLowerCase('he');
    const results = document.getElementById('adminMenuResults');
    const empty = document.getElementById('adminMenuNoResults');
    const nav = document.getElementById('adminNav');

    if (!query) {
        if (results) { results.replaceChildren(); results.classList.add('hidden'); }
        if (empty) empty.classList.add('hidden');
        if (nav) nav.classList.remove('hidden');
        return;
    }

    const matches = allowedViews().filter(view =>
        `${view.title} ${view.description} ${view.keywords || ''}`.toLocaleLowerCase('he').includes(query)
    );

    if (nav) nav.classList.toggle('hidden', matches.length > 0);
    if (!results) return;

    results.replaceChildren();
    matches.forEach(view => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-menu-result';
        button.onclick = () => {
            window.openAdminView(view.id);
            window.clearAdminMenuSearch();
        };
        const icon = document.createElement('span');
        icon.className = 'admin-menu-result-icon';
        icon.innerHTML = `<i data-lucide="${safeIconName(view.icon)}" class="w-4 h-4"></i>`;
        const text = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = view.title;
        const description = document.createElement('small');
        description.textContent = view.description;
        text.append(title, description);
        button.append(icon, text);
        results.appendChild(button);
    });

    results.classList.toggle('hidden', matches.length === 0);
    if (empty) empty.classList.toggle('hidden', matches.length > 0);
    scheduleIconRefresh(results);
};

window.clearAdminMenuSearch = function() {
    const input = document.getElementById('adminMenuSearch');
    if (input) input.value = '';
    window.filterAdminMenu('');
};

// ==========================================================================
// 4. מסך הסקירה
// ==========================================================================

const QUICK_ACTIONS = [
    { label: 'העלאת מדיה', hint: 'תמונות וסרטונים חדשים', icon: 'cloud-upload', run: () => openModal('userUploadModal') },
    { label: 'אישור העלאות', hint: 'פריטים שממתינים לאישור', icon: 'image-plus', run: () => window.openAdminView('pending') },
    { label: 'סנכרון Drive', hint: 'משיכת תוכן חדש מהדרייב', icon: 'folder-sync', run: () => window.openAdminView('drive') },
    { label: 'תיקייה חדשה', hint: 'פתיחת אירוע חדש בארכיון', icon: 'folder-plus', run: () => window.openAdminView('folders') },
    { label: 'משתמשים', hint: 'אישור בקשות ושינוי דרגות', icon: 'users-round', superAdminOnly: true, run: () => window.openAdminView('users') },
    { label: 'מרכז ההודעות', hint: 'פניות ושליחת הודעות', icon: 'messages-square', superAdminOnly: true, run: () => window.openAdminMessagesCenter?.() },
    { label: 'מעבר לגלריה', hint: 'צפייה באתר כפי שהמשתמשים רואים אותו', icon: 'images', run: () => window.location.assign('./index.html') },
    { label: 'בדיקת תקינות', hint: 'ודאו שכל השירותים מחוברים', icon: 'shield-check', run: () => window.openAdminView('health') }
];

function renderQuickActions() {
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
window.renderAdminAttention = function() {
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
};

// נתוני הסקירה שאינם נספרים ב-admin.js — נפח ומספר משתמשים.
window.updateAdminOverviewExtras = function() {
    const storage = document.getElementById('adminOverviewStorage');
    const members = document.getElementById('adminOverviewMembersCount');
    if (storage) {
        const bytes = (window.state.images || []).reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        storage.textContent = bytes ? formatBytes(bytes) : '—';
    }
    if (members) members.textContent = String(canViewSuperAdminData() ? (window.state.allUsers || []).length : 0);
    refreshAdminNavBadges();
    // מונה השגיאות שבתפריט מגיע מהשרת; המודול מרענן אותו לכל היותר פעם בדקה.
    if (window.canViewAdminData?.()) {
        ensureAdminErrorsModule()
            .then(() => window.refreshClientErrorsSummary?.())
            .catch(error => console.warn('Errors module failed to load:', error));
    }
};

window.refreshAdminData = async function() {
    if (!checkAdminPermission()) return;
    try {
        await window.forceRefreshUsers?.();
    } catch (error) {
        console.warn('User refresh failed:', error);
    }
    window.updateAdminPanelUI?.();
    window.updateAdminOverviewExtras();
    runViewHook(activeViewId);
    window.showNotification('הנתונים רועננו.', true);
};

// ==========================================================================
// 5. תיקיות
// ==========================================================================

window.renderAdminFolders = function() {
    const list = document.getElementById('adminFolderList');
    if (!list) return;
    list.replaceChildren();
    // תיקיית האב של תיקייה חדשה בטופס שמעל הרשימה מתעדכנת יחד איתה.
    window.populateFolderSelects?.();
    const tree = buildFolderTree(window.state.folders || []);

    if (!tree.byId.size) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'עדיין אין תיקיות בגלריה.';
        list.appendChild(empty);
        return;
    }

    // בדף הניהול כל התמונות בזיכרון, ולכן המונים נספרים כאן.
    const ownCounts = {};
    for (const image of window.state.images || []) {
        const folderId = safeRecordId(image.folderId);
        if (folderId) ownCounts[folderId] = (ownCounts[folderId] || 0) + 1;
    }
    const canEdit = Boolean(window.state.isAdminLoggedIn);

    // שורה לכל תיקייה, לפי סדר העץ; ההזחה לפי העומק (data-depth).
    const renderRow = (folderId, depth, siblings) => {
        const folder = tree.get(folderId);
        const own = ownCounts[folderId] || 0;
        const total = subtreeCount(tree, folderId, ownCounts);

        const row = document.createElement('div');
        row.className = 'admin-row admin-folder-row';
        row.dataset.folderId = folderId;
        row.dataset.depth = String(depth);
        row.setAttribute('role', 'listitem');
        row.innerHTML = `<span class="admin-stat-icon" data-tone="cyan"><i data-lucide="${safeIconName(folder.icon)}" class="w-4 h-4"></i></span>`;

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'admin-row-title truncate';
        title.textContent = folder.name || 'תיקייה ללא שם';
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        const nested = total - own;
        meta.textContent = `${own} פריטים${nested ? ` · ועוד ${nested} בתת־התיקיות` : ''}${folder.syncedFromDrive ? ' · מסונכרן מ־Drive' : ''}${folder.eventDate ? ` · ${folder.eventDate}` : ''}${folder.manualOrder ? ' · סדר ידני' : ''}`;
        text.append(title, meta);
        row.append(text);

        const controls = document.createElement('div');
        controls.className = 'admin-folder-controls';
        const name = folder.name || 'התיקייה';
        if (canEdit) {
            const position = siblings.indexOf(folderId);
            const moveButton = (step, icon, label) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'admin-folder-icon-button';
                button.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
                button.setAttribute('aria-label', `${label}: ${name}`);
                button.title = label;
                button.disabled = position + step < 0 || position + step >= siblings.length;
                button.onclick = () => moveFolderAmongSiblings(folderId, siblings, step);
                return button;
            };
            controls.append(moveButton(-1, 'arrow-up', 'הזזה למעלה בסדר'), moveButton(1, 'arrow-down', 'הזזה למטה בסדר'));

            // "העבר אל": רק הורים חוקיים (בלי מעגל, עד שלוש רמות).
            const select = document.createElement('select');
            select.setAttribute('aria-label', `העברת ${name} אל תיקייה אחרת`);
            const top = document.createElement('option');
            top.value = '';
            top.textContent = 'רמה עליונה';
            select.append(top);
            for (const choice of parentChoices(tree, folderId)) {
                const option = document.createElement('option');
                option.value = choice.id;
                option.textContent = `${'  '.repeat(choice.depth - 1)}${choice.depth > 1 ? '↳ ' : ''}${choice.folder?.name || 'תיקייה ללא שם'}`;
                select.append(option);
            }
            select.value = tree.parentOf(folderId);
            select.onchange = () => moveFolderUnder(folderId, select.value, () => { select.value = tree.parentOf(folderId); });
            controls.append(select);

            const manual = document.createElement('label');
            manual.className = 'admin-folder-manual';
            const manualToggle = document.createElement('input');
            manualToggle.type = 'checkbox';
            manualToggle.checked = folder.manualOrder === true;
            manualToggle.onchange = () => setFolderManualOrder(folderId, manualToggle.checked, () => { manualToggle.checked = !manualToggle.checked; });
            manual.append(manualToggle, document.createTextNode('סדר ידני כברירת מחדל'));
            controls.append(manual);

            if (depth < FOLDER_MAX_DEPTH) {
                const child = document.createElement('button');
                child.type = 'button';
                child.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
                child.textContent = 'תת־תיקייה חדשה';
                child.setAttribute('aria-label', `יצירת תת־תיקייה בתוך ${name}`);
                child.onclick = () => startSubfolder(folderId);
                controls.append(child);
            }
            row.draggable = true;
        }

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        open.textContent = 'פתיחה בגלריה';
        open.onclick = () => window.location.assign(`./index.html#folder-${encodeURIComponent(folderId)}`);
        controls.append(open);
        row.append(controls);
        list.appendChild(row);
        for (const childId of tree.childrenOf(folderId)) renderRow(childId, depth + 1, tree.childrenOf(folderId));
    };
    list.setAttribute('role', 'list');
    for (const rootId of tree.roots) renderRow(rootId, 1, tree.roots);
    installAdminFolderDrag(list);
    scheduleIconRefresh(list);
};

// הסדר הידני של תיקיות אחיות: מחושב ב-manual-order.js, ונשלחות רק התיקיות
// שהדירוג שלהן השתנה, בבקשה אחת (POST /order, טרנזקציה בשרת).
async function saveFolderSiblingOrder(orderedIds) {
    const tree = buildFolderTree(window.state.folders || []);
    const records = orderedIds.map(id => tree.get(id)).filter(Boolean);
    const changes = rankChanges(records, { idOf: folder => safeRecordId(folder.id), fallback: compareFolders });
    if (!changes.length) return;
    for (const chunk of chunkOrderChanges(changes)) {
        await r2Request('/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'folders', items: chunk })
        });
    }
    const byId = new Map(changes.map(change => [change.id, change.order]));
    window.state.folders = (window.state.folders || []).map(folder => {
        const id = safeRecordId(folder.id);
        if (!byId.has(id)) return folder;
        const next = { ...folder };
        if (byId.get(id) === null) delete next.order;
        else next.order = byId.get(id);
        return next;
    });
    window.renderFolders?.();
    window.renderAdminFolders();
}

async function moveFolderAmongSiblings(folderId, siblings, step) {
    const from = siblings.indexOf(folderId);
    if (from < 0 || from + step < 0 || from + step >= siblings.length) return;
    try {
        await saveFolderSiblingOrder(moveItem(siblings, from, from + step));
        window.showNotification('סדר התיקיות נשמר.', true);
        // הפוקוס חוזר לאותו כפתור בשורה שזזה, כדי שאפשר להמשיך להזיז במקלדת.
        const row = document.querySelector(`#adminFolderList [data-folder-id="${folderId}"]`);
        row?.querySelectorAll('.admin-folder-icon-button')[step < 0 ? 0 : 1]?.focus();
    } catch (error) {
        console.error('Folder order save failed:', error);
        window.showNotification(error.message || 'שמירת סדר התיקיות נכשלה.', false);
    }
}

function moveFolderUnder(folderId, parentId, revert) {
    const tree = buildFolderTree(window.state.folders || []);
    const folder = tree.get(folderId);
    const target = safeRecordId(parentId);
    const check = validateFolderMove(tree, folderId, target);
    if (!folder || !check.ok) {
        window.showNotification(check.message || 'לא ניתן להעביר את התיקייה לשם.', false);
        revert();
        return;
    }
    const targetName = target ? (tree.get(target)?.name || 'התיקייה') : 'הרמה העליונה';
    showConfirm('העברת תיקייה', `להעביר את "${folder.name || 'התיקייה'}" אל "${targetName}"? התמונות שבתוכה נשארות בה.`, async () => {
        try {
            await window.saveFolderToCloud({ ...folder, parentId: target || null });
            window.renderAdminFolders();
            window.showNotification('התיקייה הועברה.', true);
        } catch (error) {
            console.error('Folder move failed:', error);
            revert();
            window.showNotification(error.message || 'העברת התיקייה נכשלה.', false);
            throw error;
        }
    });
    // ביטול בחלון האישור (showConfirm אינו מודיע עליו) מחזיר את הרשימה למצב
    // האמיתי: כשהחלון נסגר, העץ מצויר שוב מ-state.folders.
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if (!confirmModal.classList.contains('hidden')) return;
            observer.disconnect();
            window.setTimeout(() => window.renderAdminFolders(), 0);
        });
        observer.observe(confirmModal, { attributes: true, attributeFilter: ['class'] });
    }
}

async function setFolderManualOrder(folderId, enabled, revert) {
    const folder = buildFolderTree(window.state.folders || []).get(folderId);
    if (!folder) return;
    try {
        await window.saveFolderToCloud({ ...folder, manualOrder: enabled });
        window.renderAdminFolders();
        window.showNotification(enabled ? 'התיקייה תיפתח בסדר הידני.' : 'התיקייה תיפתח בסדר הרגיל.', true);
    } catch (error) {
        revert();
        window.showNotification(error.message || 'שמירת ההגדרה נכשלה.', false);
    }
}

// "תת־תיקייה חדשה": הטופס שמעל הרשימה, עם ההורה כבר בחור.
function startSubfolder(parentId) {
    window.populateFolderSelects?.();
    const select = document.getElementById('emptyFolderParent');
    if (select) select.value = parentId;
    const name = document.getElementById('emptyFolderName');
    name?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    name?.focus({ preventScroll: true });
}

// גרירה בין תיקיות אחיות (אותו הורה). הכפתורים שבשורה עושים אותו דבר במקלדת.
function installAdminFolderDrag(list) {
    if (list.__folderDrag) return;
    list.__folderDrag = true;
    let dragged = '';
    list.addEventListener('dragstart', event => {
        dragged = event.target.closest?.('.admin-folder-row')?.dataset.folderId || '';
        try { event.dataTransfer.setData('text/plain', dragged); } catch { /* בלי נתונים — dragged שמור */ }
    });
    list.addEventListener('dragover', event => {
        const row = event.target.closest?.('.admin-folder-row');
        if (!row || !dragged) return;
        event.preventDefault();
        list.querySelectorAll('.is-drop-target').forEach(node => node !== row && node.classList.remove('is-drop-target'));
        row.classList.add('is-drop-target');
    });
    list.addEventListener('dragend', () => {
        dragged = '';
        list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
    });
    list.addEventListener('drop', async event => {
        const row = event.target.closest?.('.admin-folder-row');
        const targetId = row?.dataset.folderId || '';
        list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
        if (!row || !dragged || dragged === targetId) return;
        event.preventDefault();
        const tree = buildFolderTree(window.state.folders || []);
        if (tree.parentOf(dragged) !== tree.parentOf(targetId)) {
            window.showNotification('גרירה מסדרת תיקיות באותה רמה. כדי להעביר לתיקייה אחרת השתמש ב"העבר אל".', false);
            return;
        }
        const siblings = tree.parentOf(dragged) ? tree.childrenOf(tree.parentOf(dragged)) : tree.roots;
        const from = siblings.indexOf(dragged);
        const to = siblings.indexOf(targetId);
        try {
            await saveFolderSiblingOrder(moveItem(siblings, from, to));
            window.showNotification('סדר התיקיות נשמר.', true);
        } catch (error) {
            window.showNotification(error.message || 'שמירת סדר התיקיות נכשלה.', false);
        }
    });
}

// ==========================================================================
// 6. משתמשים — סינון וייצוא
// ==========================================================================

window.filterManagedUsers = function() {
    const query = String(document.getElementById('adminUserSearch')?.value || '').trim().toLocaleLowerCase('he');
    const role = String(document.getElementById('adminUserRoleFilter')?.value || '');
    const list = document.getElementById('managedUsersList');
    if (!list) return;

    [...list.children].forEach(card => {
        const text = card.textContent.toLocaleLowerCase('he');
        const matchesQuery = !query || text.includes(query);
        const matchesRole = !role || card.dataset.userRole === role;
        card.classList.toggle('hidden', !(matchesQuery && matchesRole));
    });
};

function downloadCsv(rows, filename) {
    // BOM כדי שאקסל יזהה עברית ב-UTF-8. תא שמתחיל בסימן של נוסחה נפתח בגרש (csvText).
    const csv = '﻿' + csvText(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(link.href);
    }, 100);
}

// ייצוא רשימת המשתמשים — מנהל־על בלבד, ורק ממה שכבר נטען למסך שלו
// (state.allUsers). אין כאן בקשה לשרת: הקובץ נבנה בדפדפן.
window.exportUsersCsv = function() {
    if (!checkSuperAdminPermission()) return;
    downloadCsv(userCsvRows(window.state.allUsers || []), `simchas-gallery-users-${new Date().toISOString().slice(0, 10)}.csv`);
    window.showNotification('קובץ המשתמשים הורד.', true);
};

// ==========================================================================
// 7. דוא״ל ישיר
// ==========================================================================

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

// ==========================================================================
// 8. בדיקת תקינות
// ==========================================================================

window.runSystemHealthCheck = async function() {
    const container = document.getElementById('systemHealthResults');
    if (!container) return;
    container.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'admin-empty';
    loading.textContent = 'בודק את שירותי המערכת…';
    container.appendChild(loading);

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
            label: 'תצוגות מקדימות',
            run: async () => {
                await window.ensureMediaVariantsModule?.();
                const summary = await window.refreshMediaVariantsSummary?.();
                if (!summary) throw new Error('רשימת המדיה אינה זמינה');
                return summary.missing
                    ? `נותרו ${summary.missing} פריטים בלי תצוגות — הפעילו את הריצה במסך "תצוגות מקדימות"`
                    : `מוכן — ${summary.total} פריטים עם תצוגות`;
            }
        },
        {
            label: 'Google Drive',
            run: async () => window.driveConnectionActive ? 'מחובר כעת' : 'לא מחובר — חברו בעת הצורך'
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
        row.className = 'admin-row';
        row.innerHTML = `<span class="admin-stat-icon" data-tone="${result.ok ? 'green' : 'danger'}"><i data-lucide="${result.ok ? 'circle-check' : 'circle-alert'}" class="w-4 h-4"></i></span>`;
        const text = document.createElement('div');
        text.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'admin-row-title';
        title.textContent = result.label;
        const detail = document.createElement('p');
        detail.className = 'admin-row-meta';
        detail.textContent = result.message;
        text.append(title, detail);
        row.appendChild(text);
        container.appendChild(row);
    });
    scheduleIconRefresh(container);
};

// ==========================================================================
// 9. גיבוי ושחזור
// ==========================================================================

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

// סדר שחזור התיקיות: כל תיקייה אחרי ההורה שלה. הורה שאינו בגיבוי ואינו
// בגלריה — התיקייה חוזרת כעליונה. מעגל (נתונים פגומים) נשבר באותה דרך.
function orderFoldersForRestore(folders) {
    const list = (Array.isArray(folders) ? folders : []).filter(folder => folder && typeof folder === 'object');
    const inBackup = new Set(list.map(folder => safeRecordId(folder.id)));
    const existing = new Set((window.state.folders || []).map(folder => safeRecordId(folder.id)));
    const placed = new Set();
    const ordered = [];
    let pending = list;
    while (pending.length) {
        const next = [];
        for (const folder of pending) {
            const parent = safeRecordId(folder.parentId);
            if (!parent || placed.has(parent) || (!inBackup.has(parent) && existing.has(parent))) {
                ordered.push(folder);
                placed.add(safeRecordId(folder.id));
            } else if (!inBackup.has(parent)) {
                ordered.push({ ...folder, parentId: null });
                placed.add(safeRecordId(folder.id));
            } else {
                next.push(folder);
            }
        }
        if (next.length === pending.length) {
            for (const folder of next) ordered.push({ ...folder, parentId: null });
            break;
        }
        pending = next;
    }
    return ordered;
}

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
        // תיקיות: ההורים לפני הילדים (ה-Worker דוחה הורה שעוד לא קיים), ובלי
        // תמונת השער — היא נקבעת בסבב שני, אחרי שהתמונות עצמן שוחזרו.
        const backupFolders = orderFoldersForRestore(selectedBackupPayload.folders || []);
        const covers = backupFolders.filter(folder => safeRecordId(folder?.coverImageId));
        const collections = [
            ['folders', backupFolders.map(folder => {
                if (!folder || typeof folder !== 'object' || folder.coverImageId === undefined) return folder;
                const { coverImageId, ...rest } = folder;
                return rest;
            }), 'id', false],
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
        for (const folder of covers) {
            const id = safeRecordId(folder.id);
            if (!id || id === 'all') continue;
            try {
                await setDoc(doc(window.db, ...base, 'folders', id), { coverImageId: folder.coverImageId }, { merge: true });
            } catch (error) {
                // תמונה שאינה בגיבוי: התיקייה נשארת עם הסמל, כמו היום.
                console.warn('Folder cover restore skipped:', id, error);
            }
        }
        if (status) status.textContent = `השחזור הושלם בהצלחה: ${restored} רשומות.`;
        await window.logActivity('restored_backup', 'system', '', 'גיבוי גלריה', `${restored} רשומות`);
        window.showNotification('שחזור הגיבוי הושלם.', true);
    })().catch(error => {
        const status = document.getElementById('backupRestoreStatus');
        if (status) status.textContent = error.message || 'שחזור הגיבוי נכשל.';
        window.showNotification(error.message || 'שחזור הגיבוי נכשל.', false);
    });
};

// ==========================================================================
// 10. ניתוח נתונים
// ==========================================================================

window.openAnalyticsMedia = function(mediaId) {
    const id = safeRecordId(mediaId);
    if (!id || !(window.state.images || []).some(item => safeRecordId(item.id) === id)) {
        window.showNotification('הפריט הזה כבר אינו קיים בגלריה.', false);
        return;
    }
    // התצוגה המלאה היא חלק מהגלריה, ולכן מדף הניהול עוברים אליה שם.
    window.location.assign(`./index.html#media-${encodeURIComponent(id)}`);
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
        empty.textContent = 'עדיין לא נרשמו צפיות בפריטי הגלריה.';
        container.appendChild(empty);
        return;
    }

    ordered.forEach((entry, index) => {
        const id = safeRecordId(entry.id || entry.mediaId);
        const media = (window.state.images || []).find(item => safeRecordId(item.id) === id);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'analytics-media-card';
        card.onclick = () => window.openAnalyticsMedia(id);

        const rank = document.createElement('span');
        rank.className = 'analytics-media-rank';
        rank.textContent = String(index + 1);

        const previewUrl = pickCardSource(media || {}, safeImageUrl).url;
        let preview;
        if (previewUrl && !isVideoRecord(media || {})) {
            preview = document.createElement('img');
            preview.className = 'analytics-media-preview';
            preview.loading = 'lazy';
            preview.alt = '';
            preview.src = previewUrl;
        } else {
            preview = document.createElement('span');
            preview.className = 'analytics-media-preview grid place-items-center';
            preview.innerHTML = '<i data-lucide="film" class="w-5 h-5"></i>';
        }

        const details = document.createElement('span');
        details.className = 'analytics-media-details';
        const title = document.createElement('strong');
        title.textContent = media?.title || (media ? 'פריט ללא שם' : 'פריט שנמחק');
        const type = document.createElement('small');
        type.className = 'analytics-media-type';
        const folder = (window.state.folders || []).find(item => item.id === media?.folderId);
        type.textContent = `${media && isVideoRecord(media) ? 'סרטון' : 'תמונה'} · ${folder?.name || 'כללי'}`;
        const lastViewed = document.createElement('small');
        lastViewed.className = 'analytics-media-last-viewed';
        lastViewed.textContent = entry.lastViewedAt ? `צפייה אחרונה: ${formatDate(entry.lastViewedAt)}` : 'אין תאריך צפייה';
        details.append(title, type, lastViewed);

        const views = document.createElement('span');
        views.className = 'analytics-media-views';
        const viewsNumber = document.createElement('strong');
        viewsNumber.textContent = String(Number(entry.views) || 0);
        const viewsLabel = document.createElement('small');
        viewsLabel.textContent = 'צפיות';
        views.append(viewsNumber, viewsLabel);

        card.append(rank, preview, details, views);
        container.appendChild(card);
    });
    scheduleIconRefresh(container);
}

window.loadAdvancedAnalytics = async function() {
    if (!canViewSuperAdminData()) return;
    const cards = document.getElementById('advancedAnalyticsCards');
    const top = document.getElementById('advancedAnalyticsTop');
    if (cards) {
        cards.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'admin-empty';
        loading.textContent = 'טוען…';
        cards.appendChild(loading);
    }
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats'));
        const stats = snapshot.docs.map(entry => entry.data());
        const totalViews = stats.reduce((sum, entry) => sum + (Number(entry.views) || 0), 0);
        const images = window.state.images || [];
        const videos = images.filter(isVideoRecord).length;
        const storage = images.reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        const values = [
            ['פריטי מדיה', images.length, 'images', 'cyan'],
            ['סרטונים', videos, 'video', 'violet'],
            ['משתמשים', (window.state.allUsers || []).length, 'users', 'green'],
            ['צפיות', totalViews, 'eye', 'gold'],
            ['תיקיות', (window.state.folders || []).filter(folder => folder.id !== 'all').length, 'folders', 'cyan'],
            ['נפח מקורי', formatBytes(storage), 'hard-drive', 'violet'],
            ['ממתינים לאישור', (window.state.pendingImages || []).length, 'clock', 'gold']
        ];
        if (cards) {
            cards.innerHTML = values.map(([label, value, icon, tone]) => `
                <div class="admin-stat" data-tone="${tone}">
                    <span class="admin-stat-icon"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
                    <div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>
                </div>`).join('');
        }
        renderAnalyticsMedia(stats);
        scheduleIconRefresh();
    } catch (error) {
        if (top) top.textContent = error.message || 'טעינת הנתונים נכשלה.';
        if (cards) cards.replaceChildren();
    }
};

// ==========================================================================
// 11. סל המחזור
// ==========================================================================

window.renderTrashItems = function() {
    const list = document.getElementById('trashItemsList');
    const badge = document.getElementById('trashItemsCountBadge');
    // סל המחזור — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (badge) badge.textContent = '0';
        if (list) list.replaceChildren();
        return;
    }
    const allItems = window.state.trashItems || [];
    const items = allItems.filter(item => !item.parentTrashGroupId);
    if (badge) badge.textContent = String(items.length);
    if (!list) return;

    list.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'סל המחזור ריק.';
        list.appendChild(empty);
        return;
    }

    const typeLabels = { image: 'תמונה', pendingImage: 'תמונה ממתינה', folder: 'תיקייה', user: 'משתמש' };
    items.forEach(item => {
        const row = document.createElement('article');
        row.className = 'admin-row';
        row.innerHTML = '<span class="admin-stat-icon" data-tone="gold"><i data-lucide="archive" class="w-4 h-4"></i></span>';

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'admin-row-title truncate';
        title.textContent = `${typeLabels[item.originalType] || 'פריט'} — ${item.targetName || item.originalId}`;
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        // הניקוי היומי בענן מוחק לצמיתות אחרי TRASH_RETENTION_DAYS; הספירה כאן מאותו קבוע.
        const purgeLabel = trashPurgeLabel(item.deletedAt);
        meta.textContent = `${formatDate(item.deletedAt)} · נמחק על ידי ${item.deletedByName || 'מנהל־על'}${purgeLabel ? ` · ${purgeLabel}` : ''}`;
        text.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        restore.textContent = 'שחזור';
        restore.onclick = () => window.restoreTrashItem(item.id);
        const purge = document.createElement('button');
        purge.type = 'button';
        purge.className = 'btn-danger-soft px-3 py-1.5 text-[11px]';
        purge.textContent = 'מחיקה סופית';
        purge.onclick = () => window.purgeTrashItem(item.id);
        actions.append(restore, purge);

        row.append(text, actions);
        list.appendChild(row);
    });
    scheduleIconRefresh(list);
};

window.purgeEntireTrash = function(confirmed = false) {
    if (!checkSuperAdminPermission()) return;
    const items = (window.state.trashItems || []).filter(item => !item.parentTrashGroupId);
    if (!items.length) {
        window.showNotification('סל המחזור כבר ריק.', false);
        return;
    }
    if (!confirmed) {
        showConfirm(
            'ריקון סל המחזור',
            `למחוק לצמיתות ${items.length} פריטים? הפעולה אינה הפיכה.`,
            () => window.purgeEntireTrash(true)
        );
        return;
    }
    (async () => {
        for (const item of items) {
            // purgeTrashItem מבקש אישור משלו, ולכן נשלח לו אישור מראש.
            await window.purgeTrashItem?.(item.id, true);
        }
        window.renderTrashItems();
        window.showNotification('סל המחזור רוקן.', true);
    })().catch(error => window.showNotification(error.message || 'ריקון סל המחזור נכשל.', false));
};

// ==========================================================================
// 12. יומן הפעילות
// ==========================================================================

const ACTIVITY_LABELS = {
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
    reopened_support: 'פתח פנייה מחדש',
    sent_email: 'שלח דוא״ל',
    restored_backup: 'שחזר גיבוי'
};

let activityFilter = 'all';

window.setActivityFilter = function(filter) {
    activityFilter = filter || 'all';
    window.renderActivityLogs();
};

window.renderActivityLogs = function() {
    const list = document.getElementById('activityLogList');
    const summary = document.getElementById('activitySummary');
    const filters = document.getElementById('activityFilters');
    // יומן הפעולות — מנהל־על בלבד.
    if (!canViewSuperAdminData()) {
        if (summary) summary.replaceChildren();
        if (list) list.replaceChildren();
        if (filters) filters.replaceChildren();
        return;
    }

    const logs = window.state.activityLogs || [];

    if (summary) {
        const cards = [
            ['user-plus', (window.state.pendingUsers || []).length, 'בקשות הצטרפות', 'violet'],
            ['image-plus', (window.state.pendingImages || []).length, 'ממתינים לאישור', 'gold'],
            ['trash-2', (window.state.deletionRequests || []).length, 'בקשות מחיקה', 'danger'],
            ['archive-restore', (window.state.trashItems || []).length, 'בסל המחזור', 'cyan']
        ];
        summary.innerHTML = cards.map(([icon, value, label, tone]) => `
            <div class="admin-stat" data-tone="${tone}">
                <span class="admin-stat-icon"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
                <div><strong>${value}</strong><span>${label}</span></div>
            </div>`).join('');
    }

    if (filters) {
        const actions = ['all', ...new Set(logs.map(log => log.action).filter(Boolean))];
        filters.replaceChildren();
        actions.slice(0, 12).forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-filter-chip ${action === activityFilter ? 'is-active' : ''}`;
            button.textContent = action === 'all' ? 'הכול' : (ACTIVITY_LABELS[action] || action);
            button.onclick = () => window.setActivityFilter(action);
            filters.appendChild(button);
        });
    }

    if (!list) return;
    list.replaceChildren();
    const visible = logs.filter(log => activityFilter === 'all' || log.action === activityFilter);

    if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'עדיין אין פעולות מתועדות.';
        list.appendChild(empty);
    } else {
        visible.slice(0, 80).forEach(log => {
            const row = document.createElement('article');
            row.className = 'admin-row';
            row.innerHTML = '<span class="admin-stat-icon" data-tone="cyan"><i data-lucide="history" class="w-4 h-4"></i></span>';
            const text = document.createElement('div');
            text.className = 'min-w-0 flex-1';
            const title = document.createElement('p');
            title.className = 'admin-row-title';
            title.textContent = `${log.actorName || 'משתמש'} — ${ACTIVITY_LABELS[log.action] || log.action || 'פעולה'}`;
            const meta = document.createElement('p');
            meta.className = 'admin-row-meta';
            meta.textContent = `${log.targetName || log.targetId || ''}${log.details ? ` · ${log.details}` : ''} · ${formatDate(log.createdAt)}`;
            text.append(title, meta);
            row.appendChild(text);
            list.appendChild(row);
        });
    }
    scheduleIconRefresh();
};

window.exportActivityCsv = function() {
    if (!checkSuperAdminPermission()) return;
    const rows = [['תאריך', 'מבצע', 'פעולה', 'יעד', 'פרטים']];
    (window.state.activityLogs || []).forEach(log => {
        rows.push([
            formatDate(log.createdAt),
            log.actorName || '',
            ACTIVITY_LABELS[log.action] || log.action || '',
            log.targetName || log.targetId || '',
            log.details || ''
        ]);
    });
    downloadCsv(rows, `simchas-gallery-activity-${new Date().toISOString().slice(0, 10)}.csv`);
    window.showNotification('יומן הפעילות הורד.', true);
};

// ==========================================================================
// 13. תחזוקה ואבחון
// ==========================================================================

window.clearClientCaches = function(confirmed = false) {
    if (!checkAdminPermission()) return;
    if (!confirmed) {
        showConfirm(
            'ניקוי מטמון האתר',
            'לנקות את המטמון המקומי ולטעון את הדף מחדש? הנתונים שבענן אינם מושפעים.',
            () => window.clearClientCaches(true)
        );
        return;
    }
    (async () => {
        if (window.caches?.keys) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map(key => window.caches.delete(key)));
        }
        const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(registrations.map(registration => registration.unregister()));
    })()
        .catch(error => console.warn('Cache clearing failed:', error))
        .finally(() => window.location.reload());
};

window.copyAdminDiagnostics = async function() {
    const box = document.getElementById('adminDiagnostics');
    const report = [
        `תאריך: ${new Date().toISOString()}`,
        `דפדפן: ${navigator.userAgent}`,
        `מצב תצוגה: ${document.documentElement.dataset.theme}`,
        `משתמש: ${window.state?.currentUser?.email || 'לא מחובר'}`,
        `דרגה: ${window.state?.isSuperAdmin ? 'מנהל־על' : window.state?.isAdminLoggedIn ? 'מנהל' : 'רגיל'}`,
        `פריטים: ${(window.state?.images || []).length}`,
        `תיקיות: ${(window.state?.folders || []).length}`,
        `ממתינים: ${(window.state?.pendingImages || []).length}`,
        `סביבת API: ${window.API_ENVIRONMENT || 'production'}`,
        `Worker: ${R2_WORKER_BASE_URL}`
    ].join('\n');

    if (box) {
        box.textContent = report;
        box.style.whiteSpace = 'pre-wrap';
        box.style.textAlign = 'start';
    }
    try {
        await navigator.clipboard.writeText(report);
        window.showNotification('נתוני האבחון הועתקו.', true);
    } catch (error) {
        window.showNotification('הנתונים מוצגים כאן — אפשר להעתיק אותם ידנית.', false);
    }
};

// ==========================================================================
// 14. אתחול
// ==========================================================================

function initialViewFromHash() {
    const hash = String(window.location.hash || '').replace('#', '');
    if (hash === 'messages') return 'messages';
    // #guide/<מזהה> פותח סעיף במדריך; המודול עצמו בודק שהמזהה מוכר.
    if (hash.split('/')[0] === 'guide') return 'guide';
    return viewById(hash) ? hash : 'dashboard';
}

// הניווט נבנה מחדש בכל שינוי הרשאה, כי מסכי מנהל־על נוספים או נעלמים.
window.renderAdminNavigation = function() {
    renderAdminNav();
    const target = viewById(activeViewId) && viewIsAllowed(viewById(activeViewId)) ? activeViewId : 'dashboard';
    window.openAdminView(target);
    window.updateAdminOverviewExtras();
};

document.addEventListener('DOMContentLoaded', () => {
    activeViewId = initialViewFromHash();
    renderAdminNav();

    // "/" פותח את החיפוש בתפריט, ו-Esc מנקה אותו — קיצור מוכר מכל לוח ניהול.
    document.addEventListener('keydown', event => {
        const search = document.getElementById('adminMenuSearch');
        if (!search) return;
        const typingElsewhere = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        // חלון מודאלי פתוח (למשל "מצב מהיר") מחזיק את הפוקוס: "/" אינו בורח ממנו אל התפריט שמאחור.
        const modalOpen = Boolean(document.querySelector('[role="dialog"]:not(.hidden)[aria-modal="true"]'));
        if (event.key === '/' && !typingElsewhere && !modalOpen) {
            event.preventDefault();
            search.focus();
        }
        if (event.key === 'Escape' && document.activeElement === search) {
            window.clearAdminMenuSearch();
            search.blur();
        }
    });
});
