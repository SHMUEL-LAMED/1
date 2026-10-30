// media-variants-admin.js — ריצת ההשלמה של תצוגות מקדימות (לוח הניהול).
//
// המדיה שהועלתה לפני שהתצוגות נוספו, וכל קובץ שההעלאה שלו לא הצליחה ליצור
// להן תצוגות, מקבלים אותן כאן: הרשומות נקראות מה-API, רק מי שחסרות לו
// תצוגות נכנס לתור, המקור יורד לדפדפן של המנהל, התצוגות נוצרות ב-Canvas
// ונשלחות ל-POST /media/variants. הריצה בקבוצות קטנות, במקביליות מוגבלת,
// ואפשר לעצור ולהמשיך: ההמשך מדלג מאליו על מה שכבר נשמר בענן.
//
// בנוי על אותו דגם כמו "הכן חיפוש פנים בענן" שב-face-index.js.
//
// באותו מסך: השלמת הרקע המטושטש (placeholder) לפריטים שכבר יש להם תצוגות.
// היא זולה בהרבה מריצת התצוגות — רק התצוגה הקטנה יורדת, ונשלח רק שדה טקסט
// קטן — ותמיד רצה בדפדפן של המנהל, גם כשריצת התצוגות עברה לענן.

import { selectVariantCandidates, runVariantBackfill, MEDIA_VARIANTS_VERSION, selectPlaceholderCandidates } from './media-variants.js';
import { generateMediaVariants, appendVariantParts, generatePlaceholderFromBlob } from './media-variants-generate.js';
import { API_BASE_URLS } from './api-environment.js';

// שלושה פריטים במקביל: פענוח תמונה גדולה או סרטון תופס זיכרון, ויותר מזה
// רק מקפיא את הדף בלי לקצר את הריצה.
const VARIANTS_JOB_MAX_CONCURRENCY = 3;
// עומס זמני על ה-Worker מקבל שני ניסיונות חוזרים בהמתנה עולה.
const VARIANTS_SAVE_RETRY_DELAYS_MS = [5000, 20000];
const VARIANTS_FAILURE_LIST_LIMIT = 30;

const variantsRun = {
    running: false,
    stopRequested: false,
    processed: 0,
    failed: 0,
    total: 0,
    remaining: 0,
    message: '',
    failures: []
};

// הרקע המטושטש: עד 300 פריטים בכל הפעלה. כל פריט הוא בקשה אחת ל-/media/variants
// ושתי כתיבות רשומה (images ו-pendingImages) ועדכון גרסת הנתונים — כ-4 כתיבות
// ל-D1 — ולכן ריצה אחת היא לכל היותר כ-1,200 כתיבות, הרחק מתחת לתקציב היומי.
export const PLACEHOLDER_BACKFILL_MAX_PER_RUN = 300;
export const PLACEHOLDER_D1_WRITES_PER_ITEM = 4;

const placeholdersRun = {
    running: false,
    stopRequested: false,
    processed: 0,
    failed: 0,
    total: 0,
    message: ''
};

let variantsSummaryCache = null;
let variantsSummaryError = null;
// נפח הקבצים שב-R2, מ-GET /media/variants/stats. null = לא ידוע (למשל Worker
// ישן שעדיין לא נפרס), ואז השורה פשוט אינה מוצגת.
let variantsStorageCache = null;

function variantsDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function variantsConcurrency() {
    const hardwareThreads = Math.max(2, Number(globalThis.navigator?.hardwareConcurrency) || 4);
    return Math.max(1, Math.min(VARIANTS_JOB_MAX_CONCURRENCY, hardwareThreads - 1));
}

// רק קובץ שמאוחסן ב-R2 של הגלריה — בייצור או בסביבת הניסוי — ניתן לעיבוד:
// קישור חיצוני (למשל Drive ישן) אינו מגיע עם CORS, והקנבס היה "נצבע".
const WORKER_MEDIA_PREFIXES = [window.R2_WORKER_BASE_URL, ...Object.values(API_BASE_URLS)]
    .filter(Boolean)
    .map(origin => `${origin}/media/`);
function isWorkerMediaUrl(url) {
    return typeof url === 'string' && WORKER_MEDIA_PREFIXES.some(prefix => url.startsWith(prefix));
}

