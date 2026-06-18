#!/usr/bin/env sh
set -eu

compose_file="${DE_KOI_PI_COMPOSE_FILE:-docker-compose.pi.yml}"
url="${DE_KOI_PI_HEALTH_URL:-http://127.0.0.1:7860/}"

docker compose -f "$compose_file" pull
docker compose -f "$compose_file" up -d
docker compose -f "$compose_file" ps

if command -v curl >/dev/null 2>&1; then
  curl -fsSI "$url" >/dev/null
  echo "De-Koi is reachable at $url"
else
  echo "curl is not installed; open $url to verify De-Koi."
fi
