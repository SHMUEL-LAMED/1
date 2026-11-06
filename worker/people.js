// אנשים: רשימת אנשים, אלבום אדם, "אני", נכסי המודל ותיוג פנים.
import {
  requireUser
} from "./auth.js";
import {
  DATA_CACHE_TTL_SECONDS,
  FACE_API_CDN_BASE,
  FACE_API_VERSION,
  FACE_ASSETS,
  FACE_GROUPS_RATE_LIMIT,
  FACE_GROUPS_RATE_WINDOW_MS,
  FACE_ME_RATE_LIMIT,
  FACE_ME_RATE_WINDOW_MS,
  FACE_MODEL_VERSION,
  FACE_PEOPLE_DATA_VERSION,
  FACE_PERSONS_LIST_LIMIT,
  FACE_PERSONS_RATE_LIMIT,
  FACE_PERSONS_RATE_WINDOW_MS,
  FACE_PERSON_MEDIA_LIMIT,
  FACE_TAGS_MAX_PER_IMAGE,
  FACE_VIEWER_ROLES,
  TAKEN_AT_ORDER_SQL
} from "./config.js";
import {
  bumpDataVersion,
  edgeCache,
  readDataVersion
} from "./data.js";
import {
  FACE_PERSON_COLUMNS,
  FACE_VALID_ASSIGNMENT,
  consumeFaceSearchQuota,
  deserializeFaceDescriptor,
  faceModelVersion,
  facePersonId,
  faceSearchLimit,
  hasActiveImageDocument,
  parseFaceBox,
  parseFaceDescriptor,
  readFaceBox,
  readFacePersonRow,
  readFacePersonSummaries,
  runFaceSearch,
  serializeFaceBox,
  serializeFaceDescriptor
} from "./faces.js";
import {
  safeImageId
} from "./media.js";
import {
  ensureDatabaseSchema
} from "./schema.js";
import {
  safeUid
} from "./uploads.js";
import {
  apiError,
  computeEtag,
  conditionalJson,
  consumeRateLimit,
  corsHeaders,
  json
} from "./util.js";

// --- רשימת האנשים והאלבום של כל אדם (משתמשים מאושרים) ---
// רק אנשים שמנהל אישר ונתן להם שם, ושאינם מוסתרים. האלבום כולל רק תמונות
// שבאוסף images — כלומר מדיה מאושרת — כפי שהצופה רואה בגלריה עצמה.

function facePermissionClass(user) {
  return ["admin", "super_admin"].includes(user.role) ? user.role : "approved-viewer";
}

// מטמון הקצה לתשובות האנשים: המפתח כולל את גרסת הנתונים ואת מחלקת ההרשאה,
// ולעולם לא את מזהה המשתמש. בלי Cache API (workers.dev, בדיקות) — ישירות מ-D1.
async function serveCachedFaceJson(request, ctx, keySuffix, build) {
  const cache = edgeCache();
  const cacheKey = cache ? `${new URL(request.url).origin}/__face-cache/${keySuffix}` : "";
  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) {
      const body = await cached.text();
      return conditionalJson(request, body, cached.headers.get("ETag") || await computeEtag(body));
    }
  }
  const body = JSON.stringify(await build());
  const etag = await computeEtag(body);
  if (cache) {
    const stored = cache.put(cacheKey, new Response(body, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `s-maxage=${DATA_CACHE_TTL_SECONDS}`, "ETag": etag }
    })).catch(error => console.warn("Edge cache write skipped", error?.message || error));
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(stored);
    else await stored;
  }
  return conditionalJson(request, body, etag);
}

async function requireFaceViewer(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env,
    `face-persons:${user.uid}`,
    FACE_PERSONS_RATE_LIMIT,
    FACE_PERSONS_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.",
    "face_persons_rate_limit"
  );
  return user;
}

function publicPersonView(person) {
  return {
    personId: person.personId,
    name: person.name,
    faceCount: person.faceCount,
    imageCount: person.imageCount,
    cover: person.cover ? { imageId: person.cover.imageId, box: person.cover.box, url: person.cover.url } : null
  };
}

