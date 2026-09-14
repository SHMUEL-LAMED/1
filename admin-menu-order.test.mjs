import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// עד השכתוב היו שלושה מקורות שהיו חייבים להסכים ביניהם: כרטיסי הלוח
// ב-admin.html, נושאי הניהול ורשימת המשימות שמזינה את החיפוש. כשהסדר שלהם
// נפרד — כל פעולה נראתה תקועה במקום אחר, ואותו תוכן הופיע בשני מקומות.
//
// עכשיו יש מקור אחד: ADMIN_VIEWS שב-admin-ui.js. הוא מזין את התפריט, את
// החיפוש ואת סדר המסכים, ולכל מסך יש section אחד ויחיד ב-admin.html.
// הבדיקות כאן נועלות בדיוק את זה.

const html = readFileSync(new URL("./admin.html", import.meta.url), "utf8");
const adminUiJs = readFileSync(new URL("./admin-ui.js", import.meta.url), "utf8");

function viewRegistryBlock() {
  const start = adminUiJs.indexOf("const ADMIN_VIEWS = [");
  const end = adminUiJs.indexOf("const VIEW_GROUPS");
  assert.ok(start > -1 && end > start, "ADMIN_VIEWS לא נמצאה ב-admin-ui.js");
  return adminUiJs.slice(start, end);
}

function registeredViews() {
  return [...viewRegistryBlock().matchAll(/^\s{8}id: '([\w-]+)',\n\s{8}group: '([^']+)'/gm)]
    .map(match => ({ id: match[1], group: match[2] }));
}

const CANONICAL_VIEW_ORDER = [
  "dashboard",
  "pending",
  "drive",
  "folders",
  "deletions",
  "trash",
  "users",
  "messages",
  "popup",
  "activity",
  "analytics",
  "backup",
  "health",
  "faceindex",
  "tools"
];

test("רשימת המסכים היא המקור היחיד, והסדר שלה קבוע", () => {
  assert.deepEqual(registeredViews().map(view => view.id), CANONICAL_VIEW_ORDER);
});

test("לכל מסך ברשימה יש section אחד בדיוק בדף הניהול", () => {
  for (const view of registeredViews()) {
    const occurrences = html.split(`data-view="${view.id}"`).length - 1;
    assert.equal(
      occurrences,
      1,
      `המסך ${view.id} מופיע ${occurrences} פעמים ב-admin.html — חייב להופיע בדיוק פעם אחת`
    );
    assert.ok(html.includes(`id="view-${view.id}"`), `החלק view-${view.id} חסר ב-admin.html`);
  }
});

test("אין ב-admin.html מסך שאינו מופיע ברשימת המסכים", () => {
  const inHtml = [...html.matchAll(/data-view="([\w-]+)"/g)].map(match => match[1]);
  const known = new Set(registeredViews().map(view => view.id));
  for (const id of inHtml) {
    assert.ok(known.has(id), `המסך ${id} קיים ב-admin.html אך אינו רשום ב-ADMIN_VIEWS`);
  }
});

test("המסכים מקובצים לפי הקבוצות המוכרות, והקבוצות אינן מתערבבות", () => {
  const groups = registeredViews().map(view => view.group);
  const declared = [...adminUiJs.matchAll(/const VIEW_GROUPS = \[([^\]]+)\]/g)][0];
  assert.ok(declared, "VIEW_GROUPS לא נמצאה");
  const order = [...declared[1].matchAll(/'([^']+)'/g)].map(match => match[1]);

  for (const group of groups) {
    assert.ok(order.includes(group), `הקבוצה ${group} אינה מוכרת ב-VIEW_GROUPS`);
  }
  // קבוצה שנפתחת, נסגרת ונפתחת שוב הייתה מפזרת את אותו נושא בשני מקומות בתפריט.
  const seen = [];
  let previous = "";
  for (const group of groups) {
    if (group === previous) continue;
    assert.ok(!seen.includes(group), `הקבוצה ${group} מופיעה פעמיים ברשימה`);
    seen.push(group);
    previous = group;
  }
  assert.deepEqual(seen, order);
});

test("מסכים של מנהל־על מסומנים ככאלה גם ברשימה וגם במרקאפ", () => {
  const block = viewRegistryBlock();
  for (const id of ["deletions", "trash", "users", "messages", "popup", "activity", "analytics", "backup"]) {
    const entry = block.slice(block.indexOf(`id: '${id}'`), block.indexOf(`id: '${id}'`) + 700);
    assert.match(entry, /superAdminOnly: true/, `המסך ${id} חייב להיות מסומן כמסך מנהל־על`);
  }

  // והצד השני: המרקאפ עצמו חייב להיות מסומן, אחרת מנהל דרגה 3 היה רואה
  // את הכרטיס (ריק) עד שהקוד היה מסתיר אותו.
  for (const id of ["deletions", "trash", "users", "messages", "popup", "activity", "analytics", "backup"]) {
    const start = html.indexOf(`id="view-${id}"`);
    const section = html.slice(start, html.indexOf("</section>", start));
    assert.match(section, /super-admin-only/, `המרקאפ של ${id} חייב לשאת super-admin-only`);
  }
});

test("שמות המסכים הישנים ממשיכים להוביל למסך הנכון", () => {
  // openAdminTaskWindow('accPending') נקראת עדיין מקוד קיים, ולכן היא חייבת
  // להמשיך לעבוד — אך בלי לפתוח חלון נפרד שמכפיל את התוכן.
  const map = adminUiJs.slice(adminUiJs.indexOf("const LEGACY_TASK_TO_VIEW"), adminUiJs.indexOf("window.openAdminTaskWindow"));
  const known = new Set(registeredViews().map(view => view.id));
  const pairs = [...map.matchAll(/(acc\w+): '([\w-]+)'/g)];
  assert.ok(pairs.length >= 10, "מיפוי השמות הישנים לא נקרא כראוי");
  for (const [, legacy, viewId] of pairs) {
    assert.ok(known.has(viewId), `${legacy} מפנה למסך ${viewId} שאינו קיים`);
  }
});
