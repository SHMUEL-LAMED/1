// מיון אקראי, "תמונה אקראית" וסינון לפי כיוון, בדפדפן אמיתי: הסדר האקראי
// נשאר יציב עד "ערבב מחדש", הכפתור פותח פריט מהתצוגה המסוננת בלי לחזור על
// הקודם, והכיוון נגזר מהמידות שברשומה, מצטרף לשאר הסינונים ונשמר בחיפושים.
import { test, expect, seedSession, imageRecord, variantEntries, API_ORIGIN, DEFAULT_USER, openGalleryFilters, closeGalleryFilters } from './fixtures.mjs';
import { storageKeyFor } from '../search-history.js';

const USER_KEY = storageKeyFor(DEFAULT_USER.uid);
const titles = page => page.locator('#photosGrid .gallery-card .gallery-title').allTextContents();

test('אקראי: סדר מעורבב שנשאר יציב בציור מחדש ובחזרה ממיון אחר, ו"ערבב מחדש" מחליף אותו', async ({ page, worker }) => {
    worker.seedGallery({ images: 14 });
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const sort = page.locator('#gallerySortSelect');
    const reshuffle = page.locator('#galleryReshuffleButton');
    await expect(cards).toHaveCount(14);
    const newest = await titles(page);
    await expect(reshuffle).toBeHidden();
    // במיון לפי תאריך יש תווית חודש בראש הרשימה.
    await expect(cards.first().locator('.gallery-date-group')).toBeVisible();

    await sort.selectOption('random');
    await expect(reshuffle).toBeVisible();
    await expect(reshuffle).toHaveAttribute('aria-label', 'ערבב מחדש');
    await expect.poll(() => titles(page)).not.toEqual(newest);
    const shuffled = await titles(page);
    expect([...shuffled].sort()).toEqual([...newest].sort());
    // בסדר אקראי אין קיבוץ לפי חודש.
    await expect(page.locator('#photosGrid .gallery-date-group:visible')).toHaveCount(0);

    // ציור מחדש (כמו לב שנלחץ או חזרה ללשונית) אינו מערבב.
    await page.evaluate(() => window._doRenderImages());
    expect(await titles(page)).toEqual(shuffled);

    // מעבר למיון אחר וחזרה: אותו סדר אקראי.
    await sort.selectOption('name');
    await expect(reshuffle).toBeHidden();
    await expect.poll(() => titles(page)).not.toEqual(shuffled);
    await sort.selectOption('random');
    await expect.poll(() => titles(page)).toEqual(shuffled);

    // סינון וביטולו שומרים על הסדר היחסי.
    await page.locator('#searchInput').fill('תמונה 1');
    await expect.poll(() => titles(page)).toEqual(shuffled.filter(title => title.includes('תמונה 1')));
    await page.locator('#searchInput').fill('');
    await expect.poll(() => titles(page)).toEqual(shuffled);

    // ערבוב מחדש: סדר אחר של אותם פריטים, והודעה.
    await reshuffle.click();
    await expect(page.locator('#customAlertMessage')).toContainText('הגלריה עורבבה מחדש');
    await expect.poll(() => titles(page)).not.toEqual(shuffled);
    const reshuffled = await titles(page);
    expect([...reshuffled].sort()).toEqual([...newest].sort());
    await expect(sort).toHaveValue('random');

    // "לעדכונים האחרונים" מהודעה קופצת מחזיר למיון לפי תאריך, והבורר והכפתור מתעדכנים.
    await page.evaluate(() => {
        window.state.popupAnnouncementConfig = { linkType: 'latest' };
        window.handlePopupAnnouncementClick();
    });
    await expect(sort).toHaveValue('newest');
    await expect(reshuffle).toBeHidden();
    await expect.poll(() => titles(page)).toEqual(newest);
});

test('תמונה אקראית: נפתחת מהתצוגה המסוננת, ואינה חוזרת פעמיים ברצף', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { title: 'ברכת המזון' }),
        imageRecord(2, { title: 'ריקודים בחצר' }),
        imageRecord(3, { title: 'ריקודים בסעודה' }),
        imageRecord(4, { title: 'סעודת הודיה' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const button = page.locator('#galleryRandomItemButton');
    const lightbox = page.locator('#lightboxModal');
    await expect(cards).toHaveCount(4);
    await expect(button).toHaveAttribute('aria-label', 'תמונה אקראית');

    // בתיבת החיפוש "ריקודים" נשארים שני פריטים: הכפתור מחליף ביניהם.
    await page.locator('#searchInput').fill('ריקודים');
    await expect(cards).toHaveCount(2);
    let previous = '';
    for (let draw = 0; draw < 5; draw += 1) {
        await button.click();
        await expect(lightbox).toBeVisible();
        const title = await page.locator('#lightboxTitle').textContent();
        expect(['ריקודים בחצר', 'ריקודים בסעודה']).toContain(title);
        expect(title).not.toBe(previous);
        await expect(page.locator('#lightboxCounter')).toHaveText(/ מתוך 2$/);
        previous = title;
        await page.keyboard.press('Escape');
        await expect(lightbox).toBeHidden();
    }

    // פריט יחיד בתצוגה נפתח גם אם הוא היה האחרון.
    await page.locator('#searchInput').fill('ברכת');
    await expect(cards).toHaveCount(1);
    for (let draw = 0; draw < 2; draw += 1) {
        await button.click();
        await expect(page.locator('#lightboxTitle')).toHaveText('ברכת המזון');
        await page.keyboard.press('Escape');
        await expect(lightbox).toBeHidden();
    }

    // אין פריטים: הודעה, והתצוגה המלאה אינה נפתחת.
    await page.locator('#searchInput').fill('אין דבר כזה');
    await expect(cards).toHaveCount(0);
    await button.click();
    await expect(page.locator('#customAlertMessage')).toContainText('אין פריטים להצגה בסינון הנוכחי');
    await expect(lightbox).toBeHidden();
});

