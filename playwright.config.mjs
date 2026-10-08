// הגדרות בדיקות הדפדפן (Playwright). הבדיקות עצמן ב-e2e/, והתשתית —
// הזיוף של ה-Worker והתחליפים לסקריפטים החיצוניים — ב-e2e/fixtures.mjs.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT) || 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: 'e2e',
    testMatch: /.*\.spec\.mjs$/,
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        // ה-Service Worker של האתר היה מגיש קוד מהמטמון ומסתיר בקשות מהיירוט.
        serviceWorkers: 'block',
        locale: 'he-IL',
        timezoneId: 'Asia/Jerusalem',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ],
    // שרת סטטי לשורש המאגר, בלי תלות חיצונית. פורט תפוס הוא שגיאה ולא
    // שימוש חוזר, כדי שלא ייבדק בטעות עותק אחר של האתר.
    webServer: {
        command: `node e2e/static-server.mjs ${PORT}`,
        url: `${BASE_URL}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000
    }
});
