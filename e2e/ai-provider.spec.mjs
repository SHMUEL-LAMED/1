import { test, expect, seedSession } from './fixtures.mjs';

async function openSettings(page) {
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="aititles"]').click();
}

test('מנהל־על שומר מפתח Gemini בניהול והשדה מתרוקן לאחר שמירה', async ({page, worker}) => {
    worker.seedGallery({images:2});
    await seedSession(page,{worker,role:'super_admin'});
    const requests = [];
    let provider = 'openai', hasGeminiKey = false;
    await page.route('**/admin/ai-settings', async route => {
        if (route.request().method() === 'PUT') {
            const body = route.request().postDataJSON();
            requests.push(body); provider = body.provider; hasGeminiKey = Boolean(body.apiKey);
        }
        await route.fulfill({json:{success:true,provider,hasGeminiKey,hasOpenaiKey:true}});
    });
    await page.route('**/admin/ai-settings/test', route => route.fulfill({json:{success:true,available:true,provider:'gemini'}}));
    await openSettings(page);
    await expect(page.locator('#aiProviderForm')).toBeVisible();
    await expect(page.locator('#aiProviderKey')).toHaveAttribute('type','password');
    await page.locator('#aiProviderSelect').selectOption('gemini');
    await page.locator('#aiProviderKey').fill('AIza-test-placeholder-key-1234567890');
    await page.locator('#aiProviderTest').click();
    await expect(page.locator('#aiProviderStatus')).toContainText('החיבור לתיאור תמונות ולחיפוש תקין');
    await page.locator('#aiProviderSave').click();
    await expect(page.locator('#aiProviderStatus')).toContainText('ההגדרות נשמרו');
    await expect(page.locator('#aiProviderKey')).toHaveValue('');
    await expect(page.locator('#aiProviderKeyState')).toContainText('קיים מפתח שמור');
    expect(requests).toEqual([{provider:'gemini',apiKey:'AIza-test-placeholder-key-1234567890'}]);
    const stored = await page.evaluate(() => JSON.stringify({...localStorage,...sessionStorage}));
    expect(stored).not.toContain('AIza-test-placeholder-key-1234567890');
});

test('הגדרות המפתח אינן מוצגות למנהל רגיל', async ({page,worker}) => {
    worker.seedGallery({images:1});
    await seedSession(page,{worker,role:'admin'});
    await openSettings(page);
    await expect(page.locator('#aiTitlesSummary')).toBeVisible();
    await expect(page.locator('#aiProviderForm')).toBeHidden();
});
