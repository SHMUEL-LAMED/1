// זיהוי פנים: אינדקס, חיפוש, אשכולות וקבוצות.
import {
  AI_SEARCH_INDEX_COLLECTION
} from "./ai.js";
import {
  requireUser
} from "./auth.js";
import {
  FACE_BOXES_MAX_PER_REQUEST,
  FACE_CLUSTER_BATCH,
  FACE_CLUSTER_BATCH_MAX,
  FACE_CLUSTER_JOIN_DISTANCE,
  FACE_CLUSTER_LOCK_MS,
  FACE_CLUSTER_MARGIN,
  FACE_CLUSTER_MIN_SUGGESTED,
  FACE_CLUSTER_RATE_LIMIT,
  FACE_CLUSTER_RATE_WINDOW_MS,
  FACE_CLUSTER_REVIEW_DISTANCE,
  FACE_CLUSTER_SEED_PAGE_SIZE,
  FACE_CLUSTER_SEED_SCAN_LIMIT,
  FACE_DESCRIPTOR_LENGTH,
  FACE_DESCRIPTOR_MAX_COMPONENT,
  FACE_DESCRIPTOR_MAX_NORM,
  FACE_DESCRIPTOR_MIN_NORM,
  FACE_DESCRIPTOR_PAGE_SIZE,
  FACE_DESCRIPTOR_SCAN_LIMIT,
  FACE_GROUPS_PAGE_SIZE,
  FACE_GROUPS_RATE_LIMIT,
  FACE_GROUPS_RATE_WINDOW_MS,
  FACE_GROUP_SAMPLE_FACES,
  FACE_ID_QUERY_CHUNK,
  FACE_INDEX_MAX_ATTEMPTS,
  FACE_INDEX_MAX_FACES_PER_IMAGE,
  FACE_INDEX_MAX_IMAGES_PER_REQUEST,
  FACE_INDEX_PENDING_MAX_IDS,
  FACE_INDEX_RATE_LIMIT,
  FACE_INDEX_RATE_WINDOW_MS,
  FACE_MATCH_THRESHOLD,
  FACE_MODEL_VERSION,
  FACE_PEOPLE_DATA_VERSION,
  FACE_PERSON_ID_PATTERN,
  FACE_PERSON_NAME_MAX_LENGTH,
  FACE_SEARCH_DEFAULT_LIMIT,
  FACE_SEARCH_MAX_LIMIT,
  FACE_SEARCH_RATE_LIMIT,
  FACE_SEARCH_RATE_WINDOW_MS,
  FACE_STRONG_MATCH_THRESHOLD,
  FACE_VIEWER_ROLES
} from "./config.js";
import {
  bumpDataVersion
} from "./data.js";
import {
  safeImageId
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  constantTimeHexEqual,
  consumeRateLimit,
  json,
  sha256
} from "./util.js";

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
  await env.GALLERY_DB.prepare("DELETE FROM gallery_documents WHERE collection_name = ? AND document_id = ?").bind(AI_SEARCH_INDEX_COLLECTION, safeId).run();
  // האנשים שהופיעו בתמונה מתעדכנים (מונה, מרכז ותמונה ראשית) אחרי המחיקה.
  const affected = await env.GALLERY_DB.prepare(
    "SELECT DISTINCT person_id FROM face_people WHERE image_id = ?"
  ).bind(safeId).all();
  // תיוג ידני שייך לתמונה, כמו הטביעות: נמחק יחד איתה.
  const tagged = await env.GALLERY_DB.prepare(
    "DELETE FROM face_manual_tags WHERE image_id = ? RETURNING person_id"
  ).bind(safeId).all();
  await env.GALLERY_DB.prepare("DELETE FROM face_people WHERE image_id = ?").bind(safeId).run();
  await env.GALLERY_DB.prepare("DELETE FROM face_cluster_marks WHERE image_id = ?").bind(safeId).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors WHERE image_id = ?").bind(safeId).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state WHERE image_id = ?").bind(safeId).run();
  const personIds = (affected.results || []).map(row => String(row.person_id)).filter(Boolean);
  if (personIds.length) await refreshFacePersons(env, personIds);
  if (personIds.length || (tagged.results || []).length) await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
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

