// תיקיות מקוננות, תמונת שער, סדר ידני ועריכת סיבוב/חיתוך — בדפדפן אמיתי מול
// הזיוף של ה-Worker (שמחקה את הבדיקות שלו: הורה קיים, בלי מעגל, עד שלוש רמות,
// רק מנהל משנה order/edit, ו-POST /order).
import { readFileSync } from 'node:fs';
import { test, expect, seedSession, imageRecord, DEFAULT_FOLDERS, DEFAULT_USER, variantEntries } from './fixtures.mjs';
import { baseJpeg } from './jpeg-fixtures.mjs';

const NESTED = [
    ...DEFAULT_FOLDERS,
    { id: 'year', name: 'תשפ״ו', icon: 'calendar' },
    { id: 'event', name: 'שמחת תורה', icon: 'award', parentId: 'year' },
    { id: 'part', name: 'הקפות', icon: 'users', parentId: 'event' }
];

function seedNested(worker) {
    worker.seedFolders(NESTED).seedImages([
        imageRecord(1, { folderId: 'year', title: 'פתיחת השנה' }),
        imageRecord(2, { folderId: 'event', title: 'ריקודים' }),
        imageRecord(3, { folderId: 'event', title: 'ספר תורה' }),
        imageRecord(4, { folderId: 'part', title: 'הקפה ראשונה' }),
        imageRecord(5, { folderId: '1' })
    ]);
}

test('הרשימה מציגה תיקיות עליונות, המונה כולל את תת־התיקיות, ופתיחה מציגה פירורי לחם ותת־תיקיות', async ({ page, worker }) => {
    // הרבה צעדים בדפדפן (ובבדיקה הראשונה — גם דפדפן שני): זמן כפול.
    test.slow();
    seedNested(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    const folderList = page.locator('#folderList');
    // "כל הארכיון", ארבע ברירות המחדל ו"תשפ״ו" — בלי האירוע וההקפות.
    await expect(folderList.locator('.collection-card')).toHaveCount(6);
    const yearCard = folderList.locator('.collection-card[data-folder-id="year"]');
    // 1 שלה + 2 של האירוע + 1 של ההקפות.
    await expect(yearCard.locator('.collection-card-count strong')).toHaveText('4');
    await expect(yearCard.locator('.collection-card-child')).toHaveText(['שמחת תורה']);
    await expect(page.locator('#folderTotalCount')).toHaveText('7');

    await yearCard.locator('.collection-card-main').click();
    const context = page.locator('#folderContext');
    await expect(context).toBeVisible();
    await expect(context.locator('.folder-breadcrumb')).toHaveText(/כל הארכיון\s*›?\s*תשפ״ו/);
    await expect(context.locator('.subfolder-card')).toHaveCount(1);
    await expect(context.locator('.subfolder-card-count')).toHaveText('3 פריטים');
    // רק התמונות של התיקייה עצמה ברשת.
    await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['פתיחת השנה']);

    await context.locator('.subfolder-card').click();
    await expect(context.locator('.folder-breadcrumb li')).toHaveText(['כל הארכיון', 'תשפ״ו', 'שמחת תורה']);
    await expect(context.locator('[aria-current="page"]')).toHaveText('שמחת תורה');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);

    await context.locator('.folder-breadcrumb-link', { hasText: 'כל הארכיון' }).click();
    await expect(context).toBeHidden();
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(5);
});

