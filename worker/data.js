// API הנתונים: הרשאות אוספים, רשימות, דפדוף, מטמון קצה ו-handleDataRequest.
import {
  generateImageDescription,
  normalizeImageDescriptionFields,
  selectedAiKey
} from "./ai.js";
import {
  base64UrlDecodeToBytes,
  base64UrlEncode,
  dataActor,
  updateUserEmailIndex
} from "./auth.js";
import {
  backgroundActors,
  readBackgroundConfig
} from "./background.js";
import {
  CAPTURE_FIELDS,
  DATA_CACHE_TTL_SECONDS,
  DATA_FILTER_FIELDS,
  DATA_IDS_MAX,
  DATA_PAGE_DEFAULT_LIMIT,
  DATA_PAGE_MAX_LIMIT,
  EDGE_CACHE_EXCLUDED_COLLECTIONS,
  INVITE_PROFILE_FIELDS,
  TAKEN_AT_FUTURE_SLACK_MS,
  TAKEN_AT_MIN,
  TAKEN_AT_ORDER_SQL,
  TAKEN_AT_SOURCES
} from "./config.js";
import {
  deleteFaceIndexForImage,
  hasActiveImageDocument
} from "./faces.js";
import {
  normalizeFolderFields,
  normalizeImageArrangeFields
} from "./folders.js";
import {
  deleteMediaVariantsForImage,
  readGalleryDocumentRow
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  recordUsage
} from "./stats.js";
import {
  normalizeContentHash,
  normalizeMediaPlaceholder,
  recordUploadRejection
} from "./uploads.js";
import {
  assertSuperAdminRetained
} from "./users.js";
import {
  apiError,
  computeEtag,
  conditionalJson,
  etagJson,
  json,
  parseDocumentData,
  sha256
} from "./util.js";

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

// מסמכי systemMeta שמסכי מנהל־העל שומרים (סימן המים והפרטיות בהורדה, הודעת
// הפופ־אפ): הלוח מציג אותם רק למנהל־על, ולכן גם השרת אינו מקבל כתיבה שלהם
// ממנהל רגיל. הקריאה נשארת פתוחה לכל מאושר — הגלריה צריכה אותם. כדי להוסיף
// מסמך כזה מספיק להוסיף את המזהה כאן.
const SYSTEM_META_SUPER_ADMIN_WRITE_IDS = new Set(["downloadPrivacy", "popupAnnouncement"]);
// מסמכי systemMeta פנימיים של התחזוקה והעיבוד בענן: אין לצופה או למנהל רגיל
// סיבה לקרוא אותם (רשימת הקישורים השבורים, מצב ההתראות, תור Drive), ולכן הם
// פתוחים דרך /data רק למנהל־על — וגם אינם מופיעים ברשימת האוסף של אחרים.
// ה-Worker עצמו כותב אותם ב-SQL ישיר, לא דרך הנתיב הזה.
// maintenanceStorage (סיכום הנפח היומי) ו-storageBudget (סף האזהרה שמנהל־העל
// קובע) שייכים למסך "סטטיסטיקות" → "אחסון ועלויות", ופתוחים רק לו.
const SYSTEM_META_PRIVATE_IDS = new Set(["backgroundJobs", "backgroundState", "maintenanceBrokenLinks", "maintenanceAlert", "maintenanceStorage", "storageBudget"]);

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
    const superAdminOnly = SYSTEM_META_PRIVATE_IDS.has(documentId) ||
      (method !== "GET" && SYSTEM_META_SUPER_ADMIN_WRITE_IDS.has(documentId));
    if (superAdminOnly) {
      if (superAdmin) return;
    } else {
      if (method === "GET" && approved) return;
      if (["PUT", "DELETE"].includes(method) && admin) return;
    }
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

// --- גרסת נתונים לכל אוסף ---
// נשמרת ב-gallery_schema_meta תחת data_version:<אוסף>. כל כתיבה לאוסף
// מקדמת אותה, והיא חלק ממפתח מטמון הקצה — כך רשימה שנשמרה במטמון מתיישנת
// ברגע הכתיבה ולא אחרי חמש דקות. קריאה אחת זולה ב-D1 לכל בקשת רשימה.
async function readDataVersion(env, collectionName) {
  const row = await env.GALLERY_DB.prepare(
    "SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?"
  ).bind(`data_version:${collectionName}`).first();
  return Number(row?.schema_version) || 0;
}

