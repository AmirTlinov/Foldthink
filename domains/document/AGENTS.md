# Document Domain Map

Editable source owns document meaning. `DocumentRenderer`, `LatexCompiler`, and
`WidgetHost` own separate rebuildable readouts and isolated execution.

```text
domains/document/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable source, rendering, and widget contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing Markdown, LaTeX, compilation,
document layout, or widget messages. This domain may depend only on workspace,
surface, and asset.
