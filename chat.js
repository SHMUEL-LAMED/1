// chat.js — שיחות, הודעות, קבצים מצורפים, אמוג׳ים ומדבקות
// מודול עצמאי כדי שממשק הניהול לא יישא את כל לוגיקת הצ׳אט.

const adminMessageRecipients = new Set();
let adminMessageSending = false;
let activeConversationUid = '';
let activeConversationMode = '';
let conversationSending = false;
let activeConversationAttachment = null;
let conversationAttachmentPreviewUrl = '';
const CONVERSATION_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const CONVERSATION_FILE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov',
    'mp3', 'm4a', 'wav', 'ogg', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'ppt', 'pptx', 'txt', 'csv', 'json', 'zip', 'rar', '7z'
]);
const CONVERSATION_EMOJI_GROUPS = [
    { id: 'recent', label: 'נפוצים', icon: 'clock-3', emojis: ['😊','😂','😍','👍','🙏','❤️','🎉','🔥','👏','😇','🤝','✅'] },
    { id: 'faces', label: 'פנים', icon: 'smile', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😋','😎','🤓','🧐','🤔','🤗','🤭','🤫','😐','😑','😶','🙄','😏','😣','😥','😮','😯','😲','😴','🤤','😪','😵','🤐','🥴','🤢','🤧','🥳','🥺','😭','😤','😡'] },
    { id: 'gestures', label: 'ידיים', icon: 'hand', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','👏','🙌','👐','🤲','🙏','✍️','💪'] },
    { id: 'hearts', label: 'לבבות', icon: 'heart', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'] },
    { id: 'objects', label: 'סמלים', icon: 'sparkles', emojis: ['🎉','🎊','🎈','🎁','🏆','🥇','⭐','🌟','✨','⚡','🔥','💥','✅','❌','❗','❓','💯','📸','📎','📁','🖼️','🔔','💬','📅','🕐'] }
];
let activeEmojiGroup = 'recent';
let activeStickerPack = 'greetings';
let activeConversationSticker = null;
let adminConversationFilter = 'all';
const CONVERSATION_STICKER_PACKS = [
    {
        id: 'greetings', label: 'ברכות', icon: 'party-popper',
        stickers: [
            { id: 'great', emoji: '👍', label: 'מעולה!', tone: 'gold' },
            { id: 'thanks', emoji: '🙏', label: 'תודה רבה', tone: 'blue' },
            { id: 'mazal', emoji: '🎉', label: 'מזל טוב!', tone: 'purple' },
            { id: 'respect', emoji: '👏', label: 'כל הכבוד', tone: 'green' },
            { id: 'love', emoji: '❤️', label: 'באהבה', tone: 'red' },
            { id: 'closed', emoji: '🤝', label: 'סגרנו', tone: 'blue' },
            { id: 'done', emoji: '✅', label: 'טופל!', tone: 'green' },
            { id: 'strong', emoji: '🔥', label: 'חזק ביותר', tone: 'orange' }
        ]
    },
    {
        id: 'moods', label: 'תגובות', icon: 'laugh',
        stickers: [
            { id: 'funny', emoji: '😂', label: 'קורע!', tone: 'gold' },
            { id: 'happy', emoji: '😊', label: 'בשמחה', tone: 'green' },
            { id: 'wow', emoji: '😮', label: 'וואו!', tone: 'purple' },
            { id: 'champ', emoji: '😎', label: 'אלוף', tone: 'blue' },
            { id: 'checking', emoji: '🤔', label: 'בודק…', tone: 'gold' },
            { id: 'later', emoji: '👋', label: 'נדבר', tone: 'blue' },
            { id: 'party', emoji: '🥳', label: 'חגיגה!', tone: 'purple' },
            { id: 'hundred', emoji: '💯', label: 'מאה אחוז', tone: 'red' }
        ]
    },
    {
        id: 'gallery', label: 'הגלריה', icon: 'images',
        stickers: [
            { id: 'nice-photo', emoji: '📸', label: 'תמונה יפה!', tone: 'blue' },
            { id: 'learning', emoji: '📚', label: 'לומדים', tone: 'green' },
            { id: 'music', emoji: '🎵', label: 'שמח כאן', tone: 'purple' },
            { id: 'moving', emoji: '🕯️', label: 'מרגש', tone: 'gold' },
            { id: 'winners', emoji: '🏆', label: 'אלופים!', tone: 'gold' },
            { id: 'special', emoji: '✨', label: 'מיוחד', tone: 'purple' },
            { id: 'see-you', emoji: '📅', label: 'נתראה', tone: 'blue' },
            { id: 'ashreichem', emoji: '🙌', label: 'אשריכם!', tone: 'green' }
        ]
    }
];

function conversationStickerById(id) {
    for (const pack of CONVERSATION_STICKER_PACKS) {
        const sticker = pack.stickers.find(item => item.id === id);
        if (sticker) return sticker;
    }
    return null;
}

function normalizeConversationSticker(value) {
    const id = window.safeRecordId(typeof value === 'string' ? value : value?.id);
    const sticker = conversationStickerById(id);
    return sticker ? { id: sticker.id } : null;
}

function messageDirection(message) {
    return message?.direction === 'user_to_admin' ? 'user_to_admin' : 'admin_to_user';
}

function safeAttachmentUrl(value) {
    try {
        const parsed = new URL(String(value || ''), window.location.href);
        return parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
}

function normalizeConversationAttachment(value) {
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

function conversationAttachmentCanPreview(attachment) {
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

function conversationEntries(profile) {
    const entries = [];
    const messages = Array.isArray(profile?.messages) ? profile.messages : [];
    messages.forEach((message, index) => {
        const messageAttachment = normalizeConversationAttachment(message?.attachment);
        const messageSticker = normalizeConversationSticker(message?.sticker);
        if (!message || (!String(message.text || '').trim() && !messageAttachment && !messageSticker)) return;
        entries.push({
            id: window.safeRecordId(message.id) || `legacy_${index}`,
            text: String(message.text || ''),
            direction: messageDirection(message),
            sentAt: message.sentAt || 0,
            sender: message.sender || (messageDirection(message) === 'user_to_admin' ? profile.displayName : 'מנהל הגלריה'),
            attachment: messageAttachment,
            sticker: messageSticker,
            read: messageDirection(message) === 'user_to_admin' ? message.readByAdmin === true : message.read === true,
            readAt: messageDirection(message) === 'user_to_admin' ? message.readByAdminAt : message.readAt
        });
        const replyAttachment = normalizeConversationAttachment(message?.reply?.attachment);
        const replySticker = normalizeConversationSticker(message?.reply?.sticker);
        if (message.reply && (String(message.reply.text || '').trim() || replyAttachment || replySticker)) {
            entries.push({
                id: `${window.safeRecordId(message.id) || `legacy_${index}`}_reply`,
                text: String(message.reply.text || ''),
                direction: 'user_to_admin',
                sentAt: message.reply.sentAt || message.sentAt || 0,
                sender: message.reply.senderName || profile.displayName || 'משתמש',
                attachment: replyAttachment,
                sticker: replySticker,
                read: message.reply.readByAdmin === true,
                readAt: message.reply.readByAdminAt
            });
        }
    });
    return entries.sort((a, b) => {
        const aTime = new Date(a.sentAt || 0).getTime() || Number(a.sentAt || 0) || 0;
        const bTime = new Date(b.sentAt || 0).getTime() || Number(b.sentAt || 0) || 0;
        return aTime - bTime;
    });
}

function activeConversationProfile() {
    if (activeConversationMode === 'admin') {
        return (window.state.allUsers || []).find(user => window.safeRecordId(user.uid) === window.safeRecordId(activeConversationUid)) || null;
    }
    return window.state.userProfile || null;
}

window.renderActiveConversation = function() {
    const modal = document.getElementById('conversationModal');
    const stream = document.getElementById('conversationMessages');
    if (!stream || !modal || modal.classList.contains('hidden')) return;
    const profile = activeConversationProfile();
    const entries = conversationEntries(profile);
    const resolveButton = document.getElementById('conversationResolveButton');
    if (resolveButton) {
        const visible = activeConversationMode === 'admin';
        const resolved = profile?.supportStatus === 'resolved';
        resolveButton.classList.toggle('hidden', !visible);
        resolveButton.classList.toggle('flex', visible);
        resolveButton.innerHTML = resolved
            ? '<i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>פתח מחדש</span>'
            : '<i data-lucide="circle-check-big" class="w-4 h-4"></i><span>סמן כטופל</span>';
    }
    stream.replaceChildren();
    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'h-full flex flex-col items-center justify-center text-center text-slate-500 gap-3';
        empty.innerHTML = '<i data-lucide="message-circle" class="w-10 h-10 text-cyan-300/60"></i><p class="text-sm font-bold">עדיין אין הודעות בשיחה</p><p class="text-[10px]">כתוב הודעה ראשונה למטה.</p>';
        stream.appendChild(empty);
    } else {
        entries.forEach(entry => {
            const bubble = document.createElement('article');
            bubble.className = `conversation-bubble ${entry.direction === 'user_to_admin' ? 'is-user' : 'is-admin'} ${entry.sticker && !entry.text && !entry.attachment ? 'is-sticker' : ''}`;
            const sender = document.createElement('strong');
            sender.className = 'block text-[9px] mb-1 opacity-70';
            sender.textContent = entry.direction === 'user_to_admin'
                ? (profile?.displayName || entry.sender || 'משתמש')
                : (entry.sender || 'מנהל הגלריה');
            bubble.appendChild(sender);
            if (entry.text) {
                const text = document.createElement('p');
                text.className = 'text-xs sm:text-sm leading-relaxed';
                text.textContent = entry.text;
                bubble.appendChild(text);
            }
            if (entry.sticker) {
                const sticker = conversationStickerById(entry.sticker.id);
                if (sticker) {
                    const stickerCard = document.createElement('div');
                    stickerCard.className = `conversation-sticker conversation-sticker-${sticker.tone}`;
                    stickerCard.setAttribute('aria-label', sticker.label);
                    const emoji = document.createElement('span');
                    emoji.className = 'conversation-sticker-emoji';
                    emoji.textContent = sticker.emoji;
                    const label = document.createElement('strong');
                    label.textContent = sticker.label;
                    stickerCard.append(emoji, label);
                    bubble.appendChild(stickerCard);
                }
            }
            if (entry.attachment) {
                const attachmentBox = document.createElement('div');
                attachmentBox.className = 'conversation-attachment';
                const canPreview = conversationAttachmentCanPreview(entry.attachment);

                if (entry.attachment.kind === 'image') {
                    const imageButton = document.createElement('button');
                    imageButton.type = 'button';
                    imageButton.className = 'conversation-image-preview';
                    imageButton.title = 'פתיחת התמונה';
                    const image = document.createElement('img');
                    image.className = 'conversation-attachment-image';
                    image.alt = entry.attachment.name || 'תמונה מצורפת';
                    const overlay = document.createElement('span');
                    overlay.innerHTML = '<i data-lucide="maximize-2" class="w-4 h-4"></i><span>פתח תצוגה</span>';
                    imageButton.append(image, overlay);
                    imageButton.onclick = () => window.openConversationAttachment(entry.attachment);
                    attachmentBox.appendChild(imageButton);
                    window.loadConversationImage(image, entry.attachment.url);
                } else {
                    const fileRow = document.createElement('div');
                    fileRow.className = 'conversation-file-row';

                    const fileButton = document.createElement('button');
                    fileButton.type = 'button';
                    fileButton.className = 'conversation-file-card';
                    fileButton.title = canPreview ? 'פתיחת תצוגה מקדימה' : 'הורדת הקובץ';
                    const icon = document.createElement('span');
                    icon.className = 'conversation-file-icon';
                    icon.innerHTML = canPreview
                        ? '<i data-lucide="file-search" class="w-5 h-5"></i>'
                        : '<i data-lucide="file" class="w-5 h-5"></i>';
                    const details = document.createElement('span');
                    details.className = 'min-w-0 flex-1';
                    const name = document.createElement('strong');
                    name.className = 'block text-[11px] truncate';
                    name.textContent = entry.attachment.name;
                    const size = document.createElement('small');
                    size.className = 'block mt-0.5 text-[9px] opacity-65';
                    const sizeLabel = entry.attachment.size ? window.formatBytes(entry.attachment.size) : 'קובץ מצורף';
                    size.textContent = `${sizeLabel} · ${canPreview ? 'לחץ לפתיחה' : 'זמין להורדה'}`;
                    details.append(name, size);
                    fileButton.append(icon, details);
                    fileButton.onclick = () => window.openConversationAttachment(entry.attachment);

                    const downloadButton = document.createElement('button');
                    downloadButton.type = 'button';
                    downloadButton.className = 'conversation-file-download';
                    downloadButton.title = 'הורדת הקובץ';
                    downloadButton.setAttribute('aria-label', `הורדת ${entry.attachment.name}`);
                    downloadButton.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i>';
                    downloadButton.onclick = event => {
                        event.stopPropagation();
                        window.downloadConversationAttachment(entry.attachment.url, entry.attachment.name);
                    };

                    fileRow.append(fileButton, downloadButton);
                    attachmentBox.appendChild(fileRow);
                }
                bubble.appendChild(attachmentBox);
            }
            const time = document.createElement('time');
            time.textContent = window.formatDate(entry.sentAt);
            bubble.appendChild(time);
            const outgoingForViewer =
                (activeConversationMode === 'admin' && entry.direction === 'admin_to_user') ||
                (activeConversationMode === 'user' && entry.direction === 'user_to_admin');
            if (outgoingForViewer) {
                const receipt = document.createElement('span');
                receipt.className = `conversation-receipt ${entry.read ? 'is-read' : ''}`;
                receipt.innerHTML = entry.read
                    ? '<i data-lucide="check-check" class="w-3.5 h-3.5"></i><span>נקראה</span>'
                    : '<i data-lucide="check" class="w-3.5 h-3.5"></i><span>נשלחה</span>';
                if (entry.readAt) receipt.title = `נקראה: ${window.formatDate(entry.readAt)}`;
                bubble.appendChild(receipt);
            }
            stream.appendChild(bubble);
        });
    }
    window.scheduleIconRefresh();
    requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
};

async function markConversationRead() {
    const profile = activeConversationProfile();
    const uid = activeConversationMode === 'admin' ? activeConversationUid : window.state.currentUser?.uid;
    if (!profile || !uid) return;
    try {
        const { mutateConversationMessages } = window.firestoreModules;
        const result = await mutateConversationMessages(uid, 'mark_read');
        profile.messages = Array.isArray(result?.messages) ? result.messages : profile.messages;
        window.renderFloatingInbox?.();
        window.renderAdminMessageReplies?.();
    } catch (error) {
        console.warn('Marking conversation read failed:', error);
    }
}

window.openUserConversation = function() {
    if (!window.state.currentUser || !window.state.userProfile) {
        window.showNotification('יש להתחבר באמצעות Google כדי לפנות למנהל.', false);
        return;
    }
    activeConversationMode = 'user';
    activeConversationUid = window.state.currentUser.uid;
    const title = document.getElementById('conversationTitle');
    const subtitle = document.getElementById('conversationSubtitle');
    if (title) title.textContent = 'צ׳אט עם מנהל הגלריה';
    if (subtitle) subtitle.textContent = 'אפשר לשלוח פנייה ולהמשיך את השיחה כאן';
    document.getElementById('conversationResolveButton')?.classList.add('hidden');
    document.getElementById('floatingProfilePanel')?.classList.remove('active');
    window.openModal('conversationModal');
    window.renderActiveConversation();
    markConversationRead().catch(error => console.warn('Marking user chat read failed:', error));
};

window.openAdminConversation = function(uid) {
    if (!window.checkSuperAdminPermission()) return;
    const profile = (window.state.allUsers || []).find(user => window.safeRecordId(user.uid) === window.safeRecordId(uid));
    if (!profile) {
        window.showNotification('המשתמש לא נמצא במערכת.', false);
        return;
    }
    activeConversationMode = 'admin';
    activeConversationUid = profile.uid;
    const title = document.getElementById('conversationTitle');
    const subtitle = document.getElementById('conversationSubtitle');
    if (title) title.textContent = profile.displayName || 'שיחה עם משתמש';
    if (subtitle) subtitle.textContent = profile.email || 'שיחה ישירה באזור האישי';
    window.openModal('conversationModal');
    window.renderActiveConversation();
    markConversationRead().catch(error => console.warn('Marking admin chat read failed:', error));
};

window.toggleConversationResolved = async function() {
    if (!window.checkSuperAdminPermission() || activeConversationMode !== 'admin') return;
    const profile = activeConversationProfile();
    if (!profile) return;
    const resolved = profile.supportStatus === 'resolved';
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', profile.uid), {
            supportStatus: resolved ? 'open' : 'resolved',
            supportResolvedAt: resolved ? null : Date.now(),
            supportResolvedBy: resolved ? null : (window.state.currentUser?.uid || '')
        }, { merge: true });
        profile.supportStatus = resolved ? 'open' : 'resolved';
        window.renderActiveConversation();
        window.renderAdminMessageReplies?.();
        await window.logActivity(resolved ? 'reopened_support' : 'resolved_support', 'user', profile.uid, profile.displayName || profile.email || profile.uid);
        window.showNotification(resolved ? 'הפנייה נפתחה מחדש.' : 'הפנייה סומנה כטופלה.');
    } catch (error) {
        console.error('toggleConversationResolved failed:', error);
        window.showNotification('עדכון סטטוס הפנייה נכשל.', false);
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

async function uploadConversationAttachment(file, messageId, conversationUid, onProgress) {
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

window.handleConversationKeydown = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        window.sendConversationMessage();
    }
};

window.updateConversationCharacterCount = function() {
    const input = document.getElementById('conversationInput');
    const counter = document.getElementById('conversationCharacterCount');
    if (counter) counter.textContent = `${String(input?.value || '').length}/1500`;
};

window.setConversationEmojiGroup = function(groupId) {
    activeEmojiGroup = CONVERSATION_EMOJI_GROUPS.some(group => group.id === groupId) ? groupId : 'recent';
    window.renderConversationEmojiPicker();
};

window.renderConversationEmojiPicker = function() {
    const tabs = document.getElementById('conversationEmojiTabs');
    const grid = document.getElementById('conversationEmojiGrid');
    if (!tabs || !grid) return;
    tabs.replaceChildren();
    CONVERSATION_EMOJI_GROUPS.forEach(group => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `conversation-emoji-tab ${group.id === activeEmojiGroup ? 'is-active' : ''}`;
        tab.title = group.label;
        tab.setAttribute('aria-label', group.label);
        tab.innerHTML = `<i data-lucide="${group.icon}" class="w-4 h-4"></i>`;
        tab.onclick = () => window.setConversationEmojiGroup(group.id);
        tabs.appendChild(tab);
    });
    grid.replaceChildren();
    const group = CONVERSATION_EMOJI_GROUPS.find(item => item.id === activeEmojiGroup) || CONVERSATION_EMOJI_GROUPS[0];
    group.emojis.forEach(emoji => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'conversation-emoji';
        button.textContent = emoji;
        button.setAttribute('aria-label', `הוספת ${emoji}`);
        button.onclick = () => window.insertConversationEmoji(emoji);
        grid.appendChild(button);
    });
    window.scheduleIconRefresh?.();
};

window.toggleConversationEmojiPicker = function(force) {
    const picker = document.getElementById('conversationEmojiPicker');
    const button = document.getElementById('conversationEmojiButton');
    if (!picker) return;
    const shouldOpen = typeof force === 'boolean' ? force : picker.classList.contains('hidden');
    picker.classList.toggle('hidden', !shouldOpen);
    button?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        window.toggleConversationStickerPicker(false);
        window.renderConversationEmojiPicker();
    }
};

