// התחזוקה בלוח הניהול: הגיבויים היומיים בענן (רשימה, הורדה, "גבה עכשיו"),
// דוח הקישורים השבורים, והספירה לאחור בסל המחזור. הכול למנהל־על בלבד —
// מנהל רגיל אינו רואה את המסכים ואינו פונה לנתיבים.
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { test, expect, seedSession, DAY_MS } from './fixtures.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const dayBefore = days => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

test('מנהל־על רואה את הגיבויים היומיים ומוריד אחד', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    worker.seedBackup(dayBefore(1), '{"format":"simchas-gallery-d1-backup","tables":[{"name":"gallery_documents"}]}').seedBackup(dayBefore(2));
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהלת העל' });
    await page.goto('/admin.html#backup');

    await expect(page.locator('#view-backup')).toHaveClass(/is-active/);
    const rows = page.locator('#cloudBackupsList .admin-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(dayBefore(1));
    await expect(page.locator('#cloudBackupsStatus')).toContainText('2 גיבויים זמינים');

    const downloadPromise = page.waitForEvent('download');
    await rows.first().getByRole('button', { name: 'הורדה' }).click();
    const download = await downloadPromise;
    const saved = readFileSync(await download.path());
    expect(JSON.parse(zlib.gunzipSync(saved).toString('utf8')).tables[0].name).toBe('gallery_documents');
    const [request] = worker.requestsTo('GET', `/maintenance/backups/${dayBefore(1)}`);
    expect(request.headers.authorization).toMatch(/^Bearer /);

    await page.getByRole('button', { name: 'גבה עכשיו' }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(today());
});

test('Worker שעדיין לא עודכן: הודעה ברורה במקום שגיאה', async ({ page, worker }) => {
    worker.maintenance.supported = false;
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/admin.html#backup');
    await expect(page.locator('#cloudBackupsStatus')).toHaveText('השרת עדיין לא עודכן לגיבוי היומי. הרשימה תופיע אחרי פריסת ה-Worker.');
    await page.locator('#adminNav [data-view-target="brokenlinks"]').click();
    await expect(page.locator('#brokenLinksStatus')).toHaveText('השרת עדיין לא עודכן לבדיקת הקישורים השבורים.');
});

test('דוח הקישורים השבורים: מונים, רשומות עם קישור לגלריה וקבצים בלי רשומה', async ({ page, worker }) => {
    worker.maintenance.brokenLinks = {
        report: {
            completedAt: Date.now() - 3600_000, checkedRecords: 120, checkedObjects: 400, notStored: 0,
            missingCount: 1, orphanCount: 2, orphanBytes: 3 * 1024 * 1024,
            missing: [{ id: 'img_e2e_7', title: 'ריקוד בהקפות', mediaType: 'image', missing: [{ kind: 'original', key: 'approved/u/img_e2e_7.jpg' }, { kind: 'thumb', key: 'variants/img_e2e_7/thumb.webp' }] }],
            orphans: [{ key: 'approved/u/lost.jpg', size: 2048, uploadedAt: Date.now() - 5 * DAY_MS }, { key: 'variants/ghost/thumb.webp', size: 100, uploadedAt: 0 }]
        },
        scanning: null
    };
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/admin.html#brokenlinks');

    await expect(page.locator('#view-brokenlinks')).toHaveClass(/is-active/);
    await expect(page.locator('#brokenLinksMissingCount')).toHaveText('1');
    await expect(page.locator('#brokenLinksOrphanCount')).toHaveText('2');
    await expect(page.locator('#brokenLinksStatus')).toContainText('נבדקו 120 רשומות ו-400 קבצים');
    const link = page.locator('#brokenLinksMissingList a');
    await expect(link).toHaveText('ריקוד בהקפות');
    await expect(link).toHaveAttribute('href', './#media/img_e2e_7');
    await expect(page.locator('#brokenLinksMissingList')).toContainText('חסר: הקובץ המקורי, תצוגה קטנה');
    await expect(page.locator('#brokenLinksOrphansList .admin-row')).toHaveCount(2);
    await expect(page.locator('#brokenLinksOrphansList')).toContainText('approved/u/lost.jpg');
});

test('מנהל רגיל אינו רואה את מסכי התחזוקה ואינו פונה לנתיבים שלהם', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/admin.html#brokenlinks');
    await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
    await expect(page.locator('#view-brokenlinks')).not.toHaveClass(/is-active/);
    await expect(page.locator('#adminNav')).not.toContainText('קישורים שבורים');
    await expect(page.locator('#adminNav [data-view-target="backup"]')).toHaveCount(0);
    await page.evaluate(() => window.openAdminView('backup'));
    await expect(page.locator('#view-backup')).not.toHaveClass(/is-active/);
    await page.waitForTimeout(300);
    expect(worker.requestsTo('GET', '/maintenance/')).toHaveLength(0);
});

test('סל המחזור מראה בעוד כמה ימים כל פריט יימחק לצמיתות', async ({ page, worker }) => {
    const deletedAt = Date.now() - 10 * DAY_MS - 60_000;
    worker.seed('trashItems', 'trash_e2e_1', {
        id: 'trash_e2e_1', originalType: 'image', originalId: 'img_old', originalCollection: 'images',
        targetName: 'תמונה ישנה', record: { id: 'img_old', title: 'תמונה ישנה' }, deletedAt, deletedByName: 'מנהלת העל'
    });
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/admin.html#trash');
    await expect(page.locator('#trashItemsList')).toContainText('יימחק לצמיתות בעוד 20 ימים');
});

test('הגדרת סימן המים: מנהל רגיל אינו יכול לשמור אותה גם בעקיפת הלוח', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/admin.html');
    await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
    const status = await page.evaluate(async () => {
        const { doc, setDoc } = window.firestoreModules;
        try {
            await setDoc(doc(window.db, 'artifacts', window.appId, 'public', 'data', 'systemMeta', 'downloadPrivacy'), { watermarkEnabled: false });
            return 'saved';
        } catch (error) {
            return String(error.status || error.code || error.message);
        }
    });
    expect(status).not.toBe('saved');
    expect(worker.collection('systemMeta').has('downloadPrivacy')).toBe(false);
});
