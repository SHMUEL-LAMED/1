// צ'אט: הודעות, קבצים מצורפים וגיזום היסטוריה.
import {
  dataActor
} from "./auth.js";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_HISTORY_RETENTION_MS,
  CHAT_MUTATION_MAX_RETRIES,
  MAX_CHAT_FILE_BYTES
} from "./config.js";
import {
  bumpDataVersion
} from "./data.js";
import {
  mediaUrl,
  validateObjectKey
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  apiError,
  json,
  parseDocumentData
} from "./util.js";

function chatMessageId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) throw apiError("מזהה ההודעה אינו תקין.", 400, "invalid_message_id");
  return id;
}

function chatAttachmentFromPayload(value, conversationUid, request, env) {
  if (!value || typeof value !== "object") return null;
  const key = validateObjectKey(value.key);
  const keyParts = key.split("/");
  if (keyParts[0] !== "chat" || keyParts[1] !== conversationUid) {
    throw apiError("הקובץ המצורף אינו שייך לשיחה הזו.", 403, "attachment_conversation_mismatch");
  }
  return {
    key,
    url: mediaUrl(request, key, env),
    name: String(value.name || "קובץ").replace(/[\r\n]/g, " ").slice(0, 180),
    type: String(value.type || "application/octet-stream").slice(0, 120),
    size: Math.max(0, Math.min(MAX_CHAT_FILE_BYTES, Number(value.size) || 0)),
    kind: value.kind === "image" ? "image" : "file"
  };
}

function sanitizeNewChatMessage(value, actor, conversationUid, request, env) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError("מבנה ההודעה אינו תקין.", 400, "invalid_chat_message");
  }
  const isSuperAdmin = actor.initialAdmin || (actor.status === "approved" && actor.role === "super_admin");
  const direction = isSuperAdmin ? "admin_to_user" : "user_to_admin";
  const text = String(value.text || "").trim().slice(0, 1500);
  const attachment = value.attachment ? chatAttachmentFromPayload(value.attachment, conversationUid, request, env) : null;
  const stickerId = String(value?.sticker?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  const sticker = stickerId ? { id: stickerId } : null;
  if (!text && !attachment && !sticker) {
    throw apiError("אי אפשר לשלוח הודעה ריקה.", 400, "empty_chat_message");
  }
  const now = Date.now();
  return {
    id: chatMessageId(value.id),
    text,
    direction,
    sender: String(actor.account?.displayName || actor.email || (isSuperAdmin ? "מנהל הגלריה" : "משתמש")).slice(0, 160),
    senderUid: actor.uid,
    recipientUid: isSuperAdmin ? conversationUid : "gallery-admin",
    sentAt: now,
    read: !isSuperAdmin,
    readAt: isSuperAdmin ? null : now,
    readByAdmin: isSuperAdmin,
    readByAdminAt: isSuperAdmin ? now : null,
    attachment,
    sticker,
    allowReply: true
  };
}

function chatMessageTime(message) {
  const numeric = Number(message?.sentAt);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(message?.sentAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pruneChatHistory(messages, now = Date.now()) {
  const cutoff = now - CHAT_HISTORY_RETENTION_MS;
  const seen = new Set();
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message && typeof message === "object")
    .sort((left, right) => chatMessageTime(right) - chatMessageTime(left))
    .filter(message => {
      const id = String(message.id || "");
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      const unread = (message.direction === "user_to_admin" && message.readByAdmin !== true) ||
        (message.direction !== "user_to_admin" && message.read !== true);
      return unread || chatMessageTime(message) >= cutoff;
    })
    .slice(0, CHAT_HISTORY_LIMIT);
}

function chatAttachmentKeys(messages) {
  const keys = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const attachment of [message?.attachment, message?.reply?.attachment]) {
      const key = String(attachment?.key || attachment?.r2Key || "");
      if (key) keys.add(key);
    }
  }
  return keys;
}

async function cleanupRemovedChatAttachments(env, removedKeys) {
  for (const key of removedKeys) {
    try {
      validateObjectKey(key);
      const object = await env.GALLERY_BUCKET.head(key);
      if (!object) continue;
      if (key.startsWith("chat/") || object.customMetadata?.context === "chat") {
        await env.GALLERY_BUCKET.delete(key);
      }
    } catch (error) {
      console.warn("Chat attachment cleanup skipped", String(key).slice(0, 180), error?.message || error);
    }
  }
}