async function saveFaceIndexBatch(request, env, ctx) {
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
    // מיקום כל פרצוף בתמונה (רשות), לחיתוך התצוגה של האדם בלי להריץ זיהוי שוב.
    const boxes = entry?.boxes === undefined || entry?.boxes === null ? [] : entry.boxes;
    if (!Array.isArray(boxes) || (boxes.length && boxes.length !== descriptors.length)) {
      throw apiError("מיקומי הפרצופים אינם תואמים לטביעות.", 400, "invalid_face_box");
    }
    const parsedBoxes = boxes.map(parseFaceBox);

    // שורות ישנות שנותרו מריצה קודמת עם יותר פרצופים נמחקות; השאר מתעדכנות
    // במקום, כך שתאריך היצירה המקורי נשמר.
    statements.push(env.GALLERY_DB.prepare(
      "DELETE FROM image_face_descriptors WHERE image_id = ? AND face_index >= ?"
    ).bind(imageId, descriptors.length));
    descriptors.forEach((descriptor, faceIndex) => {
      statements.push(env.GALLERY_DB.prepare(
        `INSERT INTO image_face_descriptors (image_id, face_index, descriptor_json, model_version, box_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(image_id, face_index) DO UPDATE SET
           descriptor_json = excluded.descriptor_json,
           model_version = excluded.model_version,
           box_json = excluded.box_json,
           updated_at = excluded.updated_at`
      ).bind(imageId, faceIndex, serializeFaceDescriptor(descriptor), modelVersion, serializeFaceBox(parsedBoxes[faceIndex]), now, now));
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
  // הפרצופים החדשים מקובצים לאנשים ברקע, אחרי שהתשובה כבר יצאה.
  scheduleFaceClustering(env, ctx);
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
  // האנשים, השמות והסימונים נשענים על הטביעות, ולכן נמחקים יחד איתן.
  if (clearEverything) {
    await env.GALLERY_DB.prepare("DELETE FROM face_people").run();
    await env.GALLERY_DB.prepare("DELETE FROM face_cluster_marks").run();
    await env.GALLERY_DB.prepare("DELETE FROM face_persons").run();
    await env.GALLERY_DB.prepare("DELETE FROM face_manual_tags").run();
    await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors").run();
    await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state").run();
    await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
    return json(request, { success: true, scope: "all" });
  }
  const modelVersion = faceModelVersion(payload?.modelVersion);
  await env.GALLERY_DB.prepare("DELETE FROM face_people WHERE model_version = ?").bind(modelVersion).run();
  await env.GALLERY_DB.prepare("DELETE FROM face_cluster_marks WHERE model_version = ?").bind(modelVersion).run();
  await env.GALLERY_DB.prepare("DELETE FROM face_persons WHERE model_version = ?").bind(modelVersion).run();
  // תיוג ידני של אדם שנמחק יחד עם הגרסה אינו נשאר יתום.
  await env.GALLERY_DB.prepare(
    "DELETE FROM face_manual_tags WHERE NOT EXISTS (SELECT 1 FROM face_persons fp WHERE fp.person_id = face_manual_tags.person_id)"
  ).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_descriptors WHERE model_version = ?").bind(modelVersion).run();
  await env.GALLERY_DB.prepare("DELETE FROM image_face_index_state WHERE model_version = ?").bind(modelVersion).run();
  await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
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
const FACE_PERSON_JOIN = `LEFT JOIN face_people p ON p.image_id = f.image_id
  AND p.face_index = f.face_index AND p.model_version = f.model_version
  AND p.descriptor_json = f.descriptor_json`;

// שיוך תקף: הטביעה לא השתנתה מאז השיוך (אינדוקס מחדש מבטל אותו), והתמונה
// עדיין מאושרת בגלריה. אותו תנאי בדיוק לסימונים של הקיבוץ.
const FACE_VALID_ASSIGNMENT = `JOIN image_face_descriptors f ON f.image_id = p.image_id
  AND f.face_index = p.face_index AND f.model_version = p.model_version
  AND f.descriptor_json = p.descriptor_json
  JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = p.image_id`;
const FACE_VALID_MARK = `JOIN image_face_descriptors f ON f.image_id = m.image_id
  AND f.face_index = m.face_index AND f.model_version = m.model_version
  AND f.descriptor_json = m.descriptor_json
  JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = m.image_id`;
// פרצופים שעוד לא עברו קיבוץ: אין להם שיוך תקף ואין להם סימון תקף.
const FACE_UNCLUSTERED_FROM = `FROM image_face_descriptors f
  JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = f.image_id
  LEFT JOIN face_people p ON p.image_id = f.image_id AND p.face_index = f.face_index
    AND p.model_version = f.model_version AND p.descriptor_json = f.descriptor_json
  LEFT JOIN face_cluster_marks m ON m.image_id = f.image_id AND m.face_index = f.face_index
    AND m.model_version = f.model_version AND m.descriptor_json = f.descriptor_json
  WHERE f.model_version = ? AND p.image_id IS NULL AND m.image_id IS NULL`;
// כתובת התצוגה הקטנה של התמונה, ובלעדיה המקור — לחיתוך הפרצוף בדפדפן.
// תמונה שסובבה או נחתכה (edit) מקבלת את המקור: מיקומי הפרצופים נמדדו עליו,
// והתצוגה הקטנה שלה כבר ערוכה.
const FACE_IMAGE_URL_COLUMNS = `CASE WHEN json_type(d.data_json, '$.edit') = 'object' THEN NULL
    ELSE json_extract(d.data_json, '$.variants.thumb.url') END AS thumbUrl,
  json_extract(d.data_json, '$.url') AS imageUrl`;

async function manageFacePeople(request, env, url) {
  const actor = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(env, `face-people:${actor.uid}`, 120, 60000,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.", "face_people_rate_limit");
  if (request.method === "GET") {
    const offset = Math.max(0, Math.min(1000000, Math.trunc(Number(url.searchParams.get("offset")) || 0)));
    const person = String(url.searchParams.get("person") || "").slice(0, 80);
    const result = await env.GALLERY_DB.prepare(`SELECT f.image_id AS imageId,
      f.face_index AS faceIndex, f.updated_at AS updatedAt, p.person_id AS personId
      FROM image_face_descriptors f ${FACE_PERSON_JOIN}
      JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = f.image_id
      WHERE f.model_version = ? AND (? = '' OR p.person_id = ?)
      ORDER BY f.image_id, f.face_index LIMIT 25 OFFSET ?`
    ).bind(FACE_MODEL_VERSION, person, person, offset).all();
    const faces = result.results || [];
    return json(request, { faces: faces.slice(0, 24), hasMore: faces.length > 24 });
  }
  const payload = await request.json().catch(() => ({}));
  const faces = payload.faces;
  if (!Array.isArray(faces) || faces.length < (payload.action === "detach" ? 1 : 2) || faces.length > 24 ||
      !["merge", "detach"].includes(payload.action) || (payload.action === "detach" && faces.length !== 1)) {
    throw apiError("בחר בין שניים ל־24 פרצופים לאיחוד, או פרצוף אחד להפרדה.", 400, "invalid_faces");
  }
  const bindings = [];
  const keys = new Set();
  for (const face of faces) {
    const id = safeImageId(face.imageId);
    if (!Number.isInteger(face.faceIndex) || face.faceIndex < 0 || face.faceIndex >= FACE_INDEX_MAX_FACES_PER_IMAGE ||
        !Number.isSafeInteger(face.updatedAt) || keys.has(`${id}:${face.faceIndex}`)) {
      throw apiError("בחירת הפרצופים אינה תקינה.", 400, "invalid_faces");
    }
    keys.add(`${id}:${face.faceIndex}`);
    bindings.push(id, face.faceIndex, face.updatedAt);
  }
  const selected = `WITH requested(image_id, face_index, updated_at) AS (
      VALUES ${faces.map(() => "(?, ?, ?)").join(",")}), selected AS (
      SELECT f.*, p.person_id FROM image_face_descriptors f ${FACE_PERSON_JOIN}
      JOIN requested r ON r.image_id = f.image_id AND r.face_index = f.face_index AND r.updated_at = f.updated_at
      JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = f.image_id
      WHERE f.model_version = ?)`;
  const now = Date.now();
  if (payload.action === "detach") {
    const result = await env.GALLERY_DB.prepare(`${selected} DELETE FROM face_people WHERE (image_id, face_index) IN
       (SELECT image_id, face_index FROM selected) RETURNING image_id, face_index, person_id`
    ).bind(...bindings, FACE_MODEL_VERSION).all();
    if (!result.results?.length) throw apiError("הנתונים השתנו. רענן את הרשימה ונסה שוב.", 409, "stale_faces");
    // פרצוף שהופרד מסומן "לא לקבץ"; אחרת הקיבוץ האוטומטי היה מחזיר אותו לאותה קבוצה.
    await markFacesByKey(env, result.results, "ignored", now);
    await refreshFacePersons(env, result.results.map(row => row.person_id));
    await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
    return json(request, { success: true });
  }
  // האיחוד נשמר על אדם קיים מתוך הבחירה (מאושר קודם, אחר כך הקבוצה הגדולה),
  // כדי ששם שכבר ניתן לא ילך לאיבוד. רק כשאין אף קבוצה נוצר אדם חדש.
  // ההסתרה של כל אחת מהקבוצות עוברת ליעד (adoptFacePersonDetails).
  const existing = await env.GALLERY_DB.prepare(`${selected}
    SELECT DISTINCT s.person_id AS personId, fp.status AS status, COALESCE(fp.face_count, 0) AS faceCount
    FROM selected s LEFT JOIN face_persons fp ON fp.person_id = s.person_id
    WHERE s.person_id IS NOT NULL`
  ).bind(...bindings, FACE_MODEL_VERSION).all();
  const ranked = (existing.results || []).sort((left, right) =>
    (right.status === "approved") - (left.status === "approved")
    || Number(right.faceCount) - Number(left.faceCount)
    || String(left.personId).localeCompare(String(right.personId)));
  const targetId = ranked[0]?.personId
    || await newFacePersonId(`manual:${bindings[0]}:${bindings[1]}:${bindings[2]}`);
  // One statement: concurrent merges cannot leave half a group assigned.
  const result = await env.GALLERY_DB.prepare(`${selected} INSERT INTO face_people(image_id, face_index, model_version, descriptor_json, person_id, source, assigned_at)
       SELECT f.image_id, f.face_index, f.model_version, f.descriptor_json, ?, 'manual', ?
       FROM image_face_descriptors f ${FACE_PERSON_JOIN}
       WHERE (SELECT COUNT(*) FROM selected) = ? AND (
         (f.image_id, f.face_index) IN (SELECT image_id, face_index FROM selected)
         OR p.person_id IN (SELECT person_id FROM selected WHERE person_id IS NOT NULL))
       ON CONFLICT(image_id, face_index) DO UPDATE SET person_id = excluded.person_id,
         model_version = excluded.model_version, descriptor_json = excluded.descriptor_json,
         source = 'manual', assigned_at = excluded.assigned_at
       RETURNING image_id, face_index`
  ).bind(...bindings, FACE_MODEL_VERSION, targetId, now, faces.length).all();
  if (!result.results?.length) throw apiError("הנתונים השתנו. רענן את הרשימה ונסה שוב.", 409, "stale_faces");
  await ensureFacePersonRow(env, targetId, now);
  await adoptFacePersonDetails(env, targetId, ranked.slice(1).map(row => row.personId), now);
  await clearFaceMarksByKey(env, result.results);
  await refreshFacePersons(env, [targetId, ...ranked.map(row => row.personId)]);
  await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  return json(request, { success: true });
}

// ליבת החיפוש: משמשת גם את "חיפוש פנים" וגם את "התמונות שלי".
async function runFaceSearch(env, queryDescriptor, modelVersion, resultLimit) {
  const squaredThreshold = FACE_MATCH_THRESHOLD * FACE_MATCH_THRESHOLD;
  const bestSquaredDistances = new Map();
  const personDistances = new Map();
  const manuallyLinkedImages = new Set();
  let scannedFaces = 0;

  for (let offset = 0; offset < FACE_DESCRIPTOR_SCAN_LIMIT; offset += FACE_DESCRIPTOR_PAGE_SIZE) {
    const page = await env.GALLERY_DB.prepare(
      `SELECT f.image_id, f.descriptor_json, p.person_id FROM image_face_descriptors f ${FACE_PERSON_JOIN}
       WHERE f.model_version = ?
       ORDER BY f.image_id, f.face_index
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
      if (row.person_id) personDistances.set(row.person_id,
        Math.min(personDistances.get(row.person_id) ?? Infinity, squaredDistance));
      const imageId = String(row.image_id);
      const previousBest = bestSquaredDistances.get(imageId);
      if (previousBest === undefined || squaredDistance < previousBest) {
        bestSquaredDistances.set(imageId, squaredDistance);
      }
    }

    scannedFaces += rows.length;
    if (rows.length < FACE_DESCRIPTOR_PAGE_SIZE) break;
  }

  // Identity links expand results without weakening the biometric threshold:
  // manual links always, automatic groups only after an admin approved them,
  // and never for a hidden person.
  for (const [personId, distance] of personDistances) {
    const linked = await env.GALLERY_DB.prepare(`SELECT f.image_id FROM image_face_descriptors f
      ${FACE_PERSON_JOIN} LEFT JOIN face_persons fp ON fp.person_id = p.person_id
      WHERE p.person_id = ? AND f.model_version = ? AND COALESCE(fp.hidden, 0) = 0
        AND (p.source = 'manual' OR fp.status = 'approved') LIMIT ?`
    ).bind(personId, modelVersion, FACE_SEARCH_MAX_LIMIT).all();
    for (const row of linked.results || []) {
      if (!bestSquaredDistances.has(row.image_id)) {
        bestSquaredDistances.set(row.image_id, distance);
        manuallyLinkedImages.add(row.image_id);
      }
    }
  }
  // תיוג ידני (face_manual_tags): תמונה שבה מנהל תייג אדם מאושר שזוהה כאן,
  // גם כשזיהוי הפנים לא מצא אותו בה. אותו מרחק כמו האדם, ומסומנת "ידני".
  for (const [personId, distance] of personDistances) {
    const tagged = await env.GALLERY_DB.prepare(`SELECT t.image_id FROM face_manual_tags t
      JOIN face_persons fp ON fp.person_id = t.person_id
      WHERE t.person_id = ? AND fp.status = 'approved' AND fp.hidden = 0 LIMIT ?`
    ).bind(personId, FACE_SEARCH_MAX_LIMIT).all();
    for (const row of tagged.results || []) {
      if (!bestSquaredDistances.has(row.image_id)) {
        bestSquaredDistances.set(row.image_id, distance);
        manuallyLinkedImages.add(row.image_id);
      }
    }
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
        confidence: manuallyLinkedImages.has(imageId) ? null : faceMatchConfidence(distance),
        source: manuallyLinkedImages.has(imageId) ? "manual" : "biometric",
        strength: manuallyLinkedImages.has(imageId) ? "manual" : distance < FACE_STRONG_MATCH_THRESHOLD ? "strong" : "possible"
      };
    });

  const coverage = await faceIndexSummary(env, modelVersion);
  return {
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
  };
}

function faceSearchLimit(value) {
  const requestedLimit = Math.trunc(Number(value) || FACE_SEARCH_DEFAULT_LIMIT);
  return Math.max(1, Math.min(FACE_SEARCH_MAX_LIMIT, requestedLimit));
}

async function consumeFaceSearchQuota(env, uid) {
  await consumeRateLimit(
    env,
    `face-search:${uid}`,
    FACE_SEARCH_RATE_LIMIT,
    FACE_SEARCH_RATE_WINDOW_MS,
    "בוצעו יותר מדי חיפושי פנים. המתן כמה דקות ונסה שוב.",
    "face_search_rate_limit_exceeded"
  );
}

async function faceSearch(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const modelVersion = faceModelVersion(payload.modelVersion);
  const queryDescriptor = parseFaceDescriptor(payload.descriptor);
  const resultLimit = faceSearchLimit(payload.limit);
  await consumeFaceSearchQuota(env, user.uid);
  return json(request, await runFaceSearch(env, queryDescriptor, modelVersion, resultLimit));
}

// ==========================================================================
// אנשים בגלריה: קיבוץ אוטומטי, ניהול, רשימה ציבורית ואלבום לכל אדם
// ==========================================================================

function facePersonId(value) {
  const id = String(value ?? "").trim();
  if (!FACE_PERSON_ID_PATTERN.test(id)) throw apiError("מזהה האדם אינו תקין.", 400, "invalid_person_id");
  return id;
}

// שם לתצוגה: בלי תווי בקרה ובלי תווי כיווניות שמאפשרים להציג טקסט מטעה.
function facePersonName(value) {
  const name = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw apiError("יש להזין שם.", 400, "invalid_person_name");
  if ([...name].length > FACE_PERSON_NAME_MAX_LENGTH) {
    throw apiError(`השם ארוך מדי (עד ${FACE_PERSON_NAME_MAX_LENGTH} תווים).`, 400, "invalid_person_name");
  }
  return name;
}

function faceReference(value) {
  const imageId = safeImageId(value?.imageId);
  const faceIndex = value?.faceIndex;
  const updatedAt = value?.updatedAt;
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= FACE_INDEX_MAX_FACES_PER_IMAGE
      || !Number.isSafeInteger(updatedAt)) {
    throw apiError("בחירת הפרצוף אינה תקינה.", 400, "invalid_faces");
  }
  return { imageId, faceIndex, updatedAt };
}

// מיקום הפרצוף בתמונה, ביחידות יחסיות (0..1) לרוחב ולגובה, ויחס הרוחב לגובה
// של התמונה (a) — כך הדפדפן חותך ריבוע סביב הפרצוף מכל גודל של התמונה.
function parseFaceBox(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw apiError("מיקום הפרצוף אינו תקין.", 400, "invalid_face_box");
  }
  const read = key => {
    const number = value[key];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw apiError("מיקום הפרצוף אינו תקין.", 400, "invalid_face_box");
    }
    return Math.round(number * 10000) / 10000;
  };
  const box = { x: read("x"), y: read("y"), w: read("w"), h: read("h"), a: read("a") };
  if (box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > 1.001 || box.y + box.h > 1.001
      || box.a < 0.05 || box.a > 20) {
    throw apiError("מיקום הפרצוף אינו תקין.", 400, "invalid_face_box");
  }
  return box;
}

function serializeFaceBox(box) {
  return box ? JSON.stringify(box) : "";
}

function readFaceBox(value) {
  if (!value) return null;
  try {
    return parseFaceBox(JSON.parse(String(value)));
  } catch {
    return null;
  }
}

function httpsUrl(value) {
  const url = String(value ?? "").trim();
  return /^https:\/\//i.test(url) ? url.slice(0, 2000) : "";
}

// פרצוף כפי שהוא נשלח ללקוח: מזהה, גרסה, מיקום וכתובת התמונה — לעולם לא טביעה.
// url היא התצוגה הקטנה לחיתוך; sourceUrl היא התמונה שאונדקסה, שעליה הדפדפן
// של המנהל מאתר את הפרצוף כשחסר לו מיקום. ברשימה הציבורית נשלחת רק url.
function faceView(row) {
  return {
    imageId: String(row.imageId),
    faceIndex: Number(row.faceIndex),
    updatedAt: Number(row.updatedAt),
    box: readFaceBox(row.boxJson),
    url: httpsUrl(row.thumbUrl) || httpsUrl(row.imageUrl),
    sourceUrl: httpsUrl(row.imageUrl)
  };
}

function faceDistance(left, right) {
  let squared = 0;
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const difference = left[index] - right[index];
    squared += difference * difference;
  }
  return Math.sqrt(squared);
}

// האם המרחק מתחת ל-limit? עוצר ברגע שהסכום כבר גדול ממנו — רוב הזוגות
// רחוקים זה מזה, ולכן הבדיקה החוזרת של הבודדים אינה עוברת על כל 128 המספרים.
function faceWithin(left, right, limit) {
  const squaredLimit = limit * limit;
  let squared = 0;
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
    const difference = left[index] - right[index];
    squared += difference * difference;
    if (squared >= squaredLimit) return false;
  }
  return true;
}

// ההחלטה עבור פרצוף אחד, בלי מסד ובלי אקראיות: אותו קלט נותן תמיד אותה
// תוצאה. persons ו-seeds מגיעים בסדר קבוע (מזהה), והשוויון נשבר לטובת הראשון.
//   join   — שיוך לאדם קיים (המרכז הקרוב מתחת לסף, והפער מהאדם הבא מספיק)
//   pair   — יצירת קבוצה חדשה עם פרצוף בודד קרוב (רק כשאין אדם מתחת לסף)
//   review — קרוב לאדם אך בלי ודאות: נכנס לתור "לבדיקה"
//   seed   — אין דומה; נשמר כפרצוף בודד שאליו יוכלו להצטרף הבאים
export function decideFaceCluster(descriptor, persons, seeds, {
  join = FACE_CLUSTER_JOIN_DISTANCE,
  review = FACE_CLUSTER_REVIEW_DISTANCE,
  margin = FACE_CLUSTER_MARGIN
} = {}) {
  let bestPerson = null;
  let secondPerson = Infinity;
  persons.forEach((person, index) => {
    const distance = faceDistance(descriptor, person.centroid);
    if (!bestPerson || distance < bestPerson.distance) {
      if (bestPerson) secondPerson = Math.min(secondPerson, bestPerson.distance);
      bestPerson = { index, distance };
    } else {
      secondPerson = Math.min(secondPerson, distance);
    }
  });
  let bestSeed = null;
  seeds.forEach((seed, index) => {
    const distance = faceDistance(descriptor, seed.descriptor);
    if (!bestSeed || distance < bestSeed.distance) bestSeed = { index, distance };
  });
  const gapOf = value => Math.min(9, Math.round(value * 10000) / 10000);

  // אדם מתחת לסף לעולם אינו מוליד קבוצה חדשה ליד עצמו. אם פרצוף בודד קרוב
  // יותר, אבל גם הוא עצמו שייך לאדם, הפרצוף מצטרף לאדם (והבודד יצורף אליו
  // בבדיקה החוזרת שבסוף הריצה). בודד שאינו שייך לאדם — הפרצוף נמצא ביניהם,
  // ולכן הוא נכנס לבדיקה במקום לפתוח קבוצה שאולי כפולה.
  if (bestPerson && bestPerson.distance < join) {
    const gap = secondPerson - bestPerson.distance;
    const seedCloser = bestSeed && bestSeed.distance < bestPerson.distance;
    const seedBelongs = seedCloser && faceDistance(seeds[bestSeed.index].descriptor, persons[bestPerson.index].centroid) < join;
    return {
      action: gap >= margin && (!seedCloser || seedBelongs) ? "join" : "review",
      person: bestPerson.index,
      distance: bestPerson.distance,
      margin: gapOf(gap)
    };
  }
  if (bestSeed && bestSeed.distance < join) {
    const gap = (bestPerson ? bestPerson.distance : Infinity) - bestSeed.distance;
    if (gap >= margin) return { action: "pair", seed: bestSeed.index, distance: bestSeed.distance, margin: gapOf(gap) };
    return { action: "review", person: bestPerson.index, distance: bestPerson.distance, margin: gapOf(gap) };
  }
  if (bestPerson && bestPerson.distance < review) {
    return { action: "review", person: bestPerson.index, distance: bestPerson.distance, margin: gapOf(secondPerson - bestPerson.distance) };
  }
  return { action: "seed" };
}

function meanDescriptor(descriptors) {
  const centroid = new Float64Array(FACE_DESCRIPTOR_LENGTH);
  for (const descriptor of descriptors) {
    for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) centroid[index] += descriptor[index];
  }
  for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) centroid[index] /= Math.max(1, descriptors.length);
  return centroid;
}

// מזהה אדם יציב: נגזר מהפרצוף הראשון בקבוצה, כך שריצה חוזרת על אותם נתונים
// מייצרת את אותם מזהים.
async function newFacePersonId(seedKey) {
  return `fp_${(await sha256(String(seedKey), { normalize: false })).slice(0, 24)}`;
}

async function ensureFacePersonRow(env, personId, now = Date.now()) {
  await env.GALLERY_DB.prepare(
    `INSERT INTO face_persons (person_id, model_version, status, created_at, updated_at)
     VALUES (?, ?, 'suggested', ?, ?)
     ON CONFLICT(person_id) DO NOTHING`
  ).bind(personId, FACE_MODEL_VERSION, now, now).run();
}

// אחרי איחוד: אם לאדם שנשאר אין שם, הוא מקבל את השם של אדם שאוחד לתוכו,
// ואם אחד מהם אושר — גם הוא מאושר. אם אחד מהם הוסתר, הקבוצה המאוחדת
// מוסתרת: איחוד לעולם אינו חושף לצופים תמונות של אדם שהמנהל הסתיר.
async function adoptFacePersonDetails(env, targetId, sourceIds, now = Date.now()) {
  const sources = [...new Set(sourceIds.map(String))].filter(id => id && id !== targetId);
  if (!sources.length) return;
  const placeholders = sources.map(() => "?").join(",");
  await env.GALLERY_DB.prepare(
    `UPDATE face_persons SET
       name = CASE WHEN name <> '' THEN name ELSE COALESCE((
         SELECT name FROM face_persons WHERE person_id IN (${placeholders}) AND name <> ''
         ORDER BY status = 'approved' DESC, face_count DESC, person_id LIMIT 1), '') END,
       status = CASE WHEN status = 'approved' OR EXISTS (
         SELECT 1 FROM face_persons WHERE person_id IN (${placeholders}) AND status = 'approved') THEN 'approved' ELSE status END,
       hidden = CASE WHEN hidden = 1 OR EXISTS (
         SELECT 1 FROM face_persons WHERE person_id IN (${placeholders}) AND hidden = 1) THEN 1 ELSE 0 END,
       updated_at = ?
     WHERE person_id = ?`
  ).bind(...sources, ...sources, ...sources, now, targetId).run();
}

async function markFacesByKey(env, rows, mark, now = Date.now()) {
  const keys = rows.map(row => ({ i: String(row.image_id ?? row.imageId), x: Number(row.face_index ?? row.faceIndex) }));
  if (!keys.length) return;
  await env.GALLERY_DB.prepare(
    `INSERT INTO face_cluster_marks (image_id, face_index, model_version, descriptor_json, mark, candidate_person_id, distance, margin, created_at)
     SELECT f.image_id, f.face_index, f.model_version, f.descriptor_json, ?, '', 0, 0, ?
     FROM json_each(?) AS r JOIN image_face_descriptors f
       ON f.image_id = json_extract(r.value, '$.i') AND f.face_index = json_extract(r.value, '$.x')
     WHERE true
     ON CONFLICT(image_id, face_index) DO UPDATE SET model_version = excluded.model_version,
       descriptor_json = excluded.descriptor_json, mark = excluded.mark, candidate_person_id = '',
       distance = 0, margin = 0, created_at = excluded.created_at`
  ).bind(mark, now, JSON.stringify(keys)).run();
}

async function clearFaceMarksByKey(env, rows) {
  const keys = rows.map(row => ({ i: String(row.image_id ?? row.imageId), x: Number(row.face_index ?? row.faceIndex) }));
  if (!keys.length) return;
  await env.GALLERY_DB.prepare(
    `DELETE FROM face_cluster_marks WHERE EXISTS (
       SELECT 1 FROM json_each(?) AS r
       WHERE json_extract(r.value, '$.i') = face_cluster_marks.image_id
         AND json_extract(r.value, '$.x') = face_cluster_marks.face_index)`
  ).bind(JSON.stringify(keys)).run();
}

// מחשב מחדש מרכז, מונים ותמונה ראשית לאנשים שהשתנו, מתוך השיוכים התקפים
// בלבד. בלי רשימה — מאתר בעצמו אנשים שהמונה השמור שלהם כבר אינו נכון (תמונה
// נמחקה, פרצוף אונדקס מחדש). קבוצה אוטומטית שהתרוקנה נמחקת; אדם מאושר נשאר
// עם השם שלו, ופשוט אינו מוצג כל עוד אין לו תמונות.
async function refreshFacePersons(env, personIds = null, modelVersion = FACE_MODEL_VERSION) {
  let ids;
  if (personIds) {
    ids = [...new Set(personIds.map(id => String(id ?? "")))].filter(id => FACE_PERSON_ID_PATTERN.test(id));
  } else {
    // שיוך תקף לאדם שאין לו רשומה (למשל כתיבה שהתנגשה במיזוג, או גרסה ישנה
    // של ה-Worker) היה נעלם מכל מסך. הרשומה נוצרת מחדש כקבוצה מוצעת, והמונים
    // שלה מחושבים מיד למטה — כך המנהל רואה אותה ויכול למזג או לתת שם.
    const recreatedAt = Date.now();
    await env.GALLERY_DB.prepare(
      `INSERT INTO face_persons (person_id, model_version, status, created_at, updated_at)
       SELECT p.person_id, MAX(p.model_version), 'suggested', ?, ?
       FROM face_people p ${FACE_VALID_ASSIGNMENT}
       WHERE p.model_version = ?
         AND NOT EXISTS (SELECT 1 FROM face_persons fp WHERE fp.person_id = p.person_id)
       GROUP BY p.person_id
       ON CONFLICT(person_id) DO NOTHING`
    ).bind(recreatedAt, recreatedAt, modelVersion).run();
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT fp.person_id AS personId, fp.face_count AS stored, fp.centroid_json AS centroid,
         (SELECT COUNT(*) FROM face_people p ${FACE_VALID_ASSIGNMENT} WHERE p.person_id = fp.person_id) AS actual
       FROM face_persons fp WHERE fp.model_version = ?`
    ).bind(modelVersion).all()).results || [];
    ids = rows
      .filter(row => Number(row.stored) !== Number(row.actual) || (!row.centroid && Number(row.actual) > 0))
      .map(row => String(row.personId));
  }
  const now = Date.now();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    const placeholders = chunk.map(() => "?").join(",");
    const persons = (await env.GALLERY_DB.prepare(
      `SELECT person_id AS personId, status, cover_image_id AS coverImageId, cover_face_index AS coverFaceIndex
       FROM face_persons WHERE person_id IN (${placeholders})`
    ).bind(...chunk).all()).results || [];
    const memberRows = (await env.GALLERY_DB.prepare(
      `SELECT p.person_id AS personId, p.image_id AS imageId, p.face_index AS faceIndex,
         f.descriptor_json AS descriptorJson, f.box_json AS boxJson
       FROM face_people p ${FACE_VALID_ASSIGNMENT}
       WHERE p.person_id IN (${placeholders})
       ORDER BY p.person_id, p.image_id, p.face_index`
    ).bind(...chunk).all()).results || [];
    const members = new Map();
    for (const row of memberRows) {
      const descriptor = deserializeFaceDescriptor(row.descriptorJson);
      if (!descriptor) continue;
      if (!members.has(row.personId)) members.set(row.personId, []);
      members.get(row.personId).push({ ...row, descriptor });
    }
    const updates = [];
    const removed = [];
    for (const person of persons) {
      const list = members.get(person.personId) || [];
      if (!list.length) {
        if (person.status === "approved") updates.push({ p: person.personId, c: "", n: 0, m: 0, i: "", x: -1 });
        else removed.push(person.personId);
        continue;
      }
      const centroid = meanDescriptor(list.map(member => member.descriptor));
      // התמונה הראשית נשמרת כל עוד היא עדיין בקבוצה; אחרת נבחר הפרצוף הקרוב
      // ביותר למרכז, ועדיף כזה שמיקומו ידוע (כדי שיהיה אפשר לחתוך אותו).
      let cover = list.find(member => member.imageId === person.coverImageId && Number(member.faceIndex) === Number(person.coverFaceIndex));
      if (!cover) {
        const ranked = list
          .map(member => ({ member, distance: faceDistance(member.descriptor, centroid) - (member.boxJson ? 1 : 0) }))
          .sort((left, right) => left.distance - right.distance);
        cover = ranked[0].member;
      }
      updates.push({
        p: person.personId,
        c: serializeFaceDescriptor(centroid),
        n: list.length,
        m: new Set(list.map(member => member.imageId)).size,
        i: cover.imageId,
        x: Number(cover.faceIndex)
      });
    }
    const statements = [];
    if (updates.length) {
      statements.push(env.GALLERY_DB.prepare(
        `UPDATE face_persons SET
           centroid_json = json_extract(u.value, '$.c'),
           face_count = json_extract(u.value, '$.n'),
           image_count = json_extract(u.value, '$.m'),
           cover_image_id = json_extract(u.value, '$.i'),
           cover_face_index = json_extract(u.value, '$.x'),
           updated_at = ?
         FROM json_each(?) AS u
         WHERE face_persons.person_id = json_extract(u.value, '$.p')`
      ).bind(now, JSON.stringify(updates)));
    }
    if (removed.length) {
      const removedPlaceholders = removed.map(() => "?").join(",");
      statements.push(env.GALLERY_DB.prepare(
        `DELETE FROM face_persons WHERE person_id IN (${removedPlaceholders})`
      ).bind(...removed));
      statements.push(env.GALLERY_DB.prepare(
        `UPDATE face_cluster_marks SET candidate_person_id = '' WHERE candidate_person_id IN (${removedPlaceholders})`
      ).bind(...removed));
    }
    await runDatabaseStatements(env, statements);
  }
}

async function countUnclusteredFaces(env, modelVersion = FACE_MODEL_VERSION) {
  const row = await env.GALLERY_DB.prepare(`SELECT COUNT(*) AS total ${FACE_UNCLUSTERED_FROM}`).bind(modelVersion).first();
  return Number(row?.total) || 0;
}

async function acquireFaceClusterLock(env) {
  const now = Date.now();
  const until = now + FACE_CLUSTER_LOCK_MS;
  const row = await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at)
     VALUES ('face_cluster_lock', ?, ?)
     ON CONFLICT(schema_key) DO UPDATE SET schema_version = excluded.schema_version, updated_at = excluded.updated_at
     WHERE gallery_schema_meta.schema_version < ?
     RETURNING schema_version`
  ).bind(until, now, now).first();
  return row ? until : 0;
}

async function releaseFaceClusterLock(env, until) {
  try {
    await env.GALLERY_DB.prepare(
      "UPDATE gallery_schema_meta SET schema_version = 0 WHERE schema_key = 'face_cluster_lock' AND schema_version = ?"
    ).bind(until).run();
  } catch (error) {
    console.warn("Face cluster lock release failed", error?.message || error);
  }
}

async function loadClusterPersons(env, modelVersion) {
  const rows = (await env.GALLERY_DB.prepare(
    `SELECT person_id AS personId, centroid_json AS centroidJson, face_count AS faceCount, updated_at AS updatedAt
     FROM face_persons WHERE model_version = ? AND face_count > 0 AND centroid_json <> ''
     ORDER BY person_id`
  ).bind(modelVersion).all()).results || [];
  return rows
    .map(row => ({
      id: String(row.personId),
      centroid: deserializeFaceDescriptor(row.centroidJson),
      count: Number(row.faceCount) || 0,
      updatedAt: Number(row.updatedAt) || 0
    }))
    .filter(person => person.centroid && person.count > 0);
}

// הבדיקה החוזרת של הבודדים (ראו runFaceClustering) רצה מול אנשים שהשתנו מאז
// הבדיקה הקודמת. כאן נשמר מתי היא התחילה; בלי רשומה — בדיקה מלאה מול כולם,
// וכך גם בודדים שנשארו מלפני העדכון הזה נבדקים פעם אחת.
const FACE_CLUSTER_SWEEP_KEY = "face_cluster_sweep";

async function readFaceSweepMarker(env) {
  const row = await env.GALLERY_DB.prepare(
    "SELECT schema_version FROM gallery_schema_meta WHERE schema_key = ?"
  ).bind(FACE_CLUSTER_SWEEP_KEY).first();
  return Number(row?.schema_version) || 0;
}

async function writeFaceSweepMarker(env, startedAt) {
  await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(schema_key) DO UPDATE SET schema_version = excluded.schema_version, updated_at = excluded.updated_at`
  ).bind(FACE_CLUSTER_SWEEP_KEY, startedAt, Date.now()).run();
}

