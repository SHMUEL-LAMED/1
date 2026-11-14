// video-maker-ui.js — יוצר הסרטונים: החלון, טעינת התמונות, הציור וההקלטה.
//
// נטען עצלה (app.js) מ"צור סרטון" בעמוד האירוע ומ"סרטון" בסרגל הבחירה
// המרובה. הסרטון נוצר כולו בדפדפן, בלי שרת:
//   1. התמונות (התצוגה הבינונית, 1280px) נטענות ומפוענחות, עם התקדמות וביטול.
//   2. כל פריים מצויר ב-Canvas: כל שקופית מצוירת לשכבה משלה, והמעבר מרכיב
//      את שתי השכבות על הבמה (12 סוגי מעברים, תנועת מצלמה ושקופיות פתיחה וסיום).
//   3. MediaRecorder מקליט את ה-Canvas (ואת המוזיקה, אם נבחרה) בזמן אמת,
//      ל-MP4 כשהדפדפן יודע, אחרת ל-WebM.
// ההחלטות (ציר הזמן, המעברים, עקומות ההאצה ותנועת המצלמה) — ב-video-maker.js.
//
// פרטיות: כמו האלבום להדפסה, הסרטון שייך למי שפתח את החלון. התנתקות או
// החלפת חשבון (resetVideoMaker מ-session-auth.js) עוצרות הכול ומוחקות את
// הסרטון מהדף.
import {
    VIDEO_PREFS_KEY, VIDEO_TRANSITIONS, VIDEO_ASPECTS, VIDEO_THEMES, VIDEO_FPS, VIDEO_MAX_ITEMS,
    normalizeVideoOptions, prepareVideoItems, buildTimeline, frameAt, kenBurnsPlan, kenBurnsAt,
    coverRect, easeInOutCubic, easeOutExpo, clamp01, hashSeed, pickRecorderType, videoFileName,
    formatDuration
} from './video-maker.js';
import { drawBrandMark } from './brand-mark.js';

const LOAD_CONCURRENCY = 4;
const IMAGE_TIMEOUT_MS = 30_000;
// תמונה גדולה מזה מוקטנת בטעינה: מספיק לחדות של 1280px עם זום, וחוסך זיכרון בטלפון.
const MAX_BITMAP_SIDE = 1920;

let pendingAlbum = null; // { title, subtitle, folderId | records, ownerUid }
let activeJob = null;    // { cancelled, aborts:Set }
let assets = null;       // { key, items, bitmaps:Map, seed }
let player = null;       // { raf, recorder, audio, stop() }
let resultUrl = '';
let brandSettings = null;

// --- עזרים ---

function approvedViewerUid() {
    const state = window.state;
    if (!state?.isGoogleUser || state.userApprovalStatus !== 'approved') return '';
    return String(state.currentUser?.uid || '');
}

function $(id) { return document.getElementById(id); }

function readPrefs() {
    try {
        return normalizeVideoOptions(JSON.parse(localStorage.getItem(VIDEO_PREFS_KEY) || 'null'));
    } catch {
        return normalizeVideoOptions(null);
    }
}

function writePrefs(options) {
    try { localStorage.setItem(VIDEO_PREFS_KEY, JSON.stringify(options)); } catch { /* מצב פרטי */ }
}

function readForm() {
    const form = $('videoMakerForm');
    if (!form) return readPrefs();
    const data = new FormData(form);
    return normalizeVideoOptions({
        transition: data.get('transition'),
        aspect: data.get('aspect'),
        theme: data.get('theme'),
        slideSeconds: Number(data.get('slideSeconds')),
        kenBurns: data.has('kenBurns'),
        titleCard: data.has('titleCard'),
        captions: data.has('captions'),
        logo: data.has('logo')
    });
}

function fillForm(options) {
    const form = $('videoMakerForm');
    if (!form) return;
    const transition = form.elements.transition;
    if (transition && !transition.options.length) {
        for (const item of VIDEO_TRANSITIONS) transition.add(new Option(item.label, item.id));
    }
    const aspect = form.elements.aspect;
    if (aspect && !aspect.options.length) {
        for (const [id, item] of Object.entries(VIDEO_ASPECTS)) aspect.add(new Option(item.label, id));
    }
    const theme = form.elements.theme;
    if (theme && !theme.options.length) {
        for (const [id, item] of Object.entries(VIDEO_THEMES)) theme.add(new Option(item.label, id));
    }
    if (transition) transition.value = options.transition;
    if (aspect) aspect.value = options.aspect;
    if (theme) theme.value = options.theme;
    if (form.elements.slideSeconds) form.elements.slideSeconds.value = String(options.slideSeconds);
    for (const key of ['kenBurns', 'titleCard', 'captions', 'logo']) {
        if (form.elements[key]) form.elements[key].checked = options[key];
    }
}

