// admin-pending.js — תור ההעלאות הממתינות לאישור בלוח הניהול.
//
// פוצל מ-admin.js כדי שכל קובץ יעסוק בעניין אחד: כאן רשימת הממתינים,
// המונים (כולל סיכום הנתונים שבראש הלוח) ומסלול האישור היחיד, שמשרת גם
// את "אשר נבחרים" וגם את "מצב מהיר" (pending-swipe.js). מסלול הדחייה
// (rejectPendingRecord וחבריו) נשאר ב-admin.js — ראה שם מדוע.
//
// המודול אינו נוגע ב-DOM בזמן הטעינה, ואינו רושם דבר על window: admin.js
// מייבא אותו ורושם את הפונקציות בשמותיהן הקיימים, כך שטעינה חוזרת של
// נקודת הכניסה (כמו בבדיקות) רושמת אותן מחדש על ה-window הנוכחי. כל
// עזרי window (showConfirm, r2Request, escapeHtml…) נקראים בזמן הקריאה.

import { pickCardSource } from './media-variants.js';

export function renderPendingImages() {
    // המצב המהיר (כשהוא פתוח) מתעדכן יחד עם הרשימה: פריט שמנהל אחר כבר
    // טיפל בו יוצא מהתור, ופריט חדש שהגיע נכנס לסופו.
    window.refreshPendingSwipe?.();
    const list = document.getElementById('pendingList'); if (!list) return;
    // תמונות הממתינות לאישור — מדרגה 3 ומעלה.
    if (!window.canViewAdminData?.()) { list.innerHTML = ''; return; }
    const pending = window.state.pendingImages || [];
    if (pending.length === 0) { list.innerHTML = '<p class="admin-empty">אין קבצי מדיה ממתינים לאישור.</p>'; return; }
    const parts = [];
    pending.forEach(img => {
        const imageId = window.safeRecordId(img.id);
        if (!imageId) return;
        // התצוגה הקטנה כשקיימת, ואם לא — המקור.
        const imageUrl = pickCardSource(img, window.safeImageUrl).url;
        const isVideo = window.isVideoRecord(img);
        const preview = isVideo
            ? '<span class="admin-stat-icon" data-tone="violet"><i data-lucide="video" class="w-4 h-4"></i></span>'
            : `<img src="${window.escapeHtml(imageUrl)}" loading="lazy" decoding="async" alt="" class="w-10 h-10 shrink-0 object-cover rounded-lg border border-white/10" onerror="window.handleImageError(this)">`;
        parts.push(`
            <label class="admin-row cursor-pointer">
                <input type="checkbox" name="pendingImgCheck" value="${imageId}" checked>
                ${preview}
                <div class="flex-1 min-w-0">
                    <p class="admin-row-title truncate">${window.escapeHtml(img.title)}</p>
                    <p class="admin-row-meta truncate">${isVideo ? 'סרטון' : 'תמונה'} · תיקייה מקורית: ${window.escapeHtml(img.originalFolderName)}</p>
                </div>
            </label>`);
    });
    list.innerHTML = parts.join('');
    window.scheduleIconRefresh(list);
}

// מונה התמונות הממתינות לאישור — מידע ניהולי מדרגה 3 ומעלה.
export function updatePendingBadge() {
    if (!window.canViewAdminData?.()) {
        window.clearAdminOutput?.('pendingCountBadge', '0');
        window.updateAdminOverview();
        return;
    }
    const badge = document.getElementById('pendingCountBadge');
    if (badge) badge.innerText = (window.state.pendingImages || []).length;
    window.updateAdminOverview();
}

export function toggleSelectAllPending() {
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]');
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = anyUnchecked);
}

