// עזרי תשתית: סביבה ומקורות מורשים, CORS, JSON/ETag, שגיאות API, גיבוב, דוא"ל ומגבלות קצב.
import {
  base64UrlEncode,
  requireUser
} from "./auth.js";
import {
  ALLOWED_ORIGINS,
  DEFAULT_STAGING_PAGES_PROJECT,
  EMAIL_RATE_LIMIT,
  EMAIL_RATE_WINDOW_MS,
  ENVIRONMENT_PRODUCTION,
  ENVIRONMENT_STAGING,
  LOCAL_DEVELOPMENT_HOSTNAMES,
  PAGES_PROJECT_NAME_PATTERN
} from "./config.js";
import {
  ensureDatabaseSchema
} from "./schema.js";

// ה-env של ה-Worker, כדי ש-corsHeaders — שנקראת גם מ-json() בלי env — תדע
// באיזו סביבה היא רצה. אותו אובייקט bindings משותף לכל הבקשות של ה-Worker.
let runtimeEnv = null;

function workerEnvironment(env = runtimeEnv) {
  return String(env?.ENVIRONMENT || "").trim().toLowerCase() === ENVIRONMENT_STAGING
    ? ENVIRONMENT_STAGING
    : ENVIRONMENT_PRODUCTION;
}

function stagingPagesProject(env = runtimeEnv) {
  const configured = String(env?.STAGING_PAGES_PROJECT || "").trim().toLowerCase();
  return PAGES_PROJECT_NAME_PATTERN.test(configured) ? configured : DEFAULT_STAGING_PAGES_PROJECT;
}

// בדיקת המקור ל-CORS. המקור מפורק כ-URL ומושווה ל-origin שלו, ולא נבדק כמחרוזת:
// "https://evil.com/?x=.pages.dev" אינו מקור כלל (מקור הוא סכמה, מארח ופורט
// בלבד) ולכן נדחה עוד לפני בדיקת הסיומת. הסיומת נבדקת עם הנקודה המפרידה, כך
// ש-"evilsimchas-gallery-staging.pages.dev" או "….pages.dev.evil.com" נדחים.
export function isAllowedOrigin(origin, env = runtimeEnv) {
  const value = String(origin || "").trim();
  if (!value) return false;
  if (ALLOWED_ORIGINS.has(value)) return true;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== value) return false;

  if (url.protocol === "https:") {
    const project = stagingPagesProject(env);
    if (url.hostname === `${project}.pages.dev` || url.hostname.endsWith(`.${project}.pages.dev`)) return true;
  }
  // פיתוח מקומי מורשה מול ה-Worker של הניסוי בלבד, בכל פורט וגם ב-http.
  if (workerEnvironment(env) === ENVIRONMENT_STAGING && LOCAL_DEVELOPMENT_HOSTNAMES.has(url.hostname)) {
    return url.protocol === "https:" || url.protocol === "http:";
  }
  return false;
}

// --- נעילת המסד לסביבה ---
// ל-binding של D1 אין שם, ולכן ה-Worker אינו יכול לדעת ישירות אם חובר אליו
// המסד של הייצור. במקום זה כל מסד נושא שורת סימון אחת: ה-Worker הראשון שרץ
// מולו כותב בה את שם הסביבה שלו, וכל Worker שרץ אחריו משווה. Worker של
// הניסוי שמוצא "production" (או להפך) מסרב לשרת כל בקשה — אתר ניסוי מושבת
// עדיף על ניסוי שכותב לנתוני הייצור. הבדיקה רצה פעם אחת לכל binding ב-isolate.
// מסד שהועתק במלואו מהייצור (ייצוא/ייבוא D1) נושא את הסימון של הייצור; אז יש
// לעדכן את השורה ידנית: UPDATE gallery_environment SET environment = 'staging'.
const databaseEnvironmentChecks = new WeakMap();

function assertDatabaseEnvironment(env) {
  const database = env?.GALLERY_DB;
  if (!database || typeof database !== "object") return Promise.resolve();
  let check = databaseEnvironmentChecks.get(database);
  if (!check) {
    check = verifyDatabaseEnvironment(database, workerEnvironment(env)).catch(error => {
      // כישלון אינו ננעל במטמון: תיקון ה-binding נכנס לתוקף בלי פריסה מחדש.
      databaseEnvironmentChecks.delete(database);
      throw error;
    });
    databaseEnvironmentChecks.set(database, check);
  }
  return check;
}

