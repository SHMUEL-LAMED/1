// admin-errors.js — מסך "שגיאות ותקלות" בלוח הניהול.
//
// השגיאות נשמרות ב-D1 מקובצות לפי טביעת אצבע (ראו /telemetry/errors
// ב-cloudflare-worker.js): שורה לכל סוג תקלה עם מונה מופעים. המסך מציג את
// הרשימה, מאפשר למנהל־על לסמן שטופל ולפתוח מחדש, ומזין את מונה השגיאות
// שבתפריט. המודול נטען עצלה מ-admin-ui.js, רק בדף הניהול.

const SOURCE_LABELS = { site: 'האתר', worker: 'השרת' };
const SUMMARY_REFRESH_INTERVAL_MS = 60 * 1000;
const LIST_LIMIT = 200;

let errorsFilter = 'open';
let loadGeneration = 0;
let summaryFetchedAt = 0;
let summaryPromise = null;

export function formatErrorTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '—';
    try {
        return new Date(time).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
    } catch (error) {
        return new Date(time).toISOString();
    }
}

export function shortUid(uid) {
    const value = String(uid || '').trim();
    if (!value) return '—';
    return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

export function summaryCounts(summary) {
    return {
        open: Math.max(0, Math.trunc(Number(summary?.open) || 0)),
        last24h: Math.max(0, Math.trunc(Number(summary?.last24h) || 0))
    };
}

// המונים נכתבים ל-DOM רק למי שמורשה לראות נתוני ניהול; לכל אחד אחר
// נכתב אפס, גם אם הנתון הגיע בטעות למצב המשותף.
window.renderClientErrorsSummary = function() {
    const allowed = Boolean(window.canViewAdminData?.());
    const counts = summaryCounts(allowed ? window.state?.clientErrorsSummary : null);
    const targets = { clientErrorsOpenCount: counts.open, clientErrorsRecentCount: counts.last24h };
    Object.entries(targets).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(allowed ? value : 0);
    });
    window.refreshAdminNavBadges?.();
};

// הסיכום נמשך מהשרת לכל היותר פעם בדקה, אלא אם ביקשו רענון מפורש.
window.refreshClientErrorsSummary = async function(force = false) {
    if (!window.canViewAdminData?.()) {
        if (window.state) window.state.clientErrorsSummary = null;
        window.renderClientErrorsSummary();
        return null;
    }
    if (!force && Date.now() - summaryFetchedAt < SUMMARY_REFRESH_INTERVAL_MS) {
        return window.state?.clientErrorsSummary || null;
    }
    if (summaryPromise) return summaryPromise;
    summaryPromise = window.r2Request('/telemetry/errors/summary')
        .then(payload => {
            summaryFetchedAt = Date.now();
            window.state.clientErrorsSummary = summaryCounts(payload);
            window.renderClientErrorsSummary();
            window.renderAdminAttention?.();
            return window.state.clientErrorsSummary;
        })
        .catch(error => {
            // שרת שעדיין לא פרוס עם הנתיב הזה אינו סיבה להציף את הלוח.
            if (error?.status !== 404) console.warn('Error summary failed:', error);
            return null;
        })
        .finally(() => { summaryPromise = null; });
    return summaryPromise;
};

window.setClientErrorsFilter = function(filter) {
    errorsFilter = filter === 'resolved' ? 'resolved' : 'open';
    document.querySelectorAll('[data-errors-filter]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.errorsFilter === errorsFilter);
    });
    return window.loadClientErrors();
};

