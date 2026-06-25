# Raspberry Pi Bare-Metal Pre-Alpha Web Shell

Use this path for Raspberry Pi OS Lite 64-bit when you want De-Koi to run like a
normal systemd service behind your own Caddy, nginx, DuckDNS, Tailscale, or
router setup.

This is the bare-metal equivalent of the Pi container pair:

- `de-koi-server` runs as a local Rust API service on `127.0.0.1:8787`.
- The built React web shell is served as static files.
- Caddy or nginx proxies `/health` and `/api/` to `127.0.0.1:8787`.
- Your reverse proxy owns HTTPS and full-page auth.

Do not build De-Koi on the Pi for normal updates. Use the prebuilt
`De-Koi-PreAlpha-pi-bare-metal-arm64-*.tar.gz` release asset.

## Build The Release Asset

From GitHub Actions, run **Pre-Alpha Platform Builds** on `main`. When the run
succeeds, the draft pre-release includes:

```text
De-Koi-PreAlpha-pi-bare-metal-arm64-v<version>-<sha>.tar.gz
De-Koi-PreAlpha-pi-bare-metal-arm64-v<version>-<sha>.tar.gz.sha256
```

The asset contains:

- `bin/de-koi-server`
- `web/` static files
- `app/` source and resource snapshot for runtime defaults and Deki-senpai code
  tools
- `VERSION` metadata

## Install Or Update On The Pi

Download the tarball to the Pi, then run the updater script as root:

```sh
asset=De-Koi-PreAlpha-pi-bare-metal-arm64-v<version>-<sha>.tar.gz
sudo DE_KOI_PUBLIC_ORIGIN=https://de-koi.example.duckdns.org \
  bash scripts/pi-bare-metal-update.sh "/tmp/$asset"
```

The downloaded filename includes the De-Koi version and short source SHA, matching
the asset name emitted by the pre-alpha workflow.

To validate the package layout before installing:

```sh
bash scripts/pi-bare-metal-update.sh --validate-only "/tmp/$asset"
```

The script installs to:

```text
/opt/de-koi/current
/var/lib/de-koi
/etc/de-koi/de-koi-server.env
/etc/systemd/system/de-koi-server.service
```

It creates a `de-koi` system user if needed, restarts
`de-koi-server.service`, and checks `http://127.0.0.1:8787/health`.

If you did not set `DE_KOI_PUBLIC_ORIGIN` on first install, edit:

```text
/etc/de-koi/de-koi-server.env
```

Set these to the exact browser URL:

```env
CORS_ORIGINS=https://de-koi.example.duckdns.org
CSRF_TRUSTED_ORIGINS=https://de-koi.example.duckdns.org
```

Then restart:

```sh
sudo systemctl restart de-koi-server.service
```

Or refresh only the managed safe defaults while preserving secrets:

```sh
sudo DE_KOI_PUBLIC_ORIGIN=https://de-koi.example.duckdns.org \
  bash scripts/pi-bare-metal-update.sh --refresh-env "/tmp/$asset"
```

## Caddy

Serve the static web shell from:

```text
/opt/de-koi/current/web
```

Proxy these paths to the Rust runtime:

```text
/health -> 127.0.0.1:8787
/api/*  -> 127.0.0.1:8787
```

A starting Caddy example lives at:

```text
deploy/pi/bare-metal/Caddyfile.example
```

If Caddy performs Basic Auth, preserve the browser `Authorization` header when
proxying to the runtime. The runtime stays on loopback; do not expose port
`8787` publicly.

## Updating

For each new pre-alpha package, rerun:

```sh
asset=De-Koi-PreAlpha-pi-bare-metal-arm64-v<version>-<sha>.tar.gz
sudo DE_KOI_PUBLIC_ORIGIN=https://de-koi.example.duckdns.org \
  bash scripts/pi-bare-metal-update.sh "/tmp/$asset"
```

The script installs each package into a new release directory and moves
`/opt/de-koi/current` atomically. Your data stays in `/var/lib/de-koi`.
If the existing env file was configured with a public origin, later updates must
provide the same `DE_KOI_PUBLIC_ORIGIN` or use `--refresh-env` to intentionally
change the managed origin fields.
Older env files without `DE_KOI_MANAGED_PUBLIC_ORIGIN` can be migrated by
rerunning with `--refresh-env` and the current `DE_KOI_PUBLIC_ORIGIN`.
