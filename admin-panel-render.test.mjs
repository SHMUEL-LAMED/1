// בדיקה התנהגותית של לוח הניהול בדף הנפרד.
//
// updateAdminPanelUI היא מה שנשאר מ-updateAdminUI אחרי שהחלק של המשתמש
// הרגיל עבר ל-session-ui.js. הבדיקות כאן מוודאות ששני הצדדים נשמרו:
// הלוח נפתח למנהל, תוכן מנהל־על נשאר סגור לדרגה 3, ובדף שאין בו לוח
// (כלומר דף הגלריה) הפונקציה יוצאת בשקט במקום ליפול.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function makeElement(id) {
    const classes = new Set();
    const element = {
        id,
        _text: "",
        innerHTML: "",
        classes,
        className: "",
        dataset: {},
        style: {},
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
        replaceChildren() { this.innerHTML = ""; },
        appendChild() {}, append() {}, setAttribute() {}, removeAttribute() {},
        addEventListener() {}, focus() {}, closest: () => null,
        querySelector: () => null,
        querySelectorAll: selector => element._children(selector)
    };
    element._children = () => [];
    Object.defineProperty(element, "textContent", {
        get() { return element._text; }, set(value) { element._text = String(value); }
    });
    Object.defineProperty(element, "innerText", {
        get() { return element._text; }, set(value) { element._text = String(value); }
    });
    return element;
}

// האלמנטים נבנים מהמזהים שקיימים בפועל ב-admin.html, כדי שהבדיקה לא
// תאשר לוח שהקוד מצייר אבל הדף אינו מכיל.
const adminHtml = readFileSync(new URL("./admin.html", import.meta.url), "utf8");
const PANEL_IDS = [
    "sidebarAdminPanel", "superAdminChatsCard", "superAdminUsersCard",
    "superAdminDeletionRequestsCard", "rejectPendingBtn",
    "adminCurrentUserName", "adminCurrentUserEmail", "adminCurrentUserGrade",
    "adminCurrentUserPhoto", "adminCurrentUserFallback"
];
for (const id of PANEL_IDS) {
    assert.ok(adminHtml.includes(`id="${id}"`), `${id} חסר ב-admin.html`);
}

const elements = new Map(PANEL_IDS.map(id => [id, makeElement(id)]));
const superAdminOnly = [makeElement("superOnlyA"), makeElement("superOnlyB")];
elements.get("sidebarAdminPanel")._children = selector =>
    (selector === ".super-admin-only" ? superAdminOnly : []);

