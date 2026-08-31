# Interaction Domain Map

`InkSession` owns active input, `ViewportController` owns camera and gesture
state, and `CanvasSceneRenderer` owns pixels. None owns durable scene meaning.

```text
domains/interaction/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable input, camera, and frame contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing Pencil samples, erasing gestures,
camera transitions, coordinate conversion, or rendering. This domain may depend
only on workspace and surface.
