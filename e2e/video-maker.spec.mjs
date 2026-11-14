// יוצר הסרטונים: מעמוד האירוע ומהבחירה המרובה. הבדיקה מקליטה סרטון קצר
// באמת (MediaRecorder של Chromium) ובודקת שהתקבל קובץ וידאו שניתן לנגן.
import { test, expect, seedSession, imageRecord, DEFAULT_FOLDERS } from './fixtures.mjs';

const EVENT_FOLDERS = DEFAULT_FOLDERS.map(folder => (folder.id === '2' ? { ...folder, isDefault: false } : folder));

function openEventPage(page, folderName) {
    return page.locator('#folderList .collection-card', { hasText: folderName })
        .locator('button[aria-label^="פתיחת עמוד האירוע"]').click();
}

test('סרטון מעמוד האירוע: תצוגה מקדימה, הקלטה, נגינה והורדה', async ({ page, worker }) => {
    test.setTimeout(90_000);
    worker.seedFolders(EVENT_FOLDERS).seedImages([
        imageRecord(1, { folderId: '2', title: 'פתיחת הארון', caption: 'כל הקהל עומד' }),
        imageRecord(2, { folderId: '2', title: 'הקפה שנייה' }),
        imageRecord(3, { folderId: '1', title: 'מתיקייה אחרת' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);

    await openEventPage(page, 'טיולים וסיורים');
    await page.locator('#eventPageModal').getByRole('button', { name: 'צור סרטון מהאלבום' }).click();
    const dialog = page.getByRole('dialog', { name: 'יצירת סרטון מהאלבום' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#videoMakerSummary')).toContainText('טיולים וסיורים · 2 תמונות');

    // סרטון קצר לבדיקה: שתי שניות לתמונה, בלי שקופיות פתיחה וסיום.
    await dialog.getByLabel('זמן לכל תמונה').selectOption('2');
    await dialog.getByLabel('שקופיות פתיחה וסיום').uncheck();
    await dialog.getByLabel('סגנון המעברים').selectOption('circle');

    await dialog.getByRole('button', { name: 'תצוגה מקדימה' }).click();
    await expect(dialog).toHaveAttribute('data-mode', 'preview');
    await expect(dialog).toHaveAttribute('data-mode', 'idle', { timeout: 20_000 });
    // הבמה צוירה: יש פיקסלים לא שחורים בקנבס.
    const painted = await page.evaluate(() => {
        const canvas = document.getElementById('videoMakerCanvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4 * 97) if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
        return lit;
    });
    expect(painted).toBeGreaterThan(50);

    await dialog.getByRole('button', { name: 'צור סרטון' }).click();
    await expect(dialog).toHaveAttribute('data-mode', 'recording');
    const result = dialog.locator('#videoMakerResult');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator('#videoMakerResultMeta')).toContainText(/MP4|WebM/);
    const video = await result.evaluate(element => new Promise(resolve => {
        const done = () => resolve({ ready: element.readyState, width: element.videoWidth, height: element.videoHeight });
        if (element.readyState >= 1) done(); else element.addEventListener('loadedmetadata', done, { once: true });
    }));
    expect(video).toMatchObject({ width: 1280, height: 720 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'הורדת הסרטון' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^טיולים וסיורים\.(mp4|webm)$/);
});

test('סרטון מהבחירה המרובה נפתח עם הנבחרים בלבד, וסגירה עוצרת אותו', async ({ page, worker }) => {
    worker.seedFolders(EVENT_FOLDERS).seedImages([
        imageRecord(1, { folderId: '1' }), imageRecord(2, { folderId: '2' }), imageRecord(3, { folderId: '2' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    await page.evaluate(() => {
        window.state.selectedMediaIds = new Set(['img_e2e_2', 'img_e2e_3']);
        window.openSelectionVideoMaker();
    });
    const dialog = page.getByRole('dialog', { name: 'יצירת סרטון מהאלבום' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#videoMakerSummary')).toContainText('טיולים וסיורים · 2 תמונות');
    await dialog.getByRole('button', { name: 'תצוגה מקדימה' }).click();
    await expect(dialog).toHaveAttribute('data-mode', 'preview');
    await dialog.getByRole('button', { name: 'סגירת יוצר הסרטונים' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#videoMakerModal')).toHaveAttribute('data-mode', 'idle');
});
