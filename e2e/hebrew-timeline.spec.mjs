// ציר הזמן העברי שליד הרשת (gallery-timeline-ui.js): השנים והחודשים
// שבתצוגה, קפיצה לכרטיס הראשון של חודש — גם כשהוא מעבר למנה הראשונה של
// הרינדור ההדרגתי — סימון החודש שבראש המסך בזמן גלילה (aria-current),
// מקלדת, הסתרה במיון שאינו לפי תאריך ובחודש יחיד, וכפתור "קפיצה לתאריך"
// עם חלונית במסך של טלפון.
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

const capture = takenDate => ({ takenAt: Date.parse(`${takenDate}T10:00:00Z`), takenDate, takenAtSource: 'exif' });
const day = (start, offset) => new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

// 60 תמונות בארבעה חודשים עבריים. בסדר "החדש ביותר": תשרי תשפ״ז (0–19),
// אלול תשפ״ו (20–39), אב תשפ״ו (40–54), אדר תשפ״ה (55–59) — האחרון מעבר
// ל-48 הכרטיסים של המנה הראשונה.
const MONTHS = [
    { name: 'תשרי', label: 'תשרי תשפ״ז', start: '2026-09-13', count: 20, first: 0 },
    { name: 'אלול', label: 'אלול תשפ״ו', start: '2026-08-15', count: 20, first: 20 },
    { name: 'אב', label: 'אב תשפ״ו', start: '2026-07-20', count: 15, first: 40 },
    { name: 'אדר', label: 'אדר תשפ״ה', start: '2025-03-05', count: 5, first: 55 }
];

function seedTimelineGallery(worker) {
    let index = 0;
    const records = [];
    for (const month of MONTHS) {
        // בתוך החודש: הפריט הראשון בתצוגה הוא היום המאוחר ביותר.
        for (let offset = month.count - 1; offset >= 0; offset -= 1) {
            index += 1;
            records.push(imageRecord(index, capture(day(month.start, offset))));
        }
    }
    worker.seedFolders().seedImages(records);
}

const cards = page => page.locator('#photosGrid .gallery-card');
const monthButtons = page => page.locator('#galleryTimeline .gallery-timeline-month');

// ראש הכרטיס ביחס לתחתית סרגל הכלים הדבוק (או הכותרת, כשהסרגל אינו דבוק).
function cardOffset(page, index) {
    return page.evaluate(cardIndex => {
        const card = document.querySelectorAll('#photosGrid .gallery-card')[cardIndex];
        const toolbar = document.querySelector('.gallery-toolbar');
        const header = document.querySelector('.site-header');
        const sticky = getComputedStyle(toolbar).position === 'sticky';
        const covered = sticky ? toolbar.getBoundingClientRect().bottom : header.getBoundingClientRect().bottom;
        return { offset: card.getBoundingClientRect().top - covered, top: card.getBoundingClientRect().top, viewport: window.innerHeight };
    }, index);
}

