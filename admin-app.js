// admin-app.js — נקודת הכניסה של דף הניהול (admin.html).
//
// הדף הזה נפרד מהאתר בכוונה: הגלריה טוענת רק את app.js, ואילו כל קוד
// הניהול — admin.js ו-admin-ui.js — יורד רק כאן, כשמנהל באמת נכנס.
//
// סדר הייבוא חשוב: app.js מקים את התשתית המשותפת (state, התראות,
// מודלים, r2Request) ומאתחל את שכבת ההתחברות, ורק אחר כך מודולי הניהול
// נשענים עליה. ההתחברות עצמה שורדת את המעבר בין הדפים — האסימון שמור
// ב-localStorage — ולכן אין כאן כניסה מחדש.

import './app.js';
// סנכרון Drive ומאזיני נתוני הניהול נטענים כאן בלבד. app.js מביא את
// שכבת ההתחברות, והמודול הזה מתחבר אליה דרך window.
import './drive-sync.js';
import './popup-admin.js';
import { initAdmin } from './admin.js';
import './admin-ui.js';

// מנהל שנכנס ישירות לכתובת הדף בלי הרשאה לא יראה לוח ריק: המסך מסביר
// מה חסר ומציע חזרה לגלריה. הבדיקה חוזרת בכל שינוי מצב התחברות, כי
// ההרשאה האמיתית מגיעה מהשרת רגע אחרי טעינת הדף.
function renderAccessState() {
    const gate = document.getElementById('adminAccessGate');
    const panel = document.getElementById('sidebarAdminPanel');
    const title = document.getElementById('adminAccessGateTitle');
    const text = document.getElementById('adminAccessGateText');
    const isAdmin = Boolean(window.state?.isAdminLoggedIn);

    if (panel) panel.classList.toggle('hidden', !isAdmin);
    if (gate) gate.classList.toggle('hidden', isAdmin);
    if (isAdmin || !title || !text) return;

    if (!window.state?.currentUser) {
        title.textContent = 'לוח הניהול דורש התחברות';
        text.textContent = 'התחבר עם חשבון Google בעל הרשאת ניהול כדי לפתוח את הלוח.';
    } else {
        title.textContent = 'החשבון אינו מורשה לניהול';
        text.textContent = 'הלוח פתוח למנהלים בדרגה 3 ומעלה. אפשר לחזור לגלריה ולפנות למנהל־על.';
    }
}
window.renderAdminAccessState = renderAccessState;

// updateAdminPanelUI נקראת בכל ציור של שכבת הסשן, ולכן מצב הגישה
// מתעדכן יחד איתה בלי האזנה נוספת.
const updatePanel = window.updateAdminPanelUI;
window.updateAdminPanelUI = function() {
    renderAccessState();
    if (window.state?.isAdminLoggedIn) updatePanel?.();
};

// כניסה עם #messages מגיעה מכפתור "מרכז הודעות" שבאתר עצמו. מודול הצ׳אט
// נטען עצלה, ולכן ממתינים לו לפני הפתיחה.
function openRequestedSection() {
    if (window.location.hash !== '#messages' || !window.state?.isSuperAdmin) return;
    window.ensureChatAdminModule?.()
        .then(() => window.openAdminMessagesCenter?.())
        .catch(error => console.error('Chat module failed to load:', error));
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        renderAccessState();
        initAdmin();
        // ההרשאה מגיעה מהשרת רגע אחרי הטעינה, ולכן הפתיחה המבוקשת
        // ממתינה לה במקום לרוץ על מצב שעדיין לא התקבל.
        let openedRequestedSection = false;
        const timer = window.setInterval(() => {
            if (openedRequestedSection || !window.state?.isSuperAdmin) return;
            openedRequestedSection = true;
            window.clearInterval(timer);
            openRequestedSection();
        }, 400);
        window.setTimeout(() => window.clearInterval(timer), 15000);
    } catch (error) {
        console.error('Admin page initialization error:', error);
    }
});
