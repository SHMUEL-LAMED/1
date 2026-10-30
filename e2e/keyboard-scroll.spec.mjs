// קיצורי המקלדת, "חזרה למעלה" וזיכרון הגלילה (gallery-navigation-ui.js) בדפדפן
// אמיתי: חלון "?" ומתי הוא שותק, D ו-F בתצוגה המלאה לצד החצים (מימין לשמאל),
// חזרה לאותו מקום ולאותו כרטיס אחרי התצוגה המלאה, עמוד האירוע ואלבום של אדם
// ב"חזור" של הדפדפן, והכפתור שמופיע אחרי כשני מסכים.
import { test, expect, seedSession, imageRecord, DEFAULT_USER, openGalleryFilters, closeGalleryFilters } from './fixtures.mjs';

const cards = page => page.locator('#photosGrid .gallery-card');
const card = (page, index) => page.locator(`#photosGrid .gallery-card[data-media-id="img_e2e_${index}"]`);
const scrollY = page => page.evaluate(() => Math.round(window.scrollY));
const topOf = locator => locator.evaluate(node => Math.round(node.getBoundingClientRect().top));
const helpDialog = page => page.getByRole('dialog', { name: 'קיצורי מקלדת' });

// n תמונות; התמונה n היא החדשה ביותר ולכן הכרטיס הראשון.
async function openGallery(page, worker, total) {
    worker.seedFolders().seedImages(Array.from({ length: total }, (_, i) => imageRecord(i + 1)));
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page).first()).toBeVisible();
}

// גלילה עד שהכרטיס נבנה (מנה אחר מנה), ואז הכרטיס לאמצע המסך.
async function scrollToCard(page, index) {
    await expect.poll(async () => {
        if (await card(page, index).count()) return true;
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        return false;
    }).toBe(true);
    await card(page, index).evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle(page);
}

// אנימציית הכניסה של הכרטיסים מזיזה אותם כמה פיקסלים; מדידות אחריה.
function settle(page) {
    return page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))));
}

test('"?" פותח את רשימת הקיצורים, Escape סוגר ומחזיר את הפוקוס, ובשדה טקסט הוא נכתב', async ({ page, worker }) => {
    await openGallery(page, worker, 3);

    await page.locator('body').press('?');
    const dialog = helpDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.shortcuts-group h4')).toHaveText(['בגלריה', 'בתצוגה המלאה']);
    await expect(dialog.locator('.shortcuts-row')).toHaveCount(8);
    await expect(dialog.locator('.shortcuts-row').filter({ hasText: 'הפריט הבא' }).locator('kbd')).toHaveText('←');
    await expect(dialog.locator('.shortcuts-row').filter({ hasText: 'הורדת הפריט' }).locator('kbd')).toHaveText('D');
    await expect(dialog.getByRole('button', { name: 'סגירת רשימת הקיצורים' })).toBeFocused();
    // בזמן שהחלון פתוח "?" נוסף אינו פותח אותו שוב, ו-"/" אינו קופץ לחיפוש.
    await page.keyboard.press('/');
    await expect(page.locator('#searchInput')).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // בשדה החיפוש "?" הוא תו כמו כל תו אחר.
    await page.locator('#searchInput').fill('');
    await page.locator('#searchInput').press('?');
    await expect(page.locator('#searchInput')).toHaveValue('?');
    await expect(dialog).toBeHidden();
    await page.locator('#searchInput').fill('');

    // גם בכפתור המקלדת שבסרגל; הפוקוס חוזר אליו בסגירה.
    const button = page.getByRole('button', { name: 'קיצורי מקלדת' });
    await expect(button).toHaveAttribute('aria-keyshortcuts', '?');
    await button.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'סגירת רשימת הקיצורים' }).click();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
});

test('חלון הקיצורים לוכד את הפוקוס: Tab ו-Shift+Tab אינם יוצאים ממנו אל הדף שמאחור', async ({ page, worker }) => {
    await openGallery(page, worker, 3);
    const insideDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest('#shortcutsHelpModal')));

    await page.locator('body').press('?');
    const dialog = helpDialog(page);
    const close = dialog.getByRole('button', { name: 'סגירת רשימת הקיצורים' });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
        await page.keyboard.press(key);
        expect(await insideDialog(), key).toBe(true);
    }
    await expect(close).toBeFocused();
    // פוקוס שנפל אל גוף החלון (לחיצה על הרשימה) חוזר ל-Tab הבא אל תוך החלון.
    await dialog.locator('#shortcutsHelpList').click();
    await page.keyboard.press('Shift+Tab');
    expect(await insideDialog()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // אחרי הסגירה Tab חוזר להתנהג כרגיל בדף.
    await page.keyboard.press('Tab');
    expect(await insideDialog()).toBe(false);

    // גם מעל התצוגה המלאה: Tab אינו בורח אל הכפתורים של התצוגה שמתחת.
    await cards(page).first().locator('.gallery-media').click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await page.keyboard.press('Shift+?');
    await expect(dialog).toBeVisible();
    for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        expect(await insideDialog(), key).toBe(true);
    }
});

