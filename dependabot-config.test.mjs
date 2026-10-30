// .github/dependabot.yml: עדכון שבועי ל-npm (תלויות הפיתוח מקובצות) ול-GitHub
// Actions, וגרסה ראשית של Vite, Tailwind ו-Playwright אינה מוצעת מעצמה.
// בלי ספריית YAML: הבדיקה קוראת את הטקסט, וזה מספיק לנעול את הכוונה.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("./.github/dependabot.yml", import.meta.url), "utf8");
// כל רשומה ב-updates, מ"- package-ecosystem" ועד הבאה.
const entries = config.split(/\n(?=  - package-ecosystem:)/).slice(1);
const entryFor = ecosystem => entries.find(entry => entry.includes(`package-ecosystem: ${ecosystem}`)) || "";

test("שתי רשומות: npm ו-github-actions, שבועיות, מהשורש", () => {
    assert.match(config, /^version: 2$/m);
    assert.equal(entries.length, 2);
    for (const ecosystem of ["npm", "github-actions"]) {
        const entry = entryFor(ecosystem);
        assert.ok(entry, `חסרה רשומה ל-${ecosystem}`);
        assert.match(entry, /directory: \/\n/);
        assert.match(entry, /interval: weekly/);
        assert.match(entry, /groups:/);
    }
});

test("תלויות הפיתוח מקובצות ל-PR אחד", () => {
    assert.match(entryFor("npm"), /dependency-type: development/);
});

test("גרסה ראשית של Vite, Tailwind ו-Playwright אינה מוצעת", () => {
    const npm = entryFor("npm");
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
    for (const name of ["vite", "tailwindcss", "@playwright/test"]) {
        assert.ok(name in pkg.devDependencies, `${name} אינו ב-devDependencies`);
        const quoted = name.startsWith("@") ? `"${name}"` : name;
        const rule = new RegExp(`dependency-name: ${quoted.replace(/[/.@"]/g, "\\$&")}\\n\\s+update-types: \\["version-update:semver-major"\\]`);
        assert.match(npm, rule, `${name} חסר ב-ignore של גרסה ראשית`);
    }
});
