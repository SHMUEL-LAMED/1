// scripts/measure-first-load.mjs — מדידת הטעינה הראשונה של דף הגלריה.
//
// מה נמדד: כמה זמן מתחילת הניווט עד שתמונת הכרטיס הראשונה ברשת נטענה
// ("הציור המשמעותי הראשון" של הגלריה), ומה ירד לפניה — מספר הבקשות והבתים.
// לצדה: תמונת הפסיפס הראשונה (בטלפון הרשת מתחת למסך, והפסיפס הוא התמונה
// הראשונה שרואים), הצבע הראשון (FCP), LCP, DOMContentLoaded וסך הזזות הפריסה (CLS).
//
// איך: Chromium אמיתי טוען את האתר הבנוי (dist/, כמו ש-pages.yml פורס אותו)
// משרת סטטי שדוחס ב-gzip כמו GitHub Pages, כמשתמש מאושר שכבר התחבר. ה-Worker
// הוא אותו זיוף של בדיקות הדפדפן (FakeWorker מ-e2e/fixtures.mjs), אבל כאן הוא
// אינו מיורט בתוך הדפדפן: הוא יושב מאחורי שרת HTTP/2 מקומי, והדפדפן מגיע אליו
// בחיבור אמיתי (--host-resolver-rules ממפה את שם ה-Worker אליו). רק כך אפשר
// למדוד את מה שקורה בשכבת החיבור — preconnect ועדיפויות של HTTP/2.
//
// מודל הרשת (זהה בכל ריצה, כדי שההשוואה בין גרסאות תהיה הוגנת):
//   - CDP מוסיף לכל בקשה זמן הלוך־חזור (--rtt).
//   - חיבור חדש ל-Worker מושהה ב-3 זמני הלוך־חזור (DNS, TCP ו-TLS) בשרת ביניים.
//   - רוחב הפס (--down) משותף לאתר ול-Worker. ב---network=priority (ברירת
//     המחדל) הקישור שולח קודם את הזרם בעדיפות הגבוהה ביותר, לפי עדיפויות
//     HTTP/2 שהדפדפן שולח (כולל העלאת העדיפות של תמונה שנראית במסך) — כמו
//     ש-Cloudflare מכבד אותן. ב---network=fair כל הבקשות חולקות את הפס שווה
//     בשווה (ההגבלה של CDP), כמו שרת שאינו מכבד עדיפויות.
//   - הסקריפטים והגופנים של צד שלישי (lucide, Google, Google Fonts) מוחלפים
//     בתחליפים של הבדיקות, אבל מגיעים אחרי ההשהיה שהגרסה האמיתית הייתה גובה:
//     חיבור חדש, הלוך־חזור והגודל הדחוס האמיתי שלהם ברוחב הפס של המודל.
//   - תמונות המדיה מרופדות לגודל של תצוגה מקדימה אמיתית (--image-kb).
//   - המעבד מואט פי --cpu, כמו טלפון ממוצע.
//
// שימוש (אחרי npm run build):
//   node scripts/measure-first-load.mjs [--root=dist] [--runs=7] [--viewport=desktop|phone]
//        [--network=priority|fair] [--rtt=150] [--down=1600] [--cpu=4] [--images=60] [--image-kb=40] [--json]
// PLAYWRIGHT_CHROMIUM=/path/to/chromium בוחר דפדפן אחר מזה של Playwright,
// ו-FIRST_LOAD_DEBUG=1 מדפיס את ציר הזמן של כל הבקשות בכל ריצה.
//
// המספרים יחסיים למודל ולמכונה: הם נועדו להשוות גרסה לגרסה באותה סביבה, לא
// לחזות זמני טעינה אמיתיים בטלפון של מבקר.
import http from 'node:http';
import http2 from 'node:http2';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import {
    FakeWorker, seedSession, imageRecord, variantEntries, API_ORIGIN, STAGING_API_ORIGIN
} from '../e2e/fixtures.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEBUG = Boolean(process.env.FIRST_LOAD_DEBUG);