function setProgress(text, fraction = 0) {
    const box = $('videoMakerProgress');
    const bar = $('videoMakerProgressBar');
    const status = $('videoMakerStatus');
    if (box) box.hidden = !text;
    if (bar) bar.style.width = `${Math.round(clamp01(fraction) * 100)}%`;
    if (status) status.textContent = text || '';
}

function setBusy(busy, mode = '') {
    const modal = $('videoMakerModal');
    modal?.setAttribute('aria-busy', String(Boolean(busy)));
    modal?.setAttribute('data-mode', mode || 'idle');
    for (const id of ['videoMakerPreviewBtn', 'videoMakerRecordBtn']) {
        const button = $(id);
        if (button) button.disabled = Boolean(busy);
    }
    $('videoMakerForm')?.querySelectorAll('select, input').forEach(field => { field.disabled = Boolean(busy); });
    const stop = $('videoMakerStopBtn');
    if (stop) stop.hidden = !busy;
}

function updateSummary() {
    const summary = $('videoMakerSummary');
    if (!summary || !pendingAlbum) return;
    const options = readForm();
    const count = assets?.items?.length || Number(pendingAlbum.expected) || 0;
    const timeline = buildTimeline(count, options, 1);
    const countText = count === 1 ? 'תמונה אחת' : `${count} תמונות`;
    summary.textContent = `${pendingAlbum.title} · ${countText} · כ־${formatDuration(timeline.duration)} דקות`;
}

function clearResult() {
    const video = $('videoMakerResult');
    if (video) {
        video.pause?.();
        video.removeAttribute('src');
        video.load?.();
    }
    $('videoMakerResultBox')?.setAttribute('hidden', '');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
}

function releaseAssets() {
    if (!assets) return;
    for (const bitmap of assets.bitmaps.values()) bitmap?.close?.();
    assets = null;
}

// --- טעינת התמונות ---

async function fetchImageBlob(url, signal) {
    const headers = new Headers();
    if (window.R2_WORKER_BASE_URL && url.startsWith(window.R2_WORKER_BASE_URL)) {
        try {
            const token = await window.getFirebaseIdToken?.();
            if (token) headers.set('Authorization', `Bearer ${token}`);
        } catch { /* תמונות מאושרות ציבוריות */ }
    }
    const response = await fetch(url, { headers, signal });
    if (!response.ok) throw new Error(`טעינת התמונה נכשלה (${response.status}).`);
    return response.blob();
}

async function decodeBitmap(blob) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
        // דפדפן בלי createImageBitmap ל-Blob: דרך תמונה רגילה.
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.decoding = 'async';
            image.src = url;
            await image.decode();
            bitmap = await createImageBitmap(image);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_BITMAP_SIDE) return bitmap;
    const scale = MAX_BITMAP_SIDE / longest;
    const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.round(bitmap.width * scale),
        resizeHeight: Math.round(bitmap.height * scale),
        resizeQuality: 'high'
    });
    bitmap.close?.();
    return resized;
}

async function loadImage(url, job) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    job.aborts.add(abort);
    const timer = setTimeout(abort, IMAGE_TIMEOUT_MS);
    try {
        return await decodeBitmap(await fetchImageBlob(url, controller.signal));
    } finally {
        clearTimeout(timer);
        job.aborts.delete(abort);
    }
}

async function albumRecords(album, job) {
    if (Array.isArray(album.records)) return album.records;
    const loaded = window.getLoadedFolderImages?.(album.folderId) || [];
    if (typeof window.loadAllFolderImages !== 'function') return loaded;
    setProgress('אוסף את התמונות של האירוע…', 0.02);
    try {
        const all = await window.loadAllFolderImages(album.folderId, {
            limit: VIDEO_MAX_ITEMS * 2,
            shouldStop: () => job.cancelled
        });
        const items = Array.isArray(all) ? all : all?.items;
        return Array.isArray(items) && items.length ? items : loaded;
    } catch (error) {
        console.warn('Video maker: folder load failed, using loaded items.', error);
        return loaded;
    }
}

async function loadBrandSettings() {
    if (brandSettings) return brandSettings;
    try {
        const { loadDownloadSettings } = await import('./download-privacy-ui.js');
        const { watermarkTextFor } = await import('./download-privacy.js');
        const settings = await loadDownloadSettings();
        brandSettings = { ...settings, text: watermarkTextFor(settings) };
    } catch {
        brandSettings = { text: 'גלריית שמחת התורה' };
    }
    return brandSettings;
}

