// gallery.js — הצגת הגלריה, מדיה, ניווט ותיקיות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.

let currentFilteredImages = [];

// --- 5. New Updates Banner ---
window.checkNewUpdates = function() {
    if (window.state.images.length === 0) return;
    const newest = window.state.images.reduce((max, img) => Math.max(max, img.createdAt || 0), 0);
    const lastSeen = parseInt(localStorage.getItem('yeshiva_last_seen_update') || '0');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const banner = document.getElementById('newUpdatesBanner');
    if (banner && newest > lastSeen && (Date.now() - newest < ONE_WEEK)) {
        banner.classList.remove('hidden');
    }
}

function showNewUpdates() {
    localStorage.setItem('yeshiva_last_seen_update', Date.now().toString());
    const banner = document.getElementById('newUpdatesBanner');
    if(banner) banner.classList.add('hidden');
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    window.state.tempSearchResults = window.state.images.filter(img => (img.createdAt || 0) >= weekAgo);

    const searchBanner = document.getElementById('tempSearchBanner');
    if(searchBanner) {
        searchBanner.className = "bg-gradient-to-r from-amber-500/10 to-transparent border border-white/10 rounded-2xl p-4 flex justify-between items-center shadow-md animate-fade-in transition-all backdrop-blur-xl";
        searchBanner.innerHTML = '';

        const leftDiv = document.createElement('div');
        leftDiv.className = "flex items-center gap-3";
        leftDiv.innerHTML = `<div class="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-amber-400"><i data-lucide="bell" class="w-5 h-5"></i></div>`;

        const textDiv = document.createElement('div');
        const title = document.createElement('h4');
        title.className = "font-bold text-white text-sm";
        title.textContent = "עדכונים אחרונים";
        const desc = document.createElement('p');
        desc.className = "text-xs text-amber-400";
        desc.textContent = "תמונות מהשבוע האחרון";
        textDiv.appendChild(title);
        textDiv.appendChild(desc);
        leftDiv.appendChild(textDiv);

        const returnBtn = document.createElement('button');
        returnBtn.type = "button";
        returnBtn.onclick = clearTempSearchFilter;
        returnBtn.className = "text-xs font-bold btn-secondary-dark px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all";
        returnBtn.textContent = "חזור לגלריה";

        searchBanner.appendChild(leftDiv);
        searchBanner.appendChild(returnBtn);
        searchBanner.classList.remove('hidden');
    }
    window.scheduleIconRefresh();
    window.renderImages();
}

function dismissNewUpdates() {
    localStorage.setItem('yeshiva_last_seen_update', Date.now().toString());
    const banner = document.getElementById('newUpdatesBanner');
    if(banner) banner.classList.add('hidden');
}

function clearTempSearchFilter() {
    window.state.tempSearchResults = null;
    const searchBanner = document.getElementById('tempSearchBanner');
    if(searchBanner) searchBanner.classList.add('hidden');
    window.renderImages();
}

async function saveFavorites() {
    if (!window.db || !window.state.currentUser?.uid) return;
    const { doc, setDoc } = window.firestoreModules;
    const favoriteIds = Array.from(window.state.favorites).map(safeRecordId).filter(Boolean).slice(0, 1000);
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userFavorites', window.state.currentUser.uid), {
        mediaIds: favoriteIds,
        updatedAt: Date.now()
    }, { merge: true });
}

window.toggleFavorite = async function(event, mediaId) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!window.state.isGoogleUser || window.state.userApprovalStatus !== 'approved') {
        window.showNotification('מועדפים זמינים למשתמשים מאושרים בלבד.', false);
        return;
    }
    const id = window.safeRecordId(mediaId);
    if (!id) return;
    const wasFavorite = window.state.favorites.has(id);
    if (wasFavorite) window.state.favorites.delete(id);
    else window.state.favorites.add(id);
    window.renderFolders();
    window.renderImages();
    try {
        await saveFavorites();
    } catch (error) {
        if (wasFavorite) window.state.favorites.add(id);
        else window.state.favorites.delete(id);
        window.renderFolders();
        window.renderImages();
        window.showNotification('שמירת המועדף נכשלה. בדוק את חיבור Cloudflare.', false);
    }
};

function updateBulkSelectionBar() {
    const bar = document.getElementById('bulkSelectionBar');
    const count = document.getElementById('bulkSelectedCount');
    if (count) count.textContent = String(window.state.selectedMediaIds.size);
    if (bar) {
        bar.classList.toggle('hidden', !window.state.bulkSelectionMode);
        bar.classList.toggle('flex', window.state.bulkSelectionMode);
    }
}

window.toggleBulkSelectionMode = function(forceState) {
    if (!window.state.isAdminLoggedIn) return;
    window.state.bulkSelectionMode = typeof forceState === 'boolean' ? forceState : !window.state.bulkSelectionMode;
    if (!window.state.bulkSelectionMode) window.state.selectedMediaIds.clear();
    updateBulkSelectionBar();
    window.renderImages();
};

window.toggleMediaSelection = function(event, mediaId) {
    event?.preventDefault();
    event?.stopPropagation();
    const id = window.safeRecordId(mediaId);
    if (!window.state.bulkSelectionMode || !id) return;
    if (window.state.selectedMediaIds.has(id)) window.state.selectedMediaIds.delete(id);
    else window.state.selectedMediaIds.add(id);
    updateBulkSelectionBar();
    window.renderImages();
};

window.toggleSelectAllVisibleMedia = function() {
    if (!window.state.bulkSelectionMode) return;
    const visibleIds = getFilteredSortedImages().map(item => window.safeRecordId(item.id)).filter(Boolean);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => window.state.selectedMediaIds.has(id));
    visibleIds.forEach(id => allSelected ? window.state.selectedMediaIds.delete(id) : window.state.selectedMediaIds.add(id));
    updateBulkSelectionBar();
    window.renderImages();
};

window.openBulkMoveDialog = function() {
    if (!window.state.isAdminLoggedIn || window.state.selectedMediaIds.size === 0) {
        window.showNotification('לא נבחרו פריטים להעברה.', false);
        return;
    }
    const select = document.getElementById('moveFolderSelect');
    const submit = document.getElementById('moveFolderSubmitBtn');
    if (!select || !submit) return;
    select.replaceChildren();
    window.state.folders.filter(folder => folder.id !== 'all').forEach(folder => {
        const option = document.createElement('option');
        option.value = window.safeRecordId(folder.id);
        option.textContent = folder.name;
        select.appendChild(option);
    });
    submit.onclick = () => {
        const targetFolderId = window.safeRecordId(select.value);
        const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
        window.showConfirm('העברת פריטים', `להעביר ${selected.length} פריטים לתיקייה שנבחרה?`, async () => {
            let movedCount = 0;
            let failedCount = 0;
            for (const item of selected) {
                try {
                    await window.saveImageToCloud({ ...item, folderId: targetFolderId });
                    movedCount++;
                } catch (err) {
                    failedCount++;
                    console.warn('Bulk move failed for item:', window.safeRecordId(item.id), err);
                }
            }
            window.closeModal('moveFolderModal');
            window.state.selectedMediaIds.clear();
            updateBulkSelectionBar();
            window.renderImages();
            window.showNotification(
                failedCount
                    ? `${movedCount} פריטים הועברו; ${failedCount} נכשלו.`
                    : `${movedCount} פריטים הועברו בהצלחה.`,
                !failedCount
            );
        });
    };
    window.openModal('moveFolderModal');
};

window.deleteSelectedMedia = function() {
    if (!window.state.isAdminLoggedIn || window.state.selectedMediaIds.size === 0) {
        window.showNotification('לא נבחרו פריטים למחיקה.', false);
        return;
    }
    const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    const title = window.state.isSuperAdmin ? 'העברת פריטים לסל' : 'שליחת בקשות מחיקה';
    const message = window.state.isSuperAdmin
        ? `להעביר ${selected.length} פריטים לסל המחזור?`
        : `לשלוח למנהל־העל ${selected.length} בקשות מחיקה?`;
    window.showConfirm(title, message, async () => {
        for (const item of selected) {
            if (window.state.isSuperAdmin) await window.moveImageToTrash(item.id);
            else await window.requestContentDeletion('image', item.id, item.title || 'קובץ מדיה');
        }
        window.state.selectedMediaIds.clear();
        updateBulkSelectionBar();
        window.renderImages();
        window.showNotification(window.state.isSuperAdmin ? 'הפריטים הועברו לסל.' : 'בקשות המחיקה נשלחו.');
    });
};

