# Synchronization Contract

> Domain: live collaboration and durable cross-device delivery.
>
> Owners: `SyncClient`, `SyncGateway`, and PostgreSQL.

## Responsibility split

| Owner | Responsibility |
|---|---|
| `SyncClient` | Connection lifecycle, live messages, outbox retries, acknowledgements, and reconnect order |
| `SyncGateway` | Authorization, protocol validation, room materialization, transaction submission, and broadcast |
| PostgreSQL | Idempotency record, ordered surface revisions, accepted updates, snapshots, and receipts |

## Protocol records

A durable operation envelope contains:

```text
OperationEnvelope
|-- protocolVersion
|-- operationId
|-- workspaceId
|-- commandKind
|-- changedIds[]
|-- createSurfaces[]?
`-- updates[]
    |-- surfaceId
    `-- crdtPayload
```

A committed receipt contains:

```text
CommittedReceipt
|-- operationId
|-- changedIds[]
`-- surfaces[]
    |-- surfaceId
    `-- revision
```

A live message contains `workspaceId`, `surfaceId`, `strokeId`, an increasing
sequence number, and ephemeral actual samples. It contains no durable operation.

`actorSessionId` is server-derived authorization metadata on the accepted database
record. The client envelope cannot choose the committed actor.

## SyncClient guarantees

1. One workspace uses one ordered durable send queue per browser session.
2. Reconnect fetches committed state before flushing the local outbox. Fetched
   state merges into the local replica and never replaces unacknowledged local work
   wholesale.
3. Every retry preserves the original `operationId` and envelope bytes.
4. An outbox record remains until its committed receipt is stored locally.
5. Live chunks may be dropped, reordered by sequence number, or replaced by the
   final durable element without affecting durable state.
6. Connection backoff is bounded and resets after a healthy acknowledged exchange.

## SyncGateway guarantees

1. Every request is bound to the authenticated session and authorized workspace
   role before payload validation.
2. Protocol version, size limits, declared surfaces, and core schemas are checked
   before persistence.
3. The CRDT payload is applied to a validation copy of materialized room state, and
   domain invariants pass before commit.
4. One accepted operation creates one `workspace_operations` record.
5. Declared surface creation, all surface updates, per-surface revision increments,
   and the receipt commit in one PostgreSQL transaction.
6. Broadcast happens only after the transaction commits.
7. Repeating an accepted `operationId` returns the original committed receipt and
   performs no second mutation.
8. Each surface revision increases strictly among committed updates for that
   surface.

## Snapshot and recovery guarantees

1. A snapshot declares the exact surface revision it includes.
2. Snapshot plus updates after that revision reconstructs the accepted CRDT state.
3. Compaction publishes a complete new snapshot before eligible old updates are
   removed.
4. Deletion and erasure facts remain in the compact state.
5. A stale client merges through CRDT updates and cannot replace a newer server
   snapshot wholesale.

## Failure

Authorization or validation failure commits nothing and returns a typed rejection.
Database failure broadcasts nothing and leaves the outbox queued. A disconnected
live stream removes its remote preview after a timeout. A protocol version mismatch
stops durable replay and returns the supported version range without rewriting
local data.

## Executable proof

- Two browser contexts converge after reordered live traffic and durable replay.
- Retrying one operation concurrently produces one database operation and one set
  of surface revisions.
- A database failure between every transaction step produces no partial notebook.
- Offline edit, reconnect, state fetch, and outbox flush preserve both local and
  remote valid work.
- Snapshot compaction followed by stale-client reconnect preserves deletion.
- A broadcast is never observed before its operation is readable from PostgreSQL.
