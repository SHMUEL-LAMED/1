// מדיה: העלאה (רגילה ובחלקים), Stream, הגשה, אישור, מחיקה, גרסאות מוקטנות ותאריך צילום.
import {
  dataActor,
  requireUser
} from "./auth.js";
import {
  actorCanAccessLegacyChatAttachment
} from "./chat.js";
import {
  CAPTURE_FIELDS,
  MAX_CHAT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_RESUMABLE_IMAGE_BYTES,
  MAX_RESUMABLE_VIDEO_BYTES,
  MAX_VARIANT_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_PROBE_MAX_BYTES,
  MEDIA_VARIANTS_RATE_LIMIT,
  MEDIA_VARIANTS_RATE_WINDOW_MS,
  MEDIA_VARIANTS_VERSION,
  MEDIA_VARIANT_MAX_DIMENSION,
  MEDIA_VARIANT_NAMES,
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_SIZE,
  MULTIPART_SESSION_TTL_MS,
  STREAM_API_BASE,
  STREAM_REQUEST_TIMEOUT_MS,
  TAKEN_AT_BATCH_MAX,
  UPLOAD_PART_RATE_LIMIT,
  UPLOAD_PART_RATE_WINDOW_MS,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS
} from "./config.js";
import {
  bumpDataVersion,
  bumpDataVersions,
  normalizeCaptureFields
} from "./data.js";
import {
  deleteFaceIndexForDeletedMedia,
  faceImageIdFromObjectKey,
  hasActiveImageDocument
} from "./faces.js";
import {
  MEDIA_EDIT_REVISION_PATTERN,
  isVideoLikeData
} from "./folders.js";
import {
  assertPublicMediaPath
} from "./maintenance.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  recordUsage
} from "./stats.js";
import {
  normalizeMediaPlaceholder
} from "./uploads.js";
import {
  ALLOWED_CHAT_EXTENSIONS,
  ALLOWED_CHAT_FILE_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_MEDIA_EXTENSIONS,
  ALLOWED_VARIANT_TYPES,
  ALLOWED_VIDEO_TYPES,
  VARIANT_AVIF_EXTENSION,
  VARIANT_AVIF_TYPE,
  apiError,
  consumeRateLimit,
  corsHeaders,
  json,
  parseDocumentData
} from "./util.js";

function safeImageId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) throw apiError("מזהה התמונה אינו תקין.", 400, "invalid_image_id");
  return id;
}

function validateObjectKey(value, requiredState = "") {
  const key = String(value || "");
  const galleryMatch = key.match(/^(approved|pending)\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,120})\.([a-z0-9]{1,10})$/);
  const chatMatch = key.match(/^chat\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,160})\/([a-zA-Z0-9_-]{1,120})\.([a-z0-9]{1,10})$/);
  // תצוגות מקדימות: variants/<imageId>/<thumb|medium|poster>.<webp|jpg|avif>.
  const variantMatch = key.match(/^variants\/([a-zA-Z0-9_-]{1,120})\/(thumb|medium|poster)\.(webp|jpg|avif)$/);
  const extension = galleryMatch?.[4] || chatMatch?.[4] || variantMatch?.[3] || "";
  const state = galleryMatch?.[1] || (chatMatch ? "chat" : (variantMatch ? "variants" : ""));
  if (
    (!galleryMatch && !chatMatch && !variantMatch) ||
    (requiredState && state !== requiredState) ||
    !(ALLOWED_MEDIA_EXTENSIONS.has(extension) || (variantMatch && extension === VARIANT_AVIF_EXTENSION))
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
  // התצוגות המקדימות נבדקות לפני שנשמר דבר, כדי שבקשה פסולה לא תשאיר קובץ חלקי.
  const variantParts = isChatAttachment ? [] : readVariantParts(form);
  // הרקע המטושטש אינו חלק חובה: ערך פסול פשוט אינו נשמר, וההעלאה ממשיכה.
  const placeholder = isChatAttachment ? "" : normalizeMediaPlaceholder(form.get("placeholder"));
  const capturedAt = isChatAttachment ? "" : sanitizeCapturedAt(form.get("capturedAt"));

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
      ...(capturedAt ? { capturedAt } : {}),
      uploadedAt: new Date().toISOString()
    }
  });
  // קובץ גלריה חדש: רשימות התמונות שבמטמון הקצה אינן עדכניות עוד.
  if (!isChatAttachment) {
    await ensureDatabaseSchema(env);
    await bumpDataVersion(env, state === "pending" ? "pendingImages" : "images");
  }

  let variants = null;
  if (variantParts.length) {
    variants = await storeMediaVariants(request, env, imageId, variantParts, { ownerUid: user.uid, state });
    // בהעלאה חדשה הרשומה עדיין לא קיימת: הלקוח מעתיק את variants מהתשובה
    // אל הרשומה שהוא כותב. רשומה שכבר קיימת (העלאה חוזרת) מתעדכנת כאן.
    await attachVariantsToRecords(env, imageId, variants, { placeholder });
  }
  if (!isChatAttachment) await recordUsage(env, { uploads: 1, uploadsPending: state === "pending" ? 1 : 0 });
  // Cloudflare Stream (רשות): סרטון מאושר נשלח גם לשם. בלי הסודות — null.
  const stream = !isChatAttachment && isVideo && state === "approved"
    ? await sendVideoToStream(request, env, { imageId, key, title })
    : null;

  return json(request, {
    success: true,
    key,
    state,
    mediaType,
    mimeType,
    fileName: originalName,
    size: file.size,
    url: mediaUrl(request, key, env),
    ...(variants ? { variants, variantsVersion: MEDIA_VARIANTS_VERSION } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(stream ? { stream } : {})
  }, 201);
}

// --- העלאה בחלקים שאפשר להמשיך (R2 multipart) ---
// סרטון טלפון גדול אינו עולה בבקשה אחת: ניתוק באמצע היה מאבד את כולו. כאן
// הקובץ עולה בחלקים של 8MiB, ומצב ההעלאה — אילו חלקים התקבלו — נשמר ב-D1.
// הלקוח שואל את /upload/multipart/status וממשיך מהחלק הבא, גם אחרי רענון.
//   POST /upload/multipart/create    { imageId, title, fileName, mimeType, size, capturedAt }
//   PUT  /upload/multipart/part?uploadId=&partNumber=   גוף: הבייטים של החלק
//   GET  /upload/multipart/status?uploadId=
//   POST /upload/multipart/complete  טופס: uploadId ו-variant_* כמו ב-/upload
//   POST /upload/multipart/abort     { uploadId }
// ההרשאות זהות ל-/upload: משתמש מאושר; צופה (דרגה 1) מעלה ל-pending/.
// רק מי שפתח את ההעלאה רשאי להמשיך, להשלים או לבטל אותה.

