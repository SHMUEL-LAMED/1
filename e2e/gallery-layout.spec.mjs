// גודל הכרטיסים ופריסת הגלריה: המתגים בסרגל הכלים, "פסיפס" ששומר על יחס כל
// תמונה בלי לחתוך, סדר שתואם את המיקוד במקלדת, שמירה לכל צופה, בחירה מרובה,
// גלילה הדרגתית ומסך טלפון. התמונות כאן נזרעות במידות אמיתיות (ה-PNG שהזיוף
// מגיש), כדי שהיחס שנמדד בדפדפן יהיה היחס שהרשומה מתארת.
import { test, expect, seedSession, imageRecord, makePng, DEFAULT_USER } from './fixtures.mjs';

const LAYOUT_KEY = 'simchat-gallery-layout';
const DENSITY_KEY = 'simchat-gallery-density';
const grid = page => page.locator('#photosGrid');
const cards = page => page.locator('#photosGrid .gallery-card');
const layoutButton = (page, name) => page.locator('.layout-toggle').getByRole('button', { name, exact: true });
const sizeButton = (page, name) => page.locator('.density-toggle:not(.layout-toggle)').getByRole('button', { name, exact: true });

// [רוחב, גובה] של כל תמונה, לפי הסדר שבו הכרטיסים מוצגים (החדשה ראשונה).
const SHAPES = [[16, 8], [6, 12], [12, 8], [8, 8], [9, 12], [16, 9]];

// התמונה הראשונה מתארת את מידותיה ברשומה (כמו העלאה שהוקטנה), והשאר לא —
// אצלן היחס נמדד מהתמונה כשהיא נטענת.
function seedShapedGallery(worker, shapes = SHAPES) {
    worker.seedFolders();
    const total = shapes.length;
    worker.seedImages(shapes.map(([width, height], i) => {
        const index = total - i;
        const record = imageRecord(index, i === 0 ? { width: width * 100, height: height * 100 } : {});
        worker.objects.set(`approved/${DEFAULT_USER.uid}/img_e2e_${index}.jpg`, { bytes: makePng(width, height), contentType: 'image/png' });
        return record;
    }));
}

// אנימציות הכניסה מזיזות את הכרטיסים; המדידות אחריהן. אנימציות אינסופיות
// (הברק של השלד, הרקע) אינן משנות מידות.
const settleAnimations = page => page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));

// המידות של כל כרטיס ושל התמונה שבו, לפי סדר ה-DOM.
const measureCards = page => page.locator('#photosGrid .gallery-card').evaluateAll(nodes => nodes.map(node => {
    const media = node.querySelector('.gallery-media').getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const img = node.querySelector('img.gallery-card-img');
    return {
        id: node.dataset.mediaId,
        top: Math.round(box.top), left: box.left, right: box.right, height: box.height,
        mediaWidth: media.width, mediaHeight: media.height,
        natural: img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0,
        fit: img ? getComputedStyle(img).objectFit : ''
    };
}));

// התמונות שבמסך נטענו (loading="lazy": מה שמתחת לקפל נטען רק בגלילה).
const allImagesLoaded = page => page.locator('#photosGrid .gallery-card img.gallery-card-img')
    .evaluateAll(images => images
        .filter(img => img.getBoundingClientRect().top < window.innerHeight)
        .every(img => img.complete && img.naturalWidth > 0));

