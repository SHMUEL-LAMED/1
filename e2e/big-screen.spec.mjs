// "מסך גדול" (big-screen.js) בדפדפן אמיתי, עם שעון מזויף (page.clock): הסבב
// מתקדם לבד, פריט שאושר בינתיים נכנס מיד אחרי השקופית הנוכחית עם תג "חדש",
// הבדיקה פעם בדקה (עם ETag) נעצרת כשהלשונית מוסתרת, הפקדים והסמן נעלמים
// בשקט, ה-Wake Lock נלקח ומשוחרר, ו-Escape יוצא מהכול בבת אחת.
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

// הבקשות לעמוד הראשון של תיקייה — מה שהמסך הגדול טוען מחדש.
const folderPageRequests = (worker, folderId) => worker.requestsTo('GET', '/data/images?')
    .filter(entry => entry.path.includes(`folderId=${folderId}`) && entry.path.includes('limit=120') && !entry.path.includes('after='));

async function openGallery(page, worker, records) {
    worker.seedFolders().seedImages(records);
    await seedSession(page, { worker });
    await page.addInitScript(() => {
        // שקופית של שלוש שניות (הקצרה שבבחירה), כדי שהסבב יתקדם מהר.
        try { localStorage.setItem('simchat_slideshow_interval', '3000'); } catch { /* חסום */ }
        // Wake Lock מדומה שרושם בקשה ושחרור.
        window.__wakeLog = [];
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                async request() {
                    window.__wakeLog.push('request');
                    const sentinel = new EventTarget();
                    sentinel.release = async () => { window.__wakeLog.push('release'); };
                    return sentinel;
                }
            }
        });
        // הסתרת הלשונית מתוך הבדיקה: visibilityState ו-hidden ואירוע visibilitychange.
        let hidden = false;
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
        window.__setHidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    });
    // השעון זורם כרגיל עד ש-fastForward קופץ קדימה.
    await page.clock.install();
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(records.length);
}

const wakeLog = page => page.evaluate(() => window.__wakeLog);

