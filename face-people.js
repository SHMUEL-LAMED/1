// face-people.js — מסך "פרצופים ואינדוקס" בלוח הניהול: אנשים בגלריה.
//
// שני חלקים, שניהם למנהלים בלבד, והטביעות עצמן אינן מגיעות לדפדפן:
//   openPeopleManager — הקבוצות שהקיבוץ האוטומטי הציע, תור "לבדיקה", הפרצופים
//     הבודדים, האנשים המאושרים והמוסתרים. כאן המנהל מאשר ונותן שם, משנה שם,
//     ממזג קבוצות, מעביר או מסיר פרצוף, פותח קבוצה לפרצוף בודד, בוחר תמונה
//     ראשית ומסתיר אדם.
//   openFacePeople — הרשת הישנה של כל הפרצופים, לאיחוד ידני של "זה אותו אדם".
// פרצוף שאונדקס לפני שנשמר לו מיקום מקבל אותו כאן: הדפדפן מאתר שוב את
// הפרצופים בתמונה שאונדקסה ושולח את המיקום בלבד (POST /face/boxes).
import { boxFromDetection, faceCountLabel, faceCropStyle, imageCountLabel } from './people-model.js';

let offset = 0;
let person = '';
let busy = false;
let generation = 0;
const selected = new Map();
const key = face => `${face.imageId}:${face.faceIndex}`;
const el = id => document.getElementById(id);
function button(text, action, disabled = false) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'btn-secondary-dark';
    node.textContent = text;
    node.disabled = disabled;
    node.onclick = action;
    return node;
}

// --- מיקום הפרצופים: נשלח בקבוצות קטנות, בלי לעכב את המסך ---
const pendingBoxes = new Map();
let boxFlushTimer = null;
function queueFaceBox(face, box) {
    if (!box || !Number.isSafeInteger(face?.updatedAt)) return;
    pendingBoxes.set(key(face), { imageId: face.imageId, faceIndex: face.faceIndex, updatedAt: face.updatedAt, box });
    clearTimeout(boxFlushTimer);
    boxFlushTimer = setTimeout(flushFaceBoxes, 800);
}
async function flushFaceBoxes() {
    const entries = [...pendingBoxes.values()];
    pendingBoxes.clear();
    for (let index = 0; index < entries.length; index += 50) {
        try {
            await window.r2Request('/face/boxes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boxes: entries.slice(index, index + 50) })
            });
        } catch (error) {
            // מיקום חסר אינו תקלה: התצוגה פשוט מציגה את התמונה כולה.
            console.warn('Face boxes were not saved:', error);
        }
    }
}

function toolbar() {
    el('facePeopleToolbar').replaceChildren(
        button(`זה אותו אדם — איחוד (${selected.size})`, () => mutate('merge'), busy || selected.size < 2),
        button('נקה בחירה', () => { selected.clear(); openFacePeople(); }, busy || !selected.size),
        button('כל הפרצופים / רענון', () => { person = ''; offset = 0; openFacePeople(); }, busy)
    );
}
async function mutate(action, face) {
    if (busy) return;
    const faces = face ? [face] : [...selected.values()];
    if (!window.confirm(action === 'merge'
        ? `לאחד את ${faces.length} הפרצופים ואת כל הקבוצות המשויכות אליהם לאותו אדם?`
        : 'להפריד את הפרצוף הזה מקבוצת האדם?')) return;
    busy = true;
    ++generation;
    toolbar();
    try {
        await window.r2Request('/face/people', { method: 'POST', body: JSON.stringify({ action, faces }) });
        selected.clear();
        person = '';
        offset = 0;
        busy = false;
        await openFacePeople();
        el('facePeopleStatus').textContent = action === 'merge' ? 'הפרצופים אוחדו. החיפוש ישתמש בקישור החדש.' : 'הפרצוף הופרד מהקבוצה.';
        refreshManagerSilently();
    } catch (error) {
        el('facePeopleStatus').textContent = error.message || 'השמירה נכשלה. הבחירה נשמרה כדי שתוכל לנסות שוב.';
    } finally { busy = false; toolbar(); }
}

