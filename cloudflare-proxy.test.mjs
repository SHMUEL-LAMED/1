import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapGalleryProxy } from './cloudflare-worker.js';
const target = 'https://simchas-gallery-api.smwlyqswkwt232.workers.dev/health';
const original = 'https://simchas-gallery-api.0534169095.workers.dev/health';
const valid = overrides => new Request(target, { headers: {
  'x-gallery-proxy-auth': 'test-private-secret', 'x-gallery-proxy-url': original,
  'x-gallery-proxy-credentials': btoa(JSON.stringify({ OPENAI_API_KEY: 'private-api-key', GALLERY_DB: 'untrusted', SESSION_SIGNING_SECRET: 'untrusted' })), ...overrides
} });
test('proxy rejects credentials without the shared secret', () => {
  assert.equal(unwrapGalleryProxy(valid({ 'x-gallery-proxy-auth': 'wrong' }), { GALLERY_PROXY_SECRET: 'test-private-secret', PUBLIC_API_ORIGIN: 'https://simchas-gallery-api.0534169095.workers.dev' }).response.status, 403);
  assert.equal(unwrapGalleryProxy(valid(), {}).response.status, 403);
});
test('proxy forwards only provider credentials and preserves origin and database bindings', () => {
  const db = {}; const result = unwrapGalleryProxy(valid(), { GALLERY_PROXY_SECRET: 'test-private-secret', PUBLIC_API_ORIGIN: 'https://simchas-gallery-api.0534169095.workers.dev', GALLERY_DB: db });
  assert.equal(result.request.url, original); assert.equal(result.env.OPENAI_API_KEY, 'private-api-key');
  assert.equal(result.env.GALLERY_DB, db); assert.equal(result.env.SESSION_SIGNING_SECRET, undefined);
  assert.equal([...result.request.headers.keys()].some(x => x.startsWith('x-gallery-proxy-')), false);
});
test('proxy rejects an unexpected original URL or changed path', () => {
  const env = { GALLERY_PROXY_SECRET: 'test-private-secret', PUBLIC_API_ORIGIN: 'https://simchas-gallery-api.0534169095.workers.dev' };
  assert.equal(unwrapGalleryProxy(valid({ 'x-gallery-proxy-url': 'https://example.org/health' }), env).response.status, 403);
  assert.equal(unwrapGalleryProxy(valid({ 'x-gallery-proxy-url': original.replace('/health', '/upload') }), env).response.status, 403);
});
test('direct requests keep the original environment', () => {
  const request = new Request(target);const env = {};const result = unwrapGalleryProxy(request,env);
  assert.equal(result.request,request);assert.equal(result.env,env);
});

test('gateway keeps session authorization and streams uploads while replacing spoofed credentials', async () => {
  const { default: gateway, PAID_GALLERY_API_ORIGIN } = await import('./cloudflare-proxy.js');
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async request => { forwarded = request; return new Response('ok'); };
  try {
    const request = new Request('https://simchas-gallery-api.0534169095.workers.dev/upload?file=1', {
      method: 'POST', headers: { Authorization: 'Bearer user-session', 'x-gallery-proxy-auth': 'spoofed', 'x-gallery-proxy-credentials': 'spoofed' }, body: 'image-body', duplex: 'half'
    });
    const response = await gateway.fetch(request, { GALLERY_PROXY_SECRET: 'real-secret', OPENAI_API_KEY: 'provider-secret' });
    assert.equal(await response.text(), 'ok');
    assert.equal(new URL(forwarded.url).origin, PAID_GALLERY_API_ORIGIN);
    assert.equal(forwarded.headers.get('Authorization'), 'Bearer user-session');
    assert.equal(forwarded.headers.get('x-gallery-proxy-auth'), 'real-secret');
    assert.deepEqual(JSON.parse(atob(forwarded.headers.get('x-gallery-proxy-credentials'))), { OPENAI_API_KEY: 'provider-secret' });
    assert.equal(await forwarded.text(), 'image-body');
  } finally { globalThis.fetch = originalFetch; }
});
