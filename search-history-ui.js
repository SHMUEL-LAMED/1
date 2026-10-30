// search-history-ui.js — התפריט שנפתח מתחת לשדה החיפוש של הגלריה: חיפושים
// שמורים (בכוכב) וחיפושים אחרונים, עם שמירה/הסרת כוכב, הסרה וניקוי — ובזמן
// ההקלדה גם הצעות להשלמה (תיקיות ואירועים, סוג הרגע, אנשים ומעלים).
//
// הלוגיקה והאחסון ב-search-history.js (בלי DOM). כאן: התפריט עצמו, מתי חיפוש
// נרשם, החזרת חיפוש לגלריה, והסנכרון של השמורים למסמך userPreferences.
// ההצעות הן חלק מאותו combobox ולא חלון שני: ההתאמה ב-search-suggest.js,
// המקורות וההפעלה ב-search-suggest-ui.js, והשורות שלהן נבנות כאן, לפני
// החיפושים הקודמים שמכילים את הטקסט. בשדה ריק אין הצעות — רק האחרונים
// והשמורים. ההצעות מחושבות מחדש SUGGEST_DEBOUNCE_MS אחרי ההקשה האחרונה,
// ופתיחה של התפריט (פוקוס, לחיצה, חץ) מחשבת אותן מיד.
//
// נגישות — תבנית combobox של ARIA עם חלון מסוג grid: הפוקוס נשאר בשדה, והתא
// הפעיל מסומן ב-aria-activedescendant. כל שורה היא חיפוש, ובה שלושה תאים:
// הפעלת החיפוש, כוכב והסרה; שורה של הצעה היא תא אחד, על פני שלוש העמודות.
//   חץ למטה/למעלה — שורה הבאה/קודמת (ופתיחת התפריט כשהוא סגור).
//   חץ שמאלה/ימינה — התא הבא/הקודם בשורה, לפי כיוון הכתיבה (מימין לשמאל).
//   Enter — הפעולה של התא הפעיל (בהצעה: הפעלתה); בלי תא פעיל — רישום החיפוש שבשדה.
//   Delete — הסרת השורה הפעילה. Escape — סגירת התפריט.
// כל שינוי מצב מוכרז ב-#searchHistoryStatus (aria-live).
//
// חיפוש נרשם לרשימת האחרונים ב-Enter, אחרי שתי שניות בלי הקלדה, ביציאה
// מהשדה ובהפעלה מהתפריט — רק כשיש בו טקסט (לפחות שני תווים, חוץ מ-Enter).
// רישום שהטיימר עשה באמצע הקלדה הוא "שלב הקלדה": אם ההקלדה נמשכת ("בר" ←
// "בר מצווה"), הרישום הבא שלה מחליף אותו. רישום מ-Enter, מהתפריט או משינוי
// סינון אינו שלב ואינו מחליף דבר.
//
// חיפוש נרשם רק אצל מי שכתב אותו. בהתנתקות או בהחלפת חשבון באותה לשונית
// (הדף אינו נטען מחדש) הטקסט והסינון מתאפסים, ורישום שעוד ממתין מתבטל — כך
// החיפוש של אדם אחד אינו נשמר ברשימה של מי שבא אחריו במחשב משותף.
import {
    createSearchHistoryStore, describeSearch, normalizeQuery, searchId,
    SAVED_SEARCH_LIMIT
} from './search-history.js';
import { MIN_SUGGEST_QUERY_LENGTH, SUGGEST_DEBOUNCE_MS, suggestionsMessage } from './search-suggest.js';
import { applySuggestion, loadPeopleSuggestions, resetSuggestionSources, suggestionsFor } from './search-suggest-ui.js';

export const IDLE_COMMIT_MS = 2000;
const MIN_AUTO_QUERY_LENGTH = 2;
const PUSH_DELAY_MS = 600;

const ICONS = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star: '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>',
    // סמלי ההצעות, לפי הסוג (search-suggest.js).
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    uploader: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>'
};

