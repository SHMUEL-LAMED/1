// בורר המדבקות ושליחתן
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.

import { conversationSending } from './conversation.js';

let activeStickerPack = 'greetings';

// activeStickerPack מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveStickerPack(value) {
    activeStickerPack = value;
}

export let activeConversationSticker = null;

// activeConversationSticker מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveConversationSticker(value) {
    activeConversationSticker = value;
}

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

export function conversationStickerById(id) {
    for (const pack of CONVERSATION_STICKER_PACKS) {
        const sticker = pack.stickers.find(item => item.id === id);
        if (sticker) return sticker;
    }
    return null;
}

export function normalizeConversationSticker(value) {
    const id = window.safeRecordId(typeof value === 'string' ? value : value?.id);
    const sticker = conversationStickerById(id);
    return sticker ? { id: sticker.id } : null;
}

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
