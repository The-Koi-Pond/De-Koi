# Release Readiness Checklist

Use this checklist before publishing user-facing De-Koi release notes, install
pages, or screenshots for the current desktop/runtime architecture.

## Release Identity

- Release page points to `The-Koi-Pond/De-Koi`.
- Release notes state that De-Koi is an unofficial modified fork of Marinara
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
- Unsigned, unnotarized, or debug-signed artifacts are clearly called out.
- The release notes say whether users should test with throwaway data.
- Installer, archive, APK, Docker, and source-build instructions match the
  actual artifacts attached to the release.

## Install And Update Copy

- Install instructions send users to GitHub Releases as the download source of
  truth.
- Update instructions describe manual replacement through the downloaded
  platform artifact.
- The Settings > Advanced update check is described as a handoff to the release
  page, not as a silent auto-install flow.
- Failed update recovery tells users to open GitHub Releases and download the
  intended release manually.
- Release notes do not mention signed Tauri auto-updates unless that support has
  been implemented, signed, and verified.

## Screenshots

- Fresh screenshots exist for the current De-Koi UI:
  - conversation mode;
  - roleplay mode;
  - game mode;
  - settings;
  - provider connections.
- Captures avoid secrets, private chats, API keys, personal file paths, and
  unreleased user data.
- Screenshots match the release build or the exact source commit used for the
  release notes.
- Missing screenshots are represented with documented placeholders from
  `docs/screenshot-guidance.md`, not by restoring stale images.

## Verification

- `pnpm check:security-policy` passes. The current `csp: null` value remains a
  compatibility exception until chat, roleplay, game, themes, fonts, managed
  assets, and provider connections pass an enforced policy. Asset-protocol
  scope must not widen beyond the reviewed ceiling.
- `pnpm check:docs` passes for docs and guidance changes.
- `pnpm tauri build` or the release workflow succeeds for the release artifact
  being documented.
- Release notes mention any skipped checks or manual-only verification.
- PR or release text does not restore old `staging`, package-workspace, legacy
  launcher, or stable updater claims.