let box = null;
let input = null;
let popup = null;
let statusRegion = null;
let isOpen = false;
// השורות שאפשר לנווט אליהן, לפי סדר התצוגה: { kind, entry, suggestion, cells: [{ element, action }] }.
let rows = [];
// ההצעות שבתפריט. בין הקשה לחישוב הבא (SUGGEST_DEBOUNCE_MS) מוצגות עדיין
// ההצעות של הטקסט הקודם.
let suggestionGroups = [];
let suggestTimer = 0;
let suggestionsDismissed = false;
// ההודעה האחרונה על מספר השורות, כדי לא להכריז שוב את אותו מספר בכל הקשה.
let lastCountMessage = '';
let active = null; // { row, col }
let idleTimer = 0;
let pushTimer = 0;
let announceTimer = 0;
let pendingPushUid = '';
let lastCommittedId = '';
// מזהה הרשומה שהטיימר רשם באמצע הקלדה, כל עוד היא שלב שההמשך רשאי להחליף.
let typingStepId = '';
// המשתמש שכתב את הטקסט שבשדה (בהקלדה, ב-Enter או בהפעלה מהתפריט), ו'' למי
// שאינו מחובר.
let authorUid = '';
// המשתמש שהמודול מכיר; כשהוא מתחלף, החיפוש מתאפס (handleUserChange).
let knownUid = '';
const stores = new Map();

// --- המשתמש והמאגר ---

function currentUserId() {
    const state = window.state;
    return state?.isGoogleUser && state.currentUser?.uid ? String(state.currentUser.uid) : '';
}

function storeFor(userId) {
    const key = userId || '';
    if (!stores.has(key)) stores.set(key, createSearchHistoryStore({ userId }));
    return stores.get(key);
}

function currentStore() {
    return storeFor(currentUserId());
}

function folderName(id) {
    if (id === 'favorites') return 'המועדפים';
    const folders = Array.isArray(window.state?.folders) ? window.state.folders : [];
    const safe = value => (window.safeRecordId ? window.safeRecordId(value) : String(value ?? ''));
    return folders.find(folder => safe(folder.id) === id)?.name || '';
}

function lower(text) {
    return String(text || '').toLocaleLowerCase('he');
}

// --- הכרזות לקוראי מסך ---

function announce(message) {
    if (!statusRegion) return;
    window.clearTimeout(announceTimer);
    // ריקון ואז כתיבה, כדי שהודעה זהה לקודמת תוכרז שוב.
    statusRegion.textContent = '';
    announceTimer = window.setTimeout(() => { statusRegion.textContent = message; }, 40);
}

// --- בניית התפריט ---

function element(tag, attributes = {}, text = '') {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
        if (value === null || value === undefined || value === false) continue;
        node.setAttribute(name, value === true ? '' : String(value));
    }
    if (text) node.textContent = text;
    return node;
}

function iconSpan(name, className) {
    const span = element('span', { class: className, 'aria-hidden': 'true' });
    span.innerHTML = ICONS[name];
    return span;
}

function visibleEntries(store) {
    const text = lower(normalizeQuery(input?.value || ''));
    const matches = entry => !text || lower(entry.query).includes(text);
    const allSaved = store.getSaved();
    const savedIds = new Set(allSaved.map(entry => entry.id));
    const allRecent = store.getRecent();
    return {
        saved: allSaved.filter(matches),
        // חיפוש שמור מוצג פעם אחת — ברשימת השמורים.
        recent: allRecent.filter(entry => !savedIds.has(entry.id) && matches(entry)),
        // "ניקוי" מוצג כשיש חיפוש אחרון שאינו שמור — גם אם הטקסט שבשדה מסנן אותו.
        hasRecent: allRecent.some(entry => !savedIds.has(entry.id))
    };
}

function cellId(row, col) {
    return `searchHistoryCell-${row}-${col}`;
}

// הזהות של שורה לאורך ציורים חוזרים: מזהה החיפוש, או המפתח של ההצעה.
function rowKey(row) {
    return row?.entry?.id || row?.suggestion?.key || '';
}

