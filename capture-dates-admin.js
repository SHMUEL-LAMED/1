// capture-dates-admin.js — ריצת ההשלמה של תאריכי הצילום (לוח הניהול).
//
// מדיה שהועלתה לפני שנשמר takenAt מקבלת אותו כאן. לכל פריט שעוד לא נבדק:
//   1. קובץ שסונכרן מ-Drive, כשהחיבור ל-Drive פעיל — imageMediaMetadata.time.
//   2. אחרת קובץ שמאוחסן ב-R2 של הגלריה — הדפדפן קורא ממנו רק את הבתים
//      הנחוצים (EXIF / mvhd) דרך GET /media/probe/<id>, עד 256KB בכל קריאה.
// התוצאה נשלחת בקבוצות ל-POST /media/taken-at. גם "לא נמצא תאריך" נרשם
// (takenAtSource: 'none'), ולכן ההמשך אחרי עצירה או רענון מדלג על מה
// שכבר נבדק. פריט שאינו ב-R2 ואינו מ-Drive (קישור חיצוני ישן) נספר בנפרד.
//
// תמונה שהועלתה מהאתר לפני התכונה נדחסה ב-Canvas, וה-EXIF שלה לא נשמר
// ב-R2; עבורה תיכתב 'none' והיא תמשיך להיות ממוינת לפי זמן ההעלאה.

import { runVariantBackfill } from './media-variants.js';
import { readCaptureDate, captureFields, needsCaptureDate, CAPTURE_HEAD_BYTES } from './capture-date.js';

const CAPTURE_JOB_CONCURRENCY = 4;
const CAPTURE_BATCH_SIZE = 20;
const CAPTURE_SAVE_RETRY_DELAYS_MS = [3000, 10000];
const CAPTURE_FAILURE_LIST_LIMIT = 30;

const captureRun = {
    running: false,
    stopRequested: false,
    processed: 0,
    failed: 0,
    total: 0,
    found: 0,
    message: '',
    failures: []
};
let captureSummaryCache = null;
let captureSummaryError = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isR2Stored(record) {
    return /^(approved|pending)\//.test(String(record?.r2Key || ''));
}

function canUseDrive(record) {
    return Boolean(record?.driveFileId) && Boolean(window.driveConnectionActive) && typeof window.getDriveCaptureDate === 'function';
}

// אילו פריטים צריכים בדיקה, ואילו מהם אי אפשר לבדוק כלל.
export function selectCaptureCandidates(records, { driveAvailable = false } = {}) {
    const seen = new Set();
    const candidates = [];
    let unsupported = 0;
    let total = 0;
    let withDate = 0;
    for (const record of records || []) {
        const imageId = String(record?.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!imageId || seen.has(imageId)) continue;
        seen.add(imageId);
        total += 1;
        if (!needsCaptureDate(record)) {
            if (Number.isFinite(Number(record.takenAt)) && record.takenAtSource !== 'none') withDate += 1;
            continue;
        }
        const viaDrive = driveAvailable && Boolean(record.driveFileId);
        if (!isR2Stored(record) && !viaDrive) { unsupported += 1; continue; }
        candidates.push({ imageId, title: record.title || '', record });
    }
    return { total, withDate, candidates, unsupported };
}

async function waitForDataLayer() {
    for (let waited = 0; waited <= 6000; waited += 200) {
        const { collection, getDocs } = window.firestoreModules || {};
        if (window.db && typeof collection === 'function' && typeof getDocs === 'function') return { collection, getDocs };
        await delay(200);
    }
    throw new Error('החיבור לענן עדיין לא מוכן. נסה שוב בעוד רגע.');
}

// הרשומות נקראות מחדש מה-API, כדי שהמונה ישקף את מה ששמור בענן.
async function fetchMediaRecords() {
    const { collection, getDocs } = await waitForDataLayer();
    const records = [];
    for (const name of ['images', 'pendingImages']) {
        const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', name));
        snapshot.forEach(item => records.push(item.data()));
    }
    return records;
}

