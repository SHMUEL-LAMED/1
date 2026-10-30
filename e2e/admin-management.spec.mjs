// כלי הניהול החדשים מקצה לקצה: מסך "סטטיסטיקות" (גרפים, טבלה, הנצפים ביותר,
// אחסון ועלויות), פעולה על כמה משתמשים עם חלון אישור ודוח, ייצוא CSV שמנטרל
// נוסחאות, הערות פנימיות, מוני השימוש מהגלריה, והרקע המטושטש בכרטיס, בתצוגה
// המלאה ובריצת ההשלמה.
import { readFileSync } from 'node:fs';
import { test, expect, seedSession, imageRecord, variantEntries, DEFAULT_USER, DAY_MS } from './fixtures.mjs';

const PLACEHOLDER = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
const dayBefore = days => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

test('מסך הסטטיסטיקות: גרפים נגישים, טבלה, הנצפים ביותר ואחסון עם סף', async ({ page, worker }) => {
    worker.seedFolders().seedImages([imageRecord(1, { title: 'הקפה שנייה' }), imageRecord(2, { title: 'ריקוד' })]);
    worker.seed('mediaStats', 'img_e2e_1', { id: 'img_e2e_1', views: 12 }).seed('mediaStats', 'img_e2e_2', { id: 'img_e2e_2', views: 3 });
    worker.usage.days = [
        { day: dayBefore(3), visits: 4, views: 20, downloads: 2, zipDownloads: 1, zipItems: 9, uploads: 5, approvals: 2 },
        { day: dayBefore(1), visits: 7, views: 31, uploads: 1, rejections: 1 }
    ];
    worker.usage.activeUsers = { today: 2, last7: 9, last30: 15 };
    worker.storage.report = {
        completedAt: Date.now() - 3600_000, objects: 1200, bytes: 9 * 1024 ** 3, d1Bytes: 50 * 1024 ** 2,
        byPrefix: { approved: { objects: 400, bytes: 7 * 1024 ** 3 }, variants: { objects: 790, bytes: 2 * 1024 ** 3 } },
        jobs: { month: '2026-10', aiDescriptions: 40, faceIndexed: 55 }
    };
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהלת העל' });
    await page.goto('/admin.html#stats');

    await expect(page.locator('#view-stats')).toHaveClass(/is-active/);
    const charts = page.locator('#statsCharts svg[role="img"]');
    await expect(charts).toHaveCount(4);
    await expect(page.locator('#statsCharts desc').first()).toContainText('ביקורים: 11 בסך הכול; השיא 7');
    // 30 יום — עמודה לכל יום.
    await expect(page.locator('#statsCharts svg').first().locator('rect')).toHaveCount(30);
    await expect(page.locator('#statsActiveUsers')).toContainText('9');
    await page.locator('.stats-table-details summary').click();
    await expect(page.locator('#statsTable tbody tr')).toHaveCount(30);
    await expect(page.locator('#statsTopItems li').first()).toContainText('הקפה שנייה');
    await expect(page.locator('#statsTopFolders li').first()).toContainText('15 צפיות');

    await expect(page.locator('#storageSummary')).toContainText('1200 קבצים');
    await expect(page.locator('#storageTableBody tr')).toHaveCount(6);
    await expect(page.locator('#storageJobs')).toContainText('40');

    // סף: 10GB ואזהרה מ-80% — 9GB הם 90%, והשורה מסומנת.
    await page.locator('#storageR2QuotaGb').fill('10');
    await page.locator('#storageWarnPercent').fill('80');
    await page.getByRole('button', { name: 'שמירת הסף' }).click();
    await expect.poll(() => worker.collection('systemMeta').get('storageBudget')?.r2QuotaGb).toBe(10);
    await expect(page.locator('.storage-quota-line.is-over')).toContainText('90%');

    // שבוע: 90 יום מקובצים לשבועות.
    await page.getByRole('button', { name: '90 יום (לפי שבוע)' }).click();
    await expect.poll(() => worker.requestsTo('GET', '/stats/usage?days=90').length).toBe(1);
    await expect(page.getByRole('button', { name: '90 יום (לפי שבוע)' })).toHaveAttribute('aria-pressed', 'true');
});

