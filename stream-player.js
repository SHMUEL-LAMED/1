// stream-player.js — ניגון HLS מ-Cloudflare Stream בתצוגה המלאה (רשות).
//
// כשה-Worker מוגדר עם Cloudflare Stream, רשומת סרטון נושאת שדה stream:
// { uid, hls, iframe }. בתצוגה המלאה הסרטון מנוגן אז ב-HLS — האיכות מותאמת
// לרשת ולמסך — באותו <video> של האתר (אותם פקדים, אותו זיכרון מיקום).
// Safari מנגן HLS בעצמו; בשאר הדפדפנים hls.js נטען מ-cdnjs, ורק בפעם הראשונה
// שבאמת צריך אותו. סרטון בלי stream, או כל תקלה (הסרטון עדיין בעיבוד ב-Stream,
// הספרייה לא נטענה, שגיאת רשת קטלנית) — מנוגן מהמקור ב-R2, בדיוק כמו קודם.

export const HLS_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';

const STREAM_HOST_PATTERN = /^https:\/\/(?:videodelivery\.net|[a-z0-9-]+\.cloudflarestream\.com)\//i;

// מקור ה-HLS של רשומה, או '' כשאין (או כשהכתובת אינה של Stream).
export function pickStreamSource(record) {
    const stream = record?.stream;
    if (!stream || typeof stream !== 'object') return '';
    const hls = String(stream.hls || '');
    if (!STREAM_HOST_PATTERN.test(hls) || !/\.m3u8(?:\?|$)/i.test(hls)) return '';
    return hls;
}

export function canPlayHlsNatively(video) {
    try {
        return Boolean(video?.canPlayType?.('application/vnd.apple.mpegurl'));
    } catch {
        return false;
    }
}

let hlsLibraryPromise = null;

// טוען את hls.js פעם אחת לכל דף; כשל מאפשר ניסיון נוסף בפעם הבאה.
export function loadHlsLibrary(doc = globalThis.document, win = globalThis.window) {
    if (win?.Hls) return Promise.resolve(win.Hls);
    if (!hlsLibraryPromise) {
        hlsLibraryPromise = new Promise((resolve, reject) => {
            const script = doc.createElement('script');
            script.src = HLS_JS_URL;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.referrerPolicy = 'no-referrer';
            script.onload = () => (win.Hls ? resolve(win.Hls) : reject(new Error('hls.js לא נטען.')));
            script.onerror = () => reject(new Error('hls.js לא נטען.'));
            doc.head.appendChild(script);
        }).catch(error => {
            hlsLibraryPromise = null;
            throw error;
        });
    }
    return hlsLibraryPromise;
}

// מחבר את ה-<video> למקור: HLS כשיש, ונפילה למקור ב-R2 בכל כשל. מחזיר
// פונקציית ניקוי שמנתקת את hls.js (במעבר לפריט אחר או בסגירה).
export async function attachVideoPlayback(video, { record, fallbackUrl, loadLibrary = loadHlsLibrary } = {}) {
    const hls = pickStreamSource(record);
    const useFallback = () => {
        if (fallbackUrl && video.src !== fallbackUrl) {
            video.src = fallbackUrl;
            video.load();
        }
    };
    if (!hls) {
        useFallback();
        return () => {};
    }
    if (canPlayHlsNatively(video)) {
        const onError = () => { video.removeEventListener('error', onError); useFallback(); };
        video.addEventListener('error', onError);
        video.src = hls;
        video.load();
        return () => video.removeEventListener('error', onError);
    }
    let Hls;
    try {
        Hls = await loadLibrary();
    } catch (error) {
        useFallback();
        return () => {};
    }
    if (!Hls?.isSupported?.()) {
        useFallback();
        return () => {};
    }
    const player = new Hls({ capLevelToPlayerSize: true });
    let destroyed = false;
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        try { player.destroy(); } catch { /* כבר נוקה */ }
    };
    player.on(Hls.Events.ERROR, (event, data) => {
        if (!data?.fatal) return;
        // הסרטון עדיין בעיבוד ב-Stream, או שהרשת נפלה: חוזרים למקור.
        destroy();
        useFallback();
    });
    video.removeAttribute('src');
    player.loadSource(hls);
    player.attachMedia(video);
    return destroy;
}
