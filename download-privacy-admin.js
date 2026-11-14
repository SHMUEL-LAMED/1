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
import { drawBrandMark, normalizeBrandOptions } from './brand-mark.js';

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
    const setValue = (id, value) => { const field = document.getElementById(id); if (field) field.value = String(value); };
    setValue('downloadWatermarkStyle', settings.watermarkStyle);
    setValue('downloadWatermarkPosition', settings.watermarkPosition);
    setValue('downloadWatermarkSize', settings.watermarkSize);
    setValue('downloadWatermarkOpacity', settings.watermarkOpacity);
    window.updateDownloadWatermarkPreview();
}

// התצוגה המקדימה מראה את הטקסט שיצויר בפועל (כולל ברירת המחדל כשהשדה ריק),
// ומתעמעמת כשסימן המים כבוי.
function readBrandForm() {
    return normalizeBrandOptions({
        watermarkStyle: document.getElementById('downloadWatermarkStyle')?.value,
        watermarkPosition: document.getElementById('downloadWatermarkPosition')?.value,
        watermarkSize: document.getElementById('downloadWatermarkSize')?.value,
        watermarkOpacity: document.getElementById('downloadWatermarkOpacity')?.value
    });
}

// "תמונה" לדוגמה לתצוגה המקדימה: שקיעה רכה עם קווי רכס, בלי קובץ חיצוני.
function paintSampleScene(context, width, height) {
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#20305f');
    sky.addColorStop(0.55, '#c9785a');
    sky.addColorStop(1, '#f2c48a');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    const glow = context.createRadialGradient(width * 0.62, height * 0.62, 4, width * 0.62, height * 0.62, height * 0.5);
    glow.addColorStop(0, 'rgba(255, 236, 190, .95)');
    glow.addColorStop(1, 'rgba(255, 236, 190, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    [['#3b2a4a', 0.72], ['#22182e', 0.84]].forEach(([color, base], layer) => {
        context.beginPath();
        context.moveTo(0, height);
        for (let x = 0; x <= width; x += width / 8) {
            context.lineTo(x, height * base - Math.sin((x / width) * Math.PI * (2 + layer) + layer) * height * 0.08);
        }
        context.lineTo(width, height);
        context.closePath();
        context.fillStyle = color;
        context.fill();
    });
}

// התצוגה המקדימה מציירת את הלוגו בדיוק כמו ההורדה (כולל ברירת המחדל כשהשדה
// ריק), ומתעמעמת כשסימן המים כבוי.
window.updateDownloadWatermarkPreview = function() {
    const preview = document.getElementById('downloadWatermarkPreview');
    const enabled = document.getElementById('downloadWatermarkEnabled')?.checked;
    const text = normalizeWatermarkText(document.getElementById('downloadWatermarkText')?.value) || DEFAULT_WATERMARK_TEXT;
    const brand = readBrandForm();
    if (preview) {
        preview.textContent = text;
        preview.closest('.download-watermark-preview')?.classList.toggle('is-off', !enabled);
    }
    const output = document.getElementById('downloadWatermarkOpacityValue');
    if (output) output.textContent = `${Math.round(brand.opacity * 100)}%`;
    const canvas = document.getElementById('downloadWatermarkCanvas');
    const context = canvas?.getContext?.('2d');
    if (!context) return;
    paintSampleScene(context, canvas.width, canvas.height);
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim() || 'sans-serif';
    drawBrandMark(context, canvas.width, canvas.height, text, brand, fontFamily);
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
            ...Object.fromEntries(Object.entries(readBrandForm()).map(([key, value]) => [`watermark${key[0].toUpperCase()}${key.slice(1)}`, value])),
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