export function parseArgs(argv) {
    const options = {
        root: 'dist', runs: 7, viewport: 'desktop', network: 'priority',
        rtt: 150, down: 1600, cpu: 4, images: 60, imageKb: 40, json: false
    };
    for (const arg of argv) {
        const [, key, value = 'true'] = /^--([a-z-]+)(?:=(.*))?$/.exec(arg) || [];
        if (!key) continue;
        const name = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (!(name in options)) throw new Error(`אפשרות לא מוכרת: --${key}`);
        options[name] = typeof options[name] === 'number' ? Number(value) : (typeof options[name] === 'boolean' ? value !== 'false' : value);
    }
    if (!['priority', 'fair'].includes(options.network)) throw new Error(`--network לא מוכר: ${options.network}`);
    return options;
}

// הגודל הדחוס האמיתי של הקבצים החיצוניים (נמדד מול השרתים שלהם), כדי
// שהתחליף יגיע אחרי אותה השהיה שהקובץ האמיתי היה גובה.
const THIRD_PARTY = [
    { host: 'unpkg.com', bytes: 97_605, type: 'text/javascript; charset=utf-8', body: 'window.lucide = { createIcons() {} };' },
    { host: 'accounts.google.com', bytes: 102_317, type: 'text/javascript; charset=utf-8', body: `window.google = { accounts: { id: {
        initialize(config) { window.__gisConfig = config; }, renderButton() {}, prompt() {}, cancel() {}, disableAutoSelect() {}, revoke() {}, storeCredential() {}
    }, oauth2: { initTokenClient() { return { requestAccessToken() {} }; }, initCodeClient() { return { requestCode() {} }; }, hasGrantedAllScopes() { return false; }, revoke() {} } } };` },
    { host: 'fonts.googleapis.com', bytes: 1_617, type: 'text/css; charset=utf-8', body: '' }
];

const API_HOSTS = [new URL(API_ORIGIN).hostname, new URL(STAGING_API_ORIGIN).hostname];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transferMs = (bytes, kbps) => (bytes * 8) / kbps;

const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon']
]);

// משקלי HTTP/2 ש-Chromium שולח לכל רמת עדיפות (HIGHEST..IDLE).
const H2_WEIGHT = { highest: 256, medium: 220, low: 183, lowest: 147 };

// הקישור הצר: kbps משותפים לכל התשובות של שני השרתים. בכל פעימה נשלח הזרם
// בעדיפות הגבוהה ביותר, ובעדיפות שווה — מי שהגיע קודם (כמו שרשרת התלות
// הבלעדית ש-Chromium בונה ב-HTTP/2). ב-fair הקישור אינו מגביל, וההגבלה
// היא של CDP.
export function createLink({ kbps, limited = true }) {
    const bytesPerMs = kbps / 8;
    const queue = [];
    let timer = null;
    let last = 0;
    let credit = 0;
    let seq = 0;
    const pump = () => {
        const now = performance.now();
        credit += (now - last) * bytesPerMs;
        last = now;
        while (credit >= 1 && queue.length) {
            let best = queue[0];
            for (const entry of queue) {
                if (entry.weight() > best.weight() || (entry.weight() === best.weight() && entry.seq < best.seq)) best = entry;
            }
            const size = Math.min(Math.floor(credit), best.body.length - best.offset, 16_384);
            best.write(best.body.subarray(best.offset, best.offset + size));
            best.offset += size;
            credit -= size;
            if (best.offset >= best.body.length) {
                best.end();
                queue.splice(queue.indexOf(best), 1);
            }
        }
        timer = queue.length ? setTimeout(pump, 4) : null;
        if (!queue.length) credit = 0;
    };
    return {
        send({ body, weight, write, end }) {
            if (!limited) { write(body); end(); return; }
            queue.push({ body, weight, write, end, offset: 0, seq: seq++ });
            if (!timer) { last = performance.now(); timer = setTimeout(pump, 0); }
        }
    };
}

