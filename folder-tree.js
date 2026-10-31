// folder-tree.js — תיקיות מקוננות: ההיגיון הטהור, בלי DOM (נבדק ב-Node).
//
// לכל תיקייה יכולה להיות תיקיית אב אחת (`parentId`), עד שלוש רמות: שנה ›
// אירוע › חלק באירוע. רשומה בלי `parentId` — וכל רשומה ישנה — היא תיקייה
// עליונה. ה-Worker בודק את המבנה בכל כתיבה (הורה קיים, בלי מעגל, עומק), וכאן
// אותם כללים בדיוק לבדיקה מוקדמת בממשק. העץ נבנה כך שגם נתונים פגומים (הורה
// שנמחק, מעגל ישן) לעולם אינם תוקעים את הדפדפן: תיקייה כזו מוצגת כעליונה.
//
// `parentFolderId` של סנכרון Drive אינו `parentId`: הוא מתאר את המבנה ב-Drive
// בלבד, ותיקיות Drive נשארות עליונות עד שמנהל מעביר אותן.
import { compareByManualRank } from './manual-order.js';

export const FOLDER_MAX_DEPTH = 3;
// תצוגות ולא תיקיות: אינן חלק מהעץ.
const RESERVED_IDS = new Set(['all', 'favorites']);

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function folderParentId(folder) {
    const id = safeId(folder?.parentId);
    return id && !RESERVED_IDS.has(id) ? id : '';
}

// הסדר בין תיקיות אחיות: קודם הסדר הידני שמנהל קבע (order), ואחריו הסדר של
// היום — תיקיות Drive אחרי השאר ולפי הנתיב שלהן, והשאר לפי השם.
export function compareFolders(a, b) {
    return compareByManualRank(a, b, (first, second) => {
        if (Boolean(first?.syncedFromDrive) !== Boolean(second?.syncedFromDrive)) return first?.syncedFromDrive ? 1 : -1;
        if (first?.syncedFromDrive && second?.syncedFromDrive) {
            const pathCompare = String(first.drivePath || first.name || '').localeCompare(String(second.drivePath || second.name || ''), 'he');
            if (pathCompare) return pathCompare;
        }
        return String(first?.name || '').localeCompare(String(second?.name || ''), 'he');
    });
}

export function buildFolderTree(folders) {
    const byId = new Map();
    for (const folder of Array.isArray(folders) ? folders : []) {
        const id = safeId(folder?.id);
        if (!id || RESERVED_IDS.has(id) || byId.has(id)) continue;
        byId.set(id, folder);
    }
    const declaredParent = id => {
        const parent = folderParentId(byId.get(id));
        return parent && parent !== id && byId.has(parent) ? parent : '';
    };
    // ההורה בפועל: הורה שאינו קיים, או שרשרת שחוזרת לתיקייה עצמה (מעגל), או
    // עמוקה מהמותר — והתיקייה מוצגת כעליונה. כך אף לולאה כאן אינה אינסופית.
    const parentOf = new Map();
    for (const id of byId.keys()) {
        let parent = declaredParent(id);
        const seen = new Set([id]);
        let current = parent;
        while (current) {
            if (seen.has(current)) { parent = ''; break; }
            seen.add(current);
            current = declaredParent(current);
        }
        parentOf.set(id, parent);
    }
    const children = new Map();
    const roots = [];
    for (const id of byId.keys()) {
        const parent = parentOf.get(id);
        if (!parent) { roots.push(id); continue; }
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
    }
    const sortIds = ids => ids.sort((first, second) => compareFolders(byId.get(first), byId.get(second)));
    sortIds(roots);
    for (const list of children.values()) sortIds(list);

    const tree = {
        byId,
        roots,
        has: id => byId.has(safeId(id)),
        get: id => byId.get(safeId(id)) || null,
        parentOf: id => parentOf.get(safeId(id)) || '',
        childrenOf: id => [...(children.get(safeId(id)) || [])],
        // מהשורש אל ההורה הישיר (בלי התיקייה עצמה).
        ancestorsOf(id) {
            const chain = [];
            let current = tree.parentOf(id);
            while (current && chain.length < byId.size) {
                chain.unshift(current);
                current = tree.parentOf(current);
            }
            return chain;
        },
        // עומק התיקייה: עליונה = 1.
        depthOf: id => (byId.has(safeId(id)) ? tree.ancestorsOf(id).length + 1 : 0),
        descendantsOf(id) {
            const result = [];
            const queue = tree.childrenOf(id);
            while (queue.length) {
                const next = queue.shift();
                if (result.includes(next)) continue;
                result.push(next);
                queue.push(...tree.childrenOf(next));
            }
            return result;
        },
        // מספר הרמות מהתיקייה ועד הצאצא העמוק ביותר (תיקייה בלי ילדים = 1).
        heightOf(id) {
            const safe = safeId(id);
            if (!byId.has(safe)) return 0;
            let height = 0;
            let layer = [safe];
            while (layer.length && height <= FOLDER_MAX_DEPTH + 1) {
                height += 1;
                layer = layer.flatMap(item => children.get(item) || []);
            }
            return height;
        }
    };
    return tree;
}

