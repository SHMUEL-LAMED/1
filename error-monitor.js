// error-monitor.js — ניטור שגיאות בצד הלקוח.
//
// שגיאות שלא נתפסו (error, unhandledrejection) ושגיאות שקוד האתר תופס
// בעצמו (window.reportClientError) נשלחות ל-Worker, שמקבץ אותן לפי טביעת
// אצבע ומציג אותן בלוח הניהול במסך "שגיאות ותקלות".
//
// כללי הזהירות: אותה שגיאה נשלחת פעם אחת בלבד לכל טעינת דף, עד עשר
// שגיאות שונות לטעינה, ורעש ידוע — ResizeObserver, "Script error." ממקור
// אחר, בקשות שבוטלו ומצב לא מקוון — אינו נשלח כלל. הדיווח אינו כולל
// פרטים אישיים: הודעה, מחסנית, כתובת הדף, הדפדפן וגרסת האתר בלבד.
// המשתמש המחובר מזוהה בשרת לפי האסימון, ולא לפי מה שהדפדפן טוען.

export const CLIENT_ERROR_REPORT_LIMIT = 10;
export const CLIENT_ERROR_MESSAGE_MAX_LENGTH = 500;
export const CLIENT_ERROR_STACK_MAX_LENGTH = 4000;
export const CLIENT_ERROR_URL_MAX_LENGTH = 500;
export const CLIENT_ERROR_TOKEN_WAIT_MS = 1500;

const IGNORED_MESSAGE_PATTERNS = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i
];
const ABORTED_MESSAGE_PATTERNS = [
    /\baborted\b/i,
    /signal is aborted/i
];

function normalizePart(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// השורה הראשונה במחסנית שמצביעה על קוד, בלי מספרי שורה ועמודה — אותה
// נורמליזציה כמו ב-Worker, כדי שהסינון המקומי יתאים לקיבוץ בשרת.
export function firstStackFrame(stack) {
    const lines = String(stack || '').split('\n').map(line => line.trim()).filter(Boolean);
    const frame = lines.find(line => /^at\s+\S/.test(line) || /\S@\S+:\d+/.test(line)) || '';
    return frame.replace(/\?[^\s:)]*/g, '').replace(/:\d+(?::\d+)?\)?$/, '');
}

export function errorFingerprintKey(message, stack) {
    return `${normalizePart(message)}|${normalizePart(firstStackFrame(stack))}`;
}

// מפרק כל דבר שנזרק — Error, מחרוזת, אובייקט — להודעה, מחסנית והקשר.
export function describeError(error, context) {
    const described = { message: '', stack: '', extra: {} };
    if (error instanceof Error || (error && typeof error === 'object')) {
        described.message = String(error.message ?? '');
        described.stack = String(error.stack ?? '');
        if (!described.message && !(error instanceof Error)) {
            try {
                described.message = JSON.stringify(error);
            } catch (serializationError) {
                described.message = String(error);
            }
        }
        if (typeof error.name === 'string' && error.name && error.name !== 'Error') described.extra.name = error.name;
        if (error.code !== undefined && error.code !== null) described.extra.code = String(error.code);
        if (error.status !== undefined && error.status !== null) described.extra.status = String(error.status);
    } else if (error !== undefined && error !== null) {
        described.message = String(error);
    }
    if (typeof context === 'string') {
        if (context) described.extra.scope = context;
    } else if (context && typeof context === 'object') {
        Object.assign(described.extra, context);
    }
    described.message = described.message.trim();
    return described;
}

// רעש שאינו מעיד על תקלה באתר: לולאת ResizeObserver, שגיאת סקריפט ממקור
// אחר שהדפדפן מסתיר את פרטיה, בקשה שבוטלה (ניווט באמצע טעינה) ושגיאות
// בזמן שהמכשיר מנותק מהרשת.
export function isIgnorableError(described, { online = true } = {}) {
    if (!online) return true;
    const message = String(described?.message || '').trim();
    if (!message) return true;
    if (IGNORED_MESSAGE_PATTERNS.some(pattern => pattern.test(message))) return true;
    if (described?.extra?.name === 'AbortError') return true;
    if (ABORTED_MESSAGE_PATTERNS.some(pattern => pattern.test(message))) return true;
    return false;
}

function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

