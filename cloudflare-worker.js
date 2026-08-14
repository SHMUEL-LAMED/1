const DEFAULT_GOOGLE_CLIENT_ID = "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com";
const INITIAL_SUPER_ADMIN_EMAIL_SHA256S = new Set([
  "0c70c93b21ed7d7ac11f8a0e41cf0811b221f8e16524ed71d8b1822661edc137",
  "d2632af59d29239eef52f10e1cfbf38e27c65c55470b355134b1cd1fb4f809d6"
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
const CHAT_HISTORY_LIMIT = 150;
const CHAT_HISTORY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const CHAT_MUTATION_MAX_RETRIES = 6;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_VISION_MODEL = "gpt-5.4-mini";
const FACE_API_VERSION = "1.7.15";
const FACE_API_CDN_BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}`;
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_DRIVE_SITE_URL = "https://shmuel-lamed.github.io/1/";
const DRIVE_STATE_TTL_MS = 10 * 60 * 1000;
const DRIVE_ACCESS_TOKEN_SAFETY_MS = 60 * 1000;
const DATABASE_SCHEMA_VERSION = 4;
// גודל עמוד ברשימת מסמכים. הלקוח מבקש עמודים ומצרף אותם, כך שאין תקרה
// על המספר הכולל של המסמכים שנטענים — רק על גודל התשובה הבודדת.
const DATA_PAGE_MAX_LIMIT = 1000;
const DATA_PAGE_DEFAULT_LIMIT = 500;
// כל בקשה ל־/ai-search צורכת מכסה אחת, כולל ניסיונות חוזרים אחרי 429.
// חיפוש מלא הוא עד 10 קבוצות, וכל קבוצה עשויה להגיע לשישה ניסיונות —
// כלומר עד 60 בקשות. המגבלה גבוהה מכך כדי שחיפוש אחד לא יחסום את עצמו.
const AI_SEARCH_RATE_LIMIT = 80;
const AI_SEARCH_RATE_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_RATE_LIMIT = 60;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RATE_LIMIT = 30;
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000;

// --- טביעות פנים בענן ---
// כל תמונה מעובדת פעם אחת בלבד בדפדפן של המנהל, והטביעות המספריות נשמרות
// ב-D1. חיפוש רגיל שולח רק את הטביעה של תמונת החיפוש, וההשוואה מתבצעת כאן —
// כך שהדפדפן אינו מוריד שוב את תמונות הגלריה.
// שינוי הערך מסמן את כל הטביעות הקיימות כשייכות לגרסה ישנה, והאינדוקס
// יריץ מחדש רק את מה שנדרש לגרסה החדשה.
const FACE_MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";
const FACE_DESCRIPTOR_LENGTH = 128;
// ערכי הסף זהים לאלה ששימשו בהשוואה בדפדפן. מרחק קטן יותר = דמיון גבוה יותר.
// חיפוש פנים הוא פעולה שבה false-positive גרוע בהרבה מתוצאה חסרה.
// לכן מחזירים רק התאמות מחמירות; הסף הישן 0.62 החזיר גם פנים דומות של
// אנשים אחרים, ובגלריות צפופות היה עלול להיראות כאילו כל התמונות תואמות.
const FACE_MATCH_THRESHOLD = 0.48;
const FACE_STRONG_MATCH_THRESHOLD = 0.48;
// טביעה אמיתית של face-api מורכבת מערכים קטנים שאורך הווקטור שלהם קרוב ל-1.
// הטווחים כאן רחבים בהרבה מהמצוי בפועל, ועדיין פוסלים אשפה או וקטור אפסים.
const FACE_DESCRIPTOR_MAX_COMPONENT = 5;
const FACE_DESCRIPTOR_MIN_NORM = 0.1;
const FACE_DESCRIPTOR_MAX_NORM = 12;
const FACE_SEARCH_DEFAULT_LIMIT = 60;
const FACE_SEARCH_MAX_LIMIT = 200;
const FACE_SEARCH_RATE_LIMIT = 40;
const FACE_SEARCH_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_INDEX_RATE_LIMIT = 1200;
const FACE_INDEX_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_INDEX_MAX_IMAGES_PER_REQUEST = 25;
const FACE_INDEX_MAX_FACES_PER_IMAGE = 20;
const FACE_INDEX_MAX_ATTEMPTS = 3;
const FACE_INDEX_PENDING_MAX_IDS = 500;
// קריאת הטביעות לחיפוש מתבצעת בעמודים כדי שתשובת D1 תישאר קטנה.
const FACE_DESCRIPTOR_PAGE_SIZE = 250;
const FACE_DESCRIPTOR_SCAN_LIMIT = 200000;
const FACE_ID_QUERY_CHUNK = 100;

const FACE_ASSETS = new Map([
  ["face-api.js", { upstreamPath: "dist/face-api.js", contentType: "application/javascript; charset=utf-8" }],
  ["model/ssd_mobilenetv1_model-weights_manifest.json", { upstreamPath: "model/ssd_mobilenetv1_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/ssd_mobilenetv1_model.bin", { upstreamPath: "model/ssd_mobilenetv1_model.bin", contentType: "application/octet-stream" }],
  ["model/face_landmark_68_model-weights_manifest.json", { upstreamPath: "model/face_landmark_68_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/face_landmark_68_model.bin", { upstreamPath: "model/face_landmark_68_model.bin", contentType: "application/octet-stream" }],
  ["model/face_recognition_model-weights_manifest.json", { upstreamPath: "model/face_recognition_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/face_recognition_model.bin", { upstreamPath: "model/face_recognition_model.bin", contentType: "application/octet-stream" }]
]);

const ALLOWED_ORIGINS = new Set([
  "https://shmuel-lamed.github.io",
  "https://0534169095-star.github.io",
  "https://xn--4dbjbascrao3i.com",
  "https://www.xn--4dbjbascrao3i.com"
]);

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

const ALLOWED_VIDEO_TYPES = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"]
]);

const ALLOWED_CHAT_FILE_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/json", "json"],
  ["application/zip", "zip"],
  ["application/x-zip-compressed", "zip"],
  ["application/vnd.rar", "rar"],
  ["application/x-rar-compressed", "rar"],
  ["application/x-7z-compressed", "7z"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"]
]);

const ALLOWED_CHAT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "json", "zip", "rar", "7z",
  "mp3", "m4a", "wav", "ogg"
]);

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ...ALLOWED_IMAGE_TYPES.values(),
  ...ALLOWED_VIDEO_TYPES.values(),
  ...ALLOWED_CHAT_EXTENSIONS
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Face-Index-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function apiError(message, status = 400, code = "request_failed") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw apiError("נדרשת התחברות לחשבון מאושר.", 401, "authentication_required");
  return match[1];
}

// כתובות דוא״ל מנורמלות לפני הגיבוב; סודות מגובבים כמות שהם כדי לא לאבד אנטרופיה.
async function sha256(value, { normalize = true } = {}) {
  const text = normalize ? String(value || "").trim().toLowerCase() : String(value || "");
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeHexEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

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
// השרת מנפיק אסימון משלו, חתום ב־HMAC, שתקף שלושים יום. כך המשתמש נשאר
// מחובר באותו דפדפן עד שהוא מתנתק, בלי להתחבר מחדש בכל כניסה לאתר.
const SESSION_TOKEN_PREFIX = "v1";
const SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

function parseDocumentData(row) {
  try {
    return JSON.parse(row?.data_json || "{}");
  } catch {
    return {};
  }
}

let databaseSchemaReady = false;

async function ensureDatabaseSchema(env) {
  if (!env.GALLERY_DB) throw apiError("החיבור למסד D1 אינו מוגדר.", 500, "database_binding_missing");
  if (databaseSchemaReady) return;
  try {
    const schema = await env.GALLERY_DB.prepare("PRAGMA table_info(gallery_documents)").all();
    const existingColumns = new Set((schema.results || []).map(column => String(column.name)));
    const requiredColumns = ["collection_name", "document_id", "data_json", "owner_uid", "created_at", "updated_at"];
    if (existingColumns.size > 0 && !requiredColumns.every(column => existingColumns.has(column))) {
      await env.GALLERY_DB.prepare(
        "CREATE TABLE IF NOT EXISTS gallery_documents_legacy AS SELECT * FROM gallery_documents"
      ).run();
      await env.GALLERY_DB.prepare("DROP TABLE gallery_documents").run();
    }
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS gallery_documents (
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        owner_uid TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection_name, document_id)
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS gallery_schema_meta (
        schema_key TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS request_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_email_index (
        normalized_email TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    // מפתח החתימה של אסימוני ההתחברות. הוא נוצר פעם אחת ונשמר, כדי שאסימונים
    // שהונפקו לפני פריסה מחדש של ה־Worker יישארו תקפים והמשתמשים לא יינתקו.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS auth_secrets (
        secret_key TEXT PRIMARY KEY,
        secret_value TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();
    // טביעות הפנים נשמרות בטבלה נפרדת, שורה לכל פרצוף בתמונה, כדי שתמונה
    // עם כמה אנשים תישמר במלואה ותוכל להימצא לפי כל אחד מהם.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS image_face_descriptors (
        image_id TEXT NOT NULL,
        face_index INTEGER NOT NULL,
        descriptor_json TEXT NOT NULL,
        model_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, face_index)
      )`
    ).run();
    // מצב האינדוקס לכל תמונה. תמונה ללא פנים נשמרת כאן עם face_count = 0,
    // כך שהיא לא תיסרק שוב, והאינדוקס יכול להימשך בדיוק מהמקום שנעצר.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS image_face_index_state (
        image_id TEXT PRIMARY KEY,
        model_version TEXT NOT NULL,
        status TEXT NOT NULL,
        face_count INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_image_face_descriptors_model ON image_face_descriptors (model_version, image_id, face_index)"
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_image_face_index_state_model ON image_face_index_state (model_version, status)"
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_gallery_documents_collection_updated ON gallery_documents (collection_name, updated_at DESC)"
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_gallery_documents_owner ON gallery_documents (collection_name, owner_uid)"
    ).run();
    const versionRow = await env.GALLERY_DB.prepare(
      "SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'gallery'"
    ).first();
    const currentVersion = Number(versionRow?.schema_version) || 0;
    if (currentVersion < 3) {
      await env.GALLERY_DB.prepare(
        `INSERT OR REPLACE INTO user_email_index (normalized_email, document_id, updated_at)         SELECT lower(trim(json_extract(data_json, '$.email'))), document_id, updated_at
         FROM gallery_documents
         WHERE collection_name = 'userProfiles'
           AND json_valid(data_json)
           AND length(trim(COALESCE(json_extract(data_json, '$.email'), ''))) > 0`
      ).run();
    }
    await env.GALLERY_DB.prepare(
      `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at)
       VALUES ('gallery', ?, ?)
       ON CONFLICT(schema_key) DO UPDATE SET
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at`
    ).bind(DATABASE_SCHEMA_VERSION, Date.now()).run();
    databaseSchemaReady = true;
  } catch (error) {
    console.error("D1 schema initialization failed", error);
    throw apiError("מסד הנתונים מחובר, אך טבלת הנתונים אינה זמינה.", 500, "database_schema_unavailable");
  }
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

