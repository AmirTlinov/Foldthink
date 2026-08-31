# Interaction Contract

> Domain: active input, viewport state, and visual readout.
>
> Owners: `DrawingToolController`, `InkSession`, `EraseSession`,
> `ViewportController`, `SpatialWorkspaceController`, and `CanvasSceneRenderer`.

## Responsibility split

| Owner | Owned responsibility | State lifetime |
|---|---|---|
| `DrawingToolController` | Selected pen or eraser and its validated pressure policy | Current browser session |
| `InkSession` | One active pen stroke, actual samples, and disposable prediction | One Pencil gesture |
| `EraseSession` | One active eraser path and incrementally intersected stroke IDs | One Pencil gesture |
| `ViewportController` | Board camera transform and pinch anchor | Current browser session |
| `SpatialWorkspaceController` | Selection, move feedback, and board/item transition | Current browser session |
| `CanvasSceneRenderer` | Pixels and reusable stable-frame layers derived from snapshots, active input, and viewport | Current canvas lifetime |

The DOM pointer adapter gives every pointer sequence to one `GestureArena`. The
arena classifies pen or eraser input, object drag, pan, pinch, page turn,
stationary two-finger undo, tap, and double-tap candidates. Once a candidate wins,
that owner keeps the sequence until every participating pointer ends or is
cancelled. Routing contains no durable workspace state.

## GestureArena guarantees

1. One physical pointer sequence has one winning intent owner.
2. Pointer capture follows that owner and `lostpointercapture` has the same cleanup
   consequence as cancellation.
3. `touch-action`, selection, and context-menu behavior are set at the canvas
   boundary rather than repaired by unrelated UI handlers.
4. A second pointer can turn an unclaimed touch sequence into pinch or stationary
   two-finger undo, but cannot steal an already committed Pencil stroke.
5. Every ended or cancelled sequence releases all transient pointer state.

## Drawing guarantees

1. `pointerdown` creates one active gesture with one stable element ID.
2. Real Pointer Events and coalesced events extend the actual point buffer in
   timestamp order.
3. Predicted events may draw ahead for one frame and are discarded when actual
   events arrive. They never enter a command or persistent store.
4. `pointerup` emits exactly one `CommitStroke` or `EraseInk` intent using the
   active ID; there is no second replacement stroke.
5. `pointercancel` removes the active overlay and emits no durable command.
6. Pressure maps from the tool's configured minimum opacity toward its maximum; a
   device without pressure uses a defined neutral value.
7. Eraser geometry is hit-tested incrementally through a surface-local spatial
   index and produces one pressure-sized `EraseMask` naming the strokes it crosses.
8. Two stationary fingers emit one inverse operation on tap, then repeat at a
   bounded cadence while held. Finger travel hands the sequence to pinch instead.

## Viewport and spatial workspace guarantees

1. Camera state is local and never enters a `SceneDocument` update.
2. A pinch keeps its initial world-space focal point beneath the same finger-space
   point throughout the gesture.
3. Notebook entry follows one continuous
   `board -> entering(item, progress) -> item` state machine.
4. Hysteresis separates entry and exit thresholds, and every ended gesture settles
   into `board` or `item`.
5. A double-tap on an item performs the explicit open action.
6. A tap on empty board space clears item selection.
7. A held selected item gains one lifted move preview; dropping over another item
   emits one ordered stack change, while dropping in free space removes prior
   stack membership.
8. In an open document, a stationary finger or mouse double-tap resolves one page
   coordinate for the document editor; Pencil remains owned by drawing.

## CanvasSceneRenderer guarantees

1. React is outside the per-sample ink path.
2. The active stroke and durable stroke share one geometry lifecycle and one ID.
   The durable element becomes visible before the active overlay is cleared.
3. A stable frame is cached below active pen pixels, so a Pencil sample does not
   redraw the board, pages, text, and every committed stroke.
4. Ink and eraser masks are composed per affected stroke on a transparent layer
   above the page material. An old mask never erases a later or unrelated stroke.
5. Canvas backing dimensions track CSS size and `devicePixelRatio` through
   `ResizeObserver`.
6. Resize reallocates the backing store and rerenders semantic content instead of
   stretching old pixels.
7. Page material and semantic page content use one canonical transform, so resize
   cannot detach ink from its five-millimeter grid.
8. The renderer reads snapshots and emits pixels; it never edits domain state.
9. A stable open document publishes its exact page transform and leaves rich
   document blocks to the DOM renderer, while ink and page material remain canvas
   owned.

## Failure

A lost or cancelled gesture clears transient input while leaving durable content
unchanged. A renderer failure can drop a frame but cannot change the scene. An
invalid camera transition settles at the nearest stable endpoint and reports a
diagnostic event.

## Executable proof

Implemented by [drawing-tool-controller.test.ts](tests/drawing-tool-controller.test.ts),
[erase-session.test.ts](tests/erase-session.test.ts),
[ink-geometry.test.ts](tests/ink-geometry.test.ts),
[ink-session.test.ts](tests/ink-session.test.ts),
[page-grid.test.ts](tests/page-grid.test.ts), and
[spatial-workspace-controller.test.ts](tests/spatial-workspace-controller.test.ts).

- One physical stroke yields one durable `InkStroke` with no replacement flash.
- Predicted samples never appear in serialized geometry.
- Pencil pressure changes opacity between the configured minimum and maximum.
- Partial erasure and its inverse survive reload and reconnect.
- A pinch anchor remains fixed within an explicit pixel tolerance.
- Every cancelled or ended transition reaches a stable board or item state.
- Resize and `devicePixelRatio` changes preserve semantic geometry and proportions.
- Competing touch candidates produce exactly one pan, pinch, page turn, or undo
  command for each decided sequence.

The complete browser path, including Pencil pressure, partial erasure, resize,
reload, quick two-finger undo, and held repeat, is proved by
[professional-ink.test.ts](../../tests/journeys/professional-ink.test.ts).
