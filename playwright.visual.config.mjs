// הגדרות בדיקות הרגרסיה החזותית (צילומי מסך). קובץ נפרד מ-playwright.config.mjs,
// כדי שהריצה הרגילה של npm run test:e2e לא תאסוף את e2e/visual/*.visual.mjs,
// ולהפך: כאן רצים רק קובצי .visual.mjs. ההסבר המלא ב-README, "בדיקות חזותיות".
//
// הצילומים תלויים בגרסת Chromium ובגופני המערכת, ולכן הבסיס (baselines) נוצר
// ונבדק רק ב-GitHub Actions (.github/workflows/visual.yml) — באותו Chromium
// ש-npx playwright install מוריד שם. ריצה מקומית מול בסיס של CI תיכשל כמעט
// תמיד; מקומית מריצים לתיקיות זמניות (VISUAL_SNAPSHOT_DIR / VISUAL_OUTPUT_DIR).
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT) || 8090;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// כמו בהגדרות הרגילות: בלי locale של UTF-8 Chromium משבש שמות קבצים עבריים.
const hasUtf8Locale = /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '');
const browserEnv = process.platform === 'linux' && !hasUtf8Locale
    ? { ...process.env, LC_ALL: 'C.UTF-8' }
    : undefined;

// דפדפן אחר מזה ש-Playwright מוריד (למשל בקונטיינר בלי הורדות): נתיב מפורש.
const executablePath = process.env.VISUAL_CHROMIUM_PATH || undefined;

const launchOptions = {
    ...(browserEnv ? { env: browserEnv } : {}),
    ...(executablePath ? { executablePath } : {}),
    // רינדור יציב: בלי האצת GPU ובלי החלקת גופנים שתלויה במסך.
    args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb']
};

const resolveDir = (value, fallback) => (value ? path.resolve(value) : fallback);

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

// ארבעה פרויקטים: מחשב וטלפון, כל אחד במצב בהיר ובמצב כהה. האפשרות theme
// מוגדרת ב-e2e/visual/visual-fixtures.mjs וכותבת את הבחירה ל-localStorage.
const projects = [];
for (const [device, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    for (const theme of ['light', 'dark']) {
        projects.push({
            name: `${device}-${theme}`,
            use: { ...devices['Desktop Chrome'], ...size, colorScheme: theme, theme, device }
        });
    }
}

export default defineConfig({
    testDir: 'e2e/visual',
    testMatch: /.*\.visual\.mjs$/,
    // הבסיס נשמר במאגר תחת e2e/visual/__screenshots__/<קובץ>/<פרויקט>/<שם>.png —
    // בלי סיומת מערכת ההפעלה, כי הוא נוצר תמיד על ubuntu-latest של Actions.
    snapshotDir: resolveDir(process.env.VISUAL_SNAPSHOT_DIR, 'e2e/visual/__screenshots__'),
    snapshotPathTemplate: '{snapshotDir}/{testFileName}/{projectName}/{arg}{ext}',
    outputDir: resolveDir(process.env.VISUAL_OUTPUT_DIR, 'test-results/visual'),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    // צילום שנכשל אינו "מתוקן" בניסיון חוזר: הבדל הוא הבדל.
    retries: 0,
    workers: process.env.CI ? 2 : undefined,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            // סף סביר להחלקת קצוות; שינוי עיצוב אמיתי עובר אותו בהרבה.
            // VISUAL_STRICT=1 (לבדיקת יציבות מקומית) דורש התאמה של כל פיקסל.
            ...(process.env.VISUAL_STRICT === '1'
                ? { maxDiffPixels: 0, threshold: 0 }
                : { maxDiffPixelRatio: 0.01, threshold: 0.2 })
        }
    },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/visual' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        serviceWorkers: 'block',
        locale: 'he-IL',
        timezoneId: 'Asia/Jerusalem',
        reducedMotion: 'reduce',
        trace: 'off',
        screenshot: 'off',
        launchOptions
    },
    projects,
    webServer: {
        command: `node e2e/static-server.mjs ${PORT}`,
        url: `${BASE_URL}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000
    }
});
