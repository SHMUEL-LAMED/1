// כיתובים ותגיות סצנה בדף הגלריה: החיפוש הרגיל מוצא לפי כיתוב ותגית בלי שום
// קריאה ל-AI, שבבי "סוג הרגע" מסננים (לצד בוררי התאריך העברי), התצוגה המלאה
// מציגה כיתוב ותגיות, ומנהל עורך אותם משם. הנתונים נזרעים כפי שה-Worker
// שומר אותם ברשומת המדיה: caption ו-sceneTags (מזהים).
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

function seedDescribedGallery(worker) {
    worker.seedFolders().seedImages([
        imageRecord(1, { caption: 'מעגל ריקודים סביב הבימה עם ספרי התורה.', sceneTags: ['dance', 'hakafot'], captionSource: 'ai', aiCaptionVersion: 1 }),
        imageRecord(2, { caption: 'שולחנות ערוכים לסעודת החג באולם.', sceneTags: ['meal'], captionSource: 'ai', aiCaptionVersion: 1 }),
        imageRecord(3, { caption: 'בחורים רוקדים בשורה ארוכה.', sceneTags: ['dance'], captionSource: 'ai', aiCaptionVersion: 1 }),
        imageRecord(4)
    ]);
}

const cardTitles = page => page.locator('#photosGrid .gallery-card .gallery-title');
const chip = (page, id) => page.locator(`#gallerySceneFilter .scene-chip[data-scene-tag="${id}"]`);

test('החיפוש הרגיל מוצא תמונות לפי הכיתוב ולפי שם התגית, בלי קריאה ל-AI', async ({ page, worker }) => {
    seedDescribedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(4);

    const search = page.locator('#searchInput');
    await search.fill('שולחנות ערוכים');
    await expect(cardTitles(page)).toHaveText(['תמונה 2']);
    // תווית התגית העברית ("הקפות") — גם בלי שהמילה מופיעה בכיתוב.
    await search.fill('הקפות');
    await expect(cardTitles(page)).toHaveText(['תמונה 1']);
    await search.fill('ריקוד');
    await expect(cardTitles(page)).toHaveText(['תמונה 3', 'תמונה 1']);
    await search.fill('');
    await expect(cardTitles(page)).toHaveCount(4);

    expect(worker.requestsTo('POST', '/ai-')).toHaveLength(0);
    // הכיתוב הוא גם הטקסט החלופי של תמונת הכרטיס.
    await expect(page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_2"] img')).toHaveAttribute('alt', 'שולחנות ערוכים לסעודת החג באולם.');
});

test('שבבי סוג הרגע מסננים את הגלריה, מכריזים על התוצאה ומשתלבים בסינון התאריך', async ({ page, worker }) => {
    seedDescribedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(4);

    const filter = page.locator('#gallerySceneFilter');
    await expect(filter).toBeVisible();
    // רק תגיות שיש להן פריטים, בסדר הטקסונומיה, עם מונה.
    await expect(filter.locator('.scene-chip')).toHaveCount(4);
    expect(await filter.locator('.scene-chip').evaluateAll(buttons => buttons.map(button => button.dataset.sceneTag)))
        .toEqual(['', 'dance', 'hakafot', 'meal']);
    await expect(chip(page, 'dance').locator('.scene-chip-count')).toHaveText('2 פריטים');
    await expect(chip(page, '')).toHaveAttribute('aria-pressed', 'true');

    await chip(page, 'dance').click();
    await expect(cardTitles(page)).toHaveText(['תמונה 3', 'תמונה 1']);
    await expect(chip(page, 'dance')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, '')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#gallerySceneFilterStatus')).toHaveText('מוצגים 2 פריטים מסוג ריקוד');
    await expect(page.locator('#imageCounter')).toHaveText('2 פריטים');

    // לחיצה נוספת על התגית הפעילה מבטלת את הסינון.
    await chip(page, 'dance').click();
    await expect(cardTitles(page)).toHaveCount(4);
    await expect(page.locator('#gallerySceneFilterStatus')).toHaveText('מוצגים כל הרגעים');

    // מקלדת: Enter על שבב מסנן, והמיקוד נשאר על השבב גם אחרי שהשורה צוירה מחדש.
    await chip(page, 'meal').focus();
    await page.keyboard.press('Enter');
    await expect(cardTitles(page)).toHaveText(['תמונה 2']);
    await expect(chip(page, 'meal')).toBeFocused();
    await expect(chip(page, 'meal')).toHaveAttribute('aria-pressed', 'true');

    // הסינון הקיים לפי שנה עברית ממשיך לעבוד יחד עם התגית.
    await chip(page, '').click();
    await page.locator('#galleryHebrewYearFilter').selectOption({ label: 'תשפ״ו' });
    await chip(page, 'dance').click();
    await expect(cardTitles(page)).toHaveText(['תמונה 3', 'תמונה 1']);
    await expect(page.locator('#galleryHebrewYearFilter')).toHaveValue('5786');

    // מעבר לתיקייה אחרת: השבבים נגזרים מהפריטים שבה, והבחירה נשמרת גלויה.
    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(chip(page, 'dance')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'dance').locator('.scene-chip-count')).toHaveText('0 פריטים');
});

