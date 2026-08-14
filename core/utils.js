// עזרים משותפים: בריחת HTML, מזהים בטוחים, כתובות מדיה, גיבוב ופורמט
// פוצל מתוך app.js. הקוד עצמו לא שונה — רק מיקומו.

import { scheduleIconRefresh } from '../ui/icons.js';

export function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function safeRecordId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function safeIconName(value) {
    const icon = String(value ?? '').toLowerCase();
    return /^[a-z0-9-]{1,40}$/.test(icon) ? icon : 'folder';
}

export function safeImageUrl(value) {
    const url = String(value ?? '').trim();
    // קישורי thumbnail של Drive מבצעים כמה הפניות. קישור ישיר וקבוע
    // ל-googleusercontent מתאים יותר להצגה באתר ולמערכות בדיקת תמונות.
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === 'drive.google.com') {
            const queryId = parsedUrl.searchParams.get('id');
            const pathId = parsedUrl.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
            const driveFileId = queryId || pathId;
            if (driveFileId && /^[a-zA-Z0-9_-]{10,}$/.test(driveFileId)) {
                return `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveFileId)}=w1600`;
            }
        }
    } catch (error) {}
    if (/^https:\/\//i.test(url) || /^blob:/i.test(url) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) {
        return url;
    }
    return '';
}

export function isVideoRecord(record) {
    return record?.mediaType === 'video'
        || /^video\/(?:mp4|webm)$/i.test(String(record?.mimeType || ''))
        || /\.(?:mp4|webm)(?:[?#].*)?$/i.test(String(record?.url || record?.title || ''));
}

function handleImageError(imgElement) {
    imgElement.onerror = null;
    const fallback = document.createElement('div');
    fallback.className = `${imgElement.className} image-fallback`;
    fallback.setAttribute('role', 'img');
    fallback.setAttribute('aria-label', 'התמונה אינה זמינה');
    fallback.innerHTML = '<i data-lucide="image-off" aria-hidden="true"></i><span>התמונה אינה זמינה</span>';

    // בתצוגה המלאה שומרים את אלמנט התמונה כדי שמעבר לתמונה הבאה ימשיך לעבוד.
    if (imgElement.id === 'lightboxImage') {
        document.getElementById('lightboxImageFallback')?.remove();
        fallback.id = 'lightboxImageFallback';
        imgElement.hidden = true;
        imgElement.insertAdjacentElement('afterend', fallback);
    } else {
        imgElement.replaceWith(fallback);
    }
    scheduleIconRefresh();
}

async function sha256(message) {
    if (!message) return '';
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
        return dateStr;
    }
}

window.formatDate = formatDate;

function compressAndConvertImage(file, maxW = 800, maxH = 800, quality = 0.7) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.width;
                    let h = img.height;
                    if (!w || !h) { resolve(null); return; }
                    if (w > h) {
                        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                    } else if (h > maxH) {
                        w = Math.round(w * maxH / h); h = maxH;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(null); return; }
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (error) {
                    console.error('Image processing failed:', error);
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

window.compressAndConvertImage = compressAndConvertImage;

export function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    if (parts.length !== 2) throw new Error('נתוני התמונה אינם תקינים.');
    const mimeMatch = parts[0].match(/^data:([^;]+);base64$/i);
    if (!mimeMatch) throw new Error('סוג התמונה אינו נתמך.');
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeMatch[1] || 'image/jpeg' });
}

export function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

window.escapeHtml = escapeHtml;

window.safeRecordId = safeRecordId;

window.safeIconName = safeIconName;

window.safeImageUrl = safeImageUrl;

window.isVideoRecord = isVideoRecord;

window.handleImageError = handleImageError;

window.sha256 = sha256;

window.dataUrlToBlob = dataUrlToBlob;

window.formatBytes = formatBytes;
