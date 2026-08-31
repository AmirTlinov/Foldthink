# Agent Integration Domain Map

`WebMCPAdapter` owns translation between typed WebMCP tools and existing
Foldthink commands or read-only snapshots. It never becomes another mutation
owner.

```text
domains/agent-integration/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable agent inspection and mutation contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing tool schemas, receipts, or agent
inspection. This domain may depend only on workspace, surface, and interaction.