test('פסיפס שומר על יחס כל תמונה בלי חיתוך, בשורות שוות גובה ובסדר הקריאה, ונשמר לביקור הבא', async ({ page, worker }) => {
    seedShapedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(SHAPES.length);

    // ברירת המחדל: רשת בגודל בינוני, כמו קודם.
    await expect(grid(page)).toHaveAttribute('data-layout', 'grid');
    await expect(grid(page)).toHaveAttribute('data-density', 'comfortable');
    await expect(layoutButton(page, 'רשת')).toHaveAttribute('aria-pressed', 'true');
    await expect(layoutButton(page, 'פסיפס')).toHaveAttribute('aria-pressed', 'false');
    await expect(sizeButton(page, 'בינוני')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.layout-toggle')).toHaveAttribute('role', 'group');
    await expect(page.locator('.layout-toggle')).toHaveAttribute('aria-label', 'פריסת הגלריה');

    // היחס הידוע מהרשומה כבר במרקאפ; לשאר הוא נכתב כשהתמונה נטענת.
    await expect(cards(page).first()).toHaveAttribute('style', /--media-ratio:\s*2(?![\d.])/);
    await expect.poll(() => allImagesLoaded(page)).toBe(true);
    await expect(cards(page).nth(1)).toHaveAttribute('style', /--media-ratio:\s*0\.5(?![\d.])/);

    // ברשת המשבצות אחידות והתמונה נחתכת אליהן.
    await settleAnimations(page);
    const gridBoxes = await measureCards(page);
    for (const box of gridBoxes) {
        expect(box.mediaWidth / box.mediaHeight).toBeCloseTo(4 / 3, 1);
        expect(box.fit).toBe('cover');
    }

    // מעבר לפסיפס הוא CSS בלבד: אותם אלמנטים, בלי רינדור מחדש.
    await cards(page).first().evaluate(node => { node.dataset.e2eMark = 'same'; });
    await layoutButton(page, 'פסיפס').click();
    await expect(grid(page)).toHaveAttribute('data-layout', 'masonry');
    await expect(layoutButton(page, 'פסיפס')).toHaveAttribute('aria-pressed', 'true');
    await expect(layoutButton(page, 'רשת')).toHaveAttribute('aria-pressed', 'false');
    await expect(cards(page).first()).toHaveAttribute('data-e2e-mark', 'same');

    await settleAnimations(page);
    const boxes = await measureCards(page);
    for (const box of boxes) {
        // כל תמונה ביחס שלה (בטווח של עיגול לפיקסלים) ומוצגת כולה.
        expect(box.mediaWidth / box.mediaHeight, box.id).toBeCloseTo(box.natural, 1);
        expect(box.fit).toBe('contain');
    }
    // כרטיסים באותה שורה — באותו גובה; והסדר על המסך (מימין לשמאל, שורה אחר
    // שורה) הוא סדר ה-DOM, ולכן גם סדר המיקוד במקלדת.
    const rows = new Map();
    for (const box of boxes) rows.set(box.top, [...(rows.get(box.top) || []), box]);
    for (const row of rows.values()) {
        const heights = row.map(box => box.mediaHeight);
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < boxes.length; i += 1) {
        const [previous, current] = [boxes[i - 1], boxes[i]];
        if (current.top === previous.top) expect(current.right).toBeLessThanOrEqual(previous.left + 1);
        else expect(current.top).toBeGreaterThan(previous.top);
    }
    // ובפועל: Tab מהכרטיס הראשון מגיע לכפתור הלב שלו ואז לכרטיס השני.
    await cards(page).first().locator('.gallery-media').focus();
    await page.keyboard.press('Tab');
    await expect(cards(page).first().locator('.gallery-fav')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cards(page).nth(1).locator('.gallery-media')).toBeFocused();

    // גודל קטן: שורות נמוכות יותר ויותר כרטיסים בשורה הראשונה.
    const firstRowCount = list => list.filter(box => box.top === list[0].top).length;
    await sizeButton(page, 'קטן').click();
    await expect(grid(page)).toHaveAttribute('data-density', 'compact');
    await expect(sizeButton(page, 'קטן')).toHaveAttribute('aria-pressed', 'true');
    await settleAnimations(page);
    const small = await measureCards(page);
    expect(small[0].mediaHeight).toBeLessThan(boxes[0].mediaHeight);
    expect(firstRowCount(small)).toBeGreaterThanOrEqual(firstRowCount(boxes));
    for (const box of small) expect(box.mediaWidth / box.mediaHeight, box.id).toBeCloseTo(box.natural, 1);

    // שתי הבחירות נשמרו לצופה הזה, וחוזרות אחרי רענון.
    expect(await page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [LAYOUT_KEY, DENSITY_KEY]))
        .toEqual(['masonry', 'compact']);
    await page.reload();
    await expect(cards(page)).toHaveCount(SHAPES.length);
    await expect(grid(page)).toHaveAttribute('data-layout', 'masonry');
    await expect(grid(page)).toHaveAttribute('data-density', 'compact');
    await expect(layoutButton(page, 'פסיפס')).toHaveAttribute('aria-pressed', 'true');
    await expect(sizeButton(page, 'קטן')).toHaveAttribute('aria-pressed', 'true');

    // חזרה לרשת מחזירה את המשבצות האחידות.
    await layoutButton(page, 'רשת').click();
    await settleAnimations(page);
    for (const box of await measureCards(page)) expect(box.mediaWidth / box.mediaHeight).toBeCloseTo(1, 1);
});

test('בפסיפס: בחירה מרובה עובדת, חיפוש בלי תוצאות מסתיר את הרשת, וגלילה מוסיפה מנות', async ({ page, worker }) => {
    worker.seedGallery({ images: 120 });
    await page.addInitScript(key => { try { localStorage.setItem(key, 'masonry'); } catch { /* אחסון חסום */ } }, LAYOUT_KEY);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');

    await expect(grid(page)).toHaveAttribute('data-layout', 'masonry');
    await expect(cards(page)).toHaveCount(48);
    await expect(grid(page)).toHaveCSS('display', 'flex');

    // הזקיף ממשיך לעבוד: גלילה לתחתית מוסיפה מנה, בלי כרטיס כפול.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect(cards(page)).toHaveCount(96);
    const ids = await cards(page).evaluateAll(nodes => nodes.map(node => node.dataset.mediaId));
    expect(new Set(ids).size).toBe(96);
    await expect(cards(page).nth(48).locator('.gallery-number')).toHaveText('49');

    // בחירה מרובה: הכפתור שעל הכרטיס נגיש ולחיץ גם בפסיפס.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.evaluate(() => window.toggleBulkSelectionMode(true));
    const pick = cards(page).first().getByRole('button', { name: 'בחירת הפריט' });
    await expect(pick).toBeVisible();
    await pick.click();
    await expect(page.locator('#bulkSelectedCount')).toHaveText('1');
    await expect(cards(page).first().getByRole('button', { name: 'ביטול בחירה' })).toBeVisible();
    await page.evaluate(() => window.toggleBulkSelectionMode(false));

    // אין פריטים: הרשת מוסתרת גם כשה-display שלה מגיע מהפסיפס.
    await page.locator('#searchInput').fill('אין-כזה-דבר-בכלל');
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(grid(page)).toBeHidden();
    await page.locator('#searchInput').fill('');
    await expect(grid(page)).toBeVisible();
    await expect(grid(page)).toHaveCSS('display', 'flex');
});