function sanitizeUploadName(value, fallback = "קובץ") {
  return String(value || fallback)
    .replace(/[\r\n"\\/]+/g, "-")
    .trim()
    .slice(0, 180) || fallback;
}

// תאריך הצילום מגיע מהדפדפן (EXIF), משום שקידוד מחדש ב-Canvas מוחק את ה-EXIF.
function sanitizeCapturedAt(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return "";
  const time = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : `${text}Z`);
  return Number.isFinite(time) ? text : "";
}

function multipartPartLength(session, partNumber) {
  const totalParts = Number(session.total_parts);
  const partSize = Number(session.part_size);
  if (partNumber < totalParts) return partSize;
  return Number(session.total_size) - partSize * (totalParts - 1);
}

function uploadIdFrom(value) {
  const uploadId = String(value || "").trim();
  if (!uploadId || uploadId.length > 1024 || /[\s\0]/.test(uploadId)) {
    throw apiError("מזהה ההעלאה אינו תקין.", 400, "invalid_upload_id");
  }
  return uploadId;
}

async function readOwnedUploadSession(env, uploadId, user) {
  await ensureDatabaseSchema(env);
  const session = await env.GALLERY_DB.prepare(
    "SELECT * FROM upload_sessions WHERE upload_id = ?"
  ).bind(uploadId).first();
  if (!session) throw apiError("ההעלאה לא נמצאה או שפג תוקפה. התחל אותה מחדש.", 404, "upload_session_not_found");
  if (String(session.owner_uid) !== user.uid) {
    throw apiError("אין הרשאה להמשיך העלאה של משתמש אחר.", 403, "permission_denied");
  }
  return session;
}

async function readUploadedParts(env, uploadId) {
  const rows = await env.GALLERY_DB.prepare(
    "SELECT part_number, etag, size_bytes FROM upload_session_parts WHERE upload_id = ? ORDER BY part_number"
  ).bind(uploadId).all();
  return (rows.results || []).map(row => ({
    partNumber: Number(row.part_number),
    etag: String(row.etag),
    size: Number(row.size_bytes) || 0
  }));
}

async function forgetUploadSession(env, uploadId) {
  await env.GALLERY_DB.prepare("DELETE FROM upload_session_parts WHERE upload_id = ?").bind(uploadId).run();
  await env.GALLERY_DB.prepare("DELETE FROM upload_sessions WHERE upload_id = ?").bind(uploadId).run();
}

// העלאות של המשתמש שלא נגעו בהן מעבר לתוקף: החלקים ב-R2 מבוטלים (R2 היה
// מבטל אותם ממילא אחרי שבוע) והשורות נמחקות. כשל כאן אינו עוצר העלאה חדשה.
async function expireStaleUploadSessions(env, uid, now = Date.now()) {
  try {
    const stale = await env.GALLERY_DB.prepare(
      "SELECT upload_id, object_key, status FROM upload_sessions WHERE owner_uid = ? AND updated_at < ? LIMIT 20"
    ).bind(uid, now - MULTIPART_SESSION_TTL_MS).all();
    for (const row of stale.results || []) {
      if (row.status !== "completed") {
        try {
          await env.GALLERY_BUCKET.resumeMultipartUpload(String(row.object_key), String(row.upload_id)).abort();
        } catch (error) {
          // כבר בוטלה או הושלמה ב-R2.
        }
      }
      await forgetUploadSession(env, String(row.upload_id));
    }
  } catch (error) {
    console.warn("Stale upload cleanup failed", error);
  }
}

function multipartSessionPayload(session, parts) {
  return {
    success: true,
    uploadId: String(session.upload_id),
    key: String(session.object_key),
    imageId: String(session.image_id),
    state: String(session.state),
    size: Number(session.total_size),
    partSize: Number(session.part_size),
    totalParts: Number(session.total_parts),
    status: String(session.status || "uploading"),
    parts: parts.map(part => ({ partNumber: part.partNumber, etag: part.etag }))
  };
}

async function createMultipartUpload(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  if (typeof env.GALLERY_BUCKET.createMultipartUpload !== "function") {
    throw apiError("העלאה בחלקים אינה זמינה בדלי הזה.", 501, "multipart_unavailable");
  }
  await consumeRateLimit(
    env,
    `upload:${user.uid}`,
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW_MS,
    "הועלו יותר מדי קבצים. המתן כמה דקות ונסה שוב.",
    "upload_rate_limit_exceeded"
  );
  const payload = await request.json().catch(() => ({}));
  const mimeType = String(payload.mimeType || "").toLowerCase();
  const isImage = ALLOWED_IMAGE_TYPES.has(mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(mimeType);
  const extension = ALLOWED_IMAGE_TYPES.get(mimeType) || ALLOWED_VIDEO_TYPES.get(mimeType);
  if (!extension) {
    throw apiError("סוג הקובץ אינו נתמך. אפשר להעלות JPG, PNG, WEBP, GIF, MP4, WEBM או MOV.", 415, "unsupported_file_type");
  }
  const size = Number(payload.size);
  const maximumBytes = isVideo ? MAX_RESUMABLE_VIDEO_BYTES : MAX_RESUMABLE_IMAGE_BYTES;
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytes) {
    throw apiError(isVideo ? "גודל הסרטון חייב להיות עד 1GB." : "גודל התמונה חייב להיות עד 50MB.", 413, "file_too_large");
  }
  const totalParts = Math.ceil(size / MULTIPART_PART_SIZE);
  if (totalParts > MULTIPART_MAX_PARTS) throw apiError("הקובץ גדול מדי.", 413, "file_too_large");

  const imageId = safeImageId(payload.imageId);
  const originalName = sanitizeUploadName(payload.fileName || payload.title);
  const title = String(payload.title || originalName).trim().slice(0, 120);
  const capturedAt = sanitizeCapturedAt(payload.capturedAt);
  const state = user.role === "viewer" ? "pending" : "approved";
  const key = `${state}/${user.uid}/${imageId}.${extension}`;
  const mediaType = isImage ? "image" : "video";

  await expireStaleUploadSessions(env, user.uid);
  const multipart = await env.GALLERY_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      ownerUid: user.uid,
      uploaderRole: user.role,
      imageId,
      title,
      originalName,
      mediaType,
      context: "gallery",
      conversationUid: "",
      state,
      uploadMode: "multipart",
      ...(capturedAt ? { capturedAt } : {}),
      uploadedAt: new Date().toISOString()
    }
  });
  const now = Date.now();
  await env.GALLERY_DB.prepare(
    `INSERT INTO upload_sessions (upload_id, object_key, owner_uid, image_id, state, mime_type, total_size, part_size,
       total_parts, title, original_name, status, result_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', '', ?, ?)`
  ).bind(multipart.uploadId, key, user.uid, imageId, state, mimeType, size, MULTIPART_PART_SIZE, totalParts, title, originalName, now, now).run();
  const session = await readOwnedUploadSession(env, multipart.uploadId, user);
  return json(request, multipartSessionPayload(session, []), 201);
}

