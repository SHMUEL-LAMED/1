// תצוגה מקדימה של סרטון בכרטיס הגלריה: ריחוף (או מיקוד) מנגן כמה שניות
// מושתק ובתוך הכרטיס, יציאה עוצרת וחוזרת לפוסטר, ועד הריחוף שום בייט של
// הסרטון אינו יורד (preload="none"). מי שביקש פחות תנועה אינו מקבל ניגון.
// play/pause מוחלפים במונים, כי בבדיקה אין קובץ וידאו אמיתי לנגן.
import { test, expect, seedSession, imageRecord, variantEntries, variantUrl, API_ORIGIN, DEFAULT_USER } from './fixtures.mjs';

function videoRecord() {
    return imageRecord(1, {
        title: 'סרטון הקפות',
        url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_e2e_1.mp4`,
        r2Key: `approved/${DEFAULT_USER.uid}/img_e2e_1.mp4`,
        mediaType: 'video',
        mimeType: 'video/mp4',
        duration: 30,
        variants: variantEntries('img_e2e_1', ['poster', 'thumb']),
        variantsVersion: 1
    });
}

async function stubPlayback(page) {
    await page.addInitScript(() => {
        window.__videoCalls = { play: 0, pause: 0 };
        HTMLMediaElement.prototype.play = function() {
            window.__videoCalls.play += 1;
            window.__videoCalls.lastMuted = this.muted;
            return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function() { window.__videoCalls.pause += 1; };
    });
}

test('ריחוף על כרטיס סרטון מנגן אותו מושתק, ויציאה עוצרת וחוזרת לפוסטר', async ({ page, worker }) => {
    worker.seedFolders().seedImages([videoRecord(), imageRecord(2)]);
    await stubPlayback(page);
    await seedSession(page, { worker });
    await page.goto('/');

    const card = page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"]');
    const video = card.locator('video.gallery-card-img');
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(video).toHaveAttribute('poster', variantUrl('img_e2e_1', 'thumb'));

    await card.locator('.gallery-media').hover();
    await expect(card).toHaveClass(/is-previewing/);
    await expect.poll(() => page.evaluate(() => window.__videoCalls.play)).toBe(1);
    expect(await page.evaluate(() => window.__videoCalls.lastMuted)).toBe(true);
    expect(await video.evaluate(element => element.preload)).toBe('auto');

    // יציאה מהכרטיס: עוצר, ו-preload חוזר ל-none.
    await page.mouse.move(2, 2);
    await expect(card).not.toHaveClass(/is-previewing/);
    expect(await page.evaluate(() => window.__videoCalls.pause)).toBeGreaterThanOrEqual(1);
    expect(await video.evaluate(element => element.preload)).toBe('none');

    // כרטיס של תמונה אינו מפעיל דבר.
    await page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_2"] .gallery-media').hover();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__videoCalls.play)).toBe(1);
});

test('מיקוד מקלדת מפעיל את התצוגה המקדימה, ופתיחת התצוגה המלאה עוצרת אותה', async ({ page, worker }) => {
    worker.seedFolders().seedImages([videoRecord()]);
    await stubPlayback(page);
    await seedSession(page, { worker });
    await page.goto('/');

    const card = page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"]');
    await card.locator('.gallery-media').focus();
    await expect(card).toHaveClass(/is-previewing/);
    await card.locator('.gallery-media').click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(card).not.toHaveClass(/is-previewing/);
});

test('עם הפחתת תנועה אין תצוגה מקדימה בריחוף', async ({ page, worker }) => {
    worker.seedFolders().seedImages([videoRecord()]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubPlayback(page);
    await seedSession(page, { worker });
    await page.goto('/');

    const card = page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"]');
    await card.locator('.gallery-media').hover();
    await page.waitForTimeout(500);
    await expect(card).not.toHaveClass(/is-previewing/);
    expect(await page.evaluate(() => window.__videoCalls.play)).toBe(0);
    await expect(card.locator('video.gallery-card-img')).toHaveAttribute('preload', 'none');
});
