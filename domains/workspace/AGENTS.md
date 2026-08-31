# Workspace Domain Map

`WorkspaceRuntime` owns semantic commands, invariant checks, and command
receipts. Every interface adapter reaches durable meaning through this owner.

```text
domains/workspace/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable semantic-mutation contract.
|-- package.json # Workspace package boundary and proof commands.
|-- tsconfig.json
|-- src/
|   |-- public.ts                # Exported command and runtime API.
|   |-- workspace-runtime.ts     # Sole coordinator of semantic intent.
|   |-- workspace-command.ts     # Typed command and local operation records.
|   |-- command-receipt.ts       # Observable operation result.
|   `-- workspace-commit-sink.ts # Persistence port owned by the runtime boundary.
`-- tests/
    `-- workspace-runtime.test.ts # Atomic visibility and failure proof.
```

Read [CONTRACT.md](CONTRACT.md) before adding a command or changing its result.
This domain may depend only on surface.
