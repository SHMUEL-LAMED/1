// מסך המשתמשים: ייצוא CSV שאינו מריץ נוסחאות, ותכנון של פעולה על כמה
// משתמשים — אותם כללים של ה-Worker: לא את עצמך ולא את מנהל־העל האחרון.
import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvText, userCsvRows, planBulkAction, bulkConfirmMessage, BULK_MAX_USERS } from "./admin-users-model.js";

test("CSV: תא שמתחיל בסימן של נוסחה נפתח בגרש, וגרשיים מוכפלים", () => {
  for (const evil of ["=HYPERLINK(\"http://x\",\"y\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "  =1+1"]) {
    const cell = csvCell(evil);
    assert.match(cell, /^"'/, evil);
  }
  assert.equal(csvCell('שם "מצוטט"'), '"שם ""מצוטט"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(5), '"5"');
  assert.equal(csvText([["a", "=b"], ["c", "d"]]), '"a","\'=b"\r\n"c","d"');
});

test("CSV של המשתמשים: שם, דוא״ל, דרגה, סטטוס ותאריך הצטרפות", () => {
  const rows = userCsvRows([
    { uid: "a", displayName: "=cmd|'/C calc'!A0", email: "a@example.com", role: "admin", status: "approved", requestedAt: Date.UTC(2026, 0, 2) },
    { uid: "b", displayName: "דוד", email: "b@example.com", role: "viewer", roleBeforeBlock: "uploader", status: "blocked" }
  ]);
  assert.deepEqual(rows[0], ["שם", "דוא״ל", "דרגה", "סטטוס", "נוצר"]);
  assert.deepEqual(rows[1].slice(1), ["a@example.com", "דרגה 3 — מנהל", "פעיל", "2026-01-02"]);
  assert.deepEqual(rows[2].slice(2, 4), ["דרגה 2 — מעלה", "חסום"]);
  assert.match(csvText(rows), /"'=cmd/);
});

const USERS = [
  { uid: "me", displayName: "אני", status: "approved", role: "super_admin" },
  { uid: "s2", displayName: "מנהל־על שני", status: "approved", role: "super_admin" },
  { uid: "p1", displayName: "ממתין", status: "pending", role: "viewer" },
  { uid: "v1", displayName: "צופה", status: "approved", role: "viewer" },
  { uid: "b1", displayName: "חסום", status: "blocked", role: "viewer", roleBeforeBlock: "admin" }
];

test("תכנון: החשבון שלך לעולם אינו נכלל, וכל פעולה רק למי שמתאים לה", () => {
  const block = planBulkAction(USERS, ["me", "v1", "b1", "ghost"], "block", { currentUid: "me" });
  assert.deepEqual(block.eligible.map(user => user.uid), ["v1"]);
  assert.deepEqual(block.skipped.map(entry => entry.code), ["self_forbidden", "already_blocked", "not_found"]);
  assert.deepEqual(planBulkAction(USERS, ["p1", "v1"], "approve", { role: "uploader", currentUid: "me" }).eligible.map(user => user.uid), ["p1"]);
  assert.deepEqual(planBulkAction(USERS, ["b1", "v1"], "unblock", { currentUid: "me" }).eligible.map(user => user.uid), ["b1"]);
  const role = planBulkAction(USERS, ["v1", "p1", "b1"], "role", { role: "viewer", currentUid: "me" });
  assert.deepEqual(role.skipped.map(entry => entry.code), ["unchanged", "not_approved", "not_approved"]);
});

test("תכנון: מנהל־העל האחרון נשאר — גם כשבוחרים את כולם", () => {
  // מנהל־על אחר (לא אני) ששני מנהלי־העל היחידים הם "אני" ו-s2: s2 יורד, אני לא נבחר.
  const plan = planBulkAction(USERS, ["s2"], "role", { role: "admin", currentUid: "me" });
  assert.deepEqual(plan.eligible.map(user => user.uid), ["s2"]);
  // כשאני עצמי אינו מנהל־על מאושר (למשל מנהל־על ראשי שהפרופיל שלו ישן), s2 הוא האחרון.
  const others = USERS.map(user => (user.uid === "me" ? { ...user, role: "admin" } : user));
  const last = planBulkAction(others, ["s2"], "block", { currentUid: "me" });
  assert.deepEqual(last.skipped.map(entry => entry.code), ["last_super_admin"]);
  const three = [...USERS, { uid: "s3", status: "approved", role: "super_admin" }].map(user => (user.uid === "me" ? { ...user, role: "admin" } : user));
  const both = planBulkAction(three, ["s2", "s3"], "block", { currentUid: "me" });
  assert.deepEqual(both.eligible.map(user => user.uid), ["s2"]);
  assert.deepEqual(both.skipped.map(entry => entry.code), ["last_super_admin"]);
});

test("חלון האישור מונה את השמות ואת מי שלא ייכלל ולמה", () => {
  const plan = planBulkAction(USERS, ["me", "v1"], "block", { currentUid: "me" });
  const message = bulkConfirmMessage(plan, "block");
  assert.match(message, /חסימת משתמשים — 1 משתמשים/);
  assert.match(message, /• צופה/);
  assert.match(message, /לא ייכללו \(1\)/);
  assert.match(message, /• אני — החשבון שלך/);
  assert.equal(BULK_MAX_USERS, 100);
});
