// lightbox-slideshow.js — מצגת בתצוגה המלאה.
//
// "הפעל מצגת" (בסרגל התצוגה המלאה, בסרגל הגלריה ובדף האירוע) מנגן את
// התיקייה הנוכחית ברצף: מסך מלא כשה-Fullscreen API זמין, מעבר עמעום רך בין
// השקופיות ותנועת Ken Burns איטית על כל תמונה (עם prefers-reduced-motion —
// עמעום בלבד, בלי תנועה). זמן לשקופית: 3, 5 או 8 שניות (נשמר בדפדפן).
// סרטונים מתנגנים עד הסוף ואז המצגת ממשיכה, או מדולגים — לפי הבחירה.
// רווח משהה וממשיך, Escape עוצר (וגם יציאה ממסך מלא). Wake Lock שומר על
// המסך דולק כל עוד המצגת מתנגנת. השקופית הבאה נטענת מראש בתצוגה המלאה
// (preloadLightboxNeighbours ב-gallery.js).
//
// המצב מסומן על #lightboxModal ב-data-slideshow ("playing" / "paused"),
// ומוכרז לקוראי מסך ב-#slideshowStatus (aria-live). התזמון עצמו —
// createSlideshowScheduler ב-lightbox-math.js — נבדק בבדיקות יחידה.
import { createSlideshowScheduler, normalizeSlideshowInterval } from './lightbox-math.js';

const INTERVAL_KEY = 'simchat_slideshow_interval';
const SKIP_VIDEOS_KEY = 'simchat_slideshow_skip_videos';
const CROSSFADE_MS = 800;
const CROSSFADE_REDUCED_MS = 450;
const READY_WAIT_MS = 1500;

let deps = null;
let scheduler = null;
let active = false;
let enteredFullscreen = false;
let wakeLock = null;
let skipVideos = false;
let slideToken = 0;
let slideAbort = null;
let kenBurns = null;
let progress = null;
const el = {};

const doc = () => globalThis.document;

function storageGet(key) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

function storageSet(key, value) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* מצב פרטי */ }
}

function prefersReducedMotion() {
    try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
}

function currentItem() {
    return deps?.getItems()?.[deps.getIndex()] || null;
}

function isEligible(item) {
    return Boolean(item) && !(skipVideos && deps.isVideo(item));
}

function eligibleCount() {
    return (deps?.getItems() || []).filter(isEligible).length;
}

function announce(text) {
    if (!el.status) return;
    el.status.textContent = '';
    // ניקוי ואז כתיבה, כדי שקורא המסך יכריז גם על הודעה שחוזרת על עצמה.
    setTimeout(() => { if (el.status) el.status.textContent = text; }, 30);
}

function refreshIcons() {
    globalThis.window?.scheduleIconRefresh?.();
}

function renderControls() {
    const modal = el.modal;
    const state = active ? scheduler.state : 'idle';
    if (modal) {
        modal.classList.toggle('is-slideshow', active);
        if (active) modal.dataset.slideshow = state;
        else delete modal.dataset.slideshow;
    }
    if (el.controls) el.controls.hidden = !active;
    if (el.toggle) {
        const label = active ? 'עצירת המצגת' : 'הפעל מצגת';
        el.toggle.setAttribute('aria-label', label);
        el.toggle.title = label;
        el.toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
        el.toggle.innerHTML = `<i data-lucide="${active ? 'square' : 'play'}" class="w-5 h-5"></i><span class="slideshow-toggle-text">${active ? 'עצור מצגת' : 'הפעל מצגת'}</span>`;
    }
    if (el.pause) {
        const paused = state === 'paused';
        el.pause.setAttribute('aria-label', paused ? 'המשך המצגת' : 'השהיית המצגת');
        el.pause.title = paused ? 'המשך (רווח)' : 'השהיה (רווח)';
        el.pause.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}" class="w-5 h-5"></i>`;
    }
    if (el.videos) {
        el.videos.setAttribute('aria-pressed', skipVideos ? 'false' : 'true');
        el.videos.textContent = skipVideos ? 'סרטונים: מדלג' : 'סרטונים: מנגן';
    }
    if (el.interval && scheduler) el.interval.value = String(scheduler.interval);
    refreshIcons();
}

// --- פס ההתקדמות ---