// הגרסה החדשה היא הגדול מבין "הקודמת + 1" ו-Date.now(): עולה תמיד, וגם
// אחרי איפוס של הטבלה אינה חוזרת לערך שכבר שימש במפתח מטמון.
async function bumpDataVersion(env, collectionName) {
  const now = Date.now();
  try {
    await env.GALLERY_DB.prepare(
      `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(schema_key) DO UPDATE SET
         schema_version = MAX(gallery_schema_meta.schema_version + 1, excluded.schema_version),
         updated_at = excluded.updated_at`
    ).bind(`data_version:${collectionName}`, now, now).run();
  } catch (error) {
    // הכתיבה עצמה כבר הצליחה; במקרה הגרוע המטמון מתיישן לבד בתוך חמש דקות.
    console.warn("Data version bump failed", collectionName, error?.message || error);
  }
}

async function bumpDataVersions(env, collectionNames) {
  for (const collectionName of new Set(collectionNames)) await bumpDataVersion(env, collectionName);
}

// --- סמני דפדוף ---
// הסמן הוא JSON ב-base64url של ערך המיון ומזהה השורה האחרונה בעמוד.
// ערך המיון נלקח מהעמודה המחושבת שהחזירה השאילתה עצמה, ולכן ההשוואה
// בעמוד הבא נעשית בדיוק על אותו מספר ש-SQLite חישב.
function encodeCursor(value, id) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify({ v: value, id })));
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(raw)));
    const value = Number(parsed?.v);
    const id = String(parsed?.id || "");
    if (!Number.isFinite(value) || !id) throw new Error("invalid cursor");
    return { value, id };
  } catch {
    throw apiError("סמן הדפדוף אינו תקין.", 400, "invalid_cursor");
  }
}

function orderExpression(orderField) {
  if (orderField === "takenAt") return TAKEN_AT_ORDER_SQL;
  return `CAST(COALESCE(json_extract(data_json, '$.${orderField}'), 0) AS REAL)`;
}

// פירוש פרמטרי הרשימה פעם אחת: גם השאילתה וגם מפתח המטמון נבנים מהתוצאה,
// ולכן שני ניסוחים שונים של אותה בקשה חולקים עותק אחד במטמון.
function parseListQuery(url, kind) {
  const params = url.searchParams;
  const limit = Math.max(1, Math.min(DATA_PAGE_MAX_LIMIT, Number(params.get("limit")) || DATA_PAGE_DEFAULT_LIMIT));
  const offset = Math.max(0, Math.trunc(Number(params.get("offset")) || 0));
  const orderField = safeDataPart(params.get("orderBy") || "updatedAt", "שדה המיון");
  const direction = params.get("direction") === "asc" ? "ASC" : "DESC";
  const after = decodeCursor(params.get("after"));
  const filters = [];
  for (const field of DATA_FILTER_FIELDS) {
    const value = params.get(field);
    if (value !== null && value !== "") filters.push({ field, value: String(value).slice(0, 200) });
  }
  const rawIds = String(params.get("ids") || "").split(",").map(value => value.trim()).filter(Boolean);
  if (rawIds.length > DATA_IDS_MAX) {
    throw apiError(`אפשר לבקש עד ${DATA_IDS_MAX} מזהים בבקשה אחת.`, 400, "too_many_ids");
  }
  const ids = [...new Set(rawIds.map(value => safeDataPart(value, "מזהה המסמך")))];
  let by = "";
  if (kind === "counts") {
    by = safeDataPart(params.get("by") || "folderId", "שדה הקיבוץ");
    if (!DATA_FILTER_FIELDS.includes(by)) throw apiError("אי אפשר לקבץ לפי השדה הזה.", 400, "invalid_group_field");
  }
  return { kind, limit, offset, orderField, direction, after, filters, ids, by };
}