async function uploadMultipartPart(request, env, url) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  await consumeRateLimit(
    env,
    `upload-part:${user.uid}`,
    UPLOAD_PART_RATE_LIMIT,
    UPLOAD_PART_RATE_WINDOW_MS,
    "נשלחו יותר מדי חלקי קבצים. המתן כמה דקות ונסה שוב.",
    "upload_rate_limit_exceeded"
  );
  const uploadId = uploadIdFrom(url.searchParams.get("uploadId"));
  const session = await readOwnedUploadSession(env, uploadId, user);
  if (session.status === "completed") throw apiError("ההעלאה כבר הושלמה.", 409, "upload_already_completed");
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > Number(session.total_parts)) {
    throw apiError("מספר החלק אינו תקין.", 400, "invalid_part_number");
  }
  const expectedLength = multipartPartLength(session, partNumber);
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > expectedLength) {
    throw apiError("גודל החלק אינו תואם להעלאה.", 400, "part_size_mismatch");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength !== expectedLength) {
    throw apiError("גודל החלק אינו תואם להעלאה.", 400, "part_size_mismatch");
  }
  const multipart = env.GALLERY_BUCKET.resumeMultipartUpload(String(session.object_key), uploadId);
  const uploaded = await multipart.uploadPart(partNumber, body);
  const now = Date.now();
  await env.GALLERY_DB.prepare(
    `INSERT INTO upload_session_parts (upload_id, part_number, etag, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(upload_id, part_number) DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes, created_at = excluded.created_at`
  ).bind(uploadId, partNumber, String(uploaded.etag), body.byteLength, now).run();
  await env.GALLERY_DB.prepare("UPDATE upload_sessions SET updated_at = ? WHERE upload_id = ?").bind(now, uploadId).run();
  return json(request, { success: true, uploadId, partNumber, etag: String(uploaded.etag) });
}

async function multipartUploadStatus(request, env, url) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  const uploadId = uploadIdFrom(url.searchParams.get("uploadId"));
  const session = await readOwnedUploadSession(env, uploadId, user);
  return json(request, multipartSessionPayload(session, await readUploadedParts(env, uploadId)));
}

async function completeMultipartUpload(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  const form = await request.formData();
  const uploadId = uploadIdFrom(form.get("uploadId"));
  const session = await readOwnedUploadSession(env, uploadId, user);
  // השלמה חוזרת (התשובה הקודמת אבדה ברשת) מקבלת את אותה תשובה.
  if (session.status === "completed" && session.result_json) {
    try {
      return json(request, JSON.parse(String(session.result_json)), 200);
    } catch (error) {
      // תשובה שמורה פגומה: אין מה להחזיר מעבר למה שכבר הושלם.
      throw apiError("ההעלאה כבר הושלמה.", 409, "upload_already_completed");
    }
  }
  const parts = await readUploadedParts(env, uploadId);
  const totalParts = Number(session.total_parts);
  const received = new Set(parts.map(part => part.partNumber));
  const missing = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (!received.has(partNumber)) missing.push(partNumber);
  }
  if (missing.length) {
    throw apiError(`חלק מהקובץ עדיין לא התקבל (חלקים חסרים: ${missing.slice(0, 10).join(", ")}).`, 409, "upload_incomplete");
  }
  // התצוגות נבדקות לפני ההשלמה, כדי שבקשה פסולה לא תשאיר קובץ בלי תשובה.
  const variantParts = readVariantParts(form);
  const placeholder = normalizeMediaPlaceholder(form.get("placeholder"));
  const key = String(session.object_key);
  const imageId = String(session.image_id);
  const state = String(session.state);
  const multipart = env.GALLERY_BUCKET.resumeMultipartUpload(key, uploadId);
  await multipart.complete(parts.map(part => ({ partNumber: part.partNumber, etag: part.etag })));
  await bumpDataVersion(env, state === "pending" ? "pendingImages" : "images");

  let variants = null;
  if (variantParts.length) {
    variants = await storeMediaVariants(request, env, imageId, variantParts, { ownerUid: user.uid, state });
    await attachVariantsToRecords(env, imageId, variants, { placeholder });
  }
  await recordUsage(env, { uploads: 1, uploadsPending: state === "pending" ? 1 : 0 });
  const mimeType = String(session.mime_type);
  const mediaType = ALLOWED_VIDEO_TYPES.has(mimeType) ? "video" : "image";
  const stream = mediaType === "video" && state === "approved"
    ? await sendVideoToStream(request, env, { imageId, key, title: String(session.title || "") })
    : null;
  const result = {
    success: true,
    key,
    state,
    mediaType,
    mimeType,
    fileName: String(session.original_name || ""),
    size: Number(session.total_size),
    url: mediaUrl(request, key, env),
    uploadMode: "multipart",
    ...(variants ? { variants, variantsVersion: MEDIA_VARIANTS_VERSION } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(stream ? { stream } : {})
  };
  // החלקים כבר אינם נחוצים; השורה נשארת "הושלמה" עד שתתיישן, לטובת השלמה חוזרת.
  await env.GALLERY_DB.prepare("DELETE FROM upload_session_parts WHERE upload_id = ?").bind(uploadId).run();
  await env.GALLERY_DB.prepare(
    "UPDATE upload_sessions SET status = 'completed', result_json = ?, updated_at = ? WHERE upload_id = ?"
  ).bind(JSON.stringify(result), Date.now(), uploadId).run();
  return json(request, result, 201);
}

