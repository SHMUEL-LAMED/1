// manual-order-ui.js — מצב "סדר ידני" של המנהל ברשת הגלריה.
//
// נטען רק כשמנהל לוחץ על "סדר ידני" בסרגל הכלים, בתוך תיקייה (gallery.js,
// toggleGalleryArrangeMode). במצב הזה כל התיקייה נטענת, המיון עובר ל"סדר ידני",
// והכרטיסים נגררים — או זזים בכפתורי "קודם" / "אחר כך", שעובדים גם במקלדת,
// בטלפון ובקורא מסך (כל הזזה מוכרזת). שום דבר אינו נכתב עד "שמור סדר":
// אז מחושבים הדירוגים (manual-order.js) ונשלחות רק הרשומות שהדירוג שלהן
// השתנה, ב-POST /order — כל בקשה נשמרת בשרת כטרנזקציה אחת.
//
// "פתח את התיקייה בסדר הזה" שומר manualOrder בתיקייה: הצופים יקבלו את הסדר
// הידני כברירת מחדל בתיקייה הזו בלבד.
import { moveItem, rankChanges, clearRanks, chunkOrderChanges, sortByManualRank } from './manual-order.js';
import { compareCaptureAsc } from './capture-date.js';
import { currentFolderTree } from './gallery-folders.js';

let arrange = null; // { folderId, order: [ids], dirty, previousSort, saving }
let listenersReady = false;
let dragId = '';

const safeId = value => window.safeRecordId(value);

function folderRecords(folderId) {
    return (window.state.images || []).filter(item => safeId(item.folderId) === folderId && safeId(item.id));
}

function recordById(id) {
    return (window.state.images || []).find(item => safeId(item.id) === id) || null;
}

function announce(text) {
    const status = document.getElementById('arrangeStatus');
    if (status) status.textContent = text;
}

function syncSortSelect() {
    const select = document.getElementById('gallerySortSelect');
    if (select && select.value !== window.state.gallerySort) select.value = window.state.gallerySort;
}

function renderBar() {
    let bar = document.getElementById('arrangeBar');
    if (!arrange) {
        bar?.remove();
        const button = document.getElementById('galleryArrangeButton');
        button?.setAttribute('aria-pressed', 'false');
        return;
    }
    const folder = currentFolderTree().get(arrange.folderId);
    if (!bar) {
        bar = document.createElement('section');
        bar.id = 'arrangeBar';
        bar.className = 'arrange-bar';
        bar.setAttribute('aria-label', 'סידור ידני של התמונות');
        const grid = document.getElementById('photosGrid');
        grid?.parentElement?.insertBefore(bar, grid);
    }
    // שם התיקייה נכנס כטקסט בלבד (textContent), לא כמרקאפ.
    bar.innerHTML = `
        <p class="arrange-bar-text"><strong>סדר ידני:</strong> <span data-arrange-folder></span> — גררו תמונות, או השתמשו בכפתורי "קודם" ו"אחר כך" שעל כל כרטיס.</p>
        <label class="arrange-bar-default"><input type="checkbox" id="arrangeDefaultToggle"> פתח את התיקייה בסדר הזה לכל הצופים</label>
        <div class="arrange-bar-actions">
            <button type="button" class="btn-primary-gold px-4 py-2 text-xs" data-arrange-action="save">שמור סדר</button>
            <button type="button" class="btn-secondary-dark px-3 py-2 text-xs" data-arrange-action="cancel">בטל</button>
            <button type="button" class="btn-secondary-dark px-3 py-2 text-xs" data-arrange-action="reset">איפוס לסדר לפי תאריך</button>
        </div>
        <p id="arrangeStatus" class="sr-only" role="status" aria-live="polite"></p>`;
    bar.querySelector('[data-arrange-folder]').textContent = folder?.name || 'התיקייה';
    bar.querySelector('#arrangeDefaultToggle').checked = folder?.manualOrder === true;
    document.getElementById('galleryArrangeButton')?.setAttribute('aria-pressed', 'true');
}

// הסדר שהרשת מציגה במצב הסידור (gallery.js, sortGalleryItems). פריט שהגיע
// בינתיים (העלאה חדשה) ואינו ברשימת העבודה — בסוף, לפי תאריך.
window.galleryArrangeOrder = function(items) {
    if (!arrange) return null;
    if (safeId(window.state.activeFolderId) !== arrange.folderId) {
        queueMicrotask(() => cancelArrangeMode({ notify: arrange?.dirty }));
        return null;
    }
    const index = new Map(arrange.order.map((id, position) => [id, position]));
    return [...items].sort((a, b) => {
        const first = index.has(safeId(a.id)) ? index.get(safeId(a.id)) : Infinity;
        const second = index.has(safeId(b.id)) ? index.get(safeId(b.id)) : Infinity;
        return first === second ? compareCaptureAsc(a, b) : first - second;
    });
};