test('מדף האירוע: סבב, פריט חדש אחרי הנוכחי עם תג "חדש", בלי בדיקות בלשונית מוסתרת, ו-Escape יוצא', async ({ page, worker }) => {
    await openGallery(page, worker, [imageRecord(1), imageRecord(2), imageRecord(3)]);
    await page.locator('[data-event-folder="1"]').click();
    const eventPage = page.getByRole('dialog', { name: 'אירועים ופעילויות' });
    await expect(eventPage).toBeVisible();
    await eventPage.getByRole('button', { name: 'מסך גדול' }).click();

    const lightbox = page.locator('#lightboxModal');
    const counter = page.locator('#lightboxCounter');
    const title = page.locator('#lightboxTitle');
    const badge = page.locator('#bigScreenNewBadge');
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toHaveClass(/is-big-screen/);
    await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
    await expect(page.locator('#bigScreenEvent')).toHaveText('אירועים ופעילויות');
    await expect(page.locator('#bigScreenClock')).toHaveText(/^\d{2}:\d{2}$/);
    await expect(page.locator('#bigScreenStatus')).toContainText('מסך גדול');
    await expect(counter).toHaveText('1 מתוך 3');
    await expect(title).toHaveText('תמונה 3');
    await expect(badge).toBeHidden();
    // פעולות של צופה יחיד אינן על מסך האולם.
    await expect(page.locator('#lightboxShare')).toBeHidden();
    await expect(page.locator('#lightboxDownload')).toBeHidden();
    await expect.poll(() => wakeLog(page)).toEqual(['request']);
    const pollsAtStart = folderPageRequests(worker, '1').length;
    expect(pollsAtStart).toBeGreaterThan(0);

    // הסבב מתקדם לבד.
    await expect(counter).toHaveText('2 מתוך 3', { timeout: 6000 });
    await expect(title).toHaveText('תמונה 2');

    // שקט: הפקדים והסמן נעלמים; תנועה מחזירה אותם.
    await page.clock.fastForward(3100);
    await expect(lightbox).toHaveClass(/is-idle/);
    await expect.poll(() => page.locator('.lightbox-actions').evaluate(node => getComputedStyle(node).opacity)).toBe('0');
    expect(await page.locator('#lightboxStage').evaluate(node => getComputedStyle(node).cursor)).toBe('none');
    // השעון ושם האירוע נשארים.
    await expect(page.locator('#bigScreenEvent')).toBeVisible();
    await page.mouse.move(40, 40);
    await page.mouse.move(60, 60);
    await expect(lightbox).not.toHaveClass(/is-idle/);
    // עד כאן לא עברה דקה: אין בדיקה נוספת.
    expect(folderPageRequests(worker, '1')).toHaveLength(pollsAtStart);

    // פריט שאושר בינתיים: אחרי דקה הוא נכנס לסבב מיד אחרי השקופית הנוכחית.
    // המצגת מושהית (רווח) כדי שהשקופית הנוכחית תהיה ידועה; הבדיקות נמשכות
    // גם בהשהיה, וה-Wake Lock נשאר.
    await page.keyboard.press('Space');
    await expect(lightbox).toHaveAttribute('data-slideshow', 'paused');
    const [current] = (await counter.textContent()).split(' ');
    worker.seedImages([imageRecord(4, { caption: 'מעגל ריקודים גדול באולם' })]);
    await page.clock.fastForward(60_000);
    await expect.poll(() => folderPageRequests(worker, '1').length).toBe(pollsAtStart + 1);
    // הבדיקה נשלחת עם ETag של העמוד שכבר נטען.
    expect(folderPageRequests(worker, '1').at(-1).headers['if-none-match']).toBeTruthy();
    await expect(counter).toHaveText(`${current} מתוך 4`);
    await expect(page.locator('#bigScreenStatus')).toContainText('נוסף פריט חדש למצגת');
    expect(await wakeLog(page)).toEqual(['request']);
    await page.keyboard.press('Space');
    await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
    await expect(title).toHaveText('תמונה 4', { timeout: 6000 });
    await expect(counter).toHaveText(`${Number(current) + 1} מתוך 4`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('חדש');
    // כיתוב גדול וקריא במסך גדול (במצגת רגילה התיאור מוסתר).
    const caption = page.locator('#lightboxCaption');
    await expect(caption).toHaveText('מעגל ריקודים גדול באולם');
    await expect(caption).toBeVisible();
    expect(await caption.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(18);
    // הסבב עובר הלאה: התג נעלם, והפריט אינו "חדש" בסבב הבא.
    await expect(title).not.toHaveText('תמונה 4', { timeout: 6000 });
    await expect(badge).toBeHidden();

    // לשונית מוסתרת: אין שום בקשה לתיקייה, גם אחרי כמה דקות.
    const pollsBeforeHidden = folderPageRequests(worker, '1').length;
    await page.evaluate(() => window.__setHidden(true));
    worker.seedImages([imageRecord(5)]);
    await page.clock.fastForward(150_000);
    await page.waitForTimeout(300);
    expect(folderPageRequests(worker, '1')).toHaveLength(pollsBeforeHidden);
    // בחזרה אליה — בדיקה מיד, כי עברה יותר מדקה.
    await page.evaluate(() => window.__setHidden(false));
    await expect.poll(() => folderPageRequests(worker, '1').length).toBeGreaterThan(pollsBeforeHidden);
    await expect(counter).toHaveText(/ מתוך 5$/);

    // Escape יוצא מהמצגת ומהתצוגה בבת אחת, ומשחרר את ה-Wake Lock.
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
    await expect(lightbox).not.toHaveClass(/is-big-screen/);
    await expect(lightbox).not.toHaveAttribute('data-slideshow', /.+/);
    await expect(page.locator('#bigScreenInfo')).toBeHidden();
    await expect.poll(async () => (await wakeLog(page)).at(-1)).toBe('release');
    // ואחרי היציאה אין עוד בדיקות.
    const pollsAfterExit = folderPageRequests(worker, '1').length;
    await page.clock.fastForward(180_000);
    await page.waitForTimeout(300);
    expect(folderPageRequests(worker, '1')).toHaveLength(pollsAfterExit);
});

test('מסרגל הגלריה בטלפון, עם הפחתת תנועה: בלי Ken Burns, בלי גלילה לרוחב, ויציאה בכפתור', async ({ page, worker }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGallery(page, worker, [imageRecord(1), imageRecord(2), imageRecord(3)]);
    await page.getByRole('button', { name: 'מסך גדול' }).first().click();

    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toHaveClass(/is-big-screen/);
    await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
    await expect(page.locator('#bigScreenEvent')).toHaveText('כל התמונות');
    await expect(page.locator('#lightboxTitle')).toHaveText('תמונה 3');
    await expect(page.locator('#bigScreenInfo')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.waitForTimeout(300);
    expect(await page.locator('#lightboxImage').evaluate(element =>
        element.getAnimations().filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).length
    )).toBe(0);
    // הסבב מתקדם גם עם הפחתת תנועה (עמעום בלבד).
    await expect(page.locator('#lightboxCounter')).toHaveText('2 מתוך 3', { timeout: 6000 });

    // אחרי שלוש שניות בשקט הפקדים מוסתרים; תנועה מחזירה אותם ללחיצה.
    await page.mouse.move(100, 400);
    await page.mouse.move(120, 420);
    const exit = page.getByRole('button', { name: 'יציאה ממסך גדול' });
    await exit.click();
    await expect(lightbox).toBeHidden();
    await expect(lightbox).not.toHaveClass(/is-big-screen/);
    await expect.poll(async () => (await wakeLog(page)).at(-1)).toBe('release');
});

test('מצגת רגילה אינה מסך גדול: אין שעון, ו-Escape עוצר בלבד', async ({ page, worker }) => {
    await openGallery(page, worker, [imageRecord(1), imageRecord(2)]);
    await page.getByRole('button', { name: 'הפעל מצגת' }).first().click();
    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toHaveAttribute('data-slideshow', 'playing');
    await expect(lightbox).not.toHaveClass(/is-big-screen/);
    await expect(page.locator('#bigScreenInfo')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toHaveAttribute('data-slideshow', /.+/);
    await expect(lightbox).toBeVisible();
});
