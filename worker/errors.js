// ניטור שגיאות לקוח ו-Worker.
import {
  requireUser,
  resolveAccount
} from "./auth.js";
import {
  CLIENT_ERROR_ADMIN_RATE_LIMIT,
  CLIENT_ERROR_ADMIN_RATE_WINDOW_MS,
  CLIENT_ERROR_CONTEXT_MAX_LENGTH,
  CLIENT_ERROR_LIST_DEFAULT_LIMIT,
  CLIENT_ERROR_LIST_MAX_LIMIT,
  CLIENT_ERROR_MESSAGE_MAX_LENGTH,
  CLIENT_ERROR_RATE_LIMIT,
  CLIENT_ERROR_RATE_WINDOW_MS,
  CLIENT_ERROR_RECENT_WINDOW_MS,
  CLIENT_ERROR_RESOLVED_RETENTION_MS,
  CLIENT_ERROR_SCOPE_MAX_LENGTH,
  CLIENT_ERROR_STACK_MAX_LENGTH,
  CLIENT_ERROR_URL_MAX_LENGTH,
  CLIENT_ERROR_USER_AGENT_MAX_LENGTH
} from "./config.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  consumeRateLimit,
  json,
  sha256
} from "./util.js";

// --- ניטור שגיאות ---
// האתר שולח שגיאות ל-POST /telemetry/errors, וה-Worker רושם לאותה טבלה
// גם את הכשלונות הפנימיים שלו. כל דיווח מנוקה מאסימונים ומכתובות דוא״ל,
// נחתך לגודל קבוע ומקובץ לפי טביעת אצבע, כך שלוח הניהול מציג שורה אחת
// לכל סוג תקלה עם מונה מופעים.

