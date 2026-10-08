// טעינת הגלריה לפי תיקייה (gallery-feed.js): רק העמוד הראשון יורד בכניסה,
// המונים מגיעים מהשרת, מעבר תיקייה מבקש אותה לבדה, וכפתור "טען פריטים
// ישנים יותר" ממשיך בסמן הדפדוף במקום להוריד את האוסף כולו.
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

const FEED_PAGE_SIZE = 120;
const query = entry => new URL(entry.path, 'https://fake.invalid').searchParams;
const listRequests = worker => worker.requestsTo('GET', '/data/images?');

test('בכניסה יורד רק העמוד הראשון, והתיקייה שנבחרה נטענת לבדה', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        ...Array.from({ length: 130 }, (_, index) => imageRecord(index + 1, { folderId: '1' })),
        ...Array.from({ length: 3 }, (_, index) => imageRecord(131 + index, { folderId: '2', title: `טיול ${index + 1}` }))
    ]);
    await seedSession(page, { worker });
    await page.goto('/');

    // 133 תמונות בארכיון, אבל רק 120 החדשות ביותר נטענו — בלי סינון ובלי OFFSET.
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 133 פריטים');
    const first = query(listRequests(worker)[0]);
    expect(first.get('limit')).toBe(String(FEED_PAGE_SIZE));
    expect(first.get('orderBy')).toBe('createdAt');
    expect(first.get('direction')).toBe('desc');
    expect(first.has('folderId')).toBe(false);
    expect(first.has('offset')).toBe(false);
    // שום בקשה לא ביקשה את האוסף כולו.
    for (const entry of listRequests(worker)) expect(Number(query(entry).get('limit'))).toBeLessThanOrEqual(FEED_PAGE_SIZE);

    // המונים: שאילתה מקובצת אחת, לא רשימה מלאה ולא ספירה לכל תיקייה.
    expect(worker.requestsTo('GET', '/data/images/counts').length).toBeGreaterThan(0);
    const folderCard = name => page.locator('#folderList .collection-card', { hasText: name }).locator('.collection-card-count strong');
    await expect(folderCard('טיולים וסיורים')).toHaveText('3');
    await expect(folderCard('אירועים ופעילויות')).toHaveText('130');
    await expect(folderCard('כל הארכיון')).toHaveText('133');
    await expect(page.locator('#folderMediaCount')).toHaveText('133');
    // פסיפס הכניסה מגיע משאילתת "החדשות ביותר" הקטנה.
    await expect(page.locator('#heroMosaic img')).toHaveCount(5);

    // מעבר תיקייה מבקש רק אותה.
    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('.gallery-title')).toHaveText('טיול 3');
    await expect(page.locator('#imageCounter')).toHaveText('3 פריטים');
    const folderRequests = listRequests(worker).filter(entry => query(entry).get('folderId') === '2');
    expect(folderRequests).toHaveLength(1);
    expect(query(folderRequests[0]).get('limit')).toBe(String(FEED_PAGE_SIZE));

    // חזרה ל"כל הארכיון" מהמטמון של הביקור — בלי בקשה נוספת.
    const requestsBefore = listRequests(worker).length;
    await page.locator('#folderList .collection-card-main', { hasText: 'כל הארכיון' }).click();
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 133 פריטים');
    expect(listRequests(worker)).toHaveLength(requestsBefore);
});

test('"טען פריטים ישנים יותר" ממשיך בסמן הדפדוף ומביא את שאר התיקייה', async ({ page, worker }) => {
    worker.seedGallery({ images: 133 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 133 פריטים');

    // הגלילה מציירת את המנות מהזיכרון; כשכולן מוצגות מופיע כפתור הטעינה מהענן.
    await page.evaluate(() => { window.renderMoreImages(); window.renderMoreImages(); });
    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(FEED_PAGE_SIZE);
    const fetchButton = page.locator('#galleryFetchMoreBtn');
    await expect(fetchButton).toBeVisible();
    await expect(fetchButton).toHaveText('טען פריטים ישנים יותר');
    await expect(page.locator('#galleryLoadMoreCount')).toHaveText('נטענו 120 מתוך 133 פריטים');

    await fetchButton.click();
    await expect(cards).toHaveCount(133);
    await expect(page.locator('#imageCounter')).toHaveText('133 פריטים');
    await expect(fetchButton).toBeHidden();
    // העמוד השני התבקש בסמן של השורה האחרונה, לא ב-OFFSET.
    const cursorRequests = listRequests(worker).filter(entry => query(entry).has('after'));
    expect(cursorRequests).toHaveLength(1);
    expect(query(cursorRequests[0]).has('offset')).toBe(false);
    // הפריט הישן ביותר הגיע בעמוד השני, פעם אחת בלבד — בלי כפילויות בין העמודים.
    await expect(page.locator('#photosGrid .gallery-title', { hasText: /^תמונה 1$/ })).toHaveCount(1);
    expect(await page.evaluate(() => window.state.imagesHasMore)).toBe(false);
    expect(await page.evaluate(() => window.loadMoreImages())).toEqual({ added: 0, done: true });
});

test('בקשה חוזרת לאותה רשימה נשלחת עם If-None-Match ומקבלת 304', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);

    // רענון יזום של ההזנה: אותן כתובות בדיוק, הפעם עם ה-ETag שהתקבל.
    await page.evaluate(() => window.refreshGalleryFeed());
    const repeated = listRequests(worker).filter(entry => entry.headers['if-none-match']);
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.every(entry => /^"[A-Za-z0-9_-]{22}"$/.test(entry.headers['if-none-match']))).toBe(true);
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
});