function safeHttpsUrl(value) {
    const text = String(value || '').trim();
    if (!/^https:\/\//i.test(text)) return '';
    try {
        return new URL(text).href;
    } catch (error) {
        return '';
    }
}

function textCell(className, text, title = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    if (title) cell.title = title;
    return cell;
}

function buildErrorRow(error, isSuper) {
    const row = document.createElement('tr');
    row.dataset.fingerprint = String(error.fingerprint || '');

    const messageCell = document.createElement('td');
    messageCell.className = 'error-message';
    if (error.stack) {
        const details = document.createElement('details');
        details.className = 'error-details';
        const summary = document.createElement('summary');
        summary.textContent = error.message || '(ללא הודעה)';
        const stack = document.createElement('pre');
        stack.className = 'error-stack';
        stack.textContent = error.stack;
        details.append(summary, stack);
        messageCell.appendChild(details);
    } else {
        const text = document.createElement('p');
        text.className = 'admin-row-title';
        text.textContent = error.message || '(ללא הודעה)';
        messageCell.appendChild(text);
    }
    const agent = document.createElement('p');
    agent.className = 'admin-row-meta';
    agent.textContent = error.userAgent || '';
    messageCell.appendChild(agent);
    row.appendChild(messageCell);

    const sourceCell = document.createElement('td');
    const source = document.createElement('span');
    source.className = 'error-source';
    source.dataset.source = error.source === 'worker' ? 'worker' : 'site';
    source.textContent = SOURCE_LABELS[source.dataset.source];
    sourceCell.appendChild(source);
    row.appendChild(sourceCell);

    row.appendChild(textCell('error-count', String(Number(error.count) || 0)));
    row.appendChild(textCell('error-time', formatErrorTime(error.firstSeen)));
    row.appendChild(textCell('error-time', formatErrorTime(error.lastSeen)));
    row.appendChild(textCell('', shortUid(error.lastUid), String(error.lastUid || '')));

    const urlCell = document.createElement('td');
    urlCell.className = 'error-url';
    const href = safeHttpsUrl(error.url);
    if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = new URL(href).pathname + new URL(href).hash;
        link.title = href;
        urlCell.appendChild(link);
    } else {
        urlCell.textContent = error.url || '—';
    }
    row.appendChild(urlCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'error-actions';
    if (isSuper) {
        const button = document.createElement('button');
        button.type = 'button';
        const resolved = Boolean(error.resolvedAt);
        button.className = resolved ? 'btn-secondary-dark' : 'btn-primary-gold';
        button.textContent = resolved ? 'פתח מחדש' : 'טופל';
        button.onclick = () => (resolved
            ? window.reopenClientError(error.fingerprint)
            : window.resolveClientError(error.fingerprint));
        actionsCell.appendChild(button);
    }
    row.appendChild(actionsCell);
    return row;
}

function renderClientErrorRows(list, errors) {
    list.replaceChildren();
    if (!errors.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 8;
        cell.className = 'admin-empty';
        cell.textContent = errorsFilter === 'open' ? 'אין שגיאות פתוחות.' : 'אין שגיאות שסומנו כטופלו.';
        row.appendChild(cell);
        list.appendChild(row);
        return;
    }
    const isSuper = Boolean(window.state?.isSuperAdmin);
    errors.forEach(error => list.appendChild(buildErrorRow(error, isSuper)));
}

window.loadClientErrors = async function() {
    const list = document.getElementById('clientErrorsList');
    const status = document.getElementById('clientErrorsStatus');
    if (!list) return;
    if (!window.canViewAdminData?.()) {
        list.replaceChildren();
        return;
    }
    const generation = ++loadGeneration;
    if (status) status.textContent = 'טוען שגיאות…';
    try {
        const [payload] = await Promise.all([
            window.r2Request(`/telemetry/errors?status=${errorsFilter}&limit=${LIST_LIMIT}`),
            window.refreshClientErrorsSummary(true)
        ]);
        if (generation !== loadGeneration) return;
        const errors = Array.isArray(payload?.errors) ? payload.errors : [];
        renderClientErrorRows(list, errors);
        if (status) {
            status.textContent = errors.length
                ? `${errors.length} סוגי שגיאות ${errorsFilter === 'open' ? 'פתוחים' : 'שטופלו'}, מהחדש לישן.`
                : (errorsFilter === 'open' ? 'אין שגיאות פתוחות.' : 'אין שגיאות שסומנו כטופלו.');
        }
    } catch (error) {
        if (generation !== loadGeneration) return;
        list.replaceChildren();
        if (status) {
            status.textContent = error?.status === 404
                ? 'ניטור השגיאות עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
                : (error?.message || 'טעינת השגיאות נכשלה.');
        }
    }
};

async function mutateClientError(action, fingerprint) {
    if (!window.checkSuperAdminPermission?.()) return;
    try {
        await window.r2Request(`/telemetry/errors/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint })
        });
        window.showNotification?.(action === 'resolve' ? 'השגיאה סומנה כטופלה.' : 'השגיאה נפתחה מחדש.', true);
        await window.loadClientErrors();
    } catch (error) {
        window.showNotification?.(error?.message || 'עדכון השגיאה נכשל.', false);
    }
}

window.resolveClientError = fingerprint => mutateClientError('resolve', fingerprint);
window.reopenClientError = fingerprint => mutateClientError('reopen', fingerprint);

window.clearResolvedClientErrors = function(confirmed = false) {
    if (!window.checkSuperAdminPermission?.()) return;
    if (!confirmed) {
        window.showConfirm?.(
            'ניקוי שגיאות שטופלו',
            'למחוק לצמיתות את השגיאות שסומנו כטופלו לפני יותר מ־30 יום? שגיאות פתוחות אינן מושפעות.',
            () => window.clearResolvedClientErrors(true)
        );
        return;
    }
    window.r2Request('/telemetry/errors/clear', { method: 'POST' })
        .then(payload => {
            window.showNotification?.(`נמחקו ${Number(payload?.deleted) || 0} שגיאות ישנות.`, true);
            return window.loadClientErrors();
        })
        .catch(error => window.showNotification?.(error?.message || 'הניקוי נכשל.', false));
};