function safeDownloadFileName(name, fallback = 'תמונה') {
    const sanitized = String(name || fallback).replace(/[\\/:*?"<>|\r\n]+/g, '-').trim();
    return sanitized || fallback;
}

async function downloadGalleryMedia(item, fallbackName = 'תמונה') {
    const url = window.safeImageUrl(item?.url);
    if (!url) throw new Error('כתובת הקובץ אינה תקינה.');

    const headers = new Headers();
    if (url.startsWith(window.R2_WORKER_BASE_URL || '')) {
        try {
            const token = await window.getFirebaseIdToken();
            if (token) headers.set('Authorization', `Bearer ${token}`);
        } catch (error) {
            // תמונות מאושרות הן ציבוריות; אם אין אסימון עדיין מנסים להוריד אותן.
        }
    }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`הורדת הקובץ נכשלה (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = safeDownloadFileName(item?.title, fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

window.downloadGalleryMedia = async function(item) {
    try {
        await downloadGalleryMedia(item);
        window.showNotification('הקובץ הורד למחשב.');
    } catch (error) {
        console.error('Gallery media download failed:', error);
        window.showNotification(error.message || 'הורדת הקובץ נכשלה.', false);
    }
};

window.downloadSelectedMedia = async function() {
    const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    if (!selected.length) {
        window.showNotification('לא נבחרו פריטים להורדה.', false);
        return;
    }
    let downloaded = 0;
    for (let index = 0; index < selected.length; index += 1) {
        try {
            await downloadGalleryMedia(selected[index], `media-${index + 1}`);
            downloaded += 1;
        } catch (error) {
            console.error('Bulk media download failed:', error);
        }
    }
    window.showNotification(
        downloaded === selected.length
            ? `${downloaded} פריטים הורדו למחשב.`
            : `הורדו ${downloaded} מתוך ${selected.length} פריטים.`,
        downloaded > 0
    );
};

window.openEventPage = function(event, folderId) {
    event?.preventDefault();
    event?.stopPropagation();
    const id = window.safeRecordId(folderId);
    const folder = window.state.folders.find(item => window.safeRecordId(item.id) === id);
    if (!folder || id === 'all') return;
    const media = window.state.images.filter(item => window.safeRecordId(item.folderId) === id);
    const coverRecord = media.find(item => !window.isVideoRecord(item));
    const cover = document.getElementById('eventPageCover');
    if (cover) {
        const coverUrl = window.safeImageUrl(folder.coverUrl || coverRecord?.url);
        cover.src = coverUrl || cover.src;
        cover.classList.toggle('hidden', !coverUrl);
    }
    window.state.activeEventFolderId = id;
    document.getElementById('eventPageTitle').textContent = folder.name || 'אירוע';
    document.getElementById('eventPageDate').textContent = folder.eventDate ? window.formatDate(folder.eventDate) : 'ארכיון שמחת התורה';
    document.getElementById('eventPageDescription').textContent = folder.description || 'לא נוסף עדיין תיאור לאירוע.';
    const videoCount = media.filter(isVideoRecord).length;
    document.getElementById('eventPageStats').textContent = `${media.length} פריטים · ${videoCount} סרטונים · ${media.length - videoCount} תמונות`;
    const openButton = document.getElementById('eventOpenGalleryBtn');
    if (openButton) openButton.onclick = () => {
        setActiveFolder(id);
        window.closeModal('eventPageModal');
        document.getElementById('photosGrid')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    };
    const slideshowButton = document.getElementById('eventStartSlideshowBtn');
    if (slideshowButton) slideshowButton.onclick = () => {
        setActiveFolder(id);
        window.closeModal('eventPageModal');
        window.startGallerySlideshow();
    };
    const followButton = document.getElementById('eventFollowButton');
    if (followButton) {
        const isFollowing = window.state.followedFolders.has(id);
        followButton.innerHTML = `<i data-lucide="${isFollowing ? 'bell-off' : 'bell-plus'}" class="w-4 h-4"></i> ${isFollowing ? 'הפסק לעקוב' : 'עקוב וקבל עדכונים'}`;
        followButton.onclick = () => window.toggleFollowEvent(id);
    }
    document.getElementById('eventEditFolderId').value = id;
    document.getElementById('eventEditName').value = folder.name || '';
    document.getElementById('eventEditDate').value = folder.eventDate || '';
    document.getElementById('eventEditDescription').value = folder.description || '';
    toggleEventEdit(false);
    window.openModal('eventPageModal');
    window.scheduleIconRefresh();
};

window.toggleFollowEvent = async function(folderId) {
    const id = window.safeRecordId(folderId);
    if (!id || !window.state.currentUser?.uid) return;
    const followed = new Set(window.state.followedFolders);
    if (followed.has(id)) followed.delete(id);
    else followed.add(id);
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userPreferences', window.state.currentUser.uid), {
            followedFolderIds: [...followed],
            updatedAt: Date.now()
        }, { merge: true });
        window.state.followedFolders = followed;
        window.openEventPage(null, id);
        window.showNotification(followed.has(id) ? 'המעקב הופעל. תקבל התראה על פריטים חדשים.' : 'המעקב אחר התיקייה הופסק.', true);
    } catch (error) {
        window.showNotification(error.message || 'עדכון המעקב נכשל.', false);
    }
};

window.toggleEventEdit = function(show) {
    const form = document.getElementById('eventEditForm');
    if (form) form.classList.toggle('hidden', !show);
};

window.saveEventDetails = async function(event) {
    event?.preventDefault();
    if (!window.checkAdminPermission()) return;
    const id = window.safeRecordId(document.getElementById('eventEditFolderId')?.value);
    const folder = window.state.folders.find(item => window.safeRecordId(item.id) === id);
    if (!folder) return;
    const updated = {
        ...folder,
        name: String(document.getElementById('eventEditName')?.value || '').trim().slice(0, 80),
        eventDate: document.getElementById('eventEditDate')?.value || '',
        description: String(document.getElementById('eventEditDescription')?.value || '').trim().slice(0, 600)
    };
    try {
        await window.saveFolderToCloud(updated);
        toggleEventEdit(false);
        window.openEventPage(null, id);
        window.showNotification('פרטי האירוע נשמרו.');
    } catch (error) {
        console.error('saveEventDetails failed:', error);
        window.showNotification(error.message || 'שמירת פרטי האירוע נכשלה.', false);
    }
};

// --- 6. Main UI Renders ---
function setActiveFolder(folderId) {
    const safeFolderId = window.safeRecordId(folderId);
    if (safeFolderId !== 'favorites' && !window.state.folders.some(folder => window.safeRecordId(folder.id) === safeFolderId)) return;
    window.state.tempSearchResults = null;
    const searchBanner = document.getElementById('tempSearchBanner');
    if(searchBanner) searchBanner.classList.add('hidden');
    window.state.activeFolderId = safeFolderId; window.renderFolders(); window.renderImages();
}

window.openFavoritesFromProfile = function() {
    if (!window.state.isGoogleUser || window.state.userApprovalStatus !== 'approved') {
        window.showNotification('המועדפים זמינים למשתמשים מאושרים בלבד.', false);
        return;
    }
    setActiveFolder('favorites');
    const panel = document.getElementById('floatingProfilePanel');
    if (panel) panel.classList.remove('active');
};

function handleSearch(val) { window.state.searchQuery = val; window.renderImages(); }

window.setGallerySort = function(sort) {
    window.state.gallerySort = ['newest', 'oldest', 'name'].includes(sort) ? sort : 'newest';
    window.renderImages();
};

function getFilteredSortedImages() {
    let filtered = window.state.tempSearchResults !== null ? [...window.state.tempSearchResults] : [...window.state.images];
    if (window.state.tempSearchResults === null && window.state.activeFolderId === 'favorites') {
        filtered = filtered.filter(img => window.state.favorites.has(window.safeRecordId(img.id)));
    } else if (window.state.tempSearchResults === null && window.state.activeFolderId !== 'all') {
        filtered = filtered.filter(img => img.folderId === window.state.activeFolderId);
    }
    if (window.state.searchQuery) {
        const q = window.state.searchQuery.toLowerCase();
        filtered = filtered.filter(img => {
            const folderName = window.state.folders.find(folder => folder.id === img.folderId)?.name || '';
            return [
                img.title,
                img.date,
                folderName,
                img.uploadedByName,
                img.originalFolderName
            ].some(value => String(value || '').toLowerCase().includes(q));
        });
    }
    if (window.state.gallerySort === 'oldest') {
        filtered.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else if (window.state.gallerySort === 'name') {
        filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'he'));
    } else {
        filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return filtered;
}

// „עודכן” ברצועת הכניסה נועד לומר שהארכיון חי, ולכן ימים אחרונים מוצגים
// במילים ורק אחר כך בתאריך.
function formatArchiveUpdate(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
    const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const updated = new Date(timestamp);
    const dayDifference = Math.round((startOfDay(new Date()) - startOfDay(updated)) / 86400000);
    if (dayDifference <= 0) return 'היום';
    if (dayDifference === 1) return 'אתמול';
    if (dayDifference < 7) return `לפני ${dayDifference} ימים`;
    return updated.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

// נתוני רצועת הכניסה: מה יש בארכיון ומתי התעדכן לאחרונה.
function renderArchiveEntryFacts(eventCount, mediaCount) {
    const eventCountEl = document.getElementById('heroEventCount');
    const mediaCountEl = document.getElementById('heroMediaCount');
    const updatedEl = document.getElementById('heroUpdatedAt');
    if (eventCountEl) eventCountEl.textContent = eventCount.toLocaleString('he-IL');
    if (mediaCountEl) mediaCountEl.textContent = mediaCount.toLocaleString('he-IL');
    if (updatedEl) {
        const latest = (window.state.images || []).reduce(
            (newest, item) => Math.max(newest, Number(item?.createdAt) || 0),
            0
        );
        updatedEl.textContent = formatArchiveUpdate(latest);
    }
}

// „כניסה לארכיון” מוביל ישירות לבחירת האירוע — הצעד הראשון באתר.
window.enterArchive = function() {
    const target = document.querySelector('.collections-deck') || document.getElementById('photosGrid');
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
};

window._doRenderFolders = function() {
    if (typeof window.updateAdminOverview === 'function') window.updateAdminOverview();
    const folderList = document.getElementById('folderList'); if (!folderList) return;
    const isEditBlocked = window.state.isLocked && !window.state.isAdminLoggedIn;
    const folderParts = [];
    const favoriteCount = window.state.images.filter(item => window.state.favorites.has(window.safeRecordId(item.id))).length;
    const profileFavoritesCount = document.getElementById('profileFavoritesCount');
    if (profileFavoritesCount) profileFavoritesCount.textContent = String(favoriteCount);

    const folders = [...(window.state.folders || [])].sort(function(a, b) {
        if (a.id === 'all') return -1;
        if (b.id === 'all') return 1;
        if (a.syncedFromDrive !== b.syncedFromDrive) return a.syncedFromDrive ? 1 : -1;
        if (a.syncedFromDrive && b.syncedFromDrive) {
            const pathCompare = String(a.drivePath || a.name || '').localeCompare(String(b.drivePath || b.name || ''), 'he');
            if (pathCompare) return pathCompare;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'he');
    });

    const eventCount = Math.max(0, folders.filter(folder => folder.id !== 'all').length);
    const mediaCount = window.state.images.length;
    const folderTotalCount = document.getElementById('folderTotalCount');
    const folderMediaCount = document.getElementById('folderMediaCount');
    if (folderTotalCount) folderTotalCount.textContent = String(eventCount);
    if (folderMediaCount) folderMediaCount.textContent = String(mediaCount);
    renderArchiveEntryFacts(eventCount, mediaCount);

    folders.forEach(folder => {
        const folderId = window.safeRecordId(folder.id);
        if (!folderId) return;
        const isActive = window.state.activeFolderId === folder.id;
        const canDeleteFolder = folderId !== 'all' && !isEditBlocked && (
            window.state.isSuperAdmin || (!folder.isDefault && !['1', '2', '3', '4'].includes(folderId))
        );
        const delBtn = canDeleteFolder ? `<button type="button" onclick="handleDeleteFolder(event, '${folderId}')" class="folder-card-action folder-card-delete" aria-label="מחיקת התיקייה ${window.escapeHtml(folder.name)}" title="מחיקת תיקייה"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : '';
        const eventBtn = folderId !== 'all' ? `<button type="button" onclick="openEventPage(event, '${folderId}')" class="folder-card-action" aria-label="פתיחת עמוד האירוע ${window.escapeHtml(folder.name)}" title="עמוד האירוע"><i data-lucide="arrow-up-left" class="w-4 h-4"></i></button>` : '';
        const count = folder.id === 'all' ? window.state.images.length : window.state.images.filter(img => img.folderId === folder.id).length;
        const depth = folder.syncedFromDrive ? Math.max(0, Math.min(12, Number(folder.driveDepth) || 0)) : 0;
        const nestingStyle = depth ? `style="margin-inline-start:${Math.min(depth * 18, 144)}px"` : '';
        const branchIcon = depth ? '<span class="text-slate-600 shrink-0" aria-hidden="true">↳</span>' : '';

        const folderLabel = folderId === 'all' ? 'כל הארכיון' : window.escapeHtml(folder.name);
        const folderMeta = folderId === 'all'
            ? 'כל התמונות והסרטונים במקום אחד'
            : (folder.syncedFromDrive ? 'מסונכרן מ־Google Drive' : (folder.eventDate ? window.escapeHtml(folder.eventDate) : 'אוסף מהגלריה'));
        const folderIcon = folderId === 'all' ? 'layout-grid' : window.safeIconName(folder.icon);
        folderParts.push(`
            <article class="folder-row collection-card group ${isActive ? 'is-active' : ''}" ${nestingStyle} data-folder-depth="${depth}">
                <button type="button" onclick="setActiveFolder('${folderId}')" class="folder-button collection-card-main" ${isActive ? 'aria-current="page"' : ''}>
                    <span class="collection-card-icon" aria-hidden="true">${branchIcon}<i data-lucide="${folderIcon}" class="w-5 h-5"></i></span>
                    <span class="collection-card-content">
                        <strong class="collection-card-title">${folderLabel}</strong>
                        <span class="collection-card-meta">${folderMeta}</span>
                    </span>
                    <span class="folder-count collection-card-count"><strong>${count}</strong><small>פריטים</small></span>
                </button>
                <div class="collection-card-actions">${eventBtn}${delBtn}</div>
                <span class="collection-card-active-label" aria-hidden="true"><i data-lucide="check" class="w-3 h-3"></i> נבחר</span>
            </article>`);
    });
    folderList.innerHTML = folderParts.join('');
    window.scheduleIconRefresh(folderList);
}

