#!/usr/bin/env sh
set -eu

compose_file="${DE_KOI_PI_COMPOSE_FILE:-docker-compose.pi.yml}"
trusted_lan_file="${DE_KOI_PI_TRUSTED_LAN_COMPOSE_FILE:-docker-compose.pi.trusted-lan.yml}"
url="${DE_KOI_PI_HEALTH_URL:-http://127.0.0.1:7860/}"
trusted_lan=false

usage() {
  cat <<'EOF'
Usage: sh scripts/pi-update.sh [--trusted-lan]

Fast Raspberry Pi update using prebuilt ARM64 images.

Options:
  --trusted-lan   Add docker-compose.pi.trusted-lan.yml for home LAN/Tailscale use.
  --help          Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --trusted-lan)
      trusted_lan=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

set -- -f "$compose_file"
if [ "$trusted_lan" = true ]; then
  set -- "$@" -f "$trusted_lan_file"
fi

echo "Updating De-Koi from prebuilt Pi images..."
docker compose "$@" pull
docker compose "$@" up -d
docker compose "$@" ps

if command -v curl >/dev/null 2>&1; then
  curl -fsSI "$url" >/dev/null
  echo "De-Koi is reachable at $url"
else
  echo "curl is not installed; open $url to verify De-Koi."
fi
