// הורדה בלי מיקום וסימן מים, בדפדפן אמיתי: ה-Worker המזויף מגיש JPEG אמיתי
// עם GPS ב-EXIF וב-XMP, והקובץ שנשמר אצל הצופה נבדק בבתים — בלי GPS IFD,
// בלי קואורדינטות, ובלי קידוד מחדש כשסימן המים כבוי. כשהוא מופעל — התמונה
// עומדת נכון, אין בה EXIF, והטקסט מצויר בפינה התחתונה; מנהל מוריד בלעדיו.
import { readFileSync } from 'node:fs';
import { test, expect, seedSession, imageRecord, DEFAULT_USER } from './fixtures.mjs';
import {
    jpegWithGps, containsBytes, gpsRationalBytes, scanData,
    BASE_JPEG_WIDTH, BASE_JPEG_HEIGHT, BASE_JPEG_GRAY
} from './jpeg-fixtures.mjs';
import { inspectJpegMetadata } from '../download-privacy.js';

const mediaKey = id => `approved/${DEFAULT_USER.uid}/${id}.jpg`;

function serveJpeg(worker, id, bytes) {
    worker.objects.set(mediaKey(id), { bytes: Buffer.from(bytes), contentType: 'image/jpeg' });
}

async function downloadFromLightbox(page) {
    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#lightboxDownload').click();
    const download = await downloadPromise;
    return new Uint8Array(readFileSync(await download.path()));
}

// פענוח הקובץ שהורד בדפדפן: המידות, והבהירות המרבית בפינה התחתונה השמאלית
// (שם סימן המים) מול הפינה העליונה הימנית (שם אין כלום).
function analyzeImage(page, bytes) {
    return page.evaluate(async data => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const brightest = (x, y, w, h) => {
            const pixels = context.getImageData(x, y, w, h).data;
            let max = 0;
            for (let i = 0; i < pixels.length; i += 4) max = Math.max(max, (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
            return max;
        };
        const corner = Math.min(64, Math.floor(bitmap.width / 2));
        return {
            width: bitmap.width,
            height: bitmap.height,
            bottomStart: brightest(0, bitmap.height - 32, corner, 32),
            topEnd: brightest(bitmap.width - corner, 0, corner, 32)
        };
    }, Array.from(bytes));
}

test('הורדה של JPEG עם מיקום: ה-GPS יוצא, והתמונה עצמה לא קודדה מחדש', async ({ page, worker }) => {
    const source = jpegWithGps({ orientation: 6 });
    expect(inspectJpegMetadata(source)).toMatchObject({ hasGpsIfd: true, hasXmpGps: true });
    worker.seedFolders().seedImages([imageRecord(1)]);
    serveJpeg(worker, 'img_e2e_1', source);
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);

    const saved = await downloadFromLightbox(page);
    const metadata = inspectJpegMetadata(saved);
    expect(metadata).toMatchObject({ isJpeg: true, hasExif: true, hasGpsIfd: false, hasXmp: true, hasXmpGps: false, orientation: 6 });
    expect(containsBytes(saved, gpsRationalBytes())).toBe(false);
    // אותו אורך ואותם נתונים דחוסים — רק המטא־דאטה נערכה.
    expect(saved.length).toBe(source.length);
    expect(Buffer.from(scanData(saved)).equals(Buffer.from(scanData(source)))).toBe(true);
    expect(containsBytes(saved, Buffer.from('E2E Camera'))).toBe(true);
    // ההגדרה נקראה מהמסמך של systemMeta (שאינו קיים — ולכן בלי סימן מים).
    expect(worker.requestsTo('GET', '/data/systemMeta/downloadPrivacy').length).toBeGreaterThan(0);
    await expect(page.locator('#customAlertMessage')).toContainText('הקובץ הורד למחשב');
});

test('ZIP של כמה פריטים: כל JPEG יוצא בלי מיקום, ו-PNG נשאר כפי שהוא', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2), imageRecord(3)]);
    serveJpeg(worker, 'img_e2e_1', jpegWithGps());
    serveJpeg(worker, 'img_e2e_2', jpegWithGps({ little: true }));
    // img_e2e_3 מקבל את ה-PNG של הזיוף.
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);
    await page.evaluate(() => {
        window.toggleBulkSelectionMode(true);
        window.toggleSelectAllVisibleMedia();
    });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bulkSelectionBar button', { hasText: 'הורד' }).click();
    const zip = new Uint8Array(readFileSync(await (await downloadPromise).path()));

    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    const files = [];
    for (let i = 0; i < count; i += 1) {
        const nameLength = view.getUint16(cursor + 28, true);
        const size = view.getUint32(cursor + 24, true);
        const local = view.getUint32(cursor + 42, true);
        const start = local + 30 + view.getUint16(local + 26, true);
        files.push(zip.subarray(start, start + size));
        cursor += 46 + nameLength;
    }
    expect(files).toHaveLength(3);
    const jpegs = files.filter(file => inspectJpegMetadata(file).isJpeg);
    expect(jpegs).toHaveLength(2);
    for (const file of jpegs) {
        expect(inspectJpegMetadata(file)).toMatchObject({ hasExif: true, hasGpsIfd: false, hasXmpGps: false });
        expect(containsBytes(file, gpsRationalBytes()) || containsBytes(file, gpsRationalBytes(true))).toBe(false);
    }
    const png = files.find(file => !inspectJpegMetadata(file).isJpeg);
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4E, 0x47]);
});