async function hasFacePersonsChangedSince(env, modelVersion, since) {
  const row = await env.GALLERY_DB.prepare(
    `SELECT 1 AS changed FROM face_persons
     WHERE model_version = ? AND face_count > 0 AND centroid_json <> '' AND updated_at >= ? LIMIT 1`
  ).bind(modelVersion, since).first();
  return Boolean(row);
}

async function loadClusterSeeds(env, modelVersion) {
  const seeds = [];
  for (let offset = 0; offset < FACE_CLUSTER_SEED_SCAN_LIMIT; offset += FACE_CLUSTER_SEED_PAGE_SIZE) {
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT m.image_id AS imageId, m.face_index AS faceIndex, f.updated_at AS updatedAt, m.descriptor_json AS descriptorJson,
         m.candidate_person_id AS rejectedId
       FROM face_cluster_marks m ${FACE_VALID_MARK}
       WHERE m.mark = 'seed' AND m.model_version = ?
       ORDER BY m.image_id, m.face_index LIMIT ? OFFSET ?`
    ).bind(modelVersion, FACE_CLUSTER_SEED_PAGE_SIZE, offset).all()).results || [];
    for (const row of rows) {
      const descriptor = deserializeFaceDescriptor(row.descriptorJson);
      // בבודד, candidate_person_id הוא האדם שהמנהל ענה עליו "לא — אדם אחר".
      if (descriptor) seeds.push({
        imageId: String(row.imageId),
        faceIndex: Number(row.faceIndex),
        updatedAt: Number(row.updatedAt),
        descriptor,
        rejectedId: String(row.rejectedId || "")
      });
    }
    if (rows.length < FACE_CLUSTER_SEED_PAGE_SIZE) break;
  }
  return seeds;
}

// ריצת קיבוץ אחת: עד limit פרצופים שעוד לא קובצו, לפי סדר האינדוקס.
// התוצאה תלויה רק בנתונים ובסדר הזה, ולכן ריצה חוזרת אינה משנה דבר. כל
// הכתיבות יוצאות בטרנזקציה אחת, ורק מול הטביעה שנקראה (updated_at), כך
// שפרצוף שאונדקס מחדש באמצע או שמנהל שייך בינתיים אינו נדרס.
//
// בסוף הריצה הבודדים נבדקים שוב מול האנשים שהשתנו מאז הבדיקה הקודמת (כולל
// אלה שנוצרו או גדלו בריצה הזו): פרצוף שנשמר כבודד לפני שנוצר לידו אדם,
// או לפני שהמרכז של האדם זז אליו, מצטרף אליו באותם כללים בדיוק (סף ופער).
// בודד שהמנהל דחה ("לא — אדם אחר") אינו מצורף מעצמו.
async function runFaceClustering(env, { limit = FACE_CLUSTER_BATCH } = {}) {
  await ensureDatabaseSchema(env);
  const modelVersion = FACE_MODEL_VERSION;
  const lock = await acquireFaceClusterLock(env);
  if (!lock) return { busy: true, processed: 0, joined: 0, created: 0, review: 0, seeded: 0, absorbed: 0, remaining: await countUnclusteredFaces(env, modelVersion) };
  const result = { busy: false, processed: 0, joined: 0, created: 0, review: 0, seeded: 0, absorbed: 0, remaining: 0 };
  try {
    await refreshFacePersons(env, null, modelVersion);
    const sweptSince = await readFaceSweepMarker(env);
    const startedAt = Date.now();
    const pending = (await env.GALLERY_DB.prepare(
      `SELECT f.image_id AS imageId, f.face_index AS faceIndex, f.descriptor_json AS descriptorJson, f.updated_at AS updatedAt
       ${FACE_UNCLUSTERED_FROM}
       ORDER BY f.created_at, f.image_id, f.face_index LIMIT ?`
    ).bind(modelVersion, Math.max(1, Math.min(FACE_CLUSTER_BATCH_MAX, limit))).all()).results || [];
    if (pending.length || await hasFacePersonsChangedSince(env, modelVersion, sweptSince)) {
      const persons = await loadClusterPersons(env, modelVersion);
      const seeds = await loadClusterSeeds(env, modelVersion);
      const assignments = [];
      const marks = [];
      const createdPersons = [];
      const touched = new Set();
      const joinPerson = (person, descriptor) => {
        for (let index = 0; index < FACE_DESCRIPTOR_LENGTH; index += 1) {
          person.centroid[index] = (person.centroid[index] * person.count + descriptor[index]) / (person.count + 1);
        }
        person.count += 1;
        touched.add(person.id);
      };
      for (const face of pending) {
        const key = { i: String(face.imageId), x: Number(face.faceIndex), u: Number(face.updatedAt) };
        const descriptor = deserializeFaceDescriptor(face.descriptorJson);
        result.processed += 1;
        if (!descriptor) {
          marks.push({ ...key, k: "ignored", c: "", d: 0, g: 0 });
          continue;
        }
        const decision = decideFaceCluster(descriptor, persons, seeds);
        if (decision.action === "join") {
          const person = persons[decision.person];
          joinPerson(person, descriptor);
          assignments.push({ ...key, p: person.id });
          result.joined += 1;
        } else if (decision.action === "pair") {
          const [seed] = seeds.splice(decision.seed, 1);
          const id = await newFacePersonId(`auto:${seed.imageId}:${seed.faceIndex}:${seed.updatedAt}`);
          persons.push({ id, centroid: meanDescriptor([seed.descriptor, descriptor]), count: 2, updatedAt: startedAt });
          createdPersons.push({ p: id, i: seed.imageId, x: seed.faceIndex });
          assignments.push({ i: seed.imageId, x: seed.faceIndex, u: seed.updatedAt, p: id }, { ...key, p: id });
          touched.add(id);
          result.created += 1;
        } else if (decision.action === "review") {
          marks.push({ ...key, k: "review", c: persons[decision.person].id, d: Math.round(decision.distance * 10000) / 10000, g: decision.margin });
          result.review += 1;
        } else {
          seeds.push({ imageId: key.i, faceIndex: key.x, updatedAt: key.u, descriptor, rejectedId: "" });
          marks.push({ ...key, k: "seed", c: "", d: 0, g: 0 });
          result.seeded += 1;
        }
      }
      // הבדיקה החוזרת: רק בודד שקרוב מתחת לסף לאדם שהשתנה נבדק מול כל
      // האנשים (בשביל הפער), כך שהעלות תלויה במספר האנשים שהשתנו.
      const changed = persons.filter(person => touched.has(person.id) || person.updatedAt >= sweptSince);
      for (let index = 0; changed.length && index < seeds.length;) {
        const seed = seeds[index];
        const near = !seed.rejectedId
          && changed.some(person => faceWithin(seed.descriptor, person.centroid, FACE_CLUSTER_JOIN_DISTANCE));
        const decision = near ? decideFaceCluster(seed.descriptor, persons, []) : null;
        if (decision?.action !== "join") {
          index += 1;
          continue;
        }
        const person = persons[decision.person];
        joinPerson(person, seed.descriptor);
        if (!changed.includes(person)) changed.push(person);
        assignments.push({ i: seed.imageId, x: seed.faceIndex, u: seed.updatedAt, p: person.id });
        seeds.splice(index, 1);
        result.absorbed += 1;
      }
      const now = Date.now();
      const statements = [];
      if (createdPersons.length) {
        statements.push(env.GALLERY_DB.prepare(
          `INSERT INTO face_persons (person_id, model_version, status, cover_image_id, cover_face_index, created_at, updated_at)
           SELECT json_extract(value, '$.p'), ?, 'suggested', json_extract(value, '$.i'), json_extract(value, '$.x'), ?, ?
           FROM json_each(?) WHERE true
           ON CONFLICT(person_id) DO NOTHING`
        ).bind(modelVersion, now, now, JSON.stringify(createdPersons)));
      }
      // הסימונים נכתבים לפני השיוכים: פרצוף שנשמר כבודד ובאותה ריצה הצטרף
      // לפרצוף חדש יוצא מרשימת הבודדים במחיקה שאחרי השיוך.
      // כל כתיבה שמפנה לאדם נעשית רק אם האדם עדיין קיים ברגע הכתיבה: מנהל
      // יכול למזג או להסיר קבוצה בין הקריאות של הריצה לבין הכתיבה. פרצוף
      // שנשאר כך בלי שיוך ובלי סימון פשוט עובר לריצה הבאה.
      if (marks.length) {
        const payload = JSON.stringify(marks);
        statements.push(env.GALLERY_DB.prepare(
          `INSERT INTO face_cluster_marks (image_id, face_index, model_version, descriptor_json, mark, candidate_person_id, distance, margin, created_at)
           SELECT f.image_id, f.face_index, f.model_version, f.descriptor_json, json_extract(r.value, '$.k'),
             json_extract(r.value, '$.c'), json_extract(r.value, '$.d'), json_extract(r.value, '$.g'), ?
           FROM json_each(?) AS r JOIN image_face_descriptors f
             ON f.image_id = json_extract(r.value, '$.i') AND f.face_index = json_extract(r.value, '$.x')
             AND f.updated_at = json_extract(r.value, '$.u')
           WHERE f.model_version = ? AND (json_extract(r.value, '$.k') <> 'review'
             OR EXISTS (SELECT 1 FROM face_persons fp WHERE fp.person_id = json_extract(r.value, '$.c')))
           ON CONFLICT(image_id, face_index) DO UPDATE SET model_version = excluded.model_version,
             descriptor_json = excluded.descriptor_json, mark = excluded.mark,
             candidate_person_id = excluded.candidate_person_id, distance = excluded.distance,
             margin = excluded.margin, created_at = excluded.created_at
           WHERE face_cluster_marks.descriptor_json <> excluded.descriptor_json`
        ).bind(now, payload, modelVersion));
        statements.push(env.GALLERY_DB.prepare(
          `DELETE FROM face_people WHERE EXISTS (
             SELECT 1 FROM json_each(?) AS r JOIN image_face_descriptors f
               ON f.image_id = json_extract(r.value, '$.i') AND f.face_index = json_extract(r.value, '$.x')
             WHERE f.image_id = face_people.image_id AND f.face_index = face_people.face_index
               AND f.descriptor_json <> face_people.descriptor_json)`
        ).bind(payload));
      }
      if (assignments.length) {
        const payload = JSON.stringify(assignments);
        statements.push(env.GALLERY_DB.prepare(
          `INSERT INTO face_people (image_id, face_index, model_version, descriptor_json, person_id, source, assigned_at)
           SELECT f.image_id, f.face_index, f.model_version, f.descriptor_json, json_extract(r.value, '$.p'), 'auto', ?
           FROM json_each(?) AS r JOIN image_face_descriptors f
             ON f.image_id = json_extract(r.value, '$.i') AND f.face_index = json_extract(r.value, '$.x')
             AND f.updated_at = json_extract(r.value, '$.u')
           WHERE f.model_version = ?
             AND EXISTS (SELECT 1 FROM face_persons fp WHERE fp.person_id = json_extract(r.value, '$.p'))
           ON CONFLICT(image_id, face_index) DO UPDATE SET model_version = excluded.model_version,
             descriptor_json = excluded.descriptor_json, person_id = excluded.person_id,
             source = excluded.source, assigned_at = excluded.assigned_at
           WHERE face_people.descriptor_json <> excluded.descriptor_json`
        ).bind(now, payload, modelVersion));
        // רק פרצוף שהשיוך שלו נכתב באמת יוצא מרשימת הבודדים.
        statements.push(env.GALLERY_DB.prepare(
          `DELETE FROM face_cluster_marks WHERE mark <> 'ignored' AND EXISTS (
             SELECT 1 FROM json_each(?) AS r JOIN face_people p
               ON p.image_id = json_extract(r.value, '$.i') AND p.face_index = json_extract(r.value, '$.x')
               AND p.person_id = json_extract(r.value, '$.p')
             WHERE p.image_id = face_cluster_marks.image_id AND p.face_index = face_cluster_marks.face_index)`
        ).bind(payload));
      }
      if (statements.length) {
        await runDatabaseStatements(env, statements);
        if (touched.size) await refreshFacePersons(env, [...touched], modelVersion);
        await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
      }
      await writeFaceSweepMarker(env, startedAt);
    }
    result.remaining = await countUnclusteredFaces(env, modelVersion);
    return result;
  } finally {
    await releaseFaceClusterLock(env, lock);
  }
}

// אחרי אינדוקס: הקיבוץ רץ ברקע (waitUntil) ואינו מעכב את התשובה. בלי ctx —
// למשל בבדיקות — הוא פשוט אינו מופעל, והריצה הבאה תאסוף את הפרצופים.
function scheduleFaceClustering(env, ctx) {
  if (typeof ctx?.waitUntil !== "function") return;
  ctx.waitUntil(runFaceClustering(env).catch(error => {
    console.warn("Face clustering skipped", error?.code || error?.message || error);
  }));
}

async function faceClusterRunRequest(request, env) {
  const actor = await requireFaceIndexWriter(request, env);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env,
    `face-cluster:${actor.uid}`,
    FACE_CLUSTER_RATE_LIMIT,
    FACE_CLUSTER_RATE_WINDOW_MS,
    "בוצעו יותר מדי ריצות קיבוץ. המתן מעט ונסה שוב.",
    "face_cluster_rate_limit"
  );
  const payload = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(FACE_CLUSTER_BATCH_MAX, Math.trunc(Number(payload?.limit) || FACE_CLUSTER_BATCH)));
  return json(request, { success: true, ...(await runFaceClustering(env, { limit })) });
}

// השלמת מיקום פרצופים שאונדקסו לפני שנשמר מיקום: הדפדפן של המנהל מאתר שוב
// את הפרצוף בתמונה ושולח את המיקום בלבד. הטביעה ומועד העדכון אינם משתנים.
async function saveFaceBoxes(request, env) {
  const actor = await requireFaceIndexWriter(request, env);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const entries = Array.isArray(payload?.boxes) ? payload.boxes : [];
  if (!entries.length || entries.length > FACE_BOXES_MAX_PER_REQUEST) {
    throw apiError(`יש לשלוח בין מיקום אחד ל-${FACE_BOXES_MAX_PER_REQUEST} מיקומים בכל בקשה.`, 400, "invalid_face_box");
  }
  await consumeRateLimit(
    env,
    `face-index:${actor.uid}`,
    FACE_INDEX_RATE_LIMIT,
    FACE_INDEX_RATE_WINDOW_MS,
    "בוצעו יותר מדי בקשות אינדוקס פנים. המתן מעט ונסה שוב.",
    "face_index_rate_limit_exceeded"
  );
  const rows = entries.map(entry => {
    const face = faceReference(entry);
    const box = parseFaceBox(entry?.box);
    if (!box) throw apiError("מיקום הפרצוף אינו תקין.", 400, "invalid_face_box");
    return { i: face.imageId, x: face.faceIndex, u: face.updatedAt, b: serializeFaceBox(box) };
  });
  const result = await env.GALLERY_DB.prepare(
    `UPDATE image_face_descriptors SET box_json = json_extract(r.value, '$.b')
     FROM json_each(?) AS r
     WHERE image_face_descriptors.image_id = json_extract(r.value, '$.i')
       AND image_face_descriptors.face_index = json_extract(r.value, '$.x')
       AND image_face_descriptors.updated_at = json_extract(r.value, '$.u')
       AND image_face_descriptors.box_json = ''
     RETURNING image_face_descriptors.image_id`
  ).bind(JSON.stringify(rows)).all();
  const saved = (result.results || []).length;
  if (saved) await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  return json(request, { success: true, saved });
}

// --- ניהול האנשים (מנהלים בלבד) ---

async function faceGroupCounts(env) {
  const persons = await env.GALLERY_DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'suggested' AND hidden = 0 AND face_count >= ? THEN 1 ELSE 0 END), 0) AS suggested,
       COALESCE(SUM(CASE WHEN status = 'approved' AND hidden = 0 AND face_count > 0 THEN 1 ELSE 0 END), 0) AS approved,
       COALESCE(SUM(CASE WHEN hidden = 1 AND face_count > 0 THEN 1 ELSE 0 END), 0) AS hidden
     FROM face_persons WHERE model_version = ?`
  ).bind(FACE_CLUSTER_MIN_SUGGESTED, FACE_MODEL_VERSION).first();
  const marks = await env.GALLERY_DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN m.mark = 'review' THEN 1 ELSE 0 END), 0) AS review,
       COALESCE(SUM(CASE WHEN m.mark = 'seed' THEN 1 ELSE 0 END), 0) AS singles
     FROM face_cluster_marks m ${FACE_VALID_MARK}
     WHERE m.mark IN ('review', 'seed') AND m.model_version = ?`
  ).bind(FACE_MODEL_VERSION).first();
  const singles = Number(marks?.singles) || 0;
  return {
    suggested: Number(persons?.suggested) || 0,
    approved: Number(persons?.approved) || 0,
    hidden: Number(persons?.hidden) || 0,
    review: Number(marks?.review) || 0,
    singles,
    // יש בודדים ואנשים שהשתנו מאז הבדיקה החוזרת האחרונה: פתיחת המסך מריצה
    // קיבוץ גם בלי פרצופים חדשים, כדי שהבודדים ייבדקו שוב.
    recheck: singles > 0 && await hasFacePersonsChangedSince(env, FACE_MODEL_VERSION, await readFaceSweepMarker(env)),
    unclustered: await countUnclusteredFaces(env)
  };
}

// פרטי אנשים לתצוגה, עם הפרצוף הראשי (מיקום וכתובת התמונה). אין כאן מרכז.
async function readFacePersonSummaries(env, rows, { samples = 0 } = {}) {
  const ids = rows.map(row => String(row.personId));
  const covers = new Map();
  const sampleMap = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const coverRows = (await env.GALLERY_DB.prepare(
      `SELECT fp.person_id AS personId, f.image_id AS imageId, f.face_index AS faceIndex,
         f.updated_at AS updatedAt, f.box_json AS boxJson, ${FACE_IMAGE_URL_COLUMNS}
       FROM face_persons fp
       JOIN image_face_descriptors f ON f.image_id = fp.cover_image_id AND f.face_index = fp.cover_face_index
       JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = fp.cover_image_id
       WHERE fp.person_id IN (${placeholders})`
    ).bind(...chunk).all()).results || [];
    for (const row of coverRows) covers.set(String(row.personId), faceView(row));
    if (samples > 0) {
      const sampleRows = (await env.GALLERY_DB.prepare(
        `SELECT personId, imageId, faceIndex, updatedAt, boxJson, thumbUrl, imageUrl FROM (
           SELECT p.person_id AS personId, p.image_id AS imageId, p.face_index AS faceIndex,
             f.updated_at AS updatedAt, f.box_json AS boxJson, ${FACE_IMAGE_URL_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY p.person_id
               ORDER BY (f.box_json <> '') DESC, p.assigned_at DESC, p.image_id, p.face_index) AS rowNumber
           FROM face_people p ${FACE_VALID_ASSIGNMENT}
           WHERE p.person_id IN (${placeholders}))
         WHERE rowNumber <= ? ORDER BY personId, rowNumber`
      ).bind(...chunk, samples).all()).results || [];
      for (const row of sampleRows) {
        const key = String(row.personId);
        if (!sampleMap.has(key)) sampleMap.set(key, []);
        sampleMap.get(key).push(faceView(row));
      }
    }
  }
  return rows.map(row => ({
    personId: String(row.personId),
    name: String(row.name || ""),
    status: row.status === "approved" ? "approved" : "suggested",
    hidden: Number(row.hidden) === 1,
    faceCount: Number(row.faceCount) || 0,
    imageCount: Number(row.imageCount) || 0,
    cover: covers.get(String(row.personId)) || null,
    ...(samples > 0 ? { samples: sampleMap.get(String(row.personId)) || [] } : {})
  }));
}

const FACE_PERSON_COLUMNS = `person_id AS personId, name, status, hidden, face_count AS faceCount,
  image_count AS imageCount, updated_at AS updatedAt`;

async function readFacePersonRow(env, personId) {
  return await env.GALLERY_DB.prepare(
    `SELECT ${FACE_PERSON_COLUMNS} FROM face_persons WHERE person_id = ?`
  ).bind(personId).first();
}

function faceGroupsOffset(url) {
  return Math.max(0, Math.min(1000000, Math.trunc(Number(url.searchParams.get("offset")) || 0)));
}

async function readFaceGroups(env, url) {
  const offset = faceGroupsOffset(url);
  // בפתיחת המסך (העמוד הראשון) מתקנים מונים שהתיישנו — למשל קבוצות ידניות
  // מלפני גרסה 8, או תמונה שנמחקה — כדי שהרשימה תהיה נכונה גם לפני קיבוץ.
  if (offset === 0) await refreshFacePersons(env, null);
  const counts = await faceGroupCounts(env);
  const personParam = url.searchParams.get("person");
  if (personParam) {
    const personId = facePersonId(personParam);
    const row = await readFacePersonRow(env, personId);
    if (!row) throw apiError("האדם לא נמצא. ייתכן שהקבוצה אוחדה או נמחקה.", 404, "person_not_found");
    const [person] = await readFacePersonSummaries(env, [row]);
    const faces = (await env.GALLERY_DB.prepare(
      `SELECT p.image_id AS imageId, p.face_index AS faceIndex, f.updated_at AS updatedAt,
         f.box_json AS boxJson, p.source AS source, ${FACE_IMAGE_URL_COLUMNS}
       FROM face_people p ${FACE_VALID_ASSIGNMENT}
       WHERE p.person_id = ?
       ORDER BY p.assigned_at DESC, p.image_id, p.face_index LIMIT ? OFFSET ?`
    ).bind(personId, FACE_GROUPS_PAGE_SIZE + 1, offset).all()).results || [];
    return {
      success: true,
      view: "person",
      counts,
      person,
      faces: faces.slice(0, FACE_GROUPS_PAGE_SIZE).map(face => ({ ...faceView(face), source: face.source === "auto" ? "auto" : "manual" })),
      offset,
      hasMore: faces.length > FACE_GROUPS_PAGE_SIZE
    };
  }
  const requested = String(url.searchParams.get("view") || "suggested");
  // רשימה קצרה של כל הקבוצות (מזהה, שם ומונה) לבחירת יעד באיחוד ובהעברה.
  if (requested === "options") {
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT person_id AS personId, name, status, hidden, face_count AS faceCount FROM face_persons
       WHERE model_version = ? AND face_count > 0
       ORDER BY status = 'approved' DESC, name, face_count DESC, person_id LIMIT 500`
    ).bind(FACE_MODEL_VERSION).all()).results || [];
    return {
      success: true,
      view: "options",
      counts,
      options: rows.map(row => ({
        personId: String(row.personId),
        name: String(row.name || ""),
        status: row.status === "approved" ? "approved" : "suggested",
        hidden: Number(row.hidden) === 1,
        faceCount: Number(row.faceCount) || 0
      }))
    };
  }
  const view = ["suggested", "approved", "hidden", "review", "singles"].includes(requested) ? requested : "suggested";
  // פרצופים בודדים: עוד לא נמצא להם פרצוף דומה. המנהל יכול לשייך אותם לאדם,
  // לפתוח להם קבוצה חדשה (ולתת לה שם) או להתעלם מהם.
  if (view === "singles") {
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT m.image_id AS imageId, m.face_index AS faceIndex, f.updated_at AS updatedAt, f.box_json AS boxJson,
         ${FACE_IMAGE_URL_COLUMNS}
       FROM face_cluster_marks m ${FACE_VALID_MARK}
       WHERE m.mark = 'seed' AND m.model_version = ?
       ORDER BY f.created_at DESC, m.image_id, m.face_index LIMIT ? OFFSET ?`
    ).bind(FACE_MODEL_VERSION, FACE_GROUPS_PAGE_SIZE + 1, offset).all()).results || [];
    return {
      success: true,
      view,
      counts,
      faces: rows.slice(0, FACE_GROUPS_PAGE_SIZE).map(faceView),
      offset,
      hasMore: rows.length > FACE_GROUPS_PAGE_SIZE
    };
  }
  if (view === "review") {
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT m.image_id AS imageId, m.face_index AS faceIndex, f.updated_at AS updatedAt, f.box_json AS boxJson,
         m.candidate_person_id AS candidateId, m.distance AS distance, ${FACE_IMAGE_URL_COLUMNS}
       FROM face_cluster_marks m ${FACE_VALID_MARK}
       WHERE m.mark = 'review' AND m.model_version = ?
       ORDER BY m.distance, m.image_id, m.face_index LIMIT ? OFFSET ?`
    ).bind(FACE_MODEL_VERSION, FACE_GROUPS_PAGE_SIZE + 1, offset).all()).results || [];
    const page = rows.slice(0, FACE_GROUPS_PAGE_SIZE);
    const candidateIds = [...new Set(page.map(row => String(row.candidateId || "")).filter(Boolean))];
    let candidates = [];
    if (candidateIds.length) {
      const candidateRows = (await env.GALLERY_DB.prepare(
        `SELECT ${FACE_PERSON_COLUMNS} FROM face_persons WHERE person_id IN (${candidateIds.map(() => "?").join(",")})`
      ).bind(...candidateIds).all()).results || [];
      candidates = await readFacePersonSummaries(env, candidateRows);
    }
    const byId = new Map(candidates.map(person => [person.personId, person]));
    return {
      success: true,
      view,
      counts,
      faces: page.map(row => ({
        ...faceView(row),
        distance: Math.round((Number(row.distance) || 0) * 1000) / 1000,
        candidate: byId.get(String(row.candidateId || "")) || null
      })),
      offset,
      hasMore: rows.length > FACE_GROUPS_PAGE_SIZE
    };
  }
  const conditions = {
    suggested: ["status = 'suggested' AND hidden = 0 AND face_count >= ?", [FACE_CLUSTER_MIN_SUGGESTED], "face_count DESC, person_id"],
    approved: ["status = 'approved' AND hidden = 0 AND face_count > 0", [], "name, person_id"],
    hidden: ["hidden = 1 AND face_count > 0", [], "updated_at DESC, person_id"]
  }[view];
  const rows = (await env.GALLERY_DB.prepare(
    `SELECT ${FACE_PERSON_COLUMNS} FROM face_persons
     WHERE model_version = ? AND ${conditions[0]}
     ORDER BY ${conditions[2]} LIMIT ? OFFSET ?`
  ).bind(FACE_MODEL_VERSION, ...conditions[1], FACE_GROUPS_PAGE_SIZE + 1, offset).all()).results || [];
  return {
    success: true,
    view,
    counts,
    persons: await readFacePersonSummaries(env, rows.slice(0, FACE_GROUPS_PAGE_SIZE), { samples: FACE_GROUP_SAMPLE_FACES }),
    offset,
    hasMore: rows.length > FACE_GROUPS_PAGE_SIZE
  };
}

