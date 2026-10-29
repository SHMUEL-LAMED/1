// gallery-random.js — הסדר האקראי של הגלריה ו"תמונה אקראית": ההיגיון הטהור, בלי DOM.
//
// "אקראי" במיון הגלריה אינו ערבוב חדש בכל ציור: הגלריה מציירת מחדש בכל
// עדכון (לב שנלחץ, עמוד נוסף מהענן, חזרה ללשונית), וערבוב בכל פעם היה מקפיץ
// את הכרטיסים מתחת לאצבע. במקום זה כל פריט מקבל דירוג קבוע לאורך הביקור,
// לפי זרע (seed) אחד:
//   - פריטים שכבר דורגו שומרים על מקומם היחסי, גם אחרי סינון וביטולו.
//   - פריטים חדשים (העמוד הבא בגלילה, העלאה חדשה) מעורבבים ביניהם ונוספים
//     אחרי כל מה שכבר דורג — כך עמוד נוסף אינו מערבב את מה שכבר מוצג.
//   - הדירוג נשמר לכל היקף (תיקייה) בנפרד, כדי שמעבר ל"כל הארכיון" לא יציג
//     קודם את כל התיקייה שנפתחה לפניו.
// "ערבב מחדש" מחליף את הזרע ומוחק את הדירוגים.
//
// אותו זרע ואותה קבוצת פריטים נותנים תמיד אותו סדר, בלי תלות בסדר שבו
// הגיעו מהענן — הפריטים החדשים ממוינים לפי המזהה לפני הערבוב.

// mulberry32: מחולל קטן וטוב מספיק לערבוב תצוגה (לא לקריפטוגרפיה).
export function seededRandom(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

export function createRandomSeed(random = Math.random) {
    return Math.floor(random() * 4294967296) >>> 0;
}

// זרע נגזר לכל היקף ולכל מנה, כדי שמנות שונות לא יקבלו אותו ערבוב בדיוק.
function deriveSeed(seed, text) {
    let hash = (seed ^ 0x811c9dc5) >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

// ערבוב Fisher–Yates לפי זרע. מחזיר מערך חדש; המקור אינו משתנה.
export function seededShuffle(items, seed) {
    const result = Array.isArray(items) ? [...items] : [];
    const random = seededRandom(seed);
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

const defaultKey = item => String(item?.id ?? '');

// המערבב היציב של הגלריה. order(items, scope) מחזיר עותק ממוין לפי הדירוג;
// פריט בלי מפתח נשאר בסוף, בסדר שבו הגיע. seed חושף את הזרע הנוכחי, כדי
// שהגלריה תזהה ערבוב מחדש כתצוגה חדשה.
export function createStableShuffle({ seed = createRandomSeed(), keyOf = defaultKey } = {}) {
    let currentSeed = seed >>> 0;
    // היקף → { ranks: Map<מפתח, דירוג>, next, batches }
    const scopes = new Map();

    function scopeEntry(scope) {
        const name = String(scope ?? '');
        let entry = scopes.get(name);
        if (!entry) {
            entry = { name, ranks: new Map(), next: 0, batches: 0 };
            scopes.set(name, entry);
        }
        return entry;
    }

    // מדרג פריטים שטרם דורגו, בלי למיין. הגלריה מעבירה כאן את כל התיקייה לפני
    // הסינון, כדי שפריט שהיה מסונן לא יידחף לסוף כשהסינון מתבטל.
    function include(items, scope = '') {
        const entry = scopeEntry(scope);
        const unseen = new Set();
        for (const item of Array.isArray(items) ? items : []) {
            const key = String(keyOf(item) ?? '');
            if (key && !entry.ranks.has(key)) unseen.add(key);
        }
        if (!unseen.size) return entry;
        const batchSeed = deriveSeed(currentSeed, `${entry.name}\u0000${entry.batches}`);
        entry.batches += 1;
        for (const key of seededShuffle([...unseen].sort(), batchSeed)) {
            entry.ranks.set(key, entry.next);
            entry.next += 1;
        }
        return entry;
    }

    function order(items, scope = '') {
        const list = Array.isArray(items) ? items : [];
        const entry = include(list, scope);
        const rank = item => {
            const value = entry.ranks.get(String(keyOf(item) ?? ''));
            return value === undefined ? Infinity : value;
        };
        // Array.prototype.sort יציב, ולכן פריטים בלי מפתח שומרים על סדרם.
        return [...list].sort((first, second) => {
            const a = rank(first);
            const b = rank(second);
            return a === b ? 0 : (a < b ? -1 : 1);
        });
    }

    function reshuffle(nextSeed = createRandomSeed()) {
        currentSeed = nextSeed >>> 0;
        scopes.clear();
        return currentSeed;
    }

    return {
        include,
        order,
        reshuffle,
        get seed() { return currentSeed; }
    };
}

// "תמונה אקראית": פריט אחד מתוך הרשימה, ולא הפריט שהוגרל בפעם הקודמת
// (excludeKey) — אלא אם הוא היחיד שברשימה. null כשאין פריטים.
export function pickRandomItem(items, { excludeKey = '', keyOf = defaultKey, random = Math.random } = {}) {
    const list = (Array.isArray(items) ? items : []).filter(item => String(keyOf(item) ?? ''));
    if (!list.length) return null;
    const excluded = String(excludeKey ?? '');
    const others = excluded ? list.filter(item => String(keyOf(item)) !== excluded) : list;
    const pool = others.length ? others : list;
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(Number(random()) * pool.length) || 0));
    return pool[index];
}