test('מנהל רגיל אינו רואה את מסך הסטטיסטיקות ואינו פונה לנתיבים שלו', async ({ page, worker }) => {
    worker.seedGallery({ images: 1 });
    await seedSession(page, { worker, role: 'admin' });
    await page.goto('/admin.html#stats');
    await expect(page.locator('#sidebarAdminPanel')).toBeVisible();
    await expect(page.locator('#adminNav [data-view-target="stats"]')).toHaveCount(0);
    await expect(page.locator('#view-stats')).not.toHaveClass(/is-active/);
    expect(worker.requestsTo('GET', '/stats/usage')).toHaveLength(0);
    expect(worker.requestsTo('GET', '/maintenance/storage')).toHaveLength(0);
});

test('פעולה על כמה משתמשים: חלון אישור עם שמות, בלי החשבון שלך, ודוח לכל משתמש', async ({ page, worker }) => {
    worker.seedGallery();
    worker.seedUser({ uid: 'u-pending-1', email: 'p1@example.com', name: 'רבקה ממתינה', status: 'pending' });
    worker.seedUser({ uid: 'u-pending-2', email: 'p2@example.com', name: 'שמעון ממתין', status: 'pending' });
    worker.seedUser({ uid: 'u-viewer', email: 'v@example.com', name: 'לאה צופה' });
    worker.seedUser({ uid: 'u-blocked', email: 'b@example.com', name: 'חסום כבר', status: 'blocked' });
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהלת העל' });
    await page.goto('/admin.html#users');

    await expect(page.locator('#managedUsersList [data-uid] .user-bulk-checkbox').first()).toBeVisible();
    // החשבון שלך אינו ניתן לבחירה, ואין בו כפתור הערות.
    const selfCard = page.locator(`#managedUsersList [data-uid="${DEFAULT_USER.uid}"]`);
    await expect(selfCard.locator('.user-bulk-checkbox')).toBeDisabled();
    await expect(selfCard.locator('.user-notes-button')).toHaveCount(0);

    await page.locator('#pendingUsersList [data-uid="u-pending-1"] .user-bulk-checkbox').check();
    await page.locator('#pendingUsersList [data-uid="u-pending-2"] .user-bulk-checkbox').check();
    await page.locator('#managedUsersList [data-uid="u-viewer"] .user-bulk-checkbox').check();
    await expect(page.locator('#usersBulkCount')).toHaveText('נבחרו 3 משתמשים');
    await page.locator('#usersBulkRole').selectOption('uploader');
    await page.getByRole('button', { name: 'אישור בדרגה שנבחרה' }).click();

    const dialog = page.locator('#confirmModal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#confirmMessage')).toContainText('רבקה ממתינה');
    await expect(page.locator('#confirmMessage')).toContainText('שמעון ממתין');
    await expect(page.locator('#confirmMessage')).toContainText('לאה צופה — אינו ממתין לאישור');
    await page.locator('#confirmApproveBtn').click();

    await expect(page.locator('#usersBulkResult')).toContainText('2 הצליחו');
    const [request] = worker.requestsTo('POST', '/admin/users/batch');
    expect(JSON.parse(request.body)).toEqual({ action: 'approve', role: 'uploader', uids: ['u-pending-1', 'u-pending-2'] });
    expect(worker.collection('userProfiles').get('u-pending-1')).toMatchObject({ status: 'approved', role: 'uploader' });
    expect(worker.collection('userProfiles').get('u-viewer').status).toBe('approved');

    // חסימה של משתמש שכבר חסום — אין מי שמתאים, ושום בקשה אינה נשלחת.
    await page.locator('#managedUsersList [data-uid="u-blocked"] .user-bulk-checkbox').check();
    await page.locator('[data-users-bulk-action="block"]').click();
    await expect(page.locator('#usersBulkResult')).toContainText('חסום כבר — כבר חסום');
    expect(worker.requestsTo('POST', '/admin/users/batch')).toHaveLength(1);
});

