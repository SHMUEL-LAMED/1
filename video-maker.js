// video-maker.js — סרטון מתמונות האלבום: ההיגיון הטהור, בלי DOM.
//
// "צור סרטון" בעמוד האירוע ובסרגל הבחירה המרובה בונה סרטון מהתמונות, עם
// תנועת מצלמה עדינה על כל תמונה (Ken Burns), מעברים מעוצבים ביניהן, שקופית
// פתיחה וסיום עם שם האירוע, והלוגו של הגלריה (brand-mark.js) בפינה.
//
// הסרטון נוצר כולו בדפדפן: Canvas מצייר כל פריים, ו-MediaRecorder מקליט אותו
// (video-maker-ui.js). כאן רק ההחלטות: האפשרויות, מה נכנס, ציר הזמן (איזו
// שקופית מוצגת בכל רגע ואיזה מעבר רץ), עקומות ההאצה ותנועת המצלמה — כולן
// דטרמיניסטיות לפי זרע, כך שהתצוגה המקדימה וההקלטה זהות. הבדיקות
// ב-video-maker.test.mjs.
import { pickPosterSource, variantEntry, isVideoLikeRecord } from './media-variants.js';
import { compareCaptureAsc } from './capture-date.js';

export const VIDEO_PREFS_KEY = 'simchat-gallery-video-maker';

// המעברים. 'mix' בוחר מעבר שונה לכל צמד שקופיות, לפי הזרע.
export const VIDEO_TRANSITIONS = Object.freeze([
    { id: 'mix', label: 'מגוון (מומלץ)' },
    { id: 'crossfade', label: 'עמעום רך' },
    { id: 'zoom', label: 'צלילה פנימה' },
    { id: 'slide', label: 'החלקה' },
    { id: 'wipe', label: 'מחיקה אלכסונית' },
    { id: 'circle', label: 'פתיחת עדשה' },
    { id: 'blinds', label: 'תריסים' },
    { id: 'blur', label: 'טשטוש ומיקוד' },
    { id: 'flash', label: 'הבזק אור' },
    { id: 'pixelate', label: 'פסיפס' },
    { id: 'split', label: 'פיצול מהמרכז' },
    { id: 'cube', label: 'קובייה מסתובבת' }
]);
export const TRANSITION_IDS = Object.freeze(VIDEO_TRANSITIONS.map(item => item.id).filter(id => id !== 'mix'));

export const VIDEO_ASPECTS = Object.freeze({
    landscape: { label: 'רוחב 16:9', width: 1280, height: 720 },
    portrait: { label: 'סטורי 9:16', width: 720, height: 1280 },
    square: { label: 'ריבוע 1:1', width: 1080, height: 1080 }
});

export const VIDEO_THEMES = Object.freeze({
    gold: { label: 'זהב לילי', background: '#0B0D1A', accent: '#E2B866', ink: '#FFF4DC', glow: 'rgba(226, 184, 102, 0.35)' },
    royal: { label: 'כחול מלכותי', background: '#081232', accent: '#8FB5FF', ink: '#EEF3FF', glow: 'rgba(110, 150, 255, 0.35)' },
    ivory: { label: 'שנהב', background: '#F4EEE2', accent: '#9A6A26', ink: '#2A2118', glow: 'rgba(154, 106, 38, 0.25)' }
});

export const SLIDE_SECONDS_OPTIONS = Object.freeze([2, 3, 4, 5, 6]);
export const TRANSITION_SECONDS = 0.9;
export const TITLE_SECONDS = 3.2;
export const OUTRO_SECONDS = 2.6;
export const VIDEO_FPS = 30;
export const VIDEO_MAX_ITEMS = 120;

export const DEFAULT_VIDEO_OPTIONS = Object.freeze({
    transition: 'mix',
    aspect: 'landscape',
    theme: 'gold',
    slideSeconds: 4,
    kenBurns: true,
    titleCard: true,
    captions: true,
    logo: true
});

