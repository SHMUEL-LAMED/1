// admin.js — ממשק הניהול, משתמשים, דרגות, הרשאות והודעות
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.

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
    const messages = Array.isArray(profile.messages) ? profile.messages : [];
    let changed = false;
    const updatedMessages = messages.map(message => {
        if (activeConversationMode === 'admin' && messageDirection(message) === 'user_to_admin' && message.readByAdmin !== true) {
            changed = true;
            return { ...message, readByAdmin: true, readByAdminAt: Date.now() };
        }
        if (activeConversationMode === 'admin' && message.reply && message.reply.readByAdmin !== true) {
            changed = true;
            return { ...message, reply: { ...message.reply, readByAdmin: true, readByAdminAt: Date.now() } };
        }
        if (activeConversationMode === 'user' && messageDirection(message) === 'admin_to_user' && message.read !== true) {
            changed = true;
            return { ...message, read: true, readAt: Date.now() };
        }
        return message;
    });
    if (!changed) return;
    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), {
        messages: updatedMessages
    }, { merge: true });
    profile.messages = updatedMessages;
    window.renderFloatingInbox?.();
    window.renderAdminMessageReplies?.();
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
    const text = String(input?.value || '').trim().slice(0, 1500);
    const file = activeConversationAttachment;
    const sticker = normalizeConversationSticker(activeConversationSticker);
    if (!text && !file && !sticker) return;
    const profile = activeConversationProfile();
    const uid = activeConversationMode === 'admin' ? activeConversationUid : window.state.currentUser?.uid;
    if (!profile || !uid) return;

    conversationSending = true;
    if (button) button.disabled = true;
    document.getElementById('conversationAttachmentButton')?.setAttribute('disabled', '');
    document.getElementById('conversationEmojiButton')?.setAttribute('disabled', '');
    document.getElementById('conversationStickerButton')?.setAttribute('disabled', '');
    try {
        const { doc, getDoc, setDoc } = window.firestoreModules;
        const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid);
        const snapshot = await getDoc(profileRef);
        if (!snapshot.exists()) throw new Error('פרופיל השיחה לא נמצא');
        const currentMessages = Array.isArray(snapshot.data().messages) ? snapshot.data().messages : [];
        const fromAdmin = activeConversationMode === 'admin';
        const messageId = crypto.randomUUID();
        if (status && file) status.textContent = 'מכין את הקובץ להעלאה…';
        const attachment = file
            ? await uploadConversationAttachment(file, messageId, uid, progress => {
                if (status) status.textContent = `מעלה את הקובץ… ${progress}%`;
            })
            : null;
        const message = {
            id: messageId,
            text,
            direction: fromAdmin ? 'admin_to_user' : 'user_to_admin',
            sender: fromAdmin
                ? (window.state.currentUser?.displayName || 'מנהל הגלריה')
                : (window.state.currentUser?.displayName || 'משתמש'),
            senderUid: window.state.currentUser?.uid || '',
            recipientUid: fromAdmin ? uid : 'gallery-admin',
            sentAt: Date.now(),
            read: !fromAdmin,
            readAt: fromAdmin ? null : Date.now(),
            readByAdmin: fromAdmin,
            readByAdminAt: fromAdmin ? Date.now() : null,
            attachment,
            sticker
        };
        const updatedMessages = [message, ...currentMessages].slice(0, 250);
        await setDoc(profileRef, {
            messages: updatedMessages,
            ...(fromAdmin ? {} : { supportStatus: 'open' })
        }, { merge: true });
        profile.messages = updatedMessages;
        if (!fromAdmin) profile.supportStatus = 'open';
        if (input) input.value = '';
        window.updateConversationCharacterCount();
        window.toggleConversationEmojiPicker(false);
        window.toggleConversationStickerPicker(false);
        activeConversationSticker = null;
        window.clearConversationAttachment();
        if (status) status.textContent = 'תמונות וקבצים עד 25MB';
        window.renderActiveConversation();
        window.renderFloatingInbox?.();
        window.renderAdminMessageReplies?.();
    } catch (error) {
        console.error('Conversation message failed:', error);
        if (status) status.textContent = 'ההעלאה או השליחה נכשלה';
        window.showNotification(error.message || 'שליחת ההודעה נכשלה. נסה שוב.', false);
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

    for (let index = 0; index < recipients.length; index++) {
        const user = recipients[index];
        if (progress) progress.textContent = `שולח ${index + 1} מתוך ${recipients.length}: ${user.displayName || user.email || 'משתמש'}…`;
        try {
            const { doc, getDoc, setDoc } = window.firestoreModules;
            const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', user.uid);
            const snapshot = await getDoc(profileRef);
            if (!snapshot.exists()) throw new Error('פרופיל המשתמש לא נמצא');
            const existingMessages = Array.isArray(snapshot.data().messages) ? snapshot.data().messages : [];
            const message = {
                id: crypto.randomUUID(),
                text,
                sender: window.state.currentUser?.displayName || 'מנהל שמחת התורה',
                senderUid: window.state.currentUser?.uid || '',
                recipientUid: user.uid,
                sentAt: Date.now(),
                direction: 'admin_to_user',
                read: false,
                readByAdmin: true,
                allowReply: true,
                reply: null
            };
            await setDoc(profileRef, { messages: [message, ...existingMessages].slice(0, 100) }, { merge: true });
            succeeded++;
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

window.markAdminReplyRead = async function(uid, messageId) {
    if (!window.checkSuperAdminPermission()) return;
    const profile = (window.state.allUsers || []).find(user => window.safeRecordId(user.uid) === window.safeRecordId(uid));
    if (!profile) return;
    const messages = Array.isArray(profile.messages) ? profile.messages : [];
    const updatedMessages = messages.map(message => (
        window.safeRecordId(message?.id) === window.safeRecordId(messageId) && message.reply
            ? { ...message, reply: { ...message.reply, readByAdmin: true } }
            : message
    ));
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), {
            messages: updatedMessages
        }, { merge: true });
        profile.messages = updatedMessages;
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
    if (!confirmed) {
        window.showConfirm(
            'מחיקת הודעה',
            'למחוק את ההודעה? לאחר המחיקה היא לא תופיע שוב באזור האישי.',
            () => window.deletePersonalMessage(messageId, fallbackIndex, true)
        );
        return;
    }

    const messages = Array.isArray(window.state.userProfile.messages)
        ? window.state.userProfile.messages
        : [];
    const targetMessage = messageId
        ? messages.find(message => window.safeRecordId(message?.id) === window.safeRecordId(messageId))
        : messages[fallbackIndex];
    const updatedMessages = messages.filter((message, index) => {
        if (messageId) return window.safeRecordId(message?.id) !== window.safeRecordId(messageId);
        return index !== fallbackIndex;
    });

    dismissPersonalMessageLocally(targetMessage, fallbackIndex);
    window.state.userProfile = { ...window.state.userProfile, messages: updatedMessages };
    window.renderFloatingInbox();

    try {
        const { doc, updateDoc } = window.firestoreModules;
        const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', window.state.currentUser.uid);
        await updateDoc(profileRef, { messages: updatedMessages });
        window.showNotification('ההודעה נמחקה.', true);
    } catch (error) {
        console.error('Error deleting personal message:', error);
        window.showNotification('ההודעה הוסרה מהמכשיר הזה.', true);
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
    const adminConversations = [...adminConversationMap.values()].sort((a, b) => b.sentAt - a.sentAt);

    if (visibleMessages.length === 0 && adminConversations.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-slate-500 text-center py-4">אין הודעות חדשות.</p>';
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
                    const updatedMessages = [...messages];
                    updatedMessages[originalIndex] = { ...msg, read: true, readAt: Date.now() };
                    const { doc, setDoc } = window.firestoreModules;
                    const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', window.state.currentUser.uid);
                    await setDoc(profileRef, { messages: updatedMessages }, { merge: true });
                    // Update local state so the badge and card styling reflect the read status immediately
                    if (window.state.userProfile) {
                        window.state.userProfile = { ...window.state.userProfile, messages: updatedMessages };
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
    


// --- 3. Admin UI Update Routing ---
window.updateAdminUI = function() {
    const userArea = document.getElementById('userActionArea');
    const adminPanel = document.getElementById('sidebarAdminPanel');
    const statusBadge = document.getElementById('sidebarLockStatus');
    const uploadCard = document.getElementById('userUploadAccessCard');
    const uploadTitle = document.getElementById('userUploadAccessTitle');
    const uploadText = document.getElementById('userUploadAccessText');
    const uploadModeText = document.getElementById('userUploadModeText');
    const uploadSubmitButton = document.getElementById('userUploadSubmitBtn');
    const superAdminChatsCard = document.getElementById('superAdminChatsCard');
    const superAdminUsersCard = document.getElementById('superAdminUsersCard');
    const superAdminDeletionRequestsCard = document.getElementById('superAdminDeletionRequestsCard');
    const superAdminOnlyElements = document.querySelectorAll('#sidebarAdminPanel .super-admin-only');
    const rejectPendingButton = document.getElementById('rejectPendingBtn');
    const superAdminMessageLaunchers = document.querySelectorAll('[data-super-admin-messages-launcher]');
    const adminProfileLaunchers = document.querySelectorAll('[data-admin-profile-launcher]');
    const contactManagerButton = document.getElementById('contactManagerButton');

    if (!statusBadge) return;

    if (userArea) userArea.classList.add('hidden');
    if (adminPanel) adminPanel.classList.add('hidden');
    if (uploadCard) uploadCard.classList.add('hidden');
    superAdminOnlyElements.forEach(element => element.classList.add('hidden'));
    if (superAdminChatsCard) superAdminChatsCard.classList.add('hidden');
    if (superAdminUsersCard) superAdminUsersCard.classList.add('hidden');
    if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.add('hidden');
    superAdminMessageLaunchers.forEach(button => {
        button.classList.toggle('hidden', !window.state.isSuperAdmin);
        button.classList.toggle('flex', window.state.isSuperAdmin);
    });
    adminProfileLaunchers.forEach(button => {
        button.classList.toggle('hidden', !window.state.isAdminLoggedIn);
        button.classList.toggle('flex', window.state.isAdminLoggedIn);
    });
    if (contactManagerButton) contactManagerButton.classList.toggle('hidden', window.state.isSuperAdmin);

    const googleSignedOutView = document.getElementById('googleSignedOutView');
    const googleSignedInView = document.getElementById('googleSignedInView');
    const googleUserName = document.getElementById('googleUserName');
    const googleUserEmail = document.getElementById('googleUserEmail');
    const googleUserPhoto = document.getElementById('googleUserPhoto');
    const googleUserRoleBadge = document.getElementById('googleUserRoleBadge');
    const googleUserApprovalText = document.getElementById('googleUserApprovalText');
    const currentUser = window.state.currentUser;
    const approvalStatus = window.state.userApprovalStatus;
    const role = window.state.userRole;
    const hasGalleryAccess = window.state.isAdminLoggedIn || (
        window.state.isGoogleUser && approvalStatus === 'approved'
    );
    const accessGate = document.getElementById('galleryAccessGate');
    const accessGateTitle = document.getElementById('galleryAccessGateTitle');
    const accessGateText = document.getElementById('galleryAccessGateText');
    const headerConnectionStatus = document.getElementById('headerConnectionStatus');

    document.body.classList.toggle('gallery-locked', !hasGalleryAccess);
    if (accessGate) accessGate.classList.toggle('hidden', hasGalleryAccess);
    if (headerConnectionStatus) headerConnectionStatus.textContent = hasGalleryAccess ? 'גישה מאושרת' : 'נדרשת הרשאה';
    if (!hasGalleryAccess && accessGateTitle && accessGateText) {
        if (approvalStatus === 'pending') {
            accessGateTitle.textContent = 'בקשת ההצטרפות ממתינה לאישור';
            accessGateText.textContent = 'המנהל קיבל את הבקשה שלך. לאחר שיבחר עבורך דרגה, הגלריה תיפתח כאן אוטומטית.';
        } else if (approvalStatus === 'rejected') {
            accessGateTitle.textContent = 'בקשת ההצטרפות לא אושרה';
            accessGateText.textContent = 'החשבון אינו מורשה לצפות בגלריה. ניתן לפנות למנהל האתר.';
        } else if (approvalStatus === 'blocked') {
            accessGateTitle.textContent = 'החשבון חסום';
            accessGateText.textContent = 'מנהל־העל חסם את החשבון. ניתן לפנות אליו לבירור.';
        } else {
            accessGateTitle.textContent = 'התחבר כדי לצפות בגלריה';
            accessGateText.textContent = 'התחבר באמצעות Google. לאחר מכן תישלח למנהל בקשה לאישור החשבון.';
        }
    }

    if (googleSignedOutView && googleSignedInView) {
        const signedInWithGoogle = Boolean(window.state.isGoogleUser && currentUser);
        googleSignedOutView.classList.toggle('hidden', signedInWithGoogle);
        googleSignedInView.classList.toggle('hidden', !signedInWithGoogle);
        if (signedInWithGoogle) {

            // Sync Floating Panel Profiles
            const floatingUserPhoto = document.getElementById('floatingUserPhoto');
            const floatingUserFallback = document.getElementById('floatingUserFallback');
            const floatingUserPanelPhoto = document.getElementById('floatingUserPanelPhoto');
            const floatingUserPanelName = document.getElementById('floatingUserPanelName');
            const floatingUserPanelEmail = document.getElementById('floatingUserPanelEmail');
            const floatingUserPanelBadge = document.getElementById('floatingUserPanelBadge');
            const floatingSignedOutView = document.getElementById('floatingSignedOutView');
            const floatingSignedInView = document.getElementById('floatingSignedInView');

            const photoUrl = window.safeImageUrl(currentUser.photoURL);
            if (photoUrl) {
                if(floatingUserPhoto) { floatingUserPhoto.src = photoUrl; floatingUserPhoto.classList.remove('hidden'); }
                if(floatingUserFallback) floatingUserFallback.classList.add('hidden');
                if(floatingUserPanelPhoto) { floatingUserPanelPhoto.src = photoUrl; floatingUserPanelPhoto.classList.remove('hidden'); }
            } else {
                if(floatingUserPhoto) floatingUserPhoto.classList.add('hidden');
                if(floatingUserFallback) floatingUserFallback.classList.remove('hidden');
                if(floatingUserPanelPhoto) floatingUserPanelPhoto.classList.add('hidden');
            }

            if(floatingUserPanelName) floatingUserPanelName.textContent = currentUser.displayName || 'משתמש Google';
            if(floatingUserPanelEmail) floatingUserPanelEmail.textContent = currentUser.email || '';
            if(floatingSignedOutView) floatingSignedOutView.classList.add('hidden');
            if(floatingSignedInView) floatingSignedInView.classList.remove('hidden');

            // Floating Panel badge styles based on roles
            if (floatingUserPanelBadge) {
                floatingUserPanelBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold border';
                if (approvalStatus === 'pending') {
                    floatingUserPanelBadge.className += ' bg-amber-500/10 text-amber-400 border-amber-500/20';
                    floatingUserPanelBadge.textContent = 'ממתין לאישור מנהל';
                } else if (approvalStatus === 'blocked') {
                    floatingUserPanelBadge.className += ' bg-red-500/10 text-red-400 border-red-500/20';
                    floatingUserPanelBadge.textContent = 'חשבון חסום';
                } else if (role === 'super_admin') {
                    floatingUserPanelBadge.className += ' bg-purple-500/10 text-purple-400 border-purple-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 4 — מנהל־על';
                } else if (role === 'admin') {
                    floatingUserPanelBadge.className += ' bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 3 — מנהל';
                } else if (role === 'uploader') {
                    floatingUserPanelBadge.className += ' bg-amber-500/10 text-amber-400 border-amber-500/20';
                    floatingUserPanelBadge.textContent = 'דרגה 2 — מעלה תמונות';
                } else {
                    floatingUserPanelBadge.className += ' bg-white/5 text-slate-300 border-white/10';
                    floatingUserPanelBadge.textContent = 'דרגה 1 — צופה רגיל';
                }
            }

            // Render floating inbox messages
            window.renderFloatingInbox();
            window.renderActiveConversation?.();
    
            if (googleUserName) googleUserName.textContent = currentUser.displayName || 'משתמש Google';
            if (googleUserEmail) googleUserEmail.textContent = currentUser.email || '';
            if (googleUserPhoto) {
                const photoUrl = window.safeImageUrl(currentUser.photoURL);
                if (photoUrl) { googleUserPhoto.src = photoUrl; googleUserPhoto.classList.remove('hidden'); }
                else { googleUserPhoto.removeAttribute('src'); googleUserPhoto.classList.add('hidden'); }
            }

            if (googleUserRoleBadge && googleUserApprovalText) {
                if (approvalStatus === 'pending') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20';
                    googleUserRoleBadge.textContent = 'ממתין לאישור';
                    googleUserApprovalText.textContent = 'בקשת ההצטרפות שלך נשלחה וממתינה לבחירת דרגה על ידי מנהל.';
                } else if (approvalStatus === 'rejected') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20';
                    googleUserRoleBadge.textContent = 'הבקשה לא אושרה';
                    googleUserApprovalText.textContent = 'בקשת ההצטרפות לא אושרה. ניתן לפנות למנהל האתר.';
                } else if (approvalStatus === 'blocked') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20';
                    googleUserRoleBadge.textContent = 'חשבון חסום';
                    googleUserApprovalText.textContent = 'הגישה לחשבון נחסמה על ידי מנהל־העל.';
                } else if (role === 'uploader') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 2 — מעלה תמונות';
                    googleUserApprovalText.textContent = 'החשבון מאושר ויכול להעלות תמונות ישירות לגלריה.';
                    if (uploadCard) uploadCard.classList.remove('hidden');
                    if (uploadTitle) uploadTitle.textContent = 'העלאה ישירה לגלריה';
                    if (uploadText) uploadText.textContent = 'דרגה 2 מאפשרת להעלות תמונות ללא המתנה לאישור.';
                    if (uploadModeText) uploadModeText.textContent = 'התמונות יעלו ישירות לגלריה ללא אישור נוסף.';
                    if (uploadSubmitButton) uploadSubmitButton.textContent = 'העלה לגלריה';
                } else if (role === 'super_admin') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 4 — מנהל־על';
                    googleUserApprovalText.textContent = 'לחשבון יש הרשאות ניהול מלאות.';
                } else if (role === 'admin') {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                    googleUserRoleBadge.textContent = 'דרגה 3 — מנהל';
                    googleUserApprovalText.textContent = 'החשבון מאושר כמנהל המערכת.';
                } else {
                    googleUserRoleBadge.className = 'inline-flex mt-1 text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/5 text-slate-350 border border-white/10';
                    googleUserRoleBadge.textContent = 'דרגה 1 — צופה רגיל';
                    googleUserApprovalText.textContent = 'החשבון מאושר לצפייה ולהגשת תמונות לאישור.';
                    if (uploadCard) uploadCard.classList.remove('hidden');
                    if (uploadTitle) uploadTitle.textContent = 'שליחת תמונות לאישור';
                    if (uploadText) uploadText.textContent = 'דרגה 1 מאפשרת להעלות תמונות לאחר אישור מנהל.';
                    if (uploadModeText) uploadModeText.textContent = 'התמונות יישלחו לבדיקה ויופיעו בגלריה לאחר אישור מנהל.';
                    if (uploadSubmitButton) uploadSubmitButton.textContent = 'שלח לאישור';
                }
            }
        }
    }

    if (window.state.isAdminLoggedIn) {
        if (adminPanel) adminPanel.classList.remove('hidden');
        statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
        statusBadge.innerText = window.state.isSuperAdmin ? "ניהול־על פעיל" : "ניהול פעיל";
        const adminName = document.getElementById('adminCurrentUserName');
        const adminEmail = document.getElementById('adminCurrentUserEmail');
        const adminPhoto = document.getElementById('adminCurrentUserPhoto');
        const adminFallback = document.getElementById('adminCurrentUserFallback');
        const adminGrade = document.getElementById('adminCurrentUserGrade');
        if (adminName) adminName.textContent = currentUser?.displayName || 'מנהל המערכת';
        if (adminEmail) adminEmail.textContent = currentUser?.email || '';
        if (adminPhoto && adminFallback) {
            const adminPhotoUrl = window.safeImageUrl(currentUser?.photoURL);
            adminPhoto.classList.toggle('hidden', !adminPhotoUrl);
            adminFallback.classList.toggle('hidden', Boolean(adminPhotoUrl));
            if (adminPhotoUrl) adminPhoto.src = adminPhotoUrl;
        }
        if (adminGrade) {
            adminGrade.textContent = window.state.isSuperAdmin ? 'דרגה 4 — מנהל־על' : 'דרגה 3 — מנהל';
            adminGrade.className = window.state.isSuperAdmin
                ? 'text-[9px] px-2 py-1 rounded-full font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20'
                : 'text-[9px] px-2 py-1 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        }
        if (window.state.isSuperAdmin) {
            superAdminOnlyElements.forEach(element => element.classList.remove('hidden'));
            if (superAdminChatsCard) superAdminChatsCard.classList.remove('hidden');
            if (superAdminUsersCard) superAdminUsersCard.classList.remove('hidden');
            if (superAdminDeletionRequestsCard) superAdminDeletionRequestsCard.classList.remove('hidden');
        }
        if (rejectPendingButton) rejectPendingButton.textContent = window.state.isSuperAdmin ? 'מחק לצמיתות' : 'בקש מחיקה';
        window.renderPendingImages();
        window.updatePendingBadge();
        window.renderPendingUsers();
        window.updatePendingUsersBadge();
        window.renderManagedUsers();
        window.renderDeletionRequests();
    } else {
        if (userArea) userArea.classList.remove('hidden');
        if (window.state.isGoogleUser) {
            if (approvalStatus === 'approved' && role === 'uploader') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
                statusBadge.innerText = "הרשאת העלאה";
            } else if (approvalStatus === 'approved') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-white/5 text-slate-300 border border-white/10";
                statusBadge.innerText = "צופה מאושר";
            } else if (approvalStatus === 'blocked') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20";
                statusBadge.innerText = "חשבון חסום";
            } else if (approvalStatus === 'rejected') {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 border border-red-500/20";
                statusBadge.innerText = "לא אושר";
            } else {
                statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
                statusBadge.innerText = "ממתין לאישור";
            }
        } else {
            statusBadge.className = "text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20";
            statusBadge.innerText = "מצב אורח";
        }
    }
    window.scheduleIconRefresh();
}


