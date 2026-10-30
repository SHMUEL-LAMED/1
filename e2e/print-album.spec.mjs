// אלבום להדפסה: מעמוד האירוע (התיקייה כולה, גם מעבר לעמוד הראשון) ומהבחירה
// המרובה. window.print מוחלף ברשם, כך שהבדיקה בודקת את העמודים שנבנו — השער,
// מספר העמודים, הכיתובים והמקורות — בלי לפתוח חלון הדפסה אמיתי.
import {
    test, expect, seedSession, imageRecord, mediaUrl, variantEntries, variantUrl,
    DEFAULT_FOLDERS, DEFAULT_USER
} from './fixtures.mjs';

const EVENT_FOLDERS = DEFAULT_FOLDERS.map(folder => (folder.id === '2'
    ? { ...folder, isDefault: false, eventDate: '2025-10-15', description: 'ההקפות בבית המדרש <b>הגדול</b>' }
    : folder));

// לפני שקוד האתר רץ: print רושם את הקריאה ואת מצב הדף באותו רגע.
async function stubPrint(page) {
    await page.addInitScript(() => {
        window.__printCalls = [];
        window.print = () => {
            const root = document.getElementById('printAlbum');
            window.__printCalls.push({
                printing: document.body.classList.contains('is-printing-album'),
                pages: root?.querySelectorAll('.print-album-page').length || 0,
                imagesReady: [...(root?.querySelectorAll('img') || [])].every(image => image.complete && image.naturalWidth > 0)
            });
        };
    });
}

const printCalls = page => page.evaluate(() => window.__printCalls);

function openEventPage(page, folderName) {
    return page.locator('#folderList .collection-card', { hasText: folderName })
        .locator('button[aria-label^="פתיחת עמוד האירוע"]').click();
}

