// תחזוקה: גיבויי D1, ניקוי סל המחזור, התראות וקישורים שבורים.
import {
  requireUser
} from "./auth.js";
import {
  backgroundActors,
  saveBackgroundDocument
} from "./background.js";
import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_DRIVE_SITE_URL,
  INVITE_ENDED_AT_SQL,
  INVITE_RETENTION_DAYS,
  MAINTENANCE_DAY_MS,
  MEDIA_VARIANT_NAMES,
  UPLOAD_REJECTION_RETENTION_DAYS
} from "./config.js";
import {
  bumpDataVersions
} from "./data.js";
import {
  deleteFaceIndexForImage,
  faceImageIdFromObjectKey,
  runDatabaseStatements
} from "./faces.js";
import {
  deleteMediaVariantsForImage,
  deleteStreamVideoForDeletedMedia,
  readGalleryDocumentRow,
  validateObjectKey
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  storageAlertState
} from "./stats.js";
import {
  apiError,
  consumeRateLimit,
  corsHeaders,
  json,
  parseDocumentData,
  workerEnvironment
} from "./util.js";

// --- תחזוקה יומית: גיבוי D1, ניקוי סל המחזור, התראה למנהלים וקישורים שבורים ---
// התהליך שמפעיל את כל אלה הוא scripts/maintenance.mjs, באותה ריצה של תהליך
// הרקע ב-GitHub Actions ובאותה הרשאת OIDC שלו — אין כאן סוד קבוע חדש. מנהל־על
// רואה את התוצאות בלוח הניהול. שום דבר כאן אינו מוחק רשומה פעילה, ואינו מוחק
// קובץ שמסמך כלשהו עדיין מזכיר; בדיקת הקישורים השבורים מדווחת בלבד.

// הגיבויים יושבים בקידומת משלהם. נתיבי המדיה אינם מגישים אותה לעולם (ראו
// assertPublicMediaPath), והיא נקראת רק דרך /maintenance/backups של מנהל־על.
const D1_BACKUP_PREFIX = "backups/d1/";
const D1_BACKUP_KEY_PATTERN = /^backups\/d1\/(\d{4}-\d{2}-\d{2})\.json(\.gz)?$/;
const D1_BACKUP_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const D1_BACKUP_RETENTION_DAYS = 30;
// גודל העמוד מסתגל: שורות גדולות (מסמכי צ'אט) מקטינות אותו כדי שתשובה אחת של
// D1 לא תגדל מדי בזיכרון, ושורות קטנות (טביעות פנים) מגדילות אותו כדי שגיבוי
// של טבלה ארוכה לא יגיע לתקרת השאילתות של בקשה אחת.
const D1_BACKUP_PAGE_ROWS = 500;
const D1_BACKUP_PAGE_ROWS_MIN = 50;
const D1_BACKUP_PAGE_ROWS_MAX = 2000;
const D1_BACKUP_PAGE_TARGET_CHARS = 2 * 1024 * 1024;
const D1_BACKUP_FORMAT = "simchas-gallery-d1-backup";
const D1_BACKUP_FLUSH_CHARS = 256 * 1024;
// מפתח החתימה של ההתחברות אינו יוצא לקובץ שמנהל מוריד למחשב — מי שמחזיק בו
// יכול לזייף התחברות לכל חשבון — ומוני הקצב הם נתון חולף. שחזור בלי המפתח
// רק מנתק את המשתמשים פעם אחת (ה-Worker מייצר מפתח חדש).
const D1_BACKUP_EXCLUDED_TABLES = new Set(["auth_secrets", "request_rate_limits"]);
const D1_BACKUP_DOWNLOAD_RATE_LIMIT = 30;
const D1_BACKUP_DOWNLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
// סל המחזור: פריט שנמחק נשמר 30 יום, ואחר כך נמחק לצמיתות בריצה היומית.
const TRASH_RETENTION_DAYS = 30;
const TRASH_PURGE_MAX_GROUPS = 25;
// תקרת מסמכים לריצה: תיקייה עם מאות תמונות נמחקת בכמה ריצות (קודם התמונות,
// והתיקייה עצמה רק כשלא נשאר בה דבר), כדי שאף בקשה לא תגיע לתקרות של Worker.
const TRASH_PURGE_MAX_ITEMS = 60;
// התראה למנהלי־העל: לכל היותר אחת בשש שעות, כשבדיקת /health נכשלה או
// כשהשגיאות בשעה האחרונה עברו את הסף.
const MAINTENANCE_ALERT_DOC_ID = "maintenanceAlert";
const MAINTENANCE_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAINTENANCE_ALERT_WINDOW_MS = 60 * 60 * 1000;
const MAINTENANCE_ALERT_ERROR_OCCURRENCES = 50;
const MAINTENANCE_ALERT_NEW_ERROR_KINDS = 10;
const MAINTENANCE_ALERT_MAX_RECIPIENTS = 10;
// קישורים שבורים: צעד מוגבל בכל קריאה, שממשיך מהסמן שנשמר.
const BROKEN_LINKS_DOC_ID = "maintenanceBrokenLinks";
// עד 8 מפתחות לרשומה (מקור, ממוזערת, 3 תצוגות ועותקי AVIF) — עד 400 בדיקות head בצעד.
const BROKEN_LINKS_RECORDS_PER_CALL = 50;
const BROKEN_LINKS_OBJECTS_PER_CALL = 500;
const BROKEN_LINKS_LIST_MAX = 300;
const BROKEN_LINKS_RESCAN_MS = MAINTENANCE_DAY_MS;
// קובץ שעלה ביממה האחרונה עדיין יכול להיות באמצע העלאה, לפני שהרשומה נכתבה.
const BROKEN_LINKS_OBJECT_GRACE_MS = MAINTENANCE_DAY_MS;
const BROKEN_LINKS_PREFIXES = ["approved/", "pending/", "variants/"];
// 20 מפתחות × 4 שדות = 80 פרמטרים, מתחת לתקרת 100 של D1 לשאילתה.
const BROKEN_LINKS_KEY_BATCH = 20;
const BROKEN_LINKS_ID_BATCH = 45;

function maintenanceDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function requireMaintenanceRunner(request) {
  if (!backgroundActors.has(request)) {
    throw apiError("פעולה זו מיועדת לתהליך התחזוקה.", 403, "background_scope_denied");
  }
}

// מנהל־על אנושי בלבד: הרשאת תהליך הרקע אינה פותחת את הגיבויים או את הדוח.
async function requireMaintenanceViewer(request, env) {
  if (backgroundActors.has(request)) {
    throw apiError("פעולה זו אינה מורשית לתהליך הרקע.", 403, "background_scope_denied");
  }
  return requireUser(request, env, ["super_admin"]);
}

// נתיבי המדיה מגישים רק approved/, pending/, chat/ ו-variants/ (validateObjectKey).
// הבדיקה המפורשת כאן היא חגורה נוספת: גם אם התבנית תורחב פעם, גיבוי או קובץ
// פרטי לא ייצאו דרך /media.
function assertPublicMediaPath(pathname) {
  let key = String(pathname || "").replace(/^\/media\//, "");
  for (let pass = 0; pass < 4; pass += 1) {
    let decoded;
    try { decoded = decodeURIComponent(key); } catch { break; }
    if (decoded === key) break;
    key = decoded;
  }
  if (/^[\s/\\.]*(backups|private|system)(\/|\\|$)/i.test(key)) {
    throw apiError("קובץ המדיה לא נמצא.", 404, "not_found");
  }
}

// --- גיבוי D1 ---

async function listD1Backups(env) {
  const backups = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const listed = await env.GALLERY_BUCKET.list({ prefix: D1_BACKUP_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const object of listed?.objects || []) {
      const match = D1_BACKUP_KEY_PATTERN.exec(String(object.key || ""));
      if (!match) continue;
      backups.push({
        day: match[1],
        key: object.key,
        size: Number(object.size) || 0,
        compressed: Boolean(match[2]),
        uploadedAt: object.uploaded ? new Date(object.uploaded).getTime() || 0 : 0
      });
    }
    if (!listed?.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }
  return backups.sort((left, right) => right.day.localeCompare(left.day) || Number(right.compressed) - Number(left.compressed));
}

async function findD1BackupForDay(env, day) {
  for (const key of [`${D1_BACKUP_PREFIX}${day}.json.gz`, `${D1_BACKUP_PREFIX}${day}.json`]) {
    const head = await env.GALLERY_BUCKET.head(key);
    if (head) return { day, key, size: Number(head.size) || 0, compressed: key.endsWith(".gz") };
  }
  return null;
}

function backupIdentifier(name) {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(name || ""));
}

// ערכי D1 הם מספר, טקסט, null או BLOB. BLOB נשמר כ-base64 עם סימון, כדי
// שהקובץ יישאר JSON תקין ושהשחזור יידע להחזיר אותו לבתים.
function backupCell(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let text = "";
    for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { $base64: btoa(text) };
  }
  if (typeof value === "bigint") return Number(value);
  return value === undefined ? null : value;
}

// טבלאות הפנים של SQLite וטבלאות המערכת של D1 (_cf_*, שהגישה אליהן חסומה) אינן בגיבוי.
// הייצוא כותב טקסט JSON בחלקים: כל טבלה בעמודים של D1_BACKUP_PAGE_ROWS
// שורות לפי rowid, כך שאף שאילתה אינה מחזירה טבלה שלמה ואין צורך להחזיק את
// כל ה-JSON בזיכרון — רק את הפלט הדחוס. רשימת הטבלאות נקראת מ-sqlite_master,
// ולכן טבלה שתתווסף בגרסת סכימה עתידית תיכנס לגיבוי בלי שינוי כאן.
// הייצוא אינו טרנזקציה אחת: שורה שנכתבה באמצע הייצוא יכולה להופיע או לא.
async function exportD1Database(env, write) {
  const master = await env.GALLERY_DB.prepare(
    `SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master
     WHERE type IN ('table', 'index') AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_'
     ORDER BY type DESC, name`
  ).all();
  const entries = master.results || [];
  const tables = [];
  const skipped = [];
  let totalRows = 0;
  await write(`{"format":${JSON.stringify(D1_BACKUP_FORMAT)},"version":1,"createdAt":${JSON.stringify(new Date().toISOString())},` +
    `"schemaVersion":${DATABASE_SCHEMA_VERSION},"environment":${JSON.stringify(workerEnvironment(env))},` +
    `"excludedTables":${JSON.stringify([...D1_BACKUP_EXCLUDED_TABLES])},"tables":[`);
  for (const entry of entries.filter(item => item.type === "table")) {
    const name = String(entry.name);
    if (D1_BACKUP_EXCLUDED_TABLES.has(name)) continue;
    if (!backupIdentifier(name)) { skipped.push(name); continue; }
    const info = await env.GALLERY_DB.prepare(`PRAGMA table_info("${name}")`).all();
    const columns = (info.results || []).map(column => String(column.name));
    if (!columns.length || !columns.every(backupIdentifier)) { skipped.push(name); continue; }
    await write(`${tables.length ? "," : ""}{"name":${JSON.stringify(name)},"sql":${JSON.stringify(String(entry.sql || ""))},"columns":${JSON.stringify(columns)},"rows":[`);
    const select = `SELECT rowid AS "__backup_rowid", ${columns.map(column => `"${column}"`).join(", ")} FROM "${name}" WHERE rowid > ? ORDER BY rowid LIMIT ?`;
    let lastRowId = Number.MIN_SAFE_INTEGER;
    let count = 0;
    let pageRows = D1_BACKUP_PAGE_ROWS;
    for (;;) {
      const page = await env.GALLERY_DB.prepare(select).bind(lastRowId, pageRows).all();
      const rows = page.results || [];
      if (!rows.length) break;
      const text = rows.map(row => JSON.stringify(columns.map(column => backupCell(row[column])))).join(",");
      await write(`${count ? "," : ""}${text}`);
      count += rows.length;
      lastRowId = Number(rows.at(-1).__backup_rowid);
      if (rows.length < pageRows || !Number.isFinite(lastRowId)) break;
      if (text.length > D1_BACKUP_PAGE_TARGET_CHARS) pageRows = Math.max(D1_BACKUP_PAGE_ROWS_MIN, Math.floor(pageRows / 2));
      else if (text.length < D1_BACKUP_PAGE_TARGET_CHARS / 4) pageRows = Math.min(D1_BACKUP_PAGE_ROWS_MAX, pageRows * 2);
    }
    await write(`],"rowCount":${count}}`);
    tables.push({ name, rows: count });
    totalRows += count;
  }
  const indexes = entries
    .filter(item => item.type === "index" && item.sql && !D1_BACKUP_EXCLUDED_TABLES.has(String(item.tableName)))
    .map(item => ({ name: String(item.name), table: String(item.tableName), sql: String(item.sql) }));
  await write(`],"indexes":${JSON.stringify(indexes)},"skippedTables":${JSON.stringify(skipped)}}`);
  return { tables, totalRows, skipped };
}

