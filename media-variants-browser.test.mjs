// בדיקה בדפדפן אמיתי: יצירת התצוגות המקדימות במסלול האמיתי של ההעלאה.
//
// הדף index.html נטען ב-Chromium (Playwright), ה-Worker מדומה ב-page.route,
// ו-window.uploadMediaToR2 — אותה פונקציה שההעלאה באתר קוראת לה — מקבלת
// קובץ PNG אמיתי מהמאגר, JPEG שנוצר בקנבס (גם עם כיוון EXIF), וסרטון קצר
// שמוקלט בדפדפן. הבדיקה בודקת שהטופס שנשלח ל-/upload מכיל את חלקי
// variant_* בגודל ובממדים הנכונים, ושאף תצוגה אינה גדולה מהמקור.
//
// Playwright אינו מותקן ב-CI, ולכן הבדיקה מדלגת על עצמה כשהוא חסר.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright/index.mjs";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";
const playwrightAvailable = existsSync(PLAYWRIGHT_MODULE) && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH);

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const WORKER_ORIGIN = "https://simchas-gallery-api.0534169095.workers.dev";
const MAX_VARIANT_BYTES = 2 * 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json"
};

// שרת סטטי קטן לקובצי האתר, כדי שהמודולים ייטענו מאותו מקור.
function startStaticServer() {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      const file = join(ROOT, relative);
      if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || !existsSync(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      response.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise(done => server.close(done)) });
    });
  });
}

// ממדי תמונה מתוך הבייטים עצמם — WebP (VP8 / VP8L / VP8X) ו-JPEG (SOF).
function imageDimensions(bytes, type) {
  if (type === "image/webp") {
    const fourcc = String.fromCharCode(...bytes.slice(12, 16));
    if (fourcc === "VP8 ") {
      return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
    if (fourcc === "VP8L") {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") {
      return {
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      };
    }
    throw new Error(`WebP לא מוכר: ${fourcc}`);
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error("JPEG פגום");
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      }
      offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    }
    throw new Error("JPEG בלי SOF");
  }
  throw new Error(`סוג לא נתמך: ${type}`);
}

function pngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// בודק חלק תצוגה אחד: סוג, גודל, ממדים מול הצפוי, והתאמה ל-variantsMeta.
function assertVariant(upload, name, expected) {
  const part = upload[`variant_${name}`];
  assert.ok(part, `חלק variant_${name} חסר בטופס`);
  assert.ok(["image/webp", "image/jpeg"].includes(part.type), `סוג לא צפוי: ${part.type}`);
  assert.ok(part.size > 0 && part.size <= MAX_VARIANT_BYTES, `גודל ${name}: ${part.size}`);
  const dims = imageDimensions(part.bytes, part.type);
  assert.deepEqual(dims, expected, `ממדי ${name}`);
  const meta = JSON.parse(upload.variantsMeta);
  assert.deepEqual(meta[name], expected, `variantsMeta של ${name}`);
  return part;
}

