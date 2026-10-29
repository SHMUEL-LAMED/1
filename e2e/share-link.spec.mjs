// קישור ישיר לפריט (#media/<id>) וכפתור "שתף" בתצוגה המלאה: העתקה ושיתוף
// מערכת, הכתובת שעוקבת אחרי הפריט בלי להוסיף היסטוריה, פתיחה מקישור (גם
// לפריט ישן מעבר לעמוד הראשון), שער הגישה, ופריט שאינו קיים.
import { test, expect, seedSession, signInViaGoogle, imageRecord } from './fixtures.mjs';

const lightbox = page => page.locator('#lightboxModal');
const hashOf = page => page.evaluate(() => window.location.hash);
const historyLength = page => page.evaluate(() => window.history.length);

// navigator.share ו-navigator.clipboard מוחלפים לפני שקוד האתר רץ, כדי
// שהבדיקה תראה מה נשלח אליהם בלי חלון מערכת ובלי הרשאת לוח.
async function stubShareTargets(page, { nativeShare = false } = {}) {
    await page.addInitScript(nativeShare => {
        window.__copied = [];
        window.__shared = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async text => { window.__copied.push(text); } }
        });
        if (nativeShare) {
            Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__shared.push(data); } });
            Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        } else {
            Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        }
    }, nativeShare);
}

test('"שתף" מעתיק קישור לפריט; הכתובת עוקבת אחרי הדפדוף ומתנקה בסגירה בלי להוסיף היסטוריה', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    await stubShareTargets(page);
    await seedSession(page, { worker });
    await page.goto('/');
    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(3);
    const startLength = await historyLength(page);

    // החדשה ביותר ראשונה: תמונה 3.
    await cards.first().locator('.gallery-media').click();
    await expect(lightbox(page)).toBeVisible();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await expect.poll(() => hashOf(page)).toBe('#media/img_e2e_3');

    const share = page.locator('#lightboxShare');
    await expect(share).toHaveAttribute('aria-label', 'שתף קישור לפריט הזה');
    await share.click();
    await expect(page.locator('#customAlertMessage')).toContainText('הקישור הועתק');
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => window.__copied)).toEqual([`${origin}/#media/img_e2e_3`]);

    // דפדוף (חץ שמאלה = הבא) מעדכן את ה-hash במקום, והשיתוף הבא הוא של הפריט החדש.
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');
    await expect.poll(() => hashOf(page)).toBe('#media/img_e2e_2');
    await page.locator('#lightboxModal [aria-label="התמונה הבאה"]').click();
    await expect.poll(() => hashOf(page)).toBe('#media/img_e2e_1');
    await share.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toBe(`${origin}/#media/img_e2e_1`);

    // Escape סוגר ומנקה את ה-hash; אף שלב לא הוסיף רשומה להיסטוריה.
    await page.keyboard.press('Escape');
    await expect(lightbox(page)).toBeHidden();
    expect(await hashOf(page)).toBe('');
    expect(await historyLength(page)).toBe(startLength);
});

test('בטלפון "שתף" פותח את חלון השיתוף של המערכת עם הקישור, בלי להעתיק', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await page.setViewportSize({ width: 390, height: 844 });
    await stubShareTargets(page, { nativeShare: true });
    await seedSession(page, { worker });
    await page.goto('/');
    await page.locator('#photosGrid .gallery-card').first().locator('.gallery-media').click();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');

    // ברוחב טלפון הכפתור הוא אייקון בלבד, והסרגל אינו גולש.
    await expect(page.locator('#lightboxShare .lightbox-share-text')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.locator('#lightboxShare').click();
    const origin = new URL(page.url()).origin;
    await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([{
        title: 'תמונה 2',
        text: 'תמונה מהגלריה: תמונה 2',
        url: `${origin}/#media/img_e2e_2`
    }]);
    expect(await page.evaluate(() => window.__copied)).toEqual([]);
});

test('קישור ישיר פותח את הפריט גם כשהוא ישן מהעמוד הראשון, והדפדוף הוא בתיקייה שלו', async ({ page, worker }) => {
    // 125 תמונות: העמוד הראשון (120) אינו כולל את חמש הישנות ביותר.
    worker.seedFolders().seedImages(Array.from({ length: 125 }, (_, index) => imageRecord(index + 1)));
    await seedSession(page, { worker });
    await page.goto('/#media/img_e2e_1');

    await expect(lightbox(page)).toBeVisible();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 1');
    // הפריט נטען לפי מזהה, והדפדוף הוא בעמוד הראשון של התיקייה שלו ובו הפריט.
    expect(worker.requestsTo('GET', '/data/images?').some(entry => entry.path.includes('ids=img_e2e_1'))).toBe(true);
    await expect(page.locator('#lightboxCounter')).toHaveText('121 מתוך 121');
    expect(await hashOf(page)).toBe('#media/img_e2e_1');

    // "הקודם" (חץ ימינה) עובר לפריט הבא בתיקייה, והכתובת מתעדכנת.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#lightboxCounter')).toHaveText('120 מתוך 121');
    await expect.poll(() => hashOf(page)).toBe('#media/img_e2e_6');

    await page.locator('#lightboxModal [aria-label="סגירת התצוגה המלאה"]').click();
    await expect(lightbox(page)).toBeHidden();
    expect(await hashOf(page)).toBe('');
});

test('קישור שהודבק בלשונית פתוחה נפתח, ו"חזור" סוגר אותו', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);

    await page.evaluate(() => { window.location.hash = '#media/img_e2e_2'; });
    await expect(lightbox(page)).toBeVisible();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');
    await expect(page.locator('#lightboxCounter')).toHaveText('2 מתוך 3');

    await page.goBack();
    await expect(lightbox(page)).toBeHidden();
    expect(await hashOf(page)).toBe('');
});

test('קישור לפני הכניסה: שער הגישה מוצג, והפריט נפתח מיד אחרי ההתחברות', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    worker.seedUser();
    await page.goto('/#media/img_e2e_2');

    const gate = page.locator('#galleryAccessGate');
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(lightbox(page)).toBeHidden();
    // לפני הכניסה אין פנייה לנתונים, והקישור נשאר בכתובת.
    expect(worker.requestsTo('GET', '/data/images')).toHaveLength(0);
    expect(await hashOf(page)).toBe('#media/img_e2e_2');

    await signInViaGoogle(page);
    await expect(gate).toBeHidden();
    await expect(lightbox(page)).toBeVisible();
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');
});

test('חשבון שממתין לאישור רואה את שער ההמתנה, והקישור אינו נפתח', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker, approved: false });
    await page.goto('/#media/img_e2e_1');

    await expect(page.locator('#galleryAccessGate')).toHaveAttribute('data-gate-state', 'pending');
    await expect(lightbox(page)).toBeHidden();
    expect(await hashOf(page)).toBe('#media/img_e2e_1');
});

test('קישור לפריט שאינו קיים מציג הודעה ברורה ומנקה את הכתובת', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/#media/img_missing');

    await expect(page.locator('#customAlertMessage')).toContainText('הפריט שבקישור לא נמצא');
    await expect(lightbox(page)).toBeHidden();
    await expect.poll(() => hashOf(page)).toBe('');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
});

test('התנתקות סוגרת פריט שנפתח מקישור ומנקה את הכתובת', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/#media/img_e2e_1');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 1');

    await page.evaluate(() => window.signOutGoogleAccount(true));
    await expect(lightbox(page)).toBeHidden();
    await expect(page.locator('#galleryAccessGate')).toBeVisible();
    expect(await hashOf(page)).toBe('');
});
