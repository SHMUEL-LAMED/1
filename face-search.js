// face-search.js — מנגנון חיפוש הפנים והטעינה המאוחרת של מנוע הזיהוי
// נוצר מפיצול index.html למודולים נפרדים.
//
// החיפוש הרגיל אינו מוריד ואינו סורק מחדש את תמונות הגלריה: הדפדפן מעבד רק
// את תמונת החיפוש, שולח את ה-descriptor שלה ל-Worker, וה-Worker משווה אותו
// מול הטביעות השמורות ב-D1 ומחזיר רק מזהי תמונות עם מרחק ואחוז התאמה.
// האינדוקס החד־פעמי של הגלריה נמצא ב-face-index.js.

// --- 10. חיפוש פרצוף אמיתי (face-api.js, מקומי בדפדפן, בלי מפתח API) ---
// המנוע אינו נטען עם האתר. הספרייה והמודלים יורדים רק כשהמשתמש פותח
// בפועל את כלי חיפוש הפנים, דרך Promise יחיד שנשמר לכל אורך הכניסה.
let faceEnginePromise = null;
let faceSearchQueryImageSrc = null;
// ערכי הסף מוגדרים ב-Worker ומוצגים כאן לתיעוד בלבד. מרחק קטן יותר פירושו
// דמיון גבוה יותר; הסף הגמיש מזהה את אותו אדם גם בשינויי זווית ותאורה.
const FACE_MATCH_THRESHOLD = 0.62;
const FACE_STRONG_MATCH_THRESHOLD = 0.48;
// חייב להיות זהה ל-FACE_MODEL_VERSION שב-cloudflare-worker.js.
const FACE_MODEL_VERSION = 'faceapi-1.7.15-ssd-l68-r1';
const FACE_SEARCH_RESULT_LIMIT = 200;
const FACE_API_CDN_BASE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15';
// הכתובות זהות לאלו ששימשו קודם בטעינה הראשונית של index.html.
const FACE_WORKER_BASE_URL = 'https://simchas-gallery-api.0534169095.workers.dev';
const FACE_MODEL_BASE_URLS = [
    `${FACE_WORKER_BASE_URL}/face-assets/model`,
    `${FACE_API_CDN_BASE_URL}/model`
];

function loadFaceApiScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.dataset.faceApiRetry = 'true';
        script.src = src;
        script.onload = () => typeof window.faceapi !== 'undefined'
            ? resolve()
            : reject(new Error('ספריית זיהוי הפנים נטענה ללא הממשק הנדרש'));
        script.onerror = () => reject(new Error('לא ניתן להוריד את ספריית זיהוי הפנים'));
        document.head.appendChild(script);
    });
}

async function ensureFaceApiLibrary() {
    if (typeof window.faceapi !== 'undefined') return window.faceapi;

    document.querySelectorAll('script[data-face-api-retry]').forEach(script => script.remove());
    const scriptSources = [
        `${FACE_WORKER_BASE_URL}/face-assets/face-api.js?retry=${Date.now()}`,
        `${FACE_API_CDN_BASE_URL}/dist/face-api.js`
    ];

    let lastError = null;
    for (const source of scriptSources) {
        try {
            await loadFaceApiScript(source);
            return window.faceapi;
        } catch (error) {
            lastError = error;
            console.warn('טעינת ספריית זיהוי הפנים נכשלה ממקור אחד, עובר למקור גיבוי:', error);
        }
    }
    throw new Error(lastError?.message || 'לא ניתן להוריד את ספריית זיהוי הפנים');
}