// מחרוזת שאילתה מנורמלת למפתח המטמון. אין בה שום פרט על המשתמש.
function listQueryKey(query) {
  const parts = [`kind=${query.kind}`, `orderBy=${query.orderField}`, `direction=${query.direction}`, `limit=${query.limit}`, `offset=${query.offset}`];
  if (query.after) parts.push(`after=${encodeCursor(query.after.value, query.after.id)}`);
  for (const filter of query.filters) parts.push(`${filter.field}=${encodeURIComponent(filter.value)}`);
  if (query.ids.length) parts.push(`ids=${[...query.ids].sort().join(",")}`);
  if (query.by) parts.push(`by=${query.by}`);
  return parts.join("&");
}

// מחלקת ההרשאה היא כל מה שהמטמון יודע על המבקש. לעולם לא מזהה משתמש:
// כל הצופים המאושרים חולקים עותק אחד של כל רשימה.
function actorPermissionClass(actor) {
  const approved = actor.status === "approved" || actor.initialAdmin;
  if (!approved) return "pending";
  if (actor.role === "super_admin") return "super_admin";
  if (actor.role === "admin") return "admin";
  return "approved-viewer";
}

async function dataCacheKey(request, collectionName, query, version, permissionClass) {
  let queryKey = listQueryKey(query);
  // מפתח ארוך במיוחד (רשימת מזהים) מקוצר לגיבוב, כדי שהכתובת תישאר סבירה.
  if (queryKey.length > 1500) queryKey = `h=${await sha256(queryKey, { normalize: false })}`;
  return `${new URL(request.url).origin}/__data-cache/${collectionName}/${query.kind}?${queryKey}&v=${version}&p=${permissionClass}`;
}

// Cache API זמין רק ב-Worker שמוגש מדומיין בחשבון Cloudflare. בסביבת
// בדיקות, וגם בכתובת *.workers.dev, הוא חסר או מתעלם — והקוד ממשיך בלעדיו.
function edgeCache() {
  try {
    return globalThis.caches?.default || null;
  } catch {
    return null;
  }
}

function listFilterSql(query) {
  let clause = "";
  const bindings = [];
  for (const filter of query.filters) {
    // CAST ל-TEXT: מזהה תיקייה שנשמר כמספר בגיבוי ישן עדיין מתאים לערך מהכתובת.
    clause += ` AND CAST(json_extract(data_json, '$.${filter.field}') AS TEXT) = ?`;
    bindings.push(filter.value);
  }
  if (query.ids.length) {
    clause += ` AND document_id IN (${query.ids.map(() => "?").join(", ")})`;
    bindings.push(...query.ids);
  }
  if (query.excludeIds?.length) {
    clause += ` AND document_id NOT IN (${query.excludeIds.map(() => "?").join(", ")})`;
    bindings.push(...query.excludeIds);
  }
  return { clause, bindings };
}

// document_id הוא שובר־שוויון: בלי סדר מלא ויציב, עמוד על שדה עם ערכים
// חוזרים עלול להחזיר את אותה שורה פעמיים או לדלג על שורה. הסמן ממשיך
// מהשורה האחרונה בהשוואת צמד (ערך המיון, מזהה), שנכתבת כ-OR מפורש כי
// תמיכת D1 בהשוואת שורות אינה מובטחת. שורה אחת מעבר לעמוד מגלה אם יש
// המשך, בלי שאילתת ספירה נוספת.
async function listDocuments(env, collectionName, query) {
  const order = orderExpression(query.orderField);
  const { clause, bindings } = listFilterSql(query);
  let cursorClause = "";
  const cursorBindings = [];
  if (query.after) {
    const comparator = query.direction === "ASC" ? ">" : "<";
    cursorClause = ` AND (${order} ${comparator} ? OR (${order} = ? AND document_id > ?))`;
    cursorBindings.push(query.after.value, query.after.value, query.after.id);
  }
  const offset = query.after ? 0 : query.offset;
  const result = await env.GALLERY_DB.prepare(
    `SELECT document_id, data_json, ${order} AS order_value FROM gallery_documents
     WHERE collection_name = ?${clause}${cursorClause}
     ORDER BY ${order} ${query.direction}, document_id ASC
     LIMIT ? OFFSET ?`
  ).bind(collectionName, ...bindings, ...cursorBindings, query.limit + 1, offset).all();
  const rows = result.results || [];
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const documents = pageRows.map(row => ({ id: row.document_id, data: parseDocumentData(row) }));
  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow
    ? encodeCursor(Number(lastRow.order_value) || 0, String(lastRow.document_id))
    : null;
  return { success: true, documents, offset, limit: query.limit, hasMore, nextCursor };
}

