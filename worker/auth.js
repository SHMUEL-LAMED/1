// התחברות: אימות Google, אסימוני סשן, פרופילי משתמש והרשאות בסיס.
import {
  backgroundActors
} from "./background.js";
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  INITIAL_SUPER_ADMIN_EMAIL_SHA256S
} from "./config.js";
import {
  bumpDataVersion
} from "./data.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  constantTimeHexEqual,
  getBearerToken,
  json,
  parseDocumentData,
  sha256
} from "./util.js";

function isInitialSuperAdminHash(candidateHash) {
  let matched = false;
  for (const expectedHash of INITIAL_SUPER_ADMIN_EMAIL_SHA256S) {
    matched = constantTimeHexEqual(candidateHash, expectedHash) || matched;
  }
  return matched;
}

async function verifyGoogleAccount(idToken, env) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);

  if (!response.ok) {
    throw apiError("תוקף ההתחברות הסתיים. התחבר מחדש ונסה שוב.", 401, "invalid_token");
  }

  const payload = await response.json();
  const expectedAudience = String(env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
  if (!payload?.sub || payload.aud !== expectedAudience) {
    throw apiError("החשבון אינו זמין.", 403, "account_unavailable");
  }
  if (!payload.email || ![true, "true"].includes(payload.email_verified)) {
    throw apiError("נדרש חשבון Google בעל כתובת דוא״ל מאומתת.", 403, "email_not_verified");
  }
  return {
    localId: String(payload.sub),
    email: String(payload.email),
    emailVerified: true,
    displayName: String(payload.name || "משתמש Google"),
    photoUrl: String(payload.picture || "")
  };
}

// --- אסימון התחברות מתמשך ---
// אסימון Google תקף כשעה בלבד, ולכן הוא משמש רק לכניסה הראשונה. מיד אחריה
// השרת מנפיק אסימון משלו, חתום ב־HMAC, שתקף שנה. הדפדפן מחדש אותו בכל
// ביקור (ראו tokenNeedsRenewal ב־cloudflare-client.js), ולכן התוקף הוא
// מתגלגל: מי שנכנס לאתר ולו פעם בשנה נשאר מחובר עד שהוא מתנתק בעצמו.
// הגרסה הקודמת הנפיקה אסימון לשלושים יום וחידשה אותו רק בשבוע האחרון
// לתוקפו — מי שלא ביקר בדיוק באותו שבוע נותק ונדרש להתחבר מחדש.
const SESSION_TOKEN_PREFIX = "v1";
const SESSION_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

let sessionSigningKeyPromise = null;

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function loadStoredSessionSecret(env) {
  const readSecret = () => env.GALLERY_DB.prepare(
    "SELECT secret_value FROM auth_secrets WHERE secret_key = 'session_signing'"
  ).first();

  const existing = String((await readSecret())?.secret_value || "");
  if (existing) return existing;

  const generated = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  await env.GALLERY_DB.prepare(
    `INSERT INTO auth_secrets (secret_key, secret_value, created_at)
     VALUES ('session_signing', ?, ?)
     ON CONFLICT(secret_key) DO NOTHING`
  ).bind(generated, Date.now()).run();

  // שני עותקים של ה־Worker עלולים לייצר מפתח באותו רגע; הערך שנשמר בפועל קובע.
  return String((await readSecret())?.secret_value || generated);
}

function sessionSigningKey(env) {
  if (!sessionSigningKeyPromise) {
    sessionSigningKeyPromise = (async () => {
      const configured = String(env.SESSION_SIGNING_SECRET || "").trim();
      if (!configured) await ensureDatabaseSchema(env);
      const secret = configured || await loadStoredSessionSecret(env);
      return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
    })().catch(error => {
      // כישלון זמני לא ננעל במטמון, כדי שהבקשה הבאה תנסה שוב.
      sessionSigningKeyPromise = null;
      throw error;
    });
  }
  return sessionSigningKeyPromise;
}

async function signSessionPayload(env, encodedPayload) {
  const key = await sessionSigningKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${SESSION_TOKEN_PREFIX}.${encodedPayload}`)
  );
  return base64UrlEncode(new Uint8Array(signature));
}

// מבנה האסימון זהה למבנה של JWT, כך שהדפדפן קורא ממנו את פרטי המשתמש
// בדיוק כפי שהוא קורא מאסימון Google.
async function createSessionToken(env, account, profile = null) {
  const issuedAt = Date.now();
  const payload = {
    sub: String(account.localId),
    email: String(account.email || ""),
    email_verified: true,
    name: String(profile?.displayName || account.displayName || "משתמש Google"),
    picture: String(profile?.photoURL || account.photoUrl || ""),
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor((issuedAt + SESSION_TOKEN_TTL_MS) / 1000)
  };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signSessionPayload(env, encodedPayload);
  return {
    token: `${SESSION_TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: payload.exp * 1000
  };
}

function looksLikeSessionToken(token) {
  return String(token || "").startsWith(`${SESSION_TOKEN_PREFIX}.`);
}

