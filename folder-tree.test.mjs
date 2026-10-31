// בדיקות העץ של התיקיות (folder-tree.js): שורשים, ילדים, נתיב, מונה "שלה ושל
// הצאצאים", ואותם כללי העברה של ה-Worker — כולל נתונים פגומים שאסור שיתקעו.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    FOLDER_MAX_DEPTH, buildFolderTree, compareFolders, folderParentId, folderPath,
    parentChoices, subtreeCount, subtreeHasAny, validateFolderMove
} from './folder-tree.js';

const FOLDERS = [
    { id: 'all', name: 'הכול' },
    { id: 'y2025', name: 'תשפ״ו' },
    { id: 'simchat', name: 'שמחת תורה', parentId: 'y2025' },
    { id: 'hakafot', name: 'הקפות', parentId: 'simchat' },
    { id: 'trip', name: 'טיול', parentId: 'y2025', order: 1 },
    { id: 'legacy', name: 'אלבום ישן' },
    { id: 'drive_a', name: 'Drive', syncedFromDrive: true, parentFolderId: 'drivefolder_root', driveDepth: 1 }
];

test('רשומות בלי parentId — וגם parentFolderId של Drive — הן תיקיות עליונות', () => {
    const tree = buildFolderTree(FOLDERS);
    assert.deepEqual(tree.roots, ['legacy', 'y2025', 'drive_a']);
    assert.equal(tree.has('all'), false);
    assert.equal(folderParentId({ parentId: 'all' }), '');
    assert.deepEqual(tree.childrenOf('y2025'), ['trip', 'simchat'], 'הסדר הידני קודם לשם');
    assert.deepEqual(tree.ancestorsOf('hakafot'), ['y2025', 'simchat']);
    assert.equal(tree.depthOf('hakafot'), 3);
    assert.equal(tree.heightOf('y2025'), 3);
    assert.deepEqual(tree.descendantsOf('y2025').sort(), ['hakafot', 'simchat', 'trip']);
});

test('הורה שנמחק או מעגל ישן אינם תוקעים — התיקייה מוצגת כעליונה', () => {
    const tree = buildFolderTree([
        { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' },
        { id: 'orphan', parentId: 'gone' }, { id: 'self', parentId: 'self' }
    ]);
    assert.deepEqual([...tree.roots].sort(), ['a', 'b', 'orphan', 'self']);
    assert.deepEqual(tree.ancestorsOf('a'), []);
    assert.equal(tree.descendantsOf('a').length, 0);
});

test('המונה בכרטיס: הפריטים של התיקייה ושל כל הצאצאים, מהמונים של השרת', () => {
    const tree = buildFolderTree(FOLDERS);
    const counts = { y2025: 2, simchat: 10, hakafot: 5, trip: 1, legacy: 4 };
    assert.equal(subtreeCount(tree, 'y2025', counts), 18);
    assert.equal(subtreeCount(tree, 'simchat', counts), 15);
    assert.equal(subtreeCount(tree, 'legacy', counts), 4);
    assert.equal(subtreeCount(tree, 'missing', counts), 0);
});

test('"חדש" על תיקייה כשיש חדש בה או באחת מתת־התיקיות', () => {
    const tree = buildFolderTree(FOLDERS);
    assert.equal(subtreeHasAny(tree, 'y2025', new Set(['hakafot'])), true);
    assert.equal(subtreeHasAny(tree, 'trip', new Set(['hakafot'])), false);
    assert.equal(subtreeHasAny(tree, 'legacy', null), false);
});

test('כללי ההעברה זהים לאלה של ה-Worker', () => {
    const tree = buildFolderTree(FOLDERS);
    assert.equal(validateFolderMove(tree, 'legacy', 'hakafot').code, 'folder_too_deep');
    assert.equal(validateFolderMove(tree, 'y2025', 'hakafot').code, 'folder_cycle');
    assert.equal(validateFolderMove(tree, 'simchat', 'simchat').code, 'folder_cycle');
    assert.equal(validateFolderMove(tree, 'legacy', 'nope').code, 'folder_parent_not_found');
    assert.equal(validateFolderMove(tree, 'legacy', 'all').code, 'invalid_folder_parent');
    // simchat עם הילד שלה (גובה 2) תחת legacy (עומק 1) — 3 רמות, מותר.
    assert.equal(validateFolderMove(tree, 'simchat', 'legacy').ok, true);
    // תיקייה חדשה (מזהה ריק) תחת simchat — רמה 3.
    assert.equal(validateFolderMove(tree, '', 'simchat').ok, true);
    assert.equal(validateFolderMove(tree, 'simchat', '').ok, true);
    assert.equal(FOLDER_MAX_DEPTH, 3);
});

test('אפשרויות ההורה מסננות מעגלים ועומק, בסדר העץ', () => {
    const tree = buildFolderTree(FOLDERS);
    assert.deepEqual(parentChoices(tree, 'simchat').map(choice => choice.id), ['legacy', 'y2025', 'drive_a']);
    assert.deepEqual(parentChoices(tree, '').map(choice => [choice.id, choice.depth]), [
        ['legacy', 1], ['y2025', 1], ['trip', 2], ['simchat', 2], ['drive_a', 1]
    ]);
});

test('הנתיב לפירורי הלחם', () => {
    const tree = buildFolderTree(FOLDERS);
    assert.deepEqual(folderPath(tree, 'hakafot').map(step => step.folder.name), ['תשפ״ו', 'שמחת תורה', 'הקפות']);
    assert.deepEqual(folderPath(tree, 'missing'), []);
});

test('סדר התיקיות בלי דירוג נשאר כמו היום: Drive בסוף, ואז השם', () => {
    const list = [
        { name: 'ב', syncedFromDrive: true, drivePath: 'א / ב' },
        { name: 'ת' },
        { name: 'א' },
        { name: 'ז', order: 5 }
    ].sort(compareFolders);
    assert.deepEqual(list.map(folder => folder.name), ['ז', 'א', 'ת', 'ב']);
});

test('המודולים החדשים של דף הגלריה במעטפת ה-Service Worker, וכלי המנהל מחוצה לה', () => {
    const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
    const shell = sw.slice(sw.indexOf('const APP_SHELL'), sw.indexOf('];', sw.indexOf('const APP_SHELL')));
    const pkg = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    for (const file of ['folder-tree.js', 'gallery-folders.js', 'manual-order.js', 'media-edit.js', 'media-edit-canvas.js']) {
        assert.ok(shell.includes(`"./${file}"`), `${file} חסר ב-APP_SHELL`);
        assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
    }
    for (const file of ['media-edit-ui.js', 'manual-order-ui.js']) {
        assert.equal(shell.includes(`"./${file}"`), false, `${file} הוא כלי מנהל ואינו נשמר מראש`);
        assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
    }
});