test('בתצוגה המלאה: חצים מימין לשמאל, D מוריד, F מסמן מועדף, ו-"?" נפתח מעליה בלי להזיז אותה', async ({ page, worker }) => {
    await openGallery(page, worker, 3);
    await cards(page).first().locator('.gallery-media').click();
    const lightbox = page.locator('#lightboxModal');
    const counter = page.locator('#lightboxCounter');
    await expect(lightbox).toBeVisible();
    await expect(counter).toHaveText('1 מתוך 3');

    // חץ שמאלה הוא הבא וחץ ימינה הקודם — כמו הכפתורים.
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText('2 מתוך 3');
    await page.keyboard.press('ArrowRight');
    await expect(counter).toHaveText('1 מתוך 3');

    // D: הכפתור עצמו, כלומר אותה הורדה של הקובץ המקורי.
    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('d');
    await downloadPromise;

    // F: הלב שבסרגל נלחץ, הלב שבכרטיס מתמלא, והמועדף נשמר בענן.
    const favorite = page.getByRole('button', { name: 'סימון כמועדף' });
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await expect(favorite).toHaveAttribute('aria-keyshortcuts', 'F');
    await page.keyboard.press('f');
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveClass(/is-favorite/);
    await expect(card(page, 3).locator('.gallery-fav')).toHaveClass(/is-favorite/);
    await expect.poll(() => worker.collection('userFavorites').get(DEFAULT_USER.uid)?.mediaIds).toEqual(['img_e2e_3']);
    // הפריט הבא אינו מועדף; פריסה עברית (F הפיזי מפיק "כ") מסמנת גם אותו.
    await page.keyboard.press('ArrowLeft');
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'כ', code: 'KeyF', bubbles: true })));
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 2).locator('.gallery-fav')).toHaveClass(/is-favorite/);

    // "?" מעל התצוגה המלאה: החצים אינם מדפדפים מאחוריו, ו-Escape סוגר רק אותו.
    await page.keyboard.press('Shift+?');
    const dialog = helpDialog(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('d');
    await expect(counter).toHaveText('2 מתוך 3');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(lightbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
});

test('סגירת התצוגה המלאה מחזירה לאותו מקום בגלריה ולאותו כרטיס, גם אחרי F וגלילה מאחוריה', async ({ page, worker }) => {
    await openGallery(page, worker, 150);
    await scrollToCard(page, 80);
    const before = await scrollY(page);
    const topBefore = await topOf(card(page, 80));
    expect(before).toBeGreaterThan(1000);

    await card(page, 80).locator('.gallery-media').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#lightboxModal')).toBeVisible();
    // גלגלת מעל התצוגה המלאה גוללת את הדף שמאחור.
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 500);
    // F בונה מחדש את הכרטיס, כך שהכפתור שפתח את התצוגה כבר אינו בדף.
    await page.keyboard.press('f');
    await expect(card(page, 80).locator('.gallery-fav')).toHaveClass(/is-favorite/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#lightboxModal')).toBeHidden();
    await expect(card(page, 80).locator('.gallery-media')).toBeFocused();
    await expect.poll(() => scrollY(page)).toBe(before);
    await settle(page);
    expect(Math.abs(await topOf(card(page, 80)) - topBefore)).toBeLessThanOrEqual(1);
});

