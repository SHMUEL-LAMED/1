const API_BASE_URL = "https://simchas-gallery-api.0534169095.workers.dev";
const TOKEN_STORAGE_KEY = "simchas_gallery_google_id_token";
const GOOGLE_WEB_CLIENT_ID = "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com";

// ✅ FIX: הגדלת buffer מ-60 שניות ל-5 דקות למניעת בקשות כושלות ברגע האחרון
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ✅ FIX: הפחתת מספר הניסיונות מ-80 ל-30 (7.5 שניות מקס' במקום 20)
const GOOGLE_LIBRARY_MAX_ATTEMPTS = 30;
const EMPTY_FOLDER_CLEANUP_AFTER_DELETE_MS = 3 * 1000;
const EMPTY_FOLDER_CLEANUP_AFTER_WRITE_MS = 90 * 1000;

const authState = { currentUser: null, listeners: new Set(), ready: false };
let emptyFolderCleanupTimer = null;
let emptyFolderCleanupRunning = false;

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function tokenIsUsable(token) {
  const payload = decodeJwtPayload(token);
  // ✅ FIX: שימוש ב-TOKEN_EXPIRY_BUFFER_MS במקום 60_000 הקשיח
  return Boolean(payload?.sub && Number(payload.exp || 0) * 1000 > Date.now() + TOKEN_EXPIRY_BUFFER_MS);
}

function userFromToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return null;
  return {
    uid: String(payload.sub),
    email: String(payload.email || ""),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    displayName: String(payload.name || payload.given_name || "משתמש Google"),
    photoURL: String(payload.picture || ""),
    isAnonymous: false,
    providerData: [{ providerId: "google.com" }],
    async getIdToken() {
      const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
      if (!tokenIsUsable(storedToken)) {
        await setGoogleIdToken("");
        const error = new Error("תוקף ההתחברות הסתיים. התחבר מחדש.");
        error.code = "unauthenticated";
        throw error;
      }
      return storedToken;
    }
  };
}

function notifyAuthListeners() {
  for (const listener of authState.listeners) {
    queueMicrotask(() => listener(authState.currentUser));
  }
}

export async function setGoogleIdToken(token) {
  const value = String(token || "");
  if (value && tokenIsUsable(value)) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
    authState.currentUser = userFromToken(value);
    scheduleEmptyFolderCleanup(15 * 1000);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    authState.currentUser = null;
  }
  authState.ready = true;
  notifyAuthListeners();
  return authState.currentUser;
}

function bootstrapAuth() {
  if (authState.ready) return;
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
  authState.currentUser = tokenIsUsable(token) ? userFromToken(token) : null;
  if (!authState.currentUser) sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  authState.ready = true;
}

export function initializeApp(config = {}) {
  return { config, name: "simchas-gallery-cloudflare" };
}

export function getAuth() {
  bootstrapAuth();
  return {
    get currentUser() { return authState.currentUser; },
    useDeviceLanguage() {}
  };
}

export class GoogleAuthProvider {
  setCustomParameters() {}
  static credential(idToken) { return { idToken }; }
}

export async function signInWithCredential(_auth, credential) {
  const user = await setGoogleIdToken(credential?.idToken || "");
  if (!user) {
    const error = new Error("אסימון Google אינו תקין.");
    error.code = "invalid-credential";
    throw error;
  }
  return { user };
}

export async function signOut() {
  await setGoogleIdToken("");
  // ביטול הבחירה האוטומטית מבטיח שבכניסה הבאה ייפתח שוב חלון בחירת החשבון.
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* לא קריטי */ }
}

export function onAuthStateChanged(_auth, callback) {
  bootstrapAuth();
  authState.listeners.add(callback);
  queueMicrotask(() => callback(authState.currentUser));
  return () => authState.listeners.delete(callback);
}

