// אלבום בענן (print-album-ui.js → POST /album/pdf): הרשימה נשלחת לשרת, הקובץ
// יורד מהקישור שחזר, ואין חלון הדפסה ואין טעינת תמונות בדפדפן. כשהשרת אינו
// מכיר את הנתיב (Worker ישן) — המסלול המקומי, ב-print-album.spec.mjs.
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

test('אלבום בענן: הרשימה נשלחת ל-/album/pdf, הקובץ יורד, ואין חלון הדפסה', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2), imageRecord(3)]);
    await seedSession(page, { worker, role: 'admin' });
    await page.addInitScript(() => {
        window.__printCalls = 0;
        window.print = () => { window.__printCalls += 1; };
    });
    const requests = [];
    await page.route('**/album/pdf', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { success: true, url: 'https://album.example/album/file/u/abc', fileName: 'אלבום.pdf', items: 2, skipped: 0, pages: 2 } });
    });
    await page.route('https://album.example/**', route => route.fulfill({
        body: '%PDF-1.7', contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="album.pdf"' }
    }));
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);

    await page.evaluate(() => {
        window.toggleBulkSelectionMode(true);
        ['img_e2e_1', 'img_e2e_3'].forEach(id => window.toggleMediaSelection(null, id));
    });
    await page.locator('#bulkSelectionBar').getByRole('button', { name: 'אלבום PDF' }).click();
    const dialog = page.getByRole('dialog', { name: 'אלבום להדפסה' });
    await expect(dialog.locator('.field-hint')).toContainText('נוצר בענן');
    await dialog.getByText('ארבע', { exact: true }).click();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'הכן והדפס' }).click();

    expect((await download).url()).toBe('https://album.example/album/file/u/abc');
    expect(requests).toHaveLength(1);
    expect(requests[0].perPage).toBe(4);
    expect(requests[0].ids.sort()).toEqual(['img_e2e_1', 'img_e2e_3']);
    await expect(dialog).toBeHidden();
    await expect(page.locator('#customAlertMessage')).toContainText('האלבום מוכן (2 עמודים)');
    expect(await page.evaluate(() => window.__printCalls)).toBe(0);
    await expect(page.locator('#printAlbum .print-album-page')).toHaveCount(0);
});