async function abortMultipartUpload(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  const payload = await request.json().catch(() => ({}));
  const uploadId = uploadIdFrom(payload.uploadId);
  let session;
  try {
    session = await readOwnedUploadSession(env, uploadId, user);
  } catch (error) {
    // ביטול של העלאה שכבר אינה קיימת הוא הצלחה: אין מה לבטל.
    if (error?.code === "upload_session_not_found") return json(request, { success: true, uploadId, aborted: false });
    throw error;
  }
  if (session.status === "completed") {
    throw apiError("ההעלאה כבר הושלמה ואי אפשר לבטל אותה.", 409, "upload_already_completed");
  }
  try {
    await env.GALLERY_BUCKET.resumeMultipartUpload(String(session.object_key), uploadId).abort();
  } catch (error) {
    console.warn("Multipart abort failed", error);
  }
  await forgetUploadSession(env, uploadId);
  return json(request, { success: true, uploadId, aborted: true });
}

// --- Cloudflare Stream (רשות) ---
// כשב-Worker מוגדרים הסודות STREAM_ACCOUNT_ID ו-STREAM_API_TOKEN, כל סרטון
// מאושר נשלח בנוסף ל-Stream ("העתקה מכתובת": Stream מושך את הקובץ מכתובת
// המדיה הציבורית שלו ב-R2) ומנוגן בתצוגה המלאה ב-HLS — איכות שמתאימה לרשת.
// סרטון ממתין נשלח רק כשהוא מאושר, כדי שעותק שלו לא יהיה ציבורי לפני כן.
// בלי הסודות אין שום קריאה ל-Stream, והכול פועל בדיוק כמו קודם. כשל מול
// Stream לעולם אינו מכשיל העלאה או אישור: המקור ב-R2 ממשיך לשמש לניגון.

function streamConfig(env) {
  const accountId = String(env?.STREAM_ACCOUNT_ID || "").trim();
  const token = String(env?.STREAM_API_TOKEN || "").trim();
  if (!accountId || !token || !/^[a-zA-Z0-9]{1,64}$/.test(accountId)) return null;
  return { accountId, token };
}

function safeStreamUid(value) {
  const uid = String(value || "").trim();
  return /^[a-zA-Z0-9]{1,64}$/.test(uid) ? uid : "";
}

