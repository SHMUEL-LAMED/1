// face-search.js — מנגנון חיפוש הפנים והטעינה המאוחרת של מנוע הזיהוי
// נוצר מפיצול index.html למודולים נפרדים; הלוגיקה זהה למקור.

// --- 10. חיפוש פרצוף אמיתי (face-api.js, מקומי בדפדפן, בלי מפתח API) ---
// המנוע אינו נטען עם האתר. הספרייה והמודלים יורדים רק כשהמשתמש פותח
// בפועל את כלי חיפוש הפנים, דרך Promise יחיד שנשמר לכל אורך הכניסה.
let faceEnginePromise = null;
let faceSearchQueryImageSrc = null;
// מרחק קטן יותר פירושו דמיון גבוה יותר. הסף הגמיש מזהה את אותו אדם
// גם בשינויי זווית ותאורה, ועדיין מצמצם התאמות שגויות.
const FACE_MATCH_THRESHOLD = 0.62;
const FACE_STRONG_MATCH_THRESHOLD = 0.48;
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

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
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
        const faceapi = await loadFaceApi();
        if(bar) bar.style.width = '20%';

        if(statusText) statusText.innerText = 'ה־AI לומד את מאפייני הפנים בתמונה...';
        const queryImg = await loadImageElement(faceSearchQueryImageSrc);
        const queryDet = await faceapi.detectSingleFace(queryImg).withFaceLandmarks().withFaceDescriptor();
        if (!queryDet) {
            window.showNotification('לא זוהה פרצוף בתמונה שהעלית. נסה תמונה ברורה וחזיתית יותר.', false);
            if(statusEl) statusEl.classList.add('hidden');
            if(btn) btn.disabled = false;
            return;
        }
        const queryDescriptor = queryDet.descriptor;

        const matches = [];
        const searchableImages = window.state.images.filter(item => !window.isVideoRecord(item));
        const total = searchableImages.length;
        let failedImages = 0;
        for (let i = 0; i < total; i++) {
            const imgData = searchableImages[i];
            try {
                let descriptors = window.descriptorCache[imgData.id];
                if (!descriptors) {
                    const galleryUrl = window.safeImageUrl(imgData.url);
                    if (!galleryUrl) throw new Error('כתובת התמונה אינה תקינה או אינה מורשית.');
                    const galleryImg = await loadImageElement(galleryUrl);
                    const detections = await faceapi.detectAllFaces(galleryImg).withFaceLandmarks().withFaceDescriptors();
                    descriptors = detections.map(d => Array.from(d.descriptor));
                    window.descriptorCache[imgData.id] = descriptors;
                    // נותן לדפדפן לצייר ולטפל באירועים בין זיהויים כבדים
                    await new Promise(resolve => setTimeout(resolve, 0));
                }

                const distances = descriptors.map(desc => {
                    const floatArray = new Float32Array(desc);
                    return faceapi.euclideanDistance(floatArray, queryDescriptor);
                });
                const bestDistance = distances.length ? Math.min(...distances) : Infinity;

                if (bestDistance < FACE_MATCH_THRESHOLD) {
                    const confidence = Math.max(0, Math.min(100,
                        Math.round((1 - bestDistance / FACE_MATCH_THRESHOLD) * 55 + 45)
                    ));
                    matches.push({
                        ...imgData,
                        faceMatchDistance: bestDistance,
                        faceMatchConfidence: confidence,
                        faceMatchStrength: bestDistance < FACE_STRONG_MATCH_THRESHOLD ? 'strong' : 'possible'
                    });
                }
            } catch (error) {
                failedImages++;
                console.warn(`Face search skipped image ${window.safeRecordId(imgData?.id) || i}:`, error);
            }
            if(statusText) statusText.innerText = `סורק תמונות... ${i + 1}/${total}`;
            if(bar) bar.style.width = `${20 + Math.round(((i + 1) / total) * 78)}%`;
        }

        if(bar) bar.style.width = '100%';
        matches.sort((a, b) => a.faceMatchDistance - b.faceMatchDistance);
        window.state.tempSearchResults = matches;
        showFaceResultBanner(matches.length);
        window.renderImages();
        window.closeModal('faceSearchModal');
        if (matches.length) {
            const skippedText = failedImages ? ` ${failedImages} תמונות לא הצליחו להיסרק.` : '';
            window.showNotification(`נמצאו ${matches.length} תמונות עם הפרצוף הזה.${skippedText}`, true);
        } else if (failedImages) {
            window.showNotification(`לא נמצאה התאמה, אך ${failedImages} מתוך ${total} תמונות לא הצליחו להיסרק.`, false);
        } else {
            window.showNotification('לא נמצאו תמונות תואמות.', false);
        }
    } catch (err) {
        console.error('Face recognition engine failed:', err);
        const technicalMessage = String(err?.message || '').trim();
        const userMessage = technicalMessage
            ? `זיהוי הפנים נכשל: ${technicalMessage}`
            : 'זיהוי הפנים נכשל מסיבה לא ידועה.';
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