window.insertConversationEmoji = function(emoji) {
    const input = document.getElementById('conversationInput');
    if (!input) return;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`.slice(0, 1500);
    const cursor = Math.min(input.value.length, start + emoji.length);
    input.focus();
    input.setSelectionRange(cursor, cursor);
    window.updateConversationCharacterCount();
};

window.setConversationStickerPack = function(packId) {
    activeStickerPack = CONVERSATION_STICKER_PACKS.some(pack => pack.id === packId) ? packId : 'greetings';
    window.renderConversationStickerPicker();
};

window.renderConversationStickerPicker = function() {
    const tabs = document.getElementById('conversationStickerTabs');
    const grid = document.getElementById('conversationStickerGrid');
    if (!tabs || !grid) return;
    tabs.replaceChildren();
    CONVERSATION_STICKER_PACKS.forEach(pack => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `conversation-sticker-tab ${pack.id === activeStickerPack ? 'is-active' : ''}`;
        tab.title = pack.label;
        tab.innerHTML = `<i data-lucide="${pack.icon}" class="w-4 h-4"></i><span>${pack.label}</span>`;
        tab.onclick = () => window.setConversationStickerPack(pack.id);
        tabs.appendChild(tab);
    });
    grid.replaceChildren();
    const pack = CONVERSATION_STICKER_PACKS.find(item => item.id === activeStickerPack) || CONVERSATION_STICKER_PACKS[0];
    pack.stickers.forEach(sticker => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `conversation-sticker-choice conversation-sticker-${sticker.tone}`;
        button.setAttribute('aria-label', `שליחת מדבקה: ${sticker.label}`);
        const emoji = document.createElement('span');
        emoji.textContent = sticker.emoji;
        const label = document.createElement('strong');
        label.textContent = sticker.label;
        button.append(emoji, label);
        button.onclick = () => window.sendConversationSticker(sticker.id);
        grid.appendChild(button);
    });
    window.scheduleIconRefresh?.();
};

window.toggleConversationStickerPicker = function(force) {
    const picker = document.getElementById('conversationStickerPicker');
    const button = document.getElementById('conversationStickerButton');
    if (!picker) return;
    const shouldOpen = typeof force === 'boolean' ? force : picker.classList.contains('hidden');
    picker.classList.toggle('hidden', !shouldOpen);
    button?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
        window.toggleConversationEmojiPicker(false);
        window.renderConversationStickerPicker();
    }
};

window.sendConversationSticker = function(stickerId) {
    const sticker = conversationStickerById(stickerId);
    if (!sticker || conversationSending) return;
    activeConversationSticker = { id: sticker.id };
    window.toggleConversationStickerPicker(false);
    window.sendConversationMessage();
};

window.sendConversationMessage = async function() {
    if (conversationSending) return;
    const input = document.getElementById('conversationInput');
    const button = document.getElementById('conversationSendButton');
    const status = document.getElementById('conversationUploadStatus');
    const sticker = normalizeConversationSticker(activeConversationSticker);
    const text = sticker ? '' : String(input?.value || '').trim().slice(0, 1500);
    const file = sticker ? null : activeConversationAttachment;
    if (!text && !file && !sticker) return;
    const profile = activeConversationProfile();
    const uid = activeConversationMode === 'admin' ? activeConversationUid : window.state.currentUser?.uid;
    if (!profile || !uid) return;

    conversationSending = true;
    if (button) button.disabled = true;
    document.getElementById('conversationAttachmentButton')?.setAttribute('disabled', '');
    document.getElementById('conversationEmojiButton')?.setAttribute('disabled', '');
    document.getElementById('conversationStickerButton')?.setAttribute('disabled', '');

    let attachment = null;
    try {
        const messageId = crypto.randomUUID();
        if (status && file) status.textContent = 'מכין את הקובץ להעלאה…';
        attachment = file
            ? await uploadConversationAttachment(file, messageId, uid, progress => {
                if (status) status.textContent = `מעלה את הקובץ… ${progress}%`;
            })
            : null;
        const message = { id: messageId, text, attachment, sticker };
        const { mutateConversationMessages } = window.firestoreModules;
        const result = await mutateConversationMessages(uid, 'append', { message });
        const updatedMessages = Array.isArray(result?.messages) ? result.messages : profile.messages;
        profile.messages = updatedMessages;
        if (activeConversationMode !== 'admin') profile.supportStatus = 'open';

        if (!sticker) {
            if (input) input.value = '';
            window.updateConversationCharacterCount();
            window.clearConversationAttachment();
            if (status) status.textContent = 'תמונות וקבצים עד 25MB';
        }
        window.toggleConversationEmojiPicker(false);
        window.toggleConversationStickerPicker(false);
        activeConversationSticker = null;
        window.renderActiveConversation();
        window.renderFloatingInbox?.();
        window.renderAdminMessageReplies?.();
    } catch (error) {
        activeConversationSticker = null;
        console.error('Conversation message failed:', error);
        if (attachment?.key && error?.status && error.status < 500 && error.status !== 409) {
            window.firestoreModules.deleteConversationAttachmentObject(attachment.key)
                .catch(cleanupError => console.warn('Orphan chat attachment cleanup failed:', cleanupError));
        }
        if (status) status.textContent = 'ההעלאה או השליחה נכשלה';
        window.showNotification(error.message || 'שליחת ההודעה נכשלה. הטיוטה נשמרה ואפשר לנסות שוב.', false);
    } finally {
        conversationSending = false;
        if (button) button.disabled = false;
        document.getElementById('conversationAttachmentButton')?.removeAttribute('disabled');
        document.getElementById('conversationEmojiButton')?.removeAttribute('disabled');
        document.getElementById('conversationStickerButton')?.removeAttribute('disabled');
        input?.focus();
    }
};


function adminMessageCenterUsers() {
    const query = String(document.getElementById('adminMessageUserSearch')?.value || '').trim().toLowerCase();
    const source = Array.isArray(window.state.allUsers) ? window.state.allUsers : [];
    const unique = new Map();
    source.forEach(user => {
        const uid = window.safeRecordId(user?.uid);
        if (uid) unique.set(uid, { ...user, uid });
    });
    return Array.from(unique.values())
        .filter(user => {
            const haystack = `${user.displayName || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase();
            return !query || haystack.includes(query);
        })
        .sort((a, b) => String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || ''), 'he'));
}

