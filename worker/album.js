// worker/album.js — אלבום PDF שנוצר בענן.
//
// עד עכשיו האלבום נבנה בדפדפן של הצופה: כל התמונות נטענו לזיכרון של הטלפון
// או המחשב, ו"שמירה כ־PDF" בחלון ההדפסה יצרה את הקובץ. כאן הקובץ נוצר בשרת:
// הצופה שולח את רשימת הפריטים, ה-Worker קורא את הרשומות מהמסד (רק פריטים
// מאושרים בגלריה), בונה את אותם עמודי A4 — שער ועמודי תמונות, 1, 2 או 4
// בעמוד — ושולח אותם ל-Browser Rendering של Cloudflare, שמדפיס אותם ל-PDF.
// הקובץ נשמר ב-R2 תחת albums/<uid>/<token>.pdf, והצופה מקבל קישור להורדה
// שאינו ניתן לניחוש ותקף שבעה ימים.
//
// מה נכנס לאלבום, באיזה סדר ואיך הוא מתחלק לעמודים — אותן החלטות בדיוק כמו
// באלבום של הדפדפן (print-album.js), כדי ששני המסלולים ייתנו אותו אלבום.
//
// החיבור ל-Browser Rendering, לפי הסדר:
//   1. Binding בשם BROWSER (Workers & Pages → ה-Worker → Settings → Bindings →
//      Browser Rendering) — env.BROWSER.quickAction("pdf", ...).
//   2. REST API: הסוד BROWSER_RENDERING_TOKEN (אסימון עם הרשאת
//      "Browser Rendering - Edit") והמשתנה CF_ACCOUNT_ID.
// בלי אף אחד מהם התשובה היא 409 עם הקוד album_cloud_unavailable (לא 5xx,
// כדי שלא תירשם ביומן השגיאות), והדפדפן חוזר לאלבום המקומי (חלון ההדפסה),
// כך ששום דבר אינו נשבר עד שהשירות מופעל.
import { apiError, json, corsHeaders, consumeRateLimit, parseDocumentData } from "./util.js";
import { requireUser } from "./auth.js";
import {
  ALBUM_MAX_ITEMS, normalizeAlbumPerPage, paginateAlbum, prepareAlbumItems,
  albumCoverDate, albumCountLabel
} from "../print-album.js";

