// maintenance-model.js — ההיגיון הטהור של מסכי התחזוקה בלוח הניהול, בלי DOM
// (נבדק ב-Node): הספירה לאחור של סל המחזור, שמות קובצי הגיבוי היומי, ונרמול
// הדוח של הקישורים השבורים כפי שה-Worker מחזיר אותו (ראו "תחזוקה יומית"
// ב-cloudflare-worker.js). הציור והבקשות לשרת ב-maintenance-admin.js.

// כמו TRASH_RETENTION_DAYS ב-Worker: פריט בסל המחזור נמחק לצמיתות אחרי 30 יום.
export const TRASH_RETENTION_DAYS = 30;
// כמו D1_BACKUP_RETENTION_DAYS ב-Worker: כמה גיבויים יומיים נשמרים בענן.
export const BACKUP_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// כמה ימים שלמים נשארו עד המחיקה האוטומטית; null כשאין תאריך מחיקה תקין.
export function trashDaysLeft(deletedAt, now = Date.now()) {
    const time = Number(deletedAt);
    if (!Number.isFinite(time) || time <= 0) return null;
    return Math.max(0, Math.ceil((time + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS));
}

export function trashPurgeLabel(deletedAt, now = Date.now()) {
    const days = trashDaysLeft(deletedAt, now);
    if (days === null) return '';
    if (days === 0) return 'יימחק לצמיתות בניקוי הקרוב';
    if (days === 1) return 'יימחק לצמיתות בעוד יום אחד';
    return `יימחק לצמיתות בעוד ${days} ימים`;
}

const BACKUP_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isBackupDay(value) {
    return BACKUP_DAY.test(String(value || ''));
}

export function backupFileName(day, compressed = true) {
    return `simchas-gallery-d1-${day}.json${compressed ? '.gz' : ''}`;
}

// תאריך הגיבוי הוא יום UTC; מוצג כתאריך בלי שעה, באותו יום בכל אזור זמן.
export function formatBackupDay(day) {
    if (!isBackupDay(day)) return '';
    try {
        return new Date(`${day}T12:00:00Z`).toLocaleDateString('he-IL', { timeZone: 'UTC', dateStyle: 'medium' });
    } catch {
        return day;
    }
}

export function normalizeBackupList(payload) {
    const backups = Array.isArray(payload?.backups) ? payload.backups : [];
    return backups
        .filter(item => isBackupDay(item?.day))
        .map(item => ({ day: item.day, size: Math.max(0, Number(item.size) || 0), compressed: item.compressed !== false }));
}

const VARIANT_KIND_LABELS = {
    original: 'הקובץ המקורי',
    thumbnail: 'תמונה ממוזערת ישנה',
    thumb: 'תצוגה קטנה',
    medium: 'תצוגה בינונית',
    poster: 'פוסטר של סרטון'
};

export function brokenLinkKindLabel(kind) {
    const value = String(kind || '');
    const avif = value.endsWith('-avif');
    const base = VARIANT_KIND_LABELS[avif ? value.slice(0, -5) : value] || 'קובץ';
    return avif ? `${base} (AVIF)` : base;
}

const count = value => Math.max(0, Math.trunc(Number(value) || 0));
const safeId = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);

// הדוח מגיע מהשרת; כאן הוא רק נבדק ומקוצץ, כדי שהציור לא ייפגע מנתון חסר.
export function normalizeBrokenLinksReport(payload) {
    const report = payload?.report && typeof payload.report === 'object' ? payload.report : null;
    const scanning = payload?.scanning && typeof payload.scanning === 'object' ? payload.scanning : null;
    return {
        report: report ? {
            completedAt: count(report.completedAt),
            checkedRecords: count(report.checkedRecords),
            checkedObjects: count(report.checkedObjects),
            notStored: count(report.notStored),
            missingCount: count(report.missingCount),
            orphanCount: count(report.orphanCount),
            orphanBytes: count(report.orphanBytes),
            missing: (Array.isArray(report.missing) ? report.missing : [])
                .map(entry => ({
                    id: safeId(entry?.id),
                    title: String(entry?.title || '').slice(0, 80),
                    mediaType: entry?.mediaType === 'video' ? 'video' : 'image',
                    missing: (Array.isArray(entry?.missing) ? entry.missing : []).map(item => ({ kind: String(item?.kind || ''), key: String(item?.key || '') }))
                }))
                .filter(entry => entry.id),
            orphans: (Array.isArray(report.orphans) ? report.orphans : [])
                .map(entry => ({ key: String(entry?.key || ''), size: count(entry?.size), uploadedAt: count(entry?.uploadedAt) }))
                .filter(entry => entry.key)
        } : null,
        scanning: scanning ? {
            startedAt: count(scanning.startedAt),
            phase: scanning.phase === 'objects' ? 'objects' : 'records',
            checkedRecords: count(scanning.checkedRecords),
            checkedObjects: count(scanning.checkedObjects)
        } : null,
        listMax: count(payload?.listMax) || 300
    };
}

// הקישור לרשומה פותח את הפריט בגלריה (#media/<id>, ראו media-link.js).
export function galleryRecordHref(id) {
    const value = safeId(id);
    return value ? `./#media/${value}` : '';
}
