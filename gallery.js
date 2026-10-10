// gallery.js — הצגת הגלריה, מדיה, ניווט ותיקיות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.

// בחירת המקור להצגה: תצוגה מקדימה כשקיימת, ואם לא — המקור כפי שהיה.
import { pickCardSource, pickLightboxSource, pickPosterSource, pickBackdropSource } from './media-variants.js';
// תצוגה מקדימה של סרטון בריחוף או במיקוד על הכרטיס (מושתקת, כמה שניות).
import { installVideoHoverPreview } from './video-hover-preview.js';
// תאריך הצילום (takenAt) והתאריך העברי שלו: מיון, תצוגה וסינון.
import { compareCaptureDesc, compareCaptureAsc, captureDateKey, hasCaptureDate } from './capture-date.js';
import { formatHebrewDate, formatHebrewMonthYear, formatHebrewYear, hebrewDateFromDateKey, hebrewMonthName, HEBREW_MONTH_ORDER } from './hebrew-date.js';
// מחוות התצוגה המלאה (זום, החלקה) והמצגת — כל אחד במודול משלו.
import { initLightboxGestures, resetLightboxZoom } from './lightbox-gestures.js';
import {
    initLightboxSlideshow, isSlideshowActive, startSlideshow, stopSlideshow,
    slideshowNoteNavigation, handleSlideshowKey
} from './lightbox-slideshow.js';

let currentFilteredImages = [];

// --- 5. New Updates Banner ---
// "חדש מאז הביקור הקודם" נבדק מול העמוד החדש ביותר של הארכיון
// (state.latestImages, שאילתת limit קטנה), לא מול הרשימה כולה — היא אינה
// נטענת עוד בדף הגלריה.
window.checkNewUpdates = function() {
    const source = window.state.latestImages?.length ? window.state.latestImages : window.state.images;
    if (!source || source.length === 0) return;
    const newest = source.reduce((max, img) => Math.max(max, img.createdAt || 0), 0);
    const lastSeen = parseInt(localStorage.getItem('yeshiva_last_seen_update') || '0');
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const banner = document.getElementById('newUpdatesBanner');
    if (banner && newest > lastSeen && (Date.now() - newest < ONE_WEEK)) {
        banner.classList.remove('hidden');
    }
}

// כמה מהתמונות החדשות ביותר נמשכות ל"עדכונים אחרונים".
const RECENT_UPDATES_LIMIT = 200;
async function showNewUpdates() {
    localStorage.setItem('yeshiva_last_seen_update', Date.now().toString());
    const banner = document.getElementById('newUpdatesBanner');
    if(banner) banner.classList.add('hidden');
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    // התמונות מהשבוע האחרון מגיעות משאילתה ממוינת מהחדש לישן עם limit,
    // ולא מהרשימה המלאה. אם השאילתה נכשלת נשארים עם מה שכבר בזיכרון.
    let recent = window.state.latestImages?.length ? window.state.latestImages : window.state.images;
    try {
        const { collection, query, orderBy, limit, getDocsPage } = window.firestoreModules || {};
        if (window.db && typeof getDocsPage === 'function') {
            const page = await getDocsPage(
                query(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images'), orderBy('createdAt', 'desc'), limit(RECENT_UPDATES_LIMIT)),
                { pageSize: RECENT_UPDATES_LIMIT }
            );
            recent = page.docs.map(item => item.data());
        }
    } catch (error) {
        console.warn('Recent updates query failed:', error);
    }
    window.state.tempSearchResults = recent.filter(img => (img.createdAt || 0) >= weekAgo);

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

// סיומת לפי סוג הקובץ שהורד, כדי שהקובץ ייפתח במחשב בתוכנה הנכונה. שם
// שכבר מסתיים בסיומת מוכרת נשאר כפי שהוא.
const DOWNLOAD_EXTENSIONS = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/avif': 'avif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
};
function withDownloadExtension(name, mimeType) {
    const extension = DOWNLOAD_EXTENSIONS[String(mimeType || '').split(';')[0].trim().toLowerCase()];
    if (!extension || /\.(?:jpe?g|png|webp|gif|avif|heic|mp4|webm|mov)$/i.test(name)) return name;
    return `${name}.${extension}`;
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
    link.download = withDownloadExtension(safeDownloadFileName(item?.title, fallbackName), blob.type || item?.mimeType);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(objectUrl);
    }, 100);
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
    // בדף הגלריה הזיכרון מחזיק רק את התיקייה הפעילה: הפריטים מגיעים מהמטמון
    // לפי תיקייה, והמספר הכולל מהמונים שבשרת. תיקייה שטרם נטענה נמשכת ברקע
    // והעמוד מצויר שוב כשהיא מגיעה.
    const media = window.getLoadedFolderImages
        ? window.getLoadedFolderImages(id)
        : window.state.images.filter(item => window.safeRecordId(item.folderId) === id);
    if (!media.length && typeof window.prefetchFolderImages === 'function' && (Number(window.state.folderCounts?.[id]) || 0) > 0) {
        window.prefetchFolderImages(id).then(items => {
            const modal = document.getElementById('eventPageModal');
            if (items.length && window.state.activeEventFolderId === id && modal && !modal.classList.contains('hidden')) {
                window.openEventPage(null, id);
            }
        }).catch(error => console.warn('Event folder prefetch failed:', error));
    }
    const coverRecord = media.find(item => !window.isVideoRecord(item));
    const cover = document.getElementById('eventPageCover');
    if (cover) {
        const coverUrl = window.safeImageUrl(folder.coverUrl || coverRecord?.url);
        cover.src = coverUrl || cover.src;
        cover.classList.toggle('hidden', !coverUrl);
    }
    window.state.activeEventFolderId = id;
    document.getElementById('eventPageTitle').textContent = folder.name || 'אירוע';
    document.getElementById('eventPageDate').textContent = eventHeaderDate(folder, media);
    document.getElementById('eventPageDescription').textContent = folder.description || 'לא נוסף עדיין תיאור לאירוע.';
    const videoCount = media.filter(window.isVideoRecord).length;
    const totalCount = Math.max(media.length, Number(window.state.folderCounts?.[id]) || 0);
    const fullyLoaded = window.isFolderFullyLoaded ? window.isFolderFullyLoaded(id) : true;
    document.getElementById('eventPageStats').textContent = fullyLoaded && totalCount === media.length
        ? `${media.length} פריטים · ${videoCount} סרטונים · ${media.length - videoCount} תמונות`
        : `${totalCount} פריטים`;
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
    window.noteGallerySearchChange?.();
    // התיקייה שנבחרה נטענת לבדה: מהמטמון של הביקור, או העמוד הראשון מהענן.
    return window.loadFolderImages?.(safeFolderId);
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

function handleSearch(val) {
    window.state.searchQuery = val;
    window.renderImages();
    // חיפוש בתיקייה שטרם נטענה כולה מושך את שאר העמודים ברקע, כדי שהתוצאות
    // יכסו גם פריטים ישנים.
    if (val && window.state.imagesHasMore) {
        window.loadAllImagesForSearch?.()?.catch(error => console.warn('Search autoload failed:', error));
    }
}

window.setGallerySort = function(sort) {
    window.state.gallerySort = ['newest', 'oldest', 'name'].includes(sort) ? sort : 'newest';
    window.renderImages();
};