// דחיסה ב-CompressionStream כשהיא קיימת (ב-Workers היא תמיד קיימת); בלעדיה
// הגיבוי נשמר כ-JSON רגיל, עם הסיומת המתאימה.
async function writeD1Backup(env, day) {
  const encoder = new TextEncoder();
  const compression = typeof CompressionStream === "function" ? new CompressionStream("gzip") : null;
  const writer = compression ? compression.writable.getWriter() : null;
  const compressed = compression ? new Response(compression.readable).arrayBuffer() : null;
  compressed?.catch(() => {});
  const plainChunks = [];
  let pending = "";
  const flush = async () => {
    if (!pending) return;
    const bytes = encoder.encode(pending);
    pending = "";
    if (writer) await writer.write(bytes);
    else plainChunks.push(bytes);
  };
  const write = async text => {
    pending += text;
    if (pending.length >= D1_BACKUP_FLUSH_CHARS) await flush();
  };
  let summary;
  try {
    summary = await exportD1Database(env, write);
    await flush();
    if (writer) await writer.close();
  } catch (error) {
    await writer?.abort(error).catch(() => {});
    throw error;
  }
  let body;
  if (compressed) {
    body = new Uint8Array(await compressed);
  } else {
    body = new Uint8Array(plainChunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of plainChunks) { body.set(chunk, offset); offset += chunk.length; }
  }
  const key = `${D1_BACKUP_PREFIX}${day}.json${compression ? ".gz" : ""}`;
  await env.GALLERY_BUCKET.put(key, body, {
    httpMetadata: { contentType: compression ? "application/gzip" : "application/json" },
    customMetadata: {
      kind: "d1-backup",
      day,
      tables: String(summary.tables.length),
      rows: String(summary.totalRows),
      schemaVersion: String(DATABASE_SCHEMA_VERSION)
    }
  });
  return { key, size: body.byteLength, compressed: Boolean(compression), ...summary };
}

// רק קבצים בתבנית המדויקת של הגיבוי, ורק כשקיים גיבוי חדש יותר מהסף: גם
// שעון שגוי לעולם אינו משאיר את הדלי בלי אף גיבוי.
async function pruneD1Backups(env, now) {
  const cutoffDay = maintenanceDay(now - D1_BACKUP_RETENTION_DAYS * MAINTENANCE_DAY_MS);
  const backups = await listD1Backups(env);
  if (!backups.some(backup => backup.day > cutoffDay)) return [];
  const expired = backups.filter(backup => backup.day <= cutoffDay);
  for (const backup of expired) await env.GALLERY_BUCKET.delete(backup.key);
  return [...new Set(expired.map(backup => backup.day))];
}

// POST /maintenance/backup — גיבוי אחד ליום (UTC). קריאה נוספת באותו יום רק
// בודקת שהקובץ קיים. אין כתיבה ל-D1, ולכן הגיבוי רץ גם כשמכסת הכתיבה חסומה.
async function maintenanceBackup(request, env) {
  if (!backgroundActors.has(request)) await requireUser(request, env, ["super_admin"]);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const day = maintenanceDay(now);
  const existing = await findD1BackupForDay(env, day);
  if (existing) {
    return json(request, { success: true, created: false, day, size: existing.size, compressed: existing.compressed, pruned: [] });
  }
  const result = await writeD1Backup(env, day);
  const pruned = await pruneD1Backups(env, now);
  return json(request, {
    success: true, created: true, day, size: result.size, compressed: result.compressed,
    tables: result.tables.length, rows: result.totalRows, skippedTables: result.skipped, pruned
  });
}