function buildEntryRow(kind, entry, store) {
    const rowIndex = rows.length;
    const { query, details } = describeSearch(entry, { folderName });
    const saved = kind === 'saved' || store.isSaved(entry.id);
    const row = element('div', { role: 'row', class: 'search-history-row', 'data-kind': kind, 'data-search-id': entry.id });

    const main = element('div', { role: 'gridcell', id: cellId(rowIndex, 0), class: 'search-history-cell search-history-cell-main' });
    const apply = element('button', { type: 'button', tabindex: '-1', class: 'search-history-apply', 'data-action': 'apply' });
    apply.append(iconSpan(saved ? 'star' : 'clock', `search-history-kind${saved ? ' is-saved' : ''}`));
    const text = element('span', { class: 'search-history-text' });
    text.append(element('span', { class: 'search-history-query' }, query));
    if (details.length) text.append(element('span', { class: 'search-history-meta' }, details.join(' · ')));
    apply.append(text);
    main.append(apply);

    const starCell = element('div', { role: 'gridcell', id: cellId(rowIndex, 1), class: 'search-history-cell' });
    const star = element('button', {
        type: 'button', tabindex: '-1', class: 'search-history-tool search-history-star', 'data-action': 'star',
        'aria-pressed': saved ? 'true' : 'false',
        'aria-label': saved ? `הסרת הכוכב מהחיפוש „${query}”` : `שמירת החיפוש „${query}” בכוכב`,
        title: saved ? 'הסרת הכוכב' : 'שמירה בכוכב'
    });
    star.innerHTML = ICONS.star;
    starCell.append(star);

    const removeCell = element('div', { role: 'gridcell', id: cellId(rowIndex, 2), class: 'search-history-cell' });
    const remove = element('button', {
        type: 'button', tabindex: '-1', class: 'search-history-tool search-history-remove', 'data-action': 'remove',
        'aria-label': kind === 'saved' ? `מחיקת החיפוש השמור „${query}”` : `הסרת „${query}” מהחיפושים האחרונים`,
        title: 'הסרה מהרשימה'
    });
    remove.innerHTML = ICONS.remove;
    removeCell.append(remove);

    row.append(main, starCell, removeCell);
    rows.push({ kind, entry, element: row, cells: [{ element: main, action: 'apply' }, { element: starCell, action: 'star' }, { element: removeCell, action: 'remove' }] });
    return row;
}

function buildGroup(kind, label, entries, store) {
    if (!entries.length) return null;
    const headingId = `searchHistoryHeading-${kind}`;
    const group = element('div', { role: 'rowgroup', class: 'search-history-group', 'data-kind': kind, 'aria-labelledby': headingId });
    const headingRow = element('div', { role: 'row', class: 'search-history-heading' });
    headingRow.append(element('div', { role: 'columnheader', id: headingId, 'aria-colspan': '3' }, label));
    group.append(headingRow);
    for (const entry of entries) group.append(buildEntryRow(kind, entry, store));
    return group;
}

// שורה של הצעה: תא אחד על פני שלוש העמודות, ובו כפתור ההפעלה.
function buildSuggestionRow(suggestion) {
    const rowIndex = rows.length;
    const row = element('div', { role: 'row', class: 'search-suggest-row', 'data-kind': suggestion.kind, 'data-suggestion-key': suggestion.key });
    const cell = element('div', { role: 'gridcell', 'aria-colspan': '3', id: cellId(rowIndex, 0), class: 'search-history-cell search-history-cell-main' });
    const apply = element('button', { type: 'button', tabindex: '-1', class: 'search-history-apply search-suggest-apply', 'data-action': 'suggest' });
    apply.append(iconSpan(suggestion.kind, 'search-history-kind search-suggest-kind'));
    const text = element('span', { class: 'search-history-text' });
    text.append(element('span', { class: 'search-history-query' }, suggestion.label));
    if (suggestion.meta) text.append(element('span', { class: 'search-history-meta' }, suggestion.meta));
    apply.append(text);
    cell.append(apply);
    row.append(cell);
    rows.push({ kind: 'suggestion', entry: null, suggestion, element: row, cells: [{ element: cell, action: 'suggest' }] });
    return row;
}

function buildSuggestionGroup(group) {
    const headingId = `searchSuggestHeading-${group.kind}`;
    const node = element('div', { role: 'rowgroup', class: 'search-history-group search-suggest-group', 'data-kind': group.kind, 'aria-labelledby': headingId });
    const headingRow = element('div', { role: 'row', class: 'search-history-heading' });
    headingRow.append(element('div', { role: 'columnheader', id: headingId, 'aria-colspan': '3' }, group.label));
    node.append(headingRow);
    for (const suggestion of group.items) node.append(buildSuggestionRow(suggestion));
    return node;
}