// --- התאריך העברי: תצוגה וסינון ---
// התאריך שמוצג לפריט הוא יום הצילום (takenDate / takenAt), ובלעדיו יום
// ההעלאה. אין תיקון שקיעה: תמונה שצולמה בערב אחרי השקיעה מקבלת את התאריך
// העברי של היום הלועזי שבו צולמה.
function formatDateKey(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function mediaDateInfo(img) {
    const dateKey = captureDateKey(img);
    const hebrew = hebrewDateFromDateKey(dateKey);
    return { dateKey, hebrew, hebrewText: formatHebrewDate(hebrew), gregorian: formatDateKey(dateKey), captured: hasCaptureDate(img) };
}

function activeHebrewFilters() {
    const year = Number(window.state.hebrewYearFilter) || 0;
    const month = HEBREW_MONTH_ORDER.includes(window.state.hebrewMonthFilter) ? window.state.hebrewMonthFilter : '';
    return { year, month };
}

window.hasActiveDateFilter = function() {
    const { year, month } = activeHebrewFilters();
    return Boolean(year || month);
};

function matchesHebrewFilters(img, filters) {
    if (!filters.year && !filters.month) return true;
    const hebrew = hebrewDateFromDateKey(captureDateKey(img));
    if (!hebrew) return false;
    return (!filters.year || hebrew.year === filters.year) && (!filters.month || hebrew.monthKey === filters.month);
}

function scopedGalleryImages() {
    let filtered = window.state.tempSearchResults !== null ? [...window.state.tempSearchResults] : [...window.state.images];
    if (window.state.tempSearchResults === null && window.state.activeFolderId === 'favorites') {
        filtered = filtered.filter(img => window.state.favorites.has(window.safeRecordId(img.id)));
    } else if (window.state.tempSearchResults === null && window.state.activeFolderId !== 'all') {
        filtered = filtered.filter(img => img.folderId === window.state.activeFolderId);
    }
    return filtered;
}

// שנה וחודש עבריים: האפשרויות נגזרות מהפריטים שבתיקייה הפעילה (מה שנטען),
// והבחירה הנוכחית נשארת ברשימה גם כשאין לה פריטים, כדי שהבחירה לא "תקפוץ".
// סינון פעיל בתיקייה שטרם נטענה כולה מושך את שאר העמודים ברקע (כמו חיפוש).
function renderHebrewDateFilters(scoped) {
    const yearSelect = document.getElementById('galleryHebrewYearFilter');
    const monthSelect = document.getElementById('galleryHebrewMonthFilter');
    if (!yearSelect || !monthSelect) return;
    const filters = activeHebrewFilters();
    const years = new Set();
    const months = new Set();
    for (const img of scoped) {
        const hebrew = hebrewDateFromDateKey(captureDateKey(img));
        if (!hebrew) continue;
        years.add(hebrew.year);
        if (!filters.year || hebrew.year === filters.year) months.add(hebrew.monthKey);
    }
    if (filters.year) years.add(filters.year);
    if (filters.month) months.add(filters.month);
    const yearOptions = [...years].sort((a, b) => b - a)
        .map(year => ({ value: String(year), label: formatHebrewYear(year) }));
    const monthOptions = HEBREW_MONTH_ORDER.filter(key => months.has(key))
        .map(key => ({ value: key, label: hebrewMonthName(key) }));
    const fill = (select, allLabel, options, selected) => {
        const signature = options.map(option => option.value).join('|');
        if (select.dataset.optionsKey !== signature) {
            select.dataset.optionsKey = signature;
            select.innerHTML = [`<option value="">${allLabel}</option>`]
                .concat(options.map(option => `<option value="${window.escapeHtml(option.value)}">${window.escapeHtml(option.label)}</option>`))
                .join('');
        }
        select.value = selected;
    };
    fill(yearSelect, 'כל השנים', yearOptions, filters.year ? String(filters.year) : '');
    fill(monthSelect, 'כל החודשים', monthOptions, filters.month);
}

function autoloadForDateFilter() {
    if (window.hasActiveGalleryFilters() && window.state.imagesHasMore) {
        window.loadAllImagesForSearch?.()?.catch(error => console.warn('Date filter autoload failed:', error));
    }
}

window.setGalleryHebrewYear = function(value) {
    const year = Number(value) || 0;
    window.state.hebrewYearFilter = year >= 5000 && year < 7000 ? String(year) : '';
    window.renderImages();
    autoloadForDateFilter();
    window.noteGallerySearchChange?.();
};

window.setGalleryHebrewMonth = function(value) {
    window.state.hebrewMonthFilter = HEBREW_MONTH_ORDER.includes(value) ? value : '';
    window.renderImages();
    autoloadForDateFilter();
    window.noteGallerySearchChange?.();
};

// --- סינון לפי סוג המדיה ---
const MEDIA_TYPE_FILTERS = ['image', 'video'];

function activeMediaTypeFilter() {
    return MEDIA_TYPE_FILTERS.includes(window.state.mediaTypeFilter) ? window.state.mediaTypeFilter : '';
}

function syncMediaTypeSelect() {
    const select = document.getElementById('galleryMediaTypeFilter');
    if (select) select.value = activeMediaTypeFilter();
}

// סינון כלשהו פעיל (תאריך עברי או סוג מדיה): בתיקייה שלא נטענה כולה הוא
// מושך את שאר העמודים ברקע, כמו חיפוש.
window.hasActiveGalleryFilters = function() {
    return window.hasActiveDateFilter() || Boolean(activeMediaTypeFilter());
};

window.setGalleryMediaType = function(value) {
    window.state.mediaTypeFilter = MEDIA_TYPE_FILTERS.includes(value) ? value : '';
    syncMediaTypeSelect();
    window.renderImages();
    autoloadForDateFilter();
    window.noteGallerySearchChange?.();
};

// --- חיפושים אחרונים ושמורים (search-history-ui.js) ---
// החיפוש הנוכחי: הטקסט והסינון הפעיל. תגיות נכללות כשמודול התגיות חושף
// window.getGalleryTagFilters / window.setGalleryTagFilters.
window.getGallerySearchSnapshot = function() {
    const state = window.state;
    const tags = typeof window.getGalleryTagFilters === 'function' ? window.getGalleryTagFilters() : [];
    return {
        query: String(state.searchQuery || ''),
        filters: {
            folderId: window.safeRecordId(state.activeFolderId) || 'all',
            hebrewYear: Number(state.hebrewYearFilter) || 0,
            hebrewMonth: state.hebrewMonthFilter || '',
            mediaType: activeMediaTypeFilter(),
            tags: Array.isArray(tags) ? tags : []
        }
    };
};

// מאפס את טקסט החיפוש ואת הסינון (שנה, חודש, סוג המדיה ותגיות). נקרא
// בהתנתקות ובהחלפת חשבון (search-history-ui.js), כדי שמי שבא אחרי המשתמש
// הקודם באותה לשונית לא יירש את החיפוש שלו.
window.clearGallerySearch = function() {
    const state = window.state;
    state.searchQuery = '';
    state.hebrewYearFilter = '';
    state.hebrewMonthFilter = '';
    state.mediaTypeFilter = '';
    syncMediaTypeSelect();
    if (typeof window.setGalleryTagFilters === 'function') window.setGalleryTagFilters([]);
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    window.renderImages();
};

// מחזיר חיפוש שמור: הטקסט וכל הסינונים, ומריץ אותו. תיקייה שכבר אינה קיימת
// מוחלפת ב"כל התמונות" ({ folderMissing: true }).
window.applyGallerySearch = async function(search = {}) {
    const state = window.state;
    const filters = search && typeof search.filters === 'object' && search.filters ? search.filters : {};
    let folderId = window.safeRecordId(filters.folderId) || 'all';
    let folderMissing = false;
    if (folderId !== 'favorites' && !state.folders.some(folder => window.safeRecordId(folder.id) === folderId)) {
        folderMissing = folderId !== 'all';
        folderId = 'all';
    }
    const year = Number(filters.hebrewYear) || 0;
    state.hebrewYearFilter = year >= 5000 && year < 7000 ? String(year) : '';
    state.hebrewMonthFilter = HEBREW_MONTH_ORDER.includes(filters.hebrewMonth) ? filters.hebrewMonth : '';
    state.mediaTypeFilter = MEDIA_TYPE_FILTERS.includes(filters.mediaType) ? filters.mediaType : '';
    syncMediaTypeSelect();
    if (typeof window.setGalleryTagFilters === 'function') {
        window.setGalleryTagFilters(Array.isArray(filters.tags) ? filters.tags : []);
    }
    const query = String(search?.query || '');
    state.searchQuery = query;
    const input = document.getElementById('searchInput');
    if (input) input.value = query;
    state.tempSearchResults = null;
    document.getElementById('tempSearchBanner')?.classList.add('hidden');
    if (window.safeRecordId(state.activeFolderId) !== folderId) {
        await setActiveFolder(folderId);
    } else {
        window.renderFolders();
        window.renderImages();
    }
    if ((query || window.hasActiveGalleryFilters()) && state.imagesHasMore) {
        window.loadAllImagesForSearch?.()?.catch(error => console.warn('Saved search autoload failed:', error));
    }
    return { folderMissing };
};

function getFilteredSortedImages() {
    let filtered = scopedGalleryImages();
    const hebrewFilters = activeHebrewFilters();
    if (hebrewFilters.year || hebrewFilters.month) {
        filtered = filtered.filter(img => matchesHebrewFilters(img, hebrewFilters));
    }
    const mediaType = activeMediaTypeFilter();
    if (mediaType) {
        filtered = filtered.filter(img => (mediaType === 'video') === Boolean(window.isVideoRecord(img)));
    }
    if (window.state.searchQuery) {
        const q = window.state.searchQuery.toLowerCase();
        filtered = filtered.filter(img => {
            const folderName = window.state.folders.find(folder => folder.id === img.folderId)?.name || '';
            return [
                img.title,
                img.date,
                mediaDateInfo(img).hebrewText,
                folderName,
                img.uploadedByName,
                img.originalFolderName
            ].some(value => String(value || '').toLowerCase().includes(q));
        });
    }
    // המיון לפי תאריך הוא לפי רגע הצילום (takenAt), ובשוויון — או כשאין —
    // לפי זמן ההעלאה.
    if (window.state.gallerySort === 'oldest') {
        filtered.sort(compareCaptureAsc);
    } else if (window.state.gallerySort === 'name') {
        filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'he'));
    } else {
        filtered.sort(compareCaptureDesc);
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
    const formatCount = value => Number(value).toLocaleString('he-IL');
    // המונים עולים בהדרגה אל הערך; בלי המודול המשותף הם פשוט נכתבים.
    if (eventCountEl) {
        if (window.animateCounter) window.animateCounter(eventCountEl, eventCount, formatCount);
        else eventCountEl.textContent = formatCount(eventCount);
    }
    if (mediaCountEl) {
        if (window.animateCounter) window.animateCounter(mediaCountEl, mediaCount, formatCount);
        else mediaCountEl.textContent = formatCount(mediaCount);
    }
    if (updatedEl) {
        const latest = latestImagesSource().reduce(
            (newest, item) => Math.max(newest, Number(item?.createdAt) || 0),
            0
        );
        updatedEl.textContent = formatArchiveUpdate(latest);
    }
}

// החדשות ביותר בכל הארכיון מגיעות משאילתת limit קטנה (state.latestImages);
// בלעדיה — ממה שטעון, כמו בדף הניהול.
function latestImagesSource() {
    return window.state.latestImages?.length ? window.state.latestImages : (window.state.images || []);
}

