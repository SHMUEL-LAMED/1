// אורז את ה-Worker (cloudflare-worker.js ומודולי worker/) לקובץ ESM יחיד.
// ה-Action של הפריסה מעלה ל-Cloudflare מודול אחד בשם cloudflare-worker.js,
// ולכן מעלים את הקובץ הארוז dist-worker/cloudflare-worker.js ולא את קובץ המקור.
// esbuild מגיע כתלות של vite (package-lock), כך שאין תלות חדשה.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const WORKER_BUNDLE_PATH = "dist-worker/cloudflare-worker.js";

export async function bundleWorker({ outfile = `${root}${WORKER_BUNDLE_PATH}`, write = true } = {}) {
  const result = await build({
    entryPoints: [`${root}cloudflare-worker.js`],
    outfile,
    write,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    // ללא הקטנה: שמות הפונקציות והשורות נשארים קריאים ביומני Cloudflare.
    minify: false,
    legalComments: "none",
    logLevel: "warning"
  });
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await bundleWorker();
  console.log(`Worker bundled to ${WORKER_BUNDLE_PATH}.`);
}

// טוען עותק "קר" וחדש של ה-Worker הארוז (מצב מודול נקי: סכימה, מטמונים),
// בלי לכתוב לדיסק. משמש בדיקות שמדמות Worker שזה עתה עלה.
export async function importWorkerBundle(tag = String(Date.now())) {
  const { outputFiles } = await bundleWorker({ outfile: `${root}dist-worker/in-memory.js`, write: false });
  const code = `${outputFiles[0].text}\n// ${tag}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
