// manual-tags.js — תיוג ידני של אדם בתמונה, מהתצוגה המלאה (מנהלים בלבד).
//
// זיהוי הפנים מפספס לפעמים פנים — מהצד, בצל, מרחוק. כאן מנהל בוחר אדם מאושר
// עם שם (חיפוש לפי שם, כמו ברשימת האנשים) ומתייג אותו בתמונה: בתמונה כולה, או
// במלבן שגרר סביב הפנים. התיוג נשמר ב-Worker (POST /face/tags), מופיע באלבום
// של האדם וב"התמונות שלי" שלו, מסומן "תיוג ידני", ואפשר להסיר אותו מכאן.
//
// המודול נטען רק בלחיצה על "תיוג אדם" (app.js), ולכן אינו ב-APP_SHELL.
import { filterPeople } from './people-model.js';
import { boxFromDrag } from './users-model.js';
import { pickCardSource, pickPosterSource } from './media-variants.js';

const el = id => document.getElementById(id);
const MAX_RESULTS = 20;

let record = null;
let options = null;
let selectedPersonId = '';
let box = null;
let drag = null;
let busy = false;
let generation = 0;

function isAdmin() {
    return Boolean(window.state?.isAdminLoggedIn);
}

function setStatus(text) {
    const node = el('manualTagStatus');
    if (node) node.textContent = text;
}

function setBusy(value) {
    busy = value;
    for (const id of ['manualTagSave', 'manualTagSearch', 'manualTagClearBox']) {
        const node = el(id);
        if (node) node.disabled = value;
    }
    el('manualTagModal')?.querySelector('.modal-body')?.setAttribute('aria-busy', value ? 'true' : 'false');
}

async function loadOptions() {
    if (options) return options;
    const payload = await window.r2Request('/face/groups?view=options');
    options = (Array.isArray(payload?.options) ? payload.options : [])
        .filter(person => person?.status === 'approved' && String(person?.name || '').trim())
        .map(person => ({ personId: String(person.personId), name: String(person.name), hidden: person.hidden === true }));
    return options;
}

function renderPeople() {
    const list = el('manualTagPeople');
    if (!list || !options) return;
    const query = el('manualTagSearch')?.value || '';
    const visible = filterPeople(options, query).slice(0, MAX_RESULTS);
    list.replaceChildren(...visible.map(person => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'manual-tag-person';
        button.textContent = person.hidden ? `${person.name} (מוסתר)` : person.name;
        button.setAttribute('aria-pressed', String(person.personId === selectedPersonId));
        button.addEventListener('click', () => {
            selectedPersonId = person.personId;
            renderPeople();
            const save = el('manualTagSave');
            if (save) save.disabled = busy;
            setStatus(`נבחר: ${person.name}. ${box ? 'התיוג יישמר במלבן שסימנת.' : 'בלי מלבן — התיוג על כל התמונה.'}`);
        });
        item.append(button);
        return item;
    }));
    if (!options.length) setStatus('אין עדיין אנשים מאושרים עם שם. נותנים שמות במסך "אנשים בגלריה" שבלוח הניהול.');
    else if (!visible.length) setStatus('לא נמצא אדם בשם הזה.');
}