// פסיפס הרגעים האחרונים בפוסטר הכניסה: עד חמש תמונות מהחדשות ביותר.
// מצויר מחדש רק כשהרשימה השתנתה, כדי שלא יהבהב בכל רינדור.
const HERO_MOSAIC_LIMIT = 5;
function renderHeroMosaic() {
    const mosaic = document.getElementById('heroMosaic');
    if (!mosaic) return;
    const tiles = [...latestImagesSource()]
        .map(item => {
            const url = pickCardSource(item, window.safeImageUrl).url;
            return url ? { id: window.safeRecordId(item.id), url, createdAt: Number(item?.createdAt) || 0 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, HERO_MOSAIC_LIMIT);
    const key = tiles.map(tile => tile.id).join('|');
    if (mosaic.dataset.mosaicKey === key) return;
    mosaic.dataset.mosaicKey = key;
    mosaic.innerHTML = tiles.map((tile, index) =>
        `<span style="--tile-index:${index}"><img src="${window.escapeHtml(tile.url)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.remove()"></span>`
    ).join('');
}

// „כניסה לארכיון” מוביל ישירות לבחירת האירוע — הצעד הראשון באתר.
window.enterArchive = function() {
    const target = document.querySelector('.collections-deck') || document.getElementById('photosGrid');
    target?.scrollIntoView({ behavior: 'auto', block: 'start' });
};

// התאריך שבכותרת האירוע: תאריך האירוע שהוזן, בעברית ובלועזית; בלעדיו —
// טווח ימי הצילום של הפריטים שנטענו; ובלי שניהם — כותרת הארכיון.
function eventHeaderDate(folder, media) {
    const eventKey = /^\d{4}-\d{2}-\d{2}$/.test(String(folder?.eventDate || '')) ? folder.eventDate : '';
    if (eventKey) {
        const hebrew = formatHebrewDate(hebrewDateFromDateKey(eventKey));
        return hebrew ? `${hebrew} · ${formatDateKey(eventKey)}` : formatDateKey(eventKey);
    }
    if (folder?.eventDate) return window.formatDate(folder.eventDate) || String(folder.eventDate);
    const keys = (media || []).filter(hasCaptureDate).map(captureDateKey).filter(Boolean).sort();
    if (keys.length) {
        const first = formatHebrewDate(hebrewDateFromDateKey(keys[0]));
        const last = formatHebrewDate(hebrewDateFromDateKey(keys[keys.length - 1]));
        return first === last ? `צולם ב${first}` : `צולם בין ${first} ל${last}`;
    }
    return 'ארכיון שמחת התורה';
}

// השורה שמתחת לשם התיקייה בכרטיס האירוע: תאריך האירוע בעברית כשהוזן.
function folderEventDateLabel(folder) {
    const key = String(folder?.eventDate || '');
    const hebrew = /^\d{4}-\d{2}-\d{2}$/.test(key) ? formatHebrewDate(hebrewDateFromDateKey(key)) : '';
    return hebrew || key;
}

window._doRenderFolders = function() {
    if (typeof window.updateAdminOverview === 'function') window.updateAdminOverview();
    const folderList = document.getElementById('folderList'); if (!folderList) return;
    const isEditBlocked = window.state.isLocked && !window.state.isAdminLoggedIn;
    const folderParts = [];
    const favoriteCount = window.state.favorites.size;
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
    // המונים מגיעים מהשרת בשאילתה אחת (GET /data/images/counts?by=folderId);
    // בלעדיהם — ממה שטעון בזיכרון, כמו בדף הניהול.
    const folderCounts = window.state.folderCounts;
    const mediaCount = folderCounts ? (Number(window.state.imagesTotal) || 0) : window.state.images.length;
    const folderTotalCount = document.getElementById('folderTotalCount');
    const folderMediaCount = document.getElementById('folderMediaCount');
    if (folderTotalCount) folderTotalCount.textContent = String(eventCount);
    if (folderMediaCount) folderMediaCount.textContent = String(mediaCount);
    renderArchiveEntryFacts(eventCount, mediaCount);
    renderHeroMosaic();

    folders.forEach(folder => {
        const folderId = window.safeRecordId(folder.id);
        if (!folderId) return;
        const isActive = window.state.activeFolderId === folder.id;
        const canDeleteFolder = folderId !== 'all' && !isEditBlocked && (
            window.state.isSuperAdmin || (!folder.isDefault && !['1', '2', '3', '4'].includes(folderId))
        );
        const delBtn = canDeleteFolder ? `<button type="button" onclick="handleDeleteFolder(event, '${folderId}')" class="folder-card-action folder-card-delete" aria-label="מחיקת התיקייה ${window.escapeHtml(folder.name)}" title="מחיקת תיקייה"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : '';
        const eventBtn = folderId !== 'all' ? `<button type="button" onclick="openEventPage(event, '${folderId}')" class="folder-card-action" aria-label="פתיחת עמוד האירוע ${window.escapeHtml(folder.name)}" title="עמוד האירוע"><i data-lucide="arrow-up-left" class="w-4 h-4"></i></button>` : '';
        const count = folderCounts
            ? (folderId === 'all' ? mediaCount : (Number(folderCounts[folderId]) || 0))
            : (folder.id === 'all' ? window.state.images.length : window.state.images.filter(img => img.folderId === folder.id).length);
        const depth = folder.syncedFromDrive ? Math.max(0, Math.min(12, Number(folder.driveDepth) || 0)) : 0;
        const nestingStyle = depth ? `style="margin-inline-start:${Math.min(depth * 18, 144)}px"` : '';
        const branchIcon = depth ? '<span class="text-slate-600 shrink-0" aria-hidden="true">↳</span>' : '';

        const folderLabel = folderId === 'all' ? 'כל הארכיון' : window.escapeHtml(folder.name);
        const folderMeta = folderId === 'all'
            ? 'כל התמונות והסרטונים במקום אחד'
            : (folder.syncedFromDrive ? 'מסונכרן מ־Google Drive' : (folder.eventDate ? window.escapeHtml(folderEventDateLabel(folder)) : 'אוסף מהגלריה'));
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

// הגלריה מרונדרת במנות. המנה הראשונה נבנית מיד, וכל מנה נוספת מצטרפת רק
// כשהזקיף שבסוף הרשת מתקרב למסך. הרשימה המסוננת והממוינת נשמרת במלואה —
// ממנה ניזונה גם התצוגה המלאה — ורק הכרטיסים עצמם נבנים בעצלות. בספרייה
// של אלפי פריטים בניית כל הרשת בבת אחת, ומנוע האייקונים שרץ עליה אחר כך,
// הייתה העבודה היקרה ביותר בדף.
const GALLERY_FIRST_BATCH = 48;
const GALLERY_PAGE_SIZE = 48;
// הזקיף מבקש את המנה הבאה הרבה לפני שהמשתמש מגיע אליו, כדי שהגלילה תהיה רציפה.
const GALLERY_SENTINEL_RANGE = 900;
const GALLERY_SENTINEL_MARGIN = `${GALLERY_SENTINEL_RANGE}px 0px`;
let galleryPageItems = [];
let galleryRenderedCards = [];
let galleryViewSignature = null;
let galleryPageObserver = null;
let galleryCloudRequest = null;
let galleryCloudStalledAt = -1;
// מעבר לתצוגה אחרת מסומן כאן, והגלילה לראש הרשת מתבצעת בציור הראשון שיש
// בו כרטיסים — תיקייה שנטענת מהענן מוצגת קודם ריקה („טוען…”).
let galleryRevealPending = false;
// על אילו נתונים חושבה galleryPageItems. הציור מושהה ב-50ms אחרי כל שינוי,
// ובינתיים הזקיף עלול לחשוב שהכול כבר מוצג ולבקש עמוד מהענן לשווא.
let galleryPageSource = null;
// ציור שהתבקש (renderImages) וטרם רץ.
let galleryRenderPending = false;

// מה מגדיר „תצוגה”: תיקייה, חיפוש, מיון וסינון זמני. כל עוד אלה לא השתנו,
// רינדור מחדש הוא עדכון נתונים — תמונה חדשה, לב שנלחץ, חזרה ללשונית — ואז
// מספר הכרטיסים שכבר הוצגו נשמר, כדי שהדף לא יתקצר מתחת לגלילה של המשתמש.
// שינוי של אחד מהם מחזיר את הרשת למנה הראשונה.
function currentViewSignature() {
    return [window.state.activeFolderId, window.state.searchQuery, window.state.gallerySort, window.state.tempSearchResults,
        window.state.hebrewYearFilter || '', window.state.hebrewMonthFilter || '', window.state.mediaTypeFilter || ''];
}

function sameViewSignature(first, second) {
    return Array.isArray(first) && Array.isArray(second)
        && first.length === second.length
        && first.every((value, index) => value === second[index]);
}

function galleryEditBlocked() {
    return window.state.isLocked && !window.state.isAdminLoggedIn;
}

window._doRenderImages = function() {
    if (typeof window.updateAdminOverview === 'function') window.updateAdminOverview();
    const grid = document.getElementById('photosGrid'); const emptyState = document.getElementById('emptyState');
    if (!grid || !emptyState) return;
    const signature = currentViewSignature();
    const sameView = sameViewSignature(signature, galleryViewSignature);
    const hadView = galleryViewSignature !== null;
    // העוגן נרשם לפני כל שינוי בדף — גם הפסיפס שמעל הרשת נבנה מחדש כשמגיעה
    // תמונה חדשה, ותמונותיו העצלות מקטינות אותו עד שהן נטענות.
    const anchor = sameView ? captureGalleryScrollAnchor() : null;
    renderHeroMosaic();
    galleryViewSignature = signature;
    if (!sameView) galleryCloudStalledAt = -1;
    if (!sameView && hadView) galleryRevealPending = true;
    // פריט בלי מזהה אינו מקבל כרטיס, ולכן אינו נספר — כך המספור ומיקום
    // הכרטיס ברשת נשארים חופפים.
    galleryPageItems = getFilteredSortedImages().filter(item => window.safeRecordId(item.id));
    renderHebrewDateFilters(scopedGalleryImages());
    galleryPageSource = { images: window.state.images, length: window.state.images?.length || 0 };
    galleryRenderPending = false;

    const imageCounter = document.getElementById('imageCounter');
    if (imageCounter) { imageCounter.classList.remove('hidden'); imageCounter.textContent = galleryCounterLabel(galleryPageItems.length); }

    if (galleryPageItems.length === 0) {
        grid.innerHTML = ''; galleryRenderedCards = [];
        grid.classList.add('hidden');
        // בזמן טעינת תיקייה אין עדיין מה להציג — וגם לא "אין פריטים".
        const loading = Boolean(window.state.imagesLoading);
        emptyState.classList.toggle('hidden', loading); emptyState.classList.toggle('flex', !loading);
        updateGalleryLoadMore();
        return;
    }
    grid.classList.remove('hidden'); emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    // בלי IntersectionObserver אין מי שיבקש את המנה הבאה, ולכן נבנה הכול.
    const keep = typeof IntersectionObserver !== 'function'
        ? Infinity
        : (sameView ? Math.max(GALLERY_FIRST_BATCH, galleryRenderedCards.length) : GALLERY_FIRST_BATCH);
    syncGalleryCards(grid, galleryPageItems.slice(0, Math.min(keep, galleryPageItems.length)));
    if (galleryRevealPending) {
        galleryRevealPending = false;
        revealGalleryStart(grid);
    } else if (sameView) {
        restoreGalleryScrollAnchor(anchor);
    }
    updateGalleryLoadMore();
};

// הכיתוב שליד סרגל הכלים: כמה מוצג, וכמה יש בתיקייה כשלא הכול נטען עדיין.
function galleryCounterLabel(shownCount) {
    const state = window.state;
    if (state.imagesLoading && shownCount === 0) return 'טוען…';
    if (state.tempSearchResults !== null || !state.imagesHasMore) return `${shownCount} פריטים`;
    if (state.searchQuery || window.hasActiveGalleryFilters?.()) return `${shownCount} פריטים · מחפש גם בפריטים ישנים…`;
    const total = galleryFolderTotal();
    return total > shownCount ? `${shownCount} מתוך ${total} פריטים` : `${shownCount} פריטים`;
}

// כמה פריטים יש בתיקייה הפעילה לפי המונים שבשרת; בלעדיהם — מה שטעון.
function galleryFolderTotal() {
    const state = window.state;
    const folderId = window.safeRecordId(state.activeFolderId);
    if (folderId === 'favorites') return state.favorites.size;
    if (!state.folderCounts) return state.images.length;
    return folderId === 'all' ? (Number(state.imagesTotal) || 0) : (Number(state.folderCounts[folderId]) || 0);
}

// מעבר לתצוגה אחרת (תיקייה, חיפוש, מיון) כשהמשתמש גלל עמוק לתוך הרשת: הרשת
// מתחילה מחדש במנה הראשונה, ולכן גוללים לראשה. אחרת המשתמש נשאר מתחת לסוף
// המנה, הזקיף נראה מיד, ומנה אחר מנה נבנות בלי שראה את תחילת התצוגה.
function revealGalleryStart(grid) {
    if (typeof grid.getBoundingClientRect !== 'function' || typeof grid.scrollIntoView !== 'function') return;
    if (grid.getBoundingClientRect().top < 0) grid.scrollIntoView({ block: 'start', behavior: 'instant' });
}

// עוגן הגלילה של הדפדפן אינו מספיק ברשת: תמונה חדשה בראש הרשימה מזיזה כל
// כרטיס תא אחד קדימה, וכרטיס שבסוף שורה יורד לשורה הבאה. לכן לפני רינדור
// מחדש באותה תצוגה נרשם הכרטיס הראשון שנראה בראש המסך, ואחריו הגלילה
// מתוקנת בדיוק בהפרש שבו הוא זז. בראש הדף אין תיקון — שם רוצים לראות את
// התמונה החדשה.
function captureGalleryScrollAnchor() {
    if (!(window.scrollY > 0) || typeof window.scrollBy !== 'function') return null;
    for (const card of galleryRenderedCards) {
        const node = card.node;
        if (!node?.isConnected || typeof node.getBoundingClientRect !== 'function') continue;
        const top = node.getBoundingClientRect().top;
        if (top >= 0) return { node, top };
    }
    return null;
}

function restoreGalleryScrollAnchor(anchor) {
    if (!anchor || !anchor.node.isConnected) return;
    const delta = anchor.node.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
}

// מיישם את רשימת הפריטים על הרשת לפי מזהה, בשינויים מינימליים: פריט שכבר
// מוצג ושהמרקאפ שלו לא השתנה שומר את אותו אלמנט ב-DOM — רק מספרו ומיקומו
// מתעדכנים — ולכן התמונה שבו אינה נטענת מחדש, אנימציית הכניסה אינה רצה שוב,
// ועוגן הגלילה של הדפדפן נשמר גם כשתמונה חדשה נכנסת בראש הרשימה. כרטיס
// שהשתנה (לב, בחירה) נבנה מחדש במקומו, פריט חדש מקבל כרטיס במקום הנכון,
// ומה שאינו ברשימה עוד מוסר. רענון שלא שינה דבר אינו נוגע בדף כלל.
function syncGalleryCards(grid, items) {
    const isEditBlocked = galleryEditBlocked();
    const previous = new Map(galleryRenderedCards.map(card => [card.id, card]));
    const next = [];
    items.forEach((img, index) => {
        const id = window.safeRecordId(img.id);
        const html = buildGalleryCard(img, isEditBlocked);
        const known = previous.get(id);
        previous.delete(id);
        let node = known && known.html === html && known.node.isConnected ? known.node : null;
        if (!node) {
            known?.node.remove();
            node = insertGalleryCard(grid, html, grid.children[index] || null);
            window.scheduleIconRefresh(node);
        } else if (grid.children[index] !== node) {
            grid.insertBefore(node, grid.children[index] || null);
        }
        placeGalleryCard(node, index);
        next.push({ id, html, node });
    });
    for (const stale of previous.values()) stale.node.remove();
    while (grid.children.length > items.length) grid.lastElementChild.remove();
    galleryRenderedCards = next;
}

// מוסיפה מנה שלמה בסוף הרשת בפעולת DOM אחת, ומרעננת אייקונים רק על מה שנוסף.
function appendGalleryCards(grid, items, startIndex) {
    const isEditBlocked = galleryEditBlocked();
    const cards = items.map(img => ({ id: window.safeRecordId(img.id), html: buildGalleryCard(img, isEditBlocked), node: null }));
    const firstNewCard = grid.children.length;
    grid.insertAdjacentHTML('beforeend', cards.map(card => card.html).join(''));
    cards.forEach((card, offset) => {
        card.node = grid.children[firstNewCard + offset];
        placeGalleryCard(card.node, startIndex + offset);
        window.scheduleIconRefresh(card.node);
    });
    galleryRenderedCards = galleryRenderedCards.concat(cards);
}

function insertGalleryCard(grid, html, before) {
    if (before) {
        before.insertAdjacentHTML('beforebegin', html);
        return before.previousElementSibling;
    }
    grid.insertAdjacentHTML('beforeend', html);
    return grid.lastElementChild;
}

// המספר ומיקום הכרטיס ברשת אינם חלק מהמרקאפ שמושווה: הם נכתבים על האלמנט
// עצמו, ולכן תמונה חדשה בראש הרשימה מזיזה את שאר הכרטיסים בלי לבנותם מחדש.
// ההשהיה של אנימציית הכניסה נמדדת מתחילת המנה, כדי שכל מנה תעלה בהדרגה משלה.
function placeGalleryCard(node, index) {
    node.style.setProperty('--card-index', String(Math.min(index % GALLERY_PAGE_SIZE, 12)));
    const number = node.querySelector('.gallery-number');
    if (number) number.textContent = String(index + 1).padStart(2, '0');
    placeDateGroupLabel(node, index);
}

// קיבוץ לפי חודש הצילום: במיון לפי תאריך, הכרטיס הראשון של כל חודש עברי
// מקבל תווית "תשרי תשפ״ז". התווית תלויה בשכן, ולכן — כמו המספר — היא נכתבת
// על האלמנט ואינה חלק מהמרקאפ שמושווה.
function dateGroupKey(item) {
    const hebrew = item ? hebrewDateFromDateKey(captureDateKey(item)) : null;
    return hebrew ? `${hebrew.year}-${hebrew.monthKey}` : '';
}

function placeDateGroupLabel(node, index) {
    const label = node.querySelector('.gallery-date-group');
    if (!label) return;
    const item = galleryPageItems[index];
    const byDate = window.state.gallerySort !== 'name';
    const key = dateGroupKey(item);
    const starts = Boolean(byDate && key && (index === 0 || dateGroupKey(galleryPageItems[index - 1]) !== key));
    label.hidden = !starts;
    label.textContent = starts ? formatHebrewMonthYear(hebrewDateFromDateKey(captureDateKey(item))) : '';
}

// בונה כרטיס אחד, בלי מספרו ומיקומו (אלה נכתבים ב-placeGalleryCard). הוצא
// מהלולאה כדי שגם המנה הראשונה וגם כל מנה נוספת ייבנו מאותו קוד בדיוק.
function buildGalleryCard(img, isEditBlocked) {
    const imageId = window.safeRecordId(img.id);
    if (!imageId) return '';
    const folder = window.state.folders.find(f => f.id === img.folderId);
    const imageUrl = window.safeImageUrl(img.url);
    const isVideo = window.isVideoRecord(img);
    const isFavorite = window.state.favorites.has(imageId);
    const isSelected = window.state.selectedMediaIds.has(imageId);
    const title = window.escapeHtml(img.title || (isVideo ? 'סרטון ללא שם' : 'תמונה ללא שם'));
    // הכרטיס מציג את התצוגה הקטנה (thumb) כשקיימת; סרטון מקבל אותה כפוסטר
    // במקום ריבוע שחור. אם התצוגה לא נטענת — נופלים אל המקור.
    const videoPoster = pickPosterSource(img, window.safeImageUrl, { small: true });
    const cardSource = pickCardSource(img, window.safeImageUrl);
    const durationLabel = formatMediaDuration(img.duration);
    const mediaHtml = isVideo
        ? `<video src="${window.escapeHtml(imageUrl)}" ${videoPoster ? `poster="${window.escapeHtml(videoPoster)}"` : ''} muted playsinline preload="none" class="w-full h-full object-cover gallery-card-img bg-black"></video>
           <span class="gallery-play"><span><i data-lucide="play" class="w-6 h-6 fill-current"></i></span></span>
           <span class="gallery-badge"><i data-lucide="video" class="w-3 h-3"></i> סרטון${durationLabel ? ` · ${durationLabel}` : ''}</span>`
        : buildCardPicture(cardSource, title);
    const actionHtml = !isEditBlocked ? `<div class="gallery-actions mt-4 pt-3 border-t border-slate-200 flex items-center justify-between opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"><button type="button" onclick="changeImageFolder('${imageId}')" class="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><i data-lucide="folder-sync" class="w-3.5 h-3.5"></i>העבר</button><button type="button" onclick="handleDeleteImage('${imageId}')" class="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg" aria-label="מחיקת ${title}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>` : '';
    return `<article class="overflow-hidden flex flex-col group relative fade-up gallery-card ${isSelected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-950' : ''}" data-media-id="${imageId}" style="--card-index:0">
            <button type="button" class="gallery-media${isVideo ? ' is-loaded' : ''}" onclick="${window.state.bulkSelectionMode ? `toggleMediaSelection(event, '${imageId}')` : `openLightbox('${imageId}')`}" aria-label="${window.state.bulkSelectionMode ? 'בחירת' : 'פתיחת'} ${title}">
                ${mediaHtml}
                <span class="gallery-number">01</span>
                <span class="gallery-view"><i data-lucide="maximize-2" class="w-3.5 h-3.5"></i> תצוגה מלאה</span>
            </button>
            ${window.state.bulkSelectionMode ? `<button type="button" onclick="toggleMediaSelection(event, '${imageId}')" class="absolute top-3 left-3 z-30 w-9 h-9 rounded-full flex items-center justify-center border ${isSelected ? 'bg-cyan-400 text-slate-950 border-cyan-300' : 'bg-black/70 text-white border-white/30'}" aria-label="${isSelected ? 'ביטול בחירה' : 'בחירת הפריט'}"><i data-lucide="${isSelected ? 'circle-check-big' : 'circle'}" class="w-5 h-5"></i></button>` : ''}
            <button type="button" onclick="toggleFavorite(event, '${imageId}')" class="gallery-fav${window.state.bulkSelectionMode ? ' is-stacked' : ''}${isFavorite ? ' is-favorite' : ''}" aria-label="${isFavorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}"><i data-lucide="heart" class="w-4 h-4 ${isFavorite ? 'fill-current' : ''}"></i></button>
            <div class="gallery-caption p-4 flex-1 flex flex-col justify-between relative z-10">
                <span class="gallery-date-group" hidden></span>
                <div><h3 class="gallery-title font-bold truncate mb-1">${title}</h3><div class="gallery-meta flex items-center gap-2 text-[11px]"><span class="gallery-folder-tag px-2 py-0.5 font-medium">${window.escapeHtml(folder ? folder.name : 'כללי')}</span><span aria-hidden="true">•</span>${buildCardDate(img)}</div></div>${actionHtml}
            </div>
        </article>`;
}

// "צולם בי״ז בתשרי תשפ״ז (28.09.2026)" — או "הועלה ב…" כשתאריך הצילום אינו ידוע.
function lightboxDateLabel(img) {
    const info = mediaDateInfo(img);
    if (!info.dateKey) return '';
    const hebrew = info.hebrewText ? `${info.hebrewText} (${info.gregorian})` : info.gregorian;
    return `${info.captured ? 'צולם' : 'הועלה'} ב${hebrew}`;
}

// התאריך שבכרטיס: התאריך העברי, והלועזי בתיאור. יום הצילום כשידוע, ואחרת
// יום ההעלאה (מסומן כך בתיאור).
function buildCardDate(img) {
    const info = mediaDateInfo(img);
    if (!info.dateKey) return '';
    const title = `${info.captured ? 'צולם' : 'הועלה'} ב־${info.gregorian}`;
    return `<time class="gallery-hebrew-date" datetime="${window.escapeHtml(info.dateKey)}" title="${window.escapeHtml(title)}" data-captured="${info.captured ? 'true' : 'false'}">${window.escapeHtml(info.hebrewText || info.gregorian)}</time>`;
}

// תמונת הכרטיס: <img> עם srcset של thumb ו-medium כשיש שתיהן, ועטופה
// ב-<picture> עם מקור AVIF כשנשמר כזה. דפדפן שאינו מפענח AVIF מדלג על
// ה-<source> ונשאר עם ה-WebP/JPEG; תצוגה שלא נטענת נופלת אל המקור.
// is-loaded נקבע על .gallery-media ולא על ההורה הישיר, שעשוי להיות <picture>.
function buildCardPicture(source, title) {
    const attr = (name, value) => (value ? ` ${name}="${window.escapeHtml(value)}"` : '');
    const image = `<img src="${window.escapeHtml(source.url)}"${attr('srcset', source.srcset)}${attr('sizes', source.sizes)}${attr('data-fallback-src', source.fallbackUrl)} loading="lazy" decoding="async" alt="${title}" class="w-full h-full object-cover gallery-card-img" onload="this.closest('.gallery-media')?.classList.add('is-loaded')" onerror="window.handleImageError(this)">`;
    if (!source.avifSrcset) return image;
    return `<picture class="media-picture"><source type="image/avif" srcset="${window.escapeHtml(source.avifSrcset)}"${attr('sizes', source.sizes)}>${image}</picture>`;
}

// מוסיפה את המנה הבאה בלבד. כשכל מה שהורד כבר מוצג ובענן נותרו עוד תמונות,
// הן מתבקשות מהענף שמטפל בעימוד בשרת. manual=true מגיע מכפתור „הצג עוד”.
window.renderMoreImages = function(manual = false) {
    const grid = document.getElementById('photosGrid');
    if (!grid) return;
    if (manual === true) galleryCloudStalledAt = -1;
    const rendered = galleryRenderedCards.length;
    if (rendered >= galleryPageItems.length) {
        const images = window.state.images;
        const stale = galleryRenderPending || !galleryPageSource
            || galleryPageSource.images !== images || galleryPageSource.length !== (images?.length || 0);
        if (stale) {
            // הנתונים השתנו וטרם צוירו: קודם הציור, ורק אם גם אחריו הכול
            // מוצג — בקשה לענן.
            window._doRenderImages();
            if (galleryRenderedCards.length < galleryPageItems.length) return;
        }
        requestMoreImagesFromCloud();
        return;
    }
    const nextCount = Math.min(rendered + GALLERY_PAGE_SIZE, galleryPageItems.length);
    // הרשת כבר אינה תואמת את מה שצויר (ניקוי חיצוני): סנכרון מלא במקום הוספה.
    if (grid.children.length !== rendered) syncGalleryCards(grid, galleryPageItems.slice(0, nextCount));
    else appendGalleryCards(grid, galleryPageItems.slice(rendered, nextCount), rendered);
    updateGalleryLoadMore();
};

// --- המשך טעינה מהענן ---
// gallery-feed.js מחזיק ב-state.images רק את העמודים שכבר הורדו לתיקייה
// הפעילה, מסמן ב-state.imagesHasMore שבענן נותרו עוד, ומגדיר
// window.loadMoreImages שמביאה את העמוד הבא בסמן הדפדוף ומחזירה
// { added, done }. כשהזקיף מגיע לסוף מה שהורד, הגלריה מבקשת את העמוד הבא
// דרכה — כך הגלילה האינסופית והכפתור הידני עוברים באותו מסלול.
function canLoadMoreFromCloud() {
    const state = window.state;
    return state.imagesHasMore === true && typeof window.loadMoreImages === 'function'
        && state.tempSearchResults === null && !state.imagesLoading;
}

// מחזירה הבטחה ל-{ added, done }, או null כשאין מה לבקש.
function requestMoreImagesFromCloud() {
    if (galleryCloudRequest) return galleryCloudRequest;
    if (!canLoadMoreFromCloud()) return null;
    // בקשה שלא הוסיפה דבר אינה חוזרת על עצמה כל עוד לא השתנה כלום — אחרת
    // הזקיף שנשאר על המסך היה מציף את השרת בבקשות ריקות.
    if (galleryCloudStalledAt === (window.state.images || []).length) return null;
    let request;
    try {
        request = Promise.resolve(window.loadMoreImages());
    } catch (error) {
        request = Promise.reject(error);
    }
    galleryCloudRequest = request
        .then(result => {
            if (result?.done === true) window.state.imagesHasMore = false;
            return { added: Number(result?.added) || 0, done: result?.done === true };
        }, error => {
            console.warn('טעינת תמונות נוספות מהענן נכשלה:', error);
            return { added: 0, done: false, error };
        })
        .then(result => {
            galleryCloudRequest = null;
            if (result.added <= 0) galleryCloudStalledAt = (window.state.images || []).length;
            // מה שנוסף ל-state.images נכנס לרשימה הממוינת: הרשת מתעדכנת במקום
            // (אותה תצוגה, אותו מספר כרטיסים) ואז מקבלת את המנה הבאה.
            window._doRenderImages();
            if (result.added > 0) window.renderMoreImages();
            return result;
        });
    updateGalleryLoadMore();
    return galleryCloudRequest;
}

function updateGalleryLoadMore() {
    const footer = document.getElementById('galleryLoadMore');
    if (!footer) return;
    const remaining = galleryPageItems.length - galleryRenderedCards.length;
    const loading = Boolean(galleryCloudRequest || window.state.imagesLoadingMore);
    const cloudHasMore = canLoadMoreFromCloud();
    const visible = remaining > 0 || loading || cloudHasMore;
    footer.classList.toggle('hidden', !visible);
    footer.classList.toggle('flex', visible);
    // מוני התיקיות מגיעים מהשרת בבקשה נפרדת, לעתים אחרי שהגלריה כבר צוירה;
    // לכן גם הכיתוב שליד סרגל הכלים מתעדכן כאן ולא רק בציור המלא.
    const imageCounter = document.getElementById('imageCounter');
    if (imageCounter && galleryViewSignature !== null) imageCounter.textContent = galleryCounterLabel(galleryPageItems.length);
    const counter = document.getElementById('galleryLoadMoreCount');
    if (counter) {
        counter.textContent = remaining > 0
            ? `מוצגים ${galleryRenderedCards.length} מתוך ${galleryPageItems.length} פריטים`
            : (cloudHasMore ? `נטענו ${galleryPageItems.length} מתוך ${galleryFolderTotal()} פריטים` : '');
    }
    // „טוען עוד...” מוצג רק בזמן שבקשה לענן פתוחה; עם סיומה אין מה להציג.
    const status = document.getElementById('galleryLoadingStatus');
    if (status) status.classList.toggle('hidden', !loading);
    // שני כפתורים ידניים, לגיבוי לזקיף (ובדפדפן בלי IntersectionObserver):
    // „הצג עוד” מצייר את המנה הבאה מהזיכרון, ו„טען פריטים ישנים יותר” —
    // כשכל מה שנטען כבר מוצג — מושך את העמוד הבא מהענן.
    const renderButton = document.getElementById('galleryRenderMoreBtn');
    if (renderButton) renderButton.classList.toggle('hidden', remaining <= 0);
    const fetchButton = document.getElementById('galleryFetchMoreBtn');
    if (fetchButton) {
        // בזמן הבקשה „טוען עוד...” מחליף אותו.
        fetchButton.classList.toggle('hidden', remaining > 0 || loading || !cloudHasMore);
    }
    if (visible) observeGallerySentinel();
}

// הזקיף נצפה מחדש אחרי כל מנה: observe מדווח על המצב הנוכחי, ולכן אם הוא
// עדיין בטווח (מסך גבוה, צפיפות גבוהה) המנה הבאה מגיעה בלי גלילה נוספת.
// בדפדפן בלי IntersectionObserver הרשת נבנתה כבר במלואה, ונשאר רק הכפתור
// הידני לבקשת תמונות נוספות מהענן.
// הדיווח של IntersectionObserver מגיע באיחור של פריים, ולעתים מתאר מצב
// שכבר אינו קיים — למשל רשת שהייתה ריקה רגע לפני שהמנה הראשונה צוירה, או
// שתי קריאות על אותו מצב. לכן לפני כל מנה המיקום נבדק שוב בפועל, כדי שטעינת
// הדף לא תבנה מנות נוספות (ולא תבקש עמודים מהענן) בלי שהמשתמש גלל.
function gallerySentinelInRange() {
    const sentinel = document.getElementById('gallerySentinel');
    if (!sentinel || typeof sentinel.getBoundingClientRect !== 'function') return true;
    if (typeof sentinel.getClientRects === 'function' && sentinel.getClientRects().length === 0) return false;
    const viewport = window.innerHeight || document.documentElement?.clientHeight || 0;
    return sentinel.getBoundingClientRect().top <= viewport + GALLERY_SENTINEL_RANGE;
}

function observeGallerySentinel() {
    const sentinel = document.getElementById('gallerySentinel');
    if (!sentinel || typeof IntersectionObserver !== 'function') return;
    if (!galleryPageObserver) {
        galleryPageObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting) && gallerySentinelInRange()) window.renderMoreImages();
        }, { rootMargin: GALLERY_SENTINEL_MARGIN });
    }
    galleryPageObserver.unobserve(sentinel);
    galleryPageObserver.observe(sentinel);
}

window.updateGalleryLoadMore = updateGalleryLoadMore;

// הכפתור "טען פריטים ישנים יותר": אותו מסלול שהזקיף עובר כשכל מה שנטען
// כבר מוצג — העמוד הבא מהענן (gallery-feed.js), ומיד אחריו המנה הבאה ממנו.
window.fetchOlderImages = async function() {
    galleryCloudStalledAt = -1;
    const result = await (requestMoreImagesFromCloud() || Promise.resolve({ added: 0, done: true }));
    if (result.done && !result.added) window.showNotification?.('אלה כל הפריטים בתיקייה.', true);
    return result;
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

// Debounced render wrappers — collapse rapid successive calls into one DOM update
(function() {
    let _imgTimer, _folderTimer;
    window.renderImages = function() {
        galleryRenderPending = true;
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

// טביעת התוכן לזיהוי כפילויות. קובץ גדול (סרטון של מאות מגה) אינו נקרא
// כולו לזיכרון: נגזרת טביעה מהגודל ומדגימות בתחילתו, באמצעו ובסופו. הקידומת
// "s1:" מבטיחה שטביעה כזו לעולם אינה שווה לטביעה מלאה של קובץ אחר.
const FULL_FINGERPRINT_MAX_BYTES = 64 * 1024 * 1024;
const FINGERPRINT_SAMPLE_BYTES = 1024 * 1024;

async function createFileFingerprint(file) {
    if (!(file instanceof Blob) || !window.crypto?.subtle) return '';
    const hex = digest => Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
    if (file.size <= FULL_FINGERPRINT_MAX_BYTES) {
        return hex(await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    }
    const middle = Math.floor(file.size / 2);
    const samples = await new Blob([
        String(file.size),
        file.slice(0, FINGERPRINT_SAMPLE_BYTES),
        file.slice(middle, middle + FINGERPRINT_SAMPLE_BYTES),
        file.slice(file.size - FINGERPRINT_SAMPLE_BYTES)
    ]).arrayBuffer();
    return `s1:${hex(await window.crypto.subtle.digest('SHA-256', samples))}`;
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

// --- תור ההעלאה ---
// כל קובץ שנבחר מקבל שורה עם סרגל התקדמות, מצב וכפתור ביטול. אחרי ההכנה
// (טביעה, הקטנת תמונה ענקית, בדיקת כפילויות) הקבצים נכנסים לתור של
// upload-queue.js: שניים במקביל, וכשל זמני (רשת, עומס, שגיאת שרת) מנוסה שוב
// מאליו אחרי השהיה גדלה — 1, 2, 4 שניות. קובץ גדול עולה בחלקים
// (upload-resumable.js) וממשיך מהחלק האחרון גם אחרי ניתוק או רענון.
// המודולים נטענים עצלה, רק כשמישהו באמת מעלה.

// סרטון שעולה בחלקים יכול להגיע עד 1GB (ראו MAX_RESUMABLE_VIDEO_BYTES ב-Worker).
const MAX_VIDEO_UPLOAD_BYTES = 1024 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 2;

let uploadModulesPromise = null;
function loadUploadModules() {
    uploadModulesPromise ||= Promise.all([
        import('./upload-queue.js'),
        import('./upload-resumable.js'),
        import('./upload-compress.js')
    ]).then(([queue, resumable, compress]) => ({ queue, resumable, compress })).catch(error => {
        uploadModulesPromise = null;
        throw error;
    });
    return uploadModulesPromise;
}

// קבצים שהמשתמש ביטל, לפי מיכל התור ומספר השורה — גם לפני שהתור התחיל.
const cancelledUploadRows = new Set();
let activeUploadQueue = null;
let activeUploadContainer = '';
// מזהה פריט בתור → { containerId, index, resumeKey }.
const uploadQueueRows = new Map();

function uploadRowKey(containerId, index) {
    return `${containerId}:${index}`;
}

function formatFileSize(size) {
    return size >= 1024 * 1024 * 1024
        ? `${(size / (1024 * 1024 * 1024)).toFixed(2)}GB`
        : size >= 1024 * 1024
            ? `${(size / (1024 * 1024)).toFixed(1)}MB`
            : `${Math.max(1, Math.round(size / 1024))}KB`;
}

window.renderSelectedUploadQueue = function(inputIds, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const files = (inputIds || []).flatMap(id => Array.from(document.getElementById(id)?.files || [])).filter(isSupportedMediaFile);
    container.replaceChildren();
    container.classList.toggle('hidden', files.length === 0);
    for (const key of [...cancelledUploadRows]) if (key.startsWith(`${containerId}:`)) cancelledUploadRows.delete(key);
    files.forEach((file, index) => {
        const displayName = file.webkitRelativePath || file.name;
        const row = document.createElement('div');
        row.dataset.uploadIndex = String(index);
        row.dataset.uploadState = 'queued';
        row.className = 'upload-queue-row flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2';
        const icon = document.createElement('span');
        icon.className = 'upload-queue-icon text-amber-400';
        icon.innerHTML = `<i data-lucide="${isSupportedVideoFile(file) ? 'video' : 'image'}" class="w-3.5 h-3.5"></i>`;
        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[10px] font-bold text-slate-200 truncate';
        name.textContent = displayName;
        const size = document.createElement('p');
        size.className = 'upload-queue-size text-[8px] text-slate-500';
        size.textContent = formatFileSize(file.size);
        // האחוז מוצג לעין בלבד: הקוראים שומעים את המצב (aria-live של התור)
        // ואת ערך סרגל ההתקדמות, בלי הכרזה על כל אחוז.
        const percent = document.createElement('span');
        percent.className = 'upload-queue-percent';
        percent.setAttribute('aria-hidden', 'true');
        size.appendChild(percent);
        const track = document.createElement('div');
        track.className = 'upload-queue-progress';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', '0');
        track.setAttribute('aria-label', `התקדמות ההעלאה של ${displayName}`);
        const bar = document.createElement('span');
        bar.className = 'upload-queue-progress-bar';
        track.appendChild(bar);
        body.append(name, size, track);
        const status = document.createElement('span');
        status.className = 'upload-queue-status text-[9px] text-slate-400';
        status.textContent = 'ממתין';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'upload-queue-cancel';
        cancel.setAttribute('aria-label', `ביטול ההעלאה של ${displayName}`);
        cancel.title = 'ביטול';
        cancel.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5"></i>';
        cancel.addEventListener('click', () => window.cancelUploadItem(containerId, index));
        row.append(icon, body, status, cancel);
        container.appendChild(row);
    });
    updateUploadSummary(null);
    window.scheduleIconRefresh();
    markResumableRows(files, containerId).catch(() => {});
};

// כבר בבחירה: קובץ שיש לו העלאה שנקטעה (למשל לפני רענון) מסומן "ימשיך",
// עם הסרגל במקום שבו נעצר — כך ברור שלא יתחיל מאפס.
async function markResumableRows(files, containerId) {
    if (!files.some(file => file.size > 8 * 1024 * 1024)) return;
    const { resumable } = await loadUploadModules();
    const scope = uploadScope();
    for (const [index, file] of files.entries()) {
        if (!resumable.shouldUseResumableUpload(file.size)) continue;
        const fingerprint = await resumable.fingerprintFile(file, scope);
        const candidates = isSupportedVideoFile(file) ? [fingerprint] : [`${fingerprint}:c`, `${fingerprint}:o`];
        for (const key of candidates) {
            const saved = await resumable.findSavedUpload(key);
            if (!saved) continue;
            const row = document.querySelector(`#${containerId} [data-upload-index="${index}"]`);
            if (row?.dataset.uploadState === 'queued') updateUploadQueueItem(containerId, index, 'queued', 'ימשיך מהנקודה שנעצר', resumableProgress(saved));
            break;
        }
    }
}

const UPLOAD_STATE_TEXT_CLASS = {
    success: 'text-emerald-300',
    error: 'text-red-300',
    active: 'text-cyan-300',
    waiting: 'text-amber-300',
    cancelled: 'text-slate-500'
};
const UPLOAD_STATE_ICON = {
    success: 'circle-check',
    error: 'circle-x',
    active: 'loader-circle',
    waiting: 'timer',
    cancelled: 'ban'
};

// progress: 0..1 לסרגל של השורה; בלי ערך — הסרגל נשאר כפי שהיה.
function updateUploadQueueItem(containerId, index, state, label, progress) {
    const row = document.querySelector(`#${containerId} [data-upload-index="${index}"]`);
    if (!row) return;
    const status = row.querySelector('.upload-queue-status');
    const icon = row.querySelector('.upload-queue-icon');
    const previousState = row.dataset.uploadState;
    row.dataset.uploadState = state;
    if (status) {
        if (status.textContent !== label) status.textContent = label;
        status.className = `upload-queue-status text-[9px] ${UPLOAD_STATE_TEXT_CLASS[state] || 'text-slate-400'}`;
    }
    const value = state === 'success' ? 1 : progress;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
        const track = row.querySelector('.upload-queue-progress');
        if (track) {
            track.setAttribute('aria-valuenow', String(percent));
            track.style.setProperty('--upload-progress', `${percent}%`);
        }
        const percentLabel = row.querySelector('.upload-queue-percent');
        if (percentLabel) percentLabel.textContent = state === 'active' || (percent > 0 && percent < 100) ? ` · ${percent}%` : '';
    }
    const cancel = row.querySelector('.upload-queue-cancel');
    if (cancel) cancel.hidden = ['success', 'cancelled', 'error'].includes(state);
    // הסמל מתעדכן רק כשהמצב משתנה — לא בכל דיווח התקדמות.
    if (icon && previousState !== state) {
        icon.className = `upload-queue-icon ${UPLOAD_STATE_TEXT_CLASS[state] || 'text-amber-400'}`;
        icon.innerHTML = `<i data-lucide="${UPLOAD_STATE_ICON[state] || 'image'}" class="w-3.5 h-3.5 ${state === 'active' ? 'animate-spin' : ''}"></i>`;
        window.scheduleIconRefresh();
    }
}

// שורת הסיכום שמעל התור והסרגל הכולל. summary=null מאפס אותם.
function updateUploadSummary(summary, text = '') {
    const box = document.getElementById('userUploadSummary');
    const label = document.getElementById('userUploadSummaryText');
    const track = document.getElementById('userUploadOverall');
    if (!box) return;
    if (!summary) {
        box.classList.add('hidden');
        if (label) label.textContent = '';
        if (track) {
            track.setAttribute('aria-valuenow', '0');
            track.style.setProperty('--upload-progress', '0%');
        }
        return;
    }
    box.classList.remove('hidden');
    if (label && label.textContent !== text) label.textContent = text;
    if (track) {
        const percent = Math.round(Math.max(0, Math.min(1, summary.progress || 0)) * 100);
        track.setAttribute('aria-valuenow', String(percent));
        track.style.setProperty('--upload-progress', `${percent}%`);
    }
}

// ביטול קובץ אחד: לפני ההעלאה הוא פשוט מדולג; באמצע — הבקשה נקטעת, והעלאה
// בחלקים מבוטלת גם ב-Worker כדי שלא יישארו חלקים יתומים.
window.cancelUploadItem = function(containerId, index) {
    const key = uploadRowKey(containerId, index);
    cancelledUploadRows.add(key);
    let handled = false;
    for (const [itemId, row] of uploadQueueRows) {
        if (row.containerId !== containerId || row.index !== index) continue;
        handled = activeUploadQueue?.cancel(itemId) || handled;
        if (row.resumeKey) window.abortResumableUpload?.(row.resumeKey).catch?.(() => {});
    }
    if (!handled) updateUploadQueueItem(containerId, index, 'cancelled', 'בוטל');
};

let uploadPaused = false;

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
    if (uploadPaused && text) text.textContent = 'תור ההעלאה מושהה. הקבצים שכבר בדרך יסתיימו בבטחה.';
};

