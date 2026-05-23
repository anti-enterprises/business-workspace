FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg postgresql-client; \
    rm -rf /var/lib/apt/lists/*

USER node
