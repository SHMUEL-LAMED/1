// admin-folders.js — מסך "תיקיות ואירועים" בלוח הניהול: עץ התיקיות, הזזה
// בסדר הידני (כפתורים וגרירה), "העבר אל", סדר ידני כברירת מחדל ותת־תיקייה חדשה.
//
// המודול נטען עצלה מ-admin-ui.js בפעם הראשונה שהמסך נפתח. המעטפת מגדירה
// מראש עטיפות window.* לכפתורי ה-onclick שב-admin.html, והן מושכות את
// המודול לפני הקריאה; כאן הפונקציות נרשמות על window באותם שמות.
//
// העוזרים המשותפים (safeRecordId, safeIconName, scheduleIconRefresh, showConfirm,
// r2Request) נקראים מ-window בזמן הקריאה ולא בטעינת המודול, כדי שסדר הטעינה
// העצלה לא ישבור אותם.

// עץ התיקיות והסדר הידני שלהן (folder-tree.js, manual-order.js).
import { FOLDER_MAX_DEPTH, buildFolderTree, compareFolders, parentChoices, subtreeCount, validateFolderMove } from './folder-tree.js';
import { chunkOrderChanges, moveItem, rankChanges } from './manual-order.js';

export function renderAdminFolders() {
    const { safeRecordId, safeIconName, scheduleIconRefresh } = window;
    const list = document.getElementById('adminFolderList');
    if (!list) return;
    list.replaceChildren();
    // תיקיית האב של תיקייה חדשה בטופס שמעל הרשימה מתעדכנת יחד איתה.
    window.populateFolderSelects?.();
    const tree = buildFolderTree(window.state.folders || []);

    if (!tree.byId.size) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty';
        empty.textContent = 'עדיין אין תיקיות בגלריה.';
        list.appendChild(empty);
        return;
    }

    // בדף הניהול כל התמונות בזיכרון, ולכן המונים נספרים כאן.
    const ownCounts = {};
    for (const image of window.state.images || []) {
        const folderId = safeRecordId(image.folderId);
        if (folderId) ownCounts[folderId] = (ownCounts[folderId] || 0) + 1;
    }
    const canEdit = Boolean(window.state.isAdminLoggedIn);

    // שורה לכל תיקייה, לפי סדר העץ; ההזחה לפי העומק (data-depth).
    const renderRow = (folderId, depth, siblings) => {
        const folder = tree.get(folderId);
        const own = ownCounts[folderId] || 0;
        const total = subtreeCount(tree, folderId, ownCounts);

        const row = document.createElement('div');
        row.className = 'admin-row admin-folder-row';
        row.dataset.folderId = folderId;
        row.dataset.depth = String(depth);
        row.setAttribute('role', 'listitem');
        row.innerHTML = `<span class="admin-stat-icon" data-tone="cyan"><i data-lucide="${safeIconName(folder.icon)}" class="w-4 h-4"></i></span>`;

        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const title = document.createElement('p');
        title.className = 'admin-row-title truncate';
        title.textContent = folder.name || 'תיקייה ללא שם';
        const meta = document.createElement('p');
        meta.className = 'admin-row-meta';
        const nested = total - own;
        meta.textContent = `${own} פריטים${nested ? ` · ועוד ${nested} בתת־התיקיות` : ''}${folder.syncedFromDrive ? ' · מסונכרן מ־Drive' : ''}${folder.eventDate ? ` · ${folder.eventDate}` : ''}${folder.manualOrder ? ' · סדר ידני' : ''}`;
        text.append(title, meta);
        row.append(text);

        const controls = document.createElement('div');
        controls.className = 'admin-folder-controls';
        const name = folder.name || 'התיקייה';
        if (canEdit) {
            const position = siblings.indexOf(folderId);
            const moveButton = (step, icon, label) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'admin-folder-icon-button';
                button.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i>`;
                button.setAttribute('aria-label', `${label}: ${name}`);
                button.title = label;
                button.disabled = position + step < 0 || position + step >= siblings.length;
                button.onclick = () => moveFolderAmongSiblings(folderId, siblings, step);
                return button;
            };
            controls.append(moveButton(-1, 'arrow-up', 'הזזה למעלה בסדר'), moveButton(1, 'arrow-down', 'הזזה למטה בסדר'));

            // "העבר אל": רק הורים חוקיים (בלי מעגל, עד שלוש רמות).
            const select = document.createElement('select');
            select.setAttribute('aria-label', `העברת ${name} אל תיקייה אחרת`);
            const top = document.createElement('option');
            top.value = '';
            top.textContent = 'רמה עליונה';
            select.append(top);
            for (const choice of parentChoices(tree, folderId)) {
                const option = document.createElement('option');
                option.value = choice.id;
                option.textContent = `${'  '.repeat(choice.depth - 1)}${choice.depth > 1 ? '↳ ' : ''}${choice.folder?.name || 'תיקייה ללא שם'}`;
                select.append(option);
            }
            select.value = tree.parentOf(folderId);
            select.onchange = () => moveFolderUnder(folderId, select.value, () => { select.value = tree.parentOf(folderId); });
            controls.append(select);

            const manual = document.createElement('label');
            manual.className = 'admin-folder-manual';
            const manualToggle = document.createElement('input');
            manualToggle.type = 'checkbox';
            manualToggle.checked = folder.manualOrder === true;
            manualToggle.onchange = () => setFolderManualOrder(folderId, manualToggle.checked, () => { manualToggle.checked = !manualToggle.checked; });
            manual.append(manualToggle, document.createTextNode('סדר ידני כברירת מחדל'));
            controls.append(manual);

            if (depth < FOLDER_MAX_DEPTH) {
                const child = document.createElement('button');
                child.type = 'button';
                child.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
                child.textContent = 'תת־תיקייה חדשה';
                child.setAttribute('aria-label', `יצירת תת־תיקייה בתוך ${name}`);
                child.onclick = () => startSubfolder(folderId);
                controls.append(child);
            }
            row.draggable = true;
        }

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn-secondary-dark px-3 py-1.5 text-[11px]';
        open.textContent = 'פתיחה בגלריה';
        open.onclick = () => window.location.assign(`./index.html#folder-${encodeURIComponent(folderId)}`);
        controls.append(open);
        row.append(controls);
        list.appendChild(row);
        for (const childId of tree.childrenOf(folderId)) renderRow(childId, depth + 1, tree.childrenOf(folderId));
    };
    list.setAttribute('role', 'list');
    for (const rootId of tree.roots) renderRow(rootId, 1, tree.roots);
    installAdminFolderDrag(list);
    scheduleIconRefresh(list);
}
window.renderAdminFolders = renderAdminFolders;