// טוען (פעם אחת לכל אלבום) את כל התמונות. מחזיר false כשבוטל או כשאין תמונות.
async function ensureAssets() {
    const album = pendingAlbum;
    const key = album?.key;
    if (assets && assets.key === key) return true;
    releaseAssets();
    const job = { cancelled: false, aborts: new Set() };
    activeJob = job;
    setBusy(true, 'loading');
    try {
        const records = await albumRecords(album, job);
        if (job.cancelled) return false;
        const prepared = prepareVideoItems(records);
        if (!prepared.items.length) {
            setProgress('');
            window.showNotification('אין באלבום תמונות שאפשר להכניס לסרטון.', false);
            return false;
        }
        const bitmaps = new Map();
        let next = 0;
        let done = 0;
        const total = prepared.items.length;
        const worker = async () => {
            while (next < total && !job.cancelled) {
                const item = prepared.items[next++];
                try {
                    bitmaps.set(item.id, await loadImage(item.src, job));
                } catch (error) {
                    if (!job.cancelled) console.warn('Video maker: image failed', item.id, error);
                }
                done += 1;
                if (!job.cancelled) setProgress(`טוען תמונות… ${done}/${total}`, 0.05 + 0.95 * (done / total));
            }
        };
        await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, total) }, worker));
        if (job.cancelled) {
            for (const bitmap of bitmaps.values()) bitmap?.close?.();
            return false;
        }
        const items = prepared.items.filter(item => bitmaps.has(item.id));
        if (!items.length) {
            setProgress('');
            window.showNotification('התמונות לא נטענו. בדוק את החיבור ונסה שוב.', false);
            return false;
        }
        await loadBrandSettings();
        assets = { key, items, bitmaps, seed: hashSeed(`${album.title}|${items.map(item => item.id).join(',')}`) };
        const failed = total - items.length;
        if (failed || prepared.truncated) {
            const notes = [];
            if (prepared.truncated) notes.push(`הסרטון מוגבל ל־${VIDEO_MAX_ITEMS} תמונות.`);
            if (failed) notes.push(failed === 1 ? 'תמונה אחת לא נטענה.' : `${failed} תמונות לא נטענו.`);
            window.showNotification(notes.join(' '), false);
        }
        setProgress('');
        updateSummary();
        return true;
    } finally {
        if (activeJob === job) activeJob = null;
        setBusy(false);
    }
}

// --- הציור ---

function makeLayer(width, height) {
    const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    return { canvas, context: canvas.getContext('2d') };
}

const fontStack = () => (getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim() || 'sans-serif');
const serifStack = () => (getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim() || 'serif');

function supportsFilter(context) {
    return typeof context.filter === 'string';
}

// רקע מטושטש מהתמונה עצמה — לתמונה שהכיוון שלה שונה מהסרטון.
function drawBackdrop(context, bitmap, width, height, theme) {
    context.fillStyle = theme.background;
    context.fillRect(0, 0, width, height);
    if (!bitmap) return;
    const rect = coverRect(bitmap.width, bitmap.height, width, height, { scale: 1.15 });
    context.save();
    if (supportsFilter(context)) context.filter = `blur(${Math.round(Math.min(width, height) * 0.04)}px) saturate(1.2)`;
    context.globalAlpha = 0.55;
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    context.restore();
    const shade = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.75);
    shade.addColorStop(0, 'rgba(0,0,0,0.15)');
    shade.addColorStop(1, 'rgba(0,0,0,0.65)');
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);
}

function drawPhoto(context, width, height, bitmap, motion, theme) {
    const frameRatio = width / height;
    const imageRatio = bitmap.width / bitmap.height;
    const fits = imageRatio / frameRatio > 0.72 && imageRatio / frameRatio < 1.4;
    if (fits) {
        const rect = coverRect(bitmap.width, bitmap.height, width, height, motion);
        context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
        return;
    }
    // תמונה לאורך בסרטון לרוחב (או להפך): התמונה כולה, על רקע מטושטש ממנה.
    drawBackdrop(context, bitmap, width, height, theme);
    const fit = Math.min(width / bitmap.width, height / bitmap.height) * 0.94 * (0.96 + (motion.scale - 1) * 0.5);
    const w = bitmap.width * fit;
    const h = bitmap.height * fit;
    const x = (width - w) / 2 + motion.x * width * 0.25;
    const y = (height - h) / 2 + motion.y * height * 0.25;
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.6)';
    context.shadowBlur = Math.min(width, height) * 0.04;
    context.drawImage(bitmap, x, y, w, h);
    context.restore();
}

function wrapLines(context, text, maxWidth, maxLines = 2) {
    const words = String(text || '').split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        const attempt = line ? `${line} ${word}` : word;
        if (context.measureText(attempt).width <= maxWidth || !line) {
            line = attempt;
        } else {
            lines.push(line);
            line = word;
            if (lines.length === maxLines) break;
        }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
}