test.describe('מסך רחב: עמודה בצד הסוף של הגלריה', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('השנים והחודשים לפי סדר התצוגה, קפיצה לחודש ומעבר לו, סימון בגלילה ומקלדת', async ({ page, worker }) => {
        // בלי תנועה: הגלילה מיידית, וכך גם הקפיצה.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        seedTimelineGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        await expect(cards(page)).toHaveCount(48);
        const timeline = page.locator('#galleryTimeline');
        await expect(timeline).toBeVisible();
        await expect(timeline).toHaveAttribute('aria-label', 'ציר הזמן לפי חודשים עבריים');
        await expect(page.locator('#galleryTimelineToggle')).toBeHidden();
        await expect(page.locator('.gallery-layout')).toHaveAttribute('data-timeline', '');
        await expect(timeline.locator('.gallery-timeline-year-label')).toHaveText(['תשפ״ז', 'תשפ״ו', 'תשפ״ה']);
        const months = monthButtons(page);
        await expect(months.locator('.gallery-timeline-month-name')).toHaveText(MONTHS.map(month => month.name));
        await expect(months.locator('.gallery-timeline-count')).toHaveText(MONTHS.map(month => String(month.count)));
        await expect(months.first()).toHaveAttribute('aria-label', 'תשרי תשפ״ז, 20 פריטים');
        await expect(months.first()).toHaveAttribute('aria-current', 'true');
        await expect(page.locator('#galleryTimeline [aria-current]')).toHaveCount(1);
        // אותו חודש כמו התווית שעל הכרטיס הראשון שלו.
        await expect(cards(page).nth(MONTHS[1].first).locator('.gallery-date-group')).toHaveText(MONTHS[1].label);

        // בצד הסוף: משמאל לרשת, כי הדף מימין לשמאל.
        const railBox = await timeline.boundingBox();
        const gridBox = await page.locator('#photosGrid').boundingBox();
        expect(railBox.x + railBox.width).toBeLessThanOrEqual(gridBox.x + 1);

        // אדר: הכרטיס הראשון שלו (55) עוד לא נבנה — הקפיצה בונה את המנות עד אליו.
        await months.nth(3).click();
        await expect(cards(page)).toHaveCount(60);
        await expect(cards(page).nth(MONTHS[3].first).locator('.gallery-media')).toBeFocused();
        await expect(months.nth(3)).toHaveAttribute('aria-current', 'true');
        await expect(page.locator('#galleryTimeline [aria-current]')).toHaveCount(1);
        // החודש האחרון קצר ואינו מגיע לראש המסך, אבל הכרטיס על המסך מתחת לסרגל,
        // והסימון נשאר עליו כל עוד הדף לא זז.
        const adar = await cardOffset(page, MONTHS[3].first);
        expect(adar.offset).toBeGreaterThanOrEqual(0);
        expect(adar.top).toBeLessThan(adar.viewport);
        await page.waitForTimeout(400);
        await expect(months.nth(3)).toHaveAttribute('aria-current', 'true');

        // אב: נעצר מתחת לסרגל הכלים הדבוק, עם מרווח לתווית החודש.
        await months.nth(2).click();
        await expect(cards(page).nth(MONTHS[2].first).locator('.gallery-media')).toBeFocused();
        await expect(months.nth(2)).toHaveAttribute('aria-current', 'true');
        const av = await cardOffset(page, MONTHS[2].first);
        expect(av.offset).toBeGreaterThanOrEqual(0);
        expect(av.offset).toBeLessThan(48);

        // גלילה: הכרטיס שבראש המסך (מתחת לסרגל) קובע את החודש המסומן.
        await page.evaluate(index => {
            const card = document.querySelectorAll('#photosGrid .gallery-card')[index];
            const toolbar = document.querySelector('.gallery-toolbar');
            window.scrollBy({ top: card.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom - 20, behavior: 'instant' });
        }, 30);
        await expect(months.nth(1)).toHaveAttribute('aria-current', 'true');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect(months.first()).toHaveAttribute('aria-current', 'true');

        // מקלדת: חצים, Home ו-End בין החודשים, Enter קופץ ומעביר את הפוקוס לכרטיס.
        await months.first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(months.nth(1)).toBeFocused();
        await page.keyboard.press('End');
        await expect(months.nth(3)).toBeFocused();
        await page.keyboard.press('Home');
        await expect(months.first()).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(cards(page).nth(MONTHS[1].first).locator('.gallery-media')).toBeFocused();
        await expect(months.nth(1)).toHaveAttribute('aria-current', 'true');
        const elul = await cardOffset(page, MONTHS[1].first);
        expect(elul.offset).toBeGreaterThanOrEqual(0);
        expect(elul.offset).toBeLessThan(48);
    });

    test('בגלילה חלקה החודש שנבחר נשאר מסומן בדרך, וגלילה של המשתמש משחררת אותו', async ({ page, worker }) => {
        seedTimelineGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        await expect(cards(page)).toHaveCount(48);
        const months = monthButtons(page);
        await months.nth(2).click();
        await expect(months.nth(2)).toHaveAttribute('aria-current', 'true');
        await expect(cards(page).nth(MONTHS[2].first).locator('.gallery-media')).toBeFocused();
        // הגלילה החלקה מגיעה ליעד; הסימון לא "רץ" דרך אלול בדרך.
        await expect.poll(async () => (await cardOffset(page, MONTHS[2].first)).offset, { timeout: 5000 }).toBeGreaterThanOrEqual(0);
        await expect.poll(async () => (await cardOffset(page, MONTHS[2].first)).offset, { timeout: 5000 }).toBeLessThan(48);
        await expect(months.nth(2)).toHaveAttribute('aria-current', 'true');
        await expect(page.locator('#galleryTimeline [aria-current]')).toHaveCount(1);

        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect(months.first()).toHaveAttribute('aria-current', 'true');
    });

    test('עמוד נוסף שבונה את הרשימה מחדש אינו מפיל את הפוקוס מהחודש שעליו עומדים', async ({ page, worker }) => {
        seedTimelineGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        await expect(cards(page)).toHaveCount(48);
        const months = monthButtons(page);
        await months.nth(2).focus();
        // כמו עמוד שהגיע מהענן: פריט מחודש חדש (כסלו תשפ״ה) בסוף הרשימה.
        await page.evaluate(() => {
            window.state.images = [...window.state.images, { ...window.state.images[0], id: 'late', title: 'late', takenAt: Date.parse('2024-12-10T10:00:00Z'), takenDate: '2024-12-10' }];
            window._doRenderImages();
        });
        await expect(months).toHaveCount(5);
        await expect(months.nth(2)).toBeFocused();
        await expect(months.nth(2).locator('.gallery-timeline-month-name')).toHaveText('אב');

        // שער הגישה (session-ui.js) מסתיר את הציר כמו את הרשת, גם לפני שהפריטים נמחקו.
        await page.evaluate(() => document.body.classList.add('gallery-locked'));
        await expect(page.locator('#galleryTimeline')).toBeHidden();
    });

    test('מוסתר במיון לפי שם או אקראי ובחודש יחיד; "הישן ביותר" הופך את הסדר', async ({ page, worker }) => {
        seedTimelineGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        const timeline = page.locator('#galleryTimeline');
        await expect(timeline).toBeVisible();
        const sort = page.locator('#gallerySortSelect');

        await sort.selectOption('name');
        await expect(timeline).toBeHidden();
        await expect(page.locator('.gallery-layout')).not.toHaveAttribute('data-timeline', '');
        await sort.selectOption('random');
        await expect(timeline).toBeHidden();

        await sort.selectOption('oldest');
        await expect(timeline).toBeVisible();
        await expect(timeline.locator('.gallery-timeline-year-label')).toHaveText(['תשפ״ה', 'תשפ״ו', 'תשפ״ז']);
        await expect(monthButtons(page).locator('.gallery-timeline-month-name')).toHaveText(['אדר', 'אב', 'אלול', 'תשרי']);
        await expect(monthButtons(page).first()).toHaveAttribute('aria-current', 'true');

        // סינון לחודש אחד: אין לאן לקפוץ.
        await page.locator('#galleryHebrewMonthFilter').selectOption({ label: 'אלול' });
        await expect(cards(page)).toHaveCount(20);
        await expect(timeline).toBeHidden();
        await page.locator('#galleryHebrewMonthFilter').selectOption('');
        await expect(timeline).toBeVisible();
        await expect(monthButtons(page)).toHaveCount(4);
    });
});

