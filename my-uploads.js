// my-uploads.js — "ההעלאות שלי" בדף הגלריה: כל מה שהמשתמש המחובר העלה, עם
// המצב — ממתין לאישור, אושר (ולאיזו תיקייה) או נדחה (עם הסיבה, אם המנהל
// כתב) — והודעה בכניסה הבאה כשהעלאות שלו אושרו ("3 מההעלאות שלך אושרו").
//
// הנתונים מגיעים מ-GET /my-uploads, שמחזיר רק את ההעלאות של החשבון המאומת;
// אין פרמטר שמבקש משתמש אחר. המודול נטען עצלה (app.js): בלחיצה על הכפתור,
// או אחרי הכניסה של צופה מאושר, לבדיקת האישורים החדשים.
import {
    MY_UPLOAD_STATUSES, normalizeMyUploads, filterUploadsByStatus, myUploadsSummary,
    seenMarkerKey, approvalsBaseline, newlyApproved, nextSeenMarker, approvalsNotice
} from './users-model.js';

const el = id => document.getElementById(id);
let currentUploads = [];
let currentFilter = '';
// מתקדם בכל התנתקות או החלפת חשבון: תשובה שחוזרת אחר כך נזרקת, ואינה מוצגת
// למשתמש הבא.
let session = 0;
let checkedApprovalsFor = '';

function canUse() {
    return Boolean(window.state?.isGoogleUser && window.state?.userApprovalStatus === 'approved' && window.state?.currentUser?.uid);
}

function setStatus(text) {
    const node = el('myUploadsStatus');
    if (node) node.textContent = text;
}

function readMarker(uid) {
    try { return localStorage.getItem(seenMarkerKey(uid)); } catch { return null; }
}

function writeMarker(uid, value) {
    try { localStorage.setItem(seenMarkerKey(uid), String(value)); } catch { /* מצב פרטי — ההודעה פשוט תחזור */ }
}

async function fetchMyUploads() {
    const payload = await window.r2Request('/my-uploads');
    return normalizeMyUploads(payload, window.safeImageUrl);
}

function formatWhen(value) {
    return value ? (window.formatDate?.(value) || new Date(value).toLocaleDateString('he-IL')) : '';
}

function uploadRow(item) {
    const row = document.createElement('li');
    row.className = 'my-upload-row';
    row.dataset.status = item.status;
    const visual = document.createElement('span');
    visual.className = 'my-upload-thumb';
    visual.setAttribute('aria-hidden', 'true');
    if (item.thumbUrl) {
        const image = document.createElement('img');
        image.src = item.thumbUrl;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => image.remove(), { once: true });
        visual.append(image);
    } else {
        visual.innerHTML = `<i data-lucide="${item.mediaType === 'video' ? 'video' : 'image'}" class="w-4 h-4"></i>`;
    }
    const body = document.createElement('div');
    body.className = 'my-upload-body';
    const title = document.createElement('p');
    title.className = 'my-upload-title';
    title.textContent = item.title;
    const meta = document.createElement('p');
    meta.className = 'my-upload-meta';
    const chip = document.createElement('span');
    chip.className = 'my-upload-chip';
    chip.dataset.status = item.status;
    chip.textContent = MY_UPLOAD_STATUSES[item.status];
    meta.append(chip);
    const when = item.status === 'pending' ? item.uploadedAt : (item.decidedAt || item.uploadedAt);
    if (when) {
        const date = document.createElement('span');
        const verb = item.status === 'rejected' ? 'נדחה' : item.status === 'approved' && item.decidedAt ? 'אושר' : 'הועלה';
        date.textContent = `${verb} ${formatWhen(when)}`;
        meta.append(date);
    }
    body.append(title, meta);
    if (item.status === 'approved') {
        const where = document.createElement('p');
        where.className = 'my-upload-detail';
        if (item.folderName) where.append(`בתיקייה: ${item.folderName} · `);
        const link = document.createElement('a');
        link.href = `#media/${encodeURIComponent(item.id)}`;
        link.textContent = 'הצג בגלריה';
        link.setAttribute('aria-label', `הצגת ${item.title} בגלריה`);
        link.addEventListener('click', () => window.closeModal?.('myUploadsModal'));
        where.append(link);
        body.append(where);
    }
    if (item.status === 'rejected') {
        const reason = document.createElement('p');
        reason.className = 'my-upload-detail';
        reason.textContent = item.reason ? `הסיבה: ${item.reason}` : 'לא צוינה סיבה.';
        body.append(reason);
    }
    row.append(visual, body);
    return row;
}