// כתובות הניגון: מה ש-Stream החזיר, או הכתובות הכלליות של videodelivery.net.
function streamPlayback(uid, playback = {}) {
  const hls = /^https:\/\/[^\s"'<>]+\.m3u8$/i.test(String(playback?.hls || ""))
    ? String(playback.hls)
    : `https://videodelivery.net/${uid}/manifest/video.m3u8`;
  const iframe = hls.endsWith(`/${uid}/manifest/video.m3u8`)
    ? hls.replace(/\/manifest\/video\.m3u8$/, "/iframe")
    : `https://iframe.videodelivery.net/${uid}`;
  return { uid, hls, iframe };
}

async function streamFetch(config, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${STREAM_API_BASE}/${config.accountId}/stream${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...(init.headers || {}) },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sendVideoToStream(request, env, { imageId, key, title }) {
  const config = streamConfig(env);
  if (!config) return null;
  try {
    const response = await streamFetch(config, "/copy", {
      method: "POST",
      body: JSON.stringify({
        url: mediaUrl(request, key, env),
        meta: { name: String(title || imageId).slice(0, 120), imageId }
      })
    });
    const payload = await response.json().catch(() => null);
    const uid = safeStreamUid(payload?.result?.uid);
    if (!response.ok || !payload?.success || !uid) {
      console.warn("Stream copy failed", response.status, JSON.stringify(payload?.errors || []));
      return null;
    }
    const stream = streamPlayback(uid, payload.result.playback);
    await ensureDatabaseSchema(env);
    await env.GALLERY_DB.prepare(
      `INSERT INTO stream_videos (image_id, stream_uid, object_key, hls_url, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(image_id) DO UPDATE SET stream_uid = excluded.stream_uid, object_key = excluded.object_key,
         hls_url = excluded.hls_url, created_at = excluded.created_at`
    ).bind(imageId, uid, key, stream.hls, Date.now()).run();
    return stream;
  } catch (error) {
    console.warn("Stream copy failed", error);
    return null;
  }
}

// מחיקת הסרטון מהגלריה מוחקת גם את העותק שלו ב-Stream. בלי הסודות — רק השורה.
async function deleteStreamVideoForDeletedMedia(env, key) {
  const imageId = faceImageIdFromObjectKey(key);
  if (!imageId) return;
  try {
    if (key.startsWith("pending/") && await hasActiveImageDocument(env, imageId)) return;
    const row = await env.GALLERY_DB.prepare("SELECT stream_uid FROM stream_videos WHERE image_id = ?").bind(imageId).first();
    if (!row) return;
    const config = streamConfig(env);
    const uid = safeStreamUid(row.stream_uid);
    if (config && uid) {
      const response = await streamFetch(config, `/${uid}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        console.warn("Stream delete failed", response.status);
        return;
      }
    }
    await env.GALLERY_DB.prepare("DELETE FROM stream_videos WHERE image_id = ?").bind(imageId).run();
  } catch (error) {
    console.warn("Stream delete failed", error);
  }
}

async function serveImage(request, env, pathname) {
  assertPublicMediaPath(pathname);
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

  // תצוגה מקדימה: ציבורית כשהפריט מאושר. תצוגה של פריט ממתין — לבעלים
  // ולמנהלים בלבד, אלא אם הפריט כבר אושר בינתיים והמטא-דאטה שלה לא עודכן.
  const isVariant = key.startsWith("variants/");
  let variantPublic = false;
  if (isVariant) {
    variantPublic = metadata.state === "approved" || await hasActiveImageDocument(env, key.split("/")[1] || "");
    if (!variantPublic) {
      const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
      if (user.uid !== (metadata.ownerUid || metadata.owneruid) && !["admin", "super_admin"].includes(user.role)) {
        throw apiError("אין הרשאה לצפות בתצוגה של פריט ממתין.", 403, "permission_denied");
      }
    }
  }

  const headers = new Headers(corsHeaders(request));
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", "bytes");
  if ((metadata.mediaType || metadata.mediatype) === "file") {
    const downloadName = String(metadata.originalName || metadata.originalname || metadata.title || "file")
      .replace(/[\r\n"\\/]+/g, "-")
      .slice(0, 180);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  }
  if (requestedRange) {
    headers.set("Content-Range", `bytes ${requestedRange.offset}-${requestedRange.offset + requestedRange.length - 1}/${requestedRange.total}`);
    headers.set("Content-Length", String(requestedRange.length));
  }
  // המפתח של תצוגה מקדימה אינו משתנה והתוכן שלה נכתב פעם אחת, ולכן היא
  // נשמרת במטמון לשנה; המקור נשאר עם המטמון הקצר שלו.
  headers.set(
    "Cache-Control",
    variantPublic
      ? "public, max-age=31536000, immutable"
      : (key.startsWith("approved/") && !isChatAttachment
        ? "public, max-age=3600, s-maxage=86400"
        : "private, no-store")
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
  await markMediaVariantsApproved(env, faceImageIdFromObjectKey(approvedKey));
  await ensureDatabaseSchema(env);
  await bumpDataVersions(env, ["images", "pendingImages"]);
  await recordUsage(env, { approvals: 1 });
  // סרטון שאושר נשלח עכשיו ל-Stream (כשהוא מוגדר) — לא לפני כן, כשהיה פרטי.
  const stream = (source.customMetadata?.mediaType || source.customMetadata?.mediatype) === "video"
    ? await sendVideoToStream(request, env, {
      imageId: faceImageIdFromObjectKey(approvedKey),
      key: approvedKey,
      title: String(source.customMetadata?.title || "")
    })
    : null;

  return json(request, {
    success: true,
    key: approvedKey,
    state: "approved",
    url: mediaUrl(request, approvedKey, env),
    ...(stream ? { stream } : {})
  });
}

async function deleteImage(request, env, pathname) {
  assertPublicMediaPath(pathname);
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
  // מחיקת קובץ מקור גוררת גם את טביעות הפנים ואת התצוגות המקדימות שלו.
  // מחיקת תצוגה בודדת אינה נוגעת בדבר מלבדה.
  if (!key.startsWith("chat/") && !key.startsWith("variants/")) {
    await deleteFaceIndexForDeletedMedia(env, key);
    await deleteMediaVariantsForDeletedMedia(env, key);
    await deleteStreamVideoForDeletedMedia(env, key);
    await bumpDataVersions(env, ["images", "pendingImages"]);
  }
  if (key.startsWith("variants/")) await forgetVariantFiles(env, [key]);
  return json(request, { success: true, key });
}

// --- תצוגות מקדימות (variants) ---
// לכל פריט מדיה נשמרות גרסאות מוקטנות לצד המקור, במפתחות
// variants/<imageId>/<thumb|medium|poster>.<webp|jpg>. הן נוצרות בדפדפן —
// בהעלאה (חלקי variant_* בטופס) או בריצת ההשלמה מלוח הניהול
// (POST /media/variants) — וה-Worker בודק, שומר ורושם אותן ברשומה.
// המקור לעולם אינו נמחק או מוחלף בגללן, ואינדוקס הפנים ממשיך לעבוד מולו.

function variantObjectKey(imageId, name, extension) {
  return `variants/${imageId}/${name}.${extension}`;
}

function variantDimension(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 && number <= MEDIA_VARIANT_MAX_DIMENSION ? number : 0;
}

// קורא ובודק את חלקי התצוגות שבטופס. חלק פסול מכשיל את כל הבקשה — לפני שנשמר דבר.
function readVariantParts(form) {
  let meta = {};
  try {
    meta = JSON.parse(String(form.get("variantsMeta") || "{}"));
  } catch {
    meta = {};
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};

  const parts = [];
  for (const name of MEDIA_VARIANT_NAMES) {
    const part = form.get(`variant_${name}`);
    if (part === null || part === undefined || part === "") continue;
    if (typeof part.arrayBuffer !== "function") {
      throw apiError(`התצוגה ${name} אינה קובץ.`, 400, "invalid_variant");
    }
    const type = String(part.type || "").toLowerCase();
    const extension = ALLOWED_VARIANT_TYPES.get(type);
    if (!extension) {
      throw apiError("תצוגה מקדימה חייבת להיות WebP או JPEG.", 415, "unsupported_variant_type");
    }
    if (!Number.isFinite(part.size) || part.size <= 0 || part.size > MAX_VARIANT_BYTES) {
      throw apiError("גודל תצוגה מקדימה חייב להיות עד 2MB.", 413, "variant_too_large");
    }
    const width = variantDimension(meta[name]?.width);
    const height = variantDimension(meta[name]?.height);
    parts.push({ name, part, type, extension, width, height, avif: readAvifVariantPart(form, name) });
  }
  // עותק AVIF בלי תצוגה רגילה באותה בקשה נדחה: לא היה לו גיבוי לדפדפן שאינו מפענח AVIF.
  for (const name of MEDIA_VARIANT_NAMES) {
    const orphan = form.get(`variant_${name}_avif`);
    if (orphan !== null && orphan !== undefined && orphan !== "" && !parts.some(entry => entry.name === name)) {
      throw apiError(`עותק ה-AVIF של ${name} נשלח בלי התצוגה הרגילה.`, 400, "avif_without_variant");
    }
  }
  return parts;
}

function readAvifVariantPart(form, name) {
  const part = form.get(`variant_${name}_avif`);
  if (part === null || part === undefined || part === "") return null;
  if (typeof part.arrayBuffer !== "function") {
    throw apiError(`עותק ה-AVIF של ${name} אינו קובץ.`, 400, "invalid_variant");
  }
  if (String(part.type || "").toLowerCase() !== VARIANT_AVIF_TYPE) {
    throw apiError("עותק AVIF של תצוגה חייב להיות image/avif.", 415, "unsupported_variant_type");
  }
  if (!Number.isFinite(part.size) || part.size <= 0 || part.size > MAX_VARIANT_BYTES) {
    throw apiError("גודל תצוגה מקדימה חייב להיות עד 2MB.", 413, "variant_too_large");
  }
  return part;
}

// רישום הקובץ בטבלת התצוגות. כשל כאן אינו מכשיל את השמירה: הקובץ כבר ב-R2
// והרשומה מצביעה עליו, והרישום משמש רק לסטטיסטיקה במסך הניהול.
async function recordVariantFile(env, row) {
  try {
    await env.GALLERY_DB.prepare(
      `INSERT OR REPLACE INTO media_variant_files
        (object_key, image_id, variant_name, format, content_type, width, height, size_bytes, variants_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(row.key, row.imageId, row.name, row.format, row.type, row.width, row.height, row.size, MEDIA_VARIANTS_VERSION, Date.now()).run();
  } catch (error) {
    console.warn("Variant ledger write failed", error);
  }
}

async function forgetVariantFiles(env, keys) {
  if (!keys.length) return;
  try {
    for (const key of keys) {
      await env.GALLERY_DB.prepare("DELETE FROM media_variant_files WHERE object_key = ?").bind(key).run();
    }
  } catch (error) {
    console.warn("Variant ledger delete failed", error);
  }
}

async function storeMediaVariants(request, env, imageId, parts, { ownerUid, state, editRevision = "" }) {
  const variants = {};
  // תצוגה שנוצרה מחדש אחרי סיבוב/חיתוך נכתבת לאותו מפתח ב-R2, אבל הכתובת
  // שלה נושאת את מזהה העריכה (?v=): התצוגות נשמרות במטמון לשנה (immutable),
  // וכתובת חדשה היא הדרך היחידה שהדפדפן יבקש את התוכן החדש.
  const versioned = url => (editRevision ? `${url}?v=${editRevision}` : url);
  const createdAt = new Date().toISOString();
  const putVariant = async (key, part, type, entry) => {
    const bytes = await part.arrayBuffer();
    await env.GALLERY_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: type },
      customMetadata: {
        imageId,
        variant: entry.name,
        ownerUid: String(ownerUid || ""),
        state,
        width: String(entry.width),
        height: String(entry.height),
        variantsVersion: String(MEDIA_VARIANTS_VERSION),
        createdAt
      }
    });
    await recordVariantFile(env, {
      key,
      imageId,
      name: entry.name,
      format: key.slice(key.lastIndexOf(".") + 1),
      type,
      width: entry.width,
      height: entry.height,
      size: bytes.byteLength
    });
  };
  for (const entry of parts) {
    const key = variantObjectKey(imageId, entry.name, entry.extension);
    await putVariant(key, entry.part, entry.type, entry);
    const variant = {
      key,
      url: versioned(mediaUrl(request, key, env)),
      width: entry.width,
      height: entry.height,
      type: entry.type
    };
    if (editRevision) variant.editRev = editRevision;
    // אותה תצוגה בסיומת האחרת (JPEG מול WebP) אינה נשארת כקובץ יתום, וגם לא
    // עותק AVIF ישן כשהתצוגה החדשה נשלחה בלעדיו: הוא כבר אינו תואם לה.
    const staleKeys = [...ALLOWED_VARIANT_TYPES.values()]
      .filter(otherExtension => otherExtension !== entry.extension)
      .map(otherExtension => variantObjectKey(imageId, entry.name, otherExtension));
    if (entry.avif) {
      const avifKey = variantObjectKey(imageId, entry.name, VARIANT_AVIF_EXTENSION);
      await putVariant(avifKey, entry.avif, VARIANT_AVIF_TYPE, entry);
      variant.avif = { key: avifKey, url: versioned(mediaUrl(request, avifKey, env)), type: VARIANT_AVIF_TYPE };
    } else {
      staleKeys.push(variantObjectKey(imageId, entry.name, VARIANT_AVIF_EXTENSION));
    }
    for (const staleKey of staleKeys) await env.GALLERY_BUCKET.delete(staleKey);
    await forgetVariantFiles(env, staleKeys);
    variants[entry.name] = variant;
  }
  return variants;
}

async function readGalleryDocumentRow(env, collectionName, documentId) {
  return env.GALLERY_DB.prepare(
    "SELECT data_json, owner_uid, updated_at FROM gallery_documents WHERE collection_name = ? AND document_id = ?"
  ).bind(collectionName, documentId).first();
}

// רושם את התצוגות ברשומות הקיימות של הפריט — images וגם pendingImages, שכן
// רשומה ממתינה נשמרת כתיעוד גם אחרי האישור. תצוגות קודמות שלא נשלחו שוב נשמרות.
// placeholder (רשות) הוא הרקע המטושטש שנוצר יחד עם התצוגות; בקשה שיש בה רק
// אותו (השלמה לפריט שכבר יש לו תצוגות) אינה נוגעת ב-variants.
async function attachVariantsToRecords(env, imageId, variants, { placeholder = "", editRevision = "" } = {}) {
  const updated = [];
  let merged = variants;
  const hasVariants = Object.keys(variants || {}).length > 0;
  for (const collectionName of ["images", "pendingImages"]) {
    const row = await readGalleryDocumentRow(env, collectionName, imageId);
    if (!row) continue;
    const data = parseDocumentData(row);
    const existing = data.variants && typeof data.variants === "object" ? data.variants : {};
    merged = { ...existing, ...variants };
    const next = hasVariants ? { ...data, variants: merged, variantsVersion: MEDIA_VARIANTS_VERSION } : { ...data };
    // תצוגות של סיבוב/חיתוך (או של ביטול עריכה) משנות את התמונה המוצגת: ממלא
    // המקום המטושטש הקודם תיאר את התמונה הקודמת ונמחק. רקע מטושטש שנשלח באותה
    // בקשה נוצר מהתצוגות הערוכות, ולכן הוא נשמר במקומו.
    if (editRevision) delete next.placeholder;
    if (placeholder) next.placeholder = placeholder;
    if (!hasVariants && !placeholder) continue;
    const updatedAt = Math.max(Date.now(), (Number(row.updated_at) || 0) + 1);
    await env.GALLERY_DB.prepare(
      "UPDATE gallery_documents SET data_json = ?, updated_at = ? WHERE collection_name = ? AND document_id = ?"
    ).bind(JSON.stringify(next), updatedAt, collectionName, imageId).run();
    updated.push(collectionName);
  }
  // הרשומה השתנתה: רשימות שבמטמון הקצה וב-ETag חייבות להתיישן מיד.
  await bumpDataVersions(env, updated);
  return { variants: merged, updated };
}

async function listMediaVariantObjects(env, imageId) {
  const safeId = String(imageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!safeId) return [];
  const listed = await env.GALLERY_BUCKET.list({ prefix: `variants/${safeId}/` });
  return listed?.objects || [];
}

async function deleteMediaVariantsForImage(env, imageId) {
  const keys = [];
  for (const object of await listMediaVariantObjects(env, imageId)) {
    await env.GALLERY_BUCKET.delete(object.key);
    keys.push(object.key);
  }
  await forgetVariantFiles(env, keys);
}

async function deleteMediaVariantsForDeletedMedia(env, key) {
  const imageId = faceImageIdFromObjectKey(key);
  if (!imageId) return;
  // קובץ ממתין של תמונה שכבר אושרה אינו מוחק את התצוגות של התמונה הפעילה.
  if (key.startsWith("pending/") && await hasActiveImageDocument(env, imageId)) return;
  await deleteMediaVariantsForImage(env, imageId);
}

// אחרי אישור המקור גם התצוגות מסומנות כמאושרות, כדי שיוגשו לכולם — ובמטמון
// ארוך — בלי בדיקה במסד בכל בקשה. כשל כאן אינו מכשיל את האישור: עד לתיקון
// התצוגות מוגשות לפי רשומת images.
async function markMediaVariantsApproved(env, imageId) {
  if (!imageId) return;
  try {
    for (const summary of await listMediaVariantObjects(env, imageId)) {
      const object = await env.GALLERY_BUCKET.get(summary.key);
      if (!object || object.customMetadata?.state === "approved") continue;
      await env.GALLERY_BUCKET.put(summary.key, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: { ...(object.customMetadata || {}), state: "approved" }
      });
    }
  } catch (error) {
    console.warn("Variant approval failed", error);
  }
}

// POST /media/variants — צירוף תצוגות לפריט קיים (ריצת ההשלמה, או השלמה
// להעלאה שהתצוגות שלה נכשלו). מנהל רשאי לכל פריט; המעלה רשאי לפריט שלו כל
// עוד הרשומה הממתינה שלו עדיין פתוחה.
async function attachMediaVariants(request, env) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  await consumeRateLimit(
    env,
    `variants:${user.uid}`,
    MEDIA_VARIANTS_RATE_LIMIT,
    MEDIA_VARIANTS_RATE_WINDOW_MS,
    "נשלחו יותר מדי תצוגות מקדימות. המתן כמה דקות ונסה שוב.",
    "variants_rate_limit_exceeded"
  );
  const form = await request.formData();
  const imageId = safeImageId(form.get("imageId"));

  const activeRow = await readGalleryDocumentRow(env, "images", imageId);
  const pendingRow = activeRow ? null : await readGalleryDocumentRow(env, "pendingImages", imageId);
  const row = activeRow || pendingRow;
  if (!row) throw apiError("רשומת המדיה לא נמצאה.", 404, "not_found");
  const record = parseDocumentData(row);
  const ownerUid = String(record.uploadedBy || record.r2OwnerUid || row.owner_uid || "");

  if (!["admin", "super_admin"].includes(user.role)) {
    if (!ownerUid || ownerUid !== user.uid) {
      throw apiError("רק מי שהעלה את הפריט, או מנהל, רשאי לצרף לו תצוגות.", 403, "permission_denied");
    }
    if (pendingRow && String(record.status || "pending") !== "pending") {
      throw apiError("הפריט כבר טופל ואינו פתוח לשינוי.", 403, "permission_denied");
    }
  }

  // מזהה עריכה: התצוגות נוצרו מהתמונה אחרי סיבוב/חיתוך (או מחדש מהמקור,
  // בביטול עריכה). רק מנהל עורך תמונות, ולכן רק הוא שולח אותו.
  const rawEditRevision = form.get("editRevision");
  let editRevision = "";
  if (rawEditRevision !== null && rawEditRevision !== undefined && rawEditRevision !== "") {
    if (!["admin", "super_admin"].includes(user.role)) {
      throw apiError("רק מנהל רשאי לצרף תצוגות של תמונה ערוכה.", 403, "permission_denied");
    }
    editRevision = String(rawEditRevision);
    if (!MEDIA_EDIT_REVISION_PATTERN.test(editRevision)) {
      throw apiError("מזהה העריכה אינו תקין.", 400, "invalid_edit_revision");
    }
    if (isVideoLikeData(record)) {
      throw apiError("עריכת סיבוב וחיתוך זמינה לתמונות בלבד.", 400, "media_edit_unsupported");
    }
  }

  const parts = readVariantParts(form);
  // הרקע המטושטש: כאן — בניגוד להעלאה — ערך פסול מכשיל את הבקשה, כמו תצוגה פסולה.
  const rawPlaceholder = form.get("placeholder");
  const placeholder = normalizeMediaPlaceholder(rawPlaceholder);
  if (rawPlaceholder !== null && rawPlaceholder !== undefined && rawPlaceholder !== "" && !placeholder) {
    throw apiError("הרקע המטושטש אינו תקין.", 400, "invalid_placeholder");
  }
  if (!parts.length && !placeholder) throw apiError("לא צורפה אף תצוגה מקדימה.", 400, "variant_missing");

  const variants = parts.length ? await storeMediaVariants(request, env, imageId, parts, {
    ownerUid: ownerUid || user.uid,
    state: activeRow ? "approved" : "pending",
    editRevision
  }) : {};
  const attached = await attachVariantsToRecords(env, imageId, variants, { placeholder, editRevision });
  return json(request, {
    success: true,
    imageId,
    variants: attached.variants,
    variantsVersion: MEDIA_VARIANTS_VERSION,
    ...(placeholder ? { placeholder } : {}),
    updated: attached.updated
  });
}

