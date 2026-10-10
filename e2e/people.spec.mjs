// אנשים בגלריה: רשימת האנשים, האלבום של אדם (#person/<id>), "התמונות שלי"
// וניהול השמות בלוח הניהול — בדפדפן אמיתי, מול הזיוף של ה-Worker.
import { test, expect, seedSession, signInViaGoogle, imageRecord, variantEntries, API_ORIGIN, DEFAULT_USER } from './fixtures.mjs';

const BOX = { x: 0.25, y: 0.2, w: 0.3, h: 0.4, a: 1.5 };

// ארבע תמונות; "יוסי כהן" מופיע בשתיים מהן (3 ו-1), והאלבום ממוין מהחדש לישן.
function seedPeopleGallery(worker) {
    worker.seedFolders();
    const records = [1, 2, 3, 4].map(index => imageRecord(index, { variants: variantEntries(`img_e2e_${index}`) }));
    worker.seedImages(records);
    worker.seedPerson({
        personId: 'fp_yossi',
        name: 'יוסי כהן',
        status: 'approved',
        faces: [{ imageId: 'img_e2e_1', box: BOX }, { imageId: 'img_e2e_3', box: BOX }]
    });
    worker.seedPerson({ personId: 'fp_moshe', name: 'משה לוי', status: 'approved', faces: [{ imageId: 'img_e2e_2', box: BOX }] });
    // קבוצה שלא אושרה ואדם מוסתר אינם מופיעים לצופה.
    worker.seedPerson({ personId: 'fp_pending', faces: [{ imageId: 'img_e2e_4' }, { imageId: 'img_e2e_2', faceIndex: 1 }] });
    worker.seedPerson({ personId: 'fp_hidden', name: 'מוסתר', status: 'approved', hidden: true, faces: [{ imageId: 'img_e2e_4', faceIndex: 2 }] });
    return records;
}

