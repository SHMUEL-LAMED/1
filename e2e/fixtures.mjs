// e2e/fixtures.mjs — התשתית של בדיקות הדפדפן.
//
// הבדיקות טוענות את האתר האמיתי ב-Chromium, אבל בלי רשת: ספריית Google,
// lucide והגופנים מוחלפים בתחליפים קטנים, וה-Worker מוחלף בזיוף בזיכרון
// שמחזיר בדיוק את הצורות ש-cloudflare-client.js מצפה להן (ראו
// handleDataRequest ב-worker/data.js ו-establishGoogleSession ב-worker/auth.js).
// כך הבדיקה מתרגלת את קוד הדפדפן כולו — התחברות, שחזור, הרשאות, גלריה —
// בלי להיות תלויה בשרת חי ובלי לגעת בנתונים אמיתיים.
import { test as base, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
// הכיתובים ותגיות הסצנה: אותם כללים בדיוק כמו בדפדפן וב-Worker.
import { normalizeCaption, normalizeSceneTags, AI_CAPTION_VERSION } from '../scene-tags.js';

export const API_ORIGIN = 'https://simchas-gallery-api.0534169095.workers.dev';
// באתר שמוגש מ-127.0.0.1 הקוד פונה ל-Worker של סביבת הניסוי (ראו api-environment.js);
// שני המקורות מופנים לאותו זיוף, כך שהבדיקות אינן תלויות בסביבה שנבחרה.
export const STAGING_API_ORIGIN = 'https://simchas-gallery-api-staging.0534169095.workers.dev';
export const TOKEN_KEY = 'simchas_gallery_google_id_token';
export const GOOGLE_CLIENT_ID = '601586229891-giorl13mdpu7kfbeb6h2aj6qjpkphmmo.apps.googleusercontent.com';
export const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 365 * DAY_MS;

// אותם ערכים כמו ב-Worker, כדי שהזיוף יתנהג כמוהו גם בעימוד ובאוספים.
const DATA_COLLECTIONS = new Set([
    'folders', 'images', 'pendingImages', 'userProfiles', 'deletionRequests',
    'trashItems', 'activityLogs', 'systemMeta', 'userFavorites',
    'userPreferences', 'mediaStats'
]);
const DATA_PAGE_MAX_LIMIT = 1000;
const DATA_PAGE_DEFAULT_LIMIT = 500;
// שדות הסינון והקיבוץ שה-Worker מקבל (DATA_FILTER_FIELDS), ותקרת ?ids=.
const DATA_FILTER_FIELDS = ['folderId', 'status', 'mediaType', 'uploadedBy'];
const DATA_IDS_MAX = 200;
// שדות ההזמנה בפרופיל: רק השרת כותב אותם (INVITE_PROFILE_FIELDS ב-Worker).
const INVITE_PROFILE_FIELDS = ['inviteId', 'inviteFolderId', 'inviteFolderName', 'invitedAt', 'inviteAutoApproved'];

// --- ETag וסמני דפדוף, כמו ב-Worker ---

// ETag חזק: SHA-256 של הגוף, base64url, 22 התווים הראשונים.
export function computeEtag(body) {
    return `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
}

function etagMatches(header, etag) {
    return String(header || '').split(',').some(token => token.trim().replace(/^W\//i, '') === etag);
}

export function encodeCursor(value, id) {
    return Buffer.from(JSON.stringify({ v: value, id })).toString('base64url');
}

export function decodeCursor(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
        const value = Number(parsed?.v);
        const id = String(parsed?.id || '');
        if (!Number.isFinite(value) || !id) throw new Error('invalid cursor');
        return { value, id };
    } catch {
        throw apiError('סמן הדפדוף אינו תקין.', 400, 'invalid_cursor');
    }
}

export const DEFAULT_USER = { uid: 'google-user-1', email: 'viewer@example.com', name: 'דוד כהן', picture: '' };

// תיקיות הבסיס, כפי ש-app.js מגדיר אותן וכפי שהן נשמרות בענן באתחול.
export const DEFAULT_FOLDERS = [
    { id: 'all', name: 'כל התמונות', icon: 'grid', isDefault: true },
    { id: '1', name: 'אירועים ופעילויות', icon: 'calendar', isDefault: true },
    { id: '2', name: 'טיולים וסיורים', icon: 'compass', isDefault: true },
    { id: '3', name: 'הווי ומפגשים', icon: 'users', isDefault: true },
    { id: '4', name: 'כללי', icon: 'home', isDefault: true }
];

// --- אסימונים ---

function base64url(value) {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

export function decodeTokenPayload(token) {
    try {
        const part = String(token || '').split('.')[1];
        return part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) : null;
    } catch {
        return null;
    }
}

// אסימון ההתחברות של השרת, באותו מבנה שמנפיק createSessionToken ב-Worker.
// החתימה אינה נבדקת בזיוף; הדפדפן קורא רק את ה-payload.
export function fakeSessionToken(user = {}, { issuedAgoMs = 0, ttlMs = SESSION_TTL_MS } = {}) {
    const account = { ...DEFAULT_USER, ...user };
    const issuedAt = Date.now() - issuedAgoMs;
    return `v1.${base64url({
        sub: account.uid,
        email: account.email,
        email_verified: true,
        name: account.name,
        picture: account.picture || '',
        iat: Math.floor(issuedAt / 1000),
        exp: Math.floor((issuedAt + ttlMs) / 1000)
    })}.e2e-signature`;
}

// אסימון Google מזויף: JWT בן שלושה חלקים, תקף כשעה — כמו שספריית GIS מחזירה.
export function fakeGoogleToken(user = {}) {
    const account = { ...DEFAULT_USER, ...user };
    const now = Math.floor(Date.now() / 1000);
    return `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
        iss: 'https://accounts.google.com',
        aud: GOOGLE_CLIENT_ID,
        sub: account.uid,
        email: account.email,
        email_verified: true,
        name: account.name,
        picture: account.picture || '',
        iat: now,
        exp: now + 3600
    })}.e2e-signature`;
}

// --- מדיה ---

// תמונת PNG תקינה שנוצרת בזיכרון, כדי שהגלריה והתצוגה המלאה יטענו מדיה אמיתית.
export const MEDIA_SIZE = 8;

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
}

export function makePng(width = MEDIA_SIZE, height = MEDIA_SIZE, [r, g, b] = [212, 175, 55]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8); // עומק 8, RGB, ללא דחיסה מיוחדת, ללא פילטר, ללא interlace
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

// --- רשומות לזריעה ---

export function mediaUrl(id) {
    return `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/${id}.jpg`;
}

// תצוגות מקדימות (ראו media-variants.js): אותם מפתחות וכתובות שה-Worker רושם.
export const MEDIA_VARIANTS_VERSION = 1;
const VARIANT_NAMES = ['thumb', 'medium', 'poster'];
const VARIANT_TYPES = new Map([['image/webp', 'webp'], ['image/jpeg', 'jpg']]);
const MAX_VARIANT_BYTES = 2 * 1024 * 1024;

export function variantUrl(id, name, extension = 'webp') {
    return `${API_ORIGIN}/media/variants/${id}/${name}.${extension}`;
}

export function variantAvifUrl(id, name) {
    return variantUrl(id, name, 'avif');
}

// מוסיף לכל תצוגה עותק AVIF, כפי שה-Worker רושם אותו כשהדפדפן שלח כזה.
export function withAvif(variants, id) {
    return Object.fromEntries(Object.entries(variants).map(([name, entry]) => [name, {
        ...entry,
        avif: { key: `variants/${id}/${name}.avif`, url: variantAvifUrl(id, name), type: 'image/avif' }
    }]));
}

// שדה variants של רשומה שכבר יש לה תצוגות, כפי שהעלאה או ריצת ההשלמה רושמות אותו.
export function variantEntries(id, names = ['thumb', 'medium'], extension = 'webp') {
    const dimensions = { thumb: [480, 320], medium: [1280, 853], poster: [1280, 720] };
    return Object.fromEntries(names.map(name => [name, {
        key: `variants/${id}/${name}.${extension}`,
        url: variantUrl(id, name, extension),
        width: dimensions[name][0],
        height: dimensions[name][1],
        type: extension === 'jpg' ? 'image/jpeg' : 'image/webp'
    }]));
}

// רשומה ממתינה לאישור, כפי ש-savePendingImageCloud כותב אותה: הקובץ תחת
// pending/, ופרטי המעלה ברשומה.
export function pendingRecord(index, overrides = {}) {
    const id = `pending_e2e_${index}`;
    const createdAt = Date.UTC(2026, 8, 2, 10) + index * 60_000;
    const uploader = { uid: 'google-uploader-1', name: 'שרה לוי', email: 'sarah@example.com' };
    return {
        id,
        title: `העלאה ${index}`,
        url: `${API_ORIGIN}/media/pending/${uploader.uid}/${id}.jpg`,
        r2Key: `pending/${uploader.uid}/${id}.jpg`,
        r2OwnerUid: uploader.uid,
        r2Stored: true,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        originalSize: 2048,
        originalFolderName: 'הקפות',
        status: 'pending',
        uploadedBy: uploader.uid,
        uploadedByName: uploader.name,
        uploadedByEmail: uploader.email,
        date: new Date(createdAt).toISOString().split('T')[0],
        createdAt,
        ...overrides
    };
}

// רשומת תמונה בדיוק כפי שמסלול ההעלאה כותב אותה (ראו prepareMediaRecordForCloud
// ו-uploadMediaToR2 ב-app.js). התמונה ה-n היא החדשה ביותר.
export function imageRecord(index, overrides = {}) {
    const id = `img_e2e_${index}`;
    const createdAt = Date.UTC(2026, 8, 1, 10) + index * 60_000;
    return {
        id,
        folderId: '1',
        title: `תמונה ${index}`,
        url: mediaUrl(id),
        r2Key: `approved/${DEFAULT_USER.uid}/${id}.jpg`,
        r2OwnerUid: DEFAULT_USER.uid,
        r2Stored: true,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        originalSize: 1024,
        date: new Date(createdAt).toISOString().split('T')[0],
        createdAt,
        ...overrides
    };
}

// --- הזיוף של ה-Worker ---

function apiError(message, status = 400, code = 'request_failed') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function safeDataPart(value, label) {
    const part = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    if (!part) throw apiError(`${label} אינו תקין.`, 400, 'invalid_data_path');
    return part;
}

// אותן קבוצות מסמכים כמו ב-Worker: הגדרות שרק מנהל־על כותב, ומסמכי תחזוקה
// פנימיים שרק מנהל־על קורא (ואינם ברשימת האוסף של אחרים).
const SYSTEM_META_SUPER_ADMIN_WRITE_IDS = new Set(['downloadPrivacy', 'popupAnnouncement']);
const SYSTEM_META_PRIVATE_IDS = new Set(['backgroundJobs', 'backgroundState', 'maintenanceBrokenLinks', 'maintenanceAlert', 'maintenanceStorage', 'storageBudget']);
// הרקע המטושטש: אותה תבנית ואותה תקרה כמו normalizeMediaPlaceholder ב-Worker.
const PLACEHOLDER_PATTERN = /^data:image\/(?:bmp|webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
function normalizePlaceholder(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    return text.length <= 400 && PLACEHOLDER_PATTERN.test(text) ? text : '';
}
// המדדים שהדפדפן מדווח ל-/stats/beacon, והתקרה של כל אחד (USAGE_BEACON_LIMITS).
const USAGE_BEACON_LIMITS = { views: 500, downloads: 200, zipDownloads: 50, zipItems: 2000 };
const USER_ROLES = ['viewer', 'uploader', 'admin', 'super_admin'];

// העתק נאמן של assertDataPermission שב-Worker (בלי מנהל-העל הראשוני).
function assertDataPermission(actor, collectionName, method, documentId = '') {
    const approved = actor.status === 'approved';
    const admin = approved && ['admin', 'super_admin'].includes(actor.role);
    const superAdmin = approved && actor.role === 'super_admin';
    const ownDocument = documentId === actor.uid;

    if (collectionName === 'userProfiles') {
        if ((method === 'GET' || method === 'PUT') && ownDocument) return;
        if (superAdmin) return;
    } else if (['userFavorites', 'userPreferences'].includes(collectionName)) {
        if (approved && ownDocument) return;
    } else if (['folders', 'images'].includes(collectionName)) {
        if (method === 'GET' && approved) return;
        if (method === 'PUT' && collectionName === 'images' && approved && actor.role === 'uploader') return;
        if (['PUT', 'DELETE'].includes(method) && admin) return;
    } else if (collectionName === 'pendingImages') {
        if (admin) return;
        if (method === 'PUT' && approved) return;
    } else if (collectionName === 'mediaStats') {
        if (approved && ['GET', 'PUT'].includes(method)) return;
        if (superAdmin && method === 'DELETE') return;
    } else if (collectionName === 'activityLogs') {
        if (method === 'PUT' && approved) return;
        if (method === 'GET' && superAdmin) return;
    } else if (collectionName === 'deletionRequests') {
        if (method === 'PUT' && admin) return;
        if (['GET', 'DELETE'].includes(method) && superAdmin) return;
    } else if (collectionName === 'systemMeta') {
        const superAdminOnly = SYSTEM_META_PRIVATE_IDS.has(documentId) ||
            (method !== 'GET' && SYSTEM_META_SUPER_ADMIN_WRITE_IDS.has(documentId));
        if (superAdminOnly) {
            if (superAdmin) return;
        } else {
            if (method === 'GET' && approved) return;
            if (['PUT', 'DELETE'].includes(method) && admin) return;
        }
    } else if (collectionName === 'trashItems') {
        if (superAdmin) return;
    }
    throw apiError('אין הרשאה לפעולה זו.', 403, 'permission_denied');
}

// increment() של הלקוח מגיע כאובייקט פעולה; השרת פותר אותו מול הערך הקודם.
// כמו normalizeImageDescriptionFields ב-Worker: עותק ישן בלי השדות משאיר את
// מה שנשמר, רק מנהל משנה אותם, וכל ערך מנורמל (כיתוב עד 140, תגיות מהטקסונומיה).
const DESCRIPTION_FIELDS = ['caption', 'sceneTags', 'captionSource', 'aiCaptionVersion', 'aiCaptionGeneratedAt', 'captionEditedAt'];
function normalizeDescriptionFields(data, existing, canEdit) {
    const next = { ...data };
    const previous = existing || {};
    for (const field of DESCRIPTION_FIELDS) {
        if (canEdit && next[field] !== undefined) continue;
        if (previous[field] === undefined) delete next[field];
        else next[field] = previous[field];
    }
    if (next.caption !== undefined) {
        const caption = normalizeCaption(next.caption);
        if (caption) next.caption = caption; else delete next.caption;
    }
    if (next.sceneTags !== undefined) {
        const tags = normalizeSceneTags(next.sceneTags);
        if (tags.length) next.sceneTags = tags; else delete next.sceneTags;
    }
    if (next.captionSource !== undefined && !['ai', 'manual'].includes(next.captionSource)) delete next.captionSource;
    return next;
}

// תיקיות מקוננות, שער, סדר ועריכה — אותם כללים של ה-Worker (normalizeFolderFields,
// normalizeImageArrangeFields, checkFolderPlacement): שדה שחסר נשמר מהרשומה, רק
// מנהל משנה order/edit, וההורה קיים, בלי מעגל ועד שלוש רמות.
const FOLDER_MAX_DEPTH = 3;
const RECORD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const EDIT_REVISION_PATTERN = /^[a-z0-9]{1,24}$/;

function keepOrSet(next, previous, field, canEdit, normalize) {
    if (!canEdit || next[field] === undefined) {
        if (previous?.[field] === undefined) delete next[field];
        else next[field] = previous[field];
        return;
    }
    const value = normalize(next[field]);
    if (value === null) delete next[field];
    else next[field] = value;
}

function normalizeOrderRank(value) {
    if (value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15) {
        throw apiError('מיקום בסדר הידני חייב להיות מספר.', 400, 'invalid_order');
    }
    return value;
}

function normalizeMediaEdit(value) {
    if (value === null) return null;
    const invalid = () => apiError('נתוני העריכה של התמונה אינם תקינים.', 400, 'invalid_media_edit');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const rotate = value.rotate === undefined ? 0 : value.rotate;
    if (![0, 90, 180, 270].includes(rotate)) throw invalid();
    let crop = null;
    if (value.crop) {
        const parts = {};
        for (const key of ['x', 'y', 'w', 'h']) {
            const number = value.crop[key];
            if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) throw invalid();
            parts[key] = Math.round(number * 1e6) / 1e6;
        }
        if (parts.w < 0.02 || parts.h < 0.02 || parts.x + parts.w > 1 + 1e-6 || parts.y + parts.h > 1 + 1e-6) throw invalid();
        const full = parts.x <= 1e-6 && parts.y <= 1e-6 && parts.w >= 1 - 1e-6 && parts.h >= 1 - 1e-6;
        crop = full ? null : parts;
    }
    if (typeof value.rev !== 'string' || !EDIT_REVISION_PATTERN.test(value.rev)) throw invalid();
    if (rotate === 0 && !crop) return null;
    return { rotate, crop, rev: value.rev };
}

function checkFolderPlacement(folders, folderId, parentId) {
    if (!folders.has(parentId)) throw apiError('תיקיית האב אינה קיימת.', 400, 'folder_parent_not_found');
    let depth = 0;
    let current = parentId;
    const seen = new Set();
    while (current) {
        if (current === folderId) throw apiError('אי אפשר להעביר תיקייה אל תוך עצמה או אל תוך תת־תיקייה שלה.', 400, 'folder_cycle');
        if (seen.has(current)) throw apiError('מבנה התיקיות פגום (מעגל). פנה למנהל.', 409, 'folder_tree_corrupt');
        if (!folders.has(current)) break;
        seen.add(current);
        depth += 1;
        current = String(folders.get(current)?.parentId || '');
    }
    let height = 0;
    let layer = [folderId];
    while (layer.length && height <= FOLDER_MAX_DEPTH) {
        height += 1;
        layer = [...folders].filter(([, folder]) => layer.includes(String(folder?.parentId || ''))).map(([id]) => id);
    }
    if (depth + height > FOLDER_MAX_DEPTH) throw apiError(`אפשר לקנן תיקיות עד ${FOLDER_MAX_DEPTH} רמות בלבד.`, 400, 'folder_too_deep');
}

// התשובה המובנית של מודל ה-AI בזיוף: שם, כיתוב ותגיות (תוויות עבריות).
export const FAKE_AI_DESCRIPTION = {
    title: 'בחורים רוקדים במעגל',
    caption: 'מעגל ריקודים גדול באולם, וסביבו קהל שמוחא כפיים.',
    tags: ['ריקוד', 'תמונה קבוצתית']
};

function resolveDataOperations(value, previousValue) {
    if (value && typeof value === 'object' && value.__cloudflareOperation === 'increment') {
        return (Number(previousValue) || 0) + (Number(value.amount) || 0);
    }
    if (Array.isArray(value)) return value.map((item, index) => resolveDataOperations(item, previousValue?.[index]));
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = resolveDataOperations(item, previousValue?.[key]);
        return result;
    }
    return value;
}

export class FakeWorker {
    constructor() {
        this.collections = new Map(); // שם אוסף → Map(מזהה → נתונים)
        this.requests = [];           // יומן הבקשות שהגיעו, לאימות בבדיקות
        this.media = makePng();
        this.objects = new Map();     // R2 מדומה: מפתח → { bytes, contentType, metadata }
        this.missingMedia = new Set(); // מפתחות /media/ שהזיוף עונה להם 404 (קובץ שנמחק)
        // העלאה בחלקים (ראו createMultipartUpload ואילך ב-Worker): מזהה → מצב.
        this.multipart = new Map();
        this.multipartCounter = 0;
        // הזרקת תקלות לבדיקות התור: כמה העלאות רגילות ייכשלו ב-503, ואילו
        // מספרי חלקים ייכשלו (כל עוד הם בקבוצה).
        this.failUploads = 0;
        this.failParts = new Set();
        // השהיה מלאכותית לכל העלאה רגילה, כדי שבדיקה תספיק ללחוץ "בטל".
        this.uploadDelayMs = 0;
        // שם, כיתוב ותגיות (POST /ai-title): האם מוגדר מפתח AI, מה המודל
        // "מחזיר" לכל רשומה (פונקציה שיכולה גם לזרוק apiError), אילו תמונות
        // נשלחו אליו, ושער אופציונלי שמחזיק את הבקשה עד שהבדיקה משחררת אותו.
        this.aiEnabled = true;
        this.aiDescribe = () => FAKE_AI_DESCRIPTION;
        this.aiCalls = [];
        this.aiGate = null;
        // אנשים בגלריה: אנשים, תור "לבדיקה", פרצופים בודדים, התאמות של חיפוש
        // הפנים, טביעות "זכור אותי" שנשמרו, ומיקומי פרצופים שהדפדפן השלים.
        this.people = { persons: new Map(), review: [], singles: [], unclustered: 0, matches: [], me: new Map(), boxes: [], clusterRuns: 0 };
        // התחזוקה היומית (ראו "תחזוקה יומית" ב-Worker): הגיבויים שב-R2 (יום → בתים)
        // והדוח האחרון של הקישורים השבורים, בצורה ש-/maintenance/broken-links מחזיר.
        // maintenanceSupported=false מדמה Worker ישן שעדיין אינו מכיר את הנתיבים.
        this.maintenance = { backups: new Map(), brokenLinks: { report: null, scanning: null }, supported: true };
        // סטטיסטיקות (ראו receiveUsageBeacon ו-readUsageStats ב-Worker): הדיווחים
        // שהגיעו מהדפדפן, הימים שהבדיקה זורעת, וסיכום האחסון שהתחזוקה הייתה שומרת.
        this.usage = { beacons: [], days: [], activeUsers: { today: 0, last7: 0, last30: 0 }, visitDays: new Map() };
        this.storage = { report: null, scanning: null };
        // הערות פנימיות על משתמש (adminUserNotes ב-Worker): מזהה הערה → הערה.
        this.userNotes = new Map();
        this.userNotesCounter = 0;
        // משתמשים (ראו "משתמשים" ב-Worker): תיעוד הדחייה (מזהה → { uploader, title,
        // reason, rejectedAt }), התיוגים הידניים (מזהה תמונה → [{ personId, box }])
        // וקישורי ההזמנה (מזהה → קישור, עם tokenHash — האסימון עצמו לא נשמר).
        // usersSupported=false מדמה Worker ישן שאינו מכיר את הנתיבים (404).
        this.users = { rejections: new Map(), tags: new Map(), invites: new Map(), supported: true };
        // כתיבות POST /order שהגיעו, לבדיקה שנשלחו רק הרשומות שהשתנו.
        this.orderWrites = [];
    }

    requireSuperAdminActor(request) {
        const actor = this.requireApprovedActor(request);
        if (actor.role !== 'super_admin') throw apiError('לחשבון אין הרשאה לבצע פעולה זו.', 403, 'permission_denied');
        return actor;
    }

    seedBackup(day, text = '{"format":"simchas-gallery-d1-backup","tables":[]}') {
        this.maintenance.backups.set(day, zlib.gzipSync(Buffer.from(text)));
        return this;
    }

    collection(name) {
        if (!this.collections.has(name)) this.collections.set(name, new Map());
        return this.collections.get(name);
    }

    seed(collectionName, id, data) {
        this.collection(collectionName).set(String(id), structuredClone(data));
        return this;
    }

    seedUser({ uid = DEFAULT_USER.uid, email = DEFAULT_USER.email, name = DEFAULT_USER.name, picture = '', status = 'approved', role = 'viewer' } = {}) {
        const requestedAt = Date.now() - 7 * DAY_MS;
        return this.seed('userProfiles', uid, {
            uid, email, displayName: name, photoURL: picture, status, role, requestedAt,
            lastLoginAt: requestedAt,
            ...(status === 'approved' ? { approvedAt: requestedAt, approvedBy: 'e2e-admin' } : {})
        });
    }

    seedFolders(folders = DEFAULT_FOLDERS) {
        for (const folder of folders) this.seed('folders', folder.id, folder);
        return this;
    }

    seedImages(records) {
        for (const record of records) this.seed('images', record.id, record);
        return this;
    }

    // תיקיות הבסיס ו-n תמונות בתיקייה הראשונה.
    seedGallery({ images = 0 } = {}) {
        this.seedFolders();
        const records = Array.from({ length: images }, (_, index) => imageRecord(index + 1));
        this.seedImages(records);
        return records;
    }

    requestsTo(method, pathPrefix) {
        return this.requests.filter(entry => entry.method === method && entry.path.startsWith(pathPrefix));
    }

    // כמו resolveAccount ב-Worker: חייב להיות אסימון בכותרת, ובו מזהה ותוקף.
    account(request) {
        const header = request.headers()['authorization'] || '';
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (!match) throw apiError('נדרשת התחברות לחשבון מאושר.', 401, 'authentication_required');
        const payload = decodeTokenPayload(match[1]);
        if (!payload?.sub || Number(payload.exp || 0) * 1000 <= Date.now()) {
            throw apiError('תוקף ההתחברות הסתיים. התחבר מחדש ונסה שוב.', 401, 'invalid_token');
        }
        return {
            localId: String(payload.sub),
            email: String(payload.email || ''),
            displayName: String(payload.name || 'משתמש Google'),
            photoUrl: String(payload.picture || '')
        };
    }

    // כמו dataActor: חשבון חסום נדחה בכל בקשת נתונים, גם לקריאת הפרופיל שלו.
    actor(request) {
        const account = this.account(request);
        const profile = this.collection('userProfiles').get(account.localId) || null;
        if (profile?.status === 'blocked') throw apiError('החשבון חסום.', 403, 'account_blocked');
        return {
            uid: account.localId,
            email: account.email,
            account,
            status: profile?.status || 'pending',
            role: profile?.role || 'viewer'
        };
    }

    // POST /auth/session — החלפת אסימון Google (או חידוש אסימון שרת) באסימון שרת.
    establishSession(request) {
        const account = this.account(request);
        const profiles = this.collection('userProfiles');
        const existing = profiles.get(account.localId) || null;
        if (existing?.status === 'blocked') throw apiError('החשבון חסום.', 403, 'account_blocked');

        const now = Date.now();
        const profile = {
            ...(existing || {}),
            uid: account.localId,
            displayName: account.displayName || existing?.displayName || 'משתמש Google',
            email: account.email,
            photoURL: account.photoUrl || existing?.photoURL || '',
            status: existing?.status || 'pending',
            role: existing?.role || 'viewer',
            requestedAt: existing?.requestedAt || now,
            lastLoginAt: now
        };
        profiles.set(account.localId, profile);

        const sessionToken = fakeSessionToken({
            uid: account.localId, email: account.email, name: profile.displayName, picture: profile.photoURL
        });
        return {
            success: true,
            isNewUser: !existing,
            user: {
                uid: account.localId,
                email: account.email,
                displayName: profile.displayName,
                photoURL: profile.photoURL,
                status: profile.status,
                role: profile.role
            },
            sessionToken,
            sessionExpiresAt: decodeTokenPayload(sessionToken).exp * 1000
        };
    }

    // רשימה, ספירה או ספירה מקובצת — אותם פרמטרים ואותן צורות כמו ב-Worker:
    // סינון לפי השדות המותרים, ?ids=, סמן דפדוף (after → nextCursor) לצד
    // OFFSET הישן, ו-limit + 1 כדי לדעת אם יש המשך.
    listDocuments(docs, url, kind) {
        const limit = Math.max(1, Math.min(DATA_PAGE_MAX_LIMIT, Number(url.searchParams.get('limit')) || DATA_PAGE_DEFAULT_LIMIT));
        const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0));
        const orderField = safeDataPart(url.searchParams.get('orderBy') || 'updatedAt', 'שדה המיון');
        const ascending = url.searchParams.get('direction') === 'asc';
        const after = decodeCursor(url.searchParams.get('after'));

        let rows = [...docs.entries()];
        for (const field of DATA_FILTER_FIELDS) {
            const expected = url.searchParams.get(field);
            if (expected === null || expected === '') continue;
            rows = rows.filter(([, data]) => data?.[field] !== undefined && data?.[field] !== null && String(data[field]) === expected);
        }
        const rawIds = String(url.searchParams.get('ids') || '').split(',').map(value => value.trim()).filter(Boolean);
        if (rawIds.length > DATA_IDS_MAX) throw apiError(`אפשר לבקש עד ${DATA_IDS_MAX} מזהים בבקשה אחת.`, 400, 'too_many_ids');
        if (rawIds.length) {
            const ids = new Set(rawIds.map(value => safeDataPart(value, 'מזהה המסמך')));
            rows = rows.filter(([id]) => ids.has(id));
        }

        if (kind === 'count') return { success: true, count: rows.length };
        if (kind === 'counts') {
            const by = safeDataPart(url.searchParams.get('by') || 'folderId', 'שדה הקיבוץ');
            if (!DATA_FILTER_FIELDS.includes(by)) throw apiError('אי אפשר לקבץ לפי השדה הזה.', 400, 'invalid_group_field');
            const counts = {};
            for (const [, data] of rows) {
                const value = data?.[by] === undefined || data?.[by] === null ? '' : String(data[by]);
                counts[value] = (counts[value] || 0) + 1;
            }
            return { success: true, by, total: rows.length, counts };
        }

        // כמו ב-SQL של ה-Worker: שדה המיון כמספר, ומזהה המסמך כשובר שוויון.
        const orderValue = data => Number(data?.[orderField]) || 0;
        rows.sort(([idA, a], [idB, b]) => {
            const difference = orderValue(a) - orderValue(b);
            if (difference) return ascending ? difference : -difference;
            return idA < idB ? -1 : idA > idB ? 1 : 0;
        });
        if (after) {
            rows = rows.filter(([id, data]) => {
                const value = orderValue(data);
                const beyond = ascending ? value > after.value : value < after.value;
                return beyond || (value === after.value && id > after.id);
            });
        }
        const start = after ? 0 : offset;
        const page = rows.slice(start, start + limit);
        const hasMore = rows.length > start + limit;
        const last = page[page.length - 1];
        return {
            success: true,
            documents: page.map(([id, data]) => ({ id, data: structuredClone(data) })),
            offset: start,
            limit,
            hasMore,
            nextCursor: hasMore && last ? encodeCursor(orderValue(last[1]), last[0]) : null
        };
    }

    // /data/<אוסף>[/<מזהה>] — אותן צורות ואותם קודי שגיאה כמו handleDataRequest.
    handleData(request, url) {
        const method = request.method();
        const parts = url.pathname.slice('/data/'.length).split('/').filter(Boolean).map(decodeURIComponent);
        const collectionName = safeDataPart(parts[0], 'שם האוסף');
        if (!DATA_COLLECTIONS.has(collectionName)) throw apiError('האוסף המבוקש אינו קיים.', 404, 'collection_not_found');
        const documentId = parts[1] ? safeDataPart(parts[1], 'מזהה המסמך') : '';
        // /count ו-/counts הם רשימות מקוצרות ונבדקים בהרשאות של רשימת האוסף.
        const listKind = method === 'GET' && ['count', 'counts'].includes(documentId) ? documentId : '';
        const actor = this.actor(request);
        assertDataPermission(actor, collectionName, method, listKind ? '' : documentId);
        const docs = this.collection(collectionName);

        if (method === 'GET' && documentId && !listKind) {
            if (!docs.has(documentId)) throw apiError('המסמך לא נמצא.', 404, 'not_found');
            return { success: true, id: documentId, data: structuredClone(docs.get(documentId)) };
        }

        if (method === 'GET') {
            // כמו ב-Worker: המסמכים הפנימיים של systemMeta אינם ברשימה של מי שאינו מנהל־על.
            const visible = collectionName === 'systemMeta' && actor.role !== 'super_admin'
                ? new Map([...docs].filter(([id]) => !SYSTEM_META_PRIVATE_IDS.has(id)))
                : docs;
            return this.listDocuments(visible, url, listKind || 'list');
        }

        if (method === 'PUT' && documentId) {
            let payload = {};
            try { payload = JSON.parse(request.postData() || '{}'); } catch { payload = {}; }
            if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
                throw apiError('מבנה המסמך אינו תקין.', 400, 'invalid_document');
            }
            const existing = docs.get(documentId) || null;
            let nextData = resolveDataOperations(payload.data, existing || {});
            if (payload.merge === true) nextData = { ...(existing || {}), ...nextData };
            if (['images', 'pendingImages'].includes(collectionName)) {
                const admin = actor.status === 'approved' && ['admin', 'super_admin'].includes(actor.role);
                nextData = normalizeDescriptionFields(nextData, existing, admin);
                // כמו ב-Worker: עותק ישן בלי השדה אינו מוחק אותו, וערך פסול אינו נשמר.
                if (nextData.placeholder === undefined && existing?.placeholder) nextData = { ...nextData, placeholder: existing.placeholder };
                const placeholder = normalizePlaceholder(nextData.placeholder);
                if (placeholder) nextData.placeholder = placeholder; else delete nextData.placeholder;
                keepOrSet(nextData, existing, 'order', admin, normalizeOrderRank);
                if (existing && nextData.order !== undefined && nextData.order === existing.order && String(nextData.folderId ?? '') !== String(existing.folderId ?? '')) delete nextData.order;
                keepOrSet(nextData, existing, 'edit', admin, normalizeMediaEdit);
            }
            if (collectionName === 'userProfiles' && existing) this.assertSuperAdminRetained(actor, documentId, existing, nextData);
            if (collectionName === 'folders') nextData = this.normalizeFolder(documentId, nextData, existing || {});
            // כמו ב-Worker: מי ששמר הגדרה נקבע לפי החשבון המאומת.
            if (collectionName === 'systemMeta' && Object.prototype.hasOwnProperty.call(nextData, 'updatedBy')) {
                nextData.updatedBy = actor.uid;
            }
            // משתמש רגיל אינו משנה את הדרגה או את מצב האישור של עצמו.
            if (collectionName === 'userProfiles' && documentId === actor.uid && actor.role !== 'super_admin') {
                nextData = {
                    ...nextData,
                    uid: actor.uid,
                    email: actor.email,
                    status: existing ? (existing.status || 'pending') : 'pending',
                    role: existing ? (existing.role || 'viewer') : 'viewer'
                };
                for (const field of INVITE_PROFILE_FIELDS) {
                    if (existing?.[field] !== undefined) nextData[field] = existing[field];
                    else delete nextData[field];
                }
            }
            // צופה כותב רק רשומה ממתינה משלו, והמעלה הוא החשבון המאומת.
            if (collectionName === 'pendingImages' && !['admin', 'super_admin'].includes(actor.role)) {
                if (existing?.uploadedBy && existing.uploadedBy !== actor.uid) throw apiError('אין הרשאה לפעולה זו.', 403, 'permission_denied');
                nextData = { ...nextData, uploadedBy: actor.uid, status: 'pending' };
            }
            if (collectionName === 'pendingImages' && !existing && ['admin', 'super_admin'].includes(actor.role)) this.users.rejections.delete(documentId);
            docs.set(documentId, nextData);
            return { success: true, id: documentId, data: structuredClone(nextData) };
        }

        if (method === 'DELETE' && documentId) {
            if (collectionName === 'folders' && [...docs.values()].some(folder => String(folder?.parentId || '') === documentId)) {
                throw apiError('אי אפשר למחוק תיקייה שיש בה תת־תיקיות. העבר או מחק קודם את תת־התיקיות.', 409, 'folder_has_children');
            }
            if (collectionName === 'userProfiles' && docs.has(documentId)) this.assertSuperAdminRetained(actor, documentId, docs.get(documentId), {});
            // פריט ממתין שנמחק לפני אישור — נדחה מבחינת המעלה (recordUploadRejection).
            const removed = docs.get(documentId);
            docs.delete(documentId);
            if (collectionName === 'userProfiles') {
                for (const [id, note] of this.userNotes) if (note.targetUid === documentId) this.userNotes.delete(id);
            }
            if (collectionName === 'pendingImages') this.recordRejection(documentId, removed, null, actor.uid);
            return { success: true, id: documentId };
        }

        throw apiError('הפעולה אינה נתמכת.', 405, 'method_not_allowed');
    }

    normalizeFolder(documentId, data, existing) {
        const next = { ...data };
        const folders = this.collection('folders');
        if (next.parentId === undefined) {
            if (existing.parentId === undefined) delete next.parentId; else next.parentId = existing.parentId;
        } else if (next.parentId === null || next.parentId === '') {
            delete next.parentId;
        } else {
            if (typeof next.parentId !== 'string' || !RECORD_ID_PATTERN.test(next.parentId) || ['all', 'favorites'].includes(next.parentId)) {
                throw apiError('תיקיית האב אינו תקין.', 400, 'invalid_folder_parent');
            }
            if (next.parentId === documentId) throw apiError('תיקייה אינה יכולה להיות תת־תיקייה של עצמה.', 400, 'folder_cycle');
            if (next.parentId !== existing.parentId) checkFolderPlacement(folders, documentId, next.parentId);
        }
        if (next.coverImageId === undefined) {
            if (existing.coverImageId === undefined) delete next.coverImageId; else next.coverImageId = existing.coverImageId;
        } else if (next.coverImageId === null || next.coverImageId === '') {
            delete next.coverImageId;
        } else {
            if (typeof next.coverImageId !== 'string' || !RECORD_ID_PATTERN.test(next.coverImageId)) throw apiError('תמונת השער אינו תקין.', 400, 'invalid_cover_image');
            const inTrash = [...this.collection('trashItems').values()].some(item => item?.originalCollection === 'images' && item?.originalId === next.coverImageId);
            if (next.coverImageId !== existing.coverImageId && !this.collection('images').has(next.coverImageId) && !inTrash) {
                throw apiError('תמונת השער לא נמצאה בגלריה.', 400, 'cover_image_not_found');
            }
        }
        keepOrSet(next, existing, 'order', true, normalizeOrderRank);
        if (next.manualOrder === undefined) {
            if (existing.manualOrder === undefined) delete next.manualOrder; else next.manualOrder = existing.manualOrder;
        } else if (next.manualOrder === null || next.manualOrder === false) {
            delete next.manualOrder;
        } else if (next.manualOrder !== true) {
            throw apiError('הגדרת הסדר הידני אינה תקינה.', 400, 'invalid_manual_order');
        }
        return next;
    }

    // POST /order — כמו saveManualOrder ב-Worker: מנהל בלבד, כל המזהים קיימים
    // לפני שנכתב דבר, ורק השדה order משתנה.
    handleOrder(request) {
        const actor = this.actor(request);
        let payload = {};
        try { payload = JSON.parse(request.postData() || '{}'); } catch { payload = {}; }
        const collectionName = payload?.collection;
        if (!['images', 'folders'].includes(collectionName)) throw apiError('אפשר לסדר רק תמונות או תיקיות.', 400, 'invalid_order_collection');
        assertDataPermission(actor, collectionName, 'PUT');
        if (actor.status !== 'approved' || !['admin', 'super_admin'].includes(actor.role)) throw apiError('רק מנהל רשאי לשנות את הסדר הידני.', 403, 'permission_denied');
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (!items.length) throw apiError('לא נשלחו פריטים לסידור.', 400, 'order_items_missing');
        if (items.length > 500) throw apiError('אפשר לסדר עד 500 פריטים בבקשה אחת.', 400, 'too_many_order_items');
        const docs = this.collection(collectionName);
        const updates = new Map();
        for (const item of items) {
            if (typeof item?.id !== 'string' || !RECORD_ID_PATTERN.test(item.id)) throw apiError('מזהה הפריט אינו תקין.', 400, 'invalid_order_id');
            if (updates.has(item.id)) throw apiError('פריט הופיע פעמיים בסדר.', 400, 'duplicate_order_id');
            updates.set(item.id, normalizeOrderRank(item.order));
        }
        if ([...updates.keys()].some(id => !docs.has(id))) throw apiError('חלק מהפריטים כבר אינם קיימים. רענן ונסה שוב.', 409, 'order_items_not_found');
        this.orderWrites.push({ collection: collectionName, items: [...updates].map(([id, order]) => ({ id, order })) });
        for (const [id, order] of updates) {
            const next = { ...docs.get(id) };
            if (order === null) delete next.order; else next.order = order;
            docs.set(id, next);
        }
        return { success: true, collection: collectionName, updated: updates.size };
    }

    // --- מדיה: העלאה ותצוגות מקדימות (ראו uploadImage ו-attachMediaVariants ב-Worker) ---

    // הטופס כפי שהדפדפן שולח אותו: הקבצים כ-File, שאר השדות כמחרוזות.
    async formData(request) {
        const body = request.postDataBuffer();
        const contentType = request.headers()['content-type'] || '';
        if (!body || !contentType.startsWith('multipart/form-data')) throw apiError('לא צורף קובץ.', 400, 'file_missing');
        return new Response(body, { headers: { 'content-type': contentType } }).formData();
    }

    // כמו readVariantParts ב-Worker: חלק פסול מכשיל את הבקשה לפני שנשמר דבר.
    async readVariantParts(form) {
        let meta = {};
        try { meta = JSON.parse(String(form.get('variantsMeta') || '{}')); } catch { meta = {}; }
        const parts = [];
        for (const name of VARIANT_NAMES) {
            const part = form.get(`variant_${name}`);
            if (part === null || part === '') continue;
            if (typeof part.arrayBuffer !== 'function') throw apiError(`התצוגה ${name} אינה קובץ.`, 400, 'invalid_variant');
            const extension = VARIANT_TYPES.get(String(part.type || '').toLowerCase());
            if (!extension) throw apiError('תצוגה מקדימה חייבת להיות WebP או JPEG.', 415, 'unsupported_variant_type');
            if (!part.size || part.size > MAX_VARIANT_BYTES) throw apiError('גודל תצוגה מקדימה חייב להיות עד 2MB.', 413, 'variant_too_large');
            const avifPart = form.get(`variant_${name}_avif`);
            let avif = null;
            if (avifPart !== null && avifPart !== '') {
                if (String(avifPart.type || '').toLowerCase() !== 'image/avif') throw apiError('עותק AVIF של תצוגה חייב להיות image/avif.', 415, 'unsupported_variant_type');
                if (!avifPart.size || avifPart.size > MAX_VARIANT_BYTES) throw apiError('גודל תצוגה מקדימה חייב להיות עד 2MB.', 413, 'variant_too_large');
                avif = Buffer.from(await avifPart.arrayBuffer());
            }
            parts.push({
                name,
                type: String(part.type).toLowerCase(),
                extension,
                bytes: Buffer.from(await part.arrayBuffer()),
                width: Number(meta?.[name]?.width) || 0,
                height: Number(meta?.[name]?.height) || 0,
                avif
            });
        }
        for (const name of VARIANT_NAMES) {
            const orphan = form.get(`variant_${name}_avif`);
            if (orphan !== null && orphan !== '' && !parts.some(part => part.name === name)) {
                throw apiError(`עותק ה-AVIF של ${name} נשלח בלי התצוגה הרגילה.`, 400, 'avif_without_variant');
            }
        }
        return parts;
    }

    storeVariants(imageId, parts, { ownerUid, state, editRevision = '' }) {
        const variants = {};
        // כמו ב-Worker: תצוגות של תמונה ערוכה מקבלות ?v=<rev> ו-editRev.
        const versioned = url => (editRevision ? `${url}?v=${editRevision}` : url);
        for (const part of parts) {
            const key = `variants/${imageId}/${part.name}.${part.extension}`;
            this.objects.set(key, { bytes: part.bytes, contentType: part.type, metadata: { imageId, variant: part.name, ownerUid, state } });
            variants[part.name] = { key, url: versioned(`${API_ORIGIN}/media/${key}`), width: part.width, height: part.height, type: part.type };
            if (editRevision) variants[part.name].editRev = editRevision;
            const avifKey = `variants/${imageId}/${part.name}.avif`;
            if (part.avif) {
                this.objects.set(avifKey, { bytes: part.avif, contentType: 'image/avif', metadata: { imageId, variant: part.name, ownerUid, state } });
                variants[part.name].avif = { key: avifKey, url: versioned(`${API_ORIGIN}/media/${avifKey}`), type: 'image/avif' };
            } else {
                this.objects.delete(avifKey);
            }
        }
        return variants;
    }

    attachVariantsToRecords(imageId, variants, { editRevision = '' } = {}) {
        const updated = [];
        let merged = variants;
        for (const name of ['images', 'pendingImages']) {
            const docs = this.collection(name);
            const record = docs.get(imageId);
            if (!record) continue;
            merged = { ...(record.variants || {}), ...variants };
            const next = { ...record, variants: merged, variantsVersion: MEDIA_VARIANTS_VERSION };
            if (editRevision) delete next.placeholder;
            docs.set(imageId, next);
            updated.push(name);
        }
        return { variants: merged, updated };
    }

    // POST /upload — קובצי גלריה בלבד: המקור נשמר, והתצוגות שצורפו נשמרות לצדו.
    async handleUpload(request) {
        const actor = this.actor(request);
        if (this.uploadDelayMs) await new Promise(resolve => setTimeout(resolve, this.uploadDelayMs));
        if (this.failUploads > 0) {
            this.failUploads -= 1;
            throw apiError('שרת האחסון אינו זמין כרגע.', 503, 'unavailable');
        }
        if (actor.status !== 'approved') throw apiError('החשבון עדיין ממתין לאישור מנהל.', 403, 'approval_required');
        const form = await this.formData(request);
        const file = form.get('file');
        if (!file || typeof file.arrayBuffer !== 'function') throw apiError('לא צורף קובץ.', 400, 'file_missing');
        const imageId = safeDataPart(form.get('imageId'), 'מזהה התמונה');
        const mimeType = String(file.type || 'application/octet-stream').toLowerCase();
        const isVideo = mimeType.startsWith('video/');
        const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm', 'video/mp4': 'mp4' }[mimeType] || 'jpg';
        const variantParts = await this.readVariantParts(form);
        const state = actor.role === 'viewer' ? 'pending' : 'approved';
        const key = `${state}/${actor.uid}/${imageId}.${extension}`;
        this.objects.set(key, { bytes: Buffer.from(await file.arrayBuffer()), contentType: mimeType, metadata: { ownerUid: actor.uid, state } });
        const variants = variantParts.length ? this.storeVariants(imageId, variantParts, { ownerUid: actor.uid, state }) : null;
        if (variants) this.attachVariantsToRecords(imageId, variants);
        const placeholder = normalizePlaceholder(form.get('placeholder'));
        return {
            success: true,
            key,
            state,
            mediaType: isVideo ? 'video' : 'image',
            mimeType,
            fileName: file.name || '',
            size: file.size,
            url: `${API_ORIGIN}/media/${key}`,
            ...(variants ? { variants, variantsVersion: MEDIA_VARIANTS_VERSION } : {}),
            ...(placeholder ? { placeholder } : {})
        };
    }

    // --- העלאה בחלקים: אותם נתיבים, צורות וחוקים כמו ב-Worker ---
    static PART_SIZE = 8 * 1024 * 1024;

    multipartSession(actor, uploadId) {
        const session = this.multipart.get(String(uploadId || ''));
        if (!session) throw apiError('ההעלאה לא נמצאה או שפג תוקפה. התחל אותה מחדש.', 404, 'upload_session_not_found');
        if (session.ownerUid !== actor.uid) throw apiError('אין הרשאה להמשיך העלאה של משתמש אחר.', 403, 'permission_denied');
        return session;
    }

    multipartPayload(session) {
        return {
            success: true, uploadId: session.uploadId, key: session.key, imageId: session.imageId, state: session.state,
            size: session.size, partSize: FakeWorker.PART_SIZE, totalParts: session.totalParts, status: session.status,
            parts: [...session.parts.keys()].sort((a, b) => a - b).map(partNumber => ({ partNumber, etag: `etag-${partNumber}` }))
        };
    }

    handleMultipartCreate(request) {
        const actor = this.actor(request);
        if (actor.status !== 'approved') throw apiError('החשבון עדיין ממתין לאישור מנהל.', 403, 'approval_required');
        const payload = JSON.parse(request.postData() || '{}');
        const mimeType = String(payload.mimeType || '').toLowerCase();
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' }[mimeType];
        if (!extension) throw apiError('סוג הקובץ אינו נתמך.', 415, 'unsupported_file_type');
        const size = Number(payload.size);
        if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024 * 1024) throw apiError('גודל הסרטון חייב להיות עד 1GB.', 413, 'file_too_large');
        const imageId = safeDataPart(payload.imageId, 'מזהה התמונה');
        const state = actor.role === 'viewer' ? 'pending' : 'approved';
        this.multipartCounter += 1;
        const session = {
            uploadId: `mp-${this.multipartCounter}`, key: `${state}/${actor.uid}/${imageId}.${extension}`, imageId, state,
            ownerUid: actor.uid, mimeType, size, totalParts: Math.ceil(size / FakeWorker.PART_SIZE), parts: new Map(), status: 'uploading', result: null
        };
        this.multipart.set(session.uploadId, session);
        return this.multipartPayload(session);
    }

    handleMultipartPart(request, url) {
        const actor = this.actor(request);
        const session = this.multipartSession(actor, url.searchParams.get('uploadId'));
        const partNumber = Number(url.searchParams.get('partNumber'));
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.totalParts) throw apiError('מספר החלק אינו תקין.', 400, 'invalid_part_number');
        if (this.failParts.has(partNumber)) throw apiError('שרת האחסון אינו זמין כרגע.', 503, 'unavailable');
        const bytes = request.postDataBuffer() || Buffer.alloc(0);
        const expected = partNumber < session.totalParts ? FakeWorker.PART_SIZE : session.size - FakeWorker.PART_SIZE * (session.totalParts - 1);
        if (bytes.length !== expected) throw apiError('גודל החלק אינו תואם להעלאה.', 400, 'part_size_mismatch');
        session.parts.set(partNumber, Buffer.from(bytes));
        return { success: true, uploadId: session.uploadId, partNumber, etag: `etag-${partNumber}` };
    }

    async handleMultipartComplete(request) {
        const actor = this.actor(request);
        const form = await this.formData(request);
        const session = this.multipartSession(actor, form.get('uploadId'));
        if (session.status === 'completed') return session.result;
        for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
            if (!session.parts.has(partNumber)) throw apiError('חלק מהקובץ עדיין לא התקבל.', 409, 'upload_incomplete');
        }
        const variantParts = await this.readVariantParts(form);
        const bytes = Buffer.concat([...session.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part));
        this.objects.set(session.key, { bytes, contentType: session.mimeType, metadata: { ownerUid: actor.uid, state: session.state, uploadMode: 'multipart' } });
        const variants = variantParts.length ? this.storeVariants(session.imageId, variantParts, { ownerUid: actor.uid, state: session.state }) : null;
        session.status = 'completed';
        session.parts.clear();
        session.result = {
            success: true, key: session.key, state: session.state, mediaType: session.mimeType.startsWith('video/') ? 'video' : 'image',
            mimeType: session.mimeType, size: session.size, url: `${API_ORIGIN}/media/${session.key}`, uploadMode: 'multipart',
            ...(variants ? { variants, variantsVersion: MEDIA_VARIANTS_VERSION } : {})
        };
        return session.result;
    }

    handleMultipartAbort(request) {
        const actor = this.actor(request);
        const payload = JSON.parse(request.postData() || '{}');
        const session = this.multipart.get(String(payload.uploadId || ''));
        if (!session) return { success: true, uploadId: payload.uploadId, aborted: false };
        this.multipartSession(actor, payload.uploadId);
        this.multipart.delete(session.uploadId);
        return { success: true, uploadId: session.uploadId, aborted: true };
    }

    // POST /approve — כמו approveImage ב-Worker: מנהל בלבד, הקובץ עובר מ-pending/
    // ל-approved/, ואישור חוזר של קובץ שכבר עבר מחזיר את המפתח המאושר.
    handleApprove(request) {
        const actor = this.actor(request);
        if (actor.status !== 'approved' || !['admin', 'super_admin'].includes(actor.role)) {
            throw apiError('לחשבון אין הרשאה לבצע פעולה זו.', 403, 'permission_denied');
        }
        const payload = JSON.parse(request.postData() || '{}');
        const key = String(payload.key || '');
        if (!key.startsWith('pending/') || key.includes('..')) throw apiError('מפתח הקובץ אינו תקין.', 400, 'invalid_key');
        const approvedKey = `approved/${key.slice('pending/'.length)}`;
        const stored = this.objects.get(key);
        if (stored) {
            this.objects.set(approvedKey, { ...stored, metadata: { ...stored.metadata, state: 'approved', approvedBy: actor.uid } });
            this.objects.delete(key);
        }
        return { success: true, key: approvedKey, state: 'approved', url: `${API_ORIGIN}/media/${approvedKey}` };
    }

    // POST /media/variants — צירוף תצוגות לפריט קיים: מנהל לכל פריט, המעלה לפריט שלו.
    async handleAttachVariants(request) {
        const actor = this.actor(request);
        if (actor.status !== 'approved') throw apiError('החשבון עדיין ממתין לאישור מנהל.', 403, 'approval_required');
        const form = await this.formData(request);
        const imageId = safeDataPart(form.get('imageId'), 'מזהה התמונה');
        const active = this.collection('images').get(imageId);
        const pending = active ? null : this.collection('pendingImages').get(imageId);
        const record = active || pending;
        if (!record) throw apiError('רשומת המדיה לא נמצאה.', 404, 'not_found');
        const ownerUid = String(record.uploadedBy || record.r2OwnerUid || '');
        if (!['admin', 'super_admin'].includes(actor.role) && ownerUid !== actor.uid) {
            throw apiError('רק מי שהעלה את הפריט, או מנהל, רשאי לצרף לו תצוגות.', 403, 'permission_denied');
        }
        const editRevision = String(form.get('editRevision') || '');
        if (editRevision) {
            if (!['admin', 'super_admin'].includes(actor.role)) throw apiError('רק מנהל רשאי לצרף תצוגות של תמונה ערוכה.', 403, 'permission_denied');
            if (!EDIT_REVISION_PATTERN.test(editRevision)) throw apiError('מזהה העריכה אינו תקין.', 400, 'invalid_edit_revision');
        }
        const parts = await this.readVariantParts(form);
        // הרקע המטושטש: כאן ערך פסול מכשיל את הבקשה, ובקשה עם הרקע בלבד מותרת.
        const rawPlaceholder = form.get('placeholder');
        const placeholder = normalizePlaceholder(rawPlaceholder);
        if (rawPlaceholder !== null && rawPlaceholder !== '' && !placeholder) throw apiError('הרקע המטושטש אינו תקין.', 400, 'invalid_placeholder');
        if (!parts.length && !placeholder) throw apiError('לא צורפה אף תצוגה מקדימה.', 400, 'variant_missing');
        const variants = parts.length ? this.storeVariants(imageId, parts, { ownerUid: ownerUid || actor.uid, state: active ? 'approved' : 'pending', editRevision }) : {};
        const attached = parts.length ? this.attachVariantsToRecords(imageId, variants, { editRevision }) : { variants: record.variants || {}, updated: [] };
        if (placeholder) {
            for (const name of ['images', 'pendingImages']) {
                const docs = this.collection(name);
                if (!docs.has(imageId)) continue;
                docs.set(imageId, { ...docs.get(imageId), placeholder });
                if (!attached.updated.includes(name)) attached.updated.push(name);
            }
        }
        return { success: true, imageId, variants: attached.variants, variantsVersion: MEDIA_VARIANTS_VERSION, ...(placeholder ? { placeholder } : {}), updated: attached.updated };
    }

    // POST /ai-title — כמו generateImageDescription ב-Worker: מנהל בלבד, בלי
    // מפתח 503, שם AI נשמר פעם אחת, כיתוב ותגיות פעם אחת לכל גרסה, וכיתוב
    // ידני לעולם אינו נדרס. "המודל" הוא this.aiDescribe.
    async handleAiTitle(request) {
        const actor = this.actor(request);
        if (actor.status !== 'approved' || !['admin', 'super_admin'].includes(actor.role)) {
            throw apiError('לחשבון אין הרשאה לבצע פעולה זו.', 403, 'permission_denied');
        }
        if (!this.aiEnabled) throw apiError('מפתח ה־AI אינו מוגדר בשרת.', 503, 'openai_key_missing');
        const payload = JSON.parse(request.postData() || '{}');
        const id = safeDataPart(payload.imageId, 'מזהה התמונה');
        const docs = this.collection('images');
        const record = docs.get(id);
        if (!record) throw apiError('התמונה אינה קיימת בגלריה.', 404, 'not_found');
        const describe = data => ({
            id, title: data.title || '', caption: data.caption || '',
            sceneTags: normalizeSceneTags(data.sceneTags), captionSource: data.captionSource || ''
        });
        const needsTitle = record.aiTitleVersion !== 1;
        const needsCaption = record.aiCaptionVersion !== AI_CAPTION_VERSION && record.captionSource !== 'manual';
        if (!needsTitle && !needsCaption) return { success: true, ...describe(record), skipped: true };
        this.aiCalls.push(id);
        if (this.aiGate) await this.aiGate;
        const output = this.aiDescribe(record);
        const now = Date.now();
        const next = { ...record };
        if (needsTitle) {
            next.title = output.title;
            next.originalTitle = record.originalTitle || record.title || '';
            next.aiTitleVersion = 1;
            next.aiTitleGeneratedAt = now;
        }
        if (needsCaption) {
            const caption = normalizeCaption(output.caption);
            const tags = normalizeSceneTags(output.tags);
            if (caption) next.caption = caption; else delete next.caption;
            if (tags.length) next.sceneTags = tags; else delete next.sceneTags;
            next.captionSource = 'ai';
            next.aiCaptionVersion = AI_CAPTION_VERSION;
            next.aiCaptionGeneratedAt = now;
        }
        docs.set(id, next);
        return { success: true, ...describe(next), skipped: false };
    }

    // GET /media/variants/stats — כמו ב-Worker: סיכום הקבצים שנשמרו, לפי פורמט.
    variantStats(request) {
        const actor = this.actor(request);
        if (!['admin', 'super_admin'].includes(actor.role)) throw apiError('לחשבון אין הרשאה לבצע פעולה זו.', 403, 'permission_denied');
        const byFormat = {};
        const images = new Set();
        let files = 0;
        let bytes = 0;
        for (const [key, stored] of this.objects) {
            if (!key.startsWith('variants/')) continue;
            const format = key.slice(key.lastIndexOf('.') + 1);
            byFormat[format] ||= { files: 0, bytes: 0 };
            byFormat[format].files += 1;
            byFormat[format].bytes += stored.bytes.length;
            images.add(key.split('/')[1]);
            files += 1;
            bytes += stored.bytes.length;
        }
        return { success: true, files, bytes, images: images.size, byFormat, variantsVersion: MEDIA_VARIANTS_VERSION };
    }

    // --- אנשים בגלריה: אותם נתיבים, צורות והרשאות כמו ב-Worker (ראו
    // manageFaceGroups, listFacePersons, facePersonAlbum ו-faceMeRequest) ---

    // אדם בזיוף: קבוצת פרצופים עם שם, מצב והסתרה. פרצוף = {imageId, faceIndex, box}.
    seedPerson({ personId, name = '', status = 'suggested', hidden = false, faces = [], cover = null } = {}) {
        this.people.persons.set(personId, {
            personId, name, status, hidden,
            faces: faces.map(face => ({ faceIndex: 0, updatedAt: 1_700_000_000_000, box: null, source: 'auto', ...face })),
            cover
        });
        return this;
    }

    seedReview(face) {
        this.people.review.push({ faceIndex: 0, updatedAt: 1_700_000_000_000, box: null, distance: 0.42, ...face });
        return this;
    }

    seedSingle(face) {
        this.people.singles.push({ faceIndex: 0, updatedAt: 1_700_000_000_000, box: null, ...face });
        return this;
    }

    requireApprovedActor(request) {
        const actor = this.actor(request);
        if (actor.status !== 'approved') throw apiError('החשבון עדיין ממתין לאישור מנהל.', 403, 'approval_required');
        return actor;
    }

    // --- כלי הניהול: סטטיסטיקות, אחסון, פעולה מרובה והערות (ראו ב-Worker) ---

    isApprovedSuperAdmin(profile) {
        return profile?.status === 'approved' && profile?.role === 'super_admin';
    }

    assertSuperAdminRetained(actor, documentId, existing, next) {
        if (!this.isApprovedSuperAdmin(existing) || this.isApprovedSuperAdmin(next)) return;
        if (documentId === actor.uid) throw apiError('אי אפשר להוריד או לחסום את החשבון שאיתו אתה מחובר.', 403, 'self_lockout');
        const others = [...this.collection('userProfiles')].filter(([id, profile]) => id !== documentId && this.isApprovedSuperAdmin(profile));
        if (!others.length) throw apiError('זהו מנהל־העל המאושר האחרון; יש למנות מנהל־על נוסף קודם.', 409, 'last_super_admin');
    }

    // POST /stats/beacon — כל משתמש מאושר; הביקור הראשון ביום נספר.
    usageBeacon(request) {
        const actor = this.requireApprovedActor(request);
        const payload = JSON.parse(request.postData() || '{}');
        const counts = {};
        for (const [metric, limit] of Object.entries(USAGE_BEACON_LIMITS)) {
            const amount = Math.trunc(Number(payload?.counts?.[metric]));
            if (amount > 0) counts[metric] = Math.min(limit, amount);
        }
        const day = new Date().toISOString().slice(0, 10);
        const visit = this.usage.visitDays.get(actor.uid) !== day;
        this.usage.visitDays.set(actor.uid, day);
        this.usage.beacons.push({ uid: actor.uid, counts, visit });
        return { success: true, accepted: true, visit };
    }

    usageStats(request, url) {
        this.requireSuperAdminActor(request);
        const days = Math.max(1, Math.min(400, Math.trunc(Number(url.searchParams.get('days')) || 90)));
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
        return {
            success: true, from, to,
            metrics: ['visits', 'views', 'downloads', 'zipDownloads', 'zipItems', 'uploads', 'uploadsPending', 'approvals', 'rejections'],
            days: this.usage.days.filter(entry => entry.day >= from && entry.day <= to).map(entry => ({ ...entry })),
            collectedSince: this.usage.days[0]?.day || null,
            activeUsers: { ...this.usage.activeUsers }
        };
    }

    storageReport(request) {
        this.requireSuperAdminActor(request);
        const saved = this.collection('systemMeta').get('storageBudget') || {};
        const budget = {
            r2QuotaGb: Number(saved.r2QuotaGb) > 0 ? Number(saved.r2QuotaGb) : 0,
            d1QuotaMb: Number(saved.d1QuotaMb) > 0 ? Number(saved.d1QuotaMb) : 0,
            warnPercent: Number(saved.warnPercent) >= 10 && Number(saved.warnPercent) <= 100 ? Math.trunc(Number(saved.warnPercent)) : 80
        };
        const report = this.storage.report;
        const measure = (bytes, quotaBytes) => {
            if (!Number.isFinite(Number(bytes))) return { bytes: null, quotaBytes, percent: null, over: false };
            if (!quotaBytes) return { bytes: Number(bytes), quotaBytes, percent: null, over: false };
            const percent = Math.round((Number(bytes) / quotaBytes) * 1000) / 10;
            return { bytes: Number(bytes), quotaBytes, percent, over: percent >= budget.warnPercent };
        };
        const r2 = measure(report?.bytes, budget.r2QuotaGb * 1024 ** 3);
        const d1 = measure(report?.d1Bytes, budget.d1QuotaMb * 1024 ** 2);
        return {
            success: true, report: structuredClone(report), scanning: this.storage.scanning, budget,
            status: { r2, d1, over: Boolean(report?.completedAt) && (r2.over || d1.over), warnPercent: budget.warnPercent },
            groups: ['approved', 'pending', 'variants', 'backups', 'chat', 'other']
        };
    }

    // POST /admin/users/batch — אותם כללים כמו adminUsersBatch ב-Worker.
    usersBatch(request) {
        const actor = this.requireSuperAdminActor(request);
        const payload = JSON.parse(request.postData() || '{}');
        const action = String(payload.action || '');
        if (!['approve', 'block', 'unblock', 'role'].includes(action)) throw apiError('הפעולה אינה מוכרת.', 400, 'invalid_batch_action');
        const role = action === 'approve' ? String(payload.role || 'viewer') : String(payload.role || '');
        if ((action === 'approve' || action === 'role') && !USER_ROLES.includes(role)) throw apiError('הדרגה אינה תקינה.', 400, 'invalid_role');
        if (!Array.isArray(payload.uids) || !payload.uids.length || payload.uids.length > 100) throw apiError('רשימת המשתמשים אינה תקינה.', 400, 'invalid_user_ids');
        const profiles = this.collection('userProfiles');
        const results = [];
        const now = Date.now();
        for (const uid of [...new Set(payload.uids.map(String))]) {
            const fail = (code, message) => results.push({ uid, ok: false, code, message });
            if (uid === actor.uid) { fail('self_forbidden', 'פעולה מרובה אינה חלה על החשבון שלך.'); continue; }
            const profile = profiles.get(uid);
            if (!profile) { fail('not_found', 'המשתמש לא נמצא.'); continue; }
            let next;
            if (action === 'approve') {
                if (profile.status !== 'pending') { fail('not_pending', 'המשתמש אינו ממתין לאישור.'); continue; }
                next = { ...profile, status: 'approved', role, approvedAt: now, approvedBy: actor.uid };
            } else if (action === 'block') {
                if (profile.status === 'blocked') { fail('already_blocked', 'המשתמש כבר חסום.'); continue; }
                next = { ...profile, status: 'blocked', roleBeforeBlock: USER_ROLES.includes(profile.role) ? profile.role : 'viewer', blockedAt: now, blockedBy: actor.uid };
            } else if (action === 'unblock') {
                if (profile.status !== 'blocked') { fail('not_blocked', 'המשתמש אינו חסום.'); continue; }
                next = { ...profile, status: 'approved', role: USER_ROLES.includes(profile.roleBeforeBlock) ? profile.roleBeforeBlock : 'viewer', unblockedAt: now, unblockedBy: actor.uid };
            } else {
                if (profile.status !== 'approved') { fail('not_approved', 'אפשר לשנות דרגה רק למשתמש מאושר שאינו חסום.'); continue; }
                if (profile.role === role) { fail('unchanged', 'למשתמש כבר יש הדרגה הזו.'); continue; }
                next = { ...profile, role, roleChangedAt: now, roleChangedBy: actor.uid };
            }
            try {
                this.assertSuperAdminRetained(actor, uid, profile, next);
            } catch (error) {
                fail(error.code, error.message);
                continue;
            }
            profiles.set(uid, next);
            results.push({ uid, ok: true, status: next.status, role: next.role });
        }
        const succeeded = results.filter(result => result.ok).length;
        return { success: true, action, results, succeeded, failed: results.length - succeeded };
    }

    // /admin/user-notes — מנהל ומנהל־על; אף אחד אינו קורא הערות על עצמו.
    userNotesRequest(request, url) {
        const actor = this.requireAdminActor(request);
        const method = request.method();
        const view = note => ({ id: note.id, body: note.body, authorUid: note.authorUid, authorName: note.authorName, createdAt: note.createdAt, canDelete: note.authorUid === actor.uid || actor.role === 'super_admin' });
        const own = uid => { if (uid === actor.uid) throw apiError('הערות על החשבון שלך אינן נגישות לך.', 403, 'notes_about_self'); };
        if (method === 'GET') {
            const uid = String(url.searchParams.get('uid') || '');
            own(uid);
            const notes = [...this.userNotes.values()].filter(note => note.targetUid === uid).sort((a, b) => b.createdAt - a.createdAt).map(view);
            return { success: true, uid, notes };
        }
        if (method === 'POST') {
            const payload = JSON.parse(request.postData() || '{}');
            const uid = String(payload.uid || '');
            own(uid);
            const body = String(payload.body || '').trim();
            if (!body) throw apiError('ההערה ריקה.', 400, 'empty_note');
            if (body.length > 2000) throw apiError('הערה יכולה להכיל עד 2000 תווים.', 400, 'note_too_long');
            if (!this.collection('userProfiles').has(uid)) throw apiError('המשתמש לא נמצא.', 404, 'not_found');
            this.userNotesCounter += 1;
            const id = `note_00000000-0000-4000-8000-${String(this.userNotesCounter).padStart(12, '0')}`;
            const note = { id, targetUid: uid, authorUid: actor.uid, authorName: actor.account.displayName, body, createdAt: Date.now() + this.userNotesCounter };
            this.userNotes.set(id, note);
            return { success: true, uid, note: view(note) };
        }
        const id = decodeURIComponent(url.pathname.slice('/admin/user-notes/'.length));
        const note = this.userNotes.get(id);
        if (!note) throw apiError('ההערה לא נמצאה.', 404, 'not_found');
        own(note.targetUid);
        if (note.authorUid !== actor.uid && actor.role !== 'super_admin') throw apiError('רק מי שכתב את ההערה, או מנהל־על, רשאי למחוק אותה.', 403, 'permission_denied');
        this.userNotes.delete(id);
        return { success: true, id };
    }

    requireAdminActor(request) {
        const actor = this.requireApprovedActor(request);
        if (!['admin', 'super_admin'].includes(actor.role)) throw apiError('לחשבון אין הרשאה לבצע פעולה זו.', 403, 'permission_denied');
        return actor;
    }

    faceView(face) {
        const record = this.collection('images').get(face.imageId);
        const thumb = record?.variants?.thumb?.url;
        return {
            imageId: face.imageId,
            faceIndex: face.faceIndex,
            updatedAt: face.updatedAt,
            box: face.box || null,
            url: thumb || mediaUrl(face.imageId),
            sourceUrl: record?.url || mediaUrl(face.imageId)
        };
    }

    // רק פרצופים מתמונות שקיימות בגלריה המאושרת, כמו FACE_VALID_ASSIGNMENT.
    liveFaces(person) {
        return person.faces.filter(face => this.collection('images').has(face.imageId));
    }

    personSummary(person, { samples = 0 } = {}) {
        const faces = this.liveFaces(person);
        const coverFace = faces.find(face => person.cover && face.imageId === person.cover.imageId && face.faceIndex === person.cover.faceIndex)
            || faces.find(face => face.box) || faces[0] || null;
        return {
            personId: person.personId,
            name: person.name,
            status: person.status,
            hidden: person.hidden,
            faceCount: faces.length,
            imageCount: new Set(faces.map(face => face.imageId)).size,
            cover: coverFace ? this.faceView(coverFace) : null,
            ...(samples ? { samples: faces.slice(0, samples).map(face => this.faceView(face)) } : {})
        };
    }

    peopleCounts() {
        const persons = [...this.people.persons.values()].map(person => this.personSummary(person));
        return {
            suggested: persons.filter(person => person.status === 'suggested' && !person.hidden && person.faceCount > 0).length,
            approved: persons.filter(person => person.status === 'approved' && !person.hidden && person.faceCount > 0).length,
            hidden: persons.filter(person => person.hidden && person.faceCount > 0).length,
            review: this.people.review.length,
            singles: this.people.singles.length,
            unclustered: this.people.unclustered
        };
    }

    publicPerson(summary) {
        return {
            personId: summary.personId,
            name: summary.name,
            faceCount: summary.faceCount,
            imageCount: summary.imageCount,
            cover: summary.cover ? { imageId: summary.cover.imageId, box: summary.cover.box, url: summary.cover.url } : null
        };
    }

    listPersons(request) {
        this.requireApprovedActor(request);
        const persons = [...this.people.persons.values()]
            .map(person => this.personSummary(person))
            .filter(person => person.status === 'approved' && !person.hidden && person.name && person.faceCount > 0)
            .map(person => this.publicPerson(person));
        return { success: true, version: 1, persons };
    }

    personAlbum(request, personId) {
        const actor = this.requireApprovedActor(request);
        const person = this.people.persons.get(personId);
        const isAdmin = ['admin', 'super_admin'].includes(actor.role);
        if (!person || (!isAdmin && (person.status !== 'approved' || person.hidden || !person.name))) {
            throw apiError('האדם לא נמצא.', 404, 'person_not_found');
        }
        const images = this.collection('images');
        const detected = new Set(this.liveFaces(person).map(face => face.imageId));
        const manual = [...this.users.tags.entries()]
            .filter(([imageId, tags]) => images.has(imageId) && !detected.has(imageId) && tags.some(tag => tag.personId === personId))
            .map(([imageId]) => imageId);
        const ids = [...detected, ...manual]
            .sort((a, b) => (Number(images.get(b)?.takenAt ?? images.get(b)?.createdAt) || 0) - (Number(images.get(a)?.takenAt ?? images.get(a)?.createdAt) || 0));
        return { success: true, version: 1, person: this.publicPerson(this.personSummary(person)), imageIds: ids, manualImageIds: ids.filter(id => manual.includes(id)) };
    }

    readGroups(request, url) {
        this.requireAdminActor(request);
        const counts = this.peopleCounts();
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const personId = url.searchParams.get('person');
        if (personId) {
            const person = this.people.persons.get(personId);
            if (!person) throw apiError('האדם לא נמצא.', 404, 'person_not_found');
            const faces = this.liveFaces(person);
            return {
                success: true, view: 'person', counts, person: this.personSummary(person), offset,
                faces: faces.slice(offset, offset + 24).map(face => ({ ...this.faceView(face), source: face.source })),
                hasMore: faces.length > offset + 24
            };
        }
        const view = url.searchParams.get('view') || 'suggested';
        const all = [...this.people.persons.values()].map(person => this.personSummary(person, { samples: 6 }));
        if (view === 'options') {
            return {
                success: true, view, counts,
                options: all.filter(person => person.faceCount > 0)
                    .map(({ personId: id, name, status, hidden, faceCount }) => ({ personId: id, name, status, hidden, faceCount }))
            };
        }
        if (view === 'review') {
            return {
                success: true, view, counts, offset, hasMore: false,
                faces: this.people.review.map(item => {
                    const candidate = this.people.persons.get(item.candidateId);
                    return { ...this.faceView(item), distance: item.distance, candidate: candidate ? this.personSummary(candidate) : null };
                })
            };
        }
        if (view === 'singles') {
            return { success: true, view, counts, offset, hasMore: false, faces: this.people.singles.map(item => this.faceView(item)) };
        }
        const persons = all.filter(person => (view === 'hidden'
            ? person.hidden
            : !person.hidden && person.status === view && person.faceCount > 0));
        return { success: true, view, counts, offset, hasMore: false, persons };
    }

    takeFace(reference) {
        for (const person of this.people.persons.values()) {
            const index = person.faces.findIndex(face => face.imageId === reference?.imageId && face.faceIndex === reference?.faceIndex);
            if (index >= 0) {
                if (person.faces[index].updatedAt !== reference.updatedAt) throw apiError('הנתונים השתנו. רענן את הרשימה ונסה שוב.', 409, 'stale_faces');
                return person.faces.splice(index, 1)[0];
            }
        }
        for (const queue of [this.people.review, this.people.singles]) {
            const queueIndex = queue.findIndex(face => face.imageId === reference?.imageId && face.faceIndex === reference?.faceIndex);
            if (queueIndex >= 0) return queue.splice(queueIndex, 1)[0];
        }
        throw apiError('הנתונים השתנו. רענן את הרשימה ונסה שוב.', 409, 'stale_faces');
    }

    mutateGroups(request) {
        this.requireAdminActor(request);
        const payload = JSON.parse(request.postData() || '{}');
        const person = id => {
            const found = this.people.persons.get(String(id || ''));
            if (!found) throw apiError('האדם לא נמצא. ייתכן שהקבוצה אוחדה או נמחקה. רענן ונסה שוב.', 404, 'person_not_found');
            return found;
        };
        const name = () => {
            const value = String(payload.name ?? '').replace(/\s+/g, ' ').trim();
            if (!value) throw apiError('יש להזין שם.', 400, 'invalid_person_name');
            if (value.length > 60) throw apiError('השם ארוך מדי (עד 60 תווים).', 400, 'invalid_person_name');
            return value;
        };
        switch (payload.action) {
            case 'approve': { const target = person(payload.personId); target.name = name(); target.status = 'approved'; break; }
            case 'rename': { const target = person(payload.personId); target.name = name(); break; }
            case 'hide': person(payload.personId).hidden = true; break;
            case 'unhide': person(payload.personId).hidden = false; break;
            case 'merge': {
                const target = person(payload.targetId);
                const source = person(payload.sourceId);
                target.faces.push(...source.faces.map(face => ({ ...face, source: 'manual' })));
                if (!target.name && source.name) target.name = source.name;
                if (source.status === 'approved') target.status = 'approved';
                // כמו ב-Worker: ההסתרה גוברת במיזוג.
                if (source.hidden) target.hidden = true;
                this.people.persons.delete(source.personId);
                break;
            }
            case 'move': {
                const face = this.takeFace(payload.face);
                if (payload.targetId) person(payload.targetId).faces.push({ ...face, source: 'manual' });
                else {
                    const id = `fp_new_${this.people.persons.size + 1}`;
                    this.seedPerson({ personId: id, faces: [{ ...face, source: 'manual' }] });
                }
                break;
            }
            case 'accept': {
                const target = person(payload.personId);
                const face = this.takeFace(payload.face);
                target.faces.push({ ...face, source: 'manual' });
                break;
            }
            case 'reject': {
                // "לא — אדם אחר": הפרצוף חוזר להיות בודד, כמו ב-Worker.
                const { imageId, faceIndex, updatedAt, box } = this.takeFace(payload.face);
                this.people.singles.push({ imageId, faceIndex, updatedAt, box });
                break;
            }
            case 'remove':
                this.takeFace(payload.face);
                break;
            case 'cover': {
                const target = person(payload.personId);
                target.cover = { imageId: payload.face.imageId, faceIndex: payload.face.faceIndex };
                break;
            }
            default:
                throw apiError('הפעולה המבוקשת אינה מוכרת.', 400, 'invalid_action');
        }
        return { success: true, action: payload.action };
    }

    // --- משתמשים: "ההעלאות שלי", כפילויות, תיוג ידני והזמנות ---

    recordRejection(imageId, data, reason, actorUid) {
        if (!data || data.status === 'approved' || !data.uploadedBy || this.collection('images').has(imageId)) return false;
        const existing = this.users.rejections.get(imageId);
        if (reason === null && existing) return true;
        this.users.rejections.set(imageId, { uploader: data.uploadedBy, title: String(data.title || ''), reason: reason || '', rejectedBy: actorUid, rejectedAt: Date.now() });
        return true;
    }

    myUploads(request) {
        const actor = this.requireApprovedActor(request);
        const items = new Map();
        for (const [id, data] of this.collection('images')) {
            if (data.uploadedBy !== actor.uid) continue;
            const folder = this.collection('folders').get(String(data.folderId || ''));
            items.set(id, {
                id, title: String(data.title || ''), mediaType: data.mediaType === 'video' ? 'video' : 'image', status: 'approved',
                uploadedAt: Number(data.createdAt) || 0, decidedAt: 0, folderId: String(data.folderId || ''), folderName: folder?.name || '',
                thumbUrl: data.variants?.thumb?.url || data.url || ''
            });
        }
        for (const [id, data] of this.collection('pendingImages')) {
            if (data.uploadedBy !== actor.uid) continue;
            if (items.has(id)) { if (data.status === 'approved') items.get(id).decidedAt = Number(data.approvedAt) || 0; continue; }
            if (data.status === 'approved') continue;
            const rejection = this.users.rejections.get(id);
            items.set(id, {
                id, title: String(data.title || ''), mediaType: data.mediaType === 'video' ? 'video' : 'image',
                status: rejection ? 'rejected' : 'pending', uploadedAt: Number(data.createdAt) || 0,
                decidedAt: rejection?.rejectedAt || 0, ...(rejection?.reason ? { reason: rejection.reason } : {})
            });
        }
        for (const [id, rejection] of this.users.rejections) {
            if (rejection.uploader !== actor.uid || items.has(id)) continue;
            items.set(id, { id, title: rejection.title, mediaType: 'image', status: 'rejected', uploadedAt: 0, decidedAt: rejection.rejectedAt, ...(rejection.reason ? { reason: rejection.reason } : {}) });
        }
        const uploads = [...items.values()].sort((a, b) => Math.max(b.decidedAt, b.uploadedAt) - Math.max(a.decidedAt, a.uploadedAt));
        const counts = { pending: 0, approved: 0, rejected: 0 };
        for (const item of uploads) counts[item.status] += 1;
        return { success: true, retentionDays: 60, counts, uploads };
    }

    rejectUpload(request) {
        const actor = this.requireAdminActor(request);
        const payload = JSON.parse(request.postData() || '{}');
        const data = this.collection('pendingImages').get(String(payload.imageId || ''));
        if (!data) throw apiError('הפריט הממתין לא נמצא.', 404, 'pending_not_found');
        if (data.status === 'approved') throw apiError('הפריט כבר אושר.', 409, 'already_approved');
        return { success: true, recorded: this.recordRejection(String(payload.imageId), data, String(payload.reason || '').trim().slice(0, 300), actor.uid) };
    }

    duplicates(request) {
        const actor = this.requireApprovedActor(request);
        const payload = JSON.parse(request.postData() || '{}');
        if (!Array.isArray(payload.hashes) || payload.hashes.length > 100) throw apiError('יש לשלוח עד 100 טביעות.', 400, 'invalid_hashes');
        const hashes = [...new Set(payload.hashes.map(value => String(value).toLowerCase()))];
        if (hashes.some(hash => !/^(?:s1:)?[a-f0-9]{64}$/.test(hash))) throw apiError('טביעת התוכן אינה תקינה.', 400, 'invalid_hashes');
        const admin = ['admin', 'super_admin'].includes(actor.role);
        return {
            success: true,
            results: hashes.map(hash => {
                const image = [...this.collection('images')].find(([, data]) => data.contentHash === hash);
                if (image) return { hash, exists: true, imageId: image[0], state: 'approved' };
                const pending = [...this.collection('pendingImages')].find(([, data]) => data.contentHash === hash && data.status !== 'approved');
                if (!pending) return { hash, exists: false };
                return admin || pending[1].uploadedBy === actor.uid ? { hash, exists: true, imageId: pending[0], state: 'pending' } : { hash, exists: true };
            })
        };
    }

    faceTags(request, url) {
        this.requireAdminActor(request);
        const view = imageId => (this.users.tags.get(imageId) || []).map(tag => ({
            personId: tag.personId, name: this.people.persons.get(tag.personId)?.name || '', hidden: Boolean(this.people.persons.get(tag.personId)?.hidden), box: tag.box || null, createdAt: tag.createdAt
        }));
        if (request.method() === 'GET') {
            const imageId = String(url.searchParams.get('imageId') || '');
            return { success: true, imageId, tags: view(imageId) };
        }
        const payload = JSON.parse(request.postData() || '{}');
        const imageId = String(payload.imageId || '');
        const tags = this.users.tags.get(imageId) || [];
        if (payload.action === 'add') {
            const person = this.people.persons.get(String(payload.personId || ''));
            if (!person || person.status !== 'approved' || !person.name) throw apiError('אפשר לתייג רק אדם מאושר עם שם.', 400, 'invalid_tag_person');
            if (!this.collection('images').has(imageId)) throw apiError('התמונה לא נמצאה בגלריה.', 404, 'image_not_found');
            const next = tags.filter(tag => tag.personId !== person.personId);
            next.push({ personId: person.personId, box: payload.box || null, createdAt: Date.now() });
            this.users.tags.set(imageId, next);
        } else if (payload.action === 'remove') {
            this.users.tags.set(imageId, tags.filter(tag => tag.personId !== payload.personId));
        } else {
            throw apiError('הפעולה המבוקשת אינה מוכרת.', 400, 'invalid_action');
        }
        return { success: true, imageId, tags: view(imageId) };
    }

    // קישור הזמנה מוכן לבדיקה: האסימון מוחזר לבדיקה, ובזיוף נשמר רק הגיבוב.
    seedInvite({ token, folderId = '1', folderName, autoApprove = false, maxUses = 0, days = 7, createdBy = 'google-admin-e2e' } = {}) {
        const now = Date.now();
        const inviteId = `inv_${this.users.invites.size + 1}_e2e_seed`;
        this.users.invites.set(inviteId, {
            inviteId, tokenHash: createHash('sha256').update(token).digest('hex'), folderId,
            folderName: folderName || this.collection('folders').get(folderId)?.name || 'אירוע',
            autoApprove, maxUses, useCount: 0, createdBy, createdAt: now, expiresAt: now + days * DAY_MS, revokedAt: 0
        });
        return inviteId;
    }

    inviteView(invite, uid) {
        const now = Date.now();
        const status = invite.revokedAt ? 'revoked' : invite.expiresAt <= now ? 'expired' : invite.maxUses && invite.useCount >= invite.maxUses ? 'exhausted' : 'active';
        const { tokenHash, createdBy, ...rest } = invite;
        return { ...rest, status, mine: createdBy === uid };
    }

    invites(request, url) {
        const method = request.method();
        if (url.pathname === '/invites/redeem') {
            const account = this.account(request);
            const profiles = this.collection('userProfiles');
            const profile = profiles.get(account.localId);
            const { token } = JSON.parse(request.postData() || '{}');
            const tokenHash = createHash('sha256').update(String(token || '')).digest('hex');
            const invite = [...this.users.invites.values()].find(item => item.tokenHash === tokenHash);
            if (!invite || !/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) throw apiError('קישור ההזמנה אינו תקף.', 404, 'invite_invalid');
            const status = this.inviteView(invite).status;
            if (status === 'revoked') throw apiError('קישור ההזמנה בוטל.', 410, 'invite_revoked');
            if (status === 'expired') throw apiError('תוקף קישור ההזמנה פג.', 410, 'invite_expired');
            if (!profile) throw apiError('פרופיל המשתמש עדיין לא נוצר.', 403, 'profile_missing');
            if (profile.status === 'blocked') throw apiError('החשבון חסום.', 403, 'account_blocked');
            const base = { success: true, folderId: invite.folderId, folderName: invite.folderName };
            if (profile.status === 'approved') return { ...base, status: 'approved', autoApproved: false, alreadyApproved: true };
            if (profile.inviteId === invite.inviteId) return { ...base, status: profile.status || 'pending', autoApproved: false };
            if (status === 'exhausted') throw apiError('קישור ההזמנה כבר נוצל עד הסוף.', 410, 'invite_exhausted');
            invite.useCount += 1;
            const autoApprove = invite.autoApprove && (profile.status || 'pending') === 'pending';
            profiles.set(account.localId, {
                ...profile, inviteId: invite.inviteId, inviteFolderId: invite.folderId, inviteFolderName: invite.folderName, invitedAt: Date.now(),
                inviteAutoApproved: autoApprove, ...(autoApprove ? { status: 'approved', role: 'viewer', approvedAt: Date.now() } : {})
            });
            return { ...base, status: autoApprove ? 'approved' : (profile.status || 'pending'), autoApproved: autoApprove };
        }
        const actor = this.requireAdminActor(request);
        if (method === 'GET' && url.pathname === '/invites') {
            return {
                success: true, canAutoApprove: actor.role === 'super_admin', dayOptions: [1, 7, 30], maxUsesLimit: 1000,
                invites: [...this.users.invites.values()].sort((a, b) => b.createdAt - a.createdAt).map(invite => this.inviteView(invite, actor.uid))
            };
        }
        const payload = JSON.parse(request.postData() || '{}');
        if (url.pathname === '/invites/revoke') {
            const invite = this.users.invites.get(String(payload.inviteId || ''));
            if (!invite) throw apiError('הקישור לא נמצא.', 404, 'invite_not_found');
            if (invite.createdBy !== actor.uid && actor.role !== 'super_admin') throw apiError('אין הרשאה.', 403, 'permission_denied');
            invite.revokedAt ||= Date.now();
            return { success: true, invite: this.inviteView(invite, actor.uid) };
        }
        const folder = this.collection('folders').get(String(payload.folderId || ''));
        if (!folder || payload.folderId === 'all') throw apiError('התיקייה לא נמצאה.', 404, 'folder_not_found');
        if (![1, 7, 30].includes(Number(payload.days))) throw apiError('תוקף הקישור חייב להיות יום, שבוע או חודש.', 400, 'invalid_invite_days');
        if (payload.autoApprove === true && actor.role !== 'super_admin') throw apiError('רק מנהל־על יכול ליצור קישור עם אישור אוטומטי.', 403, 'permission_denied');
        const token = randomBytes(32).toString('base64url');
        const now = Date.now();
        const invite = {
            inviteId: randomBytes(12).toString('base64url'), tokenHash: createHash('sha256').update(token).digest('hex'),
            folderId: String(payload.folderId), folderName: folder.name, autoApprove: payload.autoApprove === true,
            maxUses: Number(payload.maxUses) || 0, useCount: 0, createdBy: actor.uid, createdAt: now,
            expiresAt: now + Number(payload.days) * DAY_MS, revokedAt: 0
        };
        this.users.invites.set(invite.inviteId, invite);
        return { success: true, invite: this.inviteView(invite, actor.uid), token };
    }

    faceMe(request) {
        const actor = this.requireApprovedActor(request);
        const method = request.method();
        if (method === 'DELETE') {
            this.people.me.delete(actor.uid);
            return { success: true, remembered: false };
        }
        if (method === 'PUT') {
            const payload = JSON.parse(request.postData() || '{}');
            if (payload.consent !== true) throw apiError('שמירת הטביעה מחייבת הסכמה מפורשת („זכור אותי”).', 400, 'consent_required');
            if (!Array.isArray(payload.descriptor) || payload.descriptor.length !== 128) throw apiError('טביעת פנים חייבת להכיל בדיוק 128 מספרים.', 400, 'invalid_face_descriptor');
            this.people.me.set(actor.uid, payload.descriptor);
            return { success: true, remembered: true, savedAt: Date.now() };
        }
        const remembered = this.people.me.has(actor.uid);
        return { success: true, remembered, savedAt: remembered ? 1 : 0 };
    }

    faceSearch(request, { saved = false } = {}) {
        const actor = this.requireApprovedActor(request);
        if (saved) {
            if (!this.people.me.has(actor.uid)) throw apiError('אין טביעה שמורה. חפש שוב לפי תמונה.', 404, 'face_me_not_saved');
        } else {
            const payload = JSON.parse(request.postData() || '{}');
            if (!Array.isArray(payload.descriptor) || payload.descriptor.length !== 128) throw apiError('טביעת פנים חייבת להכיל בדיוק 128 מספרים.', 400, 'invalid_face_descriptor');
        }
        const matches = this.people.matches
            .filter(match => this.collection('images').has(match.imageId))
            .map(match => ({ imageId: match.imageId, distance: match.distance, confidence: 80, source: 'biometric', strength: 'strong' }));
        return { success: true, matches, coverage: { totalImages: 0, indexedImages: 0, remainingImages: 0, failedImages: 0, ready: true } };
    }

    async handle(route) {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        this.requests.push({
            method,
            path: `${url.pathname}${url.search}`,
            headers: request.headers(),
            body: url.pathname === '/upload/multipart/part' ? null : (request.postData() ?? null)
        });

        // CORS כמו ב-Worker: המקור של הבקשה מוחזר כפי שהוא.
        const cors = {
            'Access-Control-Allow-Origin': request.headers()['origin'] || '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Face-Index-Token, If-None-Match',
            'Access-Control-Expose-Headers': 'ETag',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin'
        };
        const json = (data, status = 200) => route.fulfill({
            status,
            headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify(data)
        });
        // GET מ-/data נושא ETag, ו-If-None-Match תואם מקבל 304 ריק — כמו ב-Worker.
        const etagJson = data => {
            const body = JSON.stringify(data);
            const etag = computeEtag(body);
            if (etagMatches(request.headers()['if-none-match'], etag)) {
                return route.fulfill({ status: 304, headers: { ...cors, ETag: etag, 'Cache-Control': 'no-store' } });
            }
            return route.fulfill({
                status: 200,
                headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: etag },
                body
            });
        };

        // preflight כמו ב-Worker. בפועל Chromium תחת Playwright משלים בקשות
        // מיורטות בלי סבב OPTIONS, אבל הזיוף עונה עליו נכון אם יגיע.
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

        try {
            if (url.pathname === '/background/config') {
                this.backgroundConfig ||= { enabled: { titles: true, faces: true, variants: true, dates: true, drive: true }, driveFolders: [], intervalMinutes: 15 };
                if (method === 'PUT') this.backgroundConfig.enabled = { ...this.backgroundConfig.enabled, ...request.postDataJSON().enabled };
                return json({ success: true, config: this.backgroundConfig });
            }
            if (url.pathname === '/background/status') return json({ success: true, state: { phase: 'idle', jobs: {}, cursor: {}, retry: [] } });
            if (method === 'GET' && url.pathname === '/media/variants/stats') return json(this.variantStats(request));
            if (method === 'GET' && url.pathname.startsWith('/media/')) {
                // קובץ שהועלה בבדיקה מוגש כפי שנשמר; כל כתובת אחרת מקבלת את תמונת הבסיס.
                const key = decodeURIComponent(url.pathname.slice('/media/'.length));
                if (this.missingMedia.has(key)) throw apiError('קובץ המדיה לא נמצא.', 404, 'not_found');
                const stored = this.objects.get(key);
                return route.fulfill({
                    status: 200,
                    headers: { ...cors, 'Content-Type': stored?.contentType || 'image/png', 'Cache-Control': 'no-store' },
                    body: stored?.bytes || this.media
                });
            }
            if (method === 'POST' && url.pathname === '/upload') return json(await this.handleUpload(request), 201);
            if (method === 'POST' && url.pathname === '/upload/multipart/create') return json(this.handleMultipartCreate(request), 201);
            if (method === 'PUT' && url.pathname === '/upload/multipart/part') return json(this.handleMultipartPart(request, url));
            if (method === 'GET' && url.pathname === '/upload/multipart/status') return json(this.multipartPayload(this.multipartSession(this.actor(request), url.searchParams.get('uploadId'))));
            if (method === 'POST' && url.pathname === '/upload/multipart/complete') return json(await this.handleMultipartComplete(request), 201);
            if (method === 'POST' && url.pathname === '/upload/multipart/abort') return json(this.handleMultipartAbort(request));
            if (method === 'POST' && url.pathname === '/media/variants') return json(await this.handleAttachVariants(request));
            if (method === 'POST' && url.pathname === '/order') return json(this.handleOrder(request));
            if (method === 'POST' && url.pathname === '/approve') return json(this.handleApprove(request));
            if (method === 'POST' && url.pathname === '/auth/session') return json(this.establishSession(request));
            if (method === 'POST' && url.pathname === '/ai-title') return json(await this.handleAiTitle(request));
            if (url.pathname.startsWith('/data/')) {
                const payload = this.handleData(request, url);
                return method === 'GET' ? etagJson(payload) : json(payload);
            }
            if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
                return json({
                    success: true, service: 'simchas-gallery-api', databaseConnected: true, bucketConnected: true,
                    aiDescriptionsEnabled: this.aiEnabled
                });
            }
            if (method === 'GET' && url.pathname === '/face-assets/face-api.js') {
                return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/javascript; charset=utf-8' }, body: FACE_API_STUB });
            }
            if (!this.users.supported && (['/my-uploads', '/pending/reject', '/duplicates'].includes(url.pathname) || url.pathname.startsWith('/invites') || url.pathname === '/face/tags')) {
                throw apiError('הנתיב המבוקש אינו קיים.', 404, 'request_failed');
            }
            if (method === 'GET' && url.pathname === '/my-uploads') return json(this.myUploads(request));
            if (method === 'POST' && url.pathname === '/pending/reject') return json(this.rejectUpload(request));
            if (method === 'POST' && url.pathname === '/duplicates') return json(this.duplicates(request));
            if (['GET', 'POST'].includes(method) && url.pathname === '/face/tags') return json(this.faceTags(request, url));
            if (url.pathname === '/invites' || url.pathname === '/invites/revoke' || url.pathname === '/invites/redeem') {
                const payload = this.invites(request, url);
                return json(payload, method === 'POST' && url.pathname === '/invites' ? 201 : 200);
            }
            if (method === 'GET' && url.pathname === '/face/persons') return json(this.listPersons(request));
            if (method === 'GET' && url.pathname.startsWith('/face/persons/')) {
                return json(this.personAlbum(request, decodeURIComponent(url.pathname.slice('/face/persons/'.length))));
            }
            if (method === 'GET' && url.pathname === '/face/groups') return json(this.readGroups(request, url));
            if (method === 'POST' && url.pathname === '/face/groups') return json(this.mutateGroups(request));
            if (method === 'POST' && url.pathname === '/face/clusters/run') {
                this.requireAdminActor(request);
                this.people.clusterRuns += 1;
                const processed = this.people.unclustered;
                this.people.unclustered = 0;
                return json({ success: true, busy: false, processed, joined: processed, created: 0, review: 0, seeded: 0, remaining: 0 });
            }
            if (method === 'POST' && url.pathname === '/face/boxes') {
                this.requireAdminActor(request);
                const { boxes = [] } = JSON.parse(request.postData() || '{}');
                this.people.boxes.push(...boxes);
                for (const entry of boxes) {
                    for (const person of this.people.persons.values()) {
                        for (const face of person.faces) {
                            if (face.imageId === entry.imageId && face.faceIndex === entry.faceIndex && !face.box) face.box = entry.box;
                        }
                    }
                }
                return json({ success: true, saved: boxes.length });
            }
            if (url.pathname === '/face/me' && ['GET', 'PUT', 'DELETE'].includes(method)) return json(this.faceMe(request));
            if (method === 'POST' && url.pathname === '/face/me/search') return json(this.faceSearch(request, { saved: true }));
            if (method === 'POST' && url.pathname === '/face/search') return json(this.faceSearch(request));
            if (method === 'GET' && url.pathname === '/face/people') {
                this.requireAdminActor(request);
                return json({ faces: [], hasMore: false });
            }
            if (method === 'GET' && url.pathname === '/face/index/summary') {
                this.requireApprovedActor(request);
                return json({ success: true, totalImages: 0, indexedImages: 0, remainingImages: 0, failedImages: 0, faceCount: 0, ready: true });
            }
            if (url.pathname.startsWith('/maintenance/') && !this.maintenance.supported) {
                return json({ success: false, message: 'הנתיב המבוקש אינו קיים.' }, 404);
            }
            if (method === 'GET' && url.pathname === '/maintenance/backups') {
                this.requireSuperAdminActor(request);
                const backups = [...this.maintenance.backups].sort(([a], [b]) => b.localeCompare(a))
                    .map(([day, bytes]) => ({ day, size: bytes.length, compressed: true, uploadedAt: Date.parse(`${day}T03:00:00Z`) }));
                return json({ success: true, retentionDays: 30, backups });
            }
            if (method === 'POST' && url.pathname === '/maintenance/backup') {
                this.requireSuperAdminActor(request);
                const day = new Date().toISOString().slice(0, 10);
                const created = !this.maintenance.backups.has(day);
                if (created) this.seedBackup(day);
                return json({ success: true, created, day, size: this.maintenance.backups.get(day).length, compressed: true, pruned: [] });
            }
            if (method === 'GET' && url.pathname.startsWith('/maintenance/backups/')) {
                this.requireSuperAdminActor(request);
                const day = decodeURIComponent(url.pathname.slice('/maintenance/backups/'.length));
                const bytes = this.maintenance.backups.get(day);
                if (!bytes) throw apiError('הגיבוי לא נמצא.', 404, 'not_found');
                return route.fulfill({
                    status: 200,
                    headers: { ...cors, 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="simchas-gallery-d1-${day}.json.gz"`, 'Cache-Control': 'private, no-store' },
                    body: bytes
                });
            }
            if (method === 'GET' && url.pathname === '/maintenance/broken-links') {
                this.requireSuperAdminActor(request);
                return json({ success: true, listMax: 300, ...structuredClone(this.maintenance.brokenLinks) });
            }
            if (method === 'POST' && url.pathname === '/stats/beacon') return json(this.usageBeacon(request));
            if (method === 'GET' && url.pathname === '/stats/usage') return json(this.usageStats(request, url));
            if (method === 'GET' && url.pathname === '/maintenance/storage') return json(this.storageReport(request));
            if (method === 'POST' && url.pathname === '/admin/users/batch') return json(this.usersBatch(request));
            if ((['GET', 'POST'].includes(method) && url.pathname === '/admin/user-notes') || (method === 'DELETE' && url.pathname.startsWith('/admin/user-notes/'))) {
                return json(this.userNotesRequest(request, url));
            }
            if (method === 'POST' && url.pathname === '/drive/token') {
                this.actor(request);
                return json({ success: true, connected: false });
            }
            return json({ success: false, message: 'הנתיב המבוקש אינו קיים.' }, 404);
        } catch (error) {
            return json({
                success: false,
                code: error?.code || 'internal_error',
                message: error?.message || 'אירעה שגיאה פנימית.'
            }, Number(error?.status) || 500);
        }
    }
}