// GET /media/variants/stats — כמה קובצי תצוגות נשמרו ומה הנפח שלהם, לפי
// פורמט. מנהלים בלבד; הנתונים מטבלת media_variant_files ולא מסריקת R2.
async function mediaVariantsStats(request, env) {
  await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const totals = await env.GALLERY_DB.prepare(
    "SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(DISTINCT image_id) AS images FROM media_variant_files"
  ).first();
  const formats = await env.GALLERY_DB.prepare(
    "SELECT format, COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM media_variant_files GROUP BY format ORDER BY format"
  ).all();
  const byFormat = {};
  for (const row of formats.results || []) {
    byFormat[String(row.format)] = { files: Number(row.files) || 0, bytes: Number(row.bytes) || 0 };
  }
  return json(request, {
    success: true,
    files: Number(totals?.files) || 0,
    bytes: Number(totals?.bytes) || 0,
    images: Number(totals?.images) || 0,
    byFormat,
    variantsVersion: MEDIA_VARIANTS_VERSION
  });
}

// --- תאריך הצילום: ריצת ההשלמה למדיה הקיימת ---

// הרשומה של פריט — הפעילה, ואם אין כזו הממתינה — ומפתח הקובץ שלה ב-R2.
async function readMediaRecordForProbe(env, imageId) {
  for (const collectionName of ["images", "pendingImages"]) {
    const row = await readGalleryDocumentRow(env, collectionName, imageId);
    if (row) return parseDocumentData(row);
  }
  return null;
}

