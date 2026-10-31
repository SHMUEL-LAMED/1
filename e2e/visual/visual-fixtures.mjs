// e2e/visual/visual-fixtures.mjs — התשתית של בדיקות הרגרסיה החזותית.
//
// נשען על e2e/fixtures.mjs (הזיוף של ה-Worker, חסימת הרשת, איסוף שגיאות הדף)
// ומוסיף את מה שצילום מסך יציב צריך:
// - שעון קבוע: page.clock.install בתאריך קבוע, כך ש"היום", "עודכן לפני…"
//   והתאריך העברי זהים בכל ריצה;
// - נתונים קבועים: תיקיות, תמונות ופריטים ממתינים עם חותמות זמן קבועות (גם
//   פרופיל המשתמש, שהזיוף זורע בדרך כלל לפי השעה הנוכחית);
// - תמונות קבועות: קובצי PNG שנוצרים בזיכרון בצבע ובגודל שנגזרים מהמספר
//   הסידורי, ונשמרים ב-R2 המדומה של הזיוף;
// - אייקונים: במקום lucide מה-CDN, תחליף מקומי שמצייר לכל אייקון אותו ריבוע
//   SVG בגודל של האייקון האמיתי — הפריסה נשמרת ואין תלות ברשת;
// - גופנים: Google Fonts נחסם תמיד (כמו בבדיקות הרגילות), ולכן הטקסט מצויר
//   בגופן החלופי של המערכת. ב-CI זו תמיד אותה מכונה (ubuntu-latest), וכך גם הבסיס;
// - ערכת נושא: theme ('light' / 'dark') נכתבת ל-localStorage לפני שהדף נטען.
import { test as base, expect, seedSession, makePng, DEFAULT_USER, API_ORIGIN } from '../fixtures.mjs';