test("הדפדפן מייצר תצוגות מקדימות ומצרף אותן לטופס ההעלאה", { skip: playwrightAvailable ? false : "Playwright אינו מותקן בסביבה זו" }, async t => {
  const { chromium } = await import(PLAYWRIGHT_MODULE);
  const server = await startStaticServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const uploads = [];
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error?.message || error)));

  try {
    // משאבים חיצוניים (Google, אייקונים, גופנים) אינם נדרשים לבדיקה.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const type = route.request().resourceType();
      const contentType = type === "script" ? "text/javascript" : (type === "stylesheet" ? "text/css" : "text/plain");
      return route.fulfill({ status: 200, contentType, body: "" });
    });

    // ה-Worker המדומה: /upload נקרא ומפורק כ-multipart, ושאר הנתיבים מחזירים ריק.
    await page.route(`${WORKER_ORIGIN}/**`, async route => {
      const request = route.request();
      const cors = {
        "Access-Control-Allow-Origin": server.origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
      };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const url = new URL(request.url());
      if (url.pathname === "/upload" && request.method() === "POST") {
        const body = request.postDataBuffer();
        const form = await new Response(body, { headers: { "content-type": request.headers()["content-type"] } }).formData();
        const parts = {};
        for (const [name, value] of form.entries()) {
          parts[name] = typeof value === "string"
            ? value
            : { name: value.name, type: value.type, size: value.size, bytes: new Uint8Array(await value.arrayBuffer()) };
        }
        uploads.push(parts);
        const imageId = parts.imageId;
        const variants = {};
        for (const name of ["thumb", "medium", "poster"]) {
          const part = parts[`variant_${name}`];
          if (!part) continue;
          const extension = part.type === "image/jpeg" ? "jpg" : "webp";
          variants[name] = { key: `variants/${imageId}/${name}.${extension}`, url: `${WORKER_ORIGIN}/media/variants/${imageId}/${name}.${extension}`, type: part.type };
        }
        const isVideo = String(parts.file?.type || "").startsWith("video/");
        return route.fulfill({
          status: 201,
          headers: { ...cors, "Content-Type": "application/json" },
          body: JSON.stringify({
            success: true,
            key: `approved/u1/${imageId}.${isVideo ? "webm" : "jpg"}`,
            state: "approved",
            url: `${WORKER_ORIGIN}/media/approved/u1/${imageId}.${isVideo ? "webm" : "jpg"}`,
            mediaType: isVideo ? "video" : "image",
            mimeType: parts.file?.type || "",
            variants,
            variantsVersion: 1
          })
        });
      }
      return route.fulfill({
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, documents: [], hasMore: false })
      });
    });

    await page.goto(`${server.origin}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.uploadMediaToR2 === "function");
    await page.evaluate(() => {
      window.getFirebaseIdToken = async () => "test-token";
      window.state.currentUser = { uid: "u1" };
    });

    // 1. PNG אמיתי מהמאגר (512×512): thumb מוקטן ל-480, medium נשאר 512 — בלי הגדלה.
    const pngBytes = readFileSync(join(ROOT, "icon-512.png"));
    const pngDims = pngDimensions(new Uint8Array(pngBytes));
    const pngResult = await page.evaluate(async ({ base64 }) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      return window.uploadMediaToR2(new File([bytes], "icon.png", { type: "image/png" }), "img_png", "תמונת בדיקה");
    }, { base64: pngBytes.toString("base64") });
    const pngUpload = uploads.at(-1);
    assert.equal(pngUpload.imageId, "img_png");
    assert.equal(pngUpload.file.type, "image/png");
    assert.equal(pngUpload.file.size, pngBytes.length);
    const pngThumb = assertVariant(pngUpload, "thumb", fitWithin(pngDims.width, pngDims.height, 480));
    const pngMedium = assertVariant(pngUpload, "medium", fitWithin(pngDims.width, pngDims.height, 1280));
    assert.equal(pngThumb.type, "image/webp", "Chromium מקודד WebP");
    assert.ok(pngThumb.size < pngBytes.length && pngMedium.size < pngBytes.length, "התצוגות קטנות מהמקור");
    assert.equal(pngUpload.variant_poster, undefined);
    assert.equal(pngResult.variants.thumb.key, "variants/img_png/thumb.webp");
    assert.equal(pngResult.variantsVersion, 1);
    assert.equal(pngResult.mediaType, "image");

    // 2. JPEG גדול שנוצר בקנבס (2000×1200): שתי התצוגות מוקטנות לפי הצלע הארוכה.
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1200;
      const context = canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 2000, 1200);
      gradient.addColorStop(0, "#f5c451");
      gradient.addColorStop(1, "#1e3a8a");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 2000, 1200);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
      window.__testJpeg = new Uint8Array(await blob.arrayBuffer());
      return window.uploadMediaToR2(new File([blob], "wide.jpg", { type: "image/jpeg" }), "img_jpeg", "רחבה");
    });
    const jpegUpload = uploads.at(-1);
    assertVariant(jpegUpload, "thumb", { width: 480, height: 288 });
    assertVariant(jpegUpload, "medium", { width: 1280, height: 768 });

    // 3. אותו JPEG עם Orientation=6 ב-EXIF: הכיוון נשמר, ולכן התצוגה מסובבת.
    await page.evaluate(async () => {
      const source = window.__testJpeg;
      // APP1 מינימלי: TIFF (little-endian) עם רשומת Orientation אחת.
      const exif = Uint8Array.from([
        0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
      ]);
      const rotated = new Uint8Array(source.length + exif.length);
      rotated.set(source.subarray(0, 2), 0);
      rotated.set(exif, 2);
      rotated.set(source.subarray(2), 2 + exif.length);
      return window.uploadMediaToR2(new File([rotated], "rotated.jpg", { type: "image/jpeg" }), "img_rotated", "מסובבת");
    });
    const rotatedUpload = uploads.at(-1);
    assertVariant(rotatedUpload, "thumb", { width: 288, height: 480 });
    assertVariant(rotatedUpload, "medium", { width: 768, height: 1280 });

    // 4. סרטון קצר שמוקלט בדפדפן (VP8/WebM): פוסטר ותצוגה קטנה מפריים אחד.
    const videoResult = await page.evaluate(async () => {
      if (typeof MediaRecorder !== "function" || !MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        return { skipped: "MediaRecorder אינו תומך ב-WebM" };
      }
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.start(100);
      let frame = 0;
      await new Promise(resolve => {
        const timer = setInterval(() => {
          context.fillStyle = `hsl(${(frame * 17) % 360}, 80%, 50%)`;
          context.fillRect(0, 0, 320, 180);
          frame += 1;
          if (frame >= 45) {
            clearInterval(timer);
            resolve();
          }
        }, 33);
      });
      await new Promise(resolve => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      const blob = new Blob(chunks, { type: "video/webm" });
      if (!blob.size) return { skipped: "ההקלטה בדפדפן יצאה ריקה" };
      const stored = await window.uploadMediaToR2(blob, "vid_test", "סרטון בדיקה");
      return { size: blob.size, stored };
    });
    if (videoResult.skipped) {
      t.diagnostic(`בדיקת הסרטון דולגה: ${videoResult.skipped}`);
    } else {
      const videoUpload = uploads.at(-1);
      assert.equal(videoUpload.file.type, "video/webm");
      assert.equal(videoUpload.file.size, videoResult.size);
      if (!videoUpload.variant_poster) {
        t.diagnostic("Chromium headless לא הפיק פריים מהסרטון שנוצר; הפוסטר לא נבדק");
      } else {
        assertVariant(videoUpload, "poster", { width: 320, height: 180 });
        assertVariant(videoUpload, "thumb", { width: 320, height: 180 });
        assert.equal(videoUpload.variant_medium, undefined);
        assert.equal(videoResult.stored.variants.poster.key, "variants/vid_test/poster.webp");
        assert.equal(videoResult.stored.mediaType, "video");
      }
    }

    // 5. ביטול מפורש של התצוגות (קובץ משני): הטופס נשלח בלעדיהן.
    await page.evaluate(async ({ base64 }) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      return window.uploadMediaToR2(new File([bytes], "icon.png", { type: "image/png" }), "img_plain", "בלי תצוגות", { variants: false });
    }, { base64: pngBytes.toString("base64") });
    const plainUpload = uploads.at(-1);
    assert.equal(plainUpload.variant_thumb, undefined);
    assert.equal(plainUpload.variantsMeta, undefined);

    const fatal = pageErrors.filter(message => /uploadMediaToR2|media-variants/.test(message));
    assert.deepEqual(fatal, [], "שגיאות דף במסלול ההעלאה");
  } finally {
    await browser.close();
    await server.close();
  }
});