// שרת סטטי כמו GitHub Pages: gzip לקבצי טקסט ו-max-age של עשר דקות.
function startStaticServer(root, link) {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        let file = path.join(root, path.posix.normalize(decodeURIComponent(url.pathname)));
        if (!file.startsWith(root)) { response.writeHead(403); response.end(); return; }
        try {
            if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        } catch { /* ייבדק בקריאה */ }
        let body;
        try { body = fs.readFileSync(file); } catch { response.writeHead(404); response.end(); return; }
        const type = MIME_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
        const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=600' };
        if (/^(?:text\/|application\/(?:json|manifest))/.test(type) && /gzip/.test(request.headers['accept-encoding'] || '')) {
            body = zlib.gzipSync(body);
            headers['Content-Encoding'] = 'gzip';
        }
        headers['Content-Length'] = body.length;
        response.writeHead(200, headers);
        // HTTP/1.1 בלי עדיפויות: המסמך וה-CSS כמו HIGHEST, הסקריפטים כמו MEDIUM.
        const weight = /html|css/.test(type) ? H2_WEIGHT.highest : (/javascript/.test(type) ? H2_WEIGHT.medium : H2_WEIGHT.low);
        link.send({ body, weight: () => weight, write: chunk => response.write(chunk), end: () => response.end() });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// תעודה זמנית ל-HTTPS המקומי (הדפדפן מופעל עם --ignore-certificate-errors).
function makeCertificate(dir) {
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// ה-Worker המזויף מאחורי HTTP/2: FakeWorker.handle מקבל route של Playwright,
// וכאן נבנה אובייקט באותה צורה מבקשה של Node. תמונה מרופדת לגודל אמיתי
// (PNG מתעלם ממה שאחרי IEND), ו-JSON נדחס כמו ב-Cloudflare. העדיפות של כל
// זרם נקראת בכל פעימה של הקישור, כך שהעלאת עדיפות באמצע ההורדה נכנסת לתוקף.
function startApiServer(worker, { certificate, imageBytes, link }) {
    const server = http2.createSecureServer({ ...certificate, allowHTTP1: true }, async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !name.startsWith(':')));
        const host = request.headers[':authority'] || request.headers.host || new URL(API_ORIGIN).host;
        const fullUrl = `https://${String(host).replace(/:\d+$/, '')}${request.url}`;
        const stream = request.stream;
        let weight = stream?.state?.weight || H2_WEIGHT.low;
        stream?.on?.('priority', (parent, nextWeight) => { weight = nextWeight; });
        const route = {
            request: () => ({
                url: () => fullUrl,
                method: () => request.method,
                headers: () => headers,
                postData: () => (body.length ? body.toString('utf8') : null),
                postDataBuffer: () => (body.length ? body : null),
                postDataJSON: () => JSON.parse(body.toString('utf8') || 'null')
            }),
            fulfill: async ({ status = 200, headers: responseHeaders = {}, contentType, body: responseBody = '' }) => {
                const out = { ...responseHeaders };
                if (contentType) out['Content-Type'] = contentType;
                let payload = Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(String(responseBody));
                const type = String(out['Content-Type'] || '');
                // כותרות המטמון של המדיה כמו ב-Worker (serveMedia): תצוגה מקדימה
                // נשמרת לשנה, המקור לשעה. הזיוף של הבדיקות שולח no-store.
                if (status === 200 && request.url.startsWith('/media/variants/')) out['Cache-Control'] = 'public, max-age=31536000, immutable';
                else if (status === 200 && request.url.startsWith('/media/approved/')) out['Cache-Control'] = 'public, max-age=3600, s-maxage=86400';
                if (/^image\//.test(type) && request.url.startsWith('/media/') && payload.length < imageBytes) {
                    payload = Buffer.concat([payload, Buffer.alloc(imageBytes - payload.length)]);
                } else if (/json|javascript/.test(type) && /gzip/.test(headers['accept-encoding'] || '')) {
                    payload = zlib.gzipSync(payload);
                    out['Content-Encoding'] = 'gzip';
                }
                out['Content-Length'] = payload.length;
                response.writeHead(status, out);
                link.send({ body: payload, weight: () => weight, write: chunk => response.write(chunk), end: () => response.end() });
            },
            abort: async () => response.destroy()
        };
        try {
            await worker.handle(route);
        } catch (error) {
            response.writeHead(500);
            response.end(String(error?.message || error));
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// שרת ביניים שמשהה כל חיבור חדש ב-setupMs לפני שהוא מעביר אותו הלאה:
// ה-ClientHello מחכה, ולכן לחיצת היד של TLS מסתיימת רק אחרי ההשהיה. חיבור
// שנפתח מראש (preconnect) משלם אותה ברקע, ובקשה שמגיעה אחריו אינה משלמת.
function startConnectionDelayProxy(targetPort, setupMs) {
    const server = net.createServer(client => {
        if (DEBUG) console.error(`[connect] ${Date.now()}`);
        client.pause();
        setTimeout(() => {
            const upstream = net.connect(targetPort, '127.0.0.1', () => {
                client.pipe(upstream);
                upstream.pipe(client);
                client.resume();
            });
            const close = () => { client.destroy(); upstream.destroy(); };
            upstream.on('error', close);
            client.on('error', close);
        }, setupMs);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// נרשם בדף לפני כל קוד של האתר.
function installPageProbe() {
    const probe = { firstCard: null, firstHero: null, fcp: null, lcp: null, cls: 0, shifts: [], domContentLoaded: null };
    window.__firstLoad = probe;
    document.addEventListener('load', event => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        if (probe.firstCard === null && target.classList.contains('gallery-card-img') && target.closest('#photosGrid')) probe.firstCard = performance.now();
        if (probe.firstHero === null && target.closest('#heroMosaic')) probe.firstHero = performance.now();
    }, true);
    document.addEventListener('DOMContentLoaded', () => { probe.domContentLoaded = performance.now(); });
    try {
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') probe.fcp = entry.startTime;
        }).observe({ type: 'paint', buffered: true });
        new PerformanceObserver(list => {
            const entries = list.getEntries();
            if (!entries.length) return;
            const last = entries[entries.length - 1];
            probe.lcp = last.startTime;
            // מה נבחר כ-LCP, לציר הזמן של FIRST_LOAD_DEBUG.
            const node = last.element;
            probe.lcpElement = node ? `${node.nodeName}${node.id ? `#${node.id}` : ''}${node.className ? `.${String(node.className).split(' ')[0]}` : ''} ${last.size}` : '';
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue;
                probe.cls += entry.value;
                // מה זז, לציר הזמן של FIRST_LOAD_DEBUG.
                probe.shifts.push({
                    at: Math.round(entry.startTime),
                    value: Number(entry.value.toFixed(4)),
                    sources: (entry.sources || []).map(source => {
                        const node = source.node;
                        const name = node?.id ? `#${node.id}` : (node?.className ? `.${String(node.className).split(' ')[0]}` : node?.nodeName || '?');
                        return `${name} ${Math.round(source.previousRect.y)}→${Math.round(source.currentRect.y)} h${Math.round(source.previousRect.height)}→${Math.round(source.currentRect.height)}`;
                    })
                });
            }
        }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* דפדפן בלי PerformanceObserver */ }
}

const VIEWPORTS = {
    desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
};

function seedWorker(count) {
    const worker = new FakeWorker();
    worker.seedFolders();
    // כמו בייצור אחרי ריצת ההשלמה: לכל תמונה יש thumb ו-medium.
    worker.seedImages(Array.from({ length: count }, (_, index) => {
        const record = imageRecord(index + 1);
        return { ...record, width: 1600, height: 1067, variants: variantEntries(record.id), variantsVersion: 1 };
    }));
    return worker;
}

// כל ריצה בפרופיל חדש וריק (מטמון קר). פרופיל רגיל ולא browser.newContext():
// הקשר של newContext הוא פרופיל גלישה בסתר, ו-Chromium אינו מבצע בו
// <link rel="preconnect"> כלל — המדידה הייתה מתעלמת מהרמזים.
async function measureOnce({ launchOptions, siteUrl, options, worker }) {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-load-profile-'));
    const context = await chromium.launchPersistentContext(profileDir, {
        ...launchOptions,
        ...VIEWPORTS[options.viewport],
        locale: 'he-IL',
        timezoneId: 'Asia/Jerusalem',
        serviceWorkers: 'allow'
    });
    try {
        // צד שלישי: התחליף מגיע אחרי ההשהיה של הקובץ האמיתי. כל מקור חיצוני
        // אחר (גופנים מ-gstatic וכדומה) נחסם, כמו בבדיקות. ה-Worker אינו מיורט.
        const isLocal = url => url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        const isApi = url => API_HOSTS.includes(url.hostname);
        await context.route(url => !isLocal(url) && !isApi(url), route => route.abort('blockedbyclient'));
        const connected = new Set();
        for (const entry of THIRD_PARTY) {
            await context.route(url => url.hostname === entry.host, async route => {
                const setup = connected.has(entry.host) ? 0 : 3 * options.rtt;
                connected.add(entry.host);
                await sleep(setup + options.rtt + transferMs(entry.bytes, options.down));
                await route.fulfill({ status: 200, contentType: entry.type, body: entry.body });
            });
        }

        const page = context.pages()[0] || await context.newPage();
        if (DEBUG) {
            page.on('console', message => { if (message.type() === 'error') console.error('[console]', message.text()); });
            page.on('requestfailed', request => console.error('[failed]', request.url(), request.failure()?.errorText));
        }
        await seedSession(page, { worker });
        await page.addInitScript(installPageProbe);

        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: options.rtt,
            // ב-priority הפס מוגבל בקישור של השרתים, ולא כאן.
            downloadThroughput: options.network === 'fair' ? (options.down * 1000) / 8 : -1,
            uploadThroughput: options.network === 'fair' ? (750 * 1000) / 8 : -1
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });

        // כל בקשה: מתי יצאה, מתי הסתיימה ומה גודלה ברשת. הזמנים של CDP מונוטוניים,
        // ומתורגמים לזמן הדף לפי בקשת המסמך (wallTime מול timestamp).
        const requests = new Map();
        let clock = null;
        cdp.on('Network.requestWillBeSent', event => {
            if (!clock && event.type === 'Document') clock = { wall: event.wallTime * 1000, mono: event.timestamp * 1000 };
            if (!requests.has(event.requestId)) requests.set(event.requestId, { url: event.request.url, start: event.timestamp * 1000, end: null, bytes: 0 });
        });
        cdp.on('Network.loadingFinished', event => {
            const entry = requests.get(event.requestId);
            if (entry) { entry.end = event.timestamp * 1000; entry.bytes = event.encodedDataLength; }
        });

        if (DEBUG) console.error(`[goto] ${Date.now()}`);
        await page.goto(`${siteUrl}?api=production`, { waitUntil: 'commit' });
        await page.waitForFunction(() => window.__firstLoad?.firstCard !== null && window.__firstLoad?.firstHero !== null, null, { timeout: 90_000, polling: 50 });
        // שנייה וחצי נוספות: LCP ו-CLS ממשיכים להתעדכן אחרי התמונה הראשונה.
        await sleep(1500);
        const probe = await page.evaluate(() => ({ ...window.__firstLoad, timeOrigin: performance.timeOrigin }));

        const firstCardWall = probe.timeOrigin + probe.firstCard;
        const toWall = mono => clock.wall + (mono - clock.mono);
        const before = [...requests.values()].filter(entry => entry.end !== null && toWall(entry.end) <= firstCardWall);
        if (DEBUG) {
            const relative = mono => (mono === null ? '     —' : (toWall(mono) - probe.timeOrigin).toFixed(0).padStart(6));
            for (const entry of [...requests.values()].sort((a, b) => a.start - b.start)) {
                if (entry.url.startsWith('data:')) continue;
                console.error(`${relative(entry.start)} → ${relative(entry.end)}  ${String(Math.round(entry.bytes / 1024)).padStart(4)}KB  ${entry.url.slice(0, 110)}`);
            }
            console.error('probe', JSON.stringify(probe));
        }
        return {
            firstCard: probe.firstCard,
            firstHero: probe.firstHero,
            fcp: probe.fcp,
            lcp: probe.lcp,
            cls: probe.cls,
            domContentLoaded: probe.domContentLoaded,
            requestsBefore: before.length,
            kbBefore: before.reduce((sum, entry) => sum + entry.bytes, 0) / 1024
        };
    } finally {
        await context.close();
        fs.rmSync(profileDir, { recursive: true, force: true });
    }
}

export function median(values) {
    const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(results) {
    const keys = ['firstCard', 'firstHero', 'fcp', 'lcp', 'domContentLoaded', 'cls', 'requestsBefore', 'kbBefore'];
    return Object.fromEntries(keys.map(key => {
        const values = results.map(result => result[key]).filter(value => Number.isFinite(value));
        return [key, { median: median(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }];
    }));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!VIEWPORTS[options.viewport]) throw new Error(`viewport לא מוכר: ${options.viewport}`);
    // כמה תיקיות מופרדות בפסיק נמדדות לסירוגין, ריצה מכל אחת בתורה: עומס
    // משתנה על המכונה פוגע בכולן באותה מידה, וההשוואה ביניהן נשארת הוגנת.
    const roots = String(options.root).split(',').map(entry => entry.trim()).filter(Boolean).map(entry => path.resolve(REPO_ROOT, entry));
    for (const root of roots) {
        if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`${root}/index.html אינו קיים (הורץ npm run build?)`);
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-load-'));
    const link = createLink({ kbps: options.down, limited: options.network === 'priority' });
    const staticServers = [];
    const results = new Map(roots.map(root => [root, []]));
    let apiServer;
    let proxy;
    try {
        for (const root of roots) staticServers.push(await startStaticServer(root, link));
        const certificate = makeCertificate(tempDir);
        // כל ריצה מקבלת Worker נקי, ולכן השרת מפנה לזה של הריצה הנוכחית.
        const current = { worker: null };
        apiServer = await startApiServer({ handle: route => current.worker.handle(route) }, {
            certificate, imageBytes: options.imageKb * 1024, link
        });
        proxy = await startConnectionDelayProxy(apiServer.address().port, 3 * options.rtt);
        const proxyPort = proxy.address().port;
        const launchOptions = {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
            args: [
                `--host-resolver-rules=${API_HOSTS.map(host => `MAP ${host} 127.0.0.1:${proxyPort}`).join(', ')}`,
                '--ignore-certificate-errors',
                // ה-Worker ממופה לשרת המקומי; פרוקסי של הסביבה היה עוקף את המיפוי.
                '--no-proxy-server'
            ]
        };
        for (let run = 0; run < options.runs; run += 1) {
            for (const [index, root] of roots.entries()) {
                current.worker = seedWorker(options.images);
                const siteUrl = `http://127.0.0.1:${staticServers[index].address().port}/`;
                const result = await measureOnce({ launchOptions, siteUrl, options, worker: current.worker });
                results.get(root).push(result);
                if (!options.json) {
                    console.log(`ריצה ${run + 1} · ${path.basename(root)}: כרטיס ${result.firstCard.toFixed(0)}ms, פסיפס ${result.firstHero.toFixed(0)}ms, `
                        + `${result.requestsBefore} בקשות, ${result.kbBefore.toFixed(0)}KB, CLS ${result.cls.toFixed(3)}`);
                }
            }
        }
    } finally {
        apiServer?.close();
        proxy?.close();
        for (const server of staticServers) server.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const summaries = roots.map(root => ({ root, summary: summarize(results.get(root)), results: results.get(root) }));
    if (options.json) {
        console.log(JSON.stringify({ options, summaries }, null, 2));
        return;
    }
    const format = (value, digits = 0) => (value === null ? '—' : value.toFixed(digits));
    console.log(`\n${options.viewport} · ${options.network} · RTT ${options.rtt}ms · ${options.down}kbps · CPU ×${options.cpu} · ${options.runs} ריצות (חציון [מינ׳–מקס׳])`);
    for (const [key, label, digits] of [
        ['firstCard', 'תמונת הכרטיס הראשונה (ms)', 0],
        ['firstHero', 'תמונת הפסיפס הראשונה (ms)', 0],
        ['fcp', 'FCP (ms)', 0],
        ['lcp', 'LCP (ms)', 0],
        ['domContentLoaded', 'DOMContentLoaded (ms)', 0],
        ['cls', 'CLS', 3],
        ['requestsBefore', 'בקשות לפני הכרטיס הראשון', 0],
        ['kbBefore', 'KB לפני הכרטיס הראשון', 0]
    ]) {
        const cells = summaries.map(({ root, summary }) => {
            const entry = summary[key];
            return `${path.basename(root)} ${format(entry.median, digits)} [${format(entry.min, digits)}–${format(entry.max, digits)}]`;
        });
        console.log(`  ${label}: ${cells.join(' | ')}`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}
