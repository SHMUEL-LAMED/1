// תור ההעלאה מקצה לקצה: כמה קבצים בבת אחת עם סרגל לכל קובץ וסיכום כולל,
// ניסיון חוזר אוטומטי אחרי כשל זמני של השרת, ביטול קובץ בודד, והמשך של
// סרטון גדול שעולה בחלקים — אחרי רענון של הדף — מהחלק שבו נעצר.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, seedSession, makePng, DEFAULT_USER } from './fixtures.mjs';

const PART = 8 * 1024 * 1024;

async function openUploadModal(page) {
    await page.waitForFunction(() => typeof window.submitUserUpload === 'function' && Boolean(window.state?.currentUser?.uid) && window.state.folders?.length > 1);
    await page.evaluate(() => window.openModal('userUploadModal'));
    await expect(page.locator('#userUploadModal')).toBeVisible();
}

async function submitAndConfirm(page) {
    await page.locator('#userUploadSubmitBtn').click();
    await page.locator('#confirmApproveBtn').click();
}

function pngFiles(count) {
    return Array.from({ length: count }, (_, index) => ({
        name: `תמונה-${index + 1}.png`,
        mimeType: 'image/png',
        buffer: makePng(8, 8, [40 * index, 120, 200])
    }));
}

const rows = page => page.locator('#userUploadQueue [data-upload-index]');

test('כמה קבצים בבת אחת: כשל זמני של השרת מנוסה שוב מאליו, וכל קובץ מגיע ל-100%', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await openUploadModal(page);

    await page.locator('#userMultiFiles').setInputFiles(pngFiles(3));
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first().locator('.upload-queue-progress')).toHaveAttribute('role', 'progressbar');
    await expect(rows(page).first().locator('.upload-queue-cancel')).toHaveAttribute('aria-label', /ביטול ההעלאה של/);

    // הבקשה הראשונה לשרת נכשלת ב-503 — התור מחכה ומנסה שוב בעצמו.
    worker.failUploads = 1;
    await submitAndConfirm(page);

    for (let index = 0; index < 3; index += 1) {
        const row = rows(page).nth(index);
        await expect(row).toHaveAttribute('data-upload-state', 'success', { timeout: 15000 });
        await expect(row.locator('.upload-queue-progress')).toHaveAttribute('aria-valuenow', '100');
        await expect(row.locator('.upload-queue-status')).toHaveText('הושלם');
    }
    await expect(page.locator('#userUploadSummaryText')).toHaveText('הושלמו 3 מתוך 3');
    await expect(page.locator('#userUploadSummaryText')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#userUploadOverall')).toHaveAttribute('aria-valuenow', '100');
    expect(worker.failUploads).toBe(0);
    expect(worker.requestsTo('POST', '/upload')).toHaveLength(4);
    const uploaded = [...worker.objects.keys()].filter(key => key.startsWith(`approved/${DEFAULT_USER.uid}/`));
    expect(uploaded).toHaveLength(3);
    // הרשומות נכתבו לגלריה, והחלון נסגר כשאין כשלונות.
    await expect.poll(() => worker.collection('images').size).toBe(3);
    await expect(page.locator('#userUploadModal')).toBeHidden();
});

test('ביטול קובץ בודד: הקובץ שבוטל אינו עולה, והשאר ממשיכים', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await openUploadModal(page);

    await page.locator('#userMultiFiles').setInputFiles(pngFiles(4));
    await expect(rows(page)).toHaveCount(4);
    // ההעלאה איטית, כך שהקבצים האחרונים עדיין ממתינים בתור.
    worker.uploadDelayMs = 700;
    await submitAndConfirm(page);
    const last = rows(page).nth(3);
    await expect(rows(page).first()).toHaveAttribute('data-upload-state', 'active', { timeout: 10000 });
    await last.locator('.upload-queue-cancel').click();
    await expect(last).toHaveAttribute('data-upload-state', 'cancelled');
    await expect(last.locator('.upload-queue-status')).toHaveText('בוטל');
    await expect(last.locator('.upload-queue-cancel')).toBeHidden();

    for (let index = 0; index < 3; index += 1) {
        await expect(rows(page).nth(index)).toHaveAttribute('data-upload-state', 'success', { timeout: 15000 });
    }
    await expect(page.locator('#userUploadSummaryText')).toHaveText('הושלמו 3 מתוך 4 · בוטלו 1');
    expect(worker.requestsTo('POST', '/upload')).toHaveLength(3);
    await expect.poll(() => worker.collection('images').size).toBe(3);
});

