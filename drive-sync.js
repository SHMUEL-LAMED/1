// drive-sync.js — חיבור וסנכרון Google Drive, סריקה רקורסיבית, מחיקות ותיקיות ריקות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.

import { initializeApp, getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit } from "./cloudflare-client.js";

// שכבת תאימות: הממשק הקיים נשאר זהה, והנתונים נשמרים ב־Cloudflare D1.
window.db = null;
window.appId = typeof __app_id !== 'undefined' ? __app_id : 'org-gallery';
window.firestoreModules = { collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, increment, query, orderBy, limit };


// D1 משתמש בבקשות HTTPS רגילות. במקום לסרוק את כל מסד הנתונים
// כל חמש שניות, כל מקור נטען פעם אחת ומתרענן במרווח חסכוני ורק כשהעמוד פעיל.
// בשגיאת מכסה מופעלת השהיה ארוכה כדי לא להחריף את התקלה.
function onSnapshot(reference, onNext, onError, options = {}) {
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
let driveAccessToken = null;
let driveAccessTokenExpiresAt = 0;
let driveRestorePromise = null;
let driveRestoredForUid = '';
let oneTapInitialized = false;
let oneTapPromptRequested = false;
const GOOGLE_ONE_TAP_CLIENT_ID = '601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com';
const DRIVE_WORKER_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';
const driveReturnStatus = new URLSearchParams(window.location.search).get('drive');
// נשמרות רק טביעות SHA-256 של חשבון מנהל-העל, לא הכתובת או המזהה עצמם.
const INITIAL_ADMIN_UID_SHA256 = 'b38e92d2900b2c32ddfe921142715cc2becbe7b77d9e911196d7a561574d8b39';
const INITIAL_SUPER_ADMIN_EMAIL_SHA256S = new Set([
    '0c70c93b21ed7d7ac11f8a0e41cf0811b221f8e16524ed71d8b1822661edc137',
    'd2632af59d29239eef52f10e1cfbf38e27c65c55470b355134b1cd1fb4f809d6'
]);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

function dismissGoogleOneTap() {
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

async function handleGoogleOneTapCredential(response) {
    if (!response?.credential) return;
    try {
        const credential = GoogleAuthProvider.credential(response.credential);
        await signInWithCredential(auth, credential);
        dismissGoogleOneTap();
        window.showNotification('התחברת בהצלחה באמצעות Google!', true);
    } catch (error) {
        console.error('Google One Tap sign-in failed:', error);
        window.showNotification('ההתחברות המהירה באמצעות Google נכשלה. אפשר להשתמש בכפתור ההתחברות הרגיל.', false);
    }
}

function showGoogleOneTapWhenReady(force = false) {
    // מבקשים מ-Google להציג את בוחר החשבון בכל ביקור בדף, גם אם
    // הדפדפן עשוי לזכור התחברות קודמת. Google עצמה עשויה להסתיר את
    // החלון בזמן השהיה לאחר שהמשתמש סגר אותו.
    if (force) oneTapPromptRequested = false;
    if (oneTapPromptRequested) return;
    let attempts = 0;
    const tryShow = () => {
        const googleIdentity = window.google?.accounts?.id;
        if (!googleIdentity) {
            attempts += 1;
            if (attempts < 40) setTimeout(tryShow, 250);
            return;
        }
        if (!oneTapInitialized) {
            googleIdentity.initialize({
                client_id: GOOGLE_ONE_TAP_CLIENT_ID,
                callback: handleGoogleOneTapCredential,
                context: 'signin',
                auto_select: false,
                cancel_on_tap_outside: false,
                use_fedcm_for_prompt: true,
                itp_support: true
            });
            oneTapInitialized = true;
        }
        oneTapPromptRequested = true;
        googleIdentity.prompt();
    };
    tryShow();
}

// גם חזרה לדף מהמטמון של הדפדפן נחשבת ביקור חדש.
window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    oneTapPromptRequested = false;
    showGoogleOneTapWhenReady();
});

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