function drawCaption(context, width, height, text, local, theme) {
    if (!text) return;
    const appear = easeOutExpo(clamp01((local - 0.08) / 0.25)) * (1 - clamp01((local - 0.86) / 0.14));
    if (appear <= 0.01) return;
    const shortSide = Math.min(width, height);
    const band = context.createLinearGradient(0, height * 0.62, 0, height);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(1, `rgba(0,0,0,${0.62 * appear})`);
    context.fillStyle = band;
    context.fillRect(0, height * 0.62, width, height * 0.38);
    const size = Math.round(shortSide * 0.042);
    context.save();
    context.globalAlpha = appear;
    context.font = `600 ${size}px ${fontStack()}`;
    context.direction = 'rtl';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.shadowColor = 'rgba(0,0,0,0.7)';
    context.shadowBlur = size * 0.4;
    const lines = wrapLines(context, text, width * 0.8);
    const lift = (1 - appear) * size * 0.6;
    const baseY = height - shortSide * 0.1 + lift;
    lines.forEach((line, index) => {
        context.fillStyle = theme.ink === '#2A2118' ? '#FFFFFF' : theme.ink;
        context.fillText(line, width / 2, baseY - (lines.length - 1 - index) * size * 1.3);
    });
    // קו פליז דק מעל הכיתוב
    const lineWidth = width * 0.08 * appear;
    context.fillStyle = theme.accent;
    context.fillRect(width / 2 - lineWidth / 2, baseY - lines.length * size * 1.3 - size * 0.2, lineWidth, Math.max(2, size * 0.08));
    context.restore();
}

function drawOrnament(context, cx, cy, span, color, progress) {
    const reach = span * easeOutExpo(progress);
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = Math.max(1.5, span * 0.006);
    context.beginPath();
    context.moveTo(cx - reach, cy);
    context.lineTo(cx - span * 0.04, cy);
    context.moveTo(cx + span * 0.04, cy);
    context.lineTo(cx + reach, cy);
    context.stroke();
    const d = span * 0.025 * easeOutExpo(progress);
    context.beginPath();
    context.moveTo(cx, cy - d);
    context.lineTo(cx + d * 0.8, cy);
    context.lineTo(cx, cy + d);
    context.lineTo(cx - d * 0.8, cy);
    context.closePath();
    context.fill();
    context.restore();
}