export function createErrorMonitor(options = {}) {
    const {
        endpoint = '',
        version = '',
        limit = CLIENT_ERROR_REPORT_LIMIT,
        getToken = null,
        sendBeacon = null,
        fetch: fetchImpl = null,
        isOnline = () => true,
        getUrl = () => '',
        getUserAgent = () => '',
        log = () => {}
    } = options;

    const seen = new Set();
    let sent = 0;

    // משתמש מחובר מדווח ב-fetch עם האסימון, כדי שהשרת יוכל לרשום מי נתקל
    // בתקלה; sendBeacon אינו יכול לשאת כותרת Authorization, ולכן הוא משמש
    // את מי שאינו מחובר — והוא שורד גם סגירה של הדף. אם גם הוא אינו זמין,
    // נשארת fetch עם keepalive.
    async function deliver(payload) {
        const body = JSON.stringify(payload);
        let token = null;
        if (typeof getToken === 'function') {
            try {
                token = await withTimeout(Promise.resolve().then(getToken), CLIENT_ERROR_TOKEN_WAIT_MS);
            } catch (tokenError) {
                token = null;
            }
        }
        if (token && typeof fetchImpl === 'function') {
            await fetchImpl(endpoint, {
                method: 'POST',
                keepalive: true,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body
            });
            return 'fetch-auth';
        }
        if (typeof sendBeacon === 'function') {
            try {
                const data = typeof Blob === 'function' ? new Blob([body], { type: 'application/json' }) : body;
                if (sendBeacon(endpoint, data)) return 'beacon';
            } catch (beaconError) {
                log('sendBeacon failed:', beaconError);
            }
        }
        if (typeof fetchImpl === 'function') {
            await fetchImpl(endpoint, {
                method: 'POST',
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body
            });
            return 'fetch';
        }
        return 'none';
    }

    // מחזירה הבטחה לשם המסלול שבו הדיווח יצא, או null כשהדיווח נדחה
    // (רעש, כפילות או חריגה מהמכסה). ההחלטה עצמה סינכרונית, כדי ששתי
    // שגיאות זהות ברצף לא ישלחו פעמיים.
    function report(error, context) {
        try {
            const described = describeError(error, context);
            if (isIgnorableError(described, { online: isOnline() })) return Promise.resolve(null);
            const key = errorFingerprintKey(described.message, described.stack);
            if (seen.has(key) || sent >= limit) return Promise.resolve(null);
            seen.add(key);
            sent += 1;
            const payload = {
                message: described.message.slice(0, CLIENT_ERROR_MESSAGE_MAX_LENGTH),
                stack: described.stack.slice(0, CLIENT_ERROR_STACK_MAX_LENGTH),
                url: String(getUrl() || '').slice(0, CLIENT_ERROR_URL_MAX_LENGTH),
                userAgent: String(getUserAgent() || '').slice(0, 300),
                extra: { version, ...described.extra }
            };
            return deliver(payload).catch(deliveryError => {
                log('Error report failed:', deliveryError);
                return null;
            });
        } catch (monitorError) {
            // המנטר עצמו לעולם אינו זורק אל תוך הקוד שקרא לו.
            log('Error monitor failed:', monitorError);
            return Promise.resolve(null);
        }
    }

    function handleErrorEvent(event) {
        const error = event?.error ?? event?.message;
        const extra = { scope: 'window.error' };
        if (event?.filename) extra.file = `${event.filename}:${event.lineno || 0}:${event.colno || 0}`;
        return report(error, extra);
    }

    function handleRejectionEvent(event) {
        return report(event?.reason, { scope: 'unhandledrejection' });
    }

    const monitor = {
        report,
        handleErrorEvent,
        handleRejectionEvent,
        install(target) {
            target?.addEventListener?.('error', handleErrorEvent);
            target?.addEventListener?.('unhandledrejection', handleRejectionEvent);
            return monitor;
        },
        get sentCount() { return sent; }
    };
    return monitor;
}

// ההתקנה בדפדפן: מאזינים גלובליים ונקודת כניסה מפורשת לקוד שתופס שגיאות
// בעצמו. getToken מחזירה את אסימון ההתחברות של המשתמש המחובר, או null.
export function installErrorMonitor({ endpoint, version = '', getToken = null } = {}) {
    if (typeof window === 'undefined') return null;
    const monitor = createErrorMonitor({
        endpoint,
        version,
        getToken,
        sendBeacon: typeof navigator?.sendBeacon === 'function'
            ? (url, data) => navigator.sendBeacon(url, data)
            : null,
        fetch: typeof window.fetch === 'function' ? (url, init) => window.fetch(url, init) : null,
        isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
        getUrl: () => window.location?.href || '',
        getUserAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || ''),
        log: (...args) => console.warn(...args)
    });
    monitor.install(window);
    window.reportClientError = (error, context) => monitor.report(error, context);
    return monitor;
}
