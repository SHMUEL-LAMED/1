// scripts/maintenance.mjs — התחזוקה שרצה אחרי עיבוד הרקע, באותה ריצה של
// .github/workflows/background-jobs.yml ובאותה הרשאת OIDC (ראו authenticate
// ב-background-jobs.mjs ו-verifyGithubBackgroundToken ב-Worker). אין סוד קבוע.
//
// סדר הצעדים:
//   1. בדיקת /health מבחוץ. Worker שאינו עונה אינו יכול לשלוח מייל על עצמו —
//      ולכן במקרה כזה הריצה נכשלת בהודעה ברורה, ו-GitHub מודיע לבעל המאגר
//      על workflow מתוזמן שנכשל.
//   2. /maintenance/alert-check — מייל אחד למנהלי־העל כשהבדיקה נכשלה או
//      כשהשגיאות בשעה האחרונה עברו את הסף (לכל היותר אחד בשש שעות).
//   3. /maintenance/backup — גיבוי D1 יומי ל-R2 (פעם ביום; אחר כך רק בדיקה).
//   4. /maintenance/trash-purge — מחיקה לצמיתות של מה שבסל יותר מ-30 יום.
//   5. /maintenance/broken-links — צעדים של בדיקת הקישורים השבורים, עד שהסריקה
//      מסתיימת או שהזמן שהוקצב נגמר; הריצה הבאה ממשיכה מהסמן.
//   6. /maintenance/storage-scan — סיכום הנפח היומי (R2 לפי קידומת, גודל D1,
//      עיבודי AI ופנים בחודש) למסך "סטטיסטיקות", באותו דגם של צעדים עם סמן.
//      פעם ביום; בשאר הריצות הקריאה הראשונה עונה "idle" בלי לכתוב דבר.
// Worker ישן, שעדיין אינו מכיר נתיב, מדולג בשקט; כך הפריסה של ה-Worker ושל
// ה-workflow אינה חייבת להיות באותה דקה.
import { pathToFileURL } from 'node:url';
import { authenticate as authenticateBackground } from './background-jobs.mjs';

const HEALTH_ATTEMPTS = 3;
const HEALTH_RETRY_MS = 10000;
const BROKEN_LINKS_MAX_STEPS = 40;
const STORAGE_SCAN_MAX_STEPS = 40;
// קודים שאינם כשל של התחזוקה: Worker ישן, או מכסת כתיבה שתתחדש מעצמה.
const SKIP_CODES = new Set(['background_scope_denied', 'background_write_quota_paused']);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function checkHealth(apiOrigin, { attempts = HEALTH_ATTEMPTS, retryMs = HEALTH_RETRY_MS, sleep = wait } = {}) {
    let last = { ok: false, status: 0, code: 'unreachable' };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(20000) });
            const data = await response.json().catch(() => ({}));
            last = { ok: response.ok && data.success === true, status: response.status, code: String(data.code || '').replace(/[^a-z0-9_]/gi, '').slice(0, 80) };
            if (last.ok) return last;
        } catch (error) {
            last = { ok: false, status: 0, code: error?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
        }
        if (attempt < attempts - 1) await sleep(retryMs);
    }
    return last;
}

export async function runMaintenance({
    apiOrigin = process.env.GALLERY_API_ORIGIN,
    authenticate = authenticateBackground,
    report = console.log,
    sleep = wait,
    budgetMs = 4 * 60 * 1000
} = {}) {
    const deadline = Date.now() + budgetMs;
    const failures = [];
    const health = await checkHealth(apiOrigin, { sleep });
    report(JSON.stringify({ maintenance: 'health', ...health }));
    let token;
    try {
        token = await authenticate(apiOrigin);
    } catch (error) {
        failures.push(`השרת אינו זמין לתהליך התחזוקה (${String(error?.message || 'unknown').slice(0, 160)})`);
        if (!health.ok) failures.unshift(`בדיקת /health נכשלה (סטטוס ${health.status || 'ללא תשובה'}${health.code ? `, ${health.code}` : ''})`);
        return { ok: false, health, failures };
    }
    const post = async (path, body = {}) => {
        const response = await fetch(`${apiOrigin}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5 * 60 * 1000)
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 404 || SKIP_CODES.has(data.code)) return { skipped: data.code || 'not_supported' };
        if (!response.ok) throw Object.assign(new Error(data.code || `http_${response.status}`), { status: response.status });
        return data;
    };
    const step = async (name, run) => {
        try {
            const result = await run();
            report(JSON.stringify({ maintenance: name, ...result }));
            return result;
        } catch (error) {
            failures.push(`${name}: ${String(error?.message || 'failed').slice(0, 120)}`);
            report(JSON.stringify({ maintenance: name, failed: String(error?.message || 'failed').slice(0, 120), status: error?.status || 0 }));
            return null;
        }
    };
    try {
        const alert = await step('alert', () => post('/maintenance/alert-check', { health: { ok: health.ok, status: health.status } }));
        // בלי מפתח דוא״ל ההתראה אינה נשלחת; זה נרשם ביומן הריצה בלבד.
        if (alert?.skipped === 'email_not_configured') report(JSON.stringify({ maintenance: 'alert', note: 'RESEND_API_KEY או EMAIL_FROM אינם מוגדרים ב-Worker; התראה לא נשלחה' }));
        await step('backup', () => post('/maintenance/backup'));
        await step('trash', () => post('/maintenance/trash-purge'));
        await step('broken-links', async () => {
            let result = {};
            for (let steps = 0; steps < BROKEN_LINKS_MAX_STEPS && Date.now() < deadline; steps += 1) {
                result = await post('/maintenance/broken-links');
                if (result.skipped || result.done || result.idle) break;
            }
            return result;
        });
        await step('storage', async () => {
            let result = {};
            for (let steps = 0; steps < STORAGE_SCAN_MAX_STEPS && Date.now() < deadline; steps += 1) {
                result = await post('/maintenance/storage-scan');
                if (result.skipped || result.done || result.idle) break;
            }
            return result;
        });
    } finally {
        token = '';
    }
    if (!health.ok) failures.unshift(`בדיקת /health נכשלה (סטטוס ${health.status || 'ללא תשובה'}${health.code ? `, ${health.code}` : ''})`);
    return { ok: failures.length === 0, health, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    runMaintenance().then(result => {
        if (result.ok) return;
        // ::error:: מופיע כהודעה בולטת בסיכום הריצה; הכישלון עצמו מפעיל את ההודעה של GitHub.
        for (const failure of result.failures) console.error(`::error title=תחזוקת הגלריה::${failure}`);
        process.exitCode = 1;
    }).catch(error => {
        console.error(`::error title=תחזוקת הגלריה::${error.message}`);
        process.exitCode = 1;
    });
}
