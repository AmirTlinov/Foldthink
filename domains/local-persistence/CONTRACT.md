# Local Persistence Contract

> Domain: browser durability and offline delivery.
>
> Owner: `LocalWorkspaceStore`.

## Responsibility

`LocalWorkspaceStore` owns the browser's durable workspace replica and the queue of
operations awaiting server acknowledgement. IndexedDB is its storage mechanism;
other domains use its methods rather than opening the database directly.

## Owned state

The conceptual IndexedDB stores are:

| Store | Owned records |
|---|---|
| `workspace_meta` | Local workspace identity, schema version, and bootstrap state |
| `surface_state` | Last valid local snapshot and subsequent updates per surface |
| `outbox` | Durable operation envelopes ordered for delivery |
| `receipts` | Latest local or committed receipt per `operationId` |

The exact physical stores may be combined when one IndexedDB transaction can still
prove the same atomic boundary.

## Accepted input

```text
commitLocal(operation, surfaceUpdates, localReceipt)
acknowledge(operationId, committedReceipt)
loadWorkspace(workspaceId)
remapBootstrapWorkspace(oldId, newId)
```

Only `WorkspaceRuntime` submits a local semantic operation. Only `SyncClient`
submits a server acknowledgement.

## Guarantees

1. A local commit writes surface updates, the outbox envelope, and the local receipt
   in one IndexedDB transaction.
2. The operation becomes `queued` only after that transaction completes.
3. Reload reconstructs the last valid local scene before network synchronization
   begins.
4. Outbox iteration is stable and returns every unacknowledged operation at least
   once.
5. Acknowledgement stores the committed receipt and removes the matching outbox
   record in one transaction.
6. Repeating an acknowledgement is harmless and preserves the highest known
   revisions.
7. Bootstrap ID remapping changes every local reference atomically before the first
   remote send.
8. IndexedDB schema migration either opens the new complete schema or leaves the
   previous schema readable by the recovery path.

## Result

`commitLocal` returns a `queued` receipt. `acknowledge` returns the stored
`committed` receipt. `loadWorkspace` returns a consistent set of surface snapshots,
later updates, outbox operations, and receipts from one known schema version.

## Failure

Quota exhaustion, blocked upgrade, transaction abort, or corrupt record produces a
typed storage error and an explicit unsaved state. The UI may keep the current
in-memory drawing visible, but it presents no durable claim until a local commit
succeeds. Recovery preserves the last valid snapshot and quarantines the corrupt
record for diagnostics.

## Executable proof

- A forced crash at every IndexedDB transaction boundary yields either the complete
  operation or the previous state.
- Reload while offline reconstructs the scene and retains every outbox operation.
- Repeated acknowledgements leave one receipt and no outbox duplicate.
- A quota failure never produces a `queued` receipt.
- A bootstrap remap leaves no reference to the old workspace ID.