// המסך עשוי להיפתח מהכתובת (#variants) רגע לפני ששכבת הנתונים מוכנה;
// ממתינים לה קצת במקום להציג שגיאה שנעלמת ברענון.
const DATA_LAYER_WAIT_MS = 6000;
const DATA_LAYER_POLL_MS = 200;
async function waitForDataLayer() {
    for (let waited = 0; waited <= DATA_LAYER_WAIT_MS; waited += DATA_LAYER_POLL_MS) {
        const { collection, getDocs } = window.firestoreModules || {};
        if (window.db && typeof collection === 'function' && typeof getDocs === 'function') return { collection, getDocs };
        await variantsDelay(DATA_LAYER_POLL_MS);
    }
    throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
}

// הרשומות נקראות מחדש מה-API ולא מהמצב המקומי של הדף, כדי שהמונה והריצה
// ישקפו את מה ששמור בענן גם אחרי ריצה בלשונית אחרת.
async function fetchMediaRecords() {
    const { collection, getDocs } = await waitForDataLayer();
    const records = [];
    for (const name of ['images', 'pendingImages']) {
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', name));
        snapshot.forEach(item => records.push(item.data()));
    }
    return records;
}

function summarizeRecords(records) {
    const { candidates, unsupported } = selectVariantCandidates(records, {
        sanitize: window.safeImageUrl,
        isSupported: candidate => isWorkerMediaUrl(candidate.url)
    });
    const total = new Set(records.map(record => window.safeRecordId(record?.id)).filter(Boolean)).size;
    const placeholderCandidates = selectPlaceholderCandidates(records);
    return { total, missing: candidates.length + unsupported.length, unsupported: unsupported.length, candidates, placeholderCandidates };
}

function renderMediaVariantsPanel() {
    const summaryEl = document.getElementById('variantsSummary');
    const statusEl = document.getElementById('variantsStatusText');
    const barEl = document.getElementById('variantsProgressBar');
    const startBtn = document.getElementById('variantsStartBtn');
    const stopBtn = document.getElementById('variantsStopBtn');
    const failuresEl = document.getElementById('variantsFailures');
    const storageEl = document.getElementById('variantsStorage');

    const summary = variantsSummaryCache;
    if (summaryEl) {
        if (summary) {
            const ready = Math.max(0, summary.total - summary.missing);
            summaryEl.textContent = `${ready} מתוך ${summary.total} פריטים עם תצוגות מקדימות · ${summary.missing} חסרים`
                + (summary.unsupported ? ` · ${summary.unsupported} מהם אינם מאוחסנים בגלריה ואינם ניתנים לעיבוד` : '');
        } else {
            summaryEl.textContent = variantsSummaryError
                ? 'לא ניתן לקרוא את רשימת המדיה כרגע. נסה שוב בעוד רגע.'
                : 'בודק אילו פריטים חסרים תצוגות מקדימות…';
        }
    }

    if (storageEl) {
        const text = describeVariantsStorage(variantsStorageCache);
        storageEl.hidden = !text;
        storageEl.textContent = text;
    }

    if (statusEl) {
        statusEl.textContent = variantsRun.message || 'הריצה עדיין לא הופעלה. אפשר להפעיל אותה בכל עת ולעצור באמצע.';
    }

    if (barEl) {
        const total = variantsRun.running || variantsRun.total ? variantsRun.total : (summary?.total || 0);
        const done = variantsRun.running || variantsRun.total
            ? variantsRun.processed
            : Math.max(0, (summary?.total || 0) - (summary?.missing || 0));
        barEl.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
    }

    if (startBtn) {
        startBtn.disabled = variantsRun.running;
        startBtn.textContent = variantsRun.running ? 'הריצה פועלת…' : 'התחל או המשך';
    }
    if (stopBtn) stopBtn.disabled = !variantsRun.running;

    renderPlaceholdersPanel(summary);

    if (failuresEl) {
        failuresEl.replaceChildren();
        variantsRun.failures.slice(0, VARIANTS_FAILURE_LIST_LIMIT).forEach(failure => {
            const row = document.createElement('div');
            row.className = 'admin-row';
            const title = document.createElement('p');
            title.className = 'admin-row-title truncate';
            title.textContent = failure.title || failure.imageId;
            const meta = document.createElement('p');
            meta.className = 'admin-row-meta truncate';
            meta.textContent = failure.message;
            row.append(title, meta);
            failuresEl.appendChild(row);
        });
    }
}
window.renderMediaVariantsPanel = renderMediaVariantsPanel;

