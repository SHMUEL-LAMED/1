import { test, expect, seedSession } from './fixtures.mjs';

test('מנהל משלים שמות לתמונות והמשך מדלג על תמונות שכבר עובדו', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker, role: 'admin' });
    let calls = 0;
    await page.route('**/ai-title', async route => {
        calls += 1;
        const { imageId } = route.request().postDataJSON();
        const record = worker.collection('images').get(imageId);
        worker.seed('images', imageId, { ...record, title: 'בחורים רוקדים במעגל', aiTitleVersion: 1 });
        await route.fulfill({ json: { success: true, id: imageId, title: 'בחורים רוקדים במעגל' } });
    });
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="aititles"]').click();
    await expect(page.locator('#aiTitlesSummary')).toContainText('2 תמונות ממתינות');
    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('2 שמות נשמרו');
    await expect(page.locator('#aiTitlesSummary')).toContainText('0 תמונות ממתינות');
    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('0 שמות נשמרו');
    expect(calls).toBe(2);
});
