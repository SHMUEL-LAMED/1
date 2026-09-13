// popup-announcement.js — הודעת הפופ-אפ שמוצגת למבקרי האתר.
// הופרד מ-admin.js משום שהוא רץ עבור כל מבקר, גם מי שאינו מנהל, ולכן
// חייב להיטען תמיד — בעוד ששאר ממשק הניהול נטען רק למי שזקוק לו.

// =================== POPUP ANNOUNCEMENT ===================

// היעדים שאליהם אפשר להפנות מהפופ-אפ, מעבר לתיקייה ולעדכונים האחרונים.
// כל יעד מפעיל את אותה נקודת כניסה שהמשתמש לוחץ עליה באתר, ולכן בדיקות
// ההרשאה וההודעות למי שאינו מורשה נשארות במקום אחד בלבד — בפיצ׳ר עצמו.
export const POPUP_FEATURE_TARGETS = [
    {
        id: 'faceSearch',
        label: 'חיפוש פנים ב־AI',
        icon: 'scan-face',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openFaceSearchModal?.()
    },
    {
        id: 'aiSearch',
        label: 'חיפוש AI לפי תיאור',
        icon: 'brain-circuit',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openAiImageSearchModal?.()
    },
    {
        id: 'upload',
        label: 'העלאת תמונות וסרטונים',
        icon: 'cloud-upload',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => {
            // openModal עצמו אינו בודק הרשאות, ולכן הבדיקה נעשית כאן.
            if (window.state?.userApprovalStatus !== 'approved') {
                window.showNotification?.('העלאת מדיה זמינה למשתמשים מאושרים בלבד.', false);
                return;
            }
            window.openModal?.('userUploadModal');
        }
    },
    {
        id: 'favorites',
        label: 'המועדפים שלי',
        icon: 'heart',
        hint: 'למשתמשים מאושרים בלבד',
        run: () => window.openFavoritesFromProfile?.()
    },
    {
        id: 'contactManager',
        label: 'צ׳אט עם מנהל הגלריה',
        icon: 'message-circle',
        hint: 'למשתמשים מחוברים בלבד',
        run: () => window.openUserConversation?.()
    },
    {
        id: 'profile',
        label: 'הפרופיל וההתראות',
        icon: 'user-round',
        hint: 'זמין לכולם',
        run: () => window.openFloatingProfile?.()
    }
];

export function resolvePopupFeature(featureId) {
    const id = String(featureId || '');
    return POPUP_FEATURE_TARGETS.find(feature => feature.id === id) || null;
}

// התווית והאייקון של כפתור הפעולה בפופ-אפ. מחזיר null כשאין לאן להפנות,
// וכך גם ההסתרה של הכפתור וגם הטקסט שלו נגזרים מאותו מקום.
export function popupAnnouncementActionInfo(config, folders = window.state?.folders) {
    const linkType = config?.linkType || 'none';
    if (linkType === 'latest') return { label: 'לעדכונים האחרונים', icon: 'sparkles' };
    if (linkType === 'feature') {
        const feature = resolvePopupFeature(config?.featureId);
        return feature ? { label: feature.label, icon: feature.icon } : null;
    }
    if (linkType === 'folder' && config?.folderId) {
        const folder = (folders || []).find(item => String(item.id) === String(config.folderId));
        return { label: folder?.name ? `למעבר אל ${folder.name}` : 'למעבר לתיקייה', icon: 'folder-open' };
    }
    return null;
}

function popupAnnouncementVersion(config) {
    return String(config?.updatedAt || config?.imageUrl || 'current');
}