function safeDataPart(value, label) {
  const part = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!part) throw apiError(`${label} אינו תקין.`, 400, "invalid_data_path");
  return part;
}

const DATA_COLLECTIONS = new Set([
  "folders", "images", "pendingImages", "userProfiles", "deletionRequests",
  "trashItems", "activityLogs", "systemMeta", "userFavorites",
  "userPreferences", "mediaStats"
]);

async function dataActor(request, env) {
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

  const session = await createSessionToken(env, account, profile);
  return json(request, {
    success: true,
    isNewUser: !existing,
    user: sessionUser(account, profile),
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt
  });
}

function assertDataPermission(actor, collectionName, method, documentId = "") {
  const approved = actor.status === "approved" || actor.initialAdmin;
  const admin = approved && ["admin", "super_admin"].includes(actor.role);
  const superAdmin = approved && actor.role === "super_admin";
  const ownDocument = documentId === actor.uid;

  if (collectionName === "userProfiles") {
    if ((method === "GET" || method === "PUT") && ownDocument) return;
    if (superAdmin) return;
  } else if (["userFavorites", "userPreferences"].includes(collectionName)) {
    if (approved && ownDocument) return;
  } else if (["folders", "images"].includes(collectionName)) {
    if (method === "GET" && approved) return;
    if (method === "PUT" && collectionName === "images" && approved && actor.role === "uploader") return;
    if (["PUT", "DELETE"].includes(method) && admin) return;
  } else if (collectionName === "pendingImages") {
    if (admin) return;
    if (method === "PUT" && approved) return;
  } else if (collectionName === "mediaStats") {
    if (approved && ["GET", "PUT"].includes(method)) return;
    if (superAdmin && method === "DELETE") return;
  } else if (collectionName === "activityLogs") {
    if (method === "PUT" && approved) return;
    if (method === "GET" && superAdmin) return;
  } else if (collectionName === "deletionRequests") {
    if (method === "PUT" && admin) return;
    if (["GET", "DELETE"].includes(method) && superAdmin) return;
  } else if (collectionName === "systemMeta") {
    if (method === "GET" && approved) return;
    if (["PUT", "DELETE"].includes(method) && admin) return;
  } else if (collectionName === "trashItems") {
    if (superAdmin) return;
  }
  throw apiError("אין הרשאה לפעולה זו.", 403, "permission_denied");
}

function resolveDataOperations(value, previousValue) {
  if (value && typeof value === "object" && value.__cloudflareOperation === "increment") {
    return (Number(previousValue) || 0) + (Number(value.amount) || 0);
  }
  if (Array.isArray(value)) return value.map((item, index) => resolveDataOperations(item, previousValue?.[index]));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = resolveDataOperations(item, previousValue?.[key]);
    }
    return result;
  }
  return value;
}


function chatMessageId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) throw apiError("מזהה ההודעה אינו תקין.", 400, "invalid_message_id");
  return id;
}

function chatAttachmentFromPayload(value, conversationUid, request, env) {
  if (!value || typeof value !== "object") return null;
  const key = validateObjectKey(value.key);
  const keyParts = key.split("/");
  if (keyParts[0] !== "chat" || keyParts[1] !== conversationUid) {
    throw apiError("הקובץ המצורף אינו שייך לשיחה הזו.", 403, "attachment_conversation_mismatch");
  }
  return {
    key,
    url: mediaUrl(request, key, env),
    name: String(value.name || "קובץ").replace(/[\r\n]/g, " ").slice(0, 180),
    type: String(value.type || "application/octet-stream").slice(0, 120),
    size: Math.max(0, Math.min(MAX_CHAT_FILE_BYTES, Number(value.size) || 0)),
    kind: value.kind === "image" ? "image" : "file"
  };
}

function sanitizeNewChatMessage(value, actor, conversationUid, request, env) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError("מבנה ההודעה אינו תקין.", 400, "invalid_chat_message");
  }
  const isSuperAdmin = actor.initialAdmin || (actor.status === "approved" && actor.role === "super_admin");
  const direction = isSuperAdmin ? "admin_to_user" : "user_to_admin";
  const text = String(value.text || "").trim().slice(0, 1500);
  const attachment = value.attachment ? chatAttachmentFromPayload(value.attachment, conversationUid, request, env) : null;
  const stickerId = String(value?.sticker?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  const sticker = stickerId ? { id: stickerId } : null;
  if (!text && !attachment && !sticker) {
    throw apiError("אי אפשר לשלוח הודעה ריקה.", 400, "empty_chat_message");
  }
  const now = Date.now();
  return {
    id: chatMessageId(value.id),
    text,
    direction,
    sender: String(actor.account?.displayName || actor.email || (isSuperAdmin ? "מנהל הגלריה" : "משתמש")).slice(0, 160),
    senderUid: actor.uid,
    recipientUid: isSuperAdmin ? conversationUid : "gallery-admin",
    sentAt: now,
    read: !isSuperAdmin,
    readAt: isSuperAdmin ? null : now,
    readByAdmin: isSuperAdmin,
    readByAdminAt: isSuperAdmin ? now : null,
    attachment,
    sticker,
    allowReply: true
  };
}

function chatMessageTime(message) {
  const numeric = Number(message?.sentAt);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(message?.sentAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pruneChatHistory(messages, now = Date.now()) {
  const cutoff = now - CHAT_HISTORY_RETENTION_MS;
  const seen = new Set();
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message && typeof message === "object")
    .sort((left, right) => chatMessageTime(right) - chatMessageTime(left))
    .filter(message => {
      const id = String(message.id || "");
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      const unread = (message.direction === "user_to_admin" && message.readByAdmin !== true) ||
        (message.direction !== "user_to_admin" && message.read !== true);
      return unread || chatMessageTime(message) >= cutoff;
    })
    .slice(0, CHAT_HISTORY_LIMIT);
}

function chatAttachmentKeys(messages) {
  const keys = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const attachment of [message?.attachment, message?.reply?.attachment]) {
      const key = String(attachment?.key || attachment?.r2Key || "");
      if (key) keys.add(key);
    }
  }
  return keys;
}

async function cleanupRemovedChatAttachments(env, removedKeys) {
  for (const key of removedKeys) {
    try {
      validateObjectKey(key);
      const object = await env.GALLERY_BUCKET.head(key);
      if (!object) continue;
      if (key.startsWith("chat/") || object.customMetadata?.context === "chat") {
        await env.GALLERY_BUCKET.delete(key);
      }
    } catch (error) {
      console.warn("Chat attachment cleanup skipped", String(key).slice(0, 180), error?.message || error);
    }
  }
}

