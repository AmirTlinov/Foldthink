# Identity Domain Map

`SessionAuthority` owns anonymous device sessions, workspace membership,
one-time linking, revocation, and authorization decisions.

```text
domains/identity/
|-- AGENTS.md                    # This ownership map.
|-- CONTRACT.md                  # Observable identity and access contract.
|-- package.json                 # Protocol and server entry points.
|-- tsconfig.json                # Node server compiler boundary.
|-- src/
|   |-- public-browser.ts        # Deliberate browser-facing exports.
|   |-- public-protocol.ts       # Browser-safe request and response records.
|   |-- public-server.ts         # Deliberate server-facing exports.
|   |-- device-session.ts        # Roles and authorized session facts.
|   |-- join-capability.ts       # One-time device-link result.
|   |-- join-capability-client.ts # Fragment-token exchange through the same origin.
|   |-- session-protocol.ts      # Anonymous bootstrap and link wire records.
|   |-- session-store.ts         # Persistence port required by the authority.
|   |-- session-authority.ts     # Credential, role, and access decisions.
|   `-- postgres-session-store.ts # Atomic PostgreSQL session persistence.
`-- tests/
    `-- session-authority.test.ts # Idempotent bootstrap and one-time join proof.
```

Read [CONTRACT.md](CONTRACT.md) before changing cookies, capabilities, roles, or
membership. This domain imports no other Foldthink domain.