window.loadPopupAnnouncement = async function(retryCount = 0) {
    if (!window.db || !window.firestoreModules?.doc || !window.firestoreModules?.getDoc) {
        if (retryCount < 24) {
            clearTimeout(window._popupAnnouncementRetryTimer);
            window._popupAnnouncementRetryTimer = setTimeout(
                () => window.loadPopupAnnouncement?.(retryCount + 1),
                Math.min(3000, 250 + retryCount * 150)
            );
        } else {
            console.warn('Popup load skipped: cloud connection was not ready.');
        }
        return;
    }
    if (window._popupAnnouncementLoadPromise) return window._popupAnnouncementLoadPromise;
    window._popupAnnouncementLoadPromise = (async () => {
        try {
            const { doc, getDoc } = window.firestoreModules;
            const snap = await getDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
            const config = snap.exists() ? snap.data() : null;
            window.state.popupAnnouncementConfig = config || null;
            window.renderPopupAnnouncementAdmin?.();
            if (config?.enabled) window.showPopupAnnouncement(config);
        } catch (e) {
            console.warn('Popup load failed:', e);
            if (retryCount < 3) {
                clearTimeout(window._popupAnnouncementRetryTimer);
                window._popupAnnouncementRetryTimer = setTimeout(
                    () => window.loadPopupAnnouncement?.(retryCount + 1),
                    1000 * (retryCount + 1)
                );
            }
        } finally {
            window._popupAnnouncementLoadPromise = null;
        }
    })();
    return window._popupAnnouncementLoadPromise;
};

window.showPopupAnnouncement = function(config) {
    if (!config || !config.enabled || !config.imageUrl) return;
    const version = popupAnnouncementVersion(config);
    try {
        if (sessionStorage.getItem('popupAnnouncementDismissedVersion') === version) return;
    } catch (e) { /* ignore */ }

    if (config.audience === 'approved') {
        const status = window.state?.userApprovalStatus;
        if (status !== 'approved') return;
    }

    const modal = document.getElementById('popupAnnouncementModal');
    const img = document.getElementById('popupAnnouncementDisplayImg');
    if (!modal || !img) return;

    const action = popupAnnouncementActionInfo(config);
    img.style.cursor = action ? 'pointer' : 'default';
    renderPopupAnnouncementActionButton(action);
    img.onload = () => {
        modal.classList.remove('hidden');
        window.scheduleIconRefresh();
    };
    img.onerror = () => {
        modal.classList.add('hidden');
        console.warn('Popup image failed to load.');
    };
    img.src = config.imageUrl;
    if (img.complete && img.naturalWidth > 0) img.onload();
};

window.closePopupAnnouncement = function() {
    const modal = document.getElementById('popupAnnouncementModal');
    if (!modal) return;
    modal.classList.add('hidden');
    try {
        sessionStorage.setItem(
            'popupAnnouncementDismissedVersion',
            popupAnnouncementVersion(window.state?.popupAnnouncementConfig)
        );
        sessionStorage.removeItem('popupAnnouncementDismissed');
    } catch (e) { /* ignore */ }
};

// כפתור הפעולה מציג למשתמש לאן הפופ-אפ מפנה, במקום להסתמך על לחיצה
// על התמונה בלבד. התוכן נבנה ב-DOM ולא כ-HTML, כדי ששם תיקייה לא יוכל
// להזריק תגיות.
function renderPopupAnnouncementActionButton(action) {
    const button = document.getElementById('popupAnnouncementActionButton');
    if (!button) return;
    button.classList.toggle('hidden', !action);
    button.classList.toggle('flex', !!action);
    if (!action) {
        button.replaceChildren();
        return;
    }
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', action.icon || 'arrow-left');
    icon.className = 'w-4 h-4';
    const label = document.createElement('span');
    label.textContent = action.label;
    button.replaceChildren(icon, label);
}

window.handlePopupAnnouncementClick = function() {
    const config = window.state?.popupAnnouncementConfig;
    if (!config || !config.linkType || config.linkType === 'none') return;
    // הפופ-אפ נסגר תחילה: הוא יושב מעל כל החלונות, ואילו נשאר פתוח היה
    // מסתיר את הפיצ׳ר או את התיקייה שנפתחו זה עתה.
    window.closePopupAnnouncement();
    if (config.linkType === 'latest') {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder('all');
        window.state.gallerySort = 'newest';
        window.renderImages?.();
    } else if (config.linkType === 'folder' && config.folderId) {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder(config.folderId);
    } else if (config.linkType === 'feature') {
        const feature = resolvePopupFeature(config.featureId);
        if (feature) feature.run();
        else window.showNotification?.('הפנייה של ההודעה אינה זמינה יותר.', false);
    }
};

