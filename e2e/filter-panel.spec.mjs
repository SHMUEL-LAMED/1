// חלונית "סינון" של סרגל הכלים (gallery-filter-panel.js): פתיחה וסגירה, המונה
// שעל הכפתור, שבבי המסננים הפעילים עם × ו"נקה הכל", מקלדת, והגיליון התחתון
// בטלפון — בלי גלילה אופקית גם ב-360px.
import { test, expect, seedSession, imageRecord, API_ORIGIN, DEFAULT_USER } from './fixtures.mjs';

function videoRecord(index, extra = {}) {
    const key = `approved/${DEFAULT_USER.uid}/img_e2e_${index}.mp4`;
    return imageRecord(index, { title: `סרטון ${index}`, url: `${API_ORIGIN}/media/${key}`, r2Key: key, mediaType: 'video', mimeType: 'video/mp4', duration: 30, ...extra });
}

// שש תמונות ושני סרטונים: שתי תמונות לאורך, ותגיות "ריקוד" לשלוש מהן.
function seedFilterGallery(worker) {
    worker.seedFolders().seedImages([
        imageRecord(1, { width: 800, height: 1200, sceneTags: ['dance'] }),
        imageRecord(2, { width: 1200, height: 800, sceneTags: ['dance'] }),
        imageRecord(3, { width: 800, height: 1200 }),
        imageRecord(4, { width: 1200, height: 800, sceneTags: ['meal'] }),
        imageRecord(5, { width: 1200, height: 800, sceneTags: ['dance'] }),
        imageRecord(6, { width: 1200, height: 800 }),
        videoRecord(7, { width: 1280, height: 720 }),
        videoRecord(8, { width: 1280, height: 720 })
    ]);
}

const cards = page => page.locator('#photosGrid .gallery-card');
const toggle = page => page.locator('#galleryFilterToggle');
const panel = page => page.locator('#galleryFilterPanel');
const chips = page => page.locator('#galleryActiveFilterChips .active-filter-chip');
const badge = page => page.locator('#galleryFilterCount');

async function openGallery(page, worker) {
    seedFilterGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(8);
}