test('שם תיקייה עם HTML מוצג כטקסט בכרטיס, בשבב ובפירורי הלחם', async ({ page, worker }) => {
    const evil = '<img src=x onerror="window.__xss=1">';
    worker.seedFolders([...DEFAULT_FOLDERS, { id: 'p', name: 'אב' }, { id: 'c', name: evil, parentId: 'p' }])
        .seedImages([imageRecord(1, { folderId: 'c' })]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#folderList .collection-card-child')).toHaveText(evil);
    await page.locator('#folderList .collection-card-child').click();
    await expect(page.locator('#folderContext [aria-current="page"]')).toHaveText(evil);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('רשומות ישנות בלי parentId — הרשימה כמו היום, בלי פירורי לחם בכל הארכיון', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#folderList .collection-card')).toHaveCount(5);
    await expect(page.locator('#folderList .collection-card-children')).toHaveCount(0);
    await expect(page.locator('#folderContext')).toBeHidden();
    // "סדר ידני" אינו מוצע בכל הארכיון.
    await expect(page.locator('#gallerySortSelect option[value="manual"]')).toBeDisabled();
    await page.locator('#folderList .collection-card-main', { hasText: 'אירועים ופעילויות' }).click();
    await expect(page.locator('#folderContext .folder-breadcrumb li')).toHaveText(['כל הארכיון', 'אירועים ופעילויות']);
    await expect(page.locator('#gallerySortSelect option[value="manual"]')).toBeEnabled();
});

test('מנהל־על: מחיקת תיקייה שיש בה תת־תיקיות נעצרת בהודעה, בלי להעביר תמונות לסל', async ({ page, worker }) => {
    seedNested(worker);
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/');
    await page.locator('#folderList .collection-card[data-folder-id="year"] .folder-card-delete').click();
    await expect(page.locator('#customAlertMessage')).toContainText('תת־תיקיות');
    expect(worker.collection('trashItems').size).toBe(0);
    expect(worker.collection('folders').has('year')).toBe(true);
});

test('לוח הניהול: יצירת תת־תיקייה והעברת תיקייה אל תוך אחרת, עם בדיקת עומק', async ({ page, worker }) => {
    // דף הניהול כבד בטעינה: זמן כפול.
    test.slow();
    seedNested(worker);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/admin.html#folders');
    await page.evaluate(() => window.openAdminView?.('folders'));

    const parentSelect = page.locator('#emptyFolderParent');
    await expect(parentSelect.locator('option[value="event"]')).toHaveCount(1);
    // ההקפות כבר ברמה השלישית — אין תחתיהן מקום.
    await expect(parentSelect.locator('option[value="part"]')).toHaveCount(0);
    await page.locator('#emptyFolderName').fill('צילומי משפחה');
    await parentSelect.selectOption('event');
    await page.locator('#emptyFolderName').press('Enter');
    await page.locator('#confirmModal button', { hasText: /אישור|כן|המשך/ }).first().click();
    await expect.poll(() => [...worker.collection('folders').values()].find(folder => folder.name === 'צילומי משפחה')?.parentId).toBe('event');

    // העברת "טיולים וסיורים" אל תוך "תשפ״ו".
    const row = page.locator('#adminFolderList .admin-folder-row[data-folder-id="2"]');
    await row.locator('select').selectOption('year');
    await page.locator('#confirmModal button', { hasText: /אישור|כן|המשך/ }).first().click();
    await expect.poll(() => worker.collection('folders').get('2')?.parentId).toBe('year');
    await expect(page.locator('#adminFolderList .admin-folder-row[data-folder-id="2"]')).toHaveAttribute('data-depth', '2');

    // "תשפ״ו" (עם שתי רמות מתחתיה) אינה יכולה להיכנס תחת תיקייה אחרת.
    await expect(page.locator('#adminFolderList .admin-folder-row[data-folder-id="year"] select option[value="1"]')).toHaveCount(0);
});

test('תמונת שער מהתצוגה המלאה: הכרטיס מציג אותה, ולחיצה נוספת מחזירה את הסמל', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { variants: variantEntries('img_e2e_1') }),
        imageRecord(2)
    ]);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"] .gallery-media').click();
    const coverButton = page.locator('#lightboxSetCover');
    await expect(coverButton).toBeVisible();
    await expect(coverButton).toHaveAttribute('aria-pressed', 'false');
    await coverButton.click();
    await expect.poll(() => worker.collection('folders').get('1')?.coverImageId).toBe('img_e2e_1');
    await expect(coverButton).toHaveAttribute('aria-pressed', 'true');
    const cover = page.locator('#folderList .collection-card[data-folder-id="1"] .collection-card-cover');
    await expect(cover).toHaveAttribute('src', /variants\/img_e2e_1\/thumb/);

    await coverButton.click();
    await expect.poll(() => 'coverImageId' in (worker.collection('folders').get('1') || {})).toBe(false);
    await expect(cover).toHaveCount(0);
});