function failedUploadCount() {
    return activeUploadQueue ? activeUploadQueue.summary().error : 0;
}

function updateUploadControlButtons(running = false) {
    const pause = document.getElementById('userUploadPauseBtn');
    const retry = document.getElementById('userUploadRetryBtn');
    if (pause) pause.classList.toggle('hidden', !running);
    if (retry) retry.classList.toggle('hidden', running || failedUploadCount() === 0);
}

const UPLOAD_STATE_LABELS = { queued: 'בתור', success: 'הושלם', cancelled: 'בוטל' };

function uploadItemLabel(item, mode) {
    if (item.state === 'active') {
        const verb = mode === 'pending' ? 'שולח' : 'מעלה';
        return `${verb}${item.attempts > 1 ? ` · ניסיון ${item.attempts}` : ''}`;
    }
    if (item.state === 'waiting') {
        const seconds = Math.max(1, Math.ceil((item.nextRetryAt - Date.now()) / 1000));
        return `ניסיון חוזר בעוד ${seconds} שנ׳`;
    }
    if (item.state === 'error') return 'נכשל — נסה שוב';
    return UPLOAD_STATE_LABELS[item.state] || 'ממתין';
}

// מריץ את התור על הרשומות שהוכנו. mode: 'direct' (גלריה) או 'pending' (לאישור).
async function runUploadQueue(records, { containerId, mode }) {
    const { queue: queueModule } = await loadUploadModules();
    const text = document.getElementById(containerId === 'adminUploadQueue' ? 'adminUploadProgressText' : 'userUploadProgressText');
    uploadQueueRows.clear();
    activeUploadContainer = containerId;
    activeUploadQueue = queueModule.createUploadQueue({
        concurrency: UPLOAD_CONCURRENCY,
        waitWhilePaused: waitWhileUploadPaused,
        run: async (record, { signal, onProgress }) => {
            const options = { signal, onProgress, resumeKey: record._resumeKey || '' };
            if (mode === 'pending') await window.savePendingImageCloud(record, options);
            else await window.saveImageToCloud(record, options);
            return true;
        },
        onChange: (item, summary) => {
            const row = uploadQueueRows.get(item.id);
            if (row) updateUploadQueueItem(row.containerId, row.index, item.state, uploadItemLabel(item, mode), item.progress);
            const summaryText = queueModule.formatUploadSummary(summary);
            updateUploadSummary(summary, summaryText);
            if (text && !uploadPaused) text.textContent = summaryText;
            if (item.state === 'error' && item.error) {
                console.warn('Single upload failed:', item.error);
                window.reportClientError?.(item.error, 'upload');
            }
        }
    });
    for (const record of records) {
        const { uploadQueueIndex, ...imageRecord } = record;
        const [item] = activeUploadQueue.add({
            id: imageRecord.id,
            payload: imageRecord,
            size: Number(imageRecord.sourceFile?.size) || Number(imageRecord.originalSize) || 0
        });
        uploadQueueRows.set(item.id, { containerId, index: uploadQueueIndex, resumeKey: imageRecord._resumeKey || '' });
        // קובץ שבוטל בזמן ההכנה אינו עולה.
        if (cancelledUploadRows.has(uploadRowKey(containerId, uploadQueueIndex))) activeUploadQueue.cancel(item.id);
    }
    return activeUploadQueue.start();
}