async function expectNoHorizontalScroll(page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('רשימת האנשים מציגה רק אנשים מאושרים עם שם, ולחיצה פותחת את האלבום שלהם', async ({ page, worker }) => {
        seedPeopleGallery(worker);
        await seedSession(page, { worker });
        await page.goto('/');
        const cards = page.locator('#photosGrid .gallery-card');
        await expect(cards).toHaveCount(4);

        await page.getByRole('button', { name: 'אנשים', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'אנשים בגלריה' });
        await expect(dialog).toBeVisible();
        const people = dialog.locator('.person-card');
        await expect(people).toHaveCount(2);
        await expect(people.first()).toContainText('יוסי כהן');
        await expect(people.first()).toContainText('2 תמונות');
        await expect(dialog.locator('#peopleDirectoryStatus')).toContainText('2 אנשים');
        // הפרצוף נחתך מהתמונה הקטנה, לפי המיקום השמור.
        const crop = people.first().locator('.face-crop img.is-cropped');
        await expect(crop).toHaveAttribute('src', /\/media\/variants\/img_e2e_\d\/thumb\.webp$/);
        await expectNoHorizontalScroll(page);

        // חיפוש לפי שם מסנן את הרשימה.
        await dialog.getByRole('searchbox', { name: 'חיפוש אדם לפי שם' }).fill('משה');
        await expect(people).toHaveCount(1);
        await expect(people.first()).toContainText('משה לוי');
        await dialog.getByRole('searchbox', { name: 'חיפוש אדם לפי שם' }).fill('');
        await expect(people).toHaveCount(2);

        await people.filter({ hasText: 'יוסי כהן' }).click();
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(/#person\/fp_yossi$/);
        await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של יוסי כהן');
        await expect(page.locator('#peopleAlbumTitle')).toBeFocused();
        await expect(cards).toHaveCount(2);
        await expect(cards.locator('.gallery-title')).toHaveText(['תמונה 3', 'תמונה 1']);
        await expectNoHorizontalScroll(page);

        // "חזור" של הדפדפן מחזיר לגלריה המלאה.
        await page.goBack();
        await expect(page.locator('#tempSearchBanner')).toBeHidden();
        await expect(cards).toHaveCount(4);
    });

    test('"התמונות שלי" לפי תמונת הפרופיל: רק טביעה נשלחת, ובלי "זכור אותי" שום דבר אינו נשמר', async ({ page, worker }) => {
        seedPeopleGallery(worker);
        worker.people.matches = [{ imageId: 'img_e2e_2', distance: 0.21 }, { imageId: 'img_e2e_4', distance: 0.3 }];
        await seedSession(page, { worker, picture: `${API_ORIGIN}/media/profiles/${DEFAULT_USER.uid}.png` });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);

        await page.getByRole('button', { name: 'התמונות שלי', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'התמונות שלי' });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#findMePrivacyNote')).toContainText('לשרת נשלחת רק טביעה מספרית של הפנים');
        await expect(dialog.getByRole('checkbox', { name: /זכור אותי/ })).not.toBeChecked();
        await expectNoHorizontalScroll(page);

        await dialog.getByRole('button', { name: /לפי תמונת הפרופיל/ }).click();
        await expect(dialog).toBeHidden();
        await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות שלי');
        // הגלריה מציגה את התוצאות לפי המיון שנבחר בה (החדש ביותר ראשון).
        await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['תמונה 4', 'תמונה 2']);

        const searches = worker.requestsTo('POST', '/face/search');
        expect(searches).toHaveLength(1);
        const body = JSON.parse(searches[0].body);
        expect(Object.keys(body).sort()).toEqual(['descriptor', 'limit', 'modelVersion']);
        expect(body.descriptor).toHaveLength(128);
        expect(worker.requestsTo('PUT', '/face/me')).toHaveLength(0);
        expect(worker.people.me.size).toBe(0);
    });

    test('תמונת פרופיל חסומה מובילה לסלפי מקומי; "זכור אותי" שומר, ו"שכח אותי" מוחק', async ({ page, worker }) => {
        seedPeopleGallery(worker);
        worker.people.matches = [{ imageId: 'img_e2e_3', distance: 0.25 }];
        // תמונה של Google שאינה נגישה מהבדיקה — כמו תמונת פרופיל בלי CORS.
        await seedSession(page, { worker, picture: 'https://lh3.googleusercontent.com/a/blocked=s96-c' });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);

        await page.getByRole('button', { name: 'התמונות שלי', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'התמונות שלי' });
        await dialog.getByRole('checkbox', { name: /זכור אותי/ }).check();
        await dialog.getByRole('button', { name: /לפי תמונת הפרופיל/ }).click();
        await expect(dialog.locator('#findMeStatus')).toContainText('בחר סלפי');
        await expect(dialog.locator('#findMeSelfie')).toBeVisible();
        expect(worker.requestsTo('POST', '/face/search')).toHaveLength(0);

        const selfie = worker.media;
        await dialog.locator('#findMeSelfieInput').setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: selfie });
        await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות שלי');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);

        // הסלפי לא נשלח לשום מקום: אין העלאה, ובכל בקשה עם תוכן יש רק JSON קטן.
        expect(worker.requestsTo('POST', '/upload')).toHaveLength(0);
        for (const entry of worker.requests.filter(item => item.body)) {
            expect(() => JSON.parse(entry.body)).not.toThrow();
            expect(entry.body).not.toContain('PNG');
        }
        const saved = worker.requestsTo('PUT', '/face/me');
        expect(saved).toHaveLength(1);
        expect(JSON.parse(saved[0].body).consent).toBe(true);
        expect(worker.people.me.has(DEFAULT_USER.uid)).toBe(true);

        // בפתיחה הבאה: הטביעה השמורה, ו"שכח אותי" מוחק אותה.
        await page.getByRole('button', { name: 'התמונות שלי', exact: true }).click();
        await expect(dialog.locator('#findMeSaved')).toBeVisible();
        await dialog.getByRole('button', { name: 'שכח אותי' }).click();
        await expect(dialog.locator('#findMeStatus')).toHaveText('טביעת הפנים שלך נמחקה מהשרת.');
        await expect(dialog.locator('#findMeSaved')).toBeHidden();
        expect(worker.people.me.size).toBe(0);
    });
});

