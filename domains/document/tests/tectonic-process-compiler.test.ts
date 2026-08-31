import assert from "node:assert/strict";
import test from "node:test";
import { TectonicProcessCompiler } from "../src/tectonic-process-compiler.js";

test("cached untrusted Tectonic produces bounded SVG pages", {
  skip: process.env.FOLDTHINK_TEST_TECTONIC !== "1" && "Set FOLDTHINK_TEST_TECTONIC=1 after warming the pinned bundle.",
}, async () => {
  const compiler = new TectonicProcessCompiler({
    ...(process.env.TECTONIC_BINARY ? { tectonicBinary: process.env.TECTONIC_BINARY } : {}),
    ...(process.env.PDFINFO_BINARY ? { pdfInfoBinary: process.env.PDFINFO_BINARY } : {}),
    ...(process.env.PDFTOCAIRO_BINARY ? { pdfToCairoBinary: process.env.PDFTOCAIRO_BINARY } : {}),
    ...(process.env.LATEX_BUNDLE_PATH ? { bundlePath: process.env.LATEX_BUNDLE_PATH } : {}),
  });
  const pages = await compiler.compile(String.raw`\documentclass{article}
\begin{document}
\section*{Foldthink proof}
$x^2 + y^2 = z^2$
\end{document}`);

  assert.equal(pages.length, 1);
  assert.ok(pages[0]!.width > 0);
  assert.ok(pages[0]!.height > 0);
  assert.match(new TextDecoder().decode(pages[0]!.bytes.subarray(0, 512)), /<svg/u);
});
