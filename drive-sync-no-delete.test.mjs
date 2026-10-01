import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// בעל הדרייב שממנו מסנכרנים עלול למחוק בו קבצים. מחיקה כזו לא אמורה
// להימחק גם מהאתר — הסנכרון מוסיף ומעדכן בלבד.

const driveSync = readFileSync(new URL("./drive-sync.js", import.meta.url), "utf8");
const code = driveSync.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("סנכרון Drive לא מוחק תמונות או תיקיות מהאתר", () => {
  assert.doesNotMatch(code, /deleteImageCloud/, "drive-sync.js לא אמור למחוק תמונות");
  assert.doesNotMatch(code, /deleteFolderCloud/, "drive-sync.js לא אמור למחוק תיקיות");
  assert.doesNotMatch(code, /reconcileDriveMirror/, "ניקוי המחיקות מול Drive הוסר");
});

test("פריטים שנעלמו מ־Drive נספרים כשמורים ולא נמחקים", () => {
  const start = code.indexOf("function countDriveItemsMissingFromDrive(");
  assert.ok(start >= 0);
  const body = code.slice(start, code.indexOf("\n}\n", start) + 3);
  const countMissing = new Function("window", body + "\nreturn countDriveItemsMissingFromDrive;");
  const window = {
    state: {
      images: [
        { id: "a", syncedFromDrive: true, driveRootFolderId: "root", driveFileId: "f1" },
        { id: "b", syncedFromDrive: true, driveRootFolderId: "root", driveFileId: "gone" },
        { id: "c", driveFileId: "gone" }
      ],
      folders: [
        { id: "x", syncedFromDrive: true, driveRootFolderId: "root", driveFolderId: "goneFolder" }
      ]
    }
  };
  const result = countMissing(window)("root", new Set(["f1"]), new Set(["root"]));
  assert.deepEqual(result, { keptImages: 1, keptFolders: 1 });
  assert.equal(window.state.images.length, 3);
  assert.equal(window.state.folders.length, 1);
});
