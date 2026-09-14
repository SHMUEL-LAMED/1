// app.js — התשתית המשותפת לשני הדפים: מצב, עזרים, מודלים, התראות
// והשכבה שמדברת עם הענן. גם דף הגלריה וגם דף הניהול נשענים עליה.
//
// מודול הניהול אינו מיובא כאן. הוא נטען רק מ-admin-app.js שבדף הניהול,
// ולכן מבקר בגלריה אינו מוריד אותו — זו הסיבה לקיומו של admin.html.

import { initSession } from './session-auth.js';
import { initGallery } from './gallery.js';
import { initSessionUI } from './session-ui.js';
import './popup-announcement.js';

// שני הדפים חולקים את הקובץ הזה, ולכן הוא חייב לדעת היכן הוא רץ:
// <html data-page="admin"> בדף הניהול, וכל השאר נחשב לדף הגלריה.
// drive-sync.js משתמש בזה כדי לא להאזין לאוספי הניהול בדף הגלריה.
const PAGE_MODE = document.documentElement.dataset.page === 'admin' ? 'admin' : 'gallery';
window.PAGE_MODE = PAGE_MODE;

// מודולים שנקודות הכניסה שלהם נמצאות כולן מאחורי פעולה מפורשת של המשתמש
// יורדים רק כשצריך אותם. עד אז יושבת כאן מעטפת בשם כל פונקציה: המטפלים
// שב-HTML קוראים לה, היא מושכת את המודול, והמודול דורס אותה בפונקציה
// האמיתית. כך אורח שרק מסתכל בגלריה אינו מוריד אותם כלל.
function defineLazyModule(load, names) {
    let promise = null;
    const ensure = () => (promise ||= load());
    for (const name of names) {
        const placeholder = (...args) => {
            ensure()
                .then(() => {
                    // בלי הבדיקה הזו, מודול שלא הגדיר את הפונקציה היה גורם
                    // למעטפת לקרוא לעצמה שוב ושוב.
                    if (window[name] === placeholder) throw new Error(`lazy module did not define ${name}`);
                    window[name](...args);
                })
                .catch(error => {
                    console.error('Lazy module failed to load:', error);
                    window.showNotification?.('טעינת הרכיב נכשלה. נסה שוב.', false);
                });
        };
        window[name] = placeholder;
    }
    return ensure;
}

const ensureFaceSearchModule = defineLazyModule(() => import('./face-search.js'), [
    'openFaceSearchModal', 'openFaceCamera', 'closeFaceCamera', 'flipFaceCamera',
    'captureFacePhoto', 'executeFaceSearch', 'handleFaceSearchFileSelect'
]);
const ensureFaceIndexModule = defineLazyModule(() => import('./face-index.js'), [
    'startFaceIndexing', 'stopFaceIndexing', 'resetFaceIndex'
]);
window.ensureFaceSearchModule = ensureFaceSearchModule;
window.ensureFaceIndexModule = ensureFaceIndexModule;

// chat.js אינו נטען בפתיחת האתר אלא בייבוא דינמי. מבקר שאינו מחובר לעולם
// אינו מוריד אותו, ולמי שכן מחובר הוא יורד אחרי הציור הראשון במקום לעכב
// אותו. ensureChatModule היא השער היחיד, והמודול נטען פעם אחת בלבד.
const ensureChatModule = defineLazyModule(() => import('./chat.js'), ['openUserConversation']);
window.ensureChatModule = ensureChatModule;

// מרכז ההודעות הניהולי הוא מודול נפרד, ונרשם רק בדף הניהול. בדף הגלריה
// השמות האלה נשארים לא מוגדרים בכוונה: כך כפתור של מנהל־על מנווט לדף
// הניהול במקום למשוך לכאן קוד שאין לו מרקאפ.
if (PAGE_MODE === 'admin') {
    const ensureChatAdminModule = defineLazyModule(() => import('./chat-admin.js'), [
        'openAdminMessagesCenter', 'openAdminConversation', 'openAdminMessagesForUser'
    ]);
    window.ensureChatAdminModule = ensureChatAdminModule;
}

// תג ההודעות שלא נקראו מוצג בפאנל הפרופיל בלי שנפתח שום חלון, ולכן משתמש
// מחובר חייב את chat.js גם אם לא נגע בצ׳אט. הפונקציה הזו מושכת את המודול
// ואז מצייר; לאורח שאינו מחובר אין מה להציג והמודול אינו נטען כלל.
window.refreshChatUI = function() {
    if (!window.state?.currentUser) return;
    ensureChatModule()
        .then(() => {
            window.renderFloatingInbox?.();
            window.renderAdminMessageReplies?.();
        })
        .catch(error => console.warn('Chat module failed to load:', error));
};


// lucide.createIcons() סורק את כל ה-DOM בכל קריאה — יקר מאד לגלריה גדולה.
// קריאות מרובות באותו frame מתמזגות לאחת, וכשיש container ידוע הסריקה
// מוגבלת אליו בלבד — קריאה ללא container גורמת לסריקת כל ה-DOM.
let _iconRefreshPending = false;
let _iconRefreshNodes = new Set();
function scheduleIconRefresh(node) {
    if (node instanceof Element) _iconRefreshNodes.add(node);
    if (_iconRefreshPending) return;
    _iconRefreshPending = true;
    requestAnimationFrame(() => {
        _iconRefreshPending = false;
        if (typeof lucide === 'undefined' || !lucide.createIcons) return;
        const nodes = _iconRefreshNodes;
        _iconRefreshNodes = new Set();
        if (nodes.size === 0) {
            lucide.createIcons();
        } else {
            for (const n of nodes) lucide.createIcons({ node: n });
        }
    });
}
window.scheduleIconRefresh = scheduleIconRefresh;

