// שיחה פעילה: פתיחה, טעינה, שליחה ומצב נקרא
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.

import { activeConversationAttachment, normalizeConversationAttachment, uploadConversationAttachment } from './attachments.js';
import { activeConversationSticker, normalizeConversationSticker, setActiveConversationSticker } from './stickers.js';

let activeConversationUid = '';

// activeConversationUid מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveConversationUid(value) {
    activeConversationUid = value;
}

export let activeConversationMode = '';

// activeConversationMode מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveConversationMode(value) {
    activeConversationMode = value;
}

export let conversationSending = false;

// conversationSending מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setConversationSending(value) {
    conversationSending = value;
}

export function messageDirection(message) {
    return message?.direction === 'user_to_admin' ? 'user_to_admin' : 'admin_to_user';
}

export function conversationEntries(profile) {
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

export function activeConversationProfile() {
    if (activeConversationMode === 'admin') {
        return (window.state.allUsers || []).find(user => window.safeRecordId(user.uid) === window.safeRecordId(activeConversationUid)) || null;
    }
    return window.state.userProfile || null;
}

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
        setActiveConversationSticker(null);
        window.renderActiveConversation();
        window.renderFloatingInbox?.();
        window.renderAdminMessageReplies?.();
    } catch (error) {
        setActiveConversationSticker(null);
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
