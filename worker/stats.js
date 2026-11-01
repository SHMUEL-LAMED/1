// סטטיסטיקת שימוש ותקציב אחסון.
import {
  requireUser
} from "./auth.js";
import {
  saveBackgroundDocument
} from "./background.js";
import {
  MAINTENANCE_DAY_MS
} from "./config.js";
import {
  runDatabaseStatements
} from "./faces.js";
import {
  readMaintenanceDocument,
  requireMaintenanceRunner,
  requireMaintenanceViewer
} from "./maintenance.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  json
} from "./util.js";

// --- ניהול: סטטיסטיקות שימוש, אחסון ועלויות, פעולות על כמה משתמשים והערות פנימיות ---
// כל מה שכאן נוסף בלי לשנות רשומה קיימת: המונים בטבלה usage_daily, ההערות
// בטבלה admin_user_notes, וסיכום הנפח במסמך systemMeta פנימי. מסכי הלוח
// (admin-stats.js, admin-users-bulk.js) הם הצרכנים היחידים.

// --- סטטיסטיקות שימוש ---
// המדדים סגורים ברשימה: שם מדד מהדפדפן לעולם אינו נכנס לטבלה כמות שהוא.
// visits — משתמשים מחוברים שונים ביום; views — פתיחת פריט בתצוגה המלאה (פעם
// אחת לפריט בביקור, כמו mediaStats); downloads / zipDownloads / zipItems —
// הורדה בודדת, הורדת ZIP ומספר הפריטים בה; uploads / uploadsPending —
// העלאות לגלריה וכמה מהן ממתינות לאישור; approvals / rejections — החלטות על
// פריטים ממתינים. ארבעת הראשונים מגיעים מהדפדפן, השאר נספרים בשרת.
const USAGE_METRICS = ["visits", "views", "downloads", "zipDownloads", "zipItems", "uploads", "uploadsPending", "approvals", "rejections"];
// התקרה של כל מונה שהדפדפן שולח בבקשה אחת. ערך גבוה יותר נחתך, כך שדפדפן
// אחד אינו יכול לנפח את הגרף.
const USAGE_BEACON_LIMITS = Object.freeze({ views: 500, downloads: 200, zipDownloads: 50, zipItems: 2000 });
// כמה דיווחים ביום מכל משתמש נספרים. הדפדפן שולח אחד בתחילת הביקור ולכל היותר
// אחד בעשר דקות אחר כך; מעבר לתקרה הדיווח מתקבל ואינו כותב דבר.
const USAGE_BEACONS_PER_DAY = 48;
const USAGE_BEACON_MAX_BYTES = 2048;
// שורה אחת לכל משתמש ב-request_rate_limits: תחילת היום האחרון שבו דיווח, ומספר
// הדיווחים באותו יום. ממנה נקבע אם זה הביקור הראשון היום (visits), ומאותה
// שורה נספרים המשתמשים הפעילים ב-7 וב-30 הימים האחרונים — בלי טבלה נוספת.
// הטבלה הזו אינה נכנסת לגיבוי (D1_BACKUP_EXCLUDED_TABLES).
const USAGE_DAY_BUCKET_PREFIX = "usage-day:";
const USAGE_DAY_BUCKET_END = "usage-day;";
const USAGE_RANGE_DEFAULT_DAYS = 90;
const USAGE_RANGE_MAX_DAYS = 400;

function usageDay(time = Date.now()) {
  return new Date(time).toISOString().slice(0, 10);
}

