# Agent Integration Domain Map

`WebMCPAdapter` owns translation between typed WebMCP tools and existing
Foldthink commands or read-only snapshots. It never becomes another mutation
owner.

```text
domains/agent-integration/
|-- AGENTS.md                         # This ownership map.
|-- CONTRACT.md                       # Observable agent inspection and mutation contract.
|-- package.json                      # Browser entry point and domain dependencies.
|-- tsconfig.json                     # Browser API and strict compiler boundary.
|-- src/
|   |-- public-browser.ts             # Deliberate browser-facing exports.
|   |-- site-tool-schema.ts           # Published tool input and browser API shapes.
|   |-- inspect-current-surface-tool.ts # Bounded semantic readout.
|   |-- apply-surface-patch-tool.ts   # Validated command translation.
|   `-- webmcp-adapter.ts             # Top-level registration and live page context.
`-- tests/
    `-- webmcp-adapter.test.ts        # Progressive enhancement and one-runtime proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing tool schemas, receipts, or agent
inspection. This domain may depend only on workspace, surface, and interaction.
