// drive-sync.js — חיבור וסנכרון Google Drive, סריקה רקורסיבית, מחיקות ותיקיות ריקות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.


// שכבת תאימות: הממשק הקיים נשאר זהה, והנתונים נשמרים ב־Cloudflare D1.

import { initializeApp, getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, getRedirectResult, signOut, getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit, mutateConversationMessages, deleteConversationAttachmentObject } from "./cloudflare-client.js";

import { defaultFolders, setupFirestoreListeners, stopAdminListeners } from './features/drive/listeners.js';
import { auth, ensureGoogleUserProfile, isInitialSuperAdmin, setAuth } from './features/drive/google-auth.js';
import { clearDriveConnection, driveReturnStatus } from './features/drive/oauth.js';
import './features/drive/picker.js';
import './features/drive/sync.js';

window.db = null;

window.appId = typeof __app_id !== 'undefined' ? __app_id : 'org-gallery';

window.firestoreModules = { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit, mutateConversationMessages, deleteConversationAttachmentObject };

window.firestoreUnsubscribers = [];

window.galleryUnsubscribers = [];

window.adminUnsubscribers = [];

async function initFirebase() {
    try {
        const counter = document.getElementById('imageCounter');
        if(counter) counter.innerText = "מתחבר לענן...";

        const firebaseConfig = { provider: 'cloudflare-d1', appId: 'org-gallery' };

        const app = initializeApp(firebaseConfig);
        setAuth(getAuth(app));
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
            stopAdminListeners();
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
    
                clearDriveConnection();
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

export function initDriveSync() {
    initFirebase();
}