async function loadFaceModelWithRetry(network, modelUrls, label) {
    if (network.isLoaded) return;

    let lastError = null;
    for (const modelUrl of modelUrls) {
        try {
            await network.loadFromUri(modelUrl);
            return;
        } catch (error) {
            lastError = error;
            console.warn(`טעינת מודל ${label} נכשלה מ-${modelUrl}, עובר למקור הבא:`, error);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw new Error(`לא ניתן להוריד את מודל ${label}. בדוק את החיבור ונסה שוב.`, { cause: lastError });
}

// טעינה מאוחרת: מזריקה את הסקריפט ומורידה את המודלים בפעם הראשונה בלבד.
// כל הקריאות הבאות מקבלות את אותו Promise, כך שסגירה ופתיחה מחדש של
// חיפוש הפנים באותה כניסה אינה טוענת או מאתחלת שוב.
function loadFaceApi() {
    if (faceEnginePromise) return faceEnginePromise;

    faceEnginePromise = (async () => {
        const api = await ensureFaceApiLibrary();
        await loadFaceModelWithRetry(api.nets.ssdMobilenetv1, FACE_MODEL_BASE_URLS, 'איתור פנים');
        await loadFaceModelWithRetry(api.nets.faceLandmark68Net, FACE_MODEL_BASE_URLS, 'נקודות פנים');
        await loadFaceModelWithRetry(api.nets.faceRecognitionNet, FACE_MODEL_BASE_URLS, 'השוואת פנים');

        if (!api.nets.ssdMobilenetv1.isLoaded
            || !api.nets.faceLandmark68Net.isLoaded
            || !api.nets.faceRecognitionNet.isLoaded) {
            throw new Error('אחד ממודלי זיהוי הפנים לא נטען במלואו');
        }

        return api;
    })();

    // כישלון מאפס את ה-Promise כדי שניסיון נוסף יוכל להתחיל מחדש,
    // ואינו מפיל את שאר האתר.
    faceEnginePromise.catch(() => { faceEnginePromise = null; });
    return faceEnginePromise;
}
window.loadFaceApi = loadFaceApi;
window.FACE_MODEL_VERSION = FACE_MODEL_VERSION;
window.FACE_MATCH_THRESHOLD = FACE_MATCH_THRESHOLD;
window.FACE_STRONG_MATCH_THRESHOLD = FACE_STRONG_MATCH_THRESHOLD;

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
// כלי האינדוקס משתמש באותה טעינת תמונה, ולכן היא נחשפת פעם אחת בלבד.
window.loadFaceImageElement = loadImageElement;

// מפת מזהה → רשומת גלריה. כאן אין סריקה של תמונות ואין הורדה שלהן: המפה
// נבנית בזיכרון מהרשימה שכבר טעונה, ומשמשת רק לתרגום התוצאות שה-Worker החזיר.
let faceGalleryIndexSource = null;
let faceGalleryIndex = new Map();

function galleryImageById(imageId) {
    const images = window.state?.images || [];
    if (faceGalleryIndexSource !== images) {
        faceGalleryIndex = new Map(images.map(image => [window.safeRecordId(image.id), image]));
        faceGalleryIndexSource = images;
    }
    return faceGalleryIndex.get(imageId) || null;
}

// התוצאה מה-Worker מכילה מזהה, מרחק ואחוז התאמה בלבד — לא descriptors.
function attachFaceMatchesToGallery(matches) {
    return (Array.isArray(matches) ? matches : [])
        .map(match => {
            const image = galleryImageById(window.safeRecordId(match?.imageId));
            if (!image) return null;
            const distance = Number(match?.distance);
            return {
                ...image,
                faceMatchDistance: Number.isFinite(distance) ? distance : FACE_MATCH_THRESHOLD,
                faceMatchConfidence: Math.max(0, Math.min(100, Math.round(Number(match?.confidence) || 0))),
                faceMatchStrength: match?.strength === 'strong' ? 'strong' : 'possible'
            };
        })
        .filter(Boolean);
}

function faceIndexNotReadyMessage(coverage) {
    if (!coverage || coverage.ready) return '';
    const total = Math.max(0, Number(coverage.totalImages) || 0);
    const indexed = Math.max(0, Number(coverage.indexedImages) || 0);
    const remaining = Math.max(0, Number(coverage.remainingImages) || 0);
    return `הכנת חיפוש הפנים בענן עדיין לא הושלמה — ${indexed} מתוך ${total} תמונות מוכנות, ${remaining} ממתינות. `
        + 'תמונות שטרם הוכנו לא ייכללו בתוצאות. מנהל יכול להשלים זאת דרך „הכן חיפוש פנים בענן”.';
}

// הודעה מקדימה בחלון החיפוש, כדי שהמשתמש ידע מראש אם האינדוקס טרם הסתיים.
async function refreshFaceSearchIndexNotice() {
    const notice = document.getElementById('faceSearchIndexNotice');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.textContent = '';
    try {
        const summary = await window.r2Request(
            `/face/index/summary?modelVersion=${encodeURIComponent(FACE_MODEL_VERSION)}`
        );
        const message = faceIndexNotReadyMessage(summary);
        if (!message) return;
        notice.textContent = message;
        notice.classList.remove('hidden');
    } catch (error) {
        // כשל בבדיקת המצב אינו מונע חיפוש; ההודעה תוצג שוב אחרי החיפוש עצמו.
        console.warn('בדיקת מצב אינדוקס הפנים נכשלה:', error);
    }
}

// --- צילום פרצוף מהמצלמה ---
let faceCameraStream = null;
let faceCameraFacing = 'user';

async function openFaceCamera() {
    window.openModal('faceCameraModal');
    await startFaceCamera();
}
window.openFaceCamera = openFaceCamera;

async function startFaceCamera() {
    const video = document.getElementById('faceCameraVideo');
    const err = document.getElementById('faceCameraError');
    if(err) err.classList.add('hidden');
    stopFaceCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if(err) {
            err.classList.remove('hidden');
            err.textContent = "המצלמה או פרוטוקול המדיה אינם נתמכים בדפדפן זה.";
        }
        window.showNotification("המצלמה אינה נתמכת בדפדפן זה.", false);
        return;
    }

    try {
        faceCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: faceCameraFacing }, audio: false });
        if(video) {
            video.srcObject = faceCameraStream;
            await video.play();
        }
    } catch (e) {
        console.error(e);
        if(err) err.classList.remove('hidden');
    }
}
window.startFaceCamera = startFaceCamera;

