// בדיקות צד הלקוח של חיפוש הפנים והאינדוקס.
// העיקר כאן: חיפוש רגיל אינו מוריד את תמונות הגלריה, והאינדוקס מדלג על
// תמונות שכבר עובדו וממשיך מהמקום שנעצר.
import test from "node:test";
import assert from "node:assert/strict";

const GALLERY_ORIGIN = "https://simchas-gallery-api.0534169095.workers.dev";
const QUERY_IMAGE_DATA_URL = "data:image/jpeg;base64,AAAAAAAAAAAAAA";

// --- חיקוי דפדפן ---
const elements = new Map();
const imageLoads = [];
const notifications = [];
const fetchCalls = [];

function createStubElement(id = "") {
    const element = {
        id,
        className: "",
        innerHTML: "",
        innerText: "",
        textContent: "",
        value: "",
        disabled: false,
        hidden: false,
        style: {},
        dataset: {},
        children: [],
        classList: {
            add() {},
            remove() {},
            contains: () => false
        },
        appendChild(child) { element.children.push(child); return child; },
        append(...items) { element.children.push(...items); },
        replaceChildren(...items) { element.children = items; },
        setAttribute() {},
        getAttribute: () => null,
        remove() {},
        focus() {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
    return element;
}

function elementById(id) {
    if (!elements.has(id)) elements.set(id, createStubElement(id));
    return elements.get(id);
}

globalThis.document = {
    readyState: "complete",
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById: elementById,
    createElement: () => createStubElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
};

globalThis.Image = class StubImage {
    constructor() {
        this.crossOrigin = "";
        this.onload = null;
        this.onerror = null;
        this._src = "";
    }
    set src(value) {
        this._src = String(value);
        imageLoads.push(this._src);
        setTimeout(() => this.onload?.(), 0);
    }
    get src() { return this._src; }
};

const storage = new Map();
globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};

globalThis.fetch = async (url, options) => {
    fetchCalls.push(String(url));
    throw new Error(`הבדיקה אינה מצפה לבקשת רשת אל ${url} (${options?.method || "GET"})`);
};

globalThis.window = {
    state: {
        images: [],
        tempSearchResults: null,
        isGoogleUser: true,
        userApprovalStatus: "approved",
        isAdminLoggedIn: true,
        isSuperAdmin: true
    },
    descriptorCache: {},
    safeRecordId: value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
    safeImageUrl: value => {
        const url = String(value ?? "").trim();
        return /^https:\/\//i.test(url) || /^data:image\//i.test(url) ? url : "";
    },
    isVideoRecord: record => record?.mediaType === "video",
    showNotification: (message, isSuccess = true) => notifications.push({ message, isSuccess }),
    openModal() {},
    closeModal() {},
    renderImages() {},
    scheduleIconRefresh() {},
    checkAdminPermission: () => true,
    checkSuperAdminPermission: () => true,
    showConfirm: (_title, _text, onConfirm) => onConfirm(),
    logActivity: async () => {},
    compressAndConvertImage: async () => QUERY_IMAGE_DATA_URL,
    async r2Request() { throw new Error("r2Request לא הוגדר בבדיקה"); }
};

await import("./face-search.js");
await import("./face-index.js");

// --- חיקוי ה-Worker ---
function createFakeWorker({ matches = [], coverage = null } = {}) {
    const indexedImages = new Map();
    const calls = [];
    const api = {
        calls,
        indexedImages,
        onSave: null,
        buildCoverage() {
            const totalImages = window.state.images.filter(image => !window.isVideoRecord(image)).length;
            const indexed = indexedImages.size;
            return coverage || {
                totalImages,
                indexedImages: indexed,
                remainingImages: Math.max(0, totalImages - indexed),
                failedImages: 0,
                faceCount: [...indexedImages.values()].reduce((sum, count) => sum + count, 0),
                ready: indexed >= totalImages
            };
        },
        async request(path, options = {}) {
            const body = options.body ? JSON.parse(options.body) : null;
            calls.push({ path, method: options.method || "GET", body });

            if (path.startsWith("/face/index/summary")) {
                return { success: true, modelVersion: window.FACE_MODEL_VERSION, ...api.buildCoverage() };
            }
            if (path === "/face/index/pending") {
                return {
                    success: true,
                    pending: (body?.imageIds || []).filter(imageId => !indexedImages.has(imageId))
                };
            }
            if (path === "/face/index") {
                const saved = (body?.images || []).map(entry => {
                    indexedImages.set(entry.imageId, Array.isArray(entry.faces) ? entry.faces.length : 0);
                    return { imageId: entry.imageId, status: entry.status === "failed" ? "failed" : "indexed" };
                });
                if (api.onSave) await api.onSave(body);
                return { success: true, saved };
            }
            if (path === "/face/index/reset") {
                indexedImages.clear();
                return { success: true };
            }
            if (path === "/face/search") {
                return {
                    success: true,
                    modelVersion: window.FACE_MODEL_VERSION,
                    matches,
                    coverage: api.buildCoverage()
                };
            }
            throw new Error(`נתיב לא צפוי: ${path}`);
        }
    };
    window.r2Request = (path, options) => api.request(path, options);
    return api;
}

function fakeFaceEngine({ facesPerImage = () => 1 } = {}) {
    const descriptor = () => Float32Array.from({ length: 128 }, () => 0.08);
    return {
        detectSingleFace: () => ({
            withFaceLandmarks: () => ({
                withFaceDescriptor: async () => ({ descriptor: descriptor() })
            })
        }),
        detectAllFaces: element => ({
            withFaceLandmarks: () => ({
                withFaceDescriptors: async () => Array.from(
                    { length: facesPerImage(element?.src || "") },
                    () => ({ descriptor: descriptor() })
                )
            })
        })
    };
}

function galleryImages(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `image-${index}`,
        title: `תמונה ${index}`,
        url: `${GALLERY_ORIGIN}/media/approved/google-admin/image-${index}.jpg`,
        folderId: "1"
    }));
}

