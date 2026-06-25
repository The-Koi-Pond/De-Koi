#!/usr/bin/env bash
set -eu

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/pi-bare-metal-update.sh [--refresh-env] <package.tar.gz>
       bash scripts/pi-bare-metal-update.sh --validate-only <package.tar.gz>

Install or update a De-Koi bare-metal Raspberry Pi package.

Inputs:
  --refresh-env                 Rewrite safe origin/path settings in the runtime env file.
  --validate-only               Validate the package contract without installing.
  <package.tar.gz>              Local path or https URL.
  DE_KOI_PI_PACKAGE_URL         Fallback package URL when no argument is passed.
  DE_KOI_PI_PACKAGE_SHA256      Optional expected SHA-256 for the package.
  DE_KOI_PUBLIC_ORIGIN          Optional browser origin, for example https://de-koi.example.duckdns.org.
  DE_KOI_INSTALL_ROOT           Default: /opt/de-koi
  DE_KOI_DATA_DIR               Default: /var/lib/de-koi
  DE_KOI_SERVICE_USER           Default: de-koi
EOF
}

refresh_env=false
validate_only=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --refresh-env|--reconfigure)
      refresh_env=true
      shift
      ;;
    --validate-only)
      validate_only=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

package_source="${1:-${DE_KOI_PI_PACKAGE_URL:-}}"
if [ -z "$package_source" ]; then
  usage >&2
  exit 2
fi

install_root="${DE_KOI_INSTALL_ROOT:-/opt/de-koi}"
data_dir="${DE_KOI_DATA_DIR:-/var/lib/de-koi}"
service_user="${DE_KOI_SERVICE_USER:-de-koi}"
public_origin="${DE_KOI_PUBLIC_ORIGIN:-}"
env_dir="/etc/de-koi"
env_file="$env_dir/de-koi-server.env"
service_file="/etc/systemd/system/de-koi-server.service"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

package_file="$tmp_dir/de-koi-pi-bare-metal.tar.gz"
case "$package_source" in
  http://*|https://*)
    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is required to download $package_source" >&2
      exit 1
    fi
    curl -fL "$package_source" -o "$package_file"
    ;;
  *)
    if [ ! -f "$package_source" ]; then
      echo "Package not found: $package_source" >&2
      exit 1
    fi
    cp "$package_source" "$package_file"
    ;;
esac

if [ -n "${DE_KOI_PI_PACKAGE_SHA256:-}" ]; then
  actual="$(sha256sum "$package_file" | awk '{print $1}')"
  if [ "$actual" != "$DE_KOI_PI_PACKAGE_SHA256" ]; then
    echo "SHA-256 mismatch for $package_source" >&2
    echo "expected: $DE_KOI_PI_PACKAGE_SHA256" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi
fi

extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"
tar -xzf "$package_file" -C "$extract_dir"
top_levels="$(tar -tzf "$package_file" | awk -F/ 'NF > 0 && $1 != "" { print $1 }' | sort -u)"
top_level_count="$(printf '%s\n' "$top_levels" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$top_level_count" != "1" ]; then
  echo "Package must contain exactly one top-level directory; found:" >&2
  printf '%s\n' "$top_levels" >&2
  exit 1
fi

package_root_name="$(printf '%s\n' "$top_levels" | sed -n '1p')"
package_root="$extract_dir/$package_root_name"

manifest_root="$(awk -F= '$1 == "package_root" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
manifest_schema="$(awk -F= '$1 == "package_schema" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
if [ "$package_root_name" != "de-koi" ] || [ "$manifest_root" != "de-koi" ] || [ "$manifest_schema" != "1" ]; then
  echo "Package root contract mismatch." >&2
  echo "top-level: $package_root_name" >&2
  echo "manifest package_root: ${manifest_root:-missing}" >&2
  echo "manifest package_schema: ${manifest_schema:-missing}" >&2
  exit 1
fi

if [ ! -x "$package_root/bin/de-koi-server" ]; then
  echo "Package is missing bin/de-koi-server" >&2
  exit 1
fi
if [ ! -f "$package_root/web/index.html" ]; then
  echo "Package is missing web/index.html" >&2
  exit 1
fi
if [ ! -d "$package_root/app/src-tauri/resources" ]; then
  echo "Package is missing app/src-tauri/resources" >&2
  exit 1
fi
if [ ! -s "$package_root/PACKAGE-MANIFEST.txt" ]; then
  echo "Package is missing PACKAGE-MANIFEST.txt" >&2
  exit 1
