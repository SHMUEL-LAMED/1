// הצעות להשלמה בשדה החיפוש: תיקיות ואירועים, סוג הרגע, אנשים ומעלים, באותו
// combobox של החיפושים האחרונים והשמורים. בחירה מפעילה את הסינון המתאים, ההתאמה
// סלחנית לניקוד ולגרשיים, והאנשים נטענים עצלה — בלי פנים ובלי מנוע הזיהוי.
import { test, expect, seedSession, imageRecord, DEFAULT_FOLDERS, DEFAULT_USER } from './fixtures.mjs';
import { storageKeyFor } from '../search-history.js';

const USER_KEY = storageKeyFor(DEFAULT_USER.uid);
const BOX = { x: 0.25, y: 0.2, w: 0.3, h: 0.4, a: 1.5 };

function seedSuggestGallery(worker) {
    worker.seedFolders([...DEFAULT_FOLDERS, { id: 'chabad', name: 'כינוס חב״ד בצ׳רנוביל', icon: 'calendar' }]);
    worker.seedImages([
        imageRecord(1, { title: 'מעגל בחצר', folderId: '2', sceneTags: ['dance'], captionSource: 'ai', aiCaptionVersion: 1, uploadedByName: 'רבקה לוי' }),
        imageRecord(2, { title: 'שולחן החג', folderId: '1', sceneTags: ['meal'], captionSource: 'ai', aiCaptionVersion: 1, uploadedByName: 'רבקה לוי' }),
        imageRecord(3, { title: 'הקפה שנייה', folderId: '2', sceneTags: ['hakafot', 'dance'], captionSource: 'ai', aiCaptionVersion: 1, uploadedByName: 'משה כץ' }),
        imageRecord(4, { title: 'פתיחת הכינוס', folderId: 'chabad', uploadedByName: 'משה כץ' })
    ]);
    worker.seedPerson({ personId: 'fp_yossi', name: 'יוסי כהן', status: 'approved', faces: [{ imageId: 'img_e2e_1', box: BOX }, { imageId: 'img_e2e_3', box: BOX }] });
    // קבוצה שלא אושרה ואדם מוסתר אינם מוצעים.
    worker.seedPerson({ personId: 'fp_pending', name: 'יוסף ממתין', status: 'suggested', faces: [{ imageId: 'img_e2e_2' }] });
    worker.seedPerson({ personId: 'fp_hidden', name: 'יוסל מוסתר', status: 'approved', hidden: true, faces: [{ imageId: 'img_e2e_4' }] });
}

const suggestionRows = page => page.locator('#searchHistoryPopup .search-suggest-row');
const suggestionGroup = (page, kind) => page.locator(`#searchHistoryPopup .search-suggest-group[data-kind="${kind}"]`);
const historyRows = page => page.locator('#searchHistoryPopup .search-history-row');

