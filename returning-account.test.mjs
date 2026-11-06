// זיכרון החשבון האחרון: מי נזכר, מה נשמר, ואיזה מסך מקבל המבקר.
import test from "node:test";
import assert from "node:assert/strict";
import {
    RETURNING_ACCOUNT_KEY, RETURN_REASONS,
    accountSnapshot, parseRememberedAccount, readRememberedAccount, rememberAccount,
    forgetRememberedAccount, markSignedOut, greetingName, accountInitial,
    returningGateCopy, gateKindFor
} from "./returning-account.js";

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key)
    };
}

const USER = { displayName: "  דוד   כהן ", email: "David@Example.com", photoURL: "https://lh3.googleusercontent.com/a/x" };

test("נשמרים רק שם, דוא\"ל ותמונה — מנוקים", () => {
    const snapshot = accountSnapshot(USER, 1000);
    assert.deepEqual(snapshot, {
        name: "דוד כהן",
        email: "david@example.com",
        photoURL: "https://lh3.googleusercontent.com/a/x",
        savedAt: 1000,
        reason: null
    });
});

test("משתמש אנונימי או בלי דוא\"ל אינו נזכר", () => {
    assert.equal(accountSnapshot(null), null);
    assert.equal(accountSnapshot({ isAnonymous: true, email: "a@b.c" }), null);
    assert.equal(accountSnapshot({ displayName: "בלי מייל" }), null);
    assert.equal(accountSnapshot({ email: "not-an-email" }), null);
});

test("כתובת תמונה שאינה https נזרקת", () => {
    assert.equal(accountSnapshot({ email: "a@b.c", photoURL: "javascript:alert(1)" }).photoURL, "");
    assert.equal(accountSnapshot({ email: "a@b.c", photoURL: "http://x/y.png" }).photoURL, "");
    assert.equal(accountSnapshot({ email: "a@b.c", photoURL: 'https://x/"onerror=' }).photoURL, "");
});

test("שמירה, קריאה ושכחה דרך האחסון", () => {
    const storage = memoryStorage();
    assert.equal(readRememberedAccount(storage), null);
    rememberAccount(storage, USER, 5);
    assert.equal(readRememberedAccount(storage).email, "david@example.com");
    forgetRememberedAccount(storage);
    assert.equal(readRememberedAccount(storage), null);
    assert.ok(!storage.data.has(RETURNING_ACCOUNT_KEY));
});

test("ערך פגום או אחסון חסום אינם מפילים את הדף", () => {
    assert.equal(parseRememberedAccount("{not json"), null);
    assert.equal(parseRememberedAccount('"string"'), null);
    assert.equal(parseRememberedAccount(JSON.stringify({ name: "בלי מייל" })), null);
    const blocked = {
        getItem() { throw new Error("SecurityError"); },
        setItem() { throw new Error("SecurityError"); },
        removeItem() { throw new Error("SecurityError"); }
    };
    assert.equal(readRememberedAccount(blocked), null);
    assert.doesNotThrow(() => rememberAccount(blocked, USER));
    assert.doesNotThrow(() => forgetRememberedAccount(blocked));
    assert.equal(markSignedOut(blocked), null);
    assert.equal(readRememberedAccount(undefined), null);
});

test("סיבה לא מוכרת באחסון נקראת כ\"אין סיבה\"", () => {
    const raw = JSON.stringify({ name: "דוד", email: "d@e.f", reason: "hacked" });
    assert.equal(parseRememberedAccount(raw).reason, null);
});

test("התנתקות מכוונת מסומנת, וכניסה חוזרת מנקה את הסימון", () => {
    const storage = memoryStorage();
    assert.equal(markSignedOut(storage), null, "אין מה לסמן כשאין חשבון שמור");
    rememberAccount(storage, USER);
    assert.equal(markSignedOut(storage).reason, RETURN_REASONS.SIGNED_OUT);
    assert.equal(readRememberedAccount(storage).reason, RETURN_REASONS.SIGNED_OUT);
    rememberAccount(storage, USER);
    assert.equal(readRememberedAccount(storage).reason, null);
});

test("שם הפנייה והאות שבעיגול", () => {
    assert.equal(greetingName({ name: "דוד כהן", email: "d@e.f" }), "דוד");
    assert.equal(greetingName({ name: "", email: "yossi@e.f" }), "yossi");
    assert.equal(greetingName(null), "");
    assert.equal(accountInitial({ name: "דוד", email: "d@e.f" }), "ד");
    assert.equal(accountInitial({ name: "", email: "yossi@e.f" }), "Y");
    assert.equal(accountInitial(null), "?");
});

test("נוסח \"שלום שוב\" לפי סיבת הניתוק", () => {
    const manual = returningGateCopy({ name: "דוד כהן", email: "d@e.f", reason: RETURN_REASONS.SIGNED_OUT });
    assert.equal(manual.state, "returning");
    assert.equal(manual.reason, "signed-out");
    assert.equal(manual.title, "שלום שוב, דוד");
    assert.equal(manual.chip, "התנתקת מהחשבון");

    const expired = returningGateCopy({ name: "דוד כהן", email: "d@e.f", reason: null });
    assert.equal(expired.reason, "expired");
    assert.equal(expired.chip, "נדרשת התחברות מחדש");
    assert.match(expired.text, /החיבור הקודם שלך הסתיים/);

    assert.equal(returningGateCopy({ name: "", email: "" }).title, "שלום שוב");
});

test("איזה מסך מוצג", () => {
    const remembered = { name: "דוד", email: "d@e.f" };
    assert.equal(gateKindFor({ approvalStatus: "signed_out", signedIn: false, rememberedAccount: null }), "signed-out");
    assert.equal(gateKindFor({ approvalStatus: "signed_out", signedIn: false, rememberedAccount: remembered }), "returning");
    assert.equal(gateKindFor({ approvalStatus: "pending", signedIn: true, rememberedAccount: remembered }), "pending");
    assert.equal(gateKindFor({ approvalStatus: "blocked", signedIn: true, rememberedAccount: null }), "blocked");
    assert.equal(gateKindFor({ approvalStatus: "rejected", signedIn: true, rememberedAccount: null }), "rejected");
    // מחובר אך במצב לא מוכר: מסך הכניסה הרגיל, לא "שלום שוב".
    assert.equal(gateKindFor({ approvalStatus: "weird", signedIn: true, rememberedAccount: remembered }), "signed-out");
});
