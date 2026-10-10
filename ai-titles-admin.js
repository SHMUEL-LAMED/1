// ai-titles-admin.js — מסך "שמות, כיתובים ותגיות עם AI" בלוח הניהול: ריצת
// ההשלמה לתמונות שכבר בגלריה.
//
// כל קריאה ל־POST /ai-title נותנת לתמונה, בקריאה אחת למודל, שם, כיתוב ותגיות
// סצנה (ראו generateImageDescription ב־cloudflare-worker.js). הריצה בוחרת רק
// תמונות שחסר להן משהו (needsAiDescription ב־scene-tags.js), ולכן אפשר לעצור
// ולהמשיך — גם אחרי רענון — בלי לעבד שוב את מה שכבר נשמר. הקצב מוגבל בצד
// הלקוח (בקשה אחת בכל AI_DESCRIBE_INTERVAL_MS) ובשרת (מכסה לשעה לכל האתר).
import { needsAiDescription, isAiDescribable, hasDescription, normalizeSceneTags, AI_CAPTION_VERSION } from './scene-tags.js';

// מרווח מינימלי בין שתי תמונות: עדין מול ספק ה־AI, ועדיין מהיר לגלריה גדולה.
export const AI_DESCRIBE_INTERVAL_MS = 1200;
// עומס זמני אצל ספק ה־AI: עד שלושה ניסיונות חוזרים עם המתנה גדלה.
export const AI_DESCRIBE_RETRY_DELAYS_MS = [5000, 15000, 30000];

// מה עושים עם שגיאה של תמונה אחת:
//   retry — עומס זמני אצל הספק; מחכים ומנסים שוב את אותה תמונה.
//   stop  — אין טעם להמשיך (אין מפתח, אין יתרה, המכסה לשעה התמלאה, השרת אינו זמין).
//   skip  — בעיה בתמונה הזו בלבד; רושמים כישלון וממשיכים לבאה.
export function classifyDescribeError(error) {
    const status = Number(error?.status) || 0;
    const code = String(error?.code || '');
    if (code === 'openai_rate_limited') return 'retry';
    // תשובה לא תקינה של המודל לתמונה מסוימת אינה סיבה לעצור את כל הגלריה.
    if (code === 'invalid_ai_title' || code === 'invalid_ai_response') return 'skip';
    // בלי סטטוס — אין חיבור לשרת; כל תמונה נוספת הייתה נכשלת באותו אופן.
    if (!status || status === 429 || status === 401 || status === 403 || status >= 500) return 'stop';
    // 404 של תמונה שנמחקה בינתיים הוא בעיה של התמונה; 404 אחר — נתיב שאינו קיים ב־Worker.
    if (status === 404 && code !== 'not_found') return 'stop';
    return 'skip';
}

export function retryDelayMs(attempt) {
    return AI_DESCRIBE_RETRY_DELAYS_MS[attempt] ?? null;
}

let running = false;
let stopped = false;
let candidates = [];
let aiEnabled = true;
const element = id => document.getElementById(id);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// המתנה שנקטעת מיד כשהמנהל לוחץ "עצור".
async function pause(ms) {
    const until = Date.now() + ms;
    while (!stopped && Date.now() < until) await wait(Math.min(250, until - Date.now()));
}

// פס ההתקדמות של הריצה הנוכחית (אחוז מהתור), כמו במסכי ההשלמה האחרים.
function setProgress(done, total) {
    const track = element('aiTitlesProgress');
    const bar = element('aiTitlesProgressBar');
    if (!track || !bar) return;
    const percent = total ? Math.round((Math.min(done, total) / total) * 100) : 0;
    bar.style.width = `${percent}%`;
    track.setAttribute('aria-valuenow', String(percent));
}

async function refresh() {
    const { collection, getDocs } = window.firestoreModules;
    const snapshot = await getDocs(collection(window.db, 'artifacts', window.appId, 'public', 'data', 'images'));
    const records = [];
    snapshot.forEach(item => records.push({ ...item.data(), id: item.id }));
    const images = records.filter(isAiDescribable);
    candidates = images.filter(needsAiDescription);
    const titled = images.filter(record => record.aiTitleVersion === 1).length;
    const described = images.filter(hasDescription).length;
    element('aiTitlesSummary').textContent =
        `${titled} תמונות עם שם AI · ${described} עם כיתוב או תגיות · ${candidates.length} תמונות ממתינות`;
}

