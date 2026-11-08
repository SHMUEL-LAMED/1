// admin-ui.js — ליבת לוח הניהול: רשימת המסכים, הניווט, הנתיב, החיפוש והמונים.
//
// הלוח בנוי משלד אחד ומסכים: רשימת המסכים (ADMIN_VIEWS) היא המקור היחיד
// לתפריט, לחיפוש, לסדר, למונים ולטעינת הנתונים של כל מסך. כל מסך קיים
// ב-admin.html פעם אחת (section.admin-view[data-view]), והמעבר ביניהם הוא
// החלפת המסך הפעיל בלבד.
//
// הקובץ הזה אינו מכיל לוגיקה של מסך מסוים. כל מסך חי במודול משלו (למשל
// admin-folders.js, admin-health.js, admin-backup.js) שנטען בפעם הראשונה
// שהמסך נפתח או שאחד הכפתורים שלו נלחץ: המעטפות שב-LAZY_MODULES מושכות את
// המודול ואז קוראות לפונקציה האמיתית, ולכן admin.html יכול להפנות אליהן
// ב-onclick עוד לפני שהמודול הגיע.
//
// המודול נשען על התשתית המשותפת שב-app.js (state, showNotification,
// openModal, showConfirm, r2Request), ולכן admin-app.js טוען קודם אותה.

import { renderDashboard } from './admin-dashboard.js';

// ==========================================================================
// 1. רשימת המסכים — מקור אחד לתפריט, לחיפוש, לסדר ולטעינת הנתונים
// ==========================================================================
//
// שדות: id (גם הכתובת #id וגם section#view-<id>), group (אחת מ-VIEW_GROUPS,
// הקבוצות חייבות להופיע ברצף), title, description, icon (lucide), keywords
// לחיפוש, superAdminOnly, badge() למונה בתפריט, ו-open() — מה לטעון כשהמסך
// נפתח. admin-menu-order.test.mjs נועל את הסדר ואת המבנה של הרשימה.

