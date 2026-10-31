// משתמשים ואנשים מקצה לקצה: "ההעלאות שלי" וההודעה על אישורים, זיהוי כפילויות
// בתור ההעלאה, סיבת דחייה (גם במצב המהיר), תיוג ידני של אדם מהתצוגה המלאה,
// והזמנה לאירוע — יצירה בלוח הניהול, ומימוש אחרי התחברות.
import {
    test, expect, seedSession, signInViaGoogle, makePng, imageRecord, variantEntries, pendingRecord, DEFAULT_USER, DAY_MS
} from './fixtures.mjs';
import { createHash } from 'node:crypto';

const BOX = { x: 0.25, y: 0.2, w: 0.3, h: 0.4, a: 1.5 };
const TOKEN = 'T'.repeat(20) + '_-' + 'k'.repeat(21);

async function expectNoHorizontalScroll(page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
}

function seedMyUploads(worker) {
    worker.seedFolders();
    const now = Date.now();
    // אושר מהתור לפני שעה — אל תיקיית "אירועים ופעילויות".
    worker.seed('pendingImages', 'mine_ok', { id: 'mine_ok', title: 'הקפה שנייה', status: 'approved', approvedAt: now - 60 * 60 * 1000, uploadedBy: DEFAULT_USER.uid, createdAt: now - DAY_MS });
    worker.seed('images', 'mine_ok', { ...imageRecord(7), id: 'mine_ok', title: 'הקפה שנייה', folderId: '1', uploadedBy: DEFAULT_USER.uid });
    worker.seed('pendingImages', 'mine_wait', { id: 'mine_wait', title: 'ממתינה לאישור', status: 'pending', uploadedBy: DEFAULT_USER.uid, createdAt: now - 1000 });
    worker.seed('pendingImages', 'mine_no', { id: 'mine_no', title: 'נדחתה <b>מודגש</b>', status: 'pending', uploadedBy: DEFAULT_USER.uid, createdAt: now - 2 * DAY_MS });
    worker.users.rejections.set('mine_no', { uploader: DEFAULT_USER.uid, title: 'נדחתה <b>מודגש</b>', reason: '<img src=x onerror=alert(1)> מטושטש', rejectedBy: 'admin', rejectedAt: now - 3000 });
    // של משתמש אחר — לעולם אינו מופיע.
    worker.seed('pendingImages', 'theirs', { id: 'theirs', title: 'של מישהו אחר', status: 'pending', uploadedBy: 'google-other' });
}

test.describe('בטלפון (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('ההעלאות שלי: ממתין, אושר (עם התיקייה) ונדחה (עם הסיבה כטקסט), והודעה על אישור חדש', async ({ page, worker }) => {
        seedMyUploads(worker);
        await seedSession(page, { worker, role: 'viewer' });
        await page.goto('/');
        // ההודעה על האישור מגיעה מעצמה, אחרי שהגלריה נפתחה.
        await expect(page.locator('#customAlertMessage')).toContainText('אחת מההעלאות שלך אושרה', { timeout: 15000 });

        await page.locator('.settings-trigger').click();
        await page.locator('#adminDrawer').getByRole('button', { name: 'ההעלאות שלי' }).click();
        const dialog = page.getByRole('dialog', { name: 'ההעלאות שלי' });
        await expect(dialog).toBeVisible();
        const rows = dialog.locator('.my-upload-row');
        await expect(rows).toHaveCount(3);
        await expect(dialog.locator('#myUploadsSummary')).toHaveText('1 ממתינים לאישור · 1 אושרו · 1 נדחו');
        const approved = rows.filter({ has: page.locator('[data-status="approved"]') });
        await expect(approved).toContainText('בתיקייה: אירועים ופעילויות');
        await expect(approved.getByRole('link', { name: /הצגת הקפה שנייה בגלריה/ })).toHaveAttribute('href', '#media/mine_ok');
        const rejected = rows.filter({ has: page.locator('.my-upload-chip[data-status="rejected"]') });
        // שם וסיבה מוצגים כטקסט, לא כ-HTML.
        await expect(rejected).toContainText('נדחתה <b>מודגש</b>');
        await expect(rejected).toContainText('הסיבה: <img src=x onerror=alert(1)> מטושטש');
        await expect(dialog.locator('img[src="x"]')).toHaveCount(0);
        await expect(dialog).not.toContainText('של מישהו אחר');
        await expectNoHorizontalScroll(page);

        await dialog.getByRole('button', { name: 'נדחה' }).click();
        await expect(dialog.getByRole('button', { name: 'נדחה' })).toHaveAttribute('aria-pressed', 'true');
        await expect(rows).toHaveCount(1);

        // ההודעה אינה חוזרת בביקור הבא.
        await page.reload();
        await expect(page.locator('#photosGrid .gallery-card').first()).toBeVisible();
        await page.waitForTimeout(3500);
        await expect(page.locator('#customAlertMessage')).not.toContainText('מההעלאות שלך אושר');
    });
});

