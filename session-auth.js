// session-auth.js — שכבת ההתחברות והנתונים המשותפת לשני הדפים.
//
// כאן נמצאים חיבור החשבון, פרופיל המשתמש, מאזיני הגלריה ומעטפת הסקרים
// (onSnapshot) שכולם נשענים עליה. סנכרון Google Drive עצמו — שהיה כאן
// עד היום וירד לכל מבקר — עבר ל-drive-sync.js, שנטען רק בדף הניהול.
//
// כל קריאה לפונקציה של מודול הניהול נעשית דרך window ובאופציונלי, כדי
// שדף הגלריה יעבוד בלעדיו לחלוטין.
import { initializeApp, getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, getRedirectResult, signOut, getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit, mutateConversationMessages, deleteConversationAttachmentObject } from "./cloudflare-client.js";

// שכבת תאימות: הממשק הקיים נשאר זהה, והנתונים נשמרים ב־Cloudflare D1.
window.db = null;
window.appId = typeof __app_id !== 'undefined' ? __app_id : 'org-gallery';
window.firestoreModules = { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit, mutateConversationMessages, deleteConversationAttachmentObject };


// D1 משתמש בבקשות HTTPS רגילות. במקום לסרוק את כל מסד הנתונים
// כל חמש שניות, כל מקור נטען פעם אחת ומתרענן במרווח חסכוני ורק כשהעמוד פעיל.
// בשגיאת מכסה מופעלת השהיה ארוכה כדי לא להחריף את התקלה.
export function onSnapshot(reference, onNext, onError, options = {}) {
    let active = true;
    let requestRunning = false;
    let timer = null;
    let lastRefreshAt = 0;
    let consecutiveErrors = 0;
    let retryNotBefore = 0;
    const isDocument = reference.type === 'document';
    const normalDelay = isDocument ? 2 * 60 * 1000 : 15 * 60 * 1000;
    const minimumEventDelay = isDocument ? 30 * 1000 : 2 * 60 * 1000;

    const schedule = (delay = normalDelay) => {
        if (!active) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => refresh(), delay);
    };

    const refresh = async (force = false) => {
        if (!active || requestRunning) return;
        if (retryNotBefore > Date.now()) {
            schedule(retryNotBefore - Date.now());
            return;
        }
        if (document.hidden) {
            schedule(normalDelay);
            return;
        }
        if (!force && lastRefreshAt && Date.now() - lastRefreshAt < minimumEventDelay) {
            schedule(minimumEventDelay - (Date.now() - lastRefreshAt));
            return;
        }
        requestRunning = true;
        try {
            const snapshot = isDocument
                ? await getDoc(reference)
                : await getDocs(reference);
            if (active) {
                lastRefreshAt = Date.now();
                consecutiveErrors = 0;
                retryNotBefore = 0;
                onNext(snapshot);
            }
        } catch (error) {
            consecutiveErrors += 1;
            const retryDelay = Math.min(normalDelay, 30 * 1000 * (2 ** Math.min(consecutiveErrors - 1, 5)));
            retryNotBefore = Date.now() + retryDelay;
            if (active && typeof onError === 'function') onError(error);
        } finally {
            requestRunning = false;
            if (active) {
                schedule(consecutiveErrors ? Math.max(1000, retryNotBefore - Date.now()) : normalDelay);
            }
        }
    };

    const refreshWhenActive = () => {
        if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', refreshWhenActive);
    window.addEventListener('online', refreshWhenActive);
    window.addEventListener('focus', refreshWhenActive);
    if (options.initialDelay) {
        timer = window.setTimeout(() => refresh(true), options.initialDelay);
    } else {
        refresh(true);
    }
    return () => {
        active = false;
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', refreshWhenActive);
        window.removeEventListener('online', refreshWhenActive);
        window.removeEventListener('focus', refreshWhenActive);
    };
}
window.firestoreUnsubscribers = [];
window.galleryUnsubscribers = [];
window.adminUnsubscribers = [];

