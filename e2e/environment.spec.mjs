// בחירת הסביבה: מ-127.0.0.1 האתר פונה לסביבת הניסוי ומציג את הרצועה,
// ו-?api=production דורס את הבחירה ללשונית.
import { test, expect } from './fixtures.mjs';

test('אתר שמוגש ממארח מקומי פונה לסביבת הניסוי ומציג רצועה', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.API_ENVIRONMENT)).toBe('staging');
    await expect(page.locator('html')).toHaveAttribute('data-api-environment', 'staging');
    await expect(page.locator('.env-ribbon').first()).toBeVisible();
});

test('?api=production דורס את הבחירה, והרצועה נעלמת', async ({ page }) => {
    await page.goto('/?api=production');
    await expect.poll(() => page.evaluate(() => window.API_ENVIRONMENT)).toBe('production');
    await expect(page.locator('html')).toHaveAttribute('data-api-environment', 'production');
    await expect(page.locator('.env-ribbon').first()).toBeHidden();
});