test('כרטיס שנבנה מחדש (בחירה מרובה, לב) שומר את היחס שנמדד, והשורה אינה קופצת', async ({ page, worker }) => {
    seedShapedGallery(worker);
    await page.addInitScript(key => { try { localStorage.setItem(key, 'masonry'); } catch { /* אחסון חסום */ } }, LAYOUT_KEY);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(SHAPES.length);
    await expect.poll(() => allImagesLoaded(page)).toBe(true);
    await expect(cards(page).nth(1)).toHaveAttribute('style', /--media-ratio:\s*0\.5(?![\d.])/);

    // הרינדור והקריאה באותה משימה: לפני שהתמונה שבכרטיס החדש מספיקה להיטען
    // ולמדוד את עצמה שוב. בלי ההעברה הכרטיס היה נופל ל-4:3 עד אז.
    const rebuilt = await page.evaluate(() => {
        const before = document.querySelectorAll('#photosGrid .gallery-card')[1];
        window.toggleBulkSelectionMode(true);
        window._doRenderImages();
        const after = document.querySelectorAll('#photosGrid .gallery-card')[1];
        return { replaced: before !== after, ratio: after.style.getPropertyValue('--media-ratio').trim() };
    });
    expect(rebuilt).toEqual({ replaced: true, ratio: '0.5' });
});

test('אחסון חסום: המתגים עובדים בלי שגיאה, והבחירה תקפה עד רענון', async ({ page, worker }) => {
    seedShapedGallery(worker);
    await seedSession(page, { worker });
    await page.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (String(key).startsWith('simchat-gallery-')) throw new DOMException('quota', 'QuotaExceededError');
            return original.call(this, key, value);
        };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(cards(page)).toHaveCount(SHAPES.length);

    await layoutButton(page, 'פסיפס').click();
    await sizeButton(page, 'גדול').click();
    await expect(grid(page)).toHaveAttribute('data-layout', 'masonry');
    await expect(grid(page)).toHaveAttribute('data-density', 'large');
    expect(errors).toEqual([]);

    await page.reload();
    await expect(cards(page)).toHaveCount(SHAPES.length);
    await expect(grid(page)).toHaveAttribute('data-layout', 'grid');
    await expect(grid(page)).toHaveAttribute('data-density', 'comfortable');
});

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('המתגים זמינים, קטן = יותר כרטיסים בשורה, ואין גלילה אופקית', async ({ page, worker }) => {
        seedShapedGallery(worker, [...SHAPES, ...SHAPES.slice().reverse()]);
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(cards(page)).toHaveCount(SHAPES.length * 2);
        await expect(layoutButton(page, 'פסיפס')).toBeVisible();
        await expect(sizeButton(page, 'קטן')).toBeVisible();

        const noHorizontalScroll = () => page.evaluate(() =>
            document.documentElement.scrollWidth <= 390 && window.innerWidth === 390 && window.scrollX === 0);
        const firstRowCount = async () => {
            await settleAnimations(page);
            const boxes = await measureCards(page);
            for (const box of boxes) {
                expect(box.left).toBeGreaterThanOrEqual(0);
                expect(box.right).toBeLessThanOrEqual(390);
            }
            return boxes.filter(box => box.top === boxes[0].top).length;
        };

        await layoutButton(page, 'פסיפס').click();
        await expect.poll(() => allImagesLoaded(page)).toBe(true);
        await sizeButton(page, 'גדול').click();
        const large = await firstRowCount();
        expect(await noHorizontalScroll()).toBe(true);
        await sizeButton(page, 'קטן').click();
        const small = await firstRowCount();
        expect(await noHorizontalScroll()).toBe(true);
        expect(small).toBeGreaterThan(large);
        expect(small).toBeGreaterThanOrEqual(3);

        // הכרטיס עדיין נפתח בנגיעה.
        await cards(page).first().locator('.gallery-media').click();
        await expect(page.locator('#lightboxModal')).toBeVisible();
    });
});
