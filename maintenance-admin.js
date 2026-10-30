// maintenance-admin.js — התחזוקה שבלוח הניהול (admin.html בלבד, מנהל־על):
// רשימת הגיבויים היומיים של D1 במסך "גיבוי ושחזור" עם הורדה, והמסך "קישורים
// שבורים". הנתונים נוצרים בשרת, בתהליך התחזוקה היומי (scripts/maintenance.mjs
// ו"תחזוקה יומית" ב-cloudflare-worker.js); כאן רק קוראים ומציגים. אין כאן
// שחזור אוטומטי ואין מחיקה: שחזור גיבוי הוא צעד ידני (README), וקובץ שבור או
// יתום מטופל ידנית. המודול נטען עצלה מ-admin-ui.js כשאחד המסכים נפתח.
import {
    backupFileName, formatBackupDay, normalizeBackupList, normalizeBrokenLinksReport,
    brokenLinkKindLabel, galleryRecordHref, isBackupDay
} from './maintenance-model.js';

const formatBytes = value => window.formatBytes?.(value) ?? `${value} B`;
const formatTime = value => {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
};

function setStatus(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function emptyRow(text) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty';
    empty.textContent = text;
    return empty;
}

function row({ icon, tone = 'gold', title, meta, actions = [] }) {
    const article = document.createElement('article');
    article.className = 'admin-row';
    const badge = document.createElement('span');
    badge.className = 'admin-stat-icon';
    badge.dataset.tone = tone;
    badge.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
    const text = document.createElement('div');
    text.className = 'min-w-0 flex-1';
    const heading = document.createElement('p');
    heading.className = 'admin-row-title truncate';
    if (title instanceof Node) heading.appendChild(title); else heading.textContent = title;
    const details = document.createElement('p');
    details.className = 'admin-row-meta';
    details.textContent = meta;
    text.append(heading, details);
    article.append(badge, text);
    if (actions.length) {
        const box = document.createElement('div');
        box.className = 'flex gap-2';
        box.append(...actions);
        article.appendChild(box);
    }
    return article;
}

function button(label, onClick, className = 'btn-secondary-dark px-3 py-1.5 text-[11px]') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.addEventListener('click', onClick);
    return element;
}

// Worker שעדיין לא נפרס עם הנתיבים מחזיר 404; זו אינה תקלה של המנהל.
const notSupported = error => error?.status === 404;

// --- גיבויים יומיים ---

let backupsGeneration = 0;

window.loadCloudBackups = async function() {
    const list = document.getElementById('cloudBackupsList');
    if (!list) return;
    if (!window.canViewSuperAdminData?.()) { list.replaceChildren(); return; }
    const generation = ++backupsGeneration;
    setStatus('cloudBackupsStatus', 'טוען את רשימת הגיבויים…');
    try {
        const payload = await window.r2Request('/maintenance/backups');
        if (generation !== backupsGeneration || !window.canViewSuperAdminData?.()) return;
        const backups = normalizeBackupList(payload);
        list.replaceChildren(...(backups.length ? backups.map(backup => row({
            icon: 'database-backup',
            tone: 'cyan',
            title: formatBackupDay(backup.day),
            meta: `${backup.day} · ${formatBytes(backup.size)}${backup.compressed ? ' · gzip' : ''}`,
            actions: [button('הורדה', event => window.downloadCloudBackup(backup.day, event.currentTarget))]
        })) : [emptyRow('עדיין אין גיבוי יומי בענן. הגיבוי הראשון ייווצר בריצת התחזוקה הקרובה.')]));
        setStatus('cloudBackupsStatus', backups.length
            ? `${backups.length} גיבויים זמינים. נשמרים ${Number(payload?.retentionDays) || 30} הימים האחרונים.`
            : '');
        window.scheduleIconRefresh?.(list);
    } catch (error) {
        if (generation !== backupsGeneration) return;
        list.replaceChildren();
        setStatus('cloudBackupsStatus', notSupported(error)
            ? 'השרת עדיין לא עודכן לגיבוי היומי. הרשימה תופיע אחרי פריסת ה-Worker.'
            : `לא ניתן לטעון את הגיבויים: ${error.message || 'שגיאה'}`);
    }
};

window.createCloudBackupNow = async function(trigger) {
    if (!window.canViewSuperAdminData?.()) { window.showNotification?.('פעולה זו זמינה למנהל-על בלבד.', false); return; }
    if (trigger) trigger.disabled = true;
    setStatus('cloudBackupsStatus', 'יוצר גיבוי… זה יכול לקחת כמה עשרות שניות.');
    try {
        const result = await window.r2Request('/maintenance/backup', { method: 'POST', timeoutMs: 5 * 60 * 1000 });
        window.showNotification?.(result?.created ? 'הגיבוי של היום נוצר.' : 'הגיבוי של היום כבר קיים.', true);
        await window.loadCloudBackups();
    } catch (error) {
        setStatus('cloudBackupsStatus', notSupported(error)
            ? 'השרת עדיין לא עודכן לגיבוי היומי.'
            : `יצירת הגיבוי נכשלה: ${error.message || 'שגיאה'}`);
    } finally {
        if (trigger) trigger.disabled = false;
    }
};

