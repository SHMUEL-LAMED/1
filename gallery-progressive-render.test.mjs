// בדיקה התנהגותית של הרינדור ההדרגתי בגלריה ושל התצוגה המלאה.
//
// הרשת נבנית במנות: המנה הראשונה מיד, וכל מנה נוספת כשהזקיף שבסוף הרשת
// נכנס למסך. התצוגה המלאה ממשיכה לעבוד על הרשימה המסוננת כולה — גם על
// פריטים שעדיין אין להם כרטיס — וטוענת מראש את השכנים של הפריט המוצג.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- DOM מינימלי, בסגנון שאר הבדיקות ---
function makeClassList(classes) {
    return {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle: (name, force) => {
            const on = force === undefined ? !classes.has(name) : Boolean(force);
            if (on) classes.add(name); else classes.delete(name);
            return on;
        }
    };
}

function makeElement(id) {
    const classes = new Set();
    const element = {
        id, classes, classList: makeClassList(classes),
        dataset: {}, style: {}, hidden: false, disabled: false, src: "", _text: "", innerHTML: "",
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, appendChild() {},
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        pause() {}, load() {}, remove() {}, focus() {}
    };
    Object.defineProperty(element, "textContent", { get() { return element._text; }, set(value) { element._text = String(value); } });
    Object.defineProperty(element, "innerText", { get() { return element._text; }, set(value) { element._text = String(value); } });
    return element;
}

// הרשת: innerHTML ו-insertAdjacentHTML מפורקים לכרטיסים (לפי <article>),
// וכל כרטיס תומך בדיוק במה ש-gallery.js עושה לו: הוספה לפניו, הסרה, כתיבת
// המספר ו---card-index, ובדיקת isConnected.
function makeCard(grid, html) {
    const card = {
        tagName: "ARTICLE", html,
        mediaId: html.match(/data-media-id="([^"]*)"/)?.[1] || "",
        number: html.match(/<span class="gallery-number">([^<]*)<\/span>/)?.[1] || "",
        style: { values: {}, setProperty(name, value) { this.values[name] = String(value); } },
        get isConnected() { return grid.children.includes(card); },
        getBoundingClientRect() { return grid.geometry ? grid.geometry(card) : { top: 0 }; },
        get previousElementSibling() {
            const index = grid.children.indexOf(card);
            return index > 0 ? grid.children[index - 1] : null;
        },
        querySelector(selector) {
            if (selector !== ".gallery-number") return null;
            return { get textContent() { return card.number; }, set textContent(value) { card.number = String(value); } };
        },
        insertAdjacentHTML(position, value) {
            assert.equal(position, "beforebegin");
            const index = grid.children.indexOf(card);
            grid.children.splice(index, 0, ...parseCards(grid, value));
        },
        remove() {
            const index = grid.children.indexOf(card);
            if (index >= 0) grid.children.splice(index, 1);
        }
    };
    return card;
}

function parseCards(grid, html) {
    return String(html).split(/(?=<article\b)/).map(part => part.trim()).filter(Boolean).map(part => makeCard(grid, part));
}

function makeGrid() {
    const grid = makeElement("photosGrid");
    grid.children = [];
    grid.innerHTMLWrites = 0;
    Object.defineProperty(grid, "innerHTML", {
        get() { return grid.children.map(card => card.html).join(""); },
        set(value) { grid.innerHTMLWrites += 1; grid.children = parseCards(grid, value); }
    });
    Object.defineProperty(grid, "lastElementChild", { get() { return grid.children.at(-1) || null; } });
    grid.insertAdjacentHTML = (position, html) => {
        assert.equal(position, "beforeend");
        grid.children.push(...parseCards(grid, html));
    };
    grid.insertBefore = (node, reference) => {
        const current = grid.children.indexOf(node);
        if (current >= 0) grid.children.splice(current, 1);
        const target = reference ? grid.children.indexOf(reference) : -1;
        if (target >= 0) grid.children.splice(target, 0, node);
        else grid.children.push(node);
        return node;
    };
    return grid;
}

