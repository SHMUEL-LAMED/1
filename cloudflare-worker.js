// נקודת הכניסה של ה-Worker: פריקת בקשות ה-proxy וניתוב כל הנתיבים.
// הלוגיקה עצמה מחולקת למודולים בתיקייה worker/ (ראו README). בפריסה הכול
// נארז לקובץ ESM יחיד (scripts/bundle-worker.mjs), כי ה-Action מעלה מודול אחד.
import {
  aiImageSearch,
  aiImageTitle,
  aiProviderSettings,
  indexAiSearchImage,
  pendingAiSearchIndex,
  selectedAiKey,
  withAiSettings
} from "./worker/ai.js";
import {
  establishGoogleSession
} from "./worker/auth.js";
import {
  authorizeBackgroundRequest,
  backgroundAiCheck,
  backgroundConfig,
  backgroundDriveToken,
  backgroundSession,
  backgroundStatus
} from "./worker/background.js";
import {
  handleChatMessages
} from "./worker/chat.js";
import {
  FACE_MODEL_VERSION
} from "./worker/config.js";
import {
  handleDataRequest
} from "./worker/data.js";
import {
  disconnectDrive,
  finishDriveOAuth,
  getDriveAccessToken,
  startDriveOAuth
} from "./worker/drive.js";
import {
  clearResolvedClientErrors,
  clientErrorsSummary,
  listClientErrors,
  receiveClientErrorReport,
  recordWorkerFailure,
  updateClientErrorStatus
} from "./worker/errors.js";
import {
  faceClusterRunRequest,
  faceIndexPendingImages,
  faceIndexSummaryRequest,
  faceSearch,
  manageFaceGroups,
  manageFacePeople,
  resetFaceIndex,
  saveFaceBoxes,
  saveFaceIndexBatch
} from "./worker/faces.js";
import {
  saveManualOrder
} from "./worker/folders.js";
import {
  createInvite,
  listInvites,
  redeemInvite,
  revokeInvite
} from "./worker/invites.js";
import {
  downloadMaintenanceBackup,
  listMaintenanceBackups,
  maintenanceAlertCheck,
  maintenanceBackup,
  maintenanceBrokenLinks,
  maintenanceTrashPurge,
  readBrokenLinksReport
} from "./worker/maintenance.js";
import {
  abortMultipartUpload,
  approveImage,
  attachMediaVariants,
  completeMultipartUpload,
  createMultipartUpload,
  deleteImage,
  mediaVariantsStats,
  multipartUploadStatus,
  probeMediaBytes,
  serveImage,
  streamConfig,
  updateMediaTakenAt,
  uploadImage,
  uploadMultipartPart
} from "./worker/media.js";
import {
  faceMeRequest,
  faceMeSearch,
  facePersonAlbum,
  faceTagsRequest,
  listFacePersons,
  serveFaceAsset
} from "./worker/people.js";
import {
  ensureDatabaseSchema
} from "./worker/schema.js";
import {
  maintenanceStorageScan,
  readStorageReport,
  readUsageStats,
  receiveUsageBeacon
} from "./worker/stats.js";
import {
  checkDuplicateUploads,
  listMyUploads,
  rejectPendingUpload
} from "./worker/uploads.js";
import {
  adminUserNotes,
  adminUsersBatch
} from "./worker/users.js";
import {
  apiError,
  assertDatabaseEnvironment,
  corsHeaders,
  isAllowedOrigin,
  json,
  sendEmail,
  setRuntimeEnv,
  workerEnvironment
} from "./worker/util.js";

// ייצוא מחדש של הפונקציות שהבדיקות מייבאות מנקודת הכניסה.
export { isAllowedOrigin } from "./worker/util.js";
export { normalizeCaptureFields } from "./worker/data.js";
export { sceneTagTaxonomy, normalizeSceneTags, normalizeImageCaption, imageDescriptionPrompt, imageDescriptionFormat, normalizeImageDescriptionFields } from "./worker/ai.js";
export { normalizeOrderRank, normalizeMediaEdit, normalizeImageArrangeFields, checkFolderPlacement, normalizeFolderFields } from "./worker/folders.js";
export { decideFaceCluster } from "./worker/faces.js";
export { normalizeUsageCounts, normalizeStorageBudget, storageBudgetStatus } from "./worker/stats.js";
export { superAdminRetentionProblem, cleanUserNote } from "./worker/users.js";
export { normalizeMediaPlaceholder, normalizeContentHash } from "./worker/uploads.js";