// --- תחליפים לסקריפטים חיצוניים ---

// ספריית Google Identity: initialize שומר את ההגדרות (ובהן ה-callback) כדי
// שהבדיקה תוכל "ללחוץ על הכפתור" בעצמה, ו-renderButton מסמן את המקום.
const GIS_STUB = `(() => {
    const id = {
        initialize(config) { window.__gisConfig = config; },
        renderButton(host) { if (host) host.textContent = '[google]'; },
        prompt() {}, cancel() {}, disableAutoSelect() {}, revoke() {}, storeCredential() {}
    };
    const oauth2 = {
        initTokenClient() { return { requestAccessToken() {} }; },
        initCodeClient() { return { requestCode() {} }; },
        hasGrantedAllScopes() { return false; }, revoke() {}
    };
    window.google = { ...(window.google || {}), accounts: { id, oauth2 } };
})();`;
const LUCIDE_STUB = 'window.lucide = { createIcons() {} };';

// מנוע זיהוי הפנים: במקום face-api.js והמודלים, תחליף שמחזיר תמיד את אותה
// טביעה ואת אותו מיקום — כך "התמונות שלי" ונתיבי המיקום רצים בדפדפן אמיתי
// בלי רשת. window.__faceStubNoFace מדמה תמונה שאין בה פנים.
export const FACE_API_STUB = `(() => {
    const net = () => ({ isLoaded: true, async loadFromUri() {} });
    const descriptor = () => Float32Array.from({ length: 128 }, (_, index) => (index === 1 ? 0.68 : 0.08));
    const detection = { descriptor: descriptor(), detection: { box: { x: 2, y: 1, width: 4, height: 5 } } };
    window.faceapi = {
        nets: { ssdMobilenetv1: net(), faceLandmark68Net: net(), faceRecognitionNet: net() },
        detectSingleFace: () => ({ withFaceLandmarks: () => ({ withFaceDescriptor: async () => (window.__faceStubNoFace ? undefined : detection) }) }),
        detectAllFaces: () => ({ withFaceLandmarks: () => ({ withFaceDescriptors: async () => [0, 1, 2, 3].map(index => ({
            descriptor: descriptor(),
            detection: { box: { x: 1 + index, y: 1, width: 3, height: 4 } }
        })) }) })
    };
})();`;

