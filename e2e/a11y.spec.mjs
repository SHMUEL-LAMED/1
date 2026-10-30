// נגישות בדפדפן אמיתי, בלי ספרייה נוספת: בדיקות ממוקדות במקום סריקה כללית.
// לכל כפתור גלוי יש שם נגיש (גם כפתור של אייקון בלבד); לכל חלון יש aria-modal
// ותווית; אין tabindex חיובי שמשבש את סדר ה-Tab; והפוקוס חוזר למי שפתח את
// התצוגה המלאה, עמוד האירוע, חלון ההעלאה וחלון הקיצורים — ב-Escape ובכפתור
// הסגירה. ובנוסף: הטקסט החלופי של התמונות (media-alt.js) בכרטיס ובתצוגה המלאה.
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

const cards = page => page.locator('#photosGrid .gallery-card');

async function openGallery(page, worker, { count = 3, role = 'viewer' } = {}) {
    worker.seedGallery({ images: count });
    await seedSession(page, { worker, role });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(count);
    // הכפתורים נבנים אחרי ההתחברות (פרופיל, סרגל הכלים); מחכים שהכול יתייצב.
    await page.waitForLoadState('networkidle');
}

// lucide מוחלף בבדיקות בתחליף שאינו מצייר דבר, ולכן כפתור של אייקון בלבד
// מופיע כאן בדיוק כמו שקורא מסך רואה אותו באתר: בלי שם, אלא אם יש לו
// aria-label, title או טקסט. ה-aria snapshot כולל רק מה שבעץ הנגישות (לא
// מוסתר, לא inert), ושורת "- button" בלי מירכאות היא כפתור בלי שם.
async function unnamedButtons(scope) {
    const snapshot = await scope.ariaSnapshot();
    return snapshot.split('\n')
        .map((line, index, lines) => ({ line, context: lines.slice(Math.max(0, index - 2), index + 3).join('\n') }))
        .filter(({ line }) => /^\s*- (button|link|checkbox|radio|switch|combobox|textbox|menuitem|tab)(?: \[[^\]]*\])*:?\s*$/.test(line))
        .map(({ context }) => context);
}

async function expectNamedControls(scope, label) {
    expect(await unnamedButtons(scope), `פקדים בלי שם נגיש: ${label}`).toEqual([]);
}

// כל חלון בדף: aria-modal מפורש ותווית (aria-label, או aria-labelledby שמפנה
// לאלמנט קיים). חלון פתוח — גם שם נגיש שאינו ריק בפועל.
async function dialogProblems(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).flatMap(node => {
        const problems = [];
        const id = node.id || node.className;
        if (!['true', 'false'].includes(node.getAttribute('aria-modal'))) problems.push(`${id}: חסר aria-modal`);
        const label = (node.getAttribute('aria-label') || '').trim();
        const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        if (!label && !labelledBy.length) problems.push(`${id}: אין תווית`);
        for (const ref of labelledBy) if (!document.getElementById(ref)) problems.push(`${id}: aria-labelledby="${ref}" אינו קיים`);
        return problems;
    }));
}

async function expectDialogsLabelled(page) {
    expect(await dialogProblems(page)).toEqual([]);
    const open = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
    for (let index = 0; index < await open.count(); index += 1) {
        await expect(open.nth(index)).toHaveAccessibleName(/\S/);
    }
}

// tabindex חיובי מוציא אלמנט מסדר הקריאה ומקדים אותו לכל השאר — ב-RTL זה
// מבלבל במיוחד. מותר רק 0 ו--1.
function positiveTabindex(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('[tabindex]'))
        .filter(node => Number(node.getAttribute('tabindex')) > 0)
        .map(node => node.outerHTML.slice(0, 120)));
}