function drawTitleCard(context, width, height, local, theme, bitmap, lines) {
    drawBackdrop(context, bitmap, width, height, theme);
    context.fillStyle = theme.background;
    context.globalAlpha = 0.55;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;
    // הילה נעה
    const glowX = width * (0.3 + 0.4 * local);
    const glow = context.createRadialGradient(glowX, height * 0.4, 0, glowX, height * 0.4, Math.max(width, height) * 0.6);
    glow.addColorStop(0, theme.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    // חלקיקי אור
    const random = (n) => (Math.sin(n * 12.9898) * 43758.5453) % 1;
    context.save();
    for (let index = 0; index < 40; index += 1) {
        const px = Math.abs(random(index + 1)) * width;
        const py = (Math.abs(random(index + 50)) * height - local * height * 0.15 * (1 + (index % 3))) % height;
        const r = 1 + Math.abs(random(index + 90)) * Math.min(width, height) * 0.004;
        context.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(local * 6 + index));
        context.fillStyle = theme.accent;
        context.beginPath();
        context.arc(px, py < 0 ? py + height : py, r, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();

    const shortSide = Math.min(width, height);
    const enter = easeOutExpo(clamp01(local / 0.45));
    const cx = width / 2;
    const cy = height / 2;
    context.save();
    context.direction = 'rtl';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.globalAlpha = enter;

    context.font = `600 ${Math.round(shortSide * 0.035)}px ${fontStack()}`;
    context.fillStyle = theme.accent;
    context.fillText(lines.kicker, cx, cy - shortSide * 0.17 - (1 - enter) * 20);

    const titleSize = Math.round(shortSide * (lines.title.length > 22 ? 0.07 : 0.095));
    context.font = `700 ${titleSize}px ${serifStack()}`;
    context.fillStyle = theme.ink;
    context.shadowColor = theme.glow;
    context.shadowBlur = titleSize * 0.5;
    const titleLines = wrapLines(context, lines.title, width * 0.84);
    titleLines.forEach((line, index) => {
        context.fillText(line, cx, cy - shortSide * 0.04 + (index - (titleLines.length - 1) / 2) * titleSize * 1.15 + (1 - enter) * 30);
    });
    context.shadowBlur = 0;
    drawOrnament(context, cx, cy + shortSide * 0.09, Math.min(width * 0.32, shortSide * 0.5), theme.accent, clamp01((local - 0.1) / 0.5));
    if (lines.subtitle) {
        context.globalAlpha = easeOutExpo(clamp01((local - 0.25) / 0.4));
        context.font = `500 ${Math.round(shortSide * 0.034)}px ${fontStack()}`;
        context.fillStyle = theme.ink;
        context.fillText(lines.subtitle, cx, cy + shortSide * 0.16);
    }
    context.restore();
}

// מצייר שקופית אחת לשכבה שלה.
function drawSlide(layer, slide, local, ctx) {
    const { context, canvas } = layer;
    const { width, height } = canvas;
    const theme = VIDEO_THEMES[ctx.options.theme];
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    if (supportsFilter(context)) context.filter = 'none';
    context.clearRect(0, 0, width, height);
    if (slide.kind === 'photo') {
        const item = ctx.items[slide.item];
        const bitmap = ctx.bitmaps.get(item.id);
        const motion = kenBurnsAt(kenBurnsPlan(slide.item, ctx.seed), local, ctx.options.kenBurns);
        drawPhoto(context, width, height, bitmap, motion, theme);
        if (ctx.options.captions) drawCaption(context, width, height, item.caption, local, theme);
    } else {
        const firstBitmap = ctx.bitmaps.get(ctx.items[slide.kind === 'title' ? 0 : ctx.items.length - 1]?.id);
        const lines = slide.kind === 'title'
            ? { kicker: 'אלבום וידאו', title: ctx.title, subtitle: ctx.subtitle }
            : { kicker: ctx.brandText, title: 'תודה שצפיתם', subtitle: ctx.title };
        drawTitleCard(context, width, height, local, theme, firstBitmap, lines);
    }
    context.restore();
}

// --- המעברים: הרכבת שתי שכבות על הבמה ---

function drawLayer(context, layer, x = 0, y = 0, w, h) {
    context.drawImage(layer.canvas, x, y, w ?? layer.canvas.width, h ?? layer.canvas.height);
}

function composeTransition(context, width, height, from, to, type, rawProgress, ctx) {
    const p = easeInOutCubic(rawProgress);
    const theme = VIDEO_THEMES[ctx.options.theme];
    context.save();
    switch (type) {
    case 'zoom': {
        const s1 = 1 + p * 0.35;
        context.globalAlpha = 1 - p;
        drawLayer(context, from, (width - width * s1) / 2, (height - height * s1) / 2, width * s1, height * s1);
        const s2 = 0.82 + p * 0.18;
        context.globalAlpha = p;
        drawLayer(context, to, (width - width * s2) / 2, (height - height * s2) / 2, width * s2, height * s2);
        break;
    }
    case 'slide': {
        // בעברית "הבא" נכנס משמאל וה"נוכחי" יוצא לימין.
        drawLayer(context, from, p * width, 0);
        drawLayer(context, to, -(1 - p) * width, 0);
        context.fillStyle = 'rgba(0,0,0,0.35)';
        context.fillRect(p * width - 2, 0, 4, height);
        break;
    }
    case 'wipe': {
        drawLayer(context, from);
        const edge = (width + height) * p * 1.05;
        context.beginPath();
        context.moveTo(width, 0);
        context.lineTo(width - edge, 0);
        context.lineTo(width - edge + height, height);
        context.lineTo(width, height);
        context.closePath();
        context.save();
        context.clip();
        drawLayer(context, to);
        context.restore();
        context.strokeStyle = theme.accent;
        context.lineWidth = Math.max(2, Math.min(width, height) * 0.006);
        context.shadowColor = theme.glow;
        context.shadowBlur = 24;
        context.beginPath();
        context.moveTo(width - edge, 0);
        context.lineTo(width - edge + height, height);
        context.stroke();
        break;
    }
    case 'circle': {
        drawLayer(context, from);
        const radius = Math.hypot(width, height) / 2 * p;
        context.save();
        context.beginPath();
        context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        context.clip();
        drawLayer(context, to);
        context.restore();
        context.strokeStyle = theme.accent;
        context.globalAlpha = 1 - p;
        context.lineWidth = Math.max(2, Math.min(width, height) * 0.008);
        context.beginPath();
        context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        context.stroke();
        break;
    }
    case 'blinds': {
        drawLayer(context, from);
        const strips = 9;
        const stripWidth = width / strips;
        for (let index = 0; index < strips; index += 1) {
            const local = clamp01(rawProgress * 1.6 - (index / strips) * 0.6);
            const w = stripWidth * easeInOutCubic(local);
            const x = width - (index + 1) * stripWidth + (stripWidth - w) / 2;
            context.save();
            context.beginPath();
            context.rect(x, 0, w, height);
            context.clip();
            drawLayer(context, to);
            context.restore();
        }
        break;
    }
    case 'blur': {
        if (supportsFilter(context)) {
            const amount = Math.min(width, height) * 0.03;
            context.filter = `blur(${(p * amount).toFixed(1)}px)`;
            context.globalAlpha = 1;
            drawLayer(context, from);
            context.filter = `blur(${((1 - p) * amount).toFixed(1)}px)`;
            context.globalAlpha = p;
            drawLayer(context, to);
            context.filter = 'none';
        } else {
            drawLayer(context, from);
            context.globalAlpha = p;
            drawLayer(context, to);
        }
        break;
    }
    case 'flash': {
        drawLayer(context, rawProgress < 0.5 ? from : to);
        const white = 1 - Math.abs(rawProgress * 2 - 1);
        context.globalAlpha = Math.pow(white, 1.4) * 0.95;
        context.fillStyle = theme.ink === '#2A2118' ? '#FFFFFF' : '#FFF6E2';
        context.fillRect(0, 0, width, height);
        break;
    }
    case 'pixelate': {
        const source = rawProgress < 0.5 ? from : to;
        const amount = 1 - Math.abs(rawProgress * 2 - 1);
        const cells = Math.max(6, Math.round(Math.max(width, height) / (1 + amount * 48)));
        const tiny = ctx.scratch;
        const tw = Math.max(1, Math.round(cells));
        const th = Math.max(1, Math.round(cells * height / width));
        tiny.canvas.width = tw;
        tiny.canvas.height = th;
        tiny.context.imageSmoothingEnabled = true;
        tiny.context.drawImage(source.canvas, 0, 0, tw, th);
        context.imageSmoothingEnabled = amount < 0.05;
        context.drawImage(tiny.canvas, 0, 0, width, height);
        context.imageSmoothingEnabled = true;
        break;
    }
    case 'split': {
        drawLayer(context, to);
        const half = width / 2;
        const shift = half * p;
        context.save();
        context.beginPath();
        context.rect(0, 0, half - shift, height);
        context.clip();
        drawLayer(context, from, -shift, 0);
        context.restore();
        context.save();
        context.beginPath();
        context.rect(half + shift, 0, half, height);
        context.clip();
        drawLayer(context, from, shift, 0);
        context.restore();
        context.fillStyle = theme.accent;
        context.globalAlpha = 1 - p;
        context.fillRect(half - shift - 2, 0, 3, height);
        context.fillRect(half + shift - 1, 0, 3, height);
        break;
    }
    case 'cube': {
        // סיבוב קובייה: הנוכחי מתכווץ לצד ימין, הבא נפתח משמאל, עם הצללה.
        const fromWidth = width * (1 - p);
        const toWidth = width * p;
        context.fillStyle = '#000';
        context.fillRect(0, 0, width, height);
        const inset = height * 0.06 * Math.sin(Math.PI * p);
        drawLayer(context, to, 0, inset, toWidth, height - inset * 2);
        context.fillStyle = `rgba(0,0,0,${0.55 * (1 - p)})`;
        context.fillRect(0, inset, toWidth, height - inset * 2);
        drawLayer(context, from, toWidth, inset, fromWidth, height - inset * 2);
        context.fillStyle = `rgba(0,0,0,${0.55 * p})`;
        context.fillRect(toWidth, inset, fromWidth, height - inset * 2);
        break;
    }
    case 'crossfade':
    default: {
        drawLayer(context, from);
        context.globalAlpha = p;
        drawLayer(context, to);
    }
    }
    context.restore();
}

// פריים אחד ברגע time על הבמה.
function renderFrame(stage, ctx, time) {
    const { context, canvas } = stage;
    const frame = frameAt(ctx.timeline, time);
    if (!frame) return;
    drawSlide(ctx.layerA, frame.current, frame.local, ctx);
    if (frame.next) {
        drawSlide(ctx.layerB, frame.next, frame.nextLocal, ctx);
        context.clearRect(0, 0, canvas.width, canvas.height);
        composeTransition(context, canvas.width, canvas.height, ctx.layerA, ctx.layerB, frame.transition, frame.progress, ctx);
    } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(ctx.layerA.canvas, 0, 0);
    }
    if (ctx.options.logo && ctx.brandText) {
        drawBrandMark(context, canvas.width, canvas.height, ctx.brandText, ctx.brand, fontStack());
    }
    // פס התקדמות דק בתחתית הבמה (רק בתצוגה המקדימה).
    if (ctx.preview) {
        context.fillStyle = VIDEO_THEMES[ctx.options.theme].accent;
        context.fillRect(canvas.width * (1 - time / ctx.timeline.duration), canvas.height - 4, canvas.width, 4);
    }
}

function buildRenderContext(options, preview) {
    const aspect = VIDEO_ASPECTS[options.aspect];
    const stageCanvas = $('videoMakerCanvas');
    stageCanvas.width = aspect.width;
    stageCanvas.height = aspect.height;
    const stage = { canvas: stageCanvas, context: stageCanvas.getContext('2d') };
    const timeline = buildTimeline(assets.items.length, options, assets.seed);
    return {
        stage,
        ctx: {
            options, preview, timeline,
            items: assets.items,
            bitmaps: assets.bitmaps,
            seed: assets.seed,
            title: pendingAlbum.title,
            subtitle: pendingAlbum.subtitle || (assets.items.length === 1 ? 'תמונה אחת' : `${assets.items.length} תמונות`),
            brand: brandSettings || {},
            brandText: brandSettings?.text || '',
            layerA: makeLayer(aspect.width, aspect.height),
            layerB: makeLayer(aspect.width, aspect.height),
            scratch: makeLayer(8, 8)
        }
    };
}

// --- מוזיקה (קובץ מקומי שהצופה בחר; אינו עולה לשום מקום) ---

async function buildAudio(duration) {
    const file = $('videoMakerMusic')?.files?.[0];
    if (!file) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const audioContext = new AudioContextClass();
    try {
        const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = buffer.duration < duration;
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.9, now + 1.2);
        gain.gain.setValueAtTime(0.9, now + Math.max(1.3, duration - 2.2));
        gain.gain.linearRampToValueAtTime(0, now + duration);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        gain.connect(audioContext.destination);
        return {
            stream: destination.stream,
            start: () => source.start(),
            stop: () => {
                try { source.stop(); } catch { /* כבר נעצר */ }
                audioContext.close().catch(() => {});
            }
        };
    } catch (error) {
        audioContext.close().catch(() => {});
        window.showNotification('קובץ המוזיקה לא נקרא. הסרטון ייווצר בלי מוזיקה.', false);
        console.warn('Video maker: audio decode failed', error);
        return null;
    }
}