// מסיר כל מה שנראה כאסימון התחברות או ככתובת דוא״ל, גם כשהודעת שגיאה
// מצטטת כותרת, כתובת או גוף בקשה.
function scrubSensitiveText(value, maxLength) {
  return String(value ?? "")
    .replace(/\0/g, "")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [הוסר]")
    .replace(/\bv1\.[\w-]{6,}\.[\w-]{6,}/g, "[אסימון הוסר]")
    .replace(/\bey[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, "[אסימון הוסר]")
    .replace(/\bya29\.[\w.-]+/g, "[אסימון הוסר]")
    .replace(/([?&#](?:access_token|id_token|token|credential|code|key|state|session)=)[^&#\s]+/gi, "$1[הוסר]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[דוא״ל הוסר]")
    .trim()
    .slice(0, maxLength);
}

function normalizeFingerprintPart(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// השורה הראשונה במחסנית שמצביעה על קוד: "at fn (url:1:2)" בכרום,
// "fn@url:1:2" בפיירפוקס ובספארי. מספרי השורה והעמודה מוסרים, כדי שפריסה
// שמזיזה שורות לא תפצל תקלה אחת לכמה שורות בלוח.
function firstStackFrame(stack) {
  const lines = String(stack || "").split("\n").map(line => line.trim()).filter(Boolean);
  const frame = lines.find(line => /^at\s+\S/.test(line) || /\S@\S+:\d+/.test(line)) || "";
  return frame.replace(/\?[^\s:)]*/g, "").replace(/:\d+(?::\d+)?\)?$/, "");
}

async function clientErrorFingerprint(source, message, stack) {
  return sha256(
    `${source}|${normalizeFingerprintPart(message)}|${normalizeFingerprintPart(firstStackFrame(stack))}`,
    { normalize: false }
  );
}

function safeErrorContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const context = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    const safeKey = String(key).replace(/[^\w-]/g, "").slice(0, 40);
    if (!safeKey || raw === undefined || raw === null) continue;
    context[safeKey] = typeof raw === "object" ? JSON.stringify(raw).slice(0, 200) : String(raw).slice(0, 200);
  }
  return context;
}

// מנרמל דיווח — מהדפדפן או מה-Worker — לרשומה מוכנה לשמירה. ההקשר
// (גרסת האתר, קוד השגיאה וכדומה) מצורף לסוף המחסנית, וה-scope פותח את
// ההודעה כדי שתקלות מאותו סוג במסלולים שונים יקבלו שורות נפרדות.
function buildErrorRecord({ source, message, stack, url, userAgent, context }) {
  const safeContext = safeErrorContext(context);
  const scope = String(safeContext.scope || "")
    .replace(/[^\w\u0590-\u05FF .:/-]/g, "")
    .trim()
    .slice(0, CLIENT_ERROR_SCOPE_MAX_LENGTH);
  delete safeContext.scope;
  const baseMessage = scrubSensitiveText(message, CLIENT_ERROR_MESSAGE_MAX_LENGTH);
  const contextBlock = Object.keys(safeContext).length
    ? `\n--- הקשר ---\n${scrubSensitiveText(JSON.stringify(safeContext), CLIENT_ERROR_CONTEXT_MAX_LENGTH)}`
    : "";
  const stackText = scrubSensitiveText(stack, CLIENT_ERROR_STACK_MAX_LENGTH - contextBlock.length);
  return {
    source: source === "worker" ? "worker" : "site",
    message: scrubSensitiveText(scope ? `${scope}: ${baseMessage}` : baseMessage, CLIENT_ERROR_MESSAGE_MAX_LENGTH),
    stack: `${stackText}${contextBlock}`.slice(0, CLIENT_ERROR_STACK_MAX_LENGTH),
    url: scrubSensitiveText(url, CLIENT_ERROR_URL_MAX_LENGTH),
    userAgent: scrubSensitiveText(userAgent, CLIENT_ERROR_USER_AGENT_MAX_LENGTH)
  };
}

// שורה אחת לכל טביעת אצבע: דיווח חוזר מגדיל את המונה ומעדכן את המופע
// האחרון. שגיאה שסומנה כטופלה ונרשמה שוב חוזרת להיות פתוחה — זה בדיוק
// האות שהתיקון לא הספיק.
async function upsertClientError(env, record, { uid = "", now = Date.now() } = {}) {
  await ensureDatabaseSchema(env);
  const fingerprint = await clientErrorFingerprint(record.source, record.message, record.stack);
  await env.GALLERY_DB.prepare(
    `INSERT INTO client_errors (fingerprint, source, message, stack, url, user_agent, last_uid, count, first_seen, last_seen, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
     ON CONFLICT(fingerprint) DO UPDATE SET
       count = client_errors.count + 1,
       last_seen = excluded.last_seen,
       stack = CASE WHEN excluded.stack = '' THEN client_errors.stack ELSE excluded.stack END,
       url = CASE WHEN excluded.url = '' THEN client_errors.url ELSE excluded.url END,
       user_agent = CASE WHEN excluded.user_agent = '' THEN client_errors.user_agent ELSE excluded.user_agent END,
       last_uid = CASE WHEN excluded.last_uid = '' THEN client_errors.last_uid ELSE excluded.last_uid END,
       resolved_at = NULL`
  ).bind(
    fingerprint, record.source, record.message, record.stack, record.url, record.userAgent,
    String(uid || ""), now, now
  ).run();
  return fingerprint;
}

function reportingClientBucket(request) {
  const forwarded = String(request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  return request.headers.get("CF-Connecting-IP") || forwarded || "unknown";
}

// המדווח מזוהה רק אם שלח אסימון תקף. דיווח בלי אסימון — או עם אסימון
// שפג — מתקבל בכל זאת, כי שגיאות קורות גם לפני ההתחברות.
async function reportingUid(request, env) {
  if (!request.headers.get("Authorization")) return "";
  try {
    const { account } = await resolveAccount(request, env);
    return String(account?.localId || "");
  } catch {
    return "";
  }
}

async function receiveClientErrorReport(request, env) {
  try {
    await consumeRateLimit(
      env,
      `client-error:${reportingClientBucket(request)}`,
      CLIENT_ERROR_RATE_LIMIT,
      CLIENT_ERROR_RATE_WINDOW_MS,
      "נשלחו יותר מדי דיווחי שגיאה. נסה שוב מאוחר יותר.",
      "client_error_rate_limit"
    );
    // sendBeacon שולח Blob, ולכן הגוף נקרא כטקסט בלי להסתמך על Content-Type.
    let payload = null;
    try {
      payload = JSON.parse(await request.text());
    } catch {
      payload = null;
    }
    const record = buildErrorRecord({
      source: "site",
      message: payload?.message,
      stack: payload?.stack,
      url: payload?.url,
      userAgent: payload?.userAgent || request.headers.get("User-Agent") || "",
      context: payload?.extra
    });
    if (!payload || typeof payload !== "object" || !record.message) {
      return json(request, { success: false, code: "invalid_error_report", message: "דיווח השגיאה אינו תקין." }, 400);
    }
    const uid = await reportingUid(request, env);
    await upsertClientError(env, record, { uid });
    return json(request, { success: true });
  } catch (error) {
    if (Number(error?.status) === 429) {
      return json(request, { success: false, code: error.code, message: error.message }, 429);
    }
    // יומן השגיאות לעולם אינו מפיל את הדפדפן שדיווח; הכישלון נרשם רק בלוג.
    console.error("Client error report could not be stored", error);
    return json(request, { success: true, stored: false });
  }
}

// כשלון פנימי (5xx) של ה-Worker נרשם לאותה טבלה, כדי שהלוח יציג גם תקלות
// שרת. הרישום רץ אחרי שהתשובה כבר יצאה ולעולם אינו משנה אותה.
async function storeWorkerFailure(request, env, error, status) {
  const url = new URL(request.url);
  const record = buildErrorRecord({
    source: "worker",
    message: `${request.method} ${url.pathname}: ${error?.message || error?.name || "internal_error"}`,
    stack: error?.stack || "",
    url: `${url.origin}${url.pathname}`,
    userAgent: request.headers.get("User-Agent") || "",
    context: { status, code: error?.code || "internal_error" }
  });
  await upsertClientError(env, record);
}

function recordWorkerFailure(request, env, ctx, error, status) {
  try {
    const task = storeWorkerFailure(request, env, error, status)
      .catch(loggingError => console.error("Worker failure could not be recorded", loggingError));
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(task);
  } catch (loggingError) {
    console.error("Worker failure could not be recorded", loggingError);
  }
}

async function requireErrorsReader(request, env) {
  const actor = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env,
    `client-errors-admin:${actor.uid}`,
    CLIENT_ERROR_ADMIN_RATE_LIMIT,
    CLIENT_ERROR_ADMIN_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.",
    "client_errors_rate_limit"
  );
  return actor;
}

async function listClientErrors(request, env, url) {
  await requireErrorsReader(request, env);
  const status = url.searchParams.get("status") === "resolved" ? "resolved" : "open";
  const requestedLimit = Math.trunc(Number(url.searchParams.get("limit")) || CLIENT_ERROR_LIST_DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(CLIENT_ERROR_LIST_MAX_LIMIT, requestedLimit));
  const result = await env.GALLERY_DB.prepare(
    `SELECT fingerprint, source, message, stack, url, user_agent AS userAgent, last_uid AS lastUid,
            count, first_seen AS firstSeen, last_seen AS lastSeen, resolved_at AS resolvedAt
     FROM client_errors
     WHERE ${status === "resolved" ? "resolved_at IS NOT NULL" : "resolved_at IS NULL"}
     ORDER BY last_seen DESC
     LIMIT ?`
  ).bind(limit).all();
  return json(request, { success: true, status, errors: result.results || [] });
}

// מונה לתג שבתפריט הניהול: שגיאות פתוחות, ומתוכן אלו שנראו ביממה האחרונה.
async function clientErrorsSummary(request, env) {
  await requireErrorsReader(request, env);
  const row = await env.GALLERY_DB.prepare(
    `SELECT COUNT(*) AS open,
            SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS recent
     FROM client_errors
     WHERE resolved_at IS NULL`
  ).bind(Date.now() - CLIENT_ERROR_RECENT_WINDOW_MS).first();
  return json(request, { success: true, open: Number(row?.open) || 0, last24h: Number(row?.recent) || 0 });
}

function safeFingerprint(value) {
  const fingerprint = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw apiError("מזהה השגיאה אינו תקין.", 400, "invalid_fingerprint");
  return fingerprint;
}

async function updateClientErrorStatus(request, env, action) {
  await requireUser(request, env, ["super_admin"]);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const fingerprint = safeFingerprint(payload?.fingerprint);
  const row = action === "resolve"
    ? await env.GALLERY_DB.prepare(
      "UPDATE client_errors SET resolved_at = ? WHERE fingerprint = ? AND resolved_at IS NULL RETURNING fingerprint"
    ).bind(Date.now(), fingerprint).first()
    : await env.GALLERY_DB.prepare(
      "UPDATE client_errors SET resolved_at = NULL WHERE fingerprint = ? AND resolved_at IS NOT NULL RETURNING fingerprint"
    ).bind(fingerprint).first();
  if (!row) throw apiError("השגיאה לא נמצאה, או שמצבה כבר עודכן.", 404, "error_not_found");
  return json(request, { success: true, fingerprint, resolved: action === "resolve" });
}

async function clearResolvedClientErrors(request, env) {
  await requireUser(request, env, ["super_admin"]);
  await ensureDatabaseSchema(env);
  const result = await env.GALLERY_DB.prepare(
    "DELETE FROM client_errors WHERE resolved_at IS NOT NULL AND resolved_at < ? RETURNING fingerprint"
  ).bind(Date.now() - CLIENT_ERROR_RESOLVED_RETENTION_MS).all();
  return json(request, { success: true, deleted: (result.results || []).length });
}

export {
  scrubSensitiveText,
  normalizeFingerprintPart,
  firstStackFrame,
  clientErrorFingerprint,
  safeErrorContext,
  buildErrorRecord,
  upsertClientError,
  reportingClientBucket,
  reportingUid,
  receiveClientErrorReport,
  storeWorkerFailure,
  recordWorkerFailure,
  requireErrorsReader,
  listClientErrors,
  clientErrorsSummary,
  safeFingerprint,
  updateClientErrorStatus,
  clearResolvedClientErrors
};
