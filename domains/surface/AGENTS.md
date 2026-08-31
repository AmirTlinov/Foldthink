# Surface Domain Map

`SceneDocument` owns durable scene content, local geometry, and CRDT meaning.
This is the only domain allowed to import or interpret Yjs.

```text
domains/surface/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable scene-state contract.
|-- package.json # Surface package boundary and proof commands.
|-- tsconfig.json
|-- src/
|   |-- public.ts            # Exported semantic surface API.
|   |-- scene-document.ts    # Yjs-backed owner of one surface.
|   |-- scene-element.ts     # Versioned element meaning and validation.
|   `-- surface-snapshot.ts  # Immutable readout and mutation result.
`-- tests/
    `-- scene-document.test.ts # Convergence and reconstruction proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing scene elements, erasure facts,
coordinates, or convergence. This domain imports no other Foldthink domain.
