// admin-users-bulk.js — במסך "משתמשים והרשאות": בחירה של כמה משתמשים ופעולה
// אחת עליהם (אישור, חסימה, ביטול חסימה, שינוי דרגה), והערות פנימיות על משתמש.
// נטען עצלה בפתיחת המסך (ensureUsersBulkModule ב-admin-ui.js); מנהל־על בלבד.
//
// הפעולה עוברת ב-POST /admin/users/batch, שבודק שוב כל משתמש בנפרד: לעולם לא
// החשבון שלך ולעולם לא מנהל־העל המאושר האחרון. חלון האישור מציג מראש את השמות
// ואת מי שלא ייכלל ולמה (planBulkAction), ואחרי הפעולה מוצג דוח לכל משתמש.
// ההערות נשמרות בשרת בנפרד מהפרופיל (/admin/user-notes) ואינן מגיעות למשתמש.

import {
    planBulkAction, bulkConfirmMessage, bulkActionTitle, skipReasonLabel, BULK_MAX_USERS, BULK_ACTIONS
} from './admin-users-model.js';

const selectedUids = new Set();
let notesTargetUid = '';
let notesRequest = 0;

function allUsers() {
    return window.state?.allUsers || [];
}

function currentUid() {
    return String(window.state?.currentUser?.uid || '');
}

function userName(user) {
    return String(user?.displayName || user?.email || user?.uid || 'משתמש');
}

function findUser(uid) {
    return allUsers().find(user => user.uid === uid) || (window.state?.pendingUsers || []).find(user => user.uid === uid) || null;
}

// --- בחירה ---

function updateBulkBar() {
    // משתמש שכבר אינו ברשימה (נמחק, או רענון מהשרת) יוצא מהבחירה.
    for (const uid of [...selectedUids]) if (!findUser(uid)) selectedUids.delete(uid);
    const count = document.getElementById('usersBulkCount');
    if (count) count.textContent = selectedUids.size ? `נבחרו ${selectedUids.size} משתמשים` : 'לא נבחרו משתמשים';
    document.querySelectorAll('[data-users-bulk-action]').forEach(button => { button.disabled = selectedUids.size === 0; });
}

function selectionBox(uid, name) {
    const label = document.createElement('label');
    label.className = 'user-bulk-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'user-bulk-checkbox';
    box.dataset.bulkUid = uid;
    box.checked = selectedUids.has(uid);
    box.disabled = uid === currentUid();
    box.setAttribute('aria-label', uid === currentUid() ? `${name} (החשבון שלך — אינו נכלל בפעולה מרובה)` : `בחירת ${name}`);
    box.addEventListener('change', () => {
        if (box.checked) selectedUids.add(uid);
        else selectedUids.delete(uid);
        updateBulkBar();
    });
    label.appendChild(box);
    return label;
}

function notesButton(uid, name) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary-dark px-2.5 py-1.5 text-[11px] user-notes-button';
    button.textContent = 'הערות';
    button.setAttribute('aria-label', `הערות פנימיות על ${name}`);
    button.addEventListener('click', () => openUserNotes(uid));
    return button;
}

// נקרא אחרי כל ציור של רשימות המשתמשים (admin.js): תיבת בחירה וכפתור הערות
// בכל כרטיס שיש לו data-uid. ציור חוזר בונה כרטיסים חדשים, ולכן אין כפילות.
export function decorateUserCards(list) {
    if (!list || !window.canViewSuperAdminData?.()) return;
    list.querySelectorAll(':scope > [data-uid]').forEach(card => {
        if (card.querySelector('.user-bulk-check')) return;
        const uid = card.dataset.uid;
        const name = userName(findUser(uid));
        const header = card.firstElementChild || card;
        header.insertBefore(selectionBox(uid, name), header.firstChild);
        if (uid !== currentUid()) header.appendChild(notesButton(uid, name));
    });
    updateBulkBar();
}

export function selectVisibleUsers() {
    for (const id of ['pendingUsersList', 'managedUsersList']) {
        document.querySelectorAll(`#${id} > [data-uid]`).forEach(card => {
            if (card.classList.contains('hidden') || card.dataset.uid === currentUid()) return;
            if (selectedUids.size >= BULK_MAX_USERS) return;
            selectedUids.add(card.dataset.uid);
            const box = card.querySelector('.user-bulk-checkbox');
            if (box) box.checked = true;
        });
    }
    updateBulkBar();
}

export function clearUserSelection() {
    selectedUids.clear();
    document.querySelectorAll('.user-bulk-checkbox').forEach(box => { box.checked = false; });
    updateBulkBar();
}

// --- הפעולה ---

function renderBulkResult(rows) {
    const region = document.getElementById('usersBulkResult');
    if (!region) return;
    region.replaceChildren();
    for (const row of rows) {
        const item = document.createElement('p');
        item.className = `admin-row-meta ${row.ok ? 'is-success' : 'is-failure'}`;
        item.textContent = row.text;
        region.appendChild(item);
    }
}

