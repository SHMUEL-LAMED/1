// face-index.js — הכנת חיפוש הפנים בענן.
//
// כאן נמצא האינדוקס החד־פעמי של התמונות הקיימות: כל תמונה מורדת פעם אחת
// בלבד, נסרקת בדפדפן של המנהל, והטביעות המספריות נשמרות ב-D1 דרך ה-Worker.
// אחרי שהאינדוקס הושלם, החיפוש הרגיל (face-search.js) כבר אינו מוריד את
// תמונות הגלריה — הוא שולח רק את הטביעה של תמונת החיפוש.
//
// הקובץ מטפל גם בתמונות חדשות: אחרי העלאה או אישור, התמונה נכנסת לתור
// אינדוקס קטן ברקע. כישלון בזיהוי הפנים אינו מעכב ואינו מפיל את ההעלאה.

// קבוצות קטנות: הדפדפן נשאר מגיב, וכישלון ברשת מבזבז מעט עבודה.
const FACE_INDEX_IMAGE_BATCH = 4;
const FACE_INDEX_SAVE_CHUNK = 8;
const FACE_INDEX_PENDING_CHUNK = 200;
// חייב להיות זהה ל-FACE_INDEX_MAX_FACES_PER_IMAGE שב-Worker.
const FACE_INDEX_MAX_FACES = 20;
const FACE_INDEX_PROGRESS_KEY = 'simchas_face_index_progress';
const FACE_INDEX_AUTO_DELAY_MS = 2500;
// עומס זמני על ה-Worker מקבל שני ניסיונות חוזרים בהמתנה עולה.
const FACE_INDEX_SAVE_RETRY_DELAYS_MS = [5000, 20000];

const faceIndexRun = {
    running: false,
    stopRequested: false,
    processed: 0,
    failed: 0,
    faces: 0,
    total: 0,
    remaining: 0,
    message: ''
};

let faceIndexSummaryCache = null;
const autoIndexQueue = [];
let autoIndexTimer = null;
let autoIndexDraining = false;

function faceIndexModelVersion() {
    return String(window.FACE_MODEL_VERSION || 'faceapi-1.7.15-ssd-l68-r1');
}

function faceIndexDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// המשתמש רשאי לכתוב טביעות רק אם הוא מנהל. משתמש רגיל שמעלה תמונה אינו
// נכשל בגלל זה — התמונה פשוט תיאסף באינדוקס הבא של המנהל.
function canWriteFaceIndex() {
    return Boolean(window.state?.isAdminLoggedIn);
}

