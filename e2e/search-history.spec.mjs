// חיפושים אחרונים ושמורים: התפריט שנפתח מתחת לשדה החיפוש (combobox עם grid).
// חיפוש נרשם עם הסינון שלו, כוכב שומר אותו (גם במסמך userPreferences בענן),
// לחיצה מחזירה את הטקסט ואת כל הסינונים, והמקלדת עובדת לפי תבנית ARIA.
// הרשימה נפרדת לכל משתמש, ואחסון פגום או חסום אינו מפיל את הדף.
import { test, expect, seedSession, imageRecord, variantEntries, API_ORIGIN, DEFAULT_USER } from './fixtures.mjs';
import { storageKeyFor } from '../search-history.js';

const USER_KEY = storageKeyFor(DEFAULT_USER.uid);

function seedSearchGallery(worker) {
    worker.seedFolders().seedImages([
        imageRecord(1, { title: 'ברכת המזון', folderId: '1' }),
        imageRecord(2, {
            title: 'ריקודים בחצר',
            folderId: '2',
            url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_e2e_2.mp4`,
            r2Key: `approved/${DEFAULT_USER.uid}/img_e2e_2.mp4`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            variants: variantEntries('img_e2e_2', ['poster', 'thumb']),
            variantsVersion: 1
        }),
        imageRecord(3, { title: 'ריקודים בסעודה', folderId: '2' }),
        imageRecord(4, { title: 'סעודת הודיה', folderId: '1' })
    ]);
}

// כותב רשימה שמורה ל-localStorage פעם אחת לכל לשונית, לפני שקוד האתר רץ.
async function seedHistory(page, entries) {
    await page.addInitScript(([items]) => {
        try {
            if (sessionStorage.getItem('__e2eHistorySeeded')) return;
            for (const [key, value] of items) localStorage.setItem(key, value);
            sessionStorage.setItem('__e2eHistorySeeded', '1');
        } catch {
            // אחסון חסום.
        }
    }, [entries]);
}

function historyState({ recent = [], saved = [], savedUpdatedAt = 0 } = {}) {
    return JSON.stringify({ v: 1, recent, saved, savedUpdatedAt, savedSyncedAt: 0 });
}

const popupRows = page => page.locator('#searchHistoryPopup .search-history-row');
const groupRows = (page, kind) => page.locator(`#searchHistoryPopup .search-history-group[data-kind="${kind}"] .search-history-row`);

test('חיפוש נרשם עם הסינון, כוכב שומר אותו בענן, ולחיצה מחזירה את הטקסט ואת כל הסינונים', async ({ page, worker }) => {
    seedSearchGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const search = page.locator('#searchInput');
    const popup = page.locator('#searchHistoryPopup');
    await expect(cards).toHaveCount(4);
    await expect(search).toHaveAttribute('role', 'combobox');
    await expect(search).toHaveAttribute('aria-controls', 'searchHistoryPopup');

    // בלי היסטוריה התפריט אינו נפתח.
    await search.click();
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    await expect(popup).toBeHidden();

    // חיפוש בתיקייה "טיולים וסיורים", סרטונים בלבד.
    await page.locator('#folderList .collection-card-main', { hasText: 'טיולים וסיורים' }).click();
    await expect(cards).toHaveCount(2);
    await page.locator('#galleryMediaTypeFilter').selectOption('video');
    await expect(cards).toHaveCount(1);
    await search.fill('ריקודים');
    await search.press('Enter');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בחצר']);

    // חיפוש שני, בלי סינון.
    await search.fill('');
    await page.locator('#galleryMediaTypeFilter').selectOption('');
    await page.locator('#folderList .collection-card-main', { hasText: 'כל הארכיון' }).click();
    await expect(cards).toHaveCount(4);
    await search.fill('סעודה');
    await search.press('Enter');
    await search.fill('');

    // לחיצה על השדה פותחת את התפריט: החדש ראשון, ופרטי הסינון מתחת לטקסט.
    await search.click();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(popup).toBeVisible();
    await expect(groupRows(page, 'recent').locator('.search-history-query')).toHaveText(['סעודה', 'ריקודים']);
    await expect(groupRows(page, 'recent').nth(1).locator('.search-history-meta')).toHaveText('תיקייה: טיולים וסיורים · סרטונים בלבד');
    await expect(page.locator('#searchHistoryStatus')).toHaveText('2 חיפושים אחרונים. חיצים למעלה ולמטה לבחירה.');

    // כוכב: "ריקודים" עובר לשמורים, והכפתור מסומן.
    await groupRows(page, 'recent').filter({ hasText: 'ריקודים' }).locator('[data-action="star"]').click();
    await expect(groupRows(page, 'saved').locator('.search-history-query')).toHaveText(['ריקודים']);
    await expect(groupRows(page, 'saved').locator('[data-action="star"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(groupRows(page, 'recent').locator('.search-history-query')).toHaveText(['סעודה']);
    await expect(page.locator('#searchHistoryStatus')).toHaveText('החיפוש „ריקודים” נשמר בכוכב.');
    await expect(search).toBeFocused();

    // החיפוש השמור נכתב למסמך userPreferences של המשתמש, בלי לגעת בשדות אחרים.
    await expect.poll(() => worker.collection('userPreferences').get(DEFAULT_USER.uid)?.savedSearches)
        .toEqual([{ query: 'ריקודים', filters: { folderId: '2', mediaType: 'video' }, savedAt: expect.any(Number) }]);
    expect(worker.requestsTo('PUT', `/data/userPreferences/${DEFAULT_USER.uid}`).every(request => JSON.parse(request.body).merge === true)).toBe(true);

    await search.press('Escape');
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    await expect(popup).toBeHidden();

    // אחרי רענון הרשימה עדיין שם — במפתח של המשתמש.
    await page.reload();
    await expect(cards).toHaveCount(4);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).saved.map(entry => entry.query), USER_KEY)).toEqual(['ריקודים']);
    await search.click();
    await expect(groupRows(page, 'saved').locator('.search-history-query')).toHaveText(['ריקודים']);
    await expect(groupRows(page, 'recent').locator('.search-history-query')).toHaveText(['סעודה']);

    // לחיצה על החיפוש השמור מחזירה את הטקסט, התיקייה וסוג המדיה, ומריצה אותו.
    await groupRows(page, 'saved').locator('[data-action="apply"]').click();
    await expect(popup).toBeHidden();
    await expect(search).toHaveValue('ריקודים');
    await expect(page.locator('#galleryMediaTypeFilter')).toHaveValue('video');
    await expect(page.locator('#folderList .collection-card.is-active')).toContainText('טיולים וסיורים');
    await expect(cards.locator('.gallery-title')).toHaveText(['ריקודים בחצר']);
    await expect(page.locator('#searchHistoryStatus')).toHaveText('החיפוש „ריקודים” הופעל.');

    // Escape סוגר את התפריט בלי למחוק את הטקסט שבשדה.
    await search.click();
    await expect(popup).toBeVisible();
    await search.press('Escape');
    await expect(popup).toBeHidden();
    await expect(search).toHaveValue('ריקודים');
    await expect(cards).toHaveCount(1);

    // הסרה של חיפוש אחרון אחד.
    await search.fill('');
    await search.click();
    await groupRows(page, 'recent').filter({ hasText: 'סעודה' }).locator('[data-action="remove"]').click();
    await expect(page.locator('#searchHistoryStatus')).toHaveText('„סעודה” הוסר מהחיפושים האחרונים.');
    await expect(groupRows(page, 'recent')).toHaveCount(0);
    await expect(groupRows(page, 'saved')).toHaveCount(1);
});

test('ניווט במקלדת: חצים בין שורות ותאים (מימין לשמאל), Enter, Delete וניקוי', async ({ page, worker }) => {
    seedSearchGallery(worker);
    await seedSession(page, { worker });
    const now = Date.now();
    await seedHistory(page, [[USER_KEY, historyState({
        recent: [
            { query: 'ברכת', filters: {}, at: now - 1000 },
            { query: 'סעודת', filters: { folderId: '1' }, at: now - 2000 },
            { query: 'ריקודים', filters: { mediaType: 'video' }, at: now - 3000 }
        ],
        saved: [{ query: 'ריקודים', filters: { mediaType: 'video' }, savedAt: now - 500 }],
        savedUpdatedAt: now - 500
    })]]);
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    const search = page.locator('#searchInput');
    const status = page.locator('#searchHistoryStatus');
    await expect(cards).toHaveCount(4);

    // "/" מקפיץ לחיפוש, והתפריט נפתח ומכריז כמה חיפושים יש.
    await page.locator('body').press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(status).toHaveText('חיפוש שמור אחד ו־2 חיפושים אחרונים. חיצים למעלה ולמטה לבחירה.');
    await expect(popupRows(page).locator('.search-history-query')).toHaveText(['ריקודים', 'ברכת', 'סעודת']);

    const activeCell = () => search.getAttribute('aria-activedescendant');
    const expectActive = async (id, text) => {
        await expect(search).toHaveAttribute('aria-activedescendant', id);
        await expect(page.locator(`#${id}`)).toHaveClass(/is-active/);
        if (text) await expect(page.locator(`#${id}`)).toContainText(text);
    };

    await search.press('ArrowDown');
    await expectActive('searchHistoryCell-0-0', 'ריקודים');
    // חץ למעלה מהשורה הראשונה עובר לאחרונה — שורת הניקוי.
    await search.press('ArrowUp');
    await expectActive('searchHistoryCell-3-0', 'ניקוי החיפושים האחרונים');
    await search.press('ArrowUp');
    await expectActive('searchHistoryCell-2-0', 'סעודת');

    // מימין לשמאל: חץ שמאלה הוא התא הבא — הכוכב.
    await search.press('ArrowLeft');
    await expectActive('searchHistoryCell-2-1');
    await search.press('Enter');
    await expect(status).toHaveText('החיפוש „סעודת” נשמר בכוכב.');
    await expect(groupRows(page, 'saved').locator('.search-history-query')).toHaveText(['סעודת', 'ריקודים']);
    // התא הפעיל נשאר על אותו חיפוש, שעבר לראש השמורים.
    await expectActive('searchHistoryCell-0-1');
    await expect(page.locator('#searchHistoryCell-0-1 [data-action="star"]')).toHaveAttribute('aria-pressed', 'true');
    await search.press('ArrowRight');
    await expectActive('searchHistoryCell-0-0', 'סעודת');

    // Delete מוחק את השורה הפעילה (חיפוש שמור — משתי הרשימות).
    await search.press('ArrowDown');
    await expectActive('searchHistoryCell-1-0', 'ריקודים');
    await search.press('Delete');
    await expect(status).toHaveText('החיפוש השמור „ריקודים” נמחק.');
    await expect(popupRows(page).locator('.search-history-query')).toHaveText(['סעודת', 'ברכת']);
    await expectActive('searchHistoryCell-1-0', 'ברכת');

    // Enter על תא החיפוש מפעיל אותו.
    await search.press('Enter');
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(await activeCell()).toBeNull();
    await expect(search).toHaveValue('ברכת');
    await expect(cards.locator('.gallery-title')).toHaveText(['ברכת המזון']);
    await expect(status).toHaveText('החיפוש „ברכת” הופעל.');

    // חץ למטה פותח שוב; התפריט מסונן לפי הטקסט שבשדה.
    await search.press('ArrowDown');
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(popupRows(page).locator('.search-history-query')).toHaveText(['ברכת']);
    await expectActive('searchHistoryCell-0-0', 'ברכת');
    await search.press('ArrowUp');
    await expectActive('searchHistoryCell-1-0', 'ניקוי החיפושים האחרונים');
    await search.press('Enter');
    await expect(status).toHaveText('החיפושים האחרונים נוקו.');
    // לא נשאר דבר שמתאים ל"ברכת", ולכן התפריט נסגר.
    await expect(search).toHaveAttribute('aria-expanded', 'false');

    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), USER_KEY);
    expect(stored.recent).toEqual([]);
    expect(stored.saved.map(entry => entry.query)).toEqual(['סעודת']);
    // הרשימה המקומית שקדמה לסנכרון נדחפה לענן בקריאה הראשונה, וכל שינוי אחריה.
    await expect.poll(() => worker.collection('userPreferences').get(DEFAULT_USER.uid)?.savedSearches?.map(entry => entry.query))
        .toEqual(['סעודת']);
});

test('כל משתמש רואה רק את שלו, חיפושים שמורים מגיעים מהענן, ותוכן פגום אינו מפיל דבר', async ({ page, worker }) => {
    seedSearchGallery(worker);
    const now = Date.now();
    worker.seed('userPreferences', DEFAULT_USER.uid, {
        followedFolderIds: ['1'],
        savedSearches: [{ query: 'מהענן', filters: { folderId: '1' }, savedAt: now - 5000 }],
        savedSearchesUpdatedAt: now - 5000
    });
    await seedSession(page, { worker });
    await seedHistory(page, [
        [storageKeyFor('google-user-2'), historyState({ recent: [{ query: 'של משתמש אחר', filters: {}, at: now }] })],
        [storageKeyFor(''), historyState({ recent: [{ query: 'של אורח', filters: {}, at: now }] })],
        [USER_KEY, '{"v":1,"recent":[{"query":']
    ]);
    await page.goto('/');

    const search = page.locator('#searchInput');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);
    await search.click();
    await expect(groupRows(page, 'saved').locator('.search-history-query')).toHaveText(['מהענן']);
    await expect(groupRows(page, 'saved').locator('.search-history-meta')).toHaveText('תיקייה: אירועים ופעילויות');
    await expect(popupRows(page)).toHaveCount(1);
    await expect(page.locator('#searchHistoryPopup')).not.toContainText('של משתמש אחר');
    await expect(page.locator('#searchHistoryPopup')).not.toContainText('של אורח');

    // החיפוש הבא מחליף את התוכן הפגום בתוכן תקין, במפתח של המשתמש בלבד.
    await search.fill('ברכת');
    await search.press('Enter');
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), USER_KEY);
    expect(stored.recent.map(entry => entry.query)).toEqual(['ברכת']);
    expect(stored.saved.map(entry => entry.query)).toEqual(['מהענן']);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).recent[0].query, storageKeyFor('google-user-2'))).toBe('של משתמש אחר');
    // המיזוג לא נגע בשדות האחרים של המסמך.
    expect(worker.collection('userPreferences').get(DEFAULT_USER.uid).followedFolderIds).toEqual(['1']);
});

