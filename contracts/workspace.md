# Workspace Contract

> Domain: semantic workspace mutation.
>
> Owner: `WorkspaceRuntime`.

## Responsibility

`WorkspaceRuntime` is the only owner allowed to turn user or agent intent into a
semantic workspace mutation. Pencil adapters, gesture adapters, React, WebMCP, and
network replay enter through its public methods.

## Owned state

`WorkspaceRuntime` owns the in-memory registry of loaded `SceneDocument` instances,
the current command transaction, and the relationship between one command and one
`CommandReceipt`. Durable scene content remains owned by `SceneDocument`; delivery
state remains owned by `LocalWorkspaceStore` and the synchronization domain.

## Accepted input

Local adapters call:

```text
dispatch(CommandIntent) -> CommandReceipt
```

`CommandIntent` contains a typed payload and the IDs needed to identify its target.
The runtime assigns the durable `operationId`, local origin, and affected surfaces.
The server later binds the authenticated session as the committed actor. An adapter
may provide a stable invocation key for retry, but it does not create a second
operation lifecycle.

The synchronization adapter calls:

```text
acceptRemoteUpdate(CommittedUpdate) -> AppliedRemoteReceipt
```

A remote update is applied as an already committed update. It is not redispatched
as local intent.

## Guarantees

1. One accepted local intent produces one local scene transaction and one
   `operationId`.
2. Every touched element belongs to a declared surface in the current workspace.
3. Domain invariants are checked before any render snapshot is published.
4. A multi-surface command is visible locally as one transition.
5. `changedIds` names the semantic records changed by that transition.
6. The runtime passes the resulting update to `LocalWorkspaceStore` before it
   reports the command as locally durable.
7. Remote replay changes the scene without creating a new outgoing operation.
8. Undo creates a new inverse semantic operation for the current actor; it does not
   rewrite acknowledged history.

## Result

```text
CommandReceipt
|-- operationId
|-- changedIds[]
|-- surfaces[]
|   |-- surfaceId
|   `-- revision?
`-- syncState           # local | queued | committed
```

The local path returns `local` or `queued`. The synchronization domain attaches
server revisions and advances the same receipt to `committed`.

## Failure

Validation failure leaves every scene unchanged and returns a typed domain error.
Local persistence failure leaves the operation visibly unsaved and returns no
`queued` or `committed` claim. A remote update that fails validation is quarantined
by the synchronization domain and does not enter the loaded scene.

## Executable proof

- The same valid command produces the same semantic element changes from the same
  starting state.
- An invalid command changes no surface and publishes no render snapshot.
- A multi-surface notebook creation appears completely or not at all.
- Applying a remote update produces no outbox record.
- Repeating a stable invocation key returns the existing operation receipt.
