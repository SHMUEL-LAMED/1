CREATE TABLE IF NOT EXISTS gallery_documents (
  collection_name TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  owner_uid TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection_name, document_id)
);

CREATE INDEX IF NOT EXISTS idx_gallery_documents_collection_updated
  ON gallery_documents (collection_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gallery_documents_owner
  ON gallery_documents (collection_name, owner_uid);

-- מיון לפי תאריך הצילום (?orderBy=takenAt): takenAt, ובלעדיו createdAt.
-- הביטוי זהה לזה שב-Worker (TAKEN_AT_ORDER_SQL), אחרת האינדקס לא ישמש.
CREATE INDEX IF NOT EXISTS idx_gallery_documents_taken_at
  ON gallery_documents (collection_name, CAST(COALESCE(json_extract(data_json, '$.takenAt'), json_extract(data_json, '$.createdAt'), 0) AS REAL));

-- טביעות פנים: שורה לכל פרצוף בתמונה, כך שתמונה עם כמה אנשים נשמרת במלואה.
CREATE TABLE IF NOT EXISTS image_face_descriptors (
  image_id TEXT NOT NULL,
  face_index INTEGER NOT NULL,
  descriptor_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, face_index)
);

CREATE INDEX IF NOT EXISTS idx_image_face_descriptors_model
  ON image_face_descriptors (model_version, image_id, face_index);

-- מצב האינדוקס לכל תמונה. תמונה ללא פנים נשמרת עם face_count = 0 כדי שלא
-- תיסרק שוב, וכך האינדוקס ממשיך בדיוק מהמקום שנעצר גם אחרי רענון.
CREATE TABLE IF NOT EXISTS image_face_index_state (
  image_id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL,
  face_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_face_index_state_model
  ON image_face_index_state (model_version, status);
CREATE TABLE IF NOT EXISTS face_people (
  image_id TEXT NOT NULL,
  face_index INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL,
  person_id TEXT NOT NULL,
  PRIMARY KEY (image_id, face_index)
);
CREATE INDEX IF NOT EXISTS idx_face_people_person ON face_people(person_id);

-- שגיאות מהאתר ומה-Worker, מקובצות לפי טביעת אצבע: שורה אחת לכל סוג
-- תקלה עם מונה מופעים. resolved_at ריק = השגיאה עדיין פתוחה.
CREATE TABLE IF NOT EXISTS client_errors (
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
);
CREATE INDEX IF NOT EXISTS idx_client_errors_resolved_seen
  ON client_errors (resolved_at, last_seen DESC);
-- סימון הסביבה של המסד: ה-Worker הראשון שרץ מולו כותב כאן 'production' או
-- 'staging', וכל Worker שמוצא ערך של הסביבה האחרת מסרב לשרת בקשות. כך Worker
-- של הניסוי שחובר בטעות למסד הייצור נעצר לפני שהוא נוגע בנתונים.
CREATE TABLE IF NOT EXISTS gallery_environment (
  marker_key TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- קובצי התצוגות המקדימות שב-R2 (variants/<imageId>/<שם>.<webp|jpg|avif>):
-- שורה לכל קובץ, לסטטיסטיקה במסך "תצוגות מקדימות" בלי לסרוק את הדלי.
-- הרשומה עצמה (gallery_documents) נשארת המקור לכתובות התצוגות.
CREATE TABLE IF NOT EXISTS media_variant_files (
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
);
CREATE INDEX IF NOT EXISTS idx_media_variant_files_image
  ON media_variant_files (image_id);

-- העלאה בחלקים (R2 multipart): שורה לכל העלאה פתוחה, ושורה לכל חלק שהתקבל.
-- הלקוח שואל כאן מה כבר עלה וממשיך מהחלק הבא — גם אחרי ניתוק או רענון.
-- העלאה שהושלמה נשארת עם status = 'completed' ו-result_json, כדי שבקשת
-- השלמה חוזרת (תשובה שאבדה ברשת) תקבל את אותה תשובה. שורות ישנות נמחקות.
CREATE TABLE IF NOT EXISTS upload_sessions (
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
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner
  ON upload_sessions (owner_uid, updated_at);
CREATE TABLE IF NOT EXISTS upload_session_parts (
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);

-- Cloudflare Stream (רשות): לכל סרטון שנשלח ל-Stream — מזהה הסרטון שם,
-- כדי שמחיקת הסרטון מהגלריה תמחק גם את העותק ב-Stream.
CREATE TABLE IF NOT EXISTS stream_videos (
  image_id TEXT PRIMARY KEY,
  stream_uid TEXT NOT NULL,
  object_key TEXT NOT NULL DEFAULT '',
  hls_url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