async function verifyDatabaseEnvironment(database, expected) {
  const readMarker = async () => String((await database.prepare(
    "SELECT environment FROM gallery_environment WHERE marker_key = 'environment'"
  ).first())?.environment || "").trim().toLowerCase();

  await database.prepare(
    `CREATE TABLE IF NOT EXISTS gallery_environment (
      marker_key TEXT PRIMARY KEY,
      environment TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();
  let marker = await readMarker();
  if (!marker) {
    await database.prepare(
      `INSERT INTO gallery_environment (marker_key, environment, created_at)
       VALUES ('environment', ?, ?)
       ON CONFLICT(marker_key) DO NOTHING`
    ).bind(expected, Date.now()).run();
    marker = await readMarker();
  }
  if (marker && marker !== expected) {
    throw apiError(
      `ה-Worker רץ בסביבת ${expected}, אך מסד הנתונים המחובר אליו מסומן כ-${marker}. בדוק את ה-binding של GALLERY_DB.`,
      500,
      "environment_database_mismatch"
    );
  }
}

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

// תצוגה מקדימה היא תמיד WebP, או JPEG בדפדפן שאינו יודע לקודד WebP.
const ALLOWED_VARIANT_TYPES = new Map([
  ["image/webp", "webp"],
  ["image/jpeg", "jpg"]
]);
// לצד כל תצוגה יכול להישמר עותק AVIF (חלק variant_<שם>_avif בטופס). הוא
// תמיד תוספת: אין AVIF בלי תצוגה רגילה באותה בקשה, כי דפדפן שאינו מפענח AVIF
// חייב לקבל את ה-WebP/JPEG.
const VARIANT_AVIF_TYPE = "image/avif";
const VARIANT_AVIF_EXTENSION = "avif";

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

function corsHeaders(request, env = runtimeEnv) {
  const origin = request.headers.get("Origin");
  return {
    ...(origin && isAllowedOrigin(origin, env)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    // If-None-Match אינה כותרת "בטוחה" ב-CORS, ולכן חייבת להופיע כאן —
    // אחרת הדפדפן חוסם את הבקשה המותנית כבר ב-preflight.
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Face-Index-Token, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
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

// --- ETag ותשובות מותנות ---
// כל תשובת GET מוצלחת מ-/data נושאת ETag חזק: SHA-256 של הגוף, base64url,
// 22 התווים הראשונים. הדפדפן שולח אותו ב-If-None-Match ומקבל 304 ריק
// כשהנתונים לא השתנו — חוסך את הגוף, לא את הבדיקה.
async function computeEtag(body) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${base64UrlEncode(new Uint8Array(digest)).slice(0, 22)}"`;
}

function etagMatches(request, etag) {
  const header = request.headers.get("If-None-Match");
  if (!header) return false;
  return header.split(",").some(token => token.trim().replace(/^W\//i, "") === etag);
}

function conditionalJson(request, body, etag, status = 200) {
  const headers = {
    ...corsHeaders(request),
    "ETag": etag,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  if (etagMatches(request, etag)) return new Response(null, { status: 304, headers });
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }
  });
}

async function etagJson(request, data, status = 200) {
  const body = JSON.stringify(data);
  return conditionalJson(request, body, await computeEtag(body), status);
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

function parseDocumentData(row) {
  try {
    return JSON.parse(row?.data_json || "{}");
  } catch {
    return {};
  }
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

// נקודת הכניסה קובעת את הסביבה של הבקשה הנוכחית; ייבוא ES אינו ניתן להשמה מבחוץ.
function setRuntimeEnv(env) {
  runtimeEnv = env;
}

export {
  runtimeEnv,
  workerEnvironment,
  stagingPagesProject,
  databaseEnvironmentChecks,
  assertDatabaseEnvironment,
  verifyDatabaseEnvironment,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  ALLOWED_VARIANT_TYPES,
  VARIANT_AVIF_TYPE,
  VARIANT_AVIF_EXTENSION,
  ALLOWED_CHAT_FILE_TYPES,
  ALLOWED_CHAT_EXTENSIONS,
  ALLOWED_MEDIA_EXTENSIONS,
  corsHeaders,
  json,
  computeEtag,
  etagMatches,
  conditionalJson,
  etagJson,
  apiError,
  getBearerToken,
  sha256,
  constantTimeHexEqual,
  parseDocumentData,
  sendEmail,
  consumeRateLimit,
  setRuntimeEnv
};
