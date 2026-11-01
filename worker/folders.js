// סידור: תיקיות, סדר ידני ועריכת מדיה.
import {
  dataActor
} from "./auth.js";
import {
  assertDataPermission,
  bumpDataVersion
} from "./data.js";
import {
  runDatabaseStatements
} from "./faces.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  json
} from "./util.js";

// --- תיקיות מקוננות, תמונת שער, סדר ידני ועריכה לא הורסת ---
// כל השדות האלה נשמרים בתוך מסמך ה-JSON של התיקייה או התמונה, בלי עמודה או
// טבלה חדשה ובלי שינוי סכימה. שדה שחסר בכתיבה נשמר מהרשומה הקיימת — כך דפדפן
// ישן שכותב רשומה שלמה (שינוי שם, סנכרון Drive, העברת תמונה) אינו מוחק את
// ההורה, את השער, את הסדר או את העריכה שמנהל קבע. null מפורש מנקה את השדה.

// עומק מרבי של עץ התיקיות: שנה › אירוע › חלק באירוע.
const FOLDER_MAX_DEPTH = 3;
// מזהים של תצוגות, לא תיקיות: אסור שיהיו הורה, ואסור לתת להם הורה.
const RESERVED_FOLDER_IDS = new Set(["all", "favorites"]);
const RECORD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
// דירוג "סדר ידני": מספר דליל. התקרה מרחיקה ערכים שאינם מספר אמיתי ב-JSON.
const ORDER_RANK_LIMIT = 1e15;
// כמה רשומות לכל היותר בכתיבת סדר אחת (POST /order). כולן ב-batch אחד של D1.
const ORDER_BATCH_MAX = 500;
const ORDER_COLLECTIONS = new Set(["images", "folders"]);
// עריכה לא הורסת של תמונה: סיבוב ברבעים וחיתוך מנורמל (0..1) של התמונה
// שאחרי הסיבוב. המקור ב-R2 לעולם אינו משתנה.
const MEDIA_EDIT_ROTATIONS = new Set([0, 90, 180, 270]);
const MEDIA_EDIT_MIN_CROP = 0.02;
// מזהה העריכה (rev): התצוגות המקדימות שנוצרו ממנה נושאות אותו, וכך הדפדפן יודע
// אם הן כבר ערוכות או שעליו להחיל את העריכה בעצמו.
const MEDIA_EDIT_REVISION_PATTERN = /^[a-z0-9]{1,24}$/;

function hasOwnField(object, field) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, field) && object[field] !== undefined;
}

function isAdminActor(actor) {
  return Boolean(actor?.status === "approved" || actor?.initialAdmin) && ["admin", "super_admin"].includes(actor?.role);
}

// מזהה רשומה שהגיע מהלקוח: חייב להיות תקין כמות שהוא. מזהה ש"ניקוי" היה משנה
// (רווח, תו אחר) נדחה, כדי שלא יצביע בשקט על רשומה אחרת.
function strictRecordId(value, label, code) {
  const id = typeof value === "string" ? value : "";
  if (!RECORD_ID_PATTERN.test(id)) throw apiError(`${label} אינו תקין.`, 400, code);
  return id;
}

export function normalizeOrderRank(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > ORDER_RANK_LIMIT) {
    throw apiError("מיקום בסדר הידני חייב להיות מספר.", 400, "invalid_order");
  }
  return value;
}

function roundEditNumber(value) {
  return Math.round(value * 1e6) / 1e6;
}

// מחזיר את העריכה המנורמלת, או null כשאין עריכה (או שהיא זהות: בלי סיבוב ובלי חיתוך).
export function normalizeMediaEdit(value) {
  if (value === null) return null;
  const invalid = () => apiError("נתוני העריכה של התמונה אינם תקינים.", 400, "invalid_media_edit");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const rotate = value.rotate === undefined ? 0 : value.rotate;
  if (typeof rotate !== "number" || !MEDIA_EDIT_ROTATIONS.has(rotate)) throw invalid();
  let crop = null;
  if (value.crop !== undefined && value.crop !== null) {
    const raw = value.crop;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const parts = {};
    for (const key of ["x", "y", "w", "h"]) {
      const number = raw[key];
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) throw invalid();
      parts[key] = roundEditNumber(number);
    }
    if (parts.w < MEDIA_EDIT_MIN_CROP || parts.h < MEDIA_EDIT_MIN_CROP) throw invalid();
    if (parts.x + parts.w > 1 + 1e-6 || parts.y + parts.h > 1 + 1e-6) throw invalid();
    // חיתוך שמכסה את כל התמונה אינו חיתוך.
    const full = parts.x <= 1e-6 && parts.y <= 1e-6 && parts.w >= 1 - 1e-6 && parts.h >= 1 - 1e-6;
    crop = full ? null : parts;
  }
  if (typeof value.rev !== "string" || !MEDIA_EDIT_REVISION_PATTERN.test(value.rev)) throw invalid();
  if (rotate === 0 && !crop) return null;
  return { rotate, crop, rev: value.rev };
}

