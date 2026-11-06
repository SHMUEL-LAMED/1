// קישורי הזמנה.
import {
  ensureInitialSuperAdminProfile,
  isInitialSuperAdminHash,
  readUserProfile,
  requireUser,
  resolveAccount
} from "./auth.js";
import {
  INVITE_CREATE_RATE_LIMIT,
  INVITE_CREATE_RATE_WINDOW_MS,
  INVITE_DAY_OPTIONS,
  INVITE_ENDED_AT_SQL,
  INVITE_ID_PATTERN,
  INVITE_LIST_LIMIT,
  INVITE_MAX_ACTIVE,
  INVITE_MAX_USES_LIMIT,
  INVITE_REDEEM_IP_RATE_LIMIT,
  INVITE_REDEEM_RATE_LIMIT,
  INVITE_REDEEM_RATE_WINDOW_MS,
  INVITE_RETENTION_DAYS,
  INVITE_TOKEN_BYTES,
  INVITE_TOKEN_PATTERN,
  MAINTENANCE_DAY_MS
} from "./config.js";
import {
  bumpDataVersions,
  safeDataPart
} from "./data.js";
import {
  randomUrlSafeToken
} from "./drive.js";
import {
  reportingClientBucket
} from "./errors.js";
import {
  readGalleryDocumentRow
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  cleanShortText,
  safeUid
} from "./uploads.js";
import {
  apiError,
  consumeRateLimit,
  json,
  parseDocumentData,
  sha256
} from "./util.js";

// --- קישורי הזמנה לאירוע ---
// מנהל יוצר קישור לתיקייה, בתוקף ליום, שבוע או חודש, ואפשר גם עם תקרת שימושים.
// האסימון (256 ביט) מוחזר פעם אחת בלבד, ביצירה; בשרת נשמר רק SHA-256 שלו, והוא
// לעולם אינו נכתב ליומן. מבקר שפותח את הקישור ומתחבר עם Google מסומן בבקשת
// ההצטרפות "הגיע מהזמנה לאירוע X"; הוא מאושר אוטומטית כצופה רק אם מנהל־על
// סימן "אישור אוטומטי" ביצירת הקישור. צופה מאושר רואה את מה שכל צופה רואה —
// הקישור אינו מעניק שום הרשאה מעבר לזה.

function inviteStatus(row, now = Date.now()) {
  if (Number(row.revoked_at) > 0) return "revoked";
  if (Number(row.expires_at) <= now) return "expired";
  if (Number(row.max_uses) > 0 && Number(row.use_count) >= Number(row.max_uses)) return "exhausted";
  return "active";
}

function inviteView(row, uid, now = Date.now()) {
  return {
    inviteId: String(row.invite_id),
    folderId: String(row.folder_id),
    folderName: String(row.folder_name || ""),
    autoApprove: Number(row.auto_approve) === 1,
    maxUses: Number(row.max_uses) || 0,
    useCount: Number(row.use_count) || 0,
    createdAt: Number(row.created_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
    revokedAt: Number(row.revoked_at) || 0,
    status: inviteStatus(row, now),
    mine: String(row.created_by) === uid
  };
}

function hashInviteToken(token) {
  return sha256(token, { normalize: false });
}

// POST /invites { folderId, days, maxUses, autoApprove }
async function createInvite(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env, `invite-create:${user.uid}`, INVITE_CREATE_RATE_LIMIT, INVITE_CREATE_RATE_WINDOW_MS,
    "נוצרו קישורים רבים. המתן מעט ונסה שוב.", "invite_rate_limit"
  );
  const payload = await request.json().catch(() => ({}));
  const folderId = safeDataPart(payload?.folderId, "מזהה התיקייה");
  const folderRow = folderId === "all" ? null : await readGalleryDocumentRow(env, "folders", folderId);
  if (!folderRow) throw apiError("התיקייה לא נמצאה.", 404, "folder_not_found");
  const folderName = cleanShortText(parseDocumentData(folderRow).name, 120) || "אירוע";
  const days = Number(payload?.days);
  if (!INVITE_DAY_OPTIONS.includes(days)) throw apiError("תוקף הקישור חייב להיות יום, שבוע או חודש.", 400, "invalid_invite_days");
  const rawUses = payload?.maxUses;
  const maxUses = rawUses === undefined || rawUses === null || rawUses === "" ? 0 : Number(rawUses);
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > INVITE_MAX_USES_LIMIT) {
    throw apiError(`מספר השימושים חייב להיות בין 1 ל־${INVITE_MAX_USES_LIMIT}, או ללא הגבלה.`, 400, "invalid_invite_uses");
  }
  if (payload?.autoApprove !== undefined && typeof payload.autoApprove !== "boolean") {
    throw apiError("ערך האישור האוטומטי אינו תקין.", 400, "invalid_invite_auto_approve");
  }
  const autoApprove = payload?.autoApprove === true;
  // אישור משתמשים הוא סמכות של מנהל־על בלבד, ולכן גם קישור שמאשר אוטומטית.
  if (autoApprove && user.role !== "super_admin") {
    throw apiError("רק מנהל־על יכול ליצור קישור עם אישור אוטומטי.", 403, "permission_denied");
  }
  const now = Date.now();
  const active = await env.GALLERY_DB.prepare(
    "SELECT COUNT(*) AS total FROM invite_links WHERE revoked_at = 0 AND expires_at > ?"
  ).bind(now).first();
  if (Number(active?.total) >= INVITE_MAX_ACTIVE) {
    throw apiError(`יש כבר ${INVITE_MAX_ACTIVE} קישורים פעילים. בטל קישורים ישנים ונסה שוב.`, 409, "too_many_invites");
  }
  const token = randomUrlSafeToken(INVITE_TOKEN_BYTES);
  const row = {
    invite_id: randomUrlSafeToken(12),
    token_hash: await hashInviteToken(token),
    folder_id: folderId,
    folder_name: folderName,
    auto_approve: autoApprove ? 1 : 0,
    max_uses: maxUses,
    use_count: 0,
    created_by: user.uid,
    created_at: now,
    expires_at: now + days * MAINTENANCE_DAY_MS,
    revoked_at: 0
  };
  await env.GALLERY_DB.prepare(
    `INSERT INTO invite_links (invite_id, token_hash, folder_id, folder_name, auto_approve, max_uses, use_count, created_by, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`
  ).bind(row.invite_id, row.token_hash, row.folder_id, row.folder_name, row.auto_approve, row.max_uses, row.created_by, row.created_at, row.expires_at).run();
  // האסימון חוזר כאן בלבד. אין דרך לקבל אותו שוב — רק לבטל וליצור חדש.
  return json(request, { success: true, invite: inviteView(row, user.uid, now), token }, 201);
}

