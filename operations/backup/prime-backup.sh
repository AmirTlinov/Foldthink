#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" == "0" ]]; then
  install -d -o postgres -g postgres \
    /var/lib/foldthink-operations \
    /var/lib/pgbackrest/repository \
    /var/spool/pgbackrest \
    /var/log/pgbackrest
  exec gosu postgres "$0" "$@"
fi

pgbackrest --stanza=foldthink stanza-create
pgbackrest --stanza=foldthink check
foldthink-backup full