function resetBrowserState(images = galleryImages(5)) {
    elements.clear();
    imageLoads.length = 0;
    notifications.length = 0;
    fetchCalls.length = 0;
    storage.clear();
    window.state.images = images;
    window.state.tempSearchResults = null;
    window.state.isAdminLoggedIn = true;
    window.descriptorCache = {};
    window.loadFaceApi = async () => fakeFaceEngine();
}

async function flushTimers(times = 3) {
    for (let index = 0; index < times; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

async function selectQueryImage() {
    window.handleFaceSearchFileSelect({ target: { files: [{ name: "face.jpg" }] } });
    await flushTimers();
}

test.beforeEach(() => resetBrowserState());

test("חיפוש רגיל אינו מוריד את תמונות הגלריה", async () => {
    const api = createFakeWorker({
        matches: [
            { imageId: "image-3", distance: 0.21, confidence: 84, strength: "strong" },
            { imageId: "image-1", distance: 0.55, confidence: 51, strength: "possible" }
        ]
    });
    await selectQueryImage();
    await window.executeFaceSearch();

    // התמונה היחידה שנטענה בדפדפן היא תמונת החיפוש עצמה.
    assert.deepEqual(imageLoads, [QUERY_IMAGE_DATA_URL]);
    assert.equal(imageLoads.some(source => source.includes("/media/")), false);
    assert.deepEqual(fetchCalls, []);

    // בקשה אחת בלבד ל-Worker, ובה רק הטביעה של תמונת החיפוש.
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].path, "/face/search");
    assert.equal(api.calls[0].body.descriptor.length, 128);
    assert.equal(api.calls[0].body.modelVersion, window.FACE_MODEL_VERSION);
    assert.equal("images" in api.calls[0].body, false);
    assert.equal(api.calls[0].body.image, undefined);

    // התוצאות מוצגות לפי הסדר שהשרת קבע, עם נתוני ההתאמה.
    const results = window.state.tempSearchResults;
    assert.deepEqual(results.map(item => item.id), ["image-3"]);
    assert.equal(results[0].faceMatchStrength, "strong");
    assert.equal(results[0].faceMatchConfidence, 84);
    assert.equal(results[0].faceMatchDistance, 0.21);
    assert.equal(results[0].title, "תמונה 3");
});

test("חיפוש רגיל אינו סורק מחדש גם גלריה גדולה", async () => {
    resetBrowserState(galleryImages(1500));
    createFakeWorker({ matches: [{ imageId: "image-900", distance: 0.3, confidence: 72, strength: "strong" }] });
    await selectQueryImage();

    const startedAt = Date.now();
    await window.executeFaceSearch();

    assert.deepEqual(imageLoads, [QUERY_IMAGE_DATA_URL]);
    assert.deepEqual(window.state.tempSearchResults.map(item => item.id), ["image-900"]);
    // ההשוואה כולה בענן, ולכן החיפוש נמשך שבריר שנייה גם ב-1500 תמונות.
    assert.ok(Date.now() - startedAt < 2000);
});