const ADMIN_VIEWS = [
    {
        id: 'dashboard',
        group: 'סקירה',
        title: 'סקירה כללית',
        description: 'תמונת מצב מהירה של הגלריה ושל מה שממתין לטיפול.',
        icon: 'gauge',
        keywords: 'בית ראשי דשבורד סיכום מצב',
        open: () => renderDashboard()
    },
    {
        id: 'guide',
        group: 'סקירה',
        title: 'מדריך למנהלים',
        description: 'הסבר קצר על כל מסך ועל סדר העבודה המומלץ.',
        icon: 'book-open',
        keywords: 'מדריך עזרה הסבר הוראות שאלות איך תיעוד',
        open: () => openGuideView()
    },
    {
        id: 'pending',
        group: 'תוכן הגלריה',
        title: 'אישור העלאות',
        description: 'תמונות וסרטונים שהועלו וממתינים לבדיקה לפני שייכנסו לגלריה.',
        icon: 'image-plus',
        badge: () => (window.state.pendingImages || []).length,
        keywords: 'ממתינות בקשות תמונות אישור',
        open: () => window.renderPendingImages?.()
    },
    {
        id: 'drive',
        group: 'תוכן הגלריה',
        title: 'סנכרון Google Drive',
        description: 'ייבוא תיקיות מהדרייב, סנכרון אוטומטי ותזמון ריצות.',
        icon: 'folder-sync',
        keywords: 'דרייב סנכרון ייבוא אוטומטי',
        open: () => {
            Promise.resolve(window.restoreDriveConnection?.())
                .catch(() => null)
                .then(() => window.loadDriveFolders?.());
            scheduleBackgroundJobsRefresh();
        }
    },
    {
        id: 'folders',
        group: 'תוכן הגלריה',
        title: 'תיקיות ואירועים',
        description: 'יצירת תיקיות, סידור העץ, סדר ידני וקישורי הזמנה לאירוע.',
        icon: 'folders',
        keywords: 'תיקייה אירוע יצירה הזמנה קישור מוזמנים',
        open: () => {
            window.renderAdminFolders?.();
            loadModule('./invites-admin.js').then(module => module.loadInvites()).catch(reportModuleError('Invites'));
        }
    },
    {
        id: 'deletions',
        group: 'תוכן הגלריה',
        title: 'בקשות מחיקה',
        description: 'בקשות שנשלחו ממנהלי דרגה 3 וממתינות להחלטת מנהל־על.',
        icon: 'trash-2',
        superAdminOnly: true,
        badge: () => (window.state.deletionRequests || []).length,
        keywords: 'מחיקה בקשות אישור',
        open: () => window.renderDeletionRequests?.()
    },
    {
        id: 'trash',
        group: 'תוכן הגלריה',
        title: 'סל מחזור',
        description: 'פריטים שנמחקו ושמורים עד לשחזור או למחיקה סופית.',
        icon: 'archive-restore',
        superAdminOnly: true,
        keywords: 'אשפה שחזור מחיקה סופית',
        open: () => window.renderTrashItems?.()
    },
    {
        id: 'downloads',
        group: 'תוכן הגלריה',
        title: 'הורדות ופרטיות',
        description: 'מה יוצא מהתמונות בהורדה, וסימן מים לצופים.',
        icon: 'shield-check',
        superAdminOnly: true,
        keywords: 'הורדה מיקום gps exif פרטיות סימן מים watermark zip',
        open: () => window.renderDownloadPrivacyAdmin?.()
    },
    {
        id: 'users',
        group: 'תקשורת ואנשים',
        title: 'משתמשים והרשאות',
        description: 'בקשות הצטרפות, דרגות, חסימות, הערות פנימיות ופעולה על כמה משתמשים.',
        icon: 'users-round',
        superAdminOnly: true,
        badge: () => (window.state.pendingUsers || []).length,
        keywords: 'משתמשים דרגות הרשאות חסימה הצטרפות',
        open: () => {
            window.renderPendingUsers?.();
            window.renderManagedUsers?.();
            window.forceRefreshUsers?.();
            if (!window.state?.isSuperAdmin) return;
            loadModule('./admin-users-bulk.js')
                .then(module => {
                    module.decorateUserCards(document.getElementById('pendingUsersList'));
                    module.decorateUserCards(document.getElementById('managedUsersList'));
                })
                .catch(reportModuleError('Users bulk'));
        }
    },
    {
        id: 'messages',
        group: 'תקשורת ואנשים',
        title: 'הודעות ופניות',
        description: 'שיחות עם משתמשים, פניות פתוחות ושליחת הודעה לקבוצה.',
        icon: 'messages-square',
        superAdminOnly: true,
        keywords: 'צאט שיחות פניות הודעות דיוור',
        open: () => window.renderAdminMessageReplies?.()
    },
    {
        id: 'popup',
        group: 'תקשורת ואנשים',
        title: 'הודעת פופ-אפ',
        description: 'מודעה שמופיעה למבקרים בכניסה לאתר, עם תמונה וקישור.',
        icon: 'megaphone',
        superAdminOnly: true,
        keywords: 'פופאפ הודעה מודעה באנר',
        open: () => window.renderPopupAnnouncementAdmin?.()
    },
    {
        id: 'activity',
        group: 'כלי מערכת',
        title: 'מרכז פעילות',
        description: 'יומן הפעולות של המנהלים והמשתמשים, עם סינון וייצוא.',
        icon: 'activity',
        superAdminOnly: true,
        keywords: 'לוג יומן פעולות היסטוריה',
        open: () => window.renderActivityLogs?.()
    },
    {
        id: 'analytics',
        group: 'כלי מערכת',
        title: 'ניתוח נתונים',
        description: 'אילו תמונות וסרטונים נצפו הכי הרבה, ומתי.',
        icon: 'chart-column-big',
        superAdminOnly: true,
        keywords: 'סטטיסטיקה צפיות נתונים אנליטיקס',
        open: () => window.loadAdvancedAnalytics?.()
    },
    {
        id: 'stats',
        group: 'כלי מערכת',
        title: 'סטטיסטיקות',
        description: 'שימוש לאורך זמן, משתמשים פעילים, אחסון ועלויות.',
        icon: 'chart-line',
        superAdminOnly: true,
        keywords: 'סטטיסטיקה גרף ביקורים צפיות הורדות העלאות משתמשים פעילים אחסון עלות נפח r2 d1 מכסה',
        open: () => { if (window.state?.isSuperAdmin) window.loadAdminStats?.(); }
    },
    {
        id: 'backup',
        group: 'כלי מערכת',
        title: 'גיבוי ושחזור',
        description: 'קובץ גיבוי להורדה, שחזור מקובץ והגיבוי היומי שבענן.',
        icon: 'database-backup',
        superAdminOnly: true,
        keywords: 'גיבוי שחזור ייצוא json',
        open: () => {
            if (!window.state?.isSuperAdmin) return;
            loadModule('./maintenance-admin.js').then(() => window.loadCloudBackups?.()).catch(reportModuleError('Maintenance'));
        }
    },
    {
        id: 'health',
        group: 'כלי מערכת',
        title: 'תקינות המערכת',
        description: 'בדיקה מהירה של Cloudflare, האחסון, זיהוי הפנים וחיבור Drive.',
        icon: 'shield-check',
        keywords: 'בדיקה תקינות שרת חיבור',
        open: () => window.runSystemHealthCheck?.()
    },
    {
        id: 'brokenlinks',
        group: 'כלי מערכת',
        title: 'קישורים שבורים',
        description: 'רשומות שחסר להן קובץ, וקבצים באחסון בלי רשומה.',
        icon: 'unlink',
        superAdminOnly: true,
        keywords: 'קישור שבור חסר יתום קובץ אחסון r2 בדיקה',
        open: () => {
            if (!window.state?.isSuperAdmin) return;
            loadModule('./maintenance-admin.js').then(() => window.loadBrokenLinksReport?.()).catch(reportModuleError('Maintenance'));
        }
    },
    {
        id: 'errors',
        group: 'כלי מערכת',
        title: 'שגיאות ותקלות',
        description: 'תקלות שנרשמו באתר ובשרת, לפי סוג, עם מספר המופעים.',
        icon: 'bug',
        // המונה מגיע מהשרת ונשמר ב-state על ידי admin-errors.js.
        badge: () => (window.canViewAdminData?.() ? Number(window.state.clientErrorsSummary?.last24h) || 0 : 0),
        keywords: 'שגיאות תקלות באגים ניטור יומן שגיאה',
        open: () => loadModule('./admin-errors.js').then(() => window.loadClientErrors?.()).catch(reportModuleError('Errors'))
    },
    {
        id: 'faceindex',
        group: 'כלי מערכת',
        title: 'אנשים, פרצופים ואינדוקס',
        description: 'קיבוץ פרצופים לאנשים, איחוד ידני והכנת חיפוש הפנים בענן.',
        icon: 'scan-face',
        keywords: 'פנים אינדוקס חיפוש ai אנשים שמות קיבוץ אלבום',
        open: () => {
            import('./face-people.js')
                .then(module => { module.openPeopleManager(); module.openFacePeople(); })
                .catch(() => setText('facePeopleStatus', 'לא ניתן לטעון את ניהול הפרצופים. רענן ונסה שוב.'));
            // renderFaceIndexPanel ו-refreshFaceIndexSummary מוגדרות רק בתוך
            // face-index.js, שנטען עצלה; בלי ההמתנה לו הן היו no-op.
            Promise.resolve(window.ensureFaceIndexModule?.())
                .then(() => {
                    window.renderFaceIndexPanel?.();
                    return window.refreshFaceIndexSummary?.();
                })
                .catch(reportModuleError('Face index'));
            scheduleBackgroundJobsRefresh();
        }
    },
    {
        id: 'variants',
        group: 'כלי מערכת',
        title: 'תצוגות מקדימות',
        description: 'השלמת גרסאות קטנות, פוסטרים לסרטונים ורקע מטושטש לפריטים קיימים.',
        icon: 'images',
        keywords: 'תצוגה מקדימה ממוזערות thumbnails webp פוסטר סרטון מהירות',
        open: () => {
            Promise.resolve(window.ensureMediaVariantsModule?.())
                .then(() => {
                    window.renderMediaVariantsPanel?.();
                    return window.refreshMediaVariantsSummary?.();
                })
                .catch(reportModuleError('Media variants'));
            scheduleBackgroundJobsRefresh();
        }
    },
    {
        id: 'capturedates',
        group: 'כלי מערכת',
        title: 'תאריכי צילום',
        description: 'השלמת תאריך הצילום (והתאריך העברי) לפריטים שהועלו בעבר.',
        icon: 'calendar-clock',
        keywords: 'תאריך צילום exif מיון תאריך עברי takenAt השלמה',
        open: () => {
            Promise.resolve(window.ensureCaptureDatesModule?.())
                .then(() => {
                    window.renderCaptureDatesPanel?.();
                    return window.refreshCaptureDatesSummary?.();
                })
                .catch(reportModuleError('Capture dates'));
            scheduleBackgroundJobsRefresh();
        }
    },
    {
        id: 'aititles',
        group: 'כלי מערכת',
        title: 'שמות, כיתובים ותגיות עם AI',
        description: 'ספק ה-AI, המפתח, והשלמת שמות, כיתובים ותגיות סצנה לתמונות הקיימות.',
        icon: 'sparkles',
        keywords: 'שמות תמונות בינה מלאכותית ai כיתוב תיאור תגיות סצנה סוג הרגע',
        open: () => {
            import('./ai-titles-admin.js')
                .then(module => module.openAiTitles())
                .catch(() => setText('aiTitlesStatus', 'לא ניתן לטעון את הכלי. רענן ונסה שוב.'));
            scheduleBackgroundJobsRefresh();
        }
    },
    {
        id: 'tools',
        group: 'כלי מערכת',
        title: 'תחזוקה ואבחון',
        description: 'ניקוי מטמון, טעינה מחדש ונתוני אבחון להעברה לתמיכה.',
        icon: 'wrench',
        keywords: 'מטמון cache אבחון תחזוקה'
    }
];
const VIEW_GROUPS = ['סקירה', 'תוכן הגלריה', 'תקשורת ואנשים', 'כלי מערכת'];

