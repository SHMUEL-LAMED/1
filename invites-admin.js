// invites-admin.js — "הזמנה לאירוע" במסך תיקיות ואירועים של לוח הניהול.
//
// מנהל יוצר קישור זמני לתיקייה (יום, שבוע או חודש, ואפשר גם תקרת שימושים).
// הקישור — עם האסימון שבו — מוצג פעם אחת בלבד, מיד אחרי היצירה: בשרת נשמר
// רק גיבוב שלו, ואין דרך לקבל אותו שוב (רק לבטל וליצור חדש). "אישור אוטומטי"
// זמין למנהל־על בלבד; בלעדיו מי שמגיע מהקישור ממתין לאישור, מסומן "הגיע
// מהזמנה לאירוע X" ברשימת בקשות ההצטרפות. נטען עצלה בפתיחת המסך (admin-ui.js).
import {
    INVITE_DAY_LABELS, INVITE_STATUS_LABELS, normalizeInvite, inviteUrl, inviteUsageLabel, inviteExpiryLabel
} from './users-model.js';

const el = id => document.getElementById(id);
let busy = false;

function setStatus(text) {
    const node = el('invitesStatus');
    if (node) node.textContent = text;
}

function fillFolders() {
    const select = el('inviteFolder');
    if (!select) return;
    const previous = select.value;
    const folders = (window.state?.folders || []).filter(folder => window.safeRecordId(folder?.id) && folder.id !== 'all');
    select.replaceChildren(...folders.map(folder => {
        const option = document.createElement('option');
        option.value = window.safeRecordId(folder.id);
        option.textContent = String(folder.name || 'תיקייה');
        return option;
    }));
    if (previous && folders.some(folder => window.safeRecordId(folder.id) === previous)) select.value = previous;
}

function inviteRow(invite) {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const body = document.createElement('div');
    body.className = 'flex-1 min-w-0';
    const title = document.createElement('p');
    title.className = 'admin-row-title truncate';
    title.textContent = invite.folderName;
    const meta = document.createElement('p');
    meta.className = 'admin-row-meta';
    meta.textContent = [
        INVITE_STATUS_LABELS[invite.status],
        invite.status === 'active' ? inviteExpiryLabel(invite) : '',
        inviteUsageLabel(invite),
        invite.autoApprove ? 'אישור אוטומטי' : 'ממתין לאישור מנהל'
    ].filter(Boolean).join(' · ');
    body.append(title, meta);
    row.append(body);
    const canRevoke = invite.status === 'active' && (invite.mine || window.state?.isSuperAdmin);
    if (canRevoke) {
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'btn-danger-soft px-3 py-1.5 text-[11px]';
        revoke.textContent = 'בטל קישור';
        revoke.setAttribute('aria-label', `ביטול קישור ההזמנה לאירוע ${invite.folderName}`);
        revoke.addEventListener('click', () => revokeInvite(invite));
        row.append(revoke);
    }
    return row;
}

export async function loadInvites() {
    fillFolders();
    const list = el('invitesList');
    setStatus('טוען את הקישורים…');
    try {
        const payload = await window.r2Request('/invites');
        const invites = (Array.isArray(payload?.invites) ? payload.invites : []).map(normalizeInvite).filter(Boolean);
        const autoRow = el('inviteAutoApproveRow');
        if (autoRow) autoRow.hidden = payload?.canAutoApprove !== true;
        if (payload?.canAutoApprove !== true) {
            const checkbox = el('inviteAutoApprove');
            if (checkbox) checkbox.checked = false;
        }
        list?.replaceChildren(...invites.map(inviteRow));
        setStatus(invites.length ? `${invites.filter(invite => invite.status === 'active').length} קישורים פעילים.` : 'עדיין לא נוצרו קישורי הזמנה.');
    } catch (error) {
        list?.replaceChildren();
        setStatus(error?.status === 404
            ? 'קישורי הזמנה עדיין אינם זמינים בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : 'טעינת הקישורים נכשלה. נסה שוב בעוד רגע.');
    }
}

export async function createInviteLink(event) {
    event?.preventDefault();
    if (busy || !window.checkAdminPermission()) return;
    const folderId = el('inviteFolder')?.value || '';
    const days = Number(el('inviteDays')?.value || 7);
    const usesText = String(el('inviteMaxUses')?.value || '').trim();
    const maxUses = usesText ? Number(usesText) : 0;
    if (!folderId) { setStatus('בחר תיקייה.'); return; }
    if (usesText && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)) {
        setStatus('מספר השימושים חייב להיות בין 1 ל־1000, או ריק — ללא הגבלה.');
        return;
    }
    const autoApprove = Boolean(window.state?.isSuperAdmin && el('inviteAutoApprove')?.checked);
    busy = true;
    const submit = el('inviteSubmit');
    if (submit) submit.disabled = true;
    try {
        const payload = await window.r2Request('/invites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId, days, maxUses, autoApprove })
        });
        const url = inviteUrl(window.location.href, payload?.token);
        const box = el('inviteCreated');
        const field = el('inviteCreatedUrl');
        if (field) field.value = url;
        if (box) box.hidden = !url;
        const invite = normalizeInvite(payload?.invite);
        const summary = el('inviteCreatedSummary');
        if (summary && invite) {
            summary.textContent = `לאירוע ${invite.folderName}, בתוקף ${INVITE_DAY_LABELS[days] || ''}${invite.maxUses ? `, עד ${invite.maxUses} שימושים` : ''}${invite.autoApprove ? ', עם אישור אוטומטי' : ''}.`;
        }
        field?.focus({ preventScroll: true });
        field?.select();
        window.logActivity?.('invite_created', 'folder', folderId, invite?.folderName || '', `${INVITE_DAY_LABELS[days] || ''}${invite?.autoApprove ? ' · אישור אוטומטי' : ''}`);
        await loadInvites();
        setStatus('הקישור נוצר. הוא מוצג רק עכשיו — העתק אותו לפני שתעזוב את המסך.');
    } catch (error) {
        setStatus(error?.message || 'יצירת הקישור נכשלה.');
    } finally {
        busy = false;
        if (submit) submit.disabled = false;
    }
}

export async function copyInviteLink() {
    const field = el('inviteCreatedUrl');
    if (!field?.value) return;
    try {
        await navigator.clipboard.writeText(field.value);
        window.showNotification?.('הקישור הועתק.', true);
    } catch {
        field.select();
        window.showNotification?.('לא ניתן להעתיק אוטומטית. הקישור מסומן — העתק אותו ידנית.', false);
    }
}

function revokeInvite(invite) {
    window.showConfirm('ביטול קישור הזמנה', `לבטל את קישור ההזמנה לאירוע ${invite.folderName}? מי שעוד לא השתמש בו לא יוכל להצטרף דרכו.`, async () => {
        try {
            await window.r2Request('/invites/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inviteId: invite.inviteId })
            });
            window.showNotification?.('הקישור בוטל.', true);
            await loadInvites();
        } catch (error) {
            window.showNotification?.(error?.message || 'ביטול הקישור נכשל.', false);
        }
    });
}

window.loadInvites = loadInvites;
window.createInviteLink = createInviteLink;
window.copyInviteLink = copyInviteLink;
