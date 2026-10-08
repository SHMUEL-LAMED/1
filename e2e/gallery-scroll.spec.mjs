// הגלילה ההדרגתית: הרשת נבנית במנות של 48 כרטיסים מתוך העמודים שהורדו
// (120 בכל עמוד, gallery-feed.js); כשהמנות נגמרות הזקיף מבקש את העמוד הבא
// בסמן הדפדוף. התצוגה המלאה מדפדפת גם אל פריטים שעדיין אין להם כרטיס,
// השכנים נטענים מראש, רינדור מחדש אינו מזיז את הגלילה, ו-window.loadMoreImages
// נקרא פעם אחת כשהכול כבר מוצג.
import { test, expect, seedSession, imageRecord, mediaUrl, DEFAULT_USER, API_ORIGIN, MEDIA_SIZE, variantEntries, variantAvifUrl, withAvif } from './fixtures.mjs';

const TOTAL = 300;
const BATCH = 48;
const FEED_PAGE = 120;
const cursorRequests = worker => worker.requestsTo('GET', '/data/images?').filter(entry => new URL(entry.path, 'https://fake.invalid').searchParams.has('after'));
// התמונה 230 היא סרטון עם פוסטר: לשכן שהוא סרטון נטען הפוסטר בלבד.
const VIDEO_INDEX = 230;

const cards = page => page.locator('#photosGrid .gallery-card');
const mediaPath = id => `/media/approved/${DEFAULT_USER.uid}/${id}.jpg`;
const scrollToBottom = page => page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));