window.updateAdminMessageCenterUI = function() {
    const text = String(document.getElementById('adminBulkMessageText')?.value || '');
    const selectedCount = adminMessageRecipients.size;
    const summary = document.getElementById('adminMessageSelectionSummary');
    const characterCount = document.getElementById('adminBulkMessageCharacterCount');
    const sendButton = document.getElementById('adminBulkMessageSendBtn');
    const sendText = document.getElementById('adminBulkMessageSendText');

    if (summary) summary.textContent = selectedCount ? `${selectedCount} נמענים נבחרו` : 'לא נבחרו נמענים';
    if (characterCount) characterCount.textContent = `${text.length}/1500`;
    if (sendText) sendText.textContent = selectedCount > 1 ? `שלח ל־${selectedCount} משתמשים` : 'שלח הודעה';
    if (sendButton) sendButton.disabled = adminMessageSending || !selectedCount || !text.trim();

    document.querySelectorAll('[data-admin-message-user]').forEach(card => {
        const selected = adminMessageRecipients.has(card.dataset.adminMessageUser);
        card.classList.toggle('is-selected', selected);
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = selected;
    });
};

window.renderAdminMessageUsers = function() {
    const list = document.getElementById('adminMessageUsersList');
    const summary = document.getElementById('adminMessageUsersSummary');
    if (!list) return;
    // רשימת הנמענים במרכז ההודעות — מנהל־על בלבד.
    if (!window.canViewSuperAdminData?.()) {
        list.replaceChildren();
        if (summary) summary.textContent = '';
        return;
    }
    const users = adminMessageCenterUsers();
    list.replaceChildren();
    if (summary) summary.textContent = `${users.length} משתמשים · ${adminMessageRecipients.size} נבחרו`;
    const usersStat = document.getElementById('adminMessagesUsersStat');
    const selectedStat = document.getElementById('adminMessagesSelectedStat');
    if (usersStat) usersStat.textContent = String(users.length);
    if (selectedStat) selectedStat.textContent = String(adminMessageRecipients.size);

    if (!users.length) {
        const empty = document.createElement('p');
        empty.className = 'sm:col-span-2 text-sm text-slate-500 text-center py-10';
        empty.textContent = 'לא נמצאו משתמשים.';
        list.appendChild(empty);
        window.updateAdminMessageCenterUI();
        return;
    }

    const roleLabels = {
        viewer: 'דרגה 1 — צופה',
        uploader: 'דרגה 2 — מעלה תמונות',
        admin: 'דרגה 3 — מנהל',
        super_admin: 'דרגה 4 — מנהל־על'
    };
    users.forEach(user => {
        const card = document.createElement('label');
        card.dataset.adminMessageUser = user.uid;
        card.className = 'admin-message-user-card';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'mt-1 accent-amber-400 w-4 h-4 shrink-0';
        checkbox.checked = adminMessageRecipients.has(user.uid);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) adminMessageRecipients.add(user.uid);
            else adminMessageRecipients.delete(user.uid);
            window.updateAdminMessageCenterUI();
            if (summary) summary.textContent = `${users.length} משתמשים · ${adminMessageRecipients.size} נבחרו`;
            const selectedStat = document.getElementById('adminMessagesSelectedStat');
            if (selectedStat) selectedStat.textContent = String(adminMessageRecipients.size);
        });

        const avatar = document.createElement('span');
        avatar.className = 'admin-message-user-avatar';
        if (user.photoURL) {
            const image = document.createElement('img');
            image.src = window.safeImageUrl(user.photoURL);
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            avatar.appendChild(image);
        } else {
            avatar.textContent = String(user.displayName || user.email || 'מ').trim().charAt(0).toUpperCase();
        }
        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'font-extrabold text-sm text-white truncate';
        name.textContent = user.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'text-[10px] text-slate-400 truncate mt-0.5';
        email.textContent = user.email || 'ללא כתובת מייל';
        const role = document.createElement('p');
        role.className = 'text-[10px] text-amber-400 mt-2';
        role.textContent = roleLabels[user.role] || 'ללא דרגה';
        body.append(name, email, role);
        card.append(checkbox, avatar, body);
        list.appendChild(card);
    });
    window.updateAdminMessageCenterUI();
};