// GET /maintenance/backups — הרשימה למסך "גיבוי ושחזור" (מנהל־על).
async function listMaintenanceBackups(request, env) {
  await requireMaintenanceViewer(request, env);
  const backups = (await listD1Backups(env)).map(({ day, size, compressed, uploadedAt }) => ({ day, size, compressed, uploadedAt }));
  const response = json(request, { success: true, retentionDays: D1_BACKUP_RETENTION_DAYS, backups });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// GET /maintenance/backups/<YYYY-MM-DD> — הורדת גיבוי אחד (מנהל־על).
async function downloadMaintenanceBackup(request, env, url) {
  const user = await requireMaintenanceViewer(request, env);
  const day = decodeURIComponent(url.pathname.slice("/maintenance/backups/".length));
  if (!D1_BACKUP_DAY_PATTERN.test(day)) throw apiError("תאריך הגיבוי אינו תקין.", 400, "invalid_backup_day");
  await consumeRateLimit(env, `backup-download:${user.uid}`, D1_BACKUP_DOWNLOAD_RATE_LIMIT, D1_BACKUP_DOWNLOAD_RATE_WINDOW_MS,
    "הורדו יותר מדי גיבויים. נסה שוב בעוד שעה.", "backup_download_rate_limit");
  const found = await findD1BackupForDay(env, day);
  const object = found ? await env.GALLERY_BUCKET.get(found.key) : null;
  if (!object) throw apiError("הגיבוי לא נמצא.", 404, "not_found");
  const headers = new Headers(corsHeaders(request));
  headers.set("Content-Type", found.compressed ? "application/gzip" : "application/json; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="simchas-gallery-d1-${day}.json${found.compressed ? ".gz" : ""}"`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers });
}

// --- סל המחזור: מחיקה לצמיתות אחרי 30 יום ---

function trashItemDeletedAt(row) {
  const deletedAt = Number(parseDocumentData(row).deletedAt);
  return Number.isFinite(deletedAt) && deletedAt > 0 ? deletedAt : Number(row.created_at) || 0;
}

// מפתחות הקבצים שפריט בסל "מחזיק": רק מקור (approved/ או pending/) של תמונה
// או תמונה ממתינה. קבצי צ'אט ותצוגות אינם שייכים לרשומה הזו.
function trashItemObjectKeys(item) {
  if (!["image", "pendingImage"].includes(item?.originalType)) return [];
  const keys = [];
  for (const value of [item.record?.r2Key, item.record?.thumbnailR2Key]) {
    const key = String(value || "");
    if (!/^(approved|pending)\//.test(key)) continue;
    try { keys.push(validateObjectKey(key)); } catch { /* מפתח שאינו של הגלריה אינו נמחק */ }
  }
  return [...new Set(keys)];
}

// האם מסמך כלשהו עדיין מזכיר את הקובץ — רשומה פעילה, ממתינה, פריט אחר בסל,
// הודעת הפופ-אפ או כל מסמך אחר. החיפוש בטקסט המלא של ה-JSON שמרני בכוונה:
// עדיף קובץ יתום (שיופיע בדוח הקישורים השבורים) ממחיקה של קובץ בשימוש.
async function objectKeyStillReferenced(env, key) {
  const row = await env.GALLERY_DB.prepare(
    "SELECT 1 AS found FROM gallery_documents WHERE instr(data_json, ?) > 0 LIMIT 1"
  ).bind(key).first();
  return Boolean(row);
}

async function mediaIdStillInUse(env, imageId) {
  const row = await env.GALLERY_DB.prepare(
    "SELECT 1 AS found FROM gallery_documents WHERE collection_name IN ('images', 'pendingImages') AND document_id = ? LIMIT 1"
  ).bind(imageId).first();
  return Boolean(row);
}

// מוחק מסמך אחד מהסל, ואחריו את הקבצים שלו — כל קובץ רק אם אף מסמך אחר אינו
// מזכיר אותו. כשל באמצע משאיר לכל היותר קובץ יתום, לעולם לא פריט בסל שהקובץ
// שלו נמחק.
async function purgeTrashDocument(env, id, data, totals) {
  await env.GALLERY_DB.prepare(
    "DELETE FROM gallery_documents WHERE collection_name = 'trashItems' AND document_id = ?"
  ).bind(id).run();
  for (const key of trashItemObjectKeys(data)) {
    if (await objectKeyStillReferenced(env, key)) { totals.keptObjects += 1; continue; }
    await env.GALLERY_BUCKET.delete(key);
    totals.deletedObjects += 1;
    const imageId = faceImageIdFromObjectKey(key);
    // הנגזרות (טביעות, תצוגות, עותק Stream) שייכות למזהה, ולכן רק כשאין לו רשומה.
    if (imageId && !(await mediaIdStillInUse(env, imageId))) {
      await deleteFaceIndexForImage(env, imageId);
      await deleteMediaVariantsForImage(env, imageId);
      await deleteStreamVideoForDeletedMedia(env, key);
    }
  }
}

// POST /maintenance/trash-purge — פריטים שבסל יותר מ-30 יום נמחקים לצמיתות,
// כמו "מחיקה סופית" של מנהל־על. הגיל נמדד מהמאוחר מבין deletedAt שהדפדפן
// כתב לבין מועד יצירת המסמך בשרת, כך ששעון שגוי בדפדפן אינו מקדים מחיקה.
// תיקייה: קודם התמונות שבה (ילדים עם parentTrashGroupId), והיא עצמה רק כשלא
// נשאר בה ילד — גם אם זה לוקח כמה ריצות.
async function maintenanceTrashPurge(request, env) {
  requireMaintenanceRunner(request);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const cutoff = now - TRASH_RETENTION_DAYS * MAINTENANCE_DAY_MS;
  const age = "MAX(COALESCE(CAST(json_extract(t.data_json, '$.deletedAt') AS INTEGER), 0), t.created_at)";
  // פריט ראשי, או ילד שהתיקייה שלו כבר אינה בסל.
  const candidates = await env.GALLERY_DB.prepare(
    `SELECT t.document_id, t.data_json, t.created_at FROM gallery_documents t
     WHERE t.collection_name = 'trashItems' AND ${age} <= ?
       AND (COALESCE(json_extract(t.data_json, '$.parentTrashGroupId'), '') = ''
         OR NOT EXISTS (SELECT 1 FROM gallery_documents p WHERE p.collection_name = 'trashItems'
           AND p.document_id = json_extract(t.data_json, '$.parentTrashGroupId')))
     ORDER BY ${age} ASC, t.document_id ASC
     LIMIT ?`
  ).bind(cutoff, TRASH_PURGE_MAX_GROUPS).all();
  const totals = { deletedObjects: 0, keptObjects: 0 };
  const purged = [];
  let purgedChildren = 0;
  let budget = TRASH_PURGE_MAX_ITEMS;
  let more = (candidates.results || []).length >= TRASH_PURGE_MAX_GROUPS;
  for (const row of candidates.results || []) {
    if (budget <= 0) { more = true; break; }
    // הגיל נבדק שוב: deletedAt שאינו מספר תקין אינו מקדים מחיקה.
    if (Math.max(trashItemDeletedAt(row), Number(row.created_at) || 0) > cutoff) continue;
    const id = String(row.document_id);
    const item = parseDocumentData(row);
    const children = await env.GALLERY_DB.prepare(
      `SELECT document_id, data_json FROM gallery_documents
       WHERE collection_name = 'trashItems' AND json_extract(data_json, '$.parentTrashGroupId') = ?
       ORDER BY document_id LIMIT ?`
    ).bind(id, budget + 1).all();
    const childRows = children.results || [];
    const batch = childRows.slice(0, budget);
    for (const child of batch) {
      await purgeTrashDocument(env, String(child.document_id), parseDocumentData(child), totals);
      purgedChildren += 1;
      budget -= 1;
    }
    // נשארו תמונות בתיקייה: התיקייה עצמה תימחק בריצה הבאה, אחרי כולן.
    if (childRows.length > batch.length) { more = true; break; }
    await purgeTrashDocument(env, id, item, totals);
    budget -= 1;
    purged.push({
      type: String(item.originalType || "").slice(0, 40),
      name: String(item.targetName || "").slice(0, 160),
      originalId: String(item.originalId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || "none"
    });
  }
  if (purged.length) {
    // שורה ביומן הפעילות לכל פריט, כמו "מחיקה סופית" ידנית, כדי שיהיה ברור מה נמחק ומתי.
    await runDatabaseStatements(env, purged.map(entry => {
      const logId = `log_${now}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const log = {
        id: logId, action: "purged", targetType: entry.type, targetId: entry.originalId, targetName: entry.name,
        details: `נמחק אוטומטית אחרי ${TRASH_RETENTION_DAYS} יום בסל המחזור`,
        actorUid: "background-worker", actorEmail: "", actorName: "ניקוי אוטומטי", actorRole: "system", createdAt: now
      };
      return env.GALLERY_DB.prepare(
        `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
         VALUES ('activityLogs', ?, ?, 'background-worker', ?, ?) ON CONFLICT(collection_name, document_id) DO NOTHING`
      ).bind(logId, JSON.stringify(log), now, now);
    }));
  }
  if (purged.length || purgedChildren) await bumpDataVersions(env, purged.length ? ["trashItems", "activityLogs"] : ["trashItems"]);
  // באותה ריצה: תיעוד דחייה בן יותר מ-60 יום, וקישורי הזמנה שפגו או בוטלו לפני
  // יותר מ-30 יום, נמחקים. שתי שאילתות על אינדקס — בדרך כלל אינן מוחקות דבר.
  const rejectionsPurged = ((await env.GALLERY_DB.prepare(
    "DELETE FROM upload_rejections WHERE rejected_at < ? RETURNING image_id"
  ).bind(now - UPLOAD_REJECTION_RETENTION_DAYS * MAINTENANCE_DAY_MS).all()).results || []).length;
  const invitesPurged = ((await env.GALLERY_DB.prepare(
    `DELETE FROM invite_links WHERE ${INVITE_ENDED_AT_SQL} < ? RETURNING invite_id`
  ).bind(now - INVITE_RETENTION_DAYS * MAINTENANCE_DAY_MS).all()).results || []).length;
  return json(request, {
    success: true, retentionDays: TRASH_RETENTION_DAYS,
    purged: purged.length, purgedChildren, ...totals, more,
    rejectionsPurged, invitesPurged
  });
}

// --- התראה למנהלי־העל ---

function maintenanceAdminUrl(env, hash = "") {
  try {
    return new URL(`admin.html${hash}`, new URL(String(env.GOOGLE_DRIVE_SITE_URL || DEFAULT_DRIVE_SITE_URL).trim())).toString();
  } catch {
    return `${DEFAULT_DRIVE_SITE_URL}admin.html${hash}`;
  }
}

async function readMaintenanceDocument(env, id) {
  return parseDocumentData(await readGalleryDocumentRow(env, "systemMeta", id));
}

async function superAdminEmails(env) {
  const result = await env.GALLERY_DB.prepare(
    `SELECT json_extract(data_json, '$.email') AS email FROM gallery_documents
     WHERE collection_name = 'userProfiles' AND json_extract(data_json, '$.role') = 'super_admin'
       AND json_extract(data_json, '$.status') = 'approved'
     ORDER BY document_id LIMIT ?`
  ).bind(MAINTENANCE_ALERT_MAX_RECIPIENTS).all();
  return [...new Set((result.results || [])
    .map(row => String(row.email || "").trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254))];
}

// התוכן כללי בכוונה: מספרים וקישור ללוח בלבד. הודעות השגיאה עצמן, כתובות
// דפים ומזהי משתמשים נשארים בלוח, מאחורי ההתחברות.
function maintenanceAlertText(env, reasons, metrics) {
  const lines = ["שלום,", "", "תהליך התחזוקה של גלריית שמחת התורה זיהה בעיה:"];
  if (reasons.includes("health")) lines.push(`- בדיקת התקינות של השרת נכשלה (סטטוס ${metrics.healthStatus || "לא ידוע"}).`);
  if (reasons.includes("errors")) {
    lines.push(`- בשעה האחרונה נרשמו ${metrics.occurrences} מופעי שגיאה ו-${metrics.newKinds} סוגי שגיאה חדשים.`);
  }
  if (reasons.includes("storage")) {
    const parts = [];
    if (Number.isFinite(metrics.storage?.r2Percent)) parts.push(`האחסון (R2) ב-${metrics.storage.r2Percent}% מהמכסה`);
    if (Number.isFinite(metrics.storage?.d1Percent)) parts.push(`מסד הנתונים (D1) ב-${metrics.storage.d1Percent}% מהמכסה`);
    lines.push(`- ${parts.join(", ") || "האחסון"} — מעל סף האזהרה (${metrics.storage?.warnPercent}%).`);
  }
  const hash = reasons.includes("errors") ? "#errors" : reasons.includes("health") ? "#health" : "#stats";
  lines.push("", `לפרטים בלוח הניהול: ${maintenanceAdminUrl(env, hash)}`, "",
    `התראה נוספת תישלח לכל היותר בעוד ${Math.round(MAINTENANCE_ALERT_INTERVAL_MS / 3600000)} שעות.`);
  return lines.join("\n");
}

// POST /maintenance/alert-check — { health: { ok, status } } כפי שהתהליך מדד
// מבחוץ. מספר המופעים בשעה האחרונה הוא ההפרש בסכום המונים של client_errors
// מול נקודת ייחוס שנשמרת לכל היותר פעם בשעה, כדי שבדיקה בכל רבע שעה לא
// תכתוב ל-D1 בכל פעם.
async function maintenanceAlertCheck(request, env) {
  requireMaintenanceRunner(request);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const now = Date.now();
  const healthOk = payload?.health?.ok !== false;
  const healthStatus = Math.max(0, Math.min(999, Math.trunc(Number(payload?.health?.status) || 0)));
  const totals = await env.GALLERY_DB.prepare(
    "SELECT COALESCE(SUM(count), 0) AS total, COALESCE(SUM(CASE WHEN first_seen >= ? THEN 1 ELSE 0 END), 0) AS newKinds FROM client_errors"
  ).bind(now - MAINTENANCE_ALERT_WINDOW_MS).first();
  const total = Number(totals?.total) || 0;
  const newKinds = Number(totals?.newKinds) || 0;
  const state = await readMaintenanceDocument(env, MAINTENANCE_ALERT_DOC_ID);
  const baselineAt = Number(state.baselineAt) || 0;
  const baselineTotal = Number(state.baselineTotal);
  const baselineFresh = baselineAt > now - 2 * MAINTENANCE_ALERT_WINDOW_MS && Number.isFinite(baselineTotal);
  // ניקוי שגיאות שטופלו מקטין את הסכום: הפרש שלילי אינו נספר, רק מחליף ייחוס.
  const occurrences = baselineFresh ? Math.max(0, total - baselineTotal) : 0;
  const reasons = [];
  if (!healthOk) reasons.push("health");
  if (occurrences >= MAINTENANCE_ALERT_ERROR_OCCURRENCES || newKinds >= MAINTENANCE_ALERT_NEW_ERROR_KINDS) reasons.push("errors");
  // אחסון מעל הסף שמנהל־העל קבע: לכל היותר התראה אחת לכל דוח נפח (פעם ביום),
  // ובנוסף כפוף לנעילה של שש השעות כמו שאר הסיבות.
  const storage = await storageAlertState(env);
  if (storage && Number(state.lastStorageAlertReportAt) !== storage.reportAt) reasons.push("storage");
  const next = { ...state };
  let changed = false;
  if (!baselineFresh || baselineAt <= now - MAINTENANCE_ALERT_WINDOW_MS || total < baselineTotal) {
    next.baselineAt = now;
    next.baselineTotal = total;
    changed = true;
  }
  const metrics = { occurrences, newKinds, healthOk, healthStatus,
    ...(reasons.includes("storage") ? { storage: { r2Percent: storage.r2.percent, d1Percent: storage.d1.percent, warnPercent: storage.warnPercent } } : {}) };
  let result = { alerted: false, reasons, metrics };
  const lastAlertAt = Number(state.lastAlertAt) || 0;
  if (reasons.length && lastAlertAt > now - MAINTENANCE_ALERT_INTERVAL_MS) {
    result = { ...result, suppressed: true, nextAllowedAt: lastAlertAt + MAINTENANCE_ALERT_INTERVAL_MS };
  } else if (reasons.length && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
    result = { ...result, skipped: "email_not_configured" };
  } else if (reasons.length) {
    const recipients = await superAdminEmails(env);
    if (!recipients.length) {
      result = { ...result, skipped: "no_recipients" };
    } else {
      // קודם נרשם שההתראה יוצאת, ורק אז היא נשלחת: אם הרישום נכשל לא נשלח
      // כלום, וכך לעולם לא נשלח מייל בכל ריצה.
      const claimed = { ...next, lastAlertAt: now, lastAlertReasons: reasons,
        ...(reasons.includes("storage") ? { lastStorageAlertReportAt: storage.reportAt } : {}) };
      await saveBackgroundDocument(env, MAINTENANCE_ALERT_DOC_ID, claimed);
      changed = false;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `gallery-maintenance-alert-${now}`
        },
        body: JSON.stringify({
          from: String(env.EMAIL_FROM).trim(),
          to: recipients,
          subject: "גלריית שמחת התורה: נדרשת בדיקה",
          text: maintenanceAlertText(env, reasons, metrics)
        }),
        signal: AbortSignal.timeout(20000)
      }).catch(() => null);
      const sent = response ? await response.json().catch(() => ({})) : {};
      if (!response?.ok || !sent?.id) {
        console.error("Maintenance alert email failed", response?.status || 0);
        // ההתראה לא יצאה: הנעילה של שש השעות משתחררת, והריצה הבאה תנסה שוב.
        await saveBackgroundDocument(env, MAINTENANCE_ALERT_DOC_ID, {
          ...claimed, lastAlertAt, lastAlertReasons: state.lastAlertReasons || [],
          lastStorageAlertReportAt: state.lastStorageAlertReportAt ?? null
        }).catch(() => {});
        result = { ...result, failed: "email_send_failed", providerStatus: response?.status || 0 };
      } else {
        result = { ...result, alerted: true, recipients: recipients.length };
      }
    }
  }
  if (changed) await saveBackgroundDocument(env, MAINTENANCE_ALERT_DOC_ID, next);
  return json(request, { success: true, ...result });
}

// --- קישורים שבורים: רשומות בלי קובץ, וקבצים בלי רשומה ---

function brokenLinksEmptyScan(now) {
  return { startedAt: now, checkedRecords: 0, checkedObjects: 0, notStored: 0, missingCount: 0, orphanCount: 0, orphanBytes: 0, missing: [], orphans: [] };
}

// המפתחות שרשומת תמונה מאושרת מצביעה עליהם: המקור, תמונה ממוזערת ישנה
// והתצוגות (כולל עותק AVIF). רק מפתחות בתבניות של הגלריה.
function recordObjectKeys(record) {
  const keys = [];
  const add = (kind, value) => {
    const key = String(value || "");
    if (!key) return;
    try { keys.push({ kind, key: validateObjectKey(key) }); } catch { /* כתובת חיצונית או ישנה */ }
  };
  add("original", record.r2Key);
  add("thumbnail", record.thumbnailR2Key);
  for (const [name, variant] of Object.entries(record.variants && typeof record.variants === "object" ? record.variants : {})) {
    if (!MEDIA_VARIANT_NAMES.includes(name)) continue;
    add(name, variant?.key);
    add(`${name}-avif`, variant?.avif?.key);
  }
  return keys;
}

async function scanBrokenRecords(env, scan, cursor) {
  const rows = await env.GALLERY_DB.prepare(
    "SELECT document_id, data_json FROM gallery_documents WHERE collection_name = 'images' AND document_id > ? ORDER BY document_id LIMIT ?"
  ).bind(String(cursor.afterId || ""), BROKEN_LINKS_RECORDS_PER_CALL).all();
  const results = rows.results || [];
  for (let index = 0; index < results.length; index += 10) {
    await Promise.all(results.slice(index, index + 10).map(async row => {
      const record = parseDocumentData(row);
      scan.checkedRecords += 1;
      const keys = recordObjectKeys(record);
      if (!keys.some(entry => entry.kind === "original")) scan.notStored += 1;
      const missing = [];
      for (const entry of keys) {
        if (!(await env.GALLERY_BUCKET.head(entry.key))) missing.push(entry);
      }
      if (!missing.length) return;
      scan.missingCount += 1;
      if (scan.missing.length < BROKEN_LINKS_LIST_MAX) {
        scan.missing.push({
          id: String(row.document_id),
          title: String(record.title || "").slice(0, 80),
          mediaType: record.mediaType === "video" ? "video" : "image",
          missing: missing.map(entry => ({ kind: entry.kind, key: entry.key }))
        });
      }
    }));
  }
  if (results.length) cursor.afterId = String(results.at(-1).document_id);
  return results.length < BROKEN_LINKS_RECORDS_PER_CALL;
}

// מקורות ותמונות ממוזערות: בשימוש אם רשומה פעילה, ממתינה, פריט בסל או מסמך
// מערכת (הודעת הפופ-אפ) מצביעים עליהם במפורש.
async function referencedSourceKeys(env, keys) {
  const referenced = new Set();
  const fields = ["$.r2Key", "$.thumbnailR2Key", "$.record.r2Key", "$.record.thumbnailR2Key"];
  for (let index = 0; index < keys.length; index += BROKEN_LINKS_KEY_BATCH) {
    const batch = keys.slice(index, index + BROKEN_LINKS_KEY_BATCH);
    const marks = batch.map(() => "?").join(", ");
    const result = await env.GALLERY_DB.prepare(
      `SELECT ${fields.map((field, position) => `json_extract(data_json, '${field}') AS k${position}`).join(", ")}
       FROM gallery_documents
       WHERE collection_name IN ('images', 'pendingImages', 'trashItems', 'systemMeta')
         AND (${fields.map(field => `json_extract(data_json, '${field}') IN (${marks})`).join(" OR ")})`
    ).bind(...fields.flatMap(() => batch)).all();
    for (const row of result.results || []) {
      for (let position = 0; position < fields.length; position += 1) {
        if (row[`k${position}`]) referenced.add(String(row[`k${position}`]));
      }
    }
  }
  return referenced;
}

// תצוגות שייכות למזהה: בשימוש כשיש לו רשומה פעילה או ממתינה, או פריט בסל.
async function referencedVariantIds(env, ids) {
  const referenced = new Set();
  for (let index = 0; index < ids.length; index += BROKEN_LINKS_ID_BATCH) {
    const batch = ids.slice(index, index + BROKEN_LINKS_ID_BATCH);
    const marks = batch.map(() => "?").join(", ");
    const result = await env.GALLERY_DB.prepare(
      `SELECT document_id AS id FROM gallery_documents WHERE collection_name IN ('images', 'pendingImages') AND document_id IN (${marks})
       UNION SELECT json_extract(data_json, '$.originalId') AS id FROM gallery_documents
       WHERE collection_name = 'trashItems' AND json_extract(data_json, '$.originalId') IN (${marks})`
    ).bind(...batch, ...batch).all();
    for (const row of result.results || []) if (row.id) referenced.add(String(row.id));
  }
  return referenced;
}

async function scanOrphanObjects(env, scan, cursor, now) {
  const prefixIndex = Math.max(0, Math.trunc(Number(cursor.prefixIndex) || 0));
  const prefix = BROKEN_LINKS_PREFIXES[prefixIndex];
  if (!prefix) return true;
  const listed = await env.GALLERY_BUCKET.list({ prefix, limit: BROKEN_LINKS_OBJECTS_PER_CALL, ...(cursor.r2Cursor ? { cursor: cursor.r2Cursor } : {}) });
  const objects = (listed?.objects || []).filter(object => {
    const uploaded = object.uploaded ? new Date(object.uploaded).getTime() : 0;
    return !(uploaded && uploaded > now - BROKEN_LINKS_OBJECT_GRACE_MS);
  });
  scan.checkedObjects += objects.length;
  const variantId = object => String(object.key).split("/")[1] || "";
  let isReferenced;
  if (prefix === "variants/") {
    const used = await referencedVariantIds(env, [...new Set(objects.map(variantId).filter(Boolean))]);
    isReferenced = object => used.has(variantId(object));
  } else {
    const used = await referencedSourceKeys(env, objects.map(object => String(object.key)));
    isReferenced = object => used.has(String(object.key));
  }
  for (const object of objects) {
    if (isReferenced(object)) continue;
    scan.orphanCount += 1;
    scan.orphanBytes += Number(object.size) || 0;
    if (scan.orphans.length < BROKEN_LINKS_LIST_MAX) {
      scan.orphans.push({
        key: String(object.key),
        size: Number(object.size) || 0,
        uploadedAt: object.uploaded ? new Date(object.uploaded).getTime() || 0 : 0
      });
    }
  }
  if (listed?.truncated && listed.cursor) {
    cursor.r2Cursor = listed.cursor;
  } else {
    cursor.prefixIndex = prefixIndex + 1;
    cursor.r2Cursor = "";
  }
  return cursor.prefixIndex >= BROKEN_LINKS_PREFIXES.length;
}

// POST /maintenance/broken-links — צעד אחד של הסריקה ושמירה אחת של המצב
// (כתיבה אחת ל-D1 לכל קריאה). אחרי סריקה מלאה נשמר דוח, והסריקה הבאה מתחילה
// רק אחרי יממה; בין לבין הקריאה רק קוראת. דבר אינו נמחק — רק מדווח.
async function maintenanceBrokenLinks(request, env) {
  requireMaintenanceRunner(request);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const state = await readMaintenanceDocument(env, BROKEN_LINKS_DOC_ID);
  const report = state.report && typeof state.report === "object" ? state.report : null;
  if (!state.scan && report && Number(report.completedAt) > now - BROKEN_LINKS_RESCAN_MS) {
    return json(request, { success: true, idle: true, done: true, nextScanAt: Number(report.completedAt) + BROKEN_LINKS_RESCAN_MS });
  }
  const scan = state.scan && typeof state.scan === "object" ? { ...brokenLinksEmptyScan(now), ...state.scan } : brokenLinksEmptyScan(now);
  const cursor = state.cursor && typeof state.cursor === "object"
    ? { ...state.cursor }
    : { phase: "records", afterId: "", prefixIndex: 0, r2Cursor: "" };
  let done = false;
  if (cursor.phase !== "objects") {
    if (await scanBrokenRecords(env, scan, cursor)) cursor.phase = "objects";
  } else {
    done = await scanOrphanObjects(env, scan, cursor, now);
  }
  const next = done
    ? { version: 1, report: { ...scan, completedAt: now }, scan: null, cursor: null, updatedAt: now }
    : { version: 1, report, scan, cursor, updatedAt: now };
  await saveBackgroundDocument(env, BROKEN_LINKS_DOC_ID, next);
  return json(request, {
    success: true, idle: false, done, phase: done ? "done" : cursor.phase,
    checkedRecords: scan.checkedRecords, checkedObjects: scan.checkedObjects,
    missingCount: scan.missingCount, orphanCount: scan.orphanCount
  });
}

// GET /maintenance/broken-links — הדוח האחרון ומצב הסריקה (מנהל־על).
async function readBrokenLinksReport(request, env) {
  await requireMaintenanceViewer(request, env);
  await ensureDatabaseSchema(env);
  const state = await readMaintenanceDocument(env, BROKEN_LINKS_DOC_ID);
  const scan = state.scan && typeof state.scan === "object" ? state.scan : null;
  const response = json(request, {
    success: true,
    listMax: BROKEN_LINKS_LIST_MAX,
    report: state.report && typeof state.report === "object" ? state.report : null,
    scanning: scan ? {
      startedAt: Number(scan.startedAt) || 0,
      phase: String(state.cursor?.phase || "records"),
      checkedRecords: Number(scan.checkedRecords) || 0,
      checkedObjects: Number(scan.checkedObjects) || 0
    } : null
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export {
  D1_BACKUP_PREFIX,
  D1_BACKUP_KEY_PATTERN,
  D1_BACKUP_DAY_PATTERN,
  D1_BACKUP_RETENTION_DAYS,
  D1_BACKUP_PAGE_ROWS,
  D1_BACKUP_PAGE_ROWS_MIN,
  D1_BACKUP_PAGE_ROWS_MAX,
  D1_BACKUP_PAGE_TARGET_CHARS,
  D1_BACKUP_FORMAT,
  D1_BACKUP_FLUSH_CHARS,
  D1_BACKUP_EXCLUDED_TABLES,
  D1_BACKUP_DOWNLOAD_RATE_LIMIT,
  D1_BACKUP_DOWNLOAD_RATE_WINDOW_MS,
  TRASH_RETENTION_DAYS,
  TRASH_PURGE_MAX_GROUPS,
  TRASH_PURGE_MAX_ITEMS,
  MAINTENANCE_ALERT_DOC_ID,
  MAINTENANCE_ALERT_INTERVAL_MS,
  MAINTENANCE_ALERT_WINDOW_MS,
  MAINTENANCE_ALERT_ERROR_OCCURRENCES,
  MAINTENANCE_ALERT_NEW_ERROR_KINDS,
  MAINTENANCE_ALERT_MAX_RECIPIENTS,
  BROKEN_LINKS_DOC_ID,
  BROKEN_LINKS_RECORDS_PER_CALL,
  BROKEN_LINKS_OBJECTS_PER_CALL,
  BROKEN_LINKS_LIST_MAX,
  BROKEN_LINKS_RESCAN_MS,
  BROKEN_LINKS_OBJECT_GRACE_MS,
  BROKEN_LINKS_PREFIXES,
  BROKEN_LINKS_KEY_BATCH,
  BROKEN_LINKS_ID_BATCH,
  maintenanceDay,
  requireMaintenanceRunner,
  requireMaintenanceViewer,
  assertPublicMediaPath,
  listD1Backups,
  findD1BackupForDay,
  backupIdentifier,
  backupCell,
  exportD1Database,
  writeD1Backup,
  pruneD1Backups,
  maintenanceBackup,
  listMaintenanceBackups,
  downloadMaintenanceBackup,
  trashItemDeletedAt,
  trashItemObjectKeys,
  objectKeyStillReferenced,
  mediaIdStillInUse,
  purgeTrashDocument,
  maintenanceTrashPurge,
  maintenanceAdminUrl,
  readMaintenanceDocument,
  superAdminEmails,
  maintenanceAlertText,
  maintenanceAlertCheck,
  brokenLinksEmptyScan,
  recordObjectKeys,
  scanBrokenRecords,
  referencedSourceKeys,
  referencedVariantIds,
  scanOrphanObjects,
  maintenanceBrokenLinks,
  readBrokenLinksReport
};