function readFaceIndexCheckpoint() {
    try {
        const raw = localStorage.getItem(FACE_INDEX_PROGRESS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || parsed.modelVersion !== faceIndexModelVersion()) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeFaceIndexCheckpoint() {
    try {
        localStorage.setItem(FACE_INDEX_PROGRESS_KEY, JSON.stringify({
            modelVersion: faceIndexModelVersion(),
            processed: faceIndexRun.processed,
            failed: faceIndexRun.failed,
            faces: faceIndexRun.faces,
            remaining: faceIndexRun.remaining,
            updatedAt: Date.now()
        }));
    } catch {
        // אחסון מקומי חסום — ההמשך מתבסס ממילא על מצב האינדוקס בשרת.
    }
}

function renderFaceIndexPanel() {
    const summaryEl = document.getElementById('faceIndexSummary');
    const statusEl = document.getElementById('faceIndexStatusText');
    const barEl = document.getElementById('faceIndexProgressBar');
    const startBtn = document.getElementById('faceIndexStartBtn');
    const stopBtn = document.getElementById('faceIndexStopBtn');

    const summary = faceIndexSummaryCache;
    if (summaryEl) {
        summaryEl.textContent = summary
            ? `${summary.indexedImages} מתוך ${summary.totalImages} תמונות מוכנות לחיפוש · ${summary.remainingImages} ממתינות · ${summary.failedImages} נכשלו · ${summary.faceCount} פרצופים שמורים`
            : 'טוען את מצב האינדוקס…';
    }

    if (statusEl) {
        const checkpoint = !faceIndexRun.running ? readFaceIndexCheckpoint() : null;
        if (faceIndexRun.message) {
            statusEl.textContent = faceIndexRun.message;
        } else if (checkpoint?.updatedAt) {
            statusEl.textContent = `הריצה האחרונה: ${checkpoint.processed} הושלמו, ${checkpoint.failed} נכשלו (${new Date(checkpoint.updatedAt).toLocaleString('he-IL')}).`;
        } else {
            statusEl.textContent = 'האינדוקס עדיין לא הופעל בדפדפן הזה.';
        }
    }

    if (barEl) {
        const total = summary?.totalImages || faceIndexRun.total || 0;
        const done = summary ? Math.min(total, summary.indexedImages) : faceIndexRun.processed;
        barEl.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
    }

    if (startBtn) {
        startBtn.disabled = faceIndexRun.running;
        startBtn.textContent = faceIndexRun.running ? 'האינדוקס פועל…' : 'התחל או המשך אינדוקס';
    }
    if (stopBtn) stopBtn.disabled = !faceIndexRun.running;
}
window.renderFaceIndexPanel = renderFaceIndexPanel;

async function refreshFaceIndexSummary() {
    try {
        const summary = await window.r2Request(
            `/face/index/summary?modelVersion=${encodeURIComponent(faceIndexModelVersion())}`
        );
        faceIndexSummaryCache = {
            totalImages: Math.max(0, Number(summary?.totalImages) || 0),
            indexedImages: Math.max(0, Number(summary?.indexedImages) || 0),
            remainingImages: Math.max(0, Number(summary?.remainingImages) || 0),
            failedImages: Math.max(0, Number(summary?.failedImages) || 0),
            faceCount: Math.max(0, Number(summary?.faceCount) || 0),
            ready: summary?.ready === true
        };
    } catch (error) {
        console.warn('קריאת מצב אינדוקס הפנים נכשלה:', error);
    }
    renderFaceIndexPanel();
    return faceIndexSummaryCache;
}
window.refreshFaceIndexSummary = refreshFaceIndexSummary;

// מועמדים לאינדוקס: תמונות בלבד (לא סרטונים) עם כתובת חוקית.
function collectFaceIndexCandidates() {
    const candidates = [];
    const seen = new Set();
    for (const record of window.state?.images || []) {
        if (window.isVideoRecord(record)) continue;
        const imageId = window.safeRecordId(record?.id);
        const url = window.safeImageUrl(record?.url);
        if (!imageId || !url || seen.has(imageId)) continue;
        seen.add(imageId);
        candidates.push({ imageId, url });
    }
    return candidates;
}

// השרת הוא מקור האמת לגבי מה כבר עובד. לכן אחרי רענון או סגירת דפדפן
// ההמשך מתחיל בדיוק מהמקום שנעצר, ותמונות שכבר אונדקסו נידלגות.
async function fetchPendingImageIds(candidates) {
    const pending = [];
    for (let offset = 0; offset < candidates.length; offset += FACE_INDEX_PENDING_CHUNK) {
        const chunk = candidates.slice(offset, offset + FACE_INDEX_PENDING_CHUNK);
        const response = await window.r2Request('/face/index/pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                modelVersion: faceIndexModelVersion(),
                imageIds: chunk.map(candidate => candidate.imageId)
            })
        });
        const pendingIds = new Set((response?.pending || []).map(id => window.safeRecordId(id)));
        chunk.forEach(candidate => {
            if (pendingIds.has(candidate.imageId)) pending.push(candidate);
        });
    }
    return pending;
}

// הפקת הטביעות של תמונה אחת. זו הפעם היחידה שבה התמונה יורדת לדפדפן.
async function describeImageFaces(faceapi, candidate) {
    const cached = window.descriptorCache?.[candidate.imageId];
    if (Array.isArray(cached)) return cached.slice(0, FACE_INDEX_MAX_FACES);

    const element = await window.loadFaceImageElement(candidate.url);
    const detections = await faceapi.detectAllFaces(element).withFaceLandmarks().withFaceDescriptors();
    const faces = (detections || [])
        .slice(0, FACE_INDEX_MAX_FACES)
        .map(detection => Array.from(detection.descriptor, value => Math.round(value * 1e6) / 1e6));
    if (window.descriptorCache) window.descriptorCache[candidate.imageId] = faces;
    // נותן לדפדפן לצייר ולטפל באירועים בין זיהויים כבדים.
    await faceIndexDelay(0);
    return faces;
}

async function saveFaceIndexEntries(entries) {
    if (!entries.length) return;
    const body = JSON.stringify({ modelVersion: faceIndexModelVersion(), images: entries });
    for (let attempt = 0; ; attempt += 1) {
        try {
            await window.r2Request('/face/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body
            });
            return;
        } catch (error) {
            // רק עומס זמני מקבל ניסיון חוזר; שאר השגיאות עוצרות את הריצה,
            // וההתקדמות שכבר נשמרה בשרת נשמרת להמשך.
            const retryable = error?.status === 429 || error?.code === 'face_index_rate_limit_exceeded';
            if (!retryable || attempt >= FACE_INDEX_SAVE_RETRY_DELAYS_MS.length) throw error;
            await faceIndexDelay(FACE_INDEX_SAVE_RETRY_DELAYS_MS[attempt]);
        }
    }
}