window.requestContentDeletion = async function(targetType, targetId, targetName) {
    if (!window.checkAdminPermission()) return;
    if (window.state.isSuperAdmin) throw new Error('מנהל־על יכול לבצע את המחיקה ישירות.');
    const allowedTypes = ['image', 'folder', 'pendingImage'];
    const safeTargetId = window.safeRecordId(targetId);
    if (!allowedTypes.includes(targetType) || !safeTargetId) throw new Error('בקשת המחיקה אינה תקינה.');
    const duplicate = (window.state.deletionRequests || []).some(request =>
        request.status === 'pending' && request.targetType === targetType && window.safeRecordId(request.targetId) === safeTargetId
    );
    if (duplicate) throw new Error('כבר קיימת בקשת מחיקה ממתינה עבור פריט זה.');

    const requestId = `delete_${crypto.randomUUID()}`;
    const { doc, setDoc } = window.firestoreModules;
    const newRequest = {
        id: requestId,
        targetType,
        targetId: safeTargetId,
        targetName: String(targetName || 'פריט').slice(0, 120),
        status: 'pending',
        requestedAt: Date.now(),
        requestedBy: window.state.currentUser?.uid || '',
        requestedByName: window.state.currentUser?.displayName || '',
        requestedByEmail: window.state.currentUser?.email || ''
    };
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'deletionRequests', requestId), newRequest);
    window.state.deletionRequests = [newRequest, ...(window.state.deletionRequests || [])];
};

