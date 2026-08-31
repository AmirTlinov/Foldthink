# Surface Domain Map

`SceneDocument` owns durable scene content, local geometry, and CRDT meaning.
This is the only domain allowed to import or interpret Yjs.

```text
domains/surface/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable scene-state contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing scene elements, erasure facts,
coordinates, or convergence. This domain imports no other Foldthink domain.