test('הצעות בזמן ההקלדה: קבוצות עם כותרות, מקלדת, ובחירה שמפעילה תיקייה, סוג רגע, אדם או מעלה', async ({ page, worker }) => {
    seedSuggestGallery(worker);
    await seedSession(page, { worker });
    const faceAssets = [];
    page.on('request', request => {
        if (/face-assets|face-api/i.test(request.url())) faceAssets.push(request.url());
    });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const search = page.locator('#searchInput');
    const popup = page.locator('#searchHistoryPopup');
    const status = page.locator('#searchHistoryStatus');
    await expect(cards).toHaveCount(4);
    // עד ההקלדה הראשונה רשימת האנשים אינה מבוקשת.
    expect(worker.requestsTo('GET', '/face/')).toHaveLength(0);

    // שדה ריק — אין הצעות (ואין היסטוריה), והתפריט סגור.
    await search.click();
    await expect(popup).toBeHidden();

    // תיקייה: "טיול" מציע את "טיולים וסיורים" תחת "תיקיות ואירועים", עם המונה.
    await search.pressSequentially('טיול');
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(suggestionGroup(page, 'folder').locator('[role="columnheader"]')).toHaveText('תיקיות ואירועים');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['טיולים וסיורים']);
    await expect(suggestionRows(page).locator('.search-history-meta')).toHaveText(['2 פריטים']);
    await expect(status).toHaveText('הצעה אחת. חיצים למעלה ולמטה לבחירה.');
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-0-0');
    await expect(page.locator('#searchHistoryCell-0-0')).toHaveClass(/is-active/);
    // שורה של הצעה היא תא אחד: חץ לצד נשאר בה.
    await search.press('ArrowLeft');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-0-0');
    await search.press('Enter');
    await expect(popup).toBeHidden();
    await expect(search).toHaveValue('');
    await expect(page.locator('#folderList .collection-card.is-active')).toContainText('טיולים וסיורים');
    await expect(cards.locator('.gallery-title')).toHaveText(['הקפה שנייה', 'מעגל בחצר']);
    await expect(status).toHaveText('נפתחה התיקייה „טיולים וסיורים”.');
    await expect(search).toBeFocused();

    // גרש וגרשיים בכל כתיבה: "חב'ד" מוצא את "כינוס חב״ד בצ׳רנוביל".
    await search.fill("חב'ד");
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['כינוס חב״ד בצ׳רנוביל']);
    await search.press('Escape');
    await expect(popup).toBeHidden();
    await expect(search).toHaveValue("חב'ד");
    await search.fill('');

    // סוג הרגע, בכתיב חסר עם ניקוד: "רִקּוּד" → שבב "ריקוד". לחיצה בעכבר.
    await page.locator('#folderList .collection-card-main', { hasText: 'כל הארכיון' }).click();
    await search.fill('רִקּוּד');
    await expect(suggestionGroup(page, 'tag').locator('[role="columnheader"]')).toHaveText('סוג הרגע');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['ריקוד']);
    await suggestionRows(page).locator('[data-action="suggest"]').click();
    await expect(search).toHaveValue('');
    await expect(page.locator('#gallerySceneFilter .scene-chip[data-scene-tag="dance"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.locator('.gallery-title')).toHaveText(['הקפה שנייה', 'מעגל בחצר']);
    await expect(status).toHaveText('מוצגים פריטים מסוג ריקוד.');
    await page.locator('#gallerySceneFilter .scene-chip[data-scene-tag=""]').click();
    await expect(cards).toHaveCount(4);

    // מעלה: בחירה מחפשת את השם כטקסט ורושמת אותו בחיפושים האחרונים.
    await search.fill('רבקה');
    await expect(suggestionGroup(page, 'uploader').locator('[role="columnheader"]')).toHaveText('הועלו על ידי');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['רבקה לוי']);
    await expect(suggestionRows(page).locator('.search-history-meta')).toHaveText(['2 פריטים']);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(search).toHaveValue('רבקה לוי');
    await expect(cards.locator('.gallery-title')).toHaveText(['שולחן החג', 'מעגל בחצר']);
    await expect(status).toHaveText('החיפוש „רבקה לוי” הופעל.');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.recent?.map(entry => entry.query), USER_KEY))
        .toEqual(['רבקה לוי']);

    // אדם: רק המאושר עם השם, בלי הממתין והמוסתר. רשימת האנשים נמשכה פעם אחת,
    // ושום דבר של זיהוי פנים לא נטען.
    await search.fill('יוס');
    await expect(suggestionGroup(page, 'person').locator('[role="columnheader"]')).toHaveText('אנשים');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['יוסי כהן']);
    await expect(suggestionRows(page).locator('.search-history-meta')).toHaveText(['2 תמונות']);
    expect(worker.requestsTo('GET', '/face/').map(request => request.path)).toEqual(['/face/persons']);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(page).toHaveURL(/#person\/fp_yossi$/);
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של יוסי כהן');
    await expect(search).toHaveValue('');
    await expect(cards.locator('.gallery-title')).toHaveText(['הקפה שנייה', 'מעגל בחצר']);
    expect(faceAssets).toEqual([]);

    // מתוך האלבום, בחירה בתיקייה סוגרת אותו ומנקה את ה-hash.
    await search.fill('אירוע');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['אירועים ופעילויות']);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(page).not.toHaveURL(/#person\//);
    await expect(page.locator('#tempSearchBanner')).toBeHidden();
    await expect(cards.locator('.gallery-title')).toHaveText(['שולחן החג']);
});

