// admin-analytics.js — מסך "ניתוח נתונים" בלוח הניהול: כרטיסי הסיכום
// (פריטים, סרטונים, משתמשים, צפיות, נפח) והפריטים הנצפים ביותר (מנהל־על בלבד).
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (safeRecordId, safeImageUrl, isVideoRecord, formatDate,
// formatBytes, escapeHtml, scheduleIconRefresh, canViewSuperAdminData) נקראים
// מ-window בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה העצלה לא ישבור אותם.

import { pickCardSource } from './media-variants.js';

export function openAnalyticsMedia(mediaId) {
    const { safeRecordId } = window;
    const id = safeRecordId(mediaId);
    if (!id || !(window.state.images || []).some(item => safeRecordId(item.id) === id)) {
        window.showNotification('הפריט הזה כבר אינו קיים בגלריה.', false);
        return;
    }
    // התצוגה המלאה היא חלק מהגלריה, ולכן מדף הניהול עוברים אליה שם.
    window.location.assign(`./index.html#media-${encodeURIComponent(id)}`);
}
window.openAnalyticsMedia = openAnalyticsMedia;

export function renderAnalyticsMedia(stats) {
    const { safeRecordId, safeImageUrl, isVideoRecord, formatDate, scheduleIconRefresh } = window;
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
        empty.textContent = 'עדיין לא נרשמו צפיות בפריטי הגלריה.';
        container.appendChild(empty);
        return;
    }

    ordered.forEach((entry, index) => {
        const id = safeRecordId(entry.id || entry.mediaId);
        const media = (window.state.images || []).find(item => safeRecordId(item.id) === id);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'analytics-media-card';
        card.onclick = () => window.openAnalyticsMedia(id);

        const rank = document.createElement('span');
        rank.className = 'analytics-media-rank';
        rank.textContent = String(index + 1);

        const previewUrl = pickCardSource(media || {}, safeImageUrl).url;
        let preview;
        if (previewUrl && !isVideoRecord(media || {})) {
            preview = document.createElement('img');
            preview.className = 'analytics-media-preview';
            preview.loading = 'lazy';
            preview.alt = '';
            preview.src = previewUrl;
        } else {
            preview = document.createElement('span');
            preview.className = 'analytics-media-preview grid place-items-center';
            preview.innerHTML = '<i data-lucide="film" class="w-5 h-5"></i>';
        }

        const details = document.createElement('span');
        details.className = 'analytics-media-details';
        const title = document.createElement('strong');
        title.textContent = media?.title || (media ? 'פריט ללא שם' : 'פריט שנמחק');
        const type = document.createElement('small');
        type.className = 'analytics-media-type';
        const folder = (window.state.folders || []).find(item => item.id === media?.folderId);
        type.textContent = `${media && isVideoRecord(media) ? 'סרטון' : 'תמונה'} · ${folder?.name || 'כללי'}`;
        const lastViewed = document.createElement('small');
        lastViewed.className = 'analytics-media-last-viewed';
        lastViewed.textContent = entry.lastViewedAt ? `צפייה אחרונה: ${formatDate(entry.lastViewedAt)}` : 'אין תאריך צפייה';
        details.append(title, type, lastViewed);

        const views = document.createElement('span');
        views.className = 'analytics-media-views';
        const viewsNumber = document.createElement('strong');
        viewsNumber.textContent = String(Number(entry.views) || 0);
        const viewsLabel = document.createElement('small');
        viewsLabel.textContent = 'צפיות';
        views.append(viewsNumber, viewsLabel);

        card.append(rank, preview, details, views);
        container.appendChild(card);
    });
    scheduleIconRefresh(container);
}

export async function loadAdvancedAnalytics() {
    const { canViewSuperAdminData, isVideoRecord, formatBytes, escapeHtml, scheduleIconRefresh } = window;
    if (!canViewSuperAdminData()) return;
    const cards = document.getElementById('advancedAnalyticsCards');
    const top = document.getElementById('advancedAnalyticsTop');
    if (cards) {
        cards.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'admin-empty';
        loading.textContent = 'טוען…';
        cards.appendChild(loading);
    }
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'mediaStats'));
        const stats = snapshot.docs.map(entry => entry.data());
        const totalViews = stats.reduce((sum, entry) => sum + (Number(entry.views) || 0), 0);
        const images = window.state.images || [];
        const videos = images.filter(isVideoRecord).length;
        const storage = images.reduce((sum, item) => sum + (Number(item.originalSize) || 0), 0);
        const values = [
            ['פריטי מדיה', images.length, 'images', 'cyan'],
            ['סרטונים', videos, 'video', 'violet'],
            ['משתמשים', (window.state.allUsers || []).length, 'users', 'green'],
            ['צפיות', totalViews, 'eye', 'gold'],
            ['תיקיות', (window.state.folders || []).filter(folder => folder.id !== 'all').length, 'folders', 'cyan'],
            ['נפח מקורי', formatBytes(storage), 'hard-drive', 'violet'],
            ['ממתינים לאישור', (window.state.pendingImages || []).length, 'clock', 'gold']
        ];
        if (cards) {
            cards.innerHTML = values.map(([label, value, icon, tone]) => `
                <div class="admin-stat" data-tone="${tone}">
                    <span class="admin-stat-icon"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
                    <div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>
                </div>`).join('');
        }
        renderAnalyticsMedia(stats);
        scheduleIconRefresh();
    } catch (error) {
        if (top) top.textContent = error.message || 'טעינת הנתונים נכשלה.';
        if (cards) cards.replaceChildren();
    }
}
window.loadAdvancedAnalytics = loadAdvancedAnalytics;
