// תאריך הצילום והתאריך העברי בגלריה: הכרטיס מציג את התאריך העברי של יום
// הצילום (ובלעדיו — של יום ההעלאה), התצוגה המלאה מציגה אותו עם הלועזי,
// המיון "החדש ביותר" הוא לפי takenAt, ובוררי השנה והחודש העבריים מסננים.
import { test, expect, seedSession, imageRecord, DEFAULT_FOLDERS } from './fixtures.mjs';

const capture = (iso, takenDate) => ({ takenAt: Date.parse(iso), takenDate, takenAtSource: 'exif' });

function seedDatedGallery(worker, folders) {
    worker.seedFolders(folders).seedImages([
        // תמונה 1 הועלתה ראשונה אך צולמה אחרונה — במיון לפי צילום היא ראשונה.
        imageRecord(1, capture('2026-09-28T16:30:00Z', '2026-09-28')),
        imageRecord(2, capture('2024-03-24T10:00:00Z', '2024-03-24')),
        imageRecord(3, capture('2024-02-15T10:00:00Z', '2024-02-15')),
        // תמונה 4 בלי תאריך צילום: התאריך הוא יום ההעלאה (2026-09-01).
        imageRecord(4)
    ]);
}

test('הכרטיסים והתצוגה המלאה מציגים את התאריך העברי של יום הצילום, ממוינים לפי takenAt', async ({ page, worker }) => {
    seedDatedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.locator('.gallery-title')).toHaveText(['תמונה 1', 'תמונה 4', 'תמונה 2', 'תמונה 3']);
    await expect(cards.locator('.gallery-hebrew-date')).toHaveText([
        'י״ז בתשרי תשפ״ז', 'י״ט באלול תשפ״ו', 'י״ד באדר ב׳ תשפ״ד', 'ו׳ באדר א׳ תשפ״ד'
    ]);
    await expect(cards.first().locator('.gallery-hebrew-date')).toHaveAttribute('datetime', '2026-09-28');
    await expect(cards.first().locator('.gallery-hebrew-date')).toHaveAttribute('title', 'צולם ב־28.09.2026');
    await expect(cards.nth(1).locator('.gallery-hebrew-date')).toHaveAttribute('title', 'הועלה ב־01.09.2026');

    // קיבוץ לפי חודש: כל כרטיס כאן פותח חודש עברי אחר.
    await expect(cards.locator('.gallery-date-group')).toHaveText(['תשרי תשפ״ז', 'אלול תשפ״ו', 'אדר ב׳ תשפ״ד', 'אדר א׳ תשפ״ד']);

    // "הישן ביותר" הופך את הסדר, לפי תאריך הצילום.
    await page.locator('#gallerySortSelect').selectOption('oldest');
    await expect(cards.locator('.gallery-title')).toHaveText(['תמונה 3', 'תמונה 2', 'תמונה 4', 'תמונה 1']);
    await page.locator('#gallerySortSelect').selectOption('newest');
    await expect(cards.locator('.gallery-title')).toHaveText(['תמונה 1', 'תמונה 4', 'תמונה 2', 'תמונה 3']);

    await cards.first().locator('.gallery-media').click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await expect(page.locator('#lightboxDetails')).toContainText('צולם בי״ז בתשרי תשפ״ז (28.09.2026)');
    await expect(page.locator('#lightboxDetails')).toContainText('תיקייה: אירועים ופעילויות');
    await page.locator('#lightboxModal button[aria-label="התמונה הבאה"]').click();
    await expect(page.locator('#lightboxDetails')).toContainText('הועלה בי״ט באלול תשפ״ו (01.09.2026)');
});

test('סינון לפי שנה עברית ולפי חודש עברי, כולל אדר א׳ ואדר ב׳', async ({ page, worker }) => {
    seedDatedGallery(worker);
    await seedSession(page, { worker });
    await page.goto('/');

    const cards = page.locator('#photosGrid .gallery-card');
    await expect(cards).toHaveCount(4);
    const year = page.locator('#galleryHebrewYearFilter');
    const month = page.locator('#galleryHebrewMonthFilter');
    await expect(year.locator('option')).toHaveText(['כל השנים', 'תשפ״ז', 'תשפ״ו', 'תשפ״ד']);
    await expect(month.locator('option')).toHaveText(['כל החודשים', 'תשרי', 'אדר א׳', 'אדר ב׳', 'אלול']);

    await year.selectOption({ label: 'תשפ״ד' });
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#imageCounter')).toHaveText('2 פריטים');
    await expect(month.locator('option')).toHaveText(['כל החודשים', 'אדר א׳', 'אדר ב׳']);

    await month.selectOption({ label: 'אדר ב׳' });
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.gallery-title')).toHaveText('תמונה 2');

    // החודש לבדו, בלי שנה.
    await year.selectOption('');
    await expect(cards).toHaveCount(1);
    await month.selectOption({ label: 'תשרי' });
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.gallery-title')).toHaveText('תמונה 1');

    await month.selectOption('');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('#imageCounter')).toHaveText('4 פריטים');
});

test('כותרת האירוע וכרטיס התיקייה מציגים את תאריך האירוע בעברית', async ({ page, worker }) => {
    const folders = DEFAULT_FOLDERS.map(folder => (folder.id === '2' ? { ...folder, isDefault: false, eventDate: '2025-10-15' } : folder));
    seedDatedGallery(worker, folders);
    await seedSession(page, { worker });
    await page.goto('/');

    const folderCard = page.locator('#folderList .collection-card', { hasText: 'טיולים וסיורים' });
    await expect(folderCard.locator('.collection-card-meta')).toHaveText('כ״ג בתשרי תשפ״ו');
    await folderCard.locator('button[aria-label^="פתיחת עמוד האירוע"]').click();
    await expect(page.locator('#eventPageDate')).toHaveText('כ״ג בתשרי תשפ״ו · 15.10.2025');
    await page.keyboard.press('Escape');

    // אירוע בלי תאריך שהוזן: טווח ימי הצילום של הפריטים.
    await page.locator('#folderList .collection-card', { hasText: 'אירועים ופעילויות' }).locator('button[aria-label^="פתיחת עמוד האירוע"]').click();
    await expect(page.locator('#eventPageDate')).toHaveText('צולם בין ו׳ באדר א׳ תשפ״ד לי״ז בתשרי תשפ״ז');
});
