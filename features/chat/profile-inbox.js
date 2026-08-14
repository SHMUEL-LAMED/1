// ההתראות החדשות שמופיעות בפרופיל
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.

import { collectAdminMessageReplies } from './admin-center.js';
import { messageDirection } from './conversation.js';
import { conversationStickerById, normalizeConversationSticker } from './stickers.js';

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
