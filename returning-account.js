// returning-account.js — זיכרון החשבון האחרון שנכנס מהמכשיר הזה.
//
// שער הכניסה מבחין בין שני מבקרים שאינם מחוברים:
//   • מבקר חדש — מעולם לא נכנס מהמכשיר. הוא מקבל את מסך הפתיחה המלא:
//     מה יש בגלריה, איך נכנסים ומה קורה אחרי ההתחברות.
//   • מבקר חוזר — כבר נכנס בעבר עם חשבון מאושר, והתנתק או שהחיבור שלו
//     הסתיים. הוא מקבל מסך "ברוך שובך" עם השם והתמונה שלו, ומתחבר מחדש
//     בלחיצה אחת, בלי לעבור שוב את ההסבר.
//
// נשמרים רק שם, כתובת דוא"ל ותמונת פרופיל — מה שחלון Google עצמו מציג —
// ורק אחרי שהחשבון אושר. חשבון ממתין, חסום או שנדחה אינו נזכר: אין טעם
// להזמין אותו "לחזור". "זה לא החשבון שלי" מוחק את הזיכרון מהמכשיר.
//
// הלוגיקה כאן טהורה ככל האפשר; האחסון מוזרק, כדי שאפשר יהיה לבדוק אותה
// בלי דפדפן (returning-account.test.mjs).

export const RETURNING_ACCOUNT_KEY = 'simchat-gallery.returning-account.v1';

// הסיבה שבגללה המבקר אינו מחובר עכשיו.
//   signed-out — לחץ בעצמו על "התנתקות".
//   expired    — החיבור הסתיים בלי שהתנתק (אסימון שפג, ניקוי בשרת וכדומה).
export const RETURN_REASONS = Object.freeze({ SIGNED_OUT: 'signed-out', EXPIRED: 'expired' });

const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

function cleanText(value, maxLength) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanPhotoUrl(value) {
    const url = String(value ?? '').trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

// תמונת מצב של החשבון לשמירה. מחזיר null למי שאין טעם לזכור.
export function accountSnapshot(user, now = Date.now()) {
    if (!user || user.isAnonymous) return null;
    const email = cleanText(user.email, MAX_EMAIL_LENGTH).toLowerCase();
    if (!email || !email.includes('@')) return null;
    return {
        name: cleanText(user.displayName, MAX_NAME_LENGTH),
        email,
        photoURL: cleanPhotoUrl(user.photoURL),
        savedAt: Number(now) || 0,
        reason: null
    };
}

// קריאה מוגנת: ערך פגום, אחסון חסום או מצב גלישה פרטית מחזירים null.
export function parseRememberedAccount(raw) {
    if (!raw) return null;
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    const snapshot = accountSnapshot({ email: data.email, displayName: data.name, photoURL: data.photoURL }, data.savedAt);
    if (!snapshot) return null;
    const reason = Object.values(RETURN_REASONS).includes(data.reason) ? data.reason : null;
    return { ...snapshot, reason };
}

export function readRememberedAccount(storage) {
    try { return parseRememberedAccount(storage?.getItem(RETURNING_ACCOUNT_KEY)); } catch { return null; }
}

export function rememberAccount(storage, user, now = Date.now()) {
    const snapshot = accountSnapshot(user, now);
    if (!snapshot) return null;
    try { storage?.setItem(RETURNING_ACCOUNT_KEY, JSON.stringify(snapshot)); } catch { /* אחסון חסום */ }
    return snapshot;
}

export function forgetRememberedAccount(storage) {
    try { storage?.removeItem(RETURNING_ACCOUNT_KEY); } catch { /* אחסון חסום */ }
}

// מסמן שההתנתקות הבאה מכוונת. בלי הסימון, ניתוק נחשב "החיבור הסתיים".
export function markSignedOut(storage, reason = RETURN_REASONS.SIGNED_OUT) {
    const account = readRememberedAccount(storage);
    if (!account) return null;
    const next = { ...account, reason };
    try { storage?.setItem(RETURNING_ACCOUNT_KEY, JSON.stringify(next)); } catch { /* אחסון חסום */ }
    return next;
}

// שם הפנייה: השם הפרטי מתוך השם המלא, ואם אין שם — החלק שלפני ה-@.
export function greetingName(account) {
    const first = cleanText(account?.name, MAX_NAME_LENGTH).split(' ')[0];
    if (first) return first;
    return cleanText(account?.email, MAX_EMAIL_LENGTH).split('@')[0] || '';
}

// האות שמוצגת בעיגול כשאין תמונת פרופיל.
export function accountInitial(account) {
    const source = cleanText(account?.name, MAX_NAME_LENGTH) || cleanText(account?.email, MAX_EMAIL_LENGTH);
    return source ? [...source][0].toUpperCase() : '?';
}

// הנוסח של מסך "ברוך שובך", לפי הסיבה שבגללה המבקר אינו מחובר.
export function returningGateCopy(account) {
    const name = greetingName(account);
    const title = name ? `שלום שוב, ${name}` : 'שלום שוב';
    if (account?.reason === RETURN_REASONS.SIGNED_OUT) {
        return {
            state: 'returning',
            reason: RETURN_REASONS.SIGNED_OUT,
            chip: 'התנתקת מהחשבון',
            title,
            text: 'כדי לחזור לגלריה, התחבר שוב עם אותו חשבון Google. ההגדרות והחיפושים השמורים שלך מחכים כאן.'
        };
    }
    return {
        state: 'returning',
        reason: RETURN_REASONS.EXPIRED,
        chip: 'נדרשת התחברות מחדש',
        title,
        text: 'החיבור הקודם שלך הסתיים. התחבר שוב עם אותו חשבון Google כדי להמשיך מאיפה שהפסקת.'
    };
}

// איזה מסך מציג השער למבקר שאין לו גישה לגלריה.
//   request — מחובר וממתין, אך עוד לא מילא שם מלא בטופס הבקשה.
//   pending / rejected / blocked — לפי מצב החשבון המחובר.
//   returning — אין חשבון מחובר, אבל יש חשבון מאושר שנזכר מהמכשיר.
//   signed-out — מבקר חדש.
export function gateKindFor({ approvalStatus, signedIn, rememberedAccount, needsRequest = false }) {
    if (signedIn && approvalStatus === 'pending' && needsRequest) return 'request';
    if (signedIn && ['pending', 'rejected', 'blocked'].includes(approvalStatus)) return approvalStatus;
    if (!signedIn && rememberedAccount) return 'returning';
    return 'signed-out';
}
