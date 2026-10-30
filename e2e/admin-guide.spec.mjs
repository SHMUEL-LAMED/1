// מסך "מדריך למנהלים" בלוח הניהול: פתיחה מהתפריט ומהחיפוש בתפריט, מעבר
// בתוכן העניינים, קישור "?" ממסך אחר שפותח את הסעיף שלו, כתובת ישירה
// #guide/<סעיף>, חיפוש בתוך המדריך, והפניות למסכים לפי הדרגה — וה-"?"
// שליד "מצב מהיר" ובמסך "הורדות ופרטיות", שמובילים לסעיפים שמסבירים אותם.
import { test, expect, seedSession } from './fixtures.mjs';
import { GUIDE_SECTIONS } from '../admin-guide.js';
import { SWIPE_UNDO_MS } from '../pending-swipe-model.js';

const section = (page, id) => page.locator(`#guide-section-${id}`);
const tocLink = (page, id) => page.locator(`[data-guide-link="${id}"]`);

async function openAdmin(page, worker, { role = 'admin', hash = '' } = {}) {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role });
    await page.goto(`/admin.html${hash}`);
    await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
}

test('המדריך נפתח מהתפריט, ותוכן העניינים מוביל לסעיף ופותח אותו', async ({ page, worker }) => {
    await openAdmin(page, worker);
    await page.locator('#adminNav [data-view-target="guide"]').click();

    await expect(page.locator('#view-guide')).toBeVisible();
    await expect(page.locator('#adminViewTitle')).toHaveText('מדריך למנהלים');
    await expect(page.locator('.admin-guide-toc a')).toHaveCount(GUIDE_SECTIONS.length);
    await expect(page.locator('.admin-guide-section')).toHaveCount(GUIDE_SECTIONS.length);
    // בפעם הראשונה פתוח רק סעיף הפתיחה.
    await expect(section(page, 'start')).toHaveAttribute('open', '');
    await expect(section(page, 'people')).not.toHaveAttribute('open', '');
    await expect(section(page, 'people').locator('.admin-guide-content')).toBeHidden();

    await tocLink(page, 'people').click();
    await expect(section(page, 'people')).toHaveAttribute('open', '');
    await expect(section(page, 'people').locator('.admin-guide-content')).toBeVisible();
    await expect(section(page, 'people').locator('.admin-guide-content')).toContainText('אשר ושמור שם');
    await expect(section(page, 'people').locator('summary')).toBeFocused();
    await expect(section(page, 'people')).toBeInViewport();
    await expect(tocLink(page, 'people')).toHaveAttribute('aria-current', 'location');
    await expect(page).toHaveURL(/#guide\/people$/);

    // הסעיף מתקפל מהמקלדת, כמו כל <details>.
    await page.keyboard.press('Enter');
    await expect(section(page, 'people')).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(section(page, 'people')).toHaveAttribute('open', '');

    // מסך מנהל־על מסומן כך במדריך, ומנהל בדרגה 3 אינו מקבל אליו קישור.
    await expect(section(page, 'popup').locator('.admin-guide-tag')).toHaveText('מנהל־על');
    await tocLink(page, 'popup').click();
    await expect(section(page, 'popup').locator('[data-guide-open-view]')).toHaveCount(0);

    // "מעבר למסך" מוביל למסך שהסעיף מסביר.
    await tocLink(page, 'folders').click();
    await section(page, 'folders').locator('[data-guide-open-view="folders"]').click();
    await expect(page.locator('#view-folders')).toBeVisible();
    await expect(page).toHaveURL(/#folders$/);
});

test('"?" במסך אחר פותח את הסעיף המתאים במדריך', async ({ page, worker }) => {
    await openAdmin(page, worker);
    await page.locator('#adminNav [data-view-target="folders"]').click();
    await expect(page.locator('#view-folders')).toBeVisible();

    const help = page.locator('#view-folders [data-guide-target="folders"]');
    await expect(help).toHaveAttribute('aria-label', 'הסבר במדריך למנהלים: תיקיות ואירועים');
    await help.click();

    await expect(page.locator('#view-guide')).toBeVisible();
    await expect(page.locator('#view-folders')).toBeHidden();
    await expect(section(page, 'folders')).toHaveAttribute('open', '');
    await expect(section(page, 'folders')).toBeInViewport();
    await expect(section(page, 'folders').locator('summary')).toBeFocused();
    await expect(tocLink(page, 'folders')).toHaveAttribute('aria-current', 'location');
    await expect(page).toHaveURL(/#guide\/folders$/);
    await expect(page.locator('#adminNav [data-view-target="guide"]')).toHaveClass(/is-active/);

    // "?" נוסף, ממסך אחר, כשהמדריך כבר נטען — אותו מסלול.
    await page.locator('#adminNav [data-view-target="errors"]').click();
    await page.locator('#view-errors [data-guide-target="errors"]').click();
    await expect(section(page, 'errors')).toHaveAttribute('open', '');
    await expect(section(page, 'errors')).toBeInViewport();
    await expect(page).toHaveURL(/#guide\/errors$/);
    // הסעיף שנפתח קודם נשאר פתוח.
    await expect(section(page, 'folders')).toHaveAttribute('open', '');
});

test('כתובת ישירה #guide/<סעיף> פותחת את הסעיף, ומנהל־על מקבל קישור למסך שלו', async ({ page, worker }) => {
    await openAdmin(page, worker, { role: 'super_admin', hash: '#guide/popup' });

    await expect(page.locator('#view-guide')).toBeVisible();
    await expect(section(page, 'popup')).toHaveAttribute('open', '');
    await expect(section(page, 'popup')).toBeInViewport();
    await expect(page).toHaveURL(/#guide\/popup$/);
    await expect(section(page, 'popup').locator('[data-guide-open-view="popup"]')).toHaveText(/מעבר למסך: הודעת פופ-אפ/);
});

test('חיפוש בתוך המדריך מסנן סעיפים ומכריז על התוצאה, ו-Escape מחזיר הכול', async ({ page, worker }) => {
    await openAdmin(page, worker, { hash: '#guide' });
    const search = page.locator('#adminGuideSearch');
    await expect(search).toBeVisible();

    // ZIP מוסבר בשני מקומות: ההורדה עצמה ב"החדש בגלריה", ומה שקורה לקובץ
    // בדרך ב"הורדות ופרטיות".
    await search.fill('ZIP');
    await expect(page.locator('#adminGuideStatus')).toHaveText('נמצאו 2 סעיפים.');
    await expect(page.locator('.admin-guide-section:visible')).toHaveCount(2);
    await expect(section(page, 'features')).toHaveAttribute('open', '');
    await expect(section(page, 'features')).toContainText('קובץ ZIP אחד');
    await expect(section(page, 'downloads')).toBeVisible();
    await expect(page.locator('[data-guide-toc-item]:visible')).toHaveCount(2);

    await search.fill('אלבום PDF');
    await expect(page.locator('#adminGuideStatus')).toHaveText('נמצא סעיף אחד.');
    await expect(page.locator('.admin-guide-section:visible')).toHaveCount(1);
    await expect(page.locator('[data-guide-toc-item]:visible')).toHaveCount(1);

    await search.fill('מילה שאין בשום סעיף');
    await expect(page.locator('#adminGuideStatus')).toHaveText('לא נמצא סעיף מתאים. נסו מילה אחרת.');
    await expect(page.locator('.admin-guide-section:visible')).toHaveCount(0);

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.locator('.admin-guide-section:visible')).toHaveCount(GUIDE_SECTIONS.length);
    await expect(page.locator('#adminGuideStatus')).toHaveText(`${GUIDE_SECTIONS.length} סעיפים במדריך.`);

    // פתיחה וסגירה של כל הסעיפים.
    await page.getByRole('button', { name: 'פתיחת כל הסעיפים' }).click();
    await expect(page.locator('.admin-guide-section[open]')).toHaveCount(GUIDE_SECTIONS.length);
    await page.getByRole('button', { name: 'סגירת כל הסעיפים' }).click();
    await expect(page.locator('.admin-guide-section[open]')).toHaveCount(0);
});

// שני מלבנים חופפים כשהם נחתכים ברוחב ובגובה.
function overlaps(a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('ה-"?" שליד "מצב מהיר" פותח סעיף שמסביר את המצב המהיר', async ({ page, worker }) => {
    await openAdmin(page, worker);
    await page.locator('#adminNav [data-view-target="pending"]').click();
    await expect(page.locator('#view-pending')).toBeVisible();

    const fast = page.locator('#pendingSwipeOpenBtn');
    const help = page.locator('#view-pending [data-guide-target="uploads"]');
    await expect(fast).toBeVisible();
    await expect(help).toBeVisible();
    // שניהם באותה שורת כותרת, וה-"?" אינו מכסה את הכפתור.
    const [fastBox, helpBox] = [await fast.boundingBox(), await help.boundingBox()];
    expect(overlaps(fastBox, helpBox)).toBe(false);
    expect(Math.abs((fastBox.y + fastBox.height / 2) - (helpBox.y + helpBox.height / 2))).toBeLessThan(fastBox.height);

    await help.click();
    const uploads = section(page, 'uploads');
    await expect(uploads).toHaveAttribute('open', '');
    await expect(uploads).toBeInViewport();
    await expect(page).toHaveURL(/#guide\/uploads$/);
    const content = uploads.locator('.admin-guide-content');
    await expect(content.locator('h4.admin-guide-subtitle', { hasText: 'מצב מהיר' })).toBeVisible();
    await expect(content).toContainText('החלקה ימינה');
    await expect(content).toContainText('→ / A / Enter');
    await expect(content).toContainText('Z או Ctrl+Z');
    await expect(content).toContainText(`${SWIPE_UNDO_MS / 1000} שניות`);
    await expect(content).toContainText('לסל המחזור');
});

test('"הורדות ופרטיות": ה-"?" של מנהל־העל פותח את הסעיף, ומשם חוזרים למסך', async ({ page, worker }) => {
    await openAdmin(page, worker, { role: 'super_admin' });
    await page.locator('#adminNav [data-view-target="downloads"]').click();
    await expect(page.locator('#view-downloads')).toBeVisible();

    const help = page.locator('#view-downloads [data-guide-target="downloads"]');
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute('aria-label', 'הסבר במדריך למנהלים: הורדות ופרטיות');
    // ה-"?" בשורת הכותרת, ליד הכותרת ולא עליה.
    const title = page.locator('#view-downloads .admin-panel-head h3');
    expect(overlaps(await title.boundingBox(), await help.boundingBox())).toBe(false);

    await help.click();
    const downloads = section(page, 'downloads');
    await expect(page.locator('#view-guide')).toBeVisible();
    await expect(downloads).toHaveAttribute('open', '');
    await expect(downloads).toBeInViewport();
    await expect(page).toHaveURL(/#guide\/downloads$/);
    await expect(downloads.locator('.admin-guide-tag')).toHaveText('מנהל־על');
    await expect(downloads).toContainText('המיקום (GPS) יוצא מתמונות JPEG תמיד');
    await expect(downloads).toContainText('מנהלים מורידים בלי סימן מים');

    await downloads.locator('[data-guide-open-view="downloads"]').click();
    await expect(page.locator('#view-downloads')).toBeVisible();
    await expect(page).toHaveURL(/#downloads$/);
});

test('החיפוש בתפריט הלוח מוצא את המדריך', async ({ page, worker }) => {
    await openAdmin(page, worker);
    await page.locator('#adminMenuSearch').fill('מדריך');
    const result = page.locator('#adminMenuResults .admin-menu-result');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('מדריך למנהלים');
    await result.click();
    await expect(page.locator('#view-guide')).toBeVisible();
    await expect(section(page, 'start')).toHaveAttribute('open', '');
});

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('המדריך אינו גורם לגלילה אופקית, ותוכן העניינים נגלל בתוך עצמו', async ({ page, worker }) => {
        await openAdmin(page, worker, { hash: '#guide/features' });
        await expect(section(page, 'features')).toHaveAttribute('open', '');
        await page.getByRole('button', { name: 'פתיחת כל הסעיפים' }).click();
        const settleAnimations = () => page.evaluate(() => Promise.all(document.getAnimations()
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {}))));
        await settleAnimations();
        expect(await page.evaluate(() =>
            document.documentElement.scrollWidth <= 390 && window.innerWidth === 390 && window.scrollX === 0)).toBe(true);
        const toc = await page.locator('.admin-guide-toc ol').boundingBox();
        expect(toc.x).toBeGreaterThanOrEqual(0);
        expect(toc.x + toc.width).toBeLessThanOrEqual(390);
        const link = await tocLink(page, 'start').boundingBox();
        expect(link.height).toBeGreaterThanOrEqual(40);

        await tocLink(page, 'drive').click();
        await expect(section(page, 'drive')).toBeInViewport();
        await expect(page).toHaveURL(/#guide\/drive$/);
    });
});