async function countDocuments(env, collectionName, query) {
  const { clause, bindings } = listFilterSql(query);
  const row = await env.GALLERY_DB.prepare(
    `SELECT COUNT(*) AS count FROM gallery_documents WHERE collection_name = ?${clause}`
  ).bind(collectionName, ...bindings).first();
  return { success: true, count: Number(row?.count) || 0 };
}

// מונים מקובצים בשאילתה אחת, למשל כמה פריטים בכל תיקייה — במקום רשימה
// מלאה או בקשת ספירה לכל תיקייה.
async function countDocumentsGrouped(env, collectionName, query) {
  const { clause, bindings } = listFilterSql(query);
  const result = await env.GALLERY_DB.prepare(
    `SELECT COALESCE(CAST(json_extract(data_json, '$.${query.by}') AS TEXT), '') AS value, COUNT(*) AS count
     FROM gallery_documents
     WHERE collection_name = ?${clause}
     GROUP BY value`
  ).bind(collectionName, ...bindings).all();
  const counts = {};
  let total = 0;
  for (const row of result.results || []) {
    const count = Number(row.count) || 0;
    counts[String(row.value ?? "")] = count;
    total += count;
  }
  return { success: true, by: query.by, total, counts };
}

// רשימות ומונים: קודם מטמון הקצה, ואחריו D1. העותק במטמון הוא גוף + ETag
// בלבד, בלי כותרות CORS — אלה נבנות לכל בקשה לפי מקורה. לדפדפן התשובה
// נשארת no-store כבעבר; s-maxage חל רק על העותק שבמטמון.
async function serveCachedList(request, env, ctx, collectionName, actor, query) {
  const version = await readDataVersion(env, collectionName);
  const cache = EDGE_CACHE_EXCLUDED_COLLECTIONS.has(collectionName) ? null : edgeCache();
  const cacheKey = cache
    ? await dataCacheKey(request, collectionName, query, version, actorPermissionClass(actor))
    : "";
  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) {
      const body = await cached.text();
      const etag = cached.headers.get("ETag") || await computeEtag(body);
      return conditionalJson(request, body, etag);
    }
  }

  const payload = query.kind === "count"
    ? await countDocuments(env, collectionName, query)
    : query.kind === "counts"
      ? await countDocumentsGrouped(env, collectionName, query)
      : await listDocuments(env, collectionName, query);
  const body = JSON.stringify(payload);
  const etag = await computeEtag(body);

  if (cache) {
    const stored = cache.put(cacheKey, new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `s-maxage=${DATA_CACHE_TTL_SECONDS}`,
        "ETag": etag
      }
    })).catch(error => console.warn("Edge cache write skipped", error?.message || error));
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(stored);
    else await stored;
  }
  return conditionalJson(request, body, etag);
}