const ELEMENT_IDS = [
    "emptyState", "imageCounter", "galleryLoadMore", "gallerySentinel", "galleryLoadMoreCount",
    "galleryLoadingStatus", "galleryRenderMoreBtn", "heroMosaic",
    "lightboxImage", "lightboxVideo", "lightboxStage", "lightboxBackdrop", "lightboxTitle",
    "lightboxDetails", "lightboxDownload", "lightboxCounter", "lightboxModal"
];
const elements = new Map(ELEMENT_IDS.map(id => [id, makeElement(id)]));
const grid = makeGrid();
elements.set("photosGrid", grid);
const el = id => elements.get(id);

// IntersectionObserver מזויף: הבדיקה היא שמחליטה מתי הזקיף „נכנס למסך”.
const observers = [];
globalThis.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
};
function intersectSentinel() {
    for (const observer of observers) {
        const entries = [...observer.targets].map(target => ({ isIntersecting: true, target }));
        if (entries.length) observer.callback(entries, observer);
    }
}

// Image מזויף: הטעינה מסתיימת רק כשהבדיקה קוראת ל-finish, כדי שאפשר יהיה
// לראות מה קורה בזמן ההמתנה לפענוח.
const createdImages = [];
globalThis.Image = class {
    constructor() { this.complete = false; this.naturalWidth = 0; this._src = ""; this.listeners = {}; createdImages.push(this); }
    set src(value) { this._src = String(value); }
    get src() { return this._src; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    decode() { return Promise.resolve(); }
    finish(ok = true) {
        this.complete = true;
        this.naturalWidth = ok ? 1 : 0;
        (this.listeners[ok ? "load" : "error"] || []).splice(0).forEach(handler => handler());
    }
};
const loaderFor = url => createdImages.find(image => image.src === url);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

const connection = { saveData: false };
Object.defineProperty(globalThis, "navigator", { value: { connection }, configurable: true, writable: true });
const storage = new Map();
globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};
globalThis.document = {
    body: makeElement("body"),
    getElementById: id => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement(""),
    addEventListener() {}
};

const FOLDERS = [
    { id: "all", name: "כל התמונות", icon: "grid", isDefault: true },
    { id: "fold-a", name: "אירוע א", icon: "calendar" },
    { id: "fold-b", name: "אירוע ב", icon: "compass" }
];
// הפריט ה-i הוא גם ה-i-י במיון „החדש ביותר”, כדי שהבדיקה תוכל לחשוב במספרים.
const BASE_TIME = 1_800_000_000_000;
function makeImages(count) {
    return Array.from({ length: count }, (_, i) => {
        const video = i % 50 === 25;
        return {
            id: `img-${i}`,
            title: `תמונה ${i}`,
            folderId: i % 2 ? "fold-b" : "fold-a",
            createdAt: BASE_TIME - i * 60_000,
            date: "2026-10-01",
            url: video ? `https://cdn.test/v${i}.mp4` : `https://cdn.test/${i}.jpg`,
            ...(video ? { mediaType: "video", thumbnailUrl: `https://cdn.test/t${i}.jpg` } : {})
        };
    });
}

function freshState(images) {
    return {
        images, folders: FOLDERS.map(folder => ({ ...folder })),
        favorites: new Set(), selectedMediaIds: new Set(), bulkSelectionMode: false,
        activeFolderId: "all", searchQuery: "", gallerySort: "newest", tempSearchResults: null,
        isLocked: true, isAdminLoggedIn: false, currentLightboxIndex: -1
    };
}

globalThis.window = {
    state: freshState(makeImages(300)),
    safeRecordId: value => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, ""),
    safeImageUrl: value => (/^https:\/\//i.test(String(value ?? "")) ? String(value) : ""),
    isVideoRecord: record => record?.mediaType === "video",
    escapeHtml: value => String(value ?? ""),
    formatDate: value => String(value ?? ""),
    scheduleIconRefresh() {}, openModal() {}, closeModal() {}, recordMediaView() {},
    handleImageError() {}, showNotification() {},
    setTimeout, clearTimeout, setInterval, clearInterval
};

await import("./gallery.js");

// הבדיקה משתמשת ברינדור הישיר כדי לא להמתין ל-debounce.
const render = () => window._doRenderImages();
const hidden = id => el(id).classList.contains("hidden");
const ids = () => grid.children.map(card => card.mediaId);