test.describe('טלפון: כפתור צף "קפיצה לתאריך"', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('הכפתור מציג את החודש הנוכחי ופותח רשימה נגישה; בחירה סוגרת וקופצת', async ({ page, worker }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        seedTimelineGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        await expect(cards(page)).toHaveCount(48);
        const toggle = page.locator('#galleryTimelineToggle');
        const panel = page.locator('#galleryTimelinePanel');
        // רק כשהרשת על המסך.
        await page.evaluate(() => {
            const grid = document.getElementById('photosGrid');
            window.scrollTo({ top: grid.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant' });
        });
        await expect(toggle).toBeVisible();
        await expect(panel).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#galleryTimelineCurrent')).toHaveText('תשרי תשפ״ז');
        await expect(toggle).toHaveAttribute('aria-label', 'קפיצה לתאריך (כעת: תשרי תשפ״ז)');

        // ליד "חזרה למעלה" ולא עליו, ובתוך רוחב המסך.
        await page.evaluate(() => window.scrollBy({ top: 1800, behavior: 'instant' }));
        await expect(page.locator('#backToTop')).toHaveClass(/is-visible/);
        const toggleBox = await toggle.boundingBox();
        const backBox = await page.locator('#backToTop').boundingBox();
        expect(toggleBox.x + toggleBox.width <= backBox.x || backBox.x + backBox.width <= toggleBox.x).toBe(true);
        expect(toggleBox.x).toBeGreaterThanOrEqual(0);

        // פתיחה: הפוקוס עובר לחודש המסומן; Escape סוגר ומחזיר לכפתור.
        await toggle.tap();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        const current = page.locator('#galleryTimeline .gallery-timeline-month[aria-current="true"]');
        await expect(current).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // לחיצה מחוץ לחלונית סוגרת אותה.
        await toggle.tap();
        await expect(panel).toBeVisible();
        const panelBox = await panel.boundingBox();
        expect(panelBox.x).toBeGreaterThanOrEqual(0);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
        await page.locator('.site-header .brand-title').tap();
        await expect(panel).toBeHidden();

        // Tab שיוצא מהחלונית (מקלדת חיצונית) סוגר אותה.
        await toggle.tap();
        await expect(panel).toBeVisible();
        await monthButtons(page).last().focus();
        await page.keyboard.press('Tab');
        await expect(panel).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // בחירת חודש: החלונית נסגרת, הדף קופץ לכרטיס הראשון שלו והכפתור מתעדכן.
        await toggle.tap();
        await monthButtons(page).nth(2).tap();
        await expect(panel).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(cards(page).nth(MONTHS[2].first).locator('.gallery-media')).toBeFocused();
        await expect(page.locator('#galleryTimelineCurrent')).toHaveText('אב תשפ״ו');
        const av = await cardOffset(page, MONTHS[2].first);
        expect(av.offset).toBeGreaterThanOrEqual(0);
        expect(av.offset).toBeLessThan(48);

        // שום דבר לא בורח לרוחב.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});