function stopProgress() {
    progress?.cancel?.();
    progress = null;
    if (el.progress?.style) el.progress.style.transform = 'scaleX(0)';
}

function startProgress() {
    stopProgress();
    if (!el.progress || typeof el.progress.animate !== 'function' || !scheduler) return;
    const remaining = scheduler.remaining();
    const done = 1 - remaining / scheduler.interval;
    progress = el.progress.animate(
        [{ transform: `scaleX(${Math.max(0, Math.min(1, done))})` }, { transform: 'scaleX(1)' }],
        { duration: Math.max(1, remaining), easing: 'linear', fill: 'forwards' }
    );
    if (scheduler.state === 'paused') progress.pause();
}

// --- מסך מלא ו-Wake Lock ---

function fullscreenElement() {
    const d = doc();
    return d?.fullscreenElement || d?.webkitFullscreenElement || null;
}

function enterFullscreen() {
    const modal = el.modal;
    if (!modal || fullscreenElement()) return;
    const request = modal.requestFullscreen || modal.webkitRequestFullscreen;
    if (typeof request !== 'function') return;
    try {
        const result = request.call(modal, { navigationUI: 'hide' });
        enteredFullscreen = true;
        Promise.resolve(result).catch(() => { enteredFullscreen = false; });
    } catch {
        enteredFullscreen = false;
    }
}

function exitFullscreen() {
    const wasOurs = enteredFullscreen;
    enteredFullscreen = false;
    if (!wasOurs || fullscreenElement() !== el.modal) return;
    const d = doc();
    const exit = d.exitFullscreen || d.webkitExitFullscreen;
    try { Promise.resolve(exit?.call(d)).catch(() => {}); } catch { /* כבר יצא */ }
}

function onFullscreenChange() {
    // יציאה ממסך מלא (Escape של הדפדפן, מחווה) עוצרת את המצגת.
    if (active && enteredFullscreen && !fullscreenElement()) {
        enteredFullscreen = false;
        stopSlideshow();
    }
}

async function acquireWakeLock() {
    if (!active || wakeLock || doc()?.visibilityState === 'hidden') return;
    try {
        const lock = await globalThis.navigator?.wakeLock?.request('screen');
        if (!lock) return;
        if (!active) { lock.release?.().catch?.(() => {}); return; }
        wakeLock = lock;
        lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch { /* אין Wake Lock או שהדפדפן סירב — המצגת ממשיכה */ }
}

function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    try { Promise.resolve(lock?.release?.()).catch(() => {}); } catch { /* כבר שוחרר */ }
}

function onVisibilityChange() {
    // הדפדפן משחרר את הנעילה כשהלשונית מוסתרת; חוזרים אליה — מבקשים שוב.
    if (doc()?.visibilityState === 'visible' && active && scheduler?.state === 'playing') acquireWakeLock();
}

// --- מעברים ---

function waitForStage() {
    return new Promise(resolve => {
        const started = Date.now();
        const tick = () => {
            if (!el.stage?.classList?.contains('is-loading') || Date.now() - started > READY_WAIT_MS) resolve();
            else (globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16)))(tick);
        };
        tick();
    });
}

