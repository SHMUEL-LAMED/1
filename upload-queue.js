// upload-queue.js — תור ההעלאה: הרבה קבצים בבת אחת, התקדמות לכל קובץ,
// ביטול לכל קובץ, ניסיון חוזר אוטומטי עם השהיה גדלה, וסיכום כולל.
//
// התור אינו יודע דבר על DOM או על הרשת: run(payload, { signal, onProgress,
// attempt }) מבצע את ההעלאה בפועל, ו-onChange מודיע לממשק על כל שינוי.
// כך כל הלוגיקה — מקביליות, ביטול, השהיה וניסיונות חוזרים — נבדקת ב-Node
// (upload-queue.test.mjs) עם שעון מדומה.

export const UPLOAD_STATES = Object.freeze({
    QUEUED: 'queued',
    ACTIVE: 'active',
    WAITING: 'waiting',
    SUCCESS: 'success',
    ERROR: 'error',
    CANCELLED: 'cancelled'
});

export const DEFAULT_RETRY = Object.freeze({ maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 30000, factor: 2, jitter: 0.25 });

// ההשהיה לפני הניסיון ה-(attempt+1): 1s, 2s, 4s… עד התקרה, עם רעד אקראי קטן
// כדי שכמה קבצים שנכשלו יחד לא ינסו שוב באותו רגע בדיוק.
export function retryDelayMs(attempt, options = {}, random = Math.random) {
    const { baseDelayMs, maxDelayMs, factor, jitter } = { ...DEFAULT_RETRY, ...options };
    const step = Math.max(1, Math.floor(Number(attempt) || 1));
    const raw = Math.min(maxDelayMs, baseDelayMs * factor ** (step - 1));
    const spread = raw * Math.max(0, Math.min(1, jitter));
    const value = raw - spread + random() * spread * 2;
    return Math.max(0, Math.min(maxDelayMs, Math.round(value)));
}

// אילו כשלונות שווה לנסות שוב: רשת, זמן קצוב, עומס (429) ושגיאות שרת (5xx),
// וגם 409 של "חלק חסר" — ההמשך ישלים אותו. שגיאת הרשאה, קובץ גדול מדי או סוג
// לא נתמך לא ישתנו בניסיון נוסף, ולכן הן מסומנות מיד ככשל.
export function isRetriableUploadError(error) {
    if (!error) return false;
    if (error.name === 'AbortError' || error.code === 'upload_cancelled') return false;
    const status = Number(error.status);
    if (!status) return true;
    if (status === 408 || status === 425 || status === 429) return true;
    if (status === 409 && error.code === 'upload_incomplete') return true;
    return status >= 500;
}

function cancelledError() {
    const error = new Error('ההעלאה בוטלה.');
    error.name = 'AbortError';
    error.code = 'upload_cancelled';
    return error;
}

