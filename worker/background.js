// משימות רקע מ-GitHub Actions (OIDC).
import {
  GEMINI_VISION_MODEL,
  geminiRequest
} from "./ai.js";
import {
  base64UrlDecodeToBytes,
  base64UrlEncode,
  requireUser,
  signSessionPayload
} from "./auth.js";
import {
  OPENAI_RESPONSES_URL,
  OPENAI_VISION_MODEL
} from "./config.js";
import {
  getDriveAccessToken
} from "./drive.js";
import {
  publicApiOrigin,
  readGalleryDocumentRow,
  safeImageId
} from "./media.js";
import {
  apiError,
  constantTimeHexEqual,
  consumeRateLimit,
  getBearerToken,
  json,
  parseDocumentData
} from "./util.js";

// תהליך תחזוקה ב-GitHub Actions: אימות OIDC חתום, ללא סוד קבוע בדפדפן.
const BACKGROUND_REPOSITORY = "SHMUEL-LAMED/1";
const BACKGROUND_REPOSITORY_ID = "1308950667";
const BACKGROUND_OWNER_ID = "295421676";
const BACKGROUND_WORKFLOW = "SHMUEL-LAMED/1/.github/workflows/background-jobs.yml@refs/heads/main";
const backgroundActors = new WeakMap();
let githubJwksCache = null;
const BACKGROUND_JOB_NAMES = ["titles", "faces", "variants", "dates", "drive"];

async function readBackgroundConfig(env) {
  const row = await readGalleryDocumentRow(env, "systemMeta", "backgroundJobs");
  const saved = parseDocumentData(row);
  return {
    enabled: Object.fromEntries(BACKGROUND_JOB_NAMES.map(name => [name, saved.enabled?.[name] !== false])),
    driveFolders: Array.isArray(saved.driveFolders) ? saved.driveFolders.slice(0, 50) : [{ id: "1Hb8mCpdnKcax8T6Xulq8PLXzlGcJaBhF", label: "שמחס'", autoSync: true }],
    driveOwnerUid: String(saved.driveOwnerUid || ""),
    intervalMinutes: Math.max(15, Math.min(1440, Number(saved.intervalMinutes) || 15)),
    updatedAt: Number(saved.updatedAt) || 0
  };
}

async function saveBackgroundDocument(env, id, value) {
  const now = Date.now();
  await env.GALLERY_DB.prepare(
    "INSERT INTO gallery_documents (collection_name, document_id, data_json, owner_uid, created_at, updated_at) VALUES ('systemMeta', ?, ?, 'background-worker', ?, ?) ON CONFLICT(collection_name, document_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at"
  ).bind(id, JSON.stringify(value), now, now).run();
}

async function verifyGithubBackgroundToken(request, env) {
  const token = getBearerToken(request);
  let parts, header, claims;
  try {
    parts = token.split(".");
    if (parts.length !== 3 || token.length > 16000) throw new Error();
    header = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(parts[1])));
  } catch { throw apiError("אסימון תהליך הרקע אינו תקין.", 401, "background_invalid_token"); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== "RS256" || !header.kid || claims.iss !== "https://token.actions.githubusercontent.com" ||
      claims.aud !== `${publicApiOrigin(request, env)}/background` || claims.repository !== BACKGROUND_REPOSITORY ||
      claims.repository_id !== BACKGROUND_REPOSITORY_ID || claims.repository_owner_id !== BACKGROUND_OWNER_ID ||
      claims.workflow_ref !== BACKGROUND_WORKFLOW || claims.ref !== "refs/heads/main" ||
      !["schedule", "workflow_dispatch", "push"].includes(claims.event_name) ||
      !Number.isFinite(claims.exp) || claims.exp <= now || claims.exp > now + 900 ||
      !Number.isFinite(claims.iat) || claims.iat > now + 30 || claims.iat < now - 900 ||
      (claims.nbf && claims.nbf > now + 30)) {
    throw apiError("תהליך הרקע אינו מורשה.", 403, "background_untrusted_workflow");
  }
  async function keys(force = false) {
    if (!force && githubJwksCache && githubJwksCache.expires > Date.now()) return githubJwksCache.keys;
    const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", { signal: AbortSignal.timeout(10000) });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.keys)) throw apiError("לא ניתן לאמת את תהליך הרקע.", 503, "background_jwks_unavailable");
    githubJwksCache = { keys: payload.keys, expires: Date.now() + 3600000 };
    return payload.keys;
  }
  let jwk = (await keys()).find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) jwk = (await keys(true)).find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw apiError("חתימת תהליך הרקע אינה תקינה.", 401, "background_invalid_signature");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecodeToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw apiError("חתימת תהליך הרקע אינה תקינה.", 401, "background_invalid_signature");
  return claims;
}