test('עמוד האירוע: הסגירה מחזירה את הגלילה ואת הפוקוס לכפתור שפתח — גם אחרי מעקב שמצייר אותו מחדש', async ({ page, worker }) => {
    await openGallery(page, worker, 60);
    const opener = page.locator('[data-event-folder="1"]');
    await opener.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle(page);
    const before = await scrollY(page);
    // הכרטיס הראשון שבתוך המסך הוא העוגן: הגלריה חוזרת אליו, גם אם משהו מעל
    // הרשת שינה גובה בינתיים (תמונות בראש הדף שנטענו או נכשלו).
    const anchorId = await page.evaluate(() => Array.from(document.querySelectorAll('#photosGrid .gallery-card[data-media-id]'))
        .find(node => node.getBoundingClientRect().top >= 0)?.dataset.mediaId);
    expect(anchorId).toBeTruthy();
    const anchor = page.locator(`#photosGrid .gallery-card[data-media-id="${anchorId}"]`);
    const anchorTop = await topOf(anchor);

    await opener.click();
    const eventPage = page.getByRole('dialog', { name: 'אירועים ופעילויות' });
    await expect(eventPage).toBeVisible();
    // מעקב מצייר את העמוד מחדש (openModal שוב על חלון פתוח).
    await eventPage.locator('#eventFollowButton').click();
    await expect(eventPage.locator('#eventFollowButton')).toContainText('הפסק לעקוב');
    // הדף שמאחור נגלל בזמן שהעמוד פתוח.
    await page.evaluate(() => window.scrollBy({ top: 1400, behavior: 'instant' }));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 500);
    // ומשהו מעל הרשת גדל בינתיים: הכרטיס שהיה בראש המסך חוזר לאותו מקום,
    // ולכן הגלילה גדלה (בגובה שנוסף, כולל הרווח של הפריסה).
    await page.evaluate(() => {
        const spacer = document.createElement('div');
        spacer.id = 'e2eLayoutShift';
        spacer.style.height = '150px';
        document.getElementById('photosGrid').before(spacer);
    });

    await page.keyboard.press('Escape');
    await expect(eventPage).toBeHidden();
    await expect(opener).toBeFocused();
    // הכרטיס עשוי להיבנות מחדש (המעקב מצייר את הרשת) ולעלות למקומו באנימציה.
    await settle(page);
    await expect.poll(async () => Math.abs(await topOf(anchor) - anchorTop)).toBeLessThanOrEqual(1);
    expect(await scrollY(page)).toBeGreaterThanOrEqual(before + 150);
    await page.evaluate(() => document.getElementById('e2eLayoutShift').remove());

    // "פתח את תמונות האירוע" עובר לתיקייה: אין חזרה למקום הישן.
    await opener.click();
    await expect(eventPage).toBeVisible();
    await eventPage.getByRole('button', { name: 'פתח את תמונות האירוע' }).click();
    await expect(eventPage).toBeHidden();
    await expect(page.locator('.folder-button[aria-current="page"]')).toContainText('אירועים ופעילויות');

    // וגם כשהתיקייה כבר פעילה (התצוגה לא משתנה): ראש הרשת, לא המקום שבו נפתח העמוד.
    // עם הפחתת תנועה הקפיצה לרשת מיידית, והחזרה למקום הייתה דורסת אותה מיד.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.locator('[data-event-folder="1"]').click();
    await expect(eventPage).toBeVisible();
    await eventPage.getByRole('button', { name: 'פתח את תמונות האירוע' }).click();
    await expect(eventPage).toBeHidden();
    // ראש הרשת מתחת לכותרת הצפה (scroll-margin-top).
    const gridTop = () => page.locator('#photosGrid').evaluate(node =>
        Math.abs(Math.round(node.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(node).scrollMarginTop) || 0))));
    await expect.poll(gridTop).toBeLessThanOrEqual(1);
    await page.waitForTimeout(300);
    expect(await gridTop()).toBeLessThanOrEqual(1);
});

test('"חזור" של הדפדפן מאלבום של אדם מחזיר לאותו כרטיס, גם כשהיה עמוק מהמנה הראשונה', async ({ page, worker }) => {
    worker.seedPerson({ personId: 'fp_yossi', name: 'יוסי כהן', status: 'approved', faces: [{ imageId: 'img_e2e_5' }, { imageId: 'img_e2e_9' }] });
    await openGallery(page, worker, 150);
    // תמונה 70 היא הכרטיס ה-81, במנה השנייה של 48.
    await scrollToCard(page, 70);
    const before = await scrollY(page);
    const topBefore = await topOf(card(page, 70));
    expect(before).toBeGreaterThan(1000);

    await page.evaluate(() => { window.location.hash = '#person/fp_yossi'; });
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של יוסי כהן');
    await expect(cards(page)).toHaveCount(2);

    await page.goBack();
    await expect(page.locator('#tempSearchBanner')).toBeHidden();
    await expect(card(page, 70)).toBeVisible();
    // הכרטיסים שנבנו מחדש עולים למקומם באנימציה; המדידה אחריה.
    await settle(page);
    expect(Math.abs(await topOf(card(page, 70)) - topBefore)).toBeLessThanOrEqual(1);
    expect(Math.abs(await scrollY(page) - before)).toBeLessThanOrEqual(1);
    // הפוקוס היה על הכותרת של האלבום, שנעלמה: הוא עובר לכרטיס שבראש המסך.
    await expect(page.locator('#photosGrid .gallery-media:focus')).toHaveCount(1);
});