// ההורדה עוברת דרך fetch עם ההתחברות: קישור רגיל לא היה נושא את האסימון.
window.downloadCloudBackup = async function(day, trigger) {
    if (!window.canViewSuperAdminData?.() || !isBackupDay(day)) return;
    if (trigger) trigger.disabled = true;
    try {
        const token = await window.getFirebaseIdToken();
        const response = await fetch(`${window.R2_WORKER_BASE_URL}/maintenance/backups/${day}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message || `ההורדה נכשלה (${response.status}).`);
        }
        const compressed = (response.headers.get('Content-Type') || '').includes('gzip');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = backupFileName(day, compressed);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
        window.showNotification?.(`הורדת הגיבוי נכשלה: ${error.message || ''}`, false);
    } finally {
        if (trigger) trigger.disabled = false;
    }
};

// --- קישורים שבורים ---

let brokenGeneration = 0;

function renderMissing(report) {
    const list = document.getElementById('brokenLinksMissingList');
    if (!list) return;
    if (!report?.missing.length) {
        list.replaceChildren(emptyRow(report ? 'לכל הרשומות שנבדקו יש קבצים.' : 'עדיין אין דוח.'));
        return;
    }
    list.replaceChildren(...report.missing.map(entry => {
        const link = document.createElement('a');
        link.href = galleryRecordHref(entry.id);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = entry.title || entry.id;
        return row({
            icon: entry.mediaType === 'video' ? 'film' : 'image-off',
            tone: 'danger',
            title: link,
            meta: `${entry.id} · חסר: ${entry.missing.map(item => brokenLinkKindLabel(item.kind)).join(', ')}`
        });
    }));
}

function renderOrphans(report) {
    const list = document.getElementById('brokenLinksOrphansList');
    if (!list) return;
    if (!report?.orphans.length) {
        list.replaceChildren(emptyRow(report ? 'לא נמצאו קבצים בלי רשומה.' : 'עדיין אין דוח.'));
        return;
    }
    list.replaceChildren(...report.orphans.map(entry => row({
        icon: 'file-question',
        tone: 'gold',
        title: entry.key,
        meta: `${formatBytes(entry.size)} · הועלה ${formatTime(entry.uploadedAt)}`
    })));
}

window.loadBrokenLinksReport = async function() {
    const root = document.getElementById('view-brokenlinks');
    if (!root) return;
    if (!window.canViewSuperAdminData?.()) {
        for (const id of ['brokenLinksMissingCount', 'brokenLinksOrphanCount']) setStatus(id, '0');
        document.getElementById('brokenLinksMissingList')?.replaceChildren();
        document.getElementById('brokenLinksOrphansList')?.replaceChildren();
        return;
    }
    const generation = ++brokenGeneration;
    setStatus('brokenLinksStatus', 'טוען את הדוח…');
    try {
        const payload = normalizeBrokenLinksReport(await window.r2Request('/maintenance/broken-links'));
        if (generation !== brokenGeneration || !window.canViewSuperAdminData?.()) return;
        const { report, scanning, listMax } = payload;
        setStatus('brokenLinksMissingCount', String(report?.missingCount || 0));
        setStatus('brokenLinksOrphanCount', String(report?.orphanCount || 0));
        const lines = [];
        if (report) {
            lines.push(`הבדיקה האחרונה הסתיימה ב-${formatTime(report.completedAt)}: נבדקו ${report.checkedRecords} רשומות ו-${report.checkedObjects} קבצים.`);
            if (report.orphanBytes) lines.push(`הקבצים בלי רשומה תופסים ${formatBytes(report.orphanBytes)}.`);
            if (report.missingCount > listMax || report.orphanCount > listMax) lines.push(`הרשימות מציגות עד ${listMax} פריטים מכל סוג.`);
        } else {
            lines.push('עדיין אין דוח: הבדיקה רצה בענן פעם ביום, בריצות התחזוקה.');
        }
        if (scanning) lines.push(`בדיקה חדשה בעיצומה (${scanning.phase === 'objects' ? 'קבצים' : 'רשומות'}): ${scanning.checkedRecords} רשומות ו-${scanning.checkedObjects} קבצים עד כה.`);
        setStatus('brokenLinksStatus', lines.join(' '));
        renderMissing(report);
        renderOrphans(report);
        window.scheduleIconRefresh?.(root);
    } catch (error) {
        if (generation !== brokenGeneration) return;
        setStatus('brokenLinksStatus', notSupported(error)
            ? 'השרת עדיין לא עודכן לבדיקת הקישורים השבורים.'
            : `לא ניתן לטעון את הדוח: ${error.message || 'שגיאה'}`);
    }
};
