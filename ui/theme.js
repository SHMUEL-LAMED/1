// מצב בהיר/כהה ושמירת הבחירה
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { scheduleIconRefresh } from './icons.js';

function updateThemeToggleUI(theme) {
    const isLight = theme === 'light';
    const button = document.getElementById('themeToggleButton');
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');
    if (button) {
        button.setAttribute('aria-label', isLight ? 'מעבר למצב כהה' : 'מעבר למצב בהיר');
        button.setAttribute('aria-pressed', String(isLight));
    }
    if (icon) icon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    if (text) text.textContent = isLight ? 'כהה' : 'בהיר';
    scheduleIconRefresh();
}

window.setSiteTheme = function(theme, persist = true) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'light' ? '#f8fafc' : '#090b10');
    if (persist) {
        try {
            localStorage.setItem('simchat-color-theme', nextTheme);
        } catch (error) {
            console.warn('Theme preference could not be saved:', error);
        }
    }
    updateThemeToggleUI(nextTheme);
};

window.toggleSiteTheme = function() {
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    window.setSiteTheme(currentTheme === 'light' ? 'dark' : 'light');
};
