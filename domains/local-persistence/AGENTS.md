# Local Persistence Domain Map

`LocalWorkspaceStore` owns the IndexedDB replica, durable local updates, and the
outgoing operation queue.

```text
domains/local-persistence/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable reload and offline-delivery contract.
|-- package.json # Browser persistence package and proof commands.
|-- tsconfig.json
|-- src/
|   |-- public-browser.ts         # Exported browser persistence API.
|   |-- local-workspace-store.ts  # IndexedDB transaction owner.
|   `-- indexeddb-schema.ts       # Versioned durable record shapes.
`-- tests/
    `-- local-workspace-store.test.ts # Atomic commit and acknowledgement proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing local transactions, recovery, or
outbox removal. This domain may depend only on workspace and surface.
