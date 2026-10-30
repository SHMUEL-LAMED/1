// "חדש מאז הביקור הקודם" ותצוגה מקדימה של תיקייה (new-since.js, folder-preview.js):
// בביקור הראשון אין תגים; בביקור חוזר הכרטיסים והתיקיות שנוסף בהם דבר מסומנים,
// והתגים נשארים אחרי רענון באמצע הביקור. ריחוף או מיקוד מהמקלדת על תיקייה
// מציג את התמונות האחרונות שבה; רק תיקייה שריחפו עליה ושעוד לא נטענה מבקשת
// את העמוד הראשון שלה, ובלי "ריחוף" (מכשיר מגע) אין דבר.
import { test, expect, seedSession, imageRecord, variantEntries, variantUrl, DEFAULT_USER } from './fixtures.mjs';

const VISIT_KEY = `simchas_gallery_last_visit_v1:${DEFAULT_USER.uid}`;
const HOUR = 60 * 60 * 1000;
const query = entry => new URL(entry.path, 'https://fake.invalid').searchParams;
const folderRequests = (worker, folderId) => worker.requestsTo('GET', '/data/images?').filter(entry => query(entry).get('folderId') === folderId);

// רשומת הביקור הקודם נכתבת פעם אחת לכל לשונית, לפני שקוד האתר רץ — רענון
// אינו דורס את מה שהאתר עצמו כתב בינתיים.
async function seedVisit(page, records) {
    await page.addInitScript(entries => {
        try {
            if (sessionStorage.getItem('__e2eVisitSeeded')) return;
            for (const [key, value] of entries) localStorage.setItem(key, JSON.stringify(value));
            sessionStorage.setItem('__e2eVisitSeeded', '1');
        } catch {
            // אחסון חסום.
        }
    }, Object.entries(records));
}

function readVisit(page) {
    return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), VISIT_KEY);
}

const folderCard = (page, name) => page.locator('#folderList .collection-card', { hasText: name });

test('ביקור ראשון: שום דבר אינו "חדש", והביקור נרשם לפעם הבאה', async ({ page, worker }) => {
    const now = Date.now();
    worker.seedFolders().seedImages([
        imageRecord(1, { createdAt: now - 3 * HOUR }),
        imageRecord(2, { createdAt: now - HOUR, folderId: '2' })
    ]);
    // ביקור של משתמש אחר באותו דפדפן אינו נחשב.
    await seedVisit(page, { 'simchas_gallery_last_visit_v1:someone-else': { previousVisit: 0, lastSeenAt: now - 5 * HOUR } });
    await seedSession(page, { worker });
    await page.goto('/');

    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
    await expect(folderCard(page, 'טיולים וסיורים').locator('.collection-card-count strong')).toHaveText('1');
    await expect(page.locator('#photosGrid .gallery-new-badge')).toHaveCount(0);
    await expect(page.locator('#folderList .new-since-badge')).toHaveCount(0);
    const visit = await readVisit(page);
    expect(visit.previousVisit).toBe(0);
    expect(visit.lastSeenAt).toBeGreaterThanOrEqual(now);
});

