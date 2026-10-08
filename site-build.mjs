// site-build.mjs — התוסף של Vite שמשלים את בניית האתר ל-dist/.
//
// Vite מאגד את קוד שני הדפים (index.html ו-admin.html) לקבצים מוקטנים עם
// גיבוב בשם. מה ש-Vite אינו יודע לעשות לבדו נעשה כאן:
//   1. קבצים שאינם מיובאים מהקוד — sw.js, manifest.webmanifest, הסמלים ודף
//      ההפניה admin-messages.html — מועתקים לשורש dist כמות שהם.
//   2. ה-Service Worker מקבל את רשימת המעטפת (APP_SHELL) מתוך מניפסט הבנייה
//      של Vite: דף הגלריה וכל קובצי ה-JS וה-CSS שהוא טוען סטטית, בשמותיהם
//      המגובבים. CACHE_VERSION נשאר כפי שהוא ב-sw.js ותואם ל-SITE_VERSION.
//   3. version.json נכתב עם ה-commit ושעת הבנייה האמיתיים במקום תבנית Jekyll,
//      ו-.nojekyll מונע מ-GitHub Pages להריץ Jekyll על התוצר.
//
// קובצי המקור עצמם אינם משתנים: האתר ממשיך לעבוד גם בלי בנייה, כפי שהוא
// מוגש היום מהענף.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// הקבצים שמועתקים לשורש dist בלי עיבוד.
export const STATIC_FILES = [
    'sw.js',
    'manifest.webmanifest',
    'favicon-32.png',
    'favicon-192.png',
    'favicon-512.png',
    'icon-192.png',
    'icon-512.png',
    'admin-messages.html'
];

// קבצים סטטיים שנכנסים למעטפת ה-Service Worker לצד הקוד המאוגד.
export const SHELL_STATIC_ASSETS = [
    './manifest.webmanifest',
    './favicon-32.png',
    './icon-192.png',
    './icon-512.png'
];

const VITE_MANIFEST_PATH = '.vite/manifest.json';