test('כיוון: לאורך, לרוחב וריבועית מהמידות שברשומה, יחד עם שאר הסינונים, ונשמר בחיפוש', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        // המידות שנרשמו בהעלאה (לאורך).
        imageRecord(1, { title: 'ריקודים לאורך', width: 3024, height: 4032 }),
        // בלי מידות ברשומה: מהתצוגות המקדימות (480×320, לרוחב).
        imageRecord(2, { title: 'ריקודים לרוחב', variants: variantEntries('img_e2e_2'), variantsVersion: 1 }),
        imageRecord(3, { title: 'ריקודים בריבוע', width: 1080, height: 1080 }),
        // סרטון לאורך, לפי הפוסטר.
        imageRecord(4, {
            title: 'ריקודים בסרטון',
            url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_e2e_4.mp4`,
            r2Key: `approved/${DEFAULT_USER.uid}/img_e2e_4.mp4`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            variants: {
                poster: { ...variantEntries('img_e2e_4', ['poster']).poster, width: 720, height: 1280 }
            },
            variantsVersion: 1
        }),
        // מדיה ישנה בלי מידות בכלל.
        imageRecord(5, { title: 'ריקודים בלי מידות' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const orientation = page.locator('#galleryOrientationFilter');
    const note = page.locator('#galleryOrientationNote');
    await expect(cards).toHaveCount(5);
    // הבורר בחלונית "סינון" של סרגל הכלים.
    await openGalleryFilters(page);
    await expect(orientation).toHaveAttribute('aria-label', 'סינון לפי כיוון');
    await expect(orientation.locator('option')).toHaveText(['כל הכיוונים', 'לאורך', 'לרוחב', 'ריבועית']);
    await expect(note).toBeHidden();

    await orientation.selectOption('portrait');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בסרטון', 'ריקודים לאורך']);
    await expect(note).toBeVisible();
    await expect(note).toHaveText('פריט אחד בלי מידות שמורות אינו נכלל בסינון לפי כיוון.');
    await expect(note).toHaveAttribute('role', 'status');

    // יחד עם סוג המדיה: רק התמונה לאורך.
    await page.locator('#galleryMediaTypeFilter').selectOption('image');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים לאורך']);
    await page.locator('#galleryMediaTypeFilter').selectOption('');

    await orientation.selectOption('landscape');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים לרוחב']);
    await orientation.selectOption('square');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בריבוע']);

    // יחד עם חיפוש טקסט, ונרשם בחיפושים האחרונים עם הכיוון.
    await orientation.selectOption('portrait');
    const search = page.locator('#searchInput');
    await search.fill('סרטון');
    await search.press('Enter');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בסרטון']);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.recent?.[0], USER_KEY))
        .toMatchObject({ query: 'סרטון', filters: { orientation: 'portrait' } });

    // ביטול: הכול חוזר, וההערה נעלמת.
    await search.fill('');
    await openGalleryFilters(page);
    await orientation.selectOption('');
    await expect(cards).toHaveCount(5);
    await expect(note).toBeHidden();

    // הפעלה מהתפריט מחזירה את הטקסט ואת הכיוון, ופרטי הסינון מוצגים בעברית.
    await search.click();
    const row = page.locator('#searchHistoryPopup .search-history-group[data-kind="recent"] .search-history-row').first();
    await expect(row.locator('.search-history-meta')).toHaveText('כיוון: לאורך');
    await row.locator('[data-action="apply"]').click();
    await expect(search).toHaveValue('סרטון');
    await expect(orientation).toHaveValue('portrait');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בסרטון']);
});

test('בטלפון: הכפתורים והבוררים נגישים בלי גלילה אופקית', async ({ page, worker }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    worker.seedGallery({ images: 3 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    await page.locator('#gallerySortSelect').selectOption('random');
    for (const id of ['#galleryRandomItemButton', '#galleryReshuffleButton']) {
        await expect(page.locator(id)).toBeVisible();
    }
    // בורר הכיוון בגיליון הסינון; גם פתוח אין גלילה אופקית.
    await openGalleryFilters(page);
    await expect(page.locator('#galleryOrientationFilter')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await closeGalleryFilters(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#galleryRandomItemButton').click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
});