// פונקציה לניקוי טקסט ומניעת הזרקות קוד (XSS)
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ערכים שמגיעים מהענן עוברים סינון לפני שילובם בתבניות HTML.
function safeRecordId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function safeIconName(value) {
    const icon = String(value ?? '').toLowerCase();
    return /^[a-z0-9-]{1,40}$/.test(icon) ? icon : 'folder';
}

function safeImageUrl(value) {
    const url = String(value ?? '').trim();
    // קישורי thumbnail של Drive מבצעים כמה הפניות. קישור ישיר וקבוע
    // ל-googleusercontent מתאים יותר להצגה באתר ולמערכות בדיקת תמונות.
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === 'drive.google.com') {
            const queryId = parsedUrl.searchParams.get('id');
            const pathId = parsedUrl.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
            const driveFileId = queryId || pathId;
            if (driveFileId && /^[a-zA-Z0-9_-]{10,}$/.test(driveFileId)) {
                return `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveFileId)}=w1600`;
            }
        }
    } catch (error) {}
    if (/^https:\/\//i.test(url) || /^blob:/i.test(url) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) {
        return url;
    }
    return '';
}

function isVideoRecord(record) {
    return record?.mediaType === 'video'
        || /^video\/(?:mp4|webm)$/i.test(String(record?.mimeType || ''))
        || /\.(?:mp4|webm)(?:[?#].*)?$/i.test(String(record?.url || record?.title || ''));
}

// פונקציית שגיאה מובנית המציגה תמונה חלופית אסתטית במידה והקישור נשבר
function handleImageError(imgElement) {
    imgElement.onerror = null;
    const fallback = document.createElement('div');
    fallback.className = `${imgElement.className} image-fallback`;
    fallback.setAttribute('role', 'img');
    fallback.setAttribute('aria-label', 'התמונה אינה זמינה');
    fallback.innerHTML = '<i data-lucide="image-off" aria-hidden="true"></i><span>התמונה אינה זמינה</span>';

    // בתצוגה המלאה שומרים את אלמנט התמונה כדי שמעבר לתמונה הבאה ימשיך לעבוד.
    if (imgElement.id === 'lightboxImage') {
        document.getElementById('lightboxImageFallback')?.remove();
        fallback.id = 'lightboxImageFallback';
        imgElement.hidden = true;
        imgElement.insertAdjacentElement('afterend', fallback);
    } else {
        imgElement.replaceWith(fallback);
    }
    scheduleIconRefresh();
}

// פונקציית גיבוב מאובטחת SHA-256 לניהול סיסמאות מוגן
async function sha256(message) {
    if (!message) return '';
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// תיקיות בסיס מוצגות גם כאשר שירות הענן חסום או עדיין נטען.
window.DEFAULT_GALLERY_FOLDERS = [
    { id: 'all', name: 'כל התמונות', icon: 'grid', isDefault: true },
    { id: '1', name: 'אירועים ופעילויות', icon: 'calendar', isDefault: true },
    { id: '2', name: 'טיולים וסיורים', icon: 'compass', isDefault: true },
    { id: '3', name: 'הווי ומפגשים', icon: 'users', isDefault: true },
    { id: '4', name: 'כללי', icon: 'home', isDefault: true }
];

// --- 1. Global State ---
window.state = {
    folders: window.DEFAULT_GALLERY_FOLDERS.map(folder => ({ ...folder })), images: [], pendingImages: [], pendingUsers: [], allUsers: [], deletionRequests: [], trashItems: [], activityLogs: [], favorites: new Set(), followedFolders: new Set(), activeFolderId: 'all', searchQuery: '', gallerySort: 'newest',
    currentLightboxIndex: -1, tempSearchResults: null,
    bulkSelectionMode: false, selectedMediaIds: new Set(), activeEventFolderId: '',
    isLocked: true, isAdminLoggedIn: false, isSuperAdmin: false, isGoogleUser: false, isInitialSuperAdminAccount: false, currentUser: null,
    userProfile: null, userRole: 'guest', userApprovalStatus: 'signed_out'
};

// מערכת מטמון (Cache) מקומית בזיכרון לשמירת תיאורי הפנים (descriptors) לחיפוש מהיר
window.descriptorCache = {};

// --- 1.5. UI & Drawer Modal Basic Functions ---

// --- Floating Profile Widget & Notification Hub Toggles & Actions ---
function setFloatingProfileOpen(shouldOpen, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const panel = document.getElementById('floatingProfilePanel');
    if (!panel) return;
    const button = document.getElementById('floatingProfileButton');
    panel.classList.toggle('active', Boolean(shouldOpen));
    button?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        scheduleIconRefresh();
    }
}

// לחיצה על תמונת המשתמש תמיד פותחת. כך אירוע כפול בטלפון או לחיצה מהירה
// אינם מפעילים toggle פעמיים וגורמים לפאנל להיפתח ולהיסגר מיד.
window.openFloatingProfile = function(event) {
    setFloatingProfileOpen(true, event);
};

window.closeFloatingProfile = function(event) {
    setFloatingProfileOpen(false, event);
};

// נשמר לתאימות עם קריאות ישנות, אך כפתור הפרופיל עצמו משתמש בפתיחה מפורשת.
window.toggleFloatingProfile = function(event) {
    const panel = document.getElementById('floatingProfilePanel');
    setFloatingProfileOpen(!panel?.classList.contains('active'), event);
};

// מרכז ההודעות הוא חלק מלוח הניהול, ולכן גם אליו עוברים בניווט. הסימן
// #messages אומר לדף הניהול לפתוח אותו מיד עם הטעינה.
window.openAdminMessagesPage = function() {
    if (!window.state.isSuperAdmin) {
        window.showNotification('מרכז ההודעות זמין למנהל־על בלבד.', false);
        return;
    }
    window.closeFloatingProfile?.();
    window.location.assign('./admin.html#messages');
};

// לוח הניהול הוא דף נפרד. מהאתר עוברים אליו בניווט רגיל, וכך אין צורך
// לטעון שום קוד ניהול עד שמנהל באמת מבקש אותו.
window.openManagementFromProfile = function() {
    if (!window.state.isAdminLoggedIn) {
        window.showNotification('הכניסה ללוח הניהול זמינה למנהלים בלבד.', false);
        return;
    }
    window.closeFloatingProfile();
    window.location.assign('./admin.html');
};

function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m._previousActiveElement = document.activeElement;
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden', 'false');
    const firstControl = m.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstControl) requestAnimationFrame(() => firstControl.focus({ preventScroll: true }));
}