function clearDriveConnection() {
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

async function restoreDriveConnection(showSuccessNotice = false, forceRefresh = false) {
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

function parseDriveFolderId(value) {
    const rawValue = String(value || '').trim();
    if (/^[a-zA-Z0-9_-]{10,}$/.test(rawValue)) return rawValue;
    try {
        const url = new URL(rawValue);
        const pathMatch = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const queryId = url.searchParams.get('id');
        if (pathMatch?.[1]) return pathMatch[1];
        if (queryId && /^[a-zA-Z0-9_-]{10,}$/.test(queryId)) return queryId;
    } catch (error) {
        return null;
    }
    return null;
}

function makeDriveRecordId(prefix, driveId) {
    return `${prefix}_${String(driveId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
}

function setDriveSyncProgress(current, total, message) {
    const container = document.getElementById('driveSyncProgress');
    const bar = document.getElementById('driveSyncProgressBar');
    const text = document.getElementById('driveSyncProgressText');
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    if (container) container.classList.remove('hidden');
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = message;
}

async function driveFetch(url) {
    if (!driveAccessToken) throw new Error('יש לחבר חשבון Google Drive לפני הסנכרון.');

    // Google מספקת שני שערים רשמיים לאותו Drive API. אם אחד מהם
    // אינו זמין בדפדפן, עוברים אוטומטית לשני בלי לבקש הרשאת עריכה.
    const requestUrls = [String(url)];
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === 'www.googleapis.com') {
            parsedUrl.hostname = 'content.googleapis.com';
            requestUrls.push(parsedUrl.toString());
        } else if (parsedUrl.hostname === 'content.googleapis.com') {
            parsedUrl.hostname = 'www.googleapis.com';
            requestUrls.push(parsedUrl.toString());
        }
    } catch (error) {}

    let response = null;
    let networkError = null;
    for (const requestUrl of [...new Set(requestUrls)]) {
        try {
            response = await fetch(requestUrl, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer',
                headers: {
                    Authorization: `Bearer ${driveAccessToken}`,
                    Accept: 'application/json, image/*, video/*, application/octet-stream'
                }
            });
            break;
        } catch (error) {
            networkError = error;
            console.warn('Drive API endpoint unavailable:', new URL(requestUrl).hostname, error);
        }
    }

    if (!response) {
        const driveError = new Error('לא ניתן להגיע ל־Google Drive כרגע. נוסו שתי כתובות החיבור של Google. בדוק שהגישה ל־googleapis.com מותרת ונסה שוב.');
        driveError.cause = networkError;
        driveError.driveNetworkError = true;
        throw driveError;
    }
    if (response.ok) return response;

    let apiMessage = '';
    try {
        const errorData = await response.json();
        apiMessage = errorData?.error?.message || '';
    } catch (error) {}

    const driveError = new Error(apiMessage || `שגיאת Google Drive (${response.status}).`);
    driveError.status = response.status;
    if (response.status === 401) {
        clearDriveConnection();
        driveError.message = 'תוקף החיבור ל־Drive הסתיים. התחבר מחדש ונסה שוב.';
        driveError.driveAuthExpired = true;
    } else if (response.status === 403) {
        driveError.message = 'אין לחשבון המחובר הרשאת צפייה בתיקייה, או ש־Google Drive API עדיין לא הופעל בפרויקט.';
    } else if (response.status === 404) {
        driveError.message = 'תיקיית Drive לא נמצאה או שלא שותפה עם החשבון המחובר.';
    }
    throw driveError;
}

async function getDriveFileMetadata(fileId) {
    const fields = encodeURIComponent('id,name,mimeType,modifiedTime');
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`);
    return response.json();
}

async function listDriveFolderChildren(folderId) {
    const results = [];
    let pageToken = '';
    do {
        const params = new URLSearchParams({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
            pageSize: '1000',
            orderBy: 'folder,name',
            spaces: 'drive',
            supportsAllDrives: 'true',
            includeItemsFromAllDrives: 'true'
        });
        if (pageToken) params.set('pageToken', pageToken);
        const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
        const data = await response.json();
        results.push(...(data.files || []));
        pageToken = data.nextPageToken || '';
    } while (pageToken);
    return results;
}

let driveFolderPickerState = {
    rootFolderId: '',
    rootName: '',
    folders: []
};

async function collectDriveFolders(rootFolderId, includeSubfolders) {
    const root = await getDriveFileMetadata(rootFolderId);
    if (root.mimeType !== 'application/vnd.google-apps.folder') {
        throw new Error('הקישור חייב להפנות לתיקייה ב־Google Drive.');
    }

    const rootFolder = {
        id: root.id,
        name: root.name || 'Google Drive',
        path: root.name || 'Google Drive',
        depth: 0,
        parentDriveFolderId: null
    };
    const folders = [rootFolder];

    if (includeSubfolders) {
        for (let index = 0; index < folders.length; index++) {
            const currentFolder = folders[index];
            setDriveSyncProgress(index, folders.length, 'מחפש תיקיות בתוך: ' + currentFolder.path);
            const children = await listDriveFolderChildren(currentFolder.id);
            for (const item of children) {
                if (item.mimeType !== 'application/vnd.google-apps.folder') continue;
                if (folders.length >= 500) {
                    throw new Error('נמצאו יותר מ־500 תיקיות משנה. בחר תיקיית Drive פנימית יותר ונסה שוב.');
                }
                folders.push({
                    id: item.id,
                    name: item.name || 'תיקייה ללא שם',
                    path: currentFolder.path + ' / ' + (item.name || 'תיקייה ללא שם'),
                    depth: currentFolder.depth + 1,
                    parentDriveFolderId: currentFolder.id
                });
            }
        }
    }

    return { root, folders };
}

async function collectSingleDriveFolderMedia(folder) {
    setDriveSyncProgress(0, 0, 'קורא את הקבצים בתיקייה: ' + folder.path);
    const children = await listDriveFolderChildren(folder.id);
    return children
        .filter(function(item) {
            return String(item.mimeType || '').startsWith('image/')
                || ['video/mp4', 'video/webm'].includes(String(item.mimeType || '').toLowerCase());
        })
        .map(function(item) {
            return { ...item, parentFolder: folder };
        });
}

async function saveDriveGalleryFolder(folder) {
    await window.saveFolderToCloud({
        id: makeDriveRecordId('drivefolder', folder.id),
        name: folder.name || 'תיקייה ללא שם',
        icon: 'folder-sync',
        isDefault: false,
        driveFolderId: folder.id,
        driveParentFolderId: folder.parentDriveFolderId || null,
        parentFolderId: folder.parentDriveFolderId
            ? makeDriveRecordId('drivefolder', folder.parentDriveFolderId)
            : null,
        driveRootFolderId: driveFolderPickerState.rootFolderId || folder.id,
        drivePath: folder.path,
        driveDepth: Number(folder.depth) || 0,
        syncedFromDrive: true
    });
}

async function downloadDriveMedia(driveMedia) {
    const fileId = String(driveMedia?.id || '').trim();
    if (!fileId) throw new Error('לקובץ ב־Drive אין מזהה תקין.');

    const response = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
    );
    const blob = await response.blob();
    if (!blob.size) throw new Error('Google Drive החזיר קובץ ריק.');

    const fileName = String(driveMedia?.name || 'drive-media')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .slice(0, 180);
    const mimeType = String(
        driveMedia?.mimeType
        || blob.type
        || (fileName.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'image/jpeg')
    );

    return new File([blob], fileName, {
        type: mimeType,
        lastModified: Date.parse(driveMedia?.modifiedTime || '') || Date.now()
    });
}

