// מסך "שמות, כיתובים ותגיות עם AI" בלוח הניהול: ריצת ההשלמה שולחת רק תמונות
// שחסר להן שם או כיתוב, ממשיכה מהמקום שנעצרה, ובלי מפתח AI בשרת אינה שולחת דבר.
// "המודל" הוא הזיוף שב-e2e/fixtures.mjs (POST /ai-title).
import { test, expect, seedSession, imageRecord, FAKE_AI_DESCRIPTION } from './fixtures.mjs';

async function openAiScreen(page) {
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="aititles"]').click();
    await expect(page.locator('#view-aititles')).toBeVisible();
}

test('מנהל משלים שמות, כיתובים ותגיות, והמשך מדלג על מה שכבר עובד', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1),
        // יש שם AI, חסרים כיתוב ותגיות.
        imageRecord(2, { aiTitleVersion: 1 }),
        // כיתוב שנערך ידנית: לא נשלח.
        imageRecord(3, { aiTitleVersion: 1, caption: 'כיתוב שהמנהל כתב', sceneTags: ['lesson'], captionSource: 'manual' }),
        // סרטון אינו נשלח למודל.
        imageRecord(4, { mediaType: 'video', mimeType: 'video/mp4' })
    ]);
    await seedSession(page, { worker, role: 'admin' });
    await openAiScreen(page);

    await expect(page.locator('#aiTitlesSummary')).toContainText('2 תמונות ממתינות');
    await expect(page.locator('#aiTitlesStart')).toBeEnabled();
    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('הריצה הסתיימה');
    await expect(page.locator('#aiTitlesStatus')).toContainText('2 תמונות עובדו');
    await expect(page.locator('#aiTitlesSummary')).toContainText('0 תמונות ממתינות');
    await expect(page.locator('#aiTitlesProgress')).toHaveAttribute('aria-valuenow', '100');
    expect([...worker.aiCalls].sort()).toEqual(['img_e2e_1', 'img_e2e_2']);

    const images = worker.collection('images');
    expect(images.get('img_e2e_1')).toMatchObject({
        title: FAKE_AI_DESCRIPTION.title, originalTitle: 'תמונה 1', aiTitleVersion: 1,
        caption: FAKE_AI_DESCRIPTION.caption, sceneTags: ['dance', 'group'], captionSource: 'ai', aiCaptionVersion: 1
    });
    // השם הקיים נשמר; רק הכיתוב והתגיות נוספו.
    expect(images.get('img_e2e_2')).toMatchObject({ title: 'תמונה 2', caption: FAKE_AI_DESCRIPTION.caption, sceneTags: ['dance', 'group'] });
    expect(images.get('img_e2e_3')).toMatchObject({ caption: 'כיתוב שהמנהל כתב', sceneTags: ['lesson'], captionSource: 'manual' });

    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('0 תמונות עובדו');
    expect(worker.aiCalls).toHaveLength(2);
});

test('עצירה באמצע הריצה וחידושה ממשיכים מהתמונה הבאה, בלי לעבד שוב', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2), imageRecord(3)]);
    await seedSession(page, { worker, role: 'admin' });
    let release;
    worker.aiGate = new Promise(resolve => { release = resolve; });
    await openAiScreen(page);
    await expect(page.locator('#aiTitlesSummary')).toContainText('3 תמונות ממתינות');

    await page.locator('#aiTitlesStart').click();
    // הבקשה הראשונה הגיעה לשרת ומוחזקת בשער: עוצרים בזמן שהיא בעיבוד.
    await expect.poll(() => worker.aiCalls.length).toBe(1);
    await expect(page.locator('#aiTitlesStatus')).toContainText('מעבד תמונה 1 מתוך 3');
    await page.locator('#aiTitlesStop').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('מסיים את התמונה הנוכחית ועוצר');
    worker.aiGate = null;
    release();

    await expect(page.locator('#aiTitlesStatus')).toContainText('הריצה נעצרה');
    await expect(page.locator('#aiTitlesStatus')).toContainText('1 תמונות עובדו');
    await expect(page.locator('#aiTitlesSummary')).toContainText('2 תמונות ממתינות');
    await expect(page.locator('#aiTitlesStop')).toBeDisabled();

    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('הריצה הסתיימה');
    await expect(page.locator('#aiTitlesStatus')).toContainText('2 תמונות עובדו');
    expect(worker.aiCalls).toHaveLength(3);
    expect(new Set(worker.aiCalls).size).toBe(3);
});

test('מכסה מלאה בשרת עוצרת את הריצה עם הסבר, ואפשר להמשיך אחר כך', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2)]);
    await seedSession(page, { worker, role: 'admin' });
    worker.aiDescribe = () => {
        const error = new Error('מכסת התיאורים לשעה התמלאה. אפשר להמשיך מאוחר יותר.');
        error.status = 429;
        error.code = 'ai_title_rate_limit';
        throw error;
    };
    await openAiScreen(page);
    await page.locator('#aiTitlesStart').click();
    await expect(page.locator('#aiTitlesStatus')).toContainText('הריצה נעצרה');
    await expect(page.locator('#aiTitlesStatus')).toContainText('מכסת התיאורים לשעה התמלאה');
    await expect(page.locator('#aiTitlesFailures')).toContainText('מכסת התיאורים לשעה התמלאה');
    // הריצה נעצרה אחרי התמונה הראשונה ולא שלחה את השנייה.
    expect(worker.aiCalls).toHaveLength(1);
    await expect(page.locator('#aiTitlesSummary')).toContainText('2 תמונות ממתינות');
});

test('בלי מפתח AI בשרת המסך מסביר שהתכונה כבויה ואינו שולח בקשות', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1)]);
    worker.aiEnabled = false;
    await seedSession(page, { worker, role: 'admin' });
    await openAiScreen(page);
    await expect(page.locator('#aiTitlesStatus')).toContainText('מפתח ה־AI אינו מוגדר בשרת');
    await expect(page.locator('#aiTitlesStart')).toBeDisabled();
    await expect(page.locator('#aiTitlesSummary')).toContainText('1 תמונות ממתינות');
    expect(worker.requestsTo('POST', '/ai-title')).toHaveLength(0);
});
