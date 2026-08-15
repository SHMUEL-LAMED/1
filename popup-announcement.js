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

// הצגה או הסתרה של אזורי הבחירה לפי סוג הפנייה שנבחר. אותה פונקציה
// משמשת גם את כפתורי הרדיו ב-HTML וגם את טעינת ההגדרות השמורות.
window.updatePopupLinkTypeUI = function() {
    const linkType = document.querySelector('input[name="popupLinkType"]:checked')?.value || 'none';
    document.getElementById('popupFolderSelectorArea')?.classList.toggle('hidden', linkType !== 'folder');
    document.getElementById('popupFeatureSelectorArea')?.classList.toggle('hidden', linkType !== 'feature');
    const hint = document.getElementById('popupFeatureHint');
    if (hint) {
        const feature = resolvePopupFeature(document.getElementById('popupFeatureSelect')?.value);
        hint.textContent = linkType === 'feature' && feature ? feature.hint || '' : '';
    }
};

window.renderPopupAnnouncementAdmin = function() {
    const config = window.state?.popupAnnouncementConfig;

    const preview = document.getElementById('popupAnnouncementPreview');
    const previewImg = document.getElementById('popupAnnouncementPreviewImg');
    const statusEl = document.getElementById('popupAnnouncementStatus');
    const audienceEl = document.getElementById('popupAnnouncementAudienceLabel');
    const linkEl = document.getElementById('popupAnnouncementLinkLabel');
    const enabledCb = document.getElementById('popupEnabled');

    if (config && config.imageUrl) {
        if (preview) preview.classList.remove('hidden');
        if (previewImg) previewImg.src = config.imageUrl;
        if (statusEl) statusEl.textContent = config.enabled ? 'פעיל' : 'כבוי';
        if (audienceEl) audienceEl.textContent = config.audience === 'approved' ? 'מורשים בלבד' : 'כולם';
        if (linkEl) {
            const action = popupAnnouncementActionInfo(config);
            linkEl.textContent = action ? `מפנה אל: ${action.label}` : 'ללא פנייה — רק תמונה';
        }
    } else {
        if (preview) preview.classList.add('hidden');
    }

    if (enabledCb) enabledCb.checked = config ? !!config.enabled : true;

    const linkType = config?.linkType || 'none';
    document.querySelectorAll('input[name="popupLinkType"]').forEach(r => { r.checked = r.value === linkType; });

    const audience = config?.audience || 'all';
    document.querySelectorAll('input[name="popupAudience"]').forEach(r => { r.checked = r.value === audience; });

    const folderSelect = document.getElementById('popupFolderSelect');
    if (folderSelect) {
        folderSelect.innerHTML = (window.state.folders || [])
            .filter(f => f.id !== 'all')
            .map(f => `<option value="${f.id}"${String(config?.folderId) === String(f.id) ? ' selected' : ''}>${f.name || f.id}</option>`)
            .join('');
    }

    const featureSelect = document.getElementById('popupFeatureSelect');
    if (featureSelect) {
        featureSelect.replaceChildren(...POPUP_FEATURE_TARGETS.map(feature => {
            const option = document.createElement('option');
            option.value = feature.id;
            option.textContent = feature.label;
            option.selected = String(config?.featureId) === feature.id;
            return option;
        }));
    }

    window.updatePopupLinkTypeUI();
};

