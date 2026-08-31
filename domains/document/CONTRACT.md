# Document Contract

> Domain: editable documents and derived rich representations.
>
> Owners: `SceneDocument`, `DocumentRenderer`, `LatexCompiler`, and `WidgetHost`.

## Responsibility split

| Owner | Responsibility |
|---|---|
| `SceneDocument` | Canonical Markdown, LaTeX, widget source, block identity, and order |
| `DocumentRenderer` | Derived Markdown, KaTeX, shape, and document layout |
| `LatexCompiler` | Restricted compilation from canonical `.tex` source to derived artifacts |
| `WidgetHost` | Isolated execution and typed communication for interactive blocks |

CodeMirror is an editing adapter. It owns an active editor session, not document
content.

## Source-editing contract

1. A double-tap resolves one visible editable block ID and opens the source of that
   exact block.
2. The editor begins from the latest `SceneDocument` source revision.
3. Save dispatches one version-checked `patchSurface` command through
   `WorkspaceRuntime`.
4. Cancel closes the editor without a semantic command.
5. A concurrent source change is merged through the document CRDT or presented as
   an explicit conflict; the editor never silently overwrites a newer revision.
6. Rendered HTML, math, PDF, SVG, and widget pixels remain derived outputs.

## DocumentRenderer guarantees

1. Markdown source passes through a versioned unified/remark pipeline.
2. KaTeX renders supported math fragments from source and renderer configuration.
3. Sanitization runs before generated HTML enters the page DOM.
4. One block render failure produces a bounded error representation for that block
   while the canonical source remains editable.
5. Layout is deterministic for the same source, renderer version, fonts, and page
   constraints.

## LatexCompiler guarantees

1. Tectonic runs as a separate untrusted process from a private temporary directory.
2. The process accepts one bounded source file and compiles from an already cached
   bundle with network retrieval disabled.
3. The parent bounds execution time, diagnostic bytes, input size, PDF size, SVG
   size, and page count, then kills work that crosses a bound.
4. An artifact key is derived from source hash, compiler version, dependency bundle,
   and compilation parameters.
5. A successful job publishes the artifact through `AssetRegistry`; it never changes
   document source.
6. The same artifact key can reuse a verified existing result.

## WidgetHost guarantees

1. A widget runs in a sandboxed iframe with an opaque origin.
2. The iframe receives a versioned input object and only explicit capabilities.
3. Parent and widget exchange messages through a typed, origin-checked
   `postMessage` protocol.
4. Parent DOM, session cookies, WebMCP registration, and unrestricted network access
   remain outside the widget capability set.
5. A widget mutation request becomes a normal `WorkspaceRuntime` command after
   schema and permission validation.
6. State requests from one widget are committed in message order, so a fast
   sequence cannot overwrite an earlier in-flight state transition.
7. Widget failure affects only that block and leaves the rest of the document
   interactive.

## Result

The document surface exposes canonical block source and order. Each derived owner
returns a representation tagged with source revision and renderer/compiler version,
so stale output can be recognized and replaced without becoming content.

## Failure

Parse, render, compile, or widget failure preserves the canonical source and returns
a bounded diagnostic attached to the block. A timed-out compiler process is killed
and publishes no ready artifact. A rejected widget message changes no scene state.

## Executable proof

The process boundary, sanitized renderer, derived compiler cache, real cached-only
Tectonic process, and widget protocol are proved by
[bounded-process.test.ts](tests/bounded-process.test.ts),
[document-rendering.test.ts](tests/document-rendering.test.ts),
[latex-compiler.test.ts](tests/latex-compiler.test.ts),
[tectonic-process-compiler.test.ts](tests/tectonic-process-compiler.test.ts), and
[widget-message.test.ts](tests/widget-message.test.ts). The complete browser and
server path is proved by
[rich-document.test.ts](../../tests/journeys/rich-document.test.ts).

- Double-tap edits the exact block and reload shows the saved source.
- Two devices observe the same source after concurrent valid edits converge.
- Renderer output can be deleted and rebuilt from source.
- Tectonic cannot access the network or exceed configured resource limits.
- A widget cannot read the parent DOM, cookies, or WebMCP API.
- One crashing widget does not break other blocks or page navigation.
