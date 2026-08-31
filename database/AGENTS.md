# Database Map

PostgreSQL migrations need one total order even though each table belongs to a
domain. This directory owns that order; domain contracts own the meaning.

```text
database/
|-- AGENTS.md    # Current migration-order map.
```

The first schema change creates `database/migrations/` in the same commit. A
migration name has the form:

```text
YYYYMMDDNNNN_<domain>__<action>.sql
```

For example, `202608310001_identity__create_device_sessions.sql` states both its
global order and semantic owner. A migration changes storage shape; it does not
become a second prose contract.