async function backgroundSession(request, env) {
  const claims = await verifyGithubBackgroundToken(request, env);
  let writeQuotaExhausted = false;
  try { await consumeRateLimit(env, "background-session", 20, 3600000, "יותר מדי ריצות רקע.", "background_session_rate_limit"); }
  catch (error) {
    if (!/row write limit/i.test(String(error?.cause?.message || error?.message || ""))) throw error;
    // OIDC כבר אומת. הרשאת קריאה קצרה מאפשרת אבחון בזמן שמכסת הכתיבה חסומה.
    writeQuotaExhausted = true;
  }
  const payload = { scope: "gallery-maintenance", readOnly: writeQuotaExhausted, runId: String(claims.run_id || ""), exp: Math.floor(Date.now() / 1000) + 1800 };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  // הפרדת חתימה מאסימוני משתמש: שינוי bg1 ל-v1 אינו מעניק כניסה לחשבון.
  const signature = await signSessionPayload(env, `background:${encoded}`);
  const response = json(request, { success: true, token: `bg1.${encoded}.${signature}`, expiresAt: payload.exp * 1000, writeQuotaExhausted });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function backgroundAllowedPath(method, path) {
  if (method === "GET") return /^\/data\/(images|pendingImages|folders)(\/[^/]+)?$/.test(path) ||
    ["/background/config", "/background/status", "/face/index/summary", "/media/variants/stats"].includes(path) || path.startsWith("/face-assets/") ||
    /^\/media\/(probe\/[^/]+|(approved|pending|variants)\/)/.test(path);
  if (method === "POST") return ["/ai-title", "/ai-search/index", "/ai-search/index/pending", "/face/index", "/face/index/pending", "/face/clusters/run", "/face/boxes", "/media/variants", "/media/taken-at", "/background/status", "/background/drive-token", "/background/ai-check", "/upload", "/upload/multipart/create", "/upload/multipart/complete", "/upload/multipart/abort",
    "/maintenance/backup", "/maintenance/trash-purge", "/maintenance/alert-check", "/maintenance/broken-links", "/maintenance/storage-scan"].includes(path);
  if (method === "PUT") return path === "/upload/multipart/part" || /^\/data\/(images\/driveimage|folders\/drivefolder)_[A-Za-z0-9_-]+$/.test(path);
  return false;
}

async function authorizeBackgroundRequest(request, env, path) {
  const token = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("bg1.")) return;
  const parts = token.split(".");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(parts[1]))); } catch {}
  if (parts.length !== 3 || payload?.scope !== "gallery-maintenance" || !Number.isFinite(payload?.exp) || payload.exp * 1000 <= Date.now() ||
      !constantTimeHexEqual(parts[2] || "", await signSessionPayload(env, `background:${parts[1]}`))) {
    throw apiError("הרשאת תהליך הרקע פגה.", 401, "background_session_expired");
  }
  // הגיבוי אינו כותב ל-D1, ולכן הוא רץ גם כשמכסת הכתיבה חסומה — אז הוא חשוב במיוחד.
  if (payload.readOnly && request.method !== "GET" && !["/background/ai-check", "/maintenance/backup"].includes(path)) throw apiError("מכסת הכתיבה תתחדש אוטומטית.",403,"background_write_quota_paused");
  if (!backgroundAllowedPath(request.method, path)) throw apiError("פעולה זו אינה מורשית לתהליך הרקע.", 403, "background_scope_denied");
  const actor = { uid: "background-worker", email: "background@internal.invalid", role: "admin", status: "approved", initialAdmin: false, idToken: token,
    account: { localId: "background-worker", email: "background@internal.invalid", displayName: "תהליך רקע בענן" } };
  backgroundActors.set(request, actor);
}

async function backgroundConfig(request, env) {
  const actor = await requireUser(request, env, ["admin", "super_admin"]);
  const current = await readBackgroundConfig(env);
  if (request.method === "GET") return json(request, { success: true, config: current });
  const payload = await request.json().catch(() => ({}));
  for (const name of BACKGROUND_JOB_NAMES) if (typeof payload.enabled?.[name] === "boolean") current.enabled[name] = payload.enabled[name];
  if (Array.isArray(payload.driveFolders)) {
    current.driveFolders = payload.driveFolders.slice(0, 50).map(folder => ({ id: String(folder.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120), label: String(folder.label || "Drive").slice(0, 120), autoSync: folder.autoSync !== false })).filter(folder => folder.id.length >= 10);
    current.driveOwnerUid = actor.uid;
  }
  if (payload.intervalMinutes !== undefined) current.intervalMinutes = Math.max(15, Math.min(1440, Number(payload.intervalMinutes) || 15));
  current.updatedAt = Date.now();
  await saveBackgroundDocument(env, "backgroundJobs", current);
  return json(request, { success: true, config: current });
}