function stopFaceCamera() {
    if (faceCameraStream) { faceCameraStream.getTracks().forEach(t => t.stop()); faceCameraStream = null; }
}
window.stopFaceCamera = stopFaceCamera;

function flipFaceCamera() {
    faceCameraFacing = faceCameraFacing === 'user' ? 'environment' : 'user';
    startFaceCamera();
}
window.flipFaceCamera = flipFaceCamera;

function closeFaceCamera() { stopFaceCamera(); window.closeModal('faceCameraModal'); }
window.closeFaceCamera = closeFaceCamera;

function captureFacePhoto() {
    const video = document.getElementById('faceCameraVideo');
    if (!video || !video.videoWidth) { window.showNotification('המצלמה עוד לא מוכנה, נסה שוב.', false); return; }
    const maxW = 600, maxH = 600;
    let w = video.videoWidth, h = video.videoHeight;
    if (w > h) { if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; } }
    else { if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; } }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) { window.showNotification('לא ניתן לעבד את התמונה מהמצלמה.', false); return; }
    context.drawImage(video, 0, 0, w, h);
    const base64 = canvas.toDataURL('image/jpeg', 0.92);

    faceSearchQueryImageSrc = base64;

    const previewImg = document.getElementById('faceSearchPreviewImage');
    if(previewImg) previewImg.src = base64;

    const previewContainer = document.getElementById('faceSearchPreviewContainer');
    if(previewContainer) previewContainer.classList.remove('hidden');

    const fileLabel = document.getElementById('faceSearchFileLabel');
    if(fileLabel) fileLabel.innerText = 'צולם מהמצלמה';

    const submitBtn = document.getElementById('submitFaceSearchBtn');
    if(submitBtn) submitBtn.disabled = false;

    closeFaceCamera();
}
window.captureFacePhoto = captureFacePhoto;