test('כל כפתור גלוי בגלריה, בתצוגה המלאה ובחלונות נושא שם נגיש, ואין tabindex חיובי', async ({ page, worker }) => {
    await openGallery(page, worker, { role: 'uploader' });
    await expectNamedControls(page.locator('body'), 'הגלריה');
    expect(await positiveTabindex(page)).toEqual([]);
    await expectDialogsLabelled(page);

    // התצוגה המלאה.
    await cards(page).first().locator('.gallery-media').click();
    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toBeVisible();
    await expectNamedControls(lightbox, 'התצוגה המלאה');
    await expectDialogsLabelled(page);
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();

    // עמוד האירוע.
    await page.locator('[data-event-folder="1"]').click();
    const eventPage = page.locator('#eventPageModal');
    await expect(eventPage).toBeVisible();
    await expectNamedControls(eventPage, 'עמוד האירוע');
    await expectDialogsLabelled(page);
    await page.keyboard.press('Escape');
    await expect(eventPage).toBeHidden();

    // האזור האישי וחלון ההעלאה.
    await page.locator('.settings-trigger').click();
    const drawer = page.locator('#adminDrawer');
    await expect(drawer).not.toHaveAttribute('inert', '');
    await expectNamedControls(drawer, 'האזור האישי');
    await drawer.getByRole('button', { name: 'העלה מדיה' }).click();
    const upload = page.locator('#userUploadModal');
    await expect(upload).toBeVisible();
    await expectNamedControls(upload, 'חלון ההעלאה');
    await expectDialogsLabelled(page);
    await page.keyboard.press('Escape');
    await expect(upload).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveAttribute('inert', '');

    // חלון הקיצורים.
    await page.getByRole('button', { name: 'קיצורי מקלדת' }).click();
    const help = page.locator('#shortcutsHelpModal');
    await expect(help).toBeVisible();
    await expectNamedControls(help, 'חלון הקיצורים');
    await expectDialogsLabelled(page);
    expect(await positiveTabindex(page)).toEqual([]);
});

test.describe('ברוחב של טלפון', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('גם ברוחב צר כל כפתור גלוי נושא שם נגיש', async ({ page, worker }) => {
        await openGallery(page, worker);
        await expectNamedControls(page.locator('body'), 'הגלריה בטלפון');
        await cards(page).first().locator('.gallery-media').click();
        const lightbox = page.locator('#lightboxModal');
        await expect(lightbox).toBeVisible();
        await expectNamedControls(lightbox, 'התצוגה המלאה בטלפון');
    });
});

// הפוקוס חוזר למי שפתח: ב-Escape ובכפתור הסגירה של כל חלון.
test.describe('הפוקוס חוזר אחרי סגירה', () => {
    test('התצוגה המלאה: אל הכרטיס שנפתח', async ({ page, worker }) => {
        await openGallery(page, worker);
        const opener = cards(page).nth(1).locator('.gallery-media');
        const lightbox = page.locator('#lightboxModal');
        for (const close of [
            () => page.keyboard.press('Escape'),
            () => lightbox.getByRole('button', { name: 'סגירת התצוגה המלאה' }).click()
        ]) {
            await opener.focus();
            await page.keyboard.press('Enter');
            await expect(lightbox).toBeVisible();
            await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#lightboxModal')))).toBe(true);
            await close();
            await expect(lightbox).toBeHidden();
            await expect(opener).toBeFocused();
        }
    });

    test('עמוד האירוע: אל הכפתור שפתח אותו', async ({ page, worker }) => {
        await openGallery(page, worker);
        const opener = page.locator('[data-event-folder="1"]');
        const eventPage = page.locator('#eventPageModal');
        // כפתור הסגירה שמעל תמונת השער אינו בכותרת חלון, ובלי הסגנון של
        // .modal-close היה רק האייקון — וכאן, בלי האייקון, בגודל אפס.
        await opener.click();
        const closeBox = await eventPage.getByRole('button', { name: 'סגירת עמוד האירוע' }).boundingBox();
        expect(closeBox.width).toBeGreaterThanOrEqual(24);
        expect(closeBox.height).toBeGreaterThanOrEqual(24);
        await page.keyboard.press('Escape');
        await expect(eventPage).toBeHidden();
        for (const close of [
            () => page.keyboard.press('Escape'),
            () => eventPage.getByRole('button', { name: 'סגירת עמוד האירוע' }).click()
        ]) {
            await opener.click();
            await expect(eventPage).toBeVisible();
            await expect(eventPage.getByRole('button', { name: 'סגירת עמוד האירוע' })).toBeFocused();
            await close();
            await expect(eventPage).toBeHidden();
            await expect(opener).toBeFocused();
        }
    });

    test('חלון ההעלאה: אל "העלה מדיה" שבאזור האישי, ואחריו אל כפתור האזור', async ({ page, worker }) => {
        await openGallery(page, worker, { role: 'uploader' });
        const trigger = page.locator('.settings-trigger');
        const drawer = page.locator('#adminDrawer');
        const opener = drawer.getByRole('button', { name: 'העלה מדיה' });
        const upload = page.locator('#userUploadModal');
        await trigger.click();
        await expect(opener).toBeVisible();
        for (const close of [
            () => page.keyboard.press('Escape'),
            () => upload.getByRole('button', { name: 'סגירת חלון ההעלאה' }).click(),
            () => upload.getByRole('button', { name: 'ביטול', exact: true }).click()
        ]) {
            await opener.click();
            await expect(upload).toBeVisible();
            await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('#userUploadModal')))).toBe(true);
            await close();
            await expect(upload).toBeHidden();
            await expect(opener).toBeFocused();
        }
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveAttribute('inert', '');
        await expect(trigger).toBeFocused();
    });

    test('חלון הקיצורים: אל הכפתור שבסרגל, וב-"?" אל מה שהיה בפוקוס', async ({ page, worker }) => {
        await openGallery(page, worker);
        const button = page.getByRole('button', { name: 'קיצורי מקלדת' });
        const help = page.locator('#shortcutsHelpModal');
        for (const close of [
            () => page.keyboard.press('Escape'),
            () => help.getByRole('button', { name: 'סגירת רשימת הקיצורים' }).click()
        ]) {
            await button.click();
            await expect(help).toBeVisible();
            await close();
            await expect(help).toBeHidden();
            await expect(button).toBeFocused();
        }
        // ב-"?" מהמקלדת, כשהפוקוס על כרטיס: חוזרים לכרטיס.
        const card = cards(page).first().locator('.gallery-media');
        await card.focus();
        await page.keyboard.press('Shift+?');
        await expect(help).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(help).toBeHidden();
        await expect(card).toBeFocused();
    });
});

