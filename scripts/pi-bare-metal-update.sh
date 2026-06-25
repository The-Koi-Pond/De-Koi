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
package_name="de-koi"
env_dir="/etc/de-koi"
env_file="$env_dir/de-koi-server.env"
service_file="/etc/systemd/system/de-koi-server.service"
required_manifest_entries="
bin/de-koi-server
web/index.html
app/package.json
app/scripts/pi-bare-metal-update.sh
app/docs/pi-bare-metal.md
app/src-tauri/Cargo.toml
app/src-tauri/src/bin/de-koi-server.rs
app/src-tauri/src/state.rs
app/src-tauri/resources/default-data/db/default-preset-v2.json
app/src-tauri/resources/default-data/game-assets/manifest.json
"

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

listing_file="$tmp_dir/package-listing.txt"
tar -tzf "$package_file" > "$listing_file"
if awk 'BEGIN { bad = 0 } $0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { print; bad = 1 } END { exit bad }' "$listing_file" >/dev/null; then
  :
else
  echo "Package contains unsafe archive paths." >&2
  awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { print }' "$listing_file" >&2
  exit 1
fi

top_levels="$(awk -F/ 'NF > 0 && $1 != "" { print $1 }' "$listing_file" | sort -u)"
top_level_count="$(printf '%s\n' "$top_levels" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$top_level_count" != "1" ]; then
  echo "Package must contain exactly one top-level directory; found:" >&2
  printf '%s\n' "$top_levels" >&2
  exit 1
fi

package_root_name="$(printf '%s\n' "$top_levels" | sed -n '1p')"
if [ "$package_root_name" != "$package_name" ]; then
  echo "Package root contract mismatch." >&2
  echo "top-level: $package_root_name" >&2
  echo "expected top-level: $package_name" >&2
  exit 1
fi

for required_entry in "$package_name/VERSION" "$package_name/PACKAGE-MANIFEST.txt" "$package_name/bin/de-koi-server" "$package_name/web/index.html"; do
  if ! grep -Fqx "$required_entry" "$listing_file"; then
    echo "Package is missing required archive entry: $required_entry" >&2
    exit 1
  fi
done

version_contract="$(tar -xOzf "$package_file" "$package_name/VERSION" 2>/dev/null || true)"
manifest_root="$(printf '%s\n' "$version_contract" | awk -F= '$1 == "package_root" { print $2 }')"
manifest_schema="$(printf '%s\n' "$version_contract" | awk -F= '$1 == "package_schema" { print $2 }')"
if [ "$manifest_root" != "$package_name" ] || [ "$manifest_schema" != "1" ]; then
  echo "Package root contract mismatch." >&2
  echo "top-level: $package_root_name" >&2
  echo "manifest package_root: ${manifest_root:-missing}" >&2
  echo "manifest package_schema: ${manifest_schema:-missing}" >&2
  exit 1
fi

package_manifest="$(tar -xOzf "$package_file" "$package_name/PACKAGE-MANIFEST.txt" 2>/dev/null || true)"
tar -tzf "$package_file" \
  | awk -v root="$package_name/" 'index($0, root) == 1 && $0 !~ /\/$/ { print substr($0, length(root) + 1) }' \
  | sort > "$tmp_dir/tar-members.txt"
printf '%s\n' "$package_manifest" | sed '/^$/d' | sort > "$tmp_dir/package-manifest.txt"
if ! cmp -s "$tmp_dir/package-manifest.txt" "$tmp_dir/tar-members.txt"; then
  echo "Package manifest does not match archive members." >&2
  exit 1
fi
for required_manifest_entry in $required_manifest_entries; do
  if ! printf '%s\n' "$package_manifest" | grep -Fqx "$required_manifest_entry"; then
    echo "Package manifest is missing required runtime path: $required_manifest_entry" >&2
    exit 1
  fi
done

extract_dir="$tmp_dir/extract"
mkdir -p "$extract_dir"
tar -xzf "$package_file" -C "$extract_dir"
extracted_top_levels="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
extracted_top_level_count="$(printf '%s\n' "$extracted_top_levels" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "$extracted_top_level_count" != "1" ] || [ "$extracted_top_levels" != "$package_name" ]; then
  echo "Extracted package root contract mismatch." >&2
  echo "extracted top-level:" >&2
  printf '%s\n' "$extracted_top_levels" >&2
  exit 1
