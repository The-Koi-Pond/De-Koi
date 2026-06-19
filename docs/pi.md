# Raspberry Pi Fast Install And Update

Use the prebuilt De-Koi Pi images. Do not run `cargo build`, `pnpm build`, or
`docker compose build` on the Pi for normal updates.

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