// הגלריה מרונדרת במנות. קודם נבנתה כל הרשת בבת אחת, ואז רץ עליה מנוע
// האייקונים — שבעה אייקונים לכל כרטיס — בכל מעבר תיקייה או לחיצה על לב.
// בספרייה של מאות פריטים זו הייתה העבודה היקרה ביותר בדף.
const GALLERY_PAGE_SIZE = 60;
let galleryPageItems = [];
let galleryRenderedCount = 0;
let galleryPageObserver = null;

window._doRenderImages = function() {
    if (typeof window.updateAdminOverview === 'function') window.updateAdminOverview();
    const grid = document.getElementById('photosGrid'); const emptyState = document.getElementById('emptyState');
    if (!grid || !emptyState) return; grid.innerHTML = '';
    const filtered = getFilteredSortedImages();
    galleryPageItems = filtered;
    galleryRenderedCount = 0;

    const imageCounter = document.getElementById('imageCounter');
    if (imageCounter) { imageCounter.classList.remove('hidden'); imageCounter.textContent = `${filtered.length} פריטים`; }

    if (filtered.length === 0) {
        grid.classList.add('hidden'); emptyState.classList.remove('hidden'); emptyState.classList.add('flex');
        updateGalleryLoadMore();
        return;
    }
    grid.classList.remove('hidden'); emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    window.renderMoreImages();
};

// בונה כרטיס אחד. הוצא מהלולאה כדי שגם המנה הראשונה וגם כל מנה נוספת
// ייבנו מאותו קוד בדיוק.
function buildGalleryCard(img, index, isEditBlocked) {
    const imageId = window.safeRecordId(img.id);
    if (!imageId) return;
    const folder = window.state.folders.find(f => f.id === img.folderId);
    const imageUrl = window.safeImageUrl(img.url);
    const isVideo = window.isVideoRecord(img);
    const isFavorite = window.state.favorites.has(imageId);
    const isSelected = window.state.selectedMediaIds.has(imageId);
    const title = window.escapeHtml(img.title || (isVideo ? 'סרטון ללא שם' : 'תמונה ללא שם'));
    const videoPoster = window.safeImageUrl(img.thumbnailUrl);
    const durationLabel = formatMediaDuration(img.duration);
    const mediaHtml = isVideo
        ? `<video src="${window.escapeHtml(imageUrl)}" ${videoPoster ? `poster="${window.escapeHtml(videoPoster)}"` : ''} muted playsinline preload="none" class="w-full h-full object-cover gallery-card-img bg-black"></video>
           <span class="absolute inset-0 flex items-center justify-center pointer-events-none"><span class="w-14 h-14 rounded-full bg-black/65 border border-white/30 text-white flex items-center justify-center shadow-xl"><i data-lucide="play" class="w-6 h-6 fill-current"></i></span></span>
           <span class="absolute top-3 right-3 rounded-full bg-black/70 border border-white/20 px-2.5 py-1 text-[9px] font-bold text-white flex items-center gap-1"><i data-lucide="video" class="w-3 h-3"></i> סרטון${durationLabel ? ` · ${durationLabel}` : ''}</span>`
        : `<img src="${window.escapeHtml(imageUrl)}" loading="lazy" decoding="async" alt="${title}" class="w-full h-full object-cover gallery-card-img" onerror="window.handleImageError(this)">`;
    const actionHtml = !isEditBlocked ? `<div class="gallery-actions mt-4 pt-3 border-t border-slate-200 flex items-center justify-between opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"><button type="button" onclick="changeImageFolder('${imageId}')" class="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><i data-lucide="folder-sync" class="w-3.5 h-3.5"></i>העבר</button><button type="button" onclick="handleDeleteImage('${imageId}')" class="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg" aria-label="מחיקת ${title}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>` : '';
    return `
        <article class="overflow-hidden flex flex-col group relative fade-up gallery-card ${isSelected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-950' : ''}" style="--card-index:${Math.min(index, 12)}">
            <button type="button" class="gallery-media" onclick="${window.state.bulkSelectionMode ? `toggleMediaSelection(event, '${imageId}')` : `openLightbox('${imageId}')`}" aria-label="${window.state.bulkSelectionMode ? 'בחירת' : 'פתיחת'} ${title}">
                ${mediaHtml}
                <span class="gallery-number">${String(index + 1).padStart(2, '0')}</span>
                <span class="gallery-view"><i data-lucide="maximize-2" class="w-3.5 h-3.5"></i> תצוגה מלאה</span>
            </button>
            ${window.state.bulkSelectionMode ? `<button type="button" onclick="toggleMediaSelection(event, '${imageId}')" class="absolute top-3 left-3 z-30 w-9 h-9 rounded-full flex items-center justify-center border ${isSelected ? 'bg-cyan-400 text-slate-950 border-cyan-300' : 'bg-black/70 text-white border-white/30'}" aria-label="${isSelected ? 'ביטול בחירה' : 'בחירת הפריט'}"><i data-lucide="${isSelected ? 'circle-check-big' : 'circle'}" class="w-5 h-5"></i></button>` : ''}
            <button type="button" onclick="toggleFavorite(event, '${imageId}')" class="absolute ${window.state.bulkSelectionMode ? 'top-14' : 'top-3'} left-3 z-30 w-9 h-9 rounded-full flex items-center justify-center border bg-black/65 ${isFavorite ? 'text-red-400 border-red-300/50' : 'text-white border-white/25'}" aria-label="${isFavorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}"><i data-lucide="heart" class="w-4 h-4 ${isFavorite ? 'fill-current' : ''}"></i></button>
            <div class="gallery-caption p-4 flex-1 flex flex-col justify-between relative z-10">
                <div><h3 class="gallery-title font-bold truncate mb-1">${title}</h3><div class="gallery-meta flex items-center gap-2 text-[11px]"><span class="gallery-folder-tag px-2 py-0.5 font-medium">${window.escapeHtml(folder ? folder.name : 'כללי')}</span><span aria-hidden="true">•</span><time datetime="${window.escapeHtml(img.date || '')}">${window.formatDate(img.date)}</time></div></div>${actionHtml}
            </div>
        </article>`;
}