export const ALBUM_FILE_PREFIX = "albums/";
export const ALBUM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// עשרה אלבומים לשעה לכל משתמש: בתוכנית החינמית יש 10 דקות דפדפן ביום לכל
// החשבון, ואלבום גדול לוקח עד דקה.
const ALBUM_RATE_LIMIT = 10;
const ALBUM_RATE_WINDOW_MS = 60 * 60 * 1000;
const RENDER_TIMEOUT_MS = 120_000;
// Quick Actions permits at most 60 seconds for page loading (PDF rendering may take longer).
const PAGE_LOAD_TIMEOUT_MS = 60_000;
const DB_CHUNK = 50;
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const UID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanId(value) {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// שם קובץ להורדה: שם האלבום בלי תווים שאסורים בשמות קבצים.
export function albumFileName(title) {
  const base = cleanText(title, 80).replace(/[\\/:*?"<>|]+/g, "-").trim() || "אלבום";
  return `${base}.pdf`;
}

// אותם צבעים, גופנים ומידות כמו בהדפסה של האתר (styles.css, ‎@media print‎).
const ALBUM_CSS = `
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  direction: rtl; color: #1B1916;
  font-family: "Assistant", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.print-album-page { height: 270mm; overflow: hidden; break-after: page; page-break-after: always; }
.print-album-page:last-child { break-after: auto; page-break-after: auto; }
.print-album-cover { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm; text-align: center; }
.print-album-cover-image { width: 100%; max-height: 150mm; object-fit: contain; margin-bottom: 8mm; border-radius: 2mm; }
.print-album-kicker { display: flex; align-items: center; gap: 3mm; margin: 0; color: #5C554B; font-size: 9pt; font-weight: 600; }
.print-album-kicker::before, .print-album-kicker::after { content: ""; width: 1.6mm; height: 1.6mm; background: #7E5118; rotate: 45deg; }
.print-album-title { margin: 0; color: #1B1916; font-family: "Frank Ruhl Libre", "David", "Times New Roman", serif; font-size: 28pt; font-weight: 500; line-height: 1.2; }
.print-album-date { margin: 0; font-size: 14pt; font-weight: 600; }
.print-album-gregorian, .print-album-count { margin: 0; color: #5C554B; font-size: 10pt; }
.print-album-description { margin: 6mm 0 0; max-width: 150mm; color: #45403A; font-size: 11pt; line-height: 1.7; }
.print-album-photos { display: grid; gap: 8mm; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.print-album[data-per-page="2"] .print-album-photos { grid-template-rows: repeat(2, minmax(0, 1fr)); }
.print-album[data-per-page="4"] .print-album-photos { gap: 6mm; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }
.print-album-item { display: flex; flex-direction: column; gap: 2.5mm; min-height: 0; margin: 0; break-inside: avoid; }
.print-album-frame { position: relative; flex: 1 1 auto; min-height: 0; }
.print-album-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.print-album-caption { flex: none; display: flex; flex-direction: column; gap: .5mm; text-align: center; }
.print-album-item-title { font-size: 10pt; font-weight: 600; }
.print-album-item-caption { color: #45403A; font-size: 9.5pt; line-height: 1.5; }
.print-album-item-date { color: #5C554B; font-size: 8pt; }
.print-album[data-per-page="4"] .print-album-item-title { font-size: 9pt; }
.print-album[data-per-page="4"] .print-album-item-caption { font-size: 8.5pt; }
`;

const FONTS_URL = "https://fonts.googleapis.com/css2?family=Assistant:wght@400;600&family=Frank+Ruhl+Libre:wght@500&display=block";

function figureHtml(item) {
  const alt = escapeHtml(item.caption || item.title);
  return `<figure class="print-album-item"><div class="print-album-frame"><img class="print-album-image" src="${escapeHtml(item.src)}" alt="${alt}"></div>`
    + `<figcaption class="print-album-caption"><strong class="print-album-item-title">${escapeHtml(item.title)}</strong>`
    + (item.caption ? `<span class="print-album-item-caption">${escapeHtml(item.caption)}</span>` : "")
    + (item.dateText ? `<span class="print-album-item-date">${escapeHtml(item.dateText)}</span>` : "")
    + `</figcaption></figure>`;
}

// כל המסמך: שער ועמודי תמונות. כל טקסט עובר escapeHtml — שמות, כיתובים
// ותיאורים הם טקסט של משתמשים, וכתובות התמונות הן https בלבד (prepareAlbumItems).
export function buildAlbumHtml({ title, description = "", coverDate = {}, items, perPage }) {
  const size = normalizeAlbumPerPage(perPage);
  const cover = [
    items[0] ? `<img class="print-album-cover-image" src="${escapeHtml(items[0].src)}" alt="">` : "",
    `<p class="print-album-kicker">אלבום תמונות</p>`,
    `<h1 class="print-album-title">${escapeHtml(title)}</h1>`,
    coverDate.hebrew ? `<p class="print-album-date">${escapeHtml(coverDate.hebrew)}</p>` : "",
    coverDate.gregorian ? `<p class="print-album-gregorian">${escapeHtml(coverDate.gregorian)}</p>` : "",
    `<p class="print-album-count">${escapeHtml(albumCountLabel(items))}</p>`,
    description ? `<p class="print-album-description">${escapeHtml(description)}</p>` : ""
  ].join("");
  const pages = paginateAlbum(items, size).map(pageItems =>
    `<section class="print-album-page print-album-photos" data-count="${pageItems.length}">${pageItems.map(figureHtml).join("")}</section>`
  ).join("");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<link rel="stylesheet" href="${FONTS_URL}"><style>${ALBUM_CSS}</style></head>`
    + `<body><main class="print-album" data-per-page="${size}">`
    + `<section class="print-album-page print-album-cover">${cover}</section>${pages}</main></body></html>`;
}

// קריאת הרשומות של הגלריה (images בלבד — פריט ממתין או מחוק אינו נכנס).
async function readAlbumRecords(env, ids) {
  const records = [];
  for (let start = 0; start < ids.length; start += DB_CHUNK) {
    const chunk = ids.slice(start, start + DB_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.GALLERY_DB.prepare(
      `SELECT document_id, data_json FROM gallery_documents WHERE collection_name = 'images' AND document_id IN (${placeholders})`
    ).bind(...chunk).all();
    for (const row of result?.results || []) {
      records.push({ ...parseDocumentData(row), id: row.document_id });
    }
  }
  return records;
}

export function albumRendererAvailable(env) {
  return typeof env?.BROWSER?.quickAction === "function"
    || Boolean(env?.BROWSER_RENDERING_TOKEN && env?.CF_ACCOUNT_ID);
}

const PDF_OPTIONS = {
  html: "",
  gotoOptions: { waitUntil: "networkidle0", timeout: PAGE_LOAD_TIMEOUT_MS },
  pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true, timeout: RENDER_TIMEOUT_MS }
};

async function readPdfBytes(result) {
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (ArrayBuffer.isView(result)) return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  if (result && typeof result.arrayBuffer === "function") return new Uint8Array(await result.arrayBuffer());
  if (result && typeof result.blob === "function") return new Uint8Array(await (await result.blob()).arrayBuffer());
  throw apiError("שירות יצירת ה-PDF החזיר תשובה לא צפויה.", 502, "album_render_failed");
}

function assertPdf(bytes) {
  // "%PDF" בתחילת הקובץ — אחרת זו הודעת שגיאה ולא אלבום.
  if (!(bytes?.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw apiError("יצירת ה-PDF בענן נכשלה. נסה שוב בעוד רגע.", 502, "album_render_failed");
  }
  return bytes;
}

export async function renderAlbumPdf(env, html, fetchImpl = fetch) {
  const options = { ...PDF_OPTIONS, html };
  if (typeof env?.BROWSER?.quickAction === "function") {
    const response = await env.BROWSER.quickAction("pdf", options);
    if (response?.ok === false) {
      console.error("Browser Rendering binding failed", response.status, (await response.text().catch(() => "")).slice(0, 500));
      if (response.status === 429) throw apiError("שירות ה-PDF בענן עמוס כרגע. נסה שוב בעוד דקה.", 429, "album_render_busy");
      throw apiError("יצירת ה-PDF בענן נכשלה. נסה שוב בעוד רגע.", 502, "album_render_failed");
    }
    return assertPdf(await readPdfBytes(response));
  }
  if (env?.BROWSER_RENDERING_TOKEN && env?.CF_ACCOUNT_ID) {
    const account = encodeURIComponent(String(env.CF_ACCOUNT_ID).trim());
    const init = {
      method: "POST",
      headers: { "Authorization": `Bearer ${String(env.BROWSER_RENDERING_TOKEN).trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(options)
    };
    // השירות שינה את שמו ל-Browser Run; הנתיב הישן נשאר כגיבוי.
    let response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-run/pdf`, init);
    if (response.status === 404) {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/pdf`, init);
    }
    if (response.status === 429) {
      throw apiError("שירות ה-PDF בענן עמוס כרגע. נסה שוב בעוד דקה.", 429, "album_render_busy");
    }
    if (!response.ok) {
      console.error("Browser Rendering failed", response.status, (await response.text().catch(() => "")).slice(0, 500));
      throw apiError("יצירת ה-PDF בענן נכשלה. נסה שוב בעוד רגע.", 502, "album_render_failed");
    }
    return assertPdf(new Uint8Array(await response.arrayBuffer()));
  }
  throw apiError("יצירת אלבום בענן עדיין לא הופעלה בשרת.", 409, "album_cloud_unavailable");
}