test('ההצעות והחיפושים הקודמים באותו תפריט: הצעות קודם, חצים עוברים ביניהם, ושדה ריק מחזיר את ההיסטוריה', async ({ page, worker }) => {
    seedSuggestGallery(worker);
    await seedSession(page, { worker });
    const now = Date.now();
    await page.addInitScript(([key, value]) => {
        try {
            if (sessionStorage.getItem('__e2eSuggestSeeded')) return;
            localStorage.setItem(key, value);
            sessionStorage.setItem('__e2eSuggestSeeded', '1');
        } catch {
            // אחסון חסום.
        }
    }, [USER_KEY, JSON.stringify({ v: 1, recent: [{ query: 'משה כץ בחצר', filters: {}, at: now - 1000 }, { query: 'ברכה', filters: {}, at: now - 2000 }], saved: [], savedUpdatedAt: 0, savedSyncedAt: 0 })]);
    await page.goto('/');

    const search = page.locator('#searchInput');
    const status = page.locator('#searchHistoryStatus');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);

    // שדה ריק: רק החיפושים האחרונים.
    await search.click();
    await expect(historyRows(page).locator('.search-history-query')).toHaveText(['משה כץ בחצר', 'ברכה']);
    await expect(suggestionRows(page)).toHaveCount(0);

    // "משה": ההצעה (מעלה) ראשונה, ואחריה החיפוש האחרון שמכיל את הטקסט ושורת הניקוי.
    await search.pressSequentially('משה');
    await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['משה כץ']);
    await expect(historyRows(page).locator('.search-history-query')).toHaveText(['משה כץ בחצר']);
    await expect(status).toHaveText('הצעה אחת ו־חיפוש אחרון אחד. חיצים למעלה ולמטה לבחירה.');
    const order = await page.locator('#searchHistoryPopup [role="row"]:not(.search-history-heading)').evaluateAll(nodes => nodes.map(node => node.className));
    expect(order).toEqual(['search-suggest-row', 'search-history-row', 'search-history-actions']);

    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-0-0');
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-1-0');
    // בשורת חיפוש קודם יש שוב שלושה תאים; Delete פועל רק בה.
    await search.press('ArrowLeft');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-1-1');
    await search.press('ArrowUp');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-0-0');
    await search.press('Delete');
    await expect(suggestionRows(page)).toHaveCount(1);
    await search.press('ArrowUp');
    await expect(search).toHaveAttribute('aria-activedescendant', 'searchHistoryCell-2-0');
    await expect(page.locator('#searchHistoryCell-2-0')).toContainText('ניקוי החיפושים האחרונים');

    // Escape סוגר בלי למחוק; מחיקת הטקסט מחזירה את התפריט של שדה ריק.
    await search.press('Escape');
    await expect(page.locator('#searchHistoryPopup')).toBeHidden();
    await expect(search).toHaveValue('משה');
    await search.fill('');
    await search.press('ArrowDown');
    await expect(suggestionRows(page)).toHaveCount(0);
    await expect(historyRows(page)).toHaveCount(2);

    // טקסט שאין לו הצעה ולא חיפוש קודם — התפריט נשאר סגור, ו-Enter מחפש כרגיל.
    await search.fill('xyz');
    await expect(page.locator('#searchHistoryPopup')).toBeHidden();
    await search.press('Enter');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(0);
});

test.describe('ברוחב טלפון', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('ההצעות נכנסות במסך, בלי גלילה אופקית, עם מטרות מגע של 40px, והקשה מפעילה', async ({ page, worker }) => {
        seedSuggestGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');

        const search = page.locator('#searchInput');
        const popup = page.locator('#searchHistoryPopup');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);
        await search.tap();
        await search.fill('כינוס');
        await expect(suggestionRows(page).locator('.search-history-query')).toHaveText(['כינוס חב״ד בצ׳רנוביל']);
        await expect(popup).toBeVisible();

        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        const box = await popup.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        const apply = await suggestionRows(page).first().locator('[data-action="suggest"]').boundingBox();
        expect(apply.height).toBeGreaterThanOrEqual(40);

        await suggestionRows(page).first().locator('[data-action="suggest"]').tap();
        await expect(page.locator('#folderList .collection-card.is-active')).toContainText('כינוס חב״ד בצ׳רנוביל');
        await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['פתיחת הכינוס']);
    });
});