// 14 בספטמבר 2026, 10:00 שעון ישראל — אחרי כל חותמות הזמן של הנתונים.
export const FIXED_NOW = Date.UTC(2026, 8, 14, 7, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

// lucide בגרסה מקומית: כל <i data-lucide> הופך ל-<svg> עם אותן תכונות
// ומחלקות, בגודל 24 כברירת מחדל (מחלקות w-4 h-4 וכו' דורסות אותו כמו באתר).
const LUCIDE_VISUAL_STUB = `(() => {
    const NS = 'http://www.w3.org/2000/svg';
    function replace(element) {
        const name = element.getAttribute('data-lucide') || '';
        const svg = document.createElementNS(NS, 'svg');
        for (const attr of Array.from(element.attributes)) svg.setAttribute(attr.name, attr.value);
        svg.setAttribute('class', ['lucide', 'lucide-' + name, element.getAttribute('class') || ''].join(' ').trim());
        svg.setAttribute('xmlns', NS);
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        if (!svg.hasAttribute('aria-hidden')) svg.setAttribute('aria-hidden', 'true');
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', '4'); rect.setAttribute('y', '4');
        rect.setAttribute('width', '16'); rect.setAttribute('height', '16'); rect.setAttribute('rx', '4');
        svg.appendChild(rect);
        element.replaceWith(svg);
    }
    window.lucide = {
        icons: {},
        createIcons() {
            document.querySelectorAll('i[data-lucide]').forEach(replace);
        }
    };
})();`;

// תמונה בגודל ובצבע שנגזרים מהמספר: לרוחב, לגובה וריבוע, בגוונים שונים.
const PALETTE = [
    [196, 154, 108], [92, 134, 168], [148, 116, 170], [104, 156, 120],
    [208, 120, 96], [70, 96, 140], [180, 168, 92], [132, 132, 140]
];
// גדולות מספיק כדי שהתצוגה המלאה תציג תמונה ולא נקודה; צבע אחיד נדחס היטב.
const SHAPES = [[480, 320], [320, 480], [400, 400], [480, 270]];

export function visualMedia(index) {
    const [width, height] = SHAPES[index % SHAPES.length];
    return makePng(width, height, PALETTE[index % PALETTE.length]);
}

export const VISUAL_FOLDERS = [
    { id: 'all', name: 'כל התמונות', icon: 'grid', isDefault: true, order: 0 },
    { id: '1', name: 'אירועים ופעילויות', icon: 'calendar', isDefault: true, order: 1 },
    { id: '2', name: 'טיולים וסיורים', icon: 'compass', isDefault: true, order: 2 },
    { id: '3', name: 'הווי ומפגשים', icon: 'users', isDefault: true, order: 3 },
    { id: '4', name: 'כללי', icon: 'home', isDefault: true, order: 4 }
];

const TITLES = [
    'הדלקת נרות', 'ריקודים באולם', 'טיול לגליל', 'שיעור ערב', 'מסיבת סיום',
    'סעודת שבת', 'הקפות שניות', 'סיור בירושלים', 'מפגש בוגרים', 'ערב שירה',
    'בניית סוכה', 'תמונה קבוצתית'
];
const FOLDER_OF = ['1', '1', '2', '3', '1', '3', '1', '2', '3', '4', '1', '4'];

// הגלריה הקבועה: 12 תמונות בארבע התיקיות, אחת לכל יומיים לפני "היום".
export function visualImages() {
    return TITLES.map((title, index) => {
        const id = `img_vis_${index + 1}`;
        const createdAt = FIXED_NOW - (TITLES.length - index) * 2 * DAY;
        const key = `approved/${DEFAULT_USER.uid}/${id}.png`;
        const [width, height] = SHAPES[index % SHAPES.length];
        return {
            id,
            folderId: FOLDER_OF[index],
            title,
            url: `${API_ORIGIN}/media/${key}`,
            r2Key: key,
            r2OwnerUid: DEFAULT_USER.uid,
            r2Stored: true,
            mediaType: 'image',
            mimeType: 'image/png',
            originalSize: 2048 + index * 512,
            width: width * 4,
            height: height * 4,
            uploadedBy: DEFAULT_USER.uid,
            uploadedByName: DEFAULT_USER.name,
            date: new Date(createdAt).toISOString().split('T')[0],
            createdAt
        };
    });
}

export function visualPending() {
    const uploader = { uid: 'google-uploader-1', name: 'שרה לוי', email: 'sarah@example.com' };
    return ['ערב חנוכה', 'טיול שנתי', 'שמחת תורה'].map((title, index) => {
        const id = `pending_vis_${index + 1}`;
        const createdAt = FIXED_NOW - (3 - index) * 60 * 60 * 1000;
        const key = `pending/${uploader.uid}/${id}.png`;
        return {
            id,
            title,
            url: `${API_ORIGIN}/media/${key}`,
            r2Key: key,
            r2OwnerUid: uploader.uid,
            r2Stored: true,
            mediaType: 'image',
            mimeType: 'image/png',
            originalSize: 4096,
            originalFolderName: 'הקפות',
            status: 'pending',
            uploadedBy: uploader.uid,
            uploadedByName: uploader.name,
            uploadedByEmail: uploader.email,
            date: new Date(createdAt).toISOString().split('T')[0],
            createdAt
        };
    });
}

function storeMedia(worker, records, offset = 0) {
    records.forEach((record, index) => {
        worker.objects.set(record.r2Key, { bytes: visualMedia(index + offset), contentType: 'image/png', metadata: {} });
    });
}

// פרופיל בחותמות זמן קבועות (seedUser של הזיוף משתמש בשעה הנוכחית).
function seedFixedProfile(worker, { uid, email, name, role, status = 'approved' }) {
    const requestedAt = FIXED_NOW - 30 * DAY;
    worker.seed('userProfiles', uid, {
        uid, email, displayName: name, photoURL: '', status, role, requestedAt,
        lastLoginAt: FIXED_NOW - DAY,
        ...(status === 'approved' ? { approvedAt: requestedAt + DAY, approvedBy: 'e2e-admin' } : {})
    });
}

// זורע את הגלריה הקבועה ומחבר משתמש. מחזיר את רשומות התמונות.
export async function seedVisualGallery(page, worker, { role = 'viewer', name = DEFAULT_USER.name, pending = false } = {}) {
    worker.seedFolders(VISUAL_FOLDERS);
    const images = visualImages();
    worker.seedImages(images);
    storeMedia(worker, images);
    if (pending) {
        const records = visualPending();
        for (const record of records) worker.seed('pendingImages', record.id, record);
        storeMedia(worker, records, 5);
        seedFixedProfile(worker, { uid: 'google-uploader-1', email: 'sarah@example.com', name: 'שרה לוי', role: 'uploader' });
        seedFixedProfile(worker, { uid: 'google-pending-1', email: 'new@example.com', name: 'יוסף מזרחי', role: 'viewer', status: 'pending' });
    }
    await seedSession(page, { worker, role, name });
    seedFixedProfile(worker, { uid: DEFAULT_USER.uid, email: DEFAULT_USER.email, name, role });
    return images;
}

// מחכה שהדף יתייצב לפני צילום: אין בקשות פתוחות, הגופנים (החלופיים) מוכנים,
// כל תמונה שנראית במסך (גם lazy) נטענה ופוענחה, וה-DOM לא השתנה 300ms.
export async function settle(page) {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForFunction(() => Array.from(document.images).every(image => {
        if (!image.getAttribute('src')) return true;
        const box = image.getBoundingClientRect();
        const inView = box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
            box.top < window.innerHeight && box.left < window.innerWidth;
        return !inView || image.complete;
    }), null, { timeout: 15_000 });
    await page.evaluate(() => Promise.all(Array.from(document.images)
        .filter(image => image.complete && image.naturalWidth)
        .map(image => image.decode().catch(() => {}))).then(() => undefined));
    await page.evaluate(() => new Promise(resolve => {
        let timer = setTimeout(done, 300);
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 300); });
        function done() { observer.disconnect(); resolve(); }
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        // תקרה: דף שמשתנה כל הזמן ייכשל בהשוואה עצמה, לא כאן.
        setTimeout(done, 5_000);
    }));
    await page.waitForLoadState('networkidle');
    // שתי מסגרות ציור, כדי שכל שינוי פריסה אחרון כבר צויר.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// הסגנון שנוסף רק בזמן הצילום (toHaveScreenshot stylePath): בלי סרגלי גלילה,
