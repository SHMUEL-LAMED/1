// "התמונות שלי" והאלבום של אדם בצד הדפדפן (people.js), מול חיקוי של DOM,
// של מנוע הזיהוי ושל ה-Worker. העיקר כאן הוא הפרטיות: לשרת נשלחת רק טביעה,
// היא נשמרת רק אחרי סימון "זכור אותי", והסלפי אינו יוצא מהדפדפן.
import test from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
function stubElement(id = "") {
  const classes = new Set();
  const attributes = new Map();
  const node = {
    id, textContent: "", value: "", hidden: false, checked: false, disabled: false, tabIndex: 0,
    style: {}, dataset: {}, children: [], className: "",
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => attributes.delete(name),
    append: (...items) => node.children.push(...items),
    replaceChildren: (...items) => { node.children = items; },
    addEventListener() {},
    focus() {},
    scrollIntoView() {},
    querySelector: () => stubElement(),
    querySelectorAll: () => []
  };
  return node;
}
const byId = id => {
  if (!elements.has(id)) elements.set(id, stubElement(id));
  return elements.get(id);
};

globalThis.document = {
  title: "גלריה",
  getElementById: byId,
  createElement: () => stubElement(),
  querySelector: () => null,
  querySelectorAll: () => []
};

const objectUrls = { created: [], revoked: [] };
globalThis.URL.createObjectURL = file => { objectUrls.created.push(file); return "blob:local-selfie"; };
globalThis.URL.revokeObjectURL = url => objectUrls.revoked.push(url);
globalThis.fetch = async url => { throw new Error(`בקשת רשת לא צפויה: ${url}`); };

const calls = [];
const imageLoads = [];
const notifications = [];
let detection = "face";
let profileLoadFails = false;
let searchMatches = [];
let personPayload = null;
// הבטחה שמעכבת את תשובת השרת, כדי לבדוק מה קורה כשמשתמש מתנתק באמצע.
let responseGate = null;

const descriptor = Float32Array.from({ length: 128 }, (_, index) => (index === 0 ? 0.1234567 : 0.08));

globalThis.window = {
  location: { hash: "", pathname: "/1/", search: "" },
  history: { replaceState: (_state, _title, url) => { window.location.hash = String(url).includes("#") ? String(url).slice(String(url).indexOf("#")) : ""; } },
  state: {
    isGoogleUser: true,
    userApprovalStatus: "approved",
    currentUser: { uid: "u1", photoURL: "https://lh3.googleusercontent.com/a/ACg8oc=s96-c" },
    images: [],
    tempSearchResults: null
  },
  FACE_MODEL_VERSION: "faceapi-1.7.15-ssd-l68-r1",
  FACE_MATCH_THRESHOLD: 0.48,
  db: {},
  appId: "app",
  safeRecordId: value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
  safeImageUrl: value => (/^https:\/\//.test(String(value ?? "")) ? String(value) : ""),
  showNotification: (message, ok) => notifications.push({ message, ok }),
  openModal: id => { byId(id).hidden = false; },
  closeModal: id => { byId(id).hidden = true; },
  renderImages() {},
  clearTempSearchFilter() { window.state.tempSearchResults = null; },
  firestoreModules: {
    collection: () => ({}),
    getDocsByIds: async (_reference, ids) => ({ docs: ids.map(id => ({ id, data: () => ({ id, title: `תמונה ${id}` }) })) })
  },
  async ensureFaceSearchModule() {
    window.loadFaceApi = async () => ({
      detectSingleFace: () => ({
        withFaceLandmarks: () => ({
          withFaceDescriptor: async () => (detection === "face" ? { descriptor } : undefined)
        })
      })
    });
    window.loadFaceImageElement = async url => {
      imageLoads.push(url);
      if (profileLoadFails && url.startsWith("https://lh3.")) throw new Error("CORS");
      return { src: url };
    };
  },
  async r2Request(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || "GET", body });
    if (responseGate && (path === "/face/search" || path.startsWith("/face/persons"))) await responseGate;
    if (path === "/face/me" && (options.method || "GET") === "GET") return { success: true, remembered: false, savedAt: 0 };
    if (path === "/face/me") return { success: true, remembered: options.method === "PUT" };
    if (path === "/face/search") return { success: true, matches: searchMatches };
    if (path.startsWith("/face/persons/")) return personPayload;
    throw new Error(`נתיב לא צפוי: ${path}`);
  }
};

