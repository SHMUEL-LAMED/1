// app.js — אתחול האתר, מצב משותף וחיבור בין שאר המודולים
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.


// lucide.createIcons() סורק את כל ה-DOM בכל קריאה — יקר מאד לגלריה גדולה.
// קריאות מרובות באותו frame מתמזגות לאחת, וכשיש container ידוע הסריקה
// מוגבלת אליו בלבד — קריאה ללא container גורמת לסריקת כל ה-DOM.

import { initDriveSync } from './drive-sync.js';
import { initGallery } from './gallery.js';
import './chat.js';
import { initAdmin } from './admin.js';
import './face-search.js';
import './face-index.js';

import { scheduleIconRefresh } from './ui/icons.js';
import './core/utils.js';
import './core/state.js';
import './ui/profile.js';
import { closeModal, openModal } from './ui/modals.js';
import './ui/admin-menu.js';
import { checkSuperAdminPermission } from './core/permissions.js';
import { R2_WORKER_BASE_URL, r2Request } from './services/r2-client.js';
import './features/backup.js';
import './features/analytics.js';
import './services/media-storage.js';
import './features/activity.js';
import './features/trash.js';
import './ui/theme.js';

window.sendDirectMail = function(recipientEmail, displayName) {
    if (!recipientEmail) {
        window.showNotification('אין כתובת מייל תקינה למשתמש זה.', false);
        return;
    }
    document.getElementById('directEmailTo').value = recipientEmail;
    document.getElementById('directEmailSubject').value = 'עדכון בנוגע לבקשת הגישה שלך לגלריית שמחת התורה';
    document.getElementById('directEmailBody').value = `שלום ${displayName || 'ידיד הישיבה'},

הבקשה שלך לגישה לגלריית שמחת התורה מעובדת כעת על ידי מנהלי המערכת.

בברכה,
צוות גלריית שמחת התורה`;
    openModal('directEmailModal');
};

window.submitDirectEmail = async function(event) {
    event?.preventDefault();
    if (!checkSuperAdminPermission()) return;
    const button = document.getElementById('directEmailSubmit');
    const payload = {
        to: document.getElementById('directEmailTo').value.trim(),
        subject: document.getElementById('directEmailSubject').value.trim(),
        text: document.getElementById('directEmailBody').value.trim()
    };
    if (button) button.disabled = true;
    try {
        await r2Request('/send-email', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        closeModal('directEmailModal');
        window.showNotification('הדוא״ל נשלח בהצלחה.', true);
        await window.logActivity('sent_email', 'user', '', payload.to, payload.subject);
    } catch (error) {
        window.showNotification(error.message || 'שליחת הדוא״ל נכשלה.', false);
    } finally {
        if (button) button.disabled = false;
    }
};

window.runSystemHealthCheck = async function() {
    const container = document.getElementById('systemHealthResults');
    if (!container) return;
    container.innerHTML = '<p class="text-xs text-cyan-300 text-center py-3">בודק את שירותי המערכת…</p>';

    const checks = [
        {
            label: 'Cloudflare D1 והתחברות',
            run: async () => {
                if (!window.db) throw new Error('מסד הנתונים עדיין לא מחובר');
                if (!window.state.currentUser) throw new Error('אין משתמש מחובר');
                return 'מחובר';
            }
        },
        {
            label: 'הרשאות מסד הנתונים',
            run: async () => {
                if (!window.state.isSuperAdmin) return 'בדיקה מלאה זמינה למנהל־על';
                const { collection, getDocs } = window.firestoreModules;
                await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'trashItems'));
                return 'סל המחזור מורשה';
            }
        },
        {
            label: 'Cloudflare R2',
            run: async () => {
                const response = await fetch(`${R2_WORKER_BASE_URL}/health`);
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload.bucketConnected !== true || payload.databaseConnected !== true) throw new Error(payload.message || 'האחסון אינו זמין');
                return 'R2 ו־D1 מחוברים';
            }
        },
        {
            label: 'זיהוי פנים',
            run: async () => typeof window.faceapi === 'undefined'
                ? 'ייטען בעת פתיחת חיפוש הפנים'
                : 'הספרייה נטענה'
        },
        {
            label: 'אינדוקס פנים בענן',
            run: async () => {
                const summary = await window.refreshFaceIndexSummary?.();
                if (!summary) throw new Error('מצב האינדוקס אינו זמין');
                return summary.ready
                    ? `מוכן — ${summary.indexedImages} תמונות, ${summary.faceCount} פרצופים`
                    : `נותרו ${summary.remainingImages} תמונות להכנה`;
            }
        },
        {
            label: 'Google Drive',
            run: async () => window.driveConnectionActive ? 'מחובר כעת' : 'לא מחובר — חבר בעת הצורך'
        }
    ];

    const results = [];
    for (const check of checks) {
        try {
            results.push({ label: check.label, ok: true, message: await check.run() });
        } catch (error) {
            results.push({ label: check.label, ok: false, message: error.message || 'הבדיקה נכשלה' });
        }
    }
    container.replaceChildren();
    results.forEach(result => {
        const row = document.createElement('div');
        row.className = `flex items-center gap-3 rounded-xl border p-3 ${result.ok ? 'border-emerald-400/15 bg-emerald-400/5' : 'border-red-400/20 bg-red-400/5'}`;
        row.innerHTML = `<i data-lucide="${result.ok ? 'circle-check' : 'circle-alert'}" class="w-4 h-4 ${result.ok ? 'text-emerald-300' : 'text-red-300'}"></i>`;
        const text = document.createElement('div');
        text.className = 'min-w-0';
        const title = document.createElement('p');
        title.className = 'text-[10px] font-bold text-slate-100';
        title.textContent = result.label;
        const detail = document.createElement('p');
        detail.className = `text-[9px] ${result.ok ? 'text-emerald-200/70' : 'text-red-200/70'}`;
        detail.textContent = result.message;
        text.append(title, detail);
        row.appendChild(text);
        container.appendChild(row);
    });
    scheduleIconRefresh();
};

function initAmbientArchiveBackground() {
    // הרקע נשאר סטטי לחלוטין: אין לולאת ציור ואין תגובה לתנועת העכבר.
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
}

initDriveSync();

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.setSiteTheme(document.documentElement.dataset.theme, false);
        initAmbientArchiveBackground();
        scheduleIconRefresh();
        initAdmin();
        initGallery();
        let showConstructionNotice = true;
        try {
            showConstructionNotice = sessionStorage.getItem('construction_notice_seen') !== '1';
            sessionStorage.setItem('construction_notice_seen', '1');
        } catch (error) {
            console.warn('Session storage is unavailable:', error);
        }
        if (showConstructionNotice && typeof window.showNotification === 'function') {
            setTimeout(() => window.showNotification('לתשומת לב: האתר עדיין בבנייה וייתכנו תקלות זמניות.', true, 'warning'), 700);
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
        }
    } catch (error) {
        console.error('UI initialization error:', error);
    }
});
