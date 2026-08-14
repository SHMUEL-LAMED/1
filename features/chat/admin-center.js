// מרכז ההודעות של מנהל־העל: רשימת שיחות, סינון ותשובות
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.

import { normalizeConversationAttachment } from './attachments.js';
import { messageDirection } from './conversation.js';
import { conversationStickerById, normalizeConversationSticker } from './stickers.js';

const adminMessageRecipients = new Set();

// adminMessageRecipients מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setAdminMessageRecipients(value) {
    adminMessageRecipients = value;
}

let adminMessageSending = false;

// adminMessageSending מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setAdminMessageSending(value) {
    adminMessageSending = value;
}

let adminConversationFilter = 'all';

// adminConversationFilter מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setAdminConversationFilterValue(value) {
    adminConversationFilter = value;
}

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

export function collectAdminMessageReplies() {
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