window.openModal = openModal;

// שדרוג: סגירת המצלמה בעת סגירת המודאל למניעת דליפת משאבי זיכרון של המצלמה
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.add('hidden');
        m.setAttribute('aria-hidden', 'true');
        if (m._previousActiveElement && typeof m._previousActiveElement.focus === 'function') {
            m._previousActiveElement.focus({ preventScroll: true });
        }
    }
    if (id === 'conversationModal') {
        window.clearConversationAttachment?.();
        window.toggleConversationEmojiPicker?.(false);
        window.toggleConversationStickerPicker?.(false);
        const status = document.getElementById('conversationUploadStatus');
        if (status) status.textContent = 'תמונות וקבצים עד 25MB';
    }
    if (id === 'faceCameraModal') {
        if (typeof window.stopFaceCamera === 'function') window.stopFaceCamera();
    }
    if (id === 'userUploadModal') {
        window.resetUploadPauseState?.();
    }
}
window.closeModal = closeModal;

function toggleAdminDrawer() {
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

function toggleAccordion(id) {
    const content = document.getElementById(id);
    if (!content) return;
    const isAct = content.classList.contains('active');
    document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('[id$="Arrow"]').forEach(a => {
        a.setAttribute('data-lucide', 'chevron-down');
        a.style.transform = 'rotate(0deg)';
    });
    if (!isAct) {
        content.classList.add('active');
        const arrow = document.getElementById(id + 'Arrow');
        if (arrow) {
            arrow.setAttribute('data-lucide', 'chevron-up');
            arrow.style.transform = 'rotate(180deg)';
        }
    }
    scheduleIconRefresh();
}
window.toggleAccordion = toggleAccordion;

// מציג פופ-אפ הודעות יוקרתי ומעוצב

// מציג פופ-אפ הודעות יוקרתי ומעוצב כולל פירוט משמעות המשימה והשפעתה על הקהילה
let notificationTimer = null;
function showNotification(msg, isSuccess = true, tone = null) {
    const alertEl = document.getElementById('customAlert');
    const iconEl = document.getElementById('customAlertIcon');
    const msgEl = document.getElementById('customAlertMessage');
    if (!alertEl || !iconEl || !msgEl) return;

    // מיפוי הודעות נפוצות להעשרת תוכן ההסבר והמשמעות הקהילתית של הפעולה (Impact)
    let enrichedMessage = msg;
    let impactDesc = "";

    if (msg.includes('התחברת בהצלחה')) {
        impactDesc = "חיבור בטוח ומאובטח המאפשר צפייה ושמירה על פרטיות זיכרונות הישיבה.";
    } else if (msg.includes('הועלו') && msg.includes('תמונות')) {
        impactDesc = "התמונות הועברו לענן בבטחה ומשמרות את הווי הישיבה והשמחה לדורות הבאים.";
    } else if (msg.includes('נשלחו לאישור')) {
        impactDesc = "החומרים בבדיקה אצל מנהל כדי לוודא שכל תמונה המוצגת עומדת בסטנדרט של הישיבה.";
    } else if (msg.includes('נוצרה בענן')) {
        impactDesc = "תיקייה חדשה מארגנת כעת את הארכיון ומאפשרת למשתמשים למצוא אירועים בקלות.";
    } else if (msg.includes('עודכן בהצלחה')) {
        impactDesc = "התמונות סווגו מחדש ויופיעו תחת הקטגוריה המעודכנת בזמן אמת.";
    } else if (msg.includes('סנכרון Drive הושלם')) {
        impactDesc = "התמונות בענן ובישיבה סונכרנו באופן מלא! הארכיון כעת שלם ומעודכן לחלוטין.";
    } else if (msg.includes('בקשת המחיקה')) {
        impactDesc = "הפריטים הוסרו כדי להבטיח את איכות ודיוק התוכן המוצג לציבור.";
    } else if (msg.includes('דרגת המשתמש עודכנה')) {
        impactDesc = "הרשאות המשתמש הותאמו לפעילותו השוטפת לשמירה על סדר וארגון בגלריה.";
    } else if (msg.includes('ההודעה האישית נשלחה')) {
        impactDesc = "המשתמש קיבל התראה אישית ישירות לתיבת ההודעות שלו בפרופיל.";
    } else if (msg.includes('מפעיל את אפליקציית הדוא"ל')) {
        impactDesc = "יוזם קשר ישיר עם חבר הקהילה לבירור וקידום הבקשה.";
    } else if (msg.includes('הפרטים נשמרו בהצלחה')) {
        impactDesc = "פרטי הזיהוי שלך נשלחו למנהל ומקדמים את פתיחת הגלריה האישית עבורך!";
    } else if (msg.includes('אין לך הרשאה')) {
        impactDesc = "פעולה זו מוגנת ומיועדת למורשי ניהול בלבד כדי לשמור על הארכיון הקדוש.";
    }

    if (impactDesc) {
        msgEl.innerHTML = `<div class="flex flex-col gap-1 text-right">
            <span class="font-black text-xs tracking-wide text-white">${escapeHtml(msg)}</span>
            <span class="text-[9px] text-amber-300 font-semibold leading-normal opacity-90">${escapeHtml(impactDesc)}</span>
        </div>`;
    } else {
        msgEl.textContent = msg;
    }

    if (tone === 'warning') {
        iconEl.innerHTML = `<i data-lucide="triangle-alert" class="w-6 h-6 text-amber-300"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-amber-400/30 max-w-[340px]";
    } else if (isSuccess) {
        iconEl.innerHTML = `<i data-lucide="check-circle" class="w-6 h-6 text-emerald-400"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-emerald-500/20 max-w-[340px]";
    } else {
        iconEl.innerHTML = `<i data-lucide="alert-circle" class="w-6 h-6 text-red-400"></i>`;
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl z-50 flex items-center gap-3.5 transform translate-y-0 opacity-100 transition-all duration-300 border border-red-500/20 max-w-[340px]";
    }
    scheduleIconRefresh();

    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        alertEl.className = "fixed bottom-6 left-6 bg-slate-900/95 backdrop-blur-md text-white px-5 py-3.5 rounded-2xl shadow-2xl z-50 flex items-center gap-2.5 transform translate-y-20 opacity-0 transition-all duration-300 border border-white/10";
    }, 5500);
}
window.showNotification = showNotification;
    

