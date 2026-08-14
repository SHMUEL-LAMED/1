// בורר האימוג׳ים
// פוצל מתוך chat.js. הקוד עצמו לא שונה — רק מיקומו.


const CONVERSATION_EMOJI_GROUPS = [
    { id: 'recent', label: 'נפוצים', icon: 'clock-3', emojis: ['😊','😂','😍','👍','🙏','❤️','🎉','🔥','👏','😇','🤝','✅'] },
    { id: 'faces', label: 'פנים', icon: 'smile', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😋','😎','🤓','🧐','🤔','🤗','🤭','🤫','😐','😑','😶','🙄','😏','😣','😥','😮','😯','😲','😴','🤤','😪','😵','🤐','🥴','🤢','🤧','🥳','🥺','😭','😤','😡'] },
    { id: 'gestures', label: 'ידיים', icon: 'hand', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','👏','🙌','👐','🤲','🙏','✍️','💪'] },
    { id: 'hearts', label: 'לבבות', icon: 'heart', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'] },
    { id: 'objects', label: 'סמלים', icon: 'sparkles', emojis: ['🎉','🎊','🎈','🎁','🏆','🥇','⭐','🌟','✨','⚡','🔥','💥','✅','❌','❗','❓','💯','📸','📎','📁','🖼️','🔔','💬','📅','🕐'] }
];

let activeEmojiGroup = 'recent';

// activeEmojiGroup מתעדכן גם ממודולים אחרים. ייבוא ב-ES modules הוא לקריאה
// בלבד, ולכן העדכון עובר דרך הפונקציה הזו במקום השמה ישירה.
export function setActiveEmojiGroup(value) {
    activeEmojiGroup = value;
}

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
