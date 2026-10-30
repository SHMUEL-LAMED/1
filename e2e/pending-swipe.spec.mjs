// "מצב מהיר" באישור העלאות (pending-swipe.js): החלקה ומקשים, ביטול לפני
// השמירה, מונים, ופריטים שיוצאים מהתור — מול הזיוף של ה-Worker, דרך אותן
// בקשות של "אשר נבחרים" (POST /approve, /data/images, /data/pendingImages).
import { test, expect, seedSession, pendingRecord } from './fixtures.mjs';

const UNDO_WAIT = { timeout: 12_000 };

function seedPending(worker, count) {
    worker.seedFolders();
    const records = Array.from({ length: count }, (_, index) => pendingRecord(index + 1));
    for (const record of records) worker.seed('pendingImages', record.id, record);
    return records;
}

async function openFastMode(page) {
    await page.goto('/admin.html#pending');
    await expect(page.locator('#pendingList input[name="pendingImgCheck"]').first()).toBeVisible();
    await page.locator('#pendingSwipeOpenBtn').click();
    const dialog = page.locator('#pendingSwipe');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#pendingSwipeCard')).toBeFocused();
    return dialog;
}

// גרירה בעכבר: אותם אירועי pointer שאצבע מפיקה, בצעדים כדי שתהיה תנועה.
async function swipe(page, dx) {
    const box = await page.locator('#pendingSwipeCard .pending-swipe-media').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + 2, { steps: 6 });
    await page.mouse.move(x + dx, y + 4, { steps: 6 });
    await page.mouse.up();
}

const cardTitle = page => page.locator('#pendingSwipeCardTitle');
const count = page => page.locator('#pendingSwipeCount');

test('מנהל־על: החלקה ימינה מאשרת, שמאלה דוחה, Z מבטל, ומקשים ממשיכים עד הסוף', async ({ page, worker }) => {
    // הבדיקה מחכה בכוונה לסוף חלון ביטול מלא (5 שניות), ועוד שלוש החלקות.
    test.slow();
    seedPending(worker, 3);
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await openFastMode(page);

    // הרשימה ממוינת מהחדש לישן, והכרטיס מציג את פרטי ההעלאה.
    await expect(cardTitle(page)).toHaveText('העלאה 3');
    await expect(count(page)).toHaveText('נותרו 3');
    await expect(page.locator('#pendingSwipeLive')).toHaveText('העלאה 3. נותרו 3.');
    const meta = page.locator('#pendingSwipeCardMeta');
    await expect(meta).toContainText('שרה לוי');
    await expect(meta).toContainText('הקפות');
    await expect(meta).toContainText('תיקייה חדשה');
    await expect(page.locator('#pendingSwipeCard img')).toHaveAttribute('src', /\/media\/pending\/google-uploader-1\/pending_e2e_3\.jpg$/);

    // החלקה ימינה: אישור. הפריט יוצא מהתור מיד, אבל נשמר רק בסוף חלון הביטול.
    await swipe(page, 260);
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('אושר: העלאה 3');
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    await expect(count(page)).toHaveText('נותרו 2');
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(0);

    // תיעוד האישור ב-pendingImages נכתב אחרון (approvePendingRecord), ולכן מחכים לו.
    await expect.poll(() => worker.collection('pendingImages').get('pending_e2e_3')?.status, UNDO_WAIT).toBe('approved');
    const approved = worker.collection('images').get('pending_e2e_3');
    expect(approved.status).toBe('active');
    expect(approved.r2Key).toBe('approved/google-uploader-1/pending_e2e_3.jpg');
    expect(worker.collection('folders').get(approved.folderId)?.name).toBe('הקפות');
    await expect(page.locator('#pendingSwipeUndo')).toBeHidden();
    await expect(page.locator('#pendingCountBadge')).toHaveText('2');

    // החלקה שמאלה: דחייה — ו-Z מחזיר את הפריט לפני שמשהו נשלח.
    await swipe(page, -260);
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('נדחה ויועבר לסל המחזור: העלאה 2');
    await expect(cardTitle(page)).toHaveText('העלאה 1');
    await expect(count(page)).toHaveText('נותר פריט אחד');
    await page.keyboard.press('z');
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    await expect(count(page)).toHaveText('נותרו 2');
    await expect(page.locator('#pendingSwipeLive')).toHaveText('הפעולה בוטלה: העלאה 2.');
    await expect(page.locator('#pendingSwipeUndo')).toBeHidden();
    await expect(page.locator('#pendingSwipeCard')).toBeFocused();

    // גרירה קצרה אינה מחליטה: הכרטיס חוזר למקומו.
    await swipe(page, 40);
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    await expect(count(page)).toHaveText('נותרו 2');

    // מקלדת: R דוחה, וחץ ימינה מאשר את האחרון — ההחלטה החדשה שולחת מיד את הקודמת.
    await page.keyboard.press('r');
    await expect(cardTitle(page)).toHaveText('העלאה 1');
    await page.keyboard.press('ArrowRight');
    // moveRecordToTrash כותב לסל ורק אחר כך מוחק את הרשומה הממתינה.
    await expect.poll(() => worker.collection('pendingImages').has('pending_e2e_2')).toBe(false);
    expect(worker.collection('trashItems').size).toBe(1);
    expect([...worker.collection('trashItems').values()][0].originalId).toBe('pending_e2e_2');

    // התור ריק: מסך ריק, מונה אפס, והכפתורים כבויים.
    await expect(page.locator('#pendingSwipeEmpty')).toBeVisible();
    await expect(page.locator('#pendingSwipeEmpty')).toContainText('אין עוד פריטים לאישור');
    await expect(count(page)).toHaveText('לא נותרו פריטים');
    await expect(page.locator('#pendingSwipeApprove')).toBeDisabled();
    await expect(page.locator('#pendingSwipeReject')).toBeDisabled();

    // יציאה שולחת מיד את ההחלטה האחרונה, והרשימה שבלוח מתרוקנת.
    await page.keyboard.press('Escape');
    await expect(page.locator('#pendingSwipe')).toBeHidden();
    await expect(page.locator('#pendingSwipeOpenBtn')).toBeFocused();
    await expect.poll(() => worker.collection('images').get('pending_e2e_1')?.status).toBe('active');
    await expect(page.locator('#pendingCountBadge')).toHaveText('0');
    await expect(page.locator('#pendingList')).toContainText('אין קבצי מדיה ממתינים לאישור');
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(2);
});