function visibleIds() {
    return (window.getFilteredSortedImages?.() || []).map(item => safeId(item.id));
}

function workingIndex(id) {
    return arrange.order.indexOf(id);
}

// מעביר את id אל המקום של targetId (לפניו או אחריו) ברשימת העבודה המלאה —
// גם כשחיפוש או סינון מסתירים חלק מהתיקייה.
function placeRelative(id, targetId, after) {
    const from = workingIndex(id);
    if (from < 0 || id === targetId) return false;
    const without = arrange.order.filter(item => item !== id);
    const targetIndex = without.indexOf(targetId);
    if (targetIndex < 0) return false;
    arrange.order = moveItem([...without, id], without.length, after ? targetIndex + 1 : targetIndex);
    arrange.dirty = true;
    return true;
}

function refocus(id, step) {
    window.setTimeout(() => {
        const button = document.querySelector(`#photosGrid .arrange-move[data-media-id="${id}"][data-arrange-move="${step}"]`)
            || document.querySelector(`#photosGrid .arrange-move[data-media-id="${id}"]`);
        button?.focus({ preventScroll: false });
    }, 120);
}

function moveBy(id, step) {
    const visible = visibleIds();
    const position = visible.indexOf(id);
    const neighbour = visible[position + step];
    if (position < 0 || !neighbour) {
        announce(step < 0 ? 'התמונה כבר ראשונה.' : 'התמונה כבר אחרונה.');
        return;
    }
    placeRelative(id, neighbour, step > 0);
    window.renderImages();
    const title = recordById(id)?.title || 'התמונה';
    announce(`${title} עברה למקום ${position + step + 1} מתוך ${visible.length}.`);
    refocus(id, step);
}

function installListeners() {
    if (listenersReady) return;
    const grid = document.getElementById('photosGrid');
    if (!grid) return;
    listenersReady = true;
    grid.addEventListener('click', event => {
        const button = event.target.closest?.('.arrange-move');
        if (!button || !arrange) return;
        event.preventDefault();
        event.stopPropagation();
        moveBy(safeId(button.dataset.mediaId), Number(button.dataset.arrangeMove) < 0 ? -1 : 1);
    });
    grid.addEventListener('dragstart', event => {
        const card = event.target.closest?.('.gallery-card.is-arranging');
        if (!card || !arrange) return;
        dragId = safeId(card.dataset.mediaId);
        card.classList.add('is-dragging');
        try {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', dragId);
        } catch {
            // דפדפן שאינו מאפשר נתונים בגרירה — המזהה שמור ב-dragId.
        }
    });
    grid.addEventListener('dragover', event => {
        const card = event.target.closest?.('.gallery-card.is-arranging');
        if (!card || !arrange || !dragId) return;
        event.preventDefault();
        grid.querySelectorAll('.is-drop-target').forEach(node => node !== card && node.classList.remove('is-drop-target'));
        card.classList.add('is-drop-target');
    });
    grid.addEventListener('dragleave', event => {
        event.target.closest?.('.gallery-card')?.classList.remove('is-drop-target');
    });
    grid.addEventListener('drop', event => {
        const card = event.target.closest?.('.gallery-card.is-arranging');
        if (!card || !arrange || !dragId) return;
        event.preventDefault();
        const targetId = safeId(card.dataset.mediaId);
        const visible = visibleIds();
        // נגרר מלפני היעד — נכנס אחריו; מאחריו — לפניו. כמו ברשימה רגילה.
        const after = visible.indexOf(dragId) < visible.indexOf(targetId);
        if (placeRelative(dragId, targetId, after)) {
            window.renderImages();
            announce(`${recordById(dragId)?.title || 'התמונה'} עברה למקום ${visible.indexOf(targetId) + 1}.`);
        }
    });
    grid.addEventListener('dragend', () => {
        dragId = '';
        grid.querySelectorAll('.is-dragging, .is-drop-target').forEach(node => node.classList.remove('is-dragging', 'is-drop-target'));
    });
    document.addEventListener('click', event => {
        const action = event.target.closest?.('#arrangeBar [data-arrange-action]')?.dataset.arrangeAction;
        if (!action || !arrange) return;
        if (action === 'save') saveArrangement();
        else if (action === 'cancel') cancelArrangeMode();
        else if (action === 'reset') resetArrangement();
    });
}

