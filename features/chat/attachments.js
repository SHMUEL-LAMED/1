// קבצים מצורפים: העלאה, הורדה ותצוגה מקדימה
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.


export let activeConversationAttachment = null;

// activeConversationAttachment מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveConversationAttachmentValue(value) {
    activeConversationAttachment = value;
}

let conversationAttachmentPreviewUrl = '';

// conversationAttachmentPreviewUrl מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setConversationAttachmentPreviewUrl(value) {
    conversationAttachmentPreviewUrl = value;
}

const CONVERSATION_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

const CONVERSATION_FILE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov',
    'mp3', 'm4a', 'wav', 'ogg', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'ppt', 'pptx', 'txt', 'csv', 'json', 'zip', 'rar', '7z'
]);

function safeAttachmentUrl(value) {
    try {
        const parsed = new URL(String(value || ''), window.location.href);
        return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
}

export function normalizeConversationAttachment(value) {
    if (!value || typeof value !== 'object') return null;
    const url = safeAttachmentUrl(value.url);
    if (!url) return null;
    return {
        url,
        key: String(value.key || value.r2Key || '').slice(0, 500),
        name: String(value.name || value.fileName || 'קובץ').slice(0, 180),
        type: String(value.type || value.mimeType || 'application/octet-stream').slice(0, 120),
        size: Math.max(0, Number(value.size) || 0),
        kind: value.kind === 'image' || String(value.type || '').startsWith('image/') ? 'image' : 'file'
    };
}

async function fetchConversationAttachment(url) {
    const safeUrl = safeAttachmentUrl(url);
    if (!safeUrl) throw new Error('כתובת הקובץ אינה תקינה.');
    const headers = new Headers();
    if (safeUrl.startsWith(`${window.R2_WORKER_BASE_URL}/media/`)) {
        headers.set('Authorization', `Bearer ${await window.getFirebaseIdToken()}`);
    }
    const response = await fetch(safeUrl, { headers });
    if (!response.ok) throw new Error('לא ניתן לפתוח את הקובץ.');
    return response.blob();
}

window.loadConversationImage = async function(image, url) {
    try {
        const blob = await fetchConversationAttachment(url);
        const objectUrl = URL.createObjectURL(blob);
        image.onload = () => URL.revokeObjectURL(objectUrl);
        image.src = objectUrl;
    } catch (error) {
        image.alt = 'התמונה אינה זמינה';
        image.classList.add('image-fallback');
    }
};

window.downloadConversationAttachment = async function(url, fileName) {
    try {
        const blob = await fetchConversationAttachment(url);
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = String(fileName || 'קובץ').replace(/[\\/:*?"<>|]+/g, '-');
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
        window.showNotification(error.message || 'הורדת הקובץ נכשלה.', false);
    }
};

export function conversationAttachmentCanPreview(attachment) {
    const type = String(attachment?.type || '').toLowerCase();
    const extension = String(attachment?.name || '').split('.').pop().toLowerCase();
    return attachment?.kind === 'image' ||
        type.startsWith('video/') ||
        type.startsWith('audio/') ||
        type === 'application/pdf' ||
        extension === 'pdf';
}

window.closeConversationAttachmentPreview = function() {
    const modal = document.getElementById('conversationAttachmentViewer');
    const content = document.getElementById('conversationAttachmentViewerContent');
    const objectUrl = modal?.dataset.objectUrl;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (modal) {
        modal.dataset.objectUrl = '';
        modal.classList.add('hidden');
    }
    content?.replaceChildren();
};

window.openConversationAttachment = async function(attachment) {
    const normalized = normalizeConversationAttachment(attachment);
    if (!normalized) {
        window.showNotification('הקובץ אינו זמין.', false);
        return;
    }
    if (!conversationAttachmentCanPreview(normalized)) {
        window.showNotification('אין תצוגה מקדימה לסוג הקובץ הזה. השתמש בכפתור ההורדה שלידו.', true, 'info');
        return;
    }
    const modal = document.getElementById('conversationAttachmentViewer');
    const content = document.getElementById('conversationAttachmentViewerContent');
    const title = document.getElementById('conversationAttachmentViewerTitle');
    const download = document.getElementById('conversationAttachmentViewerDownload');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="conversation-viewer-loading"><i data-lucide="loader-circle" class="w-7 h-7"></i><span>טוען תצוגה מקדימה…</span></div>';
    if (title) title.textContent = normalized.name || 'קובץ מצורף';
    if (download) download.onclick = () => window.downloadConversationAttachment(normalized.url, normalized.name);
    window.scheduleIconRefresh?.();
    try {
        const blob = await fetchConversationAttachment(normalized.url);
        if (modal.classList.contains('hidden')) return;
        const objectUrl = URL.createObjectURL(blob);
        modal.dataset.objectUrl = objectUrl;
        content.replaceChildren();
        const type = String(normalized.type || blob.type || '').toLowerCase();
        let viewer;
        if (normalized.kind === 'image' || type.startsWith('image/')) {
            viewer = document.createElement('img');
            viewer.alt = normalized.name || 'תמונה מצורפת';
        } else if (type.startsWith('video/')) {
            viewer = document.createElement('video');
            viewer.controls = true;
            viewer.playsInline = true;
        } else if (type.startsWith('audio/')) {
            viewer = document.createElement('audio');
            viewer.controls = true;
        } else {
            viewer = document.createElement('iframe');
            viewer.title = normalized.name || 'תצוגת PDF';
        }
        viewer.className = 'conversation-viewer-media';
        viewer.src = objectUrl;
        content.appendChild(viewer);
    } catch (error) {
        content.innerHTML = '<div class="conversation-viewer-error"><i data-lucide="file-warning" class="w-8 h-8"></i><strong>לא ניתן להציג את הקובץ</strong><span>אפשר לנסות להוריד אותו למחשב.</span></div>';
        window.scheduleIconRefresh?.();
    }
};

function renderConversationAttachmentPreview() {
    const preview = document.getElementById('conversationAttachmentPreview');
    if (!preview) return;
    if (conversationAttachmentPreviewUrl) {
        URL.revokeObjectURL(conversationAttachmentPreviewUrl);
        conversationAttachmentPreviewUrl = '';
    }
    preview.replaceChildren();
    if (!activeConversationAttachment) {
        preview.classList.add('hidden');
        return;
    }
    const file = activeConversationAttachment;
    preview.classList.remove('hidden');
    if (String(file.type || '').startsWith('image/')) {
        const image = document.createElement('img');
        conversationAttachmentPreviewUrl = URL.createObjectURL(file);
        image.src = conversationAttachmentPreviewUrl;
        image.alt = 'תצוגה מקדימה';
        preview.appendChild(image);
    } else {
        const icon = document.createElement('span');
        icon.className = 'conversation-file-icon';
        icon.innerHTML = '<i data-lucide="file" class="w-5 h-5"></i>';
        preview.appendChild(icon);
    }
    const details = document.createElement('div');
    details.className = 'min-w-0 flex-1';
    const name = document.createElement('strong');
    name.className = 'block text-xs text-slate-100 truncate';
    name.textContent = file.name || 'קובץ';
    const size = document.createElement('small');
    size.className = 'block text-[9px] text-slate-400 mt-0.5';
    size.textContent = window.formatBytes(file.size);
    details.append(name, size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'w-8 h-8 rounded-lg btn-secondary-dark grid place-items-center';
    remove.setAttribute('aria-label', 'הסרת הקובץ המצורף');
    remove.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
    remove.onclick = () => window.clearConversationAttachment();
    preview.append(details, remove);
    window.scheduleIconRefresh();
}

function conversationFileExtension(file) {
    return String(file?.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function setConversationAttachment(file, input = null) {
    if (!file) return false;
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > CONVERSATION_FILE_LIMIT_BYTES) {
        if (input) input.value = '';
        window.showNotification('אפשר לצרף קובץ בגודל עד 25MB.', false);
        return false;
    }
    const extension = conversationFileExtension(file);
    const supportedMime = /^(image|video|audio)\//.test(String(file.type || ''));
    if (!supportedMime && !CONVERSATION_FILE_EXTENSIONS.has(extension)) {
        if (input) input.value = '';
        window.showNotification('סוג הקובץ אינו נתמך. אפשר לשלוח תמונות, וידאו, שמע, מסמכים וקובצי ZIP.', false);
        return false;
    }
    activeConversationAttachment = file;
    renderConversationAttachmentPreview();
    const status = document.getElementById('conversationUploadStatus');
    if (status) status.textContent = `${file.name || 'קובץ'} · ${window.formatBytes(file.size)}`;
    return true;
}

window.handleConversationAttachment = function(input) {
    setConversationAttachment(input?.files?.[0], input);
};

window.handleConversationDrop = function(event) {
    event.preventDefault();
    event.currentTarget?.classList.remove('is-dragging');
    const files = event.dataTransfer?.files;
    if (files?.length) setConversationAttachment(files[0]);
};

window.handleConversationDragOver = function(event) {
    event.preventDefault();
    event.currentTarget?.classList.add('is-dragging');
};

window.handleConversationDragLeave = function(event) {
    if (!event.currentTarget?.contains(event.relatedTarget)) {
        event.currentTarget?.classList.remove('is-dragging');
    }
};

window.clearConversationAttachment = function() {
    activeConversationAttachment = null;
    const input = document.getElementById('conversationAttachmentInput');
    if (input) input.value = '';
    renderConversationAttachmentPreview();
};

async function uploadConversationForm(form, onProgress) {
    const token = await window.getFirebaseIdToken();
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `${window.R2_WORKER_BASE_URL}/upload`);
        request.timeout = 180000;
        request.setRequestHeader('Authorization', `Bearer ${token}`);
        request.upload.onprogress = event => {
            if (event.lengthComputable) onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        };
        request.onerror = () => reject(new Error('לא ניתן להתחבר לשרת הקבצים. בדוק את החיבור ונסה שוב.'));
        request.ontimeout = () => reject(new Error('העלאת הקובץ ארכה יותר משלוש דקות ונעצרה.'));
        request.onload = () => {
            let payload = null;
            try { payload = JSON.parse(request.responseText || '{}'); } catch {}
            if (request.status < 200 || request.status >= 300) {
                const error = new Error(payload?.message || payload?.error || `העלאת הקובץ נכשלה (שגיאה ${request.status}).`);
                error.status = request.status;
                error.code = payload?.code || 'upload_failed';
                reject(error);
                return;
            }
            resolve(payload);
        };
        request.send(form);
    });
}

export async function uploadConversationAttachment(file, messageId, conversationUid, onProgress) {
    const form = new FormData();
    form.append('file', file, file.name || 'attachment');
    form.append('imageId', `chat_${window.safeRecordId(messageId)}`);
    form.append('title', String(file.name || 'קובץ').slice(0, 120));
    form.append('context', 'chat');
    form.append('conversationUid', window.safeRecordId(conversationUid));
    const result = await uploadConversationForm(form, onProgress);
    if (!result?.url || !result?.key) throw new Error('שרת הקבצים לא החזיר קישור תקין.');
    return {
        url: result.url,
        key: result.key,
        name: String(result.fileName || file.name || 'קובץ').slice(0, 180),
        type: result.mimeType || file.type || 'application/octet-stream',
        size: Number(result.size) || file.size || 0,
        kind: result.mediaType === 'image' ? 'image' : 'file'
    };
}