test.describe('סימן מים', () => {
    const SETTINGS = { watermarkEnabled: true, watermarkText: 'גלריית בדיקה', stripAllMetadata: false };

    test('מופעל: הצופה מקבל תמונה שעומדת נכון, בלי EXIF, ועם טקסט בפינה התחתונה', async ({ page, worker }) => {
        worker.seedFolders().seedImages([imageRecord(1)]).seed('systemMeta', 'downloadPrivacy', SETTINGS);
        serveJpeg(worker, 'img_e2e_1', jpegWithGps({ orientation: 6 }));
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);

        const saved = await downloadFromLightbox(page);
        const metadata = inspectJpegMetadata(saved);
        expect(metadata.isJpeg).toBe(true);
        expect(metadata).toMatchObject({ hasExif: false, hasGpsIfd: false, hasXmp: false });
        expect(containsBytes(saved, gpsRationalBytes())).toBe(false);

        // כיוון 6: התמונה (320×160) הסתובבה בפענוח, ונשמרה עומדת (160×320) בלי תג כיוון.
        const image = await analyzeImage(page, saved);
        expect({ width: image.width, height: image.height }).toEqual({ width: BASE_JPEG_HEIGHT, height: BASE_JPEG_WIDTH });
        expect(image.topEnd).toBeLessThan(BASE_JPEG_GRAY + 20);
        expect(image.bottomStart).toBeGreaterThan(BASE_JPEG_GRAY + 40);
    });

    test('מנהל מוריד בלי סימן מים — רק בלי המיקום', async ({ page, worker }) => {
        const source = jpegWithGps({ orientation: 6 });
        worker.seedFolders().seedImages([imageRecord(1)]).seed('systemMeta', 'downloadPrivacy', SETTINGS);
        serveJpeg(worker, 'img_e2e_1', source);
        await seedSession(page, { worker, role: 'admin' });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);

        const saved = await downloadFromLightbox(page);
        expect(inspectJpegMetadata(saved)).toMatchObject({ hasExif: true, hasGpsIfd: false, orientation: 6 });
        expect(saved.length).toBe(source.length);
        const image = await analyzeImage(page, saved);
        expect(image.bottomStart).toBeLessThan(BASE_JPEG_GRAY + 20);
    });

    test('כבוי עם "כל נתוני המצלמה": נשאר רק הכיוון, בלי סימן מים', async ({ page, worker }) => {
        worker.seedFolders().seedImages([imageRecord(1)])
            .seed('systemMeta', 'downloadPrivacy', { watermarkEnabled: false, watermarkText: 'x', stripAllMetadata: true });
        serveJpeg(worker, 'img_e2e_1', jpegWithGps({ orientation: 6 }));
        await seedSession(page, { worker });
        await page.goto('/');
        await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(1);

        const saved = await downloadFromLightbox(page);
        const metadata = inspectJpegMetadata(saved);
        expect(metadata).toMatchObject({ hasExif: true, hasGpsIfd: false, hasXmp: false, orientation: 6 });
        expect(metadata.kinds.filter(kind => kind !== 'image')).toEqual(['jfif', 'exif']);
        expect(containsBytes(saved, Buffer.from('E2E Camera'))).toBe(false);
    });
});

test('מנהל־העל מפעיל סימן מים בלוח הניהול, וההגדרה נשמרת ב-systemMeta', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהלת העל' });
    await page.goto('/admin.html#downloads');

    await expect(page.locator('#view-downloads')).toHaveClass(/is-active/);
    const enabled = page.getByLabel('סימן מים בתמונות שיורדות');
    const text = page.getByLabel('טקסט סימן המים');
    await expect(enabled).not.toBeChecked();
    await expect(page.locator('#downloadWatermarkPreview')).toHaveText('גלריית שמחת התורה');

    await enabled.check();
    await text.fill('  ‮© משפחת   כהן  ');
    await expect(page.locator('#downloadWatermarkPreview')).toHaveText('© משפחת כהן');
    await page.getByLabel('להסיר את כל נתוני המצלמה, ולא רק את המיקום').check();
    await page.locator('#downloadPrivacySaveButton').click();

    await expect(page.locator('#downloadPrivacyStatus')).toHaveText('נשמר. ההגדרה חלה על ההורדות הבאות.');
    expect(worker.collection('systemMeta').get('downloadPrivacy')).toMatchObject({
        watermarkEnabled: true,
        watermarkText: '© משפחת כהן',
        stripAllMetadata: true
    });
    await expect(text).toHaveValue('© משפחת כהן');

    // פתיחה מחדש של המסך קוראת את מה שנשמר.
    await page.reload();
    await expect(page.locator('#view-downloads')).toHaveClass(/is-active/);
    await expect(enabled).toBeChecked();
    await expect(text).toHaveValue('© משפחת כהן');
});