window.selectAllAdminMessageUsers = function() {
    adminMessageCenterUsers().forEach(user => adminMessageRecipients.add(user.uid));
    window.renderAdminMessageUsers();
};

window.clearAdminMessageUsers = function() {
    adminMessageRecipients.clear();
    window.renderAdminMessageUsers();
};

window.sendAdminBulkMessages = async function(confirmed = false) {
    if (!window.checkSuperAdminPermission() || adminMessageSending) return;
    const textarea = document.getElementById('adminBulkMessageText');
    const progress = document.getElementById('adminBulkMessageProgress');
    const text = String(textarea?.value || '').trim();
    const recipients = (window.state.allUsers || []).filter(user => adminMessageRecipients.has(window.safeRecordId(user.uid)));
    if (!text || !recipients.length) return;
    if (!confirmed) {
        window.showConfirm(
            'שליחת הודעה',
            `לשלוח את ההודעה ל־${recipients.length} משתמשים? ההודעה תופיע מיד באזור האישי שלהם.`,
            () => window.sendAdminBulkMessages(true)
        );
        return;
    }

    adminMessageSending = true;
    if (progress) {
        progress.classList.remove('hidden');
        progress.textContent = 'מתחיל לשלוח…';
    }
    window.updateAdminMessageCenterUI();
    let succeeded = 0;
    const failed = [];
    const { mutateConversationMessages } = window.firestoreModules;

    for (let index = 0; index < recipients.length; index++) {
        const user = recipients[index];
        if (progress) progress.textContent = `שולח ${index + 1} מתוך ${recipients.length}: ${user.displayName || user.email || 'משתמש'}…`;
        try {
            const result = await mutateConversationMessages(user.uid, 'append', {
                message: { id: crypto.randomUUID(), text }
            });
            if (Array.isArray(result?.messages)) user.messages = result.messages;
            succeeded += 1;
        } catch (error) {
            console.error('Admin message send failed:', window.safeRecordId(user.uid), error);
            failed.push(user.displayName || user.email || user.uid);
        }
    }

    adminMessageSending = false;
    if (succeeded && textarea) textarea.value = '';
    if (succeeded) adminMessageRecipients.clear();
    window.renderAdminMessageUsers();
    window.renderAdminMessageReplies();
    if (progress) {
        progress.textContent = failed.length
            ? `נשלחו ${succeeded} הודעות; ${failed.length} נכשלו.`
            : `השליחה הושלמה בהצלחה ל־${succeeded} משתמשים.`;
    }
    window.showNotification(
        failed.length ? `חלק מההודעות לא נשלחו (${failed.length}).` : `ההודעה נשלחה בהצלחה ל־${succeeded} משתמשים.`,
        !failed.length
    );
};