async function backgroundStatus(request, env) {
  await requireUser(request, env, ["admin", "super_admin"]);
  if (request.method === "GET") return json(request, { success: true, state: parseDocumentData(await readGalleryDocumentRow(env, "systemMeta", "backgroundState")) });
  if (!backgroundActors.has(request)) throw apiError("רק תהליך הרקע יכול לעדכן את המצב.", 403, "background_scope_denied");
  const payload = await request.json().catch(() => ({}));
  if (JSON.stringify(payload.cursor || {}).length > 200000) throw apiError("מצב הריצה גדול מדי.", 400, "background_cursor_too_large");
  // אובייקטים קטנים בלבד, ללא אסימונים, טביעות פנים או פרטי משתמשים ביומן.
  const state = {
    runId: String(payload.runId || "").replace(/[^0-9]/g, "").slice(0, 30),
    updatedAt: Date.now(), startedAt: Number(payload.startedAt) || Date.now(),
    phase: String(payload.phase || "idle").slice(0, 30),
    cursor: payload.cursor && typeof payload.cursor === "object" ? JSON.parse(JSON.stringify(payload.cursor)) : {},
    jobs: Object.fromEntries(BACKGROUND_JOB_NAMES.map(name => [name, {
      processed: Math.max(0, Math.min(1000000, Number(payload.jobs?.[name]?.processed) || 0)),
      failed: Math.max(0, Math.min(1000000, Number(payload.jobs?.[name]?.failed) || 0)),
      message: String(payload.jobs?.[name]?.message || "").slice(0, 240)
    }])),
    retry: Array.isArray(payload.retry) ? payload.retry.slice(-500).map(item => ({ job: String(item.job || "").slice(0, 20), id: safeImageId(item.id), attempts: Math.min(10, Math.max(1, Number(item.attempts) || 1)), after: Math.min(Date.now() + 7 * 86400000, Number(item.after) || Date.now()) })) : []
  };
  await saveBackgroundDocument(env, "backgroundState", state);
  return json(request, { success: true });
}

async function backgroundAiCheck(request, env) {
  if (!backgroundActors.has(request)) throw apiError("פעולה זו מיועדת לתהליך הרקע.",403,"background_scope_denied");
  if (env.AI_PROVIDER === 'gemini') {
    try {
      await geminiRequest(env, GEMINI_VISION_MODEL, 'generateContent', { contents: [{ parts: [{ text: 'ענה רק במילה שלום' }] }], generationConfig: { maxOutputTokens: 32, thinkingConfig: { thinkingBudget: 0 } } });
      return json(request, { success: true, available: true, status: 200, providerCode: 'ok' });
    } catch (error) { return json(request, { success: true, available: false, status: error.status || 503, providerCode: error.code || 'gemini_request_failed' }); }
  }
  if (!env.OPENAI_API_KEY) return json(request,{success:true,available:false,status:503,providerCode:"openai_key_missing"});
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method:"POST", headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:OPENAI_VISION_MODEL,store:false,max_output_tokens:32,input:"החזר את המילה שלום בלבד"}),
    signal:AbortSignal.timeout(25000)
  });
  const data=await response.json().catch(()=>({}));
  const providerCode=response.ok ? "ok" : String(data.error?.code||data.error?.type||`http_${response.status}`).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80);
  return json(request,{success:true,available:response.ok,status:response.status,providerCode});
}

async function backgroundDriveToken(request, env) {
  if (!backgroundActors.has(request)) throw apiError("פעולה זו מיועדת לתהליך הרקע.", 403, "background_scope_denied");
  const config = await readBackgroundConfig(env);
  if (!config.enabled.drive) return json(request, { success: true, connected: false });
  let uid = config.driveOwnerUid;
  if (!uid) {
    const listed = await env.GALLERY_BUCKET.list({ prefix: "private/drive-oauth/credentials/", limit: 50 });
    for (const object of listed.objects || []) {
      const candidate = object.key.split("/").pop().replace(/\.json$/, "");
      const profile = parseDocumentData(await readGalleryDocumentRow(env, "userProfiles", candidate));
      if (profile.status === "approved" && ["admin", "super_admin"].includes(profile.role)) { uid = candidate; break; }
    }
  }
  if (!uid) return json(request, { success: true, connected: false });
  const profile = parseDocumentData(await readGalleryDocumentRow(env, "userProfiles", uid));
  if (profile.status !== "approved" || !["admin", "super_admin"].includes(profile.role)) return json(request, { success: true, connected: false });
  const actor = backgroundActors.get(request);
  backgroundActors.set(request, { ...actor, uid, email: String(profile.email || "") });
  const response = await getDriveAccessToken(request, env);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export {
  BACKGROUND_REPOSITORY,
  BACKGROUND_REPOSITORY_ID,
  BACKGROUND_OWNER_ID,
  BACKGROUND_WORKFLOW,
  backgroundActors,
  githubJwksCache,
  BACKGROUND_JOB_NAMES,
  readBackgroundConfig,
  saveBackgroundDocument,
  verifyGithubBackgroundToken,
  backgroundSession,
  backgroundAllowedPath,
  authorizeBackgroundRequest,
  backgroundConfig,
  backgroundStatus,
  backgroundAiCheck,
  backgroundDriveToken
};
