import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

test('חיפוש AI משתמש באינדקס בפנייה אחת, בלי לשלוח תמונות', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2)]);
    await seedSession(page, { worker });
    const requests = [];
    await page.route('**/ai-search', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { success:true, mode:'indexed', indexed:2000, pending:0, matches:['img_e2e_2'], documents:[{id:'img_e2e_2',data:imageRecord(2)}] } });
    });
    await page.goto('/');
    await page.locator('button[onclick="openAiImageSearchModal()"]').click();
    await page.locator('#aiImageSearchQuery').fill('בחורים לומדים בחברותא');
    await page.locator('#aiImageSearchSubmitBtn').click();
    await expect(page.locator('#aiImageSearchModal')).toBeHidden();
    await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['תמונה 2']);
    expect(requests).toEqual([{ query:'בחורים לומדים בחברותא' }]);
});

test('אינדקס שטרם הוכן מציג את מספר הממתינות בלי סריקת תמונות', async ({ page, worker }) => {
    worker.seedGallery({images:2});
    await seedSession(page, {worker});
    await page.route('**/ai-search', route => route.fulfill({json:{success:true,mode:'indexed',indexed:0,pending:250,matches:[],documents:[]}}));
    await page.goto('/');
    await page.locator('button[onclick="openAiImageSearchModal()"]').click();
    await page.locator('#aiImageSearchQuery').fill('ריקודים באולם');
    await page.locator('#aiImageSearchSubmitBtn').click();
    await expect(page.locator('#aiImageSearchStatus')).toContainText('250 תמונות ממתינות');
    await expect(page.locator('#aiImageSearchSubmitBtn')).toBeEnabled();
    await expect(page.locator('#aiImageSearchModal')).toBeVisible();
});