export async function signInAnonymously() { return { user: null }; }
export async function signInWithCustomToken() { return { user: null }; }
export async function signInWithPopup() {
  throw Object.assign(new Error("יש להשתמש בחלון Google."), { code: "google-prompt-required" });
}
export async function signInWithRedirect() {
  throw Object.assign(new Error("יש להשתמש בחלון Google."), { code: "google-prompt-required" });
}
export async function getRedirectResult() { return null; }

export function getFirestore() { return { type: "cloudflare-d1" }; }

function makeReference(type, segments, constraints = []) {
  return { type, segments: segments.map(String), constraints };
}

export function collection(_db, ...segments) { return makeReference("collection", segments); }
export function doc(_db, ...segments) { return makeReference("document", segments); }

// ✅ FIX: הוספת where() שהייתה חסרה לחלוטין — הקוד היה קורס בשקט בכל שימוש בה
export function where(field, operator, value) {
  return { kind: "where", field: String(field), operator: String(operator), value };
}

export function orderBy(field, direction = "asc") {
  return { kind: "orderBy", field: String(field), direction: direction === "desc" ? "desc" : "asc" };
}

export function limit(value) {
  return { kind: "limit", value: Math.max(1, Number(value) || 5000) };
}

export function query(reference, ...constraints) {
  return makeReference(reference.type, reference.segments, constraints);
}

export function increment(amount = 1) {
  return { __cloudflareOperation: "increment", amount: Number(amount) || 0 };
}

function collectionName(reference) {
  return reference.type === "document" ? reference.segments.at(-2) : reference.segments.at(-1);
}

function documentId(reference) {
  return reference.segments.at(-1);
}

async function apiRequest(path, options = {}) {
  bootstrapAuth();
  const user = authState.currentUser;
  if (!user) {
    const error = new Error("יש להתחבר באמצעות Google.");
    error.code = "unauthenticated";
    throw error;
  }
  const token = await user.getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || `שגיאת מסד נתונים (${response.status}).`);
    error.code = payload?.code || "unavailable";
    error.status = response.status;
    throw error;
  }
  return payload;
}

function scheduleEmptyFolderCleanup(delay = EMPTY_FOLDER_CLEANUP_AFTER_WRITE_MS) {
  clearTimeout(emptyFolderCleanupTimer);
  emptyFolderCleanupTimer = setTimeout(() => {
    cleanupEmptyGalleryFolders().catch(error => {
      console.warn("Empty folder cleanup skipped:", error);
    });
  }, Math.max(1000, Number(delay) || EMPTY_FOLDER_CLEANUP_AFTER_WRITE_MS));
}

