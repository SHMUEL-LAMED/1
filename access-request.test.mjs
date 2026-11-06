// בקשת הגישה: שם מלא אמיתי הוא חובה, והבקשה אינה נשלחת בלעדיו.
import test from "node:test";
import assert from "node:assert/strict";
import {
    validateRequestName, normalizeRequestName, normalizeRequestNote, needsAccessRequest,
    accessRequestFields, REQUEST_NOTE_MAX_LENGTH
} from "./access-request.js";

test("שם פרטי ושם משפחה עוברים, ומנוקים מרווחים", () => {
    for (const name of ["דוד כהן", "  שמואל   לוי ", "יוסף בן-דוד", "אברהם יצחק שטרן", "David Cohen", "מרדכי ג׳ורג׳י", "O'Brien Smith"]) {
        const result = validateRequestName(name);
        assert.equal(result.ok, true, `${name}: ${result.error}`);
    }
    assert.equal(validateRequestName("  שמואל   לוי ").name, "שמואל לוי");
});

test("שדה ריק נחסם עם הודעה שהשם הוא חובה", () => {
    for (const value of ["", "   ", null, undefined]) {
        const result = validateRequestName(value);
        assert.equal(result.ok, false);
        assert.equal(result.code, "required");
        assert.match(result.error, /חובה/);
    }
});

test("מילה אחת, ראשי תיבות, ספרות או סימנים — נחסמים", () => {
    assert.equal(validateRequestName("דוד").code, "one_word");
    assert.equal(validateRequestName("ד כהן").code, "initials");
    assert.equal(validateRequestName("דוד כהן 2").code, "digits");
    assert.equal(validateRequestName("david@gmail.com").code, "symbols");
    assert.equal(validateRequestName("דוד 🙂 כהן").code, "symbols");
    assert.equal(validateRequestName("א".repeat(30) + " " + "ב".repeat(31)).code, "too_long");
});

test("שמות שאינם שם של אדם נחסמים", () => {
    for (const name of ["משתמש Google", "בדיקה בדיקה", "test user", "אאא בבב", "פלוני אלמוני", "ישראל ישראלי", "שם משפחה", "אב אב"]) {
        const result = validateRequestName(name);
        assert.equal(result.ok, false, name);
        assert.equal(result.code, "not_real", name);
    }
});

test("תווים נסתרים של כיווניות אינם עוקפים את הבדיקה", () => {
    assert.equal(normalizeRequestName("‏דוד‮ כהן"), "דוד כהן");
});

test("ההערה מנוקה ומקוצרת", () => {
    assert.equal(normalizeRequestNote("  תלמיד\u0007 שיעור ב׳  "), "תלמיד שיעור ב׳");
    assert.equal(normalizeRequestNote("x".repeat(500)).length, REQUEST_NOTE_MAX_LENGTH);
});

test("רק חשבון ממתין בלי שם תקין צריך למלא את הטופס", () => {
    assert.equal(needsAccessRequest({ status: "pending" }), true);
    assert.equal(needsAccessRequest({ status: "pending", requestedName: "דוד" }), true);
    assert.equal(needsAccessRequest({ status: "pending", requestedName: "דוד כהן" }), false);
    assert.equal(needsAccessRequest({ status: "approved" }), false);
    assert.equal(needsAccessRequest({ status: "blocked" }), false);
    assert.equal(needsAccessRequest(null), false);
});

test("שדות הבקשה נבנים רק משם תקין", () => {
    assert.equal(accessRequestFields({ name: "דוד", note: "" }), null);
    assert.deepEqual(accessRequestFields({ name: " דוד  כהן ", note: " הורה " }, 1000), {
        requestedName: "דוד כהן",
        requestNote: "הורה",
        accessRequestedAt: 1000
    });
});
