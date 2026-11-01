import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as source from "./cloudflare-worker.js";
import { bundleWorker, importWorkerBundle } from "./scripts/bundle-worker.mjs";

// ה-Worker מחולק למודולים בתיקייה worker/, אבל ה-Action מעלה ל-Cloudflare
// מודול יחיד. הבדיקות כאן מוודאות שהקובץ הארוז נבנה, שהוא עצמאי (בלי import),
// ושהוא מתנהג כמו קוד המקור: אותם ייצואים ואותה רשימת יכולות ב-/health.

// מסד מזערי שמספיק ל-/health ולשורת הסימון של הסביבה.
class HealthD1 {
  prepare(sql) {
    return {
      bind() { return this; },
      async first() {
        if (sql.includes("SELECT 1 AS connected")) return { connected: 1 };
        if (sql.includes("FROM gallery_environment")) return { environment: "production" };
        return null;
      },
      async all() { return { results: [] }; },
      async run() { return { success: true }; }
    };
  }
}

function env() {
  return { GALLERY_DB: new HealthD1(), GALLERY_BUCKET: { async list() { return { objects: [] }; } } };
}

async function health(worker) {
  const response = await worker.fetch(new Request("https://simchas-gallery-api.example/health"), env(), { waitUntil() {} });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test("ה-Worker הארוז הוא מודול ESM יחיד בלי ייבוא חיצוני", async () => {
  const { outputFiles } = await bundleWorker({ write: false });
  assert.equal(outputFiles.length, 1);
  const code = outputFiles[0].text;
  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\bimport\(/);
  assert.ok(code.length > 100_000, "הקובץ הארוז קטן באופן חשוד");
  // כל מודולי worker/ נכנסו לקובץ (esbuild מסמן כל קובץ מקור בהערה).
  for (const file of readdirSync(new URL("./worker/", import.meta.url))) {
    assert.match(code, new RegExp(`// worker/${file.replace(".", "\\.")}`), file);
  }
});

test("הקובץ הארוז מייצא אובייקט ברירת מחדל עם fetch ואת אותם ייצואים כמו המקור", async () => {
  const bundled = await importWorkerBundle("exports");
  assert.equal(typeof bundled.default, "object");
  assert.equal(typeof bundled.default.fetch, "function");
  assert.deepEqual(Object.keys(bundled.default).sort(), Object.keys(source.default).sort());
  assert.deepEqual(Object.keys(bundled).sort(), Object.keys(source).sort());
});

test("/health של הקובץ הארוז זהה לזה של קוד המקור, כולל רשימת היכולות", async () => {
  const bundled = (await importWorkerBundle("health")).default;
  const [fromBundle, fromSource] = await Promise.all([health(bundled), health(source.default)]);
  assert.ok(Array.isArray(fromSource.features) && fromSource.features.length > 0);
  assert.deepEqual(fromBundle.features, fromSource.features);
  assert.deepEqual(fromBundle, fromSource);
});

test("ה-Action פורס את הקובץ הארוז ומופעל גם על שינויים ב-worker/", () => {
  const workflow = readFileSync(new URL("./.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
  assert.match(workflow, /npm run build:worker/);
  assert.match(workflow, /readFileSync\("dist-worker\/cloudflare-worker\.js"\)/);
  assert.match(workflow, /name: "cloudflare-worker\.js"/);
  assert.match(workflow, /main_module: "cloudflare-worker\.js"/);
  assert.equal((workflow.match(/- "worker\/\*\*"/g) || []).length, 2);
  assert.equal((workflow.match(/- scripts\/bundle-worker\.mjs/g) || []).length, 2);
});