async function syncDriveMediaFiles(folder, mediaFiles) {
    await saveDriveGalleryFolder(folder);

    let addedOrUpdated = 0;
    let unchanged = 0;
    let failed = 0;
    const total = mediaFiles.length;

    for (let index = 0; index < total; index++) {
        const driveMedia = mediaFiles[index];
        const imageId = makeDriveRecordId('driveimage', driveMedia.id);
        const folderId = makeDriveRecordId('drivefolder', folder.id);
        const existing = (window.state.images || []).find(function(image) {
            return image.driveFileId === driveMedia.id || image.id === imageId;
        });
        const mediaType = String(driveMedia.mimeType || '').startsWith('video/') ? 'video' : 'image';
        setDriveSyncProgress(
            index,
            total,
            'מסנכרן ' + (index + 1) + ' מתוך ' + total + ': ' + (driveMedia.name || 'קובץ מדיה')
        );

        try {
            if (existing && existing.driveModifiedTime === driveMedia.modifiedTime) {
                if (existing.folderId !== folderId) {
                    await window.saveImageToCloud({
                        ...existing,
                        folderId,
                        driveFolderId: folder.id
                    });
                    addedOrUpdated++;
                } else {
                    unchanged++;
                }
                continue;
            }

            const downloadedMedia = await downloadDriveMedia(driveMedia);
            const modifiedAt = Date.parse(driveMedia.modifiedTime || '') || Date.now();
            await window.saveImageToCloud({
                id: imageId,
                folderId,
                title: String(driveMedia.name || 'קובץ מ־Drive').replace(/\.[^.]+$/, ''),
                url: typeof downloadedMedia === 'string' ? downloadedMedia : '',
                sourceFile: downloadedMedia instanceof File ? downloadedMedia : undefined,
                mediaType,
                mimeType: driveMedia.mimeType || '',
                date: new Date(modifiedAt).toISOString().split('T')[0],
                createdAt: modifiedAt,
                driveFileId: driveMedia.id,
                driveFolderId: folder.id,
                driveRootFolderId: driveFolderPickerState.rootFolderId || folder.id,
                driveModifiedTime: driveMedia.modifiedTime || '',
                syncedFromDrive: true
            });
            addedOrUpdated++;
        } catch (error) {
            if (error.driveAuthExpired) throw error;
            failed++;
            console.warn('Drive media sync skipped: ' + (driveMedia.name || driveMedia.id), error);
        }
    }

    setDriveSyncProgress(
        total || 1,
        total || 1,
        'הסנכרון הושלם: ' + addedOrUpdated + ' נוספו או עודכנו, ' + unchanged + ' ללא שינוי'
            + (failed ? ', ' + failed + ' נכשלו' : '') + '.'
    );

    await window.logActivity(
        'synced_drive',
        'folder',
        folder.id,
        folder.name || 'Google Drive',
        addedOrUpdated + ' נוספו או עודכנו, ' + failed + ' נכשלו'
    );

    window.populateFolderSelects?.();
    return { addedOrUpdated, unchanged, failed, total };
}

