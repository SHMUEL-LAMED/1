// אינדוקס הפנים בתהליך הרקע: לצד הטביעות נשלח גם מיקום כל פרצוף בתמונה,
// ואחרי האינדוקס הקיבוץ לאנשים ממשיך עד שלא נותרו פרצופים שלא קובצו.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackgroundJobs } from './background-jobs.mjs';

const API = 'https://simchas-gallery-api.0534169095.workers.dev';
const BOX = { x: 0.2, y: 0.1, w: 0.1, h: 0.2, a: 1.5 };
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('אינדוקס בענן שולח טביעות ומיקומים, ומקבץ עד הסוף רק כשאינדוקס הפנים פעיל', async () => {
    const image = { id: 'photo1', url: `${API}/media/approved/photo1.jpg`, r2Key: 'approved/photo1.jpg', mediaType: 'image', takenAtSource: 'exif' };
    const indexed = [];
    const clusterRuns = [];
    let enabled = { titles: false, faces: true, variants: false, dates: false, drive: false };
    globalThis.fetch = async (url, options = {}) => {
        if (String(url).startsWith('http://127.0.0.1:8081/')) return new Response('ok');
        const path = new URL(url).pathname;
        if (path === '/background/config') return Response.json({ config: { enabled, driveFolders: [], intervalMinutes: 15 } });
        if (path === '/background/status') return Response.json(options.method ? { success: true } : { state: {} });
        if (path === '/data/images') return Response.json({ documents: [{ id: image.id, data: image }] });
        if (path === '/data/pendingImages') return Response.json({ documents: [] });
        if (path === '/face/index/pending') return Response.json({ pending: [image.id] });
        if (path === '/face/index') { indexed.push(JSON.parse(options.body)); return Response.json({ success: true }); }
        if (path === '/face/clusters/run') {
            clusterRuns.push(path);
            return Response.json(clusterRuns.length === 1 ? { processed: 150, remaining: 20 } : { processed: 20, remaining: 0 });
        }
        throw new Error(`Unexpected endpoint ${path}`);
    };
    const page = {
        async route() {},
        async goto() {},
        async evaluate(fn) {
            if (!String(fn).includes('detectAllFaces')) return undefined;
            return { faces: [new Array(128).fill(0.08)], boxes: [BOX] };
        }
    };
    const launchBrowser = async () => ({ newPage: async () => page, close: async () => {} });

    await runBackgroundJobs({ apiOrigin: API, authenticate: async () => 'scoped-test-token', launchBrowser, report: () => {} });
    assert.equal(indexed.length, 1);
    assert.deepEqual(indexed[0].images[0].boxes, [BOX]);
    assert.equal(indexed[0].images[0].faces.length, 1);
    assert.equal(clusterRuns.length, 2, 'הקיבוץ נמשך עד שלא נותרו פרצופים');

    // אינדוקס פנים מושהה: אין אינדוקס ואין קיבוץ.
    enabled = { ...enabled, faces: false };
    indexed.length = 0;
    clusterRuns.length = 0;
    await runBackgroundJobs({ apiOrigin: API, authenticate: async () => 'scoped-test-token', launchBrowser, report: () => {} });
    assert.equal(indexed.length, 0);
    assert.equal(clusterRuns.length, 0);
});