export async function openFacePeople() {
    if (busy || !window.state?.isAdminLoggedIn || !el('facePeopleGrid')) return;
    busy = true;
    const current = ++generation;
    toolbar();
    el('facePeopleStatus').textContent = 'טוען פרצופים…';
    el('facePeopleGrid').replaceChildren();
    el('facePeoplePages').replaceChildren();
    try {
        const data = await window.r2Request(`/face/people?offset=${offset}&person=${encodeURIComponent(person)}`);
        const jobs = new Map();
        for (const face of data.faces) {
            const card = document.createElement('article');
            card.className = 'face-person-card';
            const label = document.createElement('label');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = selected.has(key(face));
            // Prevent selecting a face until its crop is verified and visible.
            check.disabled = true;
            check.onchange = () => {
                if (check.checked && selected.size >= 24) {
                    check.checked = false;
                    el('facePeopleStatus').textContent = 'אפשר לבחור עד 24 פרצופים בכל איחוד.';
                    return;
                }
                if (check.checked) selected.set(key(face), face); else selected.delete(key(face));
                toolbar();
            };
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 160;
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', `פרצוף ${face.faceIndex + 1} בתמונה`);
            const caption = document.createElement('span');
            caption.textContent = 'מכין תצוגת פרצוף…';
            label.append(check, canvas, caption);
            card.append(label);
            if (face.personId) {
                card.append(button(`קבוצה ${face.personId.slice(0, 8)}`, () => {
                    if (busy) return;
                    person = face.personId; offset = 0; openFacePeople();
                }), button('הפרד מהאדם', () => mutate('detach', face)));
            }
            el('facePeopleGrid').append(card);
            if (!jobs.has(face.imageId)) jobs.set(face.imageId, []);
            jobs.get(face.imageId).push({ face, canvas, caption, check });
        }
        el('facePeoplePages').replaceChildren(
            button('הקודם', () => { offset = Math.max(0, offset - 24); openFacePeople(); }, offset === 0),
            document.createTextNode(` עמוד ${Math.floor(offset / 24) + 1} `),
            button('הבא', () => { offset += 24; openFacePeople(); }, !data.hasMore)
        );
        el('facePeopleStatus').textContent = data.faces.length
            ? 'טוען תצוגות פנים מהתמונות. בטעינה הראשונה התהליך עשוי לקחת זמן.'
            : 'אין פרצופים להצגה. אם טרם בוצע אינדוקס, הפעל אותו בהמשך המסך.';
        busy = false;
        toolbar();
        if (!data.faces.length) return;
        await window.ensureFaceIndexModule();
        const engine = await window.ensureFaceEngine();
        const queue = [...jobs.entries()];
        // Two photos at a time; only the current page is downloaded and processed.
        await Promise.all([0, 1].map(async () => {
            while (queue.length && current === generation) {
                const [imageId, items] = queue.shift();
                try {
                    const record = window.state.images.find(image => String(image.id) === imageId);
                    const url = window.safeImageUrl(record?.url);
                    if (!url) throw new Error('missing image');
                    const image = await window.loadFaceImageElement(url);
                    const detections = await engine.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();
                    if (current !== generation) return;
                    for (const { face, canvas, caption, check } of items) {
                        const box = detections[face.faceIndex]?.detection.box;
                        if (!box) { caption.textContent = 'לא ניתן להציג פרצוף זה. נסה לרענן.'; continue; }
                        // אותו זיהוי משמש גם להשלמת המיקום השמור של הפרצוף.
                        queueFaceBox(face, boxFromDetection(box, image.naturalWidth, image.naturalHeight));
                        const pad = Math.max(box.width, box.height) * 0.2;
                        const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
                        canvas.getContext('2d').drawImage(image, x, y,
                            Math.min(image.naturalWidth - x, box.width + pad * 2),
                            Math.min(image.naturalHeight - y, box.height + pad * 2), 0, 0, 160, 160);
                        caption.textContent = `פרצוף ${face.faceIndex + 1} · ${face.personId ? 'משויך לאדם' : 'ללא קבוצה'}`;
                        check.disabled = false;
                    }
                } catch {
                    for (const item of items) item.caption.textContent = 'התצוגה לא נטענה. לחץ על רענון כדי לנסות שוב.';
                }
            }
        }));
        if (current === generation) el('facePeopleStatus').textContent = 'בחר פרצופים ולאחר מכן לחץ על ״זה אותו אדם״.';
    } catch (error) {
        el('facePeopleStatus').textContent = error.message || 'טעינת הפרצופים נכשלה. נסה לרענן.';
    } finally { if (current === generation) { busy = false; toolbar(); } }
}

