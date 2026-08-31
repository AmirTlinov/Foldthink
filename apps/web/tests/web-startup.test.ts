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

test("the offline shell owns the main surface and isolated widget frame", async () => {
  const worker = await readFile(`${appRoot}public/sw.js`, "utf8");
  const widgetFrame = await readFile(`${appRoot}widget-frame.html`, "utf8");
  for (const asset of [
    "/assets/app.js",
    "/assets/public-browser.js",
    "/assets/scene-element.js",
    "/widget-frame.html",
    "/assets/widget-frame.js",
  ]) {
    assert.match(worker, new RegExp(asset.replaceAll("/", "\\/")));
  }
  assert.match(worker, /cache\.put\(request, response\.clone\(\)\)/u);
  assert.match(widgetFrame, /Content-Security-Policy/u);
  assert.match(widgetFrame, /connect-src 'none'/u);
});
