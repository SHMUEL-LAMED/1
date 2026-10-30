// search-suggest.js — הצעות להשלמה בזמן ההקלדה בשדה החיפוש של הגלריה: תיקיות
// ואירועים, סוג הרגע (תגיות הסצנה), אנשים ומעלים. מודול טהור, בלי DOM, ונבדק
// ב-Node (search-suggest.test.mjs). התפריט עצמו — אותו combobox של החיפושים
// האחרונים והשמורים — ב-search-history-ui.js, ואיסוף המקורות מהגלריה
// ב-search-suggest-ui.js.
//
// ההתאמה סלחנית לאופן הכתיבה בעברית: ניקוד וטעמים, גרש וגרשיים (גם ' ו-"
// ו-’ של מקלדת לועזית), אותיות סופיות, מקף עברי ופיסוק אינם משנים דבר. כתיב
// מלא וחסר ("ריקוד" / "רִקּוּד") נתפסים בשלב אחרון, בדירוג נמוך יותר: ההשוואה
// שם היא על "שלד" המילה, בלי ו' ו-י' שאינן בראשה.
//
// הכול מקופל פעם אחת בבניית המפתח (buildSuggestionIndex), כך שכל הקשה עולה
// רק השוואת מחרוזות קצרות — גם בגלריה של אלפי פריטים, שבה יש לכל היותר כמה
// עשרות תיקיות, תגיות, אנשים ומעלים.
import { normalizeNameForSearch } from './people-model.js';
import { SCENE_TAGS, sceneTagCounts } from './scene-tags.js';

// הקשה אחת מחכה רגע לבאה אחריה לפני שההצעות מחושבות מחדש. הסינון של הגלריה
// עצמה (handleSearch) אינו מחכה.
export const SUGGEST_DEBOUNCE_MS = 150;
// אות אחת מתאימה כמעט לכל דבר; ההצעות מתחילות משתי אותיות, כמו רישום החיפוש.
export const MIN_SUGGEST_QUERY_LENGTH = 2;
// כינוי (למשל "שולחנות ערוכים" של "סעודה") מתאים רק מתחילת מילה ומשלוש אותיות,
// כדי ש"או" או "בד" לא ימשכו תגיות דרך מילות הקישור שבהסבר.
const MIN_ALIAS_QUERY_LENGTH = 3;

// סדר הקבוצות בתפריט, הכותרת העברית של כל אחת ומספר ההצעות המרבי בה.
export const SUGGESTION_GROUPS = Object.freeze([
    Object.freeze({ kind: 'folder', label: 'תיקיות ואירועים', limit: 4 }),
    Object.freeze({ kind: 'tag', label: 'סוג הרגע', limit: 3 }),
    Object.freeze({ kind: 'person', label: 'אנשים', limit: 4 }),
    Object.freeze({ kind: 'uploader', label: 'הועלו על ידי', limit: 3 })
]);
export const SUGGESTION_KINDS = Object.freeze(SUGGESTION_GROUPS.map(group => group.kind));
export const MAX_SUGGESTIONS = 10;

// דרגות ההתאמה, מהטובה לחלשה. "contains" היא מילה שמתחילה באות שימוש (ו, ה,
// ב, ל, מ, ש, כ) ואחריה הטקסט. הקבוצות מוצגות בסדר קבוע, וההצעות בתוך קבוצה
// לפי הדרגה, אחר כך לפי מספר הפריטים, ואחר כך לפי הא"ב.
export const MATCH_RANK = Object.freeze({
    exact: 0,
    prefix: 1,
    words: 2,
    contains: 3,
    alias: 4,
    skeleton: 5
});