test.describe('מסך רחב', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('פתיחה וסגירה, מונה, שבב עם × שמסיר רק את המסנן שלו, ו-Escape שמחזיר את הפוקוס', async ({ page, worker }) => {
        await openGallery(page, worker);
        await expect(panel(page)).toBeHidden();
        await expect(badge(page)).toBeHidden();
        await expect(page.locator('#galleryActiveFilters')).toBeHidden();
        // כל הבוררים של הסינון בתוך החלונית.
        for (const id of ['galleryHebrewYearFilter', 'galleryHebrewMonthFilter', 'galleryDateRangeToggle', 'galleryMediaTypeFilter', 'galleryOrientationFilter', 'gallerySceneFilter']) {
            expect(await page.locator(`#galleryFilterPanel #${id}`).count(), id).toBe(1);
        }

        await toggle(page).click();
        await expect(panel(page)).toBeVisible();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        // במסך רחב החלונית אינה חוסמת את הדף.
        await expect(panel(page)).toHaveAttribute('aria-modal', 'false');
        await expect(page.locator('#galleryFilterBackdrop')).toBeHidden();
        await expect(page.locator('#galleryHebrewYearFilter')).toBeFocused();

        await page.locator('#galleryMediaTypeFilter').selectOption('image');
        await page.locator('#galleryOrientationFilter').selectOption('portrait');
        await expect(cards(page)).toHaveCount(2);
        await expect(badge(page)).toBeVisible();
        await expect(page.locator('#galleryFilterCountValue')).toHaveText('2');
        await expect(toggle(page)).toHaveAccessibleName(/סינון 2 מסננים פעילים/);
        await expect(page.locator('#galleryFilterDoneLabel')).toHaveText('הצגת 2 פריטים');

        await page.keyboard.press('Escape');
        await expect(panel(page)).toBeHidden();
        await expect(toggle(page)).toBeFocused();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

        // שבב לכל מסנן, והסרה של אחד משאירה את השני.
        await expect(chips(page)).toHaveCount(2);
        await expect(chips(page).first()).toHaveAccessibleName('הסרת הסינון סוג: תמונות בלבד');
        await expect(chips(page).nth(1)).toHaveAccessibleName('הסרת הסינון כיוון: לאורך');
        await chips(page).first().click();
        await expect(chips(page)).toHaveCount(1);
        await expect(cards(page)).toHaveCount(2);
        await expect(page.locator('#galleryMediaTypeFilter')).toHaveValue('');
        await expect(page.locator('#galleryOrientationFilter')).toHaveValue('portrait');
        await expect(page.locator('#galleryFilterCountValue')).toHaveText('1');
        // הפוקוס עובר לשבב שנשאר.
        await expect(chips(page).first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(chips(page)).toHaveCount(0);
        await expect(page.locator('#galleryActiveFilters')).toBeHidden();
        await expect(badge(page)).toBeHidden();
        await expect(toggle(page)).toBeFocused();
        await expect(cards(page)).toHaveCount(8);
    });

    test('"נקה הכל" מאפס את כל המסננים ומשאיר את טקסט החיפוש; לחיצה מחוץ לחלונית סוגרת אותה', async ({ page, worker }) => {
        await openGallery(page, worker);
        await page.locator('#searchInput').fill('תמונה');
        await expect(cards(page)).toHaveCount(6);

        await toggle(page).click();
        await page.locator('#gallerySceneFilter .scene-chip[data-scene-tag="dance"]').click();
        await page.locator('#galleryOrientationFilter').selectOption('landscape');
        await expect(cards(page)).toHaveCount(2);
        await expect(page.locator('#galleryFilterCountValue')).toHaveText('2');
        await expect(chips(page).filter({ hasText: 'ריקוד' })).toHaveCount(1);

        // לחיצה על הכותרת (מחוץ לחלונית) סוגרת אותה; המסננים נשארים.
        await page.locator('.site-header .brand-title').click();
        await expect(panel(page)).toBeHidden();
        await expect(chips(page)).toHaveCount(2);

        await page.locator('#galleryFilterClearAll').click();
        await expect(chips(page)).toHaveCount(0);
        await expect(cards(page)).toHaveCount(6);
        await expect(page.locator('#searchInput')).toHaveValue('תמונה');
        await expect(page.locator('#galleryOrientationFilter')).toHaveValue('');
        await expect(page.locator('#gallerySceneFilter .scene-chip[aria-pressed="true"]')).toHaveText('כל הרגעים');
    });

    test('מקלדת: Enter פותח, Tab נשאר בסדר החלונית, ו"נקה הכל" שבתחתית מושבת כשאין מסנן', async ({ page, worker }) => {
        await openGallery(page, worker);
        await toggle(page).focus();
        await page.keyboard.press('Enter');
        await expect(panel(page)).toBeVisible();
        await expect(page.locator('#galleryHebrewYearFilter')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#galleryHebrewMonthFilter')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#galleryDateRangeToggle')).toBeFocused();
        await expect(page.locator('#galleryFilterPanelClear')).toBeDisabled();
        // "סגור" בתחתית מחזיר את הפוקוס לכפתור.
        await page.locator('#galleryFilterDone').click();
        await expect(panel(page)).toBeHidden();
        await expect(toggle(page)).toBeFocused();
    });
});

test.describe('בטלפון: גיליון תחתון', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('גיליון מעל רקע מעומעם, מלכודת פוקוס, נעילת גלילה, וסגירה ברקע', async ({ page, worker }) => {
        await openGallery(page, worker);
        await toggle(page).tap();
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('#galleryFilterBackdrop')).toBeVisible();
        // צמוד לתחתית המסך ובכל רוחבו (אחרי שהגיליון סיים לעלות).
        await expect.poll(async () => {
            const box = await panel(page).boundingBox();
            return Math.abs(box.y + box.height - 844) <= 1 && box.x <= 0.5 && Math.abs(box.width - 390) <= 1;
        }).toBe(true);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');

        // מלכודת הפוקוס: Tab מהפקד האחרון חוזר לראשון, ו-Shift+Tab מהראשון לאחרון.
        await page.locator('#galleryFilterDone').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#galleryFilterPanel .filter-panel-close')).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#galleryFilterDone')).toBeFocused();

        await page.locator('#galleryMediaTypeFilter').selectOption('video');
        await expect(page.locator('#galleryVideoLengthFilter')).toBeVisible();
        await expect(page.locator('#galleryFilterDoneLabel')).toHaveText('הצגת 2 פריטים');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

        // לחיצה על הרקע (מעל הגיליון) סוגרת.
        await page.mouse.click(195, 40);
        await expect(panel(page)).toBeHidden();
        await expect(page.locator('#galleryFilterBackdrop')).toBeHidden();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
        await expect(chips(page)).toHaveCount(1);
        await expect(cards(page)).toHaveCount(2);
    });

    test('ב-360px אין גלילה אופקית — עם החלונית סגורה, פתוחה ועם שבבים', async ({ page, worker }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await openGallery(page, worker);
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await toggle(page).tap();
        await page.locator('#galleryOrientationFilter').selectOption('landscape');
        await page.locator('#gallerySceneFilter .scene-chip[data-scene-tag="dance"]').tap();
        await page.locator('#galleryDateRangeToggle').tap();
        await expect(page.locator('#galleryDateRangePanel')).toBeVisible();
        expect(await overflow()).toBeLessThanOrEqual(0);
        await page.locator('#galleryFilterDone').tap();
        await expect(chips(page)).toHaveCount(2);
        expect(await overflow()).toBeLessThanOrEqual(0);
        // השבבים, "נקה הכל" וכפתור הסינון בתוך רוחב המסך.
        for (const locator of [chips(page).first(), chips(page).last(), page.locator('#galleryFilterClearAll'), toggle(page)]) {
            const box = await locator.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(360);
        }
    });
});
