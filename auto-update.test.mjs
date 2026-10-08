import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    createSiteUpdateWatcher, isRenderedVersion, markSiteBusy, clearSiteBusy,
    RELOAD_GUARD_KEY, UPDATE_MESSAGE
} from "./auto-update.js";

// עדכון כפוי: גרסה חדשה של האתר מרעננת את הדף — מיד כשאפשר, ואחרי שהמשתמש
// מסיים כשהוא באמצע משהו. הבדיקות מדמות את הרשת, את הדף ואת הטיימרים.

function makeStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
        map
    };
}

function makeFetch(state) {
    // state.version — תוכן version.json; state.etag — ה-ETag של index.html.
    return async (url, options = {}) => {
        if (String(url).endsWith('version.json')) {
            if (state.versionStatus === 404) return { ok: false, status: 404, text: async () => '' };
            return { ok: true, status: 200, text: async () => state.version };
        }
        if (options.method === 'HEAD') {
            return { ok: true, status: 200, headers: { get: name => (name === 'ETag' ? state.etag : null) } };
        }
        throw new Error(`unexpected fetch ${url}`);
    };
}

function makeHarness({ version = '{"revision":"aaa","builtAt":"2026-10-07T00:00:00Z"}', etag = '"etag-1"', busy = false, visibility = 'visible', storage = makeStorage() } = {}) {
    const state = { version, etag, versionStatus: 200 };
    const timers = [];
    const listeners = {};
    const doc = {
        visibilityState: visibility,
        activeElement: null,
        querySelectorAll: () => [],
        addEventListener: (type, handler) => { (listeners[`doc:${type}`] ||= []).push(handler); }
    };
    const win = {
        addEventListener: (type, handler) => { (listeners[`win:${type}`] ||= []).push(handler); },
        navigator: {}
    };
    const calls = { reload: 0, notify: [] };
    let clock = 1_000_000;
    const watcher = createSiteUpdateWatcher({
        window: win,
        document: doc,
        fetch: makeFetch(state),
        storage,
        reload: () => { calls.reload += 1; },
        notify: message => calls.notify.push(message),
        isUserBusy: () => state.busy,
        now: () => clock,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        setInterval: () => 0
    });
    state.busy = busy;
    return {
        watcher, state, calls, timers, listeners, doc, win, storage,
        advance: ms => { clock += ms; },
        fire: key => { for (const handler of listeners[key] || []) handler(); },
        runTimers: () => { const pending = timers.splice(0); for (const timer of pending) timer.fn(); }
    };
}

test("גרסה חדשה ב-version.json מרעננת את הדף מיד, והגרסה נשמרת כהגנה מלולאה", async () => {
    const h = makeHarness();
    h.watcher.start();
    await h.watcher.check(true);
    assert.equal(h.watcher.baseline?.kind, 'version');
    assert.equal(h.win.SITE_BUILD?.revision, 'aaa');
    assert.equal(h.calls.reload, 0);

    h.state.version = '{"revision":"bbb","builtAt":"2026-10-08T00:00:00Z"}';
    assert.equal(await h.watcher.check(true), true);
    assert.equal(h.calls.reload, 1);
    const saved = JSON.parse(h.storage.getItem(RELOAD_GUARD_KEY));
    assert.equal(saved.signature, h.state.version.trim());
});

test("אותה גרסה אינה מרעננת, ובדיקות צפופות מדי נבלמות", async () => {
    const h = makeHarness();
    await h.watcher.check(true);
    assert.equal(await h.watcher.check(true), false);
    // בדיקה רגילה בתוך 15 שניות מהקודמת אינה פונה לרשת כלל.
    assert.equal(await h.watcher.check(), false);
    assert.equal(h.calls.reload, 0);
});

test("version.json שלא עבר עיבוד (אין Jekyll) מפנה ל-ETag של index.html", async () => {
    const raw = '---\n---\n{"revision": "{{ site.github.build_revision }}"}';
    assert.equal(isRenderedVersion(raw), false);
    assert.equal(isRenderedVersion('{"revision":"abc"}'), true);
    assert.equal(isRenderedVersion('{"other":1}'), false);

    const h = makeHarness({ version: raw });
    await h.watcher.check(true);
    assert.equal(h.watcher.baseline?.kind, 'etag');
    h.state.etag = '"etag-2"';
    assert.equal(await h.watcher.check(true), true);
    assert.equal(h.calls.reload, 1);
});

test("כשהמשתמש עסוק הרענון ממתין: הודעה אחת, ורענון ברגע שהוא מסיים", async () => {
    const h = makeHarness({ busy: true });
    await h.watcher.check(true);
    h.state.version = '{"revision":"bbb","builtAt":"x"}';
    assert.equal(await h.watcher.check(true), false);
    assert.equal(h.calls.reload, 0);
    assert.deepEqual(h.calls.notify, [UPDATE_MESSAGE]);
    assert.equal(h.timers.length, 1, "נקבע ניסיון חוזר");

    // עדיין עסוק: ניסיון חוזר נוסף, בלי הודעה נוספת.
    h.runTimers();
    assert.equal(h.calls.reload, 0);
    assert.deepEqual(h.calls.notify, [UPDATE_MESSAGE]);

    h.state.busy = false;
    h.runTimers();
    assert.equal(h.calls.reload, 1);
});