// מוסיפה את המנה הבאה בלבד, ומרעננת אייקונים רק על מה שנוסף.
window.renderMoreImages = function() {
    const grid = document.getElementById('photosGrid');
    if (!grid || galleryRenderedCount >= galleryPageItems.length) return;
    const isEditBlocked = window.state.isLocked && !window.state.isAdminLoggedIn;
    const nextCount = Math.min(galleryRenderedCount + GALLERY_PAGE_SIZE, galleryPageItems.length);
    const html = galleryPageItems
        .slice(galleryRenderedCount, nextCount)
        .map((img, offset) => buildGalleryCard(img, galleryRenderedCount + offset, isEditBlocked))
        .filter(Boolean)
        .join('');
    const firstNewCard = grid.children.length;
    grid.insertAdjacentHTML('beforeend', html);
    galleryRenderedCount = nextCount;
    for (let i = firstNewCard; i < grid.children.length; i++) window.scheduleIconRefresh(grid.children[i]);
    updateGalleryLoadMore();
};

function updateGalleryLoadMore() {
    const footer = document.getElementById('galleryLoadMore');
    if (!footer) return;
    const remaining = galleryPageItems.length - galleryRenderedCount;
    footer.classList.toggle('hidden', remaining <= 0);
    footer.classList.toggle('flex', remaining > 0);
    const counter = document.getElementById('galleryLoadMoreCount');
    if (counter) counter.textContent = remaining > 0 ? `מוצגים ${galleryRenderedCount} מתוך ${galleryPageItems.length} פריטים` : '';

    // הזקיף טוען את המנה הבאה עוד לפני שהמשתמש מגיע לתחתית, כך שהגלילה
    // נראית רציפה. בדפדפן בלי IntersectionObserver נשאר הכפתור הידני.
    if (!galleryPageObserver && typeof IntersectionObserver === 'function') {
        galleryPageObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) window.renderMoreImages();
        }, { rootMargin: '600px 0px' });
        galleryPageObserver.observe(footer);
    }
}

window.populateFolderSelects = function() {
    ['pendingTargetFolder', 'moveFolderSelect', 'adminTargetFolderSelect', 'userTargetFolderSelect'].forEach(id => {
        const s = document.getElementById(id); if (!s) return;
        s.innerHTML = id === 'pendingTargetFolder' || id === 'adminTargetFolderSelect' ? '<option value="auto" class="font-bold text-amber-400 bg-slate-950">יצירה וחלוקה אוטומטית לפי תיקיות משנה</option>' : '';
        window.state.folders.filter(f => f.id !== 'all').forEach(f => {
            const folderId = window.safeRecordId(f.id);
            if (folderId) s.insertAdjacentHTML('beforeend', `<option value="${folderId}" class="bg-slate-950 text-white">${window.escapeHtml(f.name)}</option>`);
        });
    });
};

// Debounced render wrappers — collapse rapid successive calls into one DOM update
(function() {
    let _imgTimer, _folderTimer;
    window.renderImages = function() {
        clearTimeout(_imgTimer);
        _imgTimer = setTimeout(window._doRenderImages, 50);
    };
    window.renderFolders = function() {
        clearTimeout(_folderTimer);
        _folderTimer = setTimeout(window._doRenderFolders, 50);
    };
})();

// --- 7. Uploads & Approvals ---
function isSupportedVideoFile(file) {
    return Boolean(file && (
        ['video/mp4', 'video/webm'].includes(String(file.type || '').toLowerCase())
        || /\.(?:mp4|webm)$/i.test(file.name)
    ));
}

function isSupportedMediaFile(file) {
    return Boolean(file && (
        file.type.startsWith('image/')
        || /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
        || isSupportedVideoFile(file)
    ));
}

async function createFileFingerprint(file) {
    if (!(file instanceof Blob) || !window.crypto?.subtle) return '';
    const bytes = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

let duplicateUploadResolver = null;

window.resolveDuplicateUpload = function(choice) {
    window.closeModal('duplicateMediaModal');
    const resolver = duplicateUploadResolver;
    duplicateUploadResolver = null;
    if (resolver) resolver(choice);
};

async function resolveDuplicateMedia(records) {
    const knownHashes = new Set(
        [...(window.state.images || []), ...(window.state.pendingImages || [])]
            .map(item => String(item.contentHash || ''))
            .filter(Boolean)
    );
    const currentHashes = new Set();
    records.forEach(record => {
        const hash = String(record.contentHash || '');
        record._isDuplicate = Boolean(hash && (knownHashes.has(hash) || currentHashes.has(hash)));
        if (hash) currentHashes.add(hash);
    });
    const duplicates = records.filter(record => record._isDuplicate);
    if (!duplicates.length) return records;

    const message = document.getElementById('duplicateMediaMessage');
    const list = document.getElementById('duplicateMediaList');
    if (message) message.textContent = `נמצאו ${duplicates.length} קבצים שכבר קיימים בגלריה או מופיעים יותר מפעם אחת בבחירה הנוכחית.`;
    if (list) {
        list.replaceChildren();
        duplicates.slice(0, 20).forEach(record => {
            const row = document.createElement('p');
            row.className = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-slate-300 truncate';
            row.textContent = record.title || 'קובץ ללא שם';
            list.appendChild(row);
        });
    }
    window.openModal('duplicateMediaModal');
    window.scheduleIconRefresh();
    const choice = await new Promise(resolve => { duplicateUploadResolver = resolve; });
    if (choice === 'cancel') return [];
    if (choice === 'skip') return records.filter(record => !record._isDuplicate);
    return records;
}

function inspectVideoFile(file) {
    return new Promise(resolve => {
        const video = document.createElement('video');
        const objectUrl = URL.createObjectURL(file);
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(objectUrl);
            video.removeAttribute('src');
            video.load();
            resolve(result);
        };
        const timeout = window.setTimeout(() => finish({ duration: 0, thumbnailDataUrl: '' }), 15000);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
            const captureAt = Math.min(Math.max(0.1, duration * 0.1), 2);
            video.onseeked = () => {
                window.clearTimeout(timeout);
                try {
                    const width = video.videoWidth || 640;
                    const height = video.videoHeight || 360;
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(1, 800 / Math.max(width, height));
                    canvas.width = Math.max(1, Math.round(width * scale));
                    canvas.height = Math.max(1, Math.round(height * scale));
                    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
                    finish({ duration, thumbnailDataUrl: canvas.toDataURL('image/jpeg', 0.76) });
                } catch (error) {
                    finish({ duration, thumbnailDataUrl: '' });
                }
            };
            try {
                video.currentTime = captureAt;
            } catch (error) {
                window.clearTimeout(timeout);
                finish({ duration, thumbnailDataUrl: '' });
            }
        };
        video.onerror = () => {
            window.clearTimeout(timeout);
            finish({ duration: 0, thumbnailDataUrl: '' });
        };
        video.src = objectUrl;
    });
}

function formatMediaDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const remaining = String(total % 60).padStart(2, '0');
    return `${minutes}:${remaining}`;
}

window.renderSelectedUploadQueue = function(inputIds, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const files = (inputIds || []).flatMap(id => Array.from(document.getElementById(id)?.files || [])).filter(isSupportedMediaFile);
    container.replaceChildren();
    container.classList.toggle('hidden', files.length === 0);
    files.forEach((file, index) => {
        const row = document.createElement('div');
        row.dataset.uploadIndex = String(index);
        row.className = 'flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2';
        const icon = document.createElement('span');
        icon.className = 'upload-queue-icon text-amber-400';
        icon.innerHTML = `<i data-lucide="${isSupportedVideoFile(file) ? 'video' : 'image'}" class="w-3.5 h-3.5"></i>`;
        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[10px] font-bold text-slate-200 truncate';
        name.textContent = file.webkitRelativePath || file.name;
        const size = document.createElement('p');
        size.className = 'text-[8px] text-slate-500';
        size.textContent = file.size >= 1024 * 1024
            ? `${(file.size / (1024 * 1024)).toFixed(1)}MB`
            : `${Math.max(1, Math.round(file.size / 1024))}KB`;
        body.append(name, size);
        const status = document.createElement('span');
        status.className = 'upload-queue-status text-[9px] text-slate-400';
        status.textContent = 'ממתין';
        row.append(icon, body, status);
        container.appendChild(row);
    });
    window.scheduleIconRefresh();
};