const PUNCTUATION_PATTERN = /[־\-–—_.,:;!?()[\]{}/\\|+*&#@~<>=]+/g;
const LATIN_QUOTES_PATTERN = /[’‘‛“”„]/g;

// הצורה שכל השוואה נעשית עליה. normalizeNameForSearch (people-model.js) מוריד
// ניקוד, גרשיים ואותיות סופיות; כאן נוספים המקף והפיסוק, המירכאות הלועזיות
// ו-וו/יי כפולות של כתיב מלא ("דוויד" = "דויד").
export function foldHebrew(text) {
    const spaced = String(text ?? '').replace(LATIN_QUOTES_PATTERN, '').replace(PUNCTUATION_PATTERN, ' ');
    return normalizeNameForSearch(spaced).replace(/ו{2,}/g, 'ו').replace(/י{2,}/g, 'י');
}

// שלד המילה: בלי ו' ו-י' שאינן האות הראשונה, כך שכתיב מלא וכתיב חסר נפגשים.
export function hebrewSkeleton(folded) {
    return String(folded ?? '').split(' ').map(word => word.charAt(0) + word.slice(1).replace(/[וי]/g, '')).join(' ');
}

function words(folded) {
    return folded ? folded.split(' ') : [];
}

// כל מילה של החיפוש היא תחילתה של מילה אחרת במועמד (בכל סדר).
function everyTokenStartsWord(tokens, candidateWords) {
    return tokens.length > 0 && tokens.every(token => candidateWords.some(word => word.startsWith(token)));
}

// אותיות השימוש שנצמדות לראש מילה בעברית ("ובבית", "שבחצר", "מהקפות").
const PREFIX_LETTERS_PATTERN = /^[ובהכלמש]{1,2}$/;

// כמו everyTokenStartsWord, אבל המילה במועמד רשאית לפתוח באות שימוש אחת או
// שתיים לפני הטקסט ("צרנוביל" ב"בצ׳רנוביל"). הכלה באמצע מילה אינה נחשבת:
// "לוי" אינו מתאים ל"פעילויות".
function everyTokenStartsWordAfterPrefix(tokens, candidateWords) {
    return tokens.length > 0 && tokens.every(token => candidateWords.some(word => {
        const at = word.indexOf(token, 1);
        return at > 0 && PREFIX_LETTERS_PATTERN.test(word.slice(0, at));
    }));
}

function prepareTerm(text) {
    const folded = foldHebrew(text);
    return { folded, words: words(folded), skeleton: hebrewSkeleton(folded) };
}

// דרגת ההתאמה של מונח אחד לחיפוש שכבר קופל, או -1.
function rankTerm(term, query) {
    if (!term.folded) return -1;
    if (term.folded === query.folded) return MATCH_RANK.exact;
    if (term.folded.startsWith(query.folded)) return MATCH_RANK.prefix;
    if (everyTokenStartsWord(query.words, term.words)) return MATCH_RANK.words;
    if (everyTokenStartsWordAfterPrefix(query.words, term.words)) return MATCH_RANK.contains;
    return -1;
}

// דרגת ההתאמה של מועמד: השם, ואחריו הכינויים, ולבסוף השלד.
export function matchRank(candidate, query) {
    const direct = rankTerm(candidate.term, query);
    if (direct >= 0) return direct;
    if (query.folded.length >= MIN_ALIAS_QUERY_LENGTH
        && candidate.aliases.some(alias => everyTokenStartsWord(query.words, alias.words))) return MATCH_RANK.alias;
    if (query.skeleton.replace(/ /g, '').length >= MIN_SUGGEST_QUERY_LENGTH) {
        const skeletonWords = words(candidate.term.skeleton);
        if (everyTokenStartsWord(words(query.skeleton), skeletonWords)) {
            return MATCH_RANK.skeleton;
        }
    }
    return -1;
}

export function prepareQuery(text) {
    return prepareTerm(text);
}

// "פריט אחד" / "12 פריטים"; בלי מונה ידוע — ריק.
export function itemCountLabel(count) {
    const value = Math.max(0, Math.trunc(Number(count) || 0));
    if (!value) return '';
    return value === 1 ? 'פריט אחד' : `${value} פריטים`;
}

function toCount(value) {
    return Math.max(0, Math.trunc(Number(value) || 0));
}

// --- המקורות: מהרשומות שכבר בזיכרון לרשימת מועמדים ---

// תיקיות: { id, name } מ-state.folders, והמונה מהשרת (folderCounts) או ממה
// שנטען. "כל הארכיון" אינו הצעה, ותיקייה בלי שם אינה מוצגת.
export function folderCandidates(folders, { counts = null, items = [] } = {}) {
    const loaded = new Map();
    for (const item of items || []) {
        const id = String(item?.folderId ?? '');
        if (id) loaded.set(id, (loaded.get(id) || 0) + 1);
    }
    const seen = new Set();
    const result = [];
    for (const folder of folders || []) {
        const id = String(folder?.id ?? '');
        const label = String(folder?.name ?? '').trim();
        if (!id || id === 'all' || !label || seen.has(id)) continue;
        seen.add(id);
        const count = counts && typeof counts === 'object' ? toCount(counts[id]) : (loaded.get(id) || 0);
        result.push({ kind: 'folder', id, label, count });
    }
    return result;
}

// סוג הרגע: רק תגיות שיש להן פריטים במה שנטען, כמו שבבי הסינון. ההסבר של
// התגית ("שולחנות ערוכים, אוכל או כיבוד") משמש ככינוי.
export function tagCandidates(items) {
    const hints = new Map(SCENE_TAGS.map(tag => [tag.id, tag.hint]));
    return sceneTagCounts(items).map(tag => ({ kind: 'tag', id: tag.id, label: tag.label, count: tag.count, aliases: [hints.get(tag.id) || ''] }));
}

// אנשים: רק מה שהשרת החזיר לצופה (אנשים מאושרים, עם שם ובלי הסתרה; ראו
// listPeopleForSearch ב-people.js). השם הוא כל מה שנדרש — בלי פנים ובלי תמונות.
export function personCandidates(people) {
    const seen = new Set();
    const result = [];
    for (const person of people || []) {
        const id = String(person?.personId ?? '');
        const label = String(person?.name ?? '').trim();
        if (!id || !label || seen.has(id)) continue;
        seen.add(id);
        result.push({ kind: 'person', id, label, count: toCount(person.imageCount) });
    }
    return result;
}

// מעלים: השמות שברשומות שנטענו (uploadedByName), עם מספר הפריטים של כל אחד.
// שתי כתיבות של אותו שם (בניקוד, ברווח כפול) הן מעלה אחד; מוצגת הכתיבה הנפוצה.
export function uploaderCandidates(items) {
    const byKey = new Map();
    for (const item of items || []) {
        const name = String(item?.uploadedByName ?? '').replace(/\s+/g, ' ').trim();
        const key = foldHebrew(name);
        if (!key) continue;
        let entry = byKey.get(key);
        if (!entry) {
            entry = { count: 0, spellings: new Map() };
            byKey.set(key, entry);
        }
        entry.count += 1;
        entry.spellings.set(name, (entry.spellings.get(name) || 0) + 1);
    }
    return [...byKey.entries()].map(([key, entry]) => {
        const [label] = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0];
        return { kind: 'uploader', id: key, label, count: entry.count };
    });
}