function renderTags(tags) {
    const list = el('manualTagExisting');
    if (!list) return;
    list.replaceChildren(...tags.map(tag => {
        const item = document.createElement('li');
        item.className = 'manual-tag-existing';
        const name = document.createElement('span');
        name.textContent = `${tag.name || 'אדם'}${tag.box ? ' · מלבן' : ' · כל התמונה'}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-danger-soft';
        remove.textContent = 'הסר';
        remove.setAttribute('aria-label', `הסרת התיוג של ${tag.name || 'אדם'}`);
        remove.addEventListener('click', () => mutate({ action: 'remove', personId: tag.personId }, `התיוג של ${tag.name || 'האדם'} הוסר.`));
        item.append(name, remove);
        return item;
    }));
    const heading = el('manualTagExistingTitle');
    if (heading) heading.hidden = tags.length === 0;
}

function drawBox() {
    const frame = el('manualTagBox');
    if (!frame) return;
    frame.hidden = !box;
    if (!box) return;
    Object.assign(frame.style, {
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`
    });
    const clear = el('manualTagClearBox');
    if (clear) clear.hidden = false;
}

function pointFrom(event, image) {
    const rect = image.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
}

function wireDrawing(image) {
    image.onpointerdown = event => {
        if (busy || !event.isPrimary) return;
        event.preventDefault();
        drag = pointFrom(event, image);
        image.setPointerCapture?.(event.pointerId);
    };
    image.onpointermove = event => {
        if (!drag) return;
        const point = pointFrom(event, image);
        box = boxFromDrag(drag, point, point.rect, image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0);
        drawBox();
    };
    image.onpointerup = image.onpointercancel = event => {
        if (!drag) return;
        const point = pointFrom(event, image);
        box = boxFromDrag(drag, point, point.rect, image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0);
        drag = null;
        drawBox();
        setStatus(box ? 'המלבן סומן. בחר אדם ולחץ "תייג".' : 'לא סומן מלבן — התיוג יהיה על כל התמונה.');
    };
}

async function refreshTags(current) {
    const payload = await window.r2Request(`/face/tags?imageId=${encodeURIComponent(record.id)}`);
    if (current !== generation) return;
    renderTags(Array.isArray(payload?.tags) ? payload.tags : []);
}

async function mutate(body, successText) {
    if (busy || !record || !isAdmin()) return;
    const current = generation;
    setBusy(true);
    try {
        const payload = await window.r2Request('/face/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageId: record.id, ...body })
        });
        if (current !== generation) return;
        renderTags(Array.isArray(payload?.tags) ? payload.tags : []);
        setStatus(successText);
        window.showNotification?.(successText, true);
    } catch (error) {
        if (current !== generation) return;
        setStatus(error?.status === 404 && error?.code !== 'image_not_found'
            ? 'התיוג הידני עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : `השמירה נכשלה: ${error?.message || 'שגיאה לא ידועה'}`);
    } finally {
        if (current === generation) setBusy(false);
    }
}

async function saveTag() {
    if (!selectedPersonId) { setStatus('בחר אדם מהרשימה.'); return; }
    const person = options?.find(item => item.personId === selectedPersonId);
    await mutate({ action: 'add', personId: selectedPersonId, ...(box ? { box } : {}) }, `${person?.name || 'האדם'} תויג בתמונה.`);
}

export async function openManualTagger() {
    if (!isAdmin()) { window.showNotification?.('תיוג אנשים זמין למנהלים בלבד.', false); return; }
    const current = window.currentLightboxRecord?.();
    const id = window.safeRecordId?.(current?.id);
    if (!current || !id) return;
    generation += 1;
    const mine = generation;
    record = { ...current, id };
    selectedPersonId = '';
    box = null;
    drag = null;
    const image = el('manualTagImage');
    const isVideo = window.isVideoRecord?.(current);
    if (image) {
        const source = isVideo ? pickPosterSource(current, window.safeImageUrl) : pickCardSource(current, window.safeImageUrl).url;
        image.src = source || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        image.alt = `התמונה לתיוג: ${current.title || 'ללא שם'}`;
        // בסרטון אין מלבן: הפוסטר אינו בהכרח הרגע שבו האדם מופיע.
        if (isVideo) { image.onpointerdown = image.onpointermove = image.onpointerup = image.onpointercancel = null; }
        else wireDrawing(image);
    }
    const hint = el('manualTagHint');
    if (hint) hint.textContent = isVideo
        ? 'בסרטון התיוג הוא על הפריט כולו.'
        : 'אפשר לגרור על התמונה כדי לסמן את הפנים (רשות). בלי סימון — התיוג על כל התמונה.';
    const clear = el('manualTagClearBox');
    if (clear) clear.hidden = true;
    drawBox();
    const search = el('manualTagSearch');
    if (search) search.value = '';
    el('manualTagPeople')?.replaceChildren();
    renderTags([]);
    setStatus('טוען את רשימת האנשים…');
    window.openModal?.('manualTagModal');
    setBusy(true);
    try {
        await Promise.all([loadOptions(), refreshTags(mine)]);
        if (mine !== generation) return;
        setStatus('');
        renderPeople();
    } catch (error) {
        if (mine !== generation) return;
        setStatus(error?.status === 404
            ? 'התיוג הידני עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : 'טעינת הנתונים נכשלה. נסה שוב בעוד רגע.');
    } finally {
        if (mine === generation) setBusy(false);
    }
    search?.focus({ preventScroll: true });
}

// התנתקות או אובדן הרשאת ניהול (session-auth.js): החלון נסגר והרשימות נשכחות.
export function resetManualTagger() {
    generation += 1;
    record = null;
    options = null;
    selectedPersonId = '';
    box = null;
    el('manualTagPeople')?.replaceChildren();
    el('manualTagExisting')?.replaceChildren();
    const modal = el('manualTagModal');
    if (modal && !modal.classList.contains('hidden')) window.closeModal?.('manualTagModal');
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    el('manualTagSearch')?.addEventListener('input', () => renderPeople());
    el('manualTagSave')?.addEventListener('click', () => saveTag());
    el('manualTagClearBox')?.addEventListener('click', () => {
        box = null;
        drawBox();
        const clear = el('manualTagClearBox');
        if (clear) clear.hidden = true;
        setStatus('הסימון נוקה — התיוג יהיה על כל התמונה.');
    });
}
wire();

window.openManualTagger = openManualTagger;
window.resetManualTagger = resetManualTagger;