function render() {
    const store = currentStore();
    const { saved, recent, hasRecent } = visibleEntries(store);
    rows = [];
    popup.replaceChildren();
    // בזמן ההקלדה ההצעות ראשונות, ואחריהן החיפושים הקודמים שמכילים את הטקסט.
    // בשדה ריק אין הצעות.
    const groups = normalizeQuery(input?.value || '') ? suggestionGroups : [];
    for (const group of groups) popup.append(buildSuggestionGroup(group));
    const suggestionRows = rows.length;
    const savedGroup = buildGroup('saved', 'חיפושים שמורים', saved, store);
    const recentGroup = buildGroup('recent', 'חיפושים אחרונים', recent, store);
    if (savedGroup) popup.append(savedGroup);
    if (recentGroup) popup.append(recentGroup);
    // "ניקוי" וההערה על האחסון שייכים לחיפושים הקודמים: רק כשיש כאלה בתפריט.
    if (rows.length === suggestionRows) return rows.length;

    const footer = element('div', { role: 'rowgroup', class: 'search-history-footer' });
    if (hasRecent) {
        const rowIndex = rows.length;
        const row = element('div', { role: 'row', class: 'search-history-actions' });
        const cell = element('div', { role: 'gridcell', id: cellId(rowIndex, 0), class: 'search-history-cell' });
        const clear = element('button', { type: 'button', tabindex: '-1', class: 'search-history-clear', 'data-action': 'clear' });
        clear.append(iconSpan('clear', 'search-history-clear-icon'), element('span', {}, 'ניקוי החיפושים האחרונים'));
        cell.append(clear);
        row.append(cell);
        footer.append(row);
        rows.push({ kind: 'actions', entry: null, element: row, cells: [{ element: cell, action: 'clear' }] });
    }
    if (!store.persistent) {
        const row = element('div', { role: 'row', class: 'search-history-note' });
        row.append(element('div', { role: 'gridcell' }, 'הדפדפן חוסם שמירה מקומית — הרשימה תישמר רק עד רענון הדף.'));
        footer.append(row);
    }
    if (footer.childElementCount) popup.append(footer);
    return rows.length;
}

// --- פתיחה, סגירה ותא פעיל ---

function setActive(rowIndex, colIndex = 0) {
    popup?.querySelectorAll('.search-history-cell.is-active').forEach(cell => cell.classList.remove('is-active'));
    if (rowIndex === null || !rows[rowIndex]) {
        active = null;
        input?.removeAttribute('aria-activedescendant');
        return;
    }
    const row = rows[rowIndex];
    const col = Math.max(0, Math.min(colIndex, row.cells.length - 1));
    active = { row: rowIndex, col };
    const cell = row.cells[col].element;
    cell.classList.add('is-active');
    input.setAttribute('aria-activedescendant', cell.id);
    cell.scrollIntoView?.({ block: 'nearest' });
}

function countMessage() {
    const entries = rows.filter(row => row.kind === 'saved' || row.kind === 'recent');
    const saved = entries.filter(row => row.kind === 'saved').length;
    const recent = entries.length - saved;
    const parts = [];
    const suggestions = suggestionsMessage(rows.filter(row => row.kind === 'suggestion').length);
    if (suggestions) parts.push(suggestions);
    if (saved) parts.push(saved === 1 ? 'חיפוש שמור אחד' : `${saved} חיפושים שמורים`);
    if (recent) parts.push(recent === 1 ? 'חיפוש אחרון אחד' : `${recent} חיפושים אחרונים`);
    return `${parts.join(' ו־')}. חיצים למעלה ולמטה לבחירה.`;
}

// refreshSuggestions: פתיחה מפוקוס, מלחיצה או מחץ מחשבת את ההצעות מיד; פתיחה
// מתוך הקלדה משאירה אותן להשהיה (scheduleSuggestions).
function openPopup({ announceCount = true, refreshSuggestions = true } = {}) {
    if (!popup || !input) return false;
    if (refreshSuggestions) {
        suggestionsDismissed = false;
        computeSuggestions();
    }
    const count = render();
    if (!count) {
        closePopup();
        return false;
    }
    const wasOpen = isOpen;
    popup.hidden = false;
    isOpen = true;
    input.setAttribute('aria-expanded', 'true');
    box.classList.add('is-open');
    box.closest('.gallery-toolbar')?.classList.add('has-open-search');
    setActive(null);
    if (announceCount && !wasOpen) {
        lastCountMessage = countMessage();
        announce(lastCountMessage);
    }
    return true;
}