test('ביקור חוזר: כרטיסים ותיקיות חדשים מסומנים, והתגים נשארים אחרי רענון', async ({ page, worker }) => {
    const now = Date.now();
    const previousEnd = now - 2 * HOUR;
    worker.seedFolders().seedImages([
        imageRecord(1, { createdAt: now - 5 * HOUR, folderId: '1' }),
        imageRecord(2, { createdAt: now - 4 * HOUR, folderId: '1' }),
        imageRecord(3, { createdAt: now - HOUR, folderId: '2', title: 'טיול חדש' }),
        imageRecord(4, { createdAt: now - 30 * 60_000, folderId: '3', title: 'מפגש חדש' })
    ]);
    await seedVisit(page, { [VISIT_KEY]: { previousVisit: now - 30 * HOUR, lastSeenAt: previousEnd } });
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(4);
    const assertMarkers = async () => {
        await expect(page.locator('#photosGrid .gallery-new-badge')).toHaveCount(2);
        await expect(page.locator('.gallery-card[data-media-id="img_e2e_3"] .gallery-new-badge')).toHaveText('חדש');
        await expect(page.locator('.gallery-card[data-media-id="img_e2e_4"] .gallery-media')).toHaveAttribute('aria-label', 'פתיחת מפגש חדש (חדש)');
        await expect(page.locator('.gallery-card[data-media-id="img_e2e_1"] .gallery-new-badge')).toHaveCount(0);
        await expect(page.locator('.gallery-card[data-media-id="img_e2e_1"] .gallery-media')).toHaveAttribute('aria-label', 'פתיחת תמונה 1');
        // התיקיות: רק אלה שנוסף בהן דבר, ו"כל הארכיון".
        await expect(folderCard(page, 'טיולים וסיורים').locator('.new-since-badge')).toHaveText('חדש');
        await expect(folderCard(page, 'הווי ומפגשים').locator('.new-since-badge')).toHaveCount(1);
        await expect(folderCard(page, 'כל הארכיון').locator('.new-since-badge')).toHaveCount(1);
        await expect(folderCard(page, 'אירועים ופעילויות').locator('.new-since-badge')).toHaveCount(0);
        await expect(folderCard(page, 'כללי').locator('.new-since-badge')).toHaveCount(0);
    };
    await assertMarkers();

    // הבאנר הקיים מספר על אותם פריטים, ו"צפה עכשיו" מציג בדיוק אותם.
    const banner = page.locator('#newUpdatesBanner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#newUpdatesBannerText')).toHaveText('נוספו 2 פריטים מאז הביקור הקודם שלך.');

    // נקודת הייחוס נקבעה פעם אחת: סוף הביקור הקודם.
    expect((await readVisit(page)).previousVisit).toBe(previousEnd);

    // רענון באמצע הביקור: התגים אינם נעלמים.
    await page.reload();
    await expect(cards).toHaveCount(4);
    await assertMarkers();
    const visit = await readVisit(page);
    expect(visit.previousVisit).toBe(previousEnd);
    expect(visit.lastSeenAt).toBeGreaterThanOrEqual(now);

    await banner.getByRole('button', { name: 'צפה עכשיו' }).click();
    await expect(banner).toBeHidden();
    await expect(page.locator('#tempSearchBanner')).toContainText('מה שנוסף מאז הביקור הקודם שלך');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#photosGrid .gallery-new-badge')).toHaveCount(2);
});

// 125 תמונות חדשות בתיקייה הראשונה ממלאות את העמוד הראשון של "כל הארכיון",
// ולכן מהתיקייה השנייה עוד לא נטען דבר.
function previewGallery(now) {
    const recent = Array.from({ length: 125 }, (_, index) => imageRecord(index + 1, {
        createdAt: now - (index + 1) * 60_000,
        folderId: '1',
        variants: variantEntries(`img_e2e_${index + 1}`, ['thumb']),
        variantsVersion: 1
    }));
    const trip = [201, 202, 203].map((index, offset) => imageRecord(index, {
        createdAt: now - (10 + offset) * HOUR,
        folderId: '2',
        title: `טיול ${offset + 1}`,
        variants: variantEntries(`img_e2e_${index}`, ['thumb']),
        variantsVersion: 1
    }));
    return [...recent, ...trip];
}

