// access-request.js — בקשת הגישה לגלריה: בדיקת השם המלא שהמבקש כותב.
//
// מבקר שנכנס עם Google ועדיין אינו מאושר ממלא טופס קצר לפני שהבקשה מגיעה
// למנהל. שם Google הוא לעיתים כינוי, ראשי תיבות או "משתמש Google", והמנהל
// אינו יכול לאשר את מי שאינו מזהה. לכן השם המלא האמיתי הוא שדה חובה, והבקשה
// אינה נשלחת עד שהוא עובר את הבדיקה כאן.
//
// המודול טהור (בלי DOM) ומשמש את שני הצדדים: הטופס (session-ui.js) בודק
// בזמן ההקלדה, וה-Worker (worker/data.js) בודק שוב בשמירה — כך דפדפן ישן
// או בקשה ישירה ל-API אינם עוקפים את החובה.

export const REQUEST_NAME_MIN_LENGTH = 4;
export const REQUEST_NAME_MAX_LENGTH = 60;
export const REQUEST_NOTE_MAX_LENGTH = 200;

// אותיות עבריות ולטיניות, ובין המילים רווח, מקף או גרש.
const LETTER = /[א-תA-Za-zÀ-ɏ]/u;
const ALLOWED = /^[א-תA-Za-zÀ-ɏ\s\-'׳״"`.]+$/u;
const WORD_SPLIT = /[\s\-]+/u;

// מילים שאינן שם של אדם. ההשוואה היא למילה שלמה, באותיות קטנות.
const PLACEHOLDER_WORDS = new Set([
    'משתמש', 'משתמשת', 'גוגל', 'בדיקה', 'בדיקות', 'טסט', 'ניסיון', 'נסיון', 'אנונימי', 'אנונימית',
    'פלוני', 'אלמוני', 'פלונית', 'אלמונית', 'שם', 'משפחה', 'פרטי', 'אין', 'לא', 'כלום', 'סתם', 'מנהל',
    'אורח', 'אורחת', 'חבר', 'מישהו', 'אני',
    'user', 'google', 'test', 'tester', 'testing', 'admin', 'anonymous', 'anon', 'guest', 'name',
    'none', 'null', 'undefined', 'unknown', 'asdf', 'qwerty', 'xxx', 'abc', 'me', 'nobody'
]);

// השם שבדוגמה שבשדה אינו נחשב שם אמיתי.
const EXAMPLE_NAMES = new Set(['ישראל ישראלי']);

export function normalizeRequestName(value) {
    return String(value ?? '')
        .normalize('NFC')
        .replace(/[​-‏‪-‮⁦-⁩]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}

export function normalizeRequestNote(value) {
    return String(value ?? '')
        .normalize('NFC')
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/gu, '')
        .replace(/[ \t]+/gu, ' ')
        .trim()
        .slice(0, REQUEST_NOTE_MAX_LENGTH);
}

function lettersOf(word) {
    return [...word].filter(char => LETTER.test(char));
}

// מחזיר { ok, name, error, code }. error הוא משפט מוכן להצגה מתחת לשדה.
export function validateRequestName(value) {
    const name = normalizeRequestName(value);
    const fail = (code, error) => ({ ok: false, name, code, error });

    if (!name) return fail('required', 'חובה לכתוב שם מלא. בלי שם אמיתי אי אפשר לשלוח את הבקשה.');
    if (name.length > REQUEST_NAME_MAX_LENGTH) return fail('too_long', `השם ארוך מדי — עד ${REQUEST_NAME_MAX_LENGTH} תווים.`);
    if (/\d/u.test(name)) return fail('digits', 'השם לא יכול לכלול ספרות.');
    if (/[@<>{}[\]\\/|#$%^&*+=_~:;!?,()]/u.test(name)) return fail('symbols', 'השם יכול לכלול אותיות בלבד, ללא סימנים או כתובת דוא"ל.');
    if (!ALLOWED.test(name)) return fail('symbols', 'השם יכול לכלול אותיות בעברית או באנגלית בלבד.');

    const words = name.split(WORD_SPLIT).filter(word => lettersOf(word).length > 0);
    if (words.length < 2) return fail('one_word', 'יש לכתוב שם פרטי ושם משפחה.');
    if (words.some(word => lettersOf(word).length < 2)) return fail('initials', 'יש לכתוב את השם המלא, לא ראשי תיבות.');

    const totalLetters = words.reduce((sum, word) => sum + lettersOf(word).length, 0);
    if (totalLetters < REQUEST_NAME_MIN_LENGTH) return fail('too_short', 'השם קצר מדי. יש לכתוב שם פרטי ושם משפחה.');

    const lowerWords = words.map(word => lettersOf(word).join('').toLowerCase());
    const placeholder = lowerWords.some(word => PLACEHOLDER_WORDS.has(word));
    const repeated = lowerWords.some(word => new Set(word).size === 1);
    const tooFewDistinct = new Set(lowerWords.join('')).size < 3;
    const example = EXAMPLE_NAMES.has(lowerWords.join(' '));
    if (placeholder || repeated || tooFewDistinct || example) {
        return fail('not_real', 'נא לכתוב את השם האמיתי שלך — המנהל מאשר רק מי שהוא מזהה.');
    }

    return { ok: true, name, code: 'ok', error: '' };
}

// חשבון שממתין לאישור ועדיין לא מילא את הטופס.
export function needsAccessRequest(profile) {
    if (!profile || (profile.status && profile.status !== 'pending')) return false;
    return !validateRequestName(profile.requestedName).ok;
}

// השדות שנשמרים בפרופיל כששולחים את הבקשה.
export function accessRequestFields({ name, note }, now = Date.now()) {
    const checked = validateRequestName(name);
    if (!checked.ok) return null;
    const cleanNote = normalizeRequestNote(note);
    return {
        requestedName: checked.name,
        requestNote: cleanNote,
        accessRequestedAt: now
    };
}
