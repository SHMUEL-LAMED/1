// העלאות: placeholder, גיבוב תוכן, "ההעלאות שלי", דחייה וכפילויות.
import {
  requireUser
} from "./auth.js";
import {
  CONTENT_HASH_COLLECTIONS_SQL,
  CONTENT_HASH_PATTERN,
  CONTENT_HASH_SQL,
  DUPLICATE_CHECK_MAX_HASHES,
  DUPLICATE_CHECK_RATE_LIMIT,
  DUPLICATE_CHECK_RATE_WINDOW_MS,
  FACE_ID_QUERY_CHUNK,
  FACE_VIEWER_ROLES,
  MAINTENANCE_DAY_MS,
  MY_UPLOADS_LIMIT,
  MY_UPLOADS_RATE_LIMIT,
  MY_UPLOADS_RATE_WINDOW_MS,
  UPLOAD_REJECTION_REASON_MAX_LENGTH,
  UPLOAD_REJECTION_RETENTION_DAYS,
  UPLOAD_REJECT_RATE_LIMIT,
  UPLOAD_REJECT_RATE_WINDOW_MS
} from "./config.js";
import {
  hasActiveImageDocument,
  httpsUrl
} from "./faces.js";
import {
  readGalleryDocumentRow,
  safeImageId
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  consumeRateLimit,
  json,
  parseDocumentData
} from "./util.js";

// --- הרקע המטושטש (placeholder) של פריט מדיה ---
// data URL קטן (BMP של רשת צבעים זעירה; WebP, PNG ו-JPEG מותרים גם הם) שנוצר
// בדפדפן יחד עם התצוגות (media-variants-generate.js). רק base64 נקי ועד 400 תווים, כי
// הגלריה מציבה אותו כ-CSS; כל ערך אחר נזרק. זהה ל-normalizePlaceholder שב-media-variants.js.
const MEDIA_PLACEHOLDER_MAX_LENGTH = 400;
const MEDIA_PLACEHOLDER_PATTERN = /^data:image\/(?:bmp|webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

export function normalizeMediaPlaceholder(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length <= MEDIA_PLACEHOLDER_MAX_LENGTH && MEDIA_PLACEHOLDER_PATTERN.test(text) ? text : "";
}

// ==========================================================================
// משתמשים: "ההעלאות שלי", כפילויות לפני העלאה, תיוג ידני והזמנות לאירוע
// ==========================================================================

// טקסט חופשי קצר (סיבת דחייה, שם תיקייה): בלי תווי בקרה ובלי תווי כיווניות
// שמאפשרים להציג טקסט מטעה. הדפדפן מציג אותו תמיד כטקסט, לא כ-HTML.
function cleanShortText(value, maxLength) {
  const text = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, maxLength).join("").trim();
}

// טביעת התוכן ברשומת מדיה: נשמרת רק בצורה תקינה (contentHash הוא כבר שדה
// שהדפדפן כותב מאז זיהוי הכפילויות הראשון). עותק בלי השדה אינו מוחק אותו.
export function normalizeContentHash(data, existing = {}) {
  const next = { ...data };
  if (next.contentHash === undefined) {
    if (typeof existing?.contentHash === "string" && CONTENT_HASH_PATTERN.test(existing.contentHash)) next.contentHash = existing.contentHash;
    return next;
  }
  const value = typeof next.contentHash === "string" ? next.contentHash.trim().toLowerCase() : "";
  if (CONTENT_HASH_PATTERN.test(value)) next.contentHash = value;
  else delete next.contentHash;
  return next;
}

function safeUid(value) {
  const uid = String(value ?? "");
  return /^[a-zA-Z0-9_-]{1,128}$/.test(uid) ? uid : "";
}

