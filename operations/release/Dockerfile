# syntax=docker/dockerfile:1.7

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS caddy

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS tectonic
ARG TARGETARCH
ARG TECTONIC_VERSION=0.16.9
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates curl \
 && case "${TARGETARCH}" in \
      amd64) archive="tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz"; checksum="60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902" ;; \
      arm64) archive="tectonic-${TECTONIC_VERSION}-aarch64-unknown-linux-musl.tar.gz"; checksum="f9aa39017dbd51f111fdb93dda222178cbe51c8193508fc567b523cc74fff9c1" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl --fail --location --retry 3 \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${archive}" \
      --output /tmp/tectonic.tar.gz \
 && echo "${checksum}  /tmp/tectonic.tar.gz" | sha256sum --check \
 && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
 && chmod 0755 /usr/local/bin/tectonic \
 && rm -rf /var/lib/apt/lists/* /tmp/tectonic.tar.gz
RUN mkdir -p /opt/tectonic-cache /tmp/warm/output \
 && printf '%s\n' \
      '\documentclass{article}' \
      '\begin{document}' \
      '\section*{Foldthink proof}' \
      'A durable page rendered by Tectonic.' \
      '\[' \
      'x^2+y^2=z^2' \
      '\]' \
      '\end{document}' \
      > /tmp/warm/main.tex \
 && XDG_CACHE_HOME=/opt/tectonic-cache tectonic -X compile --untrusted --outfmt pdf --outdir /tmp/warm/output /tmp/warm/main.tex \
 && rm /tmp/warm/output/main.pdf \
 && XDG_CACHE_HOME=/opt/tectonic-cache tectonic -X compile --untrusted --only-cached --outfmt pdf --outdir /tmp/warm/output /tmp/warm/main.tex \
 && rm -rf /tmp/warm

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS runtime
ARG REVISION
LABEL org.opencontainers.image.title="Foldthink" \
      org.opencontainers.image.source="https://github.com/AmirTlinov/Foldthink" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="0BSD"
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates poppler-utils \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 foldthink \
 && useradd --uid 10001 --gid foldthink --create-home --home-dir /home/foldthink foldthink \
 && install -d -o foldthink -g foldthink /var/lib/foldthink/assets /var/lib/caddy /var/lib/caddy-config
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=tectonic /usr/local/bin/tectonic /usr/local/bin/tectonic
COPY --from=tectonic --chown=foldthink:foldthink /opt/tectonic-cache /opt/tectonic-cache
WORKDIR /opt/foldthink
COPY --chown=foldthink:foldthink dist/release/server.mjs ./server.mjs
COPY --chown=foldthink:foldthink dist/release/migrate.mjs ./migrate.mjs
COPY --chown=foldthink:foldthink dist/release/migrations ./migrations
COPY --chown=foldthink:foldthink dist/release/web ./web
COPY --chown=foldthink:foldthink dist/release/manifest.json ./manifest.json
COPY --chown=foldthink:foldthink operations/caddy/Caddyfile ./Caddyfile
ENV NODE_ENV=production \
    PORT=8787 \
    TECTONIC_BINARY=/usr/local/bin/tectonic \
    PDFINFO_BINARY=/usr/bin/pdfinfo \
    PDFTOCAIRO_BINARY=/usr/bin/pdftocairo \
    LATEX_CACHE_DIRECTORY=/opt/tectonic-cache/Tectonic \
    XDG_CACHE_HOME=/opt/tectonic-cache
USER foldthink
EXPOSE 8787 8080 8443
CMD ["node", "/opt/foldthink/server.mjs"]
