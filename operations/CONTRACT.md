# Operations Contract

> Domain: deployment, database evolution, health, backup, and recovery.
>
> Owners: the release process, Caddy, PostgreSQL, pgBackRest, and the restore drill.

## Responsibility split

| Owner | Responsibility |
|---|---|
| Caddy | TLS termination, static PWA, same-origin API, and WebSocket routing |
| Release process | Exact source revision, build artifact, migration order, and rollout result |
| PostgreSQL | Primary durable state and transaction integrity |
| pgBackRest | WAL archiving and full/incremental offsite backups |
| Restore drill | Evidence that a clean system can recover real workspace state |

The operations domain protects and verifies PostgreSQL; it does not become another
semantic writer of workspace records.

## Deployment contract

```text
Internet -> Caddy -> Foldthink app -> PostgreSQL
                         |                |
                         v                v
                    asset bucket    pgBackRest bucket
```

1. Caddy exposes only HTTPS and routes `/api` and `/sync` to the application.
2. PostgreSQL listens on the private deployment network rather than the public
   interface.
3. The deployed application reports its exact source commit and schema version.
4. Configuration and secrets enter through the deployment environment and remain
   outside images, source control, logs, and client bundles.
5. One release uses one immutable application artifact across migration check,
   rollout, and verification.

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

1. pgBackRest sends base/incremental backups and WAL to storage outside the VPS.
2. Monitoring records the last successful backup and last archived WAL segment.
3. A restore drill starts with a clean PostgreSQL instance and only documented
   backup inputs.
4. The drill restores to a declared recovery target, starts the application, opens
   a known workspace, and verifies a known revision and asset reference.
5. Measured recovery point and recovery time are recorded as evidence, not inferred
   from backup-file presence.
6. Public release readiness requires a restore drill within the accepted freshness
   window.
7. The asset recovery policy protects ready object bytes independently of the
   database backup, and the drill verifies the checksum of a referenced asset.

## Health and observability contract

| Signal | Meaning |
|---|---|
| Health | The process event loop is alive |
| Readiness | Schema is compatible and a bounded PostgreSQL query succeeds |
| Commit acknowledgement p50/p95/p99 | Durable write latency |
| Oldest outbox age | Age of user work awaiting a server copy |
| Active and reconnecting WebSockets | Realtime channel stability |
| Snapshot/update size | Compaction pressure |
| Last WAL archive and backup | Offsite-copy freshness |
| Last clean restore drill | Demonstrated recoverability |

Logs contain request, workspace, operation, surface, revision, duration, and error
class identifiers where relevant. They exclude user content and raw secrets.

## Failure

A failed migration stops rollout before the new process becomes ready. A failed
backup or stale WAL archive blocks release according to the freshness policy. A
failed restore drill opens an operational incident and invalidates recoverability
claims until a clean drill passes.

## Executable proof

- A clean Compose environment reaches readiness from repository instructions.
- The deployed revision matches the intended exact commit.
- PostgreSQL is unreachable from the public network.
- Migration tests pass from clean and previous supported schemas.
- A synthetic workspace operation travels through API, PostgreSQL, WebSocket, and
  reload.
- A clean restore reaches the declared revision and opens its referenced content.
