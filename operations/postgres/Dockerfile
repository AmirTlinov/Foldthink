FROM postgres:18-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af
ARG REVISION
LABEL org.opencontainers.image.title="Foldthink PostgreSQL" \
      org.opencontainers.image.source="https://github.com/AmirTlinov/Foldthink" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="0BSD"
RUN apt-get update \
 && apt-get install --yes --no-install-recommends pgbackrest=2.59.1-1.pgdg12+1 jq \
 && rm -rf /var/lib/apt/lists/*
COPY operations/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY operations/postgres/configure-archive.sh /docker-entrypoint-initdb.d/20-foldthink-archive.sh
COPY operations/backup/run-backup.sh /usr/local/bin/foldthink-backup
COPY operations/backup/check-freshness.sh /usr/local/bin/foldthink-backup-freshness
COPY operations/backup/run-scheduler.sh /usr/local/bin/foldthink-backup-scheduler
COPY operations/backup/prime-backup.sh /usr/local/bin/foldthink-backup-prime
COPY operations/restore/restore-postgres.sh /usr/local/bin/foldthink-restore
RUN chmod 0755 /docker-entrypoint-initdb.d/20-foldthink-archive.sh /usr/local/bin/foldthink-backup /usr/local/bin/foldthink-backup-freshness /usr/local/bin/foldthink-backup-scheduler /usr/local/bin/foldthink-backup-prime /usr/local/bin/foldthink-restore \
 && install -d -o postgres -g postgres /var/spool/pgbackrest /var/log/pgbackrest /var/lib/foldthink-operations