function updateUploadQueueItem(containerId, index, state, label) {
    const row = document.querySelector(`#${containerId} [data-upload-index="${index}"]`);
    if (!row) return;
    const status = row.querySelector('.upload-queue-status');
    const icon = row.querySelector('.upload-queue-icon');
    if (status) {
        status.textContent = label;
        status.className = `upload-queue-status text-[9px] ${
            state === 'success' ? 'text-emerald-300' :
            state === 'error' ? 'text-red-300' :
            state === 'active' ? 'text-cyan-300' : 'text-slate-400'
        }`;
    }
    if (icon) {
        icon.className = `upload-queue-icon ${
            state === 'success' ? 'text-emerald-300' :
            state === 'error' ? 'text-red-300' :
            state === 'active' ? 'text-cyan-300' : 'text-amber-400'
        }`;
        icon.innerHTML = `<i data-lucide="${
            state === 'success' ? 'circle-check' :
            state === 'error' ? 'circle-x' :
            state === 'active' ? 'loader-circle' : 'image'
        }" class="w-3.5 h-3.5 ${state === 'active' ? 'animate-spin' : ''}"></i>`;
    }
    window.scheduleIconRefresh();
}

let uploadPaused = false;
let failedUploadRecords = [];

function waitWhileUploadPaused() {
    return new Promise(resolve => {
        const check = () => uploadPaused ? window.setTimeout(check, 250) : resolve();
        check();
    });
}

window.toggleUploadPause = function() {
    uploadPaused = !uploadPaused;
    const button = document.getElementById('userUploadPauseBtn');
    if (button) button.textContent = uploadPaused ? 'המשך העלאה' : 'השהה';
    const text = document.getElementById('userUploadProgressText');
    if (uploadPaused && text) text.textContent = 'תור ההעלאה מושהה. הקובץ הנוכחי יסתיים בבטחה.';
};

function updateUploadControlButtons(running = false) {
    const pause = document.getElementById('userUploadPauseBtn');
    const retry = document.getElementById('userUploadRetryBtn');
    if (pause) pause.classList.toggle('hidden', !running);
    if (retry) retry.classList.toggle('hidden', running || failedUploadRecords.length === 0);
}

window.retryFailedUploads = async function() {
    if (!failedUploadRecords.length) return;
    const pending = [...failedUploadRecords];
    failedUploadRecords = [];
    uploadPaused = false;
    updateUploadControlButtons(true);
    const progress = document.getElementById('userUploadProgress');
    const text = document.getElementById('userUploadProgressText');
    progress?.classList.remove('hidden');
    for (let index = 0; index < pending.length; index++) {
        await waitWhileUploadPaused();
        const item = pending[index];
        if (text) text.textContent = `ניסיון חוזר: ${index + 1} מתוך ${pending.length}`;
        updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'active', 'מנסה שוב');
        try {
            if (item.mode === 'pending') await window.savePendingImageCloud(item.record);
            else await window.saveImageToCloud(item.record);
            updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'success', 'הושלם');
        } catch (error) {
            failedUploadRecords.push(item);
            updateUploadQueueItem(item.queueId, item.uploadQueueIndex, 'error', 'נכשל שוב');
        }
    }
    progress?.classList.add('hidden');
    updateUploadControlButtons(false);
    window.showNotification(failedUploadRecords.length ? `${failedUploadRecords.length} קבצים עדיין לא הועלו.` : 'כל הקבצים הועלו בהצלחה.', failedUploadRecords.length === 0);
};

async function processFilesWithFolders(files, targetFolderId = 'auto', isAdmin = false) {
    const newImages = []; let processedCount = 0;
    const fallbackFolderId = window.safeRecordId(
        window.state.folders.find(folder => window.safeRecordId(folder.id) === '4')?.id
        || window.state.folders.find(folder => window.safeRecordId(folder.id) !== 'all')?.id
    );
    if (!fallbackFolderId) throw new Error('יש ליצור לפחות תיקיית יעד אחת לפני העלאת קבצים.');
    const progressEl = document.getElementById(isAdmin ? 'adminUploadProgressText' : 'userUploadProgressText');
    const queueId = isAdmin ? 'adminUploadQueue' : 'userUploadQueue';
    for (let i = 0; i < files.length; i++) {
        await waitWhileUploadPaused();
        const file = files[i]; let destFolderId = targetFolderId === 'auto' ? null : targetFolderId; let folderName = "כללי";
        updateUploadQueueItem(queueId, i, 'active', 'מעבד');
        let contentHash = '';
        try {
            contentHash = await createFileFingerprint(file);
        } catch (error) {
            console.warn('File fingerprint failed:', error);
        }
        if (file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length > 1) {
                folderName = parts[parts.length - 2];
                if (isAdmin && targetFolderId === 'auto') {
                    let existingFolder = window.state.folders.find(f => f.name === folderName);
                    if (!existingFolder) {
                        existingFolder = { id: 'folder_' + crypto.randomUUID(), name: folderName, icon: 'folder', isDefault: false };
                        await window.saveFolderToCloud(existingFolder);
                    }
                    destFolderId = existingFolder.id;
                }
            }
        }
        const isVideo = isSupportedVideoFile(file);
        if (isVideo && file.size > 100 * 1024 * 1024) {
            updateUploadQueueItem(queueId, i, 'error', 'מעל 100MB');
        } else if (isVideo) {
            const videoMimeType = file.type || (/\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4');
            const videoFile = file.type ? file : new File([file], file.name, { type: videoMimeType, lastModified: file.lastModified });
            const videoInfo = await inspectVideoFile(videoFile);
            newImages.push({
                uploadQueueIndex: i,
                id: `img_${crypto.randomUUID()}`,
                folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: '',
                sourceFile: videoFile, mediaType: 'video', mimeType: videoMimeType,
                duration: videoInfo.duration,
                thumbnailDataUrl: videoInfo.thumbnailDataUrl,
                contentHash, originalSize: file.size,
                date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName
            });
            updateUploadQueueItem(queueId, i, 'ready', 'מוכן');
        } else {
            const base64 = await window.compressAndConvertImage(file, 800, 800, 0.6);
            if (base64) {
                newImages.push({
                    uploadQueueIndex: i,
                    id: `img_${crypto.randomUUID()}`,
                    folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: base64,
                    mediaType: 'image', mimeType: 'image/jpeg',
                    contentHash, originalSize: file.size,
                    date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName
                });
                updateUploadQueueItem(queueId, i, 'ready', 'מוכן');
            } else {
                updateUploadQueueItem(queueId, i, 'error', 'עיבוד נכשל');
            }
        }
        processedCount++;
        if (progressEl) progressEl.innerText = `מעבד: ${Math.round((processedCount / files.length) * 100)}%`;
    }
    return newImages;
}

async function handleAddPhotoAdmin(event, confirmed = false) {
    event?.preventDefault(); if (!window.checkAdminPermission()) return;
    const filesInput = document.getElementById('adminMultiFiles'); const folderInput = document.getElementById('adminFolderUpload');
    const targetFolderId = document.getElementById('adminTargetFolderSelect').value;
    let allFiles = [];
    if (filesInput && filesInput.files.length > 0) allFiles = [...allFiles, ...Array.from(filesInput.files)];
    if (folderInput && folderInput.files.length > 0) allFiles = [...allFiles, ...Array.from(folderInput.files)];
    allFiles = allFiles.filter(isSupportedMediaFile);

    if (allFiles.length === 0) { window.showNotification('נא לבחור תמונות, סרטונים או תיקייה', false); return; }
    if (!confirmed) {
        window.showConfirm(
            'העלאת קבצים לגלריה',
            `להעלות ${allFiles.length} קבצים לגלריה? הקבצים יעובדו ויישמרו בענן.`,
            () => handleAddPhotoAdmin(null, true)
        );
        return;
    }

    const progressContainer = document.getElementById('adminUploadProgress');
    if(progressContainer) progressContainer.classList.remove('hidden');
    const pText = document.getElementById('adminUploadProgressText');

    try {
        failedUploadRecords = [];
        uploadPaused = false;
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, true);
        if (newImages.length === 0) throw new Error('לא נמצאו קובצי מדיה תקינים.');
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        let uploadedCount = 0;
        let failedCount = 0;
        for (let index = 0; index < uploadRecords.length; index++) {
            await waitWhileUploadPaused();
            if(pText) pText.innerText = `מעלה לאחסון: ${index + 1} מתוך ${uploadRecords.length}`;
            const { uploadQueueIndex, ...imageRecord } = uploadRecords[index];
            updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'active', 'מעלה');
            try {
                await window.saveImageToCloud(imageRecord);
                uploadedCount++;
                updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'success', 'הושלם');
            } catch (error) {
                failedCount++;
                failedUploadRecords.push({ record: imageRecord, queueId: 'adminUploadQueue', uploadQueueIndex, mode: 'direct' });
                updateUploadQueueItem('adminUploadQueue', uploadQueueIndex, 'error', 'נכשל — נסה שוב');
                console.warn('Single admin upload failed:', error);
            }
        }
        if (!uploadedCount) throw new Error('העלאת הקבצים נכשלה. ניתן לנסות שוב.');
        if(filesInput) filesInput.value = '';
        if(folderInput) folderInput.value = '';
        await window.logActivity('uploaded_images', 'media', '', `${uploadedCount} קבצים`, failedCount ? `${failedCount} נכשלו` : 'העלאה דרך לוח הניהול');
        window.showNotification(`הועלו ${uploadedCount} קבצים לגלריה${failedCount ? `; ${failedCount} נכשלו וניתן לנסות שוב` : ''}.`);
    } catch (error) {
        console.error('Admin upload failed:', error);
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
    }
}

