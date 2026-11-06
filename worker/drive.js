// חיבור Google Drive: OAuth ואסימוני גישה.
import {
  requireUser
} from "./auth.js";
import {
  DEFAULT_DRIVE_SITE_URL,
  DRIVE_ACCESS_TOKEN_SAFETY_MS,
  DRIVE_STATE_TTL_MS,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_TOKEN_URL
} from "./config.js";
import {
  safeUid
} from "./uploads.js";
import {
  apiError,
  json
} from "./util.js";

function requireDriveOAuthConfig(env) {
  const clientId = String(env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw apiError("חיבור Google Drive הקבוע עדיין לא הוגדר ב-Worker.", 503, "drive_oauth_not_configured");
  }
  return { clientId, clientSecret };
}

function driveRedirectUri(request, env) {
  return String(env.GOOGLE_DRIVE_REDIRECT_URI || `${new URL(request.url).origin}/drive/oauth/callback`).trim();
}

function driveSiteUrl(env, status = "connected") {
  const siteUrl = new URL(String(env.GOOGLE_DRIVE_SITE_URL || DEFAULT_DRIVE_SITE_URL).trim());
  siteUrl.searchParams.set("drive", status);
  return siteUrl.toString();
}

function randomUrlSafeToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function driveCredentialKey(uid) {
  const safeUid = String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!safeUid) throw apiError("מזהה המשתמש אינו תקין.", 400, "invalid_user_id");
  return `private/drive-oauth/credentials/${safeUid}.json`;
}

function driveStateKey(state) {
  const safeState = String(state || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
  if (!safeState) throw apiError("מצב OAuth אינו תקין.", 400, "invalid_oauth_state");
  return `private/drive-oauth/states/${safeState}.json`;
}

async function readPrivateJson(env, key) {
  const object = await env.GALLERY_BUCKET.get(key);
  if (!object) return null;
  try {
    return JSON.parse(await object.text());
  } catch (error) {
    console.error("Invalid private JSON object", key, error);
    return null;
  }
}

async function writePrivateJson(env, key, value) {
  await env.GALLERY_BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" }
  });
}

async function exchangeGoogleToken(body, env) {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    console.error("Google OAuth token exchange failed", payload?.error || response.status);
    const code = payload?.error === "invalid_grant" ? "drive_authorization_expired" : "drive_token_exchange_failed";
    throw apiError(
      payload?.error === "invalid_grant"
        ? "הרשאת Google Drive בוטלה או פגה. יש לחבר את Drive פעם נוספת."
        : "Google לא השלימה את חיבור Drive.",
      payload?.error === "invalid_grant" ? 401 : 502,
      code
    );
  }
  return payload;
}

async function startDriveOAuth(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  const { clientId } = requireDriveOAuthConfig(env);
  const state = randomUrlSafeToken();
  await writePrivateJson(env, driveStateKey(state), {
    uid: user.uid,
    email: user.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + DRIVE_STATE_TTL_MS
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(request, env),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    state,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    login_hint: user.email
  });
  return json(request, {
    success: true,
    authorizationUrl: `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    redirectUri: driveRedirectUri(request, env)
  });
}

async function finishDriveOAuth(request, env, url) {
  const state = url.searchParams.get("state") || "";
  const key = driveStateKey(state);
  const savedState = await readPrivateJson(env, key);
  await env.GALLERY_BUCKET.delete(key);

  if (!savedState || Number(savedState.expiresAt) < Date.now()) {
    return Response.redirect(driveSiteUrl(env, "state_error"), 302);
  }
  if (url.searchParams.get("error")) {
    return Response.redirect(driveSiteUrl(env, "cancelled"), 302);
  }

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(driveSiteUrl(env, "failed"), 302);
  try {
    const { clientId, clientSecret } = requireDriveOAuthConfig(env);
    const token = await exchangeGoogleToken({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: driveRedirectUri(request, env),
      grant_type: "authorization_code"
    }, env);
    const existing = await readPrivateJson(env, driveCredentialKey(savedState.uid));
    const refreshToken = token.refresh_token || existing?.refreshToken;
    if (!refreshToken) throw apiError("Google לא החזירה הרשאה קבועה. נסה לחבר את Drive שוב.", 502, "missing_refresh_token");

    await writePrivateJson(env, driveCredentialKey(savedState.uid), {
      refreshToken,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      email: savedState.email,
      scope: token.scope || GOOGLE_DRIVE_SCOPE,
      updatedAt: Date.now()
    });
    return Response.redirect(driveSiteUrl(env, "connected"), 302);
  } catch (error) {
    console.error("Drive OAuth callback failed", error);
    return Response.redirect(driveSiteUrl(env, "failed"), 302);
  }
}

async function getDriveAccessToken(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  const key = driveCredentialKey(user.uid);
  const credential = await readPrivateJson(env, key);
  if (!credential?.refreshToken) {
    return json(request, { success: true, connected: false });
  }

  if (credential.accessToken && Number(credential.expiresAt) > Date.now() + DRIVE_ACCESS_TOKEN_SAFETY_MS) {
    return json(request, {
      success: true,
      connected: true,
      accessToken: credential.accessToken,
      expiresAt: credential.expiresAt,
      email: credential.email || user.email
    });
  }

  const { clientId, clientSecret } = requireDriveOAuthConfig(env);
  try {
    const token = await exchangeGoogleToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token"
    }, env);
    const updatedCredential = {
      ...credential,
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      scope: token.scope || credential.scope || GOOGLE_DRIVE_SCOPE,
      updatedAt: Date.now()
    };
    await writePrivateJson(env, key, updatedCredential);
    return json(request, {
      success: true,
      connected: true,
      accessToken: updatedCredential.accessToken,
      expiresAt: updatedCredential.expiresAt,
      email: updatedCredential.email || user.email
    });
  } catch (error) {
    if (error?.code === "drive_authorization_expired") await env.GALLERY_BUCKET.delete(key);
    throw error;
  }
}

async function disconnectDrive(request, env) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await env.GALLERY_BUCKET.delete(driveCredentialKey(user.uid));
  return json(request, { success: true, connected: false });
}

export {
  requireDriveOAuthConfig,
  driveRedirectUri,
  driveSiteUrl,
  randomUrlSafeToken,
  driveCredentialKey,
  driveStateKey,
  readPrivateJson,
  writePrivateJson,
  exchangeGoogleToken,
  startDriveOAuth,
  finishDriveOAuth,
  getDriveAccessToken,
  disconnectDrive
};
