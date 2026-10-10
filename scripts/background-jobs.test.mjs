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
test('background title job also sends titled images that still lack a caption, but never a hand-edited caption or a video', async () => {
    const enabled = { titles: true, faces: false, variants: false, dates: false, drive: false };
    const media = API + '/media/approved/';
    const images = [
        { id: 'untitled', url: media + 'untitled.jpg', r2Key: 'approved/untitled.jpg', mediaType: 'image' },
        { id: 'uncaptioned', url: media + 'uncaptioned.jpg', r2Key: 'approved/uncaptioned.jpg', mediaType: 'image', aiTitleVersion: 1 },
        { id: 'described', url: media + 'described.jpg', r2Key: 'approved/described.jpg', mediaType: 'image', aiTitleVersion: 1, aiCaptionVersion: 1, captionSource: 'ai', caption: 'בחורים רוקדים' },
        { id: 'manual', url: media + 'manual.jpg', r2Key: 'approved/manual.jpg', mediaType: 'image', aiTitleVersion: 1, captionSource: 'manual', caption: 'כיתוב שהמנהל כתב' },
        { id: 'video', url: media + 'video.mp4', r2Key: 'approved/video.mp4', mediaType: 'video' }
    ];
    const described = [];
    globalThis.fetch = async (url, options) => {
        const path = new URL(url).pathname;
        if (path === '/background/config') return Response.json({ config: { enabled, driveFolders: [], intervalMinutes:15 } });
        if (path === '/background/status' && !options.method) return Response.json({ state: {} });
        if (path === '/data/images') return Response.json({ documents: images.map(data => ({ id: data.id, data })) });
        if (path === '/data/pendingImages') return Response.json({ documents: [] });
        if (path === '/face/index/pending') return Response.json({ pending: [] });
        if (path === '/ai-title') { described.push(JSON.parse(options.body).imageId); return Response.json({ title: 'תמונה בעברית' }); }
        if (path === '/background/status') return Response.json({ success: true });
        throw new Error('Unexpected endpoint '+path);
    };
    await runBackgroundJobs({apiOrigin:API,authenticate:async()=> 'scoped-test-token',launchBrowser:()=>{throw new Error('user browser must not be needed');},report:()=>{}});
    assert.deepEqual(described.sort(), ['uncaptioned', 'untitled']);
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
