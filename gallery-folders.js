// gallery-folders.js — תיקיות מקוננות ותמונת שער בדף הגלריה.
//
// ההיגיון של העץ ב-folder-tree.js (בלי DOM). כאן מה שהגלריה מציגה ממנו:
//   - העץ הנוכחי של state.folders (נבנה פעם אחת לכל רשימת תיקיות);
//   - בכרטיס תיקייה ב-#folderList: תמונת השער ושבבי תת־התיקיות;
//   - מעל הרשת (#folderContext): פירורי לחם "כל הארכיון › שנה › אירוע" ותת־התיקיות
//     של התיקייה הפתוחה, לפני התמונות שלה;
//   - רשימות הבחירה של תיקייה (העברה, אישור, העלאה) עם ההיררכיה.
// כל שם תיקייה עובר escapeHtml לפני שהוא נכנס למרקאפ — השם מגיע ממנהל ומ-Drive.
//
// תמונת השער (coverImageId) נלקחת ממה שכבר נטען בביקור, ובלעדיו נמשכת בבקשה
// אחת לכל השערים החסרים (?ids=). תמונה שנמחקה פשוט אינה חוזרת, והכרטיס נשאר
// עם הסמל — ההתנהגות של היום.
import { buildFolderTree, subtreeCount, subtreeHasAny, folderPath } from './folder-tree.js';
import { pickCardSource, pickLightboxSource } from './media-variants.js';
import { recordEdit, variantsMatchEdit } from './media-edit.js';

let treeSource = null;
let treeCache = null;

export function currentFolderTree() {
    const folders = window.state?.folders || [];
    if (folders !== treeSource || !treeCache) {
        treeSource = folders;
        treeCache = buildFolderTree(folders);
    }
    return treeCache;
}

function escape(value) {
    return window.escapeHtml(String(value ?? ''));
}

function safeId(value) {
    return window.safeRecordId(value);
}

// המונה של תיקייה בכרטיס: שלה ושל כל הצאצאים (README: "תיקיות מקוננות").
export function folderBadgeCount(folderId, counts = window.state?.folderCounts) {
    const tree = currentFolderTree();
    if (counts) return subtreeCount(tree, folderId, counts);
    const ids = new Set([safeId(folderId), ...tree.descendantsOf(folderId)]);
    return (window.state?.images || []).filter(image => ids.has(safeId(image.folderId))).length;
}

export function folderHasNew(folderId, newFolderIds) {
    return subtreeHasAny(currentFolderTree(), folderId, newFolderIds);
}

// --- תמונת השער ---
const coverRecords = new Map(); // מזהה תמונה → רשומה, או null כשלא נמצאה
let coverRequest = null;

function loadedRecord(imageId) {
    const lists = [window.state?.images || [], window.state?.latestImages || [], window.getAllLoadedImages?.() || []];
    for (const list of lists) {
        const found = list.find(item => safeId(item?.id) === imageId);
        if (found) return found;
    }
    return null;
}

export function folderCoverRecord(folder) {
    const imageId = safeId(folder?.coverImageId);
    if (!imageId) return null;
    return loadedRecord(imageId) || coverRecords.get(imageId) || null;
}

// הרשומה עודכנה (תמונה נערכה או הוחלפו התצוגות שלה): גם העותק של השער מתעדכן.
export function noteCoverRecord(record) {
    const id = safeId(record?.id);
    if (id && coverRecords.has(id)) coverRecords.set(id, record);
}