function collectAdminMessageReplies() {
    const replies = [];
    (window.state.allUsers || []).forEach(user => {
        const uid = window.safeRecordId(user?.uid);
        if (!uid) return;
        const messages = Array.isArray(user.messages) ? user.messages : [];
        messages.forEach((message, messageIndex) => {
            const directAttachment = normalizeConversationAttachment(message?.attachment);
            const directSticker = normalizeConversationSticker(message?.sticker);
            if (messageDirection(message) === 'user_to_admin' && (String(message.text || '').trim() || directAttachment || directSticker)) {
                replies.push({
                    user,
                    uid,
                    message,
                    messageIndex,
                    reply: {
                        text: String(message.text || ''),
                        attachment: directAttachment,
                        sticker: directSticker,
                        sentAt: message.sentAt,
                        readByAdmin: message.readByAdmin === true
                    }
                });
            }
            const reply = message?.reply;
            const replyAttachment = normalizeConversationAttachment(reply?.attachment);
            const replySticker = normalizeConversationSticker(reply?.sticker);
            if (!reply || (!String(reply.text || '').trim() && !replyAttachment && !replySticker)) return;
            replies.push({ user, uid, message, messageIndex, reply: { ...reply, attachment: replyAttachment, sticker: replySticker } });
        });
    });
    return replies.sort((a, b) => Number(b.reply.sentAt || 0) - Number(a.reply.sentAt || 0));
}