// ==========================================================================
// אנשים בגלריה: הצעות, לבדיקה, מאושרים ומוסתרים
// ==========================================================================

const VIEW_LABELS = {
    suggested: 'הצעות',
    review: 'לבדיקה',
    singles: 'בודדים',
    approved: 'אנשים מאושרים',
    hidden: 'מוסתרים'
};
const CLUSTER_MAX_ROUNDS = 40;

const manager = {
    view: 'suggested',
    offset: 0,
    personId: '',
    busy: false,
    clustering: false,
    generation: 0,
    options: [],
    counts: null,
    lastRunMessage: '',
    bound: false
};

function managerStatus(text) {
    const node = el('peopleAdminStatus');
    if (node) node.textContent = text;
}

function clusterStatus(text) {
    const node = el('peopleClusterStatus');
    if (node) node.textContent = text;
}

function personLabel(person) {
    if (person?.name) return person.name;
    return `קבוצה ללא שם (${faceCountLabel(person?.faceCount || 0)})`;
}

async function groupsRequest(query) {
    return window.r2Request(`/face/groups?${query}`);
}

async function groupsMutation(body) {
    return window.r2Request('/face/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function createFaceCrop(face, label = '') {
    const frame = document.createElement('span');
    frame.className = 'face-crop';
    const url = window.safeImageUrl?.(face?.url) || '';
    if (!url) {
        frame.classList.add('is-empty');
        return frame;
    }
    const image = document.createElement('img');
    image.alt = label;
    image.loading = 'lazy';
    image.decoding = 'async';
    const style = faceCropStyle(face.box);
    if (style) {
        image.classList.add('is-cropped');
        Object.assign(image.style, style);
    }
    image.src = url;
    frame.append(image);
    return frame;
}

function actionButton(text, handler, { tone = 'secondary', disabled = false, label = '' } = {}) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = tone === 'primary' ? 'btn-primary-gold' : tone === 'danger' ? 'btn-danger-soft' : 'btn-secondary-dark';
    node.textContent = text;
    node.disabled = disabled || manager.busy;
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', handler);
    return node;
}

// בחירת קבוצה (למיזוג או להעברה) מתוך הרשימה הקצרה שהשרת מחזיר.
function personSelect(id, label, { excludeId = '', allowNew = false } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'people-admin-select';
    const caption = document.createElement('label');
    caption.className = 'sr-only';
    caption.htmlFor = id;
    caption.textContent = label;
    const select = document.createElement('select');
    select.id = id;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = label;
    select.append(placeholder);
    if (allowNew) {
        const fresh = document.createElement('option');
        fresh.value = '__new__';
        fresh.textContent = 'קבוצה חדשה';
        select.append(fresh);
    }
    for (const option of manager.options) {
        if (option.personId === excludeId) continue;
        const node = document.createElement('option');
        node.value = option.personId;
        node.textContent = `${personLabel(option)}${option.hidden ? ' · מוסתר' : ''}`;
        select.append(node);
    }
    wrap.append(caption, select);
    return { wrap, select };
}

