// e2e/static-server.mjs — שרת סטטי זעיר לבדיקות הדפדפן.
//
// מגיש את שורש המאגר כפי ש-GitHub Pages מגיש אותו: הקבצים כמות שהם, עם
// סוגי התוכן הנכונים ובלי מטמון, כדי שכל בדיקה תטען את הקוד העדכני.
// אין כאן תלות חיצונית: http ו-fs של Node בלבד.
//
// E2E_ROOT מחליף את התיקייה שמוגשת, יחסית לשורש המאגר: E2E_ROOT=dist מריץ
// את אותן בדיקות על תוצר הבנייה (npm run build), באותם נתיבים בדיוק.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(REPO_ROOT, process.env.E2E_ROOT || '.');

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error(`static server: ${ROOT}/index.html אינו קיים (הורץ npm run build?)`);
    process.exit(1);
}
const HOST = '127.0.0.1';
const PORT = Number(process.argv[2] || process.env.E2E_PORT) || 8080;

const MIME_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.map', 'application/json; charset=utf-8'],
    ['.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.svg', 'image/svg+xml'],
    ['.ico', 'image/x-icon'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.txt', 'text/plain; charset=utf-8']
]);

// הנתיב המבוקש הופך לקובץ בתוך שורש המאגר בלבד; ".." אינו יכול לצאת ממנו.
function resolveFile(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    const normalized = path.posix.normalize(`/${decoded}`);
    const resolved = path.join(ROOT, normalized);
    return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

async function locate(pathname) {
    const target = resolveFile(pathname);
    if (!target) return null;
    try {
        const stats = await fs.promises.stat(target);
        if (stats.isFile()) return { file: target, size: stats.size };
        if (stats.isDirectory()) {
            const index = path.join(target, 'index.html');
            const indexStats = await fs.promises.stat(index);
            if (indexStats.isFile()) return { file: index, size: indexStats.size };
        }
    } catch {
        // הקובץ אינו קיים.
    }
    return null;
}

const server = http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

    if (method !== 'GET' && method !== 'HEAD') {
        response.writeHead(405, { ...baseHeaders, Allow: 'GET, HEAD' });
        response.end();
        return;
    }

    const located = await locate(url.pathname);
    if (!located) {
        response.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(method === 'HEAD' ? undefined : `לא נמצא: ${url.pathname}`);
        return;
    }

    response.writeHead(200, {
        ...baseHeaders,
        'Content-Type': MIME_TYPES.get(path.extname(located.file).toLowerCase()) || 'application/octet-stream',
        'Content-Length': located.size
    });
    if (method === 'HEAD') {
        response.end();
        return;
    }
    const stream = fs.createReadStream(located.file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
});

server.listen(PORT, HOST, () => {
    console.log(`static server: http://${HOST}:${PORT}/ -> ${ROOT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
