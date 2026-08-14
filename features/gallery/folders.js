// תיקיות: הצגה, בחירה, עריכה, עמוד אירוע וספירת פריטים
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.


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

export function setActiveFolder(folderId) {
    const safeFolderId = window.safeRecordId(folderId);
    if (safeFolderId !== 'favorites' && !window.state.folders.some(folder => window.safeRecordId(folder.id) === safeFolderId)) return;
    window.state.tempSearchResults = null;
    const searchBanner = document.getElementById('tempSearchBanner');
    if(searchBanner) searchBanner.classList.add('hidden');
    window.state.activeFolderId = safeFolderId; window.renderFolders(); window.renderImages();
}

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
};

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

window.setActiveFolder = setActiveFolder;

window.handleCreateEmptyFolder = handleCreateEmptyFolder;

window.handleDeleteFolder = handleDeleteFolder;

window.changeImageFolder = changeImageFolder;
