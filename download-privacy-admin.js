// download-privacy-admin.js — מסך "הורדות ופרטיות" בלוח הניהול (admin.html בלבד).
//
// ההגדרה נשמרת באותו מקום כמו הודעת הפופ-אפ: מסמך ב-systemMeta
// (systemMeta/downloadPrivacy). ה-Worker מתיר לכל משתמש מאושר לקרוא אותו,
// ולכתוב — למנהל־על בלבד, כמו המסך הזה (SYSTEM_META_SUPER_ADMIN_WRITE_IDS);
// את updatedBy הוא קובע בעצמו לפי החשבון המאומת. הצד שמיישם את ההגדרה בהורדה
// הוא download-privacy-ui.js שבדף הגלריה.

import {
    DOWNLOAD_SETTINGS_DOC_ID, DEFAULT_WATERMARK_TEXT, normalizeDownloadSettings, normalizeWatermarkText
} from './download-privacy.js';

const settingsRef = () => {
    const { doc } = window.firestoreModules;
    return doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', DOWNLOAD_SETTINGS_DOC_ID);
};

function fillForm(settings) {
    const enabled = document.getElementById('downloadWatermarkEnabled');
    const text = document.getElementById('downloadWatermarkText');
    const stripAll = document.getElementById('downloadStripAllMetadata');
    if (enabled) enabled.checked = settings.watermarkEnabled;
    if (text) text.value = settings.watermarkText;
    if (stripAll) stripAll.checked = settings.stripAllMetadata;
    window.updateDownloadWatermarkPreview();
}

// התצוגה המקדימה מראה את הטקסט שיצויר בפועל (כולל ברירת המחדל כשהשדה ריק),
// ומתעמעמת כשסימן המים כבוי.
window.updateDownloadWatermarkPreview = function() {
    const preview = document.getElementById('downloadWatermarkPreview');
    if (!preview) return;
    const enabled = document.getElementById('downloadWatermarkEnabled')?.checked;
    const text = normalizeWatermarkText(document.getElementById('downloadWatermarkText')?.value) || DEFAULT_WATERMARK_TEXT;
    preview.textContent = text;
    preview.closest('.download-watermark-preview')?.classList.toggle('is-off', !enabled);
};

window.renderDownloadPrivacyAdmin = async function() {
    const status = document.getElementById('downloadPrivacyStatus');
    if (!window.db || !window.firestoreModules?.getDoc) return;
    if (status) status.textContent = 'טוען את ההגדרה…';
    try {
        const snap = await window.firestoreModules.getDoc(settingsRef());
        window.state.downloadPrivacySettings = normalizeDownloadSettings(snap.exists() ? snap.data() : null);
        fillForm(window.state.downloadPrivacySettings);
        if (status) status.textContent = '';
    } catch (error) {
        console.warn('Download privacy settings load failed:', error);
        if (status) status.textContent = 'לא ניתן לטעון את ההגדרה. רענן ונסה שוב.';
    }
};

window.saveDownloadPrivacySettings = async function() {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    const button = document.getElementById('downloadPrivacySaveButton');
    const status = document.getElementById('downloadPrivacyStatus');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    if (status) status.textContent = 'שומר…';
    try {
        const settings = normalizeDownloadSettings({
            watermarkEnabled: document.getElementById('downloadWatermarkEnabled')?.checked === true,
            watermarkText: document.getElementById('downloadWatermarkText')?.value,
            stripAllMetadata: document.getElementById('downloadStripAllMetadata')?.checked === true
        });
        const { setDoc } = window.firestoreModules;
        await setDoc(settingsRef(), {
            ...settings,
            updatedAt: Date.now(),
            updatedBy: window.state.currentUser?.uid || ''
        });
        window.state.downloadPrivacySettings = settings;
        fillForm(settings);
        if (status) status.textContent = 'נשמר. ההגדרה חלה על ההורדות הבאות.';
        window.showNotification('הגדרות ההורדה נשמרו.', true);
    } catch (error) {
        if (status) status.textContent = 'שגיאה: ' + (error.message || 'השמירה נכשלה');
        window.showNotification('שגיאה בשמירת הגדרות ההורדה: ' + (error.message || ''), false);
    } finally {
        if (button) button.disabled = false;
    }
};
