# Interaction Domain Map

`DrawingToolController` owns drawing policy, `InkSession` and `EraseSession`
own one active physical mark, `ViewportController` owns the board camera,
`SpatialWorkspaceController` owns transient board/item state, and
`CanvasSceneRenderer` owns pixels. None owns durable scene meaning.

```text
domains/interaction/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable input, camera, and frame contract.
|-- package.json # Browser interaction package and proof commands.
|-- tsconfig.json
|-- src/
|   |-- public-browser.ts          # Exported browser interaction API.
|   |-- drawing-tool-controller.ts # Selected pen or eraser and validated settings.
|   |-- ink-session.ts             # One active physical stroke.
|   |-- erase-session.ts           # One active geometric erase mask.
|   |-- ink-geometry.ts            # Pressure curves and exact segment distance.
|   |-- ink-spatial-index.ts       # Bounded geometric eraser candidate lookup.
|   |-- gesture-arena.ts           # Single owner of a touch sequence.
|   |-- viewport-controller.ts     # Camera transform and pinch anchor.
|   |-- spatial-workspace-controller.ts # Board, transition, selection, and move feedback.
|   |-- surface-coordinate-map.ts # Screen, board, cover, and page coordinate conversion.
|   |-- page-grid.ts               # Canonical five-millimeter page rhythm.
|   |-- workspace-item-arrangement.ts # Drop geometry to ordered stack intent.
|   |-- canvas-scene-renderer.ts   # Scene and active-ink pixels.
|   `-- pointer-intent-adapter.ts  # Pointer Events to domain intent.
`-- tests/
    |-- drawing-tool-controller.test.ts # Immutable drawing-policy proof.
    |-- erase-session.test.ts      # Partial geometric erasure proof.
    |-- ink-geometry.test.ts       # Pressure and intersection proof.
    |-- ink-session.test.ts        # Actual versus predicted sample proof.
    |-- page-grid.test.ts          # Five-millimeter grid proof.
    `-- spatial-workspace-controller.test.ts # Entry, movement, and stacking proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing Pencil samples, erasing gestures,
camera transitions, coordinate conversion, or rendering. This domain may depend
only on workspace and surface.