// --- הפעלה: תצוגה מקדימה או הקלטה ---

function stopPlayer() {
    const current = player;
    player = null;
    if (!current) return;
    cancelAnimationFrame(current.raf);
    current.audio?.stop();
    if (current.recorder && current.recorder.state !== 'inactive') {
        current.cancelled = true;
        try { current.recorder.stop(); } catch { /* כבר נעצר */ }
    }
}

async function play({ record }) {
    if (!pendingAlbum || player || activeJob) return;
    if (!pendingAlbum.ownerUid || pendingAlbum.ownerUid !== approvedViewerUid()) {
        resetVideoMaker();
        return;
    }
    const options = readForm();
    writePrefs(options);
    if (!(await ensureAssets())) return;
    if (!pendingAlbum) return;
    clearResult();

    const { stage, ctx } = buildRenderContext(options, !record);
    const duration = ctx.timeline.duration;
    const session = { raf: 0, recorder: null, audio: null, cancelled: false };
    player = session;
    setBusy(true, record ? 'recording' : 'preview');
    $('videoMakerStage')?.removeAttribute('hidden');

    let chunks = [];
    let mimeType = '';
    if (record) {
        if (typeof MediaRecorder !== 'function' || typeof stage.canvas.captureStream !== 'function') {
            player = null;
            setBusy(false);
            window.showNotification('הדפדפן הזה אינו יודע להקליט סרטון. נסה בכרום, באדג׳ או בספארי עדכני.', false);
            return;
        }
        mimeType = pickRecorderType(type => MediaRecorder.isTypeSupported(type));
        session.audio = await buildAudio(duration);
        if (player !== session) { session.audio?.stop(); return; }
        const stream = stage.canvas.captureStream(VIDEO_FPS);
        session.audio?.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        const shortSide = Math.min(stage.canvas.width, stage.canvas.height);
        session.recorder = new MediaRecorder(stream, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: shortSide >= 1000 ? 9_000_000 : 7_000_000,
            audioBitsPerSecond: 160_000
        });
        session.recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
        session.recorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            if (session.cancelled || !pendingAlbum) { chunks = []; return; }
            const type = session.recorder.mimeType || mimeType || 'video/webm';
            const blob = new Blob(chunks, { type });
            chunks = [];
            showResult(blob, type);
        };
        renderFrame(stage, ctx, 0);
        session.recorder.start(1000);
        session.audio?.start();
    }

    const startedAt = performance.now();
    const tick = () => {
        if (player !== session) return;
        const elapsed = (performance.now() - startedAt) / 1000;
        const time = Math.min(elapsed, duration);
        renderFrame(stage, ctx, time);
        const label = record ? 'מקליט את הסרטון' : 'תצוגה מקדימה';
        setProgress(`${label}… ${formatDuration(time)} / ${formatDuration(duration)}`, time / duration);
        if (elapsed >= duration) {
            player = null;
            session.audio?.stop();
            if (session.recorder) {
                setProgress('מסיים את הקובץ…', 1);
                // עוד רגע קצר כדי שהפריים האחרון ייכנס להקלטה.
                setTimeout(() => {
                    try { session.recorder.stop(); } catch { /* כבר נעצר */ }
                    setBusy(false);
                }, 250);
            } else {
                setProgress('');
                setBusy(false);
            }
            return;
        }
        session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
}