test('כפילויות: קובץ שכבר בגלריה מסומן בתור ומדולג, ו"העלה בכל זאת" מעלה אותו', async ({ page, worker }) => {
    worker.seedGallery();
    const duplicate = makePng(8, 8, [10, 20, 30]);
    const fresh = makePng(8, 8, [200, 100, 50]);
    const hash = createHash('sha256').update(duplicate).digest('hex');
    worker.seed('images', 'existing_img', { ...imageRecord(9), id: 'existing_img', contentHash: hash });
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.submitUserUpload === 'function' && Boolean(window.state?.currentUser?.uid) && window.state.folders?.length > 1);
    await page.evaluate(() => window.openModal('userUploadModal'));
    await page.locator('#userMultiFiles').setInputFiles([
        { name: 'כפול.png', mimeType: 'image/png', buffer: duplicate },
        { name: 'חדש.png', mimeType: 'image/png', buffer: fresh }
    ]);
    await page.locator('#userUploadSubmitBtn').click();
    await page.locator('#confirmApproveBtn').click();

    const queue = page.locator('#userUploadQueue');
    const duplicateRow = queue.locator('[data-upload-index="0"]');
    await expect(duplicateRow).toHaveAttribute('data-upload-state', 'duplicate');
    await expect(duplicateRow.locator('.upload-queue-status')).toHaveText('כבר קיים בגלריה');
    await expect(duplicateRow.getByRole('link', { name: 'הצג את הקיים' })).toHaveAttribute('href', './#media/existing_img');
    const proceed = queue.getByRole('button', { name: 'המשך בהעלאה' });
    await expect(proceed).toBeFocused();
    // הבדיקה מול השרת שלחה רק טביעות, לא קבצים.
    const checks = worker.requestsTo('POST', '/duplicates');
    expect(checks).toHaveLength(1);
    expect(JSON.parse(checks[0].body).hashes).toContain(hash);

    // ברירת המחדל: דילוג.
    await proceed.click();
    await expect(duplicateRow).toHaveAttribute('data-upload-state', 'cancelled');
    await expect(duplicateRow.locator('.upload-queue-status')).toHaveText('דולג — כבר קיים בגלריה');
    await expect(queue.locator('[data-upload-index="1"]')).toHaveAttribute('data-upload-state', 'success');
    await expect.poll(() => worker.collection('images').size).toBe(2);
    const saved = [...worker.collection('images').values()].find(record => record.title === 'חדש');
    expect(saved.contentHash).toBe(createHash('sha256').update(fresh).digest('hex'));
    expect(saved.duplicateLookup).toBeUndefined();

    // שוב, הפעם "העלה בכל זאת".
    await page.evaluate(() => window.openModal('userUploadModal'));
    await page.locator('#userMultiFiles').setInputFiles([{ name: 'כפול.png', mimeType: 'image/png', buffer: duplicate }]);
    await page.locator('#userUploadSubmitBtn').click();
    await page.locator('#confirmApproveBtn').click();
    const toggle = queue.getByRole('button', { name: 'העלה בכל זאת: כפול' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await queue.getByRole('button', { name: 'המשך בהעלאה' }).click();
    await expect.poll(() => worker.collection('images').size).toBe(3);
});

test('דחייה עם סיבה: במסך האישור ובמצב המהיר, רשות — והסיבה נשלחת לפני הדחייה', async ({ page, worker }) => {
    worker.seedFolders();
    for (const record of [pendingRecord(1), pendingRecord(2)]) worker.seed('pendingImages', record.id, record);
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await page.goto('/admin.html#pending');
    await expect(page.locator('#pendingList input[name="pendingImgCheck"]')).toHaveCount(2);

    // מצב מהיר: סיבה לדחייה הבאה, ואחריה השדה מתרוקן.
    await page.locator('#pendingSwipeOpenBtn').click();
    await expect(page.locator('#pendingSwipeCardTitle')).toHaveText('העלאה 2');
    await page.getByLabel('סיבה לדחייה (רשות)').fill('לא מהאירוע');
    await page.locator('#pendingSwipeReject').click();
    await expect(page.getByLabel('סיבה לדחייה (רשות)')).toHaveValue('');
    // החלון נסגר — ההחלטה נשלחת מיד.
    await page.locator('#pendingSwipe [data-swipe-close]').first().click();
    await expect.poll(() => worker.requestsTo('POST', '/pending/reject').length).toBe(1);
    expect(JSON.parse(worker.requestsTo('POST', '/pending/reject')[0].body)).toEqual({ imageId: 'pending_e2e_2', reason: 'לא מהאירוע' });
    await expect.poll(() => worker.users.rejections.get('pending_e2e_2')?.reason).toBe('לא מהאירוע');
    await expect.poll(() => worker.collection('pendingImages').has('pending_e2e_2')).toBe(false);

    // המסך הרגיל: בלי סיבה — עדיין עובד.
    await expect(page.locator('#pendingList input[name="pendingImgCheck"]')).toHaveCount(1);
    await page.locator('#rejectPendingBtn').click();
    await page.locator('#confirmApproveBtn').click();
    await expect.poll(() => worker.collection('pendingImages').has('pending_e2e_1')).toBe(false);
    expect(worker.users.rejections.get('pending_e2e_1')?.reason).toBe('');
});

test('תיוג ידני: מנהל מתייג אדם מהתצוגה המלאה, והאלבום מסמן את התמונה "תיוג ידני"', async ({ page, worker }) => {
    worker.seedFolders();
    worker.seedImages([1, 2, 3].map(index => imageRecord(index, { variants: variantEntries(`img_e2e_${index}`) })));
    worker.seedPerson({ personId: 'fp_dana', name: 'דנה לוי', status: 'approved', faces: [{ imageId: 'img_e2e_1', box: BOX }] });
    worker.seedPerson({ personId: 'fp_other', name: 'אבי', status: 'approved', faces: [{ imageId: 'img_e2e_2', box: BOX }] });
    await seedSession(page, { worker, role: 'admin', name: 'מנהל' });
    await page.goto('/#media/img_e2e_3');
    const lightbox = page.locator('#lightboxModal');
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole('button', { name: 'תיוג אדם בתמונה' }).click();
    const dialog = page.getByRole('dialog', { name: 'תיוג אדם בתמונה' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'חיפוש אדם לפי שם' }).fill('דנה');
    await expect(dialog.locator('.manual-tag-person')).toHaveCount(1);
    // מלבן סביב הפנים, בגרירה.
    const image = await dialog.locator('#manualTagImage').boundingBox();
    await page.mouse.move(image.x + image.width * 0.2, image.y + image.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(image.x + image.width * 0.6, image.y + image.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect(dialog.locator('#manualTagBox')).toBeVisible();
    await dialog.getByRole('button', { name: 'דנה לוי' }).click();
    await expect(dialog.getByRole('button', { name: 'דנה לוי' })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'תייג' }).click();
    await expect(dialog.locator('.manual-tag-existing')).toContainText('דנה לוי · מלבן');
    const sent = JSON.parse(worker.requestsTo('POST', '/face/tags').at(-1).body);
    expect(sent).toMatchObject({ action: 'add', imageId: 'img_e2e_3', personId: 'fp_dana' });
    expect(sent.box.x).toBeGreaterThan(0.1);
    expect(sent.box.w).toBeGreaterThan(0.2);
    await dialog.getByRole('button', { name: 'סגירה' }).click();
    await page.keyboard.press('Escape');

    await page.goto('/#person/fp_dana');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
    await expect(page.locator('.people-banner-sub')).toContainText('אחת בתיוג ידני');
    const manualCard = page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_3"]');
    await expect(manualCard.locator('.gallery-manual-badge')).toHaveText('תיוג ידני');
    await expect(page.locator('#photosGrid .gallery-card[data-media-id="img_e2e_1"] .gallery-manual-badge')).toHaveCount(0);

    // הסרה מהחלון מוציאה את התמונה מהאלבום.
    await page.goto('/#media/img_e2e_3');
    await page.locator('#lightboxModal').getByRole('button', { name: 'תיוג אדם בתמונה' }).click();
    await page.getByRole('button', { name: 'הסרת התיוג של דנה לוי' }).click();
    await expect(page.locator('#manualTagExisting li')).toHaveCount(0);
    expect(worker.users.tags.get('img_e2e_3')).toEqual([]);
});

test('צופה אינו רואה את כפתור התיוג', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'viewer' });
    await page.goto('/#media/img_e2e_1');
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(page.locator('#lightboxTagPerson')).toBeHidden();
});

