// טווח תאריכים עברי ואורך סרטון, בדפדפן אמיתי: החלונית "טווח תאריכים" מסננת
// מחודש ושנה עד חודש ושנה (גם בשנה מעוברת וגם כשנבחר הפוך), מצטרפת לשאר
// הסינונים ונשמרת בחיפושים; בורר האורך מוצג ב"סרטונים בלבד", מסנן לפי duration
// שברשומה, ולסרטון בלעדיו קורא את האורך מהמטא-דאטה של הקובץ — פעם אחת, עם מטמון.
import { test, expect, seedSession, imageRecord, API_ORIGIN, DEFAULT_USER, openGalleryFilters } from './fixtures.mjs';
import { storageKeyFor } from '../search-history.js';
import { DURATION_CACHE_KEY } from '../video-length.js';

const USER_KEY = storageKeyFor(DEFAULT_USER.uid);
const titles = page => page.locator('#photosGrid .gallery-card .gallery-title');
const capture = (iso, takenDate) => ({ takenAt: Date.parse(iso), takenDate, takenAtSource: 'exif' });
const recentEntry = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.recent?.[0] || null, USER_KEY);

function seedDatedGallery(worker) {
    worker.seedFolders().seedImages([
        // י״ז בתשרי תשפ״ז
        imageRecord(1, { title: 'סוכה תשפ״ז', ...capture('2026-09-28T16:30:00Z', '2026-09-28') }),
        // י״ד באדר ב׳ תשפ״ד (מעוברת)
        imageRecord(2, { title: 'פורים תשפ״ד', ...capture('2024-03-24T10:00:00Z', '2024-03-24') }),
        // ו׳ באדר א׳ תשפ״ד
        imageRecord(3, { title: 'אדר א תשפ״ד', ...capture('2024-02-15T10:00:00Z', '2024-02-15') }),
        // ה׳ בכסלו תשפ״ו
        imageRecord(4, { title: 'כסלו תשפ״ו', ...capture('2025-11-25T10:00:00Z', '2025-11-25') }),
        // ט׳ בתשרי תשפ״ו
        imageRecord(5, { title: 'תשרי תשפ״ו', ...capture('2025-10-01T10:00:00Z', '2025-10-01') })
    ]);
}

