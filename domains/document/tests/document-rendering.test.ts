import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../src/markdown-pipeline.js";

test("Markdown keeps prose, GFM, and math while discarding executable input", async () => {
  const html = await renderMarkdown(`# Shared proof

| owner | result |
| --- | --- |
| source | $x^2$ |

<script>globalThis.compromised = true</script>

[unsafe](javascript:alert(1))`);

  assert.match(html, /<h1>Shared proof<\/h1>/u);
  assert.match(html, /<table>/u);
  assert.match(html, /class="katex"/u);
  assert.doesNotMatch(html, /<script|javascript:|compromised/u);
});

test("a malformed math fragment stays an escaped local diagnostic", async () => {
  const html = await renderMarkdown("$\\notacommand{<script>$");
  assert.match(html, /class="katex-error"/u);
  assert.match(html, /&#x3C;script/u);
  assert.doesNotMatch(html, /<\/span><script/u);
});