export function unwrapGalleryProxy(request, env) {
  const headerNames = [...request.headers.keys()].filter(name => name.startsWith("x-gallery-proxy-"));
  if (!headerNames.length) return { request, env };
  const reject = () => ({ response: new Response("Forbidden", { status: 403 }) });
  const secret = String(env.GALLERY_PROXY_SECRET || "");
  if (!secret || request.headers.get("x-gallery-proxy-auth") !== secret) return reject();
  try {
    const original = new URL(request.headers.get("x-gallery-proxy-url"));
    if (!env.PUBLIC_API_ORIGIN || original.origin !== new URL(env.PUBLIC_API_ORIGIN).origin) return reject();
    const current = new URL(request.url);
    if (original.pathname !== current.pathname || original.search !== current.search) return reject();
    const encoded = request.headers.get("x-gallery-proxy-credentials") || "";
    if (encoded.length > 16384) return reject();
    const credentials = JSON.parse(atob(encoded));
    const forwarded = { ...env };
    for (const name of ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "OPENAI_API_KEY"]) {
      if (typeof credentials[name] === "string" && credentials[name].length <= 8192) forwarded[name] = credentials[name];
    }
    const headers = new Headers(request.headers);
    const clientIp = request.headers.get("x-gallery-proxy-client-ip") || "";
    if (clientIp && /^[0-9a-fA-F:.]{3,64}$/.test(clientIp)) headers.set("CF-Connecting-IP", clientIp);
    for (const name of headerNames) headers.delete(name);
    return { request: new Request(original.href, { method: request.method, headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      ...(request.body ? { duplex: "half" } : {}) }), env: forwarded };
  } catch { return reject(); }
}