window.savePopupAnnouncement = async function() {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    const statusEl = document.getElementById('popupSaveStatus');
    const saveButton = document.getElementById('popupSaveButton');
    if (saveButton?.disabled) return;
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'מכין...';
    }
    if (statusEl) statusEl.textContent = 'מכין את התמונה להעלאה מהירה...';

    try {
        const fileInput = document.getElementById('popupImageInput');
        const file = fileInput?.files?.[0];
        const linkType = document.querySelector('input[name="popupLinkType"]:checked')?.value || 'none';
        const audience = document.querySelector('input[name="popupAudience"]:checked')?.value || 'all';
        const enabled = document.getElementById('popupEnabled')?.checked !== false;
        const folderId = linkType === 'folder' ? (document.getElementById('popupFolderSelect')?.value || '') : '';
        const featureId = linkType === 'feature' ? (document.getElementById('popupFeatureSelect')?.value || '') : '';
        if (linkType === 'folder' && !folderId) throw new Error('יש לבחור תיקייה לפנייה.');
        if (linkType === 'feature' && !resolvePopupFeature(featureId)) throw new Error('יש לבחור פיצ׳ר לפנייה.');

        let imageUrl = window.state.popupAnnouncementConfig?.imageUrl || '';
        let r2Key = window.state.popupAnnouncementConfig?.r2Key || '';

        if (file) {
            if (!String(file.type || '').startsWith('image/')) throw new Error('יש לבחור קובץ תמונה תקין.');
            if (file.size > 20 * 1024 * 1024) throw new Error('גודל התמונה חייב להיות עד 20MB.');
            const compressedDataUrl = await Promise.race([
                window.compressAndConvertImage(file, 1280, 1280, 0.78),
                new Promise((_, reject) => setTimeout(() => reject(new Error('הכנת התמונה נתקעה. נסה קובץ JPG או PNG אחר.')), 20000))
            ]);
            if (!compressedDataUrl) throw new Error('לא ניתן היה להכין את התמונה להעלאה.');
            const uploadBlob = window.dataUrlToBlob(compressedDataUrl);
            if (statusEl) statusEl.textContent = `מעלה תמונה ממוטבת (${Math.max(1, Math.round(uploadBlob.size / 1024))}KB)...`;
            if (saveButton) saveButton.textContent = 'מעלה...';
            const popupId = 'popup_announcement_' + Date.now();
            const uploaded = await window.uploadMediaToR2(uploadBlob, popupId, 'popup-announcement');
            if (!uploaded?.url) throw new Error('העלאת התמונה נכשלה.');
            if (r2Key && r2Key !== uploaded.r2Key) {
                await window.deleteImageFromR2({ r2Key }).catch(() => {});
            }
            imageUrl = uploaded.url;
            r2Key = uploaded.r2Key || '';
        }

        if (!imageUrl) throw new Error('יש לבחור תמונה לפופ-אפ.');

        const config = { imageUrl, r2Key, linkType, folderId, featureId, audience, enabled, updatedAt: Date.now() };
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'), config);
        window.state.popupAnnouncementConfig = config;
        if (fileInput) fileInput.value = '';
        window.renderPopupAnnouncementAdmin();
        try {
            sessionStorage.removeItem('popupAnnouncementDismissed');
            sessionStorage.removeItem('popupAnnouncementDismissedVersion');
        } catch (error) {}
        if (statusEl) statusEl.textContent = 'נשמר בהצלחה!';
        window.showNotification('הפופ-אפ נשמר ופורסם.', true);
        setTimeout(() => window.showPopupAnnouncement?.(config), 350);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'שמירה נכשלה');
        window.showNotification('שגיאה בשמירת הפופ-אפ: ' + (e.message || ''), false);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'שמור ופרסם';
        }
    }
};

window.deletePopupAnnouncement = async function(confirmed) {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    if (!confirmed) {
        if (!confirm('למחוק את הודעת הפופ-אפ?')) return;
        return window.deletePopupAnnouncement(true);
    }
    const statusEl = document.getElementById('popupSaveStatus');
    if (statusEl) statusEl.textContent = 'מוחק...';
    try {
        const r2Key = window.state.popupAnnouncementConfig?.r2Key;
        if (r2Key) await window.deleteImageFromR2({ r2Key }).catch(() => {});
        const { doc, deleteDoc } = window.firestoreModules;
        await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
        window.state.popupAnnouncementConfig = null;
        window.renderPopupAnnouncementAdmin();
        if (statusEl) statusEl.textContent = '';
        window.showNotification('הפופ-אפ נמחק.', true);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'מחיקה נכשלה');
        window.showNotification('שגיאה במחיקת הפופ-אפ: ' + (e.message || ''), false);
    }
};