// --- המפתח והדירוג ---

// כל מועמד מקופל פעם אחת. הקלט: מועמדים מכל הסוגים ({ kind, id, label, count,
// aliases? }); מה שאינו מסוג מוכר נזרק.
export function buildSuggestionIndex(candidates) {
    const index = [];
    for (const candidate of candidates || []) {
        if (!SUGGESTION_KINDS.includes(candidate?.kind)) continue;
        const term = prepareTerm(candidate.label);
        if (!term.folded) continue;
        index.push({
            kind: candidate.kind,
            id: String(candidate.id),
            label: String(candidate.label),
            count: toCount(candidate.count),
            key: `${candidate.kind}:${candidate.id}`,
            term,
            aliases: (candidate.aliases || []).map(prepareTerm).filter(alias => alias.folded)
        });
    }
    return index;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('he', { sensitivity: 'base', numeric: true }) : null;

function compareLabels(left, right) {
    return collator ? collator.compare(left, right) : left.localeCompare(right);
}

// ההצעות לטקסט שבשדה, בקבוצות ובסדר התצוגה: [{ kind, label, items: [{ kind,
// id, label, count, key, rank }] }]. קבוצה ריקה אינה מוחזרת. בלי טקסט, או
// בטקסט קצר מדי, אין הצעות — אז התפריט מציג את החיפושים האחרונים והשמורים.
export function rankSuggestions(index, text, { limit = MAX_SUGGESTIONS } = {}) {
    const query = prepareQuery(text);
    if (query.folded.replace(/ /g, '').length < MIN_SUGGEST_QUERY_LENGTH) return [];
    const matches = new Map(SUGGESTION_KINDS.map(kind => [kind, []]));
    for (const candidate of index || []) {
        const rank = matchRank(candidate, query);
        if (rank >= 0) matches.get(candidate.kind).push({ candidate, rank });
    }
    const groups = [];
    let remaining = Math.max(0, Math.trunc(Number(limit) || 0));
    for (const group of SUGGESTION_GROUPS) {
        if (!remaining) break;
        const found = matches.get(group.kind)
            .sort((a, b) => a.rank - b.rank || b.candidate.count - a.candidate.count || compareLabels(a.candidate.label, b.candidate.label))
            .slice(0, Math.min(group.limit, remaining))
            .map(({ candidate, rank }) => ({
                kind: candidate.kind,
                id: candidate.id,
                label: candidate.label,
                count: candidate.count,
                key: candidate.key,
                rank
            }));
        if (!found.length) continue;
        remaining -= found.length;
        groups.push({ kind: group.kind, label: group.label, items: found });
    }
    return groups;
}

export function countSuggestions(groups) {
    return (groups || []).reduce((total, group) => total + group.items.length, 0);
}

// ההודעה לקוראי מסך על ההצעות שבתפריט.
export function suggestionsMessage(count) {
    const value = toCount(count);
    if (!value) return '';
    return value === 1 ? 'הצעה אחת' : `${value} הצעות`;
}
