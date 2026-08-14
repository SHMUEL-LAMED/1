// חיבור Drive: התחלה, אסימון, שחזור חיבור וניתוק
// פוצל מתוך drive-sync.js. הקוד עצמו לא שונה — רק מיקומו.

import { auth, dismissGoogleOneTap } from './google-auth.js';
import { loadDriveFolders } from './sync.js';

export let driveAccessToken = null;

// driveAccessToken מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setDriveAccessToken(value) {
    driveAccessToken = value;
}

export let driveAccessTokenExpiresAt = 0;

// driveAccessTokenExpiresAt מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setDriveAccessTokenExpiresAt(value) {
    driveAccessTokenExpiresAt = value;
}

let driveRestorePromise = null;

// driveRestorePromise מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setDriveRestorePromise(value) {
    driveRestorePromise = value;
}

let driveRestoredForUid = '';

// driveRestoredForUid מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setDriveRestoredForUid(value) {
    driveRestoredForUid = value;
}

const DRIVE_WORKER_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';

export const driveReturnStatus = new URLSearchParams(window.location.search).get('drive');

function setDriveConnectionUI(email = '') {
    const connected = Boolean(driveAccessToken);
    window.driveConnectionActive = connected;
    const status = document.getElementById('driveConnectionStatus');
    const connectButton = document.getElementById('connectDriveBtn');
    const syncButton = document.getElementById('driveSyncBtn');

    if (status) {
        status.textContent = connected
            ? `מחובר ל־Google Drive${email ? `: ${email}` : ''}`
            : 'Google Drive עדיין לא מחובר';
        status.className = connected
            ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-700'
            : 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold text-slate-500';
    }
    if (connectButton) {
        connectButton.innerHTML = connected
            ? '<i data-lucide="refresh-cw" class="w-4 h-4"></i> החלף חשבון Drive'
            : '<i data-lucide="cloud" class="w-4 h-4"></i> חבר Google Drive';
    }
    if (syncButton) syncButton.disabled = !connected;
    window.scheduleIconRefresh();
}

export function clearDriveConnection() {
    driveAccessToken = null;
    driveAccessTokenExpiresAt = 0;
    driveRestoredForUid = '';
    setDriveConnectionUI();
}

async function driveWorkerRequest(path, options = {}) {
    const user = auth?.currentUser;
    if (!user || user.isAnonymous) throw new Error('יש להתחבר עם חשבון Google תחילה.');
    const token = await user.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${DRIVE_WORKER_BASE_URL}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.message || `שגיאת חיבור ל־Drive (${response.status}).`);
        error.code = payload?.code || 'drive_worker_error';
        error.status = response.status;
        throw error;
    }
    return payload;
}

export async function restoreDriveConnection(showSuccessNotice = false, forceRefresh = false) {
    const user = auth?.currentUser;
    if (!user || user.isAnonymous || !window.state?.isAdminLoggedIn) return false;
    if (!forceRefresh && driveAccessToken && driveAccessTokenExpiresAt > Date.now() + 60000) return true;
    if (!forceRefresh && driveRestoredForUid === user.uid && !driveAccessToken) return false;
    if (driveRestorePromise) return driveRestorePromise;

    driveRestorePromise = (async () => {
        try {
            const payload = await driveWorkerRequest('/drive/token', { method: 'POST' });
            driveRestoredForUid = user.uid;
            if (!payload.connected || !payload.accessToken) {
                driveAccessToken = null;
                driveAccessTokenExpiresAt = 0;
                setDriveConnectionUI();
                return false;
            }
            driveAccessToken = payload.accessToken;
            driveAccessTokenExpiresAt = Number(payload.expiresAt) || (Date.now() + 50 * 60 * 1000);
            setDriveConnectionUI(payload.email || user.email || '');
            loadDriveFolders(); // ← טוען תיקיות שמורות
            if (showSuccessNotice) window.showNotification('Google Drive מחובר קבוע ושוחזר אוטומטית.', true);
            return true;
        } catch (error) {
            console.error('Restoring persistent Drive connection failed:', error);
            driveAccessToken = null;
            driveAccessTokenExpiresAt = 0;
            driveRestoredForUid = user.uid;
            setDriveConnectionUI();
            if (showSuccessNotice || error.code === 'drive_oauth_not_configured') {
                window.showNotification(error.message || 'לא ניתן לשחזר את החיבור ל־Google Drive.', false);
            }
            return false;
        } finally {
            driveRestorePromise = null;
        }
    })();
    return driveRestorePromise;
}

window.restoreDriveConnection = restoreDriveConnection;

window.connectGoogleDrive = async function(confirmed = false) {
    if (!window.checkAdminPermission?.()) return;
    if (!confirmed) {
        window.showConfirm(
            'חיבור Google Drive',
            'להמשיך למסך Google ולאשר לאתר גישה לקריאת התמונות והתיקיות שבחרת לסנכרון?',
            () => window.connectGoogleDrive(true)
        );
        return;
    }

    const button = document.getElementById('connectDriveBtn');
    if (button) button.disabled = true;
    try {
        const payload = await driveWorkerRequest('/drive/oauth/start', { method: 'POST' });
        if (!payload.authorizationUrl) throw new Error('לא התקבלה כתובת חיבור משרת Drive.');
        dismissGoogleOneTap();
        window.location.assign(payload.authorizationUrl);
    } catch (error) {
        console.error('Google Drive connection failed:', error);
        window.showNotification(error.message || 'החיבור ל־Google Drive נכשל.', false);
    } finally {
        if (button) button.disabled = false;
    }
};

window.restoreDriveConnection = restoreDriveConnection;