// תיעוד דחייה של פריט ממתין. reason === null: נקרא ממחיקת הרשומה הממתינה —
// תיעוד קיים (עם הסיבה שהמנהל כתב ב-/pending/reject) נשאר כפי שהוא.
async function recordUploadRejection(env, imageId, data, { actorUid = "", reason = null } = {}) {
  if (!data || data.status === "approved") return false;
  const uploader = safeUid(data.uploadedBy);
  if (!uploader) return false;
  // הפריט כבר בגלריה (האישור נכשל באמצע וסימון "אושר" לא נכתב) — לא נדחה.
  if (await hasActiveImageDocument(env, imageId)) return false;
  const now = Date.now();
  const title = cleanShortText(data.title, 160);
  if (reason === null) {
    await env.GALLERY_DB.prepare(
      `INSERT INTO upload_rejections (image_id, uploader_uid, title, reason, rejected_by, rejected_at)
       VALUES (?, ?, ?, '', ?, ?)
       ON CONFLICT(image_id) DO NOTHING`
    ).bind(imageId, uploader, title, safeUid(actorUid), now).run();
  } else {
    await env.GALLERY_DB.prepare(
      `INSERT INTO upload_rejections (image_id, uploader_uid, title, reason, rejected_by, rejected_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(image_id) DO UPDATE SET
         uploader_uid = excluded.uploader_uid, title = excluded.title, reason = excluded.reason,
         rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at`
    ).bind(imageId, uploader, title, reason, safeUid(actorUid), now).run();
  }
  return true;
}

function mediaThumbUrl(data) {
  const isVideo = data?.mediaType === "video";
  return httpsUrl(data?.variants?.thumb?.url)
    || (isVideo ? httpsUrl(data?.variants?.poster?.url) : httpsUrl(data?.url));
}

async function readDocumentsByIds(env, collectionName, ids, columns = "document_id, data_json") {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += FACE_ID_QUERY_CHUNK) {
    const chunk = ids.slice(offset, offset + FACE_ID_QUERY_CHUNK);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const result = await env.GALLERY_DB.prepare(
      `SELECT ${columns} FROM gallery_documents WHERE collection_name = ? AND document_id IN (${placeholders})`
    ).bind(collectionName, ...chunk).all();
    rows.push(...(result.results || []));
  }
  return rows;
}

