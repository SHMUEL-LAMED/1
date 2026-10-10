// media-description.js — הכיתוב ותגיות הסצנה בדף הגלריה: שבבי הסינון שבסרגל
// הכלים, התיאור שבתצוגה המלאה וחלון העריכה של המנהל.
//
// הנתונים עצמם (caption, sceneTags) נוצרים ב־Worker בזמן ההעלאה ונשמרים
// ברשומת המדיה; כאן רק מציגים, מסננים ועורכים. הכללים — הטקסונומיה, אורך
// הכיתוב ומספר התגיות — מגיעים מ־scene-tags.js, כמו ב־Worker. כל הצבעים
// מאסימוני styles.css (.scene-chip, .lightbox-description, .scene-tag-option).
import {
    SCENE_TAGS, SCENE_TAG_MAX, CAPTION_MAX_LENGTH,
    normalizeCaption, normalizeSceneTags, recordSceneTags, sceneTagCounts, sceneTagLabel
} from './scene-tags.js';

const escape = value => window.escapeHtml(String(value ?? ''));
const tagOrder = id => SCENE_TAGS.findIndex(tag => tag.id === id);

// --- שבבי הסינון לפי סוג הרגע ---

// השבבים נגזרים מהפריטים שבתצוגה (כמו בוררי התאריך העברי): רק תגיות שיש להן
// פריטים, עם המונה שלהן, והבחירה הנוכחית נשארת גם כשאין לה פריטים. בלי שום
// תגית — למשל כשאין מפתח AI בשרת — השורה כולה מוסתרת.
export function renderSceneFilterChips(container, records, activeId) {
    if (!container) return;
    const entries = sceneTagCounts(records);
    if (activeId && !entries.some(entry => entry.id === activeId)) {
        entries.push({ id: activeId, label: sceneTagLabel(activeId), count: 0 });
        entries.sort((first, second) => tagOrder(first.id) - tagOrder(second.id));
    }
    const key = JSON.stringify([activeId || '', entries]);
    if (container.dataset.chipsKey === key) return;
    container.dataset.chipsKey = key;
    container.hidden = entries.length === 0;
    // הבנייה מחדש אינה מאבדת את המיקוד של מי שבחר שבב מהמקלדת.
    const focused = container.contains(document.activeElement) ? document.activeElement.dataset.sceneTag : null;
    const chip = (id, label, count) => {
        const countHtml = count === null ? '' : `<span class="scene-chip-count">${count}<span class="sr-only"> פריטים</span></span>`;
        return `<button type="button" class="scene-chip" data-scene-tag="${escape(id)}" aria-pressed="${(activeId || '') === id ? 'true' : 'false'}"><span>${escape(label)}</span>${countHtml}</button>`;
    };
    container.innerHTML = entries.length
        ? [chip('', 'כל הרגעים', null), ...entries.map(entry => chip(entry.id, entry.label, entry.count))].join('')
        : '';
    if (focused !== null && focused !== undefined) {
        const target = [...container.querySelectorAll('.scene-chip')].find(button => button.dataset.sceneTag === focused);
        target?.focus({ preventScroll: true });
    }
}

export function installSceneFilterChips(container, onSelect) {
    if (!container || container.dataset.sceneFilterReady) return;
    container.dataset.sceneFilterReady = '1';
    container.addEventListener('click', event => {
        const button = event.target.closest('.scene-chip');
        if (button && container.contains(button)) onSelect(button.dataset.sceneTag || '');
    });
}

// --- התיאור בתצוגה המלאה ---

// הכיתוב והתגיות של הפריט הנוכחי. התגיות הן כפתורים: לחיצה סוגרת את התצוגה
// ומסננת את הגלריה לאותו סוג רגע. כפתור העריכה מוצג למנהל בלבד, ובשבילו
// הקופסה מוצגת גם לפריט שעדיין אין לו תיאור.
export function renderLightboxDescription(record, { canEdit = false } = {}) {
    const box = document.getElementById('lightboxDescription');
    const captionElement = document.getElementById('lightboxCaption');
    const emptyElement = document.getElementById('lightboxCaptionEmpty');
    const tagsElement = document.getElementById('lightboxTags');
    const editButton = document.getElementById('lightboxEditDescription');
    if (!box || !captionElement || !tagsElement) return;
    const caption = normalizeCaption(record?.caption);
    const tags = recordSceneTags(record);
    if (editButton) editButton.hidden = !canEdit;
    if (emptyElement) emptyElement.hidden = !canEdit || Boolean(caption) || tags.length > 0;
    captionElement.textContent = caption;
    captionElement.hidden = !caption;
    tagsElement.innerHTML = tags.map(id => {
        const label = sceneTagLabel(id);
        return `<li><button type="button" class="lightbox-tag" data-scene-tag="${escape(id)}" aria-label="הצגת כל הרגעים מסוג ${escape(label)}">${escape(label)}</button></li>`;
    }).join('');
    tagsElement.hidden = tags.length === 0;
    box.hidden = !canEdit && !caption && tags.length === 0;
}