test('אלבום מעמוד האירוע: שער עם התאריך העברי, ארבע תמונות בעמוד וכיתובים מוברחים', async ({ page, worker }) => {
    worker.seedFolders(EVENT_FOLDERS).seedImages([
        imageRecord(1, { folderId: '2', title: 'פתיחת הארון', caption: 'כל הקהל עומד.', variants: variantEntries('img_e2e_1'), variantsVersion: 1 }),
        imageRecord(2, { folderId: '2', title: '<img src=x onerror="window.__xss=1">' }),
        imageRecord(3, { folderId: '2', title: 'הקפה שנייה' }),
        imageRecord(4, {
            folderId: '2', title: 'סרטון הריקודים', mediaType: 'video', mimeType: 'video/mp4',
            url: mediaUrl('img_e2e_4').replace(/\.jpg$/, '.mp4'), variants: variantEntries('img_e2e_4', ['poster', 'thumb']), variantsVersion: 1
        }),
        imageRecord(5, { folderId: '2', title: 'סיום' }),
        // סרטון בלי פוסטר אין מה להדפיס.
        imageRecord(6, { folderId: '2', title: 'סרטון בלי פוסטר', mediaType: 'video', mimeType: 'video/mp4', url: mediaUrl('img_e2e_6').replace(/\.jpg$/, '.mp4') }),
        imageRecord(7, { folderId: '1', title: 'מתיקייה אחרת' })
    ]);
    await seedSession(page, { worker });
    await stubPrint(page);
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(7);

    await openEventPage(page, 'טיולים וסיורים');
    const eventPage = page.locator('#eventPageModal');
    await expect(eventPage).toBeVisible();
    await eventPage.getByRole('button', { name: 'אלבום להדפסה' }).click();

    const dialog = page.getByRole('dialog', { name: 'אלבום להדפסה' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#printAlbumSummary')).toHaveText('טיולים וסיורים · 6 פריטים');
    // ברירת המחדל: שתיים בעמוד.
    await expect(dialog.getByRole('radio', { name: 'שתיים' })).toBeChecked();
    await dialog.getByText('ארבע', { exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'ארבע' })).toBeChecked();
    await dialog.getByRole('button', { name: 'הכן והדפס' }).click();

    await expect.poll(async () => (await printCalls(page)).length).toBe(1);
    // ההדפסה נקראה כשהעמודים מוכנים, כל התמונות טעונות, והדף במצב הדפסת אלבום.
    expect((await printCalls(page))[0]).toEqual({ printing: true, pages: 3, imagesReady: true });
    await expect(dialog).toBeHidden();
    await expect(page.locator('#customAlertMessage')).toContainText('סרטון אחד בלי תמונת פוסטר לא נכלל');

    const album = page.locator('#printAlbum');
    await expect(album).toHaveAttribute('data-per-page', '4');
    await expect(album.locator('.print-album-page')).toHaveCount(3);
    const cover = album.locator('.print-album-cover');
    await expect(cover.locator('.print-album-title')).toHaveText('טיולים וסיורים');
    await expect(cover.locator('.print-album-date')).toHaveText('כ״ג בתשרי תשפ״ו');
    await expect(cover.locator('.print-album-gregorian')).toHaveText('15.10.2025');
    await expect(cover.locator('.print-album-count')).toHaveText('4 תמונות וסרטון אחד');
    await expect(cover.locator('.print-album-description')).toHaveText('ההקפות בבית המדרש <b>הגדול</b>');

    // לפי סדר הצילום (כאן — ההעלאה), מהמוקדם למאוחר: 4 ואז 1.
    const photoPages = album.locator('.print-album-photos');
    await expect(photoPages.nth(0).locator('.print-album-item')).toHaveCount(4);
    await expect(photoPages.nth(1).locator('.print-album-item')).toHaveCount(1);
    const titles = album.locator('.print-album-item-title');
    await expect(titles).toHaveText(['פתיחת הארון', '<img src=x onerror="window.__xss=1">', 'הקפה שנייה', 'סרטון הריקודים', 'סיום']);
    await expect(album.locator('.print-album-item').first().locator('.print-album-item-caption')).toHaveText('כל הקהל עומד.');
    await expect(album.locator('.print-album-item').first().locator('.print-album-item-date')).toHaveText(/^[א-ת״׳ ]+$/);

    // התצוגה הבינונית, המקור כשאין תצוגות, והפוסטר של הסרטון.
    const sources = album.locator('.print-album-image');
    await expect(sources).toHaveCount(5);
    await expect(sources.nth(0)).toHaveAttribute('src', variantUrl('img_e2e_1', 'medium'));
    await expect(sources.nth(1)).toHaveAttribute('src', mediaUrl('img_e2e_2'));
    await expect(sources.nth(3)).toHaveAttribute('src', variantUrl('img_e2e_4', 'poster'));
    // הטקסט לא הפך למרקאפ: אין תמונה נוספת ואין קוד שרץ.
    await expect(album.locator('img')).toHaveCount(6);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();

    // הבחירה נשמרה לצופה, ואחרי ההדפסה העמודים יוצאים מהדף.
    expect(await page.evaluate(() => localStorage.getItem('simchat-gallery-album-per-page'))).toBe('4');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(album.locator('.print-album-page')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/is-printing-album/);
    // עמוד האירוע נשאר פתוח מתחת לחלון שנסגר.
    await expect(eventPage).toBeVisible();
});

test('אלבום של תיקייה גדולה כולל גם פריטים שמעבר לעמוד הראשון', async ({ page, worker }) => {
    const records = Array.from({ length: 130 }, (_, index) => imageRecord(index + 1, { folderId: '2' }));
    worker.seedFolders(EVENT_FOLDERS).seedImages(records);
    await seedSession(page, { worker });
    await stubPrint(page);
    await page.addInitScript(() => localStorage.setItem('simchat-gallery-album-per-page', '4'));
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card').first()).toBeVisible();

    await openEventPage(page, 'טיולים וסיורים');
    await page.locator('#eventPageModal').getByRole('button', { name: 'אלבום להדפסה' }).click();
    const dialog = page.getByRole('dialog', { name: 'אלבום להדפסה' });
    await expect(dialog.getByRole('radio', { name: 'ארבע' })).toBeChecked();
    await dialog.getByRole('button', { name: 'הכן והדפס' }).click();

    await expect.poll(async () => (await printCalls(page)).length, { timeout: 20_000 }).toBe(1);
    // 130 תמונות, ארבע בעמוד: 33 עמודים ועוד השער.
    await expect(page.locator('#printAlbum .print-album-page')).toHaveCount(34);
    await expect(page.locator('#printAlbum .print-album-count')).toHaveText('130 תמונות');
    await expect(page.locator('#printAlbum .print-album-item-title').first()).toHaveText('תמונה 1');
    await expect(page.locator('#printAlbum .print-album-item-title').last()).toHaveText('תמונה 130');
});

test('אלבום של התיקייה הפעילה בגלריה נטען דרך loadMoreImages, והגלריה מקבלת את התיקייה כולה בלי כפילויות', async ({ page, worker }) => {
    const records = Array.from({ length: 130 }, (_, index) => imageRecord(index + 1, { folderId: '2' }));
    worker.seedFolders(EVENT_FOLDERS).seedImages(records);
    await seedSession(page, { worker });
    await stubPrint(page);
    await page.goto('/');
    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    await expect(page.locator('#photosGrid .gallery-card').first()).toBeVisible();
    expect(await page.evaluate(() => window.state.imagesHasMore)).toBe(true);

    await openEventPage(page, 'טיולים וסיורים');
    await page.locator('#eventPageModal').getByRole('button', { name: 'אלבום להדפסה' }).click();
    await page.getByRole('dialog', { name: 'אלבום להדפסה' }).getByRole('button', { name: 'הכן והדפס' }).click();

    await expect.poll(async () => (await printCalls(page)).length, { timeout: 20_000 }).toBe(1);
    await expect(page.locator('#printAlbum .print-album-count')).toHaveText('130 תמונות');
    // התיקייה נטענה כולה אל הגלריה עצמה, בלי כפילויות.
    expect(await page.evaluate(() => ({
        total: window.state.images.length,
        unique: new Set(window.state.images.map(item => item.id)).size,
        hasMore: window.state.imagesHasMore
    }))).toEqual({ total: 130, unique: 130, hasMore: false });
});

test('אלבום PDF מהבחירה המרובה: תמונה בעמוד, ותמונה שלא נטענה יוצאת מהאלבום', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2), imageRecord(3), imageRecord(4, { folderId: '3' })]);
    worker.missingMedia.add(`approved/${DEFAULT_USER.uid}/img_e2e_2.jpg`);
    await seedSession(page, { worker, role: 'admin' });
    await stubPrint(page);
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);

    await page.evaluate(() => {
        window.toggleBulkSelectionMode(true);
        ['img_e2e_1', 'img_e2e_2', 'img_e2e_3'].forEach(id => window.toggleMediaSelection(null, id));
    });
    await expect(page.locator('#bulkSelectedCount')).toHaveText('3');
    await page.locator('#bulkSelectionBar').getByRole('button', { name: 'אלבום PDF' }).click();

    const dialog = page.getByRole('dialog', { name: 'אלבום להדפסה' });
    await expect(dialog.locator('#printAlbumSummary')).toHaveText('אירועים ופעילויות · 3 פריטים');
    await dialog.getByText('תמונה אחת', { exact: true }).click();
    await dialog.getByRole('button', { name: 'הכן והדפס' }).click();

    await expect.poll(async () => (await printCalls(page)).length).toBe(1);
    const album = page.locator('#printAlbum');
    await expect(album).toHaveAttribute('data-per-page', '1');
    await expect(album.locator('.print-album-page')).toHaveCount(3);
    await expect(album.locator('.print-album-title')).toHaveText('אירועים ופעילויות');
    await expect(album.locator('.print-album-count')).toHaveText('2 תמונות');
    await expect(album.locator('.print-album-item-title')).toHaveText(['תמונה 1', 'תמונה 3']);
    await expect(page.locator('#customAlertMessage')).toContainText('תמונה אחת לא נטענה ולא נכללה');
});