test('ייצוא CSV של המשתמשים מנטרל נוסחאות', async ({ page, worker }) => {
    worker.seedGallery();
    worker.seedUser({ uid: 'u-evil', email: 'evil@example.com', name: '=HYPERLINK("http://evil.example","x")' });
    await seedSession(page, { worker, role: 'super_admin' });
    await page.goto('/admin.html#users');
    await expect(page.locator('#managedUsersList [data-uid="u-evil"]')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ייצוא CSV' }).click();
    const text = readFileSync(await (await downloadPromise).path(), 'utf8');
    expect(text.split('\r\n')[0]).toBe('﻿"שם","דוא״ל","דרגה","סטטוס","נוצר"');
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")","evil@example.com"`);
    expect(text).not.toMatch(/(^|,)"=/m);
});

test('הערות פנימיות: נשמרות ונטענות, ומשתמש אינו רואה הערות על עצמו', async ({ page, worker }) => {
    worker.seedGallery();
    worker.seedUser({ uid: 'u-viewer', email: 'v@example.com', name: 'לאה צופה' });
    await seedSession(page, { worker, role: 'super_admin', name: 'מנהלת העל' });
    await page.goto('/admin.html#users');

    await page.locator('#managedUsersList [data-uid="u-viewer"] .user-notes-button').click();
    await expect(page.locator('#userNotesModal')).toBeVisible();
    await expect(page.locator('#userNotesTitle')).toHaveText('הערות פנימיות: לאה צופה');
    await expect(page.locator('#userNotesList')).toContainText('אין עדיין הערות');
    await page.locator('#userNoteInput').fill('ביקשה גישה לתיקיית הילדים\nלבדוק מול ההורים');
    await page.getByRole('button', { name: 'שמירת ההערה' }).click();
    await expect(page.locator('#userNotesList .user-note-body')).toHaveText('ביקשה גישה לתיקיית הילדים\nלבדוק מול ההורים');
    await expect(page.locator('#userNotesList')).toContainText('מנהלת העל');
    await page.getByRole('button', { name: 'סגירת ההערות' }).click();
    await expect(page.locator('#userNotesModal')).toBeHidden();

    // השרת המזויף אוכף את הכלל: מי שההערה עליו אינו קורא אותה, גם כשהוא מנהל.
    worker.seedUser({ uid: 'u-viewer', email: 'v@example.com', name: 'לאה צופה', role: 'admin' });
    const own = await page.evaluate(async api => {
        const token = 'v1.' + btoa(JSON.stringify({ sub: 'u-viewer', email: 'v@example.com', name: 'x', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '') + '.sig';
        const response = await fetch(`${api}/admin/user-notes?uid=u-viewer`, { headers: { Authorization: `Bearer ${token}` } });
        return { status: response.status, body: await response.text() };
    }, 'https://simchas-gallery-api-staging.0534169095.workers.dev');
    expect(own.status).toBe(403);
    expect(own.body).not.toContain('ביקשה');
});

test('מוני השימוש: דיווח אחד מצטבר מהגלריה, עם הצפייה שנפתחה', async ({ page, worker }) => {
    worker.seedGallery({ images: 2 });
    await page.clock.install();
    await seedSession(page, { worker });
    await page.goto('/');
    await expect(page.locator('#photosGrid .gallery-card')).toHaveCount(2);
    await page.locator('#photosGrid .gallery-card .gallery-media').first().click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    await page.clock.fastForward(9000);
    await expect.poll(() => worker.usage.beacons.length).toBe(1);
    expect(worker.usage.beacons[0]).toMatchObject({ uid: DEFAULT_USER.uid, visit: true, counts: { views: 1 } });
    // אין עוד דיווח לפני עשר דקות, גם כשעוברים לפריט נוסף.
    await page.clock.fastForward(60_000);
    expect(worker.usage.beacons).toHaveLength(1);
    const body = JSON.parse(worker.requestsTo('POST', '/stats/beacon')[0].body);
    expect(Object.keys(body)).toEqual(['counts']);
});

test('רקע מטושטש: מתחת לתמונת הכרטיס עד שהיא נטענת, ורק כשהוא תקין', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { placeholder: PLACEHOLDER }),
        imageRecord(2, { placeholder: 'javascript:alert(1)' })
    ]);
    await seedSession(page, { worker });
    await page.goto('/');
    const withPlaceholder = page.locator('#photosGrid [data-media-id="img_e2e_1"] .gallery-media');
    await expect(withPlaceholder).toHaveClass(/has-placeholder/);
    expect(await withPlaceholder.evaluate(node => node.style.getPropertyValue('--media-placeholder'))).toBe(`url("${PLACEHOLDER}")`);
    await expect(withPlaceholder).toHaveClass(/is-loaded/);
    // אחרי הטעינה הרקע שקוף; אין קפיצה — המסגרת זהה לכרטיס בלי רקע.
    await expect.poll(() => withPlaceholder.evaluate(node => getComputedStyle(node, '::before').opacity)).toBe('0');
    const invalid = page.locator('#photosGrid [data-media-id="img_e2e_2"] .gallery-media');
    await expect(invalid).not.toHaveClass(/has-placeholder/);
    const [first, second] = await Promise.all([withPlaceholder, invalid].map(locator => locator.evaluate(node => node.getBoundingClientRect().height)));
    expect(Math.abs(first - second)).toBeLessThan(0.5);

    // בתצוגה המלאה: הרקע מתחת להשתקפות שבאולם.
    await withPlaceholder.click();
    await expect(page.locator('#lightboxModal')).toBeVisible();
    expect(await page.locator('#lightboxBackdrop').evaluate(node => node.style.backgroundImage)).toContain('data:image/webp');
});

test('ההעלאה שומרת רקע מטושטש, וריצת ההשלמה מוסיפה אותו לפריטים שכבר יש להם תצוגות', async ({ page, worker }) => {
    worker.seedFolders().seedImages([
        imageRecord(1, { variants: variantEntries('img_e2e_1'), variantsVersion: 1 }),
        imageRecord(2, { variants: variantEntries('img_e2e_2'), variantsVersion: 1, placeholder: PLACEHOLDER }),
        imageRecord(3)
    ]);
    await seedSession(page, { worker, role: 'admin', name: 'מנהל הגלריה' });
    await page.goto('/admin.html#variants');
    await expect(page.locator('#placeholdersSummary')).toContainText('1 פריטים עם תצוגות עדיין בלי רקע מטושטש');
    await page.getByRole('button', { name: 'השלם רקע מטושטש' }).click();
    await expect(page.locator('#placeholdersStatusText')).toHaveText('ההשלמה הסתיימה: 1 פריטים קיבלו רקע מטושטש, 0 נכשלו.');
    const requests = worker.requestsTo('POST', '/media/variants');
    expect(requests).toHaveLength(1);
    // רק השדה נשלח — בלי קובצי תצוגה.
    expect(requests[0].body).toContain('name="placeholder"');
    expect(requests[0].body).not.toContain('name="variant_thumb"');
    const saved = worker.collection('images').get('img_e2e_1').placeholder;
    expect(saved).toMatch(/^data:image\/bmp;base64,Qk/);
    expect(saved.length).toBeLessThanOrEqual(300);
    expect(worker.collection('images').get('img_e2e_2').placeholder).toBe(PLACEHOLDER);
    // פריט בלי תצוגות אינו נכלל: ריצת התצוגות תיצור את שניהם יחד.
    expect(worker.collection('images').get('img_e2e_3').placeholder).toBeUndefined();

    // העלאה חדשה מייצרת את הרקע באותו פענוח, והוא חוזר מה-Worker לרשומה.
    const stored = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 40;
        const context = canvas.getContext('2d');
        context.fillStyle = '#1e3a8a';
        context.fillRect(0, 0, 64, 40);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        return window.uploadMediaToR2(new File([blob], 'blue.jpg', { type: 'image/jpeg' }), 'img_blue', 'כחולה');
    });
    expect(stored.placeholder).toMatch(/^data:image\/bmp;base64,Qk/);
    // 64×40 → רשת של 8×5.
    const bmp = Buffer.from(stored.placeholder.split(',')[1], 'base64');
    expect([bmp.readInt32LE(18), bmp.readInt32LE(22)]).toEqual([8, 5]);
});
