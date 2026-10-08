// ההתחברות והשער: מה מבקר רואה לפני הכניסה ואחריה, ואיך ההתחברות שורדת
// רענון ולשונית נוספת, מתחלפת באסימון השרת ונמחקת בהתנתקות.
import {
    test, expect, seedSession, signInViaGoogle, readStoredToken, DEFAULT_USER, DAY_MS
} from './fixtures.mjs';

const gate = page => page.locator('#galleryAccessGate');

test('אורח רואה את שער הכניסה, והגלריה נעולה', async ({ page }) => {
    await page.goto('/');

    await expect(gate(page)).toBeVisible();
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(page.locator('#galleryAccessGateTitle')).toHaveText('התחבר כדי לצפות בגלריה');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(page.locator('#headerConnectionStatus')).toHaveText('נדרשת הרשאה');
    await expect(page.locator('#headerConnectionStatus')).toHaveAttribute('data-state', 'locked');
    await expect(page.locator('#photosGrid')).toBeHidden();
    // כפתור האתר הוחלף בכפתור הרשמי של Google.
    await expect(gate(page).locator('[data-official-google-button-host]')).toHaveText('[google]');
});

test('אסימון שמור משחזר צופה מאושר: הגלריה נפתחת והתמונות מצוירות', async ({ page, worker }) => {
    worker.seedGallery({ images: 3 });
    await seedSession(page, { worker, approved: true, role: 'viewer' });
    await page.goto('/');

    await expect(page.locator('body')).not.toHaveClass(/gallery-locked/);
    await expect(gate(page)).toBeHidden();
    await expect(page.locator('#headerConnectionStatus')).toHaveText('גישה מאושרת');
    await expect(page.locator('#headerConnectionStatus')).toHaveAttribute('data-state', 'online');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    await expect(page.locator('#imageCounter')).toHaveText('3 פריטים');
    await expect(page.locator('#floatingUserPanelName')).toHaveText(DEFAULT_USER.name);
    await expect(page.locator('#floatingUserPanelEmail')).toHaveText(DEFAULT_USER.email);
    await expect(page.locator('#sidebarLockStatus')).toHaveText('צופה מאושר');
    await expect(page.locator('#userUploadSubmitBtn')).toHaveText('שלח לאישור');
    // אסימון טרי אינו מחודש: לא הייתה כניסה מחדש מול השרת.
    expect(worker.requestsTo('POST', '/auth/session')).toHaveLength(0);
});

test('ההתחברות משותפת ללשונית נוספת, והתנתקות בה נועלת גם את הראשונה', async ({ page, context, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);

    // הלשונית השנייה לא נזרעה בעצמה: היא נשענת רק על localStorage המשותף.
    const second = await context.newPage();
    await second.goto('/');
    await expect(second.locator('body')).not.toHaveClass(/gallery-locked/);
    await expect(second.locator('#photosGrid .gallery-card')).toHaveCount(2);
    await expect(second.locator('#floatingUserPanelName')).toHaveText(DEFAULT_USER.name);

    await second.evaluate(() => window.signOutGoogleAccount(true));
    await expect(second.locator('body')).toHaveClass(/gallery-locked/);
    // אירוע storage מעביר את ההתנתקות ללשונית הראשונה בלי רענון.
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect.poll(() => readStoredToken(page)).toBeNull();
});

test('משתמש שממתין לאישור רואה את מסך ההמתנה, והגלריה אינה נטענת', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await seedSession(page, { worker, approved: false });
    await page.goto('/');

    await expect(gate(page)).toBeVisible();
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'pending');
    await expect(page.locator('#galleryAccessGateChip')).toHaveText('ממתין לאישור מנהל');
    await expect(page.locator('#galleryAccessGateTitle')).toHaveText('בקשת ההצטרפות ממתינה לאישור');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(page.locator('#floatingUserPanelBadge')).toHaveText('ממתין לאישור מנהל');
    await expect(page.locator('#sidebarLockStatus')).toHaveText('ממתין לאישור');
    // הפרופיל נקרא, אבל התמונות לא נתבקשו כלל.
    expect(worker.requestsTo('GET', `/data/userProfiles/${DEFAULT_USER.uid}`).length).toBeGreaterThan(0);
    expect(worker.requestsTo('GET', '/data/images')).toHaveLength(0);
});