async function startFaceIndexing() {
    if (!window.checkAdminPermission()) return;
    if (faceIndexRun.running) {
        window.showNotification('האינדוקס כבר פועל.', false);
        return;
    }

    faceIndexRun.running = true;
    faceIndexRun.stopRequested = false;
    faceIndexRun.processed = 0;
    faceIndexRun.failed = 0;
    faceIndexRun.faces = 0;
    faceIndexRun.message = 'טוען את מנוע זיהוי הפנים…';
    renderFaceIndexPanel();

    let pending = [];
    try {
        const faceapi = await window.loadFaceApi();

        faceIndexRun.message = 'בודק אילו תמונות עדיין ממתינות…';
        renderFaceIndexPanel();
        const candidates = collectFaceIndexCandidates();
        pending = await fetchPendingImageIds(candidates);
        faceIndexRun.total = pending.length;
        faceIndexRun.remaining = pending.length;

        if (!pending.length) {
            faceIndexRun.message = 'כל התמונות כבר מוכנות לחיפוש פנים בענן.';
            window.showNotification('כל התמונות כבר מאונדקסות. חיפוש הפנים מוכן.', true);
            return;
        }

        window.showNotification(`מתחיל אינדוקס של ${pending.length} תמונות. אפשר לעצור ולהמשיך בכל שלב.`, true);

        const buffer = [];
        for (let offset = 0; offset < pending.length; offset += FACE_INDEX_IMAGE_BATCH) {
            const batch = pending.slice(offset, offset + FACE_INDEX_IMAGE_BATCH);

            for (const candidate of batch) {
                try {
                    const faces = await describeImageFaces(faceapi, candidate);
                    // גם תמונה בלי פנים נשמרת כמעובדת, כדי שלא תיסרק שוב.
                    buffer.push({ imageId: candidate.imageId, faces });
                    faceIndexRun.faces += faces.length;
                } catch (error) {
                    // כישלון בתמונה בודדת אינו עוצר את האינדוקס כולו.
                    faceIndexRun.failed += 1;
                    buffer.push({ imageId: candidate.imageId, status: 'failed', errorCode: 'image_scan_failed' });
                    console.warn('אינדוקס פנים דילג על תמונה:', candidate.imageId, error);
                }
                faceIndexRun.processed += 1;
                faceIndexRun.remaining = Math.max(0, pending.length - faceIndexRun.processed);
            }

            // שומרים את מה שנאסף לפני עצירה או סיום, כדי שהעבודה לא תאבד.
            const isLastBatch = offset + FACE_INDEX_IMAGE_BATCH >= pending.length;
            if (buffer.length >= FACE_INDEX_SAVE_CHUNK || isLastBatch || faceIndexRun.stopRequested) {
                while (buffer.length) {
                    await saveFaceIndexEntries(buffer.splice(0, FACE_INDEX_SAVE_CHUNK));
                }
            }

            faceIndexRun.message = `הושלמו ${faceIndexRun.processed} מתוך ${pending.length} · נותרו ${faceIndexRun.remaining} · נכשלו ${faceIndexRun.failed}`;
            writeFaceIndexCheckpoint();
            renderFaceIndexPanel();

            if (faceIndexRun.stopRequested) {
                faceIndexRun.message = `האינדוקס נעצר. הושלמו ${faceIndexRun.processed}, נותרו ${faceIndexRun.remaining}. אפשר להמשיך מהמקום הזה בכל עת.`;
                window.showNotification('האינדוקס נעצר. ההמשך יתחיל מהמקום שנעצר.', true);
                break;
            }
        }

        if (!faceIndexRun.stopRequested) {
            faceIndexRun.message = `האינדוקס הושלם: ${faceIndexRun.processed} תמונות, ${faceIndexRun.faces} פרצופים, ${faceIndexRun.failed} כשלונות.`;
            window.showNotification(
                faceIndexRun.failed
                    ? `האינדוקס הושלם. ${faceIndexRun.failed} תמונות לא נסרקו וניתן לנסות אותן שוב.`
                    : 'האינדוקס הושלם. חיפוש הפנים יעבוד עכשיו ישירות מהענן.',
                !faceIndexRun.failed
            );
            await window.logActivity?.('face_index_completed', 'system', 'faceIndex', 'אינדוקס פנים', `${faceIndexRun.processed} תמונות`);
        }
    } catch (error) {
        console.error('אינדוקס הפנים נכשל:', error);
        faceIndexRun.message = error?.status === 404
            ? 'האינדוקס בענן אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית ולנסות שוב.'
            : `האינדוקס נעצר בגלל שגיאה: ${error?.message || 'שגיאה לא ידועה'}. אפשר להמשיך מהמקום שנעצר.`;
        window.showNotification(faceIndexRun.message, false);
    } finally {
        faceIndexRun.running = false;
        faceIndexRun.stopRequested = false;
        writeFaceIndexCheckpoint();
        await refreshFaceIndexSummary();
        renderFaceIndexPanel();
    }
}
window.startFaceIndexing = startFaceIndexing;

