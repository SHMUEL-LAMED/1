// בדיקות העריכה הלא הורסת (media-edit.js): נרמול, סיבוב עם החיתוך, תוכנית
// הציור, והאם התצוגות המקדימות כבר "אפויות" עם העריכה הנוכחית.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clampCrop, drawEdited, editDisplay, editTransform, isEditIdentity, newEditRevision, normalizeEdit,
    originalRevision, recordEdit, rotateEdit, shouldDownloadEdited, variantsMatchEdit
} from './media-edit.js';

const EDIT = { rotate: 90, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, rev: 'k3x9a' };

test('נרמול: עריכת זהות, סיבוב פסול או בלי מזהה — אין עריכה', () => {
    assert.deepEqual(normalizeEdit(EDIT), EDIT);
    assert.equal(normalizeEdit({ rotate: 0, crop: null, rev: 'a' }), null);
    assert.equal(normalizeEdit({ rotate: 45, rev: 'a' }), null);
    assert.equal(normalizeEdit({ rotate: 90 }), null);
    assert.equal(normalizeEdit(null), null);
    assert.equal(normalizeEdit({ rotate: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, rev: 'a' }), null);
    assert.equal(recordEdit({ mediaType: 'video', edit: EDIT }), null, 'סרטון אינו נערך');
    assert.equal(isEditIdentity({ rotate: 360 }), true);
});

test('חיתוך נשאר בתוך התמונה ולא קטן מהמינימום', () => {
    assert.deepEqual(clampCrop({ x: 0.9, y: -1, w: 0.5, h: 0.001 }), { x: 0.5, y: 0, w: 0.5, h: 0.02 });
    assert.equal(clampCrop({ x: 'a', y: 0, w: 1, h: 1 }), null);
});

test('סיבוב ברבע מזיז את החיתוך יחד עם התמונה; ארבעה רבעים חוזרים להתחלה', () => {
    const start = { rotate: 0, crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, rev: 'a' };
    const once = rotateEdit(start, 1);
    assert.equal(once.rotate, 90);
    assert.deepEqual(once.crop, { x: 0.4, y: 0.1, w: 0.4, h: 0.3 });
    const back = rotateEdit(once, -1);
    assert.equal(back.rotate, 0);
    let full = start;
    for (let index = 0; index < 4; index += 1) full = rotateEdit(full, 1);
    assert.equal(full.rotate, 0);
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(full.crop[key] - start.crop[key]) < 1e-9);
});

test('תוכנית הציור: ממדים אחרי סיבוב וחיתוך, ותקרה לגודל', () => {
    const plan = editTransform(4000, 3000, EDIT);
    // אחרי סיבוב: 3000×4000; חיתוך 0.5×0.6.
    assert.equal(plan.width, 1500);
    assert.equal(plan.height, 2400);
    assert.equal(plan.cropX, 300);
    assert.equal(plan.cropY, 800);
    const small = editTransform(4000, 3000, EDIT, 1200);
    assert.equal(small.height, 1200);
    assert.equal(small.width, 750);
});

test('drawEdited מצייר את הפינה הנכונה של המקור', () => {
    // מטריצת 2D מינימלית: מספיק כדי לבדוק לאן ממופה פינת המקור (0,0).
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const multiply = ([a, b, c, d, e, f]) => {
        const [A, B, C, D, E, F] = matrix;
        matrix = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
    };
    let drawn = null;
    const context = {
        save: () => stack.push(matrix), restore: () => { matrix = stack.pop(); },
        scale: (x, y) => multiply([x, 0, 0, y, 0, 0]),
        translate: (x, y) => multiply([1, 0, 0, 1, x, y]),
        rotate: angle => multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
        drawImage: (source, x, y) => {
            const [a, b, c, d, e, f] = matrix;
            drawn = { x: Math.round(a * x + c * y + e), y: Math.round(b * x + d * y + f) };
        }
    };
    // סיבוב 90° בלי חיתוך, 4×2: הפינה העליונה־שמאלית של המקור עוברת לפינה העליונה־ימנית (2, 0).
    drawEdited(context, {}, editTransform(4, 2, { rotate: 90, rev: 'a' }));
    assert.deepEqual(drawn, { x: 2, y: 0 });
});

test('תצוגות "אפויות" רק כשכולן נושאות את מזהה העריכה הנוכחי', () => {
    const variants = rev => ({
        thumb: { url: 'https://x/t.webp', editRev: rev },
        medium: { url: 'https://x/m.webp', editRev: rev }
    });
    assert.equal(variantsMatchEdit({ edit: EDIT, variants: variants('k3x9a') }), true);
    assert.equal(variantsMatchEdit({ edit: EDIT, variants: variants('old') }), false);
    assert.equal(variantsMatchEdit({ edit: EDIT, variants: { thumb: { url: 'https://x/t', editRev: 'k3x9a' }, medium: { url: 'https://x/m' } } }), false);
    assert.equal(variantsMatchEdit({ edit: EDIT }), false, 'בלי תצוגות — מחילים על המקור');
    assert.deepEqual(editDisplay({ variants: variants('') }), { edit: null, baked: false });
    assert.equal(editDisplay({ edit: EDIT, variants: variants('k3x9a') }).baked, true);
});

test('מזהי עריכה תקינים לשרת; ביטול עריכה מתחיל ב-o', () => {
    const rev = newEditRevision(1_700_000_000_000, () => 0.5);
    assert.match(rev, /^[a-z0-9]{1,24}$/);
    assert.match(originalRevision(1_700_000_000_000, () => 0.5), /^o[a-z0-9]{1,23}$/);
});

test('הורדה ערוכה ל-JPEG בלבד, ובקשת "מקור" גוברת', () => {
    assert.equal(shouldDownloadEdited({ edit: EDIT }, 'image/jpeg'), true);
    assert.equal(shouldDownloadEdited({ edit: EDIT }, 'image/png'), false);
    assert.equal(shouldDownloadEdited({ edit: EDIT }, 'image/jpeg', { original: true }), false);
    assert.equal(shouldDownloadEdited({}, 'image/jpeg'), false);
});
