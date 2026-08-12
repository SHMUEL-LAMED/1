import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./cloudflare-client.js", import.meta.url), "utf8");

test("Google sign-in uses only the official GIS button flow", () => {
  assert.match(source, /googleIdentity\.renderButton\s*\(/);
  assert.match(source, /use_fedcm_for_button:\s*true/);
  assert.doesNotMatch(source, /navigator\.credentials\.get\s*\(/);
  assert.doesNotMatch(source, /GOOGLE_FEDCM_CONFIG_URL/);
  assert.doesNotMatch(source, /googleIdentity\.prompt\s*\(/);
});
