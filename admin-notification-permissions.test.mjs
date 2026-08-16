import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// הבדיקות כאן שומרות על הכלל שכל מידע ניהולי — בקשות הצטרפות, תמונות
// שממתינות לאישור, בקשות מחיקה, סל המחזור, יומן הפעולות ומרכז ההודעות —
// לעולם אינו נכתב ל-DOM של מי שאינו מורשה לראותו.
//
// כל תרחיש מזריק ל-window.state נתונים ניהוליים מלאים, גם כשהתפקיד אינו
// אמור לקבל אותם. כך נבדק מה שבאמת חשוב: גם אם נתון הגיע בטעות למצב
// המשותף, פונקציית הציור אינה מפרסמת אותו.

let moduleCounter = 0;

// אלמנט מדומה. innerText ו-textContent חולקים ערך אחד, כמו בדפדפן, משום
// שקוד האתר משתמש בשניהם לסירוגין על אותו מונה.
function makeElement(id) {
  const classes = new Set();
  const element = {
    id,
    _text: "",
    innerHTML: "",
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    },
    dataset: {},
    style: {},
    replaceChildren() { this.innerHTML = ""; },
    appendChild() {}, append() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  Object.defineProperty(element, "textContent", {
    get() { return element._text; },
    set(value) { element._text = String(value); }
  });
  Object.defineProperty(element, "innerText", {
    get() { return element._text; },
    set(value) { element._text = String(value); }
  });
  return element;
}

const ROLES = {
  guest:      { isGoogleUser: false, isAdminLoggedIn: false, isSuperAdmin: false, userRole: "guest",       userApprovalStatus: "signed_out" },
  viewer:     { isGoogleUser: true,  isAdminLoggedIn: false, isSuperAdmin: false, userRole: "viewer",      userApprovalStatus: "approved" },
  uploader:   { isGoogleUser: true,  isAdminLoggedIn: false, isSuperAdmin: false, userRole: "uploader",    userApprovalStatus: "approved" },
  admin:      { isGoogleUser: true,  isAdminLoggedIn: true,  isSuperAdmin: false, userRole: "admin",       userApprovalStatus: "approved" },
  superAdmin: { isGoogleUser: true,  isAdminLoggedIn: true,  isSuperAdmin: true,  userRole: "super_admin", userApprovalStatus: "approved" }
};

// נתונים ניהוליים "דלופים" למצב המשותף, בכוונה, בכל תרחיש.
function adminData() {
  return {
    pendingImages: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    pendingUsers: [{ uid: "u1", status: "pending" }, { uid: "u2", status: "pending" }],
    deletionRequests: [{ id: "d1" }],
    trashItems: [{ id: "t1" }, { id: "t2" }],
    activityLogs: [{ id: "l1", action: "approved_user" }],
    allUsers: [
      { uid: "u1", displayName: "משתמש", status: "approved", messages: [{ direction: "user_to_admin", text: "שלום", sentAt: 1 }] }
    ],
    images: [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }],
    folders: [{ id: "all" }, { id: "1" }, { id: "2" }]
  };
}

async function load(roleName) {
  const elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement: tag => makeElement(tag),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  const notifications = [];
  globalThis.window = {
    state: { ...ROLES[roleName], ...adminData() },
    showNotification: message => notifications.push(String(message)),
    safeRecordId: value => String(value ?? ""),
    escapeHtml: value => String(value ?? ""),
    formatDate: () => "",
    safeImageUrl: value => String(value ?? ""),
    isVideoRecord: () => false,
    formatBytes: () => "",
    safeIconName: value => String(value ?? "folder"),
    scheduleIconRefresh() {},
    // אותה הגדרה בדיוק כמו ב-app.js. הבדיקה שלמטה מוודאת שהיא עדיין
    // קיימת שם, כדי שהעתק הזה לא יתיישן בשקט.
    canViewAdminData: () => Boolean(globalThis.window.state?.isAdminLoggedIn),
    canViewSuperAdminData: () => Boolean(globalThis.window.state?.isSuperAdmin),
    clearAdminOutput: (id, emptyValue = "") => {
      const element = globalThis.document.getElementById(id);
      if (element) element.textContent = emptyValue;
      return element;
    }
  };

  moduleCounter += 1;
  await import(`./admin.js?perm=${moduleCounter}`);
  await import(`./chat.js?perm=${moduleCounter}`);
  return { win: globalThis.window, text: id => globalThis.document.getElementById(id).textContent, notifications };
}

// מוני הניהול שמשתמש רגיל לא אמור לראות בשום מצב. סל המחזור ויומן
// הפעולות יושבים ב-app.js ונבדקים בנפרד, בבדיקה על המקור.
const ADMIN_COUNTERS = [
  "pendingCountBadge", "pendingUsersCountBadge", "deletionRequestsCountBadge",
  "adminOverviewUsersCount", "adminOverviewPendingCount",
  "adminOverviewImagesCount", "adminOverviewFoldersCount"
];