test('שער שהתמונה שלו נמחקה — הכרטיס חוזר לסמל, וצופה אינו רואה את כלי המנהל', async ({ page, worker }) => {
    worker.seedFolders([...DEFAULT_FOLDERS.filter(folder => folder.id !== '1'), { ...DEFAULT_FOLDERS[1], coverImageId: 'img_gone' }])
        .seedImages([imageRecord(1)]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#folderList .collection-card[data-folder-id="1"]')).toBeVisible();
    await expect.poll(() => worker.requestsTo('GET', '/data/images?').some(entry => entry.path.includes('ids=img_gone'))).toBe(true);
    await expect(page.locator('#folderList .collection-card-cover')).toHaveCount(0);
    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(page.locator('#lightboxSetCover')).toBeHidden();
    await expect(page.locator('#lightboxEditMedia')).toBeHidden();
    await expect(page.locator('#lightboxDownloadOriginal')).toBeHidden();
});

test('סדר ידני: הזזה בכפתורים, שמירה של מה שהשתנה בלבד, וצופה מקבל את הסדר כברירת מחדל', async ({ page, worker, browser }) => {
    // הרבה צעדים בדפדפן (ובבדיקה הראשונה — גם דפדפן שני): זמן כפול.
    test.slow();
    worker.seedFolders().seedImages([1, 2, 3, 4].map(index => imageRecord(index, { takenAt: Date.UTC(2026, 8, index, 10) })));
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await page.locator('#folderList .collection-card-main', { hasText: 'אירועים ופעילויות' }).click();
    const titles = page.locator('#photosGrid .gallery-card .gallery-title');
    await expect(titles).toHaveCount(4);

    await page.locator('#galleryArrangeButton').click();
    await expect(page.locator('#arrangeBar')).toBeVisible();
    // בסדר הידני, בלי דירוגים: מהישן לחדש.
    await expect(titles).toHaveText(['תמונה 1', 'תמונה 2', 'תמונה 3', 'תמונה 4']);
    await page.locator('#photosGrid .arrange-move[data-media-id="img_e2e_3"][data-arrange-move="-1"]').click();
    await expect(titles).toHaveText(['תמונה 1', 'תמונה 3', 'תמונה 2', 'תמונה 4']);
    await expect(page.locator('#arrangeStatus')).toContainText('מקום 2');
    // המקלדת: הפוקוס חוזר לכפתור שזז, ועוד Enter מקדם שוב.
    await expect(page.locator('#photosGrid .arrange-move[data-media-id="img_e2e_3"][data-arrange-move="-1"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(titles).toHaveText(['תמונה 3', 'תמונה 1', 'תמונה 2', 'תמונה 4']);
    expect(worker.orderWrites).toHaveLength(0);

    await page.locator('#arrangeDefaultToggle').check();
    await page.locator('#arrangeBar [data-arrange-action="save"]').click();
    await expect(page.locator('#arrangeBar')).toHaveCount(0);
    await expect.poll(() => worker.orderWrites.length).toBe(1);
    // רק הפריט שזז מקבל דירוג; השאר נשארים בסדר שלהם, בלי כתיבה.
    expect(worker.orderWrites[0].items.map(item => item.id)).toEqual(['img_e2e_3']);
    expect(worker.collection('folders').get('1').manualOrder).toBe(true);
    await expect(titles).toHaveText(['תמונה 3', 'תמונה 1', 'תמונה 2', 'תמונה 4']);

    // צופה אחר: התיקייה נפתחת בסדר הידני.
    const viewerContext = await browser.newContext();
    const { installRoutes } = await import('./fixtures.mjs');
    await installRoutes(viewerContext, worker);
    const viewer = await viewerContext.newPage();
    await seedSession(viewer, { worker, uid: 'viewer-2', email: 'viewer2@example.com' });
    await viewer.goto('/');
    await viewer.locator('#folderList .collection-card-main', { hasText: 'אירועים ופעילויות' }).click();
    await expect(viewer.locator('#gallerySortSelect')).toHaveValue('manual');
    await expect(viewer.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['תמונה 3', 'תמונה 1', 'תמונה 2', 'תמונה 4']);
    await expect(viewer.locator('#galleryArrangeButton')).toBeHidden();
    await viewerContext.close();
});

test('עריכה: סיבוב נשמר ברשומה, התצוגות נוצרות מחדש עם מזהה העריכה, ו"בטל עריכה" מחזיר למקור', async ({ page, worker }) => {
    // הרבה צעדים בדפדפן (ובבדיקה הראשונה — גם דפדפן שני): זמן כפול.
    test.slow();
    worker.seedFolders().seedImages([imageRecord(1, { variants: variantEntries('img_e2e_1'), variantsVersion: 1 })]);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    await page.locator('#lightboxEditMedia').click();
    const editor = page.locator('#mediaEditModal');
    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-edit-loading]')).toBeHidden();
    await editor.locator('[data-edit-action="rotate-right"]').click();
    await editor.locator('[data-crop-field="w"]').fill('50');
    await editor.locator('[data-crop-field="w"]').press('Tab');
    await editor.locator('[data-edit-action="save"]').click();
    await expect(editor).toBeHidden();

    await expect.poll(() => worker.collection('images').get('img_e2e_1')?.edit?.rotate).toBe(90);
    const { edit } = worker.collection('images').get('img_e2e_1');
    expect(edit.crop).toMatchObject({ x: 0, y: 0, w: 0.5, h: 1 });
    await expect.poll(() => worker.collection('images').get('img_e2e_1')?.variants?.thumb?.editRev).toBe(edit.rev);
    expect(worker.collection('images').get('img_e2e_1').variants.medium.url).toContain(`?v=${edit.rev}`);
    // הכרטיס מציג את התצוגה הערוכה (הכתובת עם ?v=), בלי נפילה אל המקור הלא ערוך.
    await expect(page.locator('#photosGrid .gallery-card-img').first()).toHaveAttribute('src', new RegExp(`\\?v=${edit.rev}`));
    await expect(page.locator('#photosGrid .gallery-card-img').first()).not.toHaveAttribute('data-fallback-src', /.+/);
    await expect(page.locator('#lightboxDownloadOriginal')).toBeVisible();

    await page.locator('#lightboxEditMedia').click();
    await expect(editor.locator('[data-edit-action="undo"]')).toBeVisible();
    await expect(editor.locator('[data-edit-loading]')).toBeHidden();
    await editor.locator('[data-edit-action="undo"]').click();
    await expect.poll(() => 'edit' in (worker.collection('images').get('img_e2e_1') || {})).toBe(false);
    expect(worker.collection('images').get('img_e2e_1').variants.thumb.editRev).toMatch(/^o/);
    await expect(page.locator('#lightboxDownloadOriginal')).toBeHidden();
});

test('צופה: תמונה ערוכה שהתצוגות שלה עוד לא נוצרו מוצגת ערוכה מהמקור, והורדת JPEG ערוכה כברירת מחדל', async ({ page, worker }) => {
    const edit = { rotate: 90, crop: null, rev: 'abc123' };
    worker.seedFolders().seedImages([imageRecord(1, { edit })]);
    worker.objects.set(`approved/${DEFAULT_USER.uid}/img_e2e_1.jpg`, { bytes: Buffer.from(baseJpeg()), contentType: 'image/jpeg' });
    await seedSession(page, { worker });
    await page.goto('/');
    const card = page.locator('#photosGrid .gallery-card-img').first();
    await expect(card).toHaveAttribute('data-media-edit', /"rotate":90/);
    await expect(card).toHaveAttribute('src', /^blob:/);
    // אחרי סיבוב ברבע התמונה (320×160) עומדת לאורך.
    await expect.poll(() => card.evaluate(image => image.naturalHeight > image.naturalWidth)).toBe(true);

    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    const lightboxImage = page.locator('#lightboxImage');
    await expect(lightboxImage).toHaveAttribute('src', /^blob:/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#lightboxDownload').click();
    const download = await downloadPromise;
    const bytes = new Uint8Array(readFileSync(await download.path()));
    const size = await page.evaluate(async data => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
        return { width: bitmap.width, height: bitmap.height };
    }, Array.from(bytes));
    expect(size).toEqual({ width: 160, height: 320 });

    const originalPromise = page.waitForEvent('download');
    await page.locator('#lightboxDownloadOriginal').click();
    const original = new Uint8Array(readFileSync(await (await originalPromise).path()));
    const originalSize = await page.evaluate(async data => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
        return { width: bitmap.width, height: bitmap.height };
    }, Array.from(original));
    expect(originalSize).toEqual({ width: 320, height: 160 });
});
