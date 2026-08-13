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
