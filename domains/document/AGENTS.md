# Document Domain Map

Editable source owns document meaning. `DocumentRenderer`, `LatexCompiler`, and
`WidgetHost` own separate rebuildable readouts and isolated execution.

```text
domains/document/
|-- AGENTS.md                 # This ownership map.
|-- CONTRACT.md               # Observable source, rendering, and widget contract.
|-- package.json              # Protocol, browser, and server entry points.
|-- tsconfig.json             # Strict mixed browser/server compiler boundary.
|-- src/
|   |-- public-protocol.ts          # Compilation result and bounded failures.
|   |-- document-protocol.ts        # Compilation values and document errors.
|   |-- public-browser.ts           # Browser types and lazy capability loaders.
|   |-- document-renderer-entry.ts  # Lazily loaded readout and KaTeX styles.
|   |-- block-editor-entry.ts       # Lazily loaded editor and its styles.
|   |-- public-server.ts            # Restricted compiler API.
|   |-- markdown-pipeline.ts        # Sanitized Markdown, GFM, and math readout.
|   |-- block-editor.ts             # One explicit CodeMirror source session.
|   |-- document-renderer.ts        # DOM projection of canonical blocks.
|   |-- latex-compilation-client.ts # Browser-to-server compilation adapter.
|   |-- latex-compiler.ts           # Derived artifact identity and publication.
|   |-- tectonic-process-compiler.ts # Cached-only Tectonic and SVG pages.
|   |-- bounded-process.ts          # Time and output process boundary.
|   |-- widget-host.ts              # Opaque-origin iframe capability host.
|   |-- widget-message.ts           # Versioned widget message validation.
|   |-- document-style-import.ts    # CSS side-effect import declaration.
|   `-- document.css                # Document projection and editing surface.
`-- tests/
    |-- bounded-process.test.ts    # Time and output limit distinction proof.
    |-- document-rendering.test.ts  # Sanitization and math proof.
    |-- latex-compiler.test.ts      # Derivation reuse and process bounds.
    |-- tectonic-process-compiler.test.ts # Real cached untrusted compiler proof.
    `-- widget-message.test.ts      # Channel and protocol proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing Markdown, LaTeX, compilation,
document layout, or widget messages. This domain may depend only on workspace,
surface, and asset.