// הפרצוף כפי שהוא עכשיו במסד. בקשה שנשלחה מול גרסה ישנה (אינדוקס מחדש,
// תמונה שנמחקה) נדחית ב-409, כמו באיחוד הידני.
async function readFaceForUpdate(env, value) {
  const face = faceReference(value);
  const row = await env.GALLERY_DB.prepare(
    `SELECT f.image_id AS imageId, f.face_index AS faceIndex, f.descriptor_json AS descriptorJson,
       f.model_version AS modelVersion, p.person_id AS personId, m.mark AS mark, m.candidate_person_id AS candidateId
     FROM image_face_descriptors f
     JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = f.image_id
     ${FACE_PERSON_JOIN}
     LEFT JOIN face_cluster_marks m ON m.image_id = f.image_id AND m.face_index = f.face_index
       AND m.model_version = f.model_version AND m.descriptor_json = f.descriptor_json
     WHERE f.image_id = ? AND f.face_index = ? AND f.updated_at = ? AND f.model_version = ?`
  ).bind(face.imageId, face.faceIndex, face.updatedAt, FACE_MODEL_VERSION).first();
  if (!row) throw apiError("הנתונים השתנו. רענן את הרשימה ונסה שוב.", 409, "stale_faces");
  return row;
}

function assignFaceStatements(env, face, personId, now) {
  return [
    env.GALLERY_DB.prepare(
      `INSERT INTO face_people (image_id, face_index, model_version, descriptor_json, person_id, source, assigned_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?)
       ON CONFLICT(image_id, face_index) DO UPDATE SET model_version = excluded.model_version,
         descriptor_json = excluded.descriptor_json, person_id = excluded.person_id,
         source = 'manual', assigned_at = excluded.assigned_at`
    ).bind(face.imageId, face.faceIndex, face.modelVersion, face.descriptorJson, personId, now),
    env.GALLERY_DB.prepare("DELETE FROM face_cluster_marks WHERE image_id = ? AND face_index = ?").bind(face.imageId, face.faceIndex)
  ];
}