// מקטעי התפריט שבצד: "סקירה כללית" בראש בלי כותרת, ואחריה תוכן / אנשים /
// תחזוקה / הגדרות / מדריך. זו חלוקה של התצוגה בלבד — רשימת המסכים, הסדר שלה
// והקבוצות (VIEW_GROUPS) נשארים כפי שהם. מסך חדש שאינו מופיע כאן נכנס
// למקטע לפי הקבוצה שלו (NAV_SECTION_BY_GROUP).
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
// 2. מודולים שנטענים לפי צורך
// ==========================================================================
//
// לכל מודול רשומות הפונקציות ש-admin.html (או מאזיני הנתונים) קוראים להן
// דרך window. עד שהמודול נטען, window[name] היא מעטפת שמושכת את המודול
// ואז קוראת לפונקציה האמיתית — המודול עצמו מחליף את המעטפת בטעינתו.

const LAZY_MODULES = {
    './admin-folders.js': ['renderAdminFolders'],
    './admin-users-view.js': ['filterManagedUsers', 'exportUsersCsv', 'sendDirectMail', 'submitDirectEmail'],
    './admin-health.js': ['runSystemHealthCheck'],
    './admin-backup.js': ['exportGalleryBackup', 'previewBackupFile', 'restoreGalleryBackup'],
    './admin-analytics.js': ['openAnalyticsMedia', 'loadAdvancedAnalytics'],
    './admin-trash.js': ['renderTrashItems', 'purgeEntireTrash'],
    './admin-activity.js': ['setActivityFilter', 'renderActivityLogs', 'exportActivityCsv'],
    './admin-tools.js': ['clearClientCaches', 'copyAdminDiagnostics'],
    './admin-users-bulk.js': ['selectVisibleUsers', 'clearUserSelection', 'runUsersBulkAction', 'openUserNotes', 'closeUserNotes', 'addUserNote'],
    './admin-stats.js': ['loadAdminStats', 'setAdminStatsRange', 'saveStorageBudget'],
    './admin-errors.js': ['loadClientErrors', 'setClientErrorsFilter', 'clearResolvedClientErrors', 'refreshClientErrorsSummary'],
    './maintenance-admin.js': ['loadCloudBackups', 'loadBrokenLinksReport', 'createCloudBackupNow']
};