function albumOrigin(request, env) {
  try {
    const origin = env.PUBLIC_API_ORIGIN ? new URL(String(env.PUBLIC_API_ORIGIN).trim()).origin : new URL(request.url).origin;
    return origin;
  } catch {
    return new URL(request.url).origin;
  }
}

// אלבומים ישנים של אותו משתמש נמחקים בכל יצירה חדשה, כדי שהדלי לא יתמלא.
async function purgeExpiredAlbums(env, uid, now) {
  try {
    const listed = await env.GALLERY_BUCKET.list({ prefix: `${ALBUM_FILE_PREFIX}${uid}/`, limit: 100, include: ["customMetadata"] });
    for (const object of listed?.objects || []) {
      const created = Number(object.customMetadata?.createdAt) || (object.uploaded ? new Date(object.uploaded).getTime() : 0);
      if (created && now - created > ALBUM_TTL_MS) await env.GALLERY_BUCKET.delete(object.key);
    }
  } catch (error) {
    console.warn("Album cleanup skipped", error);
  }
}

// POST /album/pdf  { title, description, eventDate, perPage, ids: [...] }
export async function createAlbumPdf(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const user = await requireUser(request, env, ["viewer", "uploader", "admin", "super_admin"]);
  if (!albumRendererAvailable(env)) {
    throw apiError("יצירת אלבום בענן עדיין לא הופעלה בשרת.", 409, "album_cloud_unavailable");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw apiError("בקשת האלבום אינה תקינה.", 400, "invalid_album_request");
  }
  const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(cleanId).filter(Boolean))];
  if (!ids.length) throw apiError("לא נבחרו פריטים לאלבום.", 400, "empty_album");
  if (ids.length > ALBUM_MAX_ITEMS) throw apiError(`באלבום אחד אפשר עד ${ALBUM_MAX_ITEMS} פריטים.`, 400, "album_too_large");

  await consumeRateLimit(env, `album:${user.uid}`, ALBUM_RATE_LIMIT, ALBUM_RATE_WINDOW_MS,
    "נוצרו יותר מדי אלבומים בשעה האחרונה. נסה שוב מאוחר יותר.", "album_rate_limit_exceeded");

  const records = await readAlbumRecords(env, ids);
  const prepared = prepareAlbumItems(records);
  if (!prepared.items.length) throw apiError("אין באלבום תמונות להדפסה.", 400, "empty_album");

  const title = cleanText(body?.title, 120) || "אלבום";
  const description = cleanText(body?.description, 600);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.eventDate || "")) ? String(body.eventDate) : "";
  const perPage = normalizeAlbumPerPage(body?.perPage);
  const html = buildAlbumHtml({
    title, description, perPage, items: prepared.items,
    coverDate: albumCoverDate({ eventDate, records })
  });

  const pdf = await renderAlbumPdf(env, html, fetchImpl);
  const token = randomToken();
  const key = `${ALBUM_FILE_PREFIX}${user.uid}/${token}.pdf`;
  const fileName = albumFileName(title);
  await env.GALLERY_BUCKET.put(key, pdf, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { ownerUid: user.uid, createdAt: String(now), fileName, items: String(prepared.items.length) }
  });
  await purgeExpiredAlbums(env, user.uid, now);

  return json(request, {
    success: true,
    url: `${albumOrigin(request, env)}/album/file/${encodeURIComponent(user.uid)}/${token}`,
    fileName,
    items: prepared.items.length,
    skipped: prepared.skipped + Math.max(0, ids.length - records.length),
    pages: 1 + Math.ceil(prepared.items.length / perPage),
    bytes: pdf.length,
    expiresAt: now + ALBUM_TTL_MS
  });
}