window.setAdminConversationFilter = function(filter) {
    adminConversationFilter = ['all', 'unread', 'open', 'resolved'].includes(filter) ? filter : 'all';
    document.querySelectorAll('[data-admin-conversation-filter]').forEach(button => {
        const active = button.dataset.adminConversationFilter === adminConversationFilter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    window.renderAdminMessageReplies();
};

window.renderAdminMessageReplies = function() {
    const list = document.getElementById('adminMessageRepliesList');
    const count = document.getElementById('adminMessageRepliesCount');
    if (!list) return;
    // מרכז ההודעות המנהלי — מנהל־על בלבד. collectAdminMessageReplies סורק
    // את ההודעות של כל המשתמשים, ולכן אסור שירוץ בכלל למי שאינו מורשה.
    if (!window.canViewSuperAdminData?.()) {
        list.replaceChildren();
        if (count) count.textContent = '';
        ['adminChatsUnreadBadge', 'adminMessagesUnreadStat', 'adminMessagesOpenStat',
         'adminMessagesResolvedStat', 'adminMessagesConversationStat'].forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            element.textContent = '0';
            if (id === 'adminChatsUnreadBadge') {
                element.classList.add('hidden');
                element.classList.remove('flex');
            }
        });
        return;
    }
    const incomingMessages = collectAdminMessageReplies();
    const conversations = new Map();
    incomingMessages.forEach(item => {
        const existing = conversations.get(item.uid);
        const sentAt = new Date(item.reply.sentAt || 0).getTime() || Number(item.reply.sentAt || 0) || 0;
        const unread = item.reply.readByAdmin === true ? 0 : 1;
        if (!existing || sentAt > existing.latestAt) {
            conversations.set(item.uid, {
                ...item,
                latestAt: sentAt,
                unread: (existing?.unread || 0) + unread
            });
        } else if (unread) {
            existing.unread += 1;
        }
    });

    const allConversations = Array.from(conversations.values()).sort((left, right) => {
        if (Boolean(right.unread) !== Boolean(left.unread)) return Number(Boolean(right.unread)) - Number(Boolean(left.unread));
        return right.latestAt - left.latestAt;
    });
    const unreadCount = incomingMessages.filter(item => item.reply.readByAdmin !== true).length;
    const openCount = allConversations.filter(item => item.user.supportStatus !== 'resolved').length;
    const resolvedCount = allConversations.length - openCount;
    const replies = allConversations.filter(item => {
        if (adminConversationFilter === 'unread') return item.unread > 0;
        if (adminConversationFilter === 'open') return item.user.supportStatus !== 'resolved';
        if (adminConversationFilter === 'resolved') return item.user.supportStatus === 'resolved';
        return true;
    });

    const drawerBadge = document.getElementById('adminChatsUnreadBadge');
    if (count) {
        count.textContent = unreadCount ? `${unreadCount} חדשות` : String(allConversations.length);
        count.classList.toggle('animate-pulse', unreadCount > 0);
    }
    if (drawerBadge) {
        drawerBadge.textContent = String(unreadCount);
        drawerBadge.classList.toggle('hidden', unreadCount === 0);
        drawerBadge.classList.toggle('flex', unreadCount > 0);
    }
    const stats = {
        adminMessagesUnreadStat: unreadCount,
        adminMessagesOpenStat: openCount,
        adminMessagesResolvedStat: resolvedCount,
        adminMessagesConversationStat: allConversations.length
    };
    Object.entries(stats).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });

    list.replaceChildren();
    if (!replies.length) {
        const empty = document.createElement('div');
        empty.className = 'admin-conversation-empty';
        empty.innerHTML = '<i data-lucide="message-circle-dashed" class="w-8 h-8"></i><strong>אין שיחות בתצוגה הזו</strong><span>אפשר לעבור למסנן אחר או לבחור משתמש ולשלוח הודעה.</span>';
        list.appendChild(empty);
        window.scheduleIconRefresh?.();
        return;
    }

    replies.forEach(({ user, uid, reply, unread, latestAt }) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `admin-conversation-card ${unread ? 'is-unread' : ''} ${user.supportStatus === 'resolved' ? 'is-resolved' : ''}`;
        card.onclick = () => window.openAdminConversation(uid);

        const avatar = document.createElement('span');
        avatar.className = 'admin-conversation-avatar';
        if (user.photoURL) {
            const image = document.createElement('img');
            image.src = window.safeImageUrl(user.photoURL);
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            avatar.appendChild(image);
        } else {
            avatar.textContent = String(user.displayName || user.email || 'מ').trim().charAt(0).toUpperCase();
        }

        const body = document.createElement('span');
        body.className = 'admin-conversation-body';
        const headline = document.createElement('span');
        headline.className = 'admin-conversation-headline';
        const name = document.createElement('strong');
        name.textContent = user.displayName || user.email || 'משתמש';
        const time = document.createElement('time');
        time.textContent = window.formatDate(latestAt);
        headline.append(name, time);

        const preview = document.createElement('span');
        preview.className = 'admin-conversation-preview';
        const replySticker = normalizeConversationSticker(reply.sticker);
        const stickerDetails = replySticker ? conversationStickerById(replySticker.id) : null;
        preview.textContent = String(reply.text || '').trim() ||
            (reply.attachment ? `📎 ${reply.attachment.name || 'קובץ מצורף'}` :
                (stickerDetails ? `${stickerDetails.emoji} מדבקה: ${stickerDetails.label}` : 'הודעה חדשה'));

        const meta = document.createElement('span');
        meta.className = 'admin-conversation-meta';
        const status = document.createElement('span');
        status.className = 'admin-conversation-status';
        status.textContent = user.supportStatus === 'resolved' ? 'טופלה' : 'פתוחה';
        meta.appendChild(status);
        if (unread) {
            const unreadBadge = document.createElement('span');
            unreadBadge.className = 'admin-conversation-unread';
            unreadBadge.textContent = String(unread);
            meta.appendChild(unreadBadge);
        }
        body.append(headline, preview, meta);

        const arrow = document.createElement('span');
        arrow.className = 'admin-conversation-arrow';
        arrow.innerHTML = '<i data-lucide="chevron-left" class="w-4 h-4"></i>';
        card.append(avatar, body, arrow);
        list.appendChild(card);
    });
    window.scheduleIconRefresh();
};