async function reconcileDriveMirror(rootFolderId, seenDriveFileIds, seenDriveFolderIds) {
    if (!window.state.isSuperAdmin) {
        throw new Error('מחיקת פריטים שנעלמו מ־Drive דורשת חשבון מנהל־על.');
    }

    const staleImages = (window.state.images || []).filter(function(image) {
        return image.syncedFromDrive === true
            && image.driveRootFolderId === rootFolderId
            && image.driveFileId
            && !seenDriveFileIds.has(image.driveFileId);
    });
    const staleFolders = (window.state.folders || []).filter(function(folder) {
        return folder.syncedFromDrive === true
            && folder.driveRootFolderId === rootFolderId
            && folder.driveFolderId
            && !seenDriveFolderIds.has(folder.driveFolderId);
    }).sort(function(a, b) {
        return (Number(b.driveDepth) || 0) - (Number(a.driveDepth) || 0);
    });

    for (const image of staleImages) {
        await window.deleteImageCloud(image.id);
    }
    for (const folder of staleFolders) {
        await window.deleteFolderCloud(folder.id);
    }

    if (staleImages.length) {
        const removedImageIds = new Set(staleImages.map(image => window.safeRecordId(image.id)));
        window.state.images = (window.state.images || []).filter(image => !removedImageIds.has(window.safeRecordId(image.id)));
    }
    if (staleFolders.length) {
        const removedFolderIds = new Set(staleFolders.map(folder => window.safeRecordId(folder.id)));
        window.state.folders = (window.state.folders || []).filter(folder => !removedFolderIds.has(window.safeRecordId(folder.id)));
        if (removedFolderIds.has(window.safeRecordId(window.state.activeFolderId))) {
            window.state.activeFolderId = 'all';
        }
    }
    // Remove Drive-synced folders that are empty after a successful full scan.
    // Work from the deepest folders upward so an empty parent is removed only
    // after all of its empty descendants have been removed.
    const removedFolderIds = new Set(staleFolders.map(folder => window.safeRecordId(folder.id)));
    const remainingImageFolderIds = new Set(
        (window.state.images || []).map(image => window.safeRecordId(image.folderId)).filter(Boolean)
    );
    const emptyDriveFolders = (window.state.folders || []).filter(function(folder) {
        return folder.syncedFromDrive === true
            && folder.driveRootFolderId === rootFolderId
            && !removedFolderIds.has(window.safeRecordId(folder.id));
    }).sort(function(a, b) {
        return (Number(b.driveDepth) || 0) - (Number(a.driveDepth) || 0);
    });
    const additionallyDeletedFolderIds = new Set();

    for (const folder of emptyDriveFolders) {
        const folderId = window.safeRecordId(folder.id);
        if (!folderId || remainingImageFolderIds.has(folderId)) continue;

        const hasRemainingChild = (window.state.folders || []).some(function(child) {
            const childId = window.safeRecordId(child.id);
            return childId
                && !removedFolderIds.has(childId)
                && !additionallyDeletedFolderIds.has(childId)
                && window.safeRecordId(child.parentFolderId) === folderId;
        });
        if (hasRemainingChild) continue;

        await window.deleteFolderCloud(folderId);
        additionallyDeletedFolderIds.add(folderId);
    }

    if (additionallyDeletedFolderIds.size) {
        window.state.folders = (window.state.folders || []).filter(function(folder) {
            return !additionallyDeletedFolderIds.has(window.safeRecordId(folder.id));
        });
        if (additionallyDeletedFolderIds.has(window.safeRecordId(window.state.activeFolderId))) {
            window.state.activeFolderId = 'all';
        }
    }

    window.renderFolders();
    window.renderImages();
    window.populateFolderSelects?.();
    return {
        deletedImages: staleImages.length,
        deletedFolders: staleFolders.length + additionallyDeletedFolderIds.size
    };
}

async function syncDriveFolderTree(rootFolder) {
    const discovered = await collectDriveFolders(rootFolder.id, true);
    const folders = discovered.folders;
    const previousRootId = driveFolderPickerState.rootFolderId;
    driveFolderPickerState.rootFolderId = rootFolder.id;
    const seenDriveFolderIds = new Set(folders.map(folder => folder.id));
    const seenDriveFileIds = new Set();
    let addedOrUpdated = 0;
    let unchanged = 0;
    let failed = 0;
    let total = 0;
    let deletedImages = 0;
    let deletedFolders = 0;
    try {
        for (let index = 0; index < folders.length; index++) {
            setDriveSyncProgress(index, folders.length, 'יוצר מבנה תיקיות: ' + folders[index].path);
            await saveDriveGalleryFolder(folders[index]);
        }
        for (let index = 0; index < folders.length; index++) {
            const folder = folders[index];
            setDriveSyncProgress(index, folders.length, 'מסנכרן תיקייה ' + (index + 1) + ' מתוך ' + folders.length + ': ' + folder.path);
            const mediaFiles = await collectSingleDriveFolderMedia(folder);
            mediaFiles.forEach(media => seenDriveFileIds.add(media.id));
            const result = await syncDriveMediaFiles(folder, mediaFiles);
            addedOrUpdated += result.addedOrUpdated || 0;
            unchanged += result.unchanged || 0;
            failed += result.failed || 0;
            total += result.total || 0;
        }

        if (failed === 0) {
            setDriveSyncProgress(folders.length, folders.length, 'משווה מחיקות מול Google Drive…');
            const cleanup = await reconcileDriveMirror(rootFolder.id, seenDriveFileIds, seenDriveFolderIds);
            deletedImages = cleanup.deletedImages;
            deletedFolders = cleanup.deletedFolders;
        }
    } finally {
        driveFolderPickerState.rootFolderId = previousRootId;
    }
    const deletionSummary = deletedImages || deletedFolders
        ? ' נמחקו מהאתר ' + deletedImages + ' קבצים ו־' + deletedFolders + ' תיקיות שכבר אינם ב־Drive.'
        : '';
    const skippedCleanup = failed ? ' ניקוי מחיקות דולג בגלל קבצים שלא הסתנכרנו.' : '';
    setDriveSyncProgress(folders.length, folders.length,
        'הסנכרון הושלם: ' + folders.length + ' תיקיות, ' + addedOrUpdated + ' קבצים נוספו או עודכנו.'
            + deletionSummary + skippedCleanup);
    return { addedOrUpdated, unchanged, failed, total, folders: folders.length, deletedImages, deletedFolders };
}

