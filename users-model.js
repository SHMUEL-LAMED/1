// users-model.js — ההיגיון של "ההעלאות שלי", בדיקת הכפילויות, התיוג הידני
// וקישורי ההזמנה לאירוע. בלי DOM, נבדק ב-Node (users-model.test.mjs).

export const MY_UPLOAD_STATUSES = Object.freeze({
    pending: 'ממתין לאישור',
    approved: 'אושר',
    rejected: 'נדחה'
});

export const REJECT_REASON_MAX_LENGTH = 300;
// בכניסה הראשונה (בלי סימון שמור) ההודעה מתייחסת לאישורים של השבוע האחרון בלבד.
export const APPROVALS_FIRST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_KEY_PREFIX = 'simchas_my_uploads_seen_';

function text(value, max) {
    return [...String(value ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
}

function time(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

// התשובה של GET /my-uploads, בצורה בטוחה לציור: סטטוס מוכר בלבד, כתובת
// תמונה רק אם עברה את sanitizeUrl, והסיבה רק לפריט שנדחה.
export function normalizeMyUploads(payload, sanitizeUrl = value => value) {
    const uploads = (Array.isArray(payload?.uploads) ? payload.uploads : [])
        .map(raw => {
            const id = safeId(raw?.id);
            const status = Object.hasOwn(MY_UPLOAD_STATUSES, raw?.status) ? raw.status : '';
            if (!id || !status) return null;
            const thumbUrl = status === 'approved' ? String(sanitizeUrl(raw?.thumbUrl) || '') : '';
            return {
                id,
                status,
                title: text(raw?.title, 160) || 'ללא שם',
                mediaType: raw?.mediaType === 'video' ? 'video' : 'image',
                uploadedAt: time(raw?.uploadedAt),
                decidedAt: time(raw?.decidedAt),
                folderId: status === 'approved' ? safeId(raw?.folderId) : '',
                folderName: status === 'approved' ? text(raw?.folderName, 120) : '',
                reason: status === 'rejected' ? text(raw?.reason, REJECT_REASON_MAX_LENGTH) : '',
                thumbUrl
            };
        })
        .filter(Boolean);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const item of uploads) counts[item.status] += 1;
    return { uploads, counts, retentionDays: Number(payload?.retentionDays) || 60 };
}

export function filterUploadsByStatus(uploads, status) {
    return status && Object.hasOwn(MY_UPLOAD_STATUSES, status) ? uploads.filter(item => item.status === status) : uploads;
}

export function seenMarkerKey(uid) {
    const id = safeId(uid);
    return id ? `${SEEN_KEY_PREFIX}${id}` : '';
}

// פריטים שאושרו מתוך התור אחרי הסימון האחרון. העלאה ישירה (מעלה או מנהל) אינה
// "אושרה" — אין לה decidedAt — ולכן אינה נספרת.
export function newlyApproved(uploads, since) {
    const marker = time(since);
    return uploads.filter(item => item.status === 'approved' && item.decidedAt > marker);
}

// הסימון הבא: האישור האחרון שכבר הוצג, ולא "עכשיו" — כך אישור שנרשם בשרת
// עם שעון מעט שונה אינו הולך לאיבוד.
export function nextSeenMarker(uploads, previous) {
    const latest = uploads.reduce((max, item) => (item.status === 'approved' ? Math.max(max, item.decidedAt) : max), 0);
    return Math.max(time(previous), latest);
}

// נקודת הייחוס: מה שנשמר, ובלעדיו — שבוע אחורה.
export function approvalsBaseline(stored, now = Date.now()) {
    const saved = time(stored);
    return saved || now - APPROVALS_FIRST_LOOKBACK_MS;
}

export function approvalsNotice(count) {
    if (count <= 0) return '';
    return count === 1 ? 'אחת מההעלאות שלך אושרה ונוספה לגלריה.' : `${count} מההעלאות שלך אושרו ונוספו לגלריה.`;
}

export function myUploadsSummary(counts) {
    const parts = [];
    if (counts.pending) parts.push(`${counts.pending} ממתינים לאישור`);
    if (counts.approved) parts.push(`${counts.approved} אושרו`);
    if (counts.rejected) parts.push(`${counts.rejected} נדחו`);
    return parts.length ? parts.join(' · ') : 'עדיין לא העלית תמונות או סרטונים.';
}

export function normalizeRejectReason(value) {
    return text(String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' '), REJECT_REASON_MAX_LENGTH);
}

// --- כפילויות ---

// מה שנשלח ל-Worker: כל הטביעות של כל הקבצים, בלי כפילויות, ועד max.
export function duplicateLookupHashes(records, max = 100) {
    const hashes = new Set();
    for (const record of records) {
        for (const hash of record?.duplicateLookup || []) {
            if (/^(?:s1:)?[a-f0-9]{64}$/.test(hash)) hashes.add(hash);
        }
    }
    return [...hashes].slice(0, max);
}

// מסמן כל רשומה: duplicateOf = { imageId?, state?, inBatch? } כשקובץ זהה כבר
// בגלריה, בתור האישור, או מופיע קודם באותה בחירה. רשומה בלי טביעה אינה נבדקת.
export function markDuplicates(records, results = []) {
    const known = new Map();
    for (const result of results) {
        if (result?.exists) known.set(String(result.hash), { imageId: safeId(result.imageId), state: result.state === 'pending' ? 'pending' : result.imageId ? 'approved' : '' });
    }
    const seen = new Set();
    for (const record of records) {
        const lookup = Array.isArray(record?.duplicateLookup) ? record.duplicateLookup : [];
        const match = lookup.map(hash => known.get(hash)).find(Boolean);
        const inBatch = lookup.some(hash => seen.has(hash));
        record.duplicateOf = match ? { ...match } : inBatch ? { inBatch: true } : null;
        for (const hash of lookup) seen.add(hash);
    }
    return records.filter(record => record.duplicateOf);
}

export function duplicateLabel(duplicate) {
    if (!duplicate) return '';
    if (duplicate.inBatch) return 'מופיע פעמיים בבחירה';
    if (duplicate.state === 'pending') return 'כבר ממתין לאישור';
    return 'כבר קיים בגלריה';
}

// --- תיוג ידני: מלבן שנגרר על התמונה ---

// start ו-end בפיקסלים של התמונה המוצגת (rect = { width, height }), והתוצאה
// ביחידות יחסיות — אותה צורה של מיקום פרצוף שה-Worker בודק (parseFaceBox).
// מלבן קטן מדי (נגיעה בלי גרירה) מחזיר null, כלומר "התמונה כולה".
export function boxFromDrag(start, end, rect, naturalAspect) {
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    if (!(width > 0) || !(height > 0)) return null;
    const clamp = value => Math.max(0, Math.min(1, value));
    const x1 = clamp(Math.min(start.x, end.x) / width);
    const x2 = clamp(Math.max(start.x, end.x) / width);
    const y1 = clamp(Math.min(start.y, end.y) / height);
    const y2 = clamp(Math.max(start.y, end.y) / height);
    if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return null;
    const round = value => Math.round(value * 10000) / 10000;
    const aspect = Number(naturalAspect) > 0 ? Number(naturalAspect) : width / height;
    return {
        x: round(x1),
        y: round(y1),
        w: round(Math.min(x2 - x1, 1 - x1)),
        h: round(Math.min(y2 - y1, 1 - y1)),
        a: round(Math.max(0.05, Math.min(20, aspect)))
    };
}

// --- קישורי הזמנה ---

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const INVITE_DAY_LABELS = Object.freeze({ 1: 'יום אחד', 7: 'שבוע', 30: 'חודש' });
const INVITE_HASH_PATTERN = /^#invite\/([A-Za-z0-9_-]{43})$/;

// #invite/<token>. האסימון ב-hash: הוא אינו נשלח לשרת האתר ואינו נרשם ביומנים.
export function parseInviteHash(hash) {
    const match = String(hash ?? '').match(INVITE_HASH_PATTERN);
    return match ? match[1] : '';
}

export function inviteUrl(pageHref, token) {
    if (!INVITE_TOKEN_PATTERN.test(String(token ?? ''))) return '';
    const url = new URL(pageHref);
    url.hash = `invite/${token}`;
    url.search = '';
    url.pathname = url.pathname.replace(/[^/]*$/, '');
    return url.href;
}

export const INVITE_STATUS_LABELS = Object.freeze({
    active: 'פעיל',
    expired: 'פג תוקף',
    revoked: 'בוטל',
    exhausted: 'נוצל עד הסוף'
});

export function normalizeInvite(raw) {
    const inviteId = String(raw?.inviteId ?? '');
    if (!/^[A-Za-z0-9_-]{12,32}$/.test(inviteId)) return null;
    return {
        inviteId,
        folderId: safeId(raw?.folderId),
        folderName: text(raw?.folderName, 120) || 'אירוע',
        autoApprove: raw?.autoApprove === true,
        maxUses: Math.max(0, Math.trunc(Number(raw?.maxUses) || 0)),
        useCount: Math.max(0, Math.trunc(Number(raw?.useCount) || 0)),
        createdAt: time(raw?.createdAt),
        expiresAt: time(raw?.expiresAt),
        revokedAt: time(raw?.revokedAt),
        status: Object.hasOwn(INVITE_STATUS_LABELS, raw?.status) ? raw.status : 'expired',
        mine: raw?.mine === true
    };
}

export function inviteUsageLabel(invite) {
    return invite.maxUses > 0 ? `${invite.useCount} מתוך ${invite.maxUses} שימושים` : `${invite.useCount} שימושים, ללא הגבלה`;
}

export function inviteExpiryLabel(invite, now = Date.now()) {
    if (invite.status === 'revoked') return 'בוטל';
    const remaining = invite.expiresAt - now;
    if (remaining <= 0) return 'פג תוקף';
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    if (hours < 24) return hours === 1 ? 'בתוקף עוד שעה' : `בתוקף עוד ${hours} שעות`;
    const days = Math.ceil(hours / 24);
    return days === 1 ? 'בתוקף עוד יום' : `בתוקף עוד ${days} ימים`;
}

// מה לומר למבקר אחרי מימוש ההזמנה (POST /invites/redeem).
export function inviteRedeemMessage(result) {
    const event = text(result?.folderName, 120) || 'האירוע';
    if (result?.alreadyApproved) return `ברוך הבא! התמונות של ${event} מחכות לך בגלריה.`;
    if (result?.status === 'approved') return `ברוך הבא! אושרת לצפייה בגלריה, והתמונות של ${event} מחכות לך.`;
    if (result?.status === 'rejected') return 'בקשת ההצטרפות שלך נדחתה בעבר. אפשר לפנות למנהל הגלריה.';
    return `בקשת ההצטרפות שלך נשלחה עם ההזמנה לאירוע ${event}, וממתינה לאישור מנהל.`;
}

export function inviteErrorMessage(error) {
    switch (error?.code) {
        case 'invite_expired': return 'תוקף קישור ההזמנה פג. אפשר לבקש קישור חדש ממי ששלח אותו.';
        case 'invite_revoked': return 'קישור ההזמנה בוטל. אפשר לבקש קישור חדש ממי ששלח אותו.';
        case 'invite_exhausted': return 'קישור ההזמנה כבר נוצל עד הסוף. אפשר לבקש קישור חדש ממי ששלח אותו.';
        case 'invite_rate_limit': return 'בוצעו ניסיונות רבים. נסה שוב בעוד שעה.';
        case 'account_blocked': return 'החשבון חסום.';
        default:
            return error?.status === 404 && error?.code !== 'invite_invalid'
                ? 'הזמנות עדיין אינן זמינות בשרת.'
                : 'קישור ההזמנה אינו תקף.';
    }
}