export function normalizeVideoOptions(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const transition = VIDEO_TRANSITIONS.some(item => item.id === source.transition) ? source.transition : DEFAULT_VIDEO_OPTIONS.transition;
    const aspect = Object.hasOwn(VIDEO_ASPECTS, source.aspect) ? source.aspect : DEFAULT_VIDEO_OPTIONS.aspect;
    const theme = Object.hasOwn(VIDEO_THEMES, source.theme) ? source.theme : DEFAULT_VIDEO_OPTIONS.theme;
    const seconds = Number(source.slideSeconds);
    const slideSeconds = SLIDE_SECONDS_OPTIONS.includes(seconds) ? seconds : DEFAULT_VIDEO_OPTIONS.slideSeconds;
    const flag = (key) => (typeof source[key] === 'boolean' ? source[key] : DEFAULT_VIDEO_OPTIONS[key]);
    return {
        transition, aspect, theme, slideSeconds,
        kenBurns: flag('kenBurns'),
        titleCard: flag('titleCard'),
        captions: flag('captions'),
        logo: flag('logo')
    };
}

function secureUrl(value) {
    const url = String(value ?? '').trim();
    return /^https:\/\//i.test(url) ? url : '';
}

function safeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

// המקור לשקופית: התצוגה הבינונית (1280px) — חדה מספיק ל-720p ו-1080 בריבוע,
// וקלה בהרבה מהמקור; בלעדיה המקור. סרטון — הפוסטר שלו (תמונה, לא הסרטון).
export function pickVideoSource(record, sanitize = secureUrl) {
    if (isVideoLikeRecord(record)) return pickPosterSource(record, sanitize);
    return variantEntry(record, 'medium')?.url || sanitize(record?.url);
}

// הפריטים שייכנסו לסרטון: בלי כפילויות, לפי סדר הצילום, רק מי שיש לו תמונה,
// ועד max. skipped — בלי תמונה; truncated — מה שנחתך בתקרה.
export function prepareVideoItems(records, { sanitize = secureUrl, max = VIDEO_MAX_ITEMS } = {}) {
    const seen = new Set();
    const list = [];
    for (const record of Array.isArray(records) ? records : []) {
        const id = safeId(record?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push(record);
    }
    list.sort(compareCaptureAsc);
    const items = [];
    let skipped = 0;
    for (const record of list) {
        const src = pickVideoSource(record, sanitize);
        if (!src) { skipped += 1; continue; }
        const caption = String(record?.caption ?? '').replace(/\s+/g, ' ').trim();
        const title = String(record?.title ?? '').replace(/\s+/g, ' ').trim();
        items.push({ id: safeId(record.id), src, caption: caption || title });
    }
    const truncated = Math.max(0, items.length - max);
    return { items: items.slice(0, max), skipped, truncated };
}

// --- זרע ומספרים אקראיים דטרמיניסטיים ---

export function hashSeed(text) {
    let hash = 2166136261;
    for (const char of String(text ?? '')) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

// mulberry32: מהיר, קטן ודטרמיניסטי.
export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- עקומות האצה ---

export const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));
export const easeInOutCubic = t => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutExpo = t => {
    const x = clamp01(t);
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
};
export const easeInOutSine = t => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

// --- תנועת המצלמה (Ken Burns) ---

// לכל שקופית: זום מ-from ל-to, ותזוזה ממרכז אחד לאחר. השקופיות מתחלפות בין
// התקרבות להתרחקות, כדי שהסרטון ינשום.
export function kenBurnsPlan(index, seed) {
    const random = seededRandom((seed ^ Math.imul(index + 1, 2654435761)) >>> 0);
    const zoomIn = index % 2 === 0;
    const near = 1.04 + random() * 0.04;
    const far = 1.14 + random() * 0.08;
    const pan = () => (random() - 0.5) * 0.12;
    return {
        fromScale: zoomIn ? near : far,
        toScale: zoomIn ? far : near,
        fromX: pan(), fromY: pan(),
        toX: pan(), toY: pan()
    };
}

export function kenBurnsAt(plan, progress, enabled = true) {
    if (!enabled) return { scale: 1, x: 0, y: 0 };
    const t = easeInOutSine(progress);
    return {
        scale: plan.fromScale + (plan.toScale - plan.fromScale) * t,
        x: plan.fromX + (plan.toX - plan.fromX) * t,
        y: plan.fromY + (plan.toY - plan.fromY) * t
    };
}

