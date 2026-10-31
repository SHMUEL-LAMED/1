// media-edit-ui.js — עורך הסיבוב והחיתוך של המנהל, מהתצוגה המלאה.
//
// נטען רק כשמנהל לוחץ "עריכה" בתצוגה המלאה (gallery.js, openMediaEditorFor).
// המקור ב-R2 לעולם אינו משתנה: נשמר רק תיאור העריכה ברשומה (edit, ראו
// media-edit.js), ואחריו נוצרות מחדש התצוגות המקדימות מהתמונה הערוכה — באותו
// מסלול של ריצת ההשלמה (media-variants-generate.js ו-POST /media/variants), עם
// מזהה העריכה. הסדר חשוב: קודם edit, ואז התצוגות. אם יצירת התצוגות נכשלת,
// הגלריה מזהה שהן אינן תואמות לעריכה ומציירת אותה בעצמה על המקור.
// "בטל עריכה" הפוך: קודם תצוגות חדשות מהמקור, ורק כשהצליחו — edit נמחק.
//
// החיתוך: מלבן מעל התמונה (אחרי הסיבוב) — גרירה מזיזה, הפינות משנות גודל,
// ובמקלדת: חצים מזיזים ו-Shift+חצים משנים גודל. ארבעה שדות מספר (באחוזים)
// נותנים אותה שליטה גם בקורא מסך. הסיבוב ברבעים, בשני הכיוונים.
import { clampCrop, isEditIdentity, newEditRevision, originalRevision, recordEdit, rotateEdit, rotatedSize } from './media-edit.js';
import { fetchImageBlob, renderEditedBlob } from './media-edit-canvas.js';

const MODAL_ID = 'mediaEditModal';
const PREVIEW_MAX_SIDE = 960;
const KEY_STEP = 0.01;
// יחסי חיתוך מוכנים; "חופשי" — בלי יחס.
const ASPECTS = [
    ['', 'חופשי'],
    ['1', 'ריבוע 1:1'],
    ['1.3333', '4:3 לרוחב'],
    ['0.75', '3:4 לאורך'],
    ['1.7778', '16:9 לרוחב']
];

let session = null; // { record, onSaved, blob, decoded, edit, busy }

function modal() {
    let element = document.getElementById(MODAL_ID);
    if (element) return element;
    element = document.createElement('div');
    element.id = MODAL_ID;
    element.className = 'media-edit-modal hidden';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-labelledby', 'mediaEditTitle');
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = `
        <div class="media-edit-panel">
            <header class="media-edit-head">
                <h3 id="mediaEditTitle">עריכת תמונה: סיבוב וחיתוך</h3>
                <button type="button" class="btn-secondary-dark w-10 h-10 rounded-full" data-edit-action="close" aria-label="סגירת העורך בלי שמירה"><i data-lucide="x" class="w-5 h-5"></i></button>
            </header>
            <p class="media-edit-note">הקובץ המקורי אינו משתנה. העריכה נשמרת לצידו, ואפשר לבטל אותה בכל עת.</p>
            <div class="media-edit-stage">
                <div class="media-edit-frame" data-edit-frame>
                    <canvas data-edit-canvas aria-hidden="true"></canvas>
                    <div class="media-edit-crop" data-edit-crop tabindex="0" role="group"
                        aria-label="אזור החיתוך. חצים מזיזים אותו, Shift עם חצים משנה את גודלו."
                        aria-describedby="mediaEditCropValues">
                        <span class="media-edit-handle" data-handle="nw" aria-hidden="true"></span>
                        <span class="media-edit-handle" data-handle="ne" aria-hidden="true"></span>
                        <span class="media-edit-handle" data-handle="sw" aria-hidden="true"></span>
                        <span class="media-edit-handle" data-handle="se" aria-hidden="true"></span>
                    </div>
                </div>
                <p class="media-edit-loading" data-edit-loading>טוען את התמונה המקורית…</p>
            </div>
            <div class="media-edit-tools">
                <div class="media-edit-row" role="group" aria-label="סיבוב">
                    <button type="button" class="btn-secondary-dark px-3 py-2 text-xs" data-edit-action="rotate-left"><i data-lucide="rotate-ccw" class="w-4 h-4"></i> סובב שמאלה</button>
                    <button type="button" class="btn-secondary-dark px-3 py-2 text-xs" data-edit-action="rotate-right"><i data-lucide="rotate-cw" class="w-4 h-4"></i> סובב ימינה</button>
                </div>
                <div class="media-edit-row">
                    <label class="media-edit-field"><span>יחס החיתוך</span><select data-edit-aspect>${ASPECTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
                    <button type="button" class="btn-secondary-dark px-3 py-2 text-xs" data-edit-action="reset-crop">בלי חיתוך</button>
                </div>
                <fieldset class="media-edit-row media-edit-numbers">
                    <legend class="sr-only">מיקום וגודל החיתוך באחוזים</legend>
                    <label class="media-edit-field"><span>משמאל %</span><input type="number" min="0" max="98" step="1" data-crop-field="x"></label>
                    <label class="media-edit-field"><span>מלמעלה %</span><input type="number" min="0" max="98" step="1" data-crop-field="y"></label>
                    <label class="media-edit-field"><span>רוחב %</span><input type="number" min="2" max="100" step="1" data-crop-field="w"></label>
                    <label class="media-edit-field"><span>גובה %</span><input type="number" min="2" max="100" step="1" data-crop-field="h"></label>
                </fieldset>
                <p id="mediaEditCropValues" class="sr-only" aria-live="polite"></p>
            </div>
            <p class="media-edit-status" data-edit-status role="status" aria-live="polite"></p>
            <footer class="media-edit-actions">
                <button type="button" class="btn-primary-gold px-5 py-2.5 text-xs" data-edit-action="save">שמור עריכה</button>
                <button type="button" class="btn-secondary-dark px-4 py-2.5 text-xs" data-edit-action="undo" hidden>בטל עריכה (חזרה למקור)</button>
                <button type="button" class="btn-secondary-dark px-4 py-2.5 text-xs" data-edit-action="close">ביטול</button>
            </footer>
        </div>`;
    document.body.appendChild(element);
    installInteractions(element);
    return element;
}