async function sendBulkAction(action, role, plan) {
    const uids = plan.eligible.map(user => user.uid);
    let response;
    try {
        response = await window.r2Request('/admin/users/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, role, uids })
        });
    } catch (error) {
        window.showNotification(error?.status === 404 ? 'השרת עדיין לא עודכן לפעולה מרובה.' : (error?.message || 'הפעולה נכשלה.'), false);
        return;
    }
    const results = Array.isArray(response?.results) ? response.results : [];
    const succeeded = results.filter(result => result.ok);
    const failed = results.filter(result => !result.ok);
    const rows = [{ ok: !failed.length, text: `${bulkActionTitle(action, role)}: ${succeeded.length} הצליחו, ${failed.length + plan.skipped.length} לא בוצעו.` }];
    for (const result of failed) {
        rows.push({ ok: false, text: `${userName(findUser(result.uid) || { uid: result.uid })} — ${result.message || skipReasonLabel(result.code)}` });
    }
    for (const entry of plan.skipped) rows.push({ ok: false, text: `${userName(entry.user)} — ${entry.reason}` });
    renderBulkResult(rows);
    window.showNotification(rows[0].text, !failed.length);
    selectedUids.clear();
    await window.forceRefreshUsers?.();
    updateBulkBar();
}

export function runUsersBulkAction(action) {
    if (!window.checkSuperAdminPermission?.()) return;
    if (!BULK_ACTIONS.includes(action)) return;
    const role = String(document.getElementById('usersBulkRole')?.value || 'viewer');
    const plan = planBulkAction(allUsers(), [...selectedUids], action, { role, currentUid: currentUid() });
    if (!plan.eligible.length) {
        renderBulkResult(plan.skipped.map(entry => ({ ok: false, text: `${userName(entry.user)} — ${entry.reason}` })));
        window.showNotification('אף אחד מהמשתמשים שנבחרו אינו מתאים לפעולה הזו.', false);
        return;
    }
    if (plan.eligible.length > BULK_MAX_USERS) {
        window.showNotification(`אפשר לטפל בעד ${BULK_MAX_USERS} משתמשים בפעולה אחת.`, false);
        return;
    }
    window.showConfirm(bulkActionTitle(action, role), bulkConfirmMessage(plan, action, role), () => sendBulkAction(action, role, plan));
}

// --- הערות פנימיות ---

function notesStatus(text) {
    const status = document.getElementById('userNotesStatus');
    if (status) status.textContent = text;
}

function formatNoteDate(time) {
    return typeof window.formatDate === 'function' ? window.formatDate(time) : new Date(time).toLocaleString('he-IL');
}

function renderNotes(notes) {
    const list = document.getElementById('userNotesList');
    if (!list) return;
    list.replaceChildren();
    if (!notes.length) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'אין עדיין הערות על המשתמש הזה.';
        list.appendChild(empty);
        return;
    }
    for (const note of notes) {
        const row = document.createElement('article');
        row.className = 'admin-row flex-col items-stretch gap-1 user-note';
        const body = document.createElement('p');
        body.className = 'user-note-body';
        body.textContent = note.body;
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        meta.textContent = `${note.authorName || 'מנהל'} · ${formatNoteDate(note.createdAt)}`;
        row.append(body, meta);
        if (note.canDelete) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-danger-soft px-2.5 py-1 text-[11px] user-note-delete';
            remove.textContent = 'מחיקת ההערה';
            remove.addEventListener('click', () => deleteUserNote(note.id));
            row.appendChild(remove);
        }
        list.appendChild(row);
    }
}

async function loadNotes(uid) {
    const request = ++notesRequest;
    notesStatus('טוען הערות…');
    try {
        const response = await window.r2Request(`/admin/user-notes?uid=${encodeURIComponent(uid)}`, { method: 'GET' });
        if (request !== notesRequest || uid !== notesTargetUid) return;
        renderNotes(Array.isArray(response?.notes) ? response.notes : []);
        notesStatus('');
    } catch (error) {
        if (request !== notesRequest) return;
        renderNotes([]);
        notesStatus(error?.status === 404 ? 'השרת עדיין לא עודכן להערות.' : (error?.message || 'טעינת ההערות נכשלה.'));
    }
}

export function openUserNotes(uid) {
    if (!window.checkSuperAdminPermission?.()) return;
    const user = findUser(uid);
    if (!user || uid === currentUid()) return;
    notesTargetUid = uid;
    const title = document.getElementById('userNotesTitle');
    if (title) title.textContent = `הערות פנימיות: ${userName(user)}`;
    const input = document.getElementById('userNoteInput');
    if (input) input.value = '';
    renderNotes([]);
    window.openModal?.('userNotesModal');
    loadNotes(uid);
}

export function closeUserNotes() {
    notesTargetUid = '';
    notesRequest += 1;
    window.closeModal?.('userNotesModal');
}

export async function addUserNote() {
    const input = document.getElementById('userNoteInput');
    const body = String(input?.value || '').trim();
    if (!notesTargetUid) return;
    if (!body) {
        notesStatus('כתוב הערה לפני השמירה.');
        input?.focus();
        return;
    }
    const uid = notesTargetUid;
    notesStatus('שומר…');
    try {
        await window.r2Request('/admin/user-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, body })
        });
        if (input) input.value = '';
        await loadNotes(uid);
        notesStatus('ההערה נשמרה.');
    } catch (error) {
        notesStatus(error?.message || 'שמירת ההערה נכשלה.');
    }
}

export async function deleteUserNote(noteId) {
    const uid = notesTargetUid;
    if (!uid) return;
    try {
        await window.r2Request(`/admin/user-notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
        await loadNotes(uid);
        notesStatus('ההערה נמחקה.');
    } catch (error) {
        notesStatus(error?.message || 'מחיקת ההערה נכשלה.');
    }
}

// מעבר חשבון או התנתקות: הבחירה וחלון ההערות אינם עוברים לחשבון אחר.
export function resetUsersBulk() {
    selectedUids.clear();
    if (notesTargetUid) closeUserNotes();
    renderBulkResult([]);
    updateBulkBar();
}

window.decorateUserCards = decorateUserCards;
window.resetUsersBulk = resetUsersBulk;