const modulePromises = new Map();
function loadModule(path) {
    if (!modulePromises.has(path)) modulePromises.set(path, import(/* @vite-ignore */ path));
    return modulePromises.get(path);
}
function reportModuleError(label) {
    return error => console.error(`${label} module failed to load:`, error);
}

for (const [path, names] of Object.entries(LAZY_MODULES)) {
    for (const name of names) {
        const wrapper = (...args) => loadModule(path)
            .then(module => {
                // המודול מגדיר את הפונקציה על window בטעינתו; עד אז העטיפה היא
                // שרשומה שם, ולכן הייצוא של המודול קודם.
                const fn = typeof module[name] === 'function' ? module[name]
                    : (window[name] !== wrapper ? window[name] : null);
                if (typeof fn !== 'function') throw new Error(`${name} is not exported by ${path}`);
                return fn(...args);
            })
            .catch(error => {
                console.error(`${path} failed to load ${name}:`, error);
                window.showNotification?.('טעינת הרכיב נכשלה. נסה שוב.', false);
            });
        window[name] = wrapper;
    }
}

// עבודות הרקע שבענן: הסיכום והכפתורים מתעדכנים זמן קצר אחרי פתיחת מסך
// שמציג אותן, אחרי שהמודול של המסך הספיק לצייר את הכפתורים שלו.
function scheduleBackgroundJobsRefresh() {
    window.setTimeout(() => window.refreshCloudBackgroundJobs?.(), 1500);
}

