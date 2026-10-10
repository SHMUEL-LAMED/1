import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('./.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const scripts = [...workflow.matchAll(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/g)]
    .map(match => match[1].split('\n').map(line => line.slice(10)).join('\n').replace(/^import .*;\n/gm, ''));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const environment = { CLOUDFLARE_WORKER_NAME: 'gallery', CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'mock', GITHUB_SHA: 'sha', DEPLOY_TARGET: 'production' };
const quiet = { log() {} };
const processMock = { env: environment, exit() { throw new Error('exit'); } };
const response = result => Response.json({ success: true, result });

test('deployment inherits every binding from the active version using the supported API', async () => {
    let metadata;
    const prepare = new AsyncFunction('writeFileSync', 'fetch', 'process', 'console', scripts[0]);
    await prepare((path, value) => { metadata = JSON.parse(value); }, async url => {
        if (url.endsWith('/deployments')) return response({ deployments: [{ created_on: '2026-10-10', versions: [{ version_id: 'active-version', percentage: 100 }] }] });
        if (url.endsWith('/versions/active-version')) return response({ resources: { bindings: [{ name: 'GALLERY_DB' }, { name: 'GALLERY_BUCKET' }, { name: 'OPENAI_API_KEY' }] } });
        throw new Error(`unexpected ${url}`);
    }, processMock, quiet);
    assert.ok(metadata.bindings.every(binding => binding.version_id === 'active-version'));
    let uploaded = false;
    let deployed = false;
    const deploy = new AsyncFunction('readFileSync', 'fetch', 'process', 'console', scripts[1]);
    await deploy(path => path === 'worker-metadata.json' ? JSON.stringify(metadata) : Buffer.from('export default {}'), async (url, init) => {
        if (url.includes('/workers/workers/gallery/versions')) {
            const payload = JSON.parse(init.body);
            assert.equal(payload.modules[0].content_type, 'application/javascript+module');
            assert.equal(Buffer.from(payload.modules[0].content_base64, 'base64').toString(), 'export default {}');
            assert.deepEqual(payload.bindings, metadata.bindings);
            uploaded = true;
            return response({ id: 'new-version', bindings: metadata.bindings });
        }
        assert.ok(uploaded);
        assert.equal(JSON.parse(init.body).versions[0].version_id, 'new-version');
        deployed = true;
        return response({});
    }, processMock, quiet);
    assert.ok(deployed);
});

test('a missing binding in the upload response prevents deployment', async () => {
    const metadata = { bindings: [{ name: 'GALLERY_DB', type: 'inherit', version_id: 'active-version' }] };
    let calls = 0;
    const deploy = new AsyncFunction('readFileSync', 'fetch', 'process', 'console', scripts[1]);
    await assert.rejects(() => deploy(path => path === 'worker-metadata.json' ? JSON.stringify(metadata) : Buffer.from('export default {}'), async () => {
        calls += 1;
        return response({ id: 'new-version', bindings: [] });
    }, processMock, quiet), /refusing to deploy/);
    assert.equal(calls, 1);
});