window.changeUserRole = async function(uid, role, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    const allowedRoles = ['viewer', 'uploader', 'admin', 'super_admin'];
    if (!allowedRoles.includes(role) || !uid || uid === window.state.currentUser?.uid) return;
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    const roleLabels = { viewer: 'דרגה 1', uploader: 'דרגה 2', admin: 'דרגה 3', super_admin: 'דרגה 4' };
    if (!confirmed) {
        window.showConfirm(
            'שינוי דרגת משתמש',
            `לשנות את הדרגה של ${profile?.displayName || profile?.email || 'המשתמש'} ל־${roleLabels[role]}?`,
            () => window.changeUserRole(uid, role, true)
        );
        return;
    }
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), {
            status: 'approved',
            role,
            roleChangedAt: Date.now(),
            roleChangedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        await window.logActivity('changed_role', 'user', uid, profile?.displayName || profile?.email || uid, `דרגה חדשה: ${role}`);
        if (profile) { profile.status = 'approved'; profile.role = role; }
        window.renderManagedUsers?.();
        window.showNotification('דרגת המשתמש עודכנה בהצלחה.');
    } catch (error) {
        console.error('changeUserRole failed:', error);
        window.showNotification('שינוי דרגת המשתמש נכשל.', false);
    }
};

window.toggleUserBlock = async function(uid, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    if (!uid || uid === window.state.currentUser?.uid) {
        window.showNotification('לא ניתן לחסום את חשבון מנהל־העל הפעיל.', false);
        return;
    }
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    if (!profile) return;
    const isBlocked = profile.status === 'blocked';
    if (!confirmed) {
        window.showConfirm(
            isBlocked ? 'הסרת חסימה' : 'חסימת משתמש',
            isBlocked
                ? `להחזיר ל־${profile.displayName || profile.email || 'המשתמש'} את הגישה לגלריה?`
                : `לחסום את ${profile.displayName || profile.email || 'המשתמש'}? הגישה שלו לגלריה תופסק.`,
            () => window.toggleUserBlock(uid, true)
        );
        return;
    }
    try {
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid), isBlocked ? {
            status: 'approved',
            role: ['viewer', 'uploader', 'admin', 'super_admin'].includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : 'viewer',
            unblockedAt: Date.now(),
            unblockedBy: window.state.currentUser?.uid || ''
        } : {
            status: 'blocked',
            roleBeforeBlock: profile.role || 'viewer',
            blockedAt: Date.now(),
            blockedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        await window.logActivity('changed_block', 'user', uid, profile.displayName || profile.email || uid, isBlocked ? 'החסימה הוסרה' : 'המשתמש נחסם');
        if (isBlocked) {
            profile.status = 'approved';
            profile.role = ['viewer', 'uploader', 'admin', 'super_admin'].includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : 'viewer';
        } else {
            profile.roleBeforeBlock = profile.role || 'viewer';
            profile.status = 'blocked';
        }
        window.renderManagedUsers?.();
        window.showNotification(isBlocked ? 'חסימת המשתמש הוסרה.' : 'המשתמש נחסם.');
    } catch (error) {
        console.error('toggleUserBlock failed:', error);
        window.showNotification('שינוי סטטוס המשתמש נכשל.', false);
    }
};

