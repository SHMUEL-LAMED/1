// הגלריה עצמה: הכרטיסים, הסינון לפי תיקייה והתצוגה המלאה.
import { test, expect, seedSession, imageRecord, mediaUrl, MEDIA_SIZE } from './fixtures.mjs';

test('לחיצה על כרטיס פותחת את התצוגה המלאה עם התמונה, והצפייה נרשמת', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(3);
    // מיון ברירת המחדל: החדש ביותר ראשון.
    await expect(cards.first().locator('.gallery-title')).toHaveText('תמונה 3');
    await cards.first().locator('.gallery-media').click();

    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toHaveAttribute('aria-hidden', 'false');
    const image = page.locator('#lightboxImage');
    await expect(image).toHaveAttribute('src', mediaUrl('img_e2e_3'));
    // התמונה באמת נטענה (מהזיוף של ה-Worker), לא רק הוצבה.
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await expect(page.locator('#lightboxDetails')).toContainText('תיקייה: אירועים ופעילויות');
    await expect(page.locator('#lightboxCounter')).toHaveText('1 מתוך 3');
    await expect.poll(() => worker.requestsTo('PUT', '/data/mediaStats/img_e2e_3').length).toBe(1);
    expect(worker.collection('mediaStats').get('img_e2e_3')).toMatchObject({ id: 'img_e2e_3', views: 1 });

    await lightbox.locator('button[aria-label="התמונה הבאה"]').click();
    await expect(page.locator('#lightboxCounter')).toHaveText('2 מתוך 3');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
});

test('בחירת תיקייה מסננת את הכרטיסים, וכל הארכיון מחזיר את כולם', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { folderId: '1' }),
        imageRecord(2, { folderId: '2', title: 'טיול לצפון' }),
        imageRecord(3, { folderId: '1' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('#folderList .collection-card')).toHaveCount(5);

    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.gallery-title')).toHaveText('טיול לצפון');
    await expect(page.locator('#imageCounter')).toHaveText('1 פריטים');

    await page.locator('#folderList .collection-card-main', { hasText: 'כל הארכיון' }).click();
    await expect(cards).toHaveCount(3);
    await expect(page.locator('#imageCounter')).toHaveText('3 פריטים');
});
