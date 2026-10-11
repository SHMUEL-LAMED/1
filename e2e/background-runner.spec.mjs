import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { runBackgroundJobs } from '../scripts/background-jobs.mjs';
const API = 'https://simchas-gallery-api.0534169095.workers.dev';
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
test('cloud image runtime creates real variants and persists them through authenticated API', async () => {
    const enabled={titles:false,faces:false,variants:true,dates:false,drive:false};
    const image={id:'photo1',url:API+'/media/approved/photo1.png',r2Key:'approved/photo1.png',mediaType:'image'};
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    let parts;
    globalThis.fetch=async(url,options={})=>{
        if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url,options);
        const path=new URL(url).pathname;
        if(path==='/background/config')return Response.json({config:{enabled,driveFolders:[],intervalMinutes:15}});
        if(path==='/background/status')return Response.json(options.method?{success:true}:{state:{}});
        if(path==='/data/images')return Response.json({documents:[{id:image.id,data:image}]});
        if(path==='/data/pendingImages')return Response.json({documents:[]});
        if(path==='/face/index/pending')return Response.json({pending:[]});
        if(path=== '/media/approved/photo1.png')return new Response(png,{headers:{'Content-Type':'image/png','Transfer-Encoding':'chunked'}});
        if(path==='/media/variants'){
            parts=options.body;
            return Response.json({variants:{thumb:{url:API+'/media/variants/photo1/thumb.webp'},medium:{url:API+'/media/variants/photo1/medium.webp'}}});
        }
        throw new Error('Unexpected endpoint '+path);
    };
    await runBackgroundJobs({apiOrigin:API,authenticate:async()=> 'scoped-token',report:()=>{}});
    assert.ok(parts instanceof FormData,'real image must decode and produce variant upload');
    assert.equal(parts.get('imageId'),'photo1');
    assert.ok(parts.get('variant_thumb').size>0);
    assert.ok(parts.get('variant_medium').size>0);
});