let auth = null;
// חזרה מחיבור Drive מגיעה כפרמטר בכתובת. ההודעה וניקוי הכתובת שייכים
// לכל דף שאליו המשתמש חוזר, ולכן נשארו כאן; אסימוני Drive עצמם מנוהלים
// במודול הניהול.
const driveReturnStatus = new URLSearchParams(window.location.search).get('drive');
// נשמרות רק טביעות SHA-256 של חשבון מנהל-העל, לא הכתובת או המזהה עצמם.
const INITIAL_ADMIN_UID_SHA256 = 'b38e92d2900b2c32ddfe921142715cc2becbe7b77d9e911196d7a561574d8b39';
const INITIAL_SUPER_ADMIN_EMAIL_SHA256S = new Set([
    '0c70c93b21ed7d7ac11f8a0e41cf0811b221f8e16524ed71d8b1822661edc137',
    'd2632af59d29239eef52f10e1cfbf38e27c65c55470b355134b1cd1fb4f809d6'
]);
// חלון ה-One Tap של Google מסתיר את חלון בחירת החשבון, ולכן גם חיבור
// Drive שבמודול הניהול סוגר אותו לפני הניווט.
export function dismissGoogleOneTap() {
    try {
        window.google?.accounts?.id?.cancel();
    } catch (error) {
        console.warn('Google One Tap dismissal failed:', error);
    }
}

