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

backup_type="${1:-incr}"
case "${backup_type}" in
  full|diff|incr) ;;
  *) echo "Backup type must be full, diff, or incr." >&2; exit 64 ;;
esac

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pgbackrest --stanza=foldthink --type="${backup_type}" backup
information="$(pgbackrest --stanza=foldthink --output=json info)"
latest="$(jq -c '[.[].backup[]?] | max_by(.timestamp.stop) // {}' <<<"${information}")"
latest_stop="$(jq '.timestamp.stop // 0' <<<"${latest}")"
backup_label="$(jq -r '.label // ""' <<<"${latest}")"
archive_start="$(jq -r '.archive.start // ""' <<<"${latest}")"
archive_stop="$(jq -r '.archive.stop // ""' <<<"${latest}")"
archive_max="$(jq -r '[.[].archive[]?.max | select(. != null)] | max // ""' <<<"${information}")"
jq -n \
  --arg startedAt "${started_at}" \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg type "${backup_type}" \
  --arg backupLabel "${backup_label}" \
  --arg archiveStart "${archive_start}" \
  --arg archiveStop "${archive_stop}" \
  --arg archiveMax "${archive_max}" \
  --argjson backupStopEpoch "${latest_stop}" \
  '{startedAt:$startedAt,completedAt:$completedAt,type:$type,backupLabel:$backupLabel,backupStopEpoch:$backupStopEpoch,archiveStart:$archiveStart,archiveStop:$archiveStop,archiveMax:$archiveMax}' \
  > /var/lib/foldthink-operations/last-backup.json.tmp
mv /var/lib/foldthink-operations/last-backup.json.tmp /var/lib/foldthink-operations/last-backup.json
cat /var/lib/foldthink-operations/last-backup.json
