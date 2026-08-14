// מעטפת האפליקציה והסמל נשמרים לעבודה מהירה וגם במצב לא מקוון.
// שם המטמון נושא מספר גרסה; העלאת המספר מפילה את הגרסאות הישנות ב-activate.
const CACHE_VERSION = "v39";
const CACHE_NAME = `simchat-gallery-shell-${CACHE_VERSION}`;
const CACHE_PREFIX = "simchat-gallery-shell-";

// קבצי הליבה של האתר. index.html נשמר כאן רק כגיבוי למצב לא מקוון —
// הניווט עצמו תמיד מנסה קודם את הרשת כדי שלא יישאר עותק ישן לנצח.
const APP_SHELL = [
  "./",
  "./index.html",
  // גיליונות הסגנון נטענים לפי הסדר הזה גם ב-index.html.
  "./styles/base.css",
  "./styles/theme.css",
  "./styles/layout.css",
  "./styles/gallery.css",
  "./styles/profile.css",
  "./styles/admin.css",
  "./styles/chat.css",
  "./styles/analytics.css",
  "./styles/responsive.css",
  "./app.js",
  // המודולים ש-app.js מייבא. בלעדיהם הטעינה הראשונה במצב לא מקוון נכשלת.
  "./core/utils.js",
  "./core/state.js",
  "./core/permissions.js",
  "./ui/icons.js",
  "./ui/modals.js",
  "./ui/admin-menu.js",
  "./ui/profile.js",
  "./ui/theme.js",
  "./services/r2-client.js",
  "./services/media-storage.js",
  "./features/analytics.js",
  "./features/backup.js",
  "./features/trash.js",
  "./features/activity.js",
  "./gallery.js",
  "./features/gallery/media-grid.js",
  "./features/gallery/folders.js",
  "./features/gallery/lightbox.js",
  "./features/gallery/downloads.js",
  "./features/gallery/uploads.js",
  "./features/gallery/bulk-actions.js",
  "./features/gallery/ai-search.js",
  "./drive-sync.js",
  "./features/drive/google-auth.js",
  "./features/drive/oauth.js",
  "./features/drive/picker.js",
  "./features/drive/sync.js",
  "./features/drive/listeners.js",
  "./admin.js",
  "./chat.js",
  "./features/chat/conversation.js",
  "./features/chat/render.js",
  "./features/chat/attachments.js",
  "./features/chat/emoji.js",
  "./features/chat/stickers.js",
  "./features/chat/admin-center.js",
  "./features/chat/profile-inbox.js",
  "./face-search.js",
  "./face-index.js",
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
const FACE_CACHE_NAME = `simchat-gallery-face-${CACHE_VERSION}`;
const FACE_CACHE_PREFIX = "simchat-gallery-face-";

const STATIC_DESTINATIONS = new Set(["style", "script", "image", "font", "manifest"]);

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

  // ניווט ו-index.html: קודם רשת, ורק בנפילה חוזרים למטמון.
  if (request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html", { cacheName: CACHE_NAME })
          .then(cached => cached || caches.match("./index.html")))
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