// שתלויים בפלטפורמה, ובלי סמן ההקלדה.
const SCREENSHOT_CSS = new URL('./screenshot.css', import.meta.url).pathname;

// צילום מסך מול הבסיס. mask מכסה אזורים שמשתנים בכל זאת (תאריך ושעה).
export async function snap(page, name, { mask = [], fullPage = false } = {}) {
    await settle(page);
    // צילום של מסך מטושטש (backdrop-filter) ברוחב מלא איטי במכונה עמוסה.
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage, mask, stylePath: SCREENSHOT_CSS, timeout: 30_000 });
}

export const test = base.extend({
    theme: ['dark', { option: true }],
    device: ['desktop', { option: true }],

    context: async ({ context }, use) => {
        // נרשם אחרי installRoutes של fixtures.mjs, ולכן קודם לו: lucide מקומי.
        await context.route(url => url.hostname === 'unpkg.com', route => route.fulfill({
            status: 200, contentType: 'text/javascript; charset=utf-8', body: LUCIDE_VISUAL_STUB
        }));
        await use(context);
    },

    page: async ({ page, theme }, use) => {
        await page.clock.install({ time: FIXED_NOW });
        // ערכת הנושא, ו"ראיתי את העדכונים" נכון ל"עכשיו" הקבוע — כדי שבאנר
        // "יש עדכונים בגלריה!" לא יכסה חלק מהמסך (יש לו בדיקות משלו).
        await page.addInitScript(([value, seenKey, seenAt]) => {
            try {
                localStorage.setItem('simchat-color-theme', value);
                localStorage.setItem(seenKey, String(seenAt));
            } catch { /* אחסון חסום */ }
        }, [theme, `yeshiva_last_seen_update:${DEFAULT_USER.uid}`, FIXED_NOW]);
        await use(page);
    }
});

export { expect };