function openFaceSearchModal() {
    if (window.state.images.length === 0) { window.showNotification('הגלרייה ריקה!', false); return; }
    if (!window.state.isGoogleUser || window.state.userApprovalStatus !== 'approved') {
        window.showNotification('חיפוש פנים זמין למשתמשים מאושרים בלבד.', false);
        return;
    }
    const fileInput = document.getElementById('faceSearchFileInput'); if (fileInput) fileInput.value = '';

    const previewContainer = document.getElementById('faceSearchPreviewContainer');
    if(previewContainer) previewContainer.classList.add('hidden');

    const submitBtn = document.getElementById('submitFaceSearchBtn');
    if(submitBtn) submitBtn.disabled = true;

    const statusEl = document.getElementById('faceSearchStatus');
    if(statusEl) statusEl.classList.add('hidden');

    faceSearchQueryImageSrc = null;
    window.openModal('faceSearchModal');

    // רק כאן מתחילה הורדת המנוע בפועל. כישלון כאן נבלע בכוונה — הודעת
    // השגיאה למשתמש מוצגת בעת החיפוש עצמו, ושאר האתר ממשיך לעבוד.
    loadFaceApi().catch(error => console.warn('טעינת מנוע זיהוי הפנים נכשלה:', error));
    refreshFaceSearchIndexNotice();
}
window.openFaceSearchModal = openFaceSearchModal;

function handleFaceSearchFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const labelEl = document.getElementById('faceSearchFileLabel');
    if(labelEl) labelEl.innerText = file.name;

    window.compressAndConvertImage(file, 600, 600, 0.92).then(base64 => {
        if (!base64) {
            window.showNotification('לא ניתן לקרוא את קובץ התמונה. נסה קובץ אחר.', false);
            return;
        }
        faceSearchQueryImageSrc = base64;
        const previewImg = document.getElementById('faceSearchPreviewImage');
        if(previewImg) previewImg.src = base64;

        const previewContainer = document.getElementById('faceSearchPreviewContainer');
        if(previewContainer) previewContainer.classList.remove('hidden');

        const submitBtn = document.getElementById('submitFaceSearchBtn');
        if(submitBtn) submitBtn.disabled = false;
    });
}
window.handleFaceSearchFileSelect = handleFaceSearchFileSelect;