async function secureHash(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (!normalizedValue || !window.crypto?.subtle) return '';
    const bytes = new TextEncoder().encode(normalizedValue);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function isInitialSuperAdmin(user) {
    if (!user) return false;
    const [uidHash, emailHash] = await Promise.all([
        secureHash(user.uid),
        secureHash(user.email)
    ]);
    return uidHash === INITIAL_ADMIN_UID_SHA256 || INITIAL_SUPER_ADMIN_EMAIL_SHA256S.has(emailHash);
}

// ההתחברות עצמה מנוהלת ב־cloudflare-client.js, שם נפתח חלון בחירת החשבון
// הרשמי של Google. כאן רק מוודאים שאין חלון Google פתוח שמסתיר אותו.
window.signInWithGoogleAccount = async function() {
    dismissGoogleOneTap();
    return window.openGoogleAccountChooser();
};

window.signOutGoogleAccount = async function(confirmed = false) {
    if (!auth) return;
    if (!confirmed) {
        window.showConfirm(
            'התנתקות מהחשבון',
            'להתנתק מחשבון Google? לאחר מכן יהיה צורך להתחבר מחדש כדי לגשת לאזור האישי.',
            () => window.signOutGoogleAccount(true)
        );
        return;
    }
    try {
        window.google?.accounts?.id?.disableAutoSelect();
        window.clearDriveConnection?.();
        await signOut(auth);
        window.showNotification("התנתקת מחשבון Google.", true);
    } catch (e) {
        console.error(e);
        window.showNotification("לא ניתן היה להתנתק.", false);
    }
};

window.lockGalleryImmediatelySidebar = async function(confirmed = false) {
    if (!auth) return;
    if (!confirmed) {
        window.showConfirm(
            'יציאה ממצב ניהול',
            'לצאת ממצב הניהול ולהתנתק מהחשבון? פעולות שלא נשמרו בחלונות פתוחים יאבדו.',
            () => window.lockGalleryImmediatelySidebar(true)
        );
        return;
    }
    try {
        window.showNotification("מתנתק ממצב ניהול...", true);
        window.clearDriveConnection?.();
        await signOut(auth);
        window.showNotification("התנתקת בהצלחה. חזרת למצב משתמש.", true);
    } catch (e) {
        console.error(e);
        window.showNotification("שגיאה במהלך ההתנתקות.", false);
    }
};

export function reportFirestoreError(err) {
    if (err.code === 'unavailable') {
        console.warn("חיבור הרשת חלש או חסום (Offline). מנסה להתחבר מחדש ברקע...");
    } else if (err.code === 'database_binding_missing') {
        console.error("Cloudflare D1 binding is missing.", err);
        window.showNotification("מסד הנתונים של Cloudflare עדיין לא חובר ל־Worker.", false);
    } else if (err.code === 'permission-denied') {
        console.error("Cloudflare D1 request denied.", err);
        window.showNotification("שגיאת אבטחה: אין הרשאת גישה לנתונים.", false);
    } else {
        console.error("Cloudflare data error:", err);
    }
}

async function syncGoogleUserProfile(user) {
    const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', user.uid);
    const [snapshot, isInitialAdmin] = await Promise.all([
        getDoc(profileRef),
        isInitialSuperAdmin(user)
    ]);
    const commonData = {
        uid: user.uid,
        displayName: user.displayName || 'משתמש Google',
        email: user.email || '',
        photoURL: user.photoURL || '',
        lastLoginAt: Date.now()
    };

    if (!snapshot.exists()) {
        await setDoc(profileRef, {
            ...commonData,
            status: isInitialAdmin ? 'approved' : 'pending',
            role: isInitialAdmin ? 'super_admin' : 'viewer',
            requestedAt: Date.now(),
            ...(isInitialAdmin ? {
                approvedAt: Date.now(),
                approvedBy: 'initial-admin-bootstrap'
            } : {})
        });
        window.showNotification(
            isInitialAdmin
                ? 'חשבון המנהל הראשי הופעל בהצלחה.'
                : 'התחברת בהצלחה. בקשת ההצטרפות נשלחה לאישור מנהל.',
            true
        );
    } else {
        const existingProfile = snapshot.data();
        const shouldPromoteInitialAdmin = isInitialAdmin && (
            existingProfile.status !== 'approved' || existingProfile.role !== 'super_admin'
        );
        const writePromise = setDoc(profileRef, {
            ...commonData,
            ...(isInitialAdmin ? {
                status: 'approved',
                role: 'super_admin',
                approvedAt: existingProfile.approvedAt || Date.now(),
                approvedBy: existingProfile.approvedBy || 'initial-admin-bootstrap'
            } : {})
        }, { merge: true });
        // משתמש מחזיר ללא קידום — שולחים עדכון lastLoginAt ברקע כדי לא לעכב טעינת הגלריה
        if (!shouldPromoteInitialAdmin) {
            writePromise.catch(error => console.warn('Profile update failed:', error));
        } else {
            await writePromise;
            window.showNotification('חשבון המנהל הראשי הופעל בהצלחה.', true);
        }
    }
}

async function ensureGoogleUserProfile(user) {
    await user.getIdToken();
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await syncGoogleUserProfile(user);
            return;
        } catch (error) {
            const isAuthError = error?.code === 'permission-denied' || error?.code === 'unauthenticated';
            const isTemporaryNetworkError = error?.code === 'unavailable';
            const canRetry = (isAuthError || isTemporaryNetworkError) && attempt < maxAttempts;

            if (!canRetry) throw error;

            if (isAuthError) {
                // לאחר One Tap ייתכן שאסימון Google התעדכן רגע לפני מסד הנתונים.
                await user.getIdToken(true);
            }

            // חיבורי רשת מסוימים צריכים זמן נוסף לפני ניסיון חוזר.
            await new Promise(resolve => setTimeout(resolve, isTemporaryNetworkError ? attempt * 1200 : 500));
        }
    }
}

