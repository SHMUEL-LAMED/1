// manual-order.js — "סדר ידני" של תמונות בתיקייה ושל תיקיות: ההיגיון הטהור,
// בלי DOM (נבדק ב-Node).
//
// כל רשומה יכולה לשאת `order` — דירוג מספרי דליל (1024, 2048, …). רשומות עם
// דירוג באות קודם, מהקטן לגדול; רשומות בלי דירוג באות אחריהן בסדר שבלעדיו
// (לתמונות: תאריך הצילום מהישן לחדש). הזזה של פריט אחד משנה בדרך כלל רק את
// הדירוג שלו (ממוצע בין השכנים), וכך נכתבות לשרת רק הרשומות שהשתנו.

export const ORDER_STEP = 1024;
// מתחת לרווח הזה בין שני שכנים אין מקום לממוצע, והדירוג כולו מחושב מחדש.
const MIN_GAP = 1e-6;
// חייב להתאים ל-ORDER_RANK_LIMIT וה-ORDER_BATCH_MAX שב-Worker.
export const ORDER_RANK_LIMIT = 1e15;
export const ORDER_BATCH_MAX = 500;

export function rankOf(item) {
    const value = item?.order;
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= ORDER_RANK_LIMIT ? value : null;
}

export function hasRank(item) {
    return rankOf(item) !== null;
}

// השוואה: מדורגים קודם לפי הדירוג, ואחריהם הלא מדורגים לפי fallback.
export function compareByManualRank(a, b, fallback = () => 0) {
    const first = rankOf(a);
    const second = rankOf(b);
    if (first !== null && second !== null) {
        if (first !== second) return first - second;
        return fallback(a, b);
    }
    if (first !== null) return -1;
    if (second !== null) return 1;
    return fallback(a, b);
}

export function sortByManualRank(items, fallback) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => compareByManualRank(a, b, fallback));
}

// מעבר פריט ממקום למקום ברשימה (עותק חדש).
export function moveItem(list, fromIndex, toIndex) {
    const result = [...list];
    if (fromIndex < 0 || fromIndex >= result.length) return result;
    const [item] = result.splice(fromIndex, 1);
    const target = Math.max(0, Math.min(result.length, toIndex));
    result.splice(target, 0, item);
    return result;
}

// הדירוגים החדשים לרשימה שהמנהל סידר (ordered, בסדר הרצוי). מחזיר רק את מה
// שמשתנה: [{ id, order }], כאשר order=null מוחק דירוג.
//   1. הזנב: פריטים בלי דירוג בסוף הרשימה, שכבר עומדים בסדר שבלעדיו (fallback),
//      נשארים בלי דירוג — הם ממילא יוצגו שם.
//   2. כל מה שלפניהם חייב דירוג עולה. דירוגים קיימים שכבר עולים (התת־סדרה
//      העולה הארוכה ביותר) נשארים; האחרים מקבלים ערך בין השכנים.
//   3. אין מקום בין השכנים — הקטע כולו מקבל מחדש 1024, 2048, …
export function rankChanges(ordered, { idOf = item => item?.id, fallback = () => 0 } = {}) {
    const list = Array.isArray(ordered) ? ordered : [];
    let tailStart = list.length;
    while (tailStart > 0) {
        const item = list[tailStart - 1];
        if (hasRank(item)) break;
        if (tailStart < list.length && fallback(item, list[tailStart]) > 0) break;
        tailStart -= 1;
    }
    const prefix = list.slice(0, tailStart);
    const existing = prefix.map(rankOf);

    // התת־סדרה העולה (ממש) הארוכה ביותר של הדירוגים הקיימים — נשמרת כמו שהיא.
    const tails = [];
    const tailIndex = [];
    const previous = new Array(prefix.length).fill(-1);
    existing.forEach((rank, index) => {
        if (rank === null) return;
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (tails[middle] < rank) low = middle + 1;
            else high = middle;
        }
        tails[low] = rank;
        tailIndex[low] = index;
        previous[index] = low > 0 ? tailIndex[low - 1] : -1;
    });
    const keep = new Set();
    for (let index = tailIndex[tails.length - 1] ?? -1; index >= 0; index = previous[index]) keep.add(index);

    const next = new Array(prefix.length).fill(null);
    for (const index of keep) next[index] = existing[index];
    let fits = true;
    let start = 0;
    while (start < prefix.length) {
        if (keep.has(start)) { start += 1; continue; }
        let end = start;
        while (end < prefix.length && !keep.has(end)) end += 1;
        const low = start > 0 ? next[start - 1] : null;
        const high = end < prefix.length ? next[end] : null;
        const count = end - start;
        for (let offset = 0; offset < count; offset += 1) {
            let value;
            if (low === null && high === null) value = (offset + 1) * ORDER_STEP;
            else if (low === null) value = high - (count - offset) * ORDER_STEP;
            else if (high === null) value = low + (offset + 1) * ORDER_STEP;
            else value = low + ((high - low) * (offset + 1)) / (count + 1);
            next[start + offset] = value;
        }
        if (low !== null && high !== null && (high - low) / (count + 1) < MIN_GAP) fits = false;
        start = end;
    }
    if (!fits || next.some(value => !Number.isFinite(value) || Math.abs(value) > ORDER_RANK_LIMIT)) {
        prefix.forEach((_, index) => { next[index] = (index + 1) * ORDER_STEP; });
    }

    const changes = [];
    prefix.forEach((item, index) => {
        if (rankOf(item) !== next[index]) changes.push({ id: idOf(item), order: next[index] });
    });
    // פריט בזנב שהיה לו דירוג אינו אפשרי (הזנב מכיל רק לא מדורגים), ולכן אין
    // צורך למחוק דירוגים — אלא באיפוס מפורש (clearRanks).
    return changes;
}

// "איפוס הסדר": כל הדירוגים נמחקים, והפריטים חוזרים לסדר שבלעדיו.
export function clearRanks(items, idOf = item => item?.id) {
    return (Array.isArray(items) ? items : []).filter(hasRank).map(item => ({ id: idOf(item), order: null }));
}

// חלוקה לבקשות של עד ORDER_BATCH_MAX פריטים (כל אחת נכתבת בשרת כטרנזקציה).
export function chunkOrderChanges(changes, size = ORDER_BATCH_MAX) {
    const chunks = [];
    for (let index = 0; index < changes.length; index += size) chunks.push(changes.slice(index, index + size));
    return chunks;
}