test("המרקאפ: הזקיף מוסתר מקוראי מסך, והמחוון הוא role=status", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    assert.match(html, /id="gallerySentinel"[^>]*aria-hidden="true"/);
    assert.match(html, /id="galleryLoadingStatus"[^>]*role="status"/);
    assert.ok(html.includes('id="galleryRenderMoreBtn"'));
    assert.ok(html.includes('id="lightboxStage"'));
});

test("המנה הראשונה: 48 כרטיסים מתוך 300, ממוספרים לפי הסדר הממוין", () => {
    render();
    assert.equal(grid.children.length, 48);
    assert.equal(grid.children[0].mediaId, "img-0");
    assert.equal(grid.children[0].number, "01");
    assert.equal(grid.children[47].mediaId, "img-47");
    assert.equal(grid.children[47].number, "48");
    assert.equal(el("imageCounter").textContent, "300 פריטים");
    assert.ok(hidden("emptyState"));
    assert.ok(!hidden("galleryLoadMore"), "הזקיף מוצג כל עוד נותרו פריטים");
    assert.equal(el("galleryLoadMoreCount").textContent, "מוצגים 48 מתוך 300 פריטים");
    assert.ok(hidden("galleryLoadingStatus"), "בלי בקשה לענן אין „טוען עוד”");
    assert.ok(observers.length > 0 && observers[0].targets.has(el("gallerySentinel")), "הזקיף נצפה");
});

test("כל חיתוך של הזקיף מוסיף מנה אחת, עד שהכול מוצג", () => {
    intersectSentinel();
    assert.equal(grid.children.length, 96);
    assert.equal(grid.children[48].mediaId, "img-48");
    assert.equal(grid.children[48].number, "49");
    for (let i = 0; i < 4; i++) intersectSentinel();
    assert.equal(grid.children.length, 288);
    intersectSentinel();
    assert.equal(grid.children.length, 300);
    assert.ok(hidden("galleryLoadMore"), "כשהכול מוצג הזקיף נעלם");
    assert.equal(el("galleryLoadMoreCount").textContent, "");
    intersectSentinel();
    assert.equal(grid.children.length, 300, "חיתוך נוסף אינו מוסיף דבר");
    assert.deepEqual(new Set(ids()).size, 300, "אין כרטיס כפול");
});

test("רינדור מחדש באותה תצוגה שומר את מספר הכרטיסים ומחליף רק כרטיסים שהשתנו", () => {
    window.state.activeFolderId = "fold-a";
    render();
    assert.equal(grid.children.length, 48, "מעבר תיקייה חוזר למנה הראשונה");
    assert.equal(el("imageCounter").textContent, "150 פריטים");
    intersectSentinel();
    assert.equal(grid.children.length, 96);

    const before = [...grid.children];
    const writes = grid.innerHTMLWrites;
    render();
    assert.equal(grid.children.length, 96, "עדכון נתונים אינו מקצר את הרשת");
    assert.ok(grid.children.every((card, index) => card === before[index]), "כרטיס שלא השתנה נשאר ב-DOM");
    assert.equal(grid.innerHTMLWrites, writes, "הרשת לא נבנתה מחדש");

    // לב שנלחץ: רק הכרטיס שלו מוחלף.
    window.state.favorites.add("img-2");
    render();
    assert.equal(grid.children.length, 96);
    assert.notEqual(grid.children[1], before[1]);
    assert.ok(grid.children[1].html.includes("fill-current"));
    assert.ok(grid.children.every((card, index) => index === 1 || card === before[index]));

    // תמונה חדשה בראש הרשימה: הכרטיסים הקיימים נשארים אותם אלמנטים — רק
    // מספרם ומיקומם מתעדכנים — ומספר הכרטיסים נשמר.
    const beforeInsert = [...grid.children];
    window.state.images = [{ id: "img-new", title: "חדשה", folderId: "fold-a", createdAt: BASE_TIME + 1, date: "2026-10-02", url: "https://cdn.test/new.jpg" }, ...window.state.images];
    render();
    assert.equal(grid.children.length, 96);
    assert.equal(grid.children[0].mediaId, "img-new");
    assert.equal(grid.children[0].number, "01");
    assert.equal(grid.children[0].style.values["--card-index"], "0");
    assert.equal(grid.children[1].mediaId, "img-0");
    assert.equal(grid.children[1].number, "02");
    assert.ok(beforeInsert.slice(0, 95).every((card, index) => grid.children[index + 1] === card), "הכרטיסים הקיימים לא נבנו מחדש");
    assert.equal(grid.children[13].style.values["--card-index"], "12", "ההשהיה של האנימציה נכתבת על האלמנט");

    // תמונה ישנה שמצטרפת מעבר לכרטיסים שצוירו: שום כרטיס אינו משתנה.
    const beforeAppend = [...grid.children];
    window.state.images = [...window.state.images, { id: "img-old", title: "ישנה", folderId: "fold-a", createdAt: 1000, date: "2020-01-01", url: "https://cdn.test/old.jpg" }];
    render();
    assert.ok(grid.children.length === 96 && grid.children.every((card, index) => card === beforeAppend[index]));

    window.state.searchQuery = "תמונה 1";
    render();
    assert.equal(grid.children.length, 48, "חיפוש חוזר למנה הראשונה");
    window.state.searchQuery = "";
    window.state.activeFolderId = "all";
    window.state.images = makeImages(300);
    render();
    assert.equal(grid.children.length, 48);
});