async function submitUserUpload(confirmed = false) {
    const approved = window.state.userApprovalStatus === 'approved';
    const canUploadDirectly = approved && ['uploader', 'admin', 'super_admin'].includes(window.state.userRole);
    const canSubmitForApproval = approved && window.state.userRole === 'viewer';
    if (!canUploadDirectly && !canSubmitForApproval) {
        window.showNotification('אין לחשבון שלך הרשאת העלאת תמונות.', false);
        return;
    }
    const filesInput = document.getElementById('userMultiFiles'); const folderInput = document.getElementById('userFolderUpload');
    const targetFolderEl = document.getElementById('userTargetFolderSelect');
    const targetFolderId = targetFolderEl?.value || '4';
    if (!window.state.folders.some(folder => window.safeRecordId(folder.id) === window.safeRecordId(targetFolderId))) {
        window.showNotification('נא לבחור תיקיית יעד תקינה.', false);
        return;
    }
    let allFiles = [];
    if (filesInput && filesInput.files.length > 0) allFiles = [...allFiles, ...Array.from(filesInput.files)];
    if (folderInput && folderInput.files.length > 0) allFiles = [...allFiles, ...Array.from(folderInput.files)];
    allFiles = allFiles.filter(isSupportedMediaFile);

    if (allFiles.length === 0) { window.showNotification('נא לבחור תמונות או סרטונים', false); return; }
    if (!confirmed) {
        window.showConfirm(
            canUploadDirectly ? 'העלאת תמונות לגלריה' : 'שליחת תמונות לאישור',
            canUploadDirectly
                ? `להעלות ${allFiles.length} קבצים ישירות לגלריה?`
                : `לשלוח ${allFiles.length} קבצים לאישור מנהל?`,
            () => submitUserUpload(true)
        );
        return;
    }
    const btn = document.getElementById('userUploadSubmitBtn');
    if(btn) btn.disabled = true;

    const progressContainer = document.getElementById('userUploadProgress');
    if(progressContainer) progressContainer.classList.remove('hidden');
    const pText = document.getElementById('userUploadProgressText');

    try {
        failedUploadRecords = [];
        uploadPaused = false;
        updateUploadControlButtons(true);
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, false);
        if (newImages.length === 0) throw new Error('לא נמצאו קובצי מדיה תקינים.');
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        let uploadedCount = 0;
        let failedCount = 0;
        for (let index = 0; index < uploadRecords.length; index++) {
            await waitWhileUploadPaused();
            if(pText) pText.innerText = `${canUploadDirectly ? 'מעלה לגלריה' : 'שולח לאישור'}: ${index + 1} מתוך ${uploadRecords.length}`;
            const { uploadQueueIndex, ...imageRecord } = uploadRecords[index];
            updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'active', canUploadDirectly ? 'מעלה' : 'שולח');
            try {
                if (canUploadDirectly) await window.saveImageToCloud(imageRecord);
                else await window.savePendingImageCloud(imageRecord);
                uploadedCount++;
                updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'success', 'הושלם');
            } catch (error) {
                failedCount++;
                failedUploadRecords.push({ record: imageRecord, queueId: 'userUploadQueue', uploadQueueIndex, mode: canUploadDirectly ? 'direct' : 'pending' });
                updateUploadQueueItem('userUploadQueue', uploadQueueIndex, 'error', 'נכשל — נסה שוב');
                console.warn('Single user upload failed:', error);
            }
        }
        if (!uploadedCount) throw new Error('העלאת הקבצים נכשלה. ניתן לנסות שוב.');
        await window.logActivity('uploaded_images', 'media', '', `${uploadedCount} קבצים`, `${canUploadDirectly ? 'העלאה ישירה' : 'נשלחו לאישור'}${failedCount ? `; ${failedCount} נכשלו` : ''}`);
        window.showNotification(canUploadDirectly
            ? `${uploadedCount} קבצים הועלו בהצלחה לגלריה${failedCount ? `; ${failedCount} נכשלו` : ''}!`
            : `${uploadedCount} קבצים נשלחו לאישור מנהל${failedCount ? `; ${failedCount} נכשלו` : ''}.`
        );
        if(filesInput) filesInput.value = '';
        if(folderInput) folderInput.value = '';
        if (!failedCount) window.closeModal('userUploadModal');
    } catch (error) {
        console.error('User upload failed:', error);
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
        if(btn) btn.disabled = false;
        updateUploadControlButtons(false);
    }
}

async function handleCreateEmptyFolder(event, confirmed = false) {
    event?.preventDefault(); if (!window.checkAdminPermission()) return;
    const nameEl = document.getElementById('emptyFolderName');
    const name = nameEl ? nameEl.value.trim() : '';
    const iconEl = document.querySelector('input[name="emptyFolderIcon"]:checked');
    const icon = iconEl ? iconEl.value : 'folder';
    if (!name) return;
    if (window.state.folders.some(folder => String(folder.name || '').trim().toLowerCase() === name.toLowerCase())) {
        window.showNotification('כבר קיימת תיקייה בשם הזה.', false);
        return;
    }
    if (!confirmed) {
        window.showConfirm(
            'יצירת תיקייה חדשה',
            `ליצור בגלריה תיקייה חדשה בשם "${name}"?`,
            () => handleCreateEmptyFolder(null, true)
        );
        return;
    }
    const newFolder = { id: 'folder_' + crypto.randomUUID(), name, icon, isDefault: false };
    try {
        await window.saveFolderToCloud(newFolder);
        if(nameEl) nameEl.value = '';
        window.showNotification(`התיקייה "${name}" נוצרה בענן!`);
    } catch (error) {
        console.error('Folder creation failed:', error);
        window.showNotification('יצירת התיקייה נכשלה. נסה שוב.', false);
    }
}


function handleDeleteFolder(event, folderId) {
    event.stopPropagation(); if (!window.checkAdminPermission()) return;
    folderId = window.safeRecordId(folderId);
    if (folderId === 'all') {
        window.showNotification('תיקיית „הכול” היא תצוגה כללית ואינה תיקייה אמיתית למחיקה.', false);
        return;
    }
    const folder = window.state.folders.find(item => window.safeRecordId(item.id) === folderId);
    if (!window.state.isSuperAdmin) {
        window.showConfirm('בקשת מחיקת תיקייה', 'לשלוח למנהל־העל בקשה למחיקת התיקייה?', async () => {
            try {
                await window.requestContentDeletion('folder', folderId, folder?.name || 'תיקייה');
                window.showNotification('בקשת המחיקה נשלחה למנהל־העל.');
            } catch (error) {
                window.showNotification(error.message || 'שליחת הבקשה נכשלה.', false);
            }
        });
        return;
    }
    const mediaCount = window.state.images.filter(item => window.safeRecordId(item.folderId) === folderId).length;
    window.showConfirm('העברת תיקייה לסל', `להעביר את התיקייה ואת ${mediaCount} הפריטים שבתוכה לסל המחזור? יהיה אפשר לשחזר הכול יחד.`, async () => {
        try {
            await window.moveFolderToTrash(folderId);
            window.showNotification('התיקייה הועברה לסל המחזור.');
        } catch (error) {
            console.error('moveFolderToTrash failed:', error);
            window.showNotification('העברת התיקייה לסל נכשלה.', false);
        }
    });
}

function handleDeleteImage(id) {
    if (!window.checkAdminPermission()) return;
    id = window.safeRecordId(id);
    if (!id) return;
    const image = window.state.images.find(item => window.safeRecordId(item.id) === id);
    if (!window.state.isSuperAdmin) {
        window.showConfirm('בקשת מחיקת תמונה', 'לשלוח למנהל־העל בקשה למחיקת התמונה?', async () => {
            try {
                await window.requestContentDeletion('image', id, image?.title || 'תמונה');
                window.showNotification('בקשת המחיקה נשלחה למנהל־העל.');
            } catch (error) {
                window.showNotification(error.message || 'שליחת הבקשה נכשלה.', false);
            }
        });
        return;
    }
    window.showConfirm('העברת תמונה לסל', 'להעביר את התמונה לסל המחזור? ניתן יהיה לשחזר אותה.', async () => {
        try {
            await window.moveImageToTrash(id);
        } catch (error) {
            console.error('moveImageToTrash failed:', error);
            window.showNotification('העברת התמונה לסל נכשלה.', false);
        }
    });
}