window.deleteManagedUser = async function(uid, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    if (!uid || uid === window.state.currentUser?.uid) {
        window.showNotification('לא ניתן למחוק את חשבון מנהל־העל הפעיל.', false);
        return;
    }
    const profile = (window.state.allUsers || []).find(user => user.uid === uid);
    if (!profile) return;
    if (!confirmed) {
        window.showConfirm(
            'מחיקת משתמש',
            `למחוק את ${profile.displayName || profile.email || 'המשתמש'} מרשימת המשתמשים? הפרופיל וכל ההודעות האישיות שלו יימחקו מהאתר.`,
            () => window.deleteManagedUser(uid, true)
        );
        return;
    }
    try {
        await window.moveUserToTrash(uid);
        adminMessageRecipients.delete(window.safeRecordId(uid));
        window.state.allUsers = (window.state.allUsers || []).filter(user => user.uid !== uid);
        window.state.pendingUsers = (window.state.pendingUsers || []).filter(user => user.uid !== uid);
        window.renderManagedUsers();
        window.renderPendingUsers();
        window.renderAdminMessageUsers();
        window.renderAdminMessageReplies();
        window.updatePendingUsersBadge();
        window.showNotification('המשתמש הועבר לסל המחזור.');
    } catch (error) {
        console.error('deleteManagedUser failed:', error);
        window.showNotification('מחיקת המשתמש נכשלה.', false);
    }
};

window.forceRefreshUsers = async function() {
    if (!window.db || !window.state.isSuperAdmin) return;
    try {
        const { collection, getDocs } = window.firestoreModules;
        const snap = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles'));
        const allProfiles = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
        window.state.allUsers = allProfiles.sort((a, b) =>
            String(a.displayName || a.email || '').localeCompare(String(b.displayName || b.email || ''), 'he')
        );
        window.state.pendingUsers = allProfiles
            .filter(p => p.status === 'pending')
            .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
        window.renderManagedUsers?.();
        window.renderPendingUsers?.();
        window.renderAdminMessageUsers?.();
        window.updatePendingUsersBadge?.();
    } catch (e) {
        console.warn('forceRefreshUsers failed:', e);
        window.showNotification('טעינת רשימת המשתמשים נכשלה: ' + (e.message || ''), false);
    }
};

