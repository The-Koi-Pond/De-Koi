#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: sudo sh scripts/pi-bare-metal-update.sh <package.tar.gz>

Install or update a De-Koi bare-metal Raspberry Pi package.

Inputs:
  <package.tar.gz>              Local path or https URL.
  DE_KOI_PI_PACKAGE_URL         Fallback package URL when no argument is passed.
  DE_KOI_PI_PACKAGE_SHA256      Optional expected SHA-256 for the package.
  DE_KOI_PUBLIC_ORIGIN          Optional browser origin, for example https://de-koi.example.duckdns.org.
  DE_KOI_INSTALL_ROOT           Default: /opt/de-koi
  DE_KOI_DATA_DIR               Default: /var/lib/de-koi
  DE_KOI_SERVICE_USER           Default: de-koi
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo sh scripts/pi-bare-metal-update.sh <package.tar.gz>" >&2
  exit 1
fi

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
package_root="$extract_dir/de-koi"

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

version="$(awk -F= '$1 == "version" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
commit="$(awk -F= '$1 == "source_commit" { print $2 }' "$package_root/VERSION" 2>/dev/null || true)"
short_commit="$(printf '%s' "${commit:-unknown}" | cut -c1-7)"
release_id="v${version:-unknown}-${short_commit:-unknown}-$(date -u '+%Y%m%d%H%M%S')"
release_dir="$install_root/releases/$release_id"

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

if [ ! -f "$env_file" ]; then
  cors_origin="${public_origin:-http://127.0.0.1:7860}"
  csrf_origin="${public_origin:-http://127.0.0.1:7860}"
  cat > "$env_file" <<EOF
DE_KOI_SERVER_ADDR=127.0.0.1:8787
DE_KOI_DATA_DIR=$data_dir
DE_KOI_REPO_ROOT=$install_root/current/app
DE_KOI_RESOURCE_DIR=$install_root/current/app/src-tauri
CORS_ORIGINS=$cors_origin
CSRF_TRUSTED_ORIGINS=$csrf_origin
ADMIN_SECRET=
BASIC_AUTH_USER=
BASIC_AUTH_PASS=
IP_ALLOWLIST=
TRUSTED_PROXIES=
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
