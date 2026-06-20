# Release Update Strategy

De-Koi refactor desktop builds use a manual GitHub Releases install and update
handoff.

The in-app update check may tell the user that a newer release exists and open
the matching GitHub Release page, but the app must not silently download or
install desktop updates. Stable refactor releases keep this manual-release
behavior until maintainers explicitly add signed Tauri updater support.

This policy matches the current refactor architecture:

- the user-facing app is the Tauri desktop bundle;
- the React UI is bundled into the desktop webview for production builds;
- the optional Rust runtime is an API server only and does not serve the React UI;
- storage is local file-backed JSON collections plus managed asset files;
- provider calls, local model sidecar management, storage, assets, and imports are
  privileged Rust/Tauri capabilities.

## End-User Install Guidance

Use the GitHub Release page for the version being installed as the source of
truth for downloads, release notes, source commit, license notices, and known
risks.

For a published desktop release:

1. Open the GitHub Release page for the desired De-Koi version.
2. Download the artifact for the target operating system and CPU architecture.
3. Read the release notes for pre-alpha, unsigned, debug-signed, migration, or
   compatibility warnings.
4. Keep access to the matching source commit, `LICENSE.txt`, and `NOTICE.md`
   listed by the release.
5. Install or replace the desktop app using the operating system's normal
   installer or bundle flow.

Pre-alpha builds are test builds, not a stable update channel. They may be
unsigned, unnotarized, debug-signed, marked as GitHub pre-releases, and published
with `make_latest=false`. Test them with throwaway data unless the release notes
explicitly say otherwise.

Source users can still run or build the app from a checkout with `pnpm tauri dev`
or `pnpm tauri build`. Source builds are developer workflows, not a substitute
for a release artifact that includes user-facing notes, screenshots, license
metadata, and exact source identification.

Source users who intentionally want to track current `main` can use
`.\start-main.cmd` on Windows. That launcher updates the git checkout to
`origin/main`, rebuilds the local Tauri executable when needed, and starts the
desktop app. It is a source workflow, not a stable release installer or signed
auto-update channel.

## End-User Update Guidance

Updates are manual in the current refactor build.

1. In De-Koi, open Settings > Advanced and run the update check.
2. If a newer version is available, open the matching GitHub Release page.
3. Download the replacement artifact for the same platform.
4. Close De-Koi before replacing the app.
5. Install the downloaded artifact through the platform's normal installer or
   bundle replacement flow.
6. If the update handoff fails, go directly to GitHub Releases and download the
   latest intended release manually.

The current update flow must not claim that De-Koi has applied an update unless
the user completed that platform installer or replacement step.

## Current Policy

- GitHub Releases in `The-Koi-Pond/De-Koi` are the source of truth for desktop release downloads.
- The app update UI should describe updates as manual installs.
- `update_check` may compare the current version against GitHub Releases.
- `update_apply` should open the release page or return a manual-update result.
- `start-main.cmd` may update source checkouts to `origin/main`; release builds
  must not present that source workflow as a silent desktop installer update.
- Pre-alpha builds must not publish or advertise updater metadata.
- Failed update handoff recovery is to download the latest release manually from
  GitHub Releases.
- Release notes should identify whether the build is stable, pre-alpha,
  unsigned, unnotarized, debug-signed, source-only, or meant for throwaway data.
- Release notes should link the corresponding source commit and license notices.

## Automatic Updater Requirements

Signed automatic updates are out of scope until a follow-up release/distribution
plan defines:

- supported platforms;
- Tauri updater plugin and configuration;
- signing key ownership and secret custody;
- public update keys embedded in app config;
- release metadata location and publication flow;
- platform-specific artifact signing;
- user-facing recovery copy for failed automatic updates.

Each platform or release surface should be implemented as a separate follow-up
issue instead of one broad updater PR.