test("תמונה חדשה בראש הרשימה אינה מזיזה את הכרטיס שבראש המסך", () => {
    // רשת של 4 עמודות ושורות בגובה 300: כל כרטיס זז תא אחד קדימה, וכרטיס
    // שבסוף שורה יורד לשורה הבאה — הגלילה צריכה להתקן בדיוק בהפרש הזה.
    const COLUMNS = 4, ROW = 300;
    const scrolls = [];
    const newImage = n => ({ id: `img-new-${n}`, title: `חדשה ${n}`, folderId: "fold-a", createdAt: BASE_TIME + n, date: "2026-10-02", url: `https://cdn.test/new${n}.jpg` });
    grid.geometry = card => ({ top: Math.floor(grid.children.indexOf(card) / COLUMNS) * ROW - window.scrollY });
    window.scrollY = 0;
    window.scrollBy = ({ top }) => { scrolls.push(top); window.scrollY += top; };
    try {
        window.state = freshState(makeImages(300));
        render();
        intersectSentinel();
        assert.equal(grid.children.length, 96);

        // בראש המסך שורה 5, והכרטיס הראשון בה (אינדקס 20) זז לעמודה הבאה
        // באותה שורה: אין צורך בתיקון.
        window.scrollY = 5 * ROW;
        const inRow = grid.children[20];
        window.state.images = [newImage(1), ...window.state.images];
        render();
        assert.equal(grid.children[21], inRow);
        assert.deepEqual(scrolls, []);
        assert.equal(inRow.getBoundingClientRect().top, 0);

        // הכרטיס האחרון בשורה הוא הראשון שנראה (מה שלפניו כבר מעל המסך):
        // תמונה חדשה מורידה אותו שורה, והגלילה מתוקנת בגובה שורה אחת.
        const last = grid.children[23];
        const hiddenAbove = new Set(grid.children.slice(0, 23));
        grid.geometry = card => hiddenAbove.has(card)
            ? { top: -1 }
            : { top: Math.floor(grid.children.indexOf(card) / COLUMNS) * ROW - window.scrollY };
        window.state.images = [newImage(2), ...window.state.images];
        render();
        assert.equal(grid.children[24], last);
        assert.deepEqual(scrolls, [ROW], "הגלילה תוקנה בגובה שורה אחת");
        assert.equal(last.getBoundingClientRect().top, 0, "הכרטיס נשאר בראש המסך");

        // בראש הדף אין תיקון: שם רוצים לראות את התמונה החדשה.
        window.scrollY = 0;
        scrolls.length = 0;
        window.state.images = [newImage(3), ...window.state.images];
        render();
        assert.deepEqual(scrolls, []);
    } finally {
        delete grid.geometry;
        delete window.scrollY;
        delete window.scrollBy;
        window.state = freshState(makeImages(300));
        render();
    }
});

