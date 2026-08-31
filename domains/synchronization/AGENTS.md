# Synchronization Domain Map

`SyncClient` owns browser delivery state. `SyncGateway` owns accepted delivery,
idempotency, committed revisions, and the recovery stream with PostgreSQL.

```text
domains/synchronization/
|-- AGENTS.md                      # This ownership map.
|-- CONTRACT.md                    # Observable delivery and recovery contract.
|-- package.json                   # Protocol, browser, and server entry points.
|-- tsconfig.json                  # Strict cross-runtime compiler boundary.
|-- src/
|   |-- public-protocol.ts         # JSON-safe shared wire records.
|   |-- public-browser.ts          # Deliberate browser-facing exports.
|   |-- public-server.ts           # Deliberate server-facing exports.
|   |-- operation-envelope.ts      # Bounded CRDT update encoding and validation.
|   |-- committed-receipt.ts       # Durable receipt, state, and stream records.
|   |-- operation-journal.ts       # Atomic journal persistence port.
|   |-- postgres-operation-journal.ts # PostgreSQL transaction and recovery log.
|   |-- sync-gateway.ts            # Authorization-bound semantic commit owner.
|   |-- sync-client.ts             # Bootstrap, recovery, outbox, and reconnect order.
|   `-- websocket-sync-transport.ts # Authenticated recovery and live stream.
`-- tests/
    |-- sync-client.test.ts        # Typed rejection and safe local repair proof.
    |-- sync-gateway.test.ts       # Semantic validation and idempotency proof.
    `-- postgres-operation-journal.test.ts # Real transaction and restore proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing protocol records,
acknowledgements, retry, snapshots, or reconnect behavior. This domain may
depend only on workspace, surface, local persistence, and identity.
