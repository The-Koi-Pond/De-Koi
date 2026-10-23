# Release Readiness Checklist

Use this checklist before publishing user-facing De-Koi release notes, install
pages, or screenshots for the current desktop/runtime architecture.

## Release Identity

- Release page points to `The-Koi-Pond/De-Koi`.
- Release notes state that De-Koi is an unofficial project that began as a fork of Marinara
  Engine, not an official Marinara Engine release or support channel.
- Release notes identify the exact source commit or tag for the artifacts.
- `LICENSE.txt` and `NOTICE.md` are linked from the release notes.
- AGPL source availability is described for binaries, installers, Docker images,
  APKs, pre-release builds, and hosted network services.

## Artifact Expectations

- Each artifact name includes De-Koi, version, platform, and architecture.
- Desktop artifacts are produced from the Tauri desktop app, not from a legacy
  package workspace or Node server bundle.
- The optional Rust runtime is documented as an API server only; it does not
  serve the React UI and is not the desktop app installer.
- Pre-alpha artifacts are marked as GitHub pre-releases and are not promoted as
  the latest stable release.
- Unsigned, unnotarized, or debug-signed artifacts are clearly called out. Until
  Authenticode signing ships, release notes say the Windows installer is
  unsigned and SmartScreen will warn.
- Release desktop bundles carry updater signatures; the release Android APK is
  signed with the release keystore.
- The release notes say whether users should test with throwaway data.
- Installer, archive, APK, Docker, and source-build instructions match the
  actual artifacts attached to the release.

## Install And Update Copy

- Install instructions send users to GitHub Releases as the download source of
  truth and link [`install.md`](install.md).
- Desktop release notes describe the signed auto-update prompt ("Install and
  restart?") and say updates are verified with De-Koi's update key.
- Android release notes describe manual APK replacement over the old install.
- The Settings > Advanced update check is described as a check plus a link to
  the release page, not as the installer.
- Failed update recovery tells users to open GitHub Releases and download the
  intended release manually.
- Pre-alpha release notes never mention auto-updates; pre-alpha builds don't
  carry the updater.
- Backup copy names the exact data folder for each platform (see `install.md`).

## Before Publishing A Release

- The `Release` workflow run is green, including "Build and verify latest.json"
  and the Android APK signature check.
- The draft has the Windows installer, AppImage, `.deb`, APK, every `.sig`,
  `latest.json` and `SHA256SUMS.txt`.
- `latest.json` lists `windows-x86_64-nsis` and `linux-x86_64-appimage`, and
  every URL points at this release's tag.
- At least one install from the previous release has updated to the draft's
  files (or the release notes say this was not tested).
- The draft is marked to become Latest. Pre-alpha releases never are.
- If any PR since the last release changed prompt or generation behavior, one
  quality run per affected mode (1 game + 1 judge pass, release candidate vs
  the previous release tag) shows no score down 1.0 or more. List the scores in
  the release notes draft.

## Screenshots

- Fresh README screenshots exist for the current De-Koi UI (`pnpm docs:readme-screenshots`):
  - conversation mode;
  - roleplay mode;
  - the fanfic request form and chapter reader;
  - the phone layout.
- Captures avoid secrets, private chats, API keys, personal file paths, and
  unreleased user data.
- Screenshots match the release build or the exact source commit used for the
  release notes.
- Missing screenshots are represented with documented placeholders from
  `docs/screenshot-guidance.md`, not by restoring stale images.

## Verification

- `pnpm check:security-policy` passes and rejects `csp: null`, wildcard sources,
  missing Tauri IPC/asset sources, and asset-protocol scope beyond the reviewed
  ceiling.
- The applicable rows in
  [`security/csp-compatibility-matrix.md`](security/csp-compatibility-matrix.md)
  have been exercised in the Tauri renderer for the release candidate.
- `pnpm check:docs` passes for docs and guidance changes.
- `pnpm tauri build` or the release workflow succeeds for the release artifact
  being documented.
- Release notes mention any skipped checks or manual-only verification.
- PR or release text does not restore old `staging`, package-workspace, legacy
  launcher, or stable updater claims.