function ensureDriveFolderPickerModal() {
    let modal = document.getElementById('driveFolderPickerModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'driveFolderPickerModal';
    // חלון בחירת התיקיות נפתח מתוך חלון משימת הניהול (z-index 105),
    // ולכן הוא חייב להופיע בשכבה גבוהה יותר ולא להסתתר מאחוריו.
    modal.className = 'hidden fixed inset-0 z-[150] bg-slate-950/95 backdrop-blur-xl overflow-y-auto';
    modal.style.zIndex = '150';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'driveFolderPickerTitle');

    const page = document.createElement('div');
    page.className = 'min-h-screen w-full max-w-6xl mx-auto px-4 py-6 sm:px-8 sm:py-10';

    const header = document.createElement('div');
    header.className = 'sticky top-0 z-10 mb-6 rounded-2xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-4';

    const headingWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.id = 'driveFolderPickerTitle';
    title.className = 'text-xl sm:text-2xl font-black text-white';
    title.textContent = 'תיקיות Google Drive';
    const subtitle = document.createElement('p');
    subtitle.id = 'driveFolderPickerSubtitle';
    subtitle.className = 'mt-1 text-xs sm:text-sm text-slate-400';
    subtitle.textContent = 'בחר תיקייה וסנכרן אותה בנפרד.';
    headingWrap.append(title, subtitle);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10';
    closeButton.textContent = 'סגור';
    closeButton.addEventListener('click', window.closeDriveFolderPicker);

    header.append(headingWrap, closeButton);

    const list = document.createElement('div');
    list.id = 'driveFolderPickerList';
    list.className = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

    page.append(header, list);
    modal.append(page);
    document.body.append(modal);
    return modal;
}

function renderDriveFolderPicker() {
    const modal = ensureDriveFolderPickerModal();
    const list = modal.querySelector('#driveFolderPickerList');
    const subtitle = modal.querySelector('#driveFolderPickerSubtitle');
    if (!list) return;

    list.innerHTML = '';
    if (subtitle) {
        subtitle.textContent = 'נמצאו ' + driveFolderPickerState.folders.length
            + ' תיקיות. לחץ על “סנכרן תיקייה” ליד כל תיקייה בנפרד.';
    }

    driveFolderPickerState.folders.forEach(function(folder, index) {
        const card = document.createElement('article');
        card.className = 'rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl transition hover:border-amber-400/40';
        card.dataset.driveFolderId = folder.id;

        const top = document.createElement('div');
        top.className = 'flex items-start gap-3';

        const icon = document.createElement('div');
        icon.className = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-400';
        icon.innerHTML = '<i data-lucide="folder" class="h-5 w-5"></i>';

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const name = document.createElement('h3');
        name.className = 'truncate text-sm font-black text-white';
        name.textContent = folder.name;
        const path = document.createElement('p');
        path.className = 'mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400';
        path.textContent = folder.path;
        text.append(name, path);
        top.append(icon, text);

        const status = document.createElement('p');
        status.id = 'drive-folder-status-' + index;
        status.className = 'mt-4 min-h-5 text-[11px] font-semibold text-slate-400';
        status.textContent = 'מוכן לסנכרון';

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'drive-folder-sync-' + index;
        button.className = 'mt-2 w-full rounded-xl bg-amber-400 px-4 py-3 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60';
        button.textContent = 'סנכרן תיקייה';
        button.addEventListener('click', function() {
            window.syncDriveFolderById(folder.id);
        });

        card.append(top, status, button);
        list.append(card);
    });

    window.scheduleIconRefresh();
}

window.openDriveFolderPicker = function() {
    const modal = ensureDriveFolderPickerModal();
    renderDriveFolderPicker();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeDriveFolderPicker = function() {
    const modal = document.getElementById('driveFolderPickerModal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
};

window.syncDriveFolderById = async function(folderId) {
    if (!window.checkAdminPermission?.()) return;
    if (!driveAccessToken) {
        window.showNotification('יש לחבר חשבון Google Drive לפני הסנכרון.', false);
        return;
    }

    const folderIndex = driveFolderPickerState.folders.findIndex(function(folder) {
        return folder.id === folderId;
    });
    const folder = driveFolderPickerState.folders[folderIndex];
    if (!folder) {
        window.showNotification('התיקייה לא נמצאה ברשימת הסנכרון.', false);
        return;
    }

    const button = document.getElementById('drive-folder-sync-' + folderIndex);
    const status = document.getElementById('drive-folder-status-' + folderIndex);
    if (button) {
        button.disabled = true;
        button.textContent = 'מסנכרן...';
    }
    if (status) {
        status.className = 'mt-4 min-h-5 text-[11px] font-semibold text-amber-400';
        status.textContent = 'קורא קבצים מהתיקייה...';
    }

    try {
        if (status) status.textContent = 'סורק את התיקייה ואת כל תיקיות המשנה...';
        const result = await syncDriveFolderTree(folder);

        if (status) {
            status.className = 'mt-4 min-h-5 text-[11px] font-semibold text-emerald-400';
            status.textContent = 'הושלם: ' + result.folders + ' תיקיות, '
                + result.addedOrUpdated + ' קבצים נוספו או עודכנו, '
                + result.unchanged + ' ללא שינוי'
                + (result.failed ? ', ' + result.failed + ' נכשלו' : '');
        }
        if (button) {
            button.textContent = 'סנכרן שוב';
            button.disabled = false;
        }
        if (result.total > 0 && result.failed === result.total) {
            throw new Error('כל ' + result.total + ' הקבצים נכשלו בסנכרון. פתח את כלי המפתחים לפרטי השגיאה.');
        }
        window.showNotification(
            result.failed
                ? 'הסנכרון הושלם חלקית: ' + result.addedOrUpdated + ' הצליחו, ' + result.failed + ' נכשלו.'
                : 'התיקייה “' + folder.name + '” וכל תיקיות המשנה סונכרנו בהצלחה.',
            result.failed === 0
        );
    } catch (error) {
        console.error('Google Drive folder sync failed:', error);
        if (status) {
            status.className = 'mt-4 min-h-5 text-[11px] font-semibold text-red-400';
            status.textContent = error.message || 'סנכרון התיקייה נכשל.';
        }
        if (button) {
            button.textContent = 'נסה שוב';
            button.disabled = !driveAccessToken;
        }
        window.showNotification(error.message || 'סנכרון התיקייה נכשל.', false);
    }
};
// ──────── ניהול תיקיות סנכרון Worker ────────

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DEFAULT_DRIVE_SYNC_FOLDER = Object.freeze({
  url: 'https://drive.google.com/drive/folders/1Hb8mCpdnKcax8T6Xulq8PLXzlGcJaBhF',
  label: "שמחס'",
  autoSync: true
});

function getDriveAutoSyncSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('simchatDriveAutoSync') || '{}');
  } catch (error) {
    console.warn('Invalid Drive sync settings were reset:', error);
  }
  const folders = Array.isArray(stored.folders) ? stored.folders.filter(Boolean) : [];
  const defaultId = parseDriveFolderId(DEFAULT_DRIVE_SYNC_FOLDER.url);
  const withoutDuplicate = folders.filter(folder => parseDriveFolderId(folder?.url) !== defaultId);
  const settings = {
    ...stored,
    folders: [DEFAULT_DRIVE_SYNC_FOLDER, ...withoutDuplicate],
    enabled: true,
    intervalMinutes: Math.max(15, Number(stored.intervalMinutes || 15))
  };
  localStorage.setItem('simchatDriveAutoSync', JSON.stringify(settings));
  return settings;
}

