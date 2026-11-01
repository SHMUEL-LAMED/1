// ניהול משתמשים: פעולות מרובות והערות מנהל.
import {
  requireUser
} from "./auth.js";
import {
  backgroundActors
} from "./background.js";
import {
  bumpDataVersions
} from "./data.js";
import {
  requireMaintenanceViewer
} from "./maintenance.js";
import {
  readGalleryDocumentRow
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

// --- מנהל־העל האחרון ---
// מי שמוריד או חוסם מנהל־על מאושר (או מוחק את הפרופיל שלו) עובר כאן: לעולם
// לא את עצמו, ולעולם לא את מנהל־העל המאושר האחרון. אותה בדיקה ב-/data
// וב-/admin/users/batch, כך שהלוח אינו המגן היחיד.
const USER_ROLES = ["viewer", "uploader", "admin", "super_admin"];

function isApprovedSuperAdmin(profile) {
  return profile?.status === "approved" && profile?.role === "super_admin";
}

async function countApprovedSuperAdmins(env, excludeIds = []) {
  const excluded = [...new Set(excludeIds.map(String))];
  const placeholders = excluded.map(() => "?").join(", ");
  const row = await env.GALLERY_DB.prepare(
    `SELECT COUNT(*) AS total FROM gallery_documents
     WHERE collection_name = 'userProfiles' AND json_valid(data_json)
       AND json_extract(data_json, '$.role') = 'super_admin'
       AND json_extract(data_json, '$.status') = 'approved'
       ${excluded.length ? `AND document_id NOT IN (${placeholders})` : ""}`
  ).bind(...excluded).first();
  return Number(row?.total) || 0;
}

// ההחלטה עצמה, בלי מסד: "" כשמותר, אחרת קוד הסירוב. otherSuperAdmins הוא מספר
// מנהלי־העל המאושרים מלבד היעד (נספר רק כשצריך).
export function superAdminRetentionProblem({ existing, next, documentId, actorUid, otherSuperAdmins = 1 }) {
  if (!isApprovedSuperAdmin(existing) || isApprovedSuperAdmin(next)) return "";
  if (documentId === actorUid) return "self_lockout";
  return otherSuperAdmins < 1 ? "last_super_admin" : "";
}

async function assertSuperAdminRetained(env, actor, documentId, existing, next) {
  const base = { existing, next, documentId, actorUid: actor.uid };
  let problem = superAdminRetentionProblem(base);
  if (!problem && isApprovedSuperAdmin(existing) && !isApprovedSuperAdmin(next)) {
    problem = superAdminRetentionProblem({ ...base, otherSuperAdmins: await countApprovedSuperAdmins(env, [documentId]) });
  }
  if (problem === "self_lockout") {
    throw apiError("אי אפשר להוריד או לחסום את החשבון שאיתו אתה מחובר.", 403, "self_lockout");
  }
  if (problem === "last_super_admin") {
    throw apiError("זהו מנהל־העל המאושר האחרון; יש למנות מנהל־על נוסף קודם.", 409, "last_super_admin");
  }
}

// --- פעולה על כמה משתמשים ---
const USERS_BATCH_MAX = 100;
const USERS_BATCH_ACTIONS = new Set(["approve", "block", "unblock", "role"]);
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const USERS_BATCH_ACTIVITY = { approve: "approved_user", block: "changed_block", unblock: "changed_block", role: "changed_role" };
const ROLE_LABELS = { viewer: "דרגה 1", uploader: "דרגה 2", admin: "דרגה 3", super_admin: "דרגה 4" };

function usersBatchFailure(uid, code, message) {
  return { uid, ok: false, code, message };
}

// מה הפעולה עושה לפרופיל אחד, או כישלון עם קוד. אותם שדות שהלוח כותב
// בפעולה הבודדת (admin.js), כדי ששתי הדרכים ישאירו רשומה זהה.
function applyUserBatchAction(profile, action, role, actorUid, now) {
  if (action === "approve") {
    if (profile.status !== "pending") return { error: ["not_pending", "המשתמש אינו ממתין לאישור."] };
    return { next: { ...profile, status: "approved", role, approvedAt: now, approvedBy: actorUid } };
  }
  if (action === "block") {
    if (profile.status === "blocked") return { error: ["already_blocked", "המשתמש כבר חסום."] };
    return { next: { ...profile, status: "blocked", roleBeforeBlock: USER_ROLES.includes(profile.role) ? profile.role : "viewer", blockedAt: now, blockedBy: actorUid } };
  }
  if (action === "unblock") {
    if (profile.status !== "blocked") return { error: ["not_blocked", "המשתמש אינו חסום."] };
    return { next: { ...profile, status: "approved", role: USER_ROLES.includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : "viewer", unblockedAt: now, unblockedBy: actorUid } };
  }
  if (profile.status !== "approved") return { error: ["not_approved", "אפשר לשנות דרגה רק למשתמש מאושר שאינו חסום."] };
  if (profile.role === role) return { error: ["unchanged", "למשתמש כבר יש הדרגה הזו."] };
  return { next: { ...profile, role, roleChangedAt: now, roleChangedBy: actorUid } };
}

// POST /admin/users/batch — { action: approve|block|unblock|role, role?, uids: [...] }.
// מנהל־על אנושי בלבד. כל משתמש מטופל בנפרד, והתשובה מפרטת לכל אחד אם הצליח
// ולמה לא — כישלון של אחד אינו עוצר את השאר.
async function adminUsersBatch(request, env) {
  const actor = await requireMaintenanceViewer(request, env);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const action = String(payload?.action || "");
  if (!USERS_BATCH_ACTIONS.has(action)) throw apiError("הפעולה אינה מוכרת.", 400, "invalid_batch_action");
  const role = action === "approve" ? String(payload?.role || "viewer") : String(payload?.role || "");
  if ((action === "approve" || action === "role") && !USER_ROLES.includes(role)) throw apiError("הדרגה אינה תקינה.", 400, "invalid_role");
  if (!Array.isArray(payload?.uids) || !payload.uids.length) throw apiError("לא נבחרו משתמשים.", 400, "invalid_user_ids");
  if (payload.uids.length > USERS_BATCH_MAX) throw apiError(`אפשר לטפל בעד ${USERS_BATCH_MAX} משתמשים בפעולה אחת.`, 400, "too_many_users");
  const uids = [...new Set(payload.uids.map(value => String(value ?? "")))];
  if (uids.some(uid => !USER_ID_PATTERN.test(uid))) throw apiError("מזהה משתמש אינו תקין.", 400, "invalid_user_ids");

  const results = [];
  const logs = [];
  const now = Date.now();
  for (const uid of uids) {
    try {
      if (uid === actor.uid) {
        results.push(usersBatchFailure(uid, "self_forbidden", "פעולה מרובה אינה חלה על החשבון שלך."));
        continue;
      }
      const row = await readGalleryDocumentRow(env, "userProfiles", uid);
      if (!row) {
        results.push(usersBatchFailure(uid, "not_found", "המשתמש לא נמצא."));
        continue;
      }
      const profile = parseDocumentData(row);
      const { next, error } = applyUserBatchAction(profile, action, role, actor.uid, now);
      if (error) {
        results.push(usersBatchFailure(uid, error[0], error[1]));
        continue;
      }
      await assertSuperAdminRetained(env, actor, uid, profile, next);
      const updatedAt = Math.max(now, (Number(row.updated_at) || 0) + 1);
      const write = await env.GALLERY_DB.prepare(
        `UPDATE gallery_documents SET data_json = ?, updated_at = ?
         WHERE collection_name = 'userProfiles' AND document_id = ? AND updated_at = ?`
      ).bind(JSON.stringify(next), updatedAt, uid, Number(row.updated_at) || 0).run();
      if (write?.meta?.changes != null && Number(write.meta.changes) !== 1) {
        results.push(usersBatchFailure(uid, "document_write_conflict", "הפרופיל השתנה במקביל. רענן ונסה שוב."));
        continue;
      }
      results.push({ uid, ok: true, status: next.status, role: next.role });
      const targetName = String(profile.displayName || profile.email || uid).slice(0, 160);
      const details = action === "approve" ? ROLE_LABELS[role]
        : action === "role" ? `דרגה חדשה: ${role}`
          : action === "block" ? "המשתמש נחסם" : "החסימה הוסרה";
      logs.push({ uid, targetName, details });
    } catch (error) {
      results.push(usersBatchFailure(uid, String(error?.code || "batch_item_failed"), String(error?.message || "הפעולה נכשלה.")));
    }
  }
  // יומן הפעילות: שורה לכל משתמש שהשתנה, כמו בפעולה הבודדת, עם החשבון המאומת.
  for (const [index, entry] of logs.entries()) {
    const logId = `log_${now}_${index}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const log = {
      id: logId, action: USERS_BATCH_ACTIVITY[action], targetType: "user", targetId: entry.uid,
      targetName: entry.targetName, details: String(entry.details || "").slice(0, 400),
      actorUid: actor.uid, actorEmail: actor.email,
      actorName: String(actor.account?.displayName || actor.email || "משתמש").slice(0, 160),
      actorRole: actor.role, createdAt: now
    };
    await env.GALLERY_DB.prepare(
      `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
       VALUES ('activityLogs', ?, ?, ?, ?, ?) ON CONFLICT(collection_name, document_id) DO NOTHING`
    ).bind(logId, JSON.stringify(log), actor.uid, now, now).run();
  }
  if (logs.length) await bumpDataVersions(env, ["userProfiles", "activityLogs"]);
  const succeeded = results.filter(result => result.ok).length;
  const response = json(request, { success: true, action, results, succeeded, failed: results.length - succeeded });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// --- הערות פנימיות על משתמש ---
// מנהל (דרגה 3) ומנהל־על כותבים וקוראים; אף אחד אינו קורא — או כותב — הערות על
// עצמו, גם לא מנהל־על. ההערות אינן ב-/data, אינן ברשימות ואינן במטמון הקצה.
const USER_NOTE_MAX_LENGTH = 2000;
const USER_NOTES_LIST_LIMIT = 200;
const USER_NOTES_PER_USER_MAX = 500;
const USER_NOTE_RATE_LIMIT = 120;
const USER_NOTE_RATE_WINDOW_MS = 60 * 60 * 1000;
const USER_NOTE_ID_PATTERN = /^note_[a-f0-9-]{36}$/;

function noteTargetUid(value) {
  const uid = String(value ?? "");
  if (!USER_ID_PATTERN.test(uid)) throw apiError("מזהה המשתמש אינו תקין.", 400, "invalid_user_id");
  return uid;
}

function assertNotOwnNotes(actor, targetUid) {
  if (targetUid === actor.uid) throw apiError("הערות על החשבון שלך אינן נגישות לך.", 403, "notes_about_self");
}

// טקסט חופשי בלבד: בלי תווי בקרה (חוץ משורה חדשה וטאב) ובלי תווי כיווניות
// שמשנים את סדר התצוגה, עד 2,000 תווים.
export function cleanUserNote(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, USER_NOTE_MAX_LENGTH);
}

function noteView(row, actor) {
  const authorUid = String(row.author_uid || "");
  return {
    id: String(row.note_id),
    body: String(row.body || ""),
    authorUid,
    authorName: String(row.author_name || ""),
    createdAt: Number(row.created_at) || 0,
    canDelete: authorUid === actor.uid || actor.role === "super_admin"
  };
}

// GET /admin/user-notes?uid= · POST /admin/user-notes { uid, body } · DELETE /admin/user-notes/<noteId>
async function adminUserNotes(request, env, url) {
  if (backgroundActors.has(request)) throw apiError("פעולה זו אינה מורשית לתהליך הרקע.", 403, "background_scope_denied");
  const actor = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  let result;
  if (request.method === "GET") {
    const uid = noteTargetUid(url.searchParams.get("uid"));
    assertNotOwnNotes(actor, uid);
    const rows = await env.GALLERY_DB.prepare(
      `SELECT note_id, author_uid, author_name, body, created_at FROM admin_user_notes
       WHERE target_uid = ? ORDER BY created_at DESC, note_id DESC LIMIT ?`
    ).bind(uid, USER_NOTES_LIST_LIMIT).all();
    result = { success: true, uid, notes: (rows.results || []).map(row => noteView(row, actor)) };
  } else if (request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const uid = noteTargetUid(payload?.uid);
    assertNotOwnNotes(actor, uid);
    if (typeof payload?.body === "string" && payload.body.trim().length > USER_NOTE_MAX_LENGTH) {
      throw apiError(`הערה יכולה להכיל עד ${USER_NOTE_MAX_LENGTH} תווים.`, 400, "note_too_long");
    }
    const body = cleanUserNote(payload?.body);
    if (!body) throw apiError("ההערה ריקה.", 400, "empty_note");
    if (!(await readGalleryDocumentRow(env, "userProfiles", uid))) throw apiError("המשתמש לא נמצא.", 404, "not_found");
    const existing = await env.GALLERY_DB.prepare("SELECT COUNT(*) AS total FROM admin_user_notes WHERE target_uid = ?").bind(uid).first();
    if ((Number(existing?.total) || 0) >= USER_NOTES_PER_USER_MAX) throw apiError("למשתמש הזה יש כבר יותר מדי הערות.", 409, "notes_limit");
    await consumeRateLimit(env, `user-notes:${actor.uid}`, USER_NOTE_RATE_LIMIT, USER_NOTE_RATE_WINDOW_MS,
      "נכתבו יותר מדי הערות. המתן מעט ונסה שוב.", "notes_rate_limit_exceeded");
    const row = {
      note_id: `note_${crypto.randomUUID()}`,
      author_uid: actor.uid,
      author_name: String(actor.account?.displayName || actor.email || "מנהל").slice(0, 160),
      body,
      created_at: Date.now()
    };
    await env.GALLERY_DB.prepare(
      "INSERT INTO admin_user_notes (note_id, target_uid, author_uid, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(row.note_id, uid, row.author_uid, row.author_name, row.body, row.created_at).run();
    result = { success: true, uid, note: noteView(row, actor) };
  } else {
    let noteId = "";
    try {
      noteId = decodeURIComponent(url.pathname.slice("/admin/user-notes/".length));
    } catch {
      noteId = "";
    }
    if (!USER_NOTE_ID_PATTERN.test(noteId)) throw apiError("מזהה ההערה אינו תקין.", 400, "invalid_note_id");
    const row = await env.GALLERY_DB.prepare(
      "SELECT note_id, target_uid, author_uid FROM admin_user_notes WHERE note_id = ?"
    ).bind(noteId).first();
    if (!row) throw apiError("ההערה לא נמצאה.", 404, "not_found");
    assertNotOwnNotes(actor, String(row.target_uid));
    if (String(row.author_uid) !== actor.uid && actor.role !== "super_admin") {
      throw apiError("רק מי שכתב את ההערה, או מנהל־על, רשאי למחוק אותה.", 403, "permission_denied");
    }
    await env.GALLERY_DB.prepare("DELETE FROM admin_user_notes WHERE note_id = ?").bind(noteId).run();
    result = { success: true, id: noteId };
  }
  const response = json(request, result);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export {
  USER_ROLES,
  isApprovedSuperAdmin,
  countApprovedSuperAdmins,
  assertSuperAdminRetained,
  USERS_BATCH_MAX,
  USERS_BATCH_ACTIONS,
  USER_ID_PATTERN,
  USERS_BATCH_ACTIVITY,
  ROLE_LABELS,
  usersBatchFailure,
  applyUserBatchAction,
  adminUsersBatch,
  USER_NOTE_MAX_LENGTH,
  USER_NOTES_LIST_LIMIT,
  USER_NOTES_PER_USER_MAX,
  USER_NOTE_RATE_LIMIT,
  USER_NOTE_RATE_WINDOW_MS,
  USER_NOTE_ID_PATTERN,
  noteTargetUid,
  assertNotOwnNotes,
  noteView,
  adminUserNotes
};
