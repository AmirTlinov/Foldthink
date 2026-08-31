# Workspace Domain Map

`WorkspaceRuntime` owns semantic commands, invariant checks, and command
receipts. Every interface adapter reaches durable meaning through this owner.

```text
domains/workspace/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable semantic-mutation contract.
```

Read [CONTRACT.md](CONTRACT.md) before adding a command or changing its result.
This domain may depend only on surface.