test('הזמנה לאירוע: מנהל יוצר קישור שמוצג פעם אחת, רואה אותו ברשימה ומבטל', async ({ page, worker, context }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/admin.html#folders');
    const form = page.locator('#inviteForm');
    await expect(page.locator('#inviteFolder option')).not.toHaveCount(0);
    await page.locator('#inviteFolder').selectOption('2');
    await page.locator('#inviteDays').selectOption('1');
    await page.locator('#inviteMaxUses').fill('5');
    await expect(page.locator('#inviteAutoApproveRow')).toBeVisible();
    await page.getByLabel(/אישור אוטומטי/).check();
    await form.getByRole('button', { name: 'צור קישור הזמנה' }).click();
    const url = page.locator('#inviteCreatedUrl');
    await expect(url).toHaveValue(/\/#invite\/[A-Za-z0-9_-]{43}$/);
    const created = worker.requestsTo('POST', '/invites');
    expect(JSON.parse(created[0].body)).toEqual({ folderId: '2', days: 1, maxUses: 5, autoApprove: true });
    const rows = page.locator('#invitesList .admin-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('טיולים וסיורים');
    await expect(rows.first()).toContainText('0 מתוך 5 שימושים');
    await expect(rows.first()).toContainText('אישור אוטומטי');
    await page.getByRole('button', { name: 'העתק קישור' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await url.inputValue());
    // הרשימה מהשרת אינה מחזירה את האסימון.
    const token = (await url.inputValue()).split('/').pop();
    await page.reload();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#inviteCreated')).toBeHidden();
    expect(JSON.stringify(worker.requestsTo('GET', '/invites'))).not.toContain(token);

    await rows.first().getByRole('button', { name: /ביטול קישור ההזמנה/ }).click();
    await page.locator('#confirmApproveBtn').click();
    await expect(rows.first()).toContainText('בוטל');
});

test('הזמנה לאירוע: מנהל בדרגה 3 אינו רואה אישור אוטומטי', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'admin', name: 'מנהל' });
    await page.goto('/admin.html#folders');
    await expect(page.locator('#invitesStatus')).toContainText('עדיין לא נוצרו');
    await expect(page.locator('#inviteAutoApproveRow')).toBeHidden();
});