function changeImageFolder(id) {
    if (!window.checkAdminPermission()) return;
    id = window.safeRecordId(id);
    const img = window.state.images.find(i => window.safeRecordId(i.id) === id); if (!img) return;
    const s = document.getElementById('moveFolderSelect');
    if(!s) return;
    s.innerHTML = '';
    window.state.folders.filter(f => f.id !== 'all').forEach(f => {
        const folderId = window.safeRecordId(f.id);
        if (folderId) s.insertAdjacentHTML('beforeend', `<option value="${folderId}" ${folderId === window.safeRecordId(img.folderId) ? 'selected' : ''}>${window.escapeHtml(f.name)}</option>`);
    });
    const moveBtn = document.getElementById('moveFolderSubmitBtn');
    if(moveBtn) {
        moveBtn.onclick = () => {
            const targetFolderId = window.safeRecordId(s.value);
            if (!window.state.folders.some(folder => window.safeRecordId(folder.id) === targetFolderId)) return;
            const targetFolder = window.state.folders.find(folder => window.safeRecordId(folder.id) === targetFolderId);
            window.showConfirm(
                'העברת תמונה',
                `להעביר את התמונה "${img.title || 'תמונה'}" לתיקייה "${targetFolder?.name || 'התיקייה שנבחרה'}"?`,
                async () => {
                    try {
                        await window.saveImageToCloud({ ...img, folderId: targetFolderId });
                        window.closeModal('moveFolderModal');
                        window.showNotification("עודכן בהצלחה");
                    } catch (error) {
                        console.error('Move image failed:', error);
                        window.showNotification('העברת התמונה נכשלה.', false);
                        throw error;
                    }
                }
            );
        };
    }
    window.openModal('moveFolderModal');
}

// --- 8. Lightbox Display ---
let gallerySlideshowTimer = null;

function openLightbox(imageId) {
    imageId = window.safeRecordId(imageId);
    currentFilteredImages = getFilteredSortedImages();
    window.state.currentLightboxIndex = currentFilteredImages.findIndex(img => window.safeRecordId(img.id) === imageId);
    if (window.state.currentLightboxIndex === -1) return;
    window.recordMediaView(imageId);
    updateLightbox(); window.openModal('lightboxModal');
}

function navigateLightbox(step) {
    if (currentFilteredImages.length === 0) return;
    const activeVideo = document.getElementById('lightboxVideo');
    if (activeVideo) activeVideo.pause();
    window.state.currentLightboxIndex = (window.state.currentLightboxIndex + step + currentFilteredImages.length) % currentFilteredImages.length;
    updateLightbox();
}

window.closeLightbox = function() {
    if (gallerySlideshowTimer) {
        window.clearInterval(gallerySlideshowTimer);
        gallerySlideshowTimer = null;
        updateSlideshowButton();
    }
    const activeVideo = document.getElementById('lightboxVideo');
    if (activeVideo) {
        activeVideo.pause();
        activeVideo.removeAttribute('src');
        activeVideo.load();
    }
    window.closeModal('lightboxModal');
};

function updateSlideshowButton() {
    const button = document.getElementById('slideshowToggle');
    if (!button) return;
    const running = Boolean(gallerySlideshowTimer);
    button.setAttribute('aria-label', running ? 'עצירת מצגת אוטומטית' : 'הפעלת מצגת אוטומטית');
    button.title = running ? 'עצירת מצגת' : 'הפעלת מצגת';
    button.innerHTML = `<i data-lucide="${running ? 'pause' : 'play'}" class="w-6 h-6"></i>`;
    window.scheduleIconRefresh();
}

window.toggleGallerySlideshow = function() {
    if (gallerySlideshowTimer) {
        window.clearInterval(gallerySlideshowTimer);
        gallerySlideshowTimer = null;
    } else {
        const slideshowImages = currentFilteredImages.filter(item => !window.isVideoRecord(item));
        if (slideshowImages.length < 2) {
            window.showNotification('נדרשות לפחות שתי תמונות להפעלת מצגת.', false);
            return;
        }
        const currentId = window.safeRecordId(currentFilteredImages[window.state.currentLightboxIndex]?.id);
        currentFilteredImages = slideshowImages;
        window.state.currentLightboxIndex = Math.max(0, slideshowImages.findIndex(item => window.safeRecordId(item.id) === currentId));
        updateLightbox();
        gallerySlideshowTimer = window.setInterval(() => navigateLightbox(1), 4000);
    }
    updateSlideshowButton();
};

window.startGallerySlideshow = function() {
    const images = getFilteredSortedImages().filter(item => !window.isVideoRecord(item));
    if (!images.length) {
        window.showNotification('אין תמונות להצגת מצגת.', false);
        return;
    }
    openLightbox(images[0].id);
    if (images.length > 1 && !gallerySlideshowTimer) window.toggleGallerySlideshow();
};

function updateLightbox() {
    const img = currentFilteredImages[window.state.currentLightboxIndex]; if (!img) return;
    const f = window.state.folders.find(fold => fold.id === img.folderId);

    const lbImage = document.getElementById('lightboxImage');
    const lbVideo = document.getElementById('lightboxVideo');
    const imageUrl = window.safeImageUrl(img.url);
    const isVideo = window.isVideoRecord(img);
    document.getElementById('lightboxImageFallback')?.remove();
    if (isVideo) {
        if (lbImage) lbImage.hidden = true;
        if (lbVideo) {
            lbVideo.classList.remove('hidden');
            const posterUrl = window.safeImageUrl(img.thumbnailUrl);
            if (posterUrl) lbVideo.poster = posterUrl;
            else lbVideo.removeAttribute('poster');
            const progressKey = `simchat_video_progress_${window.safeRecordId(img.id)}`;
            lbVideo.dataset.mediaId = window.safeRecordId(img.id);
            lbVideo.onloadedmetadata = () => {
                const saved = Number(localStorage.getItem(progressKey));
                if (Number.isFinite(saved) && saved > 3 && saved < lbVideo.duration - 3) lbVideo.currentTime = saved;
            };
            lbVideo.ontimeupdate = () => {
                if (Math.floor(lbVideo.currentTime) % 3 === 0) localStorage.setItem(progressKey, String(lbVideo.currentTime));
            };
            lbVideo.onended = () => localStorage.removeItem(progressKey);
            if (lbVideo.src !== imageUrl) {
                lbVideo.src = imageUrl;
                lbVideo.load();
            }
        }
    } else if(lbImage) {
        if (lbVideo) {
            lbVideo.pause();
            lbVideo.removeAttribute('src');
            lbVideo.load();
            lbVideo.classList.add('hidden');
        }
        lbImage.hidden = false;
        lbImage.onerror = () => window.handleImageError(lbImage);
        lbImage.src = imageUrl;
    }

    const lbTitle = document.getElementById('lightboxTitle');
    if(lbTitle) lbTitle.innerText = img.title;

    const lbDetails = document.getElementById('lightboxDetails');
    if(lbDetails) lbDetails.innerText = `${isVideo ? `סרטון${formatMediaDuration(img.duration) ? ` (${formatMediaDuration(img.duration)})` : ''}` : 'תמונה'} • ${window.formatDate(img.date)} • תיקייה: ${f ? f.name : 'כללי'}`;

    const lbDownload = document.getElementById('lightboxDownload');
    if(lbDownload) {
        lbDownload.disabled = !imageUrl;
        lbDownload.setAttribute('aria-disabled', imageUrl ? 'false' : 'true');
        lbDownload.onclick = imageUrl ? () => window.downloadGalleryMedia(img) : null;
    }

    const lbCounter = document.getElementById('lightboxCounter');
    if(lbCounter) lbCounter.innerText = `${window.state.currentLightboxIndex + 1} מתוך ${currentFilteredImages.length}`;
}
document.addEventListener('keydown', e => {
    const lightbox = document.getElementById('lightboxModal');
    if (lightbox && !lightbox.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') navigateLightbox(1);
        else if (e.key === 'ArrowRight') navigateLightbox(-1);
    }
    if (e.key !== 'Escape') return;

    const openModals = Array.from(document.querySelectorAll('[id$="Modal"]:not(.hidden)'))
        .sort((first, second) => {
            const firstZ = Number.parseInt(getComputedStyle(first).zIndex, 10) || 0;
            const secondZ = Number.parseInt(getComputedStyle(second).zIndex, 10) || 0;
            return firstZ - secondZ;
        });
    const topModal = openModals.at(-1);
    if (topModal) {
        if (topModal.id === 'faceCameraModal') window.closeFaceCamera();
        else if (topModal.id === 'adminTaskModal') window.closeAdminTaskWindow?.();
        else window.closeModal(topModal.id);
        return;
    }
    const drawer = document.getElementById('adminDrawer');
    if (drawer?.classList.contains('translate-x-0')) window.toggleAdminDrawer();
});

// --- 9. חיפוש AI לפי תיאור חזותי ---
window.openAiImageSearchModal = function() {
    if (!window.state.isGoogleUser || window.state.userApprovalStatus !== 'approved') {
        window.showNotification('חיפוש AI זמין למשתמשים מאושרים בלבד.', false);
        return;
    }
    if (!Array.isArray(window.state.images) || window.state.images.length === 0) {
        window.showNotification('הגלריה עדיין ריקה.', false);
        return;
    }
    const query = document.getElementById('aiImageSearchQuery');
    const status = document.getElementById('aiImageSearchStatus');
    if (query) query.value = '';
    if (status) {
        status.textContent = '';
        status.classList.add('hidden');
    }
    window.openModal('aiImageSearchModal');
    requestAnimationFrame(() => query?.focus());
};

window.setAiSearchExample = function(value) {
    const query = document.getElementById('aiImageSearchQuery');
    if (query) {
        query.value = String(value || '').slice(0, 240);
        query.focus();
    }
};

