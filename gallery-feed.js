// gallery-feed.js — שכבת הנתונים של דף הגלריה: תמונות לפי תיקייה, בעמודים.
//
// עד היום הגלריה הורידה את כל אוסף התמונות בכל טעינה ובכל רענון, גם כשהצופה
// פתח תיקייה אחת. כאן state.images מחזיק רק את התיקייה הפעילה: העמוד הראשון
// (החדשות ביותר) נטען מיד, והבאים — דרך loadMoreImages. לכל תיקייה יש
// מטמון קטן בזיכרון לאורך הביקור, והמונים, פסיפס הכניסה ו"חדש מאז הביקור
// הקודם" מגיעים משאילתות קטנות משלהם במקום מהרשימה המלאה.
//
// דף הניהול אינו משתמש במודול הזה: מסכי הניהול — סטטיסטיקה, גיבוי, סנכרון
// Drive, אינדוקס הפנים — צריכים את הרשימה כולה, והם ממשיכים לקבל אותה
// (דרך סמני הדפדוף) ב-session-auth.js.
//
// הממשק לשאר המודולים הוא דרך window, כמו בכל המודולים באתר:
//   loadFolderImages(folderId)  — מעבר תיקייה: מהמטמון או העמוד הראשון מהענן
//   loadMoreImages()            — העמוד הבא של התיקייה הפעילה; {added, done}
//   state.imagesHasMore         — האם יש עוד עמודים לתיקייה הפעילה
//   state.folderCounts / state.imagesTotal — מוני התיקיות מהשרת
//   state.latestImages          — התמונות החדשות ביותר בכל הארכיון
import { collection, query, where, orderBy, limit, getDocsPage, getDocsByIds, getCounts } from './cloudflare-client.js';
import { onSnapshot, reportFirestoreError } from './session-auth.js';

// גודל עמוד של תיקייה. גדול מהמנה שהגלריה מציירת (48), כדי שגלילה ראשונה
// לא תחכה לרשת, וקטן מספיק שתשובה אחת תישאר קלה.
const FEED_PAGE_SIZE = 120;
// השאילתה הקטנה של "החדשות ביותר": פסיפס הכניסה לוקח ממנה חמש, ההתראה על
// תיקיות במעקב ובאנר העדכונים משתמשים בכולה.
const LATEST_LIMIT = 24;
// כמה עמודים נוספים נטענים מעצמם כשמחפשים בתיקייה שטרם נטענה כולה.
const SEARCH_AUTOLOAD_MAX_PAGES = 25;
const COUNTS_REFRESH_DELAY_MS = 2500;

// תיקייה → { items, nextCursor, hasMore, loadedAt }. "favorites" לעולם אינה
// נשמרת כאן, כי רשימת המועדפים משתנה בלחיצת לב.
const feedCache = new Map();
let activeLoadToken = 0;
let loadMorePromise = null;
let knownLatestIds = null;
let countsRefreshTimer = null;
let feedStopped = true;

function safeId(value) {
    return window.safeRecordId ? window.safeRecordId(value) : String(value ?? '');
}

function imagesCollection() {
    return collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images');
}

function folderQuery(folderId) {
    const constraints = [orderBy('createdAt', 'desc'), limit(FEED_PAGE_SIZE)];
    if (folderId !== 'all') constraints.unshift(where('folderId', '==', folderId));
    return query(imagesCollection(), ...constraints);
}