async function startArrangeMode() {
    const folderId = safeId(window.state.activeFolderId);
    if (!currentFolderTree().has(folderId)) {
        window.showNotification('סדר ידני זמין בתוך תיקייה. בחר תיקייה ונסה שוב.', false);
        return;
    }
    // הדירוגים פזורים בכל העמודים, ולכן כל התיקייה נטענת לפני הסידור.
    if (window.state.imagesHasMore) {
        window.showNotification('טוען את כל התמונות שבתיקייה…', true);
        await window.loadAllImagesForSearch?.();
    }
    if (safeId(window.state.activeFolderId) !== folderId) return;
    arrange = {
        folderId,
        order: sortByManualRank(folderRecords(folderId), compareCaptureAsc).map(item => safeId(item.id)),
        dirty: false,
        previousSort: window.state.gallerySort,
        saving: false
    };
    window.state.gallerySort = 'manual';
    syncSortSelect();
    window.state.arrangeMode = true;
    installListeners();
    renderBar();
    window.renderImages();
    announce('מצב סדר ידני פעיל.');
}

function cancelArrangeMode({ notify = false } = {}) {
    if (!arrange) return;
    const previousSort = arrange.previousSort;
    arrange = null;
    window.state.arrangeMode = false;
    if (previousSort && previousSort !== 'manual' && window.state.gallerySort === 'manual') {
        const folder = currentFolderTree().get(window.state.activeFolderId);
        if (folder?.manualOrder !== true) window.state.gallerySort = previousSort;
    }
    syncSortSelect();
    renderBar();
    window.renderImages();
    if (notify) window.showNotification('הסידור שלא נשמר בוטל.', false);
}
window.cancelGalleryArrangeMode = () => cancelArrangeMode();

// הכתיבה: בקשה לכל עד 500 רשומות. כל בקשה נשמרת בשרת בשלמותה או בכלל לא; אם
// אחת נכשלת, מה שנשמר לפניה כבר מעודכן גם כאן, ואפשר ללחוץ שוב — החישוב
// הבא שולח רק את מה שעדיין שונה.
async function writeOrderChanges(changes) {
    const updated = [];
    try {
        for (const chunk of chunkOrderChanges(changes)) {
            await window.r2Request('/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection: 'images', items: chunk })
            });
            for (const change of chunk) {
                const record = recordById(change.id);
                if (!record) continue;
                const next = { ...record };
                if (change.order === null) delete next.order;
                else next.order = change.order;
                updated.push(next);
            }
        }
    } finally {
        if (updated.length) window.applyGalleryRecordUpdates?.(updated, { refreshLightbox: false });
    }
    return updated.length;
}

async function saveDefaultToggle() {
    const toggle = document.getElementById('arrangeDefaultToggle');
    const folder = currentFolderTree().get(arrange?.folderId);
    if (!toggle || !folder || toggle.checked === (folder.manualOrder === true)) return;
    await window.saveFolderToCloud({ ...folder, manualOrder: toggle.checked });
}

async function saveArrangement() {
    if (!arrange || arrange.saving) return;
    arrange.saving = true;
    const records = arrange.order.map(recordById).filter(Boolean);
    const changes = rankChanges(records, { idOf: item => safeId(item.id), fallback: compareCaptureAsc });
    try {
        if (changes.length) await writeOrderChanges(changes);
        await saveDefaultToggle();
        arrange.dirty = false;
        cancelArrangeMode();
        window.showNotification(changes.length ? `הסדר נשמר (${changes.length} תמונות עודכנו).` : 'הסדר נשמר.', true);
    } catch (error) {
        console.error('Manual order save failed:', error);
        if (arrange) arrange.saving = false;
        window.showNotification(error.message || 'שמירת הסדר נכשלה. נסה שוב.', false);
    }
}

function resetArrangement() {
    if (!arrange) return;
    window.showConfirm('איפוס הסדר הידני', 'למחוק את הסדר הידני של התיקייה ולחזור לסדר לפי תאריך הצילום?', async () => {
        const changes = clearRanks(folderRecords(arrange?.folderId || ''), item => safeId(item.id));
        try {
            if (changes.length) await writeOrderChanges(changes);
            if (arrange) {
                arrange.order = sortByManualRank(folderRecords(arrange.folderId), compareCaptureAsc).map(item => safeId(item.id));
                arrange.dirty = false;
            }
            window.renderImages();
            window.showNotification('הסדר הידני אופס.', true);
        } catch (error) {
            console.error('Manual order reset failed:', error);
            window.showNotification(error.message || 'איפוס הסדר נכשל.', false);
            throw error;
        }
    });
}

export function toggleArrangeMode() {
    if (arrange) {
        if (arrange.dirty) {
            window.showConfirm('יציאה מהסידור', 'הסדר החדש עדיין לא נשמר. לצאת בלי לשמור?', () => cancelArrangeMode());
            return;
        }
        cancelArrangeMode();
        return;
    }
    startArrangeMode().catch(error => {
        console.error('Arrange mode failed:', error);
        window.showNotification('לא ניתן היה לטעון את כל התיקייה. נסה שוב.', false);
    });
}

export function isArranging() {
    return Boolean(arrange);
}
