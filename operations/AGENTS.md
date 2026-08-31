# Operations Map

Operations owns release identity, migration execution, health, offsite backup,
and clean restore proof.

```text
operations/
|-- AGENTS.md          # This ownership map.
|-- CONTRACT.md        # Observable release and recovery contract.
|-- .env.example       # Public names and shapes of required deployment inputs.
|-- compose.yaml       # Private data network and ordered production topology.
|-- release/
|   |-- build-release.mjs # Exact-revision artifact and manifest builder.
|   `-- Dockerfile        # Pinned application, Caddy, and cached LaTeX image.
|-- caddy/
|   `-- Caddyfile         # Public TLS, application routing, CSP, and private metrics boundary.
|-- postgres/
|   |-- Dockerfile           # Pinned PostgreSQL and pgBackRest runtime.
|   |-- configure-archive.sh # WAL archive configuration at first initialization.
|   `-- pgbackrest.conf      # Stanza, compression, spool, and process bounds.
|-- backup/
|   |-- prime-backup.sh      # Stanza check and first full backup gate.
|   |-- run-backup.sh        # Full/diff/incremental backup and evidence writer.
|   |-- run-scheduler.sh     # Bounded recurring incremental backup loop.
|   `-- check-freshness.sh   # Latest successful backup age gate.
|-- restore/
|   `-- restore-postgres.sh  # Refuse-in-place and clean-volume restore mechanism.
|-- synthetic/
|   `-- workspace-recovery-probe.mts # HTTP, WebSocket, CRDT, asset, and deletion proof.
`-- court/
    |-- compose.yaml             # Isolated deterministic storage for the recovery court.
    `-- run-release-court.sh     # Build, destroy, restore, verify, and evidence owner.
```

Read [CONTRACT.md](CONTRACT.md) before changing deployment or recovery. Runtime
configuration and runbooks appear here only with the executable mechanism they
operate and the proof that verifies it.
