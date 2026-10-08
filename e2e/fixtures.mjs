// e2e/fixtures.mjs — התשתית של בדיקות הדפדפן.
//
// הבדיקות טוענות את האתר האמיתי ב-Chromium, אבל בלי רשת: ספריית Google,
// lucide והגופנים מוחלפים בתחליפים קטנים, וה-Worker מוחלף בזיוף בזיכרון
// שמחזיר בדיוק את הצורות ש-cloudflare-client.js מצפה להן (ראו
// handleDataRequest ו-establishGoogleSession ב-cloudflare-worker.js).
// כך הבדיקה מתרגלת את קוד הדפדפן כולו — התחברות, שחזור, הרשאות, גלריה —
// בלי להיות תלויה בשרת חי ובלי לגעת בנתונים אמיתיים.
import { test as base, expect } from '@playwright/test';
import zlib from 'node:zlib';

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
        if (method === 'GET' && approved) return;
        if (['PUT', 'DELETE'].includes(method) && admin) return;
    } else if (collectionName === 'trashItems') {
        if (superAdmin) return;
    }
    throw apiError('אין הרשאה לפעולה זו.', 403, 'permission_denied');
}

// increment() של הלקוח מגיע כאובייקט פעולה; השרת פותר אותו מול הערך הקודם.
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

    // /data/<אוסף>[/<מזהה>] — אותן צורות ואותם קודי שגיאה כמו handleDataRequest.
    handleData(request, url) {
        const method = request.method();
        const parts = url.pathname.slice('/data/'.length).split('/').filter(Boolean).map(decodeURIComponent);
        const collectionName = safeDataPart(parts[0], 'שם האוסף');
        if (!DATA_COLLECTIONS.has(collectionName)) throw apiError('האוסף המבוקש אינו קיים.', 404, 'collection_not_found');
        const documentId = parts[1] ? safeDataPart(parts[1], 'מזהה המסמך') : '';
        const actor = this.actor(request);
        assertDataPermission(actor, collectionName, method, documentId);
        const docs = this.collection(collectionName);

        if (method === 'GET' && documentId) {
            if (!docs.has(documentId)) throw apiError('המסמך לא נמצא.', 404, 'not_found');
            return { success: true, id: documentId, data: structuredClone(docs.get(documentId)) };
        }

        if (method === 'GET') {
            const limit = Math.max(1, Math.min(DATA_PAGE_MAX_LIMIT, Number(url.searchParams.get('limit')) || DATA_PAGE_DEFAULT_LIMIT));
            const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0));
            const orderField = safeDataPart(url.searchParams.get('orderBy') || 'updatedAt', 'שדה המיון');
            const ascending = url.searchParams.get('direction') === 'asc';
            // כמו ב-SQL של ה-Worker: שדה המיון כמספר, ומזהה המסמך כשובר שוויון.
            const rows = [...docs.entries()].sort(([idA, a], [idB, b]) => {
                const difference = (Number(a?.[orderField]) || 0) - (Number(b?.[orderField]) || 0);
                if (difference) return ascending ? difference : -difference;
                return idA < idB ? -1 : idA > idB ? 1 : 0;
            });
            const page = rows.slice(offset, offset + limit);
            return {
                success: true,
                documents: page.map(([id, data]) => ({ id, data: structuredClone(data) })),
                offset,
                limit,
                hasMore: rows.length > offset + limit
            };
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
            // משתמש רגיל אינו משנה את הדרגה או את מצב האישור של עצמו.
            if (collectionName === 'userProfiles' && documentId === actor.uid && actor.role !== 'super_admin') {
                nextData = {
                    ...nextData,
                    uid: actor.uid,
                    email: actor.email,
                    status: existing ? (existing.status || 'pending') : 'pending',
                    role: existing ? (existing.role || 'viewer') : 'viewer'
                };
            }
            docs.set(documentId, nextData);
            return { success: true, id: documentId, data: structuredClone(nextData) };
        }

        if (method === 'DELETE' && documentId) {
            docs.delete(documentId);
            return { success: true, id: documentId };
        }

        throw apiError('הפעולה אינה נתמכת.', 405, 'method_not_allowed');
    }

    async handle(route) {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        this.requests.push({
            method,
            path: `${url.pathname}${url.search}`,
            headers: request.headers(),
            body: request.postData() ?? null
        });

        // CORS כמו ב-Worker: המקור של הבקשה מוחזר כפי שהוא.
        const cors = {
            'Access-Control-Allow-Origin': request.headers()['origin'] || '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Face-Index-Token',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin'
        };
        const json = (data, status = 200) => route.fulfill({
            status,
            headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify(data)
        });

        // preflight כמו ב-Worker. בפועל Chromium תחת Playwright משלים בקשות
        // מיורטות בלי סבב OPTIONS, אבל הזיוף עונה עליו נכון אם יגיע.
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

        try {
            if (method === 'GET' && url.pathname.startsWith('/media/')) {
                return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }, body: this.media });
            }
            if (method === 'POST' && url.pathname === '/auth/session') return json(this.establishSession(request));
            if (url.pathname.startsWith('/data/')) return json(this.handleData(request, url));
            if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
                return json({ success: true, service: 'simchas-gallery-api', databaseConnected: true, bucketConnected: true });
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
    approved = true, role = 'viewer', status = approved ? 'approved' : 'pending', issuedAgoMs = 0
} = {}) {
    worker?.seedUser({ uid, email, name, status, role });
    const token = fakeSessionToken({ uid, email, name }, { issuedAgoMs });
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
