#!/usr/bin/env sh
set -eu

# One-command HTTPS for a VDS: Caddy in front of de-koi-web with a real certificate and a login on the whole
# site. Phone notifications and voice input need an https:// page.

caddy_image="caddy:2.10.2-alpine"
env_file="${DE_KOI_VDS_ENV_FILE:-.env}"
default_origins="http://127.0.0.1:7860,http://localhost:7860"
https_port="${DE_KOI_HTTPS_PORT:-443}"

usage() {
  cat <<'EOF'
Usage: sh scripts/vds-https.sh <domain>

Example: sh scripts/vds-https.sh de-koi.example.com

Before running: point the domain's DNS (A/AAAA record) at this server and open
ports 80 and 443. The script writes DE_KOI_DOMAIN, the HTTPS origin, and a login
(BASIC_AUTH_USER/BASIC_AUTH_PASS, generated if missing) to .env, starts De-Koi
with Caddy, and checks https://<domain>/. Safe to run again.
EOF
}

case "${1:-}" in
  ""|--help|-h)
    usage
    [ -n "${1:-}" ] && exit 0
    exit 2
    ;;
esac
domain="$1"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

printf '%s' "$domain" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' ||
  fail "Give just the domain name, like de-koi.example.com (no https:// and no path)."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 ('docker compose') is required."
[ -f docker-compose.vds.yml ] && [ -f docker-compose.vds.https.yml ] ||
  fail "Run this from the De-Koi repository root."

origin="https://$domain"
[ "$https_port" = "443" ] || origin="$origin:$https_port"

[ -f "$env_file" ] || : >"$env_file"
[ -f "$env_file.bak-before-https" ] || cp "$env_file" "$env_file.bak-before-https"

# Prints a .env value with surrounding quotes removed (empty when missing).
get_env() {
  awk -v key="$1" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END {
      if (value ~ /^".*"$/ || value ~ /^\x27.*\x27$/) value = substr(value, 2, length(value) - 2)
      print value
    }' "$env_file"
}

# Sets KEY to VALUE in .env (replacing an existing line, or appending one). VALUE is written as-is.
set_env() {
  tmp="$env_file.tmp.$$"
  awk -v key="$1" -v line="$1=$2" '
    index($0, key "=") == 1 { if (!done) print line; done = 1; next }
    { print }
    END { if (!done) print line }' "$env_file" >"$tmp"
  cat "$tmp" >"$env_file"
  rm -f "$tmp"
}

add_origin() {
  current="$(get_env "$1")"
  [ -n "$current" ] || current="$default_origins"
  case ",$current," in
    *",$origin,"*) ;;
    *) current="$origin,$current" ;;
  esac
  set_env "$1" "$current"
}

set_env DE_KOI_DOMAIN "$domain"
[ "$https_port" = "443" ] || set_env DE_KOI_HTTPS_PORT "$https_port"
add_origin CORS_ORIGINS
add_origin CSRF_TRUSTED_ORIGINS

user="$(get_env BASIC_AUTH_USER)"
pass="$(get_env BASIC_AUTH_PASS)"
new_login=false
if [ -z "$user" ] || [ -z "$pass" ]; then
  [ -n "$user" ] || user="de-koi"
  pass="$(od -An -N18 -tx1 /dev/urandom | tr -d ' \n')"
  set_env BASIC_AUTH_USER "$user"
  set_env BASIC_AUTH_PASS "$pass"
  new_login=true
fi
case "$user" in
  *[!A-Za-z0-9._-]*) fail "BASIC_AUTH_USER may only use letters, numbers, dots, dashes and underscores." ;;
esac
# Docker Compose would read a '$' in .env as a variable, so the server would expect a different password than
# the one Caddy checks.
case "$pass" in
  *'$'*|*"'"*|*'"'*|*' '*) fail "BASIC_AUTH_PASS can't contain \$, quotes or spaces. Change it in $env_file (or delete it to get a generated one)." ;;
esac

# Caddy keeps only a bcrypt hash of the password. Single quotes stop Docker Compose from reading the hash's
# '$' signs as variables. The password goes in on stdin so it never shows up in the process list.
hash="$(printf '%s\n%s\n' "$pass" "$pass" | docker run --rm -i "$caddy_image" caddy hash-password 2>/dev/null | tail -n 1)"
case "$hash" in
  '$2'*) ;;
  *) fail "Could not hash the password with $caddy_image." ;;
esac
set_env DE_KOI_CADDY_PASSWORD_HASH "'$hash'"
chmod 600 "$env_file" 2>/dev/null || true

echo "Starting De-Koi with HTTPS at $origin/ ..."
set -- -f docker-compose.vds.yml -f docker-compose.vds.https.yml
docker compose "$@" pull
docker compose "$@" up -d
docker compose "$@" ps

# Check from this host, pinned to 127.0.0.1 so it doesn't depend on DNS. The first certificate can take a
# minute; a self-signed 'localhost' test install is checked with -k.
insecure=""
case "$domain" in
  localhost|*.localhost) insecure="-k" ;;
esac
check() {
  code="$(curl -s $insecure -o /dev/null -w "%{http_code}" --max-time 20 \
    --resolve "$domain:$https_port:127.0.0.1" "$@")" || true
  echo "${code:-000}"
}
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not installed; open $origin/ to check it."
  exit 0
fi
attempt=0
until [ "$(check -u "$user:$pass" "$origin/")" = "200" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail "$origin/ is not answering yet. Check that DNS points here, ports 80/443 are open, and 'docker logs de-koi-caddy'."
  sleep 4
done
[ "$(check "$origin/")" = "401" ] || fail "$origin/ answered without the login. Check deploy/vds/Caddyfile."
api="$(check -u "$user:$pass" "$origin/api/characters")"
case "$api" in
  401|403) fail "$origin/api/ refused the login ($api). BASIC_AUTH_USER/BASIC_AUTH_PASS must match on both Caddy and the server." ;;
  000|5*) fail "$origin/api/ did not answer properly ($api)." ;;
esac

echo
echo "HTTPS is ready: $origin/"
if [ "$new_login" = true ]; then
  echo "Login (saved in $env_file):"
  echo "  user:     $user"
  echo "  password: $pass"
else
  echo "Log in with BASIC_AUTH_USER/BASIC_AUTH_PASS from $env_file."
fi