fi

if [ "$validate_only" = true ]; then
  echo "Package contract is valid."
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash scripts/pi-bare-metal-update.sh <package.tar.gz>" >&2
  exit 1
fi

version="$(awk -F= '$1 == "version" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
commit="$(awk -F= '$1 == "source_commit" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
short_commit="$(printf '%s' "${commit:-unknown}" | cut -c1-7)"
release_id="v${version:-unknown}-${short_commit:-unknown}-$(date -u '+%Y%m%d%H%M%S')"
release_dir="$install_root/releases/$release_id"

cors_origin="${public_origin:-http://127.0.0.1:7860}"
csrf_origin="${public_origin:-http://127.0.0.1:7860}"
if [ -f "$env_file" ] && [ "$refresh_env" != true ] && [ -n "$public_origin" ]; then
  existing_cors="$(awk -F= '$1 == "CORS_ORIGINS" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  existing_csrf="$(awk -F= '$1 == "CSRF_TRUSTED_ORIGINS" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  if [ "$existing_cors" != "$cors_origin" ] || [ "$existing_csrf" != "$csrf_origin" ]; then
    echo "Existing runtime env origin differs from DE_KOI_PUBLIC_ORIGIN." >&2
    echo "Run again with --refresh-env to update CORS_ORIGINS and CSRF_TRUSTED_ORIGINS while preserving secrets." >&2
    exit 1
  fi
fi

if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home-dir "$data_dir" --create-home --shell /usr/sbin/nologin "$service_user"
fi

install -d -o root -g root -m 0755 "$install_root" "$install_root/releases"
install -d -o "$service_user" -g "$service_user" -m 0750 "$data_dir"
install -d -o root -g root -m 0755 "$env_dir"

cp -a "$package_root" "$release_dir"
chown -R root:root "$release_dir"

ln -sfn "$release_dir" "$install_root/current.tmp"
mv -Tf "$install_root/current.tmp" "$install_root/current"

if [ ! -f "$env_file" ] || [ "$refresh_env" = true ]; then
  admin_secret=""
  basic_auth_user=""
  basic_auth_pass=""
  ip_allowlist=""
  trusted_proxies=""
  if [ -f "$env_file" ]; then
    admin_secret="$(awk -F= '$1 == "ADMIN_SECRET" { print substr($0, index($0, "=") + 1) }' "$env_file")"
    basic_auth_user="$(awk -F= '$1 == "BASIC_AUTH_USER" { print substr($0, index($0, "=") + 1) }' "$env_file")"
    basic_auth_pass="$(awk -F= '$1 == "BASIC_AUTH_PASS" { print substr($0, index($0, "=") + 1) }' "$env_file")"
    ip_allowlist="$(awk -F= '$1 == "IP_ALLOWLIST" { print substr($0, index($0, "=") + 1) }' "$env_file")"
    trusted_proxies="$(awk -F= '$1 == "TRUSTED_PROXIES" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  fi
  cat > "$env_file" <<EOF
DE_KOI_SERVER_ADDR=127.0.0.1:8787
DE_KOI_DATA_DIR=$data_dir
DE_KOI_REPO_ROOT=$install_root/current/app
DE_KOI_RESOURCE_DIR=$install_root/current/app/src-tauri
CORS_ORIGINS=$cors_origin
CSRF_TRUSTED_ORIGINS=$csrf_origin
ADMIN_SECRET=$admin_secret
BASIC_AUTH_USER=$basic_auth_user
BASIC_AUTH_PASS=$basic_auth_pass
IP_ALLOWLIST=$ip_allowlist
TRUSTED_PROXIES=$trusted_proxies
EOF
  chmod 0640 "$env_file"
fi

cat > "$service_file" <<EOF
[Unit]
Description=De-Koi hostable runtime
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=3

[Service]
Type=simple
User=$service_user
Group=$service_user
EnvironmentFile=$env_file
WorkingDirectory=$install_root/current
ExecStart=$install_root/current/bin/de-koi-server
Restart=on-failure
RestartSec=10
TimeoutStopSec=20

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$data_dir
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now de-koi-server.service
systemctl restart de-koi-server.service

if command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:8787/health >/dev/null
fi

echo "De-Koi bare-metal runtime installed at $install_root/current"
echo "Serve the web shell from $install_root/current/web and proxy /api/ plus /health to 127.0.0.1:8787."
