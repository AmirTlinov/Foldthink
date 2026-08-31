# Asset Domain Map

`AssetRegistry` owns asset authorization, lifecycle, metadata, verification, and
scoped retrieval. Object storage owns the immutable bytes.

```text
domains/asset/
|-- AGENTS.md    # This ownership map.
|-- CONTRACT.md  # Observable asset-lifecycle contract.
```

Read [CONTRACT.md](CONTRACT.md) before changing upload capabilities, checksums,
readiness, or retrieval. This domain may depend only on identity.