const rendered = [];
globalThis.document = {
    body: makeElement("body"),
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    createElement: () => makeElement(""),
    addEventListener() {}
};
globalThis.window = {
    state: {},
    safeImageUrl: value => (/^https:\/\//i.test(String(value ?? "")) ? String(value) : ""),
    safeRecordId: value => String(value ?? ""),
    escapeHtml: value => String(value ?? ""),
    scheduleIconRefresh() {},
    showNotification() {},
    setTimeout: () => 0,
    checkAdminPermission: () => true,
    checkSuperAdminPermission: () => true,
    canViewAdminData: () => Boolean(globalThis.window.state.isAdminLoggedIn),
    canViewSuperAdminData: () => Boolean(globalThis.window.state.isSuperAdmin)
};

await import("./admin.js");

// הריגול מותקן רק אחרי הייבוא: admin.js מגדיר בעצמו את שש הפונקציות
// האלה על window, ולכן סטאב שנכתב לפניו היה נדרס ברגע הטעינה.
const RENDERERS = {
    renderPendingImages: "pendingImages",
    updatePendingBadge: "pendingBadge",
    renderPendingUsers: "pendingUsers",
    updatePendingUsersBadge: "pendingUsersBadge",
    renderManagedUsers: "managedUsers",
    renderDeletionRequests: "deletionRequests"
};
for (const [name, label] of Object.entries(RENDERERS)) {
    assert.equal(typeof window[name], "function", `${name} אמורה להיות מוגדרת ב-admin.js`);
    window[name] = () => rendered.push(label);
}

function render(state) {
    // איפוס מלא בין תרחישים: ערך שנשאר מהתרחיש הקודם היה מסתיר בדיוק את
    // מה שהבדיקה מחפשת — שדה ניהולי שלא נכתב בכלל.
    elements.forEach(element => {
        element.classes.clear();
        element.textContent = "";
    });
    superAdminOnly.forEach(element => element.classes.clear());
    rendered.length = 0;
    window.state = state;
    window.updateAdminPanelUI();
}

const hidden = id => elements.get(id).classList.contains("hidden");

test("מנהל דרגה 3 מקבל לוח פתוח בלי תוכן מנהל־על", () => {
    render({
        isAdminLoggedIn: true,
        isSuperAdmin: false,
        currentUser: { displayName: "מנהל", email: "admin@example.com" }
    });

    assert.ok(!hidden("sidebarAdminPanel"), "הלוח חייב להיפתח למנהל");
    assert.equal(elements.get("adminCurrentUserName").textContent, "מנהל");
    assert.equal(elements.get("adminCurrentUserGrade").textContent, "דרגה 3 — מנהל");
    assert.equal(elements.get("rejectPendingBtn").textContent, "בקש מחיקה");

    assert.ok(hidden("superAdminUsersCard"), "ניהול משתמשים שמור למנהל־על");
    assert.ok(hidden("superAdminChatsCard"));
    assert.ok(hidden("superAdminDeletionRequestsCard"));
    superAdminOnly.forEach(element =>
        assert.ok(element.classList.contains("hidden"), "רכיבי מנהל־על חייבים להישאר סגורים"));
});

test("מנהל־על מקבל גם את הכרטיסים השמורים לו", () => {
    render({
        isAdminLoggedIn: true,
        isSuperAdmin: true,
        currentUser: { displayName: "מנהל־על", email: "super@example.com" }
    });

    assert.equal(elements.get("adminCurrentUserGrade").textContent, "דרגה 4 — מנהל־על");
    assert.equal(elements.get("rejectPendingBtn").textContent, "מחק לצמיתות");
    assert.ok(!hidden("superAdminUsersCard"));
    assert.ok(!hidden("superAdminChatsCard"));
    assert.ok(!hidden("superAdminDeletionRequestsCard"));
    superAdminOnly.forEach(element =>
        assert.ok(!element.classList.contains("hidden"), "רכיבי מנהל־על נפתחים לדרגה 4"));
});

test("מי שאינו מנהל אינו מקבל לוח, ושום נתון ניהולי אינו מצויר", () => {
    render({ isAdminLoggedIn: false, isSuperAdmin: false, currentUser: { displayName: "צופה" } });

    assert.ok(hidden("sidebarAdminPanel"), "הלוח חייב להישאר סגור");
    assert.deepEqual(rendered, [], "אסור לצייר נתוני ניהול למי שאינו מנהל");
    assert.equal(elements.get("adminCurrentUserGrade").textContent, "");
    assert.equal(elements.get("adminCurrentUserName").textContent, "", "גם כרטיס הזהות הניהולי אינו נכתב");
});

test("הלוח מצייר את כל שש הרשימות אחרי שנפתח", () => {
    render({ isAdminLoggedIn: true, isSuperAdmin: true, currentUser: { displayName: "מנהל־על" } });

    assert.deepEqual(rendered.sort(), [
        "deletionRequests", "managedUsers", "pendingBadge",
        "pendingImages", "pendingUsers", "pendingUsersBadge"
    ]);
});

test("בדף שאין בו לוח ניהול הפונקציה יוצאת בשקט", () => {
    // זהו בדיוק דף הגלריה: admin.js אינו נטען שם, אבל גם אם ייטען
    // בטעות הוא לא ייפול על markup חסר.
    const panel = elements.get("sidebarAdminPanel");
    elements.delete("sidebarAdminPanel");
    try {
        assert.doesNotThrow(() => {
            window.state = { isAdminLoggedIn: true, isSuperAdmin: true, currentUser: {} };
            window.updateAdminPanelUI();
        });
    } finally {
        elements.set("sidebarAdminPanel", panel);
    }
});
