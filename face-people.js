// Admin-only manual identity correction. Descriptors remain on the server.
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