// שדה שהמבקש אינו רשאי לשנות, או שלא נשלח, נלקח מהרשומה הקיימת; אחרת
// נבדק ומנורמל, ו-null מוחק אותו מהרשומה.
function applyGuardedField(next, previous, field, canEdit, normalize) {
  if (!canEdit || !hasOwnField(next, field)) {
    if (previous?.[field] === undefined) delete next[field];
    else next[field] = previous[field];
    return;
  }
  const value = normalize(next[field]);
  if (value === null) delete next[field];
  else next[field] = value;
}

function isVideoLikeData(data) {
  return data?.mediaType === "video" || /^video\//i.test(String(data?.mimeType || ""));
}

// order ו-edit של תמונה: רק מנהל קובע אותם. מעלה שכותב את הרשומה שלו (או
// רשומה ממתינה) אינו יכול להכניס אותם, ועותק ישן בלי השדות אינו מוחק אותם.
export function normalizeImageArrangeFields(data, existing = {}, { canEdit = false, existed = false } = {}) {
  const next = { ...data };
  const previous = existing && typeof existing === "object" ? existing : {};
  applyGuardedField(next, previous, "order", canEdit, normalizeOrderRank);
  // הדירוג שייך לסדר של התיקייה שבה נקבע. תמונה שעברה תיקייה עם אותו דירוג
  // (הדפדפן שלח את הרשומה כפי שהייתה) מצטרפת לסוף התיקייה החדשה.
  if (existed && next.order !== undefined && next.order === previous.order &&
      String(next.folderId ?? "") !== String(previous.folderId ?? "")) {
    delete next.order;
  }
  applyGuardedField(next, previous, "edit", canEdit, normalizeMediaEdit);
  if (next.edit && canEdit && hasOwnField(data, "edit") && isVideoLikeData(next)) {
    throw apiError("עריכת סיבוב וחיתוך זמינה לתמונות בלבד.", 400, "media_edit_unsupported");
  }
  return next;
}

// מפת התיקיות (מזהה → הורה) מתוך D1. האוסף קטן — עשרות או מאות תיקיות.
async function readFolderParents(env) {
  const { results } = await env.GALLERY_DB.prepare(
    `SELECT document_id AS id, json_extract(data_json, '$.parentId') AS parentId
     FROM gallery_documents WHERE collection_name = 'folders'`
  ).all();
  const parents = new Map();
  for (const row of results || []) {
    parents.set(String(row.id), row.parentId === null || row.parentId === undefined ? "" : String(row.parentId));
  }
  return parents;
}

// בודק שהתיקייה folderId יכולה לשבת תחת parentId: ההורה קיים, אין מעגל,
// והעץ — כולל תת־התיקיות שכבר בתוכה — אינו עמוק מ-FOLDER_MAX_DEPTH.
export function checkFolderPlacement(parents, folderId, parentId) {
  if (!parents.has(parentId)) {
    throw apiError("תיקיית האב אינה קיימת.", 400, "folder_parent_not_found");
  }
  // העומק של ההורה (תיקייה עליונה = 1). הליכה במעלה העץ עם רשימת ביקורים,
  // כדי שגם נתונים פגומים (מעגל ישן) לא יכניסו את ה-Worker ללולאה.
  let depth = 0;
  let current = parentId;
  const seen = new Set();
  while (current) {
    if (current === folderId) {
      throw apiError("אי אפשר להעביר תיקייה אל תוך עצמה או אל תוך תת־תיקייה שלה.", 400, "folder_cycle");
    }
    if (seen.has(current)) throw apiError("מבנה התיקיות פגום (מעגל). פנה למנהל.", 409, "folder_tree_corrupt");
    if (!parents.has(current)) break;
    seen.add(current);
    depth += 1;
    current = parents.get(current) || "";
  }
  // הגובה של התיקייה עצמה: היא ועוד השכבה העמוקה ביותר שמתחתיה.
  const children = new Map();
  for (const [id, parent] of parents) {
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(id);
  }
  let height = 0;
  let layer = [folderId];
  const visited = new Set();
  while (layer.length && height <= FOLDER_MAX_DEPTH) {
    const nextLayer = [];
    for (const id of layer) {
      if (visited.has(id)) continue;
      visited.add(id);
      nextLayer.push(...(children.get(id) || []));
    }
    height += 1;
    layer = nextLayer;
  }
  if (depth + height > FOLDER_MAX_DEPTH) {
    throw apiError(`אפשר לקנן תיקיות עד ${FOLDER_MAX_DEPTH} רמות בלבד.`, 400, "folder_too_deep");
  }
}