function closePopup() {
    if (!popup || !input) return;
    popup.hidden = true;
    isOpen = false;
    input.setAttribute('aria-expanded', 'false');
    box?.classList.remove('is-open');
    box?.closest('.gallery-toolbar')?.classList.remove('has-open-search');
    setActive(null);
    lastCountMessage = '';
    // ההצעות של טקסט קודם אינן נשארות לפתיחה הבאה: אחרי Escape והקשה נוספת
    // התפריט היה נפתח מיד עם הצעה שכבר אינה מתאימה (ומכריז עליה). פתיחה
    // מפורשת מחשבת אותן מחדש, והקלדה — אחרי ההשהיה.
    suggestionGroups = [];
}

// ציור מחדש אחרי פעולה, עם שמירת המיקום: אותו חיפוש ואותו תא, או השורה
// שתפסה את מקומו.
function refreshKeepingPosition(previous) {
    const count = render();
    if (!count) {
        closePopup();
        return;
    }
    if (!previous) {
        setActive(null);
        return;
    }
    const sameEntry = previous.entryId ? rows.findIndex(row => rowKey(row) === previous.entryId) : -1;
    const target = sameEntry >= 0 ? sameEntry : Math.min(previous.row, rows.length - 1);
    setActive(target, previous.col);
}

// --- הצעות ההשלמה ---

function currentPosition() {
    return active ? { row: active.row, col: active.col, entryId: rowKey(rows[active.row]) } : null;
}

// Enter, Escape, Tab, יציאה מהשדה ובחירה: חישוב שעוד ממתין, או רשימת האנשים
// שמגיעה מאוחר, אינם פותחים מחדש את התפריט שהמשתמש סגר זה עתה. הקלדה או פתיחה
// מפורשת מחזירות אותם.
function stopPendingSuggestions() {
    window.clearTimeout(suggestTimer);
    suggestTimer = 0;
    suggestionsDismissed = true;
}

function cancelSuggestions() {
    stopPendingSuggestions();
    suggestionGroups = [];
}

// ההצעות לטקסט שבשדה. המפתח שמאחוריהן נבנה מחדש רק כשהמקורות השתנו
// (search-suggest-ui.js), ולכן החישוב זול. בפעם הראשונה נמשכת ברקע גם רשימת
// האנשים; כשהיא מגיעה — חישוב נוסף, אם הטקסט לא השתנה בינתיים.
function computeSuggestions() {
    window.clearTimeout(suggestTimer);
    suggestTimer = 0;
    const query = normalizeQuery(input?.value || '');
    if (query.length < MIN_SUGGEST_QUERY_LENGTH) {
        suggestionGroups = [];
        return;
    }
    suggestionGroups = suggestionsFor(query);
    loadPeopleSuggestions().then(changed => {
        if (changed && !suggestionsDismissed && input && normalizeQuery(input.value) === query) updateSuggestions();
    });
}

// אחרי ההשהיה: ההצעות החדשות נכנסות לתפריט הפתוח (התא הפעיל נשאר על אותה
// שורה, אם היא עוד שם), או פותחות אותו. מספר השורות מוכרז רק כשהשתנה.
function updateSuggestions() {
    computeSuggestions();
    if (!input || document.activeElement !== input) return;
    if (!isOpen) {
        openPopup({ refreshSuggestions: false });
        return;
    }
    refreshKeepingPosition(currentPosition());
    if (!isOpen) return;
    const message = countMessage();
    if (message === lastCountMessage) return;
    lastCountMessage = message;
    announce(message);
}

function scheduleSuggestions() {
    window.clearTimeout(suggestTimer);
    suggestTimer = 0;
    // טקסט קצר מדי, או שדה שהתרוקן: ההצעות יורדות מיד, בלי השהיה.
    if (normalizeQuery(input?.value || '').length < MIN_SUGGEST_QUERY_LENGTH) {
        suggestionGroups = [];
        return;
    }
    suggestTimer = window.setTimeout(() => {
        suggestTimer = 0;
        updateSuggestions();
    }, SUGGEST_DEBOUNCE_MS);
}