// rejectedId: בבודד שהמנהל ענה עליו "לא — אדם אחר", האדם שנדחה. הבדיקה
// החוזרת של הקיבוץ אינה מצרפת בודד כזה מעצמו.
function markFaceStatements(env, face, mark, now, rejectedId = "") {
  return [
    env.GALLERY_DB.prepare(
      `INSERT INTO face_cluster_marks (image_id, face_index, model_version, descriptor_json, mark, candidate_person_id, distance, margin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT(image_id, face_index) DO UPDATE SET model_version = excluded.model_version,
         descriptor_json = excluded.descriptor_json, mark = excluded.mark, candidate_person_id = excluded.candidate_person_id,
         distance = 0, margin = 0, created_at = excluded.created_at`
    ).bind(face.imageId, face.faceIndex, face.modelVersion, face.descriptorJson, mark, rejectedId, now),
    env.GALLERY_DB.prepare("DELETE FROM face_people WHERE image_id = ? AND face_index = ?").bind(face.imageId, face.faceIndex)
  ];
}

async function requireFacePerson(env, value) {
  const personId = facePersonId(value);
  const row = await readFacePersonRow(env, personId);
  if (!row) throw apiError("האדם לא נמצא. ייתכן שהקבוצה אוחדה או נמחקה. רענן ונסה שוב.", 404, "person_not_found");
  return row;
}