// תמונת שער קיימת: באוסף התמונות, או בסל המחזור — כדי ששחזור תיקייה עם
// התמונות שלה (התיקייה נכתבת לפני התמונות) לא ייכשל.
async function coverImageExists(env, imageId) {
  const active = await env.GALLERY_DB.prepare(
    "SELECT 1 AS found FROM gallery_documents WHERE collection_name = 'images' AND document_id = ?"
  ).bind(imageId).first();
  if (active) return true;
  const trashed = await env.GALLERY_DB.prepare(
    `SELECT 1 AS found FROM gallery_documents
     WHERE collection_name = 'trashItems'
       AND json_extract(data_json, '$.originalCollection') = 'images'
       AND json_extract(data_json, '$.originalId') = ?
     LIMIT 1`
  ).bind(imageId).first();
  return Boolean(trashed);
}

// השדות החדשים של תיקייה. נבדקים רק כשהם משתנים, כך שכתיבה רגילה (שם, תיאור)
// אינה עולה בשאילתה נוספת ואינה נכשלת בגלל מצב ישן.
export async function normalizeFolderFields(env, documentId, data, existing = {}) {
  const next = { ...data };
  const previous = existing && typeof existing === "object" ? existing : {};

  if (!hasOwnField(next, "parentId")) {
    if (previous.parentId === undefined) delete next.parentId;
    else next.parentId = previous.parentId;
  } else if (next.parentId === null || next.parentId === "") {
    delete next.parentId;
  } else {
    const parentId = strictRecordId(next.parentId, "תיקיית האב", "invalid_folder_parent");
    if (parentId === documentId) {
      throw apiError("תיקייה אינה יכולה להיות תת־תיקייה של עצמה.", 400, "folder_cycle");
    }
    if (RESERVED_FOLDER_IDS.has(parentId) || RESERVED_FOLDER_IDS.has(documentId)) {
      throw apiError("התצוגה הזו אינה יכולה להשתתף במבנה התיקיות.", 400, "invalid_folder_parent");
    }
    if (parentId !== previous.parentId) checkFolderPlacement(await readFolderParents(env), documentId, parentId);
    next.parentId = parentId;
  }

  if (!hasOwnField(next, "coverImageId")) {
    if (previous.coverImageId === undefined) delete next.coverImageId;
    else next.coverImageId = previous.coverImageId;
  } else if (next.coverImageId === null || next.coverImageId === "") {
    delete next.coverImageId;
  } else {
    const coverImageId = strictRecordId(next.coverImageId, "תמונת השער", "invalid_cover_image");
    if (coverImageId !== previous.coverImageId && !(await coverImageExists(env, coverImageId))) {
      throw apiError("תמונת השער לא נמצאה בגלריה.", 400, "cover_image_not_found");
    }
    next.coverImageId = coverImageId;
  }

  applyGuardedField(next, previous, "order", true, normalizeOrderRank);

  if (!hasOwnField(next, "manualOrder")) {
    if (previous.manualOrder === undefined) delete next.manualOrder;
    else next.manualOrder = previous.manualOrder;
  } else if (next.manualOrder === null || next.manualOrder === false) {
    delete next.manualOrder;
  } else if (next.manualOrder !== true) {
    throw apiError("הגדרת הסדר הידני אינה תקינה.", 400, "invalid_manual_order");
  }
  return next;
}

