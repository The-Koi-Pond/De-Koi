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
snapshot_entries="AGENTS.md LICENSE.txt NOTICE.md README.md package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json deploy docs scripts skills src src-tauri"

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

git archive --format=tar HEAD -- $snapshot_entries | tar -xf - -C "$package_root/app"
git ls-tree -r --name-only HEAD -- $snapshot_entries > "$package_root/PACKAGE-MANIFEST.txt"

{
  printf 'package_schema=1\n'
  printf 'package_root=%s\n' "$package_name"
  printf 'version=%s\n' "$version"
  printf 'source_commit=%s\n' "$commit"
  printf 'target=linux-arm64\n'
  printf 'created_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} > "$package_root/VERSION"

tar -C "$staging" -czf "$output" "$package_name"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$output" > "$output.sha256"
fi

echo "Wrote $output"