// פורמט תאריכים מותאם לישראל
function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
        return dateStr;
    }
}
window.formatDate = formatDate;

// וידוא הרשאות מנהל לביצוע פעולות רגישות
// בדיקות הרשאה שקטות, לשימוש בפונקציות שמציירות מונים והתראות ניהול.
// אסור להשתמש שם ב-checkAdminPermission: היא מציגה טוסט שגיאה, ומשתמש
// רגיל היה מוצף בהודעות "אין לך הרשאה" בכל ציור של הגלריה.
function canViewAdminData() {
    return Boolean(window.state?.isAdminLoggedIn);
}
function canViewSuperAdminData() {
    return Boolean(window.state?.isSuperAdmin);
}
window.canViewAdminData = canViewAdminData;
window.canViewSuperAdminData = canViewSuperAdminData;

// מנקה מונה או רשימה של הניהול. בלי זה, משתמש שהתנתק או שהורד בדרגה היה
// נשאר עם הערכים האחרונים שנכתבו ל-DOM.
function clearAdminOutput(id, emptyValue = '') {
    const element = document.getElementById(id);
    if (!element) return null;
    element.textContent = emptyValue;
    return element;
}
window.clearAdminOutput = clearAdminOutput;

function checkAdminPermission() {
    if (!window.state.isAdminLoggedIn) {
        showNotification("אין לך הרשאה לבצע פעולה זו. התחבר כמנהל תחילה.", false);
        return false;
    }
    return true;
}
window.checkAdminPermission = checkAdminPermission;

function checkSuperAdminPermission() {
    if (!window.state.isSuperAdmin) {
        showNotification("הפעולה זמינה רק למנהל־על בדרגה 4.", false);
        return false;
    }
    return true;
}
window.checkSuperAdminPermission = checkSuperAdminPermission;

let pendingConfirmAction = null;
let confirmActionRunning = false;

function resetConfirmButtons() {
    const approveBtn = document.getElementById('confirmApproveBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (approveBtn) approveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    confirmActionRunning = false;
}

function cancelConfirmAction() {
    if (confirmActionRunning) return;
    pendingConfirmAction = null;
    resetConfirmButtons();
    closeModal('confirmModal');
}
window.cancelConfirmAction = cancelConfirmAction;

async function approveConfirmAction() {
    if (confirmActionRunning || typeof pendingConfirmAction !== 'function') return;
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    confirmActionRunning = true;

    const approveBtn = document.getElementById('confirmApproveBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    if (approveBtn) approveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
        await action();
        closeModal('confirmModal');
    } catch (error) {
        console.error('Confirmed action failed:', error);
        showNotification('הפעולה נכשלה. נסה שוב.', false);
    } finally {
        resetConfirmButtons();
    }
}
window.approveConfirmAction = approveConfirmAction;

function showConfirm(title, message, onApprove) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;
    pendingConfirmAction = typeof onApprove === 'function' ? onApprove : null;
    resetConfirmButtons();
    openModal('confirmModal');
    scheduleIconRefresh();
}
window.showConfirm = showConfirm;

// פונקציית כיווץ והמרת תמונות על גבי ה-Canvas לפני העלאה לענן
function compressAndConvertImage(file, maxW = 800, maxH = 800, quality = 0.7) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.width;
                    let h = img.height;
                    if (!w || !h) { resolve(null); return; }
                    if (w > h) {
                        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                    } else if (h > maxH) {
                        w = Math.round(w * maxH / h); h = maxH;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(null); return; }
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (error) {
                    console.error('Image processing failed:', error);
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}
window.compressAndConvertImage = compressAndConvertImage;

// --- 2. Cloud DB & Google Drive Actions ---
function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    if (parts.length !== 2) throw new Error('נתוני התמונה אינם תקינים.');
    const mimeMatch = parts[0].match(/^data:([^;]+);base64$/i);
    if (!mimeMatch) throw new Error('סוג התמונה אינו נתמך.');
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeMatch[1] || 'image/jpeg' });
}

