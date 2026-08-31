import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

test("the web shell opens directly to the Foldthink surface", async () => {
  const html = await readFile(`${appRoot}index.html`, "utf8");
  const manifest = JSON.parse(await readFile(`${appRoot}public/manifest.webmanifest`, "utf8")) as {
    start_url: string;
    display: string;
  };
  assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /sign[ -]?in|register/i);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
});