function showResult(blob, type) {
    clearResult();
    resultUrl = URL.createObjectURL(blob);
    const video = $('videoMakerResult');
    if (video) video.src = resultUrl;
    $('videoMakerResultBox')?.removeAttribute('hidden');
    const sizeMb = (blob.size / 1024 / 1024).toFixed(1);
    const meta = $('videoMakerResultMeta');
    if (meta) meta.textContent = `${type.includes('mp4') ? 'MP4' : 'WebM'} · ${sizeMb}MB`;
    const download = $('videoMakerDownloadBtn');
    if (download) {
        download.onclick = () => {
            const link = document.createElement('a');
            link.href = resultUrl;
            link.download = videoFileName(pendingAlbum?.title, type);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.countUsage?.('downloads');
        };
    }
    const share = $('videoMakerShareBtn');
    if (share) {
        const file = new File([blob], videoFileName(pendingAlbum?.title, type), { type });
        const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        share.hidden = !canShare;
        share.onclick = canShare ? () => navigator.share({ files: [file], title: pendingAlbum?.title || 'סרטון' }).catch(() => {}) : null;
    }
    setProgress('');
    window.showNotification('הסרטון מוכן! אפשר לצפות בו, להוריד או לשתף.', true);
    window.scheduleIconRefresh?.();
}