test('שבב סוג רגע בתיקייה שטרם נטענה כולה מושך את שאר העמודים מעצמו, בלי גלילה', async ({ page, worker }) => {
    // 133 פריטים — יותר מעמוד אחד של הפיד (120). כולם ריקוד, ו-13 הישנים
    // ביותר (שמגיעים רק בעמוד השני) הם גם סעודה.
    worker.seedFolders().seedImages(Array.from({ length: 133 }, (_, index) => imageRecord(index + 1, {
        sceneTags: index < 13 ? ['dance', 'meal'] : ['dance'],
        captionSource: 'ai',
        aiCaptionVersion: 1
    })));
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 133 פריטים');
    await expect(chip(page, 'dance').locator('.scene-chip-count')).toHaveText('120 פריטים');
    await expect(chip(page, 'meal')).toHaveCount(0);
    const cursorRequests = () => worker.requestsTo('GET', '/data/images?')
        .filter(entry => new URL(entry.path, 'https://fake.invalid').searchParams.has('after'));
    expect(cursorRequests()).toHaveLength(0);

    await chip(page, 'dance').click();
    await expect(chip(page, 'dance')).toHaveAttribute('aria-pressed', 'true');
    // המונה אינו נתקע על "מחפש גם בפריטים ישנים…": העמוד השני נטען והתוצאה מלאה.
    await expect(page.locator('#imageCounter')).toHaveText('133 פריטים');
    await expect(chip(page, 'dance').locator('.scene-chip-count')).toHaveText('133 פריטים');
    // תגית שקיימת רק בפריטים הישנים מופיעה עכשיו בשורה.
    await expect(chip(page, 'meal').locator('.scene-chip-count')).toHaveText('13 פריטים');
    expect(await page.evaluate(() => ({ loaded: window.state.images.length, more: window.state.imagesHasMore })))
        .toEqual({ loaded: 133, more: false });
    expect(cursorRequests()).toHaveLength(1);

    await chip(page, 'meal').click();
    await expect(cardTitles(page)).toHaveCount(13);
    await expect(page.locator('#imageCounter')).toHaveText('13 פריטים');
});

test('בלי כיתובים ותגיות אין שורת שבבים ואין תיאור בתצוגה המלאה', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cardTitles(page)).toHaveCount(2);
    await expect(page.locator('#gallerySceneFilter')).toBeHidden();
    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(page.locator('#lightboxDescription')).toBeHidden();
    await expect(page.locator('#lightboxEditDescription')).toBeHidden();
});