function stopFaceIndexing() {
    if (!faceIndexRun.running) return;
    faceIndexRun.stopRequested = true;
    faceIndexRun.message = 'עוצר אחרי הקבוצה הנוכחית…';
    renderFaceIndexPanel();
}
window.stopFaceIndexing = stopFaceIndexing;

// אינדוקס מחדש: נדרש בעיקר אחרי החלפת גרסת מודל, כשצריך לנקות טביעות ישנות.
function resetFaceIndex(confirmed = false) {
    if (!window.checkSuperAdminPermission()) return;
    if (faceIndexRun.running) {
        window.showNotification('יש לעצור את האינדוקס לפני איפוס.', false);
        return;
    }
    if (!confirmed) {
        window.showConfirm(
            'איפוס אינדוקס הפנים',
            'למחוק את כל טביעות הפנים השמורות ולהתחיל אינדוקס מחדש? התמונות עצמן לא ייפגעו.',
            () => resetFaceIndex(true)
        );
        return;
    }
    window.r2Request('/face/index/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' })
    }).then(async () => {
        try { localStorage.removeItem(FACE_INDEX_PROGRESS_KEY); } catch { /* לא קריטי */ }
        if (window.descriptorCache) {
            for (const key of Object.keys(window.descriptorCache)) delete window.descriptorCache[key];
        }
        faceIndexRun.message = 'האינדוקס אופס. אפשר להתחיל סריקה חדשה.';
        window.showNotification('טביעות הפנים נמחקו. אפשר להתחיל אינדוקס מחדש.', true);
        await refreshFaceIndexSummary();
    }).catch(error => {
        window.showNotification(error?.message || 'איפוס האינדוקס נכשל.', false);
    });
}
window.resetFaceIndex = resetFaceIndex;

// --- תמונות חדשות ---
// נקראת אחרי שמירה מוצלחת של תמונה. הפונקציה לעולם אינה זורקת ואינה
// מחזירה Promise שההעלאה ממתינה לו.
function queueFaceIndexForImage(record) {
    try {
        if (!record || window.isVideoRecord(record)) return;
        const imageId = window.safeRecordId(record.id);
        const url = window.safeImageUrl(record.url);
        if (!imageId || !url) return;
        // רק מנהל רשאי לכתוב טביעות. תמונה של מעלה אחר תיאסף באינדוקס הבא,
        // שכן היא נשארת חסרה בטבלת מצב האינדוקס.
        if (!canWriteFaceIndex()) return;
        if (autoIndexQueue.some(item => item.imageId === imageId)) return;
        autoIndexQueue.push({ imageId, url });
        clearTimeout(autoIndexTimer);
        autoIndexTimer = setTimeout(() => {
            drainAutoIndexQueue().catch(error => console.warn('אינדוקס אוטומטי נכשל:', error));
        }, FACE_INDEX_AUTO_DELAY_MS);
    } catch (error) {
        console.warn('לא ניתן היה להוסיף את התמונה לתור אינדוקס הפנים:', error);
    }
}
window.queueFaceIndexForImage = queueFaceIndexForImage;

// נחשפת כדי שאפשר יהיה להריץ את התור מיד (למשל בבדיקות או אחרי אישור אצווה).
window.drainFaceIndexQueue = () => drainAutoIndexQueue();

async function drainAutoIndexQueue() {
    if (autoIndexDraining || faceIndexRun.running || !autoIndexQueue.length) return;
    if (!canWriteFaceIndex()) {
        autoIndexQueue.length = 0;
        return;
    }
    autoIndexDraining = true;
    try {
        const faceapi = await window.loadFaceApi();
        while (autoIndexQueue.length) {
            const candidates = autoIndexQueue.splice(0, FACE_INDEX_SAVE_CHUNK);
            const pending = await fetchPendingImageIds(candidates);
            const entries = [];
            for (const candidate of pending) {
                try {
                    entries.push({ imageId: candidate.imageId, faces: await describeImageFaces(faceapi, candidate) });
                } catch (error) {
                    entries.push({ imageId: candidate.imageId, status: 'failed', errorCode: 'image_scan_failed' });
                    console.warn('אינדוקס אוטומטי דילג על תמונה:', candidate.imageId, error);
                }
            }
            await saveFaceIndexEntries(entries);
        }
        faceIndexSummaryCache = null;
    } catch (error) {
        // תקלה כאן לעולם אינה משפיעה על ההעלאה עצמה; התמונה תיאסף באינדוקס הבא.
        console.warn('אינדוקס אוטומטי של תמונות חדשות נכשל:', error);
    } finally {
        autoIndexDraining = false;
    }
}
