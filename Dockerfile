# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder

ARG DE_KOI_SOURCE_COMMIT=unknown
ENV DE_KOI_SOURCE_COMMIT=${DE_KOI_SOURCE_COMMIT}

WORKDIR /app

# The Pi server image builds only the hostable server feature, not the desktop
# Tauri app, so it does not need WebKit/GTK build dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY LICENSE.txt NOTICE.md ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
COPY src ./src
COPY src-tauri/crates ./src-tauri/crates
COPY src-tauri/src ./src-tauri/src
COPY src-tauri/build.rs ./src-tauri/build.rs
COPY src-tauri/tauri.conf.json ./src-tauri/tauri.conf.json
COPY src-tauri/capabilities ./src-tauri/capabilities
COPY src-tauri/icons ./src-tauri/icons
COPY src-tauri/resources ./src-tauri/resources

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/src-tauri/target \
    cargo build --manifest-path src-tauri/Cargo.toml --release --bin de-koi-server --no-default-features --features server \
    && cp /app/src-tauri/target/release/de-koi-server /usr/local/bin/de-koi-server

FROM node:22-bookworm-slim AS runtime

ARG DE_KOI_IMAGE_VERSION=prealpha
ARG DE_KOI_SOURCE_COMMIT=unknown
ARG CODEX_CLI_VERSION=0.130.0

LABEL org.opencontainers.image.title="De-Koi Server"
LABEL org.opencontainers.image.source="https://github.com/The-Koi-Pond/De-Koi"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.version="${DE_KOI_IMAGE_VERSION}"
LABEL org.opencontainers.image.revision="${DE_KOI_SOURCE_COMMIT}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    yt-dlp \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@openai/codex@${CODEX_CLI_VERSION}" --omit=dev --no-audit --no-fund \
  && codex --version

WORKDIR /app

COPY LICENSE.txt NOTICE.md README.md /app/
COPY AGENTS.md package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json ./
COPY docs ./docs
COPY scripts ./scripts
COPY skills ./skills
COPY src ./src
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs src-tauri/tauri.conf.json ./src-tauri/
COPY src-tauri/capabilities ./src-tauri/capabilities
COPY src-tauri/crates ./src-tauri/crates
COPY src-tauri/src ./src-tauri/src
COPY --from=builder /usr/local/bin/de-koi-server /usr/local/bin/de-koi-server
COPY --from=builder /app/src-tauri/resources /app/src-tauri/resources

ENV DE_KOI_SERVER_ADDR=0.0.0.0:8787
ENV DE_KOI_DATA_DIR=/data
ENV DE_KOI_REPO_ROOT=/app

EXPOSE 8787
VOLUME ["/data"]

CMD ["de-koi-server"]
