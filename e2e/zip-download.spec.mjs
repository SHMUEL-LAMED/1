// הורדת כמה פריטים נבחרים כקובץ ZIP אחד: הדפדפן מקבל הורדה אחת, בשם
// התיקייה, ובתוכה כל הפריטים בשמות ייחודיים ובתוכן המקורי.
import { readFileSync } from 'node:fs';
import { test, expect, seedSession, imageRecord } from './fixtures.mjs';

// קורא ZIP מינימלי (STORE בלבד) מתוך הספרייה המרכזית.
function readZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054B50);
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    const files = [];
    for (let i = 0; i < count; i += 1) {
        const nameLength = view.getUint16(cursor + 28, true);
        const size = view.getUint32(cursor + 24, true);
        const local = view.getUint32(cursor + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        const start = local + 30 + view.getUint16(local + 26, true);
        files.push({ name, data: bytes.subarray(start, start + size) });
        cursor += 46 + nameLength;
    }
    return files;
}

test('כמה פריטים נבחרים יורדים כקובץ ZIP אחד', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1), imageRecord(2), imageRecord(3)]);
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(3);

    await page.evaluate(() => {
        window.toggleBulkSelectionMode(true);
        window.toggleSelectAllVisibleMedia();
    });
    await expect(page.locator('#bulkSelectedCount')).toHaveText('3');

    const downloads = [];
    page.on('download', download => downloads.push(download));
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#bulkSelectionBar button', { hasText: 'הורד' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const files = readZip(new Uint8Array(readFileSync(await download.path())));
    expect(files).toHaveLength(3);
    expect(new Set(files.map(file => file.name)).size).toBe(3);
    for (const file of files) expect(file.data.length).toBeGreaterThan(0);
    // ה־PNG המזויף נשמר בשלמותו (חתימת PNG בתחילת כל קובץ).
    for (const file of files) expect(Array.from(file.data.subarray(1, 4))).toEqual([0x50, 0x4E, 0x47]);

    await expect(page.locator('#bulkSelectionBar button', { hasText: 'הורד' })).toBeEnabled();
    expect(downloads).toHaveLength(1);
});