// POST /order — כתיבת הסדר הידני של כמה תמונות או תיקיות יחד. רק הרשומות
// שהדירוג שלהן השתנה נשלחות, וכולן נכתבות ב-batch אחד של D1 (טרנזקציה): או
// שכל הסדר נשמר, או ששום דבר אינו משתנה. העדכון נוגע רק בשדה order שבתוך
// ה-JSON (json_set), ולכן אינו דורס שינוי מקביל בשדה אחר של אותה רשומה.
async function saveManualOrder(request, env) {
  await ensureDatabaseSchema(env);
  const actor = await dataActor(request, env);
  const payload = await request.json().catch(() => null);
  const collectionName = typeof payload?.collection === "string" ? payload.collection : "";
  if (!ORDER_COLLECTIONS.has(collectionName)) {
    throw apiError("אפשר לסדר רק תמונות או תיקיות.", 400, "invalid_order_collection");
  }
  assertDataPermission(actor, collectionName, "PUT");
  if (!isAdminActor(actor)) throw apiError("רק מנהל רשאי לשנות את הסדר הידני.", 403, "permission_denied");
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items || !items.length) throw apiError("לא נשלחו פריטים לסידור.", 400, "order_items_missing");
  if (items.length > ORDER_BATCH_MAX) {
    throw apiError(`אפשר לסדר עד ${ORDER_BATCH_MAX} פריטים בבקשה אחת.`, 400, "too_many_order_items");
  }
  const updates = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw apiError("פריט בסדר הידני אינו תקין.", 400, "invalid_order");
    }
    const id = strictRecordId(item.id, "מזהה הפריט", "invalid_order_id");
    if (collectionName === "folders" && RESERVED_FOLDER_IDS.has(id)) {
      throw apiError("התצוגה הזו אינה תיקייה שאפשר לסדר.", 400, "invalid_order_id");
    }
    if (updates.has(id)) throw apiError("פריט הופיע פעמיים בסדר.", 400, "duplicate_order_id");
    if (!Object.prototype.hasOwnProperty.call(item, "order")) throw apiError("חסר מיקום לפריט.", 400, "invalid_order");
    updates.set(id, normalizeOrderRank(item.order));
  }
  // כל המזהים חייבים להיות קיימים לפני שנכתב דבר.
  const ids = [...updates.keys()];
  const found = new Set();
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    const { results } = await env.GALLERY_DB.prepare(
      `SELECT document_id FROM gallery_documents WHERE collection_name = ? AND document_id IN (${chunk.map(() => "?").join(", ")})`
    ).bind(collectionName, ...chunk).all();
    for (const row of results || []) found.add(String(row.document_id));
  }
  if (ids.some(id => !found.has(id))) {
    throw apiError("חלק מהפריטים כבר אינם קיימים. רענן ונסה שוב.", 409, "order_items_not_found");
  }
  const now = Date.now();
  const statements = [...updates].map(([id, order]) => (order === null
    ? env.GALLERY_DB.prepare(
      `UPDATE gallery_documents SET data_json = json_remove(data_json, '$.order'), updated_at = MAX(updated_at + 1, ?)
       WHERE collection_name = ? AND document_id = ?`
    ).bind(now, collectionName, id)
    : env.GALLERY_DB.prepare(
      `UPDATE gallery_documents SET data_json = json_set(data_json, '$.order', ?), updated_at = MAX(updated_at + 1, ?)
       WHERE collection_name = ? AND document_id = ?`
    ).bind(order, now, collectionName, id)));
  await runDatabaseStatements(env, statements);
  await bumpDataVersion(env, collectionName);
  return json(request, { success: true, collection: collectionName, updated: updates.size });
}

export {
  FOLDER_MAX_DEPTH,
  RESERVED_FOLDER_IDS,
  RECORD_ID_PATTERN,
  ORDER_RANK_LIMIT,
  ORDER_BATCH_MAX,
  ORDER_COLLECTIONS,
  MEDIA_EDIT_ROTATIONS,
  MEDIA_EDIT_MIN_CROP,
  MEDIA_EDIT_REVISION_PATTERN,
  hasOwnField,
  isAdminActor,
  strictRecordId,
  roundEditNumber,
  applyGuardedField,
  isVideoLikeData,
  readFolderParents,
  coverImageExists,
  saveManualOrder
};