async function cleanupEmptyGalleryFolders() {
  if (emptyFolderCleanupRunning) return;

  const state = window.state;
  if (!state?.isSuperAdmin || !window.db || !Array.isArray(state.folders) || !Array.isArray(state.images)) return;

  const folders = state.folders.filter(folder => {
    const id = String(folder?.id || "").trim();
    return id && id !== "all" && folder?.isDefault !== true;
  });
  if (!folders.length) return;

  emptyFolderCleanupRunning = true;
  try {
    const foldersById = new Map(folders.map(folder => [String(folder.id), folder]));
    const usedFolderIds = new Set();

    const markFolderAndParents = folderId => {
      let currentId = String(folderId || "").trim();
      const visited = new Set();
      while (currentId && foldersById.has(currentId) && !visited.has(currentId)) {
        visited.add(currentId);
        usedFolderIds.add(currentId);
        const currentFolder = foldersById.get(currentId);
        currentId = String(currentFolder?.parentFolderId || "").trim();
      }
    };

    for (const image of state.images || []) markFolderAndParents(image?.folderId);
    for (const pendingImage of state.pendingImages || []) markFolderAndParents(pendingImage?.folderId);

    const emptyFolders = folders
      .filter(folder => !usedFolderIds.has(String(folder.id)))
      .sort((a, b) => {
        const depthA = Number(a?.driveDepth) || 0;
        const depthB = Number(b?.driveDepth) || 0;
        if (depthA !== depthB) return depthB - depthA;
        return String(b?.parentFolderId || "").length - String(a?.parentFolderId || "").length;
      });

    if (!emptyFolders.length) return;

    const removedIds = new Set();
    for (const folder of emptyFolders) {
      const folderId = String(folder.id || "").trim();
      if (!folderId) continue;
      try {
        await apiRequest(`/data/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
        removedIds.add(folderId);
      } catch (error) {
        console.warn(`Could not delete empty folder ${folderId}:`, error);
      }
    }

    if (removedIds.size) {
      state.folders = (state.folders || []).filter(folder => !removedIds.has(String(folder?.id || "")));
      if (removedIds.has(String(state.activeFolderId || ""))) state.activeFolderId = "all";
      window.renderFolders?.();
      window.renderImages?.();
      window.populateFolderSelects?.();
      window.updateAdminOverview?.();
    }
  } finally {
    emptyFolderCleanupRunning = false;
  }
}

function documentSnapshot(id, data, exists = true) {
  return {
    id,
    exists: () => exists,
    data: () => exists ? structuredClone(data || {}) : undefined
  };
}

export async function getDoc(reference) {
  const name = encodeURIComponent(collectionName(reference));
  const id = encodeURIComponent(documentId(reference));
  try {
    const payload = await apiRequest(`/data/${name}/${id}`);
    return documentSnapshot(payload.id, payload.data, true);
  } catch (error) {
    if (error.status === 404) return documentSnapshot(documentId(reference), undefined, false);
    throw error;
  }
}

export async function getDocs(reference) {
  const params = new URLSearchParams();
  let requestedLimit = 5000;

  for (const constraint of reference.constraints || []) {
    if (constraint.kind === "orderBy") {
      params.set("orderBy", constraint.field);
      params.set("direction", constraint.direction);
    } else if (constraint.kind === "limit") {
      requestedLimit = constraint.value;
      params.set("limit", String(constraint.value));
    } else if (constraint.kind === "where") {
      params.append("where", JSON.stringify({
        field: constraint.field,
        op: constraint.operator,
        value: constraint.value
      }));
    }
  }

  // ✅ טעינת כל הדפים אוטומטית אם אין limit מפורש
  const allDocs = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    params.set("limit", String(Math.min(pageSize, requestedLimit - allDocs.length)));
    params.set("offset", String(offset));

    const payload = await apiRequest(
      `/data/${encodeURIComponent(collectionName(reference))}?${params}`
    );

    const pageDocs = (payload.documents || []).map(item =>
      documentSnapshot(item.id, item.data, true)
    );

    allDocs.push(...pageDocs);

    // עצור אם: אין עוד דפים, הגענו למגבלה, או אין hasMore
    if (!payload.hasMore || allDocs.length >= requestedLimit || pageDocs.length === 0) break;
    offset += pageDocs.length;
  }

  return {
    docs: allDocs,
    empty: allDocs.length === 0,
    size: allDocs.length,
    forEach: callback => allDocs.forEach(callback)
  };
}

export async function setDoc(reference, data, options = {}) {
  const name = collectionName(reference);
  const result = await apiRequest(
    `/data/${encodeURIComponent(name)}/${encodeURIComponent(documentId(reference))}`,
    { method: "PUT", body: JSON.stringify({ data, merge: options?.merge === true }) }
  );
  if (["images", "pendingImages", "folders"].includes(name)) {
    scheduleEmptyFolderCleanup(EMPTY_FOLDER_CLEANUP_AFTER_WRITE_MS);
  }
  return result;
}

export async function updateDoc(reference, data) {
  return setDoc(reference, data, { merge: true });
}

export async function deleteDoc(reference) {
  const name = collectionName(reference);
  const result = await apiRequest(
    `/data/${encodeURIComponent(name)}/${encodeURIComponent(documentId(reference))}`,
    { method: "DELETE" }
  );
  if (["images", "pendingImages", "folders"].includes(name)) {
    scheduleEmptyFolderCleanup(EMPTY_FOLDER_CLEANUP_AFTER_DELETE_MS);
  }
  return result;
}

// --- התחברות באמצעות חלון Google הרשמי (Google Identity Services) ---
let googleButtonLibraryPromise = null;

function waitForGoogleIdentityLibrary() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (googleButtonLibraryPromise) return googleButtonLibraryPromise;
  googleButtonLibraryPromise = new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const googleIdentity = window.google?.accounts?.id;
      if (googleIdentity) { resolve(googleIdentity); return; }
      attempts += 1;
      if (attempts >= GOOGLE_LIBRARY_MAX_ATTEMPTS) {
        // ✅ FIX: הודעת שגיאה ברורה יותר למשתמש
        reject(new Error("ספריית ההתחברות של Google לא נטענה. רענן את הדף ונסה שוב."));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
  return googleButtonLibraryPromise;
}

let googleIdentityInitialized = false;
let officialButtonsInstalled = false;
let googleButtonObserver = null;

function ensureGoogleIdentityInitialized(googleIdentity) {
  if (googleIdentityInitialized) return;
  googleIdentity.initialize({
    client_id: GOOGLE_WEB_CLIENT_ID,
    callback: handleOfficialGoogleCredential,
    context: "signin",
    ux_mode: "popup",
    // בחירה אוטומטית מבוטלת כדי שהמשתמש יוכל לבחור חשבון בכל כניסה.
    auto_select: false,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    use_fedcm_for_button: true,
    itp_support: true
  });
  googleIdentityInitialized = true;
}

// כל הדפדפנים מקבלים את הכפתור הרשמי של Google במקום כפתור האתר. ספריית
// Google Identity Services מנהלת בעצמה את FedCM ואת בקשת OAuth התקינה.
// הלחיצה חייבת להיות לחיצת משתמש אמיתית על הכפתור של Google — אין להפעיל
// navigator.credentials.get או לחיצה תכנותית, שיצרו בקשת OAuth פגומה.
function renderOfficialGoogleButton(host, googleIdentity) {
  host.replaceChildren();
  const width = Math.round(host.getBoundingClientRect().width || 320);
  googleIdentity.renderButton(host, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "pill",
    logo_alignment: "left",
    locale: "he",
    width: Math.max(240, Math.min(400, width))
  });
}

function findSiteGoogleButtons(root = document) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(
    'button[onclick*="signInWithGoogleAccount"], a[onclick*="signInWithGoogleAccount"]'
  )];
}

function replaceSiteButtonWithOfficialButton(button, googleIdentity) {
  if (!button?.isConnected || button.dataset.officialGoogleButtonInstalled === "true") return;
  button.dataset.officialGoogleButtonInstalled = "true";

  const host = document.createElement("div");
  host.dataset.officialGoogleButtonHost = "true";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "התחברות באמצעות Google");
  host.style.cssText = "display:flex;justify-content:center;align-items:center;width:100%;min-height:44px;direction:ltr;";
  if (button.id) host.id = button.id;

  button.replaceWith(host);
  renderOfficialGoogleButton(host, googleIdentity);
}

// מתקין את כפתורי Google הרשמיים פעם אחת ומשגיח גם על חלקי ממשק שנבנים
// מאוחר יותר. FedCM, כשהוא זמין, מופעל על ידי ספריית Google עצמה.
async function installOfficialGoogleButtons() {
  if (officialButtonsInstalled) return true;

  let googleIdentity;
  try {
    googleIdentity = await waitForGoogleIdentityLibrary();
  } catch (error) {
    console.error("Google Identity Services failed to load:", error);
    return false;
  }

  ensureGoogleIdentityInitialized(googleIdentity);
  officialButtonsInstalled = true;

  const install = root => {
    for (const button of findSiteGoogleButtons(root)) {
      replaceSiteButtonWithOfficialButton(button, googleIdentity);
    }
  };
  install();

  // חלקים של הממשק נבנים אחרי טעינת הדף.
  googleButtonObserver?.disconnect();
  googleButtonObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('button[onclick*="signInWithGoogleAccount"], a[onclick*="signInWithGoogleAccount"]')) {
          replaceSiteButtonWithOfficialButton(node, googleIdentity);
        }
        install(node);
      }
    }
  });
  googleButtonObserver.observe(document.documentElement, { childList: true, subtree: true });
  return true;
}

async function handleOfficialGoogleCredential(response) {
  const idToken = String(response?.credential || "");
  if (!idToken) {
    window.showNotification?.("Google לא החזירה פרטי התחברות. נסה להתחבר שוב.", false);
    return null;
  }
  try {
    const user = await setGoogleIdToken(idToken);
    if (!user) throw new Error("אסימון Google אינו תקין. נסה להתחבר שוב.");

    // אימות האסימון בצד השרת לפני שמכריזים על התחברות מוצלחת.
    const session = await verifyGoogleSessionOnServer(idToken);
    const displayName = session?.user?.displayName || user.displayName;
    // כשהשרת עדיין לא מכיר את הנתיב, מצב האישור מגיע מסנכרון הפרופיל הרגיל.
    const awaitingApproval = session?.user ? session.user.status !== "approved" : false;
    window.showNotification?.(
      awaitingApproval
        ? `שלום ${displayName}, בקשת ההצטרפות נשלחה לאישור מנהל.`
        : `שלום ${displayName}, התחברת בהצלחה.`,
      true
    );
    return user;
  } catch (error) {
    console.error("Google sign-in failed:", error);
    // אסימון שנדחה בשרת לא נשאר בדפדפן.
    if (["invalid_token", "account_unavailable", "email_not_verified", "account_blocked"].includes(error?.code)) {
      await setGoogleIdToken("");
    }
    window.showNotification?.(error?.message || "ההתחברות באמצעות Google נכשלה.", false);
    return null;
  }
}

async function verifyGoogleSessionOnServer(idToken) {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` }
  });

  // ה־Worker נפרס בנפרד מהאתר, ולכן ייתכן שהאתר כבר עודכן והשרת עדיין לא.
  // במצב הזה ממשיכים בלי הבדיקה הנוספת: כל בקשת נתונים מאמתת ממילא את
  // האסימון מול Google מחדש, כך שאין כאן ויתור על אבטחה.
  if (response.status === 404) {
    console.warn("Worker route POST /auth/session is not deployed yet; continuing without the extra sign-in check.");
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || `אימות ההתחברות בשרת נכשל (${response.status}).`);
    error.code = payload?.code || "session_verification_failed";
    error.status = response.status;
    throw error;
  }
  return payload;
}