test('ביטול באמצע הטעינה עוצר הכול: אין הדפסה ואין עמודים', async ({ page, worker }) => {
    // לשנייה יש תצוגה בינונית: הכרטיס מציג את הקטנה, והאלבום מבקש את הבינונית —
    // כתובת שהדף עוד לא טען, ולכן היא באמת יוצאת לרשת.
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2, { variants: variantEntries('img_e2e_2'), variantsVersion: 1 })]);
    await seedSession(page, { worker, role: 'admin' });
    await stubPrint(page);
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);

    // התצוגה הבינונית אינה עונה לעולם (הנתיב של הדף קודם לזיוף שבהקשר).
    await page.route(variantUrl('img_e2e_2', 'medium'), () => {});
    await page.evaluate(() => {
        window.toggleBulkSelectionMode(true);
        window.toggleSelectAllVisibleMedia();
    });
    await page.locator('#bulkSelectionBar').getByRole('button', { name: 'אלבום PDF' }).click();
    const dialog = page.getByRole('dialog', { name: 'אלבום להדפסה' });
    await dialog.getByRole('button', { name: 'הכן והדפס' }).click();

    await expect(dialog.locator('#printAlbumStatus')).toHaveText('טוען תמונות… 1 מתוך 2');
    await expect(dialog.getByRole('button', { name: 'הכן והדפס' })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: 'שתיים' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // פתיחה מחדש: החלון נקי ופעיל, ושום הדפסה לא קרתה.
    await page.locator('#bulkSelectionBar').getByRole('button', { name: 'אלבום PDF' }).click();
    await expect(dialog.locator('#printAlbumProgress')).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'הכן והדפס' })).toBeEnabled();
    expect(await printCalls(page)).toEqual([]);
    await expect(page.locator('#printAlbum .print-album-page')).toHaveCount(0);
});
