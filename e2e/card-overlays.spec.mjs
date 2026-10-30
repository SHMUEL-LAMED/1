// מה שיושב על תמונת הכרטיס — הלב, תג הסרטון, תג "חדש", מספר הפריים, התווית
// "תצוגה מלאה" וכפתור ההפעלה — אינו נערם זה על זה ואינו נחתך בשולי הכרטיס:
// ברשת ובפסיפס, בשלושת הגדלים, בטלפון ובמחשב, גם בכרטיס צר של תמונה לאורך.
// וסרגל הכלים של התצוגה המלאה בטלפון: הכותרת קריאה והסרגל אינו מתנפח.
// הבדיקה מודדת מלבנים (getBoundingClientRect) ולא מצלמת: תווית ששקופה עד
// ריחוף עדיין נספרת, כי ברגע הריחוף היא גלויה במקומה.
import { test, expect, seedSession, imageRecord, makePng, API_ORIGIN, DEFAULT_USER } from './fixtures.mjs';

const VISIT_KEY = `simchas_gallery_last_visit_v1:${DEFAULT_USER.uid}`;
const HOUR = 60 * 60 * 1000;
const SHOTS = process.env.CARD_OVERLAY_SHOTS || '';

const OVERLAYS = ['.gallery-view', '.gallery-number', '.gallery-fav', '.gallery-badge', '.gallery-new-badge', '.gallery-play > span'];
const layoutButton = (page, name) => page.locator('.layout-toggle').getByRole('button', { name, exact: true });
const sizeButton = (page, name) => page.locator('.density-toggle:not(.layout-toggle)').getByRole('button', { name, exact: true });

// [רוחב, גובה, סרטון?, חדש?] — לפי סדר ההצגה (החדש ראשון). סרטונים לאורך
// ולרוחב, תמונות ביחס הצר ביותר שהפסיפס מתיר (1:2) ועד פנורמה, וחלקן "חדשות".
const ITEMS = [
    [1080, 1920, true, true],
    [1920, 1080, true, true],
    [600, 1200, false, true],
    [800, 800, false, true],
    [1600, 800, false, true],
    [900, 1200, true, false],
    [600, 1200, false, false],
    [1200, 800, false, false],
    [800, 1000, false, true],
    [2500, 1000, false, false]
];

