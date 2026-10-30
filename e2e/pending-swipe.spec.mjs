// "מצב מהיר" באישור העלאות (pending-swipe.js): החלקה ומקשים, ביטול לפני
// השמירה, מונים, ופריטים שיוצאים מהתור — מול הזיוף של ה-Worker, דרך אותן
// בקשות של "אשר נבחרים" (POST /approve, /data/images, /data/pendingImages).
import { test, expect, seedSession, pendingRecord, readStoredToken, fakeSessionToken, TOKEN_KEY, DEFAULT_USER } from './fixtures.mjs';

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

    await expect(page.locator('#pendingSwipeReject')).toHaveAccessibleName('דחה');
    await expect(page.locator('#pendingSwipeReject')).toHaveAccessibleDescription('שליחת בקשת מחיקה למנהל־העל');
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

// כל הטוסטים שהוצגו בדף, גם אלה שכבר נעלמו — כדי לוודא שלמבקר שאינו מחובר
// לא הוצג שם של העלאה, ולא "אין הרשאה" על החלטה של המנהל שהתנתק.
async function recordToasts(page) {
    await page.addInitScript(() => {
        window.__toasts = [];
        document.addEventListener('DOMContentLoaded', () => {
            const message = document.getElementById('customAlertMessage');
            if (!message) return;
            new MutationObserver(() => window.__toasts.push(message.textContent.trim()))
                .observe(message, { childList: true, characterData: true, subtree: true });
        });
    });
}

const toasts = page => page.evaluate(() => window.__toasts || []);
const leakedToasts = async page => (await toasts(page)).filter(text => text.includes('העלאה') || text.includes('הרשאה'));
// חלון הביטול (5 שניות) ועוד מרווח: מה שהיה אמור להישלח בסופו כבר נשלח.
const pastUndoWindow = page => page.waitForTimeout(6_500);

test('התנתקות באמצע חלון הביטול: ההחלטה נשמרת לפני ההתנתקות, והמצב המהיר נסגר', async ({ page, worker }) => {
    test.slow();
    seedPending(worker, 2);
    await recordToasts(page);
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    await page.keyboard.press('a');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('אושר: העלאה 2');
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(0);

    // "יציאה ממצב ניהול" שבתפריט, כשהאישור עוד בחלון הביטול.
    await page.evaluate(() => window.lockGalleryImmediatelySidebar(true));
    await expect(page.locator('#pendingSwipe')).toBeHidden();
    await expect.poll(() => readStoredToken(page)).toBeNull();
    // האישור נשלח בשם המנהל, לפני שהאסימון נמחק.
    const record = worker.collection('pendingImages').get('pending_e2e_2');
    expect(record?.status).toBe('approved');
    expect(record?.approvedBy).toBe(DEFAULT_USER.uid);
    expect(worker.collection('images').get('pending_e2e_2')?.status).toBe('active');

    await pastUndoWindow(page);
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(1);
    expect(await leakedToasts(page)).toEqual([]);
});

test('התנתקות בלשונית אחרת באמצע חלון הביטול: המצב המהיר נסגר וההחלטה אינה נשלחת', async ({ page, context, worker }) => {
    test.slow();
    seedPending(worker, 2);
    await recordToasts(page);
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    await page.keyboard.press('a');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('אושר: העלאה 2');

    const second = await context.newPage();
    await second.goto('/');
    await second.evaluate(() => window.signOutGoogleAccount(true));

    // אירוע storage מגיע ללשונית הראשונה: החלון נסגר ואינו נשאר מעל הדף הנעול.
    await expect(page.locator('#pendingSwipe')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/pending-swipe-open/);
    await pastUndoWindow(page);
    // ההחלטה שבחלון הביטול לא נשלחה בשם מבקר שאינו מחובר: הפריט עדיין ממתין.
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(0);
    expect(worker.collection('pendingImages').get('pending_e2e_2')?.status).toBe('pending');
    expect(await leakedToasts(page)).toEqual([]);
});

