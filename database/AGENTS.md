# Database Map

PostgreSQL migrations need one total order even though each table belongs to a
domain. This directory owns that order; domain contracts own the meaning.

```text
database/
|-- AGENTS.md             # Current migration-order map.
|-- apply-migrations.mjs  # Transactional total-order migration runner.
|-- migrations/
    |-- 202608310001_identity__create_anonymous_sessions.sql # Sessions, membership, and one-time linking.
|   `-- 202608310002_synchronization__create_operation_journal.sql # Ordered CRDT state and receipts.
`-- tests/
    `-- migration-chain.test.mjs # Naming, order, and additive-chain proof.
```

The first schema change creates `database/migrations/` in the same commit. A
migration name has the form:

```text
YYYYMMDDNNNN_<domain>__<action>.sql
```

For example, `202608310001_identity__create_device_sessions.sql` states both its
global order and semantic owner. A migration changes storage shape; it does not
become a second prose contract.