test("לשונית מוסתרת מתרעננת בשקט גם כשהמשתמש היה באמצע משהו", async () => {
    const h = makeHarness({ busy: true, visibility: 'hidden' });
    await h.watcher.check(true);
    h.state.version = '{"revision":"bbb","builtAt":"x"}';
    assert.equal(await h.watcher.check(true), true);
    assert.equal(h.calls.reload, 1);
    assert.deepEqual(h.calls.notify, []);
});

test("מעבר להסתרה מרענן דף שהמתין, וחזרה ללשונית מפעילה בדיקה", async () => {
    const h = makeHarness({ busy: true });
    h.watcher.start();
    await h.watcher.check(true);
    h.state.version = '{"revision":"bbb","builtAt":"x"}';
    await h.watcher.check(true);
    assert.equal(h.calls.reload, 0);
    h.doc.visibilityState = 'hidden';
    h.fire('doc:visibilitychange');
    assert.equal(h.calls.reload, 1);
});

test("הגנה מלולאה: אותה גרסה שבגללה כבר רוענן הדף אינה מרעננת שוב בתוך שתי דקות", async () => {
    const storage = makeStorage();
    const first = makeHarness({ storage });
    await first.watcher.check(true);
    first.state.version = '{"revision":"bbb","builtAt":"x"}';
    assert.equal(await first.watcher.check(true), true);

    // אחרי הרענון השרת עדיין מגיש את הגרסה הישנה (מטמון CDN), ואז שוב את החדשה.
    const second = makeHarness({ storage });
    await second.watcher.check(true);
    second.state.version = '{"revision":"bbb","builtAt":"x"}';
    assert.equal(await second.watcher.check(true), false, "אסור לרענן שוב בשביל אותה גרסה");
    second.advance(3 * 60 * 1000);
    assert.equal(await second.watcher.check(true), true, "אחרי החלון מותר שוב");
});

test("Service Worker חדש שתופס שליטה מרענן את הדף, אך לא בהתקנה הראשונה", async () => {
    const h = makeHarness();
    const swListeners = {};
    h.win.navigator.serviceWorker = {
        controller: null,
        addEventListener: (type, handler) => { (swListeners[type] ||= []).push(handler); }
    };
    h.watcher.start();
    await h.watcher.check(true);
    for (const handler of swListeners.controllerchange) handler();
    assert.equal(h.calls.reload, 0, "ההתקנה הראשונה אינה מרעננת");
    for (const handler of swListeners.controllerchange) handler();
    assert.equal(h.calls.reload, 1);
});

test("השדות העסוקים: העלאה מסומנת, הקלדה בשדה עם טקסט וסרטון מתנגן", async () => {
    const { defaultIsUserBusy } = await import("./auto-update.js");
    const doc = { activeElement: null, querySelectorAll: () => [] };
    assert.equal(defaultIsUserBusy(doc), false);
    markSiteBusy('upload');
    assert.equal(defaultIsUserBusy(doc), true);
    clearSiteBusy('upload');
    assert.equal(defaultIsUserBusy(doc), false);
    assert.equal(defaultIsUserBusy({ activeElement: { tagName: 'TEXTAREA', value: 'שלום' }, querySelectorAll: () => [] }), true);
    assert.equal(defaultIsUserBusy({ activeElement: { tagName: 'INPUT', value: '' }, querySelectorAll: () => [] }), false);
    assert.equal(defaultIsUserBusy({ activeElement: null, querySelectorAll: () => [{ paused: false, ended: false }] }), true);
    assert.equal(defaultIsUserBusy({ activeElement: null, querySelectorAll: () => [{ paused: true, ended: false }] }), false);
});

test("החיווט: version.json עם front matter, המודול במעטפת ה-SW, וגרסאות תואמות", async () => {
    const [versionFile, swJs, appJs] = await Promise.all([
        readFile(new URL("./version.json", import.meta.url), "utf8"),
        readFile(new URL("./sw.js", import.meta.url), "utf8"),
        readFile(new URL("./app.js", import.meta.url), "utf8")
    ]);
    assert.ok(versionFile.startsWith("---\n---\n"), "version.json חייב front matter כדי ש-Jekyll ימלא אותו");
    assert.match(versionFile, /site\.time/);
    assert.match(swJs, /"\.\/auto-update\.js"/);
    assert.match(swJs, /version\\\.json/);
    assert.match(swJs, /cache: "no-cache"/);
    assert.match(appJs, /installSiteUpdateWatcher\(\{ registration: serviceWorkerRegistration \}\)/);
});
