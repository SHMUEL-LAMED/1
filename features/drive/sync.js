// סריקת Drive, הורדת קבצים, העלאה ל-R2 והתקדמות
// פוצל מתוך drive-sync.js. הקוד עצמו לא שונה — רק מיקומו.

import { clearDriveConnection, driveAccessToken, driveAccessTokenExpiresAt, restoreDriveConnection } from './oauth.js';
import { driveFolderPickerState, parseDriveFolderId } from './picker.js';

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

export async function loadDriveFolders() {
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

// driveAutoSyncTimer מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setDriveAutoSyncTimer(value) {
    driveAutoSyncTimer = value;
}

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
