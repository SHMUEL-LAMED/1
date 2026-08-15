import test from "node:test";
import assert from "node:assert/strict";

// הבדיקות כאן שומרות על ההבטחה של הפופ-אפ: מנהל שבחר להפנות אל כלי באתר —
// חיפוש פנים, חיפוש AI, העלאה, מועדפים, צ׳אט או פרופיל — הלחיצה תפתח בדיוק
// את הכלי הזה, והפופ-אפ ייסגר לפניו כדי שלא יסתיר אותו.

let moduleCounter = 0;

// DOM מינימלי: מספיק כדי שהמודול ייטען ושמסלול הלחיצה ירוץ בלי דפדפן.
async function loadAdmin(state = {}) {
  globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null
  };
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
  const opened = [];
  globalThis.window = {
    state: { folders: [], popupAnnouncementConfig: null, ...state },
    showNotification: (message, ok) => opened.push({ notification: message, ok }),
    openFaceSearchModal: () => opened.push('faceSearch'),
    openAiImageSearchModal: () => opened.push('aiSearch'),
    openModal: id => opened.push(`modal:${id}`),
    openFavoritesFromProfile: () => opened.push('favorites'),
    openUserConversation: () => opened.push('contactManager'),
    openFloatingProfile: () => opened.push('profile'),
    setActiveFolder: id => opened.push(`folder:${id}`),
    renderImages: () => opened.push('renderImages'),
    closePopupAnnouncement: null
  };

  moduleCounter += 1;
  const admin = await import(`./popup-announcement.js?case=${moduleCounter}`);
  return { admin, opened, win: globalThis.window };
}

function clickWith(config, { admin, opened, win }) {
  win.state.popupAnnouncementConfig = config;
  win.handlePopupAnnouncementClick();
  return opened;
}

test("הפופ-אפ מציע שישה כלים באתר, כל אחד עם מזהה ותווית משלו", async () => {
  const { admin } = await loadAdmin();
  const ids = admin.POPUP_FEATURE_TARGETS.map(feature => feature.id);

  assert.deepEqual(ids, [
    "faceSearch",
    "aiSearch",
    "upload",
    "favorites",
    "contactManager",
    "profile"
  ]);
  assert.equal(new Set(ids).size, ids.length, "מזהה כפול היה גורם לשמירה של יעד שגוי");
  for (const feature of admin.POPUP_FEATURE_TARGETS) {
    assert.ok(feature.label, `לכלי ${feature.id} חסרה תווית לתצוגה`);
    assert.ok(feature.icon, `לכלי ${feature.id} חסר אייקון`);
    assert.equal(typeof feature.run, "function");
  }
});

test("כל כלי פותח בדיוק את נקודת הכניסה שלו באתר", async () => {
  const expected = {
    faceSearch: "faceSearch",
    aiSearch: "aiSearch",
    upload: "modal:userUploadModal",
    favorites: "favorites",
    contactManager: "contactManager",
    profile: "profile"
  };

  for (const [featureId, marker] of Object.entries(expected)) {
    const context = await loadAdmin({ userApprovalStatus: "approved" });
    const opened = clickWith({ linkType: "feature", featureId }, context);
    assert.deepEqual(opened, [marker], `הפנייה אל ${featureId} פתחה משהו אחר`);
  }
});

test("מזהה כלי שאינו קיים אינו פותח דבר ומודיע למשתמש", async () => {
  const context = await loadAdmin();
  const opened = clickWith({ linkType: "feature", featureId: "somethingElse" }, context);

  assert.equal(opened.length, 1);
  assert.equal(opened[0].ok, false);
});

test("העלאת מדיה נחסמת למי שאינו מאושר, במקום לפתוח חלון שייכשל", async () => {
  const context = await loadAdmin({ userApprovalStatus: "pending" });
  const opened = clickWith({ linkType: "feature", featureId: "upload" }, context);

  assert.equal(opened.length, 1);
  assert.equal(opened[0].ok, false);
  assert.ok(!opened.includes("modal:userUploadModal"));
});

test("הפניות התיקייה והעדכונים האחרונים ממשיכות לעבוד כשהיו", async () => {
  const folderContext = await loadAdmin();
  assert.deepEqual(
    clickWith({ linkType: "folder", folderId: "3" }, folderContext),
    ["folder:3"]
  );

  const latestContext = await loadAdmin();
  assert.deepEqual(
    clickWith({ linkType: "latest" }, latestContext),
    ["folder:all", "renderImages"]
  );
  assert.equal(latestContext.win.state.gallerySort, "newest");

  const noneContext = await loadAdmin();
  assert.deepEqual(clickWith({ linkType: "none" }, noneContext), []);
});

test("כפתור הפעולה בפופ-אפ מתאר את היעד שנבחר", async () => {
  const { admin } = await loadAdmin();
  const folders = [{ id: "3", name: "הווי ומפגשים" }];

  assert.equal(
    admin.popupAnnouncementActionInfo({ linkType: "feature", featureId: "faceSearch" }).label,
    "חיפוש פנים ב־AI"
  );
  assert.equal(
    admin.popupAnnouncementActionInfo({ linkType: "folder", folderId: "3" }, folders).label,
    "למעבר אל הווי ומפגשים"
  );
  assert.equal(admin.popupAnnouncementActionInfo({ linkType: "latest" }).icon, "sparkles");
  assert.equal(admin.popupAnnouncementActionInfo({ linkType: "none" }), null);
  // הודעה ישנה שנשמרה לפני התוספת אינה מציגה כפתור פעולה ריק.
  assert.equal(admin.popupAnnouncementActionInfo({ linkType: "feature" }), null);
});