// GET /my-uploads — ההעלאות של המשתמש המחובר בלבד: ממתינות, שאושרו (ולאיזו
// תיקייה) ושנדחו (עם הסיבה, אם המנהל כתב). כל השאילתות מסוננות לפי המזהה
// המאומת — גם owner_uid וגם uploadedBy — ואין פרמטר שמאפשר לבקש משתמש אחר.
// לא נשלחים כתובות דוא"ל, שמות של מנהלים או פרטים של משתמשים אחרים.
async function listMyUploads(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env, `my-uploads:${user.uid}`, MY_UPLOADS_RATE_LIMIT, MY_UPLOADS_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.", "my_uploads_rate_limit"
  );
  const uid = user.uid;
  const rejectionCutoff = Date.now() - UPLOAD_REJECTION_RETENTION_DAYS * MAINTENANCE_DAY_MS;
  const pendingRows = (await env.GALLERY_DB.prepare(
    `SELECT document_id, data_json, created_at, updated_at FROM gallery_documents
     WHERE collection_name = 'pendingImages' AND owner_uid = ? AND json_extract(data_json, '$.uploadedBy') = ?
     ORDER BY updated_at DESC LIMIT ?`
  ).bind(uid, uid, MY_UPLOADS_LIMIT).all()).results || [];
  const imageRows = (await env.GALLERY_DB.prepare(
    `SELECT document_id, data_json, created_at FROM gallery_documents
     WHERE collection_name = 'images' AND owner_uid = ? AND json_extract(data_json, '$.uploadedBy') = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(uid, uid, MY_UPLOADS_LIMIT).all()).results || [];
  const rejectionRows = (await env.GALLERY_DB.prepare(
    `SELECT image_id, title, reason, rejected_at FROM upload_rejections
     WHERE uploader_uid = ? AND rejected_at >= ?
     ORDER BY rejected_at DESC LIMIT ?`
  ).bind(uid, rejectionCutoff, MY_UPLOADS_LIMIT).all()).results || [];

  const images = new Map(imageRows.map(row => [String(row.document_id), { data: parseDocumentData(row), createdAt: Number(row.created_at) || 0 }]));
  // פריט שאושר מזמן ואינו בין 200 האחרונים — נקרא לפי מזהה, כדי שיופיע עם התיקייה שלו.
  const missingIds = pendingRows
    .filter(row => parseDocumentData(row).status === "approved")
    .map(row => String(row.document_id))
    .filter(id => !images.has(id));
  for (const row of await readDocumentsByIds(env, "images", missingIds, "document_id, data_json, created_at")) {
    const data = parseDocumentData(row);
    if (safeUid(data.uploadedBy) !== uid) continue;
    images.set(String(row.document_id), { data, createdAt: Number(row.created_at) || 0 });
  }
  const rejections = new Map(rejectionRows.map(row => [String(row.image_id), row]));
  const items = new Map();
  for (const [id, { data, createdAt }] of images) {
    items.set(id, {
      id,
      title: cleanShortText(data.title, 160),
      mediaType: data.mediaType === "video" ? "video" : "image",
      status: "approved",
      uploadedAt: Number(data.createdAt) || createdAt,
      decidedAt: 0,
      folderId: String(data.folderId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
      thumbUrl: mediaThumbUrl(data)
    });
  }
  for (const row of pendingRows) {
    const id = String(row.document_id);
    const data = parseDocumentData(row);
    const existing = items.get(id);
    if (existing) {
      // אושר מתוך התור: מתי — לטובת ההודעה "X מההעלאות שלך אושרו".
      if (data.status === "approved") existing.decidedAt = Number(data.approvedAt) || 0;
      continue;
    }
    // סומן "אושר" אבל אינו בגלריה (נמחק אחר כך) — אינו מוצג.
    if (data.status === "approved") continue;
    const rejection = rejections.get(id);
    items.set(id, {
      id,
      title: cleanShortText(data.title, 160),
      mediaType: data.mediaType === "video" ? "video" : "image",
      status: rejection ? "rejected" : "pending",
      uploadedAt: Number(data.createdAt) || Number(row.created_at) || 0,
      decidedAt: rejection ? Number(rejection.rejected_at) || 0 : 0,
      ...(rejection && rejection.reason ? { reason: String(rejection.reason) } : {})
    });
  }
  for (const [id, row] of rejections) {
    if (items.has(id)) continue;
    items.set(id, {
      id,
      title: String(row.title || ""),
      mediaType: "image",
      status: "rejected",
      uploadedAt: 0,
      decidedAt: Number(row.rejected_at) || 0,
      ...(row.reason ? { reason: String(row.reason) } : {})
    });
  }
  // שמות התיקיות שאליהן הפריטים שאושרו נכנסו — כל מאושר רואה את התיקיות ממילא.
  const folderIds = [...new Set([...items.values()].map(item => item.folderId).filter(Boolean))];
  const folderNames = new Map();
  for (const row of await readDocumentsByIds(env, "folders", folderIds)) {
    folderNames.set(String(row.document_id), cleanShortText(parseDocumentData(row).name, 120));
  }
  const all = [...items.values()];
  for (const item of all) {
    if (item.folderId) item.folderName = folderNames.get(item.folderId) || "";
  }
  all.sort((left, right) => (Math.max(right.decidedAt, right.uploadedAt) - Math.max(left.decidedAt, left.uploadedAt)) || left.id.localeCompare(right.id));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const item of all) counts[item.status] += 1;
  return json(request, {
    success: true,
    retentionDays: UPLOAD_REJECTION_RETENTION_DAYS,
    counts,
    uploads: all.slice(0, MY_UPLOADS_LIMIT)
  });
}

// POST /pending/reject { imageId, reason } — מנהל רושם סיבה (רשות) לדחייה של
// פריט ממתין, לפני שהוא עובר לסל המחזור או לבקשת מחיקה. המעלה רואה את הסיבה
// ב"ההעלאות שלי"; איש מלבדו אינו מקבל אותה מהשרת.
async function rejectPendingUpload(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env, `upload-reject:${user.uid}`, UPLOAD_REJECT_RATE_LIMIT, UPLOAD_REJECT_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.", "upload_reject_rate_limit"
  );
  const payload = await request.json().catch(() => ({}));
  const imageId = safeImageId(payload?.imageId);
  if (payload?.reason !== undefined && payload?.reason !== null && typeof payload.reason !== "string") {
    throw apiError("סיבת הדחייה אינה תקינה.", 400, "invalid_reason");
  }
  const reason = cleanShortText(payload?.reason, UPLOAD_REJECTION_REASON_MAX_LENGTH);
  const row = await readGalleryDocumentRow(env, "pendingImages", imageId);
  if (!row) throw apiError("הפריט הממתין לא נמצא.", 404, "pending_not_found");
  const data = parseDocumentData(row);
  if (data.status === "approved") throw apiError("הפריט כבר אושר.", 409, "already_approved");
  const recorded = await recordUploadRejection(env, imageId, data, { actorUid: user.uid, reason });
  return json(request, { success: true, recorded });
}

// POST /duplicates { hashes: [...] } — האם כבר יש בגלריה (או בתור
// האישור) פריט עם אותה טביעת תוכן. התשובה לכל טביעה: exists בלבד, ומזהה
// הפריט רק כשהשואל רשאי לראות אותו — פריט מאושר, פריט ממתין שלו, או כל פריט
// למנהל. על פריט ממתין של משתמש אחר נאמר רק שהוא קיים.
async function checkDuplicateUploads(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env, `duplicates:${user.uid}`, DUPLICATE_CHECK_RATE_LIMIT, DUPLICATE_CHECK_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.", "duplicates_rate_limit"
  );
  const payload = await request.json().catch(() => ({}));
  if (!Array.isArray(payload?.hashes) || payload.hashes.length > DUPLICATE_CHECK_MAX_HASHES) {
    throw apiError(`יש לשלוח עד ${DUPLICATE_CHECK_MAX_HASHES} טביעות.`, 400, "invalid_hashes");
  }
  const hashes = [...new Set(payload.hashes.map(value => (typeof value === "string" ? value.trim().toLowerCase() : "")))];
  if (hashes.some(hash => !CONTENT_HASH_PATTERN.test(hash))) {
    throw apiError("טביעת התוכן אינה תקינה.", 400, "invalid_hashes");
  }
  const isAdmin = ["admin", "super_admin"].includes(user.role);
  const found = new Map();
  const rank = entry => (entry.collection === "images" ? 3 : entry.visible ? 2 : 1);
  for (let offset = 0; offset < hashes.length; offset += 50) {
    const chunk = hashes.slice(offset, offset + 50);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT collection_name AS collectionName, document_id AS id, owner_uid AS ownerUid,
         ${CONTENT_HASH_SQL} AS hash,
         json_extract(data_json, '$.status') AS status,
         json_extract(data_json, '$.uploadedBy') AS uploadedBy
       FROM gallery_documents
       WHERE ${CONTENT_HASH_COLLECTIONS_SQL} AND ${CONTENT_HASH_SQL} IN (${placeholders})`
    ).bind(...chunk).all()).results || [];
    for (const row of rows) {
      const collection = String(row.collectionName);
      if (collection === "pendingImages" && row.status === "approved") continue;
      const own = String(row.ownerUid || "") === user.uid && String(row.uploadedBy || "") === user.uid;
      const entry = { collection, id: String(row.id), visible: collection === "images" || isAdmin || own };
      const previous = found.get(String(row.hash));
      if (!previous || rank(entry) > rank(previous)) found.set(String(row.hash), entry);
    }
  }
  return json(request, {
    success: true,
    results: hashes.map(hash => {
      const entry = found.get(hash);
      if (!entry) return { hash, exists: false };
      return entry.visible
        ? { hash, exists: true, imageId: entry.id, state: entry.collection === "images" ? "approved" : "pending" }
        : { hash, exists: true };
    })
  });
}

export {
  MEDIA_PLACEHOLDER_MAX_LENGTH,
  MEDIA_PLACEHOLDER_PATTERN,
  cleanShortText,
  safeUid,
  recordUploadRejection,
  mediaThumbUrl,
  readDocumentsByIds,
  listMyUploads,
  rejectPendingUpload,
  checkDuplicateUploads
};