// --- אחסון תמונות ב-Cloudflare R2 דרך ה-Worker ---
// עדכן לכתובת ה-Worker שלך, למשל: https://simchas-gallery-api.<subdomain>.workers.dev
const R2_WORKER_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';

async function r2Request(path, options = {}) {
    const token = await window.getFirebaseIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
        response = await fetch(`${R2_WORKER_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('ההעלאה ארכה יותר מדי. בדוק את החיבור ונסה שוב.');
        throw new Error('לא ניתן להתחבר לשרת האחסון. נסה שוב בעוד רגע.');
    } finally {
        clearTimeout(timeoutId);
    }

    let payload = null;
    try { payload = await response.json(); } catch (error) {}
    if (!response.ok) {
        // הקוד והסטטוס נשמרים על אובייקט השגיאה כדי שקוראים יוכלו להבחין בין
        // עומס זמני, חוסר הרשאה ונתיב שאינו קיים ב-Worker הפרוס.
        const error = new Error(payload?.message || payload?.error || `שגיאת שרת האחסון (${response.status}).`);
        error.status = response.status;
        error.code = payload?.code || 'request_failed';
        throw error;
    }
    return payload;
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

window.recordMediaView = async function(mediaId) {
    const id = safeRecordId(mediaId);
    if (!id || !window.db || !window.state.currentUser || sessionStorage.getItem(`viewed_${id}`)) return;
    sessionStorage.setItem(`viewed_${id}`, '1');
    try {
        const { doc, setDoc, increment } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats', id), {
            id,
            views: increment(1),
            lastViewedAt: Date.now()
        }, { merge: true });
    } catch (error) {
        sessionStorage.removeItem(`viewed_${id}`);
        console.warn('View counter update failed:', error);
    }
};

window.uploadMediaToR2 = async function(mediaBlob, imgId, title = 'קובץ מדיה') {
    if (!(mediaBlob instanceof Blob)) throw new Error('קובץ המדיה אינו תקין.');
    const isVideo = String(mediaBlob.type || '').startsWith('video/');
    if (isVideo && mediaBlob.size > 100 * 1024 * 1024) throw new Error('גודל הסרטון חייב להיות עד 100MB.');
    const cleanTitle = String(title || 'קובץ מדיה').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'קובץ מדיה';
    const form = new FormData();
    const extension = mediaBlob.type === 'video/webm' ? 'webm' : (isVideo ? 'mp4' : 'jpg');
    form.append('file', mediaBlob, `${safeRecordId(imgId) || 'media'}.${extension}`);
    form.append('imageId', safeRecordId(imgId));
    form.append('title', cleanTitle);
    const result = await r2Request('/upload', {
        method: 'POST',
        body: form
    });
    if (!result?.url || !result?.key) throw new Error('שרת האחסון לא החזיר כתובת לקובץ.');
    return {
        url: result.url,
        r2Key: result.key,
        r2OwnerUid: window.state.currentUser?.uid || '',
        r2Stored: true,
        mediaType: result.mediaType || (isVideo ? 'video' : 'image'),
        mimeType: result.mimeType || mediaBlob.type || ''
    };
};

window.uploadImageToR2 = async function(base64Data, imgId, title = 'תמונה') {
    return window.uploadMediaToR2(dataUrlToBlob(base64Data), imgId, title);
};

async function prepareMediaRecordForCloud(record, mediaId) {
    const { sourceFile, thumbnailDataUrl, _isDuplicate, ...cleanRecord } = record;
    let preparedRecord = cleanRecord;
    if (sourceFile instanceof Blob) {
        const storedMedia = await window.uploadMediaToR2(sourceFile, mediaId, cleanRecord.title);
        preparedRecord = { ...cleanRecord, ...storedMedia };
    } else if (cleanRecord.url && cleanRecord.url.startsWith('data:')) {
        const storedImage = await window.uploadImageToR2(cleanRecord.url, mediaId, cleanRecord.title);
        preparedRecord = { ...cleanRecord, ...storedImage };
    }
    if (thumbnailDataUrl) {
        const storedThumbnail = await window.uploadImageToR2(thumbnailDataUrl, `${mediaId}_thumb`, `${cleanRecord.title || 'סרטון'}-תמונה-מקדימה`);
        preparedRecord.thumbnailUrl = storedThumbnail.url;
        preparedRecord.thumbnailR2Key = storedThumbnail.r2Key;
    }
    return preparedRecord;
}

window.deleteImageFromR2 = async function(imageRecord) {
    const keys = [imageRecord?.r2Key, imageRecord?.thumbnailR2Key].map(key => String(key || '').trim()).filter(Boolean);
    for (const key of keys) {
        try {
            const encodedKey = key.split('/').map(encodeURIComponent).join('/');
            await r2Request(`/media/${encodedKey}`, { method: 'DELETE' });
        } catch (error) {
            console.warn('לא ניתן היה למחוק את הקובץ מ-R2:', error);
        }
    }
};

window.approveImageInR2 = async function(imageRecord) {
    const key = String(imageRecord?.r2Key || '').trim();
    if (!key.startsWith('pending/')) return imageRecord;
    const result = await r2Request('/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
    });
    if (!result?.url || !result?.key) throw new Error('שרת האחסון לא השלים את אישור התמונה.');
    const approvedRecord = { ...imageRecord, url: result.url, r2Key: result.key, status: 'active' };
    const thumbnailKey = String(imageRecord?.thumbnailR2Key || '');
    if (thumbnailKey.startsWith('pending/')) {
        const thumbnailResult = await r2Request('/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: thumbnailKey })
        });
        if (thumbnailResult?.url && thumbnailResult?.key) {
            approvedRecord.thumbnailUrl = thumbnailResult.url;
            approvedRecord.thumbnailR2Key = thumbnailResult.key;
        }
    }
    return approvedRecord;
};

window.saveFolderToCloud = async function(folderData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    const folderId = safeRecordId(folderData?.id);
    if (!folderId) throw new Error('מזהה התיקייה אינו תקין.');
    const { doc, setDoc } = window.firestoreModules;
    const folderRecord = { ...folderData, id: folderId };
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'folders', folderId), folderRecord);
    // Update local state immediately so the folder appears without waiting for the next poll
    const existingFolderIndex = (window.state.folders || []).findIndex(f => safeRecordId(f.id) === folderId);
    if (existingFolderIndex >= 0) {
        window.state.folders = window.state.folders.map((f, i) => i === existingFolderIndex ? folderRecord : f);
    } else {
        window.state.folders = [...(window.state.folders || []), folderRecord];
    }
    window.renderFolders();
    window.populateFolderSelects?.();
};
window.deleteFolderCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תיקייה דורשת אישור מנהל־על.');
    const folderId = safeRecordId(id);
    if (!folderId) throw new Error('מזהה התיקייה אינו תקין.');
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'folders', folderId));
};

window.saveImageToCloud = async function(imgData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    const canUploadDirectly = window.state.isAdminLoggedIn || (
        window.state.userApprovalStatus === 'approved' && window.state.userRole === 'uploader'
    );
    if (!canUploadDirectly) throw new Error('אין לחשבון הרשאת העלאה ישירה.');

    const imageId = safeRecordId(imgData?.id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    let imageRecord;
    try {
        imageRecord = await prepareMediaRecordForCloud({ ...imgData, id: imageId }, imageId);
    } catch(e) {
        console.error('R2 upload failed:', e);
        throw new Error(e.message || 'העלאת הקובץ לאחסון נכשלה.');
    }

    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', imageId), imageRecord);
    // Upsert into local state immediately so changes appear without waiting for the next poll
    const existingImageIndex = (window.state.images || []).findIndex(img => safeRecordId(img.id) === imageId);
    if (existingImageIndex >= 0) {
        window.state.images = window.state.images.map((img, i) => i === existingImageIndex ? imageRecord : img);
    } else {
        window.state.images = [imageRecord, ...(window.state.images || [])];
        window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    window.renderImages();
    window.renderFolders();
    // הפקת טביעות הפנים לתמונה חדשה רצה ברקע. היא לעולם אינה מעכבת את
    // ההעלאה ואינה מכשילה אותה — כישלון רק משאיר את התמונה לאינדוקס הבא.
    try {
        window.queueFaceIndexForImage?.(imageRecord);
    } catch (error) {
        console.warn('הוספת התמונה לתור אינדוקס הפנים נכשלה:', error);
    }
};

// מחיקת רשומת הגלריה; הקובץ נמחק גם מ-R2.
window.deleteImageCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תמונה דורשת אישור מנהל־על.');
    const imageId = safeRecordId(id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    try {
        const img = window.state.images.find(i => safeRecordId(i.id) === imageId);
        if (img) await window.deleteImageFromR2(img);
    } catch (e) {
        console.warn('R2 deletion failed or skipped during cloud delete:', e);
    }
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', imageId));
};

window.savePendingImageCloud = async function(imgData) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (window.state.userApprovalStatus !== 'approved' || window.state.userRole !== 'viewer') {
        throw new Error('העלאה לאישור זמינה רק למשתמש מאושר בדרגה 1.');
    }
    const imageId = safeRecordId(imgData?.id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    let imageRecord = {
        ...imgData,
        id: imageId,
        status: 'pending',
        uploadedBy: window.state.currentUser?.uid || '',
        uploadedByName: window.state.currentUser?.displayName || '',
        uploadedByEmail: window.state.currentUser?.email || ''
    };

    try {
        imageRecord = await prepareMediaRecordForCloud(imageRecord, imageId);
    } catch(e) {
        console.error('R2 upload failed:', e);
        throw new Error(e.message || 'העלאת הקובץ לאחסון נכשלה.');
    }

    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', imageId), imageRecord);
    // Update local state immediately so the pending item appears without waiting for the next poll
    if (!(window.state.pendingImages || []).some(img => safeRecordId(img.id) === imageId)) {
        window.state.pendingImages = [imageRecord, ...(window.state.pendingImages || [])];
    }
    window.renderPendingImages?.();
    window.updatePendingBadge?.();
};

// מחיקת בקשה ממתינה; הקובץ נמחק גם מ-R2.
window.deletePendingImageCloud = async function(id) {
    if (!window.db) throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
    if (!window.state.isSuperAdmin) throw new Error('מחיקת תמונה ממתינה דורשת אישור מנהל־על.');
    const imageId = safeRecordId(id);
    if (!imageId) throw new Error('מזהה התמונה אינו תקין.');
    try {
        const img = window.state.pendingImages.find(i => safeRecordId(i.id) === imageId);
        if (img) await window.deleteImageFromR2(img);
    } catch (e) {
        console.warn('R2 deletion failed or skipped during pending delete:', e);
    }
    const { doc, deleteDoc } = window.firestoreModules;
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', imageId));
};

window.logActivity = async function(action, targetType, targetId, targetName, details = '') {
    if (!window.db || !window.state.currentUser?.uid) return;
    try {
        const { doc, setDoc } = window.firestoreModules;
        const logId = `log_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'activityLogs', logId), {
            id: logId,
            action: String(action || 'activity').slice(0, 60),
            targetType: String(targetType || '').slice(0, 40),
            targetId: safeRecordId(targetId),
            targetName: String(targetName || '').slice(0, 160),
            details: String(details || '').slice(0, 400),
            actorUid: window.state.currentUser.uid,
            actorName: window.state.currentUser.displayName || window.state.currentUser.email || 'משתמש',
            actorRole: window.state.userRole || 'viewer',
            createdAt: Date.now()
        });
    } catch (error) {
        console.warn('Activity log write failed:', error);
    }
};