window.renderManagedUsers = function() {
    const list = document.getElementById('managedUsersList');
    if (!list) return;
    list.innerHTML = '';
    const users = (window.state.allUsers || []).filter(profile => profile.status !== 'pending');
    if (users.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין משתמשים נוספים במערכת.';
        list.appendChild(empty);
        return;
    }

    const roleOptions = [
        ['viewer', 'דרגה 1 — העלאה באישור'],
        ['uploader', 'דרגה 2 — העלאה ישירה'],
        ['admin', 'דרגה 3 — מנהל'],
        ['super_admin', 'דרגה 4 — מנהל־על']
    ];
    users.forEach(profile => {
        const isCurrentUser = profile.uid === window.state.currentUser?.uid;
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-slate-200 bg-white/5 p-3 space-y-2';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';
        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[11px] font-bold text-slate-100 truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'text-[9px] text-slate-400 truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        const status = document.createElement('span');
        status.className = profile.status === 'blocked'
            ? 'text-[9px] px-2 py-1 rounded-full bg-red-500/10 text-red-300'
            : 'text-[9px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300';
        status.textContent = profile.status === 'blocked' ? 'חסום' : 'פעיל';
        header.append(identity, status);

        const controls = document.createElement('div');
        controls.className = 'flex gap-2';
        const roleSelect = document.createElement('select');
        roleSelect.className = 'flex-1 text-[10px] border border-slate-700 rounded-lg py-2 px-2 bg-slate-950 text-slate-100';
        roleOptions.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = (profile.status === 'blocked' ? profile.roleBeforeBlock : profile.role) === value;
            roleSelect.appendChild(option);
        });
        roleSelect.disabled = isCurrentUser || profile.status === 'blocked';

        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'px-3 rounded-lg bg-cyan-600 text-white text-[10px] font-bold disabled:opacity-40';
        save.textContent = 'שמור דרגה';
        save.disabled = isCurrentUser || profile.status === 'blocked';
        save.onclick = () => window.changeUserRole(profile.uid, roleSelect.value);

        const block = document.createElement('button');
        block.type = 'button';
        block.className = profile.status === 'blocked'
            ? 'px-3 rounded-lg border border-emerald-500/30 text-emerald-300 text-[10px] font-bold'
            : 'px-3 rounded-lg border border-red-500/30 text-red-300 text-[10px] font-bold';
        block.textContent = profile.status === 'blocked' ? 'בטל חסימה' : 'חסום';
        block.disabled = isCurrentUser;
        block.onclick = () => window.toggleUserBlock(profile.uid);
        controls.append(roleSelect, save, block);

        const linkedActions = document.createElement('div');
        linkedActions.className = 'grid grid-cols-2 gap-2';
        const message = document.createElement('button');
        message.type = 'button';
        message.className = 'py-2 rounded-lg btn-primary-gold text-[10px] font-bold flex items-center justify-center gap-1.5';
        message.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i> שלח הודעה';
        message.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-red-300 text-[10px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40';
        remove.innerHTML = '<i data-lucide="user-x" class="w-3.5 h-3.5"></i> מחק משתמש';
        remove.disabled = isCurrentUser;
        remove.onclick = () => window.deleteManagedUser(profile.uid);
        linkedActions.append(message, remove);

        card.append(header, controls, linkedActions);
        list.appendChild(card);
    });
    window.scheduleIconRefresh();
};

window.renderDeletionRequests = function() {
    const list = document.getElementById('deletionRequestsList');
    const badge = document.getElementById('deletionRequestsCountBadge');
    if (badge) badge.textContent = String((window.state.deletionRequests || []).length);
    if (!list) return;
    list.innerHTML = '';
    const requests = window.state.deletionRequests || [];
    if (requests.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין בקשות מחיקה ממתינות.';
        list.appendChild(empty);
        return;
    }
    const typeLabels = { image: 'תמונה', folder: 'תיקייה', pendingImage: 'תמונה ממתינה' };
    requests.forEach(request => {
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-red-500/15 bg-red-500/5 p-3 space-y-2';
        const title = document.createElement('p');
        title.className = 'text-[11px] font-bold text-slate-100';
        title.textContent = `${typeLabels[request.targetType] || 'פריט'}: ${request.targetName || request.targetId}`;
        const meta = document.createElement('p');
        meta.className = 'text-[9px] text-slate-400';
        meta.textContent = `נשלח על ידי ${request.requestedByName || request.requestedByEmail || 'מנהל דרגה 3'}`;
        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'flex-1 py-2 rounded-lg bg-red-600 text-white text-[10px] font-bold';
        approve.textContent = 'אשר מחיקה';
        approve.onclick = () => window.showConfirm('אישור מחיקה', 'האם לבצע את המחיקה לצמיתות?', () => window.resolveDeletionRequest(request.id, true));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'flex-1 py-2 rounded-lg border border-slate-600 text-slate-300 text-[10px] font-bold';
        reject.textContent = 'דחה בקשה';
        reject.onclick = () => window.resolveDeletionRequest(request.id, false);
        actions.append(approve, reject);
        card.append(title, meta, actions);
        list.appendChild(card);
    });
};

window.resolveDeletionRequest = async function(requestId, approved) {
    if (!window.checkSuperAdminPermission()) return;
    const request = (window.state.deletionRequests || []).find(item => item.id === requestId);
    if (!request) return;
    try {
        if (approved) {
            if (request.targetType === 'image') {
                await window.moveImageToTrash(request.targetId);
            } else if (request.targetType === 'pendingImage') {
                await window.movePendingImageToTrash(request.targetId);
            } else if (request.targetType === 'folder') {
                await window.moveFolderToTrash(request.targetId);
            }
        }
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'deletionRequests', requestId), {
            status: approved ? 'approved' : 'rejected',
            resolvedAt: Date.now(),
            resolvedBy: window.state.currentUser?.uid || ''
        }, { merge: true });
        window.state.deletionRequests = (window.state.deletionRequests || []).filter(item => item.id !== requestId);
        window.renderDeletionRequests?.();
        window.showNotification(approved ? 'בקשת המחיקה אושרה והפריט הועבר לסל המחזור.' : 'בקשת המחיקה נדחתה.');
    } catch (error) {
        console.error('resolveDeletionRequest failed:', error);
        window.showNotification('הטיפול בבקשה נכשל.', false);
    }
};