test('בקשה שנדחתה מציגה הסבר ברור במקום מסך ההתחברות', async ({ page, worker }) => {
    await seedSession(page, { worker, status: 'rejected' });
    await page.goto('/');

    await expect(gate(page)).toHaveAttribute('data-gate-state', 'blocked');
    await expect(page.locator('#galleryAccessGateChip')).toHaveText('הבקשה נדחתה');
    await expect(page.locator('#galleryAccessGateTitle')).toHaveText('בקשת ההצטרפות לא אושרה');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(page.locator('#sidebarLockStatus')).toHaveText('לא אושר');
});

test('חשבון חסום: אסימון ישן נדחה בחידוש, והמשתמש מנותק', async ({ page, worker }) => {
    // אסימון בן יומיים מחודש מול השרת בטעינה; השרת מחזיר account_blocked.
    await seedSession(page, { worker, status: 'blocked', issuedAgoMs: 2 * DAY_MS });
    await page.goto('/');

    await expect.poll(() => readStoredToken(page)).toBeNull();
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(page.locator('#floatingSignedInView')).toHaveClass(/hidden/);
    expect(worker.requestsTo('POST', '/auth/session')).toHaveLength(1);
});

test('כניסה דרך Google מחליפה את אסימון Google באסימון השרת ופותחת את הגלריה', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    worker.seedUser({ status: 'approved', role: 'viewer' });
    await page.goto('/');
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');

    const credential = await signInViaGoogle(page);

    // האסימון שנשמר הוא אסימון השרת (v1.), לא אסימון Google.
    await expect.poll(() => readStoredToken(page)).toMatch(/^v1\./);
    expect(await readStoredToken(page)).not.toBe(credential);
    const exchanges = worker.requestsTo('POST', '/auth/session');
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].headers.authorization).toBe(`Bearer ${credential}`);

    await expect(page.locator('body')).not.toHaveClass(/gallery-locked/);
    await expect(gate(page)).toBeHidden();
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
    await expect(page.locator('#floatingSignedOutView')).toHaveClass(/hidden/);
    await expect(page.locator('#floatingSignedInView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#floatingUserPanelName')).toHaveText(DEFAULT_USER.name);
    await expect(page.locator('#customAlertMessage')).toContainText('התחברת בהצלחה');
});

test('משתמש חדש שנכנס דרך Google מקבל פרופיל ממתין ומסך המתנה', async ({ page, worker }) => {
    await page.goto('/');
    await signInViaGoogle(page, { uid: 'google-user-new', email: 'new@example.com', name: 'חדש' });

    await expect.poll(() => readStoredToken(page)).toMatch(/^v1\./);
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'pending');
    await expect(page.locator('#floatingUserPanelName')).toHaveText('חדש');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    const profile = worker.collection('userProfiles').get('google-user-new');
    expect(profile).toMatchObject({ email: 'new@example.com', status: 'pending', role: 'viewer' });
});

test('חשבון חסום אינו יכול להתחבר: השרת דוחה, והאסימון אינו נשמר', async ({ page, worker }) => {
    worker.seedUser({ status: 'blocked' });
    await page.goto('/');
    await signInViaGoogle(page);

    // שתי ההודעות האפשריות — דחיית הכניסה או כישלון סנכרון הפרופיל — נושאות את הסיבה.
    await expect(page.locator('#customAlertMessage')).toHaveText(/החשבון חסום|account_blocked/);
    await expect.poll(() => readStoredToken(page)).toBeNull();
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(page.locator('#floatingSignedInView')).toHaveClass(/hidden/);
});

test('התנתקות דרך הכפתור מוחקת את האסימון ונועלת את הגלריה, גם אחרי רענון', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('body')).not.toHaveClass(/gallery-locked/);

    await page.locator('#floatingProfileButton').click();
    await page.locator('#floatingProfilePanel .profile-signout').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await expect(page.locator('#confirmTitle')).toHaveText('התנתקות מהחשבון');
    await page.locator('#confirmApproveBtn').click();

    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(page.locator('#customAlertMessage')).toHaveText('התנתקת מחשבון Google.');
    await expect.poll(() => readStoredToken(page)).toBeNull();

    await page.reload();
    await expect(gate(page)).toHaveAttribute('data-gate-state', 'signed-out');
    await expect(page.locator('body')).toHaveClass(/gallery-locked/);
    expect(await readStoredToken(page)).toBeNull();
});
