# Raspberry Pi Fast Install And Update

Use the prebuilt De-Koi Pi images. Do not run `cargo build`, `pnpm build`, or
`docker compose build` on the Pi for normal updates.

For Raspberry Pi OS Lite 64-bit installs that should run without Docker, use
the [bare-metal Pi guide](pi-bare-metal.md). That path installs the prebuilt
ARM64 `de-koi-server` binary as a systemd service and serves the web shell from
Caddy or nginx.

## Home LAN Or Tailscale

For a trusted home LAN or Tailscale Pi, run this from the De-Koi repository
root:

```sh
sh scripts/pi-update.sh --trusted-lan
```

That command pulls the public ARM64 images and recreates the containers:

```sh
docker compose -f docker-compose.pi.yml -f docker-compose.pi.trusted-lan.yml pull
docker compose -f docker-compose.pi.yml -f docker-compose.pi.trusted-lan.yml up -d
```

The updater checks the pulled image labels before recreating containers. It uses
the newest successful cooked batch: `de-koi-server` and `de-koi-web` must report
the same `org.opencontainers.image.revision`, and the candidate batch must not
be older than the currently deployed image batch when that current revision is
detectable.

For emergency manual recovery only, set `DE_KOI_PI_ALLOW_REVISION=<sha>` to
allow a specific matched image batch. This bypasses the freshness comparison for
that exact candidate revision only; it does not repair mixed running containers
or missing image labels, and it can deploy an older batch if you choose the wrong
SHA.

Set `DE_KOI_PI_EXTRA_COMPOSE_FILES` to a comma-separated list of local override
files when a Pi needs host-specific ports or volumes, such as exposing backend
port `8787` on a trusted Tailscale network.

### ChatGPT Through Local Codex Login

The ChatGPT connection uses the local Codex `auth.json` file instead of an API
key. For Pi Docker installs, run `codex login` as the host user that owns the
De-Koi install, then mount that host Codex directory into the server container.
This lets De-Koi read the login and persist token refreshes back to the host
after container recreation.

For the default `chai` Pi user, create a local override such as
`docker-compose.pi.local.yml`:

```yaml
services:
  de-koi-server:
    environment:
      CODEX_HOME: /root/.codex
    volumes:
      - /home/chai/.codex:/root/.codex
```

Then include that override when updating:

```sh
DE_KOI_PI_EXTRA_COMPOSE_FILES=docker-compose.pi.local.yml sh scripts/pi-update.sh --trusted-lan
```

For timer-driven updates, keep the same override in `/etc/de-koi/pi-update.env`
so future image updates recreate the container with the Codex auth mount.

In De-Koi, use the ChatGPT connection's **Test Connection** to verify the local
login, **Fetch ChatGPT Models** to confirm live model access, and **Send Test Message** to prove generation for the selected model.

For timer-driven updates, put the same override setting in the optional systemd
environment file:

```sh
sudo install -d /etc/de-koi
printf 'DE_KOI_PI_EXTRA_COMPOSE_FILES=docker-compose.pi.local.yml\n' | sudo tee /etc/de-koi/pi-update.env
```

Open De-Koi at:

```text
http://<pi-host>:7860/
```

For example:

```text
http://pi:7860/
http://pi.local:7860/
```

If you open De-Koi through a LAN IP, Tailscale IP, or another hostname, add the
exact browser origins to `.env`:

```env
CORS_ORIGINS=http://pi:7860,http://pi.local:7860,http://192.168.1.231:7860,http://100.64.240.39:7860
CSRF_TRUSTED_ORIGINS=http://pi:7860,http://pi.local:7860,http://192.168.1.231:7860,http://100.64.240.39:7860
```

## Auto Update Timer

After one manual image update works, install the systemd timer templates:

```sh
sudo cp deploy/pi/systemd/de-koi-pi-update.service /etc/systemd/system/
sudo cp deploy/pi/systemd/de-koi-pi-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now de-koi-pi-update.timer
systemctl list-timers de-koi-pi-update.timer
```

The timer checks every 6 hours with a randomized delay. The service uses `flock`
so overlapping updates cannot run.

## Hardened Default

For a hardened default install, skip the LAN-trust override:

```sh
sh scripts/pi-update.sh
```

or:

```sh
docker compose -f docker-compose.pi.yml pull
docker compose -f docker-compose.pi.yml up -d
```

Configure `BASIC_AUTH_USER` and `BASIC_AUTH_PASS`, or `IP_ALLOWLIST`, before
using the hardened default from another device.

## What Makes This Fast

GitHub builds and publishes these ARM64 images:

```text
ghcr.io/the-koi-pond/de-koi-server:prealpha
ghcr.io/the-koi-pond/de-koi-web:prealpha
```

The Pi only pulls images and recreates containers. Source builds are still
available for contributors, but they can take 30-40+ minutes on Pi hardware.

The server image includes a read-only source snapshot at /app, and the Pi
compose file sets DE_KOI_REPO_ROOT=/app so Deki-senpai can inspect current
De-Koi code. If you mount a different checkout into the container, point
DE_KOI_REPO_ROOT at that repository root; it must contain AGENTS.md and
package.json.