function renderPlaceholdersPanel(summary) {
    const summaryEl = document.getElementById('placeholdersSummary');
    const statusEl = document.getElementById('placeholdersStatusText');
    const startBtn = document.getElementById('placeholdersStartBtn');
    const stopBtn = document.getElementById('placeholdersStopBtn');
    if (summaryEl) {
        const missing = summary?.placeholderCandidates?.length;
        summaryEl.textContent = Number.isFinite(missing)
            ? (missing
                ? `${missing} פריטים עם תצוגות עדיין בלי רקע מטושטש. כל הפעלה משלימה עד ${PLACEHOLDER_BACKFILL_MAX_PER_RUN} (כ-${Math.min(missing, PLACEHOLDER_BACKFILL_MAX_PER_RUN) * PLACEHOLDER_D1_WRITES_PER_ITEM} כתיבות למסד).`
                : 'לכל הפריטים שיש להם תצוגות כבר יש רקע מטושטש.')
            : 'בודק אילו פריטים חסר להם רקע מטושטש…';
    }
    if (statusEl) statusEl.textContent = placeholdersRun.message || 'ההשלמה עדיין לא הופעלה.';
    if (startBtn) {
        startBtn.disabled = placeholdersRun.running || variantsRun.running;
        startBtn.textContent = placeholdersRun.running ? 'משלים…' : 'השלם רקע מטושטש';
    }
    if (stopBtn) stopBtn.disabled = !placeholdersRun.running;
}

// "נשמרו 12 קבצים (3.4 MB) · WebP: 8 · AVIF: 4" — או מחרוזת ריקה כשאין נתונים.
export function describeVariantsStorage(stats) {
    if (!stats || !Number(stats.files)) return '';
    const formatSize = typeof window.formatBytes === 'function' ? window.formatBytes : bytes => `${bytes} B`;
    const labels = { webp: 'WebP', jpg: 'JPEG', avif: 'AVIF' };
    const formats = Object.entries(stats.byFormat || {})
        .filter(([, entry]) => Number(entry?.files) > 0)
        .map(([format, entry]) => `${labels[format] || format}: ${Number(entry.files)}`);
    return [`נשמרו ${Number(stats.files)} קובצי תצוגה (${formatSize(Number(stats.bytes) || 0)}) ל-${Number(stats.images) || 0} פריטים`, ...formats].join(' · ');
}

async function refreshVariantsStorage() {
    try {
        variantsStorageCache = await window.r2Request('/media/variants/stats', { method: 'GET' });
    } catch (error) {
        variantsStorageCache = null;
        console.warn('קריאת נפח התצוגות המקדימות נכשלה:', error);
    }
}

async function refreshMediaVariantsSummary() {
    try {
        variantsSummaryCache = summarizeRecords(await fetchMediaRecords());
        variantsSummaryError = null;
    } catch (error) {
        variantsSummaryError = error;
        console.warn('קריאת מצב התצוגות המקדימות נכשלה:', error);
    }
    await refreshVariantsStorage();
    renderMediaVariantsPanel();
    return variantsSummaryCache;
}
window.refreshMediaVariantsSummary = refreshMediaVariantsSummary;

// מוריד מקור לעיבוד. קובץ ממתין דורש אסימון; קובץ מאושר הוא ציבורי, והבקשה
// נשארת "פשוטה" (בלי preflight) כדי שתוכל להישמר במטמון הדפדפן.
async function fetchMediaBlob(url, { authenticate = false } = {}) {
    const headers = new Headers();
    if (authenticate || url.includes('/media/pending/')) {
        const token = await window.getFirebaseIdToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(url, { headers, mode: 'cors' });
    if (!response.ok) throw new Error(`הורדת המקור נכשלה (${response.status}).`);
    return response.blob();
}

async function postMediaVariants(form) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await window.r2Request('/media/variants', { method: 'POST', body: form });
        } catch (error) {
            const retryable = error?.status === 429 || error?.code === 'variants_rate_limit_exceeded';
            if (!retryable || attempt >= VARIANTS_SAVE_RETRY_DELAYS_MS.length) throw error;
            await variantsDelay(VARIANTS_SAVE_RETRY_DELAYS_MS[attempt]);
        }
    }
}

// הרשומה המקומית מתעדכנת מיד, כדי שמסכים שמציגים את הפריט לא יחכו לסבב
// הקריאה הבא מהענן.
function applyVariantsLocally(imageId, variants, version) {
    if (!variants || typeof variants !== 'object') return;
    for (const list of [window.state?.images, window.state?.pendingImages]) {
        for (const record of list || []) {
            if (window.safeRecordId(record?.id) !== imageId) continue;
            record.variants = variants;
            record.variantsVersion = version;
        }
    }
}