test('סינון לפי כיוון שנבחר בתוך אלבום של אדם: "חזור" מגיע לראש הרשת המסוננת, לא למקום הישן', async ({ page, worker }) => {
    // כל פריט שלישי לרוחב, השאר לאורך — הכרטיס 70 נשאר גם ברשת המסוננת.
    worker.seedFolders().seedImages(Array.from({ length: 150 }, (_, i) => imageRecord(i + 1,
        (i + 1) % 3 === 0 ? { width: 4032, height: 3024 } : { width: 3024, height: 4032 })));
    worker.seedPerson({ personId: 'fp_yossi', name: 'יוסי כהן', status: 'approved', faces: [{ imageId: 'img_e2e_5' }, { imageId: 'img_e2e_7' }] });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page).first()).toBeVisible();
    await scrollToCard(page, 70);
    expect(await scrollY(page)).toBeGreaterThan(1000);

    await page.evaluate(() => { window.location.hash = '#person/fp_yossi'; });
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של יוסי כהן');
    // הכיוון בחלונית "סינון" של סרגל הכלים; נסגרת לפני החזרה.
    await openGalleryFilters(page);
    await page.locator('#galleryOrientationFilter').selectOption('portrait');
    await expect(cards(page)).toHaveCount(2);
    await closeGalleryFilters(page);

    await page.goBack();
    await expect(page.locator('#tempSearchBanner')).toBeHidden();
    await expect(page.locator('#galleryOrientationFilter')).toHaveValue('portrait');
    await expect(cards(page).first()).toBeVisible();
    await settle(page);
    await page.waitForTimeout(300);
    // תצוגה אחרת: ראש הרשת המסוננת בראש המסך, ולא המקום של הכרטיס 70 מלפני האלבום
    // (בלי הכיוון במפתח התצוגה, הגלילה חזרה לעומק של יותר מ-4000 פיקסלים).
    const gridTop = await page.locator('#photosGrid').evaluate(node => Math.round(node.getBoundingClientRect().top));
    expect(gridTop).toBeGreaterThanOrEqual(-1);
    expect(await scrollY(page)).toBeLessThan(1000);
});

test('#people שנשאר בכתובת אחרי שרשימת האנשים נסגרה אינו מקפיץ את הגלריה למקום ישן', async ({ page, worker }) => {
    worker.seedPerson({ personId: 'fp_yossi', name: 'יוסי כהן', status: 'approved', faces: [{ imageId: 'img_e2e_5' }] });
    await openGallery(page, worker, 150);
    await scrollToCard(page, 120);
    // רשימת האנשים נפתחת ונסגרת ב-Escape; הכתובת נשארת #people, בלי אלבום.
    await page.evaluate(() => { window.location.hash = '#people'; });
    const directory = page.locator('#peopleDirectoryModal');
    await expect(directory).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(directory).toBeHidden();

    // הרבה אחר כך: "עדכונים אחרונים" ו"חזור לגלריה" — תצוגה אחרת, בלי "חזור" של
    // הדפדפן. הגלריה חוזרת לראש הרשת כמו תמיד, ולא למקום שבו נפתחה הרשימה.
    await scrollToCard(page, 60);
    await page.evaluate(() => window.showNewUpdates());
    const banner = page.locator('#tempSearchBanner');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'חזור לגלריה' }).click();
    await expect(banner).toBeHidden();
    await expect(card(page, 120)).toBeAttached();
    await settle(page);
    const gridTop = await page.locator('#photosGrid').evaluate(node => Math.round(node.getBoundingClientRect().top));
    expect(gridTop).toBeGreaterThanOrEqual(-1);
});

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

    test('"חזרה למעלה" מופיע אחרי כשני מסכים, גולל לראש הדף ומעביר את הפוקוס לכותרת', async ({ page, worker }) => {
        await openGallery(page, worker, 60);
        const button = page.getByRole('button', { name: 'חזרה לראש הדף' });
        await expect(button).toBeHidden();
        await expect(page.getByRole('button', { name: 'קיצורי מקלדת' })).toBeHidden();

        await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
        await page.waitForTimeout(100);
        await expect(button).toBeHidden();
        await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 2.5, behavior: 'instant' }));
        await expect(button).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        // בפינה שבסוף השורה (שמאל במימין לשמאל), בתוך המסך.
        const box = await button.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThan(390 / 2);

        await button.focus();
        await page.keyboard.press('Enter');
        // עם prefers-reduced-motion הגלילה מיידית.
        await expect.poll(() => scrollY(page)).toBe(0);
        await expect(page.locator('.brand-title')).toBeFocused();
        await expect(button).toBeHidden();

        // כפתור הלב החדש נכנס לסרגל התצוגה המלאה גם ברוחב טלפון.
        await cards(page).first().locator('.gallery-media').click();
        const bar = page.locator('#lightboxModal .lightbox-bar');
        for (const name of ['סימון כמועדף', 'הורדת קובץ המדיה', 'סגירת התצוגה המלאה']) {
            const box = await bar.getByRole('button', { name }).boundingBox();
            expect(box.x, name).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, name).toBeLessThanOrEqual(390);
        }
        const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow2).toBeLessThanOrEqual(0);
    });
});
