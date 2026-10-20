#!/usr/bin/env sh
set -eu

# One-command HTTPS for a trusted-LAN Pi through Tailscale Serve.
# Phone notifications and voice input need an https:// page; this gives the Pi one that only your own
# Tailscale devices can reach.

port="${DE_KOI_PI_WEB_PORT:-7860}"
env_file="${DE_KOI_PI_ENV_FILE:-.env}"
default_origins="http://pi:7860,http://pi.local:7860"
update=true
off=false

usage() {
  cat <<'EOF'
Usage: sh scripts/pi-https.sh [--no-update] [--off]

Serves De-Koi at https://<pi>.<tailnet>.ts.net through Tailscale Serve, adds that
address to CORS_ORIGINS and CSRF_TRUSTED_ORIGINS in .env, recreates the containers
with scripts/pi-update.sh --trusted-lan, and checks the HTTPS address end to end.
Safe to run again.

Options:
  --no-update   Only set up Tailscale Serve and .env; don't recreate the containers.
  --off         Stop serving HTTPS (leaves .env alone).
  --help        Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-update) update=false ;;
    --off) off=true ;;
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

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

command -v tailscale >/dev/null 2>&1 ||
  fail "Tailscale is not installed. Install it (https://tailscale.com/download/linux), run 'sudo tailscale up', then rerun this."
command -v node >/dev/null 2>&1 || fail "node is required (scripts/pi-update.sh needs it too)."

if [ "$off" = true ]; then
  as_root tailscale serve --https=443 off
  echo "HTTPS is off. Plain http://<pi-host>:$port/ still works."
  exit 0
fi

# BackendState, DNS name, whether HTTPS certificates are on, and the Pi's Tailscale IPv4.
status="$(tailscale status --json | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  const s = JSON.parse(raw);
  const name = String(s.Self?.DNSName ?? "").replace(/\.$/, "");
  const certs = Array.isArray(s.CertDomains) && s.CertDomains.includes(name) ? "yes" : "no";
  const ip = (s.Self?.TailscaleIPs ?? []).find((a) => a.includes(".")) ?? "";
  console.log([s.BackendState || "-", name || "-", certs, ip || "-"].join(" "));
});')"
set -- $status
backend="${1:--}"
host="${2:--}"
certs="${3:-no}"
ts_ip="${4:--}"
[ "$host" != "-" ] || host=""
[ "$ts_ip" != "-" ] || ts_ip=""

[ "$backend" = "Running" ] || fail "Tailscale is not connected (state: ${backend:-unknown}). Run 'sudo tailscale up' first."
[ -n "$host" ] || fail "Tailscale has no MagicDNS name for this device. Turn on MagicDNS in the admin console (DNS page)."
[ "$certs" = "yes" ] ||
  fail "HTTPS certificates are off for your tailnet. Open https://login.tailscale.com/admin/dns, turn on 'HTTPS Certificates', then rerun this."

origin="https://$host"

# 1. Tailscale Serve: https://<host>/ -> http://127.0.0.1:<port>. Skip when it already does exactly that.
target="http://127.0.0.1:$port"
current="$(tailscale serve status --json 2>/dev/null | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try {
    const s = JSON.parse(raw || "{}");
    console.log(s.Web?.[process.argv[1] + ":443"]?.Handlers?.["/"]?.Proxy ?? "");
  } catch {
    console.log("");
  }
});' "$host")"
if [ "$current" = "$target" ]; then
  echo "Tailscale Serve already sends $origin to $target."
else
  echo "Turning on Tailscale Serve: $origin -> $target"
  as_root tailscale serve --bg --yes "$port"
fi

# 2. .env: add the HTTPS origin to CORS_ORIGINS and CSRF_TRUSTED_ORIGINS (keeping what is there; an empty or
# missing value means the compose default, so start from that).
[ -f "$env_file" ] || : >"$env_file"
env_tmp="$env_file.tmp.$$"
changed="$(node -e '
const fs = require("fs");
const [file, tmp, origin, defaults] = process.argv.slice(1);
const text = fs.readFileSync(file, "utf8");
const lines = text === "" ? [] : text.split("\n");
if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
let changed = false;
for (const key of ["CORS_ORIGINS", "CSRF_TRUSTED_ORIGINS"]) {
  const index = lines.findIndex((line) => line.startsWith(key + "="));
  const value = index >= 0 ? lines[index].slice(key.length + 1).trim().replace(/^"(.*)"$/, "$1") : "";
  const list = (value || defaults).split(",").map((v) => v.trim()).filter(Boolean);
  if (index >= 0 && list.includes(origin)) continue;
  if (!list.includes(origin)) list.unshift(origin);
  const line = key + "=" + list.join(",");
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  changed = true;
}
if (changed) fs.writeFileSync(tmp, lines.join("\n") + "\n");
console.log(changed ? "yes" : "no");
' "$env_file" "$env_tmp" "$origin" "$default_origins")"
if [ "$changed" = "yes" ]; then
  [ -f "$env_file.bak-before-https" ] || cp "$env_file" "$env_file.bak-before-https"
  cat "$env_tmp" >"$env_file"
  rm -f "$env_tmp"
  echo "Added $origin to CORS_ORIGINS and CSRF_TRUSTED_ORIGINS in $env_file (backup: $env_file.bak-before-https)."
else
  echo "$env_file already trusts $origin."
fi

trusted_proxies="$(sed -n 's/^TRUSTED_PROXIES=//p' "$env_file" | tail -n 1)"
if [ -n "$trusted_proxies" ]; then
  echo "WARNING: $env_file sets TRUSTED_PROXIES=$trusted_proxies. The trusted-LAN default (172.16.0.0/12) is what" >&2
  echo "lets HTTPS visitors through; leave it empty unless you know you need something else." >&2
fi

# 3. Recreate the containers so the server and reply runner read the new origins.
if [ "$update" = true ]; then
  sh scripts/pi-update.sh --trusted-lan
elif [ "$changed" = "yes" ]; then
  echo "Skipped the update (--no-update). Run 'sh scripts/pi-update.sh --trusted-lan' before using $origin."
  exit 0
fi

# 4. Check the HTTPS address end to end from the Pi itself (pinned to its Tailscale IP, so it goes through
# Tailscale Serve even when this host doesn't use MagicDNS).
check() {
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 --resolve "$host:443:$ts_ip" "$origin$1")" || true
  echo "${code:-000}"
}
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not installed; open $origin/ from a Tailscale device to check it."
  exit 0
fi
attempt=0
until [ "$(check /)" = "200" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 10 ] || fail "$origin/ is not answering. Check 'tailscale serve status' and 'docker compose ps'."
  sleep 3
done
api="$(check /api/characters)"
case "$api" in
  401|403) fail "$origin/api/ was refused ($api). Check that the trusted-LAN override is in use and TRUSTED_PROXIES is empty in $env_file." ;;
  000|5*) fail "$origin/api/ did not answer properly ($api)." ;;
esac
runner="$(check /runner/health)"
[ "$runner" = "200" ] || echo "WARNING: the reply runner did not answer at $origin/runner/health ($runner); replies will run in the tab." >&2

echo
echo "HTTPS is ready: $origin/"
echo "Open it on a phone or PC that is signed in to Tailscale, then turn on Settings > Appearance > Phone notifications."
