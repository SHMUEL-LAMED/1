// Keep the existing OAuth callback and API URL while storage and processing run
// in the paid account. Credentials remain in the existing Cloudflare secrets.
export const PAID_GALLERY_API_ORIGIN = 'https://simchas-gallery-api.smwlyqswkwt232.workers.dev';
export default {
  async fetch(request, env) {
    if (!env.GALLERY_PROXY_SECRET) return new Response('Gateway unavailable', { status: 503 });
    const original = new URL(request.url);
    const target = new URL(original.pathname + original.search, PAID_GALLERY_API_ORIGIN);
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) if (name.startsWith('x-gallery-proxy-')) headers.delete(name);
    headers.set('x-gallery-proxy-auth', env.GALLERY_PROXY_SECRET);
    headers.set('x-gallery-proxy-url', original.href);
    const credentials = {};
    for (const name of ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'OPENAI_API_KEY']) {
      if (typeof env[name] === 'string' && env[name]) credentials[name] = env[name];
    }
    headers.set('x-gallery-proxy-credentials', btoa(JSON.stringify(credentials)));
    return fetch(new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      ...(request.body ? { duplex: 'half' } : {}),
      redirect: 'manual'
    }));
  }
};