test('סרטון גדול עולה בחלקים, ואחרי רענון באמצע ההעלאה ממשיך מהחלק שבו נעצר', async ({ page, worker }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'e2e-resume-'));
    const filePath = path.join(dir, 'הקפות.mp4');
    const bytes = Buffer.alloc(PART * 2 + 4096);
    for (let index = 0; index < bytes.length; index += 997) bytes[index] = index % 251;
    writeFileSync(filePath, bytes);
    try {
        worker.seedGallery();
        await seedSession(page, { worker, role: 'uploader' });
        await page.goto('/');
        await openUploadModal(page);

        // החלק השני "נופל ברשת" שוב ושוב.
        worker.failParts.add(2);
        await page.locator('#userMultiFiles').setInputFiles(filePath);
        await submitAndConfirm(page);
        await expect.poll(() => worker.requestsTo('PUT', '/upload/multipart/part').length, { timeout: 20000 }).toBeGreaterThanOrEqual(2);
        const [session] = [...worker.multipart.values()];
        expect([...session.parts.keys()]).toEqual([1]);
        const row = rows(page).first();
        await expect(row).toHaveAttribute('data-upload-state', /waiting|active/);

        // רענון באמצע: הדף נטען מחדש, והרשת חוזרת.
        await page.reload();
        worker.failParts.clear();
        await openUploadModal(page);
        await expect(page.locator('#userUploadResumeHint')).toBeVisible();
        await expect(page.locator('#userUploadResumeHint')).toContainText('הקפות.mp4');

        await page.locator('#userMultiFiles').setInputFiles(filePath);
        await expect(row.locator('.upload-queue-status')).toHaveText('ימשיך מהנקודה שנעצר', { timeout: 15000 });
        const partsBefore = worker.requestsTo('PUT', '/upload/multipart/part').map(request => request.path);
        await submitAndConfirm(page);
        await expect(row).toHaveAttribute('data-upload-state', 'success', { timeout: 30000 });

        // אותה העלאה נמשכה: אין פתיחה חדשה, וחלק 1 לא נשלח שוב.
        expect(worker.requestsTo('POST', '/upload/multipart/create')).toHaveLength(1);
        expect(worker.requestsTo('GET', '/upload/multipart/status').length).toBeGreaterThanOrEqual(1);
        const partsAfter = worker.requestsTo('PUT', '/upload/multipart/part').map(request => request.path).slice(partsBefore.length);
        expect(partsAfter.some(entry => entry.endsWith('partNumber=1'))).toBe(false);
        expect(partsAfter.some(entry => entry.endsWith('partNumber=2'))).toBe(true);
        expect(partsAfter.some(entry => entry.endsWith('partNumber=3'))).toBe(true);

        const stored = worker.objects.get(session.key);
        expect(stored.bytes.equals(bytes)).toBe(true);
        await expect.poll(() => worker.collection('images').get(session.imageId)?.r2Key).toBe(session.key);
        // המצב השמור בדפדפן נמחק אחרי ההשלמה.
        await page.evaluate(() => window.prepareUploadModal());
        await expect(page.locator('#userUploadResumeHint')).toBeHidden();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('מתג "שלח את המקור" מוצג למנהל בלבד', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await openUploadModal(page);
    await expect(page.locator('#userUploadOriginalToggle')).toBeHidden();
    await page.evaluate(() => { window.state.userRole = 'admin'; window.prepareUploadModal(); });
    await expect(page.locator('#userUploadOriginalToggle')).toBeVisible();
});
