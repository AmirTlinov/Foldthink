#!/usr/bin/env bash
set -euo pipefail

postgres_data="${PGDATA:-/var/lib/postgresql/18/docker}"
if [[ "$(id -u)" == "0" ]]; then
  install -d -o postgres -g postgres "$(dirname "${postgres_data}")" /var/spool/pgbackrest /var/log/pgbackrest
  if [[ -d "${postgres_data}" ]] && find "${postgres_data}" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "A clean restore requires an empty PostgreSQL data directory: ${postgres_data}" >&2
    exit 64
  fi
  install -d -o postgres -g postgres "${postgres_data}"
  exec gosu postgres "$0" "$@"
fi

if find "${postgres_data}" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "A clean restore requires an empty PostgreSQL data directory: ${postgres_data}" >&2
  exit 64
fi

exec pgbackrest --stanza=foldthink --pg1-path="${postgres_data}" restore "$@"