export function installLightboxDescription({ onTagSelect, onEdit } = {}) {
    const tagsElement = document.getElementById('lightboxTags');
    if (tagsElement && !tagsElement.dataset.ready) {
        tagsElement.dataset.ready = '1';
        tagsElement.addEventListener('click', event => {
            const button = event.target.closest('.lightbox-tag');
            if (button && tagsElement.contains(button)) onTagSelect?.(button.dataset.sceneTag || '');
        });
    }
    const editButton = document.getElementById('lightboxEditDescription');
    if (editButton && !editButton.dataset.ready) {
        editButton.dataset.ready = '1';
        editButton.addEventListener('click', () => onEdit?.());
    }
}

// --- חלון העריכה (מנהל) ---

let editorSave = null;

function editorElements() {
    return {
        modal: document.getElementById('mediaDescriptionModal'),
        form: document.getElementById('mediaDescriptionForm'),
        subject: document.getElementById('mediaDescriptionSubject'),
        caption: document.getElementById('mediaDescriptionCaption'),
        count: document.getElementById('mediaDescriptionCaptionCount'),
        tags: document.getElementById('mediaDescriptionTags'),
        tagsHint: document.getElementById('mediaDescriptionTagsHint'),
        status: document.getElementById('mediaDescriptionStatus'),
        save: document.getElementById('mediaDescriptionSave')
    };
}

function selectedTags(elements) {
    return [...elements.tags.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
}

function updateEditorCounters(elements) {
    // במילים ולא "110 / 140": קו נטוי בין מספרים מתהפך בשורה מימין לשמאל.
    elements.count.textContent = `${elements.caption.value.length} מתוך ${CAPTION_MAX_LENGTH} תווים`;
    const chosen = selectedTags(elements).length;
    const full = chosen >= SCENE_TAG_MAX;
    // אחרי ארבע תגיות שאר האפשרויות ננעלות, וההערה אומרת למה.
    for (const input of elements.tags.querySelectorAll('input[type="checkbox"]')) {
        input.disabled = full && !input.checked;
    }
    elements.tagsHint.textContent = full
        ? `נבחרו ${SCENE_TAG_MAX} תגיות — המרבי. כדי להוסיף אחרת, בטל אחת.`
        : `נבחרו ${chosen} מתוך ${SCENE_TAG_MAX} לכל היותר.`;
}

export function installDescriptionEditor() {
    const elements = editorElements();
    if (!elements.form || elements.form.dataset.ready) return;
    elements.form.dataset.ready = '1';
    elements.tags.innerHTML = SCENE_TAGS.map(tag => `
        <label class="scene-tag-option">
            <input type="checkbox" name="sceneTag" value="${escape(tag.id)}">
            <span>${escape(tag.label)}</span>
        </label>`).join('');
    elements.caption.addEventListener('input', () => updateEditorCounters(elements));
    elements.tags.addEventListener('change', () => updateEditorCounters(elements));
    elements.form.addEventListener('submit', async event => {
        event.preventDefault();
        if (typeof editorSave !== 'function') return;
        const caption = normalizeCaption(elements.caption.value);
        const sceneTags = normalizeSceneTags(selectedTags(elements));
        elements.save.disabled = true;
        elements.status.textContent = 'שומר…';
        try {
            await editorSave({ caption, sceneTags });
            elements.status.textContent = '';
            window.closeModal('mediaDescriptionModal');
            window.showNotification('הכיתוב והתגיות נשמרו.');
        } catch (error) {
            elements.status.textContent = error?.message || 'השמירה נכשלה. נסה שוב.';
        } finally {
            elements.save.disabled = false;
        }
    });
}

// פותח את החלון עם הכיתוב והתגיות הנוכחיים של הפריט. onSave מקבל
// { caption, sceneTags } אחרי הנרמול, ושגיאה שהוא זורק מוצגת בחלון.
export function openDescriptionEditor(record, { onSave } = {}) {
    installDescriptionEditor();
    const elements = editorElements();
    if (!elements.modal || !elements.form) return false;
    editorSave = onSave;
    elements.subject.textContent = record?.title || 'תמונה ללא שם';
    elements.caption.value = normalizeCaption(record?.caption);
    const current = new Set(recordSceneTags(record));
    for (const input of elements.tags.querySelectorAll('input[type="checkbox"]')) {
        input.checked = current.has(input.value);
    }
    elements.status.textContent = '';
    elements.save.disabled = false;
    updateEditorCounters(elements);
    window.openModal('mediaDescriptionModal');
    // openModal ממקד את הפקד הראשון (כפתור הסגירה); כאן עוברים לשדה הכיתוב.
    requestAnimationFrame(() => elements.caption.focus({ preventScroll: true }));
    return true;
}
