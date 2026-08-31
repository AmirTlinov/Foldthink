# Asset Domain Map

`AssetRegistry` owns asset authorization, lifecycle, metadata, verification, and
scoped retrieval. Object storage owns the immutable bytes.

```text
domains/asset/
|-- AGENTS.md     # This ownership map.
|-- CONTRACT.md   # Observable asset-lifecycle contract.
|-- package.json  # Protocol, browser, and server entry points.
|-- tsconfig.json # Strict browser/server compiler boundary.
|-- src/
|   |-- public-protocol.ts       # Stable asset records and failures.
|   |-- asset-record.ts          # Asset lifecycle values and bounded errors.
|   |-- public-browser.ts        # Browser upload and retrieval API.
|   |-- public-server.ts         # Server registry and object-store adapters.
|   |-- asset-client.ts          # Reserve, upload, finalize, and read sequence.
|   |-- asset-registry.ts        # Authorized lifecycle and checksum owner.
|   |-- asset-store.ts           # Durable metadata boundary.
|   |-- postgres-asset-store.ts  # PostgreSQL metadata implementation.
|   |-- asset-object-store.ts    # Immutable byte-store boundary.
|   |-- filesystem-object-store.ts # Local and verification byte store.
|   `-- s3-object-store.ts       # S3/R2 production byte store.
`-- tests/
    `-- asset-registry.test.ts   # Lifecycle, verification, and isolation proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing upload capabilities, checksums,
readiness, or retrieval. This domain may depend only on identity.