function setStatus(text) {
    const status = modal().querySelector('[data-edit-status]');
    if (status) status.textContent = text;
}

function setBusy(busy) {
    if (session) session.busy = busy;
    modal().querySelectorAll('[data-edit-action], [data-crop-field], [data-edit-aspect]').forEach(control => {
        if (control.dataset.editAction === 'close') return;
        control.disabled = busy;
    });
}

function currentCrop() {
    return session?.edit?.crop || { x: 0, y: 0, w: 1, h: 1 };
}

// הקנבס מציג את התמונה המלאה אחרי הסיבוב (בלי החיתוך), והמלבן מעליה.
function drawPreview() {
    if (!session?.decoded) return;
    const element = modal();
    const canvas = element.querySelector('[data-edit-canvas]');
    const { width, height } = session.decoded;
    const rotate = session.edit.rotate || 0;
    const rotated = rotatedSize(width, height, rotate);
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(rotated.width, rotated.height));
    canvas.width = Math.max(1, Math.round(rotated.width * scale));
    canvas.height = Math.max(1, Math.round(rotated.height * scale));
    const context = canvas.getContext('2d');
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotate * Math.PI) / 180);
    context.drawImage(session.decoded.source, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
    context.restore();
    element.querySelector('[data-edit-frame]').style.setProperty('--edit-ratio', String(canvas.width / canvas.height));
    drawCrop();
}

function drawCrop() {
    const element = modal();
    const crop = currentCrop();
    const box = element.querySelector('[data-edit-crop]');
    box.style.left = `${crop.x * 100}%`;
    box.style.top = `${crop.y * 100}%`;
    box.style.width = `${crop.w * 100}%`;
    box.style.height = `${crop.h * 100}%`;
    for (const key of ['x', 'y', 'w', 'h']) {
        const input = element.querySelector(`[data-crop-field="${key}"]`);
        if (input && document.activeElement !== input) input.value = String(Math.round(crop[key] * 100));
    }
    const values = element.querySelector('#mediaEditCropValues');
    if (values) {
        values.textContent = session?.edit?.crop
            ? `חיתוך: ${Math.round(crop.w * 100)}% רוחב, ${Math.round(crop.h * 100)}% גובה, ${Math.round(crop.x * 100)}% משמאל, ${Math.round(crop.y * 100)}% מלמעלה. סיבוב ${session.edit.rotate} מעלות.`
            : `בלי חיתוך. סיבוב ${session?.edit?.rotate || 0} מעלות.`;
    }
}

// יחס החיתוך בפיקסלים של התמונה המסובבת (לא באחוזים).
function applyAspect(crop, aspect) {
    if (!aspect || !session?.decoded) return crop;
    const rotated = rotatedSize(session.decoded.width, session.decoded.height, session.edit.rotate || 0);
    const pixelRatio = rotated.width / rotated.height;
    let w = crop.w;
    let h = (crop.w / aspect) * pixelRatio;
    if (h > 1) {
        h = 1;
        w = (aspect / pixelRatio);
    }
    return { x: crop.x, y: crop.y, w: Math.min(1, w), h: Math.min(1, h) };
}