// GET /album/file/<uid>/<token> — הקישור עצמו הוא ההרשאה (32 תווים אקראיים),
// כדי שאפשר יהיה לפתוח אותו בטלפון בלי כותרת התחברות. אחרי שבעה ימים — 404.
export async function serveAlbumPdf(request, env, pathname, now = Date.now()) {
  const match = /^\/album\/file\/([^/]+)\/([^/]+)$/.exec(pathname);
  const uid = match ? decodeURIComponent(match[1]) : "";
  const token = match ? match[2] : "";
  if (!UID_PATTERN.test(uid) || !TOKEN_PATTERN.test(token)) throw apiError("הקישור לאלבום אינו תקין.", 404, "not_found");
  const key = `${ALBUM_FILE_PREFIX}${uid}/${token}.pdf`;
  const object = await env.GALLERY_BUCKET.get(key);
  if (!object) throw apiError("האלבום לא נמצא או שפג תוקפו.", 404, "not_found");
  const created = Number(object.customMetadata?.createdAt) || 0;
  if (created && now - created > ALBUM_TTL_MS) {
    await env.GALLERY_BUCKET.delete(key);
    throw apiError("פג תוקף הקישור לאלבום. צור אותו מחדש.", 404, "album_expired");
  }
  const fileName = String(object.customMetadata?.fileName || "album.pdf").replace(/[\r\n"\\/]+/g, "-");
  const headers = new Headers(corsHeaders(request));
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `attachment; filename="album.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(object.body, { status: 200, headers });
}