// שדות תאריך הצילום ברשומת מדיה (images / pendingImages). הלקוח קורא אותם
// מה-EXIF או מהסרטון; כאן הם רק נבדקים ומנורמלים:
//   takenAt       — מספר (ms) בין 1971 לעכשיו + יומיים; אחרת נמחק עם שאר השדות.
//   takenDate     — "YYYY-MM-DD" של שעון המצלמה; חייב להתאים ל-takenAt בטווח
//                   אזורי הזמן (‎-14 עד ‎+14 שעות), ואחרת נגזר ממנו.
//   takenAtOffset — "+03:00" או נמחק.
//   takenAtSource — exif / video / drive, או none ("נבדק ולא נמצא") בלי takenAt.
// כתיבה של רשומה מעותק ישן, בלי אף אחד מהשדות, משאירה את מה שכבר נשמר.
export function normalizeCaptureFields(data, existing = {}, now = Date.now()) {
  const next = { ...data };
  const hasOwn = field => Object.prototype.hasOwnProperty.call(data || {}, field);
  if (!CAPTURE_FIELDS.some(hasOwn)) {
    for (const field of CAPTURE_FIELDS) {
      if (existing?.[field] !== undefined) next[field] = existing[field];
    }
    if (!CAPTURE_FIELDS.some(field => next[field] !== undefined)) return next;
  }
  const rawTakenAt = next.takenAt;
  const takenAt = typeof rawTakenAt === "number" || (typeof rawTakenAt === "string" && /^\d{10,16}$/.test(rawTakenAt))
    ? Number(rawTakenAt)
    : NaN;
  const validTakenAt = Number.isFinite(takenAt) && takenAt >= TAKEN_AT_MIN && takenAt <= now + TAKEN_AT_FUTURE_SLACK_MS;
  if (!validTakenAt) {
    const checkedWithoutDate = next.takenAtSource === "none";
    for (const field of CAPTURE_FIELDS) delete next[field];
    if (checkedWithoutDate) next.takenAtSource = "none";
    return next;
  }
  next.takenAt = Math.round(takenAt);

  const offsetMatch = /^([+-])(0\d|1[0-4]):([0-5]\d)$/.exec(String(next.takenAtOffset || ""));
  if (offsetMatch) next.takenAtOffset = offsetMatch[0];
  else delete next.takenAtOffset;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(next.takenDate || ""));
  let dateOk = false;
  if (dateMatch) {
    const dayStart = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
    const roundTrip = new Date(dayStart).toISOString().slice(0, 10) === dateMatch[0];
    const hour = 60 * 60 * 1000;
    dateOk = roundTrip && next.takenAt >= dayStart - 14 * hour && next.takenAt < dayStart + 38 * hour;
  }
  if (!dateOk) {
    const offsetMinutes = offsetMatch
      ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * (offsetMatch[1] === "-" ? -1 : 1)
      : 0;
    next.takenDate = new Date(next.takenAt + offsetMinutes * 60000).toISOString().slice(0, 10);
  }

  if (!TAKEN_AT_SOURCES.has(next.takenAtSource) || next.takenAtSource === "none") delete next.takenAtSource;
  return next;
}

