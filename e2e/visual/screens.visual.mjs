// רגרסיה חזותית: צילומי מסך של המסכים העיקריים, בכל אחד מארבעת הפרויקטים של
// playwright.visual.config.mjs (מחשב / טלפון × בהיר / כהה). כל הנתונים, השעון,
// התמונות והאייקונים קבועים — ראו visual-fixtures.mjs.
import { test, expect, seedVisualGallery, settle, snap } from './visual-fixtures.mjs';
import { openGalleryFilters } from '../fixtures.mjs';

const cards = page => page.locator('#photosGrid .gallery-card');

async function openGallery(page, worker, options = {}) {
    const images = await seedVisualGallery(page, worker, options);
    await page.goto('/');
    await expect(cards(page)).toHaveCount(images.length);
    return images;
}

// השעון של הדף והנתונים קבועים, ולכן גם תאריכים יחסיים יציבים. בכל זאת
// מכוסה הערך "עודכן לפני…" שבראש הדף — המקום הראשון שבו שינוי קטן בחישוב
// הזמן היחסי (או נתון שנזרע בשעה הנוכחית) היה מפיל את כל הצילומים.
// המסכה מצוירת מעל הכול, גם מעל חלון שמכסה את הערך, ולכן היא ניתנת רק
// בצילום שבו ראש הדף גלוי.
const dynamicRegions = page => [
    page.locator('#heroUpdatedAt')
];

// לחיצה ממקום גלילה קבוע: הדף מתייצב, הפקד נגלל למרכז המסך בלי אנימציה,
// ורק אז נלחץ. כך הרקע שמאחורי חלון פתוח (מטושטש, עם פס ההתקדמות של הגלילה
// בראש הדף) זהה בכל ריצה.
async function scrollToStablePosition(page, locator) {
    await settle(page);
    await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await settle(page);
}

async function clickFromStablePosition(page, locator) {
    await scrollToStablePosition(page, locator);
    await locator.click();
}

test.describe('הגלריה', () => {
    test('דף הבית: תיקיות וכרטיסים', async ({ page, worker }) => {
        await openGallery(page, worker);
        await snap(page, 'gallery-home', { mask: dynamicRegions(page) });
    });

    test('סרגל הכלים וחלונית הסינון פתוחה', async ({ page, worker, device }) => {
        await openGallery(page, worker);
        // אותו מקום גלילה בכל ריצה, ואז פתיחה כמו בשאר הבדיקות (openGalleryFilters).
        await scrollToStablePosition(page, page.locator('#galleryFilterToggle'));
        await openGalleryFilters(page);
        await expect(page.locator('#galleryFilterPanel')).toBeVisible();
        // במחשב: חלונית צפה ליד הכפתור; בטלפון: גיליון תחתון עם רקע חוסם.
        await expect(page.locator('#galleryFilterPanel')).toHaveAttribute('aria-modal', device === 'phone' ? 'true' : 'false');
        await page.locator(':focus').evaluate(element => element.blur());
        await snap(page, 'gallery-filters');
    });

    test('התצוגה המלאה', async ({ page, worker }) => {
        await openGallery(page, worker);
        await clickFromStablePosition(page, cards(page).first().locator('.gallery-media'));
        await expect(page.locator('#lightboxModal')).toBeVisible();
        await expect(page.locator('#lightboxCounter')).toHaveText('1 מתוך 12');
        await expect.poll(() => page.locator('#lightboxImage').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        await snap(page, 'lightbox');
    });

    test('עמוד האירוע', async ({ page, worker }) => {
        await openGallery(page, worker);
        await clickFromStablePosition(page, page.locator('[data-event-folder="1"]'));
        const eventPage = page.locator('#eventPageModal');
        await expect(eventPage).toBeVisible();
        await page.locator(':focus').evaluate(element => element.blur());
        await snap(page, 'event-page');
    });
});

test.describe('לוח הניהול', () => {
    test('לוח הבקרה', async ({ page, worker }) => {
        await seedVisualGallery(page, worker, { role: 'admin', name: 'מנהל הגלריה', pending: true });
        // "ממתין לטיפול" נבנה כשהמסך נפתח. כדי שלא יהיה מרוץ מול טעינת הפריטים
        // הממתינים, נכנסים קודם לאישור העלאות (שם הם נטענים) וחוזרים לסקירה.
        await page.goto('/admin.html#pending');
        await expect(page.locator('#pendingList input[name="pendingImgCheck"]')).toHaveCount(3);
        // בטלפון התפריט הצדדי מקופל; openAdminView הוא מה שכפתור התפריט מפעיל.
        await page.evaluate(() => window.openAdminView('dashboard'));
        await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
        await expect(page.locator('#adminCurrentUserName')).toHaveText('מנהל הגלריה');
        await expect(page.locator('#adminAttentionList')).toContainText('פריטים ממתינים לאישור');
        await snap(page, 'admin-dashboard');
    });

    test('העלאות שממתינות לאישור', async ({ page, worker }) => {
        await seedVisualGallery(page, worker, { role: 'admin', name: 'מנהל הגלריה', pending: true });
        await page.goto('/admin.html#pending');
        await expect(page.locator('#pendingList input[name="pendingImgCheck"]')).toHaveCount(3);
        await snap(page, 'admin-pending');
    });
});