window.renderPendingUsers = function() {
    const list = document.getElementById('pendingUsersList');
    if (!list) return;
    list.innerHTML = '';
    const pendingUsers = window.state.pendingUsers || [];

    if (pendingUsers.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs text-center text-slate-500 py-4';
        empty.textContent = 'אין בקשות הצטרפות ממתינות.';
        list.appendChild(empty);
        return;
    }

    pendingUsers.forEach(profile => {
        const card = document.createElement('div');
        card.className = 'bg-white/5 border border-white/10 rounded-xl p-3 shadow-sm space-y-2.5';

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2.5';

        const photoUrl = window.safeImageUrl(profile.photoURL);
        if (photoUrl) {
            const photo = document.createElement('img');
            photo.src = photoUrl;
            photo.alt = '';
            photo.className = 'w-9 h-9 rounded-full object-cover border border-slate-700';
            photo.onerror = () => window.handleImageError(photo);
            header.appendChild(photo);
        } else {
            const icon = document.createElement('div');
            icon.className = 'w-9 h-9 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/25';
            icon.innerHTML = '<i data-lucide="user" class="w-4 h-4"></i>';
            header.appendChild(icon);
        }

        const identity = document.createElement('div');
        identity.className = 'min-w-0 flex-1';
        const name = document.createElement('p');
        name.className = 'text-[11px] font-bold text-white truncate';
        name.textContent = profile.displayName || 'משתמש Google';
        const email = document.createElement('p');
        email.className = 'text-[9px] text-slate-400 truncate';
        email.textContent = profile.email || '';
        identity.append(name, email);
        header.appendChild(identity);

        card.appendChild(header);

        // Show submitted details if available
        if (profile.requestDetails) {
            const detailsBox = document.createElement('div');
            detailsBox.className = 'p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[10px] text-slate-300 leading-relaxed';
            detailsBox.innerHTML = `<strong>פרטי בקשה:</strong> ${window.escapeHtml(profile.requestDetails)}`;
            card.appendChild(detailsBox);
        }

        const roleSelect = document.createElement('select');
        roleSelect.className = 'w-full text-[10px] border border-white/10 rounded-lg py-2 px-2 bg-slate-950 text-white';
        [
            ['viewer', 'דרגה 1 — העלאה לאחר אישור'],
            ['uploader', 'דרגה 2 — העלאת תמונות ללא אישור'],
            ['admin', 'דרגה 3 — מנהל'],
            ['super_admin', 'דרגה 4 — מנהל־על']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            roleSelect.appendChild(option);
        });
        card.appendChild(roleSelect);

        // Action triggers
        const actions = document.createElement('div');
        actions.className = 'flex gap-1.5';
        
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] py-2 rounded-lg font-bold';
        approve.textContent = 'אשר';
        approve.onclick = () => window.approveUserAccess(profile.uid, roleSelect.value);

        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        reject.textContent = 'דחה';
        reject.onclick = () => window.rejectUserAccess(profile.uid);

        const msgBtn = document.createElement('button');
        msgBtn.type = 'button';
        msgBtn.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        msgBtn.innerHTML = '<i data-lucide="message-square" class="w-3.5 h-3.5"></i>';
        msgBtn.onclick = () => window.openAdminMessagesForUser(profile.uid);

        const emailBtn = document.createElement('button');
        emailBtn.type = 'button';
        emailBtn.className = 'px-2.5 btn-secondary-dark text-[10px] py-2 rounded-lg font-bold';
        emailBtn.innerHTML = '<i data-lucide="mail" class="w-3.5 h-3.5"></i>';
        emailBtn.onclick = () => window.sendDirectMail(profile.email, profile.displayName);

        actions.append(approve, msgBtn, emailBtn, reject);
        card.appendChild(actions);
        list.appendChild(card);
    });

    window.scheduleIconRefresh();
};
    

window.updateAdminOverview = function() {
    const values = {
        adminOverviewUsersCount: (window.state.pendingUsers || []).length,
        adminOverviewPendingCount: (window.state.pendingImages || []).length,
        adminOverviewImagesCount: (window.state.images || []).length,
        adminOverviewFoldersCount: (window.state.folders || []).filter(folder => folder.id !== 'all').length
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    });
};

window.updatePendingUsersBadge = function() {
    const badge = document.getElementById('pendingUsersCountBadge');
    if (badge) badge.textContent = String((window.state.pendingUsers || []).length);
    window.updateAdminOverview();
};

window.approveUserAccess = async function(uid, role, confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    const allowedRoles = ['viewer', 'uploader', 'admin', 'super_admin'];
    const profile = window.state.pendingUsers.find(item => item.uid === uid);
    if (!profile || !allowedRoles.includes(role)) return;
    const roleLabels = { viewer: 'דרגה 1', uploader: 'דרגה 2', admin: 'דרגה 3', super_admin: 'דרגה 4' };
    if (!confirmed) {
        window.showConfirm(
            'אישור משתמש',
            `לאשר את ${profile.displayName || profile.email || 'המשתמש'} בתור ${roleLabels[role]}? ההרשאה תיכנס לתוקף מיד.`,
            () => window.approveUserAccess(uid, role, true)
        );
        return;
    }

    try {
        const { doc, setDoc } = window.firestoreModules;
        const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid);
        await setDoc(profileRef, {
            status: 'approved',
            role,
            approvedAt: Date.now(),
            approvedBy: window.state.currentUser?.uid || 'system-admin'
        }, { merge: true });
        await window.logActivity('approved_user', 'user', uid, profile.displayName || profile.email || uid, roleLabels[role]);
        const approvedProfile = { ...profile, status: 'approved', role };
        window.state.pendingUsers = (window.state.pendingUsers || []).filter(u => u.uid !== uid);
        window.state.allUsers = (window.state.allUsers || []).filter(u => u.uid !== uid);
        window.state.allUsers.push(approvedProfile);
        window.renderPendingUsers?.();
        window.renderManagedUsers?.();
        window.updatePendingUsersBadge?.();
        window.showNotification(`${profile.displayName || 'המשתמש'} אושר בתור ${roleLabels[role]}.`);
    } catch (error) {
        console.error('Approving user failed:', error);
        window.showNotification('אישור המשתמש נכשל. בדוק את הרשאות Cloudflare.', false);
    }
};

window.rejectUserAccess = function(uid) {
    if (!window.checkSuperAdminPermission()) return;
    const profile = window.state.pendingUsers.find(item => item.uid === uid);
    if (!profile) return;
    window.showConfirm('דחיית משתמש', `לדחות את בקשת ההצטרפות של ${profile.displayName || profile.email || 'המשתמש'}?`, async () => {
        try {
            const { doc, setDoc } = window.firestoreModules;
            const profileRef = doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userProfiles', uid);
            await setDoc(profileRef, {
                status: 'rejected',
                rejectedAt: Date.now(),
                rejectedBy: window.state.currentUser?.uid || 'system-admin'
            }, { merge: true });
            window.state.pendingUsers = (window.state.pendingUsers || []).filter(u => u.uid !== uid);
            window.renderPendingUsers?.();
            window.updatePendingUsersBadge?.();
            window.showNotification('בקשת המשתמש נדחתה.');
        } catch (error) {
            console.error('rejectUserAccess failed:', error);
            window.showNotification('דחיית הבקשה נכשלה.', false);
        }
    });
};

window.renderPendingImages = function() {
    const list = document.getElementById('pendingList'); if (!list) return;
    const pending = window.state.pendingImages || [];
    if (pending.length === 0) { list.innerHTML = '<p class="text-xs text-center text-slate-500 py-4">אין קבצי מדיה ממתינים לאישור.</p>'; return; }
    const parts = [];
    pending.forEach(img => {
        const imageId = window.safeRecordId(img.id);
        if (!imageId) return;
        const imageUrl = window.safeImageUrl(img.url);
        const isVideo = window.isVideoRecord(img);
        const preview = isVideo
            ? '<span class="w-10 h-10 shrink-0 rounded-lg border border-slate-200 bg-slate-900 text-white flex items-center justify-center"><i data-lucide="video" class="w-4 h-4"></i></span>'
            : `<img src="${window.escapeHtml(imageUrl)}" loading="lazy" decoding="async" alt="" class="w-10 h-10 object-cover rounded-lg border border-slate-200" onerror="window.handleImageError(this)">`;
        parts.push(`
            <label class="flex items-center gap-3 p-2 hover:bg-amber-100/50 border border-amber-100 rounded-xl cursor-pointer transition-all bg-white shadow-sm">
                <input type="checkbox" name="pendingImgCheck" value="${imageId}" class="rounded text-amber-500 focus:ring-amber-500 bg-white border-slate-200" checked>
                ${preview}
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] font-bold text-slate-800 truncate">${window.escapeHtml(img.title)}</p>
                    <p class="text-[9px] text-slate-500 truncate">${isVideo ? 'סרטון' : 'תמונה'} · תיקייה מקורית: ${window.escapeHtml(img.originalFolderName)}</p>
                </div>
            </label>`);
    });
    list.innerHTML = parts.join('');
    window.scheduleIconRefresh(list);
}

