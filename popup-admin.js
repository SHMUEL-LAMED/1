// popup-admin.js — עריכת הודעת הפופ-אפ, בדף הניהול בלבד.
//
// הצגת ההודעה למבקר נשארה ב-popup-announcement.js, שנטען בכל כניסה
// לאתר. העריכה — בחירת תמונה, קהל יעד, סוג הפנייה ושמירה — היא פעולת
// ניהול, ולכן היא ירדה מכאן והלאה רק למי שפותח את לוח הניהול.
//
// היעדים שאליהם ההודעה יכולה להפנות מוגדרים במודול הצופה, כדי שתהיה
// רשימה אחת בלבד לשני הצדדים.

import { POPUP_FEATURE_TARGETS, resolvePopupFeature, popupAnnouncementActionInfo } from './popup-announcement.js';

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
