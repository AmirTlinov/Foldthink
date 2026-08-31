# Local Persistence Domain Map

`LocalWorkspaceStore` owns the IndexedDB replica, durable local updates, and the
outgoing operation queue.

```text
domains/local-persistence/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable reload and offline-delivery contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing local transactions, recovery, or
outbox removal. This domain may depend only on workspace and surface.
