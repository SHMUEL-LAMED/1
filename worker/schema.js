// סכימת D1 והגירות בין גרסאות.
import {
  CONTENT_HASH_COLLECTIONS_SQL,
  CONTENT_HASH_SQL,
  DATABASE_SCHEMA_VERSION,
  TAKEN_AT_ORDER_SQL
} from "./config.js";
import {
  apiError
} from "./util.js";

let databaseSchemaReady = false;

async function ensureDatabaseSchema(env) {
  if (!env.GALLERY_DB) throw apiError("החיבור למסד D1 אינו מוגדר.", 500, "database_binding_missing");
  if (databaseSchemaReady) return;
  // בסיס שכבר הושלם אינו דורש DDL או כתיבת חותמת בכל פתיחת Worker.
  try {
    const version = await env.GALLERY_DB.prepare("SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'gallery'").first();
    if (Number(version?.schema_version) >= DATABASE_SCHEMA_VERSION) { databaseSchemaReady = true; return; }
  } catch { /* מסד חדש ממשיך למיגרציה */ }
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
        box_json TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, face_index)
      )`
    ).run();
    // שיוך פרצוף לאדם. source: 'manual' (מנהל) או 'auto' (הקיבוץ האוטומטי).
    await env.GALLERY_DB.prepare(`CREATE TABLE IF NOT EXISTS face_people (
      image_id TEXT NOT NULL, face_index INTEGER NOT NULL,
      model_version TEXT NOT NULL, descriptor_json TEXT NOT NULL,
      person_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      assigned_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (image_id, face_index)
    )`).run();
    await env.GALLERY_DB.prepare("CREATE INDEX IF NOT EXISTS idx_face_people_person ON face_people(person_id)").run();
    // אדם: קבוצת פרצופים. status: 'suggested' (קבוצה אוטומטית שממתינה לאישור)
    // או 'approved' (מנהל אישר ונתן שם). hidden מסתיר את האדם מהרשימה ומהאלבום.
    // centroid_json הוא ממוצע הטביעות — לשימוש ה-Worker בלבד, לעולם אינו נשלח.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS face_persons (
        person_id TEXT PRIMARY KEY,
        model_version TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'suggested',
        hidden INTEGER NOT NULL DEFAULT 0,
        centroid_json TEXT NOT NULL DEFAULT '',
        face_count INTEGER NOT NULL DEFAULT 0,
        image_count INTEGER NOT NULL DEFAULT 0,
        cover_image_id TEXT NOT NULL DEFAULT '',
        cover_face_index INTEGER NOT NULL DEFAULT -1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_face_persons_status ON face_persons (model_version, status, hidden)"
    ).run();
    // פרצוף שעובד בקיבוץ ולא שויך לאדם: 'seed' (בודד, ממתין לפרצוף דומה),
    // 'review' (קרוב לאדם אך לא בוודאות — candidate_person_id) או 'ignored'
    // (מנהל הסיר אותו, ולכן הקיבוץ האוטומטי לא יחזיר אותו).
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS face_cluster_marks (
        image_id TEXT NOT NULL,
        face_index INTEGER NOT NULL,
        model_version TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        mark TEXT NOT NULL,
        candidate_person_id TEXT NOT NULL DEFAULT '',
        distance REAL NOT NULL DEFAULT 0,
        margin REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, face_index)
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_face_cluster_marks_mark ON face_cluster_marks (model_version, mark)"
    ).run();
    // "זכור אותי" של "התמונות שלי": טביעה אחת למשתמש, רק אחרי סימון מפורש,
    // ונמחקת ב"שכח אותי" או במחיקת המשתמש. לעולם אינה מוחזרת לדפדפן.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS face_user_descriptors (
        uid TEXT PRIMARY KEY,
        model_version TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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
    // שגיאות מהאתר ומה-Worker, מקובצות לפי טביעת אצבע: שורה אחת לכל סוג
    // תקלה עם מונה מופעים. resolved_at ריק = השגיאה עדיין פתוחה.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS client_errors (
        fingerprint TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        last_uid TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL DEFAULT 1,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        resolved_at INTEGER
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_client_errors_resolved_seen ON client_errors (resolved_at, last_seen DESC)"
    ).run();
    // רישום קובצי התצוגות המקדימות שב-R2: שורה לכל קובץ, כדי שמסך הניהול
    // יידע כמה קבצים ונפח הן תופסות בלי לסרוק את הדלי.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS media_variant_files (
        object_key TEXT PRIMARY KEY,
        image_id TEXT NOT NULL,
        variant_name TEXT NOT NULL,
        format TEXT NOT NULL,
        content_type TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        variants_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_media_variant_files_image ON media_variant_files (image_id)"
    ).run();
    // העלאה בחלקים (R2 multipart): מצב ההעלאה נשמר כאן ולא בדפדפן בלבד, כדי
    // שהלקוח ימשיך מהחלק האחרון שהתקבל גם אחרי ניתוק או רענון. ראו
    // createMultipartUpload ואילך.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS upload_sessions (
        upload_id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        owner_uid TEXT NOT NULL,
        image_id TEXT NOT NULL,
        state TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        total_size INTEGER NOT NULL,
        part_size INTEGER NOT NULL,
        total_parts INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'uploading',
        result_json TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner ON upload_sessions (owner_uid, updated_at)"
    ).run();
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS upload_session_parts (
        upload_id TEXT NOT NULL,
        part_number INTEGER NOT NULL,
        etag TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (upload_id, part_number)
      )`
    ).run();
    // Cloudflare Stream (רשות): מזהה העותק ב-Stream לכל סרטון שנשלח אליו.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS stream_videos (
        image_id TEXT PRIMARY KEY,
        stream_uid TEXT NOT NULL,
        object_key TEXT NOT NULL DEFAULT '',
        hls_url TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`
    ).run();
    // סטטיסטיקות שימוש: שורה אחת לכל יום (UTC) ומדד, עם מונה בלבד — בלי מזהה
    // משתמש, כתובת או תוכן. כל הוספה היא UPSERT אחד (ראו recordUsage).
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS usage_daily (
        day TEXT NOT NULL,
        metric TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (day, metric)
      )`
    ).run();
    // הערות פנימיות של מנהלים על משתמש. טבלה נפרדת ולא שדה בפרופיל: משתמש
    // קורא את userProfiles של עצמו, וההערות לעולם אינן מגיעות אליו. הן אינן
    // אוסף של /data, ונקראות רק דרך /admin/user-notes (ראו adminUserNotes).
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS admin_user_notes (
        note_id TEXT PRIMARY KEY,
        target_uid TEXT NOT NULL,
        author_uid TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_admin_user_notes_target ON admin_user_notes (target_uid, created_at)"
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
    // מיון לפי תאריך הצילום (?orderBy=takenAt). הביטוי זהה בדיוק לזה של
    // orderExpression, כדי ש-SQLite ישתמש באינדקס.
    await env.GALLERY_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_gallery_documents_taken_at ON gallery_documents (collection_name, ${TAKEN_AT_ORDER_SQL})`
    ).run();
    // גרסה 11: "ההעלאות שלי", זיהוי כפילויות, תיוג ידני והזמנות לאירוע.
    // תיעוד דחייה של העלאה ממתינה: רק מה שהמעלה עצמו צריך לראות (מזהה, שם,
    // זמן וסיבה אופציונלית). נמחק בתחזוקה היומית אחרי UPLOAD_REJECTION_RETENTION_DAYS.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS upload_rejections (
        image_id TEXT PRIMARY KEY,
        uploader_uid TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        rejected_by TEXT NOT NULL DEFAULT '',
        rejected_at INTEGER NOT NULL
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_upload_rejections_uploader ON upload_rejections (uploader_uid, rejected_at)"
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_upload_rejections_time ON upload_rejections (rejected_at)"
    ).run();
    // תיוג ידני של אדם בתמונה שבה זיהוי הפנים לא מצא אותו: אין כאן טביעה,
    // ולכן זו טבלה נפרדת מ-face_people. box_json ריק = התמונה כולה.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS face_manual_tags (
        image_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        box_json TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, person_id)
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_face_manual_tags_person ON face_manual_tags (person_id)"
    ).run();
    // קישור הזמנה לאירוע. האסימון עצמו לעולם אינו נשמר: רק SHA-256 שלו.
    await env.GALLERY_DB.prepare(
      `CREATE TABLE IF NOT EXISTS invite_links (
        invite_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        folder_id TEXT NOT NULL,
        folder_name TEXT NOT NULL DEFAULT '',
        auto_approve INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER NOT NULL DEFAULT 0
      )`
    ).run();
    await env.GALLERY_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_invite_links_expires ON invite_links (expires_at)"
    ).run();
    // זיהוי כפילויות לפני העלאה (POST /duplicates). הביטוי והתנאי זהים לאלה
    // שבשאילתה (CONTENT_HASH_SQL), כדי ש-SQLite ישתמש באינדקס. האינדקס חלקי —
    // רק רשומות מדיה — כך שכתיבה לאוספים אחרים (יומן, מונים, העדפות) אינה
    // מעדכנת אותו ואינה עולה בכתיבות נוספות ב-D1.
    await env.GALLERY_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_gallery_documents_content_hash ON gallery_documents (collection_name, ${CONTENT_HASH_SQL})
       WHERE ${CONTENT_HASH_COLLECTIONS_SQL}`
    ).run();
    const versionRow = await env.GALLERY_DB.prepare(
      "SELECT schema_version FROM gallery_schema_meta WHERE schema_key = 'gallery'"
    ).first();
    const currentVersion = Number(versionRow?.schema_version) || 0;
    // גרסה 8: עמודות חדשות בטבלאות קיימות (ALTER אינו אידמפוטנטי ולכן נבדק
    // קודם), ורשומת אדם לכל קבוצה ידנית קיימת. השיוכים עצמם אינם משתנים.
    if (currentVersion < 8) {
      await addColumnIfMissing(env, "face_people", "source", "TEXT NOT NULL DEFAULT 'manual'");
      await addColumnIfMissing(env, "face_people", "assigned_at", "INTEGER NOT NULL DEFAULT 0");
      await addColumnIfMissing(env, "image_face_descriptors", "box_json", "TEXT NOT NULL DEFAULT ''");
      const migratedAt = Date.now();
      await env.GALLERY_DB.prepare(
        `INSERT INTO face_persons (person_id, model_version, status, created_at, updated_at)
         SELECT person_id, MAX(model_version), 'suggested', ?, ?
         FROM face_people WHERE true GROUP BY person_id
         ON CONFLICT(person_id) DO NOTHING`
      ).bind(migratedAt, migratedAt).run();
    }
    if (currentVersion < 3) {
      await env.GALLERY_DB.prepare(
        `INSERT OR REPLACE INTO user_email_index (normalized_email, document_id, updated_at)         SELECT lower(trim(json_extract(data_json, '$.email'))), document_id, updated_at
         FROM gallery_documents
         WHERE collection_name = 'userProfiles'
           AND json_valid(data_json)
           AND length(trim(COALESCE(json_extract(data_json, '$.email'), ''))) > 0`
      ).run();
    }
    // MAX: Worker שנפרס מחדש בגרסה ישנה יותר אינו מוריד את הגרסה הרשומה,
    // וכך מילויים חד-פעמיים (כמו של גרסה 3) אינם רצים שוב בטעות.
    await env.GALLERY_DB.prepare(
      `INSERT INTO gallery_schema_meta (schema_key, schema_version, updated_at)
       VALUES ('gallery', ?, ?)
       ON CONFLICT(schema_key) DO UPDATE SET
         schema_version = MAX(gallery_schema_meta.schema_version, excluded.schema_version),
         updated_at = excluded.updated_at`
    ).bind(DATABASE_SCHEMA_VERSION, Date.now()).run();
    databaseSchemaReady = true;
  } catch (error) {
    console.error("D1 schema initialization failed", error);
    const failure = apiError("מסד הנתונים מחובר, אך טבלת הנתונים אינה זמינה.", 500, "database_schema_unavailable");
    failure.schemaCause = String(error?.cause?.message || error?.message || "unknown").split("\n")[0].replace(/https?:\/\/\S+/g, "[url]").slice(0,180);
    throw failure;
  }
}

async function addColumnIfMissing(env, table, column, definition) {
  const info = await env.GALLERY_DB.prepare(`PRAGMA table_info(${table})`).all();
  if ((info.results || []).some(row => String(row.name) === column)) return;
  await env.GALLERY_DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

export {
  databaseSchemaReady,
  ensureDatabaseSchema,
  addColumnIfMissing
};