// קובץ WAV תקין באורך נתון: Chromium קורא את האורך מהכותרת שלו גם ב-<video>,
// כך שהבדיקה מתרגלת את קריאת המטא-דאטה האמיתית בלי לבנות MP4.
function makeWav(seconds, sampleRate = 4000) {
    const samples = seconds * sampleRate;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + samples, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // מונו
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(samples, 40);
    return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

function videoRecord(index, title, extra = {}) {
    const key = `approved/${DEFAULT_USER.uid}/img_e2e_${index}.mp4`;
    return imageRecord(index, {
        title,
        url: `${API_ORIGIN}/media/${key}`,
        r2Key: key,
        mediaType: 'video',
        mimeType: 'video/mp4',
        ...extra
    });
}

test('טווח תאריכים: מחודש ושנה עד חודש ושנה, יחד עם שאר הסינונים, ונשמר בחיפוש', async ({ page, worker }) => {
    seedDatedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const toggle = page.locator('#galleryDateRangeToggle');
    const panel = page.locator('#galleryDateRangePanel');
    const fromYear = page.locator('#galleryDateRangeFromYear');
    const fromMonth = page.locator('#galleryDateRangeFromMonth');
    const toYear = page.locator('#galleryDateRangeToYear');
    const toMonth = page.locator('#galleryDateRangeToMonth');
    await expect(cards).toHaveCount(5);
    await expect(toggle).toHaveText('סינון לפי טווח תאריכים');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    // פתיחה (בחלונית "סינון" של סרגל הכלים): הפוקוס עובר לשנת ההתחלה, והחודש
    // מושבת עד שנבחרת שנה.
    await openGalleryFilters(page);
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(fromYear).toBeFocused();
    await expect(fromYear.locator('option')).toHaveText(['בלי גבול', 'תשפ״ז', 'תשפ״ו', 'תשפ״ד']);
    await expect(fromMonth).toBeDisabled();
    await expect(page.locator('#galleryDateRangeClear')).toBeDisabled();

    // משנת תשפ״ו ואילך.
    await fromYear.selectOption({ label: 'תשפ״ו' });
    await expect(titles(page)).toHaveText(['סוכה תשפ״ז', 'כסלו תשפ״ו', 'תשרי תשפ״ו']);
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('משנת תשפ״ו ואילך');
    await expect(toggle).toHaveAttribute('data-active', 'true');
    // שנה פשוטה: אדר אחד.
    await expect(fromMonth).toBeEnabled();
    await expect(fromMonth.locator('option')).toHaveText(['מתחילת השנה', 'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול']);

    // מכסלו תשפ״ו עד סוף שנת תשפ״ו.
    await fromMonth.selectOption('kislev');
    await expect(titles(page)).toHaveText(['סוכה תשפ״ז', 'כסלו תשפ״ו']);
    await toYear.selectOption({ label: 'תשפ״ו' });
    await expect(titles(page)).toHaveText(['כסלו תשפ״ו']);
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('מכסלו תשפ״ו עד סוף שנת תשפ״ו');

    // מצטרף לבורר השנה: שנה אחרת — אין תוצאות.
    await page.locator('#galleryHebrewYearFilter').selectOption({ label: 'תשפ״ז' });
    await expect(cards).toHaveCount(0);
    await page.locator('#galleryHebrewYearFilter').selectOption('');
    await expect(titles(page)).toHaveText(['כסלו תשפ״ו']);

    // נקה: הכול חוזר, והפוקוס בשנת ההתחלה.
    await toggle.click();
    await toggle.click();
    await page.locator('#galleryDateRangeClear').click();
    await expect(cards).toHaveCount(5);
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('טווח תאריכים');
    await expect(fromYear).toBeFocused();

    // טווח שנבחר הפוך מתהפך: מתשפ״ז עד תשפ״ד = מתשפ״ד עד תשפ״ז.
    await fromYear.selectOption({ label: 'תשפ״ז' });
    await toYear.selectOption({ label: 'תשפ״ד' });
    await expect(cards).toHaveCount(5);
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('משנת תשפ״ד עד סוף שנת תשפ״ז');
    await expect(fromYear).toHaveValue('5784');
    await expect(toYear).toHaveValue('5787');

    // שנה מעוברת: אדר א׳ ואדר ב׳ נפרדים.
    await fromMonth.selectOption({ label: 'אדר ב׳' });
    await toYear.selectOption({ label: 'תשפ״ד' });
    await expect(toMonth.locator('option')).toContainText(['אדר א׳', 'אדר ב׳']);
    await toMonth.selectOption({ label: 'אדר ב׳' });
    await expect(titles(page)).toHaveText(['פורים תשפ״ד']);
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('מאדר ב׳ תשפ״ד עד אדר ב׳ תשפ״ד');

    // Escape סוגר את החלונית ומחזיר את הפוקוס לכפתור; הסינון נשאר.
    await toMonth.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(titles(page)).toHaveText(['פורים תשפ״ד']);

    // נרשם בחיפושים האחרונים עם הטווח.
    const search = page.locator('#searchInput');
    await search.fill('פורים');
    await search.press('Enter');
    await expect.poll(() => recentEntry(page))
        .toMatchObject({ query: 'פורים', filters: { dateFrom: '5784-adar2', dateTo: '5784-adar2' } });

    // איפוס, והפעלה מהתפריט מחזירה את הטקסט ואת הטווח.
    await search.fill('');
    await page.evaluate(() => window.setGalleryDateRange('', ''));
    await expect(cards).toHaveCount(5);
    await search.click();
    const row = page.locator('#searchHistoryPopup .search-history-group[data-kind="recent"] .search-history-row').first();
    await expect(row.locator('.search-history-meta')).toHaveText('מאדר ב׳ תשפ״ד עד אדר ב׳ תשפ״ד');
    await row.locator('[data-action="apply"]').click();
    await expect(search).toHaveValue('פורים');
    await expect(page.locator('#galleryDateRangeLabel')).toHaveText('מאדר ב׳ תשפ״ד עד אדר ב׳ תשפ״ד');
    await expect(titles(page)).toHaveText(['פורים תשפ״ד']);

    // לחיצה מחוץ לחלונית סוגרת אותה (החיפוש סגר את חלונית הסינון — פותחים שוב).
    await openGalleryFilters(page);
    await toggle.click();
    await expect(panel).toBeVisible();
    await page.locator('#imageCounter').click();
    await expect(panel).toBeHidden();
});

test('אורך סרטון: מוצג ב"סרטונים בלבד", מסנן לפי האורך שברשומה, וקורא אורך חסר מהקובץ פעם אחת', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { title: 'תמונה' }),
        videoRecord(2, 'סרטון קצר', { duration: 30 }),
        videoRecord(3, 'סרטון בינוני', { duration: 120 }),
        videoRecord(4, 'סרטון ארוך', { duration: 600 }),
        // מסנכרון Drive: בלי duration. הקובץ אמיתי, והאורך שלו 75 שניות.
        videoRecord(5, 'סרטון בלי אורך'),
        // בלי duration, והקובץ אינו סרטון: האורך לא יימצא.
        videoRecord(6, 'סרטון פגום')
    ]);
    worker.objects.set(`approved/${DEFAULT_USER.uid}/img_e2e_5.mp4`, { contentType: 'audio/wav', bytes: makeWav(75) });
    const mediaRequests = [];
    page.on('request', request => {
        if (/img_e2e_[56]\.mp4/.test(request.url())) mediaRequests.push(request.url());
    });
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const length = page.locator('#galleryVideoLengthFilter');
    const note = page.locator('#galleryVideoLengthNote');
    await expect(cards).toHaveCount(6);
    // בחלונית "סינון": בורר האורך מוסתר עד "סרטונים בלבד".
    await openGalleryFilters(page);
    await expect(length).toBeHidden();
    await expect(note).toBeHidden();
    // בלי סינון לפי אורך — אין שום בדיקה של קבצים.
    expect(mediaRequests).toEqual([]);

    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await expect(length).toBeVisible();
    await expect(length).toHaveAttribute('aria-label', 'סינון סרטונים לפי אורך');
    await expect(length.locator('option')).toHaveText(['אורך: הכל', 'קצרים (עד דקה)', 'בינוניים (1–5 דקות)', 'ארוכים (מעל 5 דקות)']);
    await expect(cards).toHaveCount(5);

    await length.selectOption('short');
    await expect(titles(page)).toHaveText(['סרטון קצר']);
    // הקובץ האמיתי נמדד (75 שניות — בינוני), והפגום נשאר בלי אורך.
    await expect(note).toHaveText('סרטון אחד שהאורך שלו אינו ידוע אינו נכלל בסינון לפי אורך.');
    await expect(note).toHaveAttribute('role', 'status');

    await length.selectOption('medium');
    await expect(titles(page)).toHaveText(['סרטון בלי אורך', 'סרטון בינוני']);
    await length.selectOption('long');
    await expect(titles(page)).toHaveText(['סרטון ארוך']);

    // האורך שנמצא נשמר בדפדפן לביקור הבא; כל קובץ נבדק פעם אחת בלבד.
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), DURATION_CACHE_KEY))
        .toEqual({ v: 1, d: { img_e2e_5: 75 } });
    const probed = new Set(mediaRequests);
    expect(probed.size).toBe(2);

    // נרשם בחיפושים עם סוג המדיה והאורך.
    const search = page.locator('#searchInput');
    await search.fill('סרטון');
    await search.press('Enter');
    await expect.poll(() => recentEntry(page))
        .toMatchObject({ query: 'סרטון', filters: { mediaType: 'video', videoLength: 'long' } });

    // סוג אחר מבטל את האורך ומסתיר את הבורר.
    await search.fill('');
    await page.locator('#galleryMediaTypeFilter').selectOption('image');
    await expect(length).toBeHidden();
    await expect(note).toBeHidden();
    await expect(titles(page)).toHaveText(['תמונה']);
    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await expect(length).toHaveValue('');
    await expect(cards).toHaveCount(5);

    // הפעלה מהתפריט מחזירה את שניהם.
    await page.locator('#galleryMediaTypeFilter').selectOption('');
    await search.click();
    const row = page.locator('#searchHistoryPopup .search-history-group[data-kind="recent"] .search-history-row').first();
    await expect(row.locator('.search-history-meta')).toHaveText('סרטונים בלבד · אורך: ארוכים (מעל 5 דקות)');
    await row.locator('[data-action="apply"]').click();
    await expect(page.locator('#galleryMediaTypeFilter')).toHaveValue('video');
    await expect(length).toHaveValue('long');
    await expect(titles(page)).toHaveText(['סרטון ארוך']);
});