test('אחסון חסום: הרשימה עובדת עד רענון, והתפריט מודיע שאינה נשמרת', async ({ page, worker }) => {
    seedSearchGallery(worker);
    await seedSession(page, { worker });
    await page.addInitScript(prefix => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
            if (String(key).startsWith(prefix)) throw new DOMException('blocked', 'SecurityError');
            return getItem.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
            if (String(key).startsWith(prefix)) throw new DOMException('blocked', 'SecurityError');
            return setItem.call(this, key, value);
        };
    }, USER_KEY.split(':')[0]);
    await page.goto('/');

    const search = page.locator('#searchInput');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);
    await search.fill('ברכת');
    await search.press('Enter');
    await search.fill('');
    await search.click();
    await expect(popupRows(page).locator('.search-history-query')).toHaveText(['ברכת']);
    await expect(page.locator('#searchHistoryPopup .search-history-note')).toHaveText('הדפדפן חוסם שמירה מקומית — הרשימה תישמר רק עד רענון הדף.');
    await popupRows(page).locator('[data-action="star"]').click();
    await expect(groupRows(page, 'saved').locator('.search-history-query')).toHaveText(['ברכת']);
});

test.describe('ברוחב טלפון', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('התפריט נכנס במסך, מעל הכרטיסים, בלי גלילה אופקית ועם מטרות מגע של 40px', async ({ page, worker }) => {
        seedSearchGallery(worker);
        await seedSession(page, { worker });
        const now = Date.now();
        await seedHistory(page, [[USER_KEY, historyState({
            recent: [{ query: 'חיפוש ארוך מאוד שבודק שהטקסט נחתך בשלוש נקודות ואינו דוחף את התפריט אל מחוץ למסך', filters: { folderId: '2', hebrewYear: 5786, hebrewMonth: 'tishrei', mediaType: 'video' }, at: now }],
            saved: [{ query: 'ריקודים', filters: { mediaType: 'video' }, savedAt: now }],
            savedUpdatedAt: now
        })]]);
        await page.goto('/');

        const search = page.locator('#searchInput');
        const popup = page.locator('#searchHistoryPopup');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);
        await search.tap();
        await expect(popup).toBeVisible();
        await expect(popupRows(page)).toHaveCount(2);

        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        const box = await popup.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        for (const button of await popup.locator('.search-history-tool').all()) {
            const size = await button.boundingBox();
            expect(size.width).toBeGreaterThanOrEqual(40);
            expect(size.height).toBeGreaterThanOrEqual(40);
        }
        const apply = await popupRows(page).first().locator('[data-action="apply"]').boundingBox();
        expect(apply.height).toBeGreaterThanOrEqual(40);

        // התפריט צף מעל הכרטיסים: הנקודה שבמרכז כל שורה שייכת לו. הגלילה אל
        // השורה מיידית — לדף יש scroll-behavior: smooth, ומדידה באמצע אנימציה
        // (או הקשה בזמן שהדף עוד גולל) הייתה פוגעת בשורה אחרת.
        const covered = await page.evaluate(() => [...document.querySelectorAll('#searchHistoryPopup .search-history-row')]
            .map(row => {
                row.scrollIntoView({ block: 'center', behavior: 'instant' });
                const rect = row.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return row.contains(hit) ? null : `${row.textContent} → ${hit?.outerHTML?.slice(0, 120)}`;
            })
            .filter(Boolean));
        expect(covered).toEqual([]);

        // הקשה על החיפוש השמור מחזירה אותו.
        await groupRows(page, 'saved').locator('[data-action="apply"]').tap();
        await expect(search).toHaveValue('ריקודים');
        await expect(page.locator('#galleryMediaTypeFilter')).toHaveValue('video');
        await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['ריקודים בחצר']);
    });
});