async function initFirebase() {
    try {
        const counter = document.getElementById('imageCounter');
        if(counter) counter.innerText = "מתחבר לענן...";

        const firebaseConfig = { provider: 'cloudflare-d1', appId: 'org-gallery' };

        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        // שם תאימות לקוד הקיים; בפועל מוחזר אסימון Google ישיר.
        window.getFirebaseIdToken = async function(forceRefresh = false) {
            const user = auth?.currentUser;
            if (!user) throw new Error('יש להתחבר עם חשבון Google לפני העלאת תמונות.');
            return user.getIdToken(forceRefresh);
        };
        auth.useDeviceLanguage();
        try {
            const redirectResult = await getRedirectResult(auth);
            if (redirectResult?.user) window.showNotification("התחברת בהצלחה באמצעות Google!", true);
        } catch (e) {
            console.error("Google authentication restore error", e);
        }

        if (driveReturnStatus) {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('drive');
            window.history.replaceState(null, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
            if (driveReturnStatus !== 'connected') {
                window.showNotification(
                    driveReturnStatus === 'cancelled'
                        ? 'החיבור ל־Google Drive בוטל.'
                        : 'החיבור הקבוע ל־Google Drive לא הושלם. נסה שוב.',
                    false
                );
            }
        }

        window.db = getFirestore(app);
        // טעינת הפופ־אפ מחוברת לרגע שבו הענן באמת מוכן.
        window.loadPopupAnnouncement?.();

        // ניהול הזדהות ישיר מול Google, ללא Firebase Authentication.
        onAuthStateChanged(auth, async (user) => {
            window.stopAdminListeners?.();
            if (user) {
                const providerIds = (user.providerData || []).map(p => p.providerId);
                const isGoogleUser = !user.isAnonymous && providerIds.includes('google.com');

                window.state.currentUser = user;
                window.state.isGoogleUser = isGoogleUser;
                const isInitialAdmin = isGoogleUser && await isInitialSuperAdmin(user);
                window.state.isInitialSuperAdminAccount = isInitialAdmin;
                window.state.isAdminLoggedIn = isInitialAdmin;
                window.state.isSuperAdmin = isInitialAdmin;
                window.state.isLocked = !isInitialAdmin;
                window.state.userProfile = isInitialAdmin ? {
                    uid: user.uid,
                    displayName: user.displayName || 'מנהל המערכת',
                    email: user.email || '',
                    photoURL: user.photoURL || '',
                    status: 'approved',
                    role: 'super_admin'
                } : null;
                window.state.userRole = isInitialAdmin ? 'super_admin' : (isGoogleUser ? 'viewer' : 'guest');
                window.state.userApprovalStatus = isInitialAdmin ? 'approved' : (isGoogleUser ? 'pending' : 'signed_out');

                window.updateAdminUI();
                // סנכרון הפרופיל ואתחול המאזינים רצים במקביל —
                // המאזין על הפרופיל מפעיל את טעינת הגלריה ברגע שהפרופיל זמין.
                if (isGoogleUser) {
                    ensureGoogleUserProfile(user).catch(error => {
                        console.error('Creating Google user profile failed:', error);
                        const errorCode = error?.code || 'unknown';
                        window.showNotification(`לא ניתן היה לשלוח את בקשת ההצטרפות (${errorCode}).`, false);
                    });
                }
                setupFirestoreListeners(user);
            } else {
                
                // Reset Floating Panel signed out state
                const floatingUserPhoto = document.getElementById('floatingUserPhoto');
                const floatingUserFallback = document.getElementById('floatingUserFallback');
                const floatingSignedOutView = document.getElementById('floatingSignedOutView');
                const floatingSignedInView = document.getElementById('floatingSignedInView');
                const floatingWidgetBadge = document.getElementById('floatingWidgetBadge');
                const floatingInboxList = document.getElementById('floatingInboxList');

                if(floatingUserPhoto) floatingUserPhoto.classList.add('hidden');
                if(floatingUserFallback) floatingUserFallback.classList.remove('hidden');
                if(floatingSignedOutView) floatingSignedOutView.classList.remove('hidden');
                if(floatingSignedInView) floatingSignedInView.classList.add('hidden');
                if(floatingWidgetBadge) floatingWidgetBadge.classList.add('hidden');
                if(floatingInboxList) floatingInboxList.innerHTML = '<p class="text-[10px] text-slate-500 text-center py-4">התחבר כדי לראות הודעות.</p>';
    
                window.clearDriveConnection?.();
                window.firestoreUnsubscribers.forEach(unsubscribe => { try { unsubscribe(); } catch (error) {} });
                window.galleryUnsubscribers.forEach(unsubscribe => { try { unsubscribe(); } catch (error) {} });
                window.firestoreUnsubscribers = [];
                window.galleryUnsubscribers = [];
                window.state.currentUser = null;
                window.state.isGoogleUser = false;
                window.state.isInitialSuperAdminAccount = false;
                window.state.isAdminLoggedIn = false;
                window.state.isSuperAdmin = false;
                window.state.isLocked = true;
                window.state.userProfile = null;
                window.state.userRole = 'guest';
                window.state.userApprovalStatus = 'signed_out';
                window.state.images = [];
                window.state.folders = defaultFolders();
                window.state.favorites = new Set();
                window.state.selectedMediaIds = new Set();
                window.state.bulkSelectionMode = false;
                window.updateAdminUI();
                window.renderFolders();
                window.renderImages();
                // אם אין משתמש מחובר בכלל, נבצע התחברות אנונימית לקריאת נתונים
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch(err) {
                    console.error("Anonymous authentication failed", err);
                }
            }
        });
    } catch (e) {
        console.error("Cloudflare Init Error:", e);
        window.showNotification("שגיאה בחיבור לענן. הנתונים לא יסונכרנו.", false);
    }
}

// נקרא בזמן ריצה ולא בזמן טעינת המודול, כדי שלא להיות תלוי בסדר
// ההרצה של המודולים. app.js מגדיר את ברירת המחדל לפני כל שימוש.
function defaultFolders() {
    return window.DEFAULT_GALLERY_FOLDERS.map(folder => ({ ...folder }));
}

function setupFirestoreListeners(user) {
    if (!user) return;
    window.firestoreUnsubscribers.forEach(unsubscribe => {
        try { unsubscribe(); } catch (error) { console.warn('Listener cleanup failed:', error); }
    });
    window.firestoreUnsubscribers = [];
    window.galleryUnsubscribers.forEach(unsubscribe => {
        try { unsubscribe(); } catch (error) { console.warn('Gallery listener cleanup failed:', error); }
    });
    window.galleryUnsubscribers = [];

    const handleFsError = reportFirestoreError;

    const stopGalleryListeners = () => {
        window.galleryUnsubscribers.forEach(unsubscribe => {
            try { unsubscribe(); } catch (error) { console.warn('Gallery listener cleanup failed:', error); }
        });
        window.galleryUnsubscribers = [];
        window.state.images = [];
        window.state.folders = defaultFolders();
        window.state.gallerySnapshotInitialized = false;
        window.renderFolders();
        window.renderImages();
    };

    const startGalleryListeners = () => {
        if (window.galleryUnsubscribers.length > 0) return;

        // מאזין לתיקיות רק לאחר קבלת הרשאת צפייה.
        window.galleryUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'folders'), async (snapshot) => {
        if (snapshot.empty) {
            let alreadyInitialized = false;
            try {
                const metaSnapshot = await getDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'gallery'));
                alreadyInitialized = metaSnapshot.exists() && metaSnapshot.data()?.foldersInitialized === true;
            } catch (error) {
                console.warn('Folder initialization marker unavailable:', error);
            }
            window.state.folders = alreadyInitialized
                ? defaultFolders().filter(folder => window.safeRecordId(folder.id) === 'all')
                : defaultFolders();
            window.renderFolders();
            window.populateFolderSelects();
            if (window.state.isAdminLoggedIn && !alreadyInitialized) {
                defaultFolders().forEach(folder => window.saveFolderToCloud(folder).catch(handleFsError));
                setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'gallery'), {
                    foldersInitialized: true,
                    updatedAt: Date.now()
                }, { merge: true }).catch(handleFsError);
            }
        } else {
            window.state.folders = snapshot.docs.map(d => {
                const folder = d.data();
                return String(folder.id) === '4' && !String(folder.name || '').trim()
                    ? { ...folder, name: 'כללי' }
                    : folder;
            });
            window.state.folders.sort((a, b) => a.id === 'all' ? -1 : b.id === 'all' ? 1 : 0);
            window.renderFolders(); window.populateFolderSelects();
        }
        }, handleFsError));

        // מאזין לתמונות פעילות רק לאחר קבלת הרשאת צפייה.
        window.galleryUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images'), (snapshot) => {
            const previousIds = new Set((window.state.images || []).map(item => window.safeRecordId(item.id)));
            const nextImages = snapshot.docs.map(d => d.data());
            if (window.state.gallerySnapshotInitialized) {
                const followedNewItems = nextImages.filter(item => !previousIds.has(window.safeRecordId(item.id)) && window.state.followedFolders.has(window.safeRecordId(item.folderId)));
                if (followedNewItems.length) {
                    const folderNames = [...new Set(followedNewItems.map(item => window.state.folders.find(folder => window.safeRecordId(folder.id) === window.safeRecordId(item.folderId))?.name).filter(Boolean))];
                    window.showNotification(`נוספו ${followedNewItems.length} פריטים חדשים${folderNames.length ? ` ב־${folderNames.join(', ')}` : ''}.`, true);
                }
            }
            window.state.images = nextImages;
            window.state.gallerySnapshotInitialized = true;
            window.state.images.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            window.renderImages();
            window.checkNewUpdates();
        }, handleFsError));
    };

    if (window.state.isAdminLoggedIn) {
        startGalleryListeners();
        window.startAdminListeners?.();
    }

    // פרופיל Google נפרד לכל משתמש; שינוי הרשאה מתעדכן בזמן אמת.
    if (window.state.isGoogleUser) {
        const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', user.uid);
        window.firestoreUnsubscribers.push(onSnapshot(profileRef, (snapshot) => {
            if (!snapshot.exists()) return;
            const storedProfile = { uid: snapshot.id, ...snapshot.data() };
            // חשבון מנהל ברירת־המחדל נשאר דרגה 4 גם אם נשארה ב־D1
            // רשומת pending ישנה מתקלה קודמת. ה־Worker מאמת זאת שוב בשרת.
            const profile = window.state.isInitialSuperAdminAccount ? {
                ...storedProfile,
                status: 'approved',
                role: 'super_admin'
            } : storedProfile;
            const allowedRoles = ['viewer', 'uploader', 'admin', 'super_admin'];
            const approved = profile.status === 'approved';
            const role = approved && allowedRoles.includes(profile.role) ? profile.role : 'viewer';

            window.state.userProfile = profile;
            window.state.userApprovalStatus = profile.status || 'pending';
            window.state.userRole = role;
            window.state.isSuperAdmin = approved && role === 'super_admin';
            window.state.isAdminLoggedIn = approved && (role === 'admin' || role === 'super_admin');
            window.state.isLocked = !window.state.isAdminLoggedIn;

            if (approved) startGalleryListeners();
            else stopGalleryListeners();
            if (window.state.isAdminLoggedIn) {
                window.startAdminListeners?.();
                window.restoreDriveConnection?.(driveReturnStatus === 'connected');
            }
            else {
                window.clearDriveConnection?.();
                window.stopAdminListeners?.();
            }
            window.updateAdminUI();
            if (approved && window.state.popupAnnouncementConfig) {
                window.showPopupAnnouncement?.(window.state.popupAnnouncementConfig);
            }
        }, handleFsError));

        const favoritesRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userFavorites', user.uid);
        window.firestoreUnsubscribers.push(onSnapshot(favoritesRef, (snapshot) => {
            const ids = snapshot.exists() && Array.isArray(snapshot.data()?.mediaIds)
                ? snapshot.data().mediaIds.map(safeRecordId).filter(Boolean)
                : [];
            window.state.favorites = new Set(ids);
            window.renderFolders?.();
            window.renderImages?.();
        }, handleFsError));

        const preferencesRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userPreferences', user.uid);
        window.firestoreUnsubscribers.push(onSnapshot(preferencesRef, (snapshot) => {
            const ids = snapshot.exists() && Array.isArray(snapshot.data()?.followedFolderIds)
                ? snapshot.data().followedFolderIds.map(safeRecordId).filter(Boolean)
                : [];
            window.state.followedFolders = new Set(ids);
        }, handleFsError));
    }

    if (!window._popupAnnouncementLoaded) {
        window._popupAnnouncementLoaded = true;
        setTimeout(() => window.loadPopupAnnouncement?.(), 1200);
    }
}

// נקודת האתחול של המודול. app.js קורא לה פעם אחת בטעינת האתר.
// מודול ה-Drive מקבל את מופע ההזדהות דרך הפונקציה הזו במקום להחזיק
// עותק משלו, כך שיש מקור אמת אחד לחשבון המחובר.
export function getAuthInstance() {
    return auth;
}

export function initSession() {
    initFirebase();
}