test('אורך סרטון: אורך שנמדד בביקור קודם נלקח מהמטמון, בלי לפנות לקובץ', async ({ page, worker }) => {
    worker.seedFolders().seedImages([videoRecord(5, 'סרטון בלי אורך')]);
    await page.addInitScript(([key]) => {
        localStorage.setItem(key, JSON.stringify({ v: 1, d: { img_e2e_5: 400 } }));
    }, [DURATION_CACHE_KEY]);
    const mediaRequests = [];
    page.on('request', request => {
        if (/img_e2e_5\.mp4/.test(request.url())) mediaRequests.push(request.url());
    });
    await seedSession(page, { worker });
    await page.goto('/');
    await openGalleryFilters(page);
    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await page.locator('#galleryVideoLengthFilter').selectOption('long');
    await expect(titles(page)).toHaveText(['סרטון בלי אורך']);
    await expect(page.locator('#galleryVideoLengthNote')).toBeHidden();
    expect(mediaRequests).toEqual([]);
});

// אורך הסרטון והכיוון יחד: כל מונה של "לא ידוע" סופר רק פריטים שעוברים את
// כל שאר הסינונים. סרטון לרוחב שאינו מוצג בגלל הכיוון אינו נבדק ברשת ואינו
// נספר בהערת האורך, וסרטון בלי מידות שאינו מוצג בגלל האורך אינו נספר בהערת
// הכיוון.
test('אורך סרטון וכיוון: סרטון שהכיוון מסתיר אינו נבדק ואינו נספר', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        videoRecord(1, 'קצר לאורך', { duration: 30, width: 720, height: 1280 }),
        // בלי duration, לרוחב: היו נבדקים לולא הכיוון.
        videoRecord(2, 'בלי אורך לרוחב', { width: 1920, height: 1080 }),
        videoRecord(3, 'עוד בלי אורך לרוחב', { width: 1280, height: 720 }),
        // בלי מידות: ארוך — מוסתר ממילא בגלל האורך; קצר — נספר בהערת הכיוון.
        videoRecord(4, 'ארוך בלי מידות', { duration: 600 }),
        videoRecord(5, 'קצר בלי מידות', { duration: 20 })
    ]);
    const mediaRequests = [];
    page.on('request', request => {
        if (/img_e2e_[23]\.mp4/.test(request.url())) mediaRequests.push(request.url());
    });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(5);

    // הכיוון קודם, כדי שגם בדרך לא יהיה רגע שבו הסרטונים לרוחב מוצגים עם סינון אורך.
    await openGalleryFilters(page);
    await page.locator('#galleryOrientationFilter').selectOption('portrait');
    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await page.locator('#galleryVideoLengthFilter').selectOption('short');
    await expect(titles(page)).toHaveText(['קצר לאורך']);
    // שני הסרטונים בלי מידות נספרו עד עכשיו; עם סינון האורך — רק הקצר.
    await expect(page.locator('#galleryOrientationNote')).toHaveText('פריט אחד בלי מידות שמורות אינו נכלל בסינון לפי כיוון.');
    await expect(page.locator('#galleryVideoLengthNote')).toBeHidden();
    // ציור נוסף (מיון אחר) — ועדיין אין בדיקה של הקבצים.
    await page.locator('#gallerySortSelect').selectOption('oldest');
    await expect(titles(page)).toHaveText(['קצר לאורך']);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    expect(mediaRequests).toEqual([]);

    // בלי סינון כיוון — עכשיו הם היו מוצגים, ולכן נבדקים ונספרים.
    await page.locator('#galleryOrientationFilter').selectOption('');
    await expect(page.locator('#galleryVideoLengthNote')).toBeVisible();
    await expect.poll(() => new Set(mediaRequests).size).toBe(2);
});