await import("./people.js");

function reset() {
  calls.length = 0;
  imageLoads.length = 0;
  notifications.length = 0;
  objectUrls.created.length = 0;
  objectUrls.revoked.length = 0;
  elements.clear();
  detection = "face";
  profileLoadFails = false;
  searchMatches = [
    { imageId: "img-2", distance: 0.2 },
    { imageId: "img-1", distance: 0.3 },
    { imageId: "img-far", distance: 0.6 }
  ];
  window.state.tempSearchResults = null;
  window.state.userApprovalStatus = "approved";
  window.location.hash = "";
  responseGate = null;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
test.beforeEach(reset);

test("מצא אותי לפי תמונת הפרופיל: רק טביעה נשלחת, ובלי \"זכור אותי\" שום דבר אינו נשמר", async () => {
  window.openFindMe();
  await flush();
  await window.findMeFromProfile();

  // תמונת הפרופיל נטענה בגרסה הגדולה, ישירות לדפדפן.
  assert.deepEqual(imageLoads, ["https://lh3.googleusercontent.com/a/ACg8oc=s512-c"]);
  const search = calls.find(call => call.path === "/face/search");
  assert.equal(search.method, "POST");
  assert.deepEqual(Object.keys(search.body).sort(), ["descriptor", "limit", "modelVersion"]);
  assert.equal(search.body.descriptor.length, 128);
  assert.equal(search.body.descriptor[0], 0.123457, "הטביעה מעוגלת לשש ספרות");
  assert.equal(calls.some(call => call.path === "/face/me" && call.method === "PUT"), false, "בלי הסכמה אין שמירה");

  // התוצאות מוצגות בגלריה לפי סדר השרת, בלי התאמה שמעבר לסף.
  assert.deepEqual(window.state.tempSearchResults.map(record => record.id), ["img-2", "img-1"]);
  assert.equal(byId("findMeModal").hidden, true);
  assert.equal(byId("tempSearchBanner").children.length, 2);
});

test("עם \"זכור אותי\" הטביעה נשמרת, עם הסכמה מפורשת בבקשה", async () => {
  window.openFindMe();
  await flush();
  byId("findMeRemember").checked = true;
  await window.findMeFromProfile();
  const saved = calls.find(call => call.path === "/face/me" && call.method === "PUT");
  assert.ok(saved, "הטביעה אמורה להישמר אחרי סימון");
  assert.equal(saved.body.consent, true);
  assert.equal(saved.body.descriptor.length, 128);
  assert.equal("image" in saved.body, false);
});

test("תמונת פרופיל שאינה נטענת מובילה לסלפי, שמעובד מקומית ואינו מועלה", async () => {
  profileLoadFails = true;
  window.openFindMe();
  await flush();
  await window.findMeFromProfile();
  assert.equal(byId("findMeSelfie").hidden, false);
  assert.match(byId("findMeStatus").textContent, /סלפי/);
  assert.equal(calls.some(call => call.path === "/face/search"), false);

  const file = { type: "image/jpeg", size: 2048, name: "selfie.jpg" };
  const input = byId("findMeSelfieInput");
  input.files = [file];
  input.value = "C:\\fakepath\\selfie.jpg";
  await window.findMeFromSelfie({ target: input });

  assert.deepEqual(objectUrls.created, [file]);
  assert.deepEqual(objectUrls.revoked, ["blob:local-selfie"]);
  assert.ok(imageLoads.includes("blob:local-selfie"));
  // הבקשה היחידה עם תוכן היא ההשוואה, והיא מכילה טביעה בלבד.
  const withBodies = calls.filter(call => call.body);
  assert.deepEqual(withBodies.map(call => call.path), ["/face/search"]);
  assert.equal(JSON.stringify(withBodies).includes("selfie"), false);
  assert.equal(input.value, "", "בחירת הקובץ מתאפסת אחרי העיבוד");
});

test("בלי פנים בתמונת הפרופיל — הסבר ברור והצעה לסלפי", async () => {
  detection = "none";
  window.openFindMe();
  await flush();
  await window.findMeFromProfile();
  assert.match(byId("findMeStatus").textContent, /לא זוהו פנים/);
  assert.equal(byId("findMeSelfie").hidden, false);
  assert.equal(calls.some(call => call.path === "/face/search"), false);
});

test("שכח אותי מוחק את הטביעה בשרת", async () => {
  window.openFindMe();
  await flush();
  await window.forgetFindMe();
  assert.ok(calls.some(call => call.path === "/face/me" && call.method === "DELETE"));
  assert.match(byId("findMeStatus").textContent, /נמחקה/);
});

test("אלבום של אדם: נפתח רק למשתמש מאושר, ומוצג לפי הסדר שהשרת קבע", async () => {
  personPayload = {
    success: true,
    person: { personId: "fp_1", name: "יוסף", imageCount: 2, cover: null },
    imageIds: ["img-9", "img-3"]
  };
  window.state.userApprovalStatus = "pending";
  window.handlePeopleRoute("#person/fp_1");
  await flush();
  assert.equal(calls.length, 0, "לפני אישור אין בקשה");

  window.state.userApprovalStatus = "approved";
  window.location.hash = "#person/fp_1";
  window.handlePeopleRoute("#person/fp_1");
  for (let index = 0; index < 5; index += 1) await flush();
  assert.deepEqual(calls.map(call => call.path), ["/face/persons/fp_1"]);
  assert.deepEqual(window.state.tempSearchResults.map(record => record.id), ["img-9", "img-3"]);

  // חזרה (hash אחר) סוגרת את האלבום ומחזירה את הגלריה.
  window.location.hash = "";
  window.handlePeopleRoute("");
  assert.equal(window.state.tempSearchResults, null);
});

test("התנתקות באמצע \"התמונות שלי\": התשובה שמגיעה אחריה אינה מוצגת, והטביעה אינה נשמרת", async () => {
  let release;
  responseGate = new Promise(resolve => { release = resolve; });
  window.openFindMe();
  await flush();
  byId("findMeRemember").checked = true;
  const running = window.findMeFromProfile();
  for (let index = 0; index < 5; index += 1) await flush();
  assert.ok(calls.some(call => call.path === "/face/search"), "החיפוש כבר נשלח");

  // session-auth.js קורא לזה בהתנתקות; חשבון אחר יכול להתחבר מיד אחריה.
  window.resetPeopleState();
  assert.equal(byId("findMeModal").hidden, true, "החלון נסגר");
  release();
  await running;
  assert.equal(window.state.tempSearchResults, null, "התוצאות של המשתמש הקודם אינן מוצגות");
  assert.equal(calls.some(call => call.path === "/face/me" && call.method === "PUT"), false, "ואינן נשמרות בשם אף אחד");
});

test("איפוס אחרי אלבום של אדם: האלבום נסגר, הכתובת מתנקה, וטעינה שבדרך נזרקת", async () => {
  personPayload = {
    success: true,
    person: { personId: "fp_1", name: "יוסף", imageCount: 1, cover: null },
    imageIds: ["img-9"]
  };
  window.location.hash = "#person/fp_1";
  window.handlePeopleRoute("#person/fp_1");
  for (let index = 0; index < 5; index += 1) await flush();
  assert.deepEqual(window.state.tempSearchResults.map(record => record.id), ["img-9"]);

  window.resetPeopleState();
  assert.equal(window.location.hash, "", "הקישור לאלבום אינו נפתח מחדש למשתמש הבא");

  // טעינה שהתחילה לפני ההתנתקות וחזרה אחריה אינה מציגה דבר.
  let release;
  responseGate = new Promise(resolve => { release = resolve; });
  window.state.tempSearchResults = null;
  window.location.hash = "#person/fp_1";
  window.handlePeopleRoute("#person/fp_1");
  await flush();
  window.resetPeopleState();
  release();
  for (let index = 0; index < 5; index += 1) await flush();
  assert.equal(window.state.tempSearchResults, null);
});
