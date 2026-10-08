// עדכון כפוי: כשעולה גרסה חדשה של האתר הדף מתרענן מיד, ובאמצע העלאה —
// ברגע שהיא מסתיימת.
import { test, expect } from './fixtures.mjs';

function versionBody(revision) {
    return JSON.stringify({ revision, builtAt: `2026-10-08T00:00:0${revision.length}Z` });
}

async function serveVersion(page, state) {
    await page.route(url => url.pathname.endsWith('/version.json'), route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: { 'Cache-Control': 'no-store' },
        body: versionBody(state.revision)
    }));
}

// באמצע הרענון עצמו ההקשר של הדף נהרס; הבדיקה פשוט מנסה שוב ברגע הבא.
const navigationType = page => page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type || '').catch(() => '');

test('גרסה חדשה מרעננת את הדף מיד', async ({ page }) => {
    const state = { revision: 'a1' };
    await serveVersion(page, state);
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.SITE_BUILD?.revision)).toBe('a1');
    expect(await navigationType(page)).toBe('navigate');

    state.revision = 'b22';
    await page.evaluate(() => window.checkForSiteUpdate());
    await expect.poll(() => navigationType(page)).toBe('reload');
    await expect.poll(() => page.evaluate(() => window.SITE_BUILD?.revision)).toBe('b22');
    // ההגנה מלולאה נרשמה ללשונית.
    expect(await page.evaluate(() => sessionStorage.getItem('simchas_gallery_reloaded_for'))).toContain('b22');
});

test('באמצע העלאה הרענון ממתין, מודיע, ומתבצע כשההעלאה מסתיימת', async ({ page }) => {
    const state = { revision: 'a1' };
    await serveVersion(page, state);
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.SITE_BUILD?.revision)).toBe('a1');

    await page.evaluate(() => window.markSiteBusy('upload'));
    state.revision = 'b22';
    await page.evaluate(() => window.checkForSiteUpdate());
    await expect(page.locator('#customAlertMessage')).toContainText('גרסה חדשה');
    await page.waitForTimeout(1500);
    expect(await navigationType(page)).toBe('navigate');

    await page.evaluate(() => window.clearSiteBusy('upload'));
    await expect.poll(() => navigationType(page), { timeout: 15_000 }).toBe('reload');
});