function sortNewestFirst(items) {
    return items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function activeFolderId() {
    return safeId(window.state?.activeFolderId) || 'all';
}

function itemBelongsToFolder(item, folderId) {
    return folderId === 'all' || safeId(item?.folderId) === folderId;
}

// עמוד אחד מהענן. המועדפים נטענים לפי מזהים ולא בעמודים.
async function fetchFolderPage(folderId, after = null) {
    if (folderId === 'favorites') {
        const ids = [...(window.state?.favorites || [])];
        const snapshot = ids.length ? await getDocsByIds(imagesCollection(), ids) : { docs: [] };
        return { items: snapshot.docs.map(item => item.data()), nextCursor: null, hasMore: false };
    }
    const page = await getDocsPage(folderQuery(folderId), { after, pageSize: FEED_PAGE_SIZE });
    return { items: page.docs.map(item => item.data()), nextCursor: page.nextCursor, hasMore: page.hasMore };
}

function applyFeed(folderId, entry) {
    window.state.images = sortNewestFirst([...entry.items]);
    window.state.imagesHasMore = Boolean(entry.hasMore);
    window.state.imagesLoading = false;
    window.state.gallerySnapshotInitialized = true;
    window.renderImages?.();
}

function showLoadError(error) {
    reportFirestoreError(error);
    window.showNotification?.('טעינת התמונות נכשלה. נסה שוב בעוד רגע.', false);
}

// מעבר תיקייה. מהמטמון — מיד; אחרת העמוד הראשון מהענן, והגלריה מציגה
// "טוען" עד שהוא מגיע. בקשה שהתיקייה הוחלפה בזמן שרצה נשמרת למטמון
// אך אינה נכתבת למסך.
async function loadFolderImages(folderId, { force = false } = {}) {
    // לפני אישור הצפייה (או בדף הניהול) ההזנה כבויה: אין מה לטעון ואין
    // טעם לפנות לרשת.
    if (feedStopped) return { added: 0, done: true, inactive: true };
    const id = safeId(folderId) || 'all';
    const cached = !force && id !== 'favorites' ? feedCache.get(id) : null;
    const token = ++activeLoadToken;
    if (cached) {
        applyFeed(id, cached);
        return { added: cached.items.length, done: !cached.hasMore, fromCache: true };
    }
    window.state.images = [];
    window.state.imagesHasMore = false;
    window.state.imagesLoading = true;
    window.renderImages?.();
    try {
        const page = await fetchFolderPage(id);
        const entry = { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore, loadedAt: Date.now() };
        if (id !== 'favorites') feedCache.set(id, entry);
        if (token !== activeLoadToken || activeFolderId() !== id) {
            return { added: page.items.length, done: !page.hasMore, stale: true };
        }
        applyFeed(id, entry);
        return { added: page.items.length, done: !page.hasMore };
    } catch (error) {
        if (token === activeLoadToken) {
            window.state.imagesLoading = false;
            window.renderImages?.();
        }
        showLoadError(error);
        return { added: 0, done: false, error };
    }
}

// העמוד הבא של התיקייה הפעילה. מחזיר {added, done}; קריאה כפולה בזמן
// שבקשה רצה מקבלת את אותה הבטחה.
function loadMoreImages() {
    if (loadMorePromise) return loadMorePromise;
    if (feedStopped) return Promise.resolve({ added: 0, done: true, inactive: true });
    const id = activeFolderId();
    const entry = feedCache.get(id);
    if (!entry || !entry.hasMore || !entry.nextCursor) return Promise.resolve({ added: 0, done: true });
    const token = activeLoadToken;
    window.state.imagesLoadingMore = true;
    window.updateGalleryLoadMore?.();
    loadMorePromise = (async () => {
        try {
            const page = await fetchFolderPage(id, entry.nextCursor);
            const known = new Set(entry.items.map(item => safeId(item.id)));
            const fresh = page.items.filter(item => !known.has(safeId(item.id)));
            entry.items.push(...fresh);
            entry.nextCursor = page.nextCursor;
            entry.hasMore = page.hasMore;
            if (token === activeLoadToken && activeFolderId() === id) applyFeed(id, entry);
            return { added: fresh.length, done: !entry.hasMore };
        } catch (error) {
            showLoadError(error);
            return { added: 0, done: false, error };
        } finally {
            window.state.imagesLoadingMore = false;
            loadMorePromise = null;
            window.updateGalleryLoadMore?.();
        }
    })();
    return loadMorePromise;
}

// חיפוש (או סינון לפי שנה/חודש עבריים או סוג מדיה) בתיקייה שטרם נטענה כולה: העמודים הבאים נטענים מעצמם, כל עוד
// החיפוש פעיל ובאותה תיקייה, כדי שהתוצאות יכסו גם פריטים ישנים.
async function loadAllImagesForSearch() {
    const id = activeFolderId();
    for (let page = 0; page < SEARCH_AUTOLOAD_MAX_PAGES; page += 1) {
        const filtering = Boolean(window.state.searchQuery) || Boolean(window.hasActiveGalleryFilters?.());
        if (!filtering || activeFolderId() !== id || !window.state.imagesHasMore) return;
        const result = await loadMoreImages();
        if (result.done || result.error) return;
    }
}

// רענון תקופתי של התיקייה הפעילה: העמוד הראשון נטען מחדש ומתמזג עם מה
// שכבר בזיכרון. פריט שהיה אמור להופיע בעמוד הזה ונעלם ממנו — נמחק או
// הועבר. הסמן לעמודים הבאים הוא מיקום (ערך מיון ומזהה), ולכן נשאר תקף.
function mergeFreshPage(entry, page) {
    const freshIds = new Set(page.items.map(item => safeId(item.id)));
    const oldestFresh = page.items.reduce((oldest, item) => Math.min(oldest, Number(item.createdAt) || 0), Infinity);
    const kept = page.hasMore
        ? entry.items.filter(item => !freshIds.has(safeId(item.id)) && (Number(item.createdAt) || 0) <= oldestFresh)
        : [];
    entry.items = [...page.items, ...kept];
    if (!page.hasMore || !kept.length) {
        entry.nextCursor = page.nextCursor;
        entry.hasMore = page.hasMore;
    }
    entry.loadedAt = Date.now();
}

async function refreshActiveFolder() {
    const id = activeFolderId();
    // המועדפים אינם במטמון: נטענים מחדש לפי מזהים ומוחלפים במקום, בלי
    // לרוקן את המסך בינתיים.
    if (id === 'favorites') {
        const page = await fetchFolderPage(id);
        if (activeFolderId() === id) applyFeed(id, { items: page.items, nextCursor: null, hasMore: false });
        return;
    }
    const entry = feedCache.get(id);
    if (!entry) {
        if (!window.state.imagesLoading) await loadFolderImages(id);
        return;
    }
    const page = await fetchFolderPage(id);
    mergeFreshPage(entry, page);
    if (activeFolderId() === id && !window.state.imagesLoading) applyFeed(id, entry);
}

async function refreshFolderCounts() {
    const { total, counts } = await getCounts(imagesCollection(), 'folderId');
    window.state.folderCounts = counts;
    window.state.imagesTotal = total;
    window.renderFolders?.();
    window.updateGalleryLoadMore?.();
}

function scheduleCountsRefresh() {
    if (feedStopped) return;
    clearTimeout(countsRefreshTimer);
    countsRefreshTimer = setTimeout(() => {
        refreshFolderCounts().catch(error => console.warn('Folder counts refresh failed:', error));
    }, COUNTS_REFRESH_DELAY_MS);
}

// ההתראה על פריטים חדשים בתיקיות שבמעקב — על העמוד החדש ביותר, לא על
// הרשימה כולה כבעבר.
function notifyFollowedFolders(newItems) {
    const followed = window.state?.followedFolders || new Set();
    const relevant = newItems.filter(item => followed.has(safeId(item.folderId)));
    if (!relevant.length) return;
    const folderNames = [...new Set(relevant
        .map(item => (window.state.folders || []).find(folder => safeId(folder.id) === safeId(item.folderId))?.name)
        .filter(Boolean))];
    window.showNotification?.(`נוספו ${relevant.length} פריטים חדשים${folderNames.length ? ` ב־${folderNames.join(', ')}` : ''}.`, true);
}

async function refreshLatestImages() {
    const page = await getDocsPage(query(imagesCollection(), orderBy('createdAt', 'desc'), limit(LATEST_LIMIT)), { pageSize: LATEST_LIMIT });
    const latest = page.docs.map(item => item.data());
    const latestIds = new Set(latest.map(item => safeId(item.id)));
    if (knownLatestIds) {
        const newItems = latest.filter(item => !knownLatestIds.has(safeId(item.id)));
        if (newItems.length) {
            notifyFollowedFolders(newItems);
            // תיקיות שקיבלו פריט חדש ייטענו מחדש במעבר הבא אליהן.
            for (const item of newItems) {
                const folderId = safeId(item.folderId);
                if (folderId !== activeFolderId()) feedCache.delete(folderId);
            }
            if (activeFolderId() !== 'all') feedCache.delete('all');
            scheduleCountsRefresh();
        }
    }
    knownLatestIds = latestIds;
    window.state.latestImages = latest;
    window.renderFolders?.();
    window.checkNewUpdates?.();
}

async function refreshGalleryFeed() {
    const results = await Promise.allSettled([refreshActiveFolder(), refreshLatestImages(), refreshFolderCounts()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return results;
}

// הפעלה אחרי אישור הצפייה. מחזירה פונקציית עצירה, כמו שאר המאזינים.
function startGalleryFeed() {
    feedStopped = false;
    knownLatestIds = null;
    const stopPolling = onSnapshot({ type: 'collection', segments: ['images'] }, () => {}, reportFirestoreError, { load: refreshGalleryFeed });
    return () => {
        stopPolling();
        resetGalleryFeed();
    };
}

function resetGalleryFeed() {
    feedStopped = true;
    feedCache.clear();
    activeLoadToken += 1;
    knownLatestIds = null;
    clearTimeout(countsRefreshTimer);
    if (window.state) {
        window.state.imagesHasMore = false;
        window.state.imagesLoading = false;
        window.state.imagesLoadingMore = false;
        window.state.latestImages = [];
        window.state.folderCounts = null;
        window.state.imagesTotal = null;
    }
}

// --- עדכונים מקומיים אחרי כתיבה ---
// המודולים שכותבים לענן מעדכנים את state.images בעצמם; כאן מתעדכן גם
// המטמון לפי תיקייה, כדי שהעמוד הבא לא יחזיר את התמונה הישנה.
function noteImageUpserted(record) {
    const id = safeId(record?.id);
    if (!id) return;
    for (const [folderId, entry] of feedCache) {
        const index = entry.items.findIndex(item => safeId(item.id) === id);
        if (itemBelongsToFolder(record, folderId)) {
            if (index >= 0) entry.items[index] = record;
            else entry.items.unshift(record);
        } else if (index >= 0) {
            entry.items.splice(index, 1);
        }
    }
    scheduleCountsRefresh();
}

function noteImageRemoved(imageId) {
    const id = safeId(imageId);
    if (!id) return;
    for (const entry of feedCache.values()) {
        entry.items = entry.items.filter(item => safeId(item.id) !== id);
    }
    scheduleCountsRefresh();
}

// הפריטים שכבר נטענו לתיקייה (לעמוד האירוע), בלי לפנות לרשת.
function getLoadedFolderImages(folderId) {
    const id = safeId(folderId);
    const entry = feedCache.get(id);
    if (entry) return [...entry.items];
    return (window.state?.images || []).filter(item => itemBelongsToFolder(item, id));
}

function isFolderFullyLoaded(folderId) {
    const entry = feedCache.get(safeId(folderId));
    return Boolean(entry && !entry.hasMore);
}

// העמוד הראשון של תיקייה שאינה פעילה, למשל לעמוד האירוע. נשמר למטמון
// ואינו נוגע ב-state.images.
async function prefetchFolderImages(folderId) {
    const id = safeId(folderId);
    if (!id || id === 'favorites' || feedStopped) return [];
    const cached = feedCache.get(id);
    if (cached) return [...cached.items];
    const page = await fetchFolderPage(id);
    feedCache.set(id, { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore, loadedAt: Date.now() });
    return [...page.items];
}

window.loadFolderImages = loadFolderImages;
window.loadMoreImages = loadMoreImages;
window.loadAllImagesForSearch = loadAllImagesForSearch;
window.startGalleryFeed = startGalleryFeed;
window.resetGalleryFeed = resetGalleryFeed;
window.refreshGalleryFeed = refreshGalleryFeed;
window.noteGalleryImageUpserted = noteImageUpserted;
window.noteGalleryImageRemoved = noteImageRemoved;
window.getLoadedFolderImages = getLoadedFolderImages;
window.isFolderFullyLoaded = isFolderFullyLoaded;
window.prefetchFolderImages = prefetchFolderImages;