// --- פתיחה, עצירה ואיפוס ---

function openDialog(album) {
    const ownerUid = approvedViewerUid();
    if (!ownerUid) {
        window.showNotification('יצירת סרטון זמינה למשתמשים מחוברים ומאושרים.', false);
        return;
    }
    const key = album.folderId ? `folder:${album.folderId}` : `sel:${album.records.map(item => item.id).join(',')}`;
    if (pendingAlbum?.key !== key) {
        stopPlayer();
        releaseAssets();
        clearResult();
    }
    pendingAlbum = { ...album, ownerUid, key };
    fillForm(readPrefs());
    const form = $('videoMakerForm');
    if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.addEventListener('change', () => { writePrefs(readForm()); updateSummary(); });
    }
    setProgress('');
    setBusy(false);
    updateSummary();
    window.openModal('videoMakerModal');
    window.scheduleIconRefresh?.();
}

window.openFolderVideoMaker = function(folderId) {
    const id = window.safeRecordId(folderId);
    const folder = window.state.folders.find(item => window.safeRecordId(item.id) === id);
    if (!folder || id === 'all') return;
    const loaded = window.getLoadedFolderImages?.(id)?.length || 0;
    openDialog({
        title: folder.name || 'אירוע',
        subtitle: folder.description ? String(folder.description).slice(0, 80) : '',
        folderId: id,
        expected: Math.max(loaded, Number(window.state.folderCounts?.[id]) || 0)
    });
};

window.openSelectionVideoMaker = function() {
    const records = window.state.images.filter(item => window.state.selectedMediaIds.has(window.safeRecordId(item.id)));
    if (!records.length) {
        window.showNotification('לא נבחרו פריטים לסרטון.', false);
        return;
    }
    const folderIds = new Set(records.map(item => window.safeRecordId(item.folderId)));
    const folder = folderIds.size === 1
        ? window.state.folders.find(item => window.safeRecordId(item.id) === [...folderIds][0])
        : null;
    openDialog({ title: folder?.name || 'רגעים נבחרים', subtitle: '', records, expected: records.length });
};

window.previewVideoMaker = () => play({ record: false });
window.recordVideoMaker = () => play({ record: true });

// "עצור" וסגירת החלון: עוצרים טעינה, תצוגה מקדימה או הקלטה.
window.stopVideoMaker = function() {
    const job = activeJob;
    if (job) {
        job.cancelled = true;
        for (const abort of [...job.aborts]) abort();
        activeJob = null;
    }
    stopPlayer();
    setProgress('');
    setBusy(false);
};

function resetVideoMaker() {
    window.stopVideoMaker();
    releaseAssets();
    clearResult();
    pendingAlbum = null;
    brandSettings = null;
    const music = $('videoMakerMusic');
    if (music) music.value = '';
    const canvas = $('videoMakerCanvas');
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    const modal = $('videoMakerModal');
    if (modal && !modal.classList.contains('hidden')) window.closeModal?.('videoMakerModal');
}
window.resetVideoMaker = resetVideoMaker;