function renderCaptureDatesPanel() {
    const summaryEl = document.getElementById('captureDatesSummary');
    const statusEl = document.getElementById('captureDatesStatusText');
    const barEl = document.getElementById('captureDatesProgressBar');
    const startBtn = document.getElementById('captureDatesStartBtn');
    const stopBtn = document.getElementById('captureDatesStopBtn');
    const failuresEl = document.getElementById('captureDatesFailures');
    const summary = captureSummaryCache;
    if (summaryEl) {
        summaryEl.textContent = summary
            ? `${summary.withDate} מתוך ${summary.total} פריטים עם תאריך צילום · ${summary.candidates.length} טרם נבדקו`
                + (summary.unsupported ? ` · ${summary.unsupported} אינם מאוחסנים בגלריה ואינם ניתנים לבדיקה` : '')
            : (captureSummaryError ? 'לא ניתן לקרוא את רשימת המדיה כרגע. נסה שוב בעוד רגע.' : 'בודק אילו פריטים עדיין לא נבדקו…');
    }
    if (statusEl) statusEl.textContent = captureRun.message || 'הריצה עדיין לא הופעלה. אפשר להפעיל אותה בכל עת ולעצור באמצע.';
    if (barEl) {
        const total = captureRun.total || 0;
        barEl.style.width = total > 0 ? `${Math.round((captureRun.processed / total) * 100)}%` : '0%';
    }
    if (startBtn) {
        startBtn.disabled = captureRun.running;
        startBtn.textContent = captureRun.running ? 'הריצה פועלת…' : 'התחל או המשך';
    }
    if (stopBtn) stopBtn.disabled = !captureRun.running;
    if (failuresEl) {
        failuresEl.replaceChildren();
        captureRun.failures.slice(0, CAPTURE_FAILURE_LIST_LIMIT).forEach(failure => {
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
window.renderCaptureDatesPanel = renderCaptureDatesPanel;

async function refreshCaptureDatesSummary() {
    try {
        captureSummaryCache = selectCaptureCandidates(await fetchMediaRecords(), { driveAvailable: Boolean(window.driveConnectionActive) });
        captureSummaryError = null;
    } catch (error) {
        captureSummaryError = error;
        console.warn('קריאת מצב תאריכי הצילום נכשלה:', error);
    }
    renderCaptureDatesPanel();
    return captureSummaryCache;
}
window.refreshCaptureDatesSummary = refreshCaptureDatesSummary;

// קריאת טווח בתים מה-Worker. הקריאה הראשונה מגלה גם את גודל הקובץ.
async function probeSource(imageId) {
    const token = await window.getFirebaseIdToken();
    const read = async (offset, length) => {
        const response = await fetch(`${window.R2_WORKER_BASE_URL}/media/probe/${encodeURIComponent(imageId)}?offset=${offset}&length=${length}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
            let payload = null;
            try { payload = await response.json(); } catch (error) {}
            const failure = new Error(payload?.message || `קריאת הקובץ נכשלה (${response.status}).`);
            failure.status = response.status;
            failure.code = payload?.code || 'probe_failed';
            throw failure;
        }
        source.size = Number(response.headers.get('X-Media-Size')) || source.size;
        return new Uint8Array(await response.arrayBuffer());
    };
    const source = { size: 0, read };
    const head = await read(0, CAPTURE_HEAD_BYTES);
    return {
        size: source.size || head.length,
        read: (offset, length) => (offset + length <= head.length ? Promise.resolve(head.subarray(offset, offset + length)) : read(offset, length))
    };
}

async function readCandidateCapture(candidate) {
    const record = candidate.record;
    if (canUseDrive(record)) {
        try {
            const fromDrive = await window.getDriveCaptureDate(record.driveFileId);
            if (fromDrive) return fromDrive;
        } catch (error) {
            console.warn('קריאת התאריך מ-Drive נכשלה; עובר לקובץ שב-R2:', error);
        }
    }
    if (!isR2Stored(record)) return null;
    return readCaptureDate(await probeSource(candidate.imageId));
}

async function postTakenAt(updates) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await window.r2Request('/media/taken-at', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates })
            });
        } catch (error) {
            const retryable = error?.status === 429 || error?.status >= 500;
            if (!retryable || attempt >= CAPTURE_SAVE_RETRY_DELAYS_MS.length) throw error;
            await delay(CAPTURE_SAVE_RETRY_DELAYS_MS[attempt]);
        }
    }
}

function applyCaptureLocally(update) {
    for (const list of [window.state?.images, window.state?.pendingImages]) {
        for (const record of list || []) {
            if (window.safeRecordId(record?.id) !== update.imageId) continue;
            const { imageId, ...fields } = update;
            Object.assign(record, fields);
        }
    }
}

let pendingUpdates = [];
async function flushUpdates() {
    if (!pendingUpdates.length) return;
    const batch = pendingUpdates;
    pendingUpdates = [];
    const response = await postTakenAt(batch);
    for (const result of response?.results || []) {
        if (result.status === 'updated') applyCaptureLocally(batch.find(update => update.imageId === result.imageId) || { imageId: result.imageId });
    }
}

async function processCaptureCandidate(candidate) {
    const capture = await readCandidateCapture(candidate);
    const fields = captureFields(capture);
    if (fields.takenAt) captureRun.found += 1;
    pendingUpdates.push({ imageId: candidate.imageId, ...fields });
    if (pendingUpdates.length >= CAPTURE_BATCH_SIZE) await flushUpdates();
}

async function startCaptureDatesJob() {
    if (window.CLOUD_BACKGROUND_JOBS) return window.setCloudBackgroundJob("dates", true);
    if (!window.checkAdminPermission()) return;
    if (captureRun.running) {
        window.showNotification('הריצה כבר פועלת.', false);
        return;
    }
    Object.assign(captureRun, { running: true, stopRequested: false, processed: 0, failed: 0, total: 0, found: 0, failures: [], message: 'בודק אילו פריטים עדיין לא נבדקו…' });
    pendingUpdates = [];
    renderCaptureDatesPanel();
    try {
        const summary = await refreshCaptureDatesSummary();
        if (!summary) throw captureSummaryError || new Error('לא ניתן לקרוא את רשימת המדיה.');
        const candidates = summary.candidates;
        captureRun.total = candidates.length;
        if (!candidates.length) {
            captureRun.message = 'כל הפריטים שניתן לבדוק כבר נבדקו.';
            window.showNotification('אין פריטים שממתינים לבדיקת תאריך צילום.', true);
            return;
        }
        window.showNotification(`בודק תאריך צילום ל-${candidates.length} פריטים. אפשר לעצור ולהמשיך בכל שלב.`, true);
        const result = await runVariantBackfill(candidates, processCaptureCandidate, {
            concurrency: CAPTURE_JOB_CONCURRENCY,
            shouldStop: () => captureRun.stopRequested,
            onProgress: progress => {
                captureRun.processed = progress.processed;
                captureRun.failed = progress.failed;
                captureRun.failures = progress.failures.slice();
                captureRun.message = `נבדקו ${progress.processed} מתוך ${progress.total} · נמצא תאריך ל-${captureRun.found} · נכשלו ${progress.failed}`;
                renderCaptureDatesPanel();
            }
        });
        await flushUpdates();
        captureRun.message = result.stopped
            ? `הריצה נעצרה. נבדקו ${result.processed}, נותרו ${result.remaining}. אפשר להמשיך מהמקום הזה בכל עת.`
            : `הריצה הושלמה: נמצא תאריך צילום ל-${captureRun.found} פריטים, ${result.failed} נכשלו.`;
        window.showNotification(captureRun.message, !result.failed);
        if (!result.stopped) {
            await window.logActivity?.('capture_dates_completed', 'system', 'captureDates', 'תאריכי צילום', `${captureRun.found} פריטים`);
        }
    } catch (error) {
        console.error('ריצת תאריכי הצילום נכשלה:', error);
        captureRun.message = error?.status === 404 && error?.code !== 'not_found'
            ? 'נקודת הקצה של תאריכי הצילום אינה זמינה בשרת. יש לפרוס את גרסת ה-Worker העדכנית ולנסות שוב.'
            : `הריצה נעצרה בגלל שגיאה: ${error?.message || 'שגיאה לא ידועה'}. אפשר להמשיך מהמקום שנעצר.`;
        window.showNotification(captureRun.message, false);
    } finally {
        captureRun.running = false;
        captureRun.stopRequested = false;
        pendingUpdates = [];
        await refreshCaptureDatesSummary();
        window.renderImages?.();
    }
}
window.startCaptureDatesJob = startCaptureDatesJob;

function stopCaptureDatesJob() {
    if (window.CLOUD_BACKGROUND_JOBS) return window.setCloudBackgroundJob("dates", false);
    if (!captureRun.running) return;
    captureRun.stopRequested = true;
    captureRun.message = 'עוצר אחרי הפריטים שבבדיקה…';
    renderCaptureDatesPanel();
}
window.stopCaptureDatesJob = stopCaptureDatesJob;
