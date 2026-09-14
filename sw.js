// מעטפת האפליקציה והסמל נשמרים לעבודה מהירה וגם במצב לא מקוון.
// שם המטמון נושא מספר גרסה; העלאת המספר מפילה את הגרסאות הישנות ב-activate.
const CACHE_VERSION = "v40";
const CACHE_NAME = `simchat-gallery-shell-${CACHE_VERSION}`;
const CACHE_PREFIX = "simchat-gallery-shell-";

// קבצי הליבה של האתר. index.html נשמר כאן רק כגיבוי למצב לא מקוון —
// הניווט עצמו תמיד מנסה קודם את הרשת כדי שלא יישאר עותק ישן לנצח.
// chat.js אינו כאן בכוונה: הוא נטען בייבוא דינמי רק למשתמש מחובר, ואין
// טעם להוריד אותו מראש לאורח. הוא נכנס למטמון בשימוש הראשון בו.
// chat-admin.js ו-popup-admin.js הם מודולי ניהול, ולכן גם הם נשארים בחוץ.
// admin.html ומודולי הניהול אינם כאן בכוונה, מאותו טעם: הם שייכים למנהל
// בלבד ונכנסים למטמון רק כשהוא פותח את לוח הניהול. גם face-index.js
// ו-drive-sync.js הם כלי ניהול ולכן אינם נטענים מראש לאורח.
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./tailwind.generated.css",
  "./app.js",
  "./session-ui.js",
  "./gallery.js",
  "./session-auth.js",
  "./popup-announcement.js",
  "./face-search.js",
  "./cloudflare-client.js",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png"
];

// כתובות שתשובתן פרטית למשתמש ואסור לשמור אותן במטמון.
const PRIVATE_PATH_PATTERN = /\/(?:drive|auth|login|logout|token|session|user|users|admin|chat|permission|permissions|api)(?:\/|$)/i;

// נכסי מנוע זיהוי הפנים. אין טעינה מוקדמת שלהם, אך אחרי שהמשתמש
// פתח את חיפוש הפנים פעם אחת מותר לשמור אותם לשימוש הבא.
const FACE_ASSET_PATTERN = /\/face-assets\//i;
// נכסי המנוע אינם משתנים עם קוד האתר, ולכן יש להם מספר גרסה נפרד: תיקון
// בקוד לא יגרור הורדה מחדש של מודלי הזיהוי באמצע אינדוקס.
const FACE_ASSET_VERSION = "faceapi-1.7.15-ssd-l68-r1";
const FACE_CACHE_NAME = `simchat-gallery-face-${FACE_ASSET_VERSION}`;
const FACE_CACHE_PREFIX = "simchat-gallery-face-";

const STATIC_DESTINATIONS = new Set(["style", "script", "image", "font", "manifest"]);

// כל דף נשמר תחת הכתובת שלו. ניווט לשורש נחשב לדף הגלריה.
function navigationCacheKey(url) {
  const page = url.pathname.split("/").pop();
  return page && /\.html$/i.test(page) ? `./${page}` : "./index.html";
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // קובץ חסר בודד לא אמור להכשיל את ההתקנה כולה.
      .then(cache => Promise.allSettled(APP_SHELL.map(asset => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // נמחקות רק גרסאות ישנות של המטמון של האתר עצמו.
          .filter(key => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            || (key.startsWith(FACE_CACHE_PREFIX) && key !== FACE_CACHE_NAME))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: מגיש מיד מהמטמון ומרענן ברקע לפעם הבאה.
// תשובה חוצת-מקור מגיעה כ-opaque (status 0) ועדיין ניתנת לשמירה; כישלון
// שמירה נבלע כדי שלעולם לא יפיל את הבקשה עצמה.
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && (response.ok || response.type === "opaque")) {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

// קודם רשת, ובנפילה בלבד חוזרים למטמון. מתאים לקוד של האתר: גרסה חדשה
// מגיעה למשתמש כבר בטעינה הראשונה אחרי פריסה, והמטמון נשאר גיבוי לאופליין.
function networkFirst(request, cacheName) {
  return fetch(request)
    .then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    })
    .catch(() => caches.match(request, { cacheName }).then(cached => cached || caches.match(request)));
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // נכסי מנוע זיהוי הפנים מגיעים מה-Worker ולכן נבדקים לפני סינון המקור.
  if (FACE_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, FACE_CACHE_NAME));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // תשובות פרטיות של Drive, התחברות, הרשאות ו-API לעולם אינן נשמרות.
  if (PRIVATE_PATH_PATTERN.test(url.pathname)) return;

  // ניווט ודפי HTML: קודם רשת, ורק בנפילה חוזרים למטמון.
  // לאתר יש יותר מדף אחד (הגלריה ולוח הניהול), ולכן כל ניווט נשמר תחת
  // הדף שלו. שמירה קשיחה תחת index.html הייתה מגישה את הגלריה גם למי
  // שביקש את admin.html במצב לא מקוון.
  if (request.mode === "navigate" || /\.html$/i.test(url.pathname)) {
    const pageKey = navigationCacheKey(url);
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(pageKey, copy));
          }
          return response;
        })
        .catch(() => caches.match(pageKey, { cacheName: CACHE_NAME })
          .then(cached => cached || caches.match(pageKey)))
    );
    return;
  }

  // קוד האתר. stale-while-revalidate היה מגיש כאן את הגרסה הישנה מהמטמון
  // ומרענן רק לפעם הבאה, כך שאחרי כל פריסה הטעינה הראשונה עדיין הריצה קוד ישן.
  if (request.destination === "script" || request.destination === "style"
    || /\.(?:css|js|mjs)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  // אייקונים, גופנים וקבצים סטטיים אחרים משתנים לעתים רחוקות.
  if (STATIC_DESTINATIONS.has(request.destination) || /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
  }
});