test('החלפת חשבון באמצע חלון הביטול: ההחלטה אינה נשמרת בשם המנהל השני', async ({ page, context, worker }) => {
    test.slow();
    seedPending(worker, 2);
    await recordToasts(page);
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהל־על' });
    const other = { uid: 'google-admin-2', email: 'admin2@example.com', name: 'מנהל שני' };
    worker.seedUser({ ...other, role: 'super_admin' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    await page.keyboard.press('a');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('אושר: העלאה 2');

    // לשונית אחרת נכנסת בחשבון אחר; אירוע storage מחליף את החשבון גם כאן.
    const second = await context.newPage();
    await second.goto('/version.json');
    await second.evaluate(([key, value]) => localStorage.setItem(key, value), [TOKEN_KEY, fakeSessionToken(other)]);

    await expect(page.locator('#pendingSwipe')).toBeHidden();
    await pastUndoWindow(page);
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(0);
    expect(worker.collection('pendingImages').get('pending_e2e_2')?.status).toBe('pending');
    expect([...worker.collection('pendingImages').values()].filter(record => record.approvedBy === other.uid)).toEqual([]);
    expect(await leakedToasts(page)).toEqual([]);

    // המנהל השני מתחיל מפגש נקי: הפריט שהראשון כמעט אישר חוזר לתור.
    await expect(page.locator('#pendingList input[name="pendingImgCheck"]')).toHaveCount(2);
    await page.locator('#pendingSwipeOpenBtn').click();
    await expect(cardTitle(page)).toHaveText('העלאה 2');
    await expect(count(page)).toHaveText('נותרו 2');
});

test('כפתור "דחה": השם הנגיש הוא המילה שעל הכפתור, והיעד בתיאור', async ({ page, worker }) => {
    seedPending(worker, 1);
    await seedSession(page, { worker, role: 'super_admin' });
    await openFastMode(page);
    const reject = page.locator('#pendingSwipeReject');
    // WCAG 2.5.3: מי שאומר "דחה" לתוכנת שליטה קולית מגיע לכפתור.
    await expect(reject).toHaveAccessibleName('דחה');
    await expect(reject).toHaveAccessibleDescription('העברה לסל המחזור');
    await expect(page.locator('#pendingSwipeApprove')).toHaveAccessibleName('אשר');
});

test('לחיצה על חלק בחלון שאינו מקבל פוקוס אינה מכבה את המקשים', async ({ page, worker }) => {
    seedPending(worker, 3);
    await seedSession(page, { worker, role: 'super_admin' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    // טקסט ההסבר אינו מקבל פוקוס: הלחיצה עליו מעבירה את הפוקוס ל-body.
    await page.locator('#pendingSwipeHelp').click();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('a');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('אושר: העלאה 3');
    await expect(cardTitle(page)).toHaveText('העלאה 2');

    await page.locator('#pendingSwipeTitle').click();
    await page.keyboard.press('z');
    await expect(cardTitle(page)).toHaveText('העלאה 3');
    await page.locator('#pendingSwipeCount').click();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#pendingSwipeUndoText')).toHaveText('נדחה ויועבר לסל המחזור: העלאה 3');
    await page.locator('#pendingSwipeHelp').click();
    await page.keyboard.press('z');
    await expect(cardTitle(page)).toHaveText('העלאה 3');

    // Tab מ-body חוזר לתוך החלון, ולא לדף שמאחוריו.
    await page.locator('#pendingSwipeHelp').click();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('pendingSwipe').contains(document.activeElement))).toBe(true);

    await page.locator('#pendingSwipeHelp').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pendingSwipe')).toBeHidden();
    // שתי ההחלטות בוטלו, ולכן היציאה לא שלחה דבר.
    expect(worker.requestsTo('POST', '/approve')).toHaveLength(0);
    expect(worker.collection('trashItems').size).toBe(0);
});

test('ההחלטה הראשונה מוכרזת: אזור ההכרזה קיים מראש ומתמלא רק בפריים הבא', async ({ page, worker }) => {
    seedPending(worker, 2);
    await seedSession(page, { worker, role: 'super_admin' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFastMode(page);

    const live = page.locator('#pendingSwipeUndoLive');
    // האזור כבר בעץ הנגישות לפני ההחלטה הראשונה: לא מוסתר ולא בתוך אב מוסתר.
    await expect(live).toHaveAttribute('aria-live', 'polite');
    expect(await live.evaluate(element => !element.closest('[hidden], .hidden') && getComputedStyle(element).display !== 'none')).toBe(true);
    await expect(live).toHaveText('');
    // הטקסט הנראה בפס הביטול אינו מוכרז פעם שנייה.
    await expect(page.locator('#pendingSwipeUndoText')).not.toHaveAttribute('aria-live', /.*/);
    await expect(page.locator('#pendingSwipeUndoText')).not.toHaveAttribute('role', /.*/);

    // באותה משימה שבה הפס נחשף, האזור עוד ריק; ההודעה נכנסת בפריים הבא.
    const sameTask = await page.evaluate(() => {
        document.getElementById('pendingSwipeApprove').click();
        return {
            barHidden: document.getElementById('pendingSwipeUndo').hidden,
            live: document.getElementById('pendingSwipeUndoLive').textContent
        };
    });
    expect(sameTask).toEqual({ barHidden: false, live: '' });
    await expect(live).toHaveText('אושר: העלאה 2');

    // ביטול ואותה החלטה שוב: האזור מתרוקן קודם, ולכן אותו טקסט מוכרז מחדש.
    await page.keyboard.press('z');
    await expect(live).toHaveText('');
    await page.keyboard.press('a');
    await expect(live).toHaveText('אושר: העלאה 2');
});

test('בטלפון (390px): כותרת לוח האישור נשברת לשורות, והסמל של "מצב מהיר" אינו נמחץ', async ({ page, worker }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    seedPending(worker, 2);
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/admin.html#pending');
    await expect(page.locator('#pendingList input[name="pendingImgCheck"]').first()).toBeVisible();

    const rects = await page.locator('#view-pending .admin-panel-head').evaluate(head => {
        const rect = node => {
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const title = head.querySelector('h3');
        const button = document.getElementById('pendingSwipeOpenBtn');
        const style = getComputedStyle(title);
        return {
            title: rect(title),
            lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
            button: rect(button),
            icon: rect(button.querySelector('svg, i')),
            buttons: Array.from(head.querySelectorAll('button'), rect)
        };
    });
    // הסמל בגודל שנקבע לו (w-3.5 = 14px), ולא נמחץ לשבריר פיקסל.
    expect(rects.icon.width).toBeGreaterThanOrEqual(13.5);
    expect(rects.icon.height).toBeGreaterThanOrEqual(13.5);
    // הכותרת בשורה אחת — לא שלוש שורות צרות לצד הכפתורים.
    expect(rects.title.height).toBeLessThan(rects.lineHeight * 1.8);
    // הכפתורים אינם חופפים לכותרת, וכולם בתוך המסך.
    const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
    for (const button of rects.buttons) {
        expect(overlaps(button, rects.title)).toBe(false);
        expect(button.x).toBeGreaterThanOrEqual(0);
        expect(button.right).toBeLessThanOrEqual(390);
    }
    expect(rects.button.width).toBeGreaterThan(rects.icon.width + 40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