window.retryFailedUploads = async function() {
    if (!activeUploadQueue || failedUploadCount() === 0) return;
    uploadPaused = false;
    activeUploadQueue.retryFailed();
    updateUploadControlButtons(true);
    window.markSiteBusy?.('upload');
    const progress = document.getElementById('userUploadProgress');
    progress?.classList.remove('hidden');
    try {
        const summary = await activeUploadQueue.start();
        window.showNotification(summary.error ? `${summary.error} קבצים עדיין לא הועלו.` : 'כל הקבצים הועלו בהצלחה.', summary.error === 0);
    } finally {
        progress?.classList.add('hidden');
        updateUploadControlButtons(false);
        window.clearSiteBusy?.('upload');
    }
};

function canSendOriginalUploads() {
    return Boolean(window.state.isAdminLoggedIn || ['admin', 'super_admin'].includes(window.state.userRole));
}

function uploadScope() {
    return window.state.currentUser?.uid || '';
}

// בפתיחת חלון ההעלאה: מתג "שלח את המקור" מוצג למנהלים בלבד, ותזכורת
// להעלאות שנקטעו (אחרי רענון) — בחירה מחודשת של אותו קובץ ממשיכה אותן.
window.prepareUploadModal = async function() {
    const toggle = document.getElementById('userUploadOriginalToggle');
    const allowed = canSendOriginalUploads();
    if (toggle) toggle.classList.toggle('hidden', !allowed);
    const checkbox = document.getElementById('userUploadSendOriginal');
    if (checkbox && !allowed) checkbox.checked = false;
    const hint = document.getElementById('userUploadResumeHint');
    if (!hint) return;
    try {
        const { resumable } = await loadUploadModules();
        const saved = await resumable.listSavedUploads({ scope: uploadScope() });
        if (!saved.length) {
            hint.classList.add('hidden');
            hint.textContent = '';
            return;
        }
        const names = saved.slice(0, 3).map(item => item.name || 'קובץ').join(', ');
        hint.textContent = `${saved.length === 1 ? 'העלאה אחת לא הושלמה' : `${saved.length} העלאות לא הושלמו`}: ${names}${saved.length > 3 ? ' ועוד' : ''}. בחרו שוב את אותם קבצים, וההעלאה תמשיך מהמקום שבו נעצרה.`;
        hint.classList.remove('hidden');
    } catch (error) {
        hint.classList.add('hidden');
    }
};

