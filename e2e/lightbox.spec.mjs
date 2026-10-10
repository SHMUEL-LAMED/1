// מחוות התצוגה המלאה והמצגת, בדפדפן אמיתי: זום בלחיצה כפולה ובגלגלת עם
// Ctrl (והחלפה לקובץ המקורי), החלקה במגע על מסך טלפון (כיוון מימין לשמאל,
// גומייה בקצה, משיכה למטה לסגירה), ומצגת (התקדמות, השהיה ברווח, Escape).
import {
    test, expect, seedSession, imageRecord, mediaUrl, variantEntries, variantUrl
} from './fixtures.mjs';

const stageZoom = page => page.locator('#lightboxStage').getAttribute('data-zoom');

async function openFirstCard(page, worker, records) {
    worker.seedFolders().seedImages(records);
    await seedSession(page, { worker });
    await page.goto('/');
    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(records.length);
    return cards;
}

test.describe('זום', () => {
    test('לחיצה כפולה מגדילה ל-2.5x ומחליפה לקובץ המקורי, וגלגלת עם Ctrl מגדילה ומקטינה', async ({ page, worker }) => {
        const cards = await openFirstCard(page, worker, [
            imageRecord(1, { variants: variantEntries('img_e2e_1'), variantsVersion: 1 }),
            imageRecord(2),
            imageRecord(3)
        ]);
        // הישנה ביותר (עם התצוגות) היא האחרונה במיון.
        await cards.nth(2).locator('.gallery-media').click();
        const lightbox = page.locator('#lightboxModal');
        await expect(lightbox).toBeVisible();
        const image = page.locator('#lightboxImage');
        const stage = page.locator('#lightboxStage');
        await expect(image).toHaveAttribute('src', variantUrl('img_e2e_1', 'medium'));
        await expect(stage).toHaveAttribute('data-zoom', '1');

        await stage.dblclick();
        await expect(stage).toHaveAttribute('data-zoom', '2.50');
        await expect(stage).toHaveClass(/is-zoomed/);
        expect(await image.evaluate(element => element.style.scale)).toBe('2.5');
        // ההגדלה מביאה את המקור ברזולוציה מלאה, לא את התצוגה הבינונית.
        await expect(image).toHaveAttribute('src', mediaUrl('img_e2e_1'));
        await expect(image).toHaveAttribute('srcset', `${mediaUrl('img_e2e_1')} 1x`);
        await expect(image).toHaveAttribute('data-zoom-source', 'original');

        await stage.dblclick();
        await expect(stage).toHaveAttribute('data-zoom', '1');
        await expect(stage).not.toHaveClass(/is-zoomed/);

        // גלגלת עם Ctrl (כך גם צביטה במשטח מגע) סביב הסמן.
        const box = await stage.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -100);
        await expect.poll(async () => Number(await stageZoom(page))).toBeGreaterThan(2);
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
        // התקרה: 5x.
        await expect(stage).toHaveAttribute('data-zoom', '5.00');
        for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 200);
        await page.keyboard.up('Control');
        await expect(stage).toHaveAttribute('data-zoom', '1');

        // גלגלת בלי Ctrl, כשלא מוגדל, אינה מגדילה.
        await page.mouse.wheel(0, -200);
        await expect(stage).toHaveAttribute('data-zoom', '1');

        // מעבר פריט מאפס את הזום.
        await stage.dblclick();
        await expect(stage).toHaveAttribute('data-zoom', '2.50');
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#lightboxCounter')).toHaveText('1 מתוך 3');
        await expect(stage).toHaveAttribute('data-zoom', '1');
        expect(await image.evaluate(element => element.style.scale)).toBe('');
    });
});

test.describe('החלקה במגע', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    // אירועי מגע אמיתיים דרך CDP — Chromium מתרגם אותם ל-Pointer Events.
    async function touchDrag(page, from, to, { steps = 8, duration = 160 } = {}) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
        for (let i = 1; i <= steps; i++) {
            const x = from.x + ((to.x - from.x) * i) / steps;
            const y = from.y + ((to.y - from.y) * i) / steps;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
            await page.waitForTimeout(duration / steps);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    }

    // הקשה כפולה: ארבעת אירועי המגע נשלחים יחד, בלי סבב הלוך-חזור לבדיקה בין
    // ההקשות, כך ששתיהן נקלטות בתוך חלון ההקשה הכפולה (300ms) גם כשהמכונה
    // עמוסה. שתי קריאות נפרדות ל-touchscreen.tap עלולות לחרוג ממנו.
    async function doubleTap(page, point) {
        const cdp = await page.context().newCDPSession(page);
        const touchPoints = [{ x: point.x, y: point.y }];
        await Promise.all([
            cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints }),
            cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        ]);
        await cdp.detach();
    }

    test('גרירה ימינה עוברת לבא, שמאלה חוזרת, בקצה יש גומייה, ומשיכה למטה סוגרת', async ({ page, worker }) => {
        const cards = await openFirstCard(page, worker, [imageRecord(1), imageRecord(2), imageRecord(3)]);
        await cards.first().locator('.gallery-media').click();
        const lightbox = page.locator('#lightboxModal');
        const counter = page.locator('#lightboxCounter');
        const stage = page.locator('#lightboxStage');
        await expect(lightbox).toBeVisible();
        await expect(counter).toHaveText('1 מתוך 3');
        // אין גלילה אופקית של הדף ברוחב טלפון, גם עם פקדי התצוגה המלאה.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        const box = await stage.boundingBox();
        const y = box.y + box.height / 2;
        const left = { x: 110, y };
        const right = { x: 290, y };

        // הפריט הראשון: גרירה שמאלה (אל הקודם) נמתחת וחוזרת.
        await touchDrag(page, right, left);
        await page.waitForTimeout(400);
        await expect(counter).toHaveText('1 מתוך 3');
        await expect.poll(() => stage.evaluate(element => element.style.translate)).toBe('');

        // מימין לשמאל: גרירה ימינה מושכת את הפריט הבא (שמשמאל, כמו כפתור "התמונה הבאה").
        await touchDrag(page, left, right);
        await expect(counter).toHaveText('2 מתוך 3');
        await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 2');

        // אחרי שהפריט החדש נכנס לבמה.
        await page.waitForTimeout(500);
        await touchDrag(page, right, left);
        await expect(counter).toHaveText('1 מתוך 3');

        // גרירה קצרה ואיטית אינה מדפדפת.
        await page.waitForTimeout(400);
        await touchDrag(page, { x: 200, y }, { x: 240, y }, { steps: 8, duration: 800 });
        await page.waitForTimeout(400);
        await expect(counter).toHaveText('1 מתוך 3');

        // הקשה כפולה מגדילה; בזמן זום גרירה מזיזה ואינה מדפדפת.
        await doubleTap(page, { x: 200, y });
        await expect(stage).toHaveAttribute('data-zoom', '2.50');
        await touchDrag(page, left, right);
        await page.waitForTimeout(400);
        await expect(counter).toHaveText('1 מתוך 3');
        await doubleTap(page, { x: 200, y });
        await expect(stage).toHaveAttribute('data-zoom', '1');

        // משיכה למטה סוגרת.
        await page.waitForTimeout(400);
        await touchDrag(page, { x: 200, y: y - 150 }, { x: 205, y: y + 200 });
        await expect(lightbox).toBeHidden();
    });
});