export default {
  async fetch(request, env, ctx) {
    const proxy = unwrapGalleryProxy(request, env);
    if (proxy.response) return proxy.response;
    request = proxy.request;
    env = proxy.env;
    setRuntimeEnv(env);
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      if (origin && !isAllowedOrigin(origin, env)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (!env.GALLERY_BUCKET) {
        throw apiError("החיבור לדלי R2 אינו מוגדר.", 500, "bucket_binding_missing");
      }
      // Worker שחובר למסד של הסביבה האחרת אינו מגיש שום נתיב, כולל /health.
      await assertDatabaseEnvironment(env);
      const aiPath = new URL(request.url).pathname;
      if (aiPath.startsWith('/ai-') || aiPath === '/health' || aiPath === '/' || aiPath === '/background/ai-check' || (request.method === 'PUT' && /^\/data\/(images|pendingImages)\//.test(aiPath))) {
        env = await withAiSettings(env);
      }


      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/background/session") return await backgroundSession(request, env);
      await authorizeBackgroundRequest(request, env, url.pathname);
      if (["GET", "PUT"].includes(request.method) && url.pathname === "/background/config") return await backgroundConfig(request, env);
      if (["GET", "POST"].includes(request.method) && url.pathname === "/background/status") return await backgroundStatus(request, env);
      if (request.method === "POST" && url.pathname === "/background/ai-check") return await backgroundAiCheck(request, env);
      if (request.method === "POST" && url.pathname === "/background/drive-token") return await backgroundDriveToken(request, env);
      if (request.method === "POST" && url.pathname === "/maintenance/backup") return await maintenanceBackup(request, env);
      if (request.method === "GET" && url.pathname === "/maintenance/backups") return await listMaintenanceBackups(request, env);
      if (request.method === "GET" && url.pathname.startsWith("/maintenance/backups/")) return await downloadMaintenanceBackup(request, env, url);
      if (request.method === "POST" && url.pathname === "/maintenance/trash-purge") return await maintenanceTrashPurge(request, env);
      if (request.method === "POST" && url.pathname === "/maintenance/alert-check") return await maintenanceAlertCheck(request, env);
      if (request.method === "POST" && url.pathname === "/maintenance/broken-links") return await maintenanceBrokenLinks(request, env);
      if (request.method === "GET" && url.pathname === "/maintenance/broken-links") return await readBrokenLinksReport(request, env);
      if (request.method === "POST" && url.pathname === "/maintenance/storage-scan") return await maintenanceStorageScan(request, env);
      if (request.method === "GET" && url.pathname === "/maintenance/storage") return await readStorageReport(request, env);
      if (request.method === "POST" && url.pathname === "/stats/beacon") return await receiveUsageBeacon(request, env);
      if (request.method === "GET" && url.pathname === "/stats/usage") return await readUsageStats(request, env, url);
      if (request.method === "POST" && url.pathname === "/admin/users/batch") return await adminUsersBatch(request, env);
      if ((["GET", "POST"].includes(request.method) && url.pathname === "/admin/user-notes") ||
          (request.method === "DELETE" && url.pathname.startsWith("/admin/user-notes/"))) return await adminUserNotes(request, env, url);
      if (url.pathname === '/admin/ai-settings' && ['GET', 'PUT'].includes(request.method)) return await aiProviderSettings(request, env);
      if (url.pathname === '/admin/ai-settings/test' && request.method === 'POST') return await aiProviderSettings(request, env);
      if (url.pathname.startsWith("/data/")) {
        return await handleDataRequest(request, env, url, ctx);
      }
      if (request.method === "GET" && url.pathname === "/drive/oauth/callback") {
        return await finishDriveOAuth(request, env, url);
      }
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        const result = await env.GALLERY_BUCKET.list({ limit: 1 });
        await ensureDatabaseSchema(env);
        await env.GALLERY_DB.prepare("SELECT 1 AS connected").first();
        return json(request, {
          success: true,
          service: "simchas-gallery-api",
          environment: workerEnvironment(env),
          version: "2026-10-08-data-layer-cursors-etag-cache",
          features: [
            "cloudflare-d1", "google-auth", "r2-media", "chat-attachments",
            "persistent-drive-oauth", "cloud-face-index", "media-variants", "capture-dates", "ai-image-titles", "cloud-background-jobs", "indexed-ai-search", "ai-provider-settings",
            "ai-image-captions", "scene-tags",
            "data-filters", "cursor-pagination", "etag-304", "edge-cache",
            "resumable-uploads", "face-people", "face-find-me",
            "d1-daily-backups", "trash-auto-purge", "maintenance-alerts", "broken-links-report",
            "usage-stats", "storage-report", "users-batch", "admin-user-notes", "media-placeholders",
            "my-uploads", "upload-duplicates", "face-manual-tags", "event-invites",
            ...(streamConfig(env) ? ["cloudflare-stream"] : [])
          ],
          streamEnabled: Boolean(streamConfig(env)),
          // בלי מפתח AI אין שמות, כיתובים ותגיות אוטומטיים; מסך ההשלמה מודיע על כך.
          aiDescriptionsEnabled: Boolean(selectedAiKey(env)),
          faceModelVersion: FACE_MODEL_VERSION,
          databaseConnected: true,
          bucketConnected: true,
          objectsFound: result.objects.length
        });
      }
      if (request.method === "POST" && url.pathname === "/auth/session") {
        return await establishGoogleSession(request, env);
      }
      if (request.method === "POST" && url.pathname === "/chat/messages") {
        return await handleChatMessages(request, env);
      }
      if (request.method === "POST" && url.pathname === "/upload") {
        return await uploadImage(request, env);
      }
      if (request.method === "POST" && url.pathname === "/upload/multipart/create") {
        return await createMultipartUpload(request, env);
      }
      if (request.method === "PUT" && url.pathname === "/upload/multipart/part") {
        return await uploadMultipartPart(request, env, url);
      }
      if (request.method === "GET" && url.pathname === "/upload/multipart/status") {
        return await multipartUploadStatus(request, env, url);
      }
      if (request.method === "POST" && url.pathname === "/upload/multipart/complete") {
        return await completeMultipartUpload(request, env);
      }
      if (request.method === "POST" && url.pathname === "/upload/multipart/abort") {
        return await abortMultipartUpload(request, env);
      }
      if (request.method === "POST" && url.pathname === "/approve") {
        return await approveImage(request, env);
      }
      if (request.method === "GET" && url.pathname === "/my-uploads") {
        return await listMyUploads(request, env);
      }
      if (request.method === "POST" && url.pathname === "/pending/reject") {
        return await rejectPendingUpload(request, env);
      }
      if (request.method === "POST" && url.pathname === "/duplicates") {
        return await checkDuplicateUploads(request, env);
      }
      if (request.method === "GET" && url.pathname === "/invites") {
        return await listInvites(request, env);
      }
      if (request.method === "POST" && url.pathname === "/invites") {
        return await createInvite(request, env);
      }
      if (request.method === "POST" && url.pathname === "/invites/revoke") {
        return await revokeInvite(request, env);
      }
      if (request.method === "POST" && url.pathname === "/invites/redeem") {
        return await redeemInvite(request, env);
      }
      if (request.method === "POST" && url.pathname === "/ai-title") {
        return await aiImageTitle(request, env);
      }
      if (request.method === "POST" && url.pathname === "/ai-search/index/pending") return await pendingAiSearchIndex(request, env);
      if (request.method === "POST" && url.pathname === "/ai-search/index") return await indexAiSearchImage(request, env);
      if (request.method === "POST" && url.pathname === "/ai-search") {
        return await aiImageSearch(request, env);
      }
      if (request.method === "POST" && url.pathname === "/send-email") {
        return await sendEmail(request, env);
      }
      if (request.method === "POST" && url.pathname === "/drive/oauth/start") {
        return await startDriveOAuth(request, env);
      }
      if (request.method === "POST" && url.pathname === "/drive/token") {
        return await getDriveAccessToken(request, env);
      }
      if (request.method === "DELETE" && url.pathname === "/drive/connection") {
        return await disconnectDrive(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/search") {
        return await faceSearch(request, env);
      }
      if (["GET", "POST"].includes(request.method) && url.pathname === "/face/people") {
        return await manageFacePeople(request, env, url);
      }
      if (request.method === "POST" && url.pathname === "/face/index") {
        return await saveFaceIndexBatch(request, env, ctx);
      }
      if (request.method === "POST" && url.pathname === "/face/boxes") {
        return await saveFaceBoxes(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/clusters/run") {
        return await faceClusterRunRequest(request, env);
      }
      if (["GET", "POST"].includes(request.method) && url.pathname === "/face/groups") {
        return await manageFaceGroups(request, env, url);
      }
      if (["GET", "POST"].includes(request.method) && url.pathname === "/face/tags") {
        return await faceTagsRequest(request, env, url);
      }
      if (request.method === "GET" && url.pathname === "/face/persons") {
        return await listFacePersons(request, env, ctx);
      }
      if (request.method === "GET" && url.pathname.startsWith("/face/persons/")) {
        return await facePersonAlbum(request, env, ctx, url);
      }
      if (url.pathname === "/face/me" && ["GET", "PUT", "DELETE"].includes(request.method)) {
        return await faceMeRequest(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/me/search") {
        return await faceMeSearch(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/index/pending") {
        return await faceIndexPendingImages(request, env);
      }
      if (request.method === "POST" && url.pathname === "/face/index/reset") {
        return await resetFaceIndex(request, env);
      }
      if (request.method === "GET" && url.pathname === "/face/index/summary") {
        return await faceIndexSummaryRequest(request, env, url);
      }
      if (request.method === "GET" && url.pathname.startsWith("/face-assets/")) {
        return await serveFaceAsset(request, env, url.pathname);
      }
      if (request.method === "POST" && url.pathname === "/order") {
        return await saveManualOrder(request, env);
      }
      if (request.method === "POST" && url.pathname === "/media/variants") {
        return await attachMediaVariants(request, env);
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/probe/")) {
        return await probeMediaBytes(request, env, url);
      }
      if (request.method === "POST" && url.pathname === "/media/taken-at") {
        return await updateMediaTakenAt(request, env);
      }
      if (request.method === "GET" && url.pathname === "/media/variants/stats") {
        return await mediaVariantsStats(request, env);
      }
      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        return await serveImage(request, env, url.pathname);
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/media/")) {
        return await deleteImage(request, env, url.pathname);
      }
      if (request.method === "POST" && url.pathname === "/telemetry/errors") {
        return await receiveClientErrorReport(request, env);
      }
      if (request.method === "GET" && url.pathname === "/telemetry/errors") {
        return await listClientErrors(request, env, url);
      }
      if (request.method === "GET" && url.pathname === "/telemetry/errors/summary") {
        return await clientErrorsSummary(request, env);
      }
      if (request.method === "POST" && url.pathname === "/telemetry/errors/resolve") {
        return await updateClientErrorStatus(request, env, "resolve");
      }
      if (request.method === "POST" && url.pathname === "/telemetry/errors/reopen") {
        return await updateClientErrorStatus(request, env, "reopen");
      }
      if (request.method === "POST" && url.pathname === "/telemetry/errors/clear") {
        return await clearResolvedClientErrors(request, env);
      }
      return json(request, { success: false, message: "הנתיב המבוקש אינו קיים." }, 404);
    } catch (error) {
      console.error("Worker request failed", error);
      const status = Number(error?.status) || 500;
      // רק כשלונות פנימיים נרשמים ליומן השגיאות; 4xx הן תשובות צפויות.
      if (status >= 500) recordWorkerFailure(request, env, ctx, error, status);
      return json(request, {
        success: false,
        code: error?.code || "internal_error",
        message: error?.message || "אירעה שגיאה פנימית.",
        // כשל של מנוע ה־AI (כל קודי השגיאה של התיאור) חושף רק סטטוס וקוד של הספק.
        ...(typeof error?.providerCode === "string" ? { providerCode: error.providerCode, providerStatus: error.providerStatus } : {}),
        ...(error?.code === "database_schema_unavailable" ? { schemaCause: error.schemaCause } : {})
      }, status);
    }
  }
};
