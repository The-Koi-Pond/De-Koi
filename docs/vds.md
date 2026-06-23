# VDS / VPS Pre-Alpha Web Shell

Use this guide when you want one De-Koi web-shell instance on a normal VDS/VPS
that you can open from both your phone and PC. The published pre-alpha
containers are built for both `linux/amd64` and `linux/arm64`.

This is an advanced self-hosted path. Desktop releases remain the shortest path
for most users. Treat pre-alpha hosted installs as trusted personal services,
not public community instances.

## What Runs

The VDS compose file starts two containers:

- `de-koi-web` serves the React web shell and is the only service with a host
  port.
- `de-koi-server` stores data and serves the Rust API on the private Docker
  network.

Open the web shell from a browser. Same-origin requests to `/health` and
`/api/` are proxied by nginx to `de-koi-server:8787`, so the web shell can
auto-detect the runtime without a separate Remote Runtime URL. Phone and PC
browsers that open the same hosted URL use the same server-side data volume.

## HTTPS Domain Or Reverse Proxy

Create `.env` first and set the exact browser origin users will open:

```env
CORS_ORIGINS=https://de-koi.example.com
CSRF_TRUSTED_ORIGINS=https://de-koi.example.com
```

Then start the stack from the repository root:

```sh
docker compose -f docker-compose.vds.yml pull
docker compose -f docker-compose.vds.yml up -d
curl -I http://127.0.0.1:7860/
```

By default, the web container binds to `http://127.0.0.1:7860/`. Put Caddy,
nginx, Traefik, or another HTTPS reverse proxy in front of that local port and
open De-Koi at your HTTPS domain.

The shipped `de-koi-web` nginx config proxies `/api/` to the private Rust runtime
and forwards the browser `Authorization` header on that hop. If your outer
reverse proxy performs Basic Auth, configure it to preserve `Authorization`
when proxying to `127.0.0.1:7860`.

For a public internet VDS, protect the web shell with HTTPS and authentication.
Reverse-proxy Basic Auth is the easiest full-page option when the outer proxy
preserves `Authorization`, because the browser sends that header to the web
container and the shipped web nginx forwards it to the Rust runtime.

Do not expose port `8787` on the host or to the public internet. It should stay
private on the Docker network behind `de-koi-web`.

## Private Tailscale Or VPN

For a private VDS reachable only over Tailscale, WireGuard, or another trusted
VPN, you can expose the web port on the host by setting:

```env
DE_KOI_WEB_BIND=7860
CSRF_TRUSTED_ORIGINS=http://your-vds-host:7860,http://100.x.y.z:7860
CORS_ORIGINS=http://your-vds-host:7860,http://100.x.y.z:7860
```

Then update the stack:

```sh
docker compose -f docker-compose.vds.yml up -d
```

Only use this on a network you already trust. If other people can reach the
port, add reverse-proxy auth, `BASIC_AUTH_USER` and `BASIC_AUTH_PASS`, or
`IP_ALLOWLIST`.

## Data And Updates

The default persistent data lives in the named Docker volume `de-koi-vds-data`.
To use a host folder instead, set:

```env
DE_KOI_HOST_DATA_DIR=./.de-koi-vds-data
```

The server stores records under `/data/data` inside the container. Do not bind a
live desktop app data directory directly; copy data into a throwaway host folder
when testing migration or parity.

Update to the newest pre-alpha image batch with:

```sh
docker compose -f docker-compose.vds.yml pull
docker compose -f docker-compose.vds.yml up -d
curl -I http://127.0.0.1:7860/
```

## Auth Notes

- Reverse-proxy Basic Auth protects the whole web shell and works naturally with
  phone and PC browsers.
- `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` protect the Rust runtime. They are
  most useful when a desktop client points directly at the remote runtime URL,
  or when a reverse proxy also supplies the same `Authorization` header through
  the web container.
- `IP_ALLOWLIST` is useful for static trusted client addresses.
- `ADMIN_SECRET` protects privileged runtime commands when those commands are
  used remotely. Configure the same value in De-Koi Settings > Advanced.