test('התצוגה המלאה מציגה כיתוב ותגיות, ותגית מסננת את הגלריה לאותו סוג רגע', async ({ page, worker }) => {
    seedDescribedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"] .gallery-media').click();
    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toBeVisible();
    await expect(page.locator('#lightboxCaption')).toHaveText('מעגל ריקודים סביב הבימה עם ספרי התורה.');
    await expect(page.locator('#lightboxTags .lightbox-tag')).toHaveText(['ריקוד', 'הקפות']);
    await expect(page.locator('#lightboxImage')).toHaveAttribute('alt', 'מעגל ריקודים סביב הבימה עם ספרי התורה.');
    // צופה אינו רואה את כפתור העריכה.
    await expect(page.locator('#lightboxEditDescription')).toBeHidden();

    // מעבר בין פריטים מחליף את התיאור; לפריט בלי תיאור הקופסה מוסתרת.
    await lightbox.locator('button[aria-label="התמונה הקודמת"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');
    await expect(page.locator('#lightboxTags .lightbox-tag')).toHaveText(['סעודה']);
    await lightbox.locator('button[aria-label="התמונה הקודמת"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await lightbox.locator('button[aria-label="התמונה הקודמת"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 4');
    await expect(page.locator('#lightboxDescription')).toBeHidden();
    await lightbox.locator('button[aria-label="התמונה הבאה"]').click();
    await lightbox.locator('button[aria-label="התמונה הבאה"]').click();
    await lightbox.locator('button[aria-label="התמונה הבאה"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 1');

    await page.locator('#lightboxTags .lightbox-tag', { hasText: 'הקפות' }).click();
    await expect(lightbox).toBeHidden();
    await expect(chip(page, 'hakafot')).toHaveAttribute('aria-pressed', 'true');
    await expect(cardTitles(page)).toHaveText(['תמונה 1']);
});

test('מנהל עורך כיתוב ותגיות מהתצוגה המלאה; העריכה נשמרת, מוצגת ונמצאת בחיפוש', async ({ page, worker }) => {
    seedDescribedGallery(worker);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_3"] .gallery-media').click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    const edit = page.locator('#lightboxEditDescription');
    await expect(edit).toBeVisible();
    await expect(page.locator('#lightboxCaptionEmpty')).toBeHidden();
    // לפריט בלי תיאור המנהל רואה את הקופסה עם הודעה וכפתור עריכה.
    await page.locator('#lightboxModal button[aria-label="התמונה הקודמת"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 4');
    await expect(page.locator('#lightboxDescription')).toBeVisible();
    await expect(page.locator('#lightboxCaptionEmpty')).toBeVisible();
    await expect(edit).toBeVisible();
    await page.locator('#lightboxModal button[aria-label="התמונה הבאה"]').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await edit.click();

    const modal = page.locator('#mediaDescriptionModal');
    await expect(modal).toBeVisible();
    const caption = page.locator('#mediaDescriptionCaption');
    const previousCaption = 'בחורים רוקדים בשורה ארוכה.';
    const newCaption = 'הרב מוסר שיעור קצר לפני ההקפות.';
    await expect(caption).toBeFocused();
    await expect(caption).toHaveValue(previousCaption);
    await expect(page.locator('#mediaDescriptionSubject')).toHaveText('תמונה 3');
    const option = id => page.locator(`#mediaDescriptionTags input[value="${id}"]`);
    await expect(option('dance')).toBeChecked();
    await expect(page.locator('#mediaDescriptionCaptionCount')).toHaveText(`${previousCaption.length} מתוך 140 תווים`);

    // מקשי החצים בשדה הכיתוב אינם מדפדפים את התצוגה המלאה שמאחורי החלון.
    await caption.press('ArrowLeft');
    await caption.press('ArrowRight');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');

    await caption.fill(newCaption);
    await expect(page.locator('#mediaDescriptionCaptionCount')).toHaveText(`${newCaption.length} מתוך 140 תווים`);
    await option('dance').uncheck();
    // עד ארבע תגיות: אחרי הרביעית השאר ננעלות, ושחרור אחת פותח אותן.
    for (const id of ['hakafot', 'torah', 'lesson', 'music']) await option(id).check();
    await expect(option('meal')).toBeDisabled();
    await expect(page.locator('#mediaDescriptionTagsHint')).toContainText('המרבי');
    await option('music').uncheck();
    await expect(option('meal')).toBeEnabled();
    await page.locator('#mediaDescriptionSave').click();

    await expect(modal).toBeHidden();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(page.locator('#lightboxCaption')).toHaveText(newCaption);
    await expect(page.locator('#lightboxTags .lightbox-tag')).toHaveText(['הקפות', 'ספר תורה', 'שיעור או דרשה']);
    // המיקוד חוזר לכפתור העריכה שפתח את החלון.
    await expect(edit).toBeFocused();

    const writes = worker.requestsTo('PUT', '/data/images/img_e2e_3');
    expect(writes).toHaveLength(1);
    const body = JSON.parse(writes[0].body);
    expect(body.merge).toBe(true);
    expect(body.data).toMatchObject({ caption: newCaption, sceneTags: ['hakafot', 'torah', 'lesson'], captionSource: 'manual' });
    expect(worker.collection('images').get('img_e2e_3')).toMatchObject({
        title: 'תמונה 3', caption: newCaption, sceneTags: ['hakafot', 'torah', 'lesson'], captionSource: 'manual'
    });

    // Escape סוגר קודם את חלון העריכה ורק אחר כך את התצוגה המלאה.
    await edit.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightboxModal')).toBeHidden();

    await page.locator('#searchInput').fill('שיעור קצר');
    await expect(cardTitles(page)).toHaveText(['תמונה 3']);
    await page.locator('#searchInput').fill('');
    await chip(page, 'lesson').click();
    await expect(cardTitles(page)).toHaveText(['תמונה 3']);
});

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('שבבי הסינון והתיאור בתצוגה המלאה אינם גורמים לגלילה אופקית, ויעדי המגע בגובה 40px לפחות', async ({ page, worker }) => {
        const tags = ['dance', 'hakafot', 'torah', 'lesson', 'study', 'prayer', 'meal', 'music', 'group', 'children', 'preparations', 'overview'];
        worker.seedFolders().seedImages(tags.map((tag, index) => imageRecord(index + 1, {
            caption: 'כיתוב ארוך יחסית שמתאר את הרגע באולם הישיבה ואת מה שקורה בו, כדי לבדוק שהשורה נשברת יפה במסך צר של טלפון נייד.',
            sceneTags: [tag, tags[(index + 1) % tags.length], tags[(index + 2) % tags.length], tags[(index + 3) % tags.length]],
            captionSource: 'ai',
            aiCaptionVersion: 1
        })));
        await seedSession(page, { worker, role: 'admin' });
        await page.goto('/');
        await expect(cardTitles(page)).toHaveCount(tags.length);
        const filter = page.locator('#gallerySceneFilter');
        await expect(filter).toBeVisible();
        await expect(filter.locator('.scene-chip')).toHaveCount(tags.length + 1);

        // בהדמיית טלפון הדפדפן מרחיב את ה-viewport כשמשהו בורח לרוחב, ולכן
        // בודקים גם את רוחב המסמך וגם שה-viewport נשאר 390.
        const noHorizontalScroll = () => page.evaluate(() =>
            document.documentElement.scrollWidth <= 390 && window.innerWidth === 390 && window.scrollX === 0);
        // המידות נמדדות אחרי שאנימציות הכניסה (הגדלה, החלקה) הסתיימו בפועל;
        // אנימציות אינסופיות של הרקע אינן משנות מידות ואין מה לחכות להן.
        const settleAnimations = () => page.evaluate(() => Promise.all(document.getAnimations()
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {}))));
        await settleAnimations();
        expect(await noHorizontalScroll()).toBe(true);
        // השורה עצמה נגללת לרוחב בתוך גבולותיה.
        const box = await filter.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const chipBox = await chip(page, 'dance').boundingBox();
        expect(chipBox.height).toBeGreaterThanOrEqual(40);

        await chip(page, 'overview').scrollIntoViewIfNeeded();
        await chip(page, 'overview').click();
        await expect(chip(page, 'overview')).toHaveAttribute('aria-pressed', 'true');
        await expect(cardTitles(page)).toHaveCount(4);
        expect(await noHorizontalScroll()).toBe(true);

        await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
        await expect(page.locator('#lightboxModal')).toBeVisible();
        await expect(page.locator('#lightboxDescription')).toBeVisible();
        await settleAnimations();
        expect(await noHorizontalScroll()).toBe(true);
        for (const selector of ['#lightboxDescription', '#lightboxEditDescription', '#lightboxDownload']) {
            const element = await page.locator(selector).boundingBox();
            expect(element.x).toBeGreaterThanOrEqual(0);
            expect(element.x + element.width).toBeLessThanOrEqual(390);
        }
        const tagBox = await page.locator('#lightboxTags .lightbox-tag').first().boundingBox();
        expect(tagBox.height).toBeGreaterThanOrEqual(40);

        await page.locator('#lightboxEditDescription').click();
        await expect(page.locator('#mediaDescriptionModal')).toBeVisible();
        await settleAnimations();
        expect(await noHorizontalScroll()).toBe(true);
        const optionBox = await page.locator('#mediaDescriptionTags .scene-tag-option').first().boundingBox();
        expect(optionBox.height).toBeGreaterThanOrEqual(40);
        const saveBox = await page.locator('#mediaDescriptionSave').boundingBox();
        expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(390);
    });
});