test('ריחוף על תיקייה מציג את התמונות האחרונות שבה, ורק היא מתבקשת מהרשת', async ({ page, worker }) => {
    const now = Date.now();
    worker.seedFolders().seedImages(previewGallery(now));
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 128 פריטים');
    await page.waitForLoadState('networkidle');

    // עד הריחוף שום תיקייה אינה מבוקשת לבדה.
    expect(folderRequests(worker, '2')).toHaveLength(0);
    const trip = folderCard(page, 'טיולים וסיורים');
    await trip.locator('.collection-card-main').hover();
    await expect(trip).toHaveClass(/is-previewing/);
    const frames = trip.locator('.folder-preview img');
    await expect(frames).toHaveCount(3);
    await expect(trip.locator('.folder-preview')).toHaveAttribute('aria-hidden', 'true');
    // מהחדשה לישנה, מהתצוגה הקטנה.
    await expect(frames.nth(0)).toHaveAttribute('src', variantUrl('img_e2e_201', 'thumb'));
    await expect(frames.nth(0)).toHaveClass(/is-current/);
    expect(folderRequests(worker, '2')).toHaveLength(1);
    // התמונות מתחלפות.
    await expect(frames.nth(1)).toHaveClass(/is-current/, { timeout: 3000 });
    await expect(frames.nth(0)).not.toHaveClass(/is-current/);

    // יציאה מחזירה את הסמל.
    await page.mouse.move(2, 2);
    await expect(trip).not.toHaveClass(/is-previewing/);
    await expect(trip.locator('.folder-preview')).toHaveCount(0);

    // ריחוף נוסף, ולחיצה על התיקייה, משתמשים בעמוד שכבר נטען.
    await trip.locator('.collection-card-main').hover();
    await expect(trip.locator('.folder-preview img')).toHaveCount(3);
    await trip.locator('.collection-card-main').click();
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    expect(folderRequests(worker, '2')).toHaveLength(1);
    // תיקייה שלא ריחפו עליה לא התבקשה.
    expect(folderRequests(worker, '1')).toHaveLength(0);
});

test('מיקוד מהמקלדת מציג תצוגה מקדימה, ועם הפחתת תנועה התמונה אינה מתחלפת', async ({ page, worker }) => {
    const now = Date.now();
    worker.seedFolders().seedImages(previewGallery(now));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 128 פריטים');

    // מ"כל הארכיון" במקלדת אל התיקייה הראשונה, שתמונותיה כבר בזיכרון.
    await folderCard(page, 'כל הארכיון').locator('.collection-card-main').focus();
    await page.keyboard.press('Tab');
    const events = folderCard(page, 'אירועים ופעילויות');
    await expect(events.locator('.collection-card-main')).toBeFocused();
    await expect(events).toHaveClass(/is-previewing/);
    const frames = events.locator('.folder-preview img');
    await expect(frames).toHaveCount(4);
    await expect(frames.nth(0)).toHaveAttribute('src', variantUrl('img_e2e_1', 'thumb'));
    await page.waitForTimeout(1600);
    await expect(frames.nth(0)).toHaveClass(/is-current/);
    await expect(events.locator('.folder-preview img.is-current')).toHaveCount(1);
    expect(folderRequests(worker, '1')).toHaveLength(0);

    // יציאה במקלדת מסירה את התצוגה.
    await page.keyboard.press('Shift+Tab');
    await expect(events).not.toHaveClass(/is-previewing/);
});

test('במכשיר בלי ריחוף אין תצוגה מקדימה ואין בקשה לרשת', async ({ page, worker }) => {
    const now = Date.now();
    worker.seedFolders().seedImages(previewGallery(now));
    // מכשיר מגע: (any-hover: hover) ו-(any-pointer: fine) אינם מתקיימים.
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = mediaQuery => (/any-hover|any-pointer/.test(mediaQuery)
            ? { matches: false, media: mediaQuery, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
            : original(mediaQuery));
    });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#imageCounter')).toHaveText('120 מתוך 128 פריטים');

    const trip = folderCard(page, 'טיולים וסיורים');
    await trip.locator('.collection-card-main').hover();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(600);
    await expect(page.locator('#folderList .is-previewing')).toHaveCount(0);
    await expect(page.locator('#folderList .folder-preview')).toHaveCount(0);
    expect(folderRequests(worker, '2')).toHaveLength(0);
});