async function processVariantCandidate(candidate) {
    // סרטון מאושר נטען ישירות מהכתובת: הדפדפן מושך רק את הטווח שנחוץ
    // לפריים, במקום להוריד קובץ של עשרות מגה-בייט. סרטון ממתין דורש אסימון
    // שאי אפשר לצרף ל-<video>, ולכן הוא יורד כקובץ.
    const streamable = candidate.isVideo && !candidate.url.includes('/media/pending/');
    const source = streamable ? candidate.url : await fetchMediaBlob(candidate.url);
    const generated = await generateMediaVariants(source, { isVideo: candidate.isVideo });
    const form = new FormData();
    form.append('imageId', candidate.imageId);
    if (!appendVariantParts(form, generated)) throw new Error('לא נוצרה אף תצוגה מקדימה.');
    const response = await postMediaVariants(form);
    applyVariantsLocally(candidate.imageId, response?.variants, Number(response?.variantsVersion) || MEDIA_VARIANTS_VERSION);
}

async function startMediaVariantsJob() {
    if (window.CLOUD_BACKGROUND_JOBS) return window.setCloudBackgroundJob("variants", true);
    if (!window.checkAdminPermission()) return;
    if (variantsRun.running) {
        window.showNotification('הריצה כבר פועלת.', false);
        return;
    }

    variantsRun.running = true;
    variantsRun.stopRequested = false;
    variantsRun.processed = 0;
    variantsRun.failed = 0;
    variantsRun.total = 0;
    variantsRun.remaining = 0;
    variantsRun.failures = [];
    variantsRun.message = 'בודק אילו פריטים עדיין חסרים תצוגות מקדימות…';
    renderMediaVariantsPanel();

    try {
        const summary = await refreshMediaVariantsSummary();
        if (!summary) throw variantsSummaryError || new Error('לא ניתן לקרוא את רשימת המדיה.');
        const candidates = summary.candidates;
        variantsRun.total = candidates.length;
        variantsRun.remaining = candidates.length;

        if (!candidates.length) {
            variantsRun.message = 'לכל פריטי המדיה שניתן לעבד כבר יש תצוגות מקדימות.';
            window.showNotification('אין פריטים שחסרות להם תצוגות מקדימות.', true);
            return;
        }

        const concurrency = variantsConcurrency();
        window.showNotification(`מתחיל יצירת תצוגות ל-${candidates.length} פריטים (${concurrency} במקביל). אפשר לעצור ולהמשיך בכל שלב.`, true);

        const result = await runVariantBackfill(candidates, processVariantCandidate, {
            concurrency,
            shouldStop: () => variantsRun.stopRequested,
            onProgress: progress => {
                variantsRun.processed = progress.processed;
                variantsRun.failed = progress.failed;
                variantsRun.remaining = progress.remaining;
                variantsRun.failures = progress.failures.slice();
                variantsRun.message = `הושלמו ${progress.processed} מתוך ${progress.total} · ${concurrency} במקביל · נותרו ${progress.remaining} · נכשלו ${progress.failed}`;
                renderMediaVariantsPanel();
            }
        });

        if (result.stopped) {
            variantsRun.message = `הריצה נעצרה. הושלמו ${result.processed}, נותרו ${result.remaining}. אפשר להמשיך מהמקום הזה בכל עת.`;
            window.showNotification('הריצה נעצרה. ההמשך ידלג על מה שכבר נשמר.', true);
        } else {
            variantsRun.message = `הריצה הושלמה: ${result.succeeded} פריטים קיבלו תצוגות, ${result.failed} נכשלו.`;
            window.showNotification(
                result.failed
                    ? `הריצה הושלמה. ${result.failed} פריטים נכשלו ואפשר לנסות אותם שוב.`
                    : 'הריצה הושלמה. הגלריה תיטען מעכשיו מהתצוגות המוקטנות.',
                !result.failed
            );
            await window.logActivity?.('media_variants_completed', 'system', 'mediaVariants', 'תצוגות מקדימות', `${result.succeeded} פריטים`);
        }
    } catch (error) {
        console.error('ריצת התצוגות המקדימות נכשלה:', error);
        variantsRun.message = error?.status === 404
            ? 'נקודת הקצה של התצוגות אינה זמינה בשרת. יש לפרוס את גרסת ה-Worker העדכנית ולנסות שוב.'
            : `הריצה נעצרה בגלל שגיאה: ${error?.message || 'שגיאה לא ידועה'}. אפשר להמשיך מהמקום שנעצר.`;
        window.showNotification(variantsRun.message, false);
    } finally {
        variantsRun.running = false;
        variantsRun.stopRequested = false;
        await refreshMediaVariantsSummary();
        renderMediaVariantsPanel();
    }
}
window.startMediaVariantsJob = startMediaVariantsJob;

