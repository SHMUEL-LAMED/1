import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// תפריט הניהול נשען על שלושה מקורות שחייבים להסכים ביניהם: כרטיסי המגירה
// ב-index.html, נושאי הניהול (adminCategoryDefinitions) ורשימת המשימות
// (adminTaskDefinitions) שמזינה את החיפוש. כשהסדר שלהם נפרד — כל פעולה נראית
// תקועה במקום אחר. הבדיקות כאן נועלות סדר אחד לכל המקורות.

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("./app.js", import.meta.url), "utf8");

// הסדר הקנוני: תוכן הגלריה, אחר כך אנשים ותקשורת, ולבסוף כלי המערכת.
const CANONICAL_TASK_ORDER = [
  "accPending",
  "accDriveSync",
  "accEmptyFolder",
  "accDeletionRequests",
  "accTrash",
  "accUserApprovals",
  "accPopupAnnouncement",
  "accActivityCenter",
  "accSystemHealth",
  "accFaceIndex"
];

function adminDrawerMarkup() {
  const start = html.indexOf('id="sidebarAdminPanel"');
  const end = html.indexOf("lockGalleryImmediatelySidebar");
  assert.ok(start > -1 && end > start, "מגירת הניהול לא נמצאה ב-index.html");
  return html.slice(start, end);
}

function categoryTargets(categoryName) {
  const block = appJs.slice(appJs.indexOf("const adminCategoryDefinitions"), appJs.indexOf("let activeAdminCategoryId"));
  const names = ["gallery", "users", "system"];
  const bounds = names.map(name => ({ name, index: block.indexOf(`\n    ${name}: {`) }));
  bounds.forEach(({ name, index }) => assert.ok(index > -1, `הנושא ${name} חסר בהגדרות`));
  const position = bounds.findIndex(entry => entry.name === categoryName);
  const from = bounds[position].index;
  const to = position + 1 < bounds.length ? bounds[position + 1].index : block.length;
  return [...block.slice(from, to).matchAll(/target: '(acc\w+)'/g)].map(match => match[1]);
}

test("כרטיסי המגירה מסודרים לפי הנושאים, בלי order ידני שסותר את הסדר", () => {
  const drawer = adminDrawerMarkup();

  // order ידני כפול היה מפזר כרטיסים בין הכותרות; הסדר נקבע לפי ה-DOM בלבד.
  assert.equal(/style="order:/.test(drawer), false, "נשאר style=\"order\" במגירת הניהול");

  const labels = [...drawer.matchAll(/admin-section-label[^>]*>([^<]+)</g)].map(match => match[1].trim());
  assert.deepEqual(labels, ["תוכן הגלריה", "תקשורת ואנשים", "כלי מערכת"]);

  const cardsRegion = drawer.slice(drawer.indexOf("תוכן הגלריה"));
  const opened = [...cardsRegion.matchAll(/openAdminTaskWindow\('(\w+)'\)|(openAdminMessagesCenter\(\))/g)]
    .map(match => match[1] || "messages");

  assert.deepEqual(opened, [
    "accPending",
    "accDriveSync",
    "accEmptyFolder",
    "accDeletionRequests",
    "accTrash",
    "accUserApprovals",
    "messages",
    "accPopupAnnouncement",
    "accActivityCenter",
    "accSystemHealth",
    "accFaceIndex"
  ]);
});

test("כל כותרת במגירה מקבצת את הכרטיסים ששייכים לה", () => {
  const drawer = adminDrawerMarkup();
  const [, gallerySection, peopleSection, systemSection] = drawer.split(/<p class="admin-section-label[^>]*>/);
  const targetsIn = section => [...section.matchAll(/openAdminTaskWindow\('(\w+)'\)/g)].map(match => match[1]);

  assert.deepEqual(targetsIn(gallerySection), ["accPending", "accDriveSync", "accEmptyFolder", "accDeletionRequests", "accTrash"]);
  assert.deepEqual(targetsIn(peopleSection), ["accUserApprovals", "accPopupAnnouncement"]);
  assert.deepEqual(targetsIn(systemSection), ["accActivityCenter", "accSystemHealth", "accFaceIndex"]);
});

test("כל משימת ניהול שייכת לנושא אחד בלבד", () => {
  const all = ["gallery", "users", "system"].flatMap(categoryTargets);
  const duplicates = all.filter((target, index) => all.indexOf(target) !== index);

  assert.deepEqual(duplicates, [], `משימה שמופיעה בשני נושאים גורמת לפתיחה מהמקום הלא נכון: ${duplicates.join(", ")}`);
  assert.deepEqual([...all].sort(), [...CANONICAL_TASK_ORDER].sort(), "יש משימה שאינה מגיעה מאף נושא");
});

test("סדר הפעולות בכל נושא זהה לסדר הקנוני", () => {
  const rank = target => CANONICAL_TASK_ORDER.indexOf(target);
  for (const category of ["gallery", "users", "system"]) {
    const targets = categoryTargets(category);
    const sorted = [...targets].sort((a, b) => rank(a) - rank(b));
    assert.deepEqual(targets, sorted, `הפעולות בנושא ${category} אינן בסדר הקנוני`);
  }
});

test("רשימת המשימות שמזינה את החיפוש שומרת על אותו סדר", () => {
  const block = appJs.slice(appJs.indexOf("const adminTaskDefinitions"), appJs.indexOf("let activeAdminTask"));
  const keys = [...block.matchAll(/^ {4}(acc\w+): \{/gm)].map(match => match[1]);

  assert.deepEqual(keys, CANONICAL_TASK_ORDER);
});