function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

// ==========================================================================
// 3. הניווט
// ==========================================================================

let activeViewId = 'dashboard';

function iconMarkup(name, size = 'w-4 h-4') {
    return `<i data-lucide="${window.safeIconName(name)}" class="${size}"></i>`;
}

function renderAdminNav() {
    const nav = document.getElementById('adminNav');
    if (!nav) return;
    nav.replaceChildren();

    NAV_SECTIONS.forEach(section => {
        const views = allowedViews().filter(view => navSectionOf(view) === section.id);
        if (!views.length) return;

        const group = document.createElement('div');
        group.className = 'admin-nav-group';
        group.dataset.navSection = section.id;

        if (section.label) {
            const label = document.createElement('p');
            label.className = 'admin-nav-label';
            label.dataset.navSection = section.id;
            label.textContent = section.label;
            group.appendChild(label);
        }

        views.forEach(view => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-nav-item${view.id === activeViewId ? ' is-active' : ''}`;
            button.dataset.viewTarget = view.id;
            if (view.id === activeViewId) button.setAttribute('aria-current', 'page');
            button.title = view.description;
            button.onclick = () => window.openAdminView(view.id);

            const icon = document.createElement('span');
            icon.className = 'admin-nav-icon';
            icon.innerHTML = iconMarkup(view.icon);
            const text = document.createElement('span');
            text.className = 'admin-nav-text';
            text.textContent = view.title;
            const count = document.createElement('span');
            count.className = 'admin-nav-count';
            count.dataset.viewBadge = view.id;
            count.dataset.empty = 'true';
            count.textContent = '0';

            button.append(icon, text, count);
            group.appendChild(button);
        });

        nav.appendChild(group);
    });

    refreshAdminNavBadges();
    window.scheduleIconRefresh(nav);
}

// המונים בתפריט נקראים מאותו state שמזין את הכרטיסים, ולכן הם מתעדכנים
// בכל ציור מחדש בלי מקור נתונים נוסף.
function refreshAdminNavBadges() {
    let total = 0;
    ADMIN_VIEWS.forEach(view => {
        const value = typeof view.badge === 'function' && viewIsAllowed(view) ? Number(view.badge()) || 0 : 0;
        total += value;
        document.querySelectorAll(`[data-view-badge="${view.id}"]`).forEach(badge => {
            badge.textContent = String(value);
            badge.dataset.empty = value > 0 ? 'false' : 'true';
        });
    });
    // כותרת הלשונית מראה כמה ממתין, כדי שאפשר יהיה לראות זאת גם מלשונית אחרת.
    document.title = `${total > 0 ? `(${total}) ` : ''}לוח הניהול | גלריית שמחת התורה`;
}
window.refreshAdminNavBadges = refreshAdminNavBadges;

function setActiveView(view) {
    activeViewId = view.id;

    document.querySelectorAll('.admin-view').forEach(section => {
        const active = section.dataset.view === view.id;
        section.classList.toggle('is-active', active);
        if (active) section.removeAttribute('aria-hidden'); else section.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[data-view-target]').forEach(button => {
        const active = button.dataset.viewTarget === view.id;
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });

    setText('adminViewTitle', view.title);
    setText('adminViewDescription', view.description);
    const icon = document.getElementById('adminViewIcon');
    if (icon) icon.innerHTML = iconMarkup(view.icon, 'w-5 h-5');
    const main = document.querySelector('.admin-main');
    if (main) main.dataset.activeView = view.id;
}

window.openAdminView = function(viewId) {
    const view = viewById(viewId) || viewById('dashboard');
    if (!view) return;
    if (view.superAdminOnly && !window.checkSuperAdminPermission()) return;
    if (!window.checkAdminPermission()) return;

    setActiveView(view);

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
    window.scheduleIconRefresh();
};

// כל מסך טוען את הנתונים שלו ברגע שנפתח, ולא בטעינת הדף. כך הלוח נפתח מיד
// ואינו מושך מידע שאיש אינו מסתכל עליו.
function runViewHook(viewId) {
    const view = viewById(viewId);
    if (!view || typeof view.open !== 'function') return;
    try {
        view.open();
    } catch (error) {
        console.error(`View ${viewId} failed to open:`, error);
        window.reportClientError?.(error, `admin-view:${viewId}`);
    }
}
// הרענון הכללי (admin-dashboard.js) טוען מחדש את המסך הפעיל.
window.rerunActiveAdminView = function() {
    runViewHook(activeViewId);
};
window.activeAdminViewId = function() {
    return activeViewId;
};

// ==========================================================================
// 4. המדריך למנהלים
// ==========================================================================
//
// המדריך נטען רק כשפותחים אותו. הסעיף המבוקש מקישור "?" במסך אחר נשמר עד
// שהמודול מגיע; בלעדיו נפתח הסעיף שבכתובת #guide/<מזהה>.

let pendingGuideSection = '';

function guideSectionFromHash() {
    const [viewPart, ...sectionPart] = String(window.location.hash || '').replace('#', '').split('/');
    return viewPart === 'guide' ? sectionPart.join('/') : '';
}

function openGuideView() {
    const requested = Boolean(pendingGuideSection);
    const section = pendingGuideSection || guideSectionFromHash();
    pendingGuideSection = '';
    loadModule('./admin-guide-ui.js')
        .then(module => module.renderAdminGuide({ section, requested }))
        .catch(error => {
            console.error('Admin guide module failed to load:', error);
            setText('adminGuideRoot', 'לא ניתן לטעון את המדריך. רענן ונסה שוב.');
        });
}

window.openAdminGuide = function(sectionId = '') {
    pendingGuideSection = String(sectionId || '');
    window.openAdminView('guide');
};

// ==========================================================================
// 5. שמות ישנים
// ==========================================================================
//
// שמות שנשארו בקריאות אחרות בקוד. כולם מובילים למסך המתאים, ולכן אין יותר
// שני מסלולים שונים לאותו תוכן.
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
// 6. חיפוש בתפריט
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
    matches.forEach((view, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-menu-result';
        button.setAttribute('role', 'option');
        button.dataset.viewTarget = view.id;
        if (index === 0) button.classList.add('is-active');
        button.onclick = () => {
            window.openAdminView(view.id);
            window.clearAdminMenuSearch();
        };
        const icon = document.createElement('span');
        icon.className = 'admin-menu-result-icon';
        icon.innerHTML = iconMarkup(view.icon);
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
    window.scheduleIconRefresh(results);
};

window.clearAdminMenuSearch = function() {
    const input = document.getElementById('adminMenuSearch');
    if (input) input.value = '';
    window.filterAdminMenu('');
};

// Enter בתיבת החיפוש פותח את התוצאה הראשונה; חיצים מזיזים את הבחירה.
function handleSearchKeydown(event) {
    const results = document.getElementById('adminMenuResults');
    if (!results || results.classList.contains('hidden')) return;
    const options = [...results.querySelectorAll('.admin-menu-result')];
    if (!options.length) return;
    const current = Math.max(0, options.findIndex(option => option.classList.contains('is-active')));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        options.forEach((option, index) => option.classList.toggle('is-active', index === next));
        options[next].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        options[current]?.click();
    }
}

// ==========================================================================
// 7. אתחול
// ==========================================================================

function initialViewFromHash() {
    const hash = String(window.location.hash || '').replace('#', '');
    if (hash === 'messages') return 'messages';
    // #guide/<מזהה> פותח סעיף במדריך; המודול עצמו בודק שהמזהה מוכר.
    if (hash.split('/')[0] === 'guide') return 'guide';
    return viewById(hash) ? hash : 'dashboard';
}

// הניווט נבנה מחדש בכל שינוי הרשאה, כי מסכי מנהל־על נוספים או נעלמים.
// מנהל בדרגה 3 שהגיע לכתובת של מסך מנהל־על מקבל את הסקירה, בלי הודעת שגיאה.
window.renderAdminNavigation = function() {
    renderAdminNav();
    const current = viewById(activeViewId);
    const target = current && viewIsAllowed(current) ? activeViewId : 'dashboard';
    window.openAdminView(target);
    window.updateAdminOverviewExtras?.();
};

// חזרה אחורה וקדימה בדפדפן, או שינוי ידני של הכתובת, מחליפים מסך.
function handleHashChange() {
    if (!window.state?.isAdminLoggedIn) return;
    const requested = initialViewFromHash();
    if (requested === activeViewId) return;
    const view = viewById(requested);
    if (!view || !viewIsAllowed(view)) return;
    window.openAdminView(requested);
}

document.addEventListener('DOMContentLoaded', () => {
    activeViewId = initialViewFromHash();
    renderAdminNav();
    window.addEventListener('hashchange', handleHashChange);

    const search = document.getElementById('adminMenuSearch');
    search?.addEventListener('keydown', handleSearchKeydown);

    // "/" או Ctrl+K פותחים את החיפוש בתפריט, ו-Esc מנקה אותו.
    document.addEventListener('keydown', event => {
        if (!search) return;
        const typingElsewhere = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        // חלון מודאלי פתוח (למשל "מצב מהיר") מחזיק את הפוקוס: הקיצור אינו בורח ממנו אל התפריט שמאחור.
        const modalOpen = Boolean(document.querySelector('[role="dialog"]:not(.hidden)[aria-modal="true"]'));
        const commandKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
        if ((event.key === '/' && !typingElsewhere && !modalOpen) || (commandKey && !modalOpen)) {
            event.preventDefault();
            search.focus();
            search.select();
        }
        if (event.key === 'Escape' && document.activeElement === search) {
            window.clearAdminMenuSearch();
            search.blur();
        }
    });
});
