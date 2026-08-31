# Operations Contract

> Domain: deployment, database evolution, health, backup, and recovery.
>
> Owners: the release process, Caddy, PostgreSQL, pgBackRest, and the restore drill.

## Responsibility split

| Owner | Responsibility |
|---|---|
| Caddy | TLS termination, static PWA, same-origin API, and WebSocket routing |
| Release builder | Exact source revision, immutable artifact, migration order, and manifest |
| PostgreSQL | Primary durable state and transaction integrity |
| pgBackRest | WAL archiving and full/incremental offsite backups |
| Release court | Browser journeys plus evidence that a clean system recovers real workspace state |

The operations domain protects and verifies PostgreSQL; it does not become another
semantic writer of workspace records.

## Deployment contract

```text
Internet -> Caddy -> Foldthink app -> PostgreSQL
                         |                |
                         v                v
                    asset bucket    pgBackRest bucket
```

1. Caddy terminates public HTTPS, redirects public HTTP, and routes `/api`,
   `/sync`, `/health`, and `/ready` to the application.
2. PostgreSQL listens on the private deployment network rather than the public
   interface.
3. The deployed application reports its exact source commit and schema version.
4. Configuration and secrets enter through the deployment environment and remain
   outside images, source control, logs, and client bundles.
5. One release uses one immutable application artifact across migration, app,
   edge, and verification. Its OCI label, embedded manifest, health response, and
   requested revision must agree exactly.
6. `/internal/metrics` stays on the private application boundary; Caddy returns
   `404` for that public path.

## Migration contract

1. Migrations have a total order and a unique recorded identity.
2. The release process tests the full chain against a clean database and a copy at
   the previous supported schema.
3. A migration that changes persisted protocol data ships with the compatible
   reader, writer, and recovery procedure.
4. The application readiness check stays false while required migrations are
   missing or incompatible.
5. Destructive cleanup follows a proven replacement reader and a successful backup.

## Backup and restore contract

1. pgBackRest sends full/incremental backups and WAL to an S3 repository outside
   the VPS, encrypted with an independent repository secret.
2. Every successful backup records its label, completion time, start and stop WAL,
   and the greatest archived WAL segment in one atomic evidence file.
3. A restore drill starts with a clean PostgreSQL instance and only documented
   backup inputs.
4. The drill restores to a declared recovery target, starts the application, opens
   a known workspace, and verifies a known revision and asset reference.
5. Measured recovery point and recovery time are recorded as evidence, not inferred
   from backup-file presence.
6. Public release readiness requires a successful exact-revision release court;
   the running backup monitor separately rejects a newest backup older than its
   configured freshness window.
7. The asset recovery policy protects ready object bytes independently of the
   database backup, and the drill verifies the checksum of a referenced asset.

## Health and observability contract

| Signal | Owner and meaning |
|---|---|
| Public health | Application process event loop is alive and names its exact revision |
| Public readiness | Schema identity matches the artifact and a bounded PostgreSQL query succeeds |
| Internal request p50/p95/p99 | `ServiceObserver` reports bounded in-memory latency samples |
| Internal commit acknowledgement p50/p95/p99 | Durable operation route latency |
| Internal WebSockets | Transport reports active, accepted, and rejected connections |
| Backup evidence | pgBackRest label, completion time, and WAL range |
| Release-court evidence | Exact revision, clean restore time, operation revision, and asset checksum |

Request logs contain a bounded request ID, method, route template, status,
duration, revision, and error class where relevant. Route templates deliberately
exclude workspace, operation, asset, user-content, and secret values.

## Failure

A failed migration stops the dependent services before readiness. A failed backup
or stale backup fails the backup gate. A failed clean restore invalidates
recoverability claims until the release court passes again.

## Executable proof

Run the complete proof from a clean checkout with:

```sh
pnpm verify:production
```

The court builds the exact commit, starts the Compose topology, checks the public
boundary, runs every external browser journey, and writes one real workspace
operation and verified asset. It then takes an incremental backup, stops the
application, deletes the PostgreSQL data volume, restores a new volume, and proves
the same CRDT revision through HTTP and WebSocket plus the same object checksum.
Only after those checks does it write `dist/operations/release-court.json` and
delete the temporary workspace.

The court uses an isolated POSIX pgBackRest repository so the proof is deterministic
and disposable. The production topology in `compose.yaml` keeps pgBackRest on the
configured offsite S3 repository; the court overlay does not redefine that public
deployment decision.