// הסדר הידני של תיקיות אחיות: מחושב ב-manual-order.js, ונשלחות רק התיקיות
// שהדירוג שלהן השתנה, בבקשה אחת (POST /order, טרנזקציה בשרת).
export async function saveFolderSiblingOrder(orderedIds) {
    const { safeRecordId, r2Request } = window;
    const tree = buildFolderTree(window.state.folders || []);
    const records = orderedIds.map(id => tree.get(id)).filter(Boolean);
    const changes = rankChanges(records, { idOf: folder => safeRecordId(folder.id), fallback: compareFolders });
    if (!changes.length) return;
    for (const chunk of chunkOrderChanges(changes)) {
        await r2Request('/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'folders', items: chunk })
        });
    }
    const byId = new Map(changes.map(change => [change.id, change.order]));
    window.state.folders = (window.state.folders || []).map(folder => {
        const id = safeRecordId(folder.id);
        if (!byId.has(id)) return folder;
        const next = { ...folder };
        if (byId.get(id) === null) delete next.order;
        else next.order = byId.get(id);
        return next;
    });
    window.renderFolders?.();
    window.renderAdminFolders();
}

export async function moveFolderAmongSiblings(folderId, siblings, step) {
    const from = siblings.indexOf(folderId);
    if (from < 0 || from + step < 0 || from + step >= siblings.length) return;
    try {
        await saveFolderSiblingOrder(moveItem(siblings, from, from + step));
        window.showNotification('סדר התיקיות נשמר.', true);
        // הפוקוס חוזר לאותו כפתור בשורה שזזה, כדי שאפשר להמשיך להזיז במקלדת.
        const row = document.querySelector(`#adminFolderList [data-folder-id="${folderId}"]`);
        row?.querySelectorAll('.admin-folder-icon-button')[step < 0 ? 0 : 1]?.focus();
    } catch (error) {
        console.error('Folder order save failed:', error);
        window.showNotification(error.message || 'שמירת סדר התיקיות נכשלה.', false);
    }
}