async function runMutation(body, successText) {
    if (manager.busy) return false;
    manager.busy = true;
    managerStatus('שומר…');
    try {
        await groupsMutation(body);
        manager.busy = false;
        await loadManagerView();
        managerStatus(successText);
        return true;
    } catch (error) {
        manager.busy = false;
        managerStatus(error?.status === 409
            ? 'הנתונים השתנו בינתיים. הרשימה רועננה — נסה שוב.'
            : (error?.message || 'השמירה נכשלה. נסה שוב.'));
        if (error?.status === 409) await loadManagerView({ keepStatus: true });
        return false;
    }
}

function renderCounts(counts = {}) {
    for (const node of document.querySelectorAll('[data-people-count]')) {
        node.textContent = String(Number(counts[node.dataset.peopleCount]) || 0);
    }
    for (const tab of document.querySelectorAll('[data-people-view]')) {
        const active = manager.personId === '' && tab.dataset.peopleView === manager.view;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function nameForm(personEntry) {
    const form = document.createElement('form');
    form.className = 'people-admin-name';
    const id = `peopleName-${personEntry.personId}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = 'שם';
    const input = document.createElement('input');
    input.id = id;
    input.type = 'text';
    input.maxLength = 60;
    input.required = true;
    input.autocomplete = 'off';
    input.value = personEntry.name || '';
    input.placeholder = 'למשל: ר׳ משה כהן';
    const approved = personEntry.status === 'approved';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = approved ? 'btn-secondary-dark' : 'btn-primary-gold';
    submit.textContent = approved ? 'שמור שם' : 'אשר ושמור שם';
    submit.disabled = manager.busy;
    form.append(label, input, submit);
    form.addEventListener('submit', event => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) {
            managerStatus('יש להזין שם לפני האישור.');
            input.focus();
            return;
        }
        runMutation(
            { action: approved ? 'rename' : 'approve', personId: personEntry.personId, name },
            approved ? `השם עודכן ל„${name}”.` : `„${name}” אושר ונוסף לרשימת האנשים בגלריה.`
        );
    });
    return form;
}

function renderPersonCard(personEntry, { detail = false } = {}) {
    const card = document.createElement('article');
    card.className = 'people-admin-card';
    card.setAttribute('aria-label', personLabel(personEntry));
    const faces = document.createElement('div');
    faces.className = 'people-admin-faces';
    const samples = personEntry.samples?.length ? personEntry.samples : (personEntry.cover ? [personEntry.cover] : []);
    samples.forEach((face, index) => faces.append(createFaceCrop(face, index === 0 ? `פרצוף של ${personLabel(personEntry)}` : '')));
    const meta = document.createElement('p');
    meta.className = 'people-admin-meta';
    meta.textContent = `${faceCountLabel(personEntry.faceCount)} · ${imageCountLabel(personEntry.imageCount)}${personEntry.status === 'approved' ? ' · מאושר' : ''}`;

    const actions = document.createElement('div');
    actions.className = 'people-admin-actions';
    if (!detail) actions.append(actionButton('פתח קבוצה', () => openPersonDetail(personEntry.personId)));
    const merge = personSelect(`peopleMerge-${personEntry.personId}`, 'מזג לתוך…', { excludeId: personEntry.personId });
    actions.append(merge.wrap, actionButton('מזג', () => {
        if (!merge.select.value) { managerStatus('בחר קבוצה למיזוג.'); merge.select.focus(); return; }
        const target = manager.options.find(option => option.personId === merge.select.value);
        if (!window.confirm(`למזג את ${personLabel(personEntry)} לתוך ${personLabel(target)}?`)) return;
        runMutation({ action: 'merge', targetId: merge.select.value, sourceId: personEntry.personId }, 'הקבוצות מוזגו.');
    }, { label: `מיזוג ${personLabel(personEntry)} לקבוצה שנבחרה` }));
    actions.append(personEntry.hidden
        ? actionButton('הצג שוב', () => runMutation({ action: 'unhide', personId: personEntry.personId }, 'האדם מוצג שוב.'))
        : actionButton('הסתר', () => runMutation({ action: 'hide', personId: personEntry.personId }, 'האדם הוסתר מהגלריה.'), { tone: 'danger' }));
    card.append(faces, meta, nameForm(personEntry), actions);
    return card;
}

function renderReviewCard(item) {
    const card = document.createElement('article');
    card.className = 'people-admin-card people-admin-review';
    const pair = document.createElement('div');
    pair.className = 'people-admin-pair';
    const candidateLabel = item.candidate ? personLabel(item.candidate) : 'אין הצעה';
    pair.append(createFaceCrop(item, 'הפרצוף לבדיקה'), createFaceCrop(item.candidate?.cover, item.candidate ? `הפרצוף הראשי של ${candidateLabel}` : ''));
    const question = document.createElement('p');
    question.className = 'people-admin-meta';
    question.textContent = item.candidate
        ? `האם זה ${candidateLabel}? (מרחק ${item.distance})`
        : 'לא נמצאה קבוצה מתאימה. אפשר לשייך ידנית או להשאיר כבודד.';

    const actions = document.createElement('div');
    actions.className = 'people-admin-actions';
    if (item.candidate) {
        actions.append(actionButton('כן, זה הוא', () => runMutation({ action: 'accept', face: faceRef(item), personId: item.candidate.personId }, 'הפרצוף שויך.'), { tone: 'primary' }));
    }
    const assign = personSelect(`peopleAssign-${item.imageId}-${item.faceIndex}`, 'שייך ל…');
    actions.append(assign.wrap, actionButton('שייך', () => {
        if (!assign.select.value) { managerStatus('בחר אדם לשיוך.'); assign.select.focus(); return; }
        runMutation({ action: 'accept', face: faceRef(item), personId: assign.select.value }, 'הפרצוף שויך.');
    }));
    actions.append(
        actionButton('לא — אדם אחר', () => runMutation({ action: 'reject', face: faceRef(item) }, 'הפרצוף יקובץ בנפרד.')),
        actionButton('התעלם', () => runMutation({ action: 'remove', face: faceRef(item) }, 'הפרצוף לא יקובץ.'), { tone: 'danger' })
    );
    card.append(pair, question, actions);
    return card;
}

// פרצוף בודד: עוד לא נמצא לו פרצוף דומה. אפשר לשייך אותו לאדם, לפתוח לו
// קבוצה חדשה (היא מופיעה ב„הצעות”, ושם נותנים לה שם), או להתעלם ממנו.
function renderSingleCard(item) {
    const card = document.createElement('article');
    card.className = 'people-admin-card people-admin-member';
    const meta = document.createElement('p');
    meta.className = 'people-admin-meta';
    meta.textContent = 'עוד לא נמצא לו פרצוף דומה בגלריה.';
    const actions = document.createElement('div');
    actions.className = 'people-admin-actions';
    const assign = personSelect(`peopleSingle-${item.imageId}-${item.faceIndex}`, 'שייך ל…', { allowNew: true });
    actions.append(assign.wrap, actionButton('שייך', () => {
        if (!assign.select.value) { managerStatus('בחר אדם לשיוך, או „קבוצה חדשה”.'); assign.select.focus(); return; }
        if (assign.select.value === '__new__') {
            runMutation({ action: 'move', face: faceRef(item) }, 'נפתחה קבוצה חדשה. היא מופיעה בלשונית „הצעות”, ושם אפשר לתת לה שם.');
            return;
        }
        runMutation({ action: 'accept', face: faceRef(item), personId: assign.select.value }, 'הפרצוף שויך.');
    }));
    actions.append(actionButton('התעלם', () => runMutation({ action: 'remove', face: faceRef(item) }, 'הפרצוף לא יקובץ.'), { tone: 'danger' }));
    card.append(createFaceCrop(item, 'פרצוף בודד'), meta, actions);
    return card;
}

function faceRef(face) {
    return { imageId: face.imageId, faceIndex: face.faceIndex, updatedAt: face.updatedAt };
}

function renderMemberCard(face, personEntry) {
    const card = document.createElement('article');
    card.className = 'people-admin-card people-admin-member';
    const meta = document.createElement('p');
    meta.className = 'people-admin-meta';
    const isCover = personEntry.cover && personEntry.cover.imageId === face.imageId && personEntry.cover.faceIndex === face.faceIndex;
    meta.textContent = `${face.source === 'auto' ? 'שויך אוטומטית' : 'שויך ידנית'}${isCover ? ' · תמונה ראשית' : ''}`;
    const actions = document.createElement('div');
    actions.className = 'people-admin-actions';
    if (!isCover) actions.append(actionButton('קבע כתמונה ראשית', () => runMutation({ action: 'cover', personId: personEntry.personId, face: faceRef(face) }, 'התמונה הראשית עודכנה.')));
    const move = personSelect(`peopleMove-${face.imageId}-${face.faceIndex}`, 'העבר ל…', { excludeId: personEntry.personId, allowNew: true });
    actions.append(move.wrap, actionButton('העבר', () => {
        if (!move.select.value) { managerStatus('בחר לאן להעביר.'); move.select.focus(); return; }
        const body = { action: 'move', face: faceRef(face) };
        if (move.select.value !== '__new__') body.targetId = move.select.value;
        runMutation(body, 'הפרצוף הועבר.');
    }));
    actions.append(actionButton('הסר מהקבוצה', () => runMutation({ action: 'remove', face: faceRef(face) }, 'הפרצוף הוסר מהקבוצה.'), { tone: 'danger' }));
    card.append(createFaceCrop(face, `פרצוף ${face.faceIndex + 1} בתמונה`), meta, actions);
    return card;
}

function renderPages(hasMore) {
    const pages = el('peopleAdminPages');
    if (!pages) return;
    pages.replaceChildren();
    if (manager.offset === 0 && !hasMore) return;
    pages.append(
        actionButton('הקודם', () => { manager.offset = Math.max(0, manager.offset - 24); loadManagerView(); }, { disabled: manager.offset === 0 }),
        document.createTextNode(` עמוד ${Math.floor(manager.offset / 24) + 1} `),
        actionButton('הבא', () => { manager.offset += 24; loadManagerView(); }, { disabled: !hasMore })
    );
}

function collectMissingBoxes(data) {
    const faces = [];
    const add = face => { if (face && !face.box && face.sourceUrl) faces.push(face); };
    for (const entry of data.persons || []) { (entry.samples || []).forEach(add); add(entry.cover); }
    for (const item of data.faces || []) { add(item); add(item.candidate?.cover); }
    if (data.person) add(data.person.cover);
    return faces;
}

// פרצופים מוצגים בלי מיקום שמור: מאתרים אותם בתמונה שאונדקסה, שולחים את
// המיקום, ומציירים מחדש. רק לפרצופים שבמסך, שתי תמונות בכל פעם.
async function completeMissingBoxes(faces, current) {
    if (!faces.length) return;
    const byImage = new Map();
    for (const face of faces) {
        if (!byImage.has(face.imageId)) byImage.set(face.imageId, []);
        byImage.get(face.imageId).push(face);
    }
    let found = 0;
    try {
        await window.ensureFaceIndexModule();
        const engine = await window.ensureFaceEngine();
        const queue = [...byImage.values()];
        await Promise.all([0, 1].map(async () => {
            while (queue.length && current === manager.generation) {
                const items = queue.shift();
                try {
                    const image = await window.loadFaceImageElement(items[0].sourceUrl);
                    const detections = await engine.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();
                    for (const face of items) {
                        const box = boxFromDetection(detections?.[face.faceIndex]?.detection?.box, image.naturalWidth, image.naturalHeight);
                        if (!box) continue;
                        face.box = box;
                        queueFaceBox(face, box);
                        found += 1;
                    }
                } catch (error) {
                    console.warn('Face position could not be completed:', error);
                }
            }
        }));
    } catch (error) {
        console.warn('Face engine unavailable for face positions:', error);
    }
    if (found && current === manager.generation && !manager.busy) {
        clearTimeout(boxFlushTimer);
        await flushFaceBoxes();
        await loadManagerView({ keepStatus: true, skipBoxes: true });
    }
}

async function loadOptions() {
    try {
        const data = await groupsRequest('view=options');
        manager.options = Array.isArray(data?.options) ? data.options : [];
    } catch (error) {
        console.warn('People options failed to load:', error);
    }
}

async function loadManagerView({ keepStatus = false, skipBoxes = false } = {}) {
    const list = el('peopleAdminList');
    if (!list || !window.state?.isAdminLoggedIn) return;
    const current = ++manager.generation;
    if (!keepStatus) managerStatus('טוען…');
    list.setAttribute('aria-busy', 'true');
    try {
        const query = manager.personId
            ? `person=${encodeURIComponent(manager.personId)}&offset=${manager.offset}`
            : `view=${manager.view}&offset=${manager.offset}`;
        const [data] = await Promise.all([groupsRequest(query), loadOptions()]);
        if (current !== manager.generation) return;
        manager.counts = data.counts || null;
        renderCounts(data.counts);
        renderClusterSummary(data.counts);
        const cards = [];
        if (data.view === 'person') {
            const header = document.createElement('div');
            header.className = 'people-admin-detail-head';
            const title = document.createElement('h4');
            title.textContent = personLabel(data.person);
            header.append(title, actionButton('חזרה לרשימה', () => { manager.personId = ''; manager.offset = 0; loadManagerView(); }));
            cards.push(header, renderPersonCard({ ...data.person, samples: [] }, { detail: true }));
            for (const face of data.faces || []) cards.push(renderMemberCard(face, data.person));
        } else if (data.view === 'review') {
            for (const item of data.faces || []) cards.push(renderReviewCard(item));
        } else if (data.view === 'singles') {
            for (const item of data.faces || []) cards.push(renderSingleCard(item));
        } else {
            for (const entry of data.persons || []) cards.push(renderPersonCard(entry));
        }
        list.replaceChildren(...cards);
        renderPages(Boolean(data.hasMore));
        if (!keepStatus) {
            const empty = {
                suggested: 'אין הצעות חדשות. קבוצות חדשות יופיעו כאן מעצמן אחרי אינדוקס של תמונות.',
                review: 'אין פרצופים שממתינים לבדיקה.',
                singles: 'אין פרצופים בודדים. פרצוף שעוד לא נמצא לו דומה יופיע כאן.',
                approved: 'עדיין לא אושר אף אדם. אשר קבוצה מהלשונית „הצעות” ותן לה שם.',
                hidden: 'אין אנשים מוסתרים.',
                person: 'אין פרצופים בקבוצה הזו.'
            }[data.view] || '';
            const count = data.view === 'person' ? (data.faces || []).length : (data.persons || data.faces || []).length;
            managerStatus(count ? `${VIEW_LABELS[data.view] || personLabel(data.person)}: ${count} בעמוד הזה.` : empty);
        }
        if (!skipBoxes) completeMissingBoxes(collectMissingBoxes(data), current);
    } catch (error) {
        if (current !== manager.generation) return;
        managerStatus(error?.status === 404 && !manager.personId
            ? 'ניהול האנשים עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : (error?.message || 'הטעינה נכשלה. נסה שוב.'));
        if (manager.personId && error?.status === 404) { manager.personId = ''; }
    } finally {
        if (current === manager.generation) list.removeAttribute('aria-busy');
    }
}

function openPersonDetail(personId) {
    manager.personId = personId;
    manager.offset = 0;
    loadManagerView();
}

function renderClusterSummary(counts) {
    if (manager.clustering || !counts) return;
    const runButton = el('peopleClusterRunBtn');
    if (runButton) runButton.disabled = false;
    if (counts.unclustered) {
        manager.lastRunMessage = '';
        clusterStatus(`${faceCountLabel(counts.unclustered)} עדיין לא קובצו. הקיבוץ רץ מעצמו אחרי אינדוקס, ואפשר להריץ אותו עכשיו.`);
        return;
    }
    // סיכום הריצה האחרונה נשאר גלוי גם כשהרשימה מתרעננת אחריה.
    clusterStatus(manager.lastRunMessage || 'כל הפרצופים קובצו. פרצופים מתמונות חדשות יקובצו מעצמם אחרי האינדוקס.');
}

// ריצת קיבוץ מהדפדפן: ממשיכה בקבוצות עד שאין יותר פרצופים חדשים.
async function runPeopleClustering() {
    if (manager.clustering) return;
    manager.clustering = true;
    const runButton = el('peopleClusterRunBtn');
    if (runButton) runButton.disabled = true;
    let processed = 0;
    let joined = 0;
    let created = 0;
    let review = 0;
    let absorbed = 0;
    try {
        for (let round = 0; round < CLUSTER_MAX_ROUNDS; round += 1) {
            clusterStatus(`מקבץ פרצופים… (${processed} עד כה)`);
            const result = await window.r2Request('/face/clusters/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (result?.busy) {
                clusterStatus('ריצת קיבוץ אחרת פועלת כרגע. נסה שוב בעוד דקה.');
                return;
            }
            processed += Number(result?.processed) || 0;
            joined += Number(result?.joined) || 0;
            created += Number(result?.created) || 0;
            review += Number(result?.review) || 0;
            absorbed += Number(result?.absorbed) || 0;
            if (!result?.processed || !result?.remaining) break;
        }
        // בודדים שצורפו לאנשים שנוצרו או השתנו (הבדיקה החוזרת שבסוף כל ריצה).
        const absorbedText = absorbed ? ` ${faceCountLabel(absorbed)} שהיו בודדים צורפו לאנשים.` : '';
        manager.lastRunMessage = processed
            ? `הקיבוץ הושלם: ${processed} פרצופים — ${joined} הצטרפו לאנשים קיימים, ${created} קבוצות חדשות, ${review} לבדיקה.${absorbedText}`
            : (absorbed ? `הקיבוץ הושלם.${absorbedText}` : 'אין פרצופים חדשים לקיבוץ.');
        clusterStatus(manager.lastRunMessage);
    } catch (error) {
        clusterStatus(error?.status === 404
            ? 'הקיבוץ עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : `הקיבוץ נעצר: ${error?.message || 'שגיאה לא ידועה'}. אפשר להריץ אותו שוב.`);
    } finally {
        // הרשימה מתרעננת לפני שהדגל יורד, כדי שסיכום הריצה לא יוחלף בסיכום הכללי.
        await loadManagerView({ keepStatus: true });
        manager.clustering = false;
        if (runButton) runButton.disabled = false;
    }
}

function bindManager() {
    if (manager.bound) return;
    manager.bound = true;
    for (const tab of document.querySelectorAll('[data-people-view]')) {
        tab.addEventListener('click', () => {
            manager.view = tab.dataset.peopleView;
            manager.personId = '';
            manager.offset = 0;
            loadManagerView();
        });
    }
    el('peopleClusterRunBtn')?.addEventListener('click', () => runPeopleClustering());
}

function refreshManagerSilently() {
    if (manager.bound) loadManagerView({ keepStatus: true });
}

export async function openPeopleManager() {
    if (!window.state?.isAdminLoggedIn || !el('peopleAdminList')) return;
    bindManager();
    await loadManagerView();
    // פרצופים שאונדקסו ועוד לא קובצו (למשל קיימים מלפני העדכון) מקובצים מיד,
    // וכך גם בודדים שעוד לא נבדקו שוב מול אנשים שהשתנו (recheck).
    if (Number(manager.counts?.unclustered) > 0 || manager.counts?.recheck === true) runPeopleClustering();
}