test('התנתקות סוגרת את האלבום של אדם: השם והפנים אינם נשארים מול מבקר שאינו מחובר', async ({ page, worker }) => {
    seedPeopleGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/#person/fp_yossi');
    const banner = page.locator('#tempSearchBanner');
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של יוסי כהן');
    await expect(banner.locator('.face-crop img')).toBeVisible();

    await page.evaluate(() => window.signOutGoogleAccount(true));
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(banner).toBeHidden();
    await expect(banner).toBeEmpty();
    await expect(page.getByText('יוסי כהן')).toHaveCount(0);
    await expect(page).not.toHaveURL(/#person\//);
    expect(await page.evaluate(() => window.state.tempSearchResults)).toBeNull();
});

test('תוצאות "התמונות שלי" של משתמש אחד אינן מוצגות למשתמש הבא שמתחבר באותה לשונית', async ({ page, worker }) => {
    seedPeopleGallery(worker);
    worker.people.matches = [{ imageId: 'img_e2e_2', distance: 0.21 }];
    await seedSession(page, { worker, picture: `${API_ORIGIN}/media/profiles/${DEFAULT_USER.uid}.png` });
    await page.goto('/');
    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(4);
    await page.getByRole('button', { name: 'התמונות שלי', exact: true }).click();
    await page.getByRole('dialog', { name: 'התמונות שלי' }).getByRole('button', { name: /לפי תמונת הפרופיל/ }).click();
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות שלי');
    await expect(cards).toHaveCount(1);

    await page.evaluate(() => window.signOutGoogleAccount(true));
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    const second = { uid: 'google-user-2', email: 'second@example.com', name: 'משתמש שני' };
    worker.seedUser({ ...second, status: 'approved', role: 'viewer' });
    await signInViaGoogle(page, second);
    await expect(page.locator('#floatingUserPanelName')).toHaveText('משתמש שני');
    await expect(page.locator('body')).not.toHaveClass(/gallery-locked/);
    await expect(cards).toHaveCount(4);
    await expect(page.locator('#tempSearchBanner')).toBeHidden();
    await expect(page.locator('#peopleAlbumTitle')).toHaveCount(0);
});

test('קישור ישיר לאלבום של אדם נפתח כשהגלריה נטענת, ואדם שאינו מאושר אינו נפתח', async ({ page, worker }) => {
    seedPeopleGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/#person/fp_moshe');
    await expect(page.locator('#peopleAlbumTitle')).toHaveText('התמונות של משה לוי');
    await expect(page.locator('#photosGrid .gallery-card .gallery-title')).toHaveText(['תמונה 2']);

    await page.goto('/#person/fp_pending');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(4);
    await expect(page.locator('#tempSearchBanner')).toBeHidden();
    await expect.poll(() => worker.requestsTo('GET', '/face/persons/fp_pending').length).toBe(1);
});

test('מנהל פותח קבוצה חדשה לפרצוף בודד; קבוצה של פרצוף אחד מופיעה בהצעות ומקבלת שם', async ({ page, worker }) => {
    seedPeopleGallery(worker);
    worker.seedSingle({ imageId: 'img_e2e_3', faceIndex: 1, box: BOX });
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="faceindex"]').click();

    await expect(page.locator('[data-people-count="singles"]')).toHaveText('1');
    await page.locator('[data-people-view="singles"]').click();
    await expect(page.locator('[data-people-view="singles"]')).toHaveAttribute('aria-pressed', 'true');
    const single = page.locator('#peopleAdminList .people-admin-member');
    await expect(single).toHaveCount(1);
    await expect(single.locator('.face-crop img.is-cropped')).toHaveCount(1);
    // ברוחב טלפון הכרטיס, הבחירה והכפתורים נכנסים בלי גלילה אופקית.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    const assignButton = single.getByRole('button', { name: 'שייך', exact: true });
    await assignButton.scrollIntoViewIfNeeded();
    await expect(assignButton).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('singles-390.png') });
    await single.getByRole('combobox', { name: 'שייך ל…' }).selectOption('__new__');
    await single.getByRole('button', { name: 'שייך', exact: true }).click();
    await expect(page.locator('#peopleAdminStatus')).toHaveText('נפתחה קבוצה חדשה. היא מופיעה בלשונית „הצעות”, ושם אפשר לתת לה שם.');
    await expect(page.locator('[data-people-count="singles"]')).toHaveText('0');
    await expect(page.locator('[data-people-count="suggested"]')).toHaveText('2');

    await page.locator('[data-people-view="suggested"]').click();
    const fresh = page.locator('#peopleAdminList .people-admin-card')
        .filter({ has: page.locator('.people-admin-meta', { hasText: /^פרצוף אחד · / }) });
    await expect(fresh).toHaveCount(1);
    await fresh.getByRole('textbox', { name: 'שם' }).fill('שלמה');
    await fresh.getByRole('button', { name: 'אשר ושמור שם' }).click();
    await expect(page.locator('#peopleAdminStatus')).toHaveText('„שלמה” אושר ונוסף לרשימת האנשים בגלריה.');
    const approved = [...worker.people.persons.values()].find(person => person.name === 'שלמה');
    expect(approved).toMatchObject({ status: 'approved' });
    expect(approved.faces.map(face => `${face.imageId}:${face.faceIndex}`)).toEqual(['img_e2e_3:1']);
});

