// הקישור הישיר לפריט (#media/<id>) והשיתוף שלו: פירוש ה-hash, הכתובת
// המשותפת, ההחלטה בין שיתוף מערכת להעתקה, וה-hash שחוזר בסגירה.
import test from "node:test";
import assert from "node:assert/strict";
import {
    MEDIA_HASH_PREFIX, isMediaId, parseMediaRoute, mediaHash, mediaShareUrl, mediaShareData,
    canUseNativeShare, isShareCancel, hashToRestore, findRecordById, withRecord
} from "./media-link.js";

const safeId = value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);

test("מזהה פריט: אותם תווים ואורך כמו safeRecordId", () => {
    assert.equal(isMediaId("img_e2e_1"), true);
    assert.equal(isMediaId("a-B_9"), true);
    assert.equal(isMediaId("x".repeat(120)), true);
    assert.equal(isMediaId("x".repeat(121)), false);
    assert.equal(isMediaId(""), false);
    assert.equal(isMediaId("img/1"), false);
    assert.equal(isMediaId("תמונה"), false);
    assert.equal(isMediaId(null), false);
});

test("פירוש ה-hash: רק #media/<id> תקין מחזיר פריט", () => {
    assert.equal(MEDIA_HASH_PREFIX, "#media/");
    assert.deepEqual(parseMediaRoute("#media/img_e2e_7"), { mediaId: "img_e2e_7" });
    assert.deepEqual(parseMediaRoute("#media/img%5F7"), { mediaId: "img_7" });
    assert.equal(parseMediaRoute("#media/"), null);
    assert.equal(parseMediaRoute("#media/a b"), null);
    assert.equal(parseMediaRoute("#media/%E0%A4%A"), null);
    assert.equal(parseMediaRoute("#media/../x"), null);
    assert.equal(parseMediaRoute("#person/fp_1"), null);
    assert.equal(parseMediaRoute("#people"), null);
    assert.equal(parseMediaRoute(""), null);
    assert.equal(parseMediaRoute(undefined), null);
});

test("בניית ה-hash הפוכה לפירוש, ומזהה לא תקין אינו נבנה", () => {
    assert.equal(mediaHash("img_1"), "#media/img_1");
    assert.deepEqual(parseMediaRoute(mediaHash("img_1")), { mediaId: "img_1" });
    assert.equal(mediaHash("bad id"), "");
    assert.equal(mediaHash(""), "");
});

test("הכתובת המשותפת: מקור ונתיב בלבד, בלי פרמטרי חיפוש ובלי ה-hash הקודם", () => {
    const location = {
        origin: "https://example.github.io",
        pathname: "/gallery/index.html",
        search: "?drive=connected",
        hash: "#person/fp_1"
    };
    assert.equal(mediaShareUrl(location, "img_9"), "https://example.github.io/gallery/index.html#media/img_9");
    assert.equal(mediaShareUrl({ origin: "https://example.github.io", pathname: "/" }, "img_9"), "https://example.github.io/#media/img_9");
    assert.equal(mediaShareUrl({ origin: "https://example.github.io" }, "img_9"), "https://example.github.io/#media/img_9");
    assert.equal(mediaShareUrl(location, "bad id"), "");
    // דף שנפתח מקובץ מקומי (origin "null") אינו נותן קישור שאפשר לשתף.
    assert.equal(mediaShareUrl({ origin: "null", pathname: "/x" }, "img_9"), "");
    assert.equal(mediaShareUrl(null, "img_9"), "");
});

test("נתוני השיתוף: שם הפריט, ובלעדיו תיאור לפי סוג", () => {
    assert.deepEqual(mediaShareData({ title: "  הקפות   בבית המדרש " }, "https://x/#media/a"), {
        title: "הקפות בבית המדרש",
        text: "תמונה מהגלריה: הקפות בבית המדרש",
        url: "https://x/#media/a"
    });
    assert.deepEqual(mediaShareData({ title: "", isVideo: true }, "u"), {
        title: "סרטון מהגלריה",
        text: "סרטון מהגלריה",
        url: "u"
    });
    assert.equal(mediaShareData({ title: "א".repeat(300) }).title.length, 120);
    assert.equal(mediaShareData().url, "");
});

test("שיתוף מערכת רק כשהוא קיים ומסכים לנתונים; אחרת העתקה", () => {
    const data = { url: "https://x/#media/a" };
    assert.equal(canUseNativeShare({}, data), false);
    assert.equal(canUseNativeShare(undefined, data), false);
    assert.equal(canUseNativeShare({ share: () => {} }, data), true);
    assert.equal(canUseNativeShare({ share: () => {}, canShare: () => true }, data), true);
    assert.equal(canUseNativeShare({ share: () => {}, canShare: () => false }, data), false);
    assert.equal(canUseNativeShare({ share: () => {}, canShare: () => { throw new TypeError("x"); } }, data), false);
    let received = null;
    canUseNativeShare({ share: () => {}, canShare: value => { received = value; return true; } }, data);
    assert.equal(received, data);
});

test("סגירת חלון השיתוף בידי המשתמש אינה כישלון", () => {
    assert.equal(isShareCancel(Object.assign(new Error("x"), { name: "AbortError" })), true);
    assert.equal(isShareCancel(Object.assign(new Error("x"), { name: "NotAllowedError" })), false);
    assert.equal(isShareCancel(new Error("x")), false);
    assert.equal(isShareCancel(null), false);
});

test("בסגירה חוזר ה-hash שלפני הפתיחה, אבל לעולם לא קישור לפריט", () => {
    assert.equal(hashToRestore("#person/fp_1"), "#person/fp_1");
    assert.equal(hashToRestore("#people"), "#people");
    assert.equal(hashToRestore("#media/img_1"), "");
    assert.equal(hashToRestore("#"), "");
    assert.equal(hashToRestore(""), "");
    assert.equal(hashToRestore(undefined), "");
});

test("חיפוש רשומה ברשימות שכבר נטענו, לפי סדר הרשימות", () => {
    const first = { id: "img_1", title: "ראשונה" };
    const again = { id: "img_1", title: "עותק" };
    const other = { id: "img_2" };
    assert.equal(findRecordById([null, [other], [first], [again]], "img_1", safeId), first);
    assert.equal(findRecordById([[other]], "img_1", safeId), null);
    assert.equal(findRecordById([[first]], "", safeId), null);
    assert.equal(findRecordById(null, "img_1", safeId), null);
    // המזהה מנוקה כמו בכל הגלריה לפני ההשוואה.
    assert.equal(findRecordById([[first]], "img_1<>", safeId), first);
});

test("רשימת הדפדוף לפריט מקישור כוללת אותו פעם אחת, בגרסה שנטענה עכשיו", () => {
    const folder = [{ id: "img_3" }, { id: "img_2", title: "ישנה" }, null];
    const fresh = { id: "img_2", title: "חדשה" };
    assert.deepEqual(withRecord(folder, fresh, safeId), [{ id: "img_3" }, fresh]);
    assert.deepEqual(withRecord([], fresh, safeId), [fresh]);
    assert.deepEqual(withRecord(undefined, fresh, safeId), [fresh]);
    assert.deepEqual(withRecord(folder, null, safeId), [{ id: "img_3" }, { id: "img_2", title: "ישנה" }]);
    // הרשימה המקורית (המטמון של התיקייה) אינה משתנה.
    assert.equal(folder.length, 3);
});
