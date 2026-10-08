// upload-resumable.js — העלאה בחלקים שאפשר להמשיך (R2 multipart דרך ה-Worker).
//
// קובץ גדול (בעיקר סרטון מהטלפון) נחתך לחלקים של 8MiB ונשלח חלק אחר חלק.
// מצב ההעלאה נשמר בשני מקומות:
//   * ב-Worker (D1): אילו חלקים התקבלו. זה המקור הקובע.
//   * בדפדפן (IndexedDB): לאיזו העלאה שייך הקובץ הזה — לפי "טביעת קובץ"
//     (שם, גודל, תאריך שינוי ודגימה של התוכן) — ואיזה מזהה מדיה הוקצה לו.
// אחרי ניתוק, ניסיון חוזר או רענון של הדף, בחירה מחודשת של אותו קובץ מוצאת
// את ההעלאה השמורה, שואלת את ה-Worker מה כבר הגיע וממשיכה מהחלק הבא.
//
// המודול אינו נוגע ב-DOM. הרשת מוזרקת (api), וגם האחסון (store), ולכן כל
// מכונת המצבים נבדקת ב-Node (upload-resumable.test.mjs) בלי דפדפן.

export const RESUMABLE_PART_SIZE = 8 * 1024 * 1024;
// קובץ גדול מחלק אחד עולה בחלקים; קטן ממנו נשאר בבקשה אחת (POST /upload).
export const RESUMABLE_THRESHOLD = RESUMABLE_PART_SIZE;
// דגימת התוכן לטביעה: תחילת הקובץ וסופו. קריאת קובץ של 1GB כולו רק כדי
// לזהות אותו הייתה איטית וכבדה בזיכרון בטלפון.
const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;
const STORE_DB_NAME = 'simchas-gallery-uploads';
const STORE_NAME = 'resumable';
// מצב שמור ישן מזה אינו שווה ניסיון: גם R2 מבטל העלאה פתוחה אחרי שבוע.
export const RESUMABLE_STATE_TTL_MS = 6 * 24 * 60 * 60 * 1000;

export function shouldUseResumableUpload(size, threshold = RESUMABLE_THRESHOLD) {
    return Number(size) > threshold;
}

// תוכנית החלקים: מספר חלק (מ-1), ותחום הבייטים שלו. כל החלקים באותו גודל
// מלבד האחרון — כך R2 דורש.
export function planParts(size, partSize = RESUMABLE_PART_SIZE) {
    const total = Number(size);
    const step = Number(partSize);
    if (!Number.isFinite(total) || total <= 0) throw new Error('גודל הקובץ אינו תקין.');
    if (!Number.isFinite(step) || step <= 0) throw new Error('גודל החלק אינו תקין.');
    const parts = [];
    for (let start = 0, partNumber = 1; start < total; start += step, partNumber += 1) {
        parts.push({ partNumber, start, end: Math.min(total, start + step) });
    }
    return parts;
}

// החלקים שעוד צריך לשלוח, לפי מה שה-Worker כבר אישר.
export function pendingParts(plan, completedPartNumbers) {
    const done = new Set([...(completedPartNumbers || [])].map(Number));
    return plan.filter(part => !done.has(part.partNumber));
}

export function uploadedBytes(plan, completedPartNumbers) {
    const done = new Set([...(completedPartNumbers || [])].map(Number));
    return plan.reduce((sum, part) => sum + (done.has(part.partNumber) ? part.end - part.start : 0), 0);
}

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function readBlobBytes(blob) {
    if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
    return new Uint8Array(await new Response(blob).arrayBuffer());
}

// טביעת הקובץ: אותו קובץ שנבחר שוב (גם אחרי רענון) מקבל אותה טביעה, וקובץ
// אחר — כמעט תמיד טביעה אחרת. scope מפריד בין משתמשים באותו דפדפן.
export async function fingerprintFile(file, scope = '', cryptoImpl = globalThis.crypto) {
    const size = Number(file?.size) || 0;
    const head = file.slice(0, Math.min(size, FINGERPRINT_SAMPLE_BYTES));
    const tail = size > FINGERPRINT_SAMPLE_BYTES ? file.slice(Math.max(FINGERPRINT_SAMPLE_BYTES, size - FINGERPRINT_SAMPLE_BYTES), size) : null;
    const describe = new TextEncoder().encode([
        scope, file?.name || '', size, Number(file?.lastModified) || 0, file?.type || ''
    ].join('|'));
    const pieces = [describe, await readBlobBytes(head)];
    if (tail) pieces.push(await readBlobBytes(tail));
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) { joined.set(piece, offset); offset += piece.length; }
    if (!cryptoImpl?.subtle) {
        // בלי Web Crypto (הקשר לא מאובטח) — טביעה חלשה יותר, אבל יציבה.
        return `rf0:${describe.length}:${size}:${encodeURIComponent(file?.name || '')}:${Number(file?.lastModified) || 0}`;
    }
    return `rf1:${toHex(await cryptoImpl.subtle.digest('SHA-256', joined))}`;
}