// פותח את חלון בחירת החשבון הרשמי של Google. אין כאן שום רשימת חשבונות
// מקומית — כל התצוגה מגיעה מ־Google עצמה.
export async function openGoogleAccountChooser() {
  const installed = await installOfficialGoogleButtons();
  window.showNotification?.(
    installed
      ? "לחץ על כפתור Google הרשמי כדי לבחור חשבון."
      : "ספריית ההתחברות של Google לא נטענה. בדוק את החיבור לאינטרנט או חוסם פרסומות, ורענן את הדף.",
    installed
  );
  return false;
}

// כל כפתור "התחבר באמצעות Google" באתר קורא לפונקציה הזו.
window.signInWithGoogleAccount = openGoogleAccountChooser;
window.openGoogleAccountChooser = openGoogleAccountChooser;

// מחליפים את כפתורי האתר בכפתור הרשמי כבר בטעינה, כדי שההתחברות תושלם
// בלחיצת משתמש אחת ובמסלול היחיד שנתמך על ידי Google Identity Services.
function startOfficialGoogleButtonSetup() {
  installOfficialGoogleButtons().catch(error => {
    console.warn("Installing the official Google buttons failed:", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startOfficialGoogleButtonSetup, { once: true });
} else {
  startOfficialGoogleButtonSetup();
}