async function verifySessionToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) return null;

  const [, encodedPayload, signature] = parts;
  const expected = await signSessionPayload(env, encodedPayload);
  if (!constantTimeHexEqual(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encodedPayload)));
  } catch {
    return null;
  }
  if (!payload?.sub || !payload?.email) return null;
  if (Number(payload.exp || 0) * 1000 <= Date.now()) return null;
  return payload;
}

// כל בקשה מזוהה או באסימון ההתחברות של השרת, או באסימון Google בכניסה
// הראשונה. בשני המקרים ההרשאות נקראות מחדש מהמסד בכל בקשה, ולכן חסימת
// משתמש נכנסת לתוקף מיד גם כשהאסימון שבידיו עדיין תקף.
async function resolveAccount(request, env) {
  const token = getBearerToken(request);
  if (!looksLikeSessionToken(token)) {
    return { account: await verifyGoogleAccount(token, env), token };
  }

  const payload = await verifySessionToken(env, token);
  if (!payload) {
    throw apiError("תוקף ההתחברות הסתיים. התחבר מחדש.", 401, "invalid_token");
  }
  return {
    account: {
      localId: String(payload.sub),
      email: String(payload.email),
      emailVerified: true,
      displayName: String(payload.name || "משתמש Google"),
      photoUrl: String(payload.picture || "")
    },
    token
  };
}

async function readUserProfile(uid, env, verifiedEmail = "") {
  await ensureDatabaseSchema(env);
  let row = await env.GALLERY_DB.prepare(
    "SELECT document_id, data_json, created_at FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
  ).bind("userProfiles", uid).first();

  // בגיבוי הישן מזהה המשתמש הגיע מ־Firebase. בעת הכניסה הראשונה ל־D1
  // מחברים אוטומטית את הפרופיל הישן למזהה Google החדש לפי אימייל מאומת.
  if (!row && verifiedEmail) {
    const legacyRow = await env.GALLERY_DB.prepare(
      `SELECT documents.document_id, documents.data_json, documents.created_at
       FROM user_email_index AS email_index
       JOIN gallery_documents AS documents
         ON documents.collection_name = 'userProfiles'
        AND documents.document_id = email_index.document_id
       WHERE email_index.normalized_email = lower(trim(?))
       LIMIT 1`
    ).bind(verifiedEmail).first();
    if (legacyRow) {
      const migratedData = {
        ...parseDocumentData(legacyRow),
        uid,
        email: verifiedEmail,
        migratedToGoogleAt: Date.now()
      };
      const now = Date.now();
      await env.GALLERY_DB.prepare(
        `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
         VALUES ('userProfiles', ?, ?, ?, ?, ?)
         ON CONFLICT(collection_name, document_id) DO UPDATE SET
           data_json = excluded.data_json, owner_uid = excluded.owner_uid, updated_at = excluded.updated_at`
      ).bind(uid, JSON.stringify(migratedData), uid, legacyRow.created_at || now, now).run();
      await updateUserEmailIndex(env, uid, verifiedEmail, now);
      if (legacyRow.document_id !== uid) {
        await env.GALLERY_DB.prepare(
          "DELETE FROM gallery_documents WHERE collection_name = 'userProfiles' AND document_id = ?"
        ).bind(legacyRow.document_id).run();
      }
      await bumpDataVersion(env, "userProfiles");
      row = { document_id: uid, data_json: JSON.stringify(migratedData), created_at: legacyRow.created_at };
    }
  }
  return row ? parseDocumentData(row) : null;
}

async function updateUserEmailIndex(env, documentId, email, updatedAt = Date.now()) {
  await env.GALLERY_DB.prepare(
    "DELETE FROM user_email_index WHERE document_id = ?"
  ).bind(documentId).run();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  await env.GALLERY_DB.prepare(
    `INSERT INTO user_email_index (normalized_email, document_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(normalized_email) DO UPDATE SET
       document_id = excluded.document_id,
       updated_at = excluded.updated_at`
  ).bind(normalizedEmail, documentId, updatedAt).run();
}

async function requireUser(request, env, allowedRoles = null) {
  if (backgroundActors.has(request)) return backgroundActors.get(request);
  const { account, token } = await resolveAccount(request, env);
  const isInitialSuperAdmin = isInitialSuperAdminHash(await sha256(account.email));
  const profile = isInitialSuperAdmin
    ? await ensureInitialSuperAdminProfile(account, env)
    : await readUserProfile(account.localId, env, account.email);

  if (!profile) {
    throw apiError("פרופיל המשתמש עדיין לא נוצר. רענן את האתר ונסה שוב.", 403, "profile_missing");
  }

  if (profile.status === "blocked") {
    throw apiError("החשבון חסום ואינו מורשה לבצע פעולות.", 403, "account_blocked");
  }
  if (profile.status !== "approved") {
    throw apiError("החשבון עדיין ממתין לאישור מנהל.", 403, "approval_required");
  }
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    throw apiError("לחשבון אין הרשאה לבצע פעולה זו.", 403, "permission_denied");
  }

  return {
    uid: account.localId,
    email: account.email,
    role: profile.role,
    idToken: token,
    account
  };
}

