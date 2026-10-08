// דף הניהול: מי רואה את הלוח ומי מקבל את שער הגישה.
import { test, expect, seedSession } from './fixtures.mjs';

test('מנהל מאושר רואה את לוח הניהול', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/admin.html');

    await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
    await expect(page.locator('#adminAccessGate')).toBeHidden();
    await expect(page.locator('#headerConnectionStatus')).toHaveText('גישה מאושרת');
    await expect(page.locator('#adminCurrentUserName')).toHaveText('מנהל הגלריה');
    // הלוח מושך את התוכן הממתין לאישור — נתיב שרק מנהל רשאי לקרוא.
    await expect.poll(() => worker.requestsTo('GET', '/data/pendingImages').length).toBeGreaterThan(0);
});

test('צופה מאושר מקבל בדף הניהול שער גישה, לא לוח ריק', async ({ page, worker }) => {
    await seedSession(page, { worker, role: 'viewer' });
    await page.goto('/admin.html');

    await expect(page.locator('#adminAccessGate')).toBeVisible();
    await expect(page.locator('#adminAccessGateTitle')).toHaveText('החשבון אינו מורשה לניהול');
    await expect(page.locator('#sidebarAdminPanel')).toBeHidden();
    await expect(page.locator('#headerConnectionStatus')).toHaveText('גישה מאושרת');
});

test('אורח בדף הניהול מתבקש להתחבר', async ({ page }) => {
    await page.goto('/admin.html');

    await expect(page.locator('#adminAccessGate')).toBeVisible();
    await expect(page.locator('#adminAccessGateTitle')).toHaveText('לוח הניהול דורש התחברות');
    await expect(page.locator('#sidebarAdminPanel')).toBeHidden();
    await expect(page.locator('#adminAccessGate [data-official-google-button-host]')).toHaveText('[google]');
});