async function processFilesWithFolders(files, targetFolderId = 'auto', isAdmin = false, options = {}) {
    const newImages = []; let processedCount = 0;
    const fallbackFolderId = window.safeRecordId(
        window.state.folders.find(folder => window.safeRecordId(folder.id) === '4')?.id
        || window.state.folders.find(folder => window.safeRecordId(folder.id) !== 'all')?.id
    );
    if (!fallbackFolderId) throw new Error('יש ליצור לפחות תיקיית יעד אחת לפני העלאת קבצים.');
    const progressEl = document.getElementById(isAdmin ? 'adminUploadProgressText' : 'userUploadProgressText');
    const queueId = isAdmin ? 'adminUploadQueue' : 'userUploadQueue';
    const { resumable, compress } = await loadUploadModules();
    const scope = uploadScope();
    // העלאה שמורה מריצה קודמת: אותו מזהה מדיה, כדי שה-Worker ימשיך את אותו קובץ.
    const resumeFor = async (blob, key) => {
        if (!resumable.shouldUseResumableUpload(blob.size)) return { resumeKey: '', saved: null };
        const resumeKey = key || await resumable.fingerprintFile(blob, scope);
        return { resumeKey, saved: await resumable.findSavedUpload(resumeKey) };
    };
    for (let i = 0; i < files.length; i++) {
        await waitWhileUploadPaused();
        const file = files[i]; let destFolderId = targetFolderId === 'auto' ? null : targetFolderId; let folderName = "כללי";
        if (cancelledUploadRows.has(uploadRowKey(queueId, i))) {
            processedCount++;
            continue;
        }
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
        const readyLabel = saved => (saved ? 'ימשיך מהנקודה שנעצר' : 'מוכן');
        // תאריך הצילום נקרא מהקובץ המקורי: תמונה עוברת אחר כך הקטנה ב-Canvas,
        // שמוחקת את ה-EXIF, ולכן זה הרגע היחיד שבו הוא זמין.
        const captureFields = isVideo && file.size > MAX_VIDEO_UPLOAD_BYTES
            ? {}
            : (await window.readUploadCaptureFields?.(file)) || {};
        if (isVideo && file.size > MAX_VIDEO_UPLOAD_BYTES) {
            updateUploadQueueItem(queueId, i, 'error', 'מעל 1GB');
        } else if (isVideo) {
            const videoMimeType = file.type || (/\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4');
            const videoFile = file.type ? file : new File([file], file.name, { type: videoMimeType, lastModified: file.lastModified });
            // הטביעה מהקובץ כפי שנבחר, כדי שתתאים לסימון "ימשיך" שבבחירה.
            const { resumeKey, saved } = await resumeFor(videoFile, resumable.shouldUseResumableUpload(file.size)
                ? await resumable.fingerprintFile(file, scope)
                : '');
            const videoInfo = await inspectVideoFile(videoFile);
            newImages.push({
                uploadQueueIndex: i,
                id: saved?.imageId || `img_${crypto.randomUUID()}`,
                folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: '',
                sourceFile: videoFile, mediaType: 'video', mimeType: videoMimeType,
                duration: videoInfo.duration,
                thumbnailDataUrl: videoInfo.thumbnailDataUrl,
                contentHash, originalSize: file.size,
                ...(resumeKey ? { _resumeKey: resumeKey } : {}),
                date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName,
                ...captureFields
            });
            updateUploadQueueItem(queueId, i, 'ready', readyLabel(saved), saved ? resumableProgress(saved) : 0);
        } else {
            // תמונה ענקית מוקטנת ל-3840 פיקסלים ומקודדת מחדש (upload-compress.js);
            // מנהל שבחר "שלח את המקור" מעלה את הקובץ כמות שהוא.
            const prepared = await compress.prepareImageForUpload(file, { sendOriginal: Boolean(options.sendOriginal) });
            const blob = prepared.blob;
            const mimeType = String(blob.type || file.type || 'image/jpeg').toLowerCase();
            const uploadFile = prepared.compressed
                ? new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${mimeType === 'image/webp' ? 'webp' : 'jpg'}`, { type: mimeType, lastModified: file.lastModified })
                : file;
            const { resumeKey, saved } = await resumeFor(uploadFile, resumable.shouldUseResumableUpload(uploadFile.size)
                ? `${await resumable.fingerprintFile(file, scope)}:${prepared.compressed ? 'c' : 'o'}`
                : '');
            newImages.push({
                uploadQueueIndex: i,
                id: saved?.imageId || `img_${crypto.randomUUID()}`,
                folderId: destFolderId || fallbackFolderId, title: file.name.replace(/\.[^.]+$/, ''), url: '',
                sourceFile: uploadFile, mediaType: 'image', mimeType,
                contentHash, originalSize: file.size,
                ...(prepared.compressed ? { uploadedSize: uploadFile.size } : {}),
                ...(prepared.width && prepared.height ? { width: prepared.width, height: prepared.height } : {}),
                ...(prepared.captureDate ? { capturedAt: prepared.captureDate } : {}),
                ...(resumeKey ? { _resumeKey: resumeKey } : {}),
                date: new Date().toISOString().split('T')[0], createdAt: Date.now(), originalFolderName: folderName,
                ...captureFields
            });
            const sizeLabel = document.querySelector(`#${queueId} [data-upload-index="${i}"] .upload-queue-size`);
            if (sizeLabel && prepared.compressed) sizeLabel.textContent = `${formatFileSize(file.size)} ← ${formatFileSize(uploadFile.size)}`;
            updateUploadQueueItem(queueId, i, 'ready', readyLabel(saved), saved ? resumableProgress(saved) : 0);
        }
        processedCount++;
        if (progressEl) progressEl.innerText = `מעבד: ${Math.round((processedCount / files.length) * 100)}%`;
    }
    return newImages;
}

// כמה מהקובץ כבר עלה לפי המצב השמור בדפדפן (לפני שה-Worker אישר את הפרטים).
function resumableProgress(saved) {
    const size = Number(saved?.size) || 0;
    const partSize = Number(saved?.partSize) || 0;
    if (!size || !partSize) return 0;
    const parts = Array.isArray(saved.completedParts) ? saved.completedParts.length : 0;
    return Math.min(1, (parts * partSize) / size);
}

// אחרי שהתור סיים: הודעה, יומן פעילות, ניקוי הבחירה.
async function reportUploadSummary(summary, { mode, canUploadDirectly, admin = false }) {
    const uploadedCount = summary.success;
    const failedCount = summary.error;
    const cancelledCount = summary.cancelled;
    if (!uploadedCount && !cancelledCount) throw new Error('העלאת הקבצים נכשלה. ניתן לנסות שוב.');
    if (uploadedCount) {
        await window.logActivity('uploaded_images', 'media', '', `${uploadedCount} קבצים`, admin
            ? (failedCount ? `${failedCount} נכשלו` : 'העלאה דרך לוח הניהול')
            : `${canUploadDirectly ? 'העלאה ישירה' : 'נשלחו לאישור'}${failedCount ? `; ${failedCount} נכשלו` : ''}`);
    }
    const tail = `${failedCount ? `; ${failedCount} נכשלו וניתן לנסות שוב` : ''}${cancelledCount ? `; ${cancelledCount} בוטלו` : ''}`;
    if (!uploadedCount) {
        window.showNotification(`לא הועלו קבצים${tail}.`, failedCount === 0);
        return;
    }
    window.showNotification(admin
        ? `הועלו ${uploadedCount} קבצים לגלריה${tail}.`
        : (mode === 'pending'
            ? `${uploadedCount} קבצים נשלחו לאישור מנהל${tail}.`
            : `${uploadedCount} קבצים הועלו בהצלחה לגלריה${tail}!`), failedCount === 0);
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
    window.markSiteBusy?.('upload');

    try {
        uploadPaused = false;
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, true);
        if (newImages.length === 0) throw new Error('לא נמצאו קובצי מדיה תקינים.');
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        const summary = await runUploadQueue(uploadRecords, { containerId: 'adminUploadQueue', mode: 'direct' });
        await reportUploadSummary(summary, { mode: 'direct', canUploadDirectly: true, admin: true });
        if (!summary.error) {
            if(filesInput) filesInput.value = '';
            if(folderInput) folderInput.value = '';
        }
    } catch (error) {
        console.error('Admin upload failed:', error);
        window.reportClientError?.(error, 'upload');
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
        window.clearSiteBusy?.('upload');
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
    // גרסה חדשה של האתר לא תרענן את הדף באמצע ההעלאה.
    window.markSiteBusy?.('upload');
    // חלון האישור נסגר מיד: התור — עם הסרגלים וכפתורי הביטול — הוא מה שצריך לראות.
    window.closeModal?.('confirmModal');

    const progressContainer = document.getElementById('userUploadProgress');
    if(progressContainer) progressContainer.classList.remove('hidden');
    const pText = document.getElementById('userUploadProgressText');
    const sendOriginal = canSendOriginalUploads() && Boolean(document.getElementById('userUploadSendOriginal')?.checked);
    const mode = canUploadDirectly ? 'direct' : 'pending';

    try {
        uploadPaused = false;
        activeUploadQueue = null;
        updateUploadControlButtons(true);
        if(pText) pText.innerText = 'מכין את הקבצים להעלאה...';
        const newImages = await processFilesWithFolders(allFiles, targetFolderId, false, { sendOriginal });
        if (newImages.length === 0) {
            if ([...cancelledUploadRows].some(key => key.startsWith('userUploadQueue:'))) {
                window.showNotification('כל הקבצים בוטלו.', true);
                return;
            }
            throw new Error('לא נמצאו קובצי מדיה תקינים.');
        }
        const uploadRecords = await resolveDuplicateMedia(newImages);
        if (uploadRecords.length === 0) {
            window.showNotification('ההעלאה בוטלה או שכל הקבצים הכפולים דולגו.', true);
            return;
        }
        const summary = await runUploadQueue(uploadRecords, { containerId: 'userUploadQueue', mode });
        await reportUploadSummary(summary, { mode, canUploadDirectly });
        if (!summary.error) {
            if(filesInput) filesInput.value = '';
            if(folderInput) folderInput.value = '';
        }
        if (!summary.error && summary.success) window.closeModal('userUploadModal');
    } catch (error) {
        console.error('User upload failed:', error);
        window.reportClientError?.(error, 'upload');
        window.showNotification(error.message || 'העלאת התמונות נכשלה. נסה שוב.', false);
    } finally {
        if(progressContainer) progressContainer.classList.add('hidden');
        if(btn) btn.disabled = false;
        updateUploadControlButtons(false);
        window.clearSiteBusy?.('upload');
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
    const mediaCount = window.state.folderCounts
        ? (Number(window.state.folderCounts[folderId]) || 0)
        : window.state.images.filter(item => window.safeRecordId(item.folderId) === folderId).length;
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

// מחברים את המחוות ואת המצגת בפתיחה הראשונה של התצוגה המלאה.
let lightboxInteractionsReady = false;
function ensureLightboxInteractions() {
    if (lightboxInteractionsReady) return;
    lightboxInteractionsReady = true;
    const currentItem = () => currentFilteredImages[window.state.currentLightboxIndex];
    initLightboxGestures({
        navigate: step => navigateLightbox(step),
        close: () => window.closeLightbox(),
        atStart: () => window.state.currentLightboxIndex <= 0,
        atEnd: () => window.state.currentLightboxIndex >= currentFilteredImages.length - 1,
        // הזום מחליף לקובץ המקורי ברזולוציה מלאה, לא לתצוגה הבינונית.
        getOriginalUrl: () => {
            const item = currentItem();
            return item && !window.isVideoRecord(item) ? window.safeImageUrl(item.url) : '';
        },
        canZoom: () => !isSlideshowActive() && !window.isVideoRecord(currentItem()),
        canSwipe: () => true
    });
    initLightboxSlideshow({
        getItems: () => currentFilteredImages,
        getIndex: () => window.state.currentLightboxIndex,
        showIndex: index => showLightboxIndex(index),
        isVideo: item => window.isVideoRecord(item),
        notify: (text, ok) => window.showNotification(text, ok)
    });
}

function openLightbox(imageId) {
    imageId = window.safeRecordId(imageId);
    currentFilteredImages = getFilteredSortedImages();
    window.state.currentLightboxIndex = currentFilteredImages.findIndex(img => window.safeRecordId(img.id) === imageId);
    if (window.state.currentLightboxIndex === -1) return;
    ensureLightboxInteractions();
    window.recordMediaView(imageId);
    // בפתיחה אין תמונה קודמת שכדאי להשאיר על המסך: הפריט מוצג מיד.
    updateLightbox(true); window.openModal('lightboxModal');
}

function showLightboxIndex(index) {
    if (currentFilteredImages.length === 0) return;
    const activeVideo = document.getElementById('lightboxVideo');
    if (activeVideo) activeVideo.pause();
    window.state.currentLightboxIndex = (index + currentFilteredImages.length) % currentFilteredImages.length;
    updateLightbox();
}

function navigateLightbox(step) {
    if (currentFilteredImages.length === 0) return;
    showLightboxIndex(window.state.currentLightboxIndex + step);
    // במצגת: מעבר ידני נותן לשקופית החדשה זמן מלא.
    slideshowNoteNavigation();
}

// נקרא גם מ-closeModal (Escape הכללי) וגם מכפתור הסגירה.
window.onLightboxClosed = function() {
    stopSlideshow({ silent: true });
    resetLightboxZoom();
};

window.closeLightbox = function() {
    window.onLightboxClosed();
    const activeVideo = document.getElementById('lightboxVideo');
    releaseLightboxStream();
    if (activeVideo) {
        activeVideo.pause();
        activeVideo.removeAttribute('src');
        activeVideo.load();
    }
    window.closeModal('lightboxModal');
};

// --- ניגון הסרטון בתצוגה המלאה ---
// סרטון שנשלח ל-Cloudflare Stream (שדה stream ברשומה) מנוגן ב-HLS דרך
// stream-player.js, שנטען רק כשבאמת יש סרטון כזה. בלי stream — המקור ב-R2,
// כמו תמיד; וכל תקלה ב-HLS נופלת אליו.
let lightboxStreamRelease = null;
let lightboxStreamRequest = 0;

function releaseLightboxStream() {
    lightboxStreamRequest += 1;
    const video = document.getElementById('lightboxVideo');
    if (video) delete video.dataset.streamFor;
    const release = lightboxStreamRelease;
    lightboxStreamRelease = null;
    if (release) {
        try { release(); } catch (error) { /* כבר נוקה */ }
    }
}

function playLightboxVideo(video, record, fallbackUrl) {
    const hasStream = Boolean(record?.stream?.hls);
    if (!hasStream) {
        releaseLightboxStream();
        if (video.src !== fallbackUrl) {
            video.src = fallbackUrl;
            video.load();
        }
        return;
    }
    const mediaId = window.safeRecordId(record.id);
    if (video.dataset.streamFor === mediaId && lightboxStreamRelease) return;
    releaseLightboxStream();
    const request = lightboxStreamRequest;
    video.dataset.streamFor = mediaId;
    import('./stream-player.js')
        .then(({ attachVideoPlayback }) => attachVideoPlayback(video, { record, fallbackUrl }))
        .then(release => {
            if (request !== lightboxStreamRequest) release();
            else lightboxStreamRelease = release;
        })
        .catch(() => {
            if (request !== lightboxStreamRequest) return;
            delete video.dataset.streamFor;
            if (video.src !== fallbackUrl) {
                video.src = fallbackUrl;
                video.load();
            }
        });
}

// כפתור "הפעל מצגת" שבסרגל התצוגה המלאה: מפעיל, ובזמן מצגת — עוצר.
window.toggleGallerySlideshow = function() {
    ensureLightboxInteractions();
    if (isSlideshowActive()) stopSlideshow();
    else startSlideshow();
};

// "הפעל מצגת" בסרגל הגלריה ובדף האירוע: התיקייה המוצגת, מהפריט הראשון.
window.startGallerySlideshow = function() {
    const items = getFilteredSortedImages();
    if (!items.length) {
        window.showNotification('אין פריטים להצגת מצגת.', false);
        return;
    }
    openLightbox(items[0].id);
    if (!isSlideshowActive()) startSlideshow();
};

// --- טעינה מוקדמת ופענוח בתצוגה המלאה ---
// לכל היותר ארבע טעינות מוקדמות נשמרות בו־זמנית; הישנה שבהן נזנחת, ואם
// טרם הסתיימה — ההורדה שלה מבוטלת.
const LIGHTBOX_PRELOAD_LIMIT = 4;
// רשת איטית אינה משאירה את המשתמש על התמונה הקודמת לנצח: אחרי ההמתנה הזו
// התמונה הבאה מוצגת גם אם טרם פוענחה.
const LIGHTBOX_DECODE_TIMEOUT_MS = 6000;
const lightboxPreloads = new Map();
// מונה שמזהה את הבקשה האחרונה להצגת תמונה: דפדוף מהיר משאיר רק את האחרונה.
let lightboxImageRequest = 0;

// מה התצוגה המלאה מציגה עבור פריט — אותו מקור בדיוק, כדי שהטעינה המוקדמת
// תביא את הקובץ שיוצג ולא קובץ אחר: לתמונה התצוגה הבינונית עם srcset (ועותק
// AVIF כשיש), ולסרטון רק הפוסטר.
function lightboxPreviewSource(item) {
    if (!item) return { url: '', srcset: '', avifSrcset: '', sizes: '', fallbackUrl: '' };
    if (window.isVideoRecord(item)) {
        return { url: pickPosterSource(item, window.safeImageUrl), srcset: '', avifSrcset: '', sizes: '', fallbackUrl: '' };
    }
    return pickLightboxSource(item, window.safeImageUrl);
}

function lightboxSourceKey(source) {
    return [source.url, source.srcset, source.sizes, source.avifSrcset].join('\n');
}

// מציב מקור על תמונת התצוגה המלאה (ועל ה-<source> של AVIF שב-<picture>).
function applyLightboxImageSource(lbImage, source) {
    if (source.fallbackUrl) lbImage.dataset.fallbackSrc = source.fallbackUrl;
    else delete lbImage.dataset.fallbackSrc;
    // מקור ה-AVIF שב-<picture> של התצוגה המלאה: בלי srcset הדפדפן מתעלם ממנו.
    const lbAvif = document.getElementById('lightboxImageAvif');
    if (lbAvif) {
        if (source.avifSrcset) {
            lbAvif.srcset = source.avifSrcset;
            if (source.sizes) lbAvif.sizes = source.sizes;
            else lbAvif.removeAttribute('sizes');
        } else {
            lbAvif.removeAttribute('srcset');
            lbAvif.removeAttribute('sizes');
        }
    }
    if (source.srcset) {
        lbImage.srcset = source.srcset;
        lbImage.sizes = source.sizes;
    } else {
        lbImage.removeAttribute('sizes');
        // srcset מפורש ב-1x ולא הסרה בלבד: אחרי תמונה עם srcset של רוחבים
        // Chromium שומר את צפיפות הפיקסלים הקודמת, והתמונה הייתה מוצגת
        // בממדים שגויים.
        if (source.url) lbImage.srcset = `${source.url} 1x`;
        else lbImage.removeAttribute('srcset');
    }
    lbImage.src = source.url;
}

function dataSaverEnabled() {
    return typeof navigator !== 'undefined' && navigator?.connection?.saveData === true;
}

// הטוען הוא <img> מנותק עם אותם srcset ו-sizes, כך שהדפדפן בוחר את אותו
// קובץ שיבחר בתצוגה המלאה. כשיש עותק AVIF הוא יושב בתוך <picture> מנותק עם
// <source type="image/avif">, ודפדפן שמפענח AVIF טוען אותו בדיוק כמו בתצוגה.
function createLightboxLoader(source) {
    let loader;
    if (source.avifSrcset && typeof document.createElement === 'function') {
        const picture = document.createElement('picture');
        const avif = document.createElement('source');
        avif.type = 'image/avif';
        avif.srcset = source.avifSrcset;
        if (source.sizes) avif.sizes = source.sizes;
        picture.appendChild(avif);
        loader = document.createElement('img');
        picture.appendChild(loader);
    } else {
        loader = new Image();
    }
    loader.decoding = 'async';
    if (source.srcset) {
        loader.sizes = source.sizes;
        loader.srcset = source.srcset;
    }
    loader.src = source.url;
    return loader;
}

function startLightboxImageLoad(source) {
    const key = lightboxSourceKey(source);
    const existing = lightboxPreloads.get(key);
    if (existing) return existing;
    while (lightboxPreloads.size >= LIGHTBOX_PRELOAD_LIMIT) {
        const [oldestKey, oldest] = lightboxPreloads.entries().next().value;
        lightboxPreloads.delete(oldestKey);
        if (!oldest.complete) {
            oldest.removeAttribute?.('srcset');
            oldest.src = '';
        }
    }
    const loader = createLightboxLoader(source);
    lightboxPreloads.set(key, loader);
    return loader;
}

// השכנים של הפריט הנוכחי — הבא והקודם — נטענים מראש כדי שהדפדוף יהיה
// מיידי. לסרטון נטען הפוסטר בלבד, לעולם לא קובץ הווידאו, ובמצב חיסכון
// בנתונים אין טעינה מוקדמת כלל.
function preloadLightboxNeighbours() {
    if (typeof Image !== 'function' || dataSaverEnabled()) return;
    const total = currentFilteredImages.length;
    if (total < 2) return;
    const current = window.state.currentLightboxIndex;
    for (const step of [1, -1]) {
        const source = lightboxPreviewSource(currentFilteredImages[(current + step + total) % total]);
        if (source.url) startLightboxImageLoad(source);
    }
}

// מבטיחה שהתמונה הורדה ופוענחה לפני שהיא מוצגת. ממתינה לכל היותר זמן קצוב,
// ובדפדפן בלי decode() מסתפקת בטעינה.
function loadDecodedImage(source) {
    if (typeof Image !== 'function') return Promise.resolve();
    const loader = startLightboxImageLoad(source);
    const loaded = new Promise((resolve, reject) => {
        if (loader.complete) {
            if (loader.naturalWidth > 0) resolve(); else reject(new Error('image failed'));
            return;
        }
        loader.addEventListener('load', () => resolve(), { once: true });
        loader.addEventListener('error', () => reject(new Error('image failed')), { once: true });
    });
    const decoded = loaded.then(() => (typeof loader.decode === 'function' ? loader.decode().catch(() => {}) : undefined));
    let timer = null;
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, LIGHTBOX_DECODE_TIMEOUT_MS); });
    return Promise.race([decoded, timeout]).finally(() => clearTimeout(timer));
}

