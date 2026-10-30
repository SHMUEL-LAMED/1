// הטעינה הראשונה של דף הגלריה: מה יורד מיד ובעדיפות גבוהה (השורה הראשונה
// שבמסך והאריח הגדול של הפסיפס), החיבור מראש ל-Worker, הגלריה שאינה מחכה
// ל-lucide ופסיפס שגובהו אינו קופץ כשהתמונות מגיעות. המדידה עצמה:
// scripts/measure-first-load.mjs.
import { test, expect, seedSession, STAGING_API_ORIGIN, API_ORIGIN } from './fixtures.mjs';
import { aboveFoldCardCount } from '../first-load.js';

const cards = page => page.locator('#photosGrid .gallery-card');
const tiles = page => page.locator('#heroMosaic img');

// הראש של כל כרטיס ביחס למסך, ומצב הטעינה של התמונה שבו.
function cardStates(page) {
    return cards(page).evaluateAll(nodes => nodes.map(node => {
        const image = node.querySelector('img.gallery-card-img');
        const { top, bottom } = node.getBoundingClientRect();
        return { top, bottom, loading: image?.loading, priority: image?.fetchPriority };
    }));
}

test.describe('מסך רחב', () => {
    test.use({ viewport: { width: 1366, height: 1000 } });

    test('השורה הראשונה יורדת מיד ובעדיפות גבוהה, כל השאר עצלים', async ({ page, worker }) => {
        worker.seedGallery({ images: 12 });
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(cards(page)).toHaveCount(12);

        const states = await cardStates(page);
        const eager = aboveFoldCardCount(states, 1000);
        // ברוחב הזה הרשת מתחילה בתוך המסך, בשלוש עמודות.
        expect(eager).toBe(3);
        states.forEach((state, index) => {
            expect(state, `כרטיס ${index + 1}`).toMatchObject(index < eager
                ? { loading: 'eager', priority: 'high' }
                : { loading: 'lazy', priority: 'auto' });
        });
        // הכרטיסים בשורה הראשונה באמת נטענו.
        await expect.poll(() => cards(page).first().locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    });

    test('האריח הגדול בפסיפס בעדיפות גבוהה, וכל האריחים אינם עצלים', async ({ page, worker }) => {
        worker.seedGallery({ images: 7 });
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(tiles(page)).toHaveCount(5);
        await expect(tiles(page).first()).toHaveAttribute('fetchpriority', 'high');
        for (let index = 0; index < 5; index += 1) {
            await expect(tiles(page).nth(index)).toHaveAttribute('loading', 'eager');
            if (index > 0) await expect(tiles(page).nth(index)).toHaveAttribute('fetchpriority', 'auto');
        }
    });
});

test.describe('טלפון', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('הרשת מתחת למסך: אף כרטיס אינו בעדיפות גבוהה, והפסיפס כן', async ({ page, worker }) => {
        worker.seedGallery({ images: 8 });
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(cards(page)).toHaveCount(8);
        await expect(tiles(page)).toHaveCount(5);

        const states = await cardStates(page);
        expect(states[0].top).toBeGreaterThan(844);
        for (const state of states) expect(state).toMatchObject({ loading: 'lazy', priority: 'auto' });
        await expect(tiles(page).first()).toHaveAttribute('fetchpriority', 'high');
    });

    test('גובה הפסיפס זהה כשהוא ריק וכשהתמונות נכנסו אליו', async ({ page, worker }) => {
        worker.seedGallery({ images: 6 });
        await seedSession(page, { worker });
        // ב-DOMContentLoaded הנתונים עוד לא הגיעו, והפסיפס הוא המשטח הדקורטיבי.
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                const mosaic = document.getElementById('heroMosaic');
                // offsetHeight ולא getBoundingClientRect: הפוסטר נכנס באנימציה עם
                // scale, והגובה הנראה משתנה בה בלי שהפריסה זזה.
                window.__emptyMosaic = { empty: mosaic.childElementCount === 0, height: mosaic.offsetHeight };
            });
        });
        await page.goto('/');
        await expect(tiles(page)).toHaveCount(5);

        const before = await page.evaluate(() => window.__emptyMosaic);
        expect(before.empty).toBe(true);
        const after = await page.locator('#heroMosaic').evaluate(node => node.offsetHeight);
        expect(before.height).toBeGreaterThan(150);
        expect(Math.abs(after - before.height)).toBeLessThan(1);
    });
});

test('חיבור מראש: הייצור כתוב בדף, וסביבת הניסוי מתווספת לפי api-environment.js', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(1);

    const hints = await page.locator('link[rel="preconnect"]').evaluateAll(links => links.map(link => ({
        origin: new URL(link.href).origin, crossOrigin: link.crossOrigin
    })));
    // האתר מוגש מ-127.0.0.1, ולכן הוא פונה ל-Worker של הניסוי (ראו api-environment.js).
    for (const origin of [API_ORIGIN, STAGING_API_ORIGIN]) {
        const forOrigin = hints.filter(hint => hint.origin === origin);
        expect(forOrigin, origin).toHaveLength(2);
        expect(forOrigin.map(hint => hint.crossOrigin).sort()).toEqual(['anonymous', null].sort());
    }
});

test('הגלריה אינה מחכה ל-lucide, והאייקונים מצוירים בסריקה מלאה כשהיא מגיעה', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    await seedSession(page, { worker });
    let release;
    const arrived = new Promise(resolve => { release = resolve; });
    await page.route(url => url.hostname === 'unpkg.com', async route => {
        await arrived;
        await route.fulfill({
            status: 200,
            contentType: 'text/javascript; charset=utf-8',
            body: 'window.lucide = { createIcons(options) { (window.__iconScans ||= []).push(options?.node ? "node" : "all"); } };'
        });
    });
    // load של הדף מחכה גם לסקריפט async, ולכן לא מחכים לו כאן.
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // הספרייה עוד לא הגיעה, והגלריה כבר מוצגת.
    await expect(cards(page)).toHaveCount(3);
    expect(await page.evaluate(() => typeof window.lucide)).toBe('undefined');

    release();
    await expect.poll(() => page.evaluate(() => window.__iconScans || [])).toContain('all');
});