async function loadDriveFolders() {
  const folderInput = document.getElementById('driveFolderInput');
  if (folderInput && !parseDriveFolderId(folderInput.value)) folderInput.value = DEFAULT_DRIVE_SYNC_FOLDER.url;
  const existingList = document.getElementById('driveFoldersList');
  if (existingList) existingList.innerHTML = '';
  try {
    const settings = getDriveAutoSyncSettings();
    const folders = Array.isArray(settings.folders) ? settings.folders : [];
    const noMsg = document.getElementById('noFoldersMsg');
    const enabled = document.getElementById('driveAutoSyncEnabled');
    const interval = document.getElementById('driveAutoSyncInterval');
    if (enabled) enabled.checked = settings.enabled === true;
    if (interval) interval.value = String(settings.intervalMinutes || 30);
    if (settings.lastSync) {
      const d = new Date(settings.lastSync);
      const el = document.getElementById('workerLastSync');
      if (el) el.textContent = `סנכרון אחרון: ${d.toLocaleString('he-IL')}`;
    }

    if (folders.length === 0) {
      if (noMsg) noMsg.style.display = 'block';
      return;
    }
    if (noMsg) noMsg.style.display = 'none';
    folders.forEach(f => addDriveFolderRow(f.url, f.label, f.autoSync));
  } catch (err) {
    console.warn('loadDriveFolders:', err.message);
  }
}

function addDriveFolderRow(url = '', label = '', autoSync = true) {
  const list = document.getElementById('driveFoldersList');
  const noMsg = document.getElementById('noFoldersMsg');
  if (!list) return;
  if (noMsg) noMsg.style.display = 'none';

  const row = document.createElement('div');
  row.className = 'flex gap-1.5 items-center bg-white/5 rounded-xl px-2 py-1.5 border border-white/10';
  row.innerHTML = `
    <input type="text" value="${escapeHtml(url)}"
      placeholder="https://drive.google.com/drive/folders/..."
      dir="ltr"
      class="flex-[3] rounded-lg px-2 py-1 text-[9px] bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40 min-w-0">
    <input type="text" value="${escapeHtml(label)}"
      placeholder="שם (אופציונלי)"
      class="flex-[2] rounded-lg px-2 py-1 text-[9px] bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40 min-w-0">
    <label class="flex items-center gap-1 text-[9px] text-slate-400 whitespace-nowrap cursor-pointer">
      <input type="checkbox" ${autoSync !== false ? 'checked' : ''}
class="rounded border-white/20 text-amber-500 focus:ring-amber-500">
      אוטו
    </label>
    <button type="button" onclick="removeDriveFolderRow(this)"
      class="text-red-400 hover:bg-red-500/20 rounded px-1.5 py-0.5 text-xs transition-all flex-shrink-0">✕</button>
  `;
  list.appendChild(row);
}

function removeDriveFolderRow(btn) {
  btn.closest('div.flex')?.remove();
  const list = document.getElementById('driveFoldersList');
  const noMsg = document.getElementById('noFoldersMsg');
  if (noMsg && list && list.querySelectorAll('div.flex').length === 0) {
    noMsg.style.display = 'block';
  }
}

