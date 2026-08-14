// כניסה ויציאה מחשבון Google, זיהוי מנהל־על וסנכרון הפרופיל
// פוצל מתוך drive-sync.js. הקוד עצמו לא שונה — רק מיקומו.

import { doc, getDoc, setDoc, signOut } from '../../cloudflare-client.js';
import { clearDriveConnection } from './oauth.js';

export let auth = null;

// auth מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setAuth(value) {
    auth = value;
}

const INITIAL_ADMIN_UID_SHA256 = 'b38e92d2900b2c32ddfe921142715cc2becbe7b77d9e911196d7a561574d8b39';

const INITIAL_SUPER_ADMIN_EMAIL_SHA256S = new Set([
    '0c70c93b21ed7d7ac11f8a0e41cf0811b221f8e16524ed71d8b1822661edc137',
    'd2632af59d29239eef52f10e1cfbf38e27c65c55470b355134b1cd1fb4f809d6'
]);

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

export async function isInitialSuperAdmin(user) {
    if (!user) return false;
    const [uidHash, emailHash] = await Promise.all([
        secureHash(user.uid),
        secureHash(user.email)
    ]);
    return uidHash === INITIAL_ADMIN_UID_SHA256 || INITIAL_SUPER_ADMIN_EMAIL_SHA256S.has(emailHash);
}

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
        clearDriveConnection();
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
        clearDriveConnection();
        await signOut(auth);
        window.showNotification("התנתקת בהצלחה. חזרת למצב משתמש.", true);
    } catch (e) {
        console.error(e);
        window.showNotification("שגיאה במהלך ההתנתקות.", false);
    }
};

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

export async function ensureGoogleUserProfile(user) {
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
