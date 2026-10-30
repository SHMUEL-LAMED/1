// scripts/maintenance.mjs: הסדר, הדילוג על Worker ישן, והכישלון הברור כשהשרת
// אינו עונה (GitHub מודיע לבעל המאגר על ריצה מתוזמנת שנכשלה).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMaintenance, checkHealth } from './maintenance.mjs';

const API = 'https://simchas-gallery-api.0534169095.workers.dev';
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const quiet = () => {};
const noSleep = async () => {};

test('ריצה תקינה: בדיקה, התראה, גיבוי, סל המחזור, קישורים שבורים וסריקת האחסון עד הסוף', async () => {
    const calls = [];
    let brokenSteps = 0;
    let storageSteps = 0;
    globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        calls.push(`${options.method || 'GET'} ${path}`);
        if (path === '/health') return Response.json({ success: true });
        assert.equal(options.headers.Authorization, 'Bearer bg1.test');
        if (path === '/maintenance/alert-check') {
            assert.deepEqual(JSON.parse(options.body), { health: { ok: true, status: 200 } });
            return Response.json({ success: true, alerted: false, reasons: [] });
        }
        if (path === '/maintenance/backup') return Response.json({ success: true, created: true });
        if (path === '/maintenance/trash-purge') return Response.json({ success: true, purged: 0 });
        if (path === '/maintenance/broken-links') { brokenSteps += 1; return Response.json({ success: true, done: brokenSteps === 3 }); }
        if (path === '/maintenance/storage-scan') { storageSteps += 1; return Response.json({ success: true, done: storageSteps === 2 }); }
        throw new Error(`unexpected ${path}`);
    };
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => 'bg1.test', report: quiet, sleep: noSleep });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls.slice(0, 4), ['GET /health', 'POST /maintenance/alert-check', 'POST /maintenance/backup', 'POST /maintenance/trash-purge']);
    assert.equal(brokenSteps, 3);
    assert.equal(storageSteps, 2);
    // הסריקה היומית של האחסון באה אחרי הקישורים השבורים.
    assert.ok(calls.lastIndexOf('POST /maintenance/broken-links') < calls.indexOf('POST /maintenance/storage-scan'));
});

test('סריקת האחסון שכבר רצה היום עונה idle אחרי קריאה אחת', async () => {
    let storageCalls = 0;
    globalThis.fetch = async url => {
        const path = new URL(url).pathname;
        if (path === '/health') return Response.json({ success: true });
        if (path === '/maintenance/storage-scan') { storageCalls += 1; return Response.json({ success: true, idle: true, done: true }); }
        return Response.json({ success: true, done: true });
    };
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => 'bg1.test', report: quiet, sleep: noSleep });
    assert.equal(result.ok, true);
    assert.equal(storageCalls, 1);
});

test('Worker ישן שאינו מכיר את הנתיבים: מדלגים בלי להכשיל את הריצה', async () => {
    globalThis.fetch = async url => {
        const path = new URL(url).pathname;
        if (path === '/health') return Response.json({ success: true });
        return Response.json({ success: false, code: 'background_scope_denied' }, { status: 403 });
    };
    const logs = [];
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => 'bg1.test', report: line => logs.push(JSON.parse(line)), sleep: noSleep });
    assert.equal(result.ok, true);
    assert.ok(logs.some(entry => entry.maintenance === 'backup' && entry.skipped === 'background_scope_denied'));
});

test('בלי מפתח דוא״ל: ההתראה נרשמת ביומן הריצה בלבד', async () => {
    globalThis.fetch = async url => {
        const path = new URL(url).pathname;
        if (path === '/health') return Response.json({ success: true });
        if (path === '/maintenance/alert-check') return Response.json({ success: true, alerted: false, reasons: ['errors'], skipped: 'email_not_configured' });
        return Response.json({ success: true, done: true });
    };
    const logs = [];
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => 'bg1.test', report: line => logs.push(line), sleep: noSleep });
    assert.equal(result.ok, true);
    assert.ok(logs.some(line => line.includes('RESEND_API_KEY')));
});

test('השרת אינו עונה: הריצה נכשלת עם הסבר, בלי לנסות לשלוח מייל', async () => {
    const calls = [];
    globalThis.fetch = async url => { calls.push(new URL(url).pathname); throw new TypeError('fetch failed'); };
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => { throw new Error('Background endpoint unavailable'); }, report: quiet, sleep: noSleep });
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /\/health/);
    assert.ok(result.failures.some(line => /Background endpoint unavailable/.test(line)));
    assert.ok(!calls.includes('/maintenance/alert-check'));
});

test('/health שנכשל כשהשרת עדיין עונה: ההתראה נשלחת, והריצה מסומנת ככושלת', async () => {
    let alertBody;
    globalThis.fetch = async (url, options = {}) => {
        const path = new URL(url).pathname;
        if (path === '/health') return Response.json({ success: false, code: 'database_schema_unavailable' }, { status: 500 });
        if (path === '/maintenance/alert-check') { alertBody = JSON.parse(options.body); return Response.json({ success: true, alerted: true }); }
        if (path === '/maintenance/backup') return Response.json({ success: false, code: 'internal_error' }, { status: 500 });
        return Response.json({ success: true, done: true });
    };
    const result = await runMaintenance({ apiOrigin: API, authenticate: async () => 'bg1.test', report: quiet, sleep: noSleep });
    assert.deepEqual(alertBody, { health: { ok: false, status: 500 } });
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /database_schema_unavailable/);
    assert.ok(result.failures.some(line => line.startsWith('backup:')));
});

test('checkHealth מנסה שוב לפני שהוא קובע שהשרת נפל', async () => {
    let attempts = 0;
    globalThis.fetch = async () => { attempts += 1; return attempts < 3 ? new Response('down', { status: 503 }) : Response.json({ success: true }); };
    assert.deepEqual(await checkHealth(API, { sleep: noSleep }), { ok: true, status: 200, code: '' });
    assert.equal(attempts, 3);
});