export function moveFolderUnder(folderId, parentId, revert) {
    const { safeRecordId, showConfirm } = window;
    const tree = buildFolderTree(window.state.folders || []);
    const folder = tree.get(folderId);
    const target = safeRecordId(parentId);
    const check = validateFolderMove(tree, folderId, target);
    if (!folder || !check.ok) {
        window.showNotification(check.message || 'לא ניתן להעביר את התיקייה לשם.', false);
        revert();
        return;
    }
    const targetName = target ? (tree.get(target)?.name || 'התיקייה') : 'הרמה העליונה';
    showConfirm('העברת תיקייה', `להעביר את "${folder.name || 'התיקייה'}" אל "${targetName}"? התמונות שבתוכה נשארות בה.`, async () => {
        try {
            await window.saveFolderToCloud({ ...folder, parentId: target || null });
            window.renderAdminFolders();
            window.showNotification('התיקייה הועברה.', true);
        } catch (error) {
            console.error('Folder move failed:', error);
            revert();
            window.showNotification(error.message || 'העברת התיקייה נכשלה.', false);
            throw error;
        }
    });
    // ביטול בחלון האישור (showConfirm אינו מודיע עליו) מחזיר את הרשימה למצב
    // האמיתי: כשהחלון נסגר, העץ מצויר שוב מ-state.folders.
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if (!confirmModal.classList.contains('hidden')) return;
            observer.disconnect();
            window.setTimeout(() => window.renderAdminFolders(), 0);
        });
        observer.observe(confirmModal, { attributes: true, attributeFilter: ['class'] });
    }
}

export async function setFolderManualOrder(folderId, enabled, revert) {
    const folder = buildFolderTree(window.state.folders || []).get(folderId);
    if (!folder) return;
    try {
        await window.saveFolderToCloud({ ...folder, manualOrder: enabled });
        window.renderAdminFolders();
        window.showNotification(enabled ? 'התיקייה תיפתח בסדר הידני.' : 'התיקייה תיפתח בסדר הרגיל.', true);
    } catch (error) {
        revert();
        window.showNotification(error.message || 'שמירת ההגדרה נכשלה.', false);
    }
}

// "תת־תיקייה חדשה": הטופס שמעל הרשימה, עם ההורה כבר בחור.
export function startSubfolder(parentId) {
    window.populateFolderSelects?.();
    const select = document.getElementById('emptyFolderParent');
    if (select) select.value = parentId;
    const name = document.getElementById('emptyFolderName');
    name?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    name?.focus({ preventScroll: true });
}

// גרירה בין תיקיות אחיות (אותו הורה). הכפתורים שבשורה עושים אותו דבר במקלדת.
export function installAdminFolderDrag(list) {
    if (list.__folderDrag) return;
    list.__folderDrag = true;
    let dragged = '';
    list.addEventListener('dragstart', event => {
        dragged = event.target.closest?.('.admin-folder-row')?.dataset.folderId || '';
        try { event.dataTransfer.setData('text/plain', dragged); } catch { /* בלי נתונים — dragged שמור */ }
    });
    list.addEventListener('dragover', event => {
        const row = event.target.closest?.('.admin-folder-row');
        if (!row || !dragged) return;
        event.preventDefault();
        list.querySelectorAll('.is-drop-target').forEach(node => node !== row && node.classList.remove('is-drop-target'));
        row.classList.add('is-drop-target');
    });
    list.addEventListener('dragend', () => {
        dragged = '';
        list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
    });
    list.addEventListener('drop', async event => {
        const row = event.target.closest?.('.admin-folder-row');
        const targetId = row?.dataset.folderId || '';
        list.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
        if (!row || !dragged || dragged === targetId) return;
        event.preventDefault();
        const tree = buildFolderTree(window.state.folders || []);
        if (tree.parentOf(dragged) !== tree.parentOf(targetId)) {
            window.showNotification('גרירה מסדרת תיקיות באותה רמה. כדי להעביר לתיקייה אחרת השתמש ב"העבר אל".', false);
            return;
        }
        const siblings = tree.parentOf(dragged) ? tree.childrenOf(tree.parentOf(dragged)) : tree.roots;
        const from = siblings.indexOf(dragged);
        const to = siblings.indexOf(targetId);
        try {
            await saveFolderSiblingOrder(moveItem(siblings, from, to));
            window.showNotification('סדר התיקיות נשמר.', true);
        } catch (error) {
            window.showNotification(error.message || 'שמירת סדר התיקיות נכשלה.', false);
        }
    });
}