async function handleChatMessages(request, env) {
  await ensureDatabaseSchema(env);
  const actor = await dataActor(request, env);
  const approved = actor.initialAdmin || actor.status === "approved";
  const isSuperAdmin = approved && (actor.initialAdmin || actor.role === "super_admin");
  if (!approved) throw apiError("החשבון עדיין אינו מאושר.", 403, "account_not_approved");

  const payload = await request.json().catch(() => ({}));
  const conversationUid = String(payload.conversationUid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!conversationUid) throw apiError("מזהה השיחה אינו תקין.", 400, "invalid_conversation");
  if (conversationUid !== actor.uid && !isSuperAdmin) {
    throw apiError("אין הרשאה לעדכן את השיחה הזו.", 403, "permission_denied");
  }

  const action = String(payload.action || "");
  if (!["append", "mark_read", "delete"].includes(action)) {
    throw apiError("פעולת הצ׳אט אינה נתמכת.", 400, "invalid_chat_action");
  }

  for (let attempt = 0; attempt < CHAT_MUTATION_MAX_RETRIES; attempt += 1) {
    const row = await env.GALLERY_DB.prepare(
      "SELECT data_json, updated_at FROM gallery_documents WHERE collection_name = 'userProfiles' AND document_id = ?"
    ).bind(conversationUid).first();
    if (!row) throw apiError("פרופיל השיחה לא נמצא.", 404, "conversation_not_found");

    const profile = parseDocumentData(row);
    const originalMessages = Array.isArray(profile.messages) ? profile.messages : [];
    let candidateMessages = originalMessages;

    if (action === "append") {
      const message = sanitizeNewChatMessage(payload.message, actor, conversationUid, request, env);
      const existing = originalMessages.find(item => String(item?.id || "") === message.id);
      candidateMessages = existing ? originalMessages : [message, ...originalMessages];
    } else if (action === "mark_read") {
      const readAt = Date.now();
      candidateMessages = originalMessages.map(message => {
        if (isSuperAdmin && message?.direction === "user_to_admin" && message.readByAdmin !== true) {
          return { ...message, readByAdmin: true, readByAdminAt: readAt };
        }
        if (isSuperAdmin && message?.reply && message.reply.readByAdmin !== true) {
          return { ...message, reply: { ...message.reply, readByAdmin: true, readByAdminAt: readAt } };
        }
        if (!isSuperAdmin && message?.direction !== "user_to_admin" && message.read !== true) {
          return { ...message, read: true, readAt };
        }
        return message;
      });
    } else {
      const messageId = chatMessageId(payload.messageId);
      candidateMessages = originalMessages.filter(message => String(message?.id || "") !== messageId);
    }

    const nextMessages = pruneChatHistory(candidateMessages);
    const nextProfile = {
      ...profile,
      messages: nextMessages,
      ...(action === "append" && !isSuperAdmin ? { supportStatus: "open" } : {})
    };
    const previousUpdatedAt = Number(row.updated_at) || 0;
    const nextUpdatedAt = Math.max(Date.now(), previousUpdatedAt + 1);
    const updateResult = await env.GALLERY_DB.prepare(
      `UPDATE gallery_documents
       SET data_json = ?, updated_at = ?
       WHERE collection_name = 'userProfiles' AND document_id = ? AND updated_at = ?`
    ).bind(JSON.stringify(nextProfile), nextUpdatedAt, conversationUid, previousUpdatedAt).run();

    if (updateResult?.meta?.changes == null || Number(updateResult.meta.changes) === 1) {
      const retainedKeys = chatAttachmentKeys(nextMessages);
      const removedKeys = [...chatAttachmentKeys(originalMessages)].filter(key => !retainedKeys.has(key));
      if (removedKeys.length) await cleanupRemovedChatAttachments(env, removedKeys);
      return json(request, {
        success: true,
        action,
        messages: nextMessages,
        historyLimit: CHAT_HISTORY_LIMIT,
        retentionDays: Math.round(CHAT_HISTORY_RETENTION_MS / 86400000)
      });
    }
  }

  throw apiError("השיחה השתנתה במקביל. נסה שוב.", 409, "chat_write_conflict");
}

async function actorCanAccessLegacyChatAttachment(actor, env, key) {
  if (actor.initialAdmin || actor.role === "super_admin") return true;
  const row = await env.GALLERY_DB.prepare(
    `SELECT 1 AS allowed
     FROM gallery_documents, json_each(gallery_documents.data_json, '$.messages') AS message
     WHERE collection_name = 'userProfiles'
       AND document_id = ?
       AND (
         json_extract(message.value, '$.attachment.key') = ?
         OR json_extract(message.value, '$.attachment.r2Key') = ?
         OR json_extract(message.value, '$.reply.attachment.key') = ?
         OR json_extract(message.value, '$.reply.attachment.r2Key') = ?
       )
     LIMIT 1`
  ).bind(actor.uid, key, key, key, key).first();
  return Boolean(row?.allowed);
}

async function handleDataRequest(request, env, url) {
  await ensureDatabaseSchema(env);
  const parts = url.pathname.slice("/data/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const collectionName = safeDataPart(parts[0], "שם האוסף");
  if (!DATA_COLLECTIONS.has(collectionName)) throw apiError("האוסף המבוקש אינו קיים.", 404, "collection_not_found");
  const documentId = parts[1] ? safeDataPart(parts[1], "מזהה המסמך") : "";
  const actor = await dataActor(request, env);
  assertDataPermission(actor, collectionName, request.method, documentId);

  if (request.method === "GET" && documentId) {
    const row = await env.GALLERY_DB.prepare(
      "SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
    ).bind(collectionName, documentId).first();
    if (!row) throw apiError("המסמך לא נמצא.", 404, "not_found");
    return json(request, { success: true, id: documentId, data: parseDocumentData(row) });
  }

  if (request.method === "GET") {
    const rowLimit = Math.max(1, Math.min(DATA_PAGE_MAX_LIMIT, Number(url.searchParams.get("limit")) || DATA_PAGE_DEFAULT_LIMIT));
    const offset = Math.max(0, Math.trunc(Number(url.searchParams.get("offset")) || 0));
    const orderField = safeDataPart(url.searchParams.get("orderBy") || "updatedAt", "שדה המיון");
    const direction = url.searchParams.get("direction") === "asc" ? "ASC" : "DESC";
    // document_id הוא שובר־שוויון: בלי סדר מלא ויציב, OFFSET על שדה עם ערכים
    // חוזרים עלול להחזיר את אותה שורה בשני עמודים או לדלג על שורה.
    // שורה אחת מעבר לעמוד מגלה אם קיים המשך, בלי שאילתת ספירה נוספת.
    const result = await env.GALLERY_DB.prepare(
      `SELECT document_id, data_json FROM gallery_documents
       WHERE collection_name = ?
       ORDER BY CAST(COALESCE(json_extract(data_json, '$.${orderField}'), 0) AS REAL) ${direction}, document_id ASC
       LIMIT ? OFFSET ?`
    ).bind(collectionName, rowLimit + 1, offset).all();
    const rows = result.results || [];
    const hasMore = rows.length > rowLimit;
    const documents = rows.slice(0, rowLimit).map(row => ({ id: row.document_id, data: parseDocumentData(row) }));
    return json(request, { success: true, documents, offset, limit: rowLimit, hasMore });
  }

  if (request.method === "PUT" && documentId) {
    const payload = await request.json().catch(() => ({}));
    if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      throw apiError("מבנה המסמך אינו תקין.", 400, "invalid_document");
    }
    const existingRow = await env.GALLERY_DB.prepare(
      "SELECT data_json, created_at, updated_at FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
    ).bind(collectionName, documentId).first();
    const existing = parseDocumentData(existingRow);
    let nextData = resolveDataOperations(payload.data, existing);
    if (payload.merge === true) nextData = { ...existing, ...nextData };

    if (collectionName === "activityLogs") {
      if (existingRow && actor.role !== "super_admin") {
        throw apiError("רשומת פעילות קיימת אינה ניתנת לשינוי.", 409, "activity_log_immutable");
      }
      nextData = {
        id: documentId,
        action: String(nextData.action || "activity").slice(0, 60),
        targetType: String(nextData.targetType || "").slice(0, 40),
        targetId: safeDataPart(nextData.targetId || "none", "מזהה יעד"),
        targetName: String(nextData.targetName || "").slice(0, 160),
        details: String(nextData.details || "").slice(0, 400),
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorName: String(actor.account?.displayName || actor.email || "משתמש").slice(0, 160),
        actorRole: actor.role,
        createdAt: existingRow ? (Number(existing.createdAt) || Date.now()) : Date.now()
      };
    }

    if (collectionName === "userProfiles" && documentId === actor.uid && !actor.initialAdmin && actor.role !== "super_admin") {
      nextData = {
        ...nextData,
        uid: actor.uid,
        email: actor.email,
        status: existingRow ? (existing.status || "pending") : "pending",
        role: existingRow ? (existing.role || "viewer") : "viewer"
      };
    }
    if (collectionName === "userProfiles" && actor.initialAdmin && documentId === actor.uid) {
      nextData = { ...nextData, uid: actor.uid, email: actor.email, status: "approved", role: "super_admin" };
    }

    const now = Date.now();
    const ownerUid = String(nextData.uid || nextData.uploadedBy || nextData.requestedBy || nextData.actorUid || actor.uid).slice(0, 120);
    if (existingRow) {
      const nextUpdatedAt = Math.max(now, (Number(existingRow.updated_at) || 0) + 1);
      const result = await env.GALLERY_DB.prepare(
        `UPDATE gallery_documents
         SET data_json = ?, owner_uid = ?, updated_at = ?
         WHERE collection_name = ? AND document_id = ? AND updated_at = ?`
      ).bind(
        JSON.stringify(nextData), ownerUid, nextUpdatedAt,
        collectionName, documentId, Number(existingRow.updated_at) || 0
      ).run();
      if (result?.meta?.changes != null && Number(result.meta.changes) !== 1) {
        throw apiError("המסמך השתנה במקביל. רענן ונסה שוב.", 409, "document_write_conflict");
      }
    } else {
      const result = await env.GALLERY_DB.prepare(
        `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection_name, document_id) DO NOTHING`
      ).bind(collectionName, documentId, JSON.stringify(nextData), ownerUid, now, now).run();
      if (result?.meta?.changes != null && Number(result.meta.changes) !== 1) {
        throw apiError("המסמך נוצר במקביל. רענן ונסה שוב.", 409, "document_write_conflict");
      }
    }
    if (collectionName === "userProfiles") {
      await updateUserEmailIndex(env, documentId, nextData.email, now);
    }
    return json(request, { success: true, id: documentId, data: nextData });
  }

  if (request.method === "DELETE" && documentId) {
    await env.GALLERY_DB.prepare(
      "DELETE FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
    ).bind(collectionName, documentId).run();
    if (collectionName === "userProfiles") {
      await env.GALLERY_DB.prepare("DELETE FROM user_email_index WHERE document_id = ?").bind(documentId).run();
    }
    // מחיקת תמונה מוחקת גם את כל טביעות הפנים שלה, כדי שחיפוש לא יחזיר מזהה שנמחק.
    if (collectionName === "images") {
      await deleteFaceIndexForImage(env, documentId);
    } else if (collectionName === "pendingImages" && !(await hasActiveImageDocument(env, documentId))) {
      // תמונה שאושרה שומרת את אותו מזהה גם באוסף images. ניקוי הרשומה
      // הממתינה שלה אינו אמור למחוק את הטביעות של התמונה הפעילה.
      await deleteFaceIndexForImage(env, documentId);
    }
    return json(request, { success: true, id: documentId });
  }

  throw apiError("הפעולה אינה נתמכת.", 405, "method_not_allowed");
}