test('מנהל מאשר קבוצה מוצעת עם שם, מכריע בפרצוף לבדיקה, והאדם מופיע ברשימת האנשים', async ({ page, worker }) => {
    seedPeopleGallery(worker);
    worker.people.unclustered = 3;
    // פרצוף שהקיבוץ לא היה בטוח לגביו, ומוצג לצד יוסי כהן.
    worker.seedReview({ imageId: 'img_e2e_4', faceIndex: 3, box: BOX, candidateId: 'fp_yossi' });
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/admin.html');
    await page.locator('#adminNav [data-view-target="faceindex"]').click();

    // פתיחת המסך מקבצת מיד פרצופים שעוד לא קובצו.
    await expect(page.locator('#peopleClusterStatus')).toContainText('הקיבוץ הושלם: 3 פרצופים');
    expect(worker.people.clusterRuns).toBe(1);

    const list = page.locator('#peopleAdminList');
    const suggestion = list.locator('.people-admin-card');
    await expect(suggestion).toHaveCount(1);
    await expect(suggestion).toContainText('2 פרצופים');
    // לפרצופים בלי מיקום שמור הדפדפן מאתר מיקום, שולח אותו, ומצייר את החיתוך.
    await expect(suggestion.locator('.people-admin-faces img.is-cropped')).toHaveCount(2);
    expect([...new Set(worker.people.boxes.map(box => `${box.imageId}:${box.faceIndex}`))].sort()).toEqual(['img_e2e_2:1', 'img_e2e_4:0']);

    await suggestion.getByRole('textbox', { name: 'שם' }).fill('אברהם');
    await suggestion.getByRole('button', { name: 'אשר ושמור שם' }).click();
    await expect(page.locator('#peopleAdminStatus')).toHaveText('„אברהם” אושר ונוסף לרשימת האנשים בגלריה.');
    await expect(page.locator('[data-people-count="approved"]')).toHaveText('3');
    expect(worker.people.persons.get('fp_pending')).toMatchObject({ name: 'אברהם', status: 'approved' });

    await page.locator('[data-people-view="review"]').click();
    await expect(page.locator('[data-people-view="review"]')).toHaveAttribute('aria-pressed', 'true');
    const review = list.locator('.people-admin-review');
    await expect(review).toContainText('האם זה יוסי כהן?');
    await review.getByRole('button', { name: 'כן, זה הוא' }).click();
    await expect(page.locator('#peopleAdminStatus')).toHaveText('הפרצוף שויך.');
    await expect(page.locator('[data-people-count="review"]')).toHaveText('0');
    expect(worker.people.persons.get('fp_yossi').faces).toHaveLength(3);

    // האדם שאושר מופיע עכשיו גם לצופי הגלריה.
    await page.goto('/');
    await page.getByRole('button', { name: 'אנשים', exact: true }).click();
    await expect(page.locator('#peopleDirectoryList .person-card')).toHaveCount(3);
    await expect(page.locator('#peopleDirectoryList')).toContainText('אברהם');
});
