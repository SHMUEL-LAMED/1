// מאזיני הענן: פרופיל, תמונות, תיקיות, בקשות וניקוי
// פוצל מתוך drive-sync.js. הקוד עצמו לא שונה — רק מיקומו.

import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from '../../cloudflare-client.js';
import { clearDriveConnection, driveReturnStatus, restoreDriveConnection } from './oauth.js';

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

export function stopAdminListeners() {
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
        window.renderFloatingInbox?.();
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

export function defaultFolders() {
    return window.DEFAULT_GALLERY_FOLDERS.map(folder => ({ ...folder }));
}

export function setupFirestoreListeners(user) {
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