function stopMediaVariantsJob() {
    if (window.CLOUD_BACKGROUND_JOBS) return window.setCloudBackgroundJob("variants", false);
    if (!variantsRun.running) return;
    variantsRun.stopRequested = true;
    variantsRun.message = 'עוצר אחרי הפריטים שבעיבוד…';
    renderMediaVariantsPanel();
}
window.stopMediaVariantsJob = stopMediaVariantsJob;

function applyPlaceholderLocally(imageId, placeholder) {
    if (!placeholder) return;
    for (const list of [window.state?.images, window.state?.pendingImages]) {
        for (const record of list || []) {
            if (window.safeRecordId(record?.id) === imageId) record.placeholder = placeholder;
        }
    }
}

// התצוגה הקטנה של פריט ממתין מוגשת רק עם הרשאה, ולכן היא יורדת תמיד עם
// האסימון (לפריט מאושר זה רק מוסיף בקשת preflight; זה מסך ניהול).
async function processPlaceholderCandidate(candidate) {
    const blob = await fetchMediaBlob(candidate.url, { authenticate: true });
    const placeholder = await generatePlaceholderFromBlob(blob);
    if (!placeholder) throw new Error('לא ניתן היה ליצור רקע קטן מספיק.');
    const form = new FormData();
    form.append('imageId', candidate.imageId);
    form.append('placeholder', placeholder);
    const response = await postMediaVariants(form);
    applyPlaceholderLocally(candidate.imageId, response?.placeholder || placeholder);
}

async function startPlaceholdersJob() {
    if (!window.checkAdminPermission()) return;
    if (placeholdersRun.running || variantsRun.running) {
        window.showNotification('ריצה אחרת כבר פועלת במסך הזה.', false);
        return;
    }
    Object.assign(placeholdersRun, { running: true, stopRequested: false, processed: 0, failed: 0, total: 0, message: 'בודק אילו פריטים חסר להם רקע מטושטש…' });
    renderMediaVariantsPanel();
    try {
        const records = await fetchMediaRecords();
        const candidates = selectPlaceholderCandidates(records, { limit: PLACEHOLDER_BACKFILL_MAX_PER_RUN });
        placeholdersRun.total = candidates.length;
        if (!candidates.length) {
            placeholdersRun.message = 'לכל הפריטים שיש להם תצוגות כבר יש רקע מטושטש.';
            return;
        }
        const result = await runVariantBackfill(candidates, processPlaceholderCandidate, {
            concurrency: variantsConcurrency(),
            shouldStop: () => placeholdersRun.stopRequested,
            onProgress: progress => {
                placeholdersRun.processed = progress.processed;
                placeholdersRun.failed = progress.failed;
                placeholdersRun.message = `הושלמו ${progress.processed} מתוך ${progress.total} · נכשלו ${progress.failed}`;
                renderMediaVariantsPanel();
            }
        });
        placeholdersRun.message = result.stopped
            ? `ההשלמה נעצרה אחרי ${result.processed} פריטים. אפשר להמשיך בכל עת.`
            : `ההשלמה הסתיימה: ${result.succeeded} פריטים קיבלו רקע מטושטש, ${result.failed} נכשלו.`;
        window.showNotification(placeholdersRun.message, !result.failed);
    } catch (error) {
        console.error('השלמת הרקע המטושטש נכשלה:', error);
        placeholdersRun.message = `ההשלמה נעצרה בגלל שגיאה: ${error?.message || 'שגיאה לא ידועה'}.`;
        window.showNotification(placeholdersRun.message, false);
    } finally {
        placeholdersRun.running = false;
        placeholdersRun.stopRequested = false;
        await refreshMediaVariantsSummary();
    }
}
window.startPlaceholdersJob = startPlaceholdersJob;

function stopPlaceholdersJob() {
    if (!placeholdersRun.running) return;
    placeholdersRun.stopRequested = true;
    placeholdersRun.message = 'עוצר אחרי הפריטים שבעיבוד…';
    renderMediaVariantsPanel();
}
window.stopPlaceholdersJob = stopPlaceholdersJob;
