#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" == "0" ]]; then
  exec gosu postgres "$0" "$@"
fi

maximum_age="${MAX_BACKUP_AGE_SECONDS:-86400}"
if ! [[ "${maximum_age}" =~ ^[0-9]+$ ]] || (( maximum_age < 60 )); then
  echo "MAX_BACKUP_AGE_SECONDS must be an integer of at least 60." >&2
  exit 64
fi

information="$(pgbackrest --stanza=foldthink --output=json info)"
latest_stop="$(jq '[.[].backup[]?.timestamp.stop] | max // 0' <<<"${information}")"
if (( latest_stop == 0 )); then
  echo "No successful Foldthink backup exists." >&2
  exit 1
fi
age="$(( $(date +%s) - latest_stop ))"
if (( age > maximum_age )); then
  echo "The newest Foldthink backup is ${age}s old; the maximum is ${maximum_age}s." >&2
  exit 1
fi
printf '{"status":"fresh","backupAgeSeconds":%s,"maximumAgeSeconds":%s}\n' "${age}" "${maximum_age}"