// בחירה בהצעה: הסינון המתאים במקום הטקסט שהוקלד (search-suggest-ui.js). שם של
// מעלה הוא חיפוש טקסט, ולכן נרשם כמו חיפוש מהתפריט — ומחליף את שלב ההקלדה
// שלו ("רבקה" ← "רבקה לוי"); תיקייה, תגית ואדם אינם טקסט ואינם נרשמים.
async function chooseSuggestion(suggestion) {
    closePopup();
    cancelSuggestions();
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    authorUid = currentUserId();
    const step = typingStepId;
    typingStepId = '';
    let message = '';
    try {
        message = await applySuggestion(suggestion);
    } catch (error) {
        console.warn('Applying search suggestion failed:', error);
    }
    lastCommittedId = searchId(currentSnapshot());
    if (suggestion.kind === 'uploader') currentStore().addRecent(currentSnapshot(), { typingStepId: step });
    if (message) announce(message);
}

// --- רישום חיפושים ---

function currentSnapshot() {
    const snapshot = typeof window.getGallerySearchSnapshot === 'function' ? window.getGallerySearchSnapshot() : null;
    if (snapshot) return snapshot;
    return { query: input?.value || '', filters: {} };
}

// source: 'typing' — הטיימר אחרי הקלדה; 'filter' — הטיימר אחרי שינוי סינון;
// 'blur' — יציאה מהשדה; 'enter' — רישום מפורש.
function commitCurrentSearch(source) {
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    const explicit = source === 'enter';
    const uid = currentUserId();
    if (explicit) authorUid = uid;
    // הטקסט נכתב בידי משתמש אחר, שהתנתק או הוחלף מאז באותה לשונית.
    if (uid !== authorUid) return null;
    const snapshot = currentSnapshot();
    const query = normalizeQuery(snapshot.query);
    if (!query || (!explicit && query.length < MIN_AUTO_QUERY_LENGTH)) return null;
    const id = searchId(snapshot);
    if (!explicit && id === lastCommittedId) return null;
    lastCommittedId = id;
    // רק המשך של אותה הקלדה מחליף את שלב ההקלדה; שינוי סינון הוא חיפוש חדש.
    const entry = currentStore().addRecent(snapshot, { typingStepId: source === 'filter' ? '' : typingStepId });
    typingStepId = source === 'typing' && entry ? entry.id : '';
    return entry;
}

function scheduleIdleCommit(source) {
    window.clearTimeout(idleTimer);
    if (!normalizeQuery(input?.value || '')) {
        idleTimer = 0;
        return;
    }
    idleTimer = window.setTimeout(() => commitCurrentSearch(source), IDLE_COMMIT_MS);
}

// נקרא מ-session-auth.js בכל שינוי בהתחברות. כניסה של מי שלא היה מחובר אינה
// מאפסת דבר; התנתקות או החלפת חשבון מבטלות רישום ממתין ומאפסות את הטקסט
// והסינון (gallery.js), כדי שהבא אחריו יתחיל ריק.
function handleUserChange() {
    const uid = currentUserId();
    if (uid === knownUid) return;
    const previous = knownUid;
    knownUid = uid;
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    lastCommittedId = '';
    typingStepId = '';
    closePopup();
    // השמות של משתמש אחד (אנשים שהוא רשאי לראות) אינם מוצעים לבא אחריו.
    cancelSuggestions();
    resetSuggestionSources();
    if (previous) {
        authorUid = uid;
        window.clearGallerySearch?.();
    }
}

// --- סנכרון השמורים לענן (userPreferences) ---

function syncUserId() {
    const uid = currentUserId();
    if (!uid || !window.db || typeof window.firestoreModules?.setDoc !== 'function' || typeof window.firestoreModules?.doc !== 'function') return '';
    return uid;
}

function schedulePush() {
    const uid = syncUserId();
    if (!uid) return;
    // לפני שהענן נקרא לפחות פעם אחת אין דוחפים: האיחוד בקריאה הראשונה הוא
    // שמבטיח ששמורים ממכשיר אחר לא יידרסו.
    if (!storeFor(uid).hasSynced()) {
        pendingPushUid = uid;
        return;
    }
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
        pushSavedSearches(uid).catch(error => console.warn('Saved searches sync failed:', error));
    }, PUSH_DELAY_MS);
}

