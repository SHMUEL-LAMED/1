// admin-users-model.js — ההיגיון הטהור של מסך המשתמשים, בלי DOM (נבדק ב-Node).
//
// 1. ייצוא CSV בטוח: תא שמתחיל ב-=, +, -, @ (או בטאב / מעבר שורה) נפתח בגרש,
//    כדי שאקסל או Google Sheets לא יריצו אותו כנוסחה. שם תצוגה מגיע מחשבון
//    Google של המשתמש — כלומר מכל אחד — ולכן אסור לסמוך עליו.
// 2. פעולה על כמה משתמשים: מי מהנבחרים ייכלל ולמה האחרים לא. אותם כללים
//    בדיוק כמו ב-Worker (applyUserBatchAction ו-assertSuperAdminRetained), כדי
//    שחלון האישור יאמר מראש מה יקרה. השרת בודק שוב בכל מקרה.

export const USER_ROLES = Object.freeze(['viewer', 'uploader', 'admin', 'super_admin']);
export const ROLE_LABELS = Object.freeze({
    viewer: 'דרגה 1 — צופה',
    uploader: 'דרגה 2 — מעלה',
    admin: 'דרגה 3 — מנהל',
    super_admin: 'דרגה 4 — מנהל־על'
});
export const STATUS_LABELS = Object.freeze({
    approved: 'פעיל',
    pending: 'ממתין',
    blocked: 'חסום',
    rejected: 'נדחה'
});
export const BULK_ACTIONS = Object.freeze(['approve', 'block', 'unblock', 'role']);
// כמו USERS_BATCH_MAX ב-Worker.
export const BULK_MAX_USERS = 100;

const SKIP_REASONS = Object.freeze({
    self_forbidden: 'החשבון שלך',
    last_super_admin: 'מנהל־העל האחרון',
    not_pending: 'אינו ממתין לאישור',
    already_blocked: 'כבר חסום',
    not_blocked: 'אינו חסום',
    not_approved: 'אינו משתמש מאושר',
    unchanged: 'כבר בדרגה הזו',
    not_found: 'לא נמצא'
});

export function skipReasonLabel(code) {
    return SKIP_REASONS[code] || 'לא בוצע';
}

// --- CSV ---

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    // גם אחרי רווחים מובילים: גיליון אלקטרוני מתעלם מהם ומריץ את הנוסחה.
    if (FORMULA_PREFIX.test(text) || FORMULA_PREFIX.test(text.trimStart())) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function csvText(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => row.map(csvCell).join(',')).join('\r\n');
}

function dateKey(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '';
    return new Date(time).toISOString().slice(0, 10);
}

// שם, דוא״ל, דרגה, סטטוס ומועד ההצטרפות — רק מה שמנהל־העל כבר רואה במסך.
export function userCsvRows(users) {
    const rows = [['שם', 'דוא״ל', 'דרגה', 'סטטוס', 'נוצר']];
    for (const user of Array.isArray(users) ? users : []) {
        const role = user?.status === 'blocked' ? (user.roleBeforeBlock || user.role) : user?.role;
        rows.push([
            user?.displayName || '',
            user?.email || '',
            ROLE_LABELS[role] || role || '',
            STATUS_LABELS[user?.status] || user?.status || '',
            dateKey(user?.requestedAt || user?.createdAt || user?.approvedAt)
        ]);
    }
    return rows;
}

// --- פעולה על כמה משתמשים ---

function isApprovedSuperAdmin(user) {
    return user?.status === 'approved' && user?.role === 'super_admin';
}

function actionProblem(user, action, role) {
    if (action === 'approve') return user.status === 'pending' ? '' : 'not_pending';
    if (action === 'block') return user.status === 'blocked' ? 'already_blocked' : '';
    if (action === 'unblock') return user.status === 'blocked' ? '' : 'not_blocked';
    if (user.status !== 'approved') return 'not_approved';
    return user.role === role ? 'unchanged' : '';
}

function removesSuperAdmin(user, action, role) {
    if (!isApprovedSuperAdmin(user)) return false;
    return action === 'block' || (action === 'role' && role !== 'super_admin');
}

// { eligible: [משתמש], skipped: [{ user, code, reason }] } — לפי סדר הבחירה.
// מנהלי־העל שיישארו נספרים יחד, כך שבחירה של כל מנהלי־העל להורדה משאירה
// בחוץ את האחרון שבהם, ולא את כולם.
export function planBulkAction(users, selectedUids, action, { role = '', currentUid = '' } = {}) {
    const byUid = new Map((Array.isArray(users) ? users : []).map(user => [String(user?.uid || ''), user]));
    const eligible = [];
    const skipped = [];
    let remainingSuperAdmins = [...byUid.values()].filter(isApprovedSuperAdmin).length;
    const seen = new Set();
    for (const rawUid of Array.isArray(selectedUids) ? selectedUids : []) {
        const uid = String(rawUid || '');
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        const user = byUid.get(uid);
        if (!user) {
            skipped.push({ user: { uid }, code: 'not_found', reason: skipReasonLabel('not_found') });
            continue;
        }
        let code = uid === currentUid ? 'self_forbidden' : actionProblem(user, action, role);
        if (!code && removesSuperAdmin(user, action, role)) {
            if (remainingSuperAdmins - 1 < 1) code = 'last_super_admin';
            else remainingSuperAdmins -= 1;
        }
        if (code) skipped.push({ user, code, reason: skipReasonLabel(code) });
        else eligible.push(user);
    }
    return { eligible, skipped };
}

export function bulkActionTitle(action, role = '') {
    if (action === 'approve') return `אישור משתמשים בתור ${ROLE_LABELS[role] || ROLE_LABELS.viewer}`;
    if (action === 'block') return 'חסימת משתמשים';
    if (action === 'unblock') return 'ביטול חסימה';
    return `שינוי דרגה ל${ROLE_LABELS[role] ? `־${ROLE_LABELS[role]}` : 'דרגה אחרת'}`;
}

function displayName(user) {
    return String(user?.displayName || user?.email || user?.uid || 'משתמש');
}

// טקסט חלון האישור: מי ייכלל (שמות), ומי לא ולמה. עד 25 שמות בכל רשימה.
export function bulkConfirmMessage(plan, action, role = '') {
    const listNames = list => {
        const names = list.slice(0, 25).map(entry => `• ${displayName(entry.user || entry)}`);
        if (list.length > 25) names.push(`ועוד ${list.length - 25}`);
        return names.join('\n');
    };
    const lines = [`${bulkActionTitle(action, role)} — ${plan.eligible.length} משתמשים:`, listNames(plan.eligible)];
    if (plan.skipped.length) {
        lines.push('', `לא ייכללו (${plan.skipped.length}):`);
        lines.push(plan.skipped.slice(0, 25).map(entry => `• ${displayName(entry.user)} — ${entry.reason}`).join('\n'));
        if (plan.skipped.length > 25) lines.push(`ועוד ${plan.skipped.length - 25}`);
    }
    return lines.join('\n');
}