async function listFacePersons(request, env, ctx) {
  const user = await requireFaceViewer(request, env);
  const version = await readDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  return serveCachedFaceJson(request, ctx, `persons?v=${version}&p=${facePermissionClass(user)}`, async () => {
    // אדם שמופיע רק בתיוגים ידניים (בלי פרצוף שזוהה) מופיע גם הוא ברשימה.
    const rows = (await env.GALLERY_DB.prepare(
      `SELECT ${FACE_PERSON_COLUMNS},
         (SELECT COUNT(*) FROM face_manual_tags t
            JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = t.image_id
          WHERE t.person_id = face_persons.person_id
            AND NOT EXISTS (SELECT 1 FROM face_people p WHERE p.person_id = t.person_id AND p.image_id = t.image_id)) AS manualCount
       FROM face_persons
       WHERE model_version = ? AND status = 'approved' AND hidden = 0 AND name <> ''
         AND (face_count > 0 OR EXISTS (SELECT 1 FROM face_manual_tags t WHERE t.person_id = face_persons.person_id))
       ORDER BY name, person_id LIMIT ?`
    ).bind(FACE_MODEL_VERSION, FACE_PERSONS_LIST_LIMIT).all()).results || [];
    const manualCounts = new Map(rows.map(row => [String(row.personId), Number(row.manualCount) || 0]));
    const persons = (await readFacePersonSummaries(env, rows))
      .map(person => ({ ...person, imageCount: person.imageCount + (manualCounts.get(person.personId) || 0) }))
      .filter(person => person.imageCount > 0)
      .map(publicPersonView);
    return { success: true, version, persons };
  });
}

async function facePersonAlbum(request, env, ctx, url) {
  const user = await requireFaceViewer(request, env);
  let rawId = "";
  try {
    rawId = decodeURIComponent(url.pathname.slice("/face/persons/".length));
  } catch {
    throw apiError("מזהה האדם אינו תקין.", 400, "invalid_person_id");
  }
  const personId = facePersonId(rawId);
  const version = await readDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  const isAdmin = ["admin", "super_admin"].includes(user.role);
  return serveCachedFaceJson(request, ctx, `person/${personId}?v=${version}&p=${facePermissionClass(user)}`, async () => {
    const row = await readFacePersonRow(env, personId);
    const visible = row && (isAdmin || (row.status === "approved" && Number(row.hidden) === 0 && row.name));
    if (!visible) throw apiError("האדם לא נמצא.", 404, "person_not_found");
    const [person] = await readFacePersonSummaries(env, [row]);
    const media = (await env.GALLERY_DB.prepare(
      `SELECT p.image_id AS imageId, MAX(${TAKEN_AT_ORDER_SQL}) AS orderValue
       FROM face_people p ${FACE_VALID_ASSIGNMENT}
       WHERE p.person_id = ?
       GROUP BY p.image_id
       ORDER BY orderValue DESC, p.image_id LIMIT ?`
    ).bind(personId, FACE_PERSON_MEDIA_LIMIT).all()).results || [];
    // תמונות שבהן מנהל תייג את האדם ידנית (הזיהוי לא מצא אותו בהן) מצטרפות
    // לאלבום לפי אותו מיון, ומסומנות ב-manualImageIds.
    const detected = new Set(media.map(item => String(item.imageId)));
    const manual = (await readManualTagMedia(env, personId, FACE_PERSON_MEDIA_LIMIT))
      .filter(item => !detected.has(String(item.imageId)));
    const ordered = [...media, ...manual]
      .sort((left, right) => (Number(right.orderValue) - Number(left.orderValue)) || String(left.imageId).localeCompare(String(right.imageId)))
      .slice(0, FACE_PERSON_MEDIA_LIMIT);
    const manualIds = new Set(manual.map(item => String(item.imageId)));
    return {
      success: true,
      version,
      person: { ...publicPersonView(person), ...(isAdmin ? { status: person.status, hidden: person.hidden } : {}) },
      imageIds: ordered.map(item => String(item.imageId)),
      manualImageIds: ordered.map(item => String(item.imageId)).filter(id => manualIds.has(id))
    };
  });
}

// --- "התמונות שלי": הטביעה האישית נשמרת רק אחרי "זכור אותי" ---

