// בדיקת הטעינה של מנוע זיהוי הפנים מתוך מודול האינדוקס.
//
// face-index.js ו-face-search.js נטענים עצלה ובנפרד. מנוע הזיהוי עצמו מוגדר
// ב-face-search.js בלבד, ולכן מנהל שפתח את לוח האינדוקס בלי לפתוח קודם את
// חיפוש הפנים קיבל "האינדוקס נעצר בגלל שגיאה: window.loadFaceApi is not a
// function". כאן נטען face-index.js לבדו — בלי face-search.js — בדיוק כמו
// באותו מסלול, ונבדק שהאינדוקס מושך את המודול בעצמו וממשיך לרוץ.
import test from "node:test";
import assert from "node:assert/strict";

const GALLERY_ORIGIN = "https://simchas-gallery-api.0534169095.workers.dev";

const notifications = [];
const savedEntries = [];
let searchModuleLoads = 0;

function createStubElement(id = "") {
    return {
        id,
        textContent: "",
        innerText: "",
        innerHTML: "",
        disabled: false,
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, contains: () => false }
    };
}

const elements = new Map();
globalThis.document = {
    readyState: "complete",
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById: id => {
        if (!elements.has(id)) elements.set(id, createStubElement(id));
        return elements.get(id);
    },
    createElement: () => createStubElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
};

function createStorage() {
    const map = new Map();
    return {
        map,
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key)
    };
}
const localStorageStub = createStorage();
const sessionStorageStub = createStorage();
globalThis.localStorage = localStorageStub;
globalThis.sessionStorage = sessionStorageStub;

globalThis.fetch = async url => {
    throw new Error(`הבדיקה אינה מצפה לבקשת רשת אל ${url}`);
};

function galleryImages(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `image-${index}`,
        url: `${GALLERY_ORIGIN}/media/approved/google-admin/image-${index}.jpg`
    }));
}

// מנוע מזויף: מחזיר טביעה קבועה בלי להוריד דבר.
function fakeFaceEngine() {
    return {
        nets: {
            ssdMobilenetv1: { isLoaded: true },
            faceLandmark68Net: { isLoaded: true },
            faceRecognitionNet: { isLoaded: true }
        },
        detectAllFaces: () => ({
            withFaceLandmarks: () => ({
                withFaceDescriptors: async () => [{ descriptor: new Float32Array(128).fill(0.1) }]
            })
        })
    };
}

globalThis.window = {
    state: { images: galleryImages(3), isAdminLoggedIn: true, isSuperAdmin: true },
    descriptorCache: {},
    safeRecordId: value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120),
    safeImageUrl: value => (/^https:\/\//i.test(String(value ?? "").trim()) ? String(value).trim() : ""),
    isVideoRecord: record => record?.mediaType === "video",
    showNotification: (message, isSuccess = true) => notifications.push({ message, isSuccess }),
    checkAdminPermission: () => true,
    checkSuperAdminPermission: () => true,
    scheduleIconRefresh() {},
    logActivity: async () => {},
    async r2Request(path, options) {
        if (path.startsWith("/face/index/summary")) {
            return { totalImages: 3, indexedImages: savedEntries.length, remainingImages: Math.max(0, 3 - savedEntries.length), failedImages: 0, faceCount: savedEntries.length, ready: false };
        }
        if (path === "/face/index/pending") {
            const body = JSON.parse(options.body);
            return { pending: body.imageIds.filter(id => !savedEntries.includes(id)) };
        }
        if (path === "/face/index") {
            for (const entry of JSON.parse(options.body).images) savedEntries.push(entry.imageId);
            return { ok: true };
        }
        throw new Error(`נתיב לא צפוי: ${path}`);
    }
};

// חשוב: face-search.js אינו מיובא כאן בכוונה — זהו בדיוק המצב שבו התקלה קרתה.
await import("./face-index.js");

function resetState() {
    notifications.length = 0;
    savedEntries.length = 0;
    searchModuleLoads = 0;
    elements.clear();
    localStorageStub.map.clear();
    sessionStorageStub.map.clear();
    window.state.images = galleryImages(3);
    window.descriptorCache = {};
    delete window.loadFaceApi;
    delete window.loadFaceImageElement;
    delete window.FACE_MODEL_VERSION;
    delete window.ensureFaceSearchModule;
}

// מחקה את המעטפת שב-app.js: המודול העצל נטען ורק אז מגדיר את המנוע על window.
function installLazySearchModule() {
    window.ensureFaceSearchModule = async () => {
        searchModuleLoads += 1;
        window.FACE_MODEL_VERSION = "faceapi-1.7.15-ssd-l68-r1";
        window.loadFaceApi = async () => fakeFaceEngine();
        window.loadFaceImageElement = async () => ({});
    };
}

test.beforeEach(resetState);

test("אינדוקס שמופעל בלי שחיפוש הפנים נפתח קודם מושך את מודול המנוע בעצמו", async () => {
    installLazySearchModule();

    await window.startFaceIndexing();

    assert.equal(searchModuleLoads, 1, "מודול חיפוש הפנים אמור להיטען פעם אחת בדיוק");
    assert.deepEqual(savedEntries, ["image-0", "image-1", "image-2"], "כל התמונות אמורות להיסרק ולהישמר");
    const failure = notifications.find(item => /is not a function|נעצר בגלל שגיאה/.test(item.message));
    assert.equal(failure, undefined, `האינדוקס לא אמור להיעצר בשגיאה: ${failure?.message || ""}`);
});

test("המשך אינדוקס מדלג על מה שכבר נשמר ומסיים את הנותר", async () => {
    installLazySearchModule();
    savedEntries.push("image-0", "image-1");

    await window.startFaceIndexing();

    assert.deepEqual(savedEntries, ["image-0", "image-1", "image-2"], "רק התמונה שנותרה אמורה להיסרק");
});

test("מודול מנוע שלא הגדיר את הטוען מציג שגיאה ברורה במקום TypeError", async () => {
    // מודול שנטען אך לא הגדיר את המנוע — למשל טעינה חלקית ברשת גרועה.
    window.ensureFaceSearchModule = async () => { searchModuleLoads += 1; };

    await window.startFaceIndexing();

    const message = notifications.at(-1)?.message || "";
    assert.match(message, /מודול חיפוש הפנים לא נטען/, "המשתמש אמור לקבל הסבר ולא הודעת TypeError");
    assert.match(message, /אפשר להמשיך מהמקום שנעצר/, "ההודעה אמורה להבהיר שההמשך אפשרי");
});

test("ריצה אוטומטית שנכשלה אינה מסומנת כבוצעה, כדי שהכניסה הבאה תמשיך", async () => {
    window.ensureFaceSearchModule = async () => { searchModuleLoads += 1; };

    await window.maybeStartInitialFaceIndexing();

    const markers = [...sessionStorageStub.map.keys()].filter(key => key.includes("face_index_initial_auto"));
    assert.deepEqual(markers, [], "אחרי כישלון אסור להשאיר סימון 'בוצע' שחוסם ניסיון נוסף");
});

test("ריצה אוטומטית שהצליחה מסומנת כבוצעה ואינה חוזרת על עצמה", async () => {
    installLazySearchModule();

    await window.maybeStartInitialFaceIndexing();
    const loadsAfterFirst = searchModuleLoads;
    await window.maybeStartInitialFaceIndexing();

    assert.deepEqual(savedEntries, ["image-0", "image-1", "image-2"]);
    assert.equal(searchModuleLoads, loadsAfterFirst, "הרצה שנייה באותה כניסה אינה אמורה להתחיל שוב");
});
