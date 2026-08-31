# Surface Model Contract

> Domain: durable workspace content.
>
> Owner: `SceneDocument`.

## Responsibility

`SceneDocument` owns the durable semantic content of one surface. It represents a
workspace manifest, board, notebook manifest, cover, page, or document as a Yjs
document behind a domain API.

## Owned state

The owner stores element identity, element kind, surface-local geometry, content,
style, ordering, and CRDT deletion state. The workspace manifest additionally owns
item transforms, z-order, and stack membership. A notebook manifest owns cover and
ordered page references.

Camera state, window dimensions, pointer samples in progress, rendered pixels, and
server delivery state belong to other owners.

## Accepted input

`SceneDocument` accepts a validated transaction from `WorkspaceRuntime` or a
validated committed update from the synchronization domain. Its public API exposes
semantic operations rather than raw mutable Yjs collections.

The primitive records are:

```text
InkStroke | EraseMask | MarkdownBlock | LatexBlock | Shape | Widget
```

## Guarantees

1. Every element has a stable opaque ID unique within its surface.
2. Durable geometry is expressed only in surface-local coordinates.
3. Every record matches the versioned schema for its element kind.
4. A cover's ink remains a child of the cover surface transform.
5. An `EraseMask` records its path and affected stroke IDs, so partial erasure is
   deterministic and undoable.
6. Deletion is a CRDT fact included in snapshots and updates.
7. Applying concurrent valid updates in any delivery order converges to the same
   semantic scene.
8. A read snapshot is immutable from the consumer's point of view.
9. Yjs remains an internal representation; adapters cannot mutate it directly.

## Result

A successful transaction produces an immutable scene snapshot for rendering and a
bounded CRDT update for local persistence. The snapshot exposes semantic elements,
surface revision knowledge, and the spatial-index inputs needed by read-only
consumers.

## Failure

An invalid element kind, cross-workspace reference, duplicate ID, malformed
geometry, or schema violation leaves the document at its previous valid state. A
failed snapshot decode never replaces the last valid local snapshot.

## Executable proof

- Property tests reorder and duplicate updates and obtain an equal semantic scene.
- Snapshot plus later updates reconstructs the exact surface state.
- Delete and erase remain absent after stale-client reconnect.
- Moving and scaling a notebook keeps cover ink attached to the cover.
- Camera and window resize never change serialized surface bytes.