async function faceMeRequest(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env,
    `face-me:${user.uid}`,
    FACE_ME_RATE_LIMIT,
    FACE_ME_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.",
    "face_me_rate_limit"
  );
  if (request.method === "DELETE") {
    await env.GALLERY_DB.prepare("DELETE FROM face_user_descriptors WHERE uid = ?").bind(user.uid).run();
    return json(request, { success: true, remembered: false });
  }
  if (request.method === "PUT") {
    const payload = await request.json().catch(() => ({}));
    if (payload?.consent !== true) {
      throw apiError("שמירת הטביעה מחייבת הסכמה מפורשת („זכור אותי”).", 400, "consent_required");
    }
    const modelVersion = faceModelVersion(payload.modelVersion);
    const descriptor = parseFaceDescriptor(payload.descriptor);
    const now = Date.now();
    await env.GALLERY_DB.prepare(
      `INSERT INTO face_user_descriptors (uid, model_version, descriptor_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET model_version = excluded.model_version,
         descriptor_json = excluded.descriptor_json, updated_at = excluded.updated_at`
    ).bind(user.uid, modelVersion, serializeFaceDescriptor(descriptor), now, now).run();
    return json(request, { success: true, remembered: true, savedAt: now });
  }
  const row = await env.GALLERY_DB.prepare(
    "SELECT model_version AS modelVersion, updated_at AS savedAt FROM face_user_descriptors WHERE uid = ?"
  ).bind(user.uid).first();
  const usable = Boolean(row) && row.modelVersion === FACE_MODEL_VERSION;
  return json(request, { success: true, remembered: usable, savedAt: usable ? Number(row.savedAt) || 0 : 0 });
}

async function faceMeSearch(request, env) {
  const user = await requireUser(request, env, FACE_VIEWER_ROLES);
  await ensureDatabaseSchema(env);
  const payload = await request.json().catch(() => ({}));
  const resultLimit = faceSearchLimit(payload?.limit);
  await consumeFaceSearchQuota(env, user.uid);
  const row = await env.GALLERY_DB.prepare(
    "SELECT model_version AS modelVersion, descriptor_json AS descriptorJson FROM face_user_descriptors WHERE uid = ?"
  ).bind(user.uid).first();
  const descriptor = row && row.modelVersion === FACE_MODEL_VERSION ? deserializeFaceDescriptor(row.descriptorJson) : null;
  if (!descriptor) throw apiError("אין טביעה שמורה. חפש שוב לפי תמונה.", 404, "face_me_not_saved");
  return json(request, await runFaceSearch(env, descriptor, FACE_MODEL_VERSION, resultLimit));
}