window.updatePendingBadge = function() {
    const badge = document.getElementById('pendingCountBadge');
    if (badge) badge.innerText = (window.state.pendingImages || []).length;
    window.updateAdminOverview();
}

function toggleSelectAllPending() {
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]');
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = anyUnchecked);
}

async function approveSelectedPending(confirmed = false) {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) { window.showNotification('לא נבחרו תמונות לאישור', false); return; }
    const targetFolderEl = document.getElementById('pendingTargetFolder');
    const targetFolderId = targetFolderEl ? targetFolderEl.value : 'auto';
    if (!confirmed) {
        window.showConfirm(
            'אישור תמונות',
            `לאשר ${checkboxes.length} תמונות ולהעביר אותן לגלריה הפעילה?`,
            () => approveSelectedPending(true)
        );
        return;
    }
    let approvedCount = 0;
    let failedCount = 0;

    const approvedIds = new Set();
    for(let cb of checkboxes) {
        const img = window.state.pendingImages.find(i => i.id === cb.value);
        if (img) {
            try {
                let finalFolderId = targetFolderId;
                if (targetFolderId === 'auto') {
                    const fName = img.originalFolderName || 'כללי'; let existing = window.state.folders.find(f => f.name === fName);
                    if (!existing) {
                        existing = { id: 'folder_' + crypto.randomUUID(), name: fName, icon: 'folder', isDefault: false };
                        await window.saveFolderToCloud(existing);
                    }
                    finalFolderId = existing.id;
                }
                const activeImage = await window.approveImageInR2({
                    ...img,
                    folderId: finalFolderId,
                    createdAt: Date.now(),
                    status: 'active'
                });
                await window.saveImageToCloud(activeImage);
                // שומרים תיעוד של האישור במקום למחוק, כדי שמנהל דרגה 3 לא יקבל הרשאת מחיקה עקיפה.
                const { doc, setDoc } = window.firestoreModules;
                await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'pendingImages', img.id), {
                    status: 'approved',
                    approvedAt: Date.now(),
                    approvedBy: window.state.currentUser?.uid || ''
                }, { merge: true });
                approvedIds.add(window.safeRecordId(img.id));
                approvedCount++;
            } catch (error) {
                failedCount++;
                console.warn('Approve pending image failed:', window.safeRecordId(img.id), error);
            }
        }
    }
    // Remove approved items from local pendingImages state immediately
    if (approvedIds.size) {
        window.state.pendingImages = (window.state.pendingImages || []).filter(img => !approvedIds.has(window.safeRecordId(img.id)));
        window.renderPendingImages?.();
        window.updatePendingBadge?.();
    }
    if (approvedCount) await window.logActivity('approved_images', 'image', '', `${approvedCount} תמונות`);
    window.showNotification(
        failedCount
            ? `אושרו ${approvedCount} תמונות; ${failedCount} נכשלו.`
            : `אושרו ${approvedCount} תמונות בהצלחה לענן!`,
        !failedCount
    );
}

function rejectSelectedPending() {
    if (!window.checkAdminPermission()) return;
    const checkboxes = document.querySelectorAll('input[name="pendingImgCheck"]:checked');
    if (checkboxes.length === 0) return;
    if (!window.state.isSuperAdmin) {
        window.showConfirm('שליחת בקשת מחיקה', 'לשלוח למנהל־העל בקשת מחיקה עבור התמונות שנבחרו?', async () => {
            try {
                await Promise.all(Array.from(checkboxes, cb => {
                    const image = window.state.pendingImages.find(item => window.safeRecordId(item.id) === window.safeRecordId(cb.value));
                    return window.requestContentDeletion('pendingImage', cb.value, image?.title || 'תמונה ממתינה');
                }));
                window.showNotification('בקשות המחיקה נשלחו למנהל־העל.');
            } catch (error) {
                console.error('requestContentDeletion failed:', error);
                window.showNotification(error.message || 'שליחת הבקשה נכשלה.', false);
            }
        });
        return;
    }
    window.showConfirm('דחיית תמונות', 'להעביר את התמונות הממתינות לסל המחזור?', async () => {
        try {
            await Promise.all(Array.from(checkboxes, cb => window.movePendingImageToTrash(cb.value)));
            window.showNotification('התמונות הועברו לסל המחזור.');
        } catch (error) {
            console.error('movePendingImageToTrash failed:', error);
            window.showNotification('העברה לסל המחזור נכשלה.', false);
        }
    });
}


// =================== POPUP ANNOUNCEMENT ===================

function popupAnnouncementVersion(config) {
    return String(config?.updatedAt || config?.imageUrl || 'current');
}

window.loadPopupAnnouncement = async function(retryCount = 0) {
    if (!window.db || !window.firestoreModules?.doc || !window.firestoreModules?.getDoc) {
        if (retryCount < 24) {
            clearTimeout(window._popupAnnouncementRetryTimer);
            window._popupAnnouncementRetryTimer = setTimeout(
                () => window.loadPopupAnnouncement?.(retryCount + 1),
                Math.min(3000, 250 + retryCount * 150)
            );
        } else {
            console.warn('Popup load skipped: cloud connection was not ready.');
        }
        return;
    }
    if (window._popupAnnouncementLoadPromise) return window._popupAnnouncementLoadPromise;
    window._popupAnnouncementLoadPromise = (async () => {
        try {
            const { doc, getDoc } = window.firestoreModules;
            const snap = await getDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
            const config = snap.exists() ? snap.data() : null;
            window.state.popupAnnouncementConfig = config || null;
            window.renderPopupAnnouncementAdmin?.();
            if (config?.enabled) window.showPopupAnnouncement(config);
        } catch (e) {
            console.warn('Popup load failed:', e);
            if (retryCount < 3) {
                clearTimeout(window._popupAnnouncementRetryTimer);
                window._popupAnnouncementRetryTimer = setTimeout(
                    () => window.loadPopupAnnouncement?.(retryCount + 1),
                    1000 * (retryCount + 1)
                );
            }
        } finally {
            window._popupAnnouncementLoadPromise = null;
        }
    })();
    return window._popupAnnouncementLoadPromise;
};

window.showPopupAnnouncement = function(config) {
    if (!config || !config.enabled || !config.imageUrl) return;
    const version = popupAnnouncementVersion(config);
    try {
        if (sessionStorage.getItem('popupAnnouncementDismissedVersion') === version) return;
    } catch (e) { /* ignore */ }

    if (config.audience === 'approved') {
        const status = window.state?.userApprovalStatus;
        if (status !== 'approved') return;
    }

    const modal = document.getElementById('popupAnnouncementModal');
    const img = document.getElementById('popupAnnouncementDisplayImg');
    if (!modal || !img) return;

    img.style.cursor = config.linkType && config.linkType !== 'none' ? 'pointer' : 'default';
    img.onload = () => {
        modal.classList.remove('hidden');
        window.scheduleIconRefresh();
    };
    img.onerror = () => {
        modal.classList.add('hidden');
        console.warn('Popup image failed to load.');
    };
    img.src = config.imageUrl;
    if (img.complete && img.naturalWidth > 0) img.onload();
};