test("חיפוש בלי תוצאות מציג את המצב הריק, ואחריו הרשת חוזרת", () => {
    window.state.searchQuery = "אין-כזה-דבר";
    render();
    assert.equal(grid.children.length, 0);
    assert.ok(hidden("photosGrid"));
    assert.ok(!hidden("emptyState"));
    assert.ok(hidden("galleryLoadMore"));
    window.state.searchQuery = "";
    render();
    assert.equal(grid.children.length, 48);
    assert.ok(!hidden("photosGrid"));
    assert.ok(hidden("emptyState"));
});

test("התצוגה המלאה ממפה לכל הרשימה המסוננת, גם לפריטים שעדיין לא צוירו", () => {
    assert.equal(grid.children.length, 48);
    window.openLightbox("img-200");
    assert.equal(window.state.currentLightboxIndex, 200);
    assert.equal(el("lightboxCounter").innerText, "201 מתוך 300");
    assert.equal(el("lightboxImage").src, "https://cdn.test/200.jpg", "בפתיחה התמונה מוצגת מיד");
    assert.ok(!ids().includes("img-200"), "לפריט עדיין אין כרטיס ברשת");
    window.navigateLightbox(1);
    assert.equal(window.state.currentLightboxIndex, 201);
    assert.equal(el("lightboxCounter").innerText, "202 מתוך 300");
    assert.equal(el("lightboxTitle").innerText, "תמונה 201", "הכיתוב מתעדכן מיד, עוד לפני הפענוח");
    window.navigateLightbox(99);
    assert.equal(window.state.currentLightboxIndex, 0, "הדפדוף מקיף את כל הרשימה");
    window.navigateLightbox(-1);
    assert.equal(window.state.currentLightboxIndex, 299);
    assert.equal(grid.children.length, 48, "הדפדוף אינו מצייר כרטיסים");
});

test("הדפדוף משאיר את התמונה הקודמת עד שהבאה פוענחה, ודפדוף מהיר מציג רק את האחרונה", async () => {
    window.openLightbox("img-10");
    const image = el("lightboxImage");
    assert.equal(image.src, "https://cdn.test/10.jpg");

    window.navigateLightbox(1);
    assert.equal(image.src, "https://cdn.test/10.jpg", "הקודמת נשארת בזמן הטעינה");
    assert.ok(el("lightboxStage").classList.contains("is-loading"));
    const next = loaderFor("https://cdn.test/11.jpg");
    assert.ok(next, "התמונה הבאה נטענה מראש כשכן");
    next.finish(true);
    await settle();
    assert.equal(image.src, "https://cdn.test/11.jpg");
    assert.ok(!el("lightboxStage").classList.contains("is-loading"));
    assert.equal(el("lightboxBackdrop").src, "https://cdn.test/11.jpg", "ההשתקפות מתחלפת יחד עם התמונה");

    window.navigateLightbox(1);
    window.navigateLightbox(1);
    assert.equal(window.state.currentLightboxIndex, 13);
    loaderFor("https://cdn.test/12.jpg").finish(true);
    await settle();
    assert.equal(image.src, "https://cdn.test/11.jpg", "תמונה שדולגה אינה מוצגת");
    loaderFor("https://cdn.test/13.jpg").finish(true);
    await settle();
    assert.equal(image.src, "https://cdn.test/13.jpg");
});

test("טעינה מוקדמת: השכנים נטענים, לסרטון רק הפוסטר, ולא במצב חיסכון בנתונים", () => {
    window.openLightbox("img-24");
    const sources = createdImages.map(image => image.src);
    assert.ok(sources.includes("https://cdn.test/23.jpg"), "השכן הקודם");
    assert.ok(sources.includes("https://cdn.test/t25.jpg"), "לסרטון השכן נטען הפוסטר");
    assert.ok(!sources.includes("https://cdn.test/v25.mp4"), "קובץ הווידאו לעולם אינו נטען מראש");

    for (let i = 0; i < 10; i++) window.navigateLightbox(1);
    const inFlight = createdImages.filter(image => image.src && !image.complete);
    assert.ok(inFlight.length <= 4, `לכל היותר ארבע טעינות פתוחות, בפועל ${inFlight.length}; הישנות מבוטלות`);
    assert.ok(createdImages.some(image => !image.src && !image.complete), "טעינה שנזנחה בוטלה (src ריק)");

    connection.saveData = true;
    const count = createdImages.length;
    window.navigateLightbox(-1);
    assert.equal(createdImages.length, count, "במצב חיסכון בנתונים אין טעינה מוקדמת");
    connection.saveData = false;
});