// קישורי ה-manifest והסמלים נשארים בכתובתם המקורית: ה-manifest מפנה לסמלים
// ול-start_url בנתיבים יחסיים לעצמו, ושם מגובב בתיקיית assets היה שובר אותם.
const STATIC_LINK_PATTERN = /<link\b(?![^>]*\bvite-ignore\b)(?=[^>]*\brel=["'](?:manifest|icon|apple-touch-icon)["'])/gi;

export function keepStaticLinks(html) {
    return String(html).replace(STATIC_LINK_PATTERN, '<link vite-ignore');
}

// כל הקבצים שהנקודות הנתונות טוענות סטטית: הנקודות עצמן, הייבואים הסטטיים
// שלהן ברקורסיה וה-CSS של כולם. ייבוא דינמי אינו נכלל — הוא נכנס למטמון רק
// בשימוש הראשון, כמו באתר שאינו בנוי.
export function collectEntryFiles(manifest, entryKeys) {
    const scripts = [];
    const styles = [];
    const seen = new Set();
    const visit = key => {
        if (seen.has(key)) return;
        seen.add(key);
        const chunk = manifest?.[key];
        if (!chunk) throw new Error(`${key} אינו במניפסט של Vite`);
        for (const css of chunk.css || []) {
            if (!styles.includes(css)) styles.push(css);
        }
        if (chunk.file && /\.m?js$/i.test(chunk.file)) scripts.push(chunk.file);
        for (const imported of chunk.imports || []) visit(imported);
    };
    for (const key of [].concat(entryKeys)) visit(key);
    return { scripts, styles };
}

// רשימת APP_SHELL כפי שהיא כתובה ב-sw.js של המקור.
export function readAppShell(source) {
    const match = /const APP_SHELL = (\[[\s\S]*?\n\]);/.exec(String(source));
    if (!match) throw new Error('המערך APP_SHELL לא נמצא ב-sw.js');
    return JSON.parse(match[1].replace(/,\s*\]$/, ']'));
}

// הנקודה של דף במניפסט. כשכל הקוד של הדף משותף גם לדף אחר, Rollup ממזג את
// נקודת הכניסה לתוך הנתח המשותף ו-Vite רושם אותו במניפסט תחת שם הנתח ולא תחת
// שם הדף. במקרה כזה מזהים את הנתח לפי הסקריפט שהדף הבנוי טוען בפועל.
export function findEntryKey(manifest, page, html = '') {
    if (manifest?.[page]) return page;
    const scripts = [...String(html).matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
        .map(match => match[1].replace(/^\.?\//, ''));
    for (const src of scripts) {
        const key = Object.keys(manifest || {}).find(candidate => manifest[candidate].file === src);
        if (key) return key;
    }
    throw new Error(`הדף ${page} אינו במניפסט של Vite`);
}

// רשימת המעטפת לבנייה: הדף, ה-CSS וה-JS שהוא טוען סטטית בשמות המגובבים,
// והקבצים הסטטיים. מודול שהמקור טוען מראש במכוון (למשל face-search.js) אך
// בבנייה הפך לנתח דינמי נפרד נשאר גם הוא במעטפת, כדי שהבנייה לא תשנה את מה
// שהמבקר מקבל לשימוש לא מקוון.
export function buildPrecacheList(manifest, { page = 'index.html', html = '', sourceShell = [] } = {}) {
    const roots = [findEntryKey(manifest, page, html)];
    for (const entry of sourceShell) {
        const key = String(entry).replace(/^\.\//, '');
        if (/\.m?js$/i.test(key) && manifest?.[key]) roots.push(key);
    }
    const { scripts, styles } = collectEntryFiles(manifest, roots);
    const list = ['./', `./${page}`, ...styles.map(file => `./${file}`), ...scripts.map(file => `./${file}`), ...SHELL_STATIC_ASSETS];
    return [...new Set(list)];
}

const APP_SHELL_PATTERN = /const APP_SHELL = \[[\s\S]*?\n\];/;

// מחליף את מערך APP_SHELL שב-sw.js ברשימה שנבנתה. כל שאר הקובץ — כולל
// CACHE_VERSION — נשאר כפי שהוא.
export function renderServiceWorker(source, precacheList) {
    const text = String(source);
    if (!APP_SHELL_PATTERN.test(text)) throw new Error('המערך APP_SHELL לא נמצא ב-sw.js');
    if (!/const CACHE_VERSION = "[^"]+";/.test(text)) throw new Error('CACHE_VERSION לא נמצא ב-sw.js');
    if (!Array.isArray(precacheList) || precacheList.length === 0) throw new Error('רשימת המעטפת ריקה');
    const body = precacheList.map(entry => `  ${JSON.stringify(entry)}`).join(',\n');
    // פונקציה ולא מחרוזת: "$" בשם קובץ לא יתפרש כתבנית החלפה.
    return text.replace(APP_SHELL_PATTERN, () => `const APP_SHELL = [\n${body}\n];`);
}

// version.json של הבנייה: אותו מבנה ש-Jekyll היה מפיק, בלי front matter.
export function renderVersionJson({ revision, builtAt } = {}) {
    const date = builtAt instanceof Date ? builtAt : new Date(builtAt ?? Date.now());
    if (Number.isNaN(date.getTime())) throw new Error('זמן בנייה לא תקין');
    return `${JSON.stringify({ revision: String(revision || 'local'), builtAt: date.toISOString() })}\n`;
}

// ה-commit שנבנה: GITHUB_SHA ב-Actions, ואחרת ה-HEAD של git המקומי.
export function resolveRevision(env = process.env, cwd = process.cwd()) {
    if (env.GITHUB_SHA) return env.GITHUB_SHA;
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'local';
    } catch {
        return 'local';
    }
}

export function siteBuildPlugin({ revision, builtAt } = {}) {
    let root = process.cwd();
    let outDir = path.join(root, 'dist');
    return {
        name: 'simchas-site-build',
        apply: 'build',
        configResolved(config) {
            root = config.root;
            outDir = path.resolve(config.root, config.build.outDir);
        },
        transformIndexHtml: {
            order: 'pre',
            handler: html => keepStaticLinks(html)
        },
        writeBundle() {
            const manifestFile = path.join(outDir, VITE_MANIFEST_PATH);
            const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

            for (const file of STATIC_FILES) {
                fs.copyFileSync(path.join(root, file), path.join(outDir, file));
            }

            const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
            const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
            fs.writeFileSync(path.join(outDir, 'sw.js'), renderServiceWorker(swSource, buildPrecacheList(manifest, {
                page: 'index.html',
                html: indexHtml,
                sourceShell: readAppShell(swSource)
            })));

            fs.writeFileSync(path.join(outDir, 'version.json'), renderVersionJson({
                revision: revision ?? resolveRevision(process.env, root),
                builtAt: builtAt ?? new Date()
            }));
            fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

            // המניפסט שימש רק לבנייה ואינו צריך להתפרסם.
            fs.rmSync(path.join(outDir, '.vite'), { recursive: true, force: true });
        }
    };
}
