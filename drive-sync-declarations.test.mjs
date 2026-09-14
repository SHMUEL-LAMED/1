import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// פיצול הקבצים העביר את שכבת ההתחברות ל-session-auth.js, ובדרך אבדו
// ההצהרות של מצב חיבור ה-Drive. drive-sync.js המשיך לקרוא ולכתוב לשמות
// שכבר לא היו מוגדרים בשום מקום. מודול ES רץ תמיד במצב strict, ולכן כל
// גישה כזו זרקה "driveAccessToken is not defined" והפילה את דף הניהול.

const driveSync = readFileSync(new URL("./drive-sync.js", import.meta.url), "utf8");

function withoutComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const code = withoutComments(driveSync);

// המשתנים שמחזיקים את מצב חיבור ה-Drive לאורך חיי הדף.
const MODULE_STATE = [
  "driveAccessToken",
  "driveAccessTokenExpiresAt",
  "driveRestorePromise",
  "driveRestoredForUid",
  "DRIVE_WORKER_BASE_URL"
];

test("כל משתני מצב ה-Drive מוצהרים במודול שמשתמש בהם", () => {
  for (const name of MODULE_STATE) {
    const declared = new RegExp(`^\\s*(let|const|var)\\s+${name}\\b`, "m").test(code);
    const imported = new RegExp(`^import[^;]*\\b${name}\\b[^;]*;`, "m").test(code);
    assert.ok(
      declared || imported,
      `${name} בשימוש בלי הצהרה ובלי ייבוא — במצב strict זו ReferenceError`
    );
  }
});