function safeImageId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) throw apiError("מזהה התמונה אינו תקין.", 400, "invalid_image_id");
  return id;
}

function validateObjectKey(value, requiredState = "") {
  const key = String(value || "");
  const galleryMatch = key.match(/^(approved|pending)\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,120})\.([a-z0-9]{1,10})$/);
  const chatMatch = key.match(/^chat\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,120})\.([a-z0-9]{1,10})$/);
  const extension = galleryMatch?.[4] || chatMatch?.[4] || "";
  const state = galleryMatch?.[1] || (chatMatch ? "chat" : "");
  if (
    (!galleryMatch && !chatMatch) ||
    (requiredState && state !== requiredState) ||
    !ALLOWED_MEDIA_EXTENSIONS.has(extension)
  ) {
    throw apiError("מזהה הקובץ אינו תקין.", 400, "invalid_object_key");
  }
  return key;
}

function decodeObjectKey(pathname, prefix) {
  const encoded = pathname.slice(prefix.length);
  if (!encoded) throw apiError("חסר מזהה קובץ.", 400, "missing_object_key");
  let key = encoded;
  try {
    for (let pass = 0; pass < 4; pass += 1) {
      const decoded = decodeURIComponent(key);
      if (decoded === key) break;
      key = decoded;
    }
  } catch {
    throw apiError("מזהה הקובץ אינו תקין.", 400, "invalid_object_key");
  }
  if (/%[0-9a-f]{2}/i.test(key) || /[\\\0-\x1f\x7f]/.test(key)) {
    throw apiError("מזהה הקובץ אינו תקין.", 400, "invalid_object_key");
  }
  return validateObjectKey(key);
}

function publicApiOrigin(request, env) {
  let origin;
  try {
    origin = env.PUBLIC_API_ORIGIN
      ? new URL(String(env.PUBLIC_API_ORIGIN).trim()).origin
      : new URL(request.url).origin;
  } catch {
    throw apiError("כתובת שירות המדיה אינה מוגדרת נכון.", 500, "invalid_public_api_origin");
  }
  if (!origin.startsWith("https://")) {
    throw apiError("כתובת שירות המדיה חייבת להיות מאובטחת.", 500, "invalid_public_api_origin");
  }
  return origin;
}

function mediaUrl(request, key, env) {
  const origin = publicApiOrigin(request, env);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${origin}/media/${encodedKey}`;
}

function requireDriveOAuthConfig(env) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw apiError("חיבור Google Drive הקבוע עדיין לא הוגדר ב-Worker.", 503, "drive_oauth_not_configured");
  }
  return { clientId, clientSecret };
}

function driveRedirectUri(request, env) {
  return String(env.GOOGLE_DRIVE_REDIRECT_URI || `${new URL(request.url).origin}/drive/oauth/callback`).trim();
}

function driveSiteUrl(env, status = "connected") {
  const siteUrl = new URL(String(env.GOOGLE_DRIVE_SITE_URL || DEFAULT_DRIVE_SITE_URL).trim());
  siteUrl.searchParams.set("drive", status);
  return siteUrl.toString();
}

function randomUrlSafeToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function driveCredentialKey(uid) {
  const safeUid = String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!safeUid) throw apiError("מזהה המשתמש אינו תקין.", 400, "invalid_user_id");
  return `private/drive-oauth/credentials/${safeUid}.json`;
}

function driveStateKey(state) {
  const safeState = String(state || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!safeState) throw apiError("מצב OAuth אינו תקין.", 400, "invalid_oauth_state");
  return `private/drive-oauth/states/${safeState}.json`;
}

async function readPrivateJson(env, key) {
  const object = await env.GALLERY_BUCKET.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch (error) {
    console.error("Invalid private JSON object", key, error);
    return null;
  }
}

async function writePrivateJson(env, key, value) {
  await env.GALLERY_BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" }
  });
}

async function exchangeGoogleToken(body, env) {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    console.error("Google OAuth token exchange failed", payload?.error || response.status);
    const code = payload?.error === "invalid_grant" ? "drive_authorization_expired" : "drive_token_exchange_failed";
    throw apiError(
      payload?.error === "invalid_grant"
        ? "הרשאת Google Drive בוטלה או פגה. יש לחבר את Drive פעם נוספת."
        : "Google לא השלימה את חיבור Drive.",
      payload?.error === "invalid_grant" ? 401 : 502,
      code
    );
  }
  return payload;
}

async function startDriveOAuth(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  const { clientId } = requireDriveOAuthConfig(env);
  const state = randomUrlSafeToken();
  await writePrivateJson(env, driveStateKey(state), {
    uid: user.uid,
    email: user.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + DRIVE_STATE_TTL_MS
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(request, env),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    state,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    login_hint: user.email
  });
  return json(request, {
    success: true,
    authorizationUrl: `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    redirectUri: driveRedirectUri(request, env)
  });
}

async function finishDriveOAuth(request, env, url) {
  const state = url.searchParams.get("state") || "";
  const key = driveStateKey(state);
  const savedState = await readPrivateJson(env, key);
  await env.GALLERY_BUCKET.delete(key);

  if (!savedState || Number(savedState.expiresAt) < Date.now()) {
    return Response.redirect(driveSiteUrl(env, "state_error"), 302);
  }
  if (url.searchParams.get("error")) {
    return Response.redirect(driveSiteUrl(env, "cancelled"), 302);
  }

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(driveSiteUrl(env, "failed"), 302);
  try {
    const { clientId, clientSecret } = requireDriveOAuthConfig(env);
    const token = await exchangeGoogleToken({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: driveRedirectUri(request, env),
      grant_type: "authorization_code"
    }, env);
    const existing = await readPrivateJson(env, driveCredentialKey(savedState.uid));
    const refreshToken = token.refresh_token || existing?.refreshToken;
    if (!refreshToken) throw apiError("Google לא החזירה הרשאה קבועה. נסה לחבר את Drive שוב.", 502, "missing_refresh_token");

    await writePrivateJson(env, driveCredentialKey(savedState.uid), {
      refreshToken,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      email: savedState.email,
      scope: token.scope || GOOGLE_DRIVE_SCOPE,
      updatedAt: Date.now()
    });
    return Response.redirect(driveSiteUrl(env, "connected"), 302);
  } catch (error) {
    console.error("Drive OAuth callback failed", error);
    return Response.redirect(driveSiteUrl(env, "failed"), 302);
  }
}

async function getDriveAccessToken(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  const key = driveCredentialKey(user.uid);
  const credential = await readPrivateJson(env, key);
  if (!credential?.refreshToken) {
    return json(request, { success: true, connected: false });
  }

  if (credential.accessToken && Number(credential.expiresAt) > Date.now() + DRIVE_ACCESS_TOKEN_SAFETY_MS) {
    return json(request, {
      success: true,
      connected: true,
      accessToken: credential.accessToken,
      expiresAt: credential.expiresAt,
      email: credential.email || user.email
    });
  }

  const { clientId, clientSecret } = requireDriveOAuthConfig(env);
  try {
    const token = await exchangeGoogleToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token"
    }, env);
    const updatedCredential = {
      ...credential,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      scope: token.scope || credential.scope || GOOGLE_DRIVE_SCOPE,
      updatedAt: Date.now()
    };
    await writePrivateJson(env, key, updatedCredential);
    return json(request, {
      success: true,
      connected: true,
      accessToken: updatedCredential.accessToken,
      expiresAt: updatedCredential.expiresAt,
      email: updatedCredential.email || user.email
    });
  } catch (error) {
    if (error?.code === "drive_authorization_expired") await env.GALLERY_BUCKET.delete(key);
    throw error;
  }
}

async function disconnectDrive(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await env.GALLERY_BUCKET.delete(driveCredentialKey(user.uid));
  return json(request, { success: true, connected: false });
}