test('מבקר עם קישור הזמנה: האסימון יוצא מהכתובת, ואחרי ההתחברות הבקשה מסומנת "הגיע מהזמנה"', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    worker.seedInvite({ token: TOKEN, folderId: '1' });
    await page.goto(`/#invite/${TOKEN}`);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await expect(page.locator('#customAlertMessage')).toContainText('הוזמנת לאירוע');

    await signInViaGoogle(page, { uid: 'google-invited', email: 'invited@example.com', name: 'אורח מוזמן' });
    await expect(page.locator('#customAlertMessage')).toContainText('בקשת ההצטרפות שלך נשלחה עם ההזמנה לאירוע אירועים ופעילויות');
    const redeem = worker.requestsTo('POST', '/invites/redeem');
    expect(redeem).toHaveLength(1);
    expect(JSON.parse(redeem[0].body)).toEqual({ token: TOKEN });
    // האסימון לעולם אינו בכתובת של בקשה.
    expect(worker.requests.some(entry => entry.path.includes(TOKEN))).toBe(false);
    const profile = worker.collection('userProfiles').get('google-invited');
    expect(profile.status).toBe('pending');
    expect(profile.inviteFolderName).toBe('אירועים ופעילויות');
    // רענון אינו שולח את ההזמנה שוב.
    await page.reload();
    await page.waitForTimeout(1500);
    expect(worker.requestsTo('POST', '/invites/redeem')).toHaveLength(1);
});

