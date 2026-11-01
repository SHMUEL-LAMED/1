// קבועים ומגבלות משותפים (גדלים, קצבים, גרסאות, מזהי שירותים).

const DEFAULT_GOOGLE_CLIENT_ID = "601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com";
const INITIAL_SUPER_ADMIN_EMAIL_SHA256S = new Set([
  "0c70c93b21ed7d7ac11f8a0e41cf0811b221f8e16524ed71d8b1822661edc137",
  "d2632af59d29239eef52f10e1cfbf38e27c65c55470b355134b1cd1fb4f809d6"
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
// תצוגות מקדימות (variants): גרסאות מוקטנות שנוצרות בדפדפן ונשמרות לצד המקור.
// המכסה חייבת להיות זהה ל-MEDIA_VARIANT_MAX_BYTES שב-media-variants.js.
const MAX_VARIANT_BYTES = 2 * 1024 * 1024;
const MEDIA_VARIANTS_VERSION = 1;
const MEDIA_VARIANT_NAMES = ["thumb", "medium", "poster"];
const MEDIA_VARIANT_MAX_DIMENSION = 4096;
const MEDIA_VARIANTS_RATE_LIMIT = 1500;
const MEDIA_VARIANTS_RATE_WINDOW_MS = 5 * 60 * 1000;
// העלאה בחלקים (R2 multipart). כל חלק מלבד האחרון חייב להיות באותו גודל, ו-R2
// דורש לפחות 5MiB לחלק שאינו האחרון. 8MiB הוא איזון בין מספר הבקשות לבין
// כמה צריך לשלוח מחדש אחרי ניתוק.
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_MAX_PARTS = 10000;
// קובץ שעולה בחלקים יכול להיות גדול מהמגבלה של בקשה אחת: סרטון טלפון ארוך.
const MAX_RESUMABLE_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_RESUMABLE_IMAGE_BYTES = 50 * 1024 * 1024;
// R2 מבטל בעצמו העלאה בחלקים שלא הושלמה אחרי שבעה ימים; השורה במסד נמחקת קודם.
const MULTIPART_SESSION_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const UPLOAD_PART_RATE_LIMIT = 3000;
const UPLOAD_PART_RATE_WINDOW_MS = 10 * 60 * 1000;
// Cloudflare Stream (רשות): פעיל רק כשהוגדרו STREAM_ACCOUNT_ID ו-STREAM_API_TOKEN.
const STREAM_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const STREAM_REQUEST_TIMEOUT_MS = 15000;
const CHAT_HISTORY_LIMIT = 150;
const CHAT_HISTORY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const CHAT_MUTATION_MAX_RETRIES = 6;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_VISION_MODEL = "gpt-5.4-mini";
// שם, כיתוב ותגיות סצנה לתמונה — קריאה אחת למודל עם פלט JSON מובנה (ראו
// generateImageDescription). הטקסונומיה זהה לזו שב-scene-tags.js: ה-Worker
// נפרס כקובץ יחיד ולכן היא מועתקת, ו-scene-tags.test.mjs נועל את ההתאמה.
// התגיות נשמרות כמזהים; המודל רואה ומחזיר את התוויות העבריות.
const SCENE_TAGS = [
  { id: "dance", label: "ריקוד", hint: "רוקדים, במעגל או בשורה" },
  { id: "hakafot", label: "הקפות", hint: "הקפות סביב הבימה, בדרך כלל עם ספרי תורה" },
  { id: "torah", label: "ספר תורה", hint: "ספר תורה נראה בתמונה: נשיאה, הוצאה, קריאה או הגבהה" },
  { id: "lesson", label: "שיעור או דרשה", hint: "אדם מוסר שיעור או נואם מול קהל" },
  { id: "study", label: "לימוד", hint: "לומדים מתוך ספרים, לבד או בחברותא" },
  { id: "prayer", label: "תפילה", hint: "מתפללים בבית הכנסת או במניין" },
  { id: "meal", label: "סעודה", hint: "שולחנות ערוכים, אוכל או כיבוד" },
  { id: "music", label: "נגינה", hint: "כלי נגינה, תזמורת או שירה משותפת" },
  { id: "group", label: "תמונה קבוצתית", hint: "קבוצה שמצטלמת יחד ופונה למצלמה" },
  { id: "children", label: "ילדים", hint: "פעילות שבמרכזה ילדים" },
  { id: "preparations", label: "הכנות", hint: "סידור המקום, קישוט או הכנות לפני האירוע" },
  { id: "overview", label: "מבט כללי", hint: "האולם, המקום או הקהל כולו ממרחק" },
  { id: "other", label: "אחר", hint: "רק כששום תגית אחרת אינה מתאימה" }
];
const SCENE_TAG_OTHER = "other";
const SCENE_TAG_MAX = 4;
const IMAGE_CAPTION_MAX_LENGTH = 140;
// גרסת הכיתוב של ה-AI. כיתוב שנערך ידנית (captionSource: "manual") לעולם אינו נדרס.
const AI_CAPTION_VERSION = 1;
// שדות התיאור ברשומת המדיה. רק מנהל משנה אותם בכתיבה ל-/data; עותק ישן בלי
// השדות משאיר את מה שנשמר (כמו variants ותאריך הצילום).
const IMAGE_DESCRIPTION_FIELDS = ["caption", "sceneTags", "captionSource", "aiCaptionVersion", "aiCaptionGeneratedAt", "captionEditedAt"];
// מכסה אחת לכל האתר: קריאה אחת למודל נותנת שם, כיתוב ותגיות.
const AI_DESCRIPTION_RATE_LIMIT = 600;
const AI_DESCRIPTION_RATE_WINDOW_MS = 60 * 60 * 1000;
const AI_DESCRIPTION_TIMEOUT_MS = 25000;
const FACE_API_VERSION = "1.7.15";
const FACE_API_CDN_BASE = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}`;
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_DRIVE_SITE_URL = "https://shmuel-lamed.github.io/1/";
const DRIVE_STATE_TTL_MS = 10 * 60 * 1000;
const DRIVE_ACCESS_TOKEN_SAFETY_MS = 60 * 1000;
// גרסת הסכימה נשמרת ב-gallery_schema_meta תחת המפתח 'gallery'. כל עלייה היא
// תוספת אידמפוטנטית (CREATE ... IF NOT EXISTS) ב-ensureDatabaseSchema, ולכן מסד
// קיים בכל גרסה קודמת מגיע לגרסה הנוכחית בבקשה הראשונה אחרי הפריסה:
//   3 — אינדקס האימייל (user_email_index) ומילוי חד-פעמי שלו.
//   4 — טביעות הפנים, מצב האינדוקס ושגיאות הלקוח.
//   5 — media_variant_files: רישום קובצי התצוגות המקדימות.
//   6 — אינדקס המיון לפי תאריך הצילום (takenAt, ובלעדיו createdAt).
//   7 — upload_sessions ו-upload_session_parts (העלאה בחלקים שאפשר להמשיך),
//       ו-stream_videos (העותק ב-Cloudflare Stream, כשהוא מוגדר).
//   8 — אנשים בגלריה: face_persons (קבוצה, שם, אישור, הסתרה ומרכז הקבוצה),
//       face_cluster_marks (פרצוף בודד, "לבדיקה" או "לא לקבץ"),
//       face_user_descriptors ("זכור אותי" של "התמונות שלי", רק בהסכמה),
//       ועמודות חדשות: face_people.source / assigned_at ו-image_face_descriptors.box_json.
//       השיוכים הידניים הקיימים נשארים כפי שהם, ולכל קבוצה קיימת נוצרת רשומת אדם.
//   9 — usage_daily (מוני שימוש מצטברים: שורה לכל יום ומדד, מספרים בלבד)
//       ו-admin_user_notes (הערות פנימיות של מנהלים על משתמש, מחוץ ל-userProfiles).
//       שתי טבלאות חדשות בלבד; אף טבלה או עמודה קיימת אינה משתנה.
//   10 — הייתה שמורה לענף התיקיות והתמונות, שלא נזקק לה: תיקיות מקוננות, תמונת
//       שער, סדר ידני ועריכה הם שדות בתוך מסמך ה-JSON, בלי טבלה או עמודה חדשה.
//   11 — משתמשים ואנשים: upload_rejections (תיעוד דחייה מינימלי ל"ההעלאות שלי",
//       נמחק אחרי 60 יום), face_manual_tags (תיוג ידני של אדם בתמונה שהזיהוי
//       פספס), invite_links (קישורי הזמנה לאירוע; רק גיבוב האסימון נשמר) ואינדקס
//       על contentHash לזיהוי כפילויות לפני העלאה. רק תוספות — אין שינוי בנתונים.
// כל הטבלאות והאינדקסים נוצרים ב-CREATE ... IF NOT EXISTS בכל ריצה שבה הגרסה
// הרשומה נמוכה מהנוכחית, ולכן מסד בגרסה 8 (לפני ניהול המשתמשים) ומסד בגרסה 9
// (אחריו) מגיעים שניהם ל-11 באותה ריצה: מה שכבר קיים נשאר, מה שחסר נוצר.
// גרסאות הנתונים של שכבת הנתונים (data_version:<אוסף>, ראו bumpDataVersion)
// נשמרות באותה טבלה תחת מפתחות אחרים, והעלאת הסכימה אינה נוגעת בהן.
const DATABASE_SCHEMA_VERSION = 11;
// גודל עמוד ברשימת מסמכים. הלקוח מבקש עמודים ומצרף אותם, כך שאין תקרה
// על המספר הכולל של המסמכים שנטענים — רק על גודל התשובה הבודדת.
const DATA_PAGE_MAX_LIMIT = 1000;
const DATA_PAGE_DEFAULT_LIMIT = 500;
// שדות שאפשר לסנן ולקבץ לפיהם ב-SQL (json_extract). הרשימה סגורה כדי
// ששם שדה מהכתובת לעולם לא ייכנס לשאילתה כמות שהוא.
const DATA_FILTER_FIELDS = ["folderId", "status", "mediaType", "uploadedBy"];
// מיון לפי תאריך הצילום: takenAt, ולרשומה שאין לה — זמן ההעלאה.
const TAKEN_AT_ORDER_SQL = "CAST(COALESCE(json_extract(data_json, '$.takenAt'), json_extract(data_json, '$.createdAt'), 0) AS REAL)";
// תאריך הצילום (takenAt) נבדק בכל כתיבה של רשומת מדיה: מספר בין 1971 לעכשיו
// (ועוד יומיים לשעון מצלמה שמקדים). ערך פסול נמחק, והרשומה ממוינת לפי זמן
// ההעלאה כמו קודם.
const TAKEN_AT_MIN = Date.UTC(1971, 0, 1);
const TAKEN_AT_FUTURE_SLACK_MS = 2 * 24 * 60 * 60 * 1000;
const TAKEN_AT_SOURCES = new Set(["exif", "video", "drive", "none"]);
const CAPTURE_FIELDS = ["takenAt", "takenDate", "takenAtOffset", "takenAtSource"];
// ריצת ההשלמה: גודל קריאת טווח מקובץ ב-R2, וכמה רשומות בבקשת עדכון אחת.
const MEDIA_PROBE_MAX_BYTES = 256 * 1024;
const TAKEN_AT_BATCH_MAX = 50;
// מספר המזהים המרבי בבקשה אחת של ?ids= (למשל רשימת המועדפים).
const DATA_IDS_MAX = 200;
// רשימות ומונים נשמרים במטמון הקצה (Cache API) לחמש דקות. המפתח כולל את
// גרסת הנתונים של האוסף, ולכן כל כתיבה מפילה את המטמון מיד.
const DATA_CACHE_TTL_SECONDS = 300;
// אוספים אישיים אינם נכנסים למטמון הקצה לעולם.
const EDGE_CACHE_EXCLUDED_COLLECTIONS = new Set(["userFavorites", "userPreferences"]);
// כל בקשה ל־/ai-search צורכת מכסה אחת, כולל ניסיונות חוזרים אחרי 429.
// חיפוש מלא הוא עד 10 קבוצות, וכל קבוצה עשויה להגיע לשישה ניסיונות —
// כלומר עד 60 בקשות. המגבלה גבוהה מכך כדי שחיפוש אחד לא יחסום את עצמו.
const AI_SEARCH_RATE_LIMIT = 80;
const AI_SEARCH_RATE_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_RATE_LIMIT = 60;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RATE_LIMIT = 30;
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000;
// ניטור שגיאות: דיווחים מהאתר ומה-Worker נשמרים מקובצים לפי טביעת אצבע,
// שורה אחת לכל סוג תקלה עם מונה — ולא יומן שגדל בלי גבול.
const CLIENT_ERROR_RATE_LIMIT = 30;
const CLIENT_ERROR_RATE_WINDOW_MS = 60 * 60 * 1000;
const CLIENT_ERROR_MESSAGE_MAX_LENGTH = 500;
const CLIENT_ERROR_STACK_MAX_LENGTH = 4000;
const CLIENT_ERROR_URL_MAX_LENGTH = 500;
const CLIENT_ERROR_USER_AGENT_MAX_LENGTH = 300;
const CLIENT_ERROR_CONTEXT_MAX_LENGTH = 600;
const CLIENT_ERROR_SCOPE_MAX_LENGTH = 60;
const CLIENT_ERROR_LIST_DEFAULT_LIMIT = 100;
const CLIENT_ERROR_LIST_MAX_LIMIT = 500;
const CLIENT_ERROR_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLIENT_ERROR_RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLIENT_ERROR_ADMIN_RATE_LIMIT = 120;
const CLIENT_ERROR_ADMIN_RATE_WINDOW_MS = 60 * 1000;

// --- טביעות פנים בענן ---
// כל תמונה מעובדת פעם אחת בלבד בדפדפן של המנהל, והטביעות המספריות נשמרות
// ב-D1. חיפוש רגיל שולח רק את הטביעה של תמונת החיפוש, וההשוואה מתבצעת כאן —
// כך שהדפדפן אינו מוריד שוב את תמונות הגלריה.
// שינוי הערך מסמן את כל הטביעות הקיימות כשייכות לגרסה ישנה, והאינדוקס
// יריץ מחדש רק את מה שנדרש לגרסה החדשה.
const FACE_MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";
const FACE_DESCRIPTOR_LENGTH = 128;
// ערכי הסף זהים לאלה ששימשו בהשוואה בדפדפן. מרחק קטן יותר = דמיון גבוה יותר.
// חיפוש פנים הוא פעולה שבה false-positive גרוע בהרבה מתוצאה חסרה.
// לכן מחזירים רק התאמות מחמירות; הסף הישן 0.62 החזיר גם פנים דומות של
// אנשים אחרים, ובגלריות צפופות היה עלול להיראות כאילו כל התמונות תואמות.
const FACE_MATCH_THRESHOLD = 0.48;
const FACE_STRONG_MATCH_THRESHOLD = 0.48;
// טביעה אמיתית של face-api מורכבת מערכים קטנים שאורך הווקטור שלהם קרוב ל-1.
// הטווחים כאן רחבים בהרבה מהמצוי בפועל, ועדיין פוסלים אשפה או וקטור אפסים.
const FACE_DESCRIPTOR_MAX_COMPONENT = 5;
const FACE_DESCRIPTOR_MIN_NORM = 0.1;
const FACE_DESCRIPTOR_MAX_NORM = 12;
const FACE_SEARCH_DEFAULT_LIMIT = 60;
const FACE_SEARCH_MAX_LIMIT = 200;
const FACE_SEARCH_RATE_LIMIT = 40;
const FACE_SEARCH_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_INDEX_RATE_LIMIT = 1200;
const FACE_INDEX_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_INDEX_MAX_IMAGES_PER_REQUEST = 25;
const FACE_INDEX_MAX_FACES_PER_IMAGE = 20;
const FACE_INDEX_MAX_ATTEMPTS = 3;
const FACE_INDEX_PENDING_MAX_IDS = 500;
// קריאת הטביעות לחיפוש מתבצעת בעמודים כדי שתשובת D1 תישאר קטנה.
const FACE_DESCRIPTOR_PAGE_SIZE = 250;
const FACE_DESCRIPTOR_SCAN_LIMIT = 200000;
const FACE_ID_QUERY_CHUNK = 100;

// --- אנשים בגלריה: קיבוץ אוטומטי, שמות ואלבום לכל אדם ---
// כל פרצוף חדש נבדק מול מרכז הקבוצה (ממוצע הטביעות) של כל אדם, ומול פרצופים
// בודדים שעדיין לא שויכו. המרחק אוקלידי, כמו בחיפוש. ממוצע של טביעות קרוב
// לכל אחת מהן יותר משהן קרובות זו לזו, ולכן 0.5 מול מרכז הוא סף שמרני ביחס
// ל-0.6 המקובל לזוג פרצופים במודל הזה. מעבר לזה, השיוך האוטומטי מחייב פער:
// האדם השני הכי קרוב חייב להיות רחוק לפחות ב-FACE_CLUSTER_MARGIN. פרצוף שנופל
// בין שני אנשים, או קרוב לאדם אך לא מספיק (עד FACE_CLUSTER_REVIEW_DISTANCE),
// נכנס לתור "לבדיקה" ואינו משויך עד שמנהל מחליט.
const FACE_CLUSTER_JOIN_DISTANCE = 0.5;
const FACE_CLUSTER_REVIEW_DISTANCE = 0.58;
const FACE_CLUSTER_MARGIN = 0.05;
// כמה פרצופים חדשים מעובדים בריצה אחת. הריצה ממשיכה מהמקום שנעצרה.
const FACE_CLUSTER_BATCH = 150;
const FACE_CLUSTER_BATCH_MAX = 300;
// כל קבוצה מוצעת שיש בה פרצוף מוצגת בהצעות. קבוצה אוטומטית נולדת עם שני
// פרצופים; קבוצה של פרצוף אחד נוצרת רק מפעולה של מנהל ("העבר לקבוצה חדשה")
// או אחרי שהוסרו ממנה פרצופים — וגם לה צריך להיות אפשר לתת שם.
const FACE_CLUSTER_MIN_SUGGESTED = 1;
// נעילה רכה: שתי ריצות קיבוץ אינן רצות במקביל (למשל אינדוקס משני דפדפנים).
const FACE_CLUSTER_LOCK_MS = 60 * 1000;
const FACE_CLUSTER_SEED_PAGE_SIZE = 1000;
const FACE_CLUSTER_SEED_SCAN_LIMIT = 100000;
const FACE_CLUSTER_RATE_LIMIT = 300;
const FACE_CLUSTER_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_GROUPS_RATE_LIMIT = 240;
const FACE_GROUPS_RATE_WINDOW_MS = 60 * 1000;
const FACE_GROUPS_PAGE_SIZE = 24;
const FACE_GROUP_SAMPLE_FACES = 6;
const FACE_PERSONS_RATE_LIMIT = 300;
const FACE_PERSONS_RATE_WINDOW_MS = 5 * 60 * 1000;
const FACE_PERSONS_LIST_LIMIT = 1000;
const FACE_PERSON_MEDIA_LIMIT = 2000;
const FACE_PERSON_NAME_MAX_LENGTH = 60;
const FACE_PERSON_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const FACE_BOXES_MAX_PER_REQUEST = 50;
// "התמונות שלי": שמירה, מחיקה וקריאה של הטביעה האישית (רק בהסכמה מפורשת).
const FACE_ME_RATE_LIMIT = 30;
const FACE_ME_RATE_WINDOW_MS = 10 * 60 * 1000;
// כל שינוי בשיוכים, בשמות או בהסתרה מקדם את גרסת הנתונים הזו, והיא חלק
// ממפתח מטמון הקצה של רשימת האנשים ושל האלבום של כל אדם.
const FACE_PEOPLE_DATA_VERSION = "facePeople";
const FACE_VIEWER_ROLES = ["viewer", "uploader", "admin", "super_admin"];
// תיוג ידני של אדם בתמונה (POST /face/tags): תקרה לתמונה אחת.
const FACE_TAGS_MAX_PER_IMAGE = 30;

// --- משתמשים: "ההעלאות שלי", כפילויות והזמנות לאירוע ---
const MY_UPLOADS_LIMIT = 200;
const MY_UPLOADS_RATE_LIMIT = 60;
const MY_UPLOADS_RATE_WINDOW_MS = 10 * 60 * 1000;
// תיעוד דחייה נשמר חודשיים: מספיק כדי שהמעלה יראה מה נדחה ולמה, ולא יותר.
const UPLOAD_REJECTION_RETENTION_DAYS = 60;
const UPLOAD_REJECTION_REASON_MAX_LENGTH = 300;
const UPLOAD_REJECT_RATE_LIMIT = 600;
const UPLOAD_REJECT_RATE_WINDOW_MS = 10 * 60 * 1000;
// טביעת התוכן של קובץ: SHA-256 מלא (hex), או "s1:" — טביעה מדגימות שדפדפן
// ישן חישב לקובץ מעל 64MB. אחרת השדה נמחק מהרשומה.
const CONTENT_HASH_PATTERN = /^(?:s1:)?[a-f0-9]{64}$/;
const CONTENT_HASH_SQL = "json_extract(data_json, '$.contentHash')";
const CONTENT_HASH_COLLECTIONS_SQL = "collection_name IN ('images', 'pendingImages')";
const DUPLICATE_CHECK_MAX_HASHES = 100;
const DUPLICATE_CHECK_RATE_LIMIT = 120;
const DUPLICATE_CHECK_RATE_WINDOW_MS = 10 * 60 * 1000;
// קישורי הזמנה: תוקף של יום, שבוע או חודש, ותקרת שימושים אופציונלית.
const INVITE_DAY_OPTIONS = [1, 7, 30];
const INVITE_MAX_USES_LIMIT = 1000;
const INVITE_TOKEN_BYTES = 32;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITE_ID_PATTERN = /^[A-Za-z0-9_-]{12,32}$/;
const INVITE_MAX_ACTIVE = 100;
const INVITE_LIST_LIMIT = 200;
// קישור שפג או בוטל נשאר ברשימה עוד 30 יום, ואחר כך נמחק בתחזוקה היומית.
const INVITE_RETENTION_DAYS = 30;
// מתי קישור הפסיק לעבוד: מועד הביטול, אם בוטל לפני שפג, ואחרת מועד התפוגה.
const INVITE_ENDED_AT_SQL = "CASE WHEN revoked_at > 0 AND revoked_at < expires_at THEN revoked_at ELSE expires_at END";
const INVITE_CREATE_RATE_LIMIT = 30;
const INVITE_CREATE_RATE_WINDOW_MS = 60 * 60 * 1000;
// מימוש הזמנה: לכל חשבון, ובנוסף לכל כתובת IP — כדי שניחוש אסימונים לא
// יהיה אפשרי גם מכמה חשבונות.
const INVITE_REDEEM_RATE_LIMIT = 10;
const INVITE_REDEEM_IP_RATE_LIMIT = 30;
const INVITE_REDEEM_RATE_WINDOW_MS = 60 * 60 * 1000;
// שדות ההזמנה בפרופיל: רק השרת כותב אותם (POST /invites/redeem).
const INVITE_PROFILE_FIELDS = ["inviteId", "inviteFolderId", "inviteFolderName", "invitedAt", "inviteAutoApproved"];

const FACE_ASSETS = new Map([
  ["face-api.js", { upstreamPath: "dist/face-api.js", contentType: "application/javascript; charset=utf-8" }],
  ["model/ssd_mobilenetv1_model-weights_manifest.json", { upstreamPath: "model/ssd_mobilenetv1_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/ssd_mobilenetv1_model.bin", { upstreamPath: "model/ssd_mobilenetv1_model.bin", contentType: "application/octet-stream" }],
  ["model/face_landmark_68_model-weights_manifest.json", { upstreamPath: "model/face_landmark_68_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/face_landmark_68_model.bin", { upstreamPath: "model/face_landmark_68_model.bin", contentType: "application/octet-stream" }],
  ["model/face_recognition_model-weights_manifest.json", { upstreamPath: "model/face_recognition_model-weights_manifest.json", contentType: "application/json; charset=utf-8" }],
  ["model/face_recognition_model.bin", { upstreamPath: "model/face_recognition_model.bin", contentType: "application/octet-stream" }]
]);

// מקורות הייצור הקבועים. מקורות אתר הניסוי (*.pages.dev) ו-localhost אינם
// רשומים כאן אלא נבדקים ב-isAllowedOrigin, כי הם תלויים במשתני הסביבה.
const ALLOWED_ORIGINS = new Set([
  "https://shmuel-lamed.github.io",
  "https://0534169095-star.github.io",
  "https://xn--4dbjbascrao3i.com",
  "https://www.xn--4dbjbascrao3i.com"
]);

// --- סביבת ההרצה: ייצור או ניסוי ---
// שני Workers רצים מאותו קוד: simchas-gallery-api (ייצור) ו-simchas-gallery-api-staging
// (ניסוי), לכל אחד D1 ו-R2 משלו. משתנה הטקסט ENVIRONMENT מבדיל ביניהם; כשהוא
// חסר זה הייצור, כך שה-Worker הקיים אינו דורש הגדרה חדשה. הערך מוחזר ב-/health.
const ENVIRONMENT_PRODUCTION = "production";
const ENVIRONMENT_STAGING = "staging";
// שם פרויקט Cloudflare Pages של אתר הניסוי (משתנה STAGING_PAGES_PROJECT). המקור
// https://<project>.pages.dev ופריסות התצוגה המקדימה https://<hash>.<project>.pages.dev
// מורשים ב-CORS. ערך שאינו שם פרויקט תקין של Pages מתעלמים ממנו.
const DEFAULT_STAGING_PAGES_PROJECT = "simchas-gallery-staging";
const PAGES_PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

// יום אחד במילישניות (תחזוקה וסריקת האחסון).
const MAINTENANCE_DAY_MS = 24 * 60 * 60 * 1000;

export {
  DEFAULT_GOOGLE_CLIENT_ID,
  INITIAL_SUPER_ADMIN_EMAIL_SHA256S,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_CHAT_FILE_BYTES,
  MAX_VARIANT_BYTES,
  MEDIA_VARIANTS_VERSION,
  MEDIA_VARIANT_NAMES,
  MEDIA_VARIANT_MAX_DIMENSION,
  MEDIA_VARIANTS_RATE_LIMIT,
  MEDIA_VARIANTS_RATE_WINDOW_MS,
  MULTIPART_PART_SIZE,
  MULTIPART_MAX_PARTS,
  MAX_RESUMABLE_VIDEO_BYTES,
  MAX_RESUMABLE_IMAGE_BYTES,
  MULTIPART_SESSION_TTL_MS,
  UPLOAD_PART_RATE_LIMIT,
  UPLOAD_PART_RATE_WINDOW_MS,
  STREAM_API_BASE,
  STREAM_REQUEST_TIMEOUT_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_HISTORY_RETENTION_MS,
  CHAT_MUTATION_MAX_RETRIES,
  OPENAI_RESPONSES_URL,
  OPENAI_VISION_MODEL,
  SCENE_TAGS,
  SCENE_TAG_OTHER,
  SCENE_TAG_MAX,
  IMAGE_CAPTION_MAX_LENGTH,
  AI_CAPTION_VERSION,
  IMAGE_DESCRIPTION_FIELDS,
  AI_DESCRIPTION_RATE_LIMIT,
  AI_DESCRIPTION_RATE_WINDOW_MS,
  AI_DESCRIPTION_TIMEOUT_MS,
  FACE_API_VERSION,
  FACE_API_CDN_BASE,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  DEFAULT_DRIVE_SITE_URL,
  DRIVE_STATE_TTL_MS,
  DRIVE_ACCESS_TOKEN_SAFETY_MS,
  DATABASE_SCHEMA_VERSION,
  DATA_PAGE_MAX_LIMIT,
  DATA_PAGE_DEFAULT_LIMIT,
  DATA_FILTER_FIELDS,
  TAKEN_AT_ORDER_SQL,
  TAKEN_AT_MIN,
  TAKEN_AT_FUTURE_SLACK_MS,
  TAKEN_AT_SOURCES,
  CAPTURE_FIELDS,
  MEDIA_PROBE_MAX_BYTES,
  TAKEN_AT_BATCH_MAX,
  DATA_IDS_MAX,
  DATA_CACHE_TTL_SECONDS,
  EDGE_CACHE_EXCLUDED_COLLECTIONS,
  AI_SEARCH_RATE_LIMIT,
  AI_SEARCH_RATE_WINDOW_MS,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS,
  EMAIL_RATE_LIMIT,
  EMAIL_RATE_WINDOW_MS,
  CLIENT_ERROR_RATE_LIMIT,
  CLIENT_ERROR_RATE_WINDOW_MS,
  CLIENT_ERROR_MESSAGE_MAX_LENGTH,
  CLIENT_ERROR_STACK_MAX_LENGTH,
  CLIENT_ERROR_URL_MAX_LENGTH,
  CLIENT_ERROR_USER_AGENT_MAX_LENGTH,
  CLIENT_ERROR_CONTEXT_MAX_LENGTH,
  CLIENT_ERROR_SCOPE_MAX_LENGTH,
  CLIENT_ERROR_LIST_DEFAULT_LIMIT,
  CLIENT_ERROR_LIST_MAX_LIMIT,
  CLIENT_ERROR_RECENT_WINDOW_MS,
  CLIENT_ERROR_RESOLVED_RETENTION_MS,
  CLIENT_ERROR_ADMIN_RATE_LIMIT,
  CLIENT_ERROR_ADMIN_RATE_WINDOW_MS,
  FACE_MODEL_VERSION,
  FACE_DESCRIPTOR_LENGTH,
  FACE_MATCH_THRESHOLD,
  FACE_STRONG_MATCH_THRESHOLD,
  FACE_DESCRIPTOR_MAX_COMPONENT,
  FACE_DESCRIPTOR_MIN_NORM,
  FACE_DESCRIPTOR_MAX_NORM,
  FACE_SEARCH_DEFAULT_LIMIT,
  FACE_SEARCH_MAX_LIMIT,
  FACE_SEARCH_RATE_LIMIT,
  FACE_SEARCH_RATE_WINDOW_MS,
  FACE_INDEX_RATE_LIMIT,
  FACE_INDEX_RATE_WINDOW_MS,
  FACE_INDEX_MAX_IMAGES_PER_REQUEST,
  FACE_INDEX_MAX_FACES_PER_IMAGE,
  FACE_INDEX_MAX_ATTEMPTS,
  FACE_INDEX_PENDING_MAX_IDS,
  FACE_DESCRIPTOR_PAGE_SIZE,
  FACE_DESCRIPTOR_SCAN_LIMIT,
  FACE_ID_QUERY_CHUNK,
  FACE_CLUSTER_JOIN_DISTANCE,
  FACE_CLUSTER_REVIEW_DISTANCE,
  FACE_CLUSTER_MARGIN,
  FACE_CLUSTER_BATCH,
  FACE_CLUSTER_BATCH_MAX,
  FACE_CLUSTER_MIN_SUGGESTED,
  FACE_CLUSTER_LOCK_MS,
  FACE_CLUSTER_SEED_PAGE_SIZE,
  FACE_CLUSTER_SEED_SCAN_LIMIT,
  FACE_CLUSTER_RATE_LIMIT,
  FACE_CLUSTER_RATE_WINDOW_MS,
  FACE_GROUPS_RATE_LIMIT,
  FACE_GROUPS_RATE_WINDOW_MS,
  FACE_GROUPS_PAGE_SIZE,
  FACE_GROUP_SAMPLE_FACES,
  FACE_PERSONS_RATE_LIMIT,
  FACE_PERSONS_RATE_WINDOW_MS,
  FACE_PERSONS_LIST_LIMIT,
  FACE_PERSON_MEDIA_LIMIT,
  FACE_PERSON_NAME_MAX_LENGTH,
  FACE_PERSON_ID_PATTERN,
  FACE_BOXES_MAX_PER_REQUEST,
  FACE_ME_RATE_LIMIT,
  FACE_ME_RATE_WINDOW_MS,
  FACE_PEOPLE_DATA_VERSION,
  FACE_VIEWER_ROLES,
  FACE_TAGS_MAX_PER_IMAGE,
  MY_UPLOADS_LIMIT,
  MY_UPLOADS_RATE_LIMIT,
  MY_UPLOADS_RATE_WINDOW_MS,
  UPLOAD_REJECTION_RETENTION_DAYS,
  UPLOAD_REJECTION_REASON_MAX_LENGTH,
  UPLOAD_REJECT_RATE_LIMIT,
  UPLOAD_REJECT_RATE_WINDOW_MS,
  CONTENT_HASH_PATTERN,
  CONTENT_HASH_SQL,
  CONTENT_HASH_COLLECTIONS_SQL,
  DUPLICATE_CHECK_MAX_HASHES,
  DUPLICATE_CHECK_RATE_LIMIT,
  DUPLICATE_CHECK_RATE_WINDOW_MS,
  INVITE_DAY_OPTIONS,
  INVITE_MAX_USES_LIMIT,
  INVITE_TOKEN_BYTES,
  INVITE_TOKEN_PATTERN,
  INVITE_ID_PATTERN,
  INVITE_MAX_ACTIVE,
  INVITE_LIST_LIMIT,
  INVITE_RETENTION_DAYS,
  INVITE_ENDED_AT_SQL,
  INVITE_CREATE_RATE_LIMIT,
  INVITE_CREATE_RATE_WINDOW_MS,
  INVITE_REDEEM_RATE_LIMIT,
  INVITE_REDEEM_IP_RATE_LIMIT,
  INVITE_REDEEM_RATE_WINDOW_MS,
  INVITE_PROFILE_FIELDS,
  FACE_ASSETS,
  ALLOWED_ORIGINS,
  ENVIRONMENT_PRODUCTION,
  ENVIRONMENT_STAGING,
  DEFAULT_STAGING_PAGES_PROJECT,
  PAGES_PROJECT_NAME_PATTERN,
  LOCAL_DEVELOPMENT_HOSTNAMES,
  MAINTENANCE_DAY_MS
};
