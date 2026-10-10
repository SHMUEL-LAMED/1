import { test, expect, seedSession } from './fixtures.mjs';

test('הפעלת AI ועצירה נשמרות בענן בלי עיבוד בדפדפן המשתמש', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="aititles"]').click();
    await expect(page.locator('#aiTitlesSummary')).toContainText('2 תמונות ממתינות');
    await expect(page.locator('#aiTitlesStatus')).toContainText('פעיל בענן');
    await page.locator('#aiTitlesStop').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('מושהה');
    await page.locator('#aiTitlesStart').click();
    // "אפשר לסגור את הדפדפן" מופיע גם במצב המושהה, ולכן ממתינים למצב הפעיל
    // עצמו — הוא מוצג רק אחרי שההפעלה נשמרה בענן ונקראה ממנו שוב.
    await expect(page.locator('#aiTitlesStatus')).toContainText('פעיל בענן');
    await expect(page.locator('#aiTitlesStatus')).toContainText('אפשר לסגור את הדפדפן');
    expect(worker.backgroundConfig.enabled.titles).toBe(true);
    expect(worker.requestsTo('POST', '/ai-title')).toHaveLength(0);
    await page.reload();
    await page.locator('#adminNav [data-view-target="aititles"]').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('פעיל בענן');
});
