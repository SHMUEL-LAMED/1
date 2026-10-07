// בדיקות ניטור השגיאות בצד הלקוח: טביעת אצבע, סינון כפילויות ורעש,
// המכסה לכל טעינת דף, ובחירת מסלול השליחה — sendBeacon, fetch או fetch
// עם האסימון של המשתמש המחובר. בסוף: נעילות על החיווט באתר עצמו.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    createErrorMonitor,
    describeError,
    errorFingerprintKey,
    isIgnorableError,
    CLIENT_ERROR_REPORT_LIMIT
} from "./error-monitor.js";

const ENDPOINT = "https://simchas-gallery-api.example/telemetry/errors";
const read = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

function stackAt(line) {
    return [
        "TypeError: boom",
        `    at renderImages (https://shmuel-lamed.github.io/1/gallery.js:${line}:9)`,
        "    at run (https://shmuel-lamed.github.io/1/app.js:10:1)"
    ].join("\n");
}

function makeMonitor(overrides = {}) {
    const fetchCalls = [];
    const beaconCalls = [];
    const monitor = createErrorMonitor({
        endpoint: ENDPOINT,
        version: "v43",
        fetch: async (url, init) => { fetchCalls.push({ url, init }); return { ok: true }; },
        getUrl: () => "https://shmuel-lamed.github.io/1/#gallery",
        getUserAgent: () => "TestBrowser/1.0",
        ...overrides
    });
    return { monitor, fetchCalls, beaconCalls };
}

test("טביעת האצבע מתעלמת ממספרי שורה, מרווחים ומאותיות, אך לא מההודעה", () => {
    assert.equal(errorFingerprintKey("boom", stackAt(10)), errorFingerprintKey("  Boom ", stackAt(99)));
    assert.notEqual(errorFingerprintKey("boom", stackAt(10)), errorFingerprintKey("other", stackAt(10)));
    // פיירפוקס וספארי כותבים "fn@url:line:col".
    assert.equal(
        errorFingerprintKey("boom", "renderImages@https://shmuel-lamed.github.io/1/gallery.js:10:9"),
        errorFingerprintKey("boom", "renderImages@https://shmuel-lamed.github.io/1/gallery.js:20:3")
    );
    assert.notEqual(
        errorFingerprintKey("boom", stackAt(10)),
        errorFingerprintKey("boom", "    at upload (https://shmuel-lamed.github.io/1/gallery.js:10:9)")
    );
});

test("אותה שגיאה נשלחת פעם אחת לכל טעינת דף", async () => {
    const { monitor, fetchCalls } = makeMonitor();
    const first = await monitor.report(Object.assign(new Error("boom"), { stack: stackAt(10) }), "upload");
    const second = await monitor.report(Object.assign(new Error("boom"), { stack: stackAt(42) }), "upload");
    assert.equal(first, "fetch");
    assert.equal(second, null, "כפילות אינה נשלחת שוב");
    assert.equal(fetchCalls.length, 1);
    assert.equal(monitor.sentCount, 1);
});

test(`לכל היותר ${CLIENT_ERROR_REPORT_LIMIT} שגיאות שונות לטעינה`, async () => {
    const { monitor, fetchCalls } = makeMonitor();
    const results = [];
    for (let index = 0; index < CLIENT_ERROR_REPORT_LIMIT + 2; index += 1) {
        results.push(await monitor.report(new Error(`error ${index}`)));
    }
    assert.equal(fetchCalls.length, CLIENT_ERROR_REPORT_LIMIT);
    assert.equal(results[CLIENT_ERROR_REPORT_LIMIT], null);
    assert.equal(results[CLIENT_ERROR_REPORT_LIMIT + 1], null);
});

test("רעש ידוע אינו נשלח: ResizeObserver, Script error., ביטול בקשה, מצב לא מקוון", async () => {
    const { monitor, fetchCalls } = makeMonitor();
    const noise = [
        new Error("ResizeObserver loop completed with undelivered notifications."),
        new Error("ResizeObserver loop limit exceeded"),
        "Script error.",
        Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
        Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" }),
        new Error(""),
        null,
        undefined
    ];
    for (const item of noise) {
        assert.equal(await monitor.report(item), null, `נשלח רעש: ${String(item?.message ?? item)}`);
    }
    assert.equal(fetchCalls.length, 0);

    const offline = makeMonitor({ isOnline: () => false });
    assert.equal(await offline.monitor.report(new Error("Failed to fetch")), null);
    assert.equal(offline.fetchCalls.length, 0);

    // שגיאה רגילה כן נשלחת.
    assert.equal(await monitor.report(new Error("Failed to fetch")), "fetch");
    assert.equal(isIgnorableError(describeError(new Error("Failed to fetch"))), false);
});