async function saveDriveFoldersToWorker() {
  const rows = document.querySelectorAll('#driveFoldersList > div');
  const folders = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input[type="text"]');
    const checkbox = row.querySelector('input[type="checkbox"]');
    const url = inputs[0]?.value.trim();
    const label = inputs[1]?.value.trim();
    const autoSync = checkbox?.checked !== false;
    if (url) folders.push({ url, label, autoSync });
  });

  const resultEl = document.getElementById('workerSyncResult');
  try {
    const previous = getDriveAutoSyncSettings();
    const settings = {
      folders,
      enabled: true,
      intervalMinutes: Number(document.getElementById('driveAutoSyncInterval')?.value || 30),
      lastSync: previous.lastSync || null
    };
    localStorage.setItem('simchatDriveAutoSync', JSON.stringify(settings));
    scheduleDriveAutoSync();
    if (resultEl) { resultEl.style.color = '#22c55e'; resultEl.textContent = `✅ ההגדרות נשמרו (${folders.length} תיקיות)`; }
    window.showNotification?.('הגדרות הסנכרון האוטומטי נשמרו.', true);
  } catch (err) {
    if (resultEl) { resultEl.style.color = '#ef4444'; resultEl.textContent = `❌ ${err.message}`; }
  }
  setTimeout(() => { if (resultEl) resultEl.textContent = ''; }, 4000);
}