const trashCollectionByType = {
    image: 'images',
    pendingImage: 'pendingImages',
    folder: 'folders',
    user: 'userProfiles'
};

window.moveRecordToTrash = async function(type, record, options = {}) {
    if (!checkSuperAdminPermission()) return;
    const collectionName = trashCollectionByType[type];
    const originalId = safeRecordId(type === 'user' ? record?.uid : record?.id);
    if (!collectionName || !originalId || !record) throw new Error('הפריט למחיקה אינו תקין.');

    const { doc, setDoc, deleteDoc } = window.firestoreModules;
    const trashId = safeRecordId(options.trashId) || `trash_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const trashRecord = {
        id: trashId,
        originalType: type,
        originalId,
        originalCollection: collectionName,
        targetName: String(options.targetName || record.title || record.name || record.displayName || record.email || 'פריט').slice(0, 160),
        record,
        relatedImageIds: Array.isArray(options.relatedImageIds) ? options.relatedImageIds.map(safeRecordId).filter(Boolean) : [],
        relatedTrashIds: Array.isArray(options.relatedTrashIds) ? options.relatedTrashIds.map(safeRecordId).filter(Boolean) : [],
        parentTrashGroupId: safeRecordId(options.parentTrashGroupId),
        deletedAt: Date.now(),
        deletedBy: window.state.currentUser?.uid || '',
        deletedByName: window.state.currentUser?.displayName || window.state.currentUser?.email || 'מנהל־על'
    };

    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', trashId), trashRecord);
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', collectionName, originalId));
    window.state.trashItems = [trashRecord, ...(window.state.trashItems || [])];
    // Update local state immediately so the UI reflects the deletion without waiting for the next snapshot
    if (type === 'image') {
        window.state.images = (window.state.images || []).filter(item => safeRecordId(item.id) !== originalId);
        window.renderImages();
        window.renderFolders();
    } else if (type === 'pendingImage') {
        window.state.pendingImages = (window.state.pendingImages || []).filter(item => safeRecordId(item.id) !== originalId);
        window.renderPendingImages?.();
        window.updatePendingBadge?.();
    } else if (type === 'folder') {
        window.state.folders = (window.state.folders || []).filter(item => safeRecordId(item.id) !== originalId);
        if (window.state.activeFolderId === originalId) window.state.activeFolderId = 'all';
        window.renderFolders();
        window.renderImages();
    }
    window.renderTrashItems?.();
    await window.logActivity('moved_to_trash', type, originalId, trashRecord.targetName);
    return trashRecord;
};

window.moveImageToTrash = async function(id) {
    const image = (window.state.images || []).find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!image) throw new Error('התמונה לא נמצאה.');
    await window.moveRecordToTrash('image', image);
};

window.movePendingImageToTrash = async function(id) {
    const image = (window.state.pendingImages || []).find(item => safeRecordId(item.id) === safeRecordId(id));
    if (!image) throw new Error('התמונה הממתינה לא נמצאה.');
    await window.moveRecordToTrash('pendingImage', image);
};

window.moveFolderToTrash = async function(id) {
    const folderId = safeRecordId(id);
    const folder = (window.state.folders || []).find(item => safeRecordId(item.id) === folderId);
    if (!folder) throw new Error('התיקייה לא נמצאה.');
    const relatedImages = (window.state.images || []).filter(image => safeRecordId(image.folderId) === folderId);
    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'gallery'), {
        foldersInitialized: true,
        updatedAt: Date.now()
    }, { merge: true });
    const folderTrashId = `trash_folder_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const relatedTrashItems = [];
    for (const image of relatedImages) {
        const trashItem = await window.moveRecordToTrash('image', image, { parentTrashGroupId: folderTrashId });
        if (trashItem) relatedTrashItems.push(trashItem);
    }
    await window.moveRecordToTrash('folder', folder, {
        trashId: folderTrashId,
        relatedImageIds: relatedImages.map(image => image.id),
        relatedTrashIds: relatedTrashItems.map(item => item.id)
    });
    if (window.state.activeFolderId === folderId) window.state.activeFolderId = 'all';
};

