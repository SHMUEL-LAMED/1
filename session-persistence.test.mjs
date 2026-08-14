import test from "node:test";
import assert from "node:assert/strict";

// הבדיקות כאן שומרות על ההבטחה המרכזית: מי שהתחבר פעם אחת בדפדפן נשאר
// מחובר עד שהוא מתנתק בעצמו — גם אחרי סגירת הלשונית, גם בלשונית נוספת,
// וגם אחרי שתוקפו של אסימון Google המקורי פג.

const TOKEN_KEY = "simchas_gallery_google_id_token";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function encodeToken(prefix, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${prefix}.${body}.signature`;
}

// אסימון Google: תקף כשעה, וזה בדיוק מקור הבעיה שנפתרה כאן.
function googleToken(expiresInMs = HOUR_MS) {
  return encodeToken(Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"), {
    sub: "google-user-1",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    exp: Math.floor((Date.now() + expiresInMs) / 1000)
  });
}

// אסימון ההתחברות של השרת: תקף שלושים יום.
function serverSessionToken(expiresInMs = 30 * DAY_MS) {
  return encodeToken("v1", {
    sub: "google-user-1",
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
    exp: Math.floor((Date.now() + expiresInMs) / 1000)
  });
}

function makeStorage(map) {
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
}

let moduleCounter = 0;
const restoreGlobals = [];

test.afterEach(() => {
  while (restoreGlobals.length) restoreGlobals.pop()();
});

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// כל טעינה מקבלת עותק נקי של המודול, כדי שמצב ההתחברות של בדיקה אחת לא
// ידלוף לבדיקה הבאה.
async function loadClient({ local = new Map(), session = new Map(), listeners = null, fetchImpl = null } = {}) {
  globalThis.localStorage = makeStorage(local);
  globalThis.sessionStorage = makeStorage(session);
  globalThis.document = { readyState: "loading", addEventListener() {}, visibilityState: "visible" };
  globalThis.window = listeners
    ? { addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); } }
    : {};

  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  restoreGlobals.push(() => {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
  });

  // הטיימר התקופתי מיותר בבדיקה, ומשאיר את התהליך פתוח.
  globalThis.setInterval = () => 0;
  if (fetchImpl) globalThis.fetch = fetchImpl;

  moduleCounter += 1;
  const client = await import(`./cloudflare-client.js?case=${moduleCounter}`);
  // חידוש רקע שהתחיל בזמן הטעינה מקבל הזדמנות להסתיים.
  await settle();
  return { client, local, session };
}

test("ההתחברות שורדת סגירה של הלשונית", async () => {
  // sessionStorage ריק — כך נראה הדפדפן אחרי שהלשונית נסגרה ונפתחה מחדש.
  const { client } = await loadClient({
    local: new Map([[TOKEN_KEY, serverSessionToken()]]),
    session: new Map()
  });

  assert.equal(client.getAuth().currentUser?.uid, "google-user-1");
  assert.equal(client.getAuth().currentUser?.email, "user@example.com");
});

test("ההתחברות נשמרת באחסון הקבוע ולא באחסון של הלשונית בלבד", async () => {
  const local = new Map();
  const session = new Map();
  const { client } = await loadClient({ local, session });

  const token = serverSessionToken();
  await client.setGoogleIdToken(token);

  assert.equal(local.get(TOKEN_KEY), token, "the sign-in must be written to localStorage");
  assert.equal(session.has(TOKEN_KEY), false, "sessionStorage is wiped when the tab closes");
});

test("התחברות שנשמרה בגרסה קודמת עוברת לאחסון הקבוע", async () => {
  const local = new Map();
  const legacyToken = serverSessionToken();
  const { client } = await loadClient({
    local,
    session: new Map([[TOKEN_KEY, legacyToken]])
  });

  assert.equal(client.getAuth().currentUser?.uid, "google-user-1");
  assert.equal(local.get(TOKEN_KEY), legacyToken, "the old sign-in must be migrated, not dropped");
});

test("אסימון Google שתוקפו עומד לפוג מוחלף באסימון ההתחברות של השרת", async () => {
  const local = new Map([[TOKEN_KEY, googleToken()]]);
  const renewedToken = serverSessionToken();
  const requestedPaths = [];

  const { client } = await loadClient({
    local,
    listeners: {},
    fetchImpl: async (url, options = {}) => {
      requestedPaths.push(new URL(String(url)).pathname);
      assert.equal(options.method, "POST");
      return Response.json({ success: true, sessionToken: renewedToken, user: { uid: "google-user-1" } });
    }
  });

  assert.deepEqual(requestedPaths, ["/auth/session"]);
  assert.equal(local.get(TOKEN_KEY), renewedToken, "the short lived Google token must be swapped out");
  assert.equal(client.getAuth().currentUser?.uid, "google-user-1");
});

test("אסימון שפג תוקפו מתחדש בבקשה הבאה במקום לנתק את המשתמש", async () => {
  const local = new Map();
  const renewedToken = serverSessionToken();

  const { client } = await loadClient({
    local,
    fetchImpl: async () => Response.json({ success: true, sessionToken: renewedToken })
  });

  // המשתמש מחובר, ובזמן שהדף היה פתוח פג תוקפו של האסימון השמור.
  await client.setGoogleIdToken(googleToken(2 * HOUR_MS));
  local.set(TOKEN_KEY, googleToken(-HOUR_MS));

  const token = await client.getAuth().currentUser.getIdToken();
  assert.equal(token, renewedToken);
  assert.equal(local.get(TOKEN_KEY), renewedToken);
});

test("יציאה מהחשבון מוחקת את ההתחברות מהאחסון הקבוע", async () => {
  const local = new Map();
  const session = new Map();
  const { client } = await loadClient({ local, session });

  await client.setGoogleIdToken(serverSessionToken());
  assert.ok(local.has(TOKEN_KEY));

  await client.signOut();

  assert.equal(local.has(TOKEN_KEY), false);
  assert.equal(session.has(TOKEN_KEY), false);
  assert.equal(client.getAuth().currentUser, null);
});

test("התנתקות בלשונית אחת מתנתקת גם בשאר הלשוניות", async () => {
  const local = new Map([[TOKEN_KEY, serverSessionToken()]]);
  const listeners = {};
  const { client } = await loadClient({ local, listeners });

  assert.equal(client.getAuth().currentUser?.uid, "google-user-1");

  const seen = [];
  client.onAuthStateChanged(null, user => seen.push(user?.uid || null));
  await settle();

  // לשונית אחרת התנתקה: הדפדפן מודיע על השינוי באחסון המשותף.
  local.delete(TOKEN_KEY);
  for (const handler of listeners.storage || []) handler({ key: TOKEN_KEY });
  await settle();

  assert.equal(client.getAuth().currentUser, null);
  assert.deepEqual(seen, ["google-user-1", null]);
});

test("חידוש שקט של האסימון אינו מדווח כהתחברות מחדש", async () => {
  const local = new Map();
  const { client } = await loadClient({ local });

  await client.setGoogleIdToken(serverSessionToken());

  const seen = [];
  client.onAuthStateChanged(null, user => seen.push(user?.uid || null));
  await settle();

  // אותו משתמש, אסימון חדש: הגלריה והמאזינים לא אמורים להיטען מחדש.
  await client.setGoogleIdToken(serverSessionToken(29 * DAY_MS));
  await settle();

  assert.deepEqual(seen, ["google-user-1"]);
});