async function syncNowFromWorker() {
  const resultEl = document.getElementById('workerSyncResult');
  const btn = document.getElementById('workerSyncBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ מסנכרן...'; }

  try {
    if (!driveAccessToken) await restoreDriveConnection(false, true);
    if (!driveAccessToken) throw new Error('יש לחבר את Google Drive לפני הסנכרון.');
    const settings = getDriveAutoSyncSettings();
    const folders = (settings.folders || []).filter(folder => folder.autoSync !== false && parseDriveFolderId(folder.url));
    if (!folders.length) throw new Error('לא הוגדרו תיקיות תקינות לסנכרון.');
    let total = 0;
    for (const saved of folders) {
      const id = parseDriveFolderId(saved.url);
      const metadata = await getDriveFileMetadata(id);
      const folder = {
id,
name: saved.label || metadata.name || 'תיקיית Drive',
path: saved.label || metadata.name || 'תיקיית Drive',
depth: 0,
parentDriveFolderId: null
      };
      const result = await syncDriveFolderTree(folder);
      total += result.addedOrUpdated || 0;
    }
    settings.lastSync = new Date().toISOString();
    localStorage.setItem('simchatDriveAutoSync', JSON.stringify(settings));
    if (resultEl) { resultEl.style.color = '#22c55e'; resultEl.textContent = `✅ הסנכרון הושלם: ${total} קבצים נוספו או עודכנו`; }
    const lastEl = document.getElementById('workerLastSync');
    if (lastEl) lastEl.textContent = `סנכרון אחרון: ${new Date(settings.lastSync).toLocaleString('he-IL')}`;
    window.showNotification?.('הסנכרון האוטומטי הושלם בהצלחה.', true);
  } catch (err) {
    if (resultEl) { resultEl.style.color = '#ef4444'; resultEl.textContent = `❌ ${err.message}`; }
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔄 סנכרן עכשיו'; }
  setTimeout(() => { if (resultEl) resultEl.textContent = ''; }, 6000);
}
let driveAutoSyncTimer = null;
function scheduleDriveAutoSync() {
  if (driveAutoSyncTimer) clearInterval(driveAutoSyncTimer);
  const settings = getDriveAutoSyncSettings();
  if (!settings.enabled) return;
  const delay = Math.max(15, Number(settings.intervalMinutes || 30)) * 60000;
  driveAutoSyncTimer = setInterval(() => syncNowFromWorker(), delay);
  if (!settings.lastSync || Date.now() - new Date(settings.lastSync).getTime() >= delay) {
    setTimeout(() => syncNowFromWorker(), 1500);
  }
}
document.addEventListener('DOMContentLoaded', scheduleDriveAutoSync);
window.addDriveFolderRow = addDriveFolderRow;
window.removeDriveFolderRow = removeDriveFolderRow;
window.saveDriveFoldersToWorker = saveDriveFoldersToWorker;
window.syncNowFromWorker = syncNowFromWorker;
window.loadDriveFolders = loadDriveFolders;
window.restoreDriveConnection = restoreDriveConnection;
window.startGoogleDriveSync = async function(confirmed = false) {
    if (!window.checkAdminPermission?.()) return;
    if (!driveAccessToken || driveAccessTokenExpiresAt <= Date.now() + 60000) {
        await restoreDriveConnection(false, true);
    }
    if (!driveAccessToken) {
        window.showNotification('יש לחבר חשבון Google Drive לפני הסנכרון.', false);
        return;
    }

    const folderInput = document.getElementById('driveFolderInput');
    const rootFolderId = parseDriveFolderId(folderInput?.value);
    if (!rootFolderId) {
        window.showNotification('הדבק קישור תקין לתיקיית Google Drive.', false);
        folderInput?.focus();
        return;
    }

    if (!confirmed) {
        window.showConfirm(
            'סנכרון תיקיית Drive',
            'המערכת תסנכרן את התיקייה שבקישור, את כל תיקיות המשנה ואת כל הקבצים שבתוכן. להמשיך?',
            function() { window.startGoogleDriveSync(true); }
        );
        return;
    }

    const syncButton = document.getElementById('driveSyncBtn');
    const connectButton = document.getElementById('connectDriveBtn');
    if (syncButton) syncButton.disabled = true;
    if (connectButton) connectButton.disabled = true;
    setDriveSyncProgress(0, 0, 'קורא את מבנה התיקיות מ־Drive...');

    try {
        const metadata = await getDriveFileMetadata(rootFolderId);
        const rootFolder = {
            id: rootFolderId,
            name: metadata.name || 'Google Drive',
            path: metadata.name || 'Google Drive',
            depth: 0,
            parentDriveFolderId: null
        };
        const result = await syncDriveFolderTree(rootFolder);
        window.showNotification(
            'סנכרון Drive הושלם: ' + result.folders + ' תיקיות ו־'
                + result.addedOrUpdated + ' קבצים נוספו או עודכנו.',
            result.failed === 0
        );
    } catch (error) {
        console.error('Google Drive sync failed:', error);
        setDriveSyncProgress(0, 1, error.message || 'סנכרון Drive נכשל.');
        window.showNotification(error.message || 'סנכרון Google Drive נכשל.', false);
    } finally {
        if (syncButton) syncButton.disabled = !driveAccessToken;
        if (connectButton) connectButton.disabled = false;
    }
};

window.signInWithGoogleAccount = async function() {
    if (!auth) { window.showNotification("המערכת עדיין מתחברת...", false); return; }
    try {
        dismissGoogleOneTap();
        window.showNotification("פותח התחברות באמצעות Google...", true);
        showGoogleOneTapWhenReady(true);
    } catch (e) {
        console.error("Google sign-in error", e);
        window.showNotification("ההתחברות באמצעות Google נכשלה.", false);
    }
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

function reportFirestoreError(err) {
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

function stopAdminListeners() {
    window.adminUnsubscribers.forEach(unsubscribe => {
        try { unsubscribe(); } catch (error) { console.warn('Admin listener cleanup failed:', error); }
    });
    window.adminUnsubscribers = [];
    window.state.pendingUsers = [];
    window.state.pendingImages = [];
    window.state.allUsers = [];
    window.state.deletionRequests = [];
    window.state.trashItems = [];
    window.state.activityLogs = [];
    if (typeof window.renderPendingUsers === 'function') window.renderPendingUsers();
    if (typeof window.renderPendingImages === 'function') window.renderPendingImages();
    if (typeof window.renderManagedUsers === 'function') window.renderManagedUsers();
    if (typeof window.renderAdminMessageReplies === 'function') window.renderAdminMessageReplies();
    if (typeof window.renderDeletionRequests === 'function') window.renderDeletionRequests();
    if (typeof window.renderTrashItems === 'function') window.renderTrashItems();
    if (typeof window.renderActivityLogs === 'function') window.renderActivityLogs();
    if (typeof window.updatePendingUsersBadge === 'function') window.updatePendingUsersBadge();
    if (typeof window.updatePendingBadge === 'function') window.updatePendingBadge();
}

function startAdminListeners() {
    if (!window.state.isAdminLoggedIn || window.adminUnsubscribers.length > 0) return;

    window.adminUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages'), (snapshot) => {
        window.state.pendingImages = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(image => !image.status || image.status === 'pending');
        window.state.pendingImages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        window.renderPendingImages();
        window.updatePendingBadge();
    }, reportFirestoreError));

    if (!window.state.isSuperAdmin) return;

    let previousPendingIds = new Set();
    window.adminUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles'), (snapshot) => {
        const allProfiles = snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
        const pending = allProfiles
            .filter(profile => profile.status === 'pending')
            .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
        const newRequests = pending.filter(profile => !previousPendingIds.has(profile.uid));

        window.state.allUsers = allProfiles.sort((a, b) => String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || ''), 'he'));
        window.state.pendingUsers = pending;
        window.renderPendingUsers();
        window.renderManagedUsers();
        window.renderAdminMessageUsers?.();
        window.renderAdminMessageReplies?.();
        window.renderActiveConversation?.();
        window.updatePendingUsersBadge();

        if (newRequests.length > 0) {
            const label = newRequests.length === 1
                ? `בקשת הצטרפות חדשה מאת ${newRequests[0].displayName || newRequests[0].email || 'משתמש חדש'}`
                : `${newRequests.length} בקשות הצטרפות חדשות ממתינות לאישור`;
            window.showNotification(label, true);
        }
        previousPendingIds = new Set(pending.map(profile => profile.uid));
    }, reportFirestoreError, { initialDelay: 500 }));

    window.adminUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'deletionRequests'), (snapshot) => {
        window.state.deletionRequests = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(request => request.status === 'pending')
            .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
        window.renderDeletionRequests();
        window.updateAdminOverview();
    }, reportFirestoreError, { initialDelay: 1000 }));

    window.adminUnsubscribers.push(onSnapshot(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems'), (snapshot) => {
        window.state.trashItems = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
        window.renderTrashItems?.();
        window.updateAdminOverview?.();
    }, reportFirestoreError, { initialDelay: 1500 }));

    const recentActivityQuery = query(
        collection(window.db, 'artifacts', window.appId, 'public', 'data', 'activityLogs'),
        orderBy('createdAt', 'desc'),
        limit(100)
    );
    window.adminUnsubscribers.push(onSnapshot(recentActivityQuery, (snapshot) => {
        window.state.activityLogs = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        window.renderActivityLogs?.();
    }, reportFirestoreError, { initialDelay: 2000 }));
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
                showGoogleOneTapWhenReady();
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
                showGoogleOneTapWhenReady();
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
        startAdminListeners();
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
                startAdminListeners();
                restoreDriveConnection(driveReturnStatus === 'connected');
            }
            else {
                clearDriveConnection();
                stopAdminListeners();
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
export function initDriveSync() {
    initFirebase();
}
