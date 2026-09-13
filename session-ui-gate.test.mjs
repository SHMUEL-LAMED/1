// בדיקה התנהגותית של שכבת הסשן, בלי מודול הניהול כלל.
//
// זה המצב של דף הגלריה אחרי ההפרדה: admin.js אינו נטען, ואין בדף לא לוח
// ניהול ולא #sidebarLockStatus. הגרסה הקודמת יצאה בדיוק כאן מ-updateAdminUI
// והשאירה את שער הגישה, נעילת הגלריה וסטטוס הכותרת בלי עדכון.
import test from "node:test";
import assert from "node:assert/strict";

function createElement(id = "") {
    const classes = new Set();
    return {
        id,
        dataset: {},
        textContent: "",
        innerText: "",
        classes,
        className: "",
        removeAttribute() {},
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
            toggle: (name, force) => {
                const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
                if (shouldAdd) classes.add(name);
                else classes.delete(name);
                return shouldAdd;
            }
        }
    };
}

// רק האלמנטים שדף הגלריה באמת מכיל. מרקאפ הניהול נעדר בכוונה.
const GALLERY_ELEMENT_IDS = [
    "galleryAccessGate", "galleryAccessGateChip", "galleryAccessGateTitle", "galleryAccessGateText",
    "headerConnectionStatus", "googleSignedOutView", "googleSignedInView",
    "googleUserName", "googleUserEmail", "googleUserRoleBadge", "googleUserApprovalText",
    "floatingSignedOutView", "floatingSignedInView", "floatingUserPanelName",
    "floatingUserPanelEmail", "floatingUserPanelBadge",
    "userUploadAccessCard", "userUploadAccessTitle", "userUploadAccessText",
    "userUploadModeText", "userUploadSubmitBtn", "userActionArea"
];

const elements = new Map(GALLERY_ELEMENT_IDS.map(id => [id, createElement(id)]));
const body = createElement("body");

globalThis.document = {
    body,
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    createElement: () => createElement(),
    addEventListener() {}
};
globalThis.window = {
    state: {},
    safeImageUrl: value => (/^https:\/\//i.test(String(value ?? "")) ? String(value) : ""),
    scheduleIconRefresh() {}
};

await import("./session-ui.js");

function render(state) {
    window.state = state;
    elements.forEach(element => element.classes.clear());
    body.classes.clear();
    window.updateSessionUI();
}

const el = id => elements.get(id);

test("אורח שאינו מחובר רואה את שער הגישה, והגלריה נעולה", () => {
    render({ isGoogleUser: false, currentUser: null, userApprovalStatus: "signed_out", userRole: "guest" });

    assert.ok(body.classList.contains("gallery-locked"), "הגלריה חייבת להיות נעולה לאורח");
    assert.ok(!el("galleryAccessGate").classList.contains("hidden"), "שער הגישה חייב להיות מוצג");
    assert.equal(el("galleryAccessGate").dataset.gateState, "signed-out");
    assert.equal(el("galleryAccessGateTitle").textContent, "התחבר כדי לצפות בגלריה");
    assert.equal(el("headerConnectionStatus").textContent, "נדרשת הרשאה");
});

test("משתמש שממתין לאישור מקבל את מסך ההמתנה ולא את מסך ההתחברות", () => {
    render({
        isGoogleUser: true,
        currentUser: { displayName: "דוד", email: "david@example.com" },
        userApprovalStatus: "pending",
        userRole: "viewer"
    });

    assert.ok(body.classList.contains("gallery-locked"));
    assert.equal(el("galleryAccessGate").dataset.gateState, "pending");
    assert.equal(el("galleryAccessGateChip").textContent, "ממתין לאישור מנהל");
    assert.equal(el("floatingUserPanelName").textContent, "דוד");
    assert.equal(el("floatingUserPanelBadge").textContent, "ממתין לאישור מנהל");
});

test("חשבון חסום מקבל הסבר ברור", () => {
    render({
        isGoogleUser: true,
        currentUser: { displayName: "רות", email: "ruth@example.com" },
        userApprovalStatus: "blocked",
        userRole: "viewer"
    });

    assert.equal(el("galleryAccessGate").dataset.gateState, "blocked");
    assert.equal(el("galleryAccessGateTitle").textContent, "החשבון חסום");
    assert.equal(el("googleUserApprovalText").textContent, "הגישה לחשבון נחסמה על ידי מנהל־העל.");
});

test("צופה מאושר מקבל גלריה פתוחה וכרטיס שליחה לאישור", () => {
    render({
        isGoogleUser: true,
        currentUser: { displayName: "שרה", email: "sara@example.com" },
        userApprovalStatus: "approved",
        userRole: "viewer"
    });

    assert.ok(!body.classList.contains("gallery-locked"), "משתמש מאושר אינו אמור לראות גלריה נעולה");
    assert.ok(el("galleryAccessGate").classList.contains("hidden"));
    assert.equal(el("headerConnectionStatus").textContent, "גישה מאושרת");
    assert.ok(!el("userUploadAccessCard").classList.contains("hidden"));
    assert.equal(el("userUploadSubmitBtn").textContent, "שלח לאישור");
    assert.equal(el("userUploadAccessTitle").textContent, "שליחת תמונות לאישור");
});

test("דרגה 2 מעלה ישירות, והניסוח משתנה בהתאם", () => {
    render({
        isGoogleUser: true,
        currentUser: { displayName: "יוסי", email: "yossi@example.com" },
        userApprovalStatus: "approved",
        userRole: "uploader"
    });

    assert.equal(el("userUploadSubmitBtn").textContent, "העלה לגלריה");
    assert.equal(el("userUploadAccessTitle").textContent, "העלאה ישירה לגלריה");
    assert.equal(el("googleUserRoleBadge").textContent, "דרגה 2 — מעלה תמונות");
});

test("מנהל שנכנס לגלריה מקבל גישה, ובלי שמודול הניהול נטען", () => {
    render({
        isGoogleUser: true,
        isAdminLoggedIn: true,
        currentUser: { displayName: "מנהל", email: "admin@example.com" },
        userApprovalStatus: "approved",
        userRole: "admin"
    });

    assert.ok(!body.classList.contains("gallery-locked"));
    assert.equal(el("headerConnectionStatus").textContent, "גישה מאושרת");
    // updateAdminPanelUI כלל אינה מוגדרת כאן — זה בדיוק דף הגלריה.
    assert.equal(typeof window.updateAdminPanelUI, "undefined");
});

test("השם הישן updateAdminUI ממשיך לעבוד עבור drive-sync", () => {
    assert.equal(window.updateAdminUI, window.updateSessionUI);
});

test("אין קריסה כשחסרים אלמנטים של האזור האישי", () => {
    // דף הניהול, למשל, אינו מכיל את שער הגישה ואת כרטיס ההעלאה.
    const saved = new Map(elements);
    elements.clear();
    try {
        assert.doesNotThrow(() => render({ isGoogleUser: false, currentUser: null, userApprovalStatus: "signed_out" }));
    } finally {
        saved.forEach((value, key) => elements.set(key, value));
    }
});