// --- אחסון המצב בדפדפן ---

export function createMemoryStore() {
    const map = new Map();
    return {
        async get(key) { return map.has(key) ? structuredClone(map.get(key)) : null; },
        async set(key, value) { map.set(key, structuredClone(value)); },
        async delete(key) { map.delete(key); },
        async list() { return [...map.values()].map(value => structuredClone(value)); }
    };
}

// IndexedDB: שורד רענון וסגירת הלשונית. כל כשל (גלישה פרטית, אחסון חסום)
// נופל לאחסון בזיכרון — ההעלאה עדיין עובדת, רק בלי המשך אחרי רענון.
export function createIndexedDbStore(indexedDb = globalThis.indexedDB, name = STORE_DB_NAME) {
    const fallback = createMemoryStore();
    if (!indexedDb) return fallback;
    let opening = null;
    const open = () => {
        opening ||= new Promise((resolve, reject) => {
            let request;
            try {
                request = indexedDb.open(name, 1);
            } catch (error) {
                reject(error);
                return;
            }
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('IndexedDB blocked'));
        });
        return opening;
    };
    const run = async (mode, action) => {
        const db = await open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, mode);
            const request = action(transaction.objectStore(STORE_NAME));
            transaction.oncomplete = () => resolve(request?.result ?? null);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    };
    const guarded = (method, fallbackMethod) => async (...args) => {
        try {
            return await method(...args);
        } catch (error) {
            return fallbackMethod(...args);
        }
    };
    return {
        get: guarded(key => run('readonly', store => store.get(key)), key => fallback.get(key)),
        set: guarded((key, value) => run('readwrite', store => store.put(value, key)), (key, value) => fallback.set(key, value)),
        delete: guarded(key => run('readwrite', store => store.delete(key)), key => fallback.delete(key)),
        list: guarded(() => run('readonly', store => store.getAll()), () => fallback.list())
    };
}

let defaultStore = null;
export function resumableStore() {
    defaultStore ||= createIndexedDbStore();
    return defaultStore;
}

// העלאה שמורה ותקפה לטביעה הזו, או null.
export async function findSavedUpload(fingerprint, { store = resumableStore(), now = Date.now() } = {}) {
    if (!fingerprint) return null;
    const saved = await store.get(fingerprint);
    if (!saved) return null;
    if (!saved.uploadId || now - Number(saved.updatedAt || saved.createdAt || 0) > RESUMABLE_STATE_TTL_MS) {
        await store.delete(fingerprint);
        return null;
    }
    return saved;
}

// כל ההעלאות שלא הושלמו, כדי שחלון ההעלאה יזכיר אותן אחרי רענון.
export async function listSavedUploads({ store = resumableStore(), now = Date.now(), scope = '' } = {}) {
    const all = await store.list();
    return all
        .filter(item => item?.uploadId && now - Number(item.updatedAt || item.createdAt || 0) <= RESUMABLE_STATE_TTL_MS)
        .filter(item => !scope || item.scope === scope)
        .sort((first, second) => Number(second.updatedAt || 0) - Number(first.updatedAt || 0));
}