function usageDayStart(time = Date.now()) {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function usageIncrementStatement(env, day, metric, amount, now) {
  return env.GALLERY_DB.prepare(
    `INSERT INTO usage_daily (day, metric, count, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, metric) DO UPDATE SET
       count = usage_daily.count + excluded.count,
       updated_at = excluded.updated_at`
  ).bind(day, metric, amount, now);
}

// מונה בצד השרת (העלאה, אישור, דחייה): UPSERT אחד לכל מדד. כשל כאן לעולם
// אינו מכשיל את הפעולה עצמה — הסטטיסטיקה היא תוספת, לא חלק מהשמירה.
async function recordUsage(env, counts, now = Date.now()) {
  try {
    await ensureDatabaseSchema(env);
    const day = usageDay(now);
    const statements = Object.entries(counts || {})
      .filter(([metric, amount]) => USAGE_METRICS.includes(metric) && Number.isInteger(amount) && amount > 0)
      .map(([metric, amount]) => usageIncrementStatement(env, day, metric, amount, now));
    await runDatabaseStatements(env, statements);
  } catch (error) {
    console.warn("Usage counter failed", error?.message || error);
  }
}

export function normalizeUsageCounts(value) {
  const counts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  for (const [metric, limit] of Object.entries(USAGE_BEACON_LIMITS)) {
    const amount = Math.trunc(Number(value[metric]));
    if (Number.isFinite(amount) && amount > 0) counts[metric] = Math.min(limit, amount);
  }
  return counts;
}

// POST /stats/beacon — { counts: { views, downloads, zipDownloads, zipItems } }.
// כל משתמש מאושר. כתיבה אחת לשורת המשתמש, ועוד אחת לכל מדד שאינו אפס (ולביקור
// הראשון היום). אין כאן מזהה פריט, כתובת דף או כל תוכן — רק מספרים.
async function receiveUsageBeacon(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  const text = await request.text();
  if (text.length > USAGE_BEACON_MAX_BYTES) throw apiError("הדיווח גדול מדי.", 413, "usage_beacon_too_large");
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw apiError("הדיווח אינו תקין.", 400, "invalid_usage_beacon");
  }
  const counts = normalizeUsageCounts(payload?.counts);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const row = await env.GALLERY_DB.prepare(
    `INSERT INTO request_rate_limits (bucket_key, window_started_at, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(bucket_key) DO UPDATE SET
       request_count = CASE
         WHEN request_rate_limits.window_started_at < excluded.window_started_at THEN 1
         ELSE request_rate_limits.request_count + 1
       END,
       window_started_at = MAX(request_rate_limits.window_started_at, excluded.window_started_at)
     RETURNING request_count`
  ).bind(`${USAGE_DAY_BUCKET_PREFIX}${user.uid}`, usageDayStart(now)).first();
  const beaconNumber = Number(row?.request_count) || 0;
  let accepted = false;
  const firstToday = beaconNumber === 1;
  if (beaconNumber > 0 && beaconNumber <= USAGE_BEACONS_PER_DAY) {
    const day = usageDay(now);
    const statements = [];
    if (firstToday) statements.push(usageIncrementStatement(env, day, "visits", 1, now));
    for (const [metric, amount] of Object.entries(counts)) statements.push(usageIncrementStatement(env, day, metric, amount, now));
    await runDatabaseStatements(env, statements);
    accepted = true;
  }
  const response = json(request, { success: true, accepted, visit: accepted && firstToday });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function usageRangeDays(url) {
  const days = Math.trunc(Number(url.searchParams.get("days")) || USAGE_RANGE_DEFAULT_DAYS);
  return Math.max(1, Math.min(USAGE_RANGE_MAX_DAYS, days));
}

// GET /stats/usage?days=90 — מנהל־על אנושי בלבד, כמו "ניתוח נתונים". מחזיר
// שורה לכל יום שיש בו נתונים, ואת מספר המשתמשים הפעילים — מספרים בלבד.
async function readUsageStats(request, env, url) {
  await requireMaintenanceViewer(request, env);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const days = usageRangeDays(url);
  const todayStart = usageDayStart(now);
  const from = usageDay(todayStart - (days - 1) * MAINTENANCE_DAY_MS);
  const to = usageDay(now);
  const rows = await env.GALLERY_DB.prepare(
    "SELECT day, metric, count FROM usage_daily WHERE day >= ? AND day <= ? ORDER BY day"
  ).bind(from, to).all();
  const byDay = new Map();
  for (const row of rows.results || []) {
    const metric = String(row.metric);
    if (!USAGE_METRICS.includes(metric)) continue;
    const day = String(row.day);
    if (!byDay.has(day)) byDay.set(day, { day });
    byDay.get(day)[metric] = Number(row.count) || 0;
  }
  const active = await env.GALLERY_DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN window_started_at >= ? THEN 1 ELSE 0 END), 0) AS today,
       COALESCE(SUM(CASE WHEN window_started_at >= ? THEN 1 ELSE 0 END), 0) AS last7,
       COALESCE(SUM(CASE WHEN window_started_at >= ? THEN 1 ELSE 0 END), 0) AS last30
     FROM request_rate_limits WHERE bucket_key >= ? AND bucket_key < ?`
  ).bind(todayStart, todayStart - 6 * MAINTENANCE_DAY_MS, todayStart - 29 * MAINTENANCE_DAY_MS, USAGE_DAY_BUCKET_PREFIX, USAGE_DAY_BUCKET_END).first();
  const first = await env.GALLERY_DB.prepare("SELECT MIN(day) AS day FROM usage_daily").first();
  const response = json(request, {
    success: true,
    from,
    to,
    metrics: USAGE_METRICS,
    days: [...byDay.values()],
    collectedSince: first?.day ? String(first.day) : null,
    activeUsers: {
      today: Number(active?.today) || 0,
      last7: Number(active?.last7) || 0,
      last30: Number(active?.last30) || 0
    }
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// --- אחסון ועלויות ---
// פעם ביום תהליך התחזוקה עובר על כל הדלי ב-R2 בעמודים של 1,000 (הסמן נשמר
// במסמך, כך שהריצה הבאה ממשיכה), ובסוף שומר סיכום: נפח ומספר קבצים לפי
// קידומת, גודל מסד D1, ומספר העיבודים (AI ופנים) בחודש הנוכחי. כתיבה אחת
// ל-D1 לכל צעד; דבר אינו נמחק.
const STORAGE_DOC_ID = "maintenanceStorage";
const STORAGE_BUDGET_DOC_ID = "storageBudget";
const STORAGE_OBJECTS_PER_CALL = 1000;
const STORAGE_RESCAN_MS = MAINTENANCE_DAY_MS;
const STORAGE_PREFIX_GROUPS = ["approved", "pending", "variants", "backups", "chat"];
const STORAGE_OTHER_GROUP = "other";
const STORAGE_WARN_PERCENT_DEFAULT = 80;
const STORAGE_QUOTA_MAX_GB = 100000;
const GIGABYTE = 1024 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;

function storageGroup(key) {
  const first = String(key || "").split("/")[0];
  return STORAGE_PREFIX_GROUPS.includes(first) ? first : STORAGE_OTHER_GROUP;
}

function storageEmptyScan(now) {
  return {
    startedAt: now,
    objects: 0,
    bytes: 0,
    byPrefix: Object.fromEntries([...STORAGE_PREFIX_GROUPS, STORAGE_OTHER_GROUP].map(group => [group, { objects: 0, bytes: 0 }]))
  };
}

// סף האזהרה שמנהל־העל שומר ב-systemMeta/storageBudget. הערכים נבדקים כאן,
// בקריאה: מסמך פגום פשוט מכבה את האזהרה. 0 = אין מכסה.
export function normalizeStorageBudget(value) {
  const data = value && typeof value === "object" ? value : {};
  const quota = (raw, max) => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? Math.min(max, Math.round(number * 1000) / 1000) : 0;
  };
  const percent = Math.trunc(Number(data.warnPercent));
  return {
    r2QuotaGb: quota(data.r2QuotaGb, STORAGE_QUOTA_MAX_GB),
    d1QuotaMb: quota(data.d1QuotaMb, STORAGE_QUOTA_MAX_GB * 1024),
    warnPercent: Number.isFinite(percent) && percent >= 10 && percent <= 100 ? percent : STORAGE_WARN_PERCENT_DEFAULT
  };
}

export function storageBudgetStatus(report, budget) {
  const measure = (bytes, quotaBytes) => {
    const used = bytes === null || bytes === undefined ? NaN : Number(bytes);
    if (!Number.isFinite(used) || used < 0) return { bytes: null, quotaBytes, percent: null, over: false };
    if (!quotaBytes) return { bytes: used, quotaBytes, percent: null, over: false };
    const percent = Math.round((used / quotaBytes) * 1000) / 10;
    return { bytes: used, quotaBytes, percent, over: percent >= budget.warnPercent };
  };
  const r2 = measure(report?.bytes, budget.r2QuotaGb * GIGABYTE);
  const d1 = measure(report?.d1Bytes, budget.d1QuotaMb * MEGABYTE);
  return { r2, d1, over: Boolean(report?.completedAt) && (r2.over || d1.over), warnPercent: budget.warnPercent };
}

// גודל מסד D1: D1 מחזיר size_after במטא-דאטה של כל שאילתה; בלעדיו (סביבה
// אחרת) — page_count * page_size. כשאף אחד אינו זמין: null, והמסך כותב "לא ידוע".
async function d1DatabaseBytes(env) {
  try {
    const result = await env.GALLERY_DB.prepare("SELECT 1 AS probe").all();
    const size = Number(result?.meta?.size_after);
    if (Number.isFinite(size) && size > 0) return size;
  } catch { /* ממשיכים לחלופה */ }
  try {
    const pages = await env.GALLERY_DB.prepare("PRAGMA page_count").first();
    const pageSize = await env.GALLERY_DB.prepare("PRAGMA page_size").first();
    const size = Number(pages?.page_count) * Number(pageSize?.page_size);
    if (Number.isFinite(size) && size > 0) return size;
  } catch { /* PRAGMA חסום */ }
  return null;
}

// כמה עיבודים נעשו מתחילת החודש (UTC): תמונות שקיבלו שם או כיתוב מה-AI,
// ותמונות שעברו אינדוקס פנים. קריאה בלבד, פעם אחת בסוף כל סריקה.
async function monthlyJobCounts(env, now) {
  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const counts = { month: new Date(monthStart).toISOString().slice(0, 7), aiDescriptions: null, faceIndexed: null };
  try {
    const ai = await env.GALLERY_DB.prepare(
      `SELECT COUNT(*) AS total FROM gallery_documents
       WHERE collection_name = 'images' AND json_valid(data_json)
         AND CAST(COALESCE(json_extract(data_json, '$.aiCaptionGeneratedAt'), json_extract(data_json, '$.aiTitleGeneratedAt'), 0) AS REAL) >= ?`
    ).bind(monthStart).first();
    counts.aiDescriptions = Number(ai?.total) || 0;
  } catch (error) {
    console.warn("Monthly AI count failed", error?.message || error);
  }
  try {
    const faces = await env.GALLERY_DB.prepare(
      "SELECT COUNT(*) AS total FROM image_face_index_state WHERE updated_at >= ?"
    ).bind(monthStart).first();
    counts.faceIndexed = Number(faces?.total) || 0;
  } catch (error) {
    console.warn("Monthly face count failed", error?.message || error);
  }
  return counts;
}

// POST /maintenance/storage-scan — צעד אחד: עמוד אחד מרשימת R2 ושמירה אחת של
// המצב. אחרי סריקה מלאה נשמר הדוח, והבאה מתחילה רק אחרי יממה; בינתיים הקריאה
// רק קוראת.
async function maintenanceStorageScan(request, env) {
  requireMaintenanceRunner(request);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const state = await readMaintenanceDocument(env, STORAGE_DOC_ID);
  const report = state.report && typeof state.report === "object" ? state.report : null;
  if (!state.scan && report && Number(report.completedAt) > now - STORAGE_RESCAN_MS) {
    return json(request, { success: true, idle: true, done: true, nextScanAt: Number(report.completedAt) + STORAGE_RESCAN_MS });
  }
  const empty = storageEmptyScan(now);
  const scan = state.scan && typeof state.scan === "object"
    ? { ...empty, ...state.scan, byPrefix: { ...empty.byPrefix, ...(state.scan.byPrefix || {}) } }
    : empty;
  const r2Cursor = String(state.cursor?.r2Cursor || "");
  const listed = await env.GALLERY_BUCKET.list({ limit: STORAGE_OBJECTS_PER_CALL, ...(r2Cursor ? { cursor: r2Cursor } : {}) });
  for (const object of listed?.objects || []) {
    const size = Math.max(0, Number(object.size) || 0);
    const group = storageGroup(object.key);
    scan.objects += 1;
    scan.bytes += size;
    scan.byPrefix[group] = {
      objects: (Number(scan.byPrefix[group]?.objects) || 0) + 1,
      bytes: (Number(scan.byPrefix[group]?.bytes) || 0) + size
    };
  }
  const done = !(listed?.truncated && listed.cursor);
  let next;
  if (done) {
    const finished = { ...scan, d1Bytes: await d1DatabaseBytes(env), jobs: await monthlyJobCounts(env, now), completedAt: now };
    next = { version: 1, report: finished, scan: null, cursor: null, updatedAt: now };
  } else {
    next = { version: 1, report, scan, cursor: { r2Cursor: String(listed.cursor) }, updatedAt: now };
  }
  await saveBackgroundDocument(env, STORAGE_DOC_ID, next);
  return json(request, { success: true, idle: false, done, objects: scan.objects, bytes: scan.bytes });
}

// GET /maintenance/storage — הדוח האחרון, הסריקה שבדרך והסף (מנהל־על).
async function readStorageReport(request, env) {
  await requireMaintenanceViewer(request, env);
  await ensureDatabaseSchema(env);
  const state = await readMaintenanceDocument(env, STORAGE_DOC_ID);
  const report = state.report && typeof state.report === "object" ? state.report : null;
  const budget = normalizeStorageBudget(await readMaintenanceDocument(env, STORAGE_BUDGET_DOC_ID));
  const scan = state.scan && typeof state.scan === "object" ? state.scan : null;
  const response = json(request, {
    success: true,
    report,
    scanning: scan ? { startedAt: Number(scan.startedAt) || 0, objects: Number(scan.objects) || 0, bytes: Number(scan.bytes) || 0 } : null,
    budget,
    status: storageBudgetStatus(report, budget),
    groups: [...STORAGE_PREFIX_GROUPS, STORAGE_OTHER_GROUP]
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// מצב האחסון לבדיקת ההתראה: null כשאין דוח או סף, או כשהנפח מתחת לסף.
async function storageAlertState(env) {
  try {
    const state = await readMaintenanceDocument(env, STORAGE_DOC_ID);
    const report = state.report && typeof state.report === "object" ? state.report : null;
    if (!report?.completedAt) return null;
    const status = storageBudgetStatus(report, normalizeStorageBudget(await readMaintenanceDocument(env, STORAGE_BUDGET_DOC_ID)));
    return status.over ? { ...status, reportAt: Number(report.completedAt) } : null;
  } catch (error) {
    console.warn("Storage alert state failed", error?.message || error);
    return null;
  }
}

export {
  USAGE_METRICS,
  USAGE_BEACON_LIMITS,
  USAGE_BEACONS_PER_DAY,
  USAGE_BEACON_MAX_BYTES,
  USAGE_DAY_BUCKET_PREFIX,
  USAGE_DAY_BUCKET_END,
  USAGE_RANGE_DEFAULT_DAYS,
  USAGE_RANGE_MAX_DAYS,
  usageDay,
  usageDayStart,
  usageIncrementStatement,
  recordUsage,
  receiveUsageBeacon,
  usageRangeDays,
  readUsageStats,
  STORAGE_DOC_ID,
  STORAGE_BUDGET_DOC_ID,
  STORAGE_OBJECTS_PER_CALL,
  STORAGE_RESCAN_MS,
  STORAGE_PREFIX_GROUPS,
  STORAGE_OTHER_GROUP,
  STORAGE_WARN_PERCENT_DEFAULT,
  STORAGE_QUOTA_MAX_GB,
  GIGABYTE,
  MEGABYTE,
  storageGroup,
  storageEmptyScan,
  d1DatabaseBytes,
  monthlyJobCounts,
  maintenanceStorageScan,
  readStorageReport,
  storageAlertState
};