// סיכום נתוני הניהול. הפונקציה נקראת מכל רינדור של הגלריה, ולכן היא חייבת
// לבדוק הרשאה בעצמה ולא להסתמך על כך שהפאנל מוסתר: משתמש רגיל היה מקבל את
// המספרים כתובים ב-DOM. מונה בקשות ההצטרפות נשאר אפס גם למנהל דרגה 3,
// משום שהוא נתון של מנהל־על.
export function updateAdminOverview() {
    const overviewIds = [
        'adminOverviewUsersCount', 'adminOverviewPendingCount',
        'adminOverviewImagesCount', 'adminOverviewFoldersCount'
    ];
    if (!window.canViewAdminData?.()) {
        overviewIds.forEach(id => window.clearAdminOutput?.(id, '0'));
        return;
    }
    const values = {
        adminOverviewUsersCount: window.canViewSuperAdminData?.() ? (window.state.pendingUsers || []).length : 0,
        adminOverviewPendingCount: (window.state.pendingImages || []).length,
        adminOverviewImagesCount: (window.state.images || []).length,
        adminOverviewFoldersCount: (window.state.folders || []).filter(folder => folder.id !== 'all').length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
}

// אישור פריט ממתין אחד — המסלול היחיד לאישור, גם ל"אשר נבחרים" וגם
// ל"מצב מהיר" (pending-swipe.js). כך יעד השמירה, האישור ב-R2 והתיעוד
// ב-pendingImages זהים בשני המקומות ואינם יכולים להתפצל.
async function approvePendingRecord(img, targetFolderId) {
    let finalFolderId = targetFolderId;
    if (!targetFolderId || targetFolderId === 'auto') {
        const fName = img.originalFolderName || 'כללי'; let existing = window.state.folders.find(f => f.name === fName);
        if (!existing) {
            existing = { id: 'folder_' + crypto.randomUUID(), name: fName, icon: 'folder', isDefault: false };
            await window.saveFolderToCloud(existing);
        }
        finalFolderId = existing.id;
    }
    const activeImage = await window.approveImageInR2({
        ...img,
        folderId: finalFolderId,
        createdAt: Date.now(),
        status: 'active'
    });
    await window.saveImageToCloud(activeImage);
    // שומרים תיעוד של האישור במקום למחוק, כדי שמנהל דרגה 3 לא יקבל הרשאת מחיקה עקיפה.
    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', img.id), {
        status: 'approved',
        approvedAt: Date.now(),
        approvedBy: window.state.currentUser?.uid || ''
    }, { merge: true });
    return activeImage;
}

// Remove approved items from local pendingImages state immediately
export function forgetApprovedPending(approvedIds) {
    if (!approvedIds.size) return;
    window.state.pendingImages = (window.state.pendingImages || []).filter(img => !approvedIds.has(window.safeRecordId(img.id)));
    window.renderPendingImages?.();
    window.updatePendingBadge?.();
}

export async function approveSelectedPending(confirmed = false) {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) { window.showNotification('לא נבחרו תמונות לאישור', false); return; }
    const targetFolderEl = document.getElementById('pendingTargetFolder');
    const targetFolderId = targetFolderEl ? targetFolderEl.value : 'auto';
    if (!confirmed) {
        window.showConfirm(
            'אישור תמונות',
            `לאשר ${checkboxes.length} תמונות ולהעביר אותן לגלריה הפעילה?`,
            () => approveSelectedPending(true)
        );
        return;
    }
    let approvedCount = 0;
    let failedCount = 0;

    const approvedIds = new Set();
    for(let cb of checkboxes) {
        const img = window.state.pendingImages.find(i => i.id === cb.value);
        if (img) {
            try {
                await approvePendingRecord(img, targetFolderId);
                approvedIds.add(window.safeRecordId(img.id));
                approvedCount++;
            } catch (error) {
                failedCount++;
                console.warn('Approve pending image failed:', window.safeRecordId(img.id), error);
            }
        }
    }
    forgetApprovedPending(approvedIds);
    if (approvedCount) await window.logActivity('approved_images', 'image', '', `${approvedCount} תמונות`);
    window.showNotification(
        failedCount
            ? `אושרו ${approvedCount} תמונות; ${failedCount} נכשלו.`
            : `אושרו ${approvedCount} תמונות בהצלחה לענן!`,
        !failedCount
    );
}

// "מצב מהיר": פריט אחד בכל פעם, עם החלקה ומקלדת. הוא משתמש באותן שתי
// פונקציות שלמעלה, בלי נתיב חדש בשרת, ונטען עצלה רק כשמנהל פותח אותו.
// הפונקציות זורקות בכישלון, כדי שהמצב המהיר יחזיר את הפריט לתור.
export async function approvePendingImage(imageId, targetFolderId = 'auto') {
    if (!window.checkAdminPermission()) throw new Error('אין הרשאה לאשר תוכן.');
    const id = window.safeRecordId(imageId);
    const img = (window.state.pendingImages || []).find(item => window.safeRecordId(item.id) === id);
    if (!img) throw new Error('הפריט הממתין לא נמצא. ייתכן שכבר טופל.');
    await approvePendingRecord(img, targetFolderId);
    forgetApprovedPending(new Set([id]));
    await window.logActivity('approved_images', 'image', id, img.title || 'תמונה');
}

let pendingSwipeModulePromise = null;
export function openPendingSwipe() {
    if (!window.checkAdminPermission()) return;
    (pendingSwipeModulePromise ||= import('./pending-swipe.js'))
        .then(module => module.openPendingSwipe())
        .catch(error => {
            pendingSwipeModulePromise = null;
            console.error('Pending swipe module failed to load:', error);
            window.showNotification('לא ניתן לפתוח את המצב המהיר. רענן ונסה שוב.', false);
        });
}