// המונה שבכרטיס התיקייה: הפריטים שלה ועוד אלה של כל תת־התיקיות שלה. מחושב
// מהמונים לפי תיקייה שכבר מגיעים מהשרת (GET /data/images/counts?by=folderId),
// בלי שאילתה נוספת.
export function subtreeCount(tree, folderId, counts) {
    const id = safeId(folderId);
    if (!tree?.has(id)) return Number(counts?.[id]) || 0;
    return [id, ...tree.descendantsOf(id)].reduce((sum, item) => sum + (Number(counts?.[item]) || 0), 0);
}

// "חדש" על תיקייה: בה או באחת מתת־התיקיות שלה.
export function subtreeHasAny(tree, folderId, idSet) {
    const id = safeId(folderId);
    if (!idSet || typeof idSet.has !== 'function') return false;
    if (idSet.has(id)) return true;
    return Boolean(tree?.has(id)) && tree.descendantsOf(id).some(item => idSet.has(item));
}

// אותם כללים של ה-Worker (checkFolderPlacement), כדי להסביר למנהל לפני השליחה.
// parentId ריק = העברה לרמה העליונה, שתמיד מותרת.
export function validateFolderMove(tree, folderId, parentId) {
    const id = safeId(folderId);
    const parent = safeId(parentId);
    if (!parent) return { ok: true };
    if (RESERVED_IDS.has(parent) || RESERVED_IDS.has(id)) return { ok: false, code: 'invalid_folder_parent', message: 'התצוגה הזו אינה יכולה להשתתף במבנה התיקיות.' };
    if (parent === id) return { ok: false, code: 'folder_cycle', message: 'תיקייה אינה יכולה להיות תת־תיקייה של עצמה.' };
    if (!tree?.has(parent)) return { ok: false, code: 'folder_parent_not_found', message: 'תיקיית האב אינה קיימת.' };
    if (tree.has(id) && tree.descendantsOf(id).includes(parent)) {
        return { ok: false, code: 'folder_cycle', message: 'אי אפשר להעביר תיקייה אל תוך תת־תיקייה שלה.' };
    }
    const height = tree.has(id) ? tree.heightOf(id) : 1;
    if (tree.depthOf(parent) + height > FOLDER_MAX_DEPTH) {
        return { ok: false, code: 'folder_too_deep', message: `אפשר לקנן תיקיות עד ${FOLDER_MAX_DEPTH} רמות בלבד.` };
    }
    return { ok: true };
}

// התיקיות שאפשר לבחור כהורה של folderId (או של תיקייה חדשה, כש-folderId ריק),
// לפי סדר העץ, עם העומק לכל אחת — לרשימת הבחירה בממשק.
export function parentChoices(tree, folderId = '') {
    const result = [];
    const visit = (id, depth) => {
        if (validateFolderMove(tree, folderId, id).ok) result.push({ id, depth, folder: tree.get(id) });
        for (const child of tree.childrenOf(id)) visit(child, depth + 1);
    };
    for (const root of tree?.roots || []) visit(root, 1);
    return result;
}

// הנתיב לפירורי הלחם: "כל הארכיון › שנה › אירוע".
export function folderPath(tree, folderId) {
    const id = safeId(folderId);
    if (!tree?.has(id)) return [];
    return [...tree.ancestorsOf(id), id].map(item => ({ id: item, folder: tree.get(item) }));
}