// השהיה שאפשר לקטוע: ביטול הקובץ אינו מחכה לסוף ההמתנה.
export function abortableSleep(ms, signal, setTimer = setTimeout, clearTimer = clearTimeout) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(cancelledError()); return; }
        const onAbort = () => { clearTimer(timer); reject(cancelledError()); };
        const timer = setTimer(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

export function summarizeItems(items) {
    const summary = { total: items.length, queued: 0, active: 0, waiting: 0, success: 0, error: 0, cancelled: 0, bytesTotal: 0, bytesDone: 0 };
    for (const item of items) {
        summary[item.state] += 1;
        const size = Number(item.size) || 0;
        // קובץ שבוטל אינו נספר בנפח: הסרגל הכולל מראה את מה שבאמת יעלה.
        if (item.state === UPLOAD_STATES.CANCELLED) continue;
        summary.bytesTotal += size;
        summary.bytesDone += item.state === UPLOAD_STATES.SUCCESS ? size : size * (Number(item.progress) || 0);
    }
    summary.finished = summary.success + summary.error + summary.cancelled;
    summary.progress = summary.bytesTotal > 0
        ? summary.bytesDone / summary.bytesTotal
        : (summary.total ? summary.finished / summary.total : 0);
    summary.done = summary.finished === summary.total;
    return summary;
}

// הכיתוב של הסיכום, לאזור ה-aria-live ולשורת הסיכום שמעל התור.
export function formatUploadSummary(summary) {
    if (!summary?.total) return '';
    const parts = [`הושלמו ${summary.success} מתוך ${summary.total}`];
    if (summary.active || summary.queued || summary.waiting) parts.push(`בתהליך ${summary.active + summary.queued + summary.waiting}`);
    if (summary.waiting) parts.push(`ממתינים לניסיון חוזר ${summary.waiting}`);
    if (summary.error) parts.push(`נכשלו ${summary.error}`);
    if (summary.cancelled) parts.push(`בוטלו ${summary.cancelled}`);
    return parts.join(' · ');
}

export function createUploadQueue({
    run,
    concurrency = 2,
    retry = {},
    onChange = () => {},
    waitWhilePaused = async () => {},
    sleep = abortableSleep,
    random = Math.random
} = {}) {
    if (typeof run !== 'function') throw new Error('createUploadQueue: חסרה פונקציית העלאה.');
    const retryOptions = { ...DEFAULT_RETRY, ...retry };
    const items = [];
    let running = null;

    const notify = item => {
        try { onChange(item, summarizeItems(items)); } catch (error) { /* ממשק שנכשל אינו עוצר את התור */ }
    };
    const find = id => items.find(item => item.id === id);

    function add(entries) {
        const added = [];
        for (const entry of [].concat(entries || [])) {
            const item = {
                id: String(entry.id ?? items.length),
                payload: entry.payload,
                size: Number(entry.size) || 0,
                state: UPLOAD_STATES.QUEUED,
                progress: 0,
                attempts: 0,
                error: null,
                result: null,
                nextRetryAt: 0,
                controller: null
            };
            items.push(item);
            added.push(item);
            notify(item);
        }
        return added;
    }

    async function runItem(item) {
        while (item.state !== UPLOAD_STATES.CANCELLED) {
            item.controller = new AbortController();
            item.attempts += 1;
            item.state = UPLOAD_STATES.ACTIVE;
            item.error = null;
            notify(item);
            try {
                item.result = await run(item.payload, {
                    signal: item.controller.signal,
                    attempt: item.attempts,
                    onProgress: fraction => {
                        if (item.state !== UPLOAD_STATES.ACTIVE) return;
                        item.progress = Math.max(0, Math.min(1, Number(fraction) || 0));
                        notify(item);
                    }
                });
                if (item.state === UPLOAD_STATES.CANCELLED) return;
                item.state = UPLOAD_STATES.SUCCESS;
                item.progress = 1;
                notify(item);
                return;
            } catch (error) {
                if (item.state === UPLOAD_STATES.CANCELLED || item.controller.signal.aborted) {
                    item.state = UPLOAD_STATES.CANCELLED;
                    notify(item);
                    return;
                }
                item.error = error;
                if (!isRetriableUploadError(error) || item.attempts >= retryOptions.maxAttempts) {
                    item.state = UPLOAD_STATES.ERROR;
                    notify(item);
                    return;
                }
                const delay = retryDelayMs(item.attempts, retryOptions, random);
                item.state = UPLOAD_STATES.WAITING;
                item.nextRetryAt = Date.now() + delay;
                notify(item);
                try {
                    await sleep(delay, item.controller.signal);
                } catch (sleepError) {
                    item.state = UPLOAD_STATES.CANCELLED;
                    notify(item);
                    return;
                }
            }
        }
    }

    function nextQueued() {
        return items.find(item => item.state === UPLOAD_STATES.QUEUED);
    }

    async function worker() {
        for (;;) {
            await waitWhilePaused();
            const item = nextQueued();
            if (!item) return;
            await runItem(item);
        }
    }

    // מריץ עד שאין עוד מה להעלות. קריאה נוספת בזמן ריצה מחזירה את אותה ריצה,
    // ופריטים שנוספו או הוחזרו לתור בינתיים נאספים בה.
    function start() {
        if (running) return running;
        running = (async () => {
            try {
                const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
                await Promise.all(workers);
                // פריט שהוחזר לתור בדיוק כשהעובדים סיימו.
                if (nextQueued()) await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
            } finally {
                running = null;
            }
            return summarizeItems(items);
        })();
        return running;
    }

    function cancel(id) {
        const item = find(id);
        if (!item || [UPLOAD_STATES.SUCCESS, UPLOAD_STATES.CANCELLED].includes(item.state)) return false;
        item.state = UPLOAD_STATES.CANCELLED;
        // קובץ שבאמצע העלאה או בהמתנה לניסיון חוזר נקטע מיד.
        item.controller?.abort();
        notify(item);
        return true;
    }

    function cancelAll() {
        for (const item of items) cancel(item.id);
    }

    // ניסיון חוזר ידני לקובץ שנכשל סופית (או בוטל): חוזר לתור עם מונה נקי.
    function retryItem(id) {
        const item = find(id);
        if (!item || ![UPLOAD_STATES.ERROR, UPLOAD_STATES.CANCELLED].includes(item.state)) return false;
        item.state = UPLOAD_STATES.QUEUED;
        item.attempts = 0;
        item.progress = 0;
        item.error = null;
        notify(item);
        return true;
    }

    function retryFailed() {
        return items.filter(item => item.state === UPLOAD_STATES.ERROR).map(item => retryItem(item.id)).filter(Boolean).length;
    }

    return {
        add,
        start,
        cancel,
        cancelAll,
        retry: retryItem,
        retryFailed,
        get: find,
        get items() { return items.slice(); },
        get running() { return Boolean(running); },
        summary: () => summarizeItems(items)
    };
}
