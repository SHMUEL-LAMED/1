import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackgroundJobs, noteRetry, canRetry } from './background-jobs.mjs';
const API = 'https://simchas-gallery-api.0534169095.workers.dev';
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
test('background title job persists work without opening a browser; paused jobs remain paused', async () => {
    const enabled = { titles: true, faces: false, variants: false, dates: false, drive: false };
    const posts = [];
    const image = { id: 'photo1', url: API+'/media/approved/photo1.jpg', r2Key: 'approved/photo1.jpg', mediaType: 'image' };
    globalThis.fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer scoped-test-token');
        const path = new URL(url).pathname;
        if (path === '/background/config') return Response.json({ config: { enabled, driveFolders: [], intervalMinutes:15 } });
        if (path === '/background/status' && !options.method) return Response.json({ state: {} });
        if (path === '/data/images') return Response.json({ documents: [{ id:image.id,data:image }] });
        if (path === '/data/pendingImages') return Response.json({ documents: [] });
        if (path === '/face/index/pending') return Response.json({ pending: [] });
        if (path === '/ai-title') { image.aiTitleVersion=1; return Response.json({title:'תמונה בעברית'}); }
        if (path === '/background/status') { posts.push(JSON.parse(options.body)); return Response.json({success:true}); }
        throw new Error('Unexpected endpoint '+path);
    };
    await runBackgroundJobs({apiOrigin:API,authenticate:async()=> 'scoped-test-token',launchBrowser:()=>{throw new Error('user browser must not be needed');},report:()=>{}});
    assert.equal(image.aiTitleVersion,1);
    assert.equal(posts.at(-1).phase,'idle');
    assert.equal(posts.at(-1).jobs.titles.processed,1);
    assert.equal(posts.at(-1).jobs.variants.processed,0);
});
test('retry continuation backs off repeatedly and eventually becomes eligible', () => {
    let retry=noteRetry([], 'titles','photo1',1000);
    assert.equal(canRetry(retry,'titles','photo1',2000),false);
    assert.equal(canRetry(retry,'faces','photo1',2000),true);
    retry=noteRetry(retry,'titles','photo1',2000);
    assert.equal(retry[0].attempts,2);
    assert.equal(retry[0].after,1802000);
    assert.equal(canRetry(retry,'titles','photo1',1802000),true);
});