async function uploadImage(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  await consumeRateLimit(env, `upload:${user.uid}`, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw apiError("לא צורף קובץ.", 400, "file_missing");
  }

  const mimeType = String(file.type || "application/octet-stream").toLowerCase();
  const originalName = String(file.name || form.get("title") || "קובץ")
    .replace(/[\r\n"\\/]+/g, "-")
    .trim()
    .slice(0, 180) || "קובץ";
  const requestedExtension = originalName.includes(".")
    ? originalName.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)
    : "";
  const isChatAttachment = String(form.get("context") || "") === "chat";
  const isImage = ALLOWED_IMAGE_TYPES.has(mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(mimeType);
  let extension = ALLOWED_IMAGE_TYPES.get(mimeType) || ALLOWED_VIDEO_TYPES.get(mimeType);

  if (!extension && isChatAttachment) {
    extension = ALLOWED_CHAT_FILE_TYPES.get(mimeType);
    if (!extension && mimeType === "application/octet-stream" && ALLOWED_CHAT_EXTENSIONS.has(requestedExtension)) {
      extension = requestedExtension;
    }
  }
  if (!extension) {
    throw apiError(
      isChatAttachment
        ? "סוג הקובץ אינו נתמך. אפשר לצרף תמונות, וידאו, שמע, PDF, מסמכי Office, טקסט וקובצי ZIP."
        : "סוג הקובץ אינו נתמך. אפשר להעלות JPG, PNG, WEBP, GIF, MP4, WEBM או MOV.",
      415,
      "unsupported_file_type"
    );
  }

  const maximumBytes = isChatAttachment
    ? MAX_CHAT_FILE_BYTES
    : (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maximumBytes) {
    throw apiError(
      isChatAttachment
        ? "גודל הקובץ בצ׳אט חייב להיות עד 25MB."
        : (isVideo ? "גודל הסרטון חייב להיות עד 100MB." : "גודל התמונה חייב להיות עד 10MB."),
      413,
      "file_too_large"
    );
  }

  const imageId = safeImageId(form.get("imageId"));
  const title = String(form.get("title") || originalName).trim().slice(0, 120);
  let conversationUid = "";
  if (isChatAttachment) {
    conversationUid = String(form.get("conversationUid") || user.uid)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 160);
    if (!conversationUid) throw apiError("מזהה השיחה אינו תקין.", 400, "invalid_conversation");
    if (!["admin", "super_admin"].includes(user.role) && conversationUid !== user.uid) {
      throw apiError("אין הרשאה לצרף קובץ לשיחה הזו.", 403, "permission_denied");
    }
  }
  const state = isChatAttachment ? "private" : (user.role === "viewer" ? "pending" : "approved");
  const key = isChatAttachment
    ? `chat/${conversationUid}/${user.uid}/${imageId}.${extension}`
    : `${state}/${user.uid}/${imageId}.${extension}`;
  const mediaType = isImage ? "image" : (isVideo ? "video" : (mimeType.startsWith("audio/") ? "audio" : "file"));

  await env.GALLERY_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      ownerUid: user.uid,
      uploaderRole: user.role,
      imageId,
      title,
      originalName,
      mediaType,
      context: isChatAttachment ? "chat" : "gallery",
      conversationUid: isChatAttachment ? conversationUid : "",
      state,
      uploadedAt: new Date().toISOString()
    }
  });

  return json(request, {
    success: true,
    key,
    state,
    mediaType,
    mimeType,
    fileName: originalName,
    size: file.size,
    url: mediaUrl(request, key, env)
  }, 201);
}

async function serveImage(request, env, pathname) {
  const key = decodeObjectKey(pathname, "/media/");
  let pathActor = null;

  if (key.startsWith("chat/")) {
    pathActor = await dataActor(request, env);
    const conversationUid = key.split("/")[1] || "";
    if (pathActor.uid !== conversationUid && !["admin", "super_admin"].includes(pathActor.role)) {
      throw apiError("אין הרשאה לפתוח קובץ מהשיחה הזו.", 403, "permission_denied");
    }
  }

  if (key.startsWith("pending/")) {
    const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
    const ownerUid = key.split("/")[1] || "";
    if (user.uid !== ownerUid && !["admin", "super_admin"].includes(user.role)) {
      throw apiError("אין הרשאה לצפות בתמונה הממתינה.", 403, "permission_denied");
    }
  }

  const rangeHeader = request.headers.get("Range");
  const objectHead = rangeHeader ? await env.GALLERY_BUCKET.head(key) : null;
  let requestedRange = null;
  if (rangeHeader && objectHead) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
    if (match) {
      const size = objectHead.size;
      let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
      let end = match[2] ? Number(match[2]) : size - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && start < size) {
        end = Math.min(end, size - 1);
        requestedRange = { offset: start, length: end - start + 1, total: size };
      }
    }
  }
  const object = await env.GALLERY_BUCKET.get(
    key,
    requestedRange ? { range: { offset: requestedRange.offset, length: requestedRange.length } } : undefined
  );
  if (!object) throw apiError("קובץ המדיה לא נמצא.", 404, "not_found");

  const metadata = object.customMetadata || objectHead?.customMetadata || {};
  const isChatAttachment = key.startsWith("chat/") || metadata.context === "chat";
  if (isChatAttachment && !key.startsWith("chat/")) {
    const actor = pathActor || await dataActor(request, env);
    if (!(await actorCanAccessLegacyChatAttachment(actor, env, key))) {
      throw apiError("אין הרשאה לפתוח את הקובץ הישן הזה.", 403, "permission_denied");
    }
  }

  const headers = new Headers(corsHeaders(request));
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", "bytes");
  if (metadata.mediaType === "file") {
    const downloadName = String(metadata.originalName || metadata.title || "file")
      .replace(/[\r\n"\\/]+/g, "-")
      .slice(0, 180);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  }
  if (requestedRange) {
    headers.set("Content-Range", `bytes ${requestedRange.offset}-${requestedRange.offset + requestedRange.length - 1}/${requestedRange.total}`);
    headers.set("Content-Length", String(requestedRange.length));
  }
  headers.set(
    "Cache-Control",
    key.startsWith("approved/") && !isChatAttachment
      ? "public, max-age=3600, s-maxage=86400"
      : "private, no-store"
  );
  return new Response(object.body, { headers, status: requestedRange ? 206 : 200 });
}

async function approveImage(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  const payload = await request.json().catch(() => ({}));
  const key = validateObjectKey(String(payload.key || ""), "pending");

  const approvedKey = `approved/${key.slice("pending/".length)}`;
  const source = await env.GALLERY_BUCKET.get(key);
  if (!source) {
    const existingApproved = await env.GALLERY_BUCKET.head(approvedKey);
    if (existingApproved) {
      return json(request, {
        success: true,
        key: approvedKey,
        state: "approved",
        url: mediaUrl(request, approvedKey, env)
      });
    }
    throw apiError("קובץ המדיה הממתין לא נמצא.", 404, "not_found");
  }

  await env.GALLERY_BUCKET.put(approvedKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: {
      ...(source.customMetadata || {}),
      state: "approved",
      approvedBy: user.uid,
      approvedAt: new Date().toISOString()
    }  });
  await env.GALLERY_BUCKET.delete(key);

  return json(request, {
    success: true,
    key: approvedKey,
    state: "approved",
    url: mediaUrl(request, approvedKey, env)
  });
}

async function deleteImage(request, env, pathname) {
  const key = decodeObjectKey(pathname, "/media/");
  if (key.startsWith("chat/")) {
    const actor = await dataActor(request, env);
    const conversationUid = key.split("/")[1] || "";
    if (actor.uid !== conversationUid && !["admin", "super_admin"].includes(actor.role)) {
      throw apiError("אין הרשאה למחוק קובץ מהשיחה הזו.", 403, "permission_denied");
    }
  } else {
    await requireUser(request, env, ["super_admin"]);
  }
  await env.GALLERY_BUCKET.delete(key);
  if (!key.startsWith("chat/")) await deleteFaceIndexForDeletedMedia(env, key);
  return json(request, { success: true, key });
}