// מעל רוחב טלפון גבולות הטווח נפתחים בתוך חלונית הסינון הצפה. כשהכפתור
// ישב בסרגל עצמו, ליד הקצה השמאלי, החלונית חרגה מהמסך (820px, ו-1280px עם
// בורר האורך). הבדיקה נשארת: בכל רוחב, גם כשהכיתוב שבכפתור משתנה, אין חריגה.
for (const width of [820, 900, 1280]) {
    test(`ברוחב ${width}px: חלונית הטווח כולה בתוך המסך, בלי גלילה אופקית`, async ({ page, worker }) => {
        await page.setViewportSize({ width, height: 900 });
        seedDatedGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(5);
        await openGalleryFilters(page);
        await page.locator('#galleryMediaTypeFilter').selectOption('video');
        await page.locator('#galleryDateRangeToggle').click();
        const panel = page.locator('#galleryDateRangePanel');
        await expect(panel).toBeVisible();
        const inside = async () => {
            const box = await panel.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        };
        await inside();
        await page.locator('#galleryDateRangeFromYear').selectOption({ label: 'תשפ״ד' });
        await page.locator('#galleryDateRangeToYear').selectOption({ label: 'תשפ״ז' });
        await expect(page.locator('#galleryDateRangeLabel')).toHaveText('משנת תשפ״ד עד סוף שנת תשפ״ז');
        await inside();
    });
}