async function mutateFaceGroups(env, payload) {
  const action = String(payload?.action || "");
  const now = Date.now();
  const touched = [];
  switch (action) {
    case "approve":
    case "rename": {
      const person = await requireFacePerson(env, payload.personId);
      const name = facePersonName(payload.name);
      await env.GALLERY_DB.prepare(
        `UPDATE face_persons SET name = ?, status = CASE WHEN ? = 'approve' THEN 'approved' ELSE status END, updated_at = ?
         WHERE person_id = ?`
      ).bind(name, action, now, person.personId).run();
      touched.push(person.personId);
      break;
    }
    case "hide":
    case "unhide": {
      const person = await requireFacePerson(env, payload.personId);
      await env.GALLERY_DB.prepare("UPDATE face_persons SET hidden = ?, updated_at = ? WHERE person_id = ?")
        .bind(action === "hide" ? 1 : 0, now, person.personId).run();
      touched.push(person.personId);
      break;
    }
    case "merge": {
      const target = await requireFacePerson(env, payload.targetId);
      const source = await requireFacePerson(env, payload.sourceId);
      if (target.personId === source.personId) throw apiError("יש לבחור שתי קבוצות שונות.", 400, "invalid_merge");
      await runDatabaseStatements(env, [
        env.GALLERY_DB.prepare("UPDATE face_people SET person_id = ?, source = 'manual', assigned_at = ? WHERE person_id = ?")
          .bind(target.personId, now, source.personId),
        env.GALLERY_DB.prepare("UPDATE face_cluster_marks SET candidate_person_id = ? WHERE candidate_person_id = ?")
          .bind(target.personId, source.personId),
        // התיוגים הידניים עוברים לאדם שנשאר; תמונה שתויגה בשניהם נשארת פעם אחת.
        env.GALLERY_DB.prepare("UPDATE OR IGNORE face_manual_tags SET person_id = ? WHERE person_id = ?")
          .bind(target.personId, source.personId),
        env.GALLERY_DB.prepare("DELETE FROM face_manual_tags WHERE person_id = ?").bind(source.personId)
      ]);
      await adoptFacePersonDetails(env, target.personId, [source.personId], now);
      await env.GALLERY_DB.prepare("DELETE FROM face_persons WHERE person_id = ?").bind(source.personId).run();
      touched.push(target.personId);
      break;
    }
    case "move": {
      const face = await readFaceForUpdate(env, payload.face);
      let targetId;
      if (payload.targetId) {
        targetId = (await requireFacePerson(env, payload.targetId)).personId;
      } else {
        targetId = await newFacePersonId(`manual:${face.imageId}:${face.faceIndex}:${now}`);
        await ensureFacePersonRow(env, targetId, now);
      }
      await runDatabaseStatements(env, assignFaceStatements(env, face, targetId, now));
      touched.push(targetId, face.personId);
      break;
    }
    case "accept": {
      const face = await readFaceForUpdate(env, payload.face);
      const targetId = (await requireFacePerson(env, payload.personId || face.candidateId)).personId;
      await runDatabaseStatements(env, assignFaceStatements(env, face, targetId, now));
      touched.push(targetId, face.personId);
      break;
    }
    case "reject":
    case "remove": {
      // "לא, זה מישהו אחר" — הפרצוף חוזר להיות בודד וממתין לדומים לו;
      // "הסר" — הפרצוף לא יקובץ עוד (למשל, אינו פנים או אינו רלוונטי).
      const face = await readFaceForUpdate(env, payload.face);
      await runDatabaseStatements(env, action === "reject"
        ? markFaceStatements(env, face, "seed", now, String(face.candidateId || face.personId || ""))
        : markFaceStatements(env, face, "ignored", now));
      touched.push(face.personId);
      break;
    }
    case "cover": {
      const person = await requireFacePerson(env, payload.personId);
      const face = await readFaceForUpdate(env, payload.face);
      if (face.personId !== person.personId) throw apiError("הפרצוף אינו שייך לאדם הזה.", 400, "invalid_cover");
      await env.GALLERY_DB.prepare(
        "UPDATE face_persons SET cover_image_id = ?, cover_face_index = ?, updated_at = ? WHERE person_id = ?"
      ).bind(face.imageId, face.faceIndex, now, person.personId).run();
      touched.push(person.personId);
      break;
    }
    default:
      throw apiError("הפעולה המבוקשת אינה מוכרת.", 400, "invalid_action");
  }
  await refreshFacePersons(env, touched.filter(Boolean));
  await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  return { action, personIds: [...new Set(touched.filter(Boolean))] };
}

