# Interaction Contract

> Domain: active input, viewport state, and visual readout.
>
> Owners: `InkSession`, `ViewportController`, and `CanvasSceneRenderer`.

## Responsibility split

| Owner | Owned responsibility | State lifetime |
|---|---|---|
| `InkSession` | The active pen or eraser gesture and its actual samples | One pointer gesture |
| `ViewportController` | Camera transform, selection, pinch focus, and board/item transition | Current browser session |
| `CanvasSceneRenderer` | Pixels derived from scene snapshots, active input, and viewport | One rendered frame |

The DOM pointer adapter routes Pencil input to `InkSession` and finger gestures to
`ViewportController`. Routing contains no durable workspace state.

## InkSession guarantees

1. `pointerdown` creates one active gesture with one stable element ID.
2. Real Pointer Events and coalesced events extend the actual point buffer in
   timestamp order.
3. Predicted events may draw ahead for one frame and are discarded when actual
   events arrive. They never enter a command or persistent store.
4. `pointerup` emits exactly one `CommitStroke` or `EraseInk` intent using the same
   active ID.
5. `pointercancel` removes the active overlay and emits no durable command.
6. Pressure maps from the tool's configured minimum opacity toward its maximum; a
   device without pressure uses a defined neutral value.
7. Eraser geometry is hit-tested in surface-local coordinates and produces an
   `EraseMask`, not whole-element deletion.

## ViewportController guarantees

1. Camera state is local and never enters a `SceneDocument` update.
2. A pinch keeps its initial world-space focal point beneath the same finger-space
   point throughout the gesture.
3. Notebook entry follows one continuous
   `board -> entering(item, progress) -> item` state machine.
4. Hysteresis separates entry and exit thresholds, and every ended gesture settles
   into `board` or `item`.
5. A double-tap on an item performs the explicit open action.
6. A tap on empty board space clears item selection.

## CanvasSceneRenderer guarantees

1. React is outside the per-sample ink path.
2. The active stroke and durable stroke share one geometry lifecycle and one ID.
   The durable element becomes visible before the active overlay is cleared.
3. Ink and eraser masks are composed on a transparent layer above the page
   material, preserving the grid.
4. Canvas backing dimensions track CSS size and `devicePixelRatio` through
   `ResizeObserver`.
5. Resize reallocates the backing store and rerenders semantic content instead of
   stretching old pixels.
6. The renderer reads snapshots and emits pixels; it never edits domain state.

## Failure

A lost or cancelled gesture clears transient input while leaving durable content
unchanged. A renderer failure can drop a frame but cannot change the scene. An
invalid camera transition settles at the nearest stable endpoint and reports a
diagnostic event.

## Executable proof

- One physical stroke yields one durable `InkStroke` with no replacement flash.
- Predicted samples never appear in serialized geometry.
- Pencil pressure changes opacity between the configured minimum and maximum.
- Partial erasure survives reload and remains absent after reconnect.
- A pinch anchor remains fixed within an explicit pixel tolerance.
- Every cancelled or ended transition reaches a stable board or item state.
- Resize and `devicePixelRatio` changes preserve semantic geometry and proportions.
