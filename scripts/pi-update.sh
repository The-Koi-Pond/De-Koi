#!/usr/bin/env sh
set -eu

compose_file="${DE_KOI_PI_COMPOSE_FILE:-docker-compose.pi.yml}"
trusted_lan_file="${DE_KOI_PI_TRUSTED_LAN_COMPOSE_FILE:-docker-compose.pi.trusted-lan.yml}"
url="${DE_KOI_PI_HEALTH_URL:-http://127.0.0.1:7860/}"
extra_compose_files="${DE_KOI_PI_EXTRA_COMPOSE_FILES:-}"
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

old_ifs="$IFS"
IFS=","
for extra_compose_file in $extra_compose_files; do
  if [ -n "$extra_compose_file" ]; then
    set -- "$@" -f "$extra_compose_file"
  fi
done
IFS="$old_ifs"

echo "Preflight: checking current De-Koi Pi deployment before pulling images..."
DE_KOI_PI_CHECK_CURRENT_ONLY=1 node scripts/pi-image-guard.mjs

echo "Preflight: validating cached De-Koi Pi image batch before pulling images..."
DE_KOI_PI_ALLOW_MISSING_IMAGES=1 node scripts/pi-image-guard.mjs

echo "Pulling De-Koi prebuilt Pi images..."
docker compose "$@" pull
node scripts/pi-image-guard.mjs
docker compose "$@" up -d
docker compose "$@" ps

if command -v curl >/dev/null 2>&1; then
  curl -fsSI "$url" >/dev/null
  echo "De-Koi is reachable at $url"
else
  echo "curl is not installed; open $url to verify De-Koi."
fi