// עותק של התמונה הנוכחית נשאר מעל הבמה בזמן ההחלפה, ונמוג מעל החדשה.
function captureCrossfade() {
    const image = el.image;
    if (!image || image.hidden || !el.stage || typeof image.getBoundingClientRect !== 'function') return null;
    const src = image.currentSrc || image.src;
    if (!src) return null;
    const rect = image.getBoundingClientRect();
    const stageRect = el.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const overlay = doc().createElement('img');
    overlay.className = 'slideshow-fade';
    overlay.alt = '';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.src = src;
    Object.assign(overlay.style, {
        left: `${rect.left - stageRect.left}px`,
        top: `${rect.top - stageRect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
    });
    el.stage.appendChild(overlay);
    return overlay;
}

function fadeOut(overlay) {
    if (!overlay) return;
    const duration = prefersReducedMotion() ? CROSSFADE_REDUCED_MS : CROSSFADE_MS;
    if (typeof overlay.animate !== 'function') { overlay.remove(); return; }
    const animation = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease', fill: 'forwards' });
    animation.finished.then(() => overlay.remove(), () => overlay.remove());
}

function clearOverlays() {
    el.stage?.querySelectorAll?.('.slideshow-fade').forEach(node => node.remove());
}

function stopKenBurns() {
    kenBurns?.cancel?.();
    kenBurns = null;
}

function startKenBurns() {
    stopKenBurns();
    const image = el.image;
    if (!image || image.hidden || prefersReducedMotion() || typeof image.animate !== 'function') return;
    // כיוון אקראי עדין לכל שקופית: הגדלה של 8% והזזה של עד 1.5%.
    const drift = () => ((Math.random() * 3) - 1.5).toFixed(2);
    kenBurns = image.animate(
        [{ transform: 'scale(1) translate(0, 0)' }, { transform: `scale(1.08) translate(${drift()}%, ${drift()}%)` }],
        { duration: scheduler.interval + CROSSFADE_MS, easing: 'linear', fill: 'forwards' }
    );
    if (scheduler.state === 'paused') kenBurns.pause();
}

// --- השקופיות ---

function playVideo(token) {
    const video = el.video;
    if (!video) { scheduler.slideShown(); return; }
    scheduler.hold();
    stopProgress();
    const signal = slideAbort.signal;
    const finish = () => { if (token === slideToken && active) scheduler.release(); };
    video.addEventListener('ended', finish, { signal });
    video.addEventListener('error', finish, { signal });
    video.addEventListener('timeupdate', () => {
        if (token !== slideToken || !el.progress?.style || !(video.duration > 0)) return;
        el.progress.style.transform = `scaleX(${Math.min(1, video.currentTime / video.duration)})`;
    }, { signal });
    if (scheduler.state !== 'playing') return;
    const attempt = () => Promise.resolve(video.play?.());
    // ניגון עם קול עלול להיחסם; אז מנגנים מושתק, ואם גם זה נכשל — הסרטון
    // מוצג כמו תמונה למשך הזמן הרגיל.
    attempt().catch(() => { video.muted = true; return attempt(); }).catch(() => {
        if (token === slideToken && active) {
            scheduler.slideShown();
            startProgress();
        }
    });
}

function onSlide(overlay = null) {
    if (!active) return;
    slideToken += 1;
    const token = slideToken;
    slideAbort?.abort();
    slideAbort = typeof AbortController === 'function' ? new AbortController() : { signal: undefined, abort() {} };
    stopKenBurns();
    const item = currentItem();
    if (item && deps.isVideo(item) && !skipVideos) {
        fadeOut(overlay);
        playVideo(token);
        return;
    }
    scheduler.slideShown();
    startProgress();
    waitForStage().then(() => {
        if (token !== slideToken) { overlay?.remove(); return; }
        fadeOut(overlay);
        if (active) startKenBurns();
    });
}

function nextEligibleIndex() {
    const items = deps.getItems() || [];
    const count = items.length;
    const start = deps.getIndex();
    for (let step = 1; step <= count; step++) {
        const index = (start + step) % count;
        if (isEligible(items[index])) return index;
    }
    return -1;
}

function advance() {
    if (!active) return;
    const index = nextEligibleIndex();
    if (index < 0) { stopSlideshow(); return; }
    const overlay = captureCrossfade();
    deps.showIndex(index);
    onSlide(overlay);
}

// --- ממשק ---

export function isSlideshowActive() {
    return active;
}

export function getSlideshowState() {
    return active ? scheduler.state : 'idle';
}

export function startSlideshow() {
    if (!deps) return false;
    if (active) return true;
    if (eligibleCount() < 2) {
        deps.notify?.(skipVideos ? 'נדרשות לפחות שתי תמונות להפעלת מצגת.' : 'נדרשים לפחות שני פריטים להפעלת מצגת.', false);
        return false;
    }
    active = true;
    if (!isEligible(currentItem())) {
        const index = nextEligibleIndex();
        if (index >= 0) deps.showIndex(index);
    }
    scheduler.start();
    enterFullscreen();
    acquireWakeLock();
    renderControls();
    onSlide();
    announce(`המצגת פועלת, ${Math.round(scheduler.interval / 1000)} שניות לשקופית. רווח להשהיה, Escape לעצירה.`);
    return true;
}

export function stopSlideshow({ silent = false } = {}) {
    if (!active) return;
    active = false;
    slideToken += 1;
    slideAbort?.abort();
    scheduler.stop();
    stopKenBurns();
    stopProgress();
    clearOverlays();
    exitFullscreen();
    releaseWakeLock();
    renderControls();
    if (!silent) announce('המצגת נעצרה.');
}

export function toggleSlideshowPause() {
    if (!active) return;
    if (scheduler.state === 'playing') {
        scheduler.pause();
        progress?.pause?.();
        kenBurns?.pause?.();
        if (scheduler.holding) el.video?.pause?.();
        releaseWakeLock();
        announce('המצגת מושהית. רווח להמשך.');
    } else {
        scheduler.resume();
        progress?.play?.();
        kenBurns?.play?.();
        if (scheduler.holding && el.video && !el.video.ended) Promise.resolve(el.video.play?.()).catch(() => {});
        acquireWakeLock();
        announce('המצגת ממשיכה.');
    }
    renderControls();
}

// מעבר ידני (חצים, מקלדת, החלקה) בזמן מצגת: השקופית החדשה מקבלת זמן מלא.
export function slideshowNoteNavigation() {
    if (active) onSlide();
}

// מקשי המצגת. מחזיר true כשהמקש טופל (ואז אין להמשיך בטיפול הרגיל).
export function handleSlideshowKey(event) {
    if (!active) return false;
    const tag = event.target?.tagName;
    if (event.key === 'Escape') {
        event.preventDefault();
        stopSlideshow();
        return true;
    }
    if ((event.key === ' ' || event.code === 'Space') && tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        event.preventDefault();
        if (!event.repeat) toggleSlideshowPause();
        return true;
    }
    return false;
}

function onKeyUp(event) {
    // רווח על כפתור שבפוקוס היה "לוחץ" עליו ב-keyup; בזמן מצגת הרווח שייך לה.
    if (active && (event.key === ' ' || event.code === 'Space') && event.target?.tagName === 'BUTTON') event.preventDefault();
}

function setSkipVideos(value) {
    skipVideos = Boolean(value);
    storageSet(SKIP_VIDEOS_KEY, skipVideos ? '1' : '0');
    if (active && skipVideos && deps.isVideo(currentItem())) {
        el.video?.pause?.();
        if (eligibleCount() < 1) stopSlideshow();
        else advance();
    }
    renderControls();
}

// options: getItems(), getIndex(), showIndex(index), isVideo(item), notify(text, ok).
export function initLightboxSlideshow(options) {
    if (deps) return;
    deps = options;
    const d = doc();
    const byId = id => d?.getElementById?.(id) || null;
    Object.assign(el, {
        modal: byId('lightboxModal'),
        stage: byId('lightboxStage'),
        image: byId('lightboxImage'),
        video: byId('lightboxVideo'),
        toggle: byId('slideshowToggle'),
        controls: byId('slideshowControls'),
        pause: byId('slideshowPauseBtn'),
        stop: byId('slideshowStopBtn'),
        interval: byId('slideshowInterval'),
        videos: byId('slideshowVideosBtn'),
        progress: byId('slideshowProgress'),
        status: byId('slideshowStatus')
    });
    skipVideos = storageGet(SKIP_VIDEOS_KEY) === '1';
    scheduler = createSlideshowScheduler({
        interval: normalizeSlideshowInterval(storageGet(INTERVAL_KEY)),
        onAdvance: advance
    });
    el.pause?.addEventListener?.('click', toggleSlideshowPause);
    el.stop?.addEventListener?.('click', () => stopSlideshow());
    el.videos?.addEventListener?.('click', () => setSkipVideos(!skipVideos));
    el.interval?.addEventListener?.('change', () => {
        const ms = scheduler.setInterval(el.interval.value);
        storageSet(INTERVAL_KEY, String(ms));
        if (active && !scheduler.holding) {
            startProgress();
            if (kenBurns) startKenBurns();
        }
        announce(`${Math.round(ms / 1000)} שניות לשקופית.`);
    });
    d?.addEventListener?.('fullscreenchange', onFullscreenChange);
    d?.addEventListener?.('webkitfullscreenchange', onFullscreenChange);
    d?.addEventListener?.('visibilitychange', onVisibilityChange);
    d?.addEventListener?.('keyup', onKeyUp, true);
    renderControls();
}
