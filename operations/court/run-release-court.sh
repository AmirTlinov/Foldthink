#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DOCKER_HOST:-}" && -S "${HOME}/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
fi

project="${FOLDTHINK_COURT_PROJECT:-foldthink-court}"
revision="${FOLDTHINK_BUILD_REVISION:-$(git rev-parse HEAD)}"
public_origin="${FOLDTHINK_PUBLIC_ORIGIN:-http://localhost:18080}"
evidence_directory="${FOLDTHINK_COURT_EVIDENCE_DIRECTORY:-dist/operations}"
private_evidence="${evidence_directory}/.recovery-private.json"
backup_evidence="${evidence_directory}/backup-evidence.json"
court_evidence="${evidence_directory}/release-court.json"

export FOLDTHINK_REVISION="${revision}"
export FOLDTHINK_IMAGE="${FOLDTHINK_IMAGE:-foldthink-release:court}"
export FOLDTHINK_POSTGRES_IMAGE="${FOLDTHINK_POSTGRES_IMAGE:-foldthink-postgres:court}"
export FOLDTHINK_PUBLIC_ORIGIN="${public_origin}"
export FOLDTHINK_SITE_ADDRESS="${FOLDTHINK_SITE_ADDRESS:-http://localhost}"
export FOLDTHINK_HTTP_PORT="${FOLDTHINK_HTTP_PORT:-18080}"
export FOLDTHINK_HTTPS_PORT="${FOLDTHINK_HTTPS_PORT:-18443}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-court-password}"
export SESSION_HMAC_KEY="${SESSION_HMAC_KEY:-court-session-hmac-key-with-at-least-32-bytes}"
export ASSET_S3_BUCKET="${ASSET_S3_BUCKET:-assets}"
export ASSET_S3_REGION="${ASSET_S3_REGION:-us-east-1}"
export ASSET_S3_ENDPOINT="${ASSET_S3_ENDPOINT:-http://object-store:9000}"
export ASSET_S3_FORCE_PATH_STYLE="${ASSET_S3_FORCE_PATH_STYLE:-true}"
export ASSET_S3_ACCESS_KEY_ID="${ASSET_S3_ACCESS_KEY_ID:-foldthink}"
export ASSET_S3_SECRET_ACCESS_KEY="${ASSET_S3_SECRET_ACCESS_KEY:-foldthink-court-secret}"
export PGBACKREST_S3_BUCKET="${PGBACKREST_S3_BUCKET:-backups}"
export PGBACKREST_S3_REGION="${PGBACKREST_S3_REGION:-us-east-1}"
export PGBACKREST_S3_ENDPOINT="${PGBACKREST_S3_ENDPOINT:-object-store}"
export PGBACKREST_STORAGE_PORT="${PGBACKREST_STORAGE_PORT:-9000}"
export PGBACKREST_S3_KEY="${PGBACKREST_S3_KEY:-foldthink}"
export PGBACKREST_S3_KEY_SECRET="${PGBACKREST_S3_KEY_SECRET:-foldthink-court-secret}"
export PGBACKREST_S3_URI_STYLE="${PGBACKREST_S3_URI_STYLE:-path}"
export PGBACKREST_STORAGE_VERIFY_TLS="${PGBACKREST_STORAGE_VERIFY_TLS:-n}"
export PGBACKREST_CIPHER_PASS="${PGBACKREST_CIPHER_PASS:-court-backup-cipher-pass}"

compose=(docker compose -p "${project}" -f operations/compose.yaml -f operations/court/compose.yaml)

cleanup() {
  rm -f "${private_evidence}"
  if [[ "${FOLDTHINK_COURT_KEEP:-0}" != "1" ]]; then
    "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_container_health() {
  local service="$1"
  local container
  local status
  local attempt
  for attempt in $(seq 1 90); do
    container="$("${compose[@]}" ps -q "${service}")"
    if [[ -n "${container}" ]]; then
      status="$(docker inspect "${container}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
      if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
        return 0
      fi
      if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]]; then
        "${compose[@]}" logs "${service}" >&2
        return 1
      fi
    fi
    sleep 1
  done
  "${compose[@]}" logs "${service}" >&2
  echo "${service} did not become healthy." >&2
  return 1
}

mkdir -p "${evidence_directory}"
rm -f "${private_evidence}" "${backup_evidence}" "${court_evidence}"
"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true

pnpm build:release
docker build --build-arg REVISION="${revision}" -f operations/release/Dockerfile -t "${FOLDTHINK_IMAGE}" .
docker build --build-arg REVISION="${revision}" -f operations/postgres/Dockerfile -t "${FOLDTHINK_POSTGRES_IMAGE}" .
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait

health="$(curl --fail --silent --show-error "${public_origin}/health")"
ready="$(curl --fail --silent --show-error "${public_origin}/ready")"
if [[ "$(jq -r '.revision' <<<"${health}")" != "${revision}" ]] ||
   [[ "$(jq -r '.revision' <<<"${ready}")" != "${revision}" ]]; then
  echo "The public service does not report the image revision ${revision}." >&2
  exit 1
fi
internal_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "${public_origin}/internal/metrics")"
if [[ "${internal_status}" != "404" ]]; then
  echo "The internal metrics boundary is publicly reachable with HTTP ${internal_status}." >&2
  exit 1
fi
if [[ -n "$(docker port "$("${compose[@]}" ps -q postgres)")" ]]; then
  echo "PostgreSQL has a host port in the release topology." >&2
  exit 1
fi
image_revision="$(docker image inspect "${FOLDTHINK_IMAGE}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
manifest="$(docker run --rm --entrypoint cat "${FOLDTHINK_IMAGE}" /opt/foldthink/manifest.json)"
if [[ "${image_revision}" != "${revision}" ]] || [[ "$(jq -r '.revision' <<<"${manifest}")" != "${revision}" ]]; then
  echo "The image label, manifest, and requested revision disagree." >&2
  exit 1
fi

FOLDTHINK_EXTERNAL_BASE_URL="${public_origin}" pnpm exec playwright test --reporter=line

EXPECTED_REVISION="${revision}" FOLDTHINK_BASE_URL="${public_origin}" \
  pnpm exec tsx --tsconfig tsconfig.base.json \
  operations/synthetic/workspace-recovery-probe.mts seed "${private_evidence}"

"${compose[@]}" exec -T backup-scheduler foldthink-backup incr
"${compose[@]}" exec -T backup-scheduler foldthink-backup-freshness
docker run --rm \
  -v "${project}_operation_evidence:/evidence:ro" \
  --entrypoint cat "${FOLDTHINK_POSTGRES_IMAGE}" \
  /evidence/last-backup.json > "${backup_evidence}"

restore_started_epoch="$(date +%s)"
"${compose[@]}" stop edge app backup-scheduler postgres
"${compose[@]}" rm --force backup-scheduler backup-prime postgres
docker volume rm "${project}_postgres_data"
docker volume create "${project}_postgres_data" >/dev/null

docker run --rm \
  -e PGBACKREST_REPO1_TYPE=posix \
  -e PGBACKREST_REPO1_PATH=/var/lib/pgbackrest/repository \
  -e PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc \
  -e PGBACKREST_REPO1_CIPHER_PASS="${PGBACKREST_CIPHER_PASS}" \
  -v "${project}_postgres_data:/var/lib/postgresql" \
  -v "${project}_pgbackrest_repository:/var/lib/pgbackrest/repository" \
  --entrypoint foldthink-restore \
  "${FOLDTHINK_POSTGRES_IMAGE}"

"${compose[@]}" up -d --no-deps postgres
wait_for_container_health postgres
"${compose[@]}" up -d app
wait_for_container_health app
"${compose[@]}" up -d edge
wait_for_container_health edge

EXPECTED_REVISION="${revision}" FOLDTHINK_BASE_URL="${public_origin}" \
  pnpm exec tsx --tsconfig tsconfig.base.json \
  operations/synthetic/workspace-recovery-probe.mts verify "${private_evidence}"
restore_completed_epoch="$(date +%s)"

"${compose[@]}" up -d --no-deps backup-scheduler
private_summary="$(jq '{workspaceId,operationId,operationSequence,surfaceRevision,assetId,assetSha256}' "${private_evidence}")"
jq -n \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg revision "${revision}" \
  --arg schemaMigration "$(jq -r '.schemaMigration' <<<"${manifest}")" \
  --argjson recoveryTimeSeconds "$((restore_completed_epoch - restore_started_epoch))" \
  --argjson backup "$(cat "${backup_evidence}")" \
  --argjson proof "${private_summary}" \
  '{
    status:"passed",
    completedAt:$completedAt,
    revision:$revision,
    schemaMigration:$schemaMigration,
    releaseIdentity:{imageLabelMatches:true,manifestMatches:true,serviceMatches:true},
    publicBoundary:{postgresExposed:false,internalMetricsExposed:false},
    backup:$backup,
    restore:{
      source:"clean PostgreSQL data volume",
      targetBackupLabel:$backup.backupLabel,
      recoveryTimeSeconds:$recoveryTimeSeconds,
      recoveryPointGapOperations:0,
      operation:$proof,
      httpStateVerified:true,
      websocketHistoryVerified:true,
      assetChecksumVerified:true
    },
    browserJourneysVerified:true
  }' > "${court_evidence}"

EXPECTED_REVISION="${revision}" FOLDTHINK_BASE_URL="${public_origin}" \
  pnpm exec tsx --tsconfig tsconfig.base.json \
  operations/synthetic/workspace-recovery-probe.mts delete "${private_evidence}"

cat "${court_evidence}"