async function pushSavedSearches(uid) {
    if (syncUserId() !== uid) return;
    const store = storeFor(uid);
    const { doc, setDoc } = window.firestoreModules;
    await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'userPreferences', uid), {
        ...store.exportSaved(),
        updatedAt: Date.now()
    }, { merge: true });
    store.markSynced();
}

// נקרא מהמאזין של userPreferences (session-auth.js) בכל קריאה של המסמך.
function syncFromPreferences(data) {
    const uid = syncUserId();
    if (!uid) return;
    const store = storeFor(uid);
    const { changed, push } = store.mergeRemoteSaved(data);
    if (changed && currentUserId() === uid) {
        if (isOpen) refreshKeepingPosition(currentPosition());
        // הרשימה הגיעה מהענן בזמן שהשדה בפוקוס והתפריט ריק — נפתח עכשיו.
        else if (input && document.activeElement === input) openPopup();
    }
    if (push || pendingPushUid === uid) {
        pendingPushUid = '';
        schedulePush();
    }
}

// --- פעולות ---

async function applyEntry(entry) {
    closePopup();
    cancelSuggestions();
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    authorUid = currentUserId();
    typingStepId = '';
    let result = null;
    try {
        result = typeof window.applyGallerySearch === 'function'
            ? await window.applyGallerySearch(entry)
            : null;
    } catch (error) {
        console.warn('Applying saved search failed:', error);
    }
    if (typeof window.applyGallerySearch !== 'function' && input) {
        input.value = entry.query;
        window.handleSearch?.(entry.query);
    }
    lastCommittedId = searchId(currentSnapshot());
    currentStore().addRecent(currentSnapshot());
    announce(result?.folderMissing
        ? `החיפוש „${entry.query}” הופעל בכל התמונות — התיקייה שנשמרה איתו אינה קיימת עוד.`
        : `החיפוש „${entry.query}” הופעל.`);
}

// forcedAction: Delete מסיר את השורה גם כשהתא הפעיל אינו תא ההסרה.
function performAction(rowIndex, colIndex, forcedAction = '') {
    const row = rows[rowIndex];
    if (!row) return;
    const action = forcedAction || row.cells[colIndex]?.action;
    const store = currentStore();
    const previous = { row: rowIndex, col: colIndex, entryId: rowKey(row) };

    if (action === 'suggest' && row.suggestion) {
        chooseSuggestion(row.suggestion);
        return;
    }
    if (action === 'apply' && row.entry) {
        applyEntry(row.entry);
        return;
    }
    if (action === 'star' && row.entry) {
        const result = store.toggleSaved(row.entry);
        if (!result.ok) {
            announce(result.reason === 'limit'
                ? `אפשר לשמור עד ${SAVED_SEARCH_LIMIT} חיפושים. הסירו חיפוש שמור כדי להוסיף חדש.`
                : 'אי אפשר לשמור את החיפוש הזה.');
            return;
        }
        announce(result.saved ? `החיפוש „${row.entry.query}” נשמר בכוכב.` : `הכוכב הוסר מהחיפוש „${row.entry.query}”.`);
        refreshKeepingPosition(previous);
        schedulePush();
        return;
    }
    if (action === 'remove' && row.entry) {
        if (row.kind === 'saved') {
            store.removeSearch(row.entry.id);
            schedulePush();
            announce(`החיפוש השמור „${row.entry.query}” נמחק.`);
        } else {
            store.removeRecent(row.entry.id);
            announce(`„${row.entry.query}” הוסר מהחיפושים האחרונים.`);
        }
        refreshKeepingPosition({ ...previous, entryId: '' });
        return;
    }
    if (action === 'clear') {
        store.clearRecent();
        lastCommittedId = '';
        typingStepId = '';
        announce('החיפושים האחרונים נוקו.');
        refreshKeepingPosition(null);
    }
}

// --- מקלדת ועכבר ---

function isRtl() {
    return getComputedStyle(input).direction === 'rtl';
}

function moveRow(step) {
    if (!rows.length) return;
    if (!active) {
        setActive(step > 0 ? 0 : rows.length - 1, 0);
        return;
    }
    const next = (active.row + step + rows.length) % rows.length;
    setActive(next, active.col);
}