function updateLightbox(immediate = false) {
    const img = currentFilteredImages[window.state.currentLightboxIndex]; if (!img) return;
    // כל מעבר פריט מתחיל ב-1x, על התצוגה הבינונית.
    resetLightboxZoom();
    const f = window.state.folders.find(fold => fold.id === img.folderId);

    const lbImage = document.getElementById('lightboxImage');
    const lbVideo = document.getElementById('lightboxVideo');
    const lbStage = document.getElementById('lightboxStage');
    const imageUrl = window.safeImageUrl(img.url);
    const isVideo = window.isVideoRecord(img);
    // ההשתקפות ברקע: התצוגה הקטנה ביותר שקיימת (היא ממילא מטושטשת), ואם אין —
    // התמונה עצמה או תמונת הפוסטר של סרטון. בלי אחת מהן הרקע נשאר כהה ואחיד.
    // לתמונה היא מתחלפת יחד איתה, לא לפניה.
    const lbBackdrop = document.getElementById('lightboxBackdrop');
    const backdropUrl = pickBackdropSource(img, window.safeImageUrl);
    const setBackdrop = () => {
        if (!lbBackdrop) return;
        lbBackdrop.hidden = !backdropUrl;
        if (backdropUrl && lbBackdrop.src !== backdropUrl) lbBackdrop.src = backdropUrl;
        lbBackdrop.onerror = () => { lbBackdrop.hidden = true; };
    };
    // כל בקשת תצוגה חדשה מבטלת פענוח שעדיין רץ מהקודמת.
    const request = ++lightboxImageRequest;
    if (isVideo) {
        document.getElementById('lightboxImageFallback')?.remove();
        lbStage?.classList.remove('is-loading');
        setBackdrop();
        if (lbImage) lbImage.hidden = true;
        if (lbVideo) {
            lbVideo.classList.remove('hidden');
            const posterUrl = pickPosterSource(img, window.safeImageUrl);
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
            playLightboxVideo(lbVideo, img, imageUrl);
        }
    } else if(lbImage) {
        releaseLightboxStream();
        if (lbVideo) {
            lbVideo.pause();
            lbVideo.removeAttribute('src');
            lbVideo.load();
            lbVideo.classList.add('hidden');
        }
        // medium עם srcset של thumb ו-medium: טלפון מקבל את הקטנה ומסך גדול
        // את הבינונית. ההורדה נשארת על המקור, וכך גם הנפילה אם התצוגה לא נטענת.
        // הטעינה המוקדמת של השכנים בונה בדיוק את אותו מקור (lightboxPreviewSource).
        const source = lightboxPreviewSource(img);
        const show = () => {
            if (request !== lightboxImageRequest) return;
            document.getElementById('lightboxImageFallback')?.remove();
            setBackdrop();
            lbImage.hidden = false;
            lbImage.onerror = () => window.handleImageError(lbImage);
            applyLightboxImageSource(lbImage, source);
            lbStage?.classList.remove('is-loading');
        };
        // התמונה הקודמת נשארת על המסך עד שהבאה פוענחה, ורק אז מתחלפת — בלי
        // הבזק של מסך ריק. בפתיחה, או כשאין תמונה קודמת (ממלא מקום של תמונה
        // שבורה), אין מה להשאיר ומציגים מיד.
        if (immediate || lbImage.hidden || !source.url) {
            show();
        } else {
            lbStage?.classList.add('is-loading');
            loadDecodedImage(source).then(show, show);
        }
    }

    const lbTitle = document.getElementById('lightboxTitle');
    if(lbTitle) lbTitle.innerText = img.title;

    const lbDetails = document.getElementById('lightboxDetails');
    if(lbDetails) lbDetails.innerText = `${isVideo ? `סרטון${formatMediaDuration(img.duration) ? ` (${formatMediaDuration(img.duration)})` : ''}` : 'תמונה'} • ${lightboxDateLabel(img)} • תיקייה: ${f ? f.name : 'כללי'}`;

    const lbDownload = document.getElementById('lightboxDownload');
    if(lbDownload) {
        lbDownload.disabled = !imageUrl;
        lbDownload.setAttribute('aria-disabled', imageUrl ? 'false' : 'true');
        lbDownload.onclick = imageUrl ? () => window.downloadGalleryMedia(img) : null;
    }

    const lbCounter = document.getElementById('lightboxCounter');
    if(lbCounter) lbCounter.innerText = `${window.state.currentLightboxIndex + 1} מתוך ${currentFilteredImages.length}`;
    preloadLightboxNeighbours();
}
document.addEventListener('keydown', e => {
    const lightbox = document.getElementById('lightboxModal');
    if (lightbox && !lightbox.classList.contains('hidden')) {
        // רווח ו-Escape שייכים למצגת כשהיא פועלת (Escape עוצר אותה בלבד).
        if (handleSlideshowKey(e)) return;
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
    if (!Array.isArray(window.state.images) || (window.state.images.length === 0 && !(Number(window.state.imagesTotal) > 0))) {
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
        window.reportClientError?.(error, 'ai-search');
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
    const grid = document.getElementById('photosGrid');
    if (grid) installVideoHoverPreview(grid);
}