// הטקסט החלופי: הכיתוב, אחרת השם, אחרת "תמונה שצולמה ב…" עם התאריך העברי.
test('הטקסט החלופי של תמונה: הכיתוב, אחרת השם, ובלי שניהם התאריך העברי', async ({ page, worker }) => {
    // 28.09.2026 הוא י״ז בתשרי תשפ״ז.
    const takenAt = Date.UTC(2026, 8, 28, 9);
    worker.seedFolders().seedImages([
        imageRecord(1, { caption: 'ריקוד במעגל סביב הבימה', title: 'IMG_2041.jpg' }),
        imageRecord(2, { title: 'שם עם "מירכאות" & <סוגריים>' }),
        imageRecord(3, { title: '', takenAt, takenDate: '2026-09-28', takenAtSource: 'exif' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(cards(page)).toHaveCount(3);

    const cardImage = id => page.locator(`.gallery-card[data-media-id="${id}"] img.gallery-card-img`);
    await expect(cardImage('img_e2e_1')).toHaveAttribute('alt', 'ריקוד במעגל סביב הבימה');
    // השם מוברח במרקאפ, ולכן המירכאות אינן שוברות את התכונה.
    await expect(cardImage('img_e2e_2')).toHaveAttribute('alt', 'שם עם "מירכאות" & <סוגריים>');
    await expect(cardImage('img_e2e_3')).toHaveAttribute('alt', 'תמונה שצולמה בי״ז בתשרי תשפ״ז');
    // הכותרת שבכרטיס נשארת כמו שהייתה.
    await expect(page.locator('.gallery-card[data-media-id="img_e2e_3"] .gallery-title')).toHaveText('תמונה ללא שם');
    // ה-aria-label של כפתור התמונה גובר על ה-alt שבתוכו: גם הוא מהכיתוב, מהשם
    // או מהתאריך, אחרת קורא מסך לא היה שומע את הכיתוב ברשת.
    const cardButton = id => page.locator(`.gallery-card[data-media-id="${id}"] .gallery-media`);
    await expect(cardButton('img_e2e_1')).toHaveAccessibleName('פתיחת ריקוד במעגל סביב הבימה');
    await expect(cardButton('img_e2e_2')).toHaveAccessibleName('פתיחת שם עם "מירכאות" & <סוגריים>');
    await expect(cardButton('img_e2e_3')).toHaveAccessibleName('פתיחת תמונה שצולמה בי״ז בתשרי תשפ״ז');

    const lightboxImage = page.locator('#lightboxImage');
    await page.locator('.gallery-card[data-media-id="img_e2e_1"] .gallery-media').click();
    await expect(lightboxImage).toHaveAttribute('alt', 'ריקוד במעגל סביב הבימה');
    await page.keyboard.press('Escape');
    await page.locator('.gallery-card[data-media-id="img_e2e_3"] .gallery-media').click();
    await expect(lightboxImage).toHaveAttribute('alt', 'תמונה שצולמה בי״ז בתשרי תשפ״ז');
    await page.keyboard.press('Escape');
    await page.locator('.gallery-card[data-media-id="img_e2e_2"] .gallery-media').click();
    await expect(lightboxImage).toHaveAttribute('alt', 'שם עם "מירכאות" & <סוגריים>');
});