function abortError() {
    const error = new Error('ההעלאה בוטלה.');
    error.name = 'AbortError';
    error.code = 'upload_cancelled';
    return error;
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

// --- מכונת המצבים ---
//
// api: { create(meta), status(uploadId), uploadPart(uploadId, partNumber, blob, { signal, onProgress }),
//        complete(uploadId, extras), abort(uploadId) }
// השלבים: (1) מצב שמור? שואלים את ה-Worker מה התקבל. אם ההעלאה אינה קיימת
// עוד שם (404) — מתחילים מחדש. (2) אין מצב — create, ושומרים. (3) שולחים את
// החלקים החסרים לפי הסדר; כל חלק שאושר נרשם גם בדפדפן. (4) complete, ומוחקים
// את המצב השמור. שגיאה בחלק עוצרת את הריצה ומשאירה את המצב — הניסיון הבא
// (של התור, או אחרי רענון) ממשיך מאותה נקודה.
export async function uploadResumable({
    blob,
    fingerprint,
    meta = {},
    api,
    store = resumableStore(),
    signal = null,
    onProgress = () => {},
    completeExtras = null,
    now = () => Date.now()
}) {
    if (!blob || !(Number(blob.size) > 0)) throw new Error('קובץ המדיה אינו תקין.');
    if (!api) throw new Error('לא הוגדר ממשק העלאה.');
    const key = fingerprint || `id:${meta.imageId || ''}`;
    throwIfAborted(signal);

    let saved = await findSavedUpload(key, { store, now: now() });
    if (saved && (Number(saved.size) !== Number(blob.size) || (meta.imageId && saved.imageId && saved.imageId !== meta.imageId))) {
        // אותה טביעה אך קובץ או מזהה אחר: המצב הישן אינו שייך לכאן.
        await store.delete(key);
        saved = null;
    }

    let session = null;
    let completed = [];
    if (saved) {
        try {
            const status = await api.status(saved.uploadId, { signal });
            if (status?.status === 'completed') {
                // ההשלמה הקודמת הצליחה אך התשובה אבדה: מבקשים אותה שוב.
                const result = await api.complete(saved.uploadId, completeExtras ? await completeExtras() : null, { signal });
                await store.delete(key);
                onProgress(1, { uploaded: blob.size, total: blob.size, resumed: true });
                return { ...result, imageId: saved.imageId, resumed: true };
            }
            session = { uploadId: saved.uploadId, partSize: Number(status?.partSize) || Number(saved.partSize), imageId: saved.imageId, key: status?.key || saved.key };
            completed = (status?.parts || []).map(part => Number(part.partNumber));
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            if (Number(error?.status) === 404 || Number(error?.status) === 403) {
                await store.delete(key);
                saved = null;
            } else {
                throw error;
            }
        }
    }

    if (!session) {
        const created = await api.create({ ...meta, size: blob.size, mimeType: meta.mimeType || blob.type }, { signal });
        if (!created?.uploadId) throw new Error('שרת האחסון לא פתח העלאה בחלקים.');
        session = { uploadId: created.uploadId, partSize: Number(created.partSize) || RESUMABLE_PART_SIZE, imageId: created.imageId || meta.imageId, key: created.key };
        await store.set(key, {
            fingerprint: key,
            scope: meta.scope || '',
            uploadId: session.uploadId,
            key: session.key,
            imageId: session.imageId,
            partSize: session.partSize,
            size: blob.size,
            name: meta.fileName || meta.title || '',
            mimeType: meta.mimeType || blob.type || '',
            completedParts: [],
            createdAt: now(),
            updatedAt: now()
        });
    }

    const plan = planParts(blob.size, session.partSize);
    const resumed = completed.length > 0;
    let doneBytes = uploadedBytes(plan, completed);
    onProgress(doneBytes / blob.size, { uploaded: doneBytes, total: blob.size, resumed });

    for (const part of pendingParts(plan, completed)) {
        throwIfAborted(signal);
        const partBytes = part.end - part.start;
        await api.uploadPart(session.uploadId, part.partNumber, blob.slice(part.start, part.end), {
            signal,
            onProgress: fraction => {
                const current = doneBytes + Math.max(0, Math.min(1, Number(fraction) || 0)) * partBytes;
                onProgress(current / blob.size, { uploaded: current, total: blob.size, resumed });
            }
        });
        completed.push(part.partNumber);
        doneBytes += partBytes;
        const current = await store.get(key);
        if (current) await store.set(key, { ...current, completedParts: [...completed], updatedAt: now() });
        onProgress(doneBytes / blob.size, { uploaded: doneBytes, total: blob.size, resumed });
    }

    throwIfAborted(signal);
    const result = await api.complete(session.uploadId, completeExtras ? await completeExtras() : null, { signal });
    await store.delete(key);
    return { ...result, imageId: session.imageId, resumed };
}

// ביטול מפורש של העלאה (כפתור "בטל"): החלקים ב-R2 נמחקים והמצב השמור נשכח.
export async function abortResumableUpload(fingerprint, { api, store = resumableStore() } = {}) {
    const saved = fingerprint ? await store.get(fingerprint) : null;
    if (!saved) return false;
    await store.delete(fingerprint);
    try {
        await api?.abort(saved.uploadId);
    } catch (error) {
        // ה-Worker ינקה העלאה נטושה בעצמו; הביטול בדפדפן כבר הושלם.
    }
    return true;
}
