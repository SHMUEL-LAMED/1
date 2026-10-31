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
  -- מיקום הפרצוף בתמונה (יחסי, JSON) לחיתוך התצוגה של האדם. ריק באינדוקס ישן.
  box_json TEXT NOT NULL DEFAULT '',
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
-- שיוך פרצוף לאדם: source הוא 'manual' (מנהל) או 'auto' (הקיבוץ האוטומטי).
-- שיוך תקף רק כל עוד descriptor_json זהה לטביעה הנוכחית של הפרצוף.
CREATE TABLE IF NOT EXISTS face_people (
  image_id TEXT NOT NULL,
  face_index INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  assigned_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (image_id, face_index)
);
CREATE INDEX IF NOT EXISTS idx_face_people_person ON face_people(person_id);

-- אנשים בגלריה (גרסת סכימה 8): קבוצת פרצופים, שם, אישור מנהל והסתרה.
-- centroid_json הוא ממוצע הטביעות, לשימוש ה-Worker בלבד.
CREATE TABLE IF NOT EXISTS face_persons (
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
);
CREATE INDEX IF NOT EXISTS idx_face_persons_status ON face_persons (model_version, status, hidden);

-- פרצוף שעבר קיבוץ ולא שויך: 'seed' (בודד), 'review' (לבדיקה, עם האדם המוצע)
-- או 'ignored' (מנהל הסיר אותו, והקיבוץ האוטומטי לא יחזיר אותו).
CREATE TABLE IF NOT EXISTS face_cluster_marks (
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
);
CREATE INDEX IF NOT EXISTS idx_face_cluster_marks_mark ON face_cluster_marks (model_version, mark);

-- "זכור אותי" של "התמונות שלי": נשמר רק אחרי הסכמה מפורשת, ונמחק ב"שכח אותי".
CREATE TABLE IF NOT EXISTS face_user_descriptors (
  uid TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

-- גרסה 9: סטטיסטיקות שימוש — שורה אחת לכל יום (UTC) ומדד, עם מונה בלבד.
-- אין כאן מזהה משתמש, כתובת או תוכן; כל הוספה היא UPSERT אחד.
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);

-- גרסה 9: הערות פנימיות של מנהלים על משתמש. מחוץ ל-userProfiles, כי משתמש
-- קורא את הפרופיל של עצמו; נקראות רק דרך /admin/user-notes, לעולם לא ב-/data.
CREATE TABLE IF NOT EXISTS admin_user_notes (
  note_id TEXT PRIMARY KEY,
  target_uid TEXT NOT NULL,
  author_uid TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_user_notes_target
  ON admin_user_notes (target_uid, created_at);

-- גרסה 11: "ההעלאות שלי", זיהוי כפילויות, תיוג ידני והזמנות לאירוע.
-- תיעוד דחייה מינימלי של העלאה ממתינה — רק מה שהמעלה עצמו רואה. נמחק
-- בתחזוקה היומית אחרי 60 יום.
CREATE TABLE IF NOT EXISTS upload_rejections (
  image_id TEXT PRIMARY KEY,
  uploader_uid TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  rejected_by TEXT NOT NULL DEFAULT '',
  rejected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_rejections_uploader
  ON upload_rejections (uploader_uid, rejected_at);
CREATE INDEX IF NOT EXISTS idx_upload_rejections_time
  ON upload_rejections (rejected_at);

-- תיוג ידני של אדם בתמונה שבה זיהוי הפנים לא מצא אותו. box_json ריק = התמונה כולה.
CREATE TABLE IF NOT EXISTS face_manual_tags (
  image_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  box_json TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_face_manual_tags_person
  ON face_manual_tags (person_id);

-- קישור הזמנה לאירוע: רק SHA-256 של האסימון נשמר, לעולם לא האסימון עצמו.
CREATE TABLE IF NOT EXISTS invite_links (
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
);
CREATE INDEX IF NOT EXISTS idx_invite_links_expires
  ON invite_links (expires_at);

-- זיהוי כפילויות לפני העלאה: הביטוי והתנאי זהים לאלה שב-Worker
-- (CONTENT_HASH_SQL). אינדקס חלקי — רק רשומות מדיה.
CREATE INDEX IF NOT EXISTS idx_gallery_documents_content_hash
  ON gallery_documents (collection_name, json_extract(data_json, '$.contentHash'))
  WHERE collection_name IN ('images', 'pendingImages');
