# Synchronization Domain Map

`SyncClient` owns browser delivery state. `SyncGateway` owns accepted delivery,
idempotency, committed revisions, and the recovery stream with PostgreSQL.

```text
domains/synchronization/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable delivery and recovery contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing protocol records,
acknowledgements, retry, snapshots, or reconnect behavior. This domain may
depend only on workspace, surface, local persistence, and identity.
