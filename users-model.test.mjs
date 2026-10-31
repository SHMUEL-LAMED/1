// users-model.js: "ההעלאות שלי", ההודעה על אישורים חדשים, סימון הכפילויות
// בתור ההעלאה, המלבן של התיוג הידני וקישורי ההזמנה.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    normalizeMyUploads, filterUploadsByStatus, newlyApproved, nextSeenMarker, approvalsBaseline, approvalsNotice,
    myUploadsSummary, seenMarkerKey, normalizeRejectReason, duplicateLookupHashes, markDuplicates, duplicateLabel,
    boxFromDrag, parseInviteHash, inviteUrl, normalizeInvite, inviteUsageLabel, inviteExpiryLabel,
    inviteRedeemMessage, inviteErrorMessage, APPROVALS_FIRST_LOOKBACK_MS
} from "./users-model.js";
import { createSha256, sha256OfBlob, legacySampleHash, fingerprintForUpload, FULL_HASH_SUBTLE_MAX_BYTES } from "./content-hash.js";

const DAY = 24 * 60 * 60 * 1000;
const HASH = "a".repeat(64);

test("normalizeMyUploads: רק סטטוס מוכר, כתובת שעברה בדיקה, ותיקייה וסיבה רק במצב המתאים", () => {
    const sanitize = url => (/^https:\/\//.test(String(url)) ? url : "");
    const result = normalizeMyUploads({
        retentionDays: 60,
        uploads: [
            { id: "a1", status: "approved", title: "  חתונה  ", folderId: "f1", folderName: "אירוע", decidedAt: 5, thumbUrl: "https://x/t.webp", reason: "לא אמור להופיע" },
            { id: "a2", status: "approved", thumbUrl: "javascript:alert(1)" },
            { id: "p1", status: "pending", folderId: "f1", reason: "x", thumbUrl: "https://x/p.webp" },
            { id: "r1", status: "rejected", reason: "מטושטש", folderName: "x" },
            { id: "bad", status: "deleted" },
            { id: "<script>", status: "pending" },
            { status: "pending" }
        ]
    }, sanitize);
    assert.deepEqual(result.counts, { pending: 2, approved: 2, rejected: 1 });
    const [a1, a2, p1, r1, script] = result.uploads;
    assert.equal(a1.title, "חתונה");
    assert.equal(a1.folderName, "אירוע");
    assert.equal(a1.reason, "");
    assert.equal(a1.thumbUrl, "https://x/t.webp");
    assert.equal(a2.thumbUrl, "", "כתובת שאינה https אינה עוברת");
    assert.equal(a2.title, "ללא שם");
    assert.equal(p1.folderId, "");
    assert.equal(p1.reason, "");
    assert.equal(p1.thumbUrl, "", "לפריט ממתין אין תמונה ממוזערת");
    assert.equal(script.id, "script", "המזהה מנוקה");
    assert.equal(r1.reason, "מטושטש");
    assert.equal(r1.folderName, "");
    assert.deepEqual(filterUploadsByStatus(result.uploads, "rejected").map(item => item.id), ["r1"]);
    assert.equal(filterUploadsByStatus(result.uploads, "nope").length, 5);
    assert.equal(normalizeMyUploads(null).uploads.length, 0);
});

test("אישורים חדשים: רק מה שאושר מהתור אחרי הסימון; כניסה ראשונה — שבוע אחורה", () => {
    const now = Date.UTC(2026, 9, 30);
    const uploads = [
        { id: "old", status: "approved", decidedAt: now - 10 * DAY },
        { id: "week", status: "approved", decidedAt: now - 2 * DAY },
        { id: "fresh", status: "approved", decidedAt: now - 1000 },
        { id: "direct", status: "approved", decidedAt: 0 },
        { id: "wait", status: "pending", decidedAt: 0 },
        { id: "no", status: "rejected", decidedAt: now }
    ];
    assert.equal(approvalsBaseline(null, now), now - APPROVALS_FIRST_LOOKBACK_MS);
    assert.equal(approvalsBaseline("123", now), 123);
    assert.deepEqual(newlyApproved(uploads, approvalsBaseline(null, now)).map(item => item.id), ["week", "fresh"]);
    assert.deepEqual(newlyApproved(uploads, now - 5000).map(item => item.id), ["fresh"]);
    assert.equal(nextSeenMarker(uploads, now - 5000), now - 1000);
    assert.equal(nextSeenMarker([], 77), 77);
    assert.equal(approvalsNotice(0), "");
    assert.equal(approvalsNotice(1), "אחת מההעלאות שלך אושרה ונוספה לגלריה.");
    assert.equal(approvalsNotice(3), "3 מההעלאות שלך אושרו ונוספו לגלריה.");
    assert.equal(myUploadsSummary({ pending: 1, approved: 2, rejected: 0 }), "1 ממתינים לאישור · 2 אושרו");
    assert.equal(seenMarkerKey("google-1"), "simchas_my_uploads_seen_google-1");
    assert.equal(seenMarkerKey(""), "");
});

test("סיבת דחייה: בלי תווי בקרה, רווחים מכווצים, עד 300 תווים", () => {
    assert.equal(normalizeRejectReason("  לא\nקשור\t לאירוע "), "לא קשור לאירוע");
    assert.equal([...normalizeRejectReason("א".repeat(400))].length, 300);
    assert.equal(normalizeRejectReason(null), "");
});

test("כפילויות: טביעות לבדיקה, סימון מול השרת ובתוך אותה בחירה", () => {
    const records = [
        { id: "1", duplicateLookup: [HASH] },
        { id: "2", duplicateLookup: ["b".repeat(64), `s1:${"c".repeat(64)}`] },
        { id: "3", duplicateLookup: ["d".repeat(64)] },
        { id: "4", duplicateLookup: ["d".repeat(64)] },
        { id: "5", duplicateLookup: ["not-a-hash"] },
        { id: "6" }
    ];
    assert.deepEqual(duplicateLookupHashes(records), [HASH, "b".repeat(64), `s1:${"c".repeat(64)}`, "d".repeat(64)]);
    assert.equal(duplicateLookupHashes(records, 2).length, 2);
    const duplicates = markDuplicates(records, [
        { hash: HASH, exists: true, imageId: "img_1", state: "approved" },
        { hash: `s1:${"c".repeat(64)}`, exists: true },
        { hash: "d".repeat(64), exists: false }
    ]);
    assert.deepEqual(duplicates.map(record => record.id), ["1", "2", "4"]);
    assert.deepEqual(records[0].duplicateOf, { imageId: "img_1", state: "approved" });
    assert.deepEqual(records[1].duplicateOf, { imageId: "", state: "" }, "ממתין של אחר: קיים, בלי מזהה");
    assert.equal(records[2].duplicateOf, null);
    assert.deepEqual(records[3].duplicateOf, { inBatch: true });
    assert.equal(duplicateLabel(records[0].duplicateOf), "כבר קיים בגלריה");
    assert.equal(duplicateLabel({ imageId: "x", state: "pending" }), "כבר ממתין לאישור");
    assert.equal(duplicateLabel(records[3].duplicateOf), "מופיע פעמיים בבחירה");
});

test("מלבן התיוג: יחסי לתמונה, בכל כיוון גרירה, ונגיעה בלי גרירה היא כל התמונה", () => {
    const rect = { width: 400, height: 200 };
    assert.deepEqual(boxFromDrag({ x: 100, y: 50 }, { x: 300, y: 150 }, rect, 2), { x: 0.25, y: 0.25, w: 0.5, h: 0.5, a: 2 });
    assert.deepEqual(boxFromDrag({ x: 300, y: 150 }, { x: 100, y: 50 }, rect, 2), { x: 0.25, y: 0.25, w: 0.5, h: 0.5, a: 2 });
    const clamped = boxFromDrag({ x: -50, y: -10 }, { x: 900, y: 500 }, rect, 0);
    assert.deepEqual(clamped, { x: 0, y: 0, w: 1, h: 1, a: 2 });
    assert.equal(boxFromDrag({ x: 10, y: 10 }, { x: 12, y: 11 }, rect), null);
    assert.equal(boxFromDrag({ x: 10, y: 10 }, { x: 50, y: 50 }, { width: 0, height: 0 }), null);
});

test("קישור הזמנה: אסימון ב-hash בלבד, בצורה מדויקת", () => {
    const token = "A".repeat(20) + "_-" + "b".repeat(21);
    assert.equal(parseInviteHash(`#invite/${token}`), token);
    assert.equal(parseInviteHash(`#invite/${token}x`), "");
    assert.equal(parseInviteHash(`#invite/${token.slice(1)}`), "");
    assert.equal(parseInviteHash("#invite/<script>"), "");
    assert.equal(parseInviteHash("#media/x"), "");
    assert.equal(inviteUrl("https://shmuel-lamed.github.io/1/admin.html?x=1#folders", token), `https://shmuel-lamed.github.io/1/#invite/${token}`);
    assert.equal(inviteUrl("https://site.example/", "short"), "");
});

test("הזמנה ברשימת הניהול: נרמול, שימושים ותוקף", () => {
    const now = Date.UTC(2026, 9, 30, 12);
    const invite = normalizeInvite({ inviteId: "abcdefghijkl", folderName: "חתונה", maxUses: 5, useCount: 2, expiresAt: now + 3 * DAY, status: "active", mine: true, autoApprove: true });
    assert.equal(invite.folderName, "חתונה");
    assert.equal(inviteUsageLabel(invite), "2 מתוך 5 שימושים");
    assert.equal(inviteUsageLabel({ ...invite, maxUses: 0 }), "2 שימושים, ללא הגבלה");
    assert.equal(inviteExpiryLabel(invite, now), "בתוקף עוד 3 ימים");
    assert.equal(inviteExpiryLabel({ ...invite, expiresAt: now + 2 * 60 * 60 * 1000 }, now), "בתוקף עוד 2 שעות");
    assert.equal(inviteExpiryLabel({ ...invite, expiresAt: now - 1 }, now), "פג תוקף");
    assert.equal(inviteExpiryLabel({ ...invite, status: "revoked" }, now), "בוטל");
    assert.equal(normalizeInvite({ inviteId: "x" }), null);
    assert.equal(normalizeInvite({ inviteId: "abcdefghijkl", status: "weird" }).status, "expired");
});

test("הודעות המימוש: מאושר, ממתין, נדחה ושגיאות", () => {
    assert.match(inviteRedeemMessage({ status: "approved", autoApproved: true, folderName: "חתונה" }), /אושרת לצפייה.*חתונה/);
    assert.match(inviteRedeemMessage({ status: "pending", folderName: "חתונה" }), /ממתינה לאישור/);
    assert.match(inviteRedeemMessage({ status: "approved", alreadyApproved: true, folderName: "חתונה" }), /מחכות לך/);
    assert.match(inviteRedeemMessage({ status: "rejected" }), /נדחתה/);
    assert.match(inviteErrorMessage({ code: "invite_expired" }), /פג/);
    assert.match(inviteErrorMessage({ code: "invite_revoked" }), /בוטל/);
    assert.match(inviteErrorMessage({ code: "invite_exhausted" }), /נוצל/);
    assert.match(inviteErrorMessage({ status: 404, code: "invite_invalid" }), /אינו תקף/);
    assert.match(inviteErrorMessage({ status: 404, code: "request_failed" }), /אינן זמינות/);
});

// --- content-hash.js ---

function nodeSha(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

test("SHA-256 מצטבר: זהה ל-node:crypto בכל חלוקה לחלקים ובכל אורך", () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
        const bytes = new Uint8Array(length).map((_, index) => (index * 31 + length) & 255);
        const whole = createSha256().update(bytes).digestHex();
        assert.equal(whole, nodeSha(bytes), `אורך ${length}`);
        const parts = createSha256();
        for (let offset = 0; offset < length; offset += 7) parts.update(bytes.subarray(offset, offset + 7));
        assert.equal(parts.digestHex(), whole, `חלקים, אורך ${length}`);
    }
    assert.equal(createSha256().update(new TextEncoder().encode("abc")).digestHex(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const done = createSha256();
    done.digestHex();
    assert.throws(() => done.update(new Uint8Array(1)));
});

test("טביעת קובץ: subtle לקובץ קטן, קריאה בחלקים לגדול — ושתיהן נותנות אותה תוצאה", async () => {
    const bytes = new Uint8Array(300_000).map((_, index) => (index * 7) & 255);
    const blob = new Blob([bytes]);
    const expected = nodeSha(bytes);
    assert.equal(await sha256OfBlob(blob), expected);
    const progress = [];
    assert.equal(await sha256OfBlob(blob, { subtle: null, chunkBytes: 65_536, onProgress: value => progress.push(value) }), expected);
    assert.ok(progress.length >= 4 && progress.at(-1) === 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sha256OfBlob(blob, { subtle: null, signal: controller.signal }), { name: "AbortError" });
    assert.equal(await sha256OfBlob(null), "");
});

test("טביעה ישנה מדגימות: רק מעל 64MB, באותה צורה שהדפדפן חישב עד עכשיו", async () => {
    const small = new Blob([new Uint8Array(10)]);
    assert.equal(await legacySampleHash(small), "");
    const fake = { size: FULL_HASH_SUBTLE_MAX_BYTES + 10, slice: (start, end) => new Blob([new Uint8Array(Math.max(0, Math.min(end ?? Infinity, FULL_HASH_SUBTLE_MAX_BYTES + 10) - start)).fill(1)]) };
    const legacy = await legacySampleHash(fake);
    assert.match(legacy, /^s1:[a-f0-9]{64}$/);
    const fingerprint = await fingerprintForUpload(small);
    assert.deepEqual(fingerprint.lookup, [fingerprint.contentHash]);
    assert.equal(fingerprint.legacyHash, "");
});