async function sendEmail(request, env) {
  const user = await requireUser(request, env, ["super_admin"]);
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw apiError("שירות הדוא״ל עדיין לא הוגדר בשרת.", 503, "email_not_configured");
  }
  const payload = await request.json().catch(() => ({}));
  const to = String(payload.to || "").trim().toLowerCase();
  const subject = String(payload.subject || "").trim();
  const textBody = String(payload.text || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) {
    throw apiError("כתובת הדוא״ל של הנמען אינה תקינה.", 400, "invalid_recipient");
  }
  if (subject.length < 1 || subject.length > 160) {
    throw apiError("נושא ההודעה חייב להכיל עד 160 תווים.", 400, "invalid_subject");
  }
  if (textBody.length < 1 || textBody.length > 5000) {
    throw apiError("תוכן ההודעה חייב להכיל עד 5,000 תווים.", 400, "invalid_email_body");
  }
  await consumeRateLimit(env, `email:${user.uid}`, EMAIL_RATE_LIMIT, EMAIL_RATE_WINDOW_MS);

  const idempotencyKey = `gallery-${user.uid}-${crypto.randomUUID()}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from: String(env.EMAIL_FROM).trim(),
      to: [to],
      subject,
      text: textBody,
      reply_to: user.email
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) {
    console.error("Email provider rejected request", response.status, result?.name || result?.message || "unknown");
    throw apiError("ספק הדוא״ל לא הצליח לשלוח את ההודעה.", 502, "email_send_failed");
  }
  return json(request, { success: true, id: result.id });
}

function safeAiSearchImage(value, request, env) {
  const id = safeImageId(value?.id);
  const title = String(value?.title || "תמונה").trim().slice(0, 120);
  const folder = String(value?.folder || "כללי").trim().slice(0, 80);
  const date = String(value?.date || "").trim().slice(0, 20);
  let url;
  try {
    url = new URL(String(value?.url || ""));
  } catch {
    throw apiError("אחת מכתובות התמונות אינה תקינה.", 400, "invalid_image_url");
  }
  if (url.protocol !== "https:") {
    throw apiError("כתובת תמונה חייבת להשתמש בחיבור מאובטח.", 400, "invalid_image_url");
  }
  if (
    url.origin !== publicApiOrigin(request, env) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith("/media/approved/")
  ) {
    throw apiError("חיפוש AI מקבל רק תמונות מאושרות מהגלריה.", 400, "untrusted_image_url");
  }
  const key = decodeObjectKey(url.pathname, "/media/");
  const fileName = key.split("/").pop() || "";
  const extension = fileName.split(".").pop() || "";
  const keyImageId = fileName.slice(0, -(extension.length + 1));
  if (!key.startsWith("approved/") || !ALLOWED_IMAGE_TYPES.has(`image/${extension === "jpg" ? "jpeg" : extension}`) || keyImageId !== id) {
    throw apiError("חיפוש AI מקבל רק תמונות מאושרות שתואמות לרשומת הגלריה.", 400, "untrusted_image_url");
  }
  return { id, title, folder, date, key, url: mediaUrl(request, key, env) };
}

async function consumeRateLimit(
  env,
  bucketKey,
  maximum,
  windowMs,
  limitMessage = "בוצעו יותר מדי חיפושי AI. המתן כמה דקות ונסה שוב.",
  limitCode = "ai_rate_limit_exceeded"
) {
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const cutoff = now - windowMs;
  const row = await env.GALLERY_DB.prepare(
    `INSERT INTO request_rate_limits (bucket_key, window_started_at, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(bucket_key) DO UPDATE SET
       request_count = CASE
         WHEN request_rate_limits.window_started_at <= ? THEN 1
         ELSE request_rate_limits.request_count + 1
       END,
       window_started_at = CASE
         WHEN request_rate_limits.window_started_at <= ? THEN excluded.window_started_at
         ELSE request_rate_limits.window_started_at
       END
     RETURNING request_count, window_started_at`
  ).bind(bucketKey, now, cutoff, cutoff).first();
  if (!row || Number(row.request_count) > maximum) {
    throw apiError(limitMessage, 429, limitCode);
  }
}

function extractOpenAIOutputText(payload) {
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

async function aiImageSearch(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  if (!env.OPENAI_API_KEY) {
    throw apiError("חיפוש ה־AI עדיין לא הוגדר בשרת.", 503, "openai_key_missing");
  }

  const payload = await request.json().catch(() => ({}));
  const query = String(payload.query || "").trim().slice(0, 240);
  if (query.length < 3) {
    throw apiError("יש לכתוב תיאור באורך של שלוש אותיות לפחות.", 400, "query_too_short");
  }
  if (!Array.isArray(payload.images) || payload.images.length === 0 || payload.images.length > 20) {
    throw apiError("ניתן לסרוק בין תמונה אחת לעשרים תמונות בכל קבוצה.", 400, "invalid_image_batch");
  }

  const images = payload.images.map(image => safeAiSearchImage(image, request, env));
  await consumeRateLimit(env, `ai-search:${user.uid}`, AI_SEARCH_RATE_LIMIT, AI_SEARCH_RATE_WINDOW_MS);
  await Promise.all(images.map(async image => {
    const object = await env.GALLERY_BUCKET.head(image.key);
    if (
      !object ||
      (object.customMetadata?.state && object.customMetadata.state !== "approved") ||
      (object.customMetadata?.mediaType && object.customMetadata.mediaType !== "image")
    ) {
      throw apiError("אחת התמונות אינה קיימת בגלריה המאושרת.", 400, "unapproved_image");
    }
  }));
  const knownIds = new Set(images.map(image => image.id));
  const content = [{
    type: "input_text",
    text: `מצא אילו תמונות מתאימות לבקשת החיפוש הבאה בעברית: "${query}". החזר רק מזהים של תמונות שיש להן התאמה חזותית ברורה או סבירה. אל תחזיר תמונה רק בגלל שם הקובץ.`
  }];

  images.forEach(image => {
    content.push({
      type: "input_text",
      text: `IMAGE_ID=${image.id}; כותרת=${image.title}; תיקייה=${image.folder}; תאריך=${image.date || "לא ידוע"}`
    });
    content.push({
      type: "input_image",
      image_url: image.url,
      detail: "low"
    });
  });

  const openAIResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      store: false,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "gallery_image_search",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              matches: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["matches"]
          }
        }
      }
    })
  });

  const openAIPayload = await openAIResponse.json().catch(() => ({}));
  if (!openAIResponse.ok) {
    const upstreamCode = String(openAIPayload?.error?.code || "unknown");
    console.error("OpenAI search request failed", openAIResponse.status, upstreamCode);

    if (openAIResponse.status === 401) {
      throw apiError("מפתח OpenAI אינו תקין או בוטל. יש להחליף אותו ב־Cloudflare.", 503, "openai_invalid_key");
    }
    if (openAIResponse.status === 429 && upstreamCode === "insufficient_quota") {
      throw apiError("לחשבון OpenAI API אין כרגע יתרה זמינה. יש לבדוק חיוב ומכסה בחשבון OpenAI.", 503, "openai_quota_exhausted");
    }
    if (openAIResponse.status === 429) {
      throw apiError("חיפוש ה־AI עמוס כרגע. המתן מעט ונסה שוב.", 429, "openai_rate_limited");
    }
    if (openAIResponse.status === 403) {
      throw apiError("למפתח OpenAI אין הרשאה להשתמש במודל החיפוש.", 503, "openai_model_forbidden");
    }
    if (openAIResponse.status === 404 || upstreamCode === "model_not_found") {
      throw apiError("מודל חיפוש ה־AI אינו זמין לפרויקט הזה.", 503, "openai_model_unavailable");
    }
    if (openAIResponse.status === 400) {
      throw apiError("הגדרת בקשת חיפוש ה־AI אינה נתמכת כרגע.", 502, "openai_invalid_request");
    }
    throw apiError("מנוע חיפוש ה־AI אינו זמין כרגע.", 502, "openai_request_failed");
  }

  let parsed;
  try {
    parsed = JSON.parse(extractOpenAIOutputText(openAIPayload));
  } catch {
    throw apiError("מנוע ה־AI החזיר תשובה לא תקינה.", 502, "invalid_openai_response");
  }
  const matches = Array.isArray(parsed?.matches)
    ? [...new Set(parsed.matches.map(safeImageId).filter(id => knownIds.has(id)))]
    : [];

  return json(request, { success: true, matches });
}

// --- אינדוקס וחיפוש של טביעות פנים ---
// אף נקודת קצה כאן אינה מחזירה descriptor ללקוח ואינה כותבת אותו ליומן.

function faceModelVersion(value) {
  const version = String(value || FACE_MODEL_VERSION).trim();
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(version)) {
    throw apiError("גרסת מודל הפנים אינה תקינה.", 400, "invalid_model_version");
  }
  return version;
}

// אימות מלא של הטביעה: בדיוק 128 מספרים סופיים, כל אחד בטווח סביר,
// ואורך הווקטור כולו בטווח של תוצאת זיהוי פנים אמיתית.
function parseFaceDescriptor(value) {
  if (!Array.isArray(value) || value.length !== FACE_DESCRIPTOR_LENGTH) {
    throw apiError(`טביעת פנים חייבת להכיל בדיוק ${FACE_DESCRIPTOR_LENGTH} מספרים.`, 400, "invalid_face_descriptor");
  }
  const descriptor = new Float64Array(FACE_DESCRIPTOR_LENGTH);
  let squaredNorm = 0;
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const component = value[index];
    if (typeof component !== "number" || !Number.isFinite(component) || Math.abs(component) > FACE_DESCRIPTOR_MAX_COMPONENT) {
      throw apiError("טביעת הפנים מכילה ערך שאינו מספר סופי בטווח הצפוי.", 400, "invalid_face_descriptor");
    }
    descriptor[index] = component;
    squaredNorm += component * component;
  }
  const norm = Math.sqrt(squaredNorm);
  if (norm < FACE_DESCRIPTOR_MIN_NORM || norm > FACE_DESCRIPTOR_MAX_NORM) {
    throw apiError("טביעת הפנים אינה בטווח של תוצאת זיהוי פנים.", 400, "invalid_face_descriptor");
  }
  return descriptor;
}

function serializeFaceDescriptor(descriptor) {
  // שש ספרות אחרי הנקודה שומרות על דיוק ההשוואה ומקצרות את השורה במסד.
  return JSON.stringify(Array.from(descriptor, component => Math.round(component * 1e6) / 1e6));
}

function deserializeFaceDescriptor(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value || ""));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== FACE_DESCRIPTOR_LENGTH) return null;
  const descriptor = new Float64Array(FACE_DESCRIPTOR_LENGTH);
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const component = Number(parsed[index]);
    if (!Number.isFinite(component)) return null;
    descriptor[index] = component;
  }
  return descriptor;
}

// אותה נוסחה ששימשה בהשוואה בדפדפן, כדי שאחוזי ההתאמה לא ישתנו למשתמש.
function faceMatchConfidence(distance) {
  return Math.max(0, Math.min(100, Math.round((1 - distance / FACE_MATCH_THRESHOLD) * 55 + 45)));
}

function faceImageIdFromObjectKey(key) {
  const fileName = String(key || "").split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  const imageId = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return /^[a-zA-Z0-9_-]{1,120}$/.test(imageId) ? imageId : "";
}

async function deleteFaceIndexForImage(env, imageId) {
  const safeId = String(imageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!safeId) return;
  await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors WHERE image_id = ?").bind(safeId).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state WHERE image_id = ?").bind(safeId).run();
}

async function hasActiveImageDocument(env, imageId) {
  const row = await env.GALLERY_DB.prepare(
    "SELECT 1 AS found FROM gallery_documents WHERE collection_name = 'images' AND document_id = ?"
  ).bind(imageId).first();
  return Boolean(row);
}

async function deleteFaceIndexForDeletedMedia(env, key) {
  const imageId = faceImageIdFromObjectKey(key);
  if (!imageId) return;
  // קובץ ממתין של תמונה שכבר אושרה אינו מוחק את הטביעות של התמונה הפעילה.
  if (key.startsWith("pending/") && await hasActiveImageDocument(env, imageId)) return;
  await deleteFaceIndexForImage(env, imageId);
}

// כתיבת טביעות מותרת למנהל מחובר או לתהליך אינדוקס עם אסימון ייעודי.
async function requireFaceIndexWriter(request, env) {
  const configuredToken = String(env.FACE_INDEX_TOKEN || "").trim();
  const providedToken = String(request.headers.get("X-Face-Index-Token") || "").trim();
  if (configuredToken && providedToken) {
    const [expectedHash, providedHash] = await Promise.all([
      sha256(configuredToken, { normalize: false }),
      sha256(providedToken, { normalize: false })
    ]);
    if (!constantTimeHexEqual(expectedHash, providedHash)) {
      throw apiError("אסימון תהליך האינדוקס אינו תקין.", 403, "invalid_index_token");
    }
    return { uid: "face-index-process", role: "indexer" };
  }
  return await requireUser(request, env, ["admin", "super_admin"]);
}

async function readFaceIndexStates(env, imageIds) {
  const states = new Map();
  for (let offset = 0; offset < imageIds.length; offset += FACE_ID_QUERY_CHUNK) {
    const chunk = imageIds.slice(offset, offset + FACE_ID_QUERY_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await env.GALLERY_DB.prepare(
      `SELECT image_id, model_version, status, face_count, attempts
       FROM image_face_index_state WHERE image_id IN (${placeholders})`
    ).bind(...chunk).all();
    for (const row of result.results || []) states.set(String(row.image_id), row);
  }
  return states;
}

// תמונה נחשבת מטופלת אם היא אונדקסה בגרסת המודל הנוכחית. החלפת גרסה או
// כישלון שטרם מיצה את מספר הניסיונות מחזירים אותה לתור.
function faceIndexNeedsWork(state, modelVersion) {
  if (!state) return true;
  if (String(state.model_version) !== modelVersion) return true;
  if (String(state.status) === "failed" && (Number(state.attempts) || 0) < FACE_INDEX_MAX_ATTEMPTS) return true;
  return false;
}

async function faceIndexSummary(env, modelVersion) {
  const totalRow = await env.GALLERY_DB.prepare(
    `SELECT COUNT(*) AS total FROM gallery_documents
     WHERE collection_name = 'images'
       AND (json_valid(data_json) = 0 OR COALESCE(json_extract(data_json, '$.mediaType'), 'image') <> 'video')`
  ).first();
  const stateRow = await env.GALLERY_DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) AS indexed_images,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_images,
       SUM(CASE WHEN status = 'failed' AND attempts >= ? THEN 1 ELSE 0 END) AS abandoned_images,
       COALESCE(MAX(updated_at), 0) AS updated_at
     FROM image_face_index_state WHERE model_version = ?`
  ).bind(FACE_INDEX_MAX_ATTEMPTS, modelVersion).first();
  const faceRow = await env.GALLERY_DB.prepare(
    "SELECT COUNT(*) AS face_count FROM image_face_descriptors WHERE model_version = ?"
  ).bind(modelVersion).first();

  const totalImages = Number(totalRow?.total) || 0;
  const indexedImages = Number(stateRow?.indexed_images) || 0;
  const failedImages = Number(stateRow?.failed_images) || 0;
  const abandonedImages = Number(stateRow?.abandoned_images) || 0;
  const processedImages = Math.min(totalImages, indexedImages + abandonedImages);
  return {
    modelVersion,
    totalImages,
    indexedImages,
    failedImages,
    faceCount: Number(faceRow?.face_count) || 0,
    remainingImages: Math.max(0, totalImages - processedImages),
    ready: totalImages - processedImages <= 0,
    updatedAt: Number(stateRow?.updated_at) || 0
  };
}

