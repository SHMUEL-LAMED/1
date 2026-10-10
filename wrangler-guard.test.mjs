import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

// Cloudflare Workers Builds הריץ `npx wrangler deploy` בכל דחיפה, ואחרי המעבר
// ל-Vite פרס את האתר הבנוי כ-Worker סטטי ומחק את ה-API (8.10). wrangler.jsonc
// קיים כדי שפריסה כזו תיכשל תמיד, לפני כל העלאה.

function stripJsonComments(text) {
    return text.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
}

test("wrangler.jsonc חוסם את Workers Builds: נקודת כניסה שאינה קיימת ואין Bindings", async () => {
    const raw = await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8");
    const config = JSON.parse(stripJsonComments(raw));
    assert.equal(config.name, "simchas-gallery-api");
    assert.match(config.main, /WORKERS-BUILDS-DISABLED/);
    await assert.rejects(access(new URL(config.main, import.meta.url)), "קובץ הכניסה חייב לא להתקיים, כדי ש-wrangler deploy ייכשל");
    for (const key of ["assets", "site", "d1_databases", "r2_buckets", "vars", "kv_namespaces", "services", "build"]) {
        assert.equal(config[key], undefined, `אסור להגדיר ${key} בקובץ המחסום`);
    }
});

test("ה-Action של הפריסה יורש Bindings מהגרסה הפעילה ולא מהאחרונה", async () => {
    const workflow = await readFile(new URL("./.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
    assert.match(workflow, /api\("\/deployments"\)/);
    assert.match(workflow, /version_id: inheritFrom/);
    assert.match(workflow, /workers\/workers\/\$\{workerName\}/);
    assert.match(workflow, /Uploaded version is missing inherited bindings; refusing to deploy/);
});
