#!/usr/bin/env bash
set -euo pipefail

interval="${BACKUP_INTERVAL_SECONDS:-21600}"
if ! [[ "${interval}" =~ ^[0-9]+$ ]] || (( interval < 300 )); then
  echo "BACKUP_INTERVAL_SECONDS must be an integer of at least 300." >&2
  exit 64
fi
while true; do
  sleep "${interval}" &
  wait $!
  foldthink-backup incr
done