window.closePopupAnnouncement = function() {
    const modal = document.getElementById('popupAnnouncementModal');
    if (!modal) return;
    modal.classList.add('hidden');
    try {
        sessionStorage.setItem(
            'popupAnnouncementDismissedVersion',
            popupAnnouncementVersion(window.state?.popupAnnouncementConfig)
        );
        sessionStorage.removeItem('popupAnnouncementDismissed');
    } catch (e) { /* ignore */ }
};

window.handlePopupAnnouncementClick = function() {
    const config = window.state?.popupAnnouncementConfig;
    if (!config || !config.linkType || config.linkType === 'none') return;
    window.closePopupAnnouncement();
    if (config.linkType === 'latest') {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder('all');
        window.state.gallerySort = 'newest';
        window.renderImages?.();
    } else if (config.linkType === 'folder' && config.folderId) {
        if (typeof window.setActiveFolder === 'function') window.setActiveFolder(config.folderId);
    }
};

window.renderPopupAnnouncementAdmin = function() {
    const config = window.state?.popupAnnouncementConfig;

    const preview = document.getElementById('popupAnnouncementPreview');
    const previewImg = document.getElementById('popupAnnouncementPreviewImg');
    const statusEl = document.getElementById('popupAnnouncementStatus');
    const audienceEl = document.getElementById('popupAnnouncementAudienceLabel');
    const enabledCb = document.getElementById('popupEnabled');

    if (config && config.imageUrl) {
        if (preview) preview.classList.remove('hidden');
        if (previewImg) previewImg.src = config.imageUrl;
        if (statusEl) statusEl.textContent = config.enabled ? 'פעיל' : 'כבוי';
        if (audienceEl) audienceEl.textContent = config.audience === 'approved' ? 'מורשים בלבד' : 'כולם';
    } else {
        if (preview) preview.classList.add('hidden');
    }

    if (enabledCb) enabledCb.checked = config ? !!config.enabled : true;

    const linkType = config?.linkType || 'none';
    document.querySelectorAll('input[name="popupLinkType"]').forEach(r => { r.checked = r.value === linkType; });
    const folderArea = document.getElementById('popupFolderSelectorArea');
    if (folderArea) folderArea.classList.toggle('hidden', linkType !== 'folder');

    const audience = config?.audience || 'all';
    document.querySelectorAll('input[name="popupAudience"]').forEach(r => { r.checked = r.value === audience; });

    const folderSelect = document.getElementById('popupFolderSelect');
    if (folderSelect) {
        folderSelect.innerHTML = (window.state.folders || [])
            .filter(f => f.id !== 'all')
            .map(f => `<option value="${f.id}"${String(config?.folderId) === String(f.id) ? ' selected' : ''}>${f.name || f.id}</option>`)
            .join('');
    }
};

window.savePopupAnnouncement = async function() {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    const statusEl = document.getElementById('popupSaveStatus');
    const saveButton = document.getElementById('popupSaveButton');
    if (saveButton?.disabled) return;
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'מכין...';
    }
    if (statusEl) statusEl.textContent = 'מכין את התמונה להעלאה מהירה...';

    try {
        const fileInput = document.getElementById('popupImageInput');
        const file = fileInput?.files?.[0];
        const linkType = document.querySelector('input[name="popupLinkType"]:checked')?.value || 'none';
        const audience = document.querySelector('input[name="popupAudience"]:checked')?.value || 'all';
        const enabled = document.getElementById('popupEnabled')?.checked !== false;
        const folderId = linkType === 'folder' ? (document.getElementById('popupFolderSelect')?.value || '') : '';

        let imageUrl = window.state.popupAnnouncementConfig?.imageUrl || '';
        let r2Key = window.state.popupAnnouncementConfig?.r2Key || '';

        if (file) {
            if (!String(file.type || '').startsWith('image/')) throw new Error('יש לבחור קובץ תמונה תקין.');
            if (file.size > 20 * 1024 * 1024) throw new Error('גודל התמונה חייב להיות עד 20MB.');
            const compressedDataUrl = await Promise.race([
                window.compressAndConvertImage(file, 1280, 1280, 0.78),
                new Promise((_, reject) => setTimeout(() => reject(new Error('הכנת התמונה נתקעה. נסה קובץ JPG או PNG אחר.')), 20000))
            ]);
            if (!compressedDataUrl) throw new Error('לא ניתן היה להכין את התמונה להעלאה.');
            const uploadBlob = window.dataUrlToBlob(compressedDataUrl);
            if (statusEl) statusEl.textContent = `מעלה תמונה ממוטבת (${Math.max(1, Math.round(uploadBlob.size / 1024))}KB)...`;
            if (saveButton) saveButton.textContent = 'מעלה...';
            const popupId = 'popup_announcement_' + Date.now();
            const uploaded = await window.uploadMediaToR2(uploadBlob, popupId, 'popup-announcement');
            if (!uploaded?.url) throw new Error('העלאת התמונה נכשלה.');
            if (r2Key && r2Key !== uploaded.r2Key) {
                await window.deleteImageFromR2({ r2Key }).catch(() => {});
            }
            imageUrl = uploaded.url;
            r2Key = uploaded.r2Key || '';
        }

        if (!imageUrl) throw new Error('יש לבחור תמונה לפופ-אפ.');

        const config = { imageUrl, r2Key, linkType, folderId, audience, enabled, updatedAt: Date.now() };
        const { doc, setDoc } = window.firestoreModules;
        await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'), config);
        window.state.popupAnnouncementConfig = config;
        if (fileInput) fileInput.value = '';
        window.renderPopupAnnouncementAdmin();
        try {
            sessionStorage.removeItem('popupAnnouncementDismissed');
            sessionStorage.removeItem('popupAnnouncementDismissedVersion');
        } catch (error) {}
        if (statusEl) statusEl.textContent = 'נשמר בהצלחה!';
        window.showNotification('הפופ-אפ נשמר ופורסם.', true);
        setTimeout(() => window.showPopupAnnouncement?.(config), 350);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'שמירה נכשלה');
        window.showNotification('שגיאה בשמירת הפופ-אפ: ' + (e.message || ''), false);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'שמור ופרסם';
        }
    }
};

window.deletePopupAnnouncement = async function(confirmed) {
    if (!window.state.isSuperAdmin) { window.showNotification('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    if (!confirmed) {
        if (!confirm('למחוק את הודעת הפופ-אפ?')) return;
        return window.deletePopupAnnouncement(true);
    }
    const statusEl = document.getElementById('popupSaveStatus');
    if (statusEl) statusEl.textContent = 'מוחק...';
    try {
        const r2Key = window.state.popupAnnouncementConfig?.r2Key;
        if (r2Key) await window.deleteImageFromR2({ r2Key }).catch(() => {});
        const { doc, deleteDoc } = window.firestoreModules;
        await deleteDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'popupAnnouncement'));
        window.state.popupAnnouncementConfig = null;
        window.renderPopupAnnouncementAdmin();
        if (statusEl) statusEl.textContent = '';
        window.showNotification('הפופ-אפ נמחק.', true);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'שגיאה: ' + (e.message || 'מחיקה נכשלה');
        window.showNotification('שגיאה במחיקת הפופ-אפ: ' + (e.message || ''), false);
    }
};


// חשיפה ל-window עבור מטפלי onclick שנשארו ב-HTML.
window.approveSelectedPending = approveSelectedPending;
window.rejectSelectedPending = rejectSelectedPending;
window.toggleSelectAllPending = toggleSelectAllPending;

// נקודת האתחול של המודול. app.js קורא לה פעם אחת בטעינת האתר.
export function initAdmin() {
    window.updateAdminUI?.();
}