window.moveUserToTrash = async function(uid) {
    const profile = (window.state.allUsers || []).find(user => safeRecordId(user.uid) === safeRecordId(uid));
    if (!profile) throw new Error('המשתמש לא נמצא.');
    await window.moveRecordToTrash('user', profile);
};

window.restoreTrashItem = async function(trashId, confirmed = false) {
    if (!checkSuperAdminPermission()) return;
    const item = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(trashId));
    if (!item) return;
    if (!confirmed) {
        showConfirm('שחזור פריט', `לשחזר את "${item.targetName || 'הפריט'}" למקום המקורי?`, () => window.restoreTrashItem(trashId, true));
        return;
    }
    const collectionName = trashCollectionByType[item.originalType];
    if (!collectionName || !item.record) throw new Error('נתוני השחזור אינם תקינים.');
    const { doc, setDoc, deleteDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', collectionName, safeRecordId(item.originalId)), item.record);
    if (item.originalType === 'folder' && Array.isArray(item.relatedTrashIds)) {
        for (const childTrashId of item.relatedTrashIds) {
            const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
            if (!child?.record) continue;
            await setDoc(
                doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', safeRecordId(child.originalId)),
                { ...child.record, folderId: item.originalId }
            );
            await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(child.id)));
        }
    }
    await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(item.id)));
    window.state.trashItems = (window.state.trashItems || []).filter(entry => entry.id !== item.id);
    // Update local state immediately so restored items appear without waiting for the next snapshot
    if (item.originalType === 'image' && item.record) {
        if (!(window.state.images || []).some(img => safeRecordId(img.id) === safeRecordId(item.originalId))) {
            window.state.images = [item.record, ...(window.state.images || [])];
            window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        window.renderImages();
        window.renderFolders();
    } else if (item.originalType === 'folder' && item.record) {
        if (!(window.state.folders || []).some(f => safeRecordId(f.id) === safeRecordId(item.originalId))) {
            window.state.folders = [...(window.state.folders || []), item.record];
        }
        // Restore related images
        if (Array.isArray(item.relatedTrashIds)) {
            for (const childTrashId of item.relatedTrashIds) {
                const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
                if (child?.record && !(window.state.images || []).some(img => safeRecordId(img.id) === safeRecordId(child.originalId))) {
                    window.state.images = [{ ...child.record, folderId: item.originalId }, ...(window.state.images || [])];
                }
            }
            window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            window.state.trashItems = (window.state.trashItems || []).filter(entry => !item.relatedTrashIds.includes(entry.id));
        }
        window.renderFolders();
        window.renderImages();
    }
    window.renderTrashItems?.();
    await window.logActivity('restored', item.originalType, item.originalId, item.targetName);
    window.showNotification('הפריט שוחזר בהצלחה.');
};