// GET /invites — הקישורים הפעילים, ואלה שפגו או בוטלו ב-30 הימים האחרונים.
async function listInvites(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const now = Date.now();
  const rows = (await env.GALLERY_DB.prepare(
    `SELECT invite_id, folder_id, folder_name, auto_approve, max_uses, use_count, created_by, created_at, expires_at, revoked_at
     FROM invite_links WHERE ${INVITE_ENDED_AT_SQL} > ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(now - INVITE_RETENTION_DAYS * MAINTENANCE_DAY_MS, INVITE_LIST_LIMIT).all()).results || [];
  return json(request, {
    success: true,
    canAutoApprove: user.role === "super_admin",
    dayOptions: INVITE_DAY_OPTIONS,
    maxUsesLimit: INVITE_MAX_USES_LIMIT,
    invites: rows.map(row => inviteView(row, user.uid, now))
  });
}

// POST /invites/revoke { inviteId } — מי שיצר את הקישור, או מנהל־על.
async function revokeInvite(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const inviteId = String(payload?.inviteId ?? "");
  if (!INVITE_ID_PATTERN.test(inviteId)) throw apiError("מזהה הקישור אינו תקין.", 400, "invalid_invite_id");
  const row = await env.GALLERY_DB.prepare("SELECT * FROM invite_links WHERE invite_id = ?").bind(inviteId).first();
  if (!row) throw apiError("הקישור לא נמצא.", 404, "invite_not_found");
  if (String(row.created_by) !== user.uid && user.role !== "super_admin") {
    throw apiError("רק מי שיצר את הקישור, או מנהל־על, יכול לבטל אותו.", 403, "permission_denied");
  }
  const now = Date.now();
  await env.GALLERY_DB.prepare("UPDATE invite_links SET revoked_at = ? WHERE invite_id = ? AND revoked_at = 0").bind(now, inviteId).run();
  const updated = await env.GALLERY_DB.prepare("SELECT * FROM invite_links WHERE invite_id = ?").bind(inviteId).first();
  return json(request, { success: true, invite: inviteView(updated, user.uid, now) });
}

// POST /invites/redeem { token } — כל חשבון Google מחובר, גם כזה שעוד ממתין
// לאישור (בשבילו הקישור קיים). מוגבל בקצב לחשבון ולכתובת IP, לפני כל בדיקה.
async function redeemInvite(request, env) {
  const { account } = await resolveAccount(request, env);
  await ensureDatabaseSchema(env);
  const uid = account.localId;
  const limitMessage = "בוצעו ניסיונות רבים. המתן שעה ונסה שוב.";
  await consumeRateLimit(env, `invite-redeem-ip:${reportingClientBucket(request)}`, INVITE_REDEEM_IP_RATE_LIMIT, INVITE_REDEEM_RATE_WINDOW_MS, limitMessage, "invite_rate_limit");
  await consumeRateLimit(env, `invite-redeem:${uid}`, INVITE_REDEEM_RATE_LIMIT, INVITE_REDEEM_RATE_WINDOW_MS, limitMessage, "invite_rate_limit");
  const payload = await request.json().catch(() => ({}));
  const token = typeof payload?.token === "string" ? payload.token : "";
  const invalid = () => apiError("קישור ההזמנה אינו תקף.", 404, "invite_invalid");
  if (!INVITE_TOKEN_PATTERN.test(token)) throw invalid();
  const row = await env.GALLERY_DB.prepare("SELECT * FROM invite_links WHERE token_hash = ?").bind(await hashInviteToken(token)).first();
  if (!row) throw invalid();
  const now = Date.now();
  const status = inviteStatus(row, now);
  if (status === "revoked") throw apiError("קישור ההזמנה בוטל.", 410, "invite_revoked");
  if (status === "expired") throw apiError("תוקף קישור ההזמנה פג.", 410, "invite_expired");

  const initialAdmin = isInitialSuperAdminHash(await sha256(account.email));
  const profile = initialAdmin ? await ensureInitialSuperAdminProfile(account, env) : await readUserProfile(uid, env, account.email);
  if (!profile) throw apiError("פרופיל המשתמש עדיין לא נוצר. רענן את האתר ונסה שוב.", 403, "profile_missing");
  if (profile.status === "blocked") throw apiError("החשבון חסום.", 403, "account_blocked");
  const base = { success: true, folderId: String(row.folder_id), folderName: String(row.folder_name || "") };
  // משתמש מאושר רק מגיע לאירוע; שימוש אינו נספר, והפרופיל אינו משתנה.
  if (profile.status === "approved") return json(request, { ...base, status: "approved", autoApproved: false, alreadyApproved: true });
  // אותו קישור פעם שנייה (רענון, מכשיר אחר) אינו צורך שימוש נוסף.
  if (profile.inviteId === row.invite_id) {
    return json(request, { ...base, status: profile.status || "pending", autoApproved: false });
  }
  if (status === "exhausted") throw apiError("קישור ההזמנה כבר נוצל עד הסוף.", 410, "invite_exhausted");
  // השימוש נספר באטומיות: שני מבקרים בו-זמנית אינם עוברים יחד את התקרה.
  const consumed = await env.GALLERY_DB.prepare(
    `UPDATE invite_links SET use_count = use_count + 1
     WHERE invite_id = ? AND revoked_at = 0 AND expires_at > ? AND (max_uses = 0 OR use_count < max_uses)
     RETURNING use_count`
  ).bind(row.invite_id, now).first();
  if (!consumed) throw apiError("קישור ההזמנה כבר נוצל עד הסוף.", 410, "invite_exhausted");

  const currentStatus = profile.status || "pending";
  // משתמש שנדחה בעבר אינו מאושר דרך קישור — רק מסומן, וההחלטה נשארת אצל מנהל־העל.
  const autoApprove = Number(row.auto_approve) === 1 && currentStatus === "pending";
  const nextProfile = {
    ...profile,
    inviteId: String(row.invite_id),
    inviteFolderId: String(row.folder_id),
    inviteFolderName: String(row.folder_name || ""),
    invitedAt: now,
    inviteAutoApproved: autoApprove,
    ...(autoApprove ? { status: "approved", role: "viewer", approvedAt: now, approvedBy: `invite:${row.invite_id}` } : {})
  };
  await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES ('userProfiles', ?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, document_id) DO UPDATE SET
       data_json = excluded.data_json, owner_uid = excluded.owner_uid, updated_at = excluded.updated_at`
  ).bind(uid, JSON.stringify(nextProfile), uid, now, now).run();
  const logId = `log_${now}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const log = {
    id: logId,
    action: autoApprove ? "invite_auto_approved" : "invite_redeemed",
    targetType: "user",
    targetId: safeUid(uid) || "none",
    targetName: cleanShortText(nextProfile.displayName || account.displayName || "משתמש", 160),
    details: autoApprove
      ? `אושר אוטומטית כצופה מהזמנה לאירוע ${nextProfile.inviteFolderName}`
      : `בקשת הצטרפות מהזמנה לאירוע ${nextProfile.inviteFolderName}`,
    actorUid: uid,
    actorEmail: account.email,
    actorName: cleanShortText(account.displayName || account.email || "משתמש", 160),
    actorRole: "viewer",
    createdAt: now
  };
  await env.GALLERY_DB.prepare(
    `INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at)
     VALUES ('activityLogs', ?, ?, ?, ?, ?) ON CONFLICT(collection_name, document_id) DO NOTHING`
  ).bind(logId, JSON.stringify(log), uid, now, now).run();
  await bumpDataVersions(env, ["userProfiles", "activityLogs"]);
  return json(request, { ...base, status: autoApprove ? "approved" : currentStatus, autoApproved: autoApprove });
}

export {
  inviteStatus,
  inviteView,
  hashInviteToken,
  createInvite,
  listInvites,
  revokeInvite,
  redeemInvite
};