async function handleChatMessages(request, env) {
  await ensureDatabaseSchema(env);
  const actor = await dataActor(request, env);
  const approved = actor.initialAdmin || actor.status === "approved";
  const isSuperAdmin = approved && (actor.initialAdmin || actor.role === "super_admin");
  if (!approved) throw apiError("החשבון עדיין אינו מאושר.", 403, "account_not_approved");

  const payload = await request.json().catch(() => ({}));
  const conversationUid = String(payload.conversationUid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!conversationUid) throw apiError("מזהה השיחה אינו תקין.", 400, "invalid_conversation");
  if (conversationUid !== actor.uid && !isSuperAdmin) {
    throw apiError("אין הרשאה לעדכן את השיחה הזו.", 403, "permission_denied");
  }

  const action = String(payload.action || "");
  if (!["append", "mark_read", "delete"].includes(action)) {
    throw apiError("פעולת הצ׳אט אינה נתמכת.", 400, "invalid_chat_action");
  }

  for (let attempt = 0; attempt < CHAT_MUTATION_MAX_RETRIES; attempt += 1) {
    const row = await env.GALLERY_DB.prepare(
      "SELECT data_json, updated_at FROM gallery_documents WHERE collection_name = 'userProfiles' AND document_id = ?"
    ).bind(conversationUid).first();
    if (!row) throw apiError("פרופיל השיחה לא נמצא.", 404, "conversation_not_found");

    const profile = parseDocumentData(row);
    const originalMessages = Array.isArray(profile.messages) ? profile.messages : [];
    let candidateMessages = originalMessages;

    if (action === "append") {
      const message = sanitizeNewChatMessage(payload.message, actor, conversationUid, request, env);
      const existing = originalMessages.find(item => String(item?.id || "") === message.id);
      candidateMessages = existing ? originalMessages : [message, ...originalMessages];
    } else if (action === "mark_read") {
      const readAt = Date.now();
      candidateMessages = originalMessages.map(message => {
        if (isSuperAdmin && message?.direction === "user_to_admin" && message.readByAdmin !== true) {
          return { ...message, readByAdmin: true, readByAdminAt: readAt };
        }
        if (isSuperAdmin && message?.reply && message.reply.readByAdmin !== true) {
          return { ...message, reply: { ...message.reply, readByAdmin: true, readByAdminAt: readAt } };
        }
        if (!isSuperAdmin && message?.direction !== "user_to_admin" && message.read !== true) {
          return { ...message, read: true, readAt };
        }
        return message;
      });
    } else {
      const messageId = chatMessageId(payload.messageId);
      candidateMessages = originalMessages.filter(message => String(message?.id || "") !== messageId);
    }

    const nextMessages = pruneChatHistory(candidateMessages);
    const nextProfile = {
      ...profile,
      messages: nextMessages,
      ...(action === "append" && !isSuperAdmin ? { supportStatus: "open" } : {})
    };
    const previousUpdatedAt = Number(row.updated_at) || 0;
    const nextUpdatedAt = Math.max(Date.now(), previousUpdatedAt + 1);
    const updateResult = await env.GALLERY_DB.prepare(
      `UPDATE gallery_documents
       SET data_json = ?, updated_at = ?
       WHERE collection_name = 'userProfiles' AND document_id = ? AND updated_at = ?`
    ).bind(JSON.stringify(nextProfile), nextUpdatedAt, conversationUid, previousUpdatedAt).run();

    if (updateResult?.meta?.changes == null || Number(updateResult.meta.changes) === 1) {
      await bumpDataVersion(env, "userProfiles");
      const retainedKeys = chatAttachmentKeys(nextMessages);
      const removedKeys = [...chatAttachmentKeys(originalMessages)].filter(key => !retainedKeys.has(key));
      if (removedKeys.length) await cleanupRemovedChatAttachments(env, removedKeys);
      return json(request, {
        success: true,
        action,
        messages: nextMessages,
        historyLimit: CHAT_HISTORY_LIMIT,
        retentionDays: Math.round(CHAT_HISTORY_RETENTION_MS / 86400000)
      });
    }
  }

  throw apiError("השיחה השתנתה במקביל. נסה שוב.", 409, "chat_write_conflict");
}

async function actorCanAccessLegacyChatAttachment(actor, env, key) {
  if (actor.initialAdmin || actor.role === "super_admin") return true;
  const row = await env.GALLERY_DB.prepare(
    `SELECT 1 AS allowed
     FROM gallery_documents, json_each(gallery_documents.data_json, '$.messages') AS message
     WHERE collection_name = 'userProfiles'
       AND document_id = ?
       AND (
         json_extract(message.value, '$.attachment.key') = ?
         OR json_extract(message.value, '$.attachment.r2Key') = ?
         OR json_extract(message.value, '$.reply.attachment.key') = ?
         OR json_extract(message.value, '$.reply.attachment.r2Key') = ?
       )
     LIMIT 1`
  ).bind(actor.uid, key, key, key, key).first();
  return Boolean(row?.allowed);
}

export {
  chatMessageId,
  chatAttachmentFromPayload,
  sanitizeNewChatMessage,
  chatMessageTime,
  pruneChatHistory,
  chatAttachmentKeys,
  cleanupRemovedChatAttachments,
  handleChatMessages,
  actorCanAccessLegacyChatAttachment
};
