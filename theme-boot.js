// theme-boot.js — רץ ראשון, כסקריפט רגיל וחוסם ב-<head> (לא מודול), לפני הציור
// הראשון. היה סקריפט בתוך ה-HTML; הוא קובץ נפרד כדי שמדיניות ה-CSP לא תצטרך
// 'unsafe-inline' או גיבוב (ראו index.html). Vite אינו מאגד אותו — site-build.mjs
// מעתיק אותו כמות שהוא, ולכן אסור לו לייבא דבר.
(() => {
    // מצב התצוגה נקבע לפני הציור הראשון, כדי שלא תהיה הבזקה של המצב השני.
    try {
        const savedTheme = localStorage.getItem('simchat-color-theme');
        const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        document.documentElement.dataset.theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemTheme;
    } catch (error) {
        document.documentElement.dataset.theme = 'dark';
    }
    // קישור הזמנה לאירוע (#invite/<אסימון>): נשמר ללשונית ונמחק מהכתובת לפני
    // שכל סקריפט אחר נטען — כך הוא אינו נשאר בהיסטוריה ואינו נקרא בידי אחרים.
    // המימוש עצמו ב-invite-link.js, אחרי ההתחברות. בדף הגלריה בלבד.
    if (document.documentElement.dataset.page !== 'gallery') return;
    try {
        const invite = location.hash.match(/^#invite\/([A-Za-z0-9_-]{43})$/);
        if (invite) {
            sessionStorage.setItem('simchas_pending_invite', invite[1]);
            history.replaceState(null, document.title, location.pathname + location.search);
        }
    } catch (error) {
        // אחסון חסום: invite-link.js קורא את הכתובת בעצמו.
    }
})();