// GET /media/probe/<imageId>?offset=&length= — טווח בתים מקובץ המקור, כדי
// שהדפדפן של המנהל יקרא את ה-EXIF או את mvhd בלי להוריד את הקובץ כולו.
// מנהלים בלבד; עד 256KB בבקשה; X-Media-Size מחזירה את גודל הקובץ המלא.
async function probeMediaBytes(request, env, url) {
  await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const imageId = safeImageId(decodeURIComponent(url.pathname.slice("/media/probe/".length)));
  const record = await readMediaRecordForProbe(env, imageId);
  if (!record) throw apiError("רשומת המדיה לא נמצאה.", 404, "not_found");
  const key = String(record.r2Key || "");
  if (!/^(approved|pending)\//.test(key)) throw apiError("הפריט אינו מאוחסן ב-R2 של הגלריה.", 404, "not_stored");
  validateObjectKey(key);
  const offset = Math.max(0, Math.trunc(Number(url.searchParams.get("offset")) || 0));
  const length = Math.max(1, Math.min(MEDIA_PROBE_MAX_BYTES, Math.trunc(Number(url.searchParams.get("length")) || MEDIA_PROBE_MAX_BYTES)));
  const head = await env.GALLERY_BUCKET.head(key);
  if (!head) throw apiError("קובץ המדיה לא נמצא.", 404, "not_found");
  const size = Number(head.size) || 0;
  let bytes = new Uint8Array(0);
  if (offset < size) {
    const object = await env.GALLERY_BUCKET.get(key, { range: { offset, length: Math.min(length, size - offset) } });
    if (!object) throw apiError("קובץ המדיה לא נמצא.", 404, "not_found");
    const all = new Uint8Array(await new Response(object.body).arrayBuffer());
    // R2 מחזיר בדיוק את הטווח; מאגר שמתעלם מהטווח מחזיר את הכול, ואז חותכים.
    bytes = all.length > length ? all.subarray(offset, offset + length) : all;
  }
  const headers = new Headers(corsHeaders(request));
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Media-Size", String(size));
  headers.set("Access-Control-Expose-Headers", "ETag, X-Media-Size");
  return new Response(bytes, { status: 200, headers });
}

// POST /media/taken-at — { updates: [{ imageId, takenAt, takenDate, takenAtOffset,
// takenAtSource }] } עד 50 בבקשה. כל עדכון נבדק כמו בכתיבה רגילה, נרשם ב-images
// וגם ב-pendingImages, וגרסאות הנתונים מתקדמות כדי שה-ETag ומטמון הקצה יתיישנו.
// "none" (נבדק ולא נמצא) אינו מוחק תאריך שכבר נשמר.
async function updateMediaTakenAt(request, env) {
  await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  if (!updates.length) throw apiError("לא נשלחו עדכונים.", 400, "no_updates");
  if (updates.length > TAKEN_AT_BATCH_MAX) {
    throw apiError(`אפשר לעדכן עד ${TAKEN_AT_BATCH_MAX} פריטים בבקשה אחת.`, 400, "too_many_updates");
  }
  const touched = new Set();
  const results = [];
  for (const update of updates) {
    const imageId = safeImageId(update?.imageId);
    const fields = {};
    for (const field of CAPTURE_FIELDS) if (update?.[field] !== undefined) fields[field] = update[field];
    const normalized = normalizeCaptureFields(fields, {});
    if (normalized.takenAt === undefined && normalized.takenAtSource !== "none") {
      results.push({ imageId, status: "invalid" });
      continue;
    }
    let found = false;
    for (const collectionName of ["images", "pendingImages"]) {
      const row = await readGalleryDocumentRow(env, collectionName, imageId);
      if (!row) continue;
      found = true;
      const data = parseDocumentData(row);
      if (normalized.takenAt === undefined && Number.isFinite(Number(data.takenAt)) && data.takenAtSource !== "none") continue;
      const next = { ...data };
      for (const field of CAPTURE_FIELDS) delete next[field];
      Object.assign(next, normalized);
      const updatedAt = Math.max(Date.now(), (Number(row.updated_at) || 0) + 1);
      await env.GALLERY_DB.prepare(
        "UPDATE gallery_documents SET data_json = ?, updated_at = ? WHERE collection_name = ? AND document_id = ?"
      ).bind(JSON.stringify(next), updatedAt, collectionName, imageId).run();
      touched.add(collectionName);
    }
    results.push({ imageId, status: found ? "updated" : "not_found", ...normalized });
  }
  await bumpDataVersions(env, [...touched]);
  return json(request, { success: true, updated: results.filter(result => result.status === "updated").length, results });
}

export {
  safeImageId,
  validateObjectKey,
  decodeObjectKey,
  publicApiOrigin,
  mediaUrl,
  uploadImage,
  sanitizeUploadName,
  sanitizeCapturedAt,
  multipartPartLength,
  uploadIdFrom,
  readOwnedUploadSession,
  readUploadedParts,
  forgetUploadSession,
  expireStaleUploadSessions,
  multipartSessionPayload,
  createMultipartUpload,
  uploadMultipartPart,
  multipartUploadStatus,
  completeMultipartUpload,
  abortMultipartUpload,
  streamConfig,
  safeStreamUid,
  streamPlayback,
  streamFetch,
  sendVideoToStream,
  deleteStreamVideoForDeletedMedia,
  serveImage,
  approveImage,
  deleteImage,
  variantObjectKey,
  variantDimension,
  readVariantParts,
  readAvifVariantPart,
  recordVariantFile,
  forgetVariantFiles,
  storeMediaVariants,
  readGalleryDocumentRow,
  attachVariantsToRecords,
  listMediaVariantObjects,
  deleteMediaVariantsForImage,
  deleteMediaVariantsForDeletedMedia,
  markMediaVariantsApproved,
  attachMediaVariants,
  mediaVariantsStats,
  readMediaRecordForProbe,
  probeMediaBytes,
  updateMediaTakenAt
};
