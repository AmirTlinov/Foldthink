# Interaction Domain Map

`InkSession` owns active input, `ViewportController` owns the board camera,
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
|   |-- ink-session.ts             # One active physical stroke.
|   |-- gesture-arena.ts           # Single owner of a touch sequence.
|   |-- viewport-controller.ts     # Camera transform and pinch anchor.
|   |-- spatial-workspace-controller.ts # Board, transition, selection, and move feedback.
|   |-- surface-coordinate-map.ts # Screen, board, cover, and page coordinate conversion.
|   |-- workspace-item-arrangement.ts # Drop geometry to ordered stack intent.
|   |-- canvas-scene-renderer.ts   # Scene and active-ink pixels.
|   `-- pointer-intent-adapter.ts  # Pointer Events to domain intent.
`-- tests/
    |-- ink-session.test.ts        # Stroke, anchor, and gesture proof.
    `-- spatial-workspace-controller.test.ts # Entry, movement, and stacking proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing Pencil samples, erasing gestures,
camera transitions, coordinate conversion, or rendering. This domain may depend
only on workspace and surface.
