// תצוגות מקדימות למדיה, מקצה לקצה: הכרטיס מציג את thumb והתצוגה המלאה את
// medium עם srcset בעוד ההורדה נשארת על המקור; סרטון מקבל פוסטר; תצוגה
// שנמחקה נופלת אל המקור; ההעלאה מייצרת את התצוגות בדפדפן אמיתי (PNG
// מהמאגר, JPEG מסובב ב-EXIF, סרטון שמוקלט בדפדפן); וריצת ההשלמה בלוח
// הניהול משלימה תצוגות לפריטים ישנים בלי לחזור על מה שכבר נשמר.
import { readFileSync } from 'node:fs';
import { CARD_IMAGE_SIZES } from '../media-variants.js';
import {
    test, expect, seedSession, imageRecord, mediaUrl, variantEntries, variantUrl,
    MEDIA_SIZE, DEFAULT_USER, API_ORIGIN, variantAvifUrl, withAvif
} from './fixtures.mjs';

const ICON_PNG = readFileSync(new URL('../icon-512.png', import.meta.url));
const ICON_SIZE = ICON_PNG.readUInt32BE(16);
const MAX_VARIANT_BYTES = 2 * 1024 * 1024;

// ממדי WebP מתוך הבייטים (VP8 / VP8L / VP8X) — בלי ספריות.
function webpDimensions(bytes) {
    const fourcc = bytes.toString('ascii', 12, 16);
    if (fourcc === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (fourcc === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    throw new Error(`WebP לא מוכר: ${fourcc}`);
}

function originalRequests(worker, id) {
    return worker.requestsTo('GET', `/media/approved/${DEFAULT_USER.uid}/${id}.jpg`).length;
}

// בודק תצוגה שנשמרה בזיוף: WebP בגודל המותר ובממדים הצפויים, ותואמת לרשומה.
function expectStoredVariant(worker, record, name, dimensions) {
    const key = `variants/${record.id}/${name}.webp`;
    const stored = worker.objects.get(key);
    expect(stored, `התצוגה ${key} לא נשמרה`).toBeTruthy();
    expect(stored.contentType).toBe('image/webp');
    expect(stored.bytes.length).toBeGreaterThan(0);
    expect(stored.bytes.length).toBeLessThanOrEqual(MAX_VARIANT_BYTES);
    expect(webpDimensions(stored.bytes)).toEqual(dimensions);
    expect(record.variants[name]).toMatchObject({ key, url: variantUrl(record.id, name), type: 'image/webp', ...dimensions });
    return stored;
}

test('הכרטיס מציג את התצוגה הקטנה, התצוגה המלאה את הבינונית עם srcset, וההורדה מביאה את המקור', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { variants: variantEntries('img_e2e_1'), variantsVersion: 1 }),
        imageRecord(2)
    ]);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(2);

    // התמונה החדשה (2) היא בלי תצוגות — מוצגת כמו קודם, מהמקור.
    const plain = cards.nth(0).locator('img.gallery-card-img');
    await expect(plain).toHaveAttribute('src', mediaUrl('img_e2e_2'));
    expect(await plain.getAttribute('data-fallback-src')).toBeNull();
    expect(await plain.getAttribute('srcset')).toBeNull();

    // התמונה עם התצוגות: thumb בכרטיס, עם נפילה אל המקור, וטעינה עצלה.
    const card = cards.nth(1).locator('img.gallery-card-img');
    await expect(card).toHaveAttribute('src', variantUrl('img_e2e_1', 'thumb'));
    await expect(card).toHaveAttribute('data-fallback-src', mediaUrl('img_e2e_1'));
    await expect(card).toHaveAttribute('srcset', `${variantUrl('img_e2e_1', 'thumb')} 480w, ${variantUrl('img_e2e_1', 'medium')} 1280w`);
    await expect(card).toHaveAttribute('sizes', CARD_IMAGE_SIZES);
    // בלי עותקי AVIF אין <picture>: התמונה היא ילד ישיר של הכרטיס.
    await expect(cards.nth(1).locator('picture')).toHaveCount(0);
    await expect(card).toHaveAttribute('loading', 'lazy');
    await expect(card).toHaveAttribute('decoding', 'async');
    // מסך רגיל (1x) ברוחב 1280: לפי sizes הכרטיס ברוחב 360px, ולכן נבחרת thumb.
    await expect.poll(() => card.evaluate(element => element.complete && element.naturalWidth > 0 && element.currentSrc)).toBe(variantUrl('img_e2e_1', 'thumb'));
    expect(worker.requestsTo('GET', '/media/variants/img_e2e_1/thumb.webp').length).toBeGreaterThan(0);
    const originalsBefore = originalRequests(worker, 'img_e2e_1');

    await cards.nth(1).locator('.gallery-media').click();
    const image = page.locator('#lightboxImage');
    await expect(image).toHaveAttribute('src', variantUrl('img_e2e_1', 'medium'));
    await expect(image).toHaveAttribute('srcset', `${variantUrl('img_e2e_1', 'thumb')} 480w, ${variantUrl('img_e2e_1', 'medium')} 1280w`);
    await expect(image).toHaveAttribute('sizes', '100vw');
    await expect(image).toHaveAttribute('data-fallback-src', mediaUrl('img_e2e_1'));
    await expect(page.locator('#lightboxBackdrop')).toHaveAttribute('src', variantUrl('img_e2e_1', 'thumb'));
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
    expect(originalRequests(worker, 'img_e2e_1')).toBe(originalsBefore);

    // ההורדה מביאה את המקור, לא את התצוגה.
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#lightboxDownload').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('תמונה 1');
    expect(originalRequests(worker, 'img_e2e_1')).toBe(originalsBefore + 1);

    // מעבר לתמונה בלי תצוגות מחליף את srcset במקור עצמו ב-1x ומנקה את הנפילה.
    await page.locator('#lightboxModal button[aria-label="התמונה הבאה"]').click();
    await expect(image).toHaveAttribute('src', mediaUrl('img_e2e_2'));
    await expect(image).toHaveAttribute('srcset', `${mediaUrl('img_e2e_2')} 1x`);
    expect(await image.getAttribute('sizes')).toBeNull();
    expect(await image.getAttribute('data-fallback-src')).toBeNull();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
});

