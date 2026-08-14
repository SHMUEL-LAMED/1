// רשת המדיה: סינון, מיון, כרטיסים, מועדפים וחיפוש
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.

import { setActiveFolder } from './folders.js';
import { formatMediaDuration } from './uploads.js';

export let currentFilteredImages = [];

// currentFilteredImages מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setCurrentFilteredImages(value) {
    currentFilteredImages = value;
}

window.checkNewUpdates = function() {
    if (window.state.images.length === 0) return;
    const newest = window.state.images.reduce((max, img) => Math.max(max, img.createdAt || 0), 0);
    const lastSeen = parseInt(localStorage.getItem('yeshiva_last_seen_update') || '0');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const banner = document.getElementById('newUpdatesBanner');
    if (banner && newest > lastSeen && (Date.now() - newest < ONE_WEEK)) {
        banner.classList.remove('hidden');
    }
};

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

export function clearTempSearchFilter() {
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

export function getFilteredSortedImages() {
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

window._doRenderImages = function() {
    if (typeof window.updateAdminOverview === 'function') window.updateAdminOverview();
    const grid = document.getElementById('photosGrid'); const emptyState = document.getElementById('emptyState');
    if (!grid || !emptyState) return; grid.innerHTML = '';
    const filtered = getFilteredSortedImages();

    const imageCounter = document.getElementById('imageCounter');
    if (imageCounter) { imageCounter.classList.remove('hidden'); imageCounter.textContent = `${filtered.length} פריטים`; }

    if (filtered.length === 0) { grid.classList.add('hidden'); emptyState.classList.remove('hidden'); emptyState.classList.add('flex'); return; }
    grid.classList.remove('hidden'); emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    const isEditBlocked = window.state.isLocked && !window.state.isAdminLoggedIn;
    const htmlParts = [];
    filtered.forEach((img, index) => {
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
        htmlParts.push(`
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
            </article>`);
    });
    grid.innerHTML = htmlParts.join('');
    window.scheduleIconRefresh(grid);
};

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

window.handleSearch = handleSearch;

window.showNewUpdates = showNewUpdates;

window.dismissNewUpdates = dismissNewUpdates;

window.clearTempSearchFilter = clearTempSearchFilter;

window.handleDeleteImage = handleDeleteImage;

window.getFilteredSortedImages = getFilteredSortedImages;