async function manageFaceGroups(request, env, url) {
  const actor = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env,
    `face-groups:${actor.uid}`,
    FACE_GROUPS_RATE_LIMIT,
    FACE_GROUPS_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.",
    "face_groups_rate_limit"
  );
  if (request.method === "GET") return json(request, await readFaceGroups(env, url));
  const payload = await request.json().catch(() => ({}));
  return json(request, { success: true, ...(await mutateFaceGroups(env, payload)) });
}

export {
  faceModelVersion,
  parseFaceDescriptor,
  serializeFaceDescriptor,
  deserializeFaceDescriptor,
  faceMatchConfidence,
  faceImageIdFromObjectKey,
  deleteFaceIndexForImage,
  hasActiveImageDocument,
  deleteFaceIndexForDeletedMedia,
  requireFaceIndexWriter,
  readFaceIndexStates,
  faceIndexNeedsWork,
  faceIndexSummary,
  runDatabaseStatements,
  saveFaceIndexBatch,
  faceIndexPendingImages,
  faceIndexSummaryRequest,
  resetFaceIndex,
  filterExistingImageIds,
  FACE_PERSON_JOIN,
  FACE_VALID_ASSIGNMENT,
  FACE_VALID_MARK,
  FACE_UNCLUSTERED_FROM,
  FACE_IMAGE_URL_COLUMNS,
  manageFacePeople,
  runFaceSearch,
  faceSearchLimit,
  consumeFaceSearchQuota,
  faceSearch,
  facePersonId,
  facePersonName,
  faceReference,
  parseFaceBox,
  serializeFaceBox,
  readFaceBox,
  httpsUrl,
  faceView,
  faceDistance,
  faceWithin,
  meanDescriptor,
  newFacePersonId,
  ensureFacePersonRow,
  adoptFacePersonDetails,
  markFacesByKey,
  clearFaceMarksByKey,
  refreshFacePersons,
  countUnclusteredFaces,
  acquireFaceClusterLock,
  releaseFaceClusterLock,
  loadClusterPersons,
  FACE_CLUSTER_SWEEP_KEY,
  readFaceSweepMarker,
  writeFaceSweepMarker,
  hasFacePersonsChangedSince,
  loadClusterSeeds,
  runFaceClustering,
  scheduleFaceClustering,
  faceClusterRunRequest,
  saveFaceBoxes,
  faceGroupCounts,
  readFacePersonSummaries,
  FACE_PERSON_COLUMNS,
  readFacePersonRow,
  faceGroupsOffset,
  readFaceGroups,
  readFaceForUpdate,
  assignFaceStatements,
  markFaceStatements,
  requireFacePerson,
  mutateFaceGroups,
  manageFaceGroups
};
