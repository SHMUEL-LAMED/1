// hero-mosaic.js — פסיפס הרגעים בפוסטר הכניסה: ההיגיון הטהור, בלי DOM.
//
// הפסיפס מציג חמש תמונות אקראיות מתוך כל מה שנטען בביקור, ומחליף מדי כמה
// שניות אריח אחד בתמונה אקראית אחרת. כדי שהפסיפס לא יקפוץ בכל רינדור של
// הגלריה (לב שנלחץ, עמוד נוסף מהענן), האריחים שכבר מוצגים נשמרים כל עוד
// הם עדיין במאגר; רק מקומות ריקים מתמלאים בתמונות חדשות.

export const HERO_MOSAIC_LIMIT = 5;
// הזמן בין החלפה להחלפה. ארוך מספיק כדי שאפשר יהיה להתבונן בתמונה.
export const HERO_SWAP_INTERVAL_MS = 5000;

const keyOf = item => String(item?.id ?? '');

// מאחד כמה רשימות לרשימה אחת בלי כפילויות לפי המזהה; פריט בלי מזהה נזרק.
export function mergeHeroPool(lists) {
    const seen = new Set();
    const pool = [];
    for (const list of lists || []) {
        for (const item of list || []) {
            const key = keyOf(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            pool.push(item);
        }
    }
    return pool;
}

// בוחר עד count פריטים אקראיים מהמאגר שאינם ב-exclude, בלי חזרות.
// usable(item) מסנן פריטים שאין להם תמונה להצגה.
export function pickRandomHeroItems(pool, count, { exclude = new Set(), usable = () => true, random = Math.random } = {}) {
    const candidates = (pool || []).filter(item => {
        const key = keyOf(item);
        return key && !exclude.has(key);
    });
    const picked = [];
    // Fisher–Yates חלקי: מספיק לערבב רק את המקומות שנבחרים.
    for (let index = 0; index < candidates.length && picked.length < count; index += 1) {
        const swap = index + Math.floor(random() * (candidates.length - index));
        [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
        if (usable(candidates[index])) picked.push(candidates[index]);
    }
    return picked;
}

// האריחים לרינדור: מי שכבר מוצג ועדיין במאגר נשאר במקומו, והחסרים
// מתמלאים באקראי. currentIds — המזהים המוצגים כעת, לפי הסדר.
export function fillHeroTiles(currentIds, pool, { limit = HERO_MOSAIC_LIMIT, usable = () => true, random = Math.random } = {}) {
    const byKey = new Map((pool || []).map(item => [keyOf(item), item]));
    const kept = [];
    const keptKeys = new Set();
    for (const id of currentIds || []) {
        const item = byKey.get(String(id));
        if (!item || keptKeys.has(String(id)) || kept.length >= limit || !usable(item)) continue;
        kept.push(item);
        keptKeys.add(String(id));
    }
    const extra = pickRandomHeroItems(pool, limit - kept.length, { exclude: keptKeys, usable, random });
    return [...kept, ...extra];
}

// ההחלפה הבאה: איזה אריח (slot) מתחלף ובאיזה פריט. האריח שהוחלף בפעם
// הקודמת אינו נבחר שוב מיד, כדי שההחלפות יתפזרו על פני כל הפסיפס.
// מחזיר null כשאין במאגר תמונה שאינה מוצגת כבר.
export function nextHeroSwap(currentIds, pool, { lastSlot = -1, usable = () => true, random = Math.random } = {}) {
    const ids = (currentIds || []).map(String);
    if (!ids.length) return null;
    const [item] = pickRandomHeroItems(pool, 1, { exclude: new Set(ids), usable, random });
    if (!item) return null;
    const slots = ids.map((_, index) => index).filter(index => ids.length < 2 || index !== lastSlot);
    const slot = slots[Math.floor(random() * slots.length)];
    return { slot, item };
}