fi
package_root="$extract_dir/$package_root_name"
if [ ! -d "$package_root" ] || [ -L "$package_root" ]; then
  echo "Extracted package root is not a normal directory: $package_root_name" >&2
  exit 1
fi
(cd "$package_root" && find . -type f -printf '%P\n' | sort > "$tmp_dir/extracted-members.txt")
if ! cmp -s "$tmp_dir/package-manifest.txt" "$tmp_dir/extracted-members.txt"; then
  echo "Extracted package files do not match package manifest." >&2
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
if [ -f "$env_file" ] && [ "$refresh_env" != true ]; then
  existing_cors="$(awk -F= '$1 == "CORS_ORIGINS" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  existing_csrf="$(awk -F= '$1 == "CSRF_TRUSTED_ORIGINS" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  existing_managed_origin="$(awk -F= '$1 == "DE_KOI_MANAGED_PUBLIC_ORIGIN" { print substr($0, index($0, "=") + 1) }' "$env_file")"
  if [ -z "$existing_managed_origin" ] && { [ -n "$existing_cors" ] || [ -n "$existing_csrf" ]; }; then
    if [ -n "$public_origin" ] && [ "$existing_cors" = "$cors_origin" ] && [ "$existing_csrf" = "$csrf_origin" ]; then
      refresh_env=true
    else
      echo "Existing runtime env has origin settings but no DE_KOI_MANAGED_PUBLIC_ORIGIN marker." >&2
      echo "Rerun with --refresh-env and DE_KOI_PUBLIC_ORIGIN set to the current browser URL to backfill the managed origin contract while preserving secrets." >&2
      exit 1
    fi
  fi
  if [ -z "$public_origin" ] && [ -n "$existing_managed_origin" ]; then
    echo "Existing runtime env was configured with DE_KOI_PUBLIC_ORIGIN=$existing_managed_origin." >&2
    echo "Set DE_KOI_PUBLIC_ORIGIN on this run, or run with --refresh-env to intentionally update managed origin settings." >&2
    exit 1
  fi
  if [ -n "$public_origin" ] && { [ "$existing_cors" != "$cors_origin" ] || [ "$existing_csrf" != "$csrf_origin" ] || [ "$existing_managed_origin" != "$public_origin" ]; }; then
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

set_env_value() {
  key="$1"
  value="$2"
  file="$3"
  tmp_env="$tmp_dir/env.$key"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (found == 0) print key "=" value }
  ' "$file" > "$tmp_env"
  cat "$tmp_env" > "$file"
}

if [ ! -f "$env_file" ]; then
  cat > "$env_file" <<EOF
DE_KOI_SERVER_ADDR=127.0.0.1:8787
DE_KOI_DATA_DIR=$data_dir
DE_KOI_REPO_ROOT=$install_root/current/app
DE_KOI_RESOURCE_DIR=$install_root/current/app/src-tauri
DE_KOI_MANAGED_PUBLIC_ORIGIN=$public_origin
CORS_ORIGINS=$cors_origin
CSRF_TRUSTED_ORIGINS=$csrf_origin
ADMIN_SECRET=
BASIC_AUTH_USER=
BASIC_AUTH_PASS=
IP_ALLOWLIST=
TRUSTED_PROXIES=
EOF
  chmod 0640 "$env_file"
elif [ "$refresh_env" = true ]; then
  set_env_value DE_KOI_SERVER_ADDR "127.0.0.1:8787" "$env_file"
  set_env_value DE_KOI_DATA_DIR "$data_dir" "$env_file"
  set_env_value DE_KOI_REPO_ROOT "$install_root/current/app" "$env_file"
  set_env_value DE_KOI_RESOURCE_DIR "$install_root/current/app/src-tauri" "$env_file"
  set_env_value DE_KOI_MANAGED_PUBLIC_ORIGIN "$public_origin" "$env_file"
  set_env_value CORS_ORIGINS "$cors_origin" "$env_file"
  set_env_value CSRF_TRUSTED_ORIGINS "$csrf_origin" "$env_file"
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