test('הזמנה עם אישור אוטומטי: המבקר מאושר כצופה ומגיע לתיקיית האירוע', async ({ page, worker }) => {
    worker.seedFolders();
    worker.seedImages([imageRecord(1), imageRecord(2, { folderId: '2' })]);
    worker.seedInvite({ token: TOKEN, folderId: '2', autoApprove: true });
    await page.goto(`/#invite/${TOKEN}`);
    await signInViaGoogle(page, { uid: 'google-auto', email: 'auto@example.com', name: 'אורח' });
    await expect.poll(() => worker.collection('userProfiles').get('google-auto')?.status).toBe('approved');
    expect(worker.collection('userProfiles').get('google-auto').role).toBe('viewer');
    // הדף נטען מחדש כצופה, ישר באירוע.
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1, { timeout: 20000 });
    await expect.poll(() => page.evaluate(() => window.state?.activeFolderId)).toBe('2');
});

test('מנהל־על רואה בבקשת ההצטרפות שהמשתמש הגיע מהזמנה', async ({ page, worker }) => {
    worker.seedGallery();
    worker.seed('userProfiles', 'google-guest', {
        uid: 'google-guest', email: 'guest@example.com', displayName: 'אורחת', status: 'pending', role: 'viewer',
        requestedAt: Date.now(), inviteFolderName: 'חתונת <i>כהן</i>'
    });
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await page.goto('/admin.html#users');
    const flag = page.locator('#pendingUsersList .invite-flag');
    await expect(flag).toHaveText('הגיע מהזמנה לאירוע חתונת <i>כהן</i>');
    await expect(page.locator('#pendingUsersList i:not([data-lucide])')).toHaveCount(0);
});

test('Worker ישן בלי הנתיבים החדשים: ההעלאה, הדחייה וההעלאות שלי ממשיכים בלי שגיאה', async ({ page, worker }) => {
    worker.users.supported = false;
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.submitUserUpload === 'function' && Boolean(window.state?.currentUser?.uid) && window.state.folders?.length > 1);
    await page.evaluate(() => window.openModal('userUploadModal'));
    await page.locator('#userMultiFiles').setInputFiles([{ name: 'א.png', mimeType: 'image/png', buffer: makePng(8, 8, [1, 2, 3]) }]);
    await page.locator('#userUploadSubmitBtn').click();
    await page.locator('#confirmApproveBtn').click();
    await expect.poll(() => worker.collection('images').size).toBe(1);
    await page.evaluate(() => window.closeModal('userUploadModal'));
    await page.evaluate(() => window.openMyUploads());
    await expect(page.locator('#myUploadsStatus')).toContainText('יש לפרוס את גרסת ה־Worker העדכנית');
});