const script = body => route => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
const isLocal = url => url.hostname === '127.0.0.1' || url.hostname === 'localhost';

export async function installRoutes(context, worker) {
    // סדר הרישום הפוך לסדר הבדיקה: הכלל הכללי נרשם ראשון ונבדק אחרון.
    // כל כתובת חיצונית שאינה מטופלת במפורש נחסמת — הבדיקות אינן תלויות ברשת.
    await context.route(url => !isLocal(url), route => route.abort('blockedbyclient'));
    await context.route(url => url.hostname === 'fonts.gstatic.com', route => route.abort('blockedbyclient'));
    await context.route(url => url.hostname === 'fonts.googleapis.com', route => route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' }));
    await context.route(url => url.hostname === 'unpkg.com', script(LUCIDE_STUB));
    await context.route(url => url.hostname === 'accounts.google.com', script(GIS_STUB));
    await context.route(url => url.origin === API_ORIGIN || url.origin === STAGING_API_ORIGIN, route => worker.handle(route));
}

// --- עזרים לבדיקות ---

// כותב אסימון התחברות של השרת ל-localStorage לפני שקוד האתר רץ — בדיוק מה
// שדפדפן של משתמש שכבר התחבר פעם מכיל — וזורע את הפרופיל התואם בזיוף.
export async function seedSession(page, {
    worker, uid = DEFAULT_USER.uid, email = DEFAULT_USER.email, name = DEFAULT_USER.name,
    approved = true, role = 'viewer', status = approved ? 'approved' : 'pending', issuedAgoMs = 0, picture = ''
} = {}) {
    worker?.seedUser({ uid, email, name, status, role, picture });
    const token = fakeSessionToken({ uid, email, name, picture }, { issuedAgoMs });
    await page.addInitScript(([key, value]) => {
        // פעם אחת לכל לשונית: רענון אחרי התנתקות אינו מחזיר את האסימון.
        try {
            if (!sessionStorage.getItem('__e2eSessionSeeded')) {
                localStorage.setItem(key, value);
                sessionStorage.setItem('__e2eSessionSeeded', '1');
            }
        } catch {
            // אחסון חסום.
        }
    }, [TOKEN_KEY, token]);
    return token;
}

// מדמה לחיצה על כפתור Google: ספריית GIS הייתה קוראת ל-callback עם
// credential, וכאן הבדיקה קוראת לו ישירות עם אסימון Google מזויף.
export async function signInViaGoogle(page, user = {}) {
    const credential = fakeGoogleToken(user);
    await page.waitForFunction(() => typeof window.__gisConfig?.callback === 'function');
    await page.evaluate(credential => window.__gisConfig.callback({ credential }), credential);
    return credential;
}

// בוררי הסינון (שנה, חודש, טווח, סוג מדיה, כיוון, אורך, סוג הרגע) יושבים
// בחלונית "סינון" של סרגל הכלים (gallery-filter-panel.js), ולכן בדיקה שבוחרת
// בהם פותחת אותה קודם — כמו המשתמש. אם היא כבר פתוחה, אין לחיצה נוספת.
export async function openGalleryFilters(page) {
    const panel = page.locator('#galleryFilterPanel');
    if (!(await panel.isVisible())) await page.locator('#galleryFilterToggle').click();
    await expect(panel).toBeVisible();
}

// סוגר את החלונית ב"הצגת N פריטים" שבתחתית, למשל לפני לחיצה על כרטיס.
export async function closeGalleryFilters(page) {
    const panel = page.locator('#galleryFilterPanel');
    if (await panel.isVisible()) await page.locator('#galleryFilterDone').click();
    await expect(panel).toBeHidden();
}

export function readStoredToken(page) {
    return page.evaluate(key => localStorage.getItem(key), TOKEN_KEY);
}

export const test = base.extend({
    worker: async ({}, use) => {
        await use(new FakeWorker());
    },

    // כל החיבורים לרשת מיורטים לפני שהדף הראשון נפתח.
    context: async ({ context, worker }, use) => {
        await installRoutes(context, worker);
        await use(context);
    },

    // כל מה שהדף זורק — חריגה שלא נתפסה או הבטחה שנדחתה — נאסף, ובסוף
    // הבדיקה חייב להיות ריק. כך רגרסיה שקטה בקוד הדף מכשילה את הבדיקה.
    pageErrors: [async ({ context }, use) => {
        const errors = [];
        const watch = page => page.on('pageerror', error => errors.push(error));
        context.pages().forEach(watch);
        context.on('page', watch);
        await use(errors);
        expect(errors.map(error => String(error?.stack || error)), 'הדף זרק שגיאות').toEqual([]);
    }, { auto: true }],

    page: async ({ page, pageErrors }, use) => {
        void pageErrors;
        await use(page);
    }
});

export { expect };
