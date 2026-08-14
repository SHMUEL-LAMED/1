// חיפוש תמונות לפי תיאור מול ה-Worker
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.

import { clearTempSearchFilter } from './media-grid.js';

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

const AI_SEARCH_BATCH_SIZE = 8;

const AI_SEARCH_BATCH_DELAY_MS = 1200;

const AI_SEARCH_MAX_RETRIES = 5;

const AI_SEARCH_RETRY_BASE_MS = 2000;

function aiSearchDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