async function executeFaceSearch() {
    if (!faceSearchQueryImageSrc) return;
    const statusEl = document.getElementById('faceSearchStatus');
    const statusText = document.getElementById('faceSearchStatusText');
    const bar = document.getElementById('faceSearchProgressBar');
    const btn = document.getElementById('submitFaceSearchBtn');

    if(statusEl) statusEl.classList.remove('hidden');
    if(btn) btn.disabled = true;
    if(bar) bar.style.width = '5%';

    try {
        if(statusText) statusText.innerText = 'טוען מנוע זיהוי פנים (בפעם הראשונה לוקח רגע)...';
        // window.loadFaceApi מצביע על אותה פונקציה; הקריאה דרך window מאפשרת
        // גם לכלי האינדוקס ולבדיקות להשתמש באותו מנוע בדיוק.
        const faceapi = await window.loadFaceApi();
        if(bar) bar.style.width = '25%';

        if(statusText) statusText.innerText = 'ה־AI לומד את מאפייני הפנים בתמונה שהעלית...';
        const queryImg = await loadImageElement(faceSearchQueryImageSrc);
        const queryDetection = await faceapi.detectSingleFace(queryImg).withFaceLandmarks().withFaceDescriptor();
        if (!queryDetection) {
            window.showNotification('לא זוהה פרצוף בתמונה שהעלית. נסה תמונה ברורה וחזיתית יותר.', false);
            if(statusEl) statusEl.classList.add('hidden');
            if(btn) btn.disabled = false;
            return;
        }
        if(bar) bar.style.width = '55%';

        // רק הטביעה של תמונת החיפוש נשלחת. תמונת החיפוש עצמה נשארת בדפדפן.
        if(statusText) statusText.innerText = 'משווה את טביעת הפנים מול הגלריה בענן...';
        const response = await window.r2Request('/face/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                descriptor: Array.from(queryDetection.descriptor, value => Math.round(value * 1e6) / 1e6),
                modelVersion: FACE_MODEL_VERSION,
                limit: FACE_SEARCH_RESULT_LIMIT
            })
        });
        if(bar) bar.style.width = '100%';

        const returnedMatches = Array.isArray(response?.matches) ? response.matches : [];
        const matches = attachFaceMatchesToGallery(returnedMatches);
        const missingFromGallery = returnedMatches.length - matches.length;
        const indexNotice = faceIndexNotReadyMessage(response?.coverage);

        window.state.tempSearchResults = matches;
        showFaceResultBanner(matches.length);
        window.renderImages();
        window.closeModal('faceSearchModal');

        if (matches.length) {
            const missingText = missingFromGallery > 0
                ? ` ${missingFromGallery} תוצאות אינן מוצגות כרגע בגלריה הטעונה.`
                : '';
            window.showNotification(`נמצאו ${matches.length} תמונות עם הפרצוף הזה.${missingText}`, true);
        } else if (indexNotice) {
            window.showNotification(indexNotice, false);
        } else {
            window.showNotification('לא נמצאו תמונות תואמות.', false);
        }
        // גם כשיש תוצאות חשוב לומר שהאינדוקס עדיין רץ, כדי שלא ייראה כאילו אלו כל התמונות.
        if (matches.length && indexNotice) {
            setTimeout(() => window.showNotification(indexNotice, false), 3500);
        }
    } catch (err) {
        console.error('Face recognition engine failed:', err);
        const technicalMessage = String(err?.message || '').trim();
        const userMessage = err?.status === 404
            ? 'חיפוש הפנים בענן עדיין אינו זמין בשרת. יש לפרוס את גרסת ה־Worker העדכנית.'
            : (technicalMessage
                ? `זיהוי הפנים נכשל: ${technicalMessage}`
                : 'זיהוי הפנים נכשל מסיבה לא ידועה.');
        if(statusText) statusText.innerText = userMessage;
        window.showNotification(`${userMessage} נסה שוב בעוד רגע.`, false);
    } finally {
        if(btn) btn.disabled = false;
        if(statusEl) statusEl.classList.add('hidden');
    }
}
window.executeFaceSearch = executeFaceSearch;

function showFaceResultBanner(count) {
    const banner = document.getElementById('tempSearchBanner');
    if (!banner) return;
    banner.className = "bg-gradient-to-r from-amber-500/10 to-transparent border border-white/10 rounded-2xl p-4 flex justify-between items-center shadow-md animate-fade-in transition-all backdrop-blur-xl";
    banner.innerHTML = '';

    const rightContainer = document.createElement('div');
    rightContainer.className = "flex items-center gap-3";
    rightContainer.innerHTML = `<div class="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-amber-400"><i data-lucide="sparkles" class="w-5 h-5"></i></div>`;

    const textContainer = document.createElement('div');
    const title = document.createElement('h4');
    title.className = "font-bold text-white text-sm";
    title.textContent = "תוצאות חיפוש פנים ב־AI";
    const sub = document.createElement('p');
    sub.className = "text-xs text-amber-400 font-semibold";
    sub.textContent = `${count} תמונות תואמות — מההתאמה החזקה לחלשה`;
    textContainer.appendChild(title);
    textContainer.appendChild(sub);
    rightContainer.appendChild(textContainer);

    const btn = document.createElement('button');
    btn.type = "button";
    btn.onclick = window.clearTempSearchFilter;
    btn.className = "text-xs font-bold btn-secondary-dark px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all";
    btn.textContent = "חזור לגלריה";

    banner.appendChild(rightContainer);
    banner.appendChild(btn);
    banner.classList.remove('hidden');
    window.scheduleIconRefresh();
}