test('סרטון מקבל את הפוסטר שלו, ותצוגה שנמחקה נופלת אל המקור', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, {
            title: 'סרטון',
            url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_e2e_1.mp4`,
            r2Key: `approved/${DEFAULT_USER.uid}/img_e2e_1.mp4`,
            mediaType: 'video',
            mimeType: 'video/mp4',
            duration: 12,
            variants: variantEntries('img_e2e_1', ['poster', 'thumb']),
            variantsVersion: 1
        }),
        imageRecord(2, { variants: variantEntries('img_e2e_2'), variantsVersion: 1 })
    ]);
    worker.missingMedia.add('variants/img_e2e_2/thumb.webp');
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(2);

    // התצוגה של התמונה החדשה נמחקה: הכרטיס נופל אל המקור ומציג אותו.
    const fallen = cards.nth(0).locator('img.gallery-card-img');
    await expect(fallen).toHaveAttribute('src', mediaUrl('img_e2e_2'));
    await expect.poll(() => fallen.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
    expect(await fallen.getAttribute('data-fallback-src')).toBeNull();
    expect(worker.requestsTo('GET', '/media/variants/img_e2e_2/thumb.webp')).toHaveLength(1);

    // הסרטון: thumb כפוסטר הכרטיס, poster בתצוגה המלאה, thumb ברקע.
    const video = cards.nth(1).locator('video.gallery-card-img');
    await expect(video).toHaveAttribute('poster', variantUrl('img_e2e_1', 'thumb'));
    await cards.nth(1).locator('.gallery-media').click();
    await expect(page.locator('#lightboxVideo')).toHaveAttribute('poster', variantUrl('img_e2e_1', 'poster'));
    await expect(page.locator('#lightboxBackdrop')).toHaveAttribute('src', variantUrl('img_e2e_1', 'thumb'));
    await expect(page.locator('#lightboxImage')).toBeHidden();
});

test('ההעלאה מייצרת תצוגות בדפדפן: PNG מוקטן ל-480, לא מוגדל מעבר למקור, והכיוון שב-EXIF נשמר', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.uploadMediaToR2 === 'function' && Boolean(window.state?.currentUser?.uid));

    // PNG אמיתי מהמאגר (512×512): thumb מוקטן ל-480, medium נשאר 512.
    const stored = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        return window.uploadMediaToR2(new File([bytes], 'icon.png', { type: 'image/png' }), 'img_upload', 'תמונה שהועלתה');
    }, ICON_PNG.toString('base64'));

    expect(stored).toMatchObject({ url: `${API_ORIGIN}/media/approved/${DEFAULT_USER.uid}/img_upload.png`, mediaType: 'image', variantsVersion: 1 });
    const uploaded = worker.objects.get(`approved/${DEFAULT_USER.uid}/img_upload.png`);
    expect(uploaded.bytes.length).toBe(ICON_PNG.length);
    const record = { id: 'img_upload', variants: stored.variants };
    const thumb = expectStoredVariant(worker, record, 'thumb', { width: 480, height: 480 });
    const medium = expectStoredVariant(worker, record, 'medium', { width: ICON_SIZE, height: ICON_SIZE });
    expect(thumb.bytes.length).toBeLessThan(ICON_PNG.length);
    expect(medium.bytes.length).toBeLessThan(ICON_PNG.length);
    expect(stored.variants.poster).toBeUndefined();

    // JPEG רחב (600×300) עם Orientation=6 ב-EXIF: התצוגות מסובבות לאורך.
    const rotated = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 300;
        const context = canvas.getContext('2d');
        context.fillStyle = '#1e3a8a';
        context.fillRect(0, 0, 600, 300);
        context.fillStyle = '#f5c451';
        context.fillRect(0, 0, 300, 300);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        const source = new Uint8Array(await blob.arrayBuffer());
        // APP1 מינימלי: TIFF (little-endian) עם רשומת Orientation אחת בלבד.
        const exif = Uint8Array.from([
            0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00,
            0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00
        ]);
        const bytes = new Uint8Array(source.length + exif.length);
        bytes.set(source.subarray(0, 2), 0);
        bytes.set(exif, 2);
        bytes.set(source.subarray(2), 2 + exif.length);
        return window.uploadMediaToR2(new File([bytes], 'rotated.jpg', { type: 'image/jpeg' }), 'img_rotated', 'מסובבת');
    });
    const rotatedRecord = { id: 'img_rotated', variants: rotated.variants };
    expectStoredVariant(worker, rotatedRecord, 'thumb', { width: 240, height: 480 });
    expectStoredVariant(worker, rotatedRecord, 'medium', { width: 300, height: 600 });

    // ביטול מפורש (קובץ משני): הטופס נשלח בלי תצוגות.
    const plain = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        return window.uploadMediaToR2(new File([bytes], 'icon.png', { type: 'image/png' }), 'img_plain', 'בלי תצוגות', { variants: false });
    }, ICON_PNG.toString('base64'));
    expect(plain.variants).toBeUndefined();
    expect(worker.objects.has('variants/img_plain/thumb.webp')).toBe(false);
});

test('העלאת סרטון מייצרת פוסטר ותצוגה קטנה מפריים של הסרטון', async ({ page, worker }) => {
    worker.seedGallery();
    await seedSession(page, { worker, role: 'uploader' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.uploadMediaToR2 === 'function' && Boolean(window.state?.currentUser?.uid));

    // סרטון קצר שמוקלט בדפדפן עצמו (VP8/WebM) מתוך קנבס צבעוני.
    const result = await page.evaluate(async () => {
        if (typeof MediaRecorder !== 'function' || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return { unsupported: true };
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        recorder.start(100);
        let frame = 0;
        await new Promise(resolve => {
            const timer = setInterval(() => {
                context.fillStyle = `hsl(${(frame * 17) % 360}, 80%, 50%)`;
                context.fillRect(0, 0, 320, 180);
                frame += 1;
                if (frame >= 36) {
                    clearInterval(timer);
                    resolve();
                }
            }, 33);
        });
        await new Promise(resolve => {
            recorder.onstop = resolve;
            recorder.stop();
        });
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (!blob.size) return { unsupported: true };
        return { size: blob.size, stored: await window.uploadMediaToR2(blob, 'vid_upload', 'סרטון שהועלה') };
    });
    // Chromium מקליט VP8 תמיד; אם לא — זו תקלה בסביבה, ולא סיבה לדלג.
    expect(result.unsupported, 'הדפדפן אינו מקליט WebM').toBeFalsy();

    expect(result.stored).toMatchObject({ mediaType: 'video', variantsVersion: 1 });
    expect(worker.objects.get(`approved/${DEFAULT_USER.uid}/vid_upload.webm`).bytes.length).toBe(result.size);
    const record = { id: 'vid_upload', variants: result.stored.variants };
    expectStoredVariant(worker, record, 'poster', { width: 320, height: 180 });
    expectStoredVariant(worker, record, 'thumb', { width: 320, height: 180 });
    expect(result.stored.variants.medium).toBeUndefined();
});

test('ריצת "תצוגות מקדימות" בלוח הניהול משלימה תצוגות לפריטים ישנים, ואינה חוזרת על מה שנשמר', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1),
        imageRecord(2),
        imageRecord(3, { variants: variantEntries('img_e2e_3'), variantsVersion: 1 })
    ]);
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/admin.html#variants');

    await expect(page.locator('#view-variants')).toHaveClass(/is-active/);
    await expect(page.locator('#variantsSummary')).toHaveText('1 מתוך 3 פריטים עם תצוגות מקדימות · 2 חסרים');
    await expect(page.locator('#variantsStartBtn')).toBeEnabled();

    await page.locator('#variantsStartBtn').click();
    await expect(page.locator('#variantsStatusText')).toHaveText('הריצה הושלמה: 2 פריטים קיבלו תצוגות, 0 נכשלו.');
    await expect(page.locator('#variantsSummary')).toHaveText('3 מתוך 3 פריטים עם תצוגות מקדימות · 0 חסרים');
    expect(worker.requestsTo('POST', '/media/variants')).toHaveLength(2);

    // הפריטים הישנים קיבלו תצוגות (המקור בזיוף הוא 8×8, ולכן אין הגדלה), והרשומות עודכנו.
    for (const id of ['img_e2e_1', 'img_e2e_2']) {
        const record = worker.collection('images').get(id);
        expect(record.variantsVersion).toBe(1);
        expectStoredVariant(worker, record, 'thumb', { width: MEDIA_SIZE, height: MEDIA_SIZE });
        expectStoredVariant(worker, record, 'medium', { width: MEDIA_SIZE, height: MEDIA_SIZE });
    }
    // הפריט שכבר היו לו תצוגות לא נגע.
    expect(worker.objects.has('variants/img_e2e_3/thumb.webp')).toBe(false);
    expect(worker.requestsTo('GET', `/media/approved/${DEFAULT_USER.uid}/img_e2e_3.jpg`)).toHaveLength(0);

    // ריצה חוזרת: אין מה לעשות, ואף בקשה חדשה אינה נשלחת.
    await page.locator('#variantsStartBtn').click();
    await expect(page.locator('#variantsStatusText')).toHaveText('לכל פריטי המדיה שניתן לעבד כבר יש תצוגות מקדימות.');
    expect(worker.requestsTo('POST', '/media/variants')).toHaveLength(2);
});

test('עותקי AVIF מוצעים ב-<picture> בכרטיס ובתצוגה המלאה, ותצוגה שנמחקה נופלת אל המקור גם משם', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { variants: withAvif(variantEntries('img_e2e_1'), 'img_e2e_1'), variantsVersion: 1 }),
        imageRecord(2, { variants: withAvif(variantEntries('img_e2e_2'), 'img_e2e_2'), variantsVersion: 1 }),
        imageRecord(3)
    ]);
    // ה-AVIF של התמונה האמצעית נמחק: Chromium מפענח AVIF ולכן בוחר אותו —
    // והנפילה חייבת לוותר גם על ה-<source> כדי להגיע אל המקור.
    worker.missingMedia.add('variants/img_e2e_2/thumb.avif');
    worker.missingMedia.add('variants/img_e2e_2/medium.avif');
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(3);

    const avifSrcset = id => `${variantAvifUrl(id, 'thumb')} 480w, ${variantAvifUrl(id, 'medium')} 1280w`;
    const source = cards.nth(2).locator('picture.media-picture > source[type="image/avif"]');
    await expect(source).toHaveAttribute('srcset', avifSrcset('img_e2e_1'));
    await expect(source).toHaveAttribute('sizes', CARD_IMAGE_SIZES);
    const card = cards.nth(2).locator('picture.media-picture > img.gallery-card-img');
    await expect(card).toHaveAttribute('src', variantUrl('img_e2e_1', 'thumb'));
    // ה-<picture> אינו משנה את הפריסה: התמונה ממלאת את הכרטיס כמו קודם.
    const sizes = await cards.nth(2).evaluate(element => {
        const media = element.querySelector('.gallery-media').getBoundingClientRect();
        const image = element.querySelector('img.gallery-card-img').getBoundingClientRect();
        return { media: [Math.round(media.width), Math.round(media.height)], image: [Math.round(image.width), Math.round(image.height)] };
    });
    expect(sizes.image).toEqual(sizes.media);

    const fallen = cards.nth(1).locator('img.gallery-card-img');
    await expect(fallen).toHaveAttribute('src', mediaUrl('img_e2e_2'));
    await expect.poll(() => fallen.evaluate(element => element.complete && element.naturalWidth)).toBe(MEDIA_SIZE);
    expect(await cards.nth(1).locator('source').getAttribute('srcset')).toBeNull();
    await expect(fallen).toHaveAttribute('srcset', `${mediaUrl('img_e2e_2')} 1x`);

    // התצוגה המלאה: מקור AVIF ב-<picture> שסביב #lightboxImage.
    await cards.nth(2).locator('.gallery-media').click();
    const lightboxSource = page.locator('#lightboxImageAvif');
    await expect(lightboxSource).toHaveAttribute('srcset', avifSrcset('img_e2e_1'));
    await expect(lightboxSource).toHaveAttribute('sizes', '100vw');
    await expect(page.locator('#lightboxImage')).toHaveAttribute('src', variantUrl('img_e2e_1', 'medium'));

    // מעבר לתמונה בלי תצוגות: גם מקור ה-AVIF מתנקה, ומוצג המקור.
    await page.locator('#lightboxModal button[aria-label="התמונה הבאה"]').click();
    await expect(page.locator('#lightboxImage')).toHaveAttribute('src', mediaUrl('img_e2e_3'));
    expect(await lightboxSource.getAttribute('srcset')).toBeNull();
});

test('דפדפן שיודע לקודד AVIF שולח עותק AVIF לצד כל תצוגה, ומסך הניהול מציג את הנפח שנשמר', async ({ page, worker }) => {
    worker.seedGallery();
    // Chromium מפענח AVIF אך אינו מקודד אותו ב-Canvas. כאן מדמים דפדפן שכן:
    // בקשת image/avif מחזירה קובץ קטן מה-WebP עם סוג AVIF.
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
            if (type !== 'image/avif') return original.call(this, callback, type, quality);
            return original.call(this, blob => {
                callback(blob ? new Blob([blob.slice(0, Math.max(1, Math.floor(blob.size / 2)))], { type: 'image/avif' }) : null);
            }, 'image/webp', quality);
        };
    });
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.uploadMediaToR2 === 'function' && Boolean(window.state?.currentUser?.uid));

    const stored = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        return window.uploadMediaToR2(new File([bytes], 'icon.png', { type: 'image/png' }), 'img_avif', 'עם AVIF');
    }, ICON_PNG.toString('base64'));

    for (const name of ['thumb', 'medium']) {
        const key = `variants/img_avif/${name}.avif`;
        expect(stored.variants[name].avif).toEqual({ key, url: variantAvifUrl('img_avif', name), type: 'image/avif' });
        const avifFile = worker.objects.get(key);
        expect(avifFile.contentType).toBe('image/avif');
        expect(avifFile.bytes.length).toBeLessThan(worker.objects.get(`variants/img_avif/${name}.webp`).bytes.length);
    }

    await page.goto('/admin.html#variants');
    await expect(page.locator('#variantsStorage')).toBeVisible();
    await expect(page.locator('#variantsStorage')).toContainText('נשמרו 4 קובצי תצוגה');
    await expect(page.locator('#variantsStorage')).toContainText('WebP: 2');
    await expect(page.locator('#variantsStorage')).toContainText('AVIF: 2');
});
