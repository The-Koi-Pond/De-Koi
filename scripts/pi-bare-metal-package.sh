#!/usr/bin/env bash
set -eu

version="$(node -p "require('./package.json').version")"
commit="${DE_KOI_SOURCE_COMMIT:-}"
if [ -z "$commit" ] && command -v git >/dev/null 2>&1; then
  commit="$(git rev-parse HEAD 2>/dev/null || true)"
fi
commit="${commit:-unknown}"
short_commit="$(printf '%s' "$commit" | cut -c1-7)"
if [ -z "$short_commit" ]; then
  short_commit="unknown"
fi

output="${1:-dist-pi-bare-metal/de-koi-pi-bare-metal-linux-arm64-v${version}-${short_commit}.tar.gz}"
server_bin="${DE_KOI_SERVER_BIN:-src-tauri/target/release/de-koi-server}"
web_dir="${DE_KOI_WEB_DIST:-dist}"
staging="${DE_KOI_PI_PACKAGE_STAGING:-dist-pi-bare-metal/staging}"
package_name="de-koi"
package_root="${staging}/${package_name}"
manifest_tmp="$(mktemp -d)"
trap 'rm -rf "$manifest_tmp"' EXIT
snapshot_entries=(
  AGENTS.md
  LICENSE.txt
  NOTICE.md
  README.md
  package.json
  pnpm-lock.yaml
  tsconfig.json
  tsconfig.node.json
  deploy
  docs
  scripts
  skills
  src
  src-tauri
)
contract_tar="$manifest_tmp/package-contract.tar.gz"
contract_members="$manifest_tmp/package-members.txt"
final_members="$manifest_tmp/final-members.txt"
required_package_paths=(
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
)

require_manifest_path() {
  required_path="$1"
  manifest_file="$2"
  if ! grep -Fqx "$required_path" "$manifest_file"; then
    echo "Package manifest is missing required runtime path: $required_path" >&2
    exit 1
  fi
}

case "$staging" in
  ""|"/"|".")
    echo "Refusing unsafe staging path: $staging" >&2
    exit 2
    ;;
esac

if [ ! -f "$server_bin" ]; then
  echo "Missing server binary: $server_bin" >&2
  echo "Build it first with: cargo build --manifest-path src-tauri/Cargo.toml --release --bin de-koi-server --no-default-features --features server" >&2
  exit 1
fi

if [ ! -d "$web_dir" ] || [ ! -f "$web_dir/index.html" ]; then
  echo "Missing web dist: $web_dir/index.html" >&2
  echo "Build it first with: pnpm build" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "A git checkout is required so the package includes only tracked runtime snapshot files." >&2
  exit 1
fi

rm -rf "$staging"
mkdir -p "$package_root/bin" "$package_root/web" "$package_root/app" "$(dirname "$output")"

cp "$server_bin" "$package_root/bin/de-koi-server"
chmod 0755 "$package_root/bin/de-koi-server"
cp -R "$web_dir"/. "$package_root/web/"

git archive --format=tar HEAD -- "${snapshot_entries[@]}" | tar -xf - -C "$package_root/app"

{
  printf 'package_schema=1\n'
  printf 'package_root=%s\n' "$package_name"
  printf 'version=%s\n' "$version"
  printf 'source_commit=%s\n' "$commit"
  printf 'target=linux-arm64\n'
  printf 'created_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} > "$package_root/VERSION"

> "$package_root/PACKAGE-MANIFEST.txt"
tar -C "$staging" -czf "$contract_tar" "$package_name"
tar -tzf "$contract_tar" \
  | awk -v root="$package_name/" 'index($0, root) == 1 && $0 !~ /\/$/ { print substr($0, length(root) + 1) }' \
  | sort > "$contract_members"
cp "$contract_members" "$package_root/PACKAGE-MANIFEST.txt"
for required_path in "${required_package_paths[@]}"; do
  require_manifest_path "$required_path" "$package_root/PACKAGE-MANIFEST.txt"
done

tar -C "$staging" -czf "$output" "$package_name"

tar -tzf "$output" \
  | awk -v root="$package_name/" 'index($0, root) == 1 && $0 !~ /\/$/ { print substr($0, length(root) + 1) }' \
  | sort > "$final_members"
if ! cmp -s "$package_root/PACKAGE-MANIFEST.txt" "$final_members"; then
  echo "Package manifest does not match final tarball members." >&2
  diff -u "$package_root/PACKAGE-MANIFEST.txt" "$final_members" >&2 || true
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$output" > "$output.sha256"
fi

echo "Wrote $output"