test("מי שאינו מחובר מדווח ב-sendBeacon עם Blob של JSON", async () => {
    const beaconCalls = [];
    const { monitor, fetchCalls } = makeMonitor({
        sendBeacon: (url, data) => { beaconCalls.push({ url, data }); return true; }
    });
    const error = Object.assign(new Error("Upload failed"), { stack: stackAt(5), code: "request_failed", status: 503 });
    assert.equal(await monitor.report(error, "upload"), "beacon");
    assert.equal(fetchCalls.length, 0, "כש-sendBeacon הצליח אין צורך ב-fetch");
    assert.equal(beaconCalls.length, 1);
    assert.equal(beaconCalls[0].url, ENDPOINT);
    assert.ok(beaconCalls[0].data instanceof Blob);
    assert.equal(beaconCalls[0].data.type, "application/json");

    const payload = JSON.parse(await beaconCalls[0].data.text());
    assert.equal(payload.message, "Upload failed");
    assert.equal(payload.stack, stackAt(5));
    assert.equal(payload.url, "https://shmuel-lamed.github.io/1/#gallery");
    assert.equal(payload.userAgent, "TestBrowser/1.0");
    assert.deepEqual(payload.extra, { version: "v43", code: "request_failed", status: "503", scope: "upload" });
});

test("כש-sendBeacon נכשל או אינו קיים — fetch עם keepalive ובלי אסימון", async () => {
    const refusing = makeMonitor({ sendBeacon: () => false });
    assert.equal(await refusing.monitor.report(new Error("beacon refused")), "fetch");
    assert.equal(refusing.fetchCalls.length, 1);
    const { url, init } = refusing.fetchCalls[0];
    assert.equal(url, ENDPOINT);
    assert.equal(init.method, "POST");
    assert.equal(init.keepalive, true);
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(JSON.parse(init.body).message, "beacon refused");

    const missing = makeMonitor({ sendBeacon: null });
    assert.equal(await missing.monitor.report(new Error("no beacon api")), "fetch");
    assert.equal(missing.fetchCalls.length, 1);

    const throwing = makeMonitor({ sendBeacon: () => { throw new Error("beacon exploded"); } });
    assert.equal(await throwing.monitor.report(new Error("beacon threw")), "fetch");
});

test("משתמש מחובר מדווח ב-fetch עם האסימון, כדי שהשרת ירשום מי נתקל בתקלה", async () => {
    const beaconCalls = [];
    const signedIn = makeMonitor({
        getToken: async () => "session-token",
        sendBeacon: (url, data) => { beaconCalls.push({ url, data }); return true; }
    });
    assert.equal(await signedIn.monitor.report(new Error("signed in failure")), "fetch-auth");
    assert.equal(beaconCalls.length, 0, "עם אסימון אין שימוש ב-sendBeacon, שאינו יכול לשאת כותרת");
    assert.equal(signedIn.fetchCalls.length, 1);
    assert.equal(signedIn.fetchCalls[0].init.headers.Authorization, "Bearer session-token");
    assert.equal(signedIn.fetchCalls[0].init.keepalive, true);

    // אסימון שאינו זמין — מי שאינו מחובר, או כישלון בקריאה — חוזר ל-sendBeacon.
    const failingToken = makeMonitor({
        getToken: async () => { throw new Error("not signed in"); },
        sendBeacon: (url, data) => { beaconCalls.push({ url, data }); return true; }
    });
    assert.equal(await failingToken.monitor.report(new Error("guest failure")), "beacon");
    assert.equal(failingToken.fetchCalls.length, 0);

    const emptyToken = makeMonitor({
        getToken: async () => null,
        sendBeacon: (url, data) => { beaconCalls.push({ url, data }); return true; }
    });
    assert.equal(await emptyToken.monitor.report(new Error("guest failure")), "beacon");
});

test("המאזינים הגלובליים מדווחים על שגיאות שלא נתפסו, ומסננים Script error.", async () => {
    const listeners = new Map();
    const target = { addEventListener: (type, handler) => listeners.set(type, handler) };
    const { monitor, fetchCalls } = makeMonitor();
    monitor.install(target);
    assert.deepEqual([...listeners.keys()].sort(), ["error", "unhandledrejection"]);

    await listeners.get("error")({
        error: Object.assign(new Error("uncaught boom"), { stack: stackAt(3) }),
        message: "Uncaught Error: uncaught boom",
        filename: "https://shmuel-lamed.github.io/1/gallery.js",
        lineno: 3,
        colno: 9
    });
    assert.equal(fetchCalls.length, 1);
    const first = JSON.parse(fetchCalls[0].init.body);
    assert.equal(first.message, "uncaught boom");
    assert.equal(first.extra.scope, "window.error");
    assert.equal(first.extra.file, "https://shmuel-lamed.github.io/1/gallery.js:3:9");

    // שגיאת סקריפט ממקור אחר מגיעה בלי error ובלי פרטים.
    await listeners.get("error")({ error: null, message: "Script error.", filename: "", lineno: 0, colno: 0 });
    assert.equal(fetchCalls.length, 1);

    await listeners.get("unhandledrejection")({ reason: new Error("rejected promise") });
    assert.equal(fetchCalls.length, 2);
    const second = JSON.parse(fetchCalls[1].init.body);
    assert.equal(second.message, "rejected promise");
    assert.equal(second.extra.scope, "unhandledrejection");

    // דחייה עם ערך שאינו Error מדווחת כטקסט.
    await listeners.get("unhandledrejection")({ reason: { code: "quota_exceeded" } });
    assert.equal(fetchCalls.length, 3);
    assert.equal(JSON.parse(fetchCalls[2].init.body).message, '{"code":"quota_exceeded"}');
});

