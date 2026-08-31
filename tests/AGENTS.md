# Cross-Domain Test Map

A domain behavior test lives beside its owner under `domains/<domain>/tests/`.
This root test area is reserved for journeys that cross real ownership
boundaries, such as browser-to-server synchronization and clean restore.

```text
tests/
|-- AGENTS.md    # Current cross-domain proof map.
`-- journeys/
    |-- first-stroke-offline-reload.test.ts # PWA, canvas, and IndexedDB journey.
    |-- professional-ink.test.ts             # Pressure, geometric erasing, resize, and undo journey.
    |-- rich-document.test.ts                # Markdown, LaTeX, widget, asset, and linked-device journey.
    |-- spatial-notebook-workspace.test.ts # Item, cover, page, stack, and deletion journey.
    |-- webmcp-shared-runtime.test.ts        # Agent patch and visible-page journey.
    |-- workspace-deletion.test.ts           # Active purge, local reset, tombstone, and object cleanup journey.
    `-- two-device-sync.test.ts              # Anonymous link, live delivery, and reload journey.
```

A test name describes the observed scenario rather than an implementation layer.
The first cross-domain journey creates its test directory and harness in the same
change; placeholder suites do not live here.