async function serveFaceAsset(request, env, pathname) {
  let assetPath;
  try {
    assetPath = decodeURIComponent(pathname.slice("/face-assets/".length));
  } catch {    throw apiError("כתובת נכס זיהוי הפנים אינה תקינה.", 400, "invalid_face_asset");
  }

  const asset = FACE_ASSETS.get(assetPath);
  if (!asset) {
    throw apiError("נכס זיהוי הפנים לא נמצא.", 404, "face_asset_not_found");
  }

  const cacheKey = `system/face-api/${FACE_API_VERSION}/${assetPath}`;
  let body;
  let contentType = asset.contentType;
  const cached = await env.GALLERY_BUCKET.get(cacheKey);

  if (cached) {
    body = cached.body;
    contentType = cached.httpMetadata?.contentType || contentType;
  } else {
    const upstreamUrl = `${FACE_API_CDN_BASE}/${asset.upstreamPath}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { "User-Agent": "simchas-gallery-worker/1.0" }
    });
    if (!upstream.ok) {
      throw apiError("לא ניתן לטעון את מנוע זיהוי הפנים.", 502, "face_asset_upstream_failed");
    }
    const bytes = await upstream.arrayBuffer();
    await env.GALLERY_BUCKET.put(cacheKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        source: upstreamUrl,
        cachedAt: new Date().toISOString()
      }
    });
    body = bytes;
  }

  return new Response(body, {
    headers: {
      ...corsHeaders(request),
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// --- תיוג ידני של אדם בתמונה (מנהלים) ---
// זיהוי הפנים מפספס לפעמים פנים (צד, צל, מרחק). מנהל מתייג אדם מאושר עם שם
// בתמונה כולה, או במלבן שסימן. התיוג מופיע באלבום של האדם ובתוצאות "התמונות
// שלי" שלו, מסומן "ידני", ואינו נוגע בטביעות או בקיבוץ.

async function readFaceTags(env, imageId) {
  const rows = (await env.GALLERY_DB.prepare(
    `SELECT t.person_id AS personId, t.box_json AS boxJson, t.created_at AS createdAt,
       fp.name AS name, fp.hidden AS hidden
     FROM face_manual_tags t LEFT JOIN face_persons fp ON fp.person_id = t.person_id
     WHERE t.image_id = ? ORDER BY t.created_at, t.person_id`
  ).bind(imageId).all()).results || [];
  return rows.map(row => ({
    personId: String(row.personId),
    name: String(row.name || ""),
    hidden: Number(row.hidden) === 1,
    box: readFaceBox(row.boxJson),
    createdAt: Number(row.createdAt) || 0
  }));
}

// GET /face/tags?imageId= ו-POST /face/tags { action: add|remove, imageId, personId, box? }
async function faceTagsRequest(request, env, url) {
  const user = await requireUser(request, env, ["admin", "super_admin"]);
  await ensureDatabaseSchema(env);
  await consumeRateLimit(
    env, `face-groups:${user.uid}`, FACE_GROUPS_RATE_LIMIT, FACE_GROUPS_RATE_WINDOW_MS,
    "בוצעו בקשות רבות. המתן מעט ונסה שוב.", "face_groups_rate_limit"
  );
  if (request.method === "GET") {
    const imageId = safeImageId(url.searchParams.get("imageId"));
    return json(request, { success: true, imageId, tags: await readFaceTags(env, imageId) });
  }
  const payload = await request.json().catch(() => ({}));
  const action = String(payload?.action || "");
  if (!["add", "remove"].includes(action)) throw apiError("הפעולה המבוקשת אינה מוכרת.", 400, "invalid_action");
  const imageId = safeImageId(payload?.imageId);
  const personId = facePersonId(payload?.personId);
  if (action === "add") {
    const box = parseFaceBox(payload?.box ?? null);
    if (!(await hasActiveImageDocument(env, imageId))) throw apiError("התמונה לא נמצאה בגלריה.", 404, "image_not_found");
    const person = await readFacePersonRow(env, personId);
    if (!person || person.status !== "approved" || !person.name) {
      throw apiError("אפשר לתייג רק אדם מאושר עם שם.", 400, "invalid_tag_person");
    }
    const count = await env.GALLERY_DB.prepare(
      "SELECT COUNT(*) AS total FROM face_manual_tags WHERE image_id = ? AND person_id <> ?"
    ).bind(imageId, personId).first();
    if (Number(count?.total) >= FACE_TAGS_MAX_PER_IMAGE) {
      throw apiError(`אפשר לתייג עד ${FACE_TAGS_MAX_PER_IMAGE} אנשים בתמונה.`, 400, "too_many_tags");
    }
    await env.GALLERY_DB.prepare(
      `INSERT INTO face_manual_tags (image_id, person_id, box_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(image_id, person_id) DO UPDATE SET box_json = excluded.box_json`
    ).bind(imageId, personId, serializeFaceBox(box), safeUid(user.uid), Date.now()).run();
  } else {
    await env.GALLERY_DB.prepare("DELETE FROM face_manual_tags WHERE image_id = ? AND person_id = ?").bind(imageId, personId).run();
  }
  await bumpDataVersion(env, FACE_PEOPLE_DATA_VERSION);
  return json(request, { success: true, imageId, tags: await readFaceTags(env, imageId) });
}

// מזהי התמונות המאושרות שבהן אדם תויג ידנית, עם ערך המיון שלהן.
async function readManualTagMedia(env, personId, limit) {
  return (await env.GALLERY_DB.prepare(
    `SELECT t.image_id AS imageId, ${TAKEN_AT_ORDER_SQL} AS orderValue
     FROM face_manual_tags t
     JOIN gallery_documents d ON d.collection_name = 'images' AND d.document_id = t.image_id
     WHERE t.person_id = ?
     ORDER BY orderValue DESC, t.image_id LIMIT ?`
  ).bind(personId, limit).all()).results || [];
}

export {
  facePermissionClass,
  serveCachedFaceJson,
  requireFaceViewer,
  publicPersonView,
  listFacePersons,
  facePersonAlbum,
  faceMeRequest,
  faceMeSearch,
  serveFaceAsset,
  readFaceTags,
  faceTagsRequest,
  readManualTagMedia
};