window.markAdminReplyRead = async function(uid) {
    if (!window.checkSuperAdminPermission()) return;
    const profile = (window.state.allUsers || []).find(user => window.safeRecordId(user.uid) === window.safeRecordId(uid));
    if (!profile) return;
    try {
        const { mutateConversationMessages } = window.firestoreModules;
        const result = await mutateConversationMessages(uid, 'mark_read');
        if (Array.isArray(result?.messages)) profile.messages = result.messages;
        window.renderAdminMessageReplies();
    } catch (error) {
        console.error('markAdminReplyRead failed:', error);
    }
};


window.openAdminMessagesForUser = function(uid) {
    window.openAdminConversation(uid);
};

window.openAdminMessagesCenter = function() {
    if (!window.state.isSuperAdmin) {
        window.showNotification('מרכז שליחת ההודעות זמין למנהל־על בלבד.', false);
        return;
    }
    const floatingPanel = document.getElementById('floatingProfilePanel');
    if (floatingPanel) floatingPanel.classList.remove('active');
    window.renderAdminMessageUsers();
    window.renderAdminMessageReplies();
    window.openModal('adminMessagesCenterModal');
    window.scheduleIconRefresh();
};

function personalMessageStorageKey(uid) {
    return `simchat-dismissed-messages:${window.safeRecordId(uid) || 'anonymous'}`;
}

function personalMessageKey(message, fallbackIndex) {
    const id = window.safeRecordId(message?.id);
    if (id) return id;
    const fingerprint = `${message?.sentAt || ''}|${message?.sender || ''}|${message?.text || ''}|${fallbackIndex}`;
    let hash = 0;
    for (let index = 0; index < fingerprint.length; index++) {
        hash = ((hash << 5) - hash + fingerprint.charCodeAt(index)) | 0;
    }
    return `legacy_${Math.abs(hash)}`;
}

function getDismissedPersonalMessages() {
    const uid = window.state.currentUser?.uid;
    if (!uid) return new Set();
    try {
        const saved = JSON.parse(localStorage.getItem(personalMessageStorageKey(uid)) || '[]');
        return new Set(Array.isArray(saved) ? saved.filter(value => typeof value === 'string') : []);
    } catch {
        return new Set();
    }
}

function dismissPersonalMessageLocally(message, fallbackIndex) {
    const uid = window.state.currentUser?.uid;
    if (!uid) return;
    const dismissed = getDismissedPersonalMessages();
    dismissed.add(personalMessageKey(message, fallbackIndex));
    localStorage.setItem(personalMessageStorageKey(uid), JSON.stringify([...dismissed].slice(-500)));
}

window.deletePersonalMessage = async function(messageId, fallbackIndex, confirmed = false) {
    if (!window.state.currentUser || !window.state.userProfile) return;
    const messages = Array.isArray(window.state.userProfile.messages) ? window.state.userProfile.messages : [];
    const targetMessage = messageId
        ? messages.find(message => window.safeRecordId(message?.id) === window.safeRecordId(messageId))
        : messages[fallbackIndex];
    const targetId = window.safeRecordId(targetMessage?.id);
    if (!targetId) {
        window.showNotification('אי אפשר למחוק הודעה ישנה ללא מזהה. אפשר לסמן אותה כנקראה.', false);
        return;
    }
    if (!confirmed) {
        window.showConfirm(
            'מחיקת הודעה',
            'למחוק את ההודעה ואת הקובץ המצורף אליה? הפעולה תתבצע גם בענן.',
            () => window.deletePersonalMessage(targetId, fallbackIndex, true)
        );
        return;
    }

    try {
        const { mutateConversationMessages } = window.firestoreModules;
        const result = await mutateConversationMessages(window.state.currentUser.uid, 'delete', { messageId: targetId });
        const updatedMessages = Array.isArray(result?.messages) ? result.messages : messages.filter(message => window.safeRecordId(message?.id) !== targetId);
        dismissPersonalMessageLocally(targetMessage, fallbackIndex);
        window.state.userProfile = { ...window.state.userProfile, messages: updatedMessages };
        window.renderFloatingInbox();
        window.showNotification('ההודעה והקובץ המצורף נמחקו מהענן.', true);
    } catch (error) {
        console.error('Error deleting personal message:', error);
        window.showNotification(error.message || 'מחיקת ההודעה נכשלה.', false);
    }
};