function setCrop(crop) {
    if (!session) return;
    session.edit = { ...session.edit, crop: clampCrop(crop) };
    drawCrop();
}

function installInteractions(element) {
    element.addEventListener('click', event => {
        const action = event.target.closest?.('[data-edit-action]')?.dataset.editAction;
        if (!action || !session) return;
        if (action === 'close') closeEditor();
        else if (session.busy) return;
        else if (action === 'rotate-left' || action === 'rotate-right') {
            session.edit = rotateEdit(session.edit, action === 'rotate-right' ? 1 : -1);
            drawPreview();
        } else if (action === 'reset-crop') {
            element.querySelector('[data-edit-aspect]').value = '';
            setCrop(null);
        } else if (action === 'save') saveEditor();
        else if (action === 'undo') undoEditor();
    });
    element.querySelector('[data-edit-aspect]').addEventListener('change', event => {
        const aspect = Number(event.target.value) || 0;
        if (!aspect) return;
        setCrop(applyAspect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, aspect));
    });
    element.querySelectorAll('[data-crop-field]').forEach(input => {
        input.addEventListener('change', () => {
            const crop = { ...currentCrop() };
            const value = Number(input.value);
            if (!Number.isFinite(value)) return;
            crop[input.dataset.cropField] = value / 100;
            setCrop(crop);
        });
    });
    const box = element.querySelector('[data-edit-crop]');
    box.addEventListener('keydown', event => {
        const deltas = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
        const delta = deltas[event.key];
        if (!delta || !session) return;
        event.preventDefault();
        event.stopPropagation();
        const crop = { ...currentCrop() };
        if (event.shiftKey) {
            crop.w += delta[0];
            crop.h += delta[1];
        } else {
            crop.x += delta[0];
            crop.y += delta[1];
        }
        setCrop(crop);
    });
    // גרירה: בתוך המלבן מזיזה, בפינה משנה גודל. הכול מנורמל לגודל הקנבס המוצג.
    let drag = null;
    box.addEventListener('pointerdown', event => {
        if (!session || session.busy) return;
        const frame = element.querySelector('[data-edit-frame]').getBoundingClientRect();
        drag = { handle: event.target.dataset?.handle || 'move', startX: event.clientX, startY: event.clientY, frame, crop: { ...currentCrop() } };
        box.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    box.addEventListener('pointermove', event => {
        if (!drag) return;
        const dx = (event.clientX - drag.startX) / Math.max(1, drag.frame.width);
        const dy = (event.clientY - drag.startY) / Math.max(1, drag.frame.height);
        const start = drag.crop;
        let next = { ...start };
        if (drag.handle === 'move') next = { ...start, x: start.x + dx, y: start.y + dy };
        else {
            const west = drag.handle.includes('w');
            const north = drag.handle.includes('n');
            const right = start.x + start.w;
            const bottom = start.y + start.h;
            const x = west ? Math.min(right - 0.02, Math.max(0, start.x + dx)) : start.x;
            const y = north ? Math.min(bottom - 0.02, Math.max(0, start.y + dy)) : start.y;
            next = {
                x, y,
                w: west ? right - x : Math.min(1 - start.x, start.w + dx),
                h: north ? bottom - y : Math.min(1 - start.y, start.h + dy)
            };
        }
        setCrop(next);
    });
    const endDrag = event => {
        if (!drag) return;
        box.releasePointerCapture?.(event.pointerId);
        drag = null;
    };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
}

async function regenerateVariants(record, blob, revision, edit) {
    const prepared = edit ? await renderEditedBlob(blob, edit, { maxSide: 2560, type: 'image/jpeg', quality: 0.95 }) : blob;
    const { generateImageVariants, appendVariantParts } = await import('./media-variants-generate.js');
    const parts = await generateImageVariants(prepared);
    const form = new FormData();
    form.append('imageId', window.safeRecordId(record.id));
    form.append('editRevision', revision);
    if (!appendVariantParts(form, { parts })) throw new Error('התצוגות המקדימות לא נוצרו.');
    const result = await window.r2Request('/media/variants', { method: 'POST', body: form });
    if (!result?.variants) throw new Error('שמירת התצוגות המקדימות נכשלה.');
    return result.variants;
}

// הרשומה המקומית אחרי תצוגות חדשות: כמו בשרת, ממלא המקום (placeholder, אם יש)
// של התמונה הקודמת יוצא.
function withVariants(record, variants) {
    const next = { ...record, variants, variantsVersion: 1 };
    delete next.placeholder;
    return next;
}

async function writeEdit(record, edit) {
    const { doc, setDoc } = window.firestoreModules;
    const id = window.safeRecordId(record.id);
    const result = await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'images', id), { edit }, { merge: true });
    const saved = result?.data && typeof result.data === 'object' ? { ...result.data, id } : { ...record, edit };
    if (!edit) delete saved.edit;
    return saved;
}