async function dataActor(request, env) {
  if (backgroundActors.has(request)) return backgroundActors.get(request);
  const { account } = await resolveAccount(request, env);
  const initialAdmin = isInitialSuperAdminHash(await sha256(account.email));
  const profile = initialAdmin
    ? { status: "approved", role: "super_admin" }
    : await readUserProfile(account.localId, env, account.email);
  if (initialAdmin) {
    await ensureInitialSuperAdminProfile(account, env);
  }
  if (profile?.status === "blocked") throw apiError("החשבון חסום.", 403, "account_blocked");
  return {
    uid: account.localId,
    email: account.email,
    account,
    status: profile?.status || "pending",
    role: initialAdmin ? "super_admin" : (profile?.role || "viewer"),
    initialAdmin
  };
}

async function ensureInitialSuperAdminProfile(account, env) {
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const existing = await readUserProfile(account.localId, env, account.email);
  const profile = {
    ...(existing || {}),
    uid: account.localId,
    displayName: account.displayName || existing?.displayName || "מנהל המערכת",
    email: account.email,
    photoURL: account.photoUrl || existing?.photoURL || "",
    status: "approved",
    role: "super_admin",
    approvedAt: existing?.approvedAt || now,
    approvedBy: existing?.approvedBy || "initial-admin-bootstrap",
    lastLoginAt: now
  };
  await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES ('userProfiles', ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET
       data_json = excluded.data_json, owner_uid = excluded.owner_uid, updated_at = excluded.updated_at`
  ).bind(account.localId, JSON.stringify(profile), account.localId, existing?.requestedAt || now, now).run();
  await updateUserEmailIndex(env, account.localId, account.email, now);
  // הכתיבה הזו רצה בכל בקשה של מנהל־העל הראשי; רק שינוי ממשי בפרופיל
  // (יצירה או קידום) מצדיק הפלה של רשימת המשתמשים במטמון.
  if (!existing || existing.status !== "approved" || existing.role !== "super_admin") {
    await bumpDataVersion(env, "userProfiles");
  }
  return profile;
}

function sessionUser(account, profile) {
  return {
    uid: account.localId,
    email: account.email,
    displayName: profile?.displayName || account.displayName,
    photoURL: profile?.photoURL || account.photoUrl || "",
    status: profile?.status || "pending",
    role: profile?.role || "viewer"
  };
}

// אימות שרתי של ההתחברות. בכניסה הראשונה הדפדפן שולח את אסימון Google, וכאן
// הוא מוחלף באסימון התחברות ארוך־טווח של השרת. אותו מסלול משמש גם לחידוש
// האסימון לפני שתוקפו פג, ואז הדפדפן שולח את האסימון הקיים.
async function establishGoogleSession(request, env) {
  const { account } = await resolveAccount(request, env);
  await ensureDatabaseSchema(env);

  if (isInitialSuperAdminHash(await sha256(account.email))) {
    const profile = await ensureInitialSuperAdminProfile(account, env);
    const session = await createSessionToken(env, account, profile);
    return json(request, {
      success: true,
      isNewUser: false,
      user: sessionUser(account, profile),
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt
    });
  }

  const now = Date.now();
  const existing = await readUserProfile(account.localId, env, account.email);
  if (existing?.status === "blocked") throw apiError("החשבון חסום.", 403, "account_blocked");

  const profile = {
    ...(existing || {}),
    uid: account.localId,
    displayName: account.displayName || existing?.displayName || "משתמש Google",
    email: account.email,
    photoURL: account.photoUrl || existing?.photoURL || "",
    status: existing?.status || "pending",
    role: existing?.role || "viewer",
    requestedAt: existing?.requestedAt || now,
    lastLoginAt: now
  };
  await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES ('userProfiles', ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET
       data_json = excluded.data_json, owner_uid = excluded.owner_uid, updated_at = excluded.updated_at`
  ).bind(account.localId, JSON.stringify(profile), account.localId, existing?.requestedAt || now, now).run();
  await updateUserEmailIndex(env, account.localId, account.email, now);
  await bumpDataVersion(env, "userProfiles");

  const session = await createSessionToken(env, account, profile);
  return json(request, {
    success: true,
    isNewUser: !existing,
    user: sessionUser(account, profile),
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt
  });
}

export {
  isInitialSuperAdminHash,
  verifyGoogleAccount,
  SESSION_TOKEN_PREFIX,
  SESSION_TOKEN_TTL_MS,
  sessionSigningKeyPromise,
  base64UrlEncode,
  base64UrlDecodeToBytes,
  loadStoredSessionSecret,
  sessionSigningKey,
  signSessionPayload,
  createSessionToken,
  looksLikeSessionToken,
  verifySessionToken,
  resolveAccount,
  readUserProfile,
  updateUserEmailIndex,
  requireUser,
  dataActor,
  ensureInitialSuperAdminProfile,
  sessionUser,
  establishGoogleSession
};