test.describe('מצגת', () => {
    test('הפעל מצגת: מתקדמת לבד, רווח משהה וממשיך, Escape עוצר', async ({ page, worker }) => {
        const cards = await openFirstCard(page, worker, [imageRecord(1), imageRecord(2), imageRecord(3)]);
        await cards.first().locator('.gallery-media').click();
        const lightbox = page.locator('#lightboxModal');
        const counter = page.locator('#lightboxCounter');
        const status = page.locator('#slideshowStatus');
        await expect(counter).toHaveText('1 מתוך 3');
        await expect(page.locator('#slideshowControls')).toBeHidden();

        const toggle = page.locator('#slideshowToggle');
        await expect(toggle).toHaveAttribute('aria-label', 'הפעל מצגת');
        await toggle.click();
        await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
        await expect(page.locator('#slideshowControls')).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-label', 'עצירת המצגת');
        await expect(status).toContainText('המצגת פועלת');

        await page.locator('#slideshowInterval').selectOption('3000');
        await expect(status).toContainText('3 שניות לשקופית');
        // רווח כשהפוקוס על כפתור: משהה פעם אחת, בלי "ללחוץ" על הכפתור.
        await page.locator('#slideshowPauseBtn').focus();

        await expect(counter).toHaveText('2 מתוך 3', { timeout: 6000 });
        // תנועת Ken Burns על התמונה (Web Animations, לא אנימציית ה-CSS).
        await expect.poll(() => page.locator('#lightboxImage').evaluate(element =>
            element.getAnimations().filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).length
        )).toBeGreaterThan(0);

        await page.keyboard.press('Space');
        await expect(lightbox).toHaveAttribute('data-slideshow', 'paused');
        await expect(status).toContainText('מושהית');
        await expect(page.locator('#slideshowPauseBtn')).toHaveAttribute('aria-label', 'המשך המצגת');
        const pausedAt = await counter.textContent();
        await page.waitForTimeout(3600);
        await expect(counter).toHaveText(pausedAt);

        await page.keyboard.press('Space');
        await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
        await expect(status).toContainText('ממשיכה');
        await expect(counter).not.toHaveText(pausedAt, { timeout: 6000 });

        await page.keyboard.press('Escape');
        await expect(lightbox).not.toHaveAttribute('data-slideshow', /.+/);
        await expect(status).toContainText('המצגת נעצרה');
        await expect(page.locator('#slideshowControls')).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-label', 'הפעל מצגת');
        // Escape הראשון עוצר את המצגת בלבד; השני סוגר את התצוגה.
        await expect(lightbox).toBeVisible();
        const stoppedAt = await counter.textContent();
        await page.waitForTimeout(3500);
        await expect(counter).toHaveText(stoppedAt);
        await page.keyboard.press('Escape');
        await expect(lightbox).toBeHidden();
    });

    test('הפעל מצגת מסרגל הגלריה: מתחיל מהפריט הראשון, ועם הפחתת תנועה — בלי Ken Burns', async ({ page, worker }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openFirstCard(page, worker, [imageRecord(1), imageRecord(2), imageRecord(3)]);
        await page.getByRole('button', { name: 'הפעל מצגת' }).first().click();
        const lightbox = page.locator('#lightboxModal');
        await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
        await expect(page.locator('#lightboxCounter')).toHaveText('1 מתוך 3');
        await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
        await page.waitForTimeout(300);
        expect(await page.locator('#lightboxImage').evaluate(element =>
            element.getAnimations().filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).length
        )).toBe(0);
        // הזום כבוי בזמן מצגת.
        await page.locator('#lightboxStage').dblclick();
        await expect(page.locator('#lightboxStage')).toHaveAttribute('data-zoom', '1');

        await page.locator('#slideshowStopBtn').click();
        await expect(lightbox).not.toHaveAttribute('data-slideshow', /.+/);
        await expect(page.locator('#slideshowStatus')).toContainText('המצגת נעצרה');
    });
});