async function saveEditor() {
    if (!session || session.busy || !session.blob) return;
    const { record, onSaved, blob } = session;
    const edit = { rotate: session.edit.rotate || 0, crop: clampCrop(session.edit.crop), rev: newEditRevision() };
    if (isEditIdentity(edit)) {
        if (recordEdit(record)) return undoEditor();
        closeEditor();
        return;
    }
    setBusy(true);
    setStatus('שומר את העריכה…');
    let saved;
    try {
        saved = await writeEdit(record, edit);
        onSaved?.(saved);
    } catch (error) {
        console.error('Media edit save failed:', error);
        setBusy(false);
        setStatus(error.message || 'שמירת העריכה נכשלה.');
        return;
    }
    setStatus('יוצר תצוגות מקדימות ערוכות…');
    try {
        const variants = await regenerateVariants(saved, blob, edit.rev, edit);
        onSaved?.(withVariants(saved, variants));
        window.showNotification('העריכה נשמרה.', true);
    } catch (error) {
        console.warn('Edited variants failed:', error);
        window.showNotification('העריכה נשמרה, אבל התצוגות המקדימות לא נוצרו. הגלריה תציג את העריכה מהמקור; אפשר לפתוח את העורך ולשמור שוב.', false);
    }
    closeEditor();
}

async function undoEditor() {
    if (!session || session.busy || !session.blob) return;
    const { record, onSaved, blob } = session;
    setBusy(true);
    setStatus('יוצר מחדש את התצוגות מהקובץ המקורי…');
    try {
        const variants = await regenerateVariants(record, blob, originalRevision(), null);
        onSaved?.(withVariants(record, variants));
        setStatus('מבטל את העריכה…');
        const saved = await writeEdit(withVariants(record, variants), null);
        onSaved?.(saved);
        window.showNotification('העריכה בוטלה; התמונה חזרה למקור.', true);
        closeEditor();
    } catch (error) {
        console.error('Media edit undo failed:', error);
        setBusy(false);
        setStatus(error.message || 'ביטול העריכה נכשל. העריכה עדיין בתוקף.');
    }
}

function closeEditor() {
    session?.decoded?.release?.();
    session = null;
    window.closeModal(MODAL_ID);
}

export async function openMediaEditor(record, { onSaved } = {}) {
    if (!window.state?.isAdminLoggedIn) throw new Error('עריכת תמונה זמינה למנהלים בלבד.');
    const element = modal();
    const existing = recordEdit(record);
    session?.decoded?.release?.();
    session = {
        record,
        onSaved,
        blob: null,
        decoded: null,
        busy: false,
        edit: existing ? { ...existing } : { rotate: 0, crop: null }
    };
    const own = session;
    element.querySelector('[data-edit-action="undo"]').hidden = !existing;
    element.querySelector('[data-edit-aspect]').value = '';
    element.querySelector('[data-edit-loading]').hidden = false;
    element.querySelector('[data-edit-frame]').hidden = true;
    setStatus('');
    setBusy(true);
    window.openModal(MODAL_ID);
    window.scheduleIconRefresh?.(element);
    try {
        // העריכה תמיד על המקור (אחרי כיוון ה-EXIF), לעולם לא על תצוגה ערוכה.
        const blob = await fetchImageBlob(record.url);
        const { decodeImageBlob } = await import('./media-variants-generate.js');
        const decoded = await decodeImageBlob(blob);
        if (session !== own) {
            decoded.release?.();
            return;
        }
        session.blob = blob;
        session.decoded = decoded;
        element.querySelector('[data-edit-loading]').hidden = true;
        element.querySelector('[data-edit-frame]').hidden = false;
        drawPreview();
        setBusy(false);
    } catch (error) {
        console.error('Media editor load failed:', error);
        if (session === own) {
            element.querySelector('[data-edit-loading]').textContent = 'טעינת התמונה המקורית נכשלה. בדוק את החיבור ונסה שוב.';
            setBusy(false);
            element.querySelectorAll('[data-edit-action="save"], [data-edit-action="undo"]').forEach(button => { button.disabled = true; });
        }
    }
}