function handleKeyDown(event) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            if (!isOpen) {
                if (openPopup()) moveRow(step);
                return;
            }
            // הצעות שעוד ממתינות להשהיה מחושבות עכשיו, כדי שחץ ו-Enter מהירים
            // אחרי הקשה לא יפעילו הצעה של הטקסט הקודם.
            if (suggestTimer) updateSuggestions();
            if (isOpen) moveRow(step);
            return;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
            if (!isOpen || !active) return;
            event.preventDefault();
            // מימין לשמאל, התא הבא יושב משמאל.
            const forward = (event.key === 'ArrowLeft') === isRtl();
            setActive(active.row, active.col + (forward ? 1 : -1));
            return;
        }
        case 'Enter':
            if (isOpen && active) {
                event.preventDefault();
                performAction(active.row, active.col);
                return;
            }
            commitCurrentSearch('enter');
            stopPendingSuggestions();
            closePopup();
            return;
        case 'Delete':
            if (isOpen && active && rows[active.row]?.entry) {
                event.preventDefault();
                performAction(active.row, active.col, 'remove');
            }
            return;
        case 'Escape':
            stopPendingSuggestions();
            if (isOpen) {
                event.preventDefault();
                event.stopPropagation();
                closePopup();
            }
            return;
        case 'Tab':
            stopPendingSuggestions();
            closePopup();
            return;
        case 'Home':
        case 'End':
            setActive(null);
            return;
        default:
    }
}

function handleInput() {
    authorUid = currentUserId();
    scheduleIdleCommit('typing');
    suggestionsDismissed = false;
    scheduleSuggestions();
    if (document.activeElement !== input) return;
    if (isOpen) {
        if (!render()) closePopup();
        else setActive(null);
        return;
    }
    // תוך כדי הקלדה התפריט נפתח מיד כשיש חיפוש קודם שמתאים לטקסט; הצעות
    // פותחות אותו אחרי ההשהיה (updateSuggestions).
    if (normalizeQuery(input.value)) openPopup({ announceCount: true, refreshSuggestions: false });
}

function rowIndexOf(node) {
    const rowElement = node?.closest?.('[role="row"]');
    return rows.findIndex(row => row.element === rowElement);
}

function handlePopupClick(event) {
    const button = event.target?.closest?.('[data-action]');
    if (!button || !popup.contains(button)) return;
    const rowIndex = rowIndexOf(button);
    if (rowIndex < 0) return;
    const colIndex = rows[rowIndex].cells.findIndex(cell => cell.element.contains(button));
    setActive(rowIndex, Math.max(0, colIndex));
    performAction(rowIndex, Math.max(0, colIndex));
    // הפוקוס נשאר בשדה, כמו בכל combobox.
    if (document.activeElement !== input) input.focus({ preventScroll: true });
}

function handleFocusOut() {
    window.setTimeout(() => {
        if (box && box.contains(document.activeElement)) return;
        stopPendingSuggestions();
        closePopup();
        commitCurrentSearch('blur');
    }, 0);
}

// --- התקנה ---

export function initSearchHistory() {
    if (box) return;
    if (window.PAGE_MODE && window.PAGE_MODE !== 'gallery') return;
    box = document.getElementById('gallerySearchBox');
    input = document.getElementById('searchInput');
    popup = document.getElementById('searchHistoryPopup');
    statusRegion = document.getElementById('searchHistoryStatus');
    if (!box || !input || !popup) {
        box = null;
        return;
    }
    knownUid = currentUserId();
    authorUid = knownUid;

    input.addEventListener('focus', () => openPopup());
    input.addEventListener('click', () => { if (!isOpen) openPopup(); });
    input.addEventListener('keydown', handleKeyDown);
    input.addEventListener('input', handleInput);
    box.addEventListener('focusout', handleFocusOut);
    // לחיצה בתפריט אינה מוציאה את הפוקוס מהשדה.
    popup.addEventListener('mousedown', event => event.preventDefault());
    popup.addEventListener('click', handlePopupClick);
    // לשונית אחרת שינתה את הרשימה.
    window.addEventListener('storage', event => {
        if (isOpen && event.key === currentStore().key) refreshKeepingPosition(null);
    });

    window.syncSavedSearchesFromPreferences = syncFromPreferences;
    window.noteGalleryUserChange = handleUserChange;
    // שינוי סינון (תיקייה, שנה, חודש, סוג הרגע, סוג המדיה) כשיש טקסט בשדה מחדש את הרישום.
    window.noteGallerySearchChange = () => scheduleIdleCommit('filter');
}