// D1 מריץ batch כטרנזקציה אחת. בסביבה שאין בה batch מריצים ברצף.
async function runDatabaseStatements(env, statements) {
  if (!statements.length) return;
  if (typeof env.GALLERY_DB.batch === "function") {
    await env.GALLERY_DB.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

async function saveFaceIndexBatch(request, env) {
  const actor = await requireFaceIndexWriter(request, env);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const modelVersion = faceModelVersion(payload.modelVersion);
  const entries = Array.isArray(payload.images)
    ? payload.images
    : (payload.imageId ? [payload] : []);
  if (!entries.length || entries.length > FACE_INDEX_MAX_IMAGES_PER_REQUEST) {
    throw apiError(
      `יש לשלוח בין תמונה אחת ל-${FACE_INDEX_MAX_IMAGES_PER_REQUEST} תמונות בכל בקשת אינדוקס.`,
      400,
      "invalid_face_index_batch"
    );
  }
  await consumeRateLimit(
    env,
    `face-index:${actor.uid}`,
    FACE_INDEX_RATE_LIMIT,
    FACE_INDEX_RATE_WINDOW_MS,
    "בוצעו יותר מדי בקשות אינדוקס פנים. המתן מעט ונסה שוב.",
    "face_index_rate_limit_exceeded"
  );

  const imageIds = entries.map(entry => safeImageId(entry?.imageId));
  const existingStates = await readFaceIndexStates(env, imageIds);
  const now = Date.now();
  const statements = [];
  const saved = [];

  // כל האימותים מתבצעים לפני הכתיבה, כדי שבקשה עם טביעה פסולה לא תשאיר
  // חצי אינדוקס במסד.
  entries.forEach((entry, position) => {
    const imageId = imageIds[position];
    const previous = existingStates.get(imageId);

    if (entry?.status === "failed") {
      const attempts = Math.min(FACE_INDEX_MAX_ATTEMPTS, (Number(previous?.attempts) || 0) + 1);
      const errorCode = String(entry?.errorCode || "face_index_failed").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      statements.push(env.GALLERY_DB.prepare(
        `INSERT INTO image_face_index_state (image_id, model_version, status, face_count, attempts, error_code, created_at, updated_at)
         VALUES (?, ?, 'failed', 0, ?, ?, ?, ?)
         ON CONFLICT(image_id) DO UPDATE SET
           model_version = excluded.model_version,
           status = excluded.status,
           face_count = 0,
           attempts = excluded.attempts,
           error_code = excluded.error_code,
           updated_at = excluded.updated_at`
      ).bind(imageId, modelVersion, attempts, errorCode, now, now));
      saved.push({ imageId, status: "failed", faceCount: 0, attempts });
      return;
    }

    const faces = Array.isArray(entry?.faces) ? entry.faces : [];
    if (faces.length > FACE_INDEX_MAX_FACES_PER_IMAGE) {
      throw apiError(`אפשר לשמור עד ${FACE_INDEX_MAX_FACES_PER_IMAGE} פרצופים לתמונה.`, 400, "too_many_faces");
    }
    const descriptors = faces.map(parseFaceDescriptor);

    // שורות ישנות שנותרו מריצה קודמת עם יותר פרצופים נמחקות; השאר מתעדכנות
    // במקום, כך שתאריך היצירה המקורי נשמר.
    statements.push(env.GALLERY_DB.prepare(
      "DELETE FROM image_face_descriptors WHERE image_id = ? AND face_index >= ?"
    ).bind(imageId, descriptors.length));
    descriptors.forEach((descriptor, faceIndex) => {
      statements.push(env.GALLERY_DB.prepare(
        `INSERT INTO image_face_descriptors (image_id, face_index, descriptor_json, model_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(image_id, face_index) DO UPDATE SET
           descriptor_json = excluded.descriptor_json,
           model_version = excluded.model_version,
           updated_at = excluded.updated_at`
      ).bind(imageId, faceIndex, serializeFaceDescriptor(descriptor), modelVersion, now, now));
    });
    statements.push(env.GALLERY_DB.prepare(
      `INSERT INTO image_face_index_state (image_id, model_version, status, face_count, attempts, error_code, created_at, updated_at)
       VALUES (?, ?, 'indexed', ?, 0, '', ?, ?)
       ON CONFLICT(image_id) DO UPDATE SET
         model_version = excluded.model_version,
         status = excluded.status,
         face_count = excluded.face_count,
         attempts = 0,
         error_code = '',
         updated_at = excluded.updated_at`
    ).bind(imageId, modelVersion, descriptors.length, now, now));
    saved.push({ imageId, status: "indexed", faceCount: descriptors.length });
  });

  await runDatabaseStatements(env, statements);
  return json(request, { success: true, modelVersion, saved });
}

async function faceIndexPendingImages(request, env) {
  const actor = await requireFaceIndexWriter(request, env);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const modelVersion = faceModelVersion(payload.modelVersion);
  const requestedIds = Array.isArray(payload.imageIds) ? payload.imageIds : [];
  if (!requestedIds.length || requestedIds.length > FACE_INDEX_PENDING_MAX_IDS) {
    throw apiError(
      `יש לשלוח בין מזהה אחד ל-${FACE_INDEX_PENDING_MAX_IDS} מזהי תמונות בכל בדיקה.`,
      400,
      "invalid_face_index_batch"
    );
  }
  await consumeRateLimit(
    env,
    `face-index:${actor.uid}`,
    FACE_INDEX_RATE_LIMIT,
    FACE_INDEX_RATE_WINDOW_MS,
    "בוצעו יותר מדי בקשות אינדוקס פנים. המתן מעט ונסה שוב.",
    "face_index_rate_limit_exceeded"
  );

  const uniqueIds = [...new Set(requestedIds.map(safeImageId))];
  const states = await readFaceIndexStates(env, uniqueIds);
  const pending = uniqueIds.filter(imageId => faceIndexNeedsWork(states.get(imageId), modelVersion));
  return json(request, {
    success: true,
    modelVersion,
    pending,
    requested: uniqueIds.length,
    skipped: uniqueIds.length - pending.length
  });
}

async function faceIndexSummaryRequest(request, env, url) {
  await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const modelVersion = faceModelVersion(url.searchParams.get("modelVersion"));
  return json(request, { success: true, ...(await faceIndexSummary(env, modelVersion)) });
}

// איפוס יזום לפני אינדוקס מחדש, למשל אחרי החלפת גרסת מודל.
async function resetFaceIndex(request, env) {
  await requireUser(request, env, ["super_admin"]);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const clearEverything = payload?.scope === "all";
  if (clearEverything) {
    await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors").run();
    await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state").run();
    return json(request, { success: true, scope: "all" });
  }
  const modelVersion = faceModelVersion(payload?.modelVersion);
  await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors WHERE model_version = ?").bind(modelVersion).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state WHERE model_version = ?").bind(modelVersion).run();
  return json(request, { success: true, scope: "model", modelVersion });
}

async function filterExistingImageIds(env, imageIds) {
  const existing = new Set();
  for (let offset = 0; offset < imageIds.length; offset += FACE_ID_QUERY_CHUNK) {
    const chunk = imageIds.slice(offset, offset + FACE_ID_QUERY_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await env.GALLERY_DB.prepare(
      `SELECT document_id FROM gallery_documents
       WHERE collection_name = 'images' AND document_id IN (${placeholders})`
    ).bind(...chunk).all();
    for (const row of result.results || []) existing.add(String(row.document_id));
  }
  return existing;
}

// ההשוואה כולה מתבצעת כאן. ללקוח חוזרים רק מזהי תמונות, מרחק ואחוז התאמה.
async function faceSearch(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const modelVersion = faceModelVersion(payload.modelVersion);
  const queryDescriptor = parseFaceDescriptor(payload.descriptor);
  const requestedLimit = Math.trunc(Number(payload.limit) || FACE_SEARCH_DEFAULT_LIMIT);
  const resultLimit = Math.max(1, Math.min(FACE_SEARCH_MAX_LIMIT, requestedLimit));
  await consumeRateLimit(
    env,
    `face-search:${user.uid}`,
    FACE_SEARCH_RATE_LIMIT,
    FACE_SEARCH_RATE_WINDOW_MS,
    "בוצעו יותר מדי חיפושי פנים. המתן כמה דקות ונסה שוב.",
    "face_search_rate_limit_exceeded"
  );

  const squaredThreshold = FACE_MATCH_THRESHOLD * FACE_MATCH_THRESHOLD;
  const bestSquaredDistances = new Map();
  let scannedFaces = 0;

  for (let offset = 0; offset < FACE_DESCRIPTOR_SCAN_LIMIT; offset += FACE_DESCRIPTOR_PAGE_SIZE) {
    const page = await env.GALLERY_DB.prepare(
      `SELECT image_id, descriptor_json FROM image_face_descriptors
       WHERE model_version = ?
       ORDER BY image_id, face_index
       LIMIT ? OFFSET ?`
    ).bind(modelVersion, FACE_DESCRIPTOR_PAGE_SIZE, offset).all();
    const rows = page.results || [];

    for (const row of rows) {
      const storedDescriptor = deserializeFaceDescriptor(row.descriptor_json);
      if (!storedDescriptor) continue;
      // עוצרים ברגע שהמרחק כבר גדול מהסף — אין צורך לסיים את כל 128 המימדים.
      let squaredDistance = 0;
      for (let index = 0; index < FACE_DESCRIPTOR_LENGTH && squaredDistance < squaredThreshold; index += 1) {
        const difference = queryDescriptor[index] - storedDescriptor[index];
        squaredDistance += difference * difference;
      }
      if (squaredDistance >= squaredThreshold) continue;
      const imageId = String(row.image_id);
      const previousBest = bestSquaredDistances.get(imageId);
      if (previousBest === undefined || squaredDistance < previousBest) {
        bestSquaredDistances.set(imageId, squaredDistance);
      }
    }

    scannedFaces += rows.length;
    if (rows.length < FACE_DESCRIPTOR_PAGE_SIZE) break;
  }

  const ranked = [...bestSquaredDistances.entries()]
    .sort((left, right) => left[1] - right[1])
    .slice(0, resultLimit);
  // רשת ביטחון: תמונה שנמחקה בזמן שהטביעות שלה עדיין קיימות לא תוחזר.
  const existingImageIds = await filterExistingImageIds(env, ranked.map(([imageId]) => imageId));
  const matches = ranked
    .filter(([imageId]) => existingImageIds.has(imageId))
    .map(([imageId, squaredDistance]) => {
      const distance = Math.sqrt(squaredDistance);
      return {
        imageId,
        distance: Math.round(distance * 10000) / 10000,
        confidence: faceMatchConfidence(distance),
        strength: distance < FACE_STRONG_MATCH_THRESHOLD ? "strong" : "possible"
      };
    });

  const coverage = await faceIndexSummary(env, modelVersion);
  return json(request, {
    success: true,
    modelVersion,
    matches,
    scannedFaces,
    thresholds: { match: FACE_MATCH_THRESHOLD, strong: FACE_STRONG_MATCH_THRESHOLD },
    coverage: {
      totalImages: coverage.totalImages,
      indexedImages: coverage.indexedImages,
      remainingImages: coverage.remainingImages,
      failedImages: coverage.failedImages,
      ready: coverage.ready
    }
  });
}

async function serveFaceAsset(request, env, pathname) {
  let assetPath;
  try {
    assetPath = decodeURIComponent(pathname.slice("/face-assets/".length));
  } catch {    throw apiError("כתובת נכס זיהוי הפנים אינה תקינה.", 400, "invalid_face_asset");
  }

  const asset = FACE_ASSETS.get(assetPath);
  if (!asset) {
    throw apiError("נכס זיהוי הפנים לא נמצא.", 404, "face_asset_not_found");
  }

  const cacheKey = `system/face-api/${FACE_API_VERSION}/${assetPath}`;
  let body;
  let contentType = asset.contentType;
  const cached = await env.GALLERY_BUCKET.get(cacheKey);

  if (cached) {
    body = cached.body;
    contentType = cached.httpMetadata?.contentType || contentType;
  } else {
    const upstreamUrl = `${FACE_API_CDN_BASE}/${asset.upstreamPath}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { "User-Agent": "simchas-gallery-worker/1.0" }
    });
    if (!upstream.ok) {
      throw apiError("לא ניתן לטעון את מנוע זיהוי הפנים.", 502, "face_asset_upstream_failed");
    }
    const bytes = await upstream.arrayBuffer();
    await env.GALLERY_BUCKET.put(cacheKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        source: upstreamUrl,
        cachedAt: new Date().toISOString()
      }
    });
    body = bytes;
  }

  return new Response(body, {
    headers: {
      ...corsHeaders(request),
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (!env.GALLERY_BUCKET) {
        throw apiError("החיבור לדלי R2 אינו מוגדר.", 500, "bucket_binding_missing");
      }

      const url = new URL(request.url);
      if (url.pathname.startsWith("/data/")) {
        return await handleDataRequest(request, env, url);
      }
      if (request.method === "GET" && url.pathname === "/drive/oauth/callback") {
        return await finishDriveOAuth(request, env, url);
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        const result = await env.GALLERY_BUCKET.list({ limit: 1 });
        await ensureDatabaseSchema(env);
        await env.GALLERY_DB.prepare("SELECT 1 AS connected").first();
        return json(request, {
          success: true,
          service: "simchas-gallery-api",
          version: "2026-08-13-cloudflare-d1-face-index",
          features: [
            "cloudflare-d1", "google-auth", "r2-media", "chat-attachments",
            "persistent-drive-oauth", "cloud-face-index"
          ],
          faceModelVersion: FACE_MODEL_VERSION,
          databaseConnected: true,
          bucketConnected: true,
          objectsFound: result.objects.length
        });
      }
      if (request.method === "POST" && url.pathname === "/auth/session") {
        return await establishGoogleSession(request, env);
      }
      if (request.method === "POST" && url.pathname === "/chat/messages") {
        return await handleChatMessages(request, env);
      }
      if (request.method === "POST" && url.pathname === "/upload") {
        return await uploadImage(request, env);
      }
      if (request.method === "POST" && url.pathname === "/approve") {
        return await approveImage(request, env);
      }
      if (request.method === "POST" && url.pathname === "/ai-search") {
        return await aiImageSearch(request, env);
      }
      if (request.method === "POST" && url.pathname === "/send-email") {
        return await sendEmail(request, env);
      }
      if (request.method === "POST" && url.pathname === "/drive/oauth/start") {
        return await startDriveOAuth(request, env);
      }
      if (request.method === "POST" && url.pathname === "/drive/token") {
        return await getDriveAccessToken(request, env);
      }
      if (request.method === "DELETE" && url.pathname === "/drive/connection") {
        return await disconnectDrive(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/search") {
        return await faceSearch(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/index") {
        return await saveFaceIndexBatch(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/index/pending") {
        return await faceIndexPendingImages(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/index/reset") {
        return await resetFaceIndex(request, env);
      }
      if (request.method === "GET" && url.pathname === "/face/index/summary") {
        return await faceIndexSummaryRequest(request, env, url);
      }
      if (request.method === "GET" && url.pathname.startsWith("/face-assets/")) {
        return await serveFaceAsset(request, env, url.pathname);
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        return await serveImage(request, env, url.pathname);
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/media/")) {
        return await deleteImage(request, env, url.pathname);
      }
      return json(request, { success: false, message: "הנתיב המבוקש אינו קיים." }, 404);
    } catch (error) {
      console.error("Worker request failed", error);
      return json(request, {
        success: false,
        code: error?.code || "internal_error",
        message: error?.message || "אירעה שגיאה פנימית."
      }, Number(error?.status) || 500);
    }
  }
};