async function handleDataRequest(request, env, url, ctx) {
  await ensureDatabaseSchema(env);
  const parts = url.pathname.slice("/data/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const collectionName = safeDataPart(parts[0], "שם האוסף");
  if (!DATA_COLLECTIONS.has(collectionName)) throw apiError("האוסף המבוקש אינו קיים.", 404, "collection_not_found");
  const documentId = parts[1] ? safeDataPart(parts[1], "מזהה המסמך") : "";
  // /count ו-/counts הם רשימות מקוצרות, לא מסמכים, ונבדקים באותן הרשאות
  // של רשימת האוסף.
  const listKind = request.method === "GET" && ["count", "counts"].includes(documentId) ? documentId : "";
  const actor = await dataActor(request, env);
  assertDataPermission(actor, collectionName, request.method, listKind ? "" : documentId);

  if (request.method === "GET" && documentId && !listKind) {
    const row = await env.GALLERY_DB.prepare(
      "SELECT data_json FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
    ).bind(collectionName, documentId).first();
    if (!row) throw apiError("המסמך לא נמצא.", 404, "not_found");
    return etagJson(request, { success: true, id: documentId, data: parseDocumentData(row) });
  }

  if (request.method === "GET") {
    const query = parseListQuery(url, listKind || "list");
    // המסמכים הפנימיים של systemMeta אינם יוצאים ברשימה למי שאינו מנהל־על.
    // מחלקת ההרשאה כבר חלק ממפתח המטמון, ולכן אין ערבוב בין העותקים.
    if (collectionName === "systemMeta" && actorPermissionClass(actor) !== "super_admin") {
      query.excludeIds = [...SYSTEM_META_PRIVATE_IDS];
    }
    return serveCachedList(request, env, ctx, collectionName, actor, query);
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
    // לקוח שכותב רשומת מדיה שלמה מעותק ישן (בלי variants) אינו מוחק את התצוגות
    // שריצת ההשלמה כבר רשמה; הקבצים עצמם נשארים ב-R2 בכל מקרה.
    if (["images", "pendingImages"].includes(collectionName) && existing.variants && nextData.variants === undefined) {
      nextData = { ...nextData, variants: existing.variants, variantsVersion: existing.variantsVersion };
    }
    // הרקע המטושטש (placeholder): אותו כלל — עותק ישן בלי השדה אינו מוחק אותו —
    // וערך שאינו data URL קטן ותקין לעולם אינו נשמר (הוא מוצב כ-CSS בגלריה).
    if (["images", "pendingImages"].includes(collectionName)) {
      if (nextData.placeholder === undefined && existing.placeholder) nextData = { ...nextData, placeholder: existing.placeholder };
      const placeholder = normalizeMediaPlaceholder(nextData.placeholder);
      if (placeholder) nextData.placeholder = placeholder;
      else delete nextData.placeholder;
    }
    if (["images", "pendingImages"].includes(collectionName)) {
      nextData = normalizeContentHash(nextData, existing);
      nextData = normalizeCaptureFields(nextData, existing);
      // כיתוב ותגיות: רק מנהל משנה אותם, ועותק ישן בלי השדות אינו מוחק אותם.
      const canEditDescription = (actor.status === "approved" || actor.initialAdmin) && ["admin", "super_admin"].includes(actor.role);
      nextData = normalizeImageDescriptionFields(nextData, existing, { canEdit: canEditDescription });
      // סדר ידני ועריכת סיבוב/חיתוך: אותו כלל — רק מנהל, ועותק ישן אינו מוחק.
      nextData = normalizeImageArrangeFields(nextData, existing, { canEdit: canEditDescription, existed: Boolean(existingRow) });
      if (existing.aiTitleVersion === 1) {
        nextData.aiTitleVersion = existing.aiTitleVersion;
        nextData.aiTitleGeneratedAt = existing.aiTitleGeneratedAt;
        nextData.originalTitle = existing.originalTitle;
        if (nextData.title === existing.originalTitle) nextData.title = existing.title;
      }
    }

    if (collectionName === "images" && backgroundActors.has(request) && existing.driveFileId && nextData.driveModifiedTime !== existing.driveModifiedTime) {
      // תוכן Drive שהוחלף חייב להיבדק מחדש, ולא לרשת את תוצאות הקובץ הקודם.
      nextData.variants = {};
      nextData.variantsVersion = 0;
      // הרקע המטושטש תיאר את הקובץ הקודם; ריצת התצוגות הבאה יוצרת חדש.
      delete nextData.placeholder;
      nextData.aiTitleVersion = 0;
      nextData.aiTitleGeneratedAt = null;
      nextData.title = String(payload.data.originalTitle || payload.data.title || "").replace(/\.[^.]+$/, "");
      nextData.originalTitle = String(payload.data.originalTitle || payload.data.title || "");
      nextData.takenAt = payload.data.takenAt || null;
      nextData.takenAtDate = payload.data.takenAtDate || null;
      nextData.takenAtSource = payload.data.takenAtSource || null;
      // כיתוב ותגיות של ה־AI תיארו את הקובץ הקודם; כיתוב שמנהל ערך ידנית נשאר.
      if (nextData.captionSource !== "manual") {
        for (const field of ["caption", "sceneTags", "captionSource", "aiCaptionVersion", "aiCaptionGeneratedAt"]) delete nextData[field];
      }
      // סיבוב וחיתוך שנקבעו לקובץ הקודם אינם מתאימים לתוכן החדש.
      delete nextData.edit;
      await deleteFaceIndexForImage(env, documentId);
    }
    if (collectionName === "folders") {
      // תיקיית אב, תמונת שער וסדר: נבדקים כאן ולא סומכים על הדפדפן.
      nextData = await normalizeFolderFields(env, documentId, nextData, existing);
    }
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

    // מי ששמר הגדרה נקבע לפי החשבון המאומת, לא לפי מה שהדפדפן כתב בשדה.
    if (collectionName === "systemMeta" && Object.prototype.hasOwnProperty.call(nextData, "updatedBy")) {
      nextData.updatedBy = actor.uid;
    }

    if (collectionName === "userProfiles" && documentId === actor.uid && !actor.initialAdmin && actor.role !== "super_admin") {
      nextData = {
        ...nextData,
        uid: actor.uid,
        email: actor.email,
        status: existingRow ? (existing.status || "pending") : "pending",
        role: existingRow ? (existing.role || "viewer") : "viewer"
      };
      // "הגיע מהזמנה לאירוע" נכתב רק בשרת (redeemInvite); המשתמש אינו יכול
      // לסמן את עצמו כמוזמן כדי להיראות אמין יותר בבקשת ההצטרפות.
      for (const field of INVITE_PROFILE_FIELDS) {
        if (existing[field] !== undefined) nextData[field] = existing[field];
        else delete nextData[field];
      }
    }
    // צופה ששולח העלאה לאישור כותב רק רשומה משלו: המעלה הוא החשבון המאומת,
    // המצב תמיד "ממתין", ורשומה ממתינה של משתמש אחר אינה נדרסת. כך "ההעלאות
    // שלי" (GET /my-uploads) לעולם אינו מציג למשתמש פריט של מישהו אחר.
    if (collectionName === "pendingImages" && !["admin", "super_admin"].includes(actor.role)) {
      if (existingRow && existing.uploadedBy && existing.uploadedBy !== actor.uid) {
        throw apiError("אין הרשאה לפעולה זו.", 403, "permission_denied");
      }
      // פריט שכבר אושר אינו חוזר לתור האישור בכתיבה של המעלה.
      if (existingRow && existing.status === "approved") {
        throw apiError("הפריט כבר אושר.", 409, "already_approved");
      }
      nextData = { ...nextData, uploadedBy: actor.uid, status: "pending" };
      delete nextData.uid;
    }
    if (collectionName === "userProfiles" && actor.initialAdmin && documentId === actor.uid) {
      nextData = { ...nextData, uid: actor.uid, email: actor.email, status: "approved", role: "super_admin" };
    }
    // מנהל־על אינו מוריד את עצמו מדרגה 4 ואינו חוסם את עצמו, ואף אחד אינו
    // מוריד או חוסם את מנהל־העל המאושר האחרון — גם לא בכתיבה ישירה ל-/data.
    if (collectionName === "userProfiles" && existingRow) {
      await assertSuperAdminRetained(env, actor, documentId, existing, nextData);
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
    // פריט ממתין שחזר (שחזור מסל המחזור) אינו "נדחה" עוד אצל המעלה.
    if (collectionName === "pendingImages" && !existingRow && ["admin", "super_admin"].includes(actor.role)) {
      await env.GALLERY_DB.prepare("DELETE FROM upload_rejections WHERE image_id = ?").bind(documentId).run();
    }
    await bumpDataVersion(env, collectionName);
    if (collectionName === "images" && !existingRow && nextData.mediaType !== "video" && selectedAiKey(env) && ctx?.waitUntil) {
      // שם, כיתוב ותגיות לתמונה חדשה נוצרים ברקע, אחרי שהתשובה יצאה — רק כשמשימת
      // "titles" של העיבוד בענן פעילה. בלי מפתח AI אין קריאה כלל, וכישלון לעולם
      // אינו מכשיל את השמירה: התמונה תיאסף בריצת ההשלמה (בענן או בלוח הניהול).
      ctx.waitUntil(readBackgroundConfig(env).then(config => config.enabled.titles ? generateImageDescription(request, env, documentId) : null).catch(error => {
        console.warn("Automatic image description failed", error.code || "ai_title_failed");
      }));
    }
    return json(request, { success: true, id: documentId, data: nextData });
  }

  if (request.method === "DELETE" && documentId) {
    if (collectionName === "folders") {
      // אין מחיקה מדורגת: תיקייה שיש בה תת־תיקיות נשארת עד שהן מועברות או
      // נמחקות. כך גם דפדפן ישן, או ניקוי התיקיות הריקות, אינם משאירים
      // תת־תיקיות יתומות.
      const child = await env.GALLERY_DB.prepare(
        `SELECT document_id FROM gallery_documents
         WHERE collection_name = 'folders' AND json_extract(data_json, '$.parentId') = ? LIMIT 1`
      ).bind(documentId).first();
      if (child) {
        throw apiError("אי אפשר למחוק תיקייה שיש בה תת־תיקיות. העבר או מחק קודם את תת־התיקיות.", 409, "folder_has_children");
      }
    }
    // מחיקת פרופיל היא גם הסרת הגישה: אותם כללים כמו בחסימה (ראו assertSuperAdminRetained).
    // פריט ממתין נקרא פעם אחת, לפני המחיקה, לשני צרכים: פריט שנמחק לפני שאושר
    // (סל המחזור, מחיקה סופית) נדחה מבחינת המעלה — נשאר ממנו רק תיעוד מינימלי,
    // שהמעלה עצמו רואה ב"ההעלאות שלי"; ורק פריט שעדיין המתין נספר כ"נדחה"
    // בסטטיסטיקות (רשומת תיעוד של פריט שאושר אינה). POST /pending/reject רק
    // רושם את הסיבה ואינו סופר, כך שכל דחייה נספרת כאן, פעם אחת.
    let deletedPending = null;
    let deletedPendingStatus = "";
    if (collectionName === "userProfiles") {
      const existingRow = await readGalleryDocumentRow(env, collectionName, documentId);
      if (existingRow) await assertSuperAdminRetained(env, actor, documentId, parseDocumentData(existingRow), {});
    } else if (collectionName === "pendingImages") {
      const pendingRow = await readGalleryDocumentRow(env, collectionName, documentId);
      deletedPending = pendingRow ? parseDocumentData(pendingRow) : null;
      deletedPendingStatus = deletedPending ? String(deletedPending.status || "pending") : "";
    }
    await env.GALLERY_DB.prepare(
      "DELETE FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
    ).bind(collectionName, documentId).run();
    if (deletedPending) await recordUploadRejection(env, documentId, deletedPending, { actorUid: actor.uid });
    await bumpDataVersion(env, collectionName);
    if (collectionName === "userProfiles") {
      await env.GALLERY_DB.prepare("DELETE FROM user_email_index WHERE document_id = ?").bind(documentId).run();
      // משתמש שנמחק אינו משאיר אחריו את טביעת "זכור אותי" שלו.
      await env.GALLERY_DB.prepare("DELETE FROM face_user_descriptors WHERE uid = ?").bind(documentId).run();
      // וגם לא הערות פנימיות עליו: אין להן עוד משתמש לשייך אליו.
      await env.GALLERY_DB.prepare("DELETE FROM admin_user_notes WHERE target_uid = ?").bind(documentId).run();
    }
    // מחיקת תמונה מוחקת גם את כל טביעות הפנים שלה, כדי שחיפוש לא יחזיר מזהה שנמחק,
    // וגם את קובצי התצוגות המקדימות שלה.
    if (collectionName === "images") {
      await deleteFaceIndexForImage(env, documentId);
      await deleteMediaVariantsForImage(env, documentId);
    } else if (collectionName === "pendingImages" && !(await hasActiveImageDocument(env, documentId))) {
      // תמונה שאושרה שומרת את אותו מזהה גם באוסף images. ניקוי הרשומה
      // הממתינה שלה אינו אמור למחוק את הטביעות של התמונה הפעילה.
      await deleteFaceIndexForImage(env, documentId);
      await deleteMediaVariantsForImage(env, documentId);
      if (deletedPendingStatus === "pending") await recordUsage(env, { rejections: 1 });
    }
    return json(request, { success: true, id: documentId });
  }

  throw apiError("הפעולה אינה נתמכת.", 405, "method_not_allowed");
}

export {
  safeDataPart,
  DATA_COLLECTIONS,
  SYSTEM_META_SUPER_ADMIN_WRITE_IDS,
  SYSTEM_META_PRIVATE_IDS,
  assertDataPermission,
  resolveDataOperations,
  readDataVersion,
  bumpDataVersion,
  bumpDataVersions,
  encodeCursor,
  decodeCursor,
  orderExpression,
  parseListQuery,
  listQueryKey,
  actorPermissionClass,
  dataCacheKey,
  edgeCache,
  listFilterSql,
  listDocuments,
  countDocuments,
  countDocumentsGrouped,
  serveCachedList,
  handleDataRequest
};