// גודל ומיקום של תמונה בגודל imageW×imageH שממלאת מסגרת frameW×frameH
// ("cover"), עם זום ותזוזה יחסית (x/y ביחידות של רוחב/גובה המסגרת).
export function coverRect(imageW, imageH, frameW, frameH, { scale = 1, x = 0, y = 0 } = {}) {
    const iw = Math.max(1, Number(imageW) || 1);
    const ih = Math.max(1, Number(imageH) || 1);
    const base = Math.max(frameW / iw, frameH / ih) * Math.max(1, scale);
    const width = iw * base;
    const height = ih * base;
    // התזוזה מוגבלת כך שהתמונה לעולם אינה חושפת את הרקע.
    const maxX = Math.max(0, (width - frameW) / 2);
    const maxY = Math.max(0, (height - frameH) / 2);
    const dx = Math.max(-maxX, Math.min(maxX, x * frameW));
    const dy = Math.max(-maxY, Math.min(maxY, y * frameH));
    return {
        x: (frameW - width) / 2 + dx,
        y: (frameH - height) / 2 + dy,
        width,
        height
    };
}

// --- ציר הזמן ---

// המעבר בין שקופית index לבאה אחריה.
export function transitionFor(options, index, seed) {
    const { transition } = normalizeVideoOptions(options);
    if (transition !== 'mix') return transition;
    // מגוון בלי חזרה על אותו מעבר פעמיים ברצף.
    const random = seededRandom((seed ^ Math.imul(index + 7, 40503)) >>> 0);
    const previous = index > 0 ? transitionFor(options, index - 1, seed) : '';
    let pick = TRANSITION_IDS[Math.floor(random() * TRANSITION_IDS.length)];
    if (pick === previous) pick = TRANSITION_IDS[(TRANSITION_IDS.indexOf(pick) + 1) % TRANSITION_IDS.length];
    return pick;
}

// השקופיות של הסרטון: פתיחה (אם נבחרה), התמונות, וסיום. כל שקופית מתחילה
// TRANSITION_SECONDS לפני שהקודמת מסתיימת — זה זמן המעבר.
export function buildTimeline(itemCount, rawOptions = {}, seed = 1) {
    const options = normalizeVideoOptions(rawOptions);
    const count = Math.max(0, Math.trunc(Number(itemCount)) || 0);
    const slides = [];
    if (count && options.titleCard) slides.push({ kind: 'title', seconds: TITLE_SECONDS });
    for (let index = 0; index < count; index += 1) slides.push({ kind: 'photo', item: index, seconds: options.slideSeconds });
    if (count && options.titleCard) slides.push({ kind: 'outro', seconds: OUTRO_SECONDS });

    let cursor = 0;
    const timeline = slides.map((slide, index) => {
        const start = cursor;
        const end = start + slide.seconds;
        cursor = end - (index < slides.length - 1 ? TRANSITION_SECONDS : 0);
        return { ...slide, index, start, end, transition: index < slides.length - 1 ? transitionFor(options, index, seed) : null };
    });
    const duration = timeline.length ? timeline[timeline.length - 1].end : 0;
    return { slides: timeline, duration, options };
}

// מה מוצג ברגע time: השקופית הנוכחית, ואם רץ מעבר — גם הבאה וההתקדמות שלו.
export function frameAt(timeline, time) {
    const slides = timeline?.slides || [];
    if (!slides.length) return null;
    const t = Math.max(0, Math.min(Number(time) || 0, timeline.duration));
    let index = slides.findIndex(slide => t < slide.end);
    if (index === -1) index = slides.length - 1;
    // ברגע החפיפה הקודמת עדיין "נוכחית" והבאה נכנסת.
    while (index > 0 && t < slides[index].start + 1e-9) index -= 1;
    const current = slides[index];
    const next = slides[index + 1];
    const local = clamp01((t - current.start) / current.seconds);
    if (next && t >= next.start) {
        return {
            current, next,
            local,
            nextLocal: clamp01((t - next.start) / next.seconds),
            transition: current.transition,
            progress: clamp01((t - next.start) / TRANSITION_SECONDS)
        };
    }
    return { current, next: null, local, nextLocal: 0, transition: null, progress: 0 };
}

// שם הקובץ: שם האירוע, בלי תווים שאסורים בשמות קבצים.
export function videoFileName(title, mimeType = 'video/webm') {
    const base = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'סרטון';
    const extension = String(mimeType).includes('mp4') ? 'mp4' : 'webm';
    return `${base}.${extension}`;
}

// סוג ההקלטה הטוב ביותר שהדפדפן תומך בו: MP4 (ספארי, כרום חדש) נפתח בכל
// טלפון; WebM ככל הנראה בכל השאר.
export const RECORDER_TYPES = Object.freeze([
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
]);

export function pickRecorderType(isSupported = () => false) {
    return RECORDER_TYPES.find(type => {
        try { return Boolean(isSupported(type)); } catch { return false; }
    }) || '';
}

export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
}
