// הצגת השיחה: בועות, תאריכים, כיוונים ומצב קריאה
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.

import { conversationAttachmentCanPreview } from './attachments.js';
import { activeConversationMode, activeConversationProfile, conversationEntries } from './conversation.js';
import { conversationStickerById } from './stickers.js';

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
