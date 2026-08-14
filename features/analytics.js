// נתוני צפיות: רישום, טעינה והצגה
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { checkSuperAdminPermission } from '../core/permissions.js';
import { escapeHtml, formatBytes, isVideoRecord, safeImageUrl, safeRecordId } from '../core/utils.js';
import { scheduleIconRefresh } from '../ui/icons.js';
import { closeModal } from '../ui/modals.js';

window.recordMediaView = async function(mediaId) {
    const id = safeRecordId(mediaId);
    if (!id || !window.db || !window.state.currentUser || sessionStorage.getItem(`viewed_${id}`)) return;
    sessionStorage.setItem(`viewed_${id}`, '1');
    try {
        const { doc, setDoc, increment } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats', id), {
            id,
            views: increment(1),
            lastViewedAt: Date.now()
        }, { merge: true });
    } catch (error) {
        sessionStorage.removeItem(`viewed_${id}`);
        console.warn('View counter update failed:', error);
    }
};

window.openAnalyticsMedia = function(mediaId) {
    const id = safeRecordId(mediaId);
    if (!id || !(window.state.images || []).some(item => safeRecordId(item.id) === id)) {
        window.showNotification('הפריט הזה כבר אינו קיים בגלריה.', false);
        return;
    }
    closeModal('advancedAnalyticsModal');
    window.openLightbox?.(id);
};

function renderAnalyticsMedia(stats) {
    const container = document.getElementById('advancedAnalyticsTop');
    const count = document.getElementById('advancedAnalyticsMediaCount');
    if (!container) return;

    const ordered = [...stats]
        .sort((first, second) => (Number(second.views) || 0) - (Number(first.views) || 0))
        .slice(0, 30);
    if (count) count.textContent = `${ordered.length} פריטים`;
    container.replaceChildren();

    if (!ordered.length) {
        const empty = document.createElement('p');
        empty.className = 'analytics-media-empty';
        empty.textContent = 'נתוני הצפייה יופיעו כאן לאחר פתיחת תמונות וסרטונים.';
        container.appendChild(empty);
        return;
    }

    const mediaById = new Map((window.state.images || []).map(item => [safeRecordId(item.id), item]));
    const foldersById = new Map((window.state.folders || []).map(folder => [safeRecordId(folder.id), folder]));
    ordered.forEach((entry, index) => {
        const id = safeRecordId(entry.id);
        const media = mediaById.get(id);
        const folder = media ? foldersById.get(safeRecordId(media.folderId)) : null;
        const isVideo = media ? isVideoRecord(media) : false;
        const previewUrl = media ? safeImageUrl(isVideo ? (media.thumbnailUrl || '') : media.url) : '';
        const card = document.createElement(media ? 'button' : 'article');
        if (media) card.type = 'button';
        card.className = `analytics-media-card${media ? '' : ' is-missing'}`;
        if (media) {
            card.onclick = () => window.openAnalyticsMedia(id);
            card.setAttribute('aria-label', `פתיחת ${media.title || 'פריט מדיה'}, ${Number(entry.views) || 0} צפיות`);
        }

        const preview = document.createElement('span');
        preview.className = 'analytics-media-preview';
        if (previewUrl) {
            const image = document.createElement('img');
            image.src = previewUrl;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.onerror = () => {
                image.remove();
                preview.classList.add('has-fallback');
            };
            preview.appendChild(image);
        } else {
            preview.classList.add('has-fallback');
        }
        const rank = document.createElement('span');
        rank.className = 'analytics-media-rank';
        rank.textContent = String(index + 1);
        const typeIcon = document.createElement('span');
        typeIcon.className = 'analytics-media-type';
        typeIcon.innerHTML = `<i data-lucide="${media ? (isVideo ? 'video' : 'image') : 'image-off'}" class="w-4 h-4"></i>`;
        preview.append(rank, typeIcon);

        const details = document.createElement('span');
        details.className = 'analytics-media-details';
        const title = document.createElement('strong');
        title.textContent = media?.title || 'פריט שנמחק מהגלריה';
        const folderName = document.createElement('small');
        folderName.textContent = media
            ? `${isVideo ? 'סרטון' : 'תמונה'} · ${folder?.name || 'ללא תיקייה'}`
            : `מזהה ישן: ${id || 'לא ידוע'}`;
        const lastViewed = document.createElement('small');
        lastViewed.className = 'analytics-media-last-viewed';
        lastViewed.textContent = entry.lastViewedAt
            ? `צפייה אחרונה: ${window.formatDate(entry.lastViewedAt)}`
            : 'אין תאריך צפייה';
        details.append(title, folderName, lastViewed);

        const views = document.createElement('span');
        views.className = 'analytics-media-views';
        const viewsNumber = document.createElement('strong');
        viewsNumber.textContent = String(Number(entry.views) || 0);
        const viewsLabel = document.createElement('small');
        viewsLabel.textContent = 'צפיות';
        views.append(viewsNumber, viewsLabel);
        card.append(preview, details, views);
        container.appendChild(card);
    });
    scheduleIconRefresh(container);
}

window.loadAdvancedAnalytics = async function() {
    if (!checkSuperAdminPermission()) return;
    const cards = document.getElementById('advancedAnalyticsCards');
    const top = document.getElementById('advancedAnalyticsTop');
    if (cards) cards.innerHTML = '<p class="text-xs text-slate-400">טוען…</p>';
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats'));
        const stats = snapshot.docs.map(entry => entry.data());
        const totalViews = stats.reduce((sum, entry) => sum + (Number(entry.views) || 0), 0);
        const videos = (window.state.images || []).filter(isVideoRecord).length;
        const storage = (window.state.images || []).reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        const values = [
            ['פריטי מדיה', window.state.images.length, 'images'],
            ['סרטונים', videos, 'video'],
            ['משתמשים', window.state.allUsers.length, 'users'],
            ['צפיות', totalViews, 'eye'],
            ['תיקיות', window.state.folders.filter(folder => folder.id !== 'all').length, 'folders'],
            ['נפח מקורי', formatBytes(storage), 'hard-drive'],
            ['מועדפים שלך', window.state.favorites.size, 'heart'],
            ['ממתינים לאישור', window.state.pendingImages.length, 'clock']
        ];
        if (cards) cards.innerHTML = values.map(([label, value, icon]) => `<div class="rounded-2xl border border-white/10 bg-white/5 p-4"><i data-lucide="${icon}" class="w-4 h-4 text-amber-300"></i><strong class="block text-2xl text-white mt-3">${escapeHtml(value)}</strong><span class="text-[10px] text-slate-400">${label}</span></div>`).join('');
        renderAnalyticsMedia(stats);
        scheduleIconRefresh();
    } catch (error) {
        if (top) top.textContent = error.message || 'טעינת הנתונים נכשלה.';
    }
};