test('מנהל: דחייה היא בקשת מחיקה, Enter מאשר, והפריט שנדחה אינו חוזר לתור', async ({ page, worker }) => {
    seedPending(worker, 2);
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    await expect(page.locator('#pendingSwipeReject')).toHaveAttribute('aria-label', 'דחייה — שליחת בקשת מחיקה למנהל־העל');
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    // "/" של חיפוש התפריט אינו מוציא את הפוקוס מהחלון המודאלי.
    await page.keyboard.press('/');
    await expect(page.locator('#pendingSwipeCard')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('תישלח בקשת מחיקה: העלאה 2');
    await expect(cardTitle(page)).toHaveText('העלאה 1');

    // Enter על הכרטיס מאשר; האישור שולח מיד את בקשת המחיקה של הקודם.
    await page.keyboard.press('Enter');
    await expect.poll(() => worker.collection('deletionRequests').size).toBe(1);
    const request = [...worker.collection('deletionRequests').values()][0];
    expect(request).toMatchObject({ targetType: 'pendingImage', targetId: 'pending_e2e_2', status: 'pending' });
    // מנהל אינו מוחק: הרשומה הממתינה נשארת עד שמנהל־העל יחליט.
    expect(worker.collection('pendingImages').get('pending_e2e_2')?.status).toBe('pending');
    await expect(page.locator('#pendingSwipeEmpty')).toBeVisible();

    await expect.poll(() => worker.collection('images').get('pending_e2e_1')?.status, UNDO_WAIT).toBe('active');
    await expect(page.locator('#pendingSwipeUndo')).toBeHidden();

    // פתיחה מחדש: הפריט שכבר נשלחה עליו בקשה אינו חוזר.
    await page.locator('#pendingSwipeEmpty button').click();
    await expect(page.locator('#pendingSwipe')).toBeHidden();
    await page.locator('#pendingSwipeOpenBtn').click();
    await expect(page.locator('#pendingSwipeEmpty')).toBeVisible();
    await expect(count(page)).toHaveText('לא נותרו פריטים');
});

test('בטלפון (390px): הכרטיס והכפתורים במסך, בלי גלילה אופקית, והכפתורים עובדים', async ({ page, worker }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    seedPending(worker, 2);
    await seedSession(page, { worker, role: 'super_admin' });
    await openFastMode(page);

    const card = await page.locator('#pendingSwipeCard').boundingBox();
    const approve = await page.locator('#pendingSwipeApprove').boundingBox();
    const reject = await page.locator('#pendingSwipeReject').boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    expect(card.height).toBeGreaterThan(300);
    for (const button of [approve, reject]) {
        expect(button.y + button.height).toBeLessThanOrEqual(844);
        expect(button.height).toBeGreaterThanOrEqual(44);
    }
    // "אשר" בצד ימין — לשם ההחלקה מאשרת.
    expect(approve.x).toBeGreaterThan(reject.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.locator('#pendingSwipeReject').click();
    await expect(cardTitle(page)).toHaveText('העלאה 1');
    await page.locator('#pendingSwipeUndoBtn').click();
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    await page.locator('#pendingSwipeApprove').click();
    await expect(cardTitle(page)).toHaveText('העלאה 1');
    await expect(count(page)).toHaveText('נותר פריט אחד');
    await page.locator('#pendingSwipe .modal-close').click();
    await expect.poll(() => worker.collection('images').get('pending_e2e_2')?.status).toBe('active');
    expect(worker.collection('trashItems').size).toBe(0);
});

test('אישורים מהירים לתיקייה מקורית חדשה יוצרים אותה פעם אחת בלבד', async ({ page, worker }) => {
    seedPending(worker, 3);
    await seedSession(page, { worker, role: 'super_admin' });
    // בלי תנועה ההחלטה נרשמת מיד, וכך שלוש השמירות יוצאות כמעט יחד:
    // שתיים עם ההחלטה הבאה, והאחרונה ביציאה.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);
    // רשת איטית: שמירת התיקייה החדשה לוקחת זמן, כמו בטלפון.
    await page.route(url => url.pathname.startsWith('/data/folders'), async route => {
        if (route.request().method() !== 'GET') await new Promise(resolve => setTimeout(resolve, 600));
        await route.fallback();
    });
    await page.keyboard.press('a');
    await page.keyboard.press('a');
    await page.keyboard.press('a');
    await page.keyboard.press('Escape');
    for (const id of ['pending_e2e_1', 'pending_e2e_2', 'pending_e2e_3']) {
        await expect.poll(() => worker.collection('pendingImages').get(id)?.status).toBe('approved');
    }
    const folders = [...worker.collection('folders').values()].filter(folder => folder.name === 'הקפות');
    expect(folders).toHaveLength(1);
    for (const id of ['pending_e2e_1', 'pending_e2e_2', 'pending_e2e_3']) {
        expect(worker.collection('images').get(id)?.folderId).toBe(folders[0].id);
    }
});