// /health אומר אם מוגדר מפתח AI בשרת. Worker ישן שאינו מדווח — מניחים שכן,
// ושגיאה בריצה עצמה תסביר.
async function readAiAvailability() {
    try {
        const health = await window.r2Request('/health', { timeoutMs: 15000 });
        return health?.aiDescriptionsEnabled !== false;
    } catch {
        return true;
    }
}

function applyResultLocally(record, result) {
    const local = window.state.images?.find(image => image.id === record.id);
    if (!local) return;
    if (result.title) local.title = result.title;
    local.aiTitleVersion = 1;
    if (result.captionSource !== 'manual') {
        if (result.caption) local.caption = result.caption;
        else delete local.caption;
        const sceneTags = normalizeSceneTags(result.sceneTags);
        if (sceneTags.length) local.sceneTags = sceneTags;
        else delete local.sceneTags;
        local.captionSource = 'ai';
        local.aiCaptionVersion = AI_CAPTION_VERSION;
    }
    window.noteGalleryImageUpserted?.(local);
}

async function describeWithRetry(record) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await window.r2Request('/ai-title', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageId: record.id })
            });
        } catch (error) {
            const delay = classifyDescribeError(error) === 'retry' ? retryDelayMs(attempt) : null;
            if (delay === null || stopped) throw error;
            element('aiTitlesStatus').textContent = `מנוע ה־AI עמוס. מנסה שוב בעוד ${Math.round(delay / 1000)} שניות…`;
            await pause(delay);
            if (stopped) throw error;
        }
    }
}

async function start() {
    if (running || !aiEnabled) return;
    running = true;
    stopped = false;
    element('aiTitlesStart').disabled = true;
    element('aiTitlesStop').disabled = false;
    element('aiTitlesFailures').replaceChildren();
    let done = 0;
    let failed = 0;
    let stopReason = '';
    try {
        await refresh();
        const queue = [...candidates];
        setProgress(0, queue.length);
        for (const [index, record] of queue.entries()) {
            if (stopped) break;
            if (index > 0) await pause(AI_DESCRIBE_INTERVAL_MS);
            if (stopped) break;
            element('aiTitlesStatus').textContent = `מעבד תמונה ${index + 1} מתוך ${queue.length}…`;
            try {
                const result = await describeWithRetry(record);
                done += 1;
                applyResultLocally(record, result || {});
            } catch (error) {
                failed += 1;
                const line = document.createElement('p');
                line.textContent = `${record.title || record.id}: ${error.message || 'העיבוד נכשל'}`;
                element('aiTitlesFailures').append(line);
                // אין טעם לשלוח את שאר הגלריה לספק שאינו זמין או למכסה מלאה.
                if (classifyDescribeError(error) !== 'skip') {
                    stopped = true;
                    stopReason = error.message || '';
                }
            }
            setProgress(index + 1, queue.length);
        }
        const summary = `${done} תמונות עובדו · ${failed} נכשלו. אפשר להמשיך; תמונות שכבר עובדו ידולגו.`;
        element('aiTitlesStatus').textContent = stopped
            ? `הריצה נעצרה${stopReason ? ` (${stopReason})` : ''} · ${summary}`
            : `הריצה הסתיימה · ${summary}`;
        await refresh();
        window.renderImages?.();
    } catch (error) {
        element('aiTitlesStatus').textContent = error.message || 'לא ניתן לקרוא את התמונות. נסה שוב.';
    } finally {
        running = false;
        element('aiTitlesStart').disabled = !aiEnabled;
        element('aiTitlesStop').disabled = true;
    }
}

export async function openAiTitles() {
    element('aiTitlesStart').onclick = start;
    element('aiTitlesStop').onclick = () => {
        stopped = true;
        element('aiTitlesStop').disabled = true;
        element('aiTitlesStatus').textContent = 'מסיים את התמונה הנוכחית ועוצר…';
    };
    if (running) return;
    try {
        const [enabled] = await Promise.all([readAiAvailability(), refresh()]);
        aiEnabled = enabled;
        element('aiTitlesStart').disabled = !aiEnabled;
        element('aiTitlesStatus').textContent = aiEnabled
            ? 'מוכן. השם המקורי נשמר לצד שם ה־AI, וכיתוב שנערך ידנית לא יוחלף.'
            : 'מפתח ה־AI אינו מוגדר בשרת, ולכן שמות, כיתובים ותגיות אוטומטיים כבויים. אפשר עדיין לערוך כיתוב ותגיות ידנית מהתצוגה המלאה בגלריה.';
    } catch (error) {
        element('aiTitlesStatus').textContent = error.message || 'החיבור לענן עדיין לא מוכן. פתח את המסך שוב.';
    }
}