// n תמונות; התמונה n היא החדשה ביותר ולכן הכרטיס הראשון. הזוגיות קובעת
// את התיקייה, כדי שמעבר תיקייה יסנן בדיוק חצי.
function seedLargeGallery(worker, total = TOTAL) {
    worker.seedFolders();
    worker.seedImages(Array.from({ length: total }, (_, i) => {
        const index = i + 1;
        const folderId = index % 2 ? '1' : '2';
        if (index === VIDEO_INDEX) {
            return imageRecord(index, {
                folderId, mediaType: 'video', mimeType: 'video/mp4', duration: 12,
                url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_e2e_${index}.mp4`,
                thumbnailUrl: mediaUrl(`img_e2e_${index}_poster`)
            });
        }
        return imageRecord(index, { folderId });
    }));
}

test('רק המנה הראשונה נבנית, כל גלילה לתחתית מוסיפה מנה, ורינדור מחדש אינו מזיז את הגלילה', async ({ page, worker }) => {
    seedLargeGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    await expect(cards(page)).toHaveCount(BATCH);
    await expect(page.locator('#imageCounter')).toHaveText(`${FEED_PAGE} מתוך ${TOTAL} פריטים`);
    await expect(cards(page).first().locator('.gallery-title')).toHaveText(`תמונה ${TOTAL}`);
    await expect(cards(page).first().locator('.gallery-number')).toHaveText('01');
    await expect(cards(page).nth(BATCH - 1).locator('.gallery-number')).toHaveText(String(BATCH));
    await expect(page.locator('#galleryLoadMoreCount')).toHaveText(`מוצגים ${BATCH} מתוך ${FEED_PAGE} פריטים`);
    await expect(page.locator('#gallerySentinel')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#galleryLoadingStatus')).toHaveAttribute('role', 'status');
    await expect(page.locator('#galleryLoadingStatus')).toBeHidden();

    // מנה אחת לכל גלילה: 48 כרטיסים הם שורות רבות, והזקיף יוצא מהטווח.
    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(BATCH * 2);
    await expect(cards(page).nth(BATCH).locator('.gallery-number')).toHaveText(String(BATCH + 1));
    expect(cursorRequests(worker), 'העמוד הראשון עוד לא נגמר').toHaveLength(0);
    // הגלילה הבאה מציגה את שארית העמוד הראשון, והגלילה שאחריה — כשאין עוד
    // מנות בזיכרון — מבקשת מהענן את העמוד השני בסמן הדפדוף, ומנה ממנו
    // מצטרפת מיד.
    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(FEED_PAGE);
    await scrollToBottom(page);
    const shown = FEED_PAGE + BATCH;
    await expect(cards(page)).toHaveCount(shown);
    expect(cursorRequests(worker)).toHaveLength(1);
    await expect(page.locator('#imageCounter')).toHaveText(`${FEED_PAGE * 2} מתוך ${TOTAL} פריטים`);
    await expect(page.locator('#galleryLoadMoreCount')).toHaveText(`מוצגים ${shown} מתוך ${FEED_PAGE * 2} פריטים`);
    await expect(page.locator('#galleryLoadingStatus')).toBeHidden();
    const ids = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.mediaId));
    expect(new Set(ids).size, 'אין כרטיס כפול').toBe(shown);

    // סנאפשוט עם תמונה חדשה בראש הרשימה, באותה תצוגה: מספר הכרטיסים נשמר,
    // הכרטיסים הקיימים נשארים אותם אלמנטים (רק מספרם מתעדכן), ולכן הדפדפן
    // שומר את עוגן הגלילה והכרטיס שבראש המסך נשאר במקומו.
    await page.evaluate(() => window.scrollTo({ top: Math.round(document.documentElement.scrollHeight * 0.6), behavior: 'instant' }));
    // אנימציית הכניסה של הכרטיסים מזיזה אותם כמה פיקסלים; המדידה אחריה.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    const anchorBefore = await page.evaluate(() => {
        const card = [...document.querySelectorAll('#photosGrid .gallery-card')].find(node => node.getBoundingClientRect().top >= 0);
        card.dataset.e2eAnchor = '1';
        return { id: card.dataset.mediaId, top: Math.round(card.getBoundingClientRect().top) };
    });
    await page.evaluate(record => {
        window.state.images = [record, ...window.state.images];
        window._doRenderImages();
    }, imageRecord(TOTAL + 1, { title: 'תמונה חדשה' }));
    await expect(cards(page).first().locator('.gallery-title')).toHaveText('תמונה חדשה');
    await expect(cards(page).nth(1).locator('.gallery-number')).toHaveText('02');
    await expect(cards(page)).toHaveCount(shown);
    await page.waitForTimeout(300);
    const anchorAfter = await page.evaluate(id => {
        const card = document.querySelector(`#photosGrid .gallery-card[data-media-id="${id}"]`);
        return { retained: card?.dataset.e2eAnchor === '1', top: Math.round(card.getBoundingClientRect().top) };
    }, anchorBefore.id);
    expect(anchorAfter.retained, 'הכרטיס הקיים לא נבנה מחדש').toBe(true);
    expect(Math.abs(anchorAfter.top - anchorBefore.top), 'הכרטיס שבראש המסך נשאר במקומו').toBeLessThanOrEqual(4);

    // תמונה ישנה שמצטרפת מעבר לכרטיסים שצוירו: הרשת אינה משתנה והגלילה זהה.
    const scrollBeforeAppend = await page.evaluate(() => window.scrollY);
    await page.evaluate(record => {
        window.state.images = [...window.state.images, record];
        window._doRenderImages();
    }, imageRecord(0, { title: 'תמונה ישנה' }));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY), 'הגלילה לא זזה').toBe(scrollBeforeAppend);
    await expect(cards(page)).toHaveCount(shown);

    // מעבר תיקייה מחזיר למנה הראשונה וגולל לראש הרשת, כך שהזקיף אינו נראה
    // מיד ואינו בונה מנה אחר מנה מתחת למשתמש.
    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    await expect(page.locator('#imageCounter')).toHaveText(`${FEED_PAGE} מתוך ${TOTAL / 2} פריטים`);
    await expect(cards(page)).toHaveCount(BATCH);
    await expect(cards(page).first()).toBeInViewport();
    await page.waitForTimeout(400);
    await expect(cards(page), 'אין מנות נוספות בלי גלילה').toHaveCount(BATCH);
});

test('התצוגה המלאה מדפדפת אל פריטים שעדיין לא צוירו, והשכנים נטענים מראש', async ({ page, worker }) => {
    seedLargeGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(BATCH);

    await cards(page).first().locator('.gallery-media').click();
    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toBeVisible();
    // התצוגה המלאה עוברת על כל מה שהורד (העמוד הראשון), לא רק על הכרטיסים.
    await expect(page.locator('#lightboxCounter')).toHaveText(`1 מתוך ${FEED_PAGE}`);
    const image = page.locator('#lightboxImage');
    await expect(image).toHaveAttribute('src', mediaUrl(`img_e2e_${TOTAL}`));
    // השכן הקודם של הפריט הראשון הוא האחרון ברשימה שהורדה: אין לו כרטיס,
    // ובכל זאת הוא נטען מראש.
    const lastLoaded = TOTAL - FEED_PAGE + 1;
    await expect.poll(() => worker.requestsTo('GET', mediaPath(`img_e2e_${lastLoaded}`)).length).toBeGreaterThanOrEqual(1);

    // 60 לחיצות „הבא” (חץ שמאלה ב-RTL) מגיעות לתמונה 240, הרחק מעבר ל-48 הכרטיסים.
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowLeft');
    const current = TOTAL - 60;
    await expect(page.locator('#lightboxCounter')).toHaveText(`61 מתוך ${FEED_PAGE}`);
    await expect(page.locator('#lightboxTitle')).toHaveText(`תמונה ${current}`);
    await expect(image).toHaveAttribute('src', mediaUrl(`img_e2e_${current}`));
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
    await expect(page.locator('#lightboxStage')).not.toHaveClass(/is-loading/);
    await expect(cards(page), 'הדפדוף אינו מצייר כרטיסים').toHaveCount(BATCH);
    await expect(page.locator(`[data-media-id="img_e2e_${current}"]`)).toHaveCount(0);
    // השכנים של הפריט המוצג נטענו מראש, אף שאין להם כרטיס.
    await expect.poll(() => worker.requestsTo('GET', mediaPath(`img_e2e_${current - 1}`)).length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => worker.requestsTo('GET', mediaPath(`img_e2e_${current + 1}`)).length).toBeGreaterThanOrEqual(1);

    // לשכן שהוא סרטון נטען הפוסטר בלבד — לעולם לא קובץ הווידאו.
    for (let i = 0; i < current - VIDEO_INDEX - 1; i++) await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#lightboxTitle')).toHaveText(`תמונה ${VIDEO_INDEX + 1}`);
    await expect.poll(() => worker.requestsTo('GET', mediaPath(`img_e2e_${VIDEO_INDEX}_poster`)).length).toBeGreaterThanOrEqual(1);
    expect(worker.requests.filter(entry => entry.path.endsWith('.mp4')), 'קובץ הווידאו לא התבקש').toEqual([]);

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(cards(page)).toHaveCount(BATCH);
});

test('הטעינה המוקדמת מביאה את התצוגה שהתצוגה המלאה תציג, לא את המקור', async ({ page, worker }) => {
    worker.seedFolders();
    worker.seedImages([1, 2, 3].map(index => imageRecord(index, {
        variants: withAvif(variantEntries(`img_e2e_${index}`), `img_e2e_${index}`),
        variantsVersion: 1
    })));
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(3);

    await cards(page).first().locator('.gallery-media').click();
    const image = page.locator('#lightboxImage');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await expect.poll(() => image.evaluate(element => element.complete && element.currentSrc)).toBe(variantAvifUrl('img_e2e_3', 'medium'));
    // שני השכנים: אותו קובץ שהתצוגה המלאה בוחרת (medium ב-AVIF), והמקור לא.
    for (const id of ['img_e2e_2', 'img_e2e_1']) {
        await expect.poll(() => worker.requestsTo('GET', `/media/variants/${id}/medium.avif`).length).toBeGreaterThanOrEqual(1);
        expect(worker.requestsTo('GET', mediaPath(id)), 'המקור לא התבקש').toEqual([]);
    }

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');
    await expect.poll(() => image.evaluate(element => element.complete && element.currentSrc)).toBe(variantAvifUrl('img_e2e_2', 'medium'));
    expect(worker.requestsTo('GET', mediaPath('img_e2e_2')), 'גם בהצגה המקור לא התבקש').toEqual([]);
});

test('כשכל מה שהורד מוצג, window.loadMoreImages נקרא פעם אחת ו„טוען עוד...” מוצג עד שהתמונות מגיעות', async ({ page, worker }) => {
    seedLargeGallery(worker, 100);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(BATCH);

    // הענף של העימוד בשרת מגדיר את שני השמות האלה; כאן הם מדומים.
    await page.evaluate(record => {
        window.__loadMoreCalls = 0;
        window.state.imagesHasMore = true;
        window.loadMoreImages = () => new Promise(resolve => {
            window.__loadMoreCalls += 1;
            // הבקשה „בדרך” עד שהבדיקה משחררת אותה, כדי שהמחוון ייבדק בזמן ההמתנה.
            window.__releaseLoadMore = () => {
                for (let i = 0; i < 30; i++) {
                    window.state.images.push({ ...record, id: `img_e2e_extra_${i}`, title: `תמונה נוספת ${i}`, createdAt: record.createdAt - (i + 1) * 60_000 });
                }
                window.state.imagesHasMore = false;
                resolve({ added: 30, done: true });
            };
        });
    }, imageRecord(0));

    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(BATCH * 2);
    await scrollToBottom(page);
    await expect(cards(page)).toHaveCount(100);
    await scrollToBottom(page);
    await expect(page.locator('#galleryLoadingStatus')).toBeVisible();
    await expect(page.locator('#galleryLoadingStatus')).toHaveText('טוען עוד...');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__loadMoreCalls), 'בקשה אחת בזמן ההמתנה').toBe(1);
    await page.evaluate(() => window.__releaseLoadMore());
    await expect(cards(page)).toHaveCount(130);
    await expect(cards(page).nth(100).locator('.gallery-title')).toHaveText('תמונה נוספת 0');
    await expect(page.locator('#galleryLoadingStatus')).toBeHidden();
    await expect(page.locator('#galleryLoadMore')).toBeHidden();

    await scrollToBottom(page);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__loadMoreCalls), 'הפונקציה נקראה פעם אחת בלבד').toBe(1);
});