window.purgeTrashItem = async function(trashId, confirmed = false) {
    if (!checkSuperAdminPermission()) return;
    const item = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(trashId));
    if (!item) return;
    if (!confirmed) {
        showConfirm('מחיקה סופית', `למחוק לצמיתות את "${item.targetName || 'הפריט'}"? לאחר מכן לא יהיה אפשר לשחזר.`, () => window.purgeTrashItem(trashId, true));
        return;
    }
    try {
        if (['image', 'pendingImage'].includes(item.originalType) && item.record?.r2Key) {
            await window.deleteImageFromR2(item.record);
        }
        const { doc, deleteDoc } = window.firestoreModules;
        const purgedChildIds = new Set();
        if (item.originalType === 'folder' && Array.isArray(item.relatedTrashIds)) {
            for (const childTrashId of item.relatedTrashIds) {
                const child = (window.state.trashItems || []).find(entry => safeRecordId(entry.id) === safeRecordId(childTrashId));
                if (child?.record?.r2Key) await window.deleteImageFromR2(child.record);
                await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(childTrashId)));
                purgedChildIds.add(safeRecordId(childTrashId));
            }
        }
        await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems', safeRecordId(item.id)));
        window.state.trashItems = (window.state.trashItems || []).filter(entry =>
            entry.id !== item.id && !purgedChildIds.has(safeRecordId(entry.id))
        );
        window.renderTrashItems?.();
        await window.logActivity('purged', item.originalType, item.originalId, item.targetName);
        window.showNotification('הפריט נמחק לצמיתות.');
    } catch (error) {
        console.error('purgeTrashItem failed:', error);
        window.showNotification('מחיקה לצמיתות נכשלה.', false);
    }
};


function updateThemeToggleUI(theme) {
    const isLight = theme === 'light';
    const button = document.getElementById('themeToggleButton');
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');
    if (button) {
        button.setAttribute('aria-label', isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר');
        button.setAttribute('aria-pressed', String(isLight));
    }
    if (icon) icon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    if (text) text.textContent = isLight ? 'כהה' : 'בהיר';
    scheduleIconRefresh();
}

window.setSiteTheme = function(theme, persist = true) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'light' ? '#f8fafc' : '#090b10');
    if (persist) {
        try {
            localStorage.setItem('simchat-color-theme', nextTheme);
        } catch (error) {
            console.warn('Theme preference could not be saved:', error);
        }
    }
    updateThemeToggleUI(nextTheme);
};

window.toggleSiteTheme = function() {
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    window.setSiteTheme(currentTheme === 'light' ? 'dark' : 'light');
};


// =================== END POPUP ANNOUNCEMENT ===================

function initAmbientArchiveBackground() {
    // הרקע נשאר סטטי לחלוטין: אין לולאת ציור ואין תגובה לתנועת העכבר.
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
}



// המודולים תוקשרו זה לזה דרך window, ולכן העזרים המשותפים נחשפים כאן
// לפני שפונקציות האתחול של שאר המודולים רצות.
window.escapeHtml = escapeHtml;
window.safeRecordId = safeRecordId;
window.safeIconName = safeIconName;
window.safeImageUrl = safeImageUrl;
window.isVideoRecord = isVideoRecord;
window.handleImageError = handleImageError;
window.sha256 = sha256;
window.dataUrlToBlob = dataUrlToBlob;
window.formatBytes = formatBytes;
window.r2Request = r2Request;
window.R2_WORKER_BASE_URL = R2_WORKER_BASE_URL;

// אתחול מפורש ובסדר קבוע: השכבה המשותפת כבר מוכנה, ועכשיו מתחילה
// שכבת ההתחברות. סנכרון Drive עצמו נטען רק בדף הניהול.
initSession();

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.setSiteTheme(document.documentElement.dataset.theme, false);
        initAmbientArchiveBackground();
        scheduleIconRefresh();
        initSessionUI();
        initGallery();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
        }
    } catch (error) {
        console.error('UI initialization error:', error);
    }
});
