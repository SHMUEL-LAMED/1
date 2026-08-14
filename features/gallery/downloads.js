// הורדות: קובץ בודד, הורדה מרובה ושמות קבצים בטוחים
// פוצל מתוך gallery.js. הקוד עצמו לא שונה — רק מיקומו.


function safeDownloadFileName(name, fallback = 'תמונה') {
    const sanitized = String(name || fallback).replace(/[\\/:*?"<>|\r\n]+/g, '-').trim();
    return sanitized || fallback;
}

async function downloadGalleryMedia(item, fallbackName = 'תמונה') {
    const url = window.safeImageUrl(item?.url);
    if (!url) throw new Error('כתובת הקובץ אינה תקינה.');

    const headers = new Headers();
    if (url.startsWith(window.R2_WORKER_BASE_URL || '')) {
        try {
            const token = await window.getFirebaseIdToken();
            if (token) headers.set('Authorization', `Bearer ${token}`);
        } catch (error) {
            // תמונות מאושרות הן ציבוריות; אם אין אסימון עדיין מנסים להוריד אותן.
        }
    }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`הורדת הקובץ נכשלה (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = safeDownloadFileName(item?.title, fallbackName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

window.downloadGalleryMedia = async function(item) {
    try {
        await downloadGalleryMedia(item);
        window.showNotification('הקובץ הורד למחשב.');
    } catch (error) {
        console.error('Gallery media download failed:', error);
        window.showNotification(error.message || 'הורדת הקובץ נכשלה.', false);
    }
};

window.downloadSelectedMedia = async function() {
    const selected = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    if (!selected.length) {
        window.showNotification('לא נבחרו פריטים להורדה.', false);
        return;
    }
    let downloaded = 0;
    for (let index = 0; index < selected.length; index += 1) {
        try {
            await downloadGalleryMedia(selected[index], `media-${index + 1}`);
            downloaded += 1;
        } catch (error) {
            console.error('Bulk media download failed:', error);
        }
    }
    window.showNotification(
        downloaded === selected.length
            ? `${downloaded} פריטים הורדו למחשב.`
            : `הורדו ${downloaded} מתוך ${selected.length} פריטים.`,
        downloaded > 0
    );
};