test("מוצגת הודעה ברורה כשהאינדוקס בענן עדיין לא הסתיים", async () => {
    createFakeWorker({
        matches: [],
        coverage: { totalImages: 500, indexedImages: 120, remainingImages: 380, failedImages: 0, faceCount: 300, ready: false }
    });
    await selectQueryImage();
    await window.executeFaceSearch();

    const message = notifications.at(-1)?.message || "";
    assert.match(message, /לא הושלמה/);
    assert.match(message, /120 מתוך 500/);
    assert.match(message, /380/);
});

test("האינדוקס מדלג על תמונות שכבר עובדו", async () => {
    resetBrowserState(galleryImages(6));
    const api = createFakeWorker();
    api.indexedImages.set("image-0", 1);
    api.indexedImages.set("image-2", 0);

    await window.startFaceIndexing();

    // רק ארבע התמונות שלא אונדקסו ירדו לדפדפן.
    assert.deepEqual(imageLoads.sort(), [1, 3, 4, 5].map(index => `${GALLERY_ORIGIN}/media/approved/google-admin/image-${index}.jpg`).sort());
    const savedIds = api.calls
        .filter(call => call.path === "/face/index")
        .flatMap(call => call.body.images.map(entry => entry.imageId));
    assert.deepEqual(savedIds.sort(), ["image-1", "image-3", "image-4", "image-5"]);
    assert.equal(api.indexedImages.size, 6);
});

test("אפשר לעצור את האינדוקס ולהמשיך בדיוק מהמקום שנעצר", async () => {
    resetBrowserState(galleryImages(20));
    const api = createFakeWorker();
    // עצירה מתוך שמירת האצווה הראשונה, כמו לחיצה על „עצור” באמצע ריצה.
    api.onSave = async () => {
        api.onSave = null;
        window.stopFaceIndexing();
    };

    await window.startFaceIndexing();
    const afterStop = api.indexedImages.size;
    assert.ok(afterStop > 0 && afterStop < 20, `נשמרו ${afterStop} תמונות לפני העצירה`);
    assert.match(notifications.map(item => item.message).join(" "), /נעצר/);

    const downloadsBeforeResume = [...imageLoads];
    // המשך: השרת מחזיר רק את מה שנותר, ואף תמונה אינה נסרקת פעמיים.
    window.descriptorCache = {};
    await window.startFaceIndexing();

    assert.equal(api.indexedImages.size, 20);
    assert.equal(imageLoads.length, 20);
    assert.equal(new Set(imageLoads).size, 20);
    assert.deepEqual(imageLoads.slice(0, downloadsBeforeResume.length), downloadsBeforeResume);
});

test("כישלון בתמונה אחת אינו עוצר את האינדוקס", async () => {
    resetBrowserState(galleryImages(4));
    const api = createFakeWorker();
    window.loadFaceApi = async () => ({
        detectAllFaces: element => ({
            withFaceLandmarks: () => ({
                withFaceDescriptors: async () => {
                    if (String(element?.src || "").includes("image-2")) throw new Error("סריקה נכשלה");
                    return [{ descriptor: Float32Array.from({ length: 128 }, () => 0.08) }];
                }
            })
        })
    });

    await window.startFaceIndexing();

    const entries = api.calls
        .filter(call => call.path === "/face/index")
        .flatMap(call => call.body.images);
    assert.equal(entries.length, 4);
    const failed = entries.find(entry => entry.imageId === "image-2");
    assert.equal(failed.status, "failed");
    assert.equal(entries.filter(entry => Array.isArray(entry.faces)).length, 3);
});

test("תמונה חדשה נכנסת לאינדוקס ברקע בלי לעכב את ההעלאה", async () => {
    resetBrowserState(galleryImages(1));
    const api = createFakeWorker();
    const newRecord = {
        id: "image-new",
        title: "תמונה חדשה",
        url: `${GALLERY_ORIGIN}/media/approved/google-admin/image-new.jpg`
    };

    // הקריאה סינכרונית ואינה מחזירה Promise שההעלאה ממתינה לו.
    assert.equal(window.queueFaceIndexForImage(newRecord), undefined);
    await window.drainFaceIndexQueue();

    assert.equal(api.indexedImages.has("image-new"), true);
    assert.deepEqual(imageLoads, [newRecord.url]);

    // סרטון אינו נכנס לתור, ומשתמש שאינו מנהל אינו כותב טביעות.
    window.state.isAdminLoggedIn = false;
    window.queueFaceIndexForImage({ id: "image-later", url: newRecord.url });
    await window.drainFaceIndexQueue();
    assert.equal(api.indexedImages.has("image-later"), false);
});