export function requestMissingCovers(onLoaded) {
    if (coverRequest) return;
    const { getDocsByIds, collection } = window.firestoreModules || {};
    if (!window.db || typeof getDocsByIds !== 'function' || typeof collection !== 'function') return;
    const missing = [...new Set((window.state?.folders || [])
        .map(folder => safeId(folder?.coverImageId))
        .filter(id => id && !coverRecords.has(id) && !loadedRecord(id)))];
    if (!missing.length) return;
    coverRequest = getDocsByIds(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images'), missing.slice(0, 200))
        .then(snapshot => {
            const found = new Map(snapshot.docs.map(item => [safeId(item.id), item.data()]));
            for (const id of missing.slice(0, 200)) coverRecords.set(id, found.get(id) || null);
            onLoaded?.();
        })
        .catch(error => {
            // כשל אינו חוזר בכל ציור: השערים האלה נשארים עם הסמל עד הטעינה הבאה של הדף.
            console.warn('Folder covers load failed:', error);
            for (const id of missing.slice(0, 200)) coverRecords.set(id, null);
        })
        .finally(() => { coverRequest = null; });
}

// מקור התמונה לשער: התצוגה הקטנה (thumb). לתמונה ערוכה שהתצוגות שלה עוד לא
// נוצרו מחדש — אין שער (הסמל), ולא המקור הלא ערוך.
export function coverSource(record, { large = false } = {}) {
    if (!record) return '';
    if (recordEdit(record) && !variantsMatchEdit(record)) return '';
    const source = large ? pickLightboxSource(record, window.safeImageUrl) : pickCardSource(record, window.safeImageUrl);
    if (!source.url || (recordEdit(record) && source.url === source.original)) return '';
    return source.url;
}

export function folderCoverHtml(folder) {
    const url = coverSource(folderCoverRecord(folder));
    if (!url) return '';
    return `<img class="collection-card-cover" src="${escape(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}

// --- שבבי תת־התיקיות בכרטיס של תיקייה עליונה ---
const CHILD_CHIPS_LIMIT = 6;

export function subfolderChipsHtml(folderId) {
    const tree = currentFolderTree();
    const children = tree.childrenOf(folderId);
    if (!children.length) return '';
    const parentName = tree.get(folderId)?.name || '';
    const chips = children.slice(0, CHILD_CHIPS_LIMIT).map(id => {
        const child = tree.get(id);
        return `<li><button type="button" class="collection-card-child" onclick="setActiveFolder('${id}')" aria-label="פתיחת תת־התיקייה ${escape(child?.name)} (${folderBadgeCount(id)} פריטים)">${escape(child?.name || 'תיקייה ללא שם')}</button></li>`;
    });
    const more = children.length - CHILD_CHIPS_LIMIT;
    if (more > 0) chips.push(`<li><button type="button" class="collection-card-child is-more" onclick="setActiveFolder('${safeId(folderId)}')" aria-label="עוד ${more} תת־תיקיות ב${escape(parentName)}">+${more}</button></li>`);
    return `<ul class="collection-card-children" aria-label="תת־תיקיות של ${escape(parentName)}">${chips.join('')}</ul>`;
}

// --- מעל הרשת: פירורי לחם ותת־התיקיות של התיקייה הפתוחה ---
export function renderFolderContext() {
    const container = document.getElementById('folderContext');
    if (!container) return;
    const tree = currentFolderTree();
    const activeId = safeId(window.state?.activeFolderId);
    const inSearch = window.state?.tempSearchResults !== null && window.state?.tempSearchResults !== undefined;
    if (!activeId || !tree.has(activeId) || inSearch) {
        if (!container.hidden) {
            container.hidden = true;
            container.replaceChildren();
        }
        container.dataset.contextKey = '';
        return;
    }
    const path = folderPath(tree, activeId);
    const children = tree.childrenOf(activeId);
    const counts = window.state?.folderCounts;
    const key = JSON.stringify([activeId, path.map(step => [step.id, step.folder?.name]),
        children.map(id => [id, tree.get(id)?.name, folderBadgeCount(id, counts), safeId(tree.get(id)?.coverImageId), coverSource(folderCoverRecord(tree.get(id)))])]);
    if (container.dataset.contextKey === key && !container.hidden) return;
    container.dataset.contextKey = key;
    const crumbs = [`<li><button type="button" class="folder-breadcrumb-link" onclick="setActiveFolder('all')">כל הארכיון</button></li>`];
    path.forEach((step, index) => {
        const name = escape(step.folder?.name || 'תיקייה ללא שם');
        crumbs.push(index === path.length - 1
            ? `<li><span class="folder-breadcrumb-current" aria-current="page">${name}</span></li>`
            : `<li><button type="button" class="folder-breadcrumb-link" onclick="setActiveFolder('${step.id}')">${name}</button></li>`);
    });
    const subfolders = children.map(id => {
        const child = tree.get(id);
        const count = folderBadgeCount(id, counts);
        const cover = folderCoverHtml(child);
        const icon = cover || `<i data-lucide="${window.safeIconName(child?.icon)}" class="w-5 h-5" aria-hidden="true"></i>`;
        return `<li><button type="button" class="subfolder-card" data-folder-id="${id}" onclick="setActiveFolder('${id}')">
            <span class="subfolder-card-media" aria-hidden="true">${icon}</span>
            <span class="subfolder-card-name">${escape(child?.name || 'תיקייה ללא שם')}</span>
            <span class="subfolder-card-count">${count} פריטים</span>
        </button></li>`;
    }).join('');
    container.innerHTML = `
        <nav class="folder-breadcrumb" aria-label="מיקום בארכיון"><ol>${crumbs.join('')}</ol></nav>
        ${children.length ? `<section class="subfolder-strip" aria-label="תת־תיקיות"><h2 class="subfolder-strip-title">תת־תיקיות</h2><ul class="subfolder-list">${subfolders}</ul></section>` : ''}`;
    container.hidden = false;
    window.scheduleIconRefresh?.(container);
}

// --- רשימות בחירה של תיקייה: לפי העץ, עם הזחה לפי העומק ---
export function folderOptionsHtml({ selectedId = '', excludeIds = [] } = {}) {
    const tree = currentFolderTree();
    const excluded = new Set(excludeIds.map(safeId));
    const options = [];
    const visit = (id, depth) => {
        if (excluded.has(id)) return;
        const folder = tree.get(id);
        const prefix = depth > 1 ? `${'  '.repeat(depth - 1)}↳ ` : '';
        options.push(`<option value="${id}" class="bg-slate-950 text-white"${id === safeId(selectedId) ? ' selected' : ''}>${prefix}${escape(folder?.name || 'תיקייה ללא שם')}</option>`);
        for (const child of tree.childrenOf(id)) visit(child, depth + 1);
    };
    for (const root of tree.roots) visit(root, 1);
    return options.join('');
}

// שם התיקייה עם הנתיב שלה, לכיתוב ("שנה › אירוע").
export function folderPathLabel(folderId) {
    return folderPath(currentFolderTree(), folderId).map(step => step.folder?.name || '').filter(Boolean).join(' › ');
}