function seedOverlayGallery(worker, now) {
    worker.seedFolders();
    const total = ITEMS.length;
    worker.seedImages(ITEMS.map(([width, height, isVideo, isNew], i) => {
        const index = total - i;
        const id = `img_e2e_${index}`;
        const createdAt = isNew ? now - HOUR + index * 1000 : now - 10 * HOUR + index * 1000;
        if (isVideo) {
            return imageRecord(index, {
                title: `סרטון ${index}`,
                url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/${id}.mp4`,
                r2Key: `approved/${DEFAULT_USER.uid}/${id}.mp4`,
                mediaType: 'video',
                mimeType: 'video/mp4',
                duration: 754,
                width,
                height,
                createdAt
            });
        }
        worker.objects.set(`approved/${DEFAULT_USER.uid}/${id}.jpg`, { bytes: makePng(width / 100, height / 100), contentType: 'image/png' });
        return imageRecord(index, { width, height, createdAt });
    }));
}

// ביקור חוזר: סוף הביקור הקודם לפני שעתיים, ולכן מה שנוסף בשעה האחרונה "חדש".
async function seedReturningVisit(page, now) {
    await page.addInitScript(([key, value]) => {
        try {
            if (sessionStorage.getItem('__e2eVisitSeeded')) return;
            localStorage.setItem(key, JSON.stringify(value));
            sessionStorage.setItem('__e2eVisitSeeded', '1');
        } catch {
            // אחסון חסום.
        }
    }, [VISIT_KEY, { previousVisit: now - 30 * HOUR, lastSeenAt: now - 2 * HOUR }]);
}

const settleAnimations = page => page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));

// כל שכבה גלויה על כל כרטיס: חפיפה בין שתיים, או שכבה שחורגת מהתמונה.
// transform (הזזת הכניסה של התווית, הגדלה בריחוף) מנוטרל לזמן המדידה, כדי
// שנמדד המקום שבו השכבה נחה.
function findCollisions(page) {
    return page.locator('#photosGrid .gallery-card').evaluateAll((cards, selectors) => {
        const problems = [];
        const style = document.createElement('style');
        style.textContent = '#photosGrid .gallery-card, #photosGrid .gallery-card * { transform: none !important; transition: none !important; }';
        document.head.append(style);
        for (const card of cards) {
            const media = card.querySelector('.gallery-media').getBoundingClientRect();
            const boxes = [];
            for (const selector of selectors) {
                const node = card.querySelector(selector);
                if (!node) continue;
                const computed = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                if (computed.display === 'none' || computed.visibility === 'hidden' || !rect.width || !rect.height) continue;
                boxes.push({ selector, rect });
                const out = rect.left < media.left - 0.5 || rect.right > media.right + 0.5
                    || rect.top < media.top - 0.5 || rect.bottom > media.bottom + 0.5;
                if (out) problems.push(`${card.dataset.mediaId} (${Math.round(media.width)}x${Math.round(media.height)}): ${selector} חורג מהתמונה`);
                // טקסט שנחתך בשלוש נקודות עדיין קריא; טקסט שגולש מהתג — לא.
                if (node.scrollWidth > node.clientWidth + 1 && computed.textOverflow !== 'ellipsis') {
                    problems.push(`${card.dataset.mediaId}: ${selector} גולש מעצמו`);
                }
            }
            for (let i = 0; i < boxes.length; i += 1) {
                for (let j = i + 1; j < boxes.length; j += 1) {
                    const a = boxes[i].rect;
                    const b = boxes[j].rect;
                    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
                        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
                    const where = box => `[${[box.left - media.left, box.top - media.top, box.width, box.height].map(Math.round).join(',')}]`;
                    if (overlap) problems.push(`${card.dataset.mediaId} (${Math.round(media.width)}x${Math.round(media.height)}): ${boxes[i].selector}${where(a)} על ${boxes[j].selector}${where(b)}`);
                }
            }
        }
        style.remove();
        return problems;
    }, OVERLAYS);
}

// התג "חדש" והלב נשארים על הכרטיס בכל הגדלים — רק במקום אחר או קטנים יותר.
function visibleCount(page, selector) {
    return page.locator(`#photosGrid ${selector}`).evaluateAll(nodes => nodes
        .filter(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0).length);
}

async function openGallery(page, worker) {
    const now = Date.now();
    seedOverlayGallery(worker, now);
    await seedReturningVisit(page, now);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(ITEMS.length);
    await expect(page.locator('#photosGrid .gallery-new-badge')).toHaveCount(ITEMS.filter(item => item[3]).length);
}

async function checkAllArrangements(page, viewportName, testInfo) {
    const problems = [];
    for (const layout of ['רשת', 'פסיפס']) {
        await layoutButton(page, layout).click();
        for (const size of ['קטן', 'בינוני', 'גדול']) {
            await sizeButton(page, size).click();
            await expect(sizeButton(page, size)).toHaveAttribute('aria-pressed', 'true');
            await settleAnimations(page);
            for (const problem of await findCollisions(page)) problems.push(`${layout}/${size}: ${problem}`);
            expect(await visibleCount(page, '.gallery-new-badge'), `${layout}/${size}: תג "חדש"`).toBe(ITEMS.filter(item => item[3]).length);
            if (SHOTS) {
                await page.locator('#photosGrid').screenshot({ path: `${SHOTS}/${viewportName}-${layout === 'רשת' ? 'grid' : 'masonry'}-${size}.png` });
            }
        }
    }
    await testInfo.attach('collisions', { body: problems.join('\n') || 'none', contentType: 'text/plain' });
    expect(problems).toEqual([]);
}

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('השכבות על הכרטיס אינן חופפות ואינן נחתכות בשום פריסה וגודל', async ({ page, worker }, testInfo) => {
        await openGallery(page, worker);
        await checkAllArrangements(page, 'phone', testInfo);
    });

    test('סרגל התצוגה המלאה: הכותרת גלויה כולה והסרגל נשאר נמוך', async ({ page, worker }) => {
        await openGallery(page, worker);
        await page.locator('#photosGrid .gallery-card').nth(2).locator('.gallery-media').click();
        const bar = page.locator('#lightboxModal .lightbox-bar');
        await expect(bar).toBeVisible();
        await settleAnimations(page);
        const title = page.locator('#lightboxTitle');
        await expect(title).toHaveText('תמונה 8');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-lightbox.png` });

        const metrics = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect();
            const titleNode = document.querySelector('#lightboxTitle');
            const buttons = [...document.querySelectorAll('#lightboxModal .lightbox-bar button')]
                .filter(node => node.getBoundingClientRect().width > 0)
                .map(node => node.getBoundingClientRect());
            return {
                bar: rect('#lightboxModal .lightbox-bar'),
                title: rect('#lightboxTitle'),
                details: rect('#lightboxDetails'),
                titleClipped: titleNode.scrollWidth > titleNode.clientWidth + 1,
                buttons,
                viewport: window.innerWidth
            };
        });
        // הכותרת והשורה שמתחתיה ברוחב סביר ובשורה אחת, ולא עמודה צרה שנשברת.
        expect(metrics.title.width).toBeGreaterThan(metrics.viewport * 0.6);
        expect(metrics.titleClipped).toBe(false);
        expect(metrics.title.height).toBeLessThan(30);
        // הסרגל: שורת כותרת, שורת פרטים (שמותר לה להישבר כשהיא ארוכה) ושורת
        // כפתורים — בלי עוד גובה מעבר לזה.
        expect(metrics.bar.height - metrics.details.height, JSON.stringify(metrics)).toBeLessThanOrEqual(96);
        expect(metrics.bar.right).toBeLessThanOrEqual(metrics.viewport);
        expect(metrics.bar.left).toBeGreaterThanOrEqual(0);
        // הכפתורים בתוך הסרגל, בשורה אחת, ואינם יושבים על הכותרת.
        const tops = new Set(metrics.buttons.map(box => Math.round(box.top)));
        expect(tops.size).toBe(1);
        for (const box of metrics.buttons) {
            expect(box.left).toBeGreaterThanOrEqual(metrics.bar.left);
            expect(box.right).toBeLessThanOrEqual(metrics.bar.right);
            expect(box.width).toBeGreaterThanOrEqual(40);
            expect(box.top).toBeGreaterThanOrEqual(metrics.details.bottom - 0.5);
        }

        // סדר ה-DOM, ולכן סדר המיקוד, לא השתנה: מהמצגת ועד הסגירה.
        const order = await page.locator('#lightboxModal .lightbox-bar button').evaluateAll(nodes => nodes
            .filter(node => node.getBoundingClientRect().width > 0)
            .map(node => node.id || node.getAttribute('aria-label')));
        expect(order).toEqual(['slideshowToggle', 'lightboxShare', 'lightboxFavorite', 'lightboxDownload', 'סגירת התצוגה המלאה']);
    });
});

test.describe('במחשב (1280px)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('השכבות על הכרטיס אינן חופפות ואינן נחתכות בשום פריסה וגודל', async ({ page, worker }, testInfo) => {
        await openGallery(page, worker);
        await checkAllArrangements(page, 'desktop', testInfo);
    });

    test('סרגל התצוגה המלאה נשאר בשורה אחת', async ({ page, worker }) => {
        await openGallery(page, worker);
        await page.locator('#photosGrid .gallery-card').nth(2).locator('.gallery-media').click();
        const bar = page.locator('#lightboxModal .lightbox-bar');
        await expect(bar).toBeVisible();
        await settleAnimations(page);
        const box = await bar.boundingBox();
        expect(box.height).toBeLessThan(80);
    });
});