test("loadMoreImages נקרא רק כש-imagesHasMore דלוק, ופעם אחת בכל פעם", async () => {
    window.state = freshState(makeImages(100));
    render();
    intersectSentinel();
    intersectSentinel();
    assert.equal(grid.children.length, 100);
    assert.ok(hidden("galleryLoadMore"));

    let calls = 0;
    let resolveLoad = null;
    window.loadMoreImages = () => { calls += 1; return new Promise(resolve => { resolveLoad = resolve; }); };
    intersectSentinel();
    assert.equal(calls, 0, "בלי imagesHasMore אין פנייה לענן");

    window.state.imagesHasMore = true;
    render();
    assert.ok(!hidden("galleryLoadMore"), "כשבענן נותרו תמונות הזקיף נשאר");
    intersectSentinel();
    assert.equal(calls, 1);
    assert.ok(!hidden("galleryLoadingStatus"), "„טוען עוד...” מוצג בזמן הבקשה");
    assert.ok(hidden("galleryRenderMoreBtn"));
    intersectSentinel();
    assert.equal(calls, 1, "אין בקשה שנייה כל עוד הראשונה פתוחה");

    window.state.images.push(...makeImages(120).slice(100));
    resolveLoad({ added: 20, done: true });
    await settle();
    assert.equal(grid.children.length, 120, "מה שנוסף מוצג בהמשך הגלילה");
    assert.equal(grid.children[100].mediaId, "img-100");
    assert.equal(window.state.imagesHasMore, false, "done מסמן שאין עוד");
    assert.ok(hidden("galleryLoadingStatus"));
    assert.ok(hidden("galleryLoadMore"));
    intersectSentinel();
    assert.equal(calls, 1);

    // בקשה שלא הוסיפה דבר אינה חוזרת על עצמה מאליה — רק מכפתור „הצג עוד”.
    window.state.imagesHasMore = true;
    window.loadMoreImages = () => { calls += 1; return Promise.resolve({ added: 0, done: false }); };
    intersectSentinel();
    assert.equal(calls, 2);
    await settle();
    intersectSentinel();
    assert.equal(calls, 2, "הזקיף אינו מציף את השרת בבקשות ריקות");
    window.renderMoreImages(true);
    assert.equal(calls, 3);
    await settle();
    delete window.loadMoreImages;
    delete window.state.imagesHasMore;
});

test("נתונים שהגיעו וטרם צוירו נצבעים קודם, בלי בקשה מיותרת לענן", () => {
    window.state = freshState(makeImages(10));
    window.state.imagesHasMore = true;
    render();
    let calls = 0;
    window.loadMoreImages = () => { calls += 1; return new Promise(() => {}); };
    try {
        // העמוד הבא כבר בזיכרון, אבל הציור (המושהה) עוד לא רץ.
        window.state.images = makeImages(130);
        intersectSentinel();
        assert.equal(calls, 0, "אין בקשה לענן כשיש עוד מה לצייר");
        assert.equal(grid.children.length, 48);
        assert.equal(el("galleryLoadMoreCount").textContent, "מוצגים 48 מתוך 130 פריטים");
        // אין בקשה גם כשהתצוגה מציגה סינון זמני או כשהתיקייה עדיין נטענת.
        window.state.images = makeImages(48);
        window.state.imagesLoading = true;
        render();
        intersectSentinel();
        assert.equal(calls, 0);
    } finally {
        delete window.loadMoreImages;
        window.state = freshState(makeImages(300));
        render();
    }
});

test("בלי IntersectionObserver הכול נבנה בבת אחת", () => {
    const saved = globalThis.IntersectionObserver;
    delete globalThis.IntersectionObserver;
    try {
        window.state = freshState(makeImages(300));
        render();
        assert.equal(grid.children.length, 300);
        assert.ok(hidden("galleryLoadMore"));
    } finally {
        globalThis.IntersectionObserver = saved;
    }
});