function render() {
    const list = el('myUploadsList');
    if (!list) return;
    const visible = filterUploadsByStatus(currentUploads, currentFilter);
    list.replaceChildren(...visible.map(uploadRow));
    document.querySelectorAll('#myUploadsFilters [data-filter]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.filter === currentFilter));
    });
    if (!currentUploads.length) setStatus('עדיין לא העלית תמונות או סרטונים.');
    else if (!visible.length) setStatus('אין פריטים במצב הזה.');
    window.scheduleIconRefresh?.(list);
}

export async function openMyUploads() {
    if (!canUse()) {
        window.showNotification?.('ההעלאות שלי זמינות למשתמשים מחוברים ומאושרים.', false);
        return;
    }
    const current = session;
    currentFilter = '';
    window.openModal?.('myUploadsModal');
    const list = el('myUploadsList');
    list?.setAttribute('aria-busy', 'true');
    setStatus('טוען את ההעלאות שלך…');
    try {
        const result = await fetchMyUploads();
        if (current !== session) return;
        currentUploads = result.uploads;
        const summary = el('myUploadsSummary');
        if (summary) summary.textContent = myUploadsSummary(result.counts);
        const note = el('myUploadsRetention');
        if (note) note.textContent = `פריט שנדחה מוצג כאן ${result.retentionDays} יום. רק אתה רואה את הרשימה הזו.`;
        setStatus(`${currentUploads.length} פריטים.`);
        render();
        markApprovalsSeen(result.uploads);
    } catch (error) {
        console.warn('My uploads failed to load:', error);
        if (current !== session) return;
        setStatus(error?.status === 404
            ? 'הרשימה עדיין אינה זמינה בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : 'טעינת ההעלאות נכשלה. נסה שוב בעוד רגע.');
    } finally {
        list?.removeAttribute('aria-busy');
    }
}

export function filterMyUploads(status) {
    currentFilter = Object.hasOwn(MY_UPLOAD_STATUSES, status) ? status : '';
    render();
}

function markApprovalsSeen(uploads) {
    const uid = window.state?.currentUser?.uid;
    if (!uid) return;
    writeMarker(uid, nextSeenMarker(uploads, approvalsBaseline(readMarker(uid))));
}

// בכניסה של צופה מאושר (דרגה 1 — רק אצלו העלאה ממתינה לאישור): פעם אחת לכל
// חשבון בביקור, ובלי להפריע — כישלון אינו מוצג.
export async function checkUploadApprovals() {
    const uid = window.state?.currentUser?.uid;
    if (!canUse() || window.state?.userRole !== 'viewer' || checkedApprovalsFor === uid) return;
    checkedApprovalsFor = uid;
    const current = session;
    try {
        const { uploads } = await fetchMyUploads();
        if (current !== session || window.state?.currentUser?.uid !== uid) return;
        const fresh = newlyApproved(uploads, approvalsBaseline(readMarker(uid)));
        writeMarker(uid, nextSeenMarker(uploads, approvalsBaseline(readMarker(uid))));
        const notice = approvalsNotice(fresh.length);
        if (notice) window.showNotification?.(notice, true);
    } catch (error) {
        if (error?.status !== 404) console.warn('Upload approvals check failed:', error);
    }
}

// התנתקות או החלפת חשבון (session-auth.js): הרשימה והסטטוסים נמחקים מהדף.
export function resetMyUploads() {
    session += 1;
    checkedApprovalsFor = '';
    currentUploads = [];
    currentFilter = '';
    el('myUploadsList')?.replaceChildren();
    const summary = el('myUploadsSummary');
    if (summary) summary.textContent = '';
    setStatus('');
    const modal = el('myUploadsModal');
    if (modal && !modal.classList.contains('hidden')) window.closeModal?.('myUploadsModal');
}

window.openMyUploads = openMyUploads;
window.filterMyUploads = filterMyUploads;
window.checkUploadApprovals = checkUploadApprovals;
window.resetMyUploads = resetMyUploads;