function renderEverything(win) {
  win.updatePendingBadge();
  win.updatePendingUsersBadge();
  win.updateAdminOverview();
  win.renderPendingImages();
  win.renderPendingUsers();
  win.renderManagedUsers();
  win.renderDeletionRequests();
  win.renderAdminMessageReplies();
  win.renderAdminMessageUsers();
}

for (const roleName of ["guest", "viewer", "uploader"]) {
  test(`משתמש בתפקיד ${roleName} אינו מקבל שום מונה ניהולי`, async () => {
    const { win, text } = await load(roleName);
    renderEverything(win);

    for (const id of ADMIN_COUNTERS) {
      assert.equal(text(id), "0", `${id} נכתב עבור ${roleName} למרות שאינו מורשה`);
    }
    assert.equal(text("adminMessageRepliesCount"), "", "מרכז ההודעות המנהלי נחשף");
    assert.equal(text("adminChatsUnreadBadge"), "0", "מונה שיחות המנהל נחשף");
    assert.equal(text("adminMessagesUnreadStat"), "0");
  });

  test(`משתמש בתפקיד ${roleName} אינו מקבל רשימות ניהוליות`, async () => {
    const { win } = await load(roleName);
    renderEverything(win);
    const doc = globalThis.document;
    for (const id of ["pendingList", "pendingUsersList", "managedUsersList",
                      "deletionRequestsList", "adminMessageRepliesList", "adminMessageUsersList"]) {
      assert.equal(doc.getElementById(id).innerHTML, "", `${id} מולא עבור ${roleName}`);
    }
  });

  test(`ציור ההתראות אינו מציף את ${roleName} בהודעות שגיאה`, async () => {
    // guard שמשתמש ב-checkAdminPermission היה מפעיל טוסט בכל ציור.
    const { win, notifications } = await load(roleName);
    renderEverything(win);
    assert.deepEqual(notifications, [], "ציור התראות הפעיל הודעה למשתמש רגיל");
  });
}

test("מנהל דרגה 3 מקבל את מוני התוכן, אך לא נתוני מנהל־על", async () => {
  const { win, text } = await load("admin");
  renderEverything(win);

  assert.equal(text("pendingCountBadge"), "3", "מנהל דרגה 3 אמור לראות תמונות לאישור");
  assert.equal(text("adminOverviewPendingCount"), "3");
  assert.equal(text("adminOverviewImagesCount"), "4");
  assert.equal(text("adminOverviewFoldersCount"), "2", "התיקייה 'all' אינה נספרת");

  // אלה שמורים למנהל־על בלבד.
  assert.equal(text("adminOverviewUsersCount"), "0", "בקשות הצטרפות אינן לדרגה 3");
  assert.equal(text("pendingUsersCountBadge"), "0");
  assert.equal(text("deletionRequestsCountBadge"), "0");
  assert.equal(text("adminChatsUnreadBadge"), "0");
  assert.equal(globalThis.document.getElementById("managedUsersList").innerHTML, "");
});

test("מנהל־על מקבל את כל המונים", async () => {
  const { win, text } = await load("superAdmin");
  renderEverything(win);

  assert.equal(text("pendingCountBadge"), "3");
  assert.equal(text("pendingUsersCountBadge"), "2");
  assert.equal(text("deletionRequestsCountBadge"), "1");
  assert.equal(text("adminOverviewUsersCount"), "2");
  assert.equal(text("adminOverviewPendingCount"), "3");
});

test("סל המחזור ויומן הפעולות שמורים למנהל־על", async () => {
  // renderTrashItems ו-renderActivityLogs יושבות ב-app.js, שאינו ניתן
  // לייבוא כאן; נבדק שהן נושאות את אותו guard בדיוק.
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  for (const fn of ["window.renderTrashItems", "window.renderActivityLogs"]) {
    const start = source.indexOf(`${fn} = function`);
    assert.ok(start > 0, `${fn} לא נמצאה ב-app.js`);
    const head = source.slice(start, start + 420);
    assert.match(head, /canViewSuperAdminData\(\)/, `${fn} חסרה בדיקת מנהל־על`);
  }
});

test("app.js עדיין חושף את בדיקות ההרשאה השקטות", async () => {
  // הבדיקות למעלה משכפלות את ההגדרה; אם היא תוסר מ-app.js הן יהפכו
  // לבדיקה של עצמן בלבד, ולכן קיומה נבדק במפורש.
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(source, /window\.canViewAdminData\s*=\s*canViewAdminData/);
  assert.match(source, /window\.canViewSuperAdminData\s*=\s*canViewSuperAdminData/);
  assert.match(source, /function canViewAdminData\(\)\s*\{\s*return Boolean\(window\.state\?\.isAdminLoggedIn\)/);
  assert.match(source, /function canViewSuperAdminData\(\)\s*\{\s*return Boolean\(window\.state\?\.isSuperAdmin\)/);
});