window.renderFloatingInbox = function() {
    const list = document.getElementById('floatingInboxList');
    const badge = document.getElementById('floatingWidgetBadge');
    if (!list) return;
    
    const profile = window.state.userProfile;
    const messages = (profile && profile.messages) ? profile.messages : [];
    const dismissedMessages = getDismissedPersonalMessages();
    const visibleMessages = messages
        .map((message, originalIndex) => ({ message, originalIndex }))
        .filter(({ message }) => messageDirection(message) === 'admin_to_user')
        .filter(({ message }) => message.read !== true)
        .filter(({ message, originalIndex }) => !dismissedMessages.has(personalMessageKey(message, originalIndex)));
    
    const adminConversationMap = new Map();
    if (window.state.isSuperAdmin) {
        collectAdminMessageReplies().forEach(item => {
            const sentAt = Number(item.reply.sentAt || item.message.sentAt || 0);
            const unread = item.reply.readByAdmin === true ? 0 : 1;
            const existing = adminConversationMap.get(item.uid);
            if (!existing || sentAt > existing.sentAt) {
                adminConversationMap.set(item.uid, {
                    ...item,
                    sentAt,
                    unread: (existing?.unread || 0) + unread
                });
            } else if (unread) {
                existing.unread += 1;
            }
        });
    }
    // הפרופיל הוא תיבת התראות בלבד; שיחות שנקראו נשארות במרכז ההודעות.
    const adminConversations = [...adminConversationMap.values()]
        .filter(item => item.unread > 0)
        .sort((a, b) => b.sentAt - a.sentAt);

    if (visibleMessages.length === 0 && adminConversations.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-slate-500 text-center py-4">אין התראות חדשות.</p>';
        if (badge) badge.classList.add('hidden');
        return;
    }
    
    list.innerHTML = '';
    let unreadCount = adminConversations.reduce((total, item) => total + item.unread, 0);

    adminConversations.forEach(item => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `w-full p-2.5 rounded-lg border text-right transition-all ${item.unread ? 'bg-cyan-500/10 border-cyan-400/25' : 'bg-white/5 border-white/5 opacity-80'}`;
        card.setAttribute('aria-label', `פתיחת השיחה עם ${item.user.displayName || item.user.email || 'משתמש'}`);

        const meta = document.createElement('div');
        meta.className = 'flex justify-between items-center gap-2 mb-1';

        const sender = document.createElement('span');
        sender.className = 'text-[9px] font-bold text-cyan-300 truncate';
        sender.textContent = item.user.displayName || item.user.email || 'משתמש';

        const status = document.createElement('span');
        status.className = 'text-[8px] text-slate-400 shrink-0';
        status.textContent = item.unread ? `${item.unread} חדשות` : window.formatDate(item.sentAt);

        const message = document.createElement('p');
        message.className = 'text-[11px] text-slate-200 leading-relaxed line-clamp-2';
        message.textContent = item.reply.text || 'הודעה חדשה';

        const action = document.createElement('span');
        action.className = 'mt-2 text-[9px] font-bold text-cyan-300 flex items-center gap-1';
        action.innerHTML = '<i data-lucide="messages-square" class="w-3.5 h-3.5"></i> פתח שיחה';

        meta.append(sender, status);
        card.append(meta, message, action);
        card.onclick = () => window.openAdminConversation(item.uid);
        list.appendChild(card);
    });

    visibleMessages.forEach(({ message: msg, originalIndex }) => {
        if (!msg.read) unreadCount++;
        const card = document.createElement('div');
        card.className = `p-2.5 rounded-lg border text-right transition-all ${msg.read ? 'bg-white/5 border-white/5 opacity-75' : 'bg-amber-500/10 border-amber-500/20'}`;
        
        const meta = document.createElement('div');
        meta.className = 'flex justify-between items-center mb-1';
        
        const sender = document.createElement('span');
        sender.className = 'text-[9px] font-bold text-amber-400';
        sender.textContent = msg.sender || 'מנהל שמחת התורה';
        
        const time = document.createElement('span');
        time.className = 'text-[8px] text-slate-500';
        time.textContent = window.formatDate(msg.sentAt);
        const metaActions = document.createElement('div');
        metaActions.className = 'flex items-center gap-1.5';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'w-6 h-6 rounded-md text-slate-500 hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center';
        deleteButton.title = 'מחיקת ההודעה';
        deleteButton.setAttribute('aria-label', 'מחיקת ההודעה');
        deleteButton.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
        deleteButton.onclick = event => {
            event.stopPropagation();
            window.deletePersonalMessage(msg.id, originalIndex);
        };

        metaActions.append(time, deleteButton);
        meta.append(sender, metaActions);
        
        const text = document.createElement('p');
        text.className = 'text-[11px] text-slate-200 leading-relaxed';
        const personalSticker = normalizeConversationSticker(msg.sticker);
        const personalStickerDetails = personalSticker ? conversationStickerById(personalSticker.id) : null;
        text.textContent = msg.text || (personalStickerDetails ? `${personalStickerDetails.emoji} מדבקה: ${personalStickerDetails.label}` : 'הודעה חדשה');
        
        card.append(meta, text);

        if (msg.reply?.text) {
            const replyBox = document.createElement('div');
            replyBox.className = 'mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-2';
            const replyLabel = document.createElement('span');
            replyLabel.className = 'block text-[9px] font-bold text-cyan-300 mb-1';
            replyLabel.textContent = 'התשובה שלך';
            const replyText = document.createElement('p');
            replyText.className = 'text-[10px] text-cyan-50 leading-relaxed whitespace-pre-wrap';
            replyText.textContent = msg.reply.text;
            replyBox.append(replyLabel, replyText);
            card.appendChild(replyBox);
        }

        const openChatButton = document.createElement('button');
        openChatButton.type = 'button';
        openChatButton.className = 'w-full mt-2 py-2 btn-secondary-dark rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5';
        openChatButton.innerHTML = '<i data-lucide="messages-square" class="w-3.5 h-3.5"></i> פתח בצ׳אט';
        openChatButton.onclick = event => {
            event.stopPropagation();
            window.openUserConversation();
        };
        card.appendChild(openChatButton);
        
        // לחיצה על הודעה מסמנת אותה כנקראה במסד הנתונים.
        card.onclick = async () => {
            if (!msg.read && window.state.currentUser) {
                try {
                    const { mutateConversationMessages } = window.firestoreModules;
                    const result = await mutateConversationMessages(window.state.currentUser.uid, 'mark_read');
                    if (window.state.userProfile && Array.isArray(result?.messages)) {
                        window.state.userProfile = { ...window.state.userProfile, messages: result.messages };
                        window.renderFloatingInbox();
                    }
                } catch (e) {
                    console.error('Error marking message read:', e);
                }
            }
        };
        list.appendChild(card);
    });
    
    if (badge) {
        if (unreadCount > 0) {
            badge.classList.remove('hidden');
            badge.textContent = unreadCount;
        } else {
            badge.classList.add('hidden');
        }
    }
    window.scheduleIconRefresh?.(list);
};
    


