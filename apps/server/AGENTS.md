# Server Application Map

The server application is the Node.js composition root. It wires HTTP,
WebSocket, PostgreSQL, object storage, and document compilation adapters to
public server entry points from domains. It owns no domain meaning of its own.

```text
apps/server/
|-- AGENTS.md                    # Current server composition-root map.
|-- package.json                 # Server commands and domain dependencies.
|-- tsconfig.json                # Node composition compiler boundary.
|-- src/
|   |-- main.ts                  # HTTP process, lifecycle, and route composition.
|   |-- server-config.ts         # Required environment and exact release identity.
|   |-- release-identity.ts      # Compiled revision and schema identity gate.
|   |-- request-admission.ts     # Per-session, per-network, and concurrency bounds.
|   |-- service-observer.ts      # Content-free request logs and latency readouts.
|   |-- compose-server-runtime.ts # PostgreSQL and domain owner wiring.
|   |-- http-boundary.ts         # JSON, cookie, origin, and response mechanics.
|   |-- identity-http-routes.ts  # Anonymous bootstrap and device-link adapter.
|   |-- sync-http-routes.ts      # State and durable-operation HTTP adapter.
|   |-- asset-http-routes.ts     # Authorized byte lifecycle adapter.
|   `-- document-http-routes.ts  # Restricted LaTeX compilation adapter.
`-- tests/
    |-- server-startup.test.ts      # Required durable configuration proof.
    `-- operational-boundary.test.ts # Admission, route privacy, and metrics proof.
```

Allowed imports are enforced by
[dependency-cruiser.cjs](../../dependency-cruiser.cjs).