function showAiSearchResultBanner(count, query) {
    const banner = document.getElementById('tempSearchBanner');
    if (!banner) return;
    banner.className = "bg-gradient-to-r from-cyan-500/10 to-transparent border border-cyan-400/20 rounded-2xl p-4 flex justify-between items-center shadow-md animate-fade-in transition-all backdrop-blur-xl";
    banner.replaceChildren();

    const details = document.createElement('div');
    details.className = 'flex items-center gap-3 min-w-0';
    const icon = document.createElement('div');
    icon.className = 'bg-cyan-500/10 border border-cyan-400/20 p-2.5 rounded-xl text-cyan-300 shrink-0';
    icon.innerHTML = '<i data-lucide="brain-circuit" class="w-5 h-5"></i>';
    const copy = document.createElement('div');
    copy.className = 'min-w-0';
    const title = document.createElement('h4');
    title.className = 'font-bold text-white text-sm';
    title.textContent = 'תוצאות חיפוש AI';
    const summary = document.createElement('p');
    summary.className = 'text-xs text-cyan-300 font-semibold truncate';
    summary.textContent = `${count} תמונות תואמות ל־„${query}”`;
    copy.append(title, summary);
    details.append(icon, copy);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.onclick = clearTempSearchFilter;
    clear.className = 'text-xs font-bold btn-secondary-dark px-4 py-2 rounded-xl shadow-sm';
    clear.textContent = 'חזור לגלריה';
    banner.append(details, clear);
    banner.classList.remove('hidden');
    window.scheduleIconRefresh();
}

// חיפוש ה־AI מעבד קבוצה אחת בכל פעם. OpenAI מגביל את קצב הבקשות, ולכן יש
// השהיה קצרה בין קבוצות וניסיון חוזר עם השהיה מכפילה כשמתקבל 429.
const AI_SEARCH_BATCH_SIZE = 8;
const AI_SEARCH_BATCH_DELAY_MS = 1200;
// חמישה ניסיונות פורשים 2+4+8+16+32 שניות, כלומר יותר מדקה. מגבלת הקצב של
// OpenAI מתאפסת בחלון של דקה, ולכן ארבעה ניסיונות (30 שניות) עלולים להסתיים
// כולם בתוך אותו חלון חסום.
const AI_SEARCH_MAX_RETRIES = 5;
const AI_SEARCH_RETRY_BASE_MS = 2000;

function aiSearchDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// מחזיר את תשובת ה־Worker לקבוצה אחת, עם ניסיונות חוזרים על עומס זמני בלבד.
async function requestAiSearchBatch(query, batch, onRetryWait) {
    let lastError;
    for (let attempt = 0; attempt <= AI_SEARCH_MAX_RETRIES; attempt++) {
        try {
            return await window.r2Request('/ai-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, images: batch })
            });
        } catch (error) {
            lastError = error;
            // מגבלת הקצב של האתר עצמו נמשכת כמה דקות, ולכן ניסיון חוזר קצר לא יועיל.
            const retryable = error?.status === 429 && error?.code !== 'ai_rate_limit_exceeded';
            if (!retryable || attempt === AI_SEARCH_MAX_RETRIES) break;
            const wait = Math.round(AI_SEARCH_RETRY_BASE_MS * Math.pow(2, attempt) * (1 + Math.random() * 0.25));
            if (typeof onRetryWait === 'function') onRetryWait(attempt + 1, wait);
            await aiSearchDelay(wait);
        }
    }
    throw lastError;
}

window.executeAiImageSearch = async function() {
    const queryInput = document.getElementById('aiImageSearchQuery');
    const status = document.getElementById('aiImageSearchStatus');
    const button = document.getElementById('aiImageSearchSubmitBtn');
    const query = String(queryInput?.value || '').trim();
    if (query.length < 3) {
        window.showNotification('כתוב לפחות שלוש אותיות לתיאור התמונה.', false);
        queryInput?.focus();
        return;
    }

    const candidates = (window.state.images || [])
        .filter(image => !window.isVideoRecord(image))
        .map(image => {
            const id = window.safeRecordId(image.id);
            const url = window.safeImageUrl(image.url);
            const folder = window.state.folders.find(item => item.id === image.folderId);
            return id && url ? {
                id,
                url,
                title: String(image.title || 'תמונה').slice(0, 120),
                folder: String(folder?.name || 'כללי').slice(0, 80),
                date: String(image.date || '').slice(0, 20)
            } : null;
        })
        .filter(Boolean)
        .slice(0, 80);

    if (!candidates.length) {
        window.showNotification('לא נמצאו תמונות זמינות לסריקה.', false);
        return;
    }

    if (button) button.disabled = true;
    if (status) {
        status.classList.remove('hidden');
        status.textContent = `מתחיל לסרוק ${candidates.length} תמונות…`;
    }

    try {
        const matchedIds = new Set();
        // שומרים תאימות ל־Worker החי, שמקבל כרגע עד שמונה תמונות בבקשה.
        // לאחר פריסת גרסת ה־Worker החדשה אפשר להעלות את הקבוצה ל־20.
        const batchSize = AI_SEARCH_BATCH_SIZE;
        const totalBatches = Math.ceil(candidates.length / batchSize);
        let succeededBatches = 0;
        let failedBatches = 0;
        let lastBatchError = null;

        for (let offset = 0; offset < candidates.length; offset += batchSize) {
            const batch = candidates.slice(offset, offset + batchSize);
            const batchNumber = Math.floor(offset / batchSize) + 1;
            if (status) status.textContent = `ה־AI סורק קבוצה ${batchNumber} מתוך ${totalBatches}…`;

            try {
                const result = await requestAiSearchBatch(query, batch, (retryNumber, wait) => {
                    if (status) {
                        status.textContent = `מנוע ה־AI עמוס. ניסיון ${retryNumber} מתוך ${AI_SEARCH_MAX_RETRIES} לקבוצה ${batchNumber} בעוד ${Math.round(wait / 1000)} שניות…`;
                    }
                });
                (result?.matches || []).forEach(id => matchedIds.add(window.safeRecordId(id)));
                succeededBatches++;
            } catch (error) {
                // כישלון בקבוצה אחת אינו מבטל את התוצאות שכבר נאספו מקבוצות קודמות.
                failedBatches++;
                lastBatchError = error;
                console.warn(`AI image search batch ${batchNumber} of ${totalBatches} failed:`, error?.code || error?.message || error);
            }

            if (offset + batchSize < candidates.length) await aiSearchDelay(AI_SEARCH_BATCH_DELAY_MS);
        }

        // רק אם כל הקבוצות נכשלו מוצגת שגיאה במקום תוצאות חלקיות.
        if (!succeededBatches) throw lastBatchError || new Error('חיפוש ה־AI נכשל.');

        const matches = window.state.images.filter(image => matchedIds.has(window.safeRecordId(image.id)));
        window.state.tempSearchResults = matches;
        window.state.searchQuery = '';
        const regularSearch = document.getElementById('searchInput');
        if (regularSearch) regularSearch.value = '';
        window.renderImages();
        // תקלה בעיטור התצוגה לא תהפוך חיפוש שהצליח לכישלון ולא תסתיר תוצאות.
        try {
            showAiSearchResultBanner(matches.length, query);
        } catch (bannerError) {
            console.warn('AI search banner failed to render:', bannerError);
        }
        window.closeModal('aiImageSearchModal');
        const partialNote = failedBatches ? ` (${failedBatches} מתוך ${totalBatches} קבוצות לא נסרקו)` : '';
        window.showNotification(
            matches.length
                ? `נמצאו ${matches.length} תמונות מתאימות${partialNote}.`
                : `לא נמצאו תמונות שמתאימות לתיאור${partialNote}.`,
            matches.length > 0
        );
    } catch (error) {
        console.error('AI image search failed:', error);
        if (status) status.textContent = error.message || 'חיפוש ה־AI נכשל. נסה שוב.';
        window.showNotification(error.message || 'חיפוש ה־AI נכשל.', false);
    } finally {
        if (button) button.disabled = false;
    }
};


// חשיפה ל-window עבור מטפלי onclick שנשארו ב-HTML ועבור מודולים אחרים.
window.setActiveFolder = setActiveFolder;
window.handleSearch = handleSearch;
window.showNewUpdates = showNewUpdates;
window.dismissNewUpdates = dismissNewUpdates;
window.clearTempSearchFilter = clearTempSearchFilter;
window.submitUserUpload = submitUserUpload;
window.handleCreateEmptyFolder = handleCreateEmptyFolder;
window.handleAddPhotoAdmin = handleAddPhotoAdmin;
window.handleDeleteFolder = handleDeleteFolder;
window.handleDeleteImage = handleDeleteImage;
window.changeImageFolder = changeImageFolder;
window.openLightbox = openLightbox;
window.navigateLightbox = navigateLightbox;
window.getFilteredSortedImages = getFilteredSortedImages;

// מאפס את מצב ההשהיה של תור ההעלאה; נקרא מ-closeModal ב-app.js.
window.resetUploadPauseState = function() {
    uploadPaused = false;
    const pauseButton = document.getElementById('userUploadPauseBtn');
    if (pauseButton) pauseButton.textContent = 'השהה';
};

// נקודת האתחול של המודול. app.js קורא לה פעם אחת בטעינת האתר.
export function initGallery() {
    window.renderFolders?.();
    window.renderImages?.();
}