test('בטלפון: חלונית הטווח נפתחת בתוך גיליון הסינון, בלי גלילה אופקית', async ({ page, worker }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    seedDatedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(5);
    const toggle = page.locator('#galleryDateRangeToggle');
    await openGalleryFilters(page);
    await toggle.click();
    const panel = page.locator('#galleryDateRangePanel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#galleryDateRangeFromYear').selectOption({ label: 'תשפ״ז' });
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// ברוחב 1280px ציר הזמן הוא עמודה שלישית בפריסה, והוא מופיע ונעלם עם המיון
// ועם מספר החודשים שבתצוגה — גם כשהחלונית פתוחה (טווח של חודש אחד מעלים
// אותו). הגלריה משנה אז את רוחבה, הסרגל נשבר אחרת והכפתור זז — והחלונית
// צריכה להימדד מחדש, בלי לחרוג מהמסך.
test('ברוחב 1280px: חלונית הטווח נשארת בתוך המסך כשציר הזמן מופיע ונעלם', async ({ page, worker }) => {
    const width = 1280;
    await page.setViewportSize({ width, height: 900 });
    // סרטונים משלושה חודשים, כדי שגם ב"סרטונים בלבד" יהיה ציר.
    worker.seedFolders().seedImages([
        videoRecord(1, 'סרטון תשרי', { duration: 30, ...capture('2026-09-28T16:30:00Z', '2026-09-28') }),
        videoRecord(2, 'סרטון כסלו', { duration: 30, ...capture('2025-11-25T10:00:00Z', '2025-11-25') }),
        videoRecord(3, 'סרטון אדר', { duration: 30, ...capture('2024-03-24T10:00:00Z', '2024-03-24') })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    const layout = page.locator('.gallery-layout');
    await expect(layout).toHaveAttribute('data-timeline', '');
    // בורר האורך מוצג גם הוא (כשהבוררים ישבו בסרגל, הוא הרחיב אותו).
    await openGalleryFilters(page);
    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await page.evaluate(() => window.setGallerySort('name'));
    await expect(layout).not.toHaveAttribute('data-timeline');
    await page.locator('#galleryDateRangeToggle').click();
    const panel = page.locator('#galleryDateRangePanel');
    await expect(panel).toBeVisible();
    const inside = async () => {
        await expect.poll(async () => {
            const box = await panel.boundingBox();
            const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
            return { left: box.x >= 0, right: box.x + box.width <= width, noScroll };
        }).toEqual({ left: true, right: true, noScroll: true });
    };
    await inside();
    // המיון חוזר לתאריך בזמן שהחלונית פתוחה: ציר הזמן מופיע.
    await page.evaluate(() => window.setGallerySort('newest'));
    await expect(layout).toHaveAttribute('data-timeline', '');
    await expect(panel).toBeVisible();
    await inside();
    await page.evaluate(() => window.setGallerySort('name'));
    await expect(layout).not.toHaveAttribute('data-timeline');
    await inside();
    // טווח של חודש אחד מעלים את הציר, וביטולו מחזיר אותו.
    await page.evaluate(() => window.setGallerySort('newest'));
    await expect(layout).toHaveAttribute('data-timeline', '');
    await inside();
    await page.locator('#galleryDateRangeFromYear').selectOption({ label: 'תשפ״ז' });
    await expect(layout).not.toHaveAttribute('data-timeline');
    await inside();
    await page.locator('#galleryDateRangeFromYear').selectOption('');
    await expect(layout).toHaveAttribute('data-timeline', '');
    await inside();
});
