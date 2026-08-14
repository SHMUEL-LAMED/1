// הקריאות ל־Worker: אסימון, timeout וטיפול בשגיאות
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.


export const R2_WORKER_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';

export async function r2Request(path, options = {}) {
    const token = await window.getFirebaseIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
        response = await fetch(`${R2_WORKER_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('ההעלאה ארכה יותר מדי. בדוק את החיבור ונסה שוב.');
        throw new Error('לא ניתן להתחבר לשרת האחסון. נסה שוב בעוד רגע.');
    } finally {
        clearTimeout(timeoutId);
    }

    let payload = null;
    try { payload = await response.json(); } catch (error) {}
    if (!response.ok) {
        // הקוד והסטטוס נשמרים על אובייקט השגיאה כדי שקוראים יוכלו להבחין בין
        // עומס זמני, חוסר הרשאה ונתיב שאינו קיים ב-Worker הפרוס.
        const error = new Error(payload?.message || payload?.error || `שגיאת שרת האחסון (${response.status}).`);
        error.status = response.status;
        error.code = payload?.code || 'request_failed';
        throw error;
    }
    return payload;
}

window.r2Request = r2Request;

window.R2_WORKER_BASE_URL = R2_WORKER_BASE_URL;
