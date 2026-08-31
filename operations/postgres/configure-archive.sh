#!/usr/bin/env bash
set -euo pipefail

cat >> "${PGDATA}/postgresql.conf" <<'EOF'

# Foldthink durable recovery boundary.
archive_mode = on
archive_command = 'pgbackrest --stanza=foldthink archive-push %p'
archive_timeout = '60s'
EOF