test("ההודעה והמחסנית נחתכות לפני השליחה, וההקשר נשמר כמחרוזות", async () => {
    const { monitor, fetchCalls } = makeMonitor();
    const error = Object.assign(new Error("m".repeat(2000)), { stack: "s".repeat(9000), code: 418, status: 500 });
    await monitor.report(error, { scope: "upload", attempt: 2 });
    const payload = JSON.parse(fetchCalls[0].init.body);
    assert.equal(payload.message.length, 500);
    assert.equal(payload.stack.length, 4000);
    assert.deepEqual(payload.extra, { version: "v43", code: "418", status: "500", scope: "upload", attempt: 2 });
});

test("המנטר לעולם אינו זורק אל הקוד שקרא לו", async () => {
    const { monitor } = makeMonitor({
        fetch: async () => { throw new Error("network down"); },
        getUrl: () => { throw new Error("no location"); }
    });
    await assert.doesNotReject(() => monitor.report(new Error("still reported")));
});

test("גרסת האתר ב-app.js זהה לגרסת המטמון ב-sw.js", () => {
    const appJs = read("app.js");
    const swJs = read("sw.js");
    const siteVersion = /const SITE_VERSION = '([^']+)';/.exec(appJs)?.[1];
    const cacheVersion = /const CACHE_VERSION = "([^"]+)";/.exec(swJs)?.[1];
    assert.ok(siteVersion, "SITE_VERSION לא נמצאה ב-app.js");
    assert.ok(cacheVersion, "CACHE_VERSION לא נמצאה ב-sw.js");
    assert.equal(siteVersion, cacheVersion, "יש להעלות את SITE_VERSION ואת CACHE_VERSION יחד");
    assert.match(appJs, /window\.SITE_VERSION = SITE_VERSION/);
});

test("המנטר מותקן בכל דף, והמודול שלו שייך למעטפת האפליקציה", () => {
    const appJs = read("app.js");
    assert.match(appJs, /import \{ installErrorMonitor \} from '\.\/error-monitor\.js'/);
    assert.match(appJs, /installErrorMonitor\(\{\s*endpoint: `\$\{R2_WORKER_BASE_URL\}\/telemetry\/errors`/);
    assert.ok(
        appJs.indexOf("installErrorMonitor({") < appJs.indexOf("initSession();"),
        "המנטר חייב להיות מותקן לפני אתחול ההתחברות"
    );

    const shell = read("sw.js");
    const appShell = shell.slice(shell.indexOf("const APP_SHELL"), shell.indexOf("];", shell.indexOf("const APP_SHELL")));
    assert.ok(appShell.includes('"./error-monitor.js"'), "app.js מייבא את המודול סטטית, ולכן הוא חייב במעטפת");

    const pkg = read("package.json");
    for (const file of ["error-monitor.js", "admin-errors.js"]) {
        assert.ok(pkg.includes(`node --check ${file}`), `${file} חסר ב-check:syntax`);
    }
});

test("הנקודות המרכזיות שתופסות שגיאות מדווחות עליהן", () => {
    const expectations = [
        ["session-auth.js", "window.reportClientError?.(err, 'data-listener')"],
        ["cloudflare-client.js", 'window.reportClientError?.(error, "sign-in")'],
        ["gallery.js", "window.reportClientError?.(error, 'upload')"],
        ["gallery.js", "window.reportClientError?.(error, 'ai-search')"],
        ["face-search.js", "window.reportClientError?.(err, 'face-search')"],
        ["face-index.js", "window.reportClientError?.(error, 'face-index')"],
        ["app.js", "window.reportClientError?.(error, 'lazy-module')"]
    ];
    for (const [file, marker] of expectations) {
        assert.ok(read(file).includes(marker), `${file} אינו מדווח: ${marker}`);
    }
    // ניתוק רשת אינו תקלה באתר ואינו מדווח.
    const reporter = read("session-auth.js");
    const start = reporter.indexOf("export function reportFirestoreError");
    assert.match(reporter.slice(start, start + 900), /err\?\.code !== 'unavailable'/);
});
