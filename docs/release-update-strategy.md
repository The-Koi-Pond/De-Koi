# Release Update Strategy

De-Koi has several kinds of builds, and they update differently:

| Build                                                 | How it updates                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| **Release** desktop (`vX.Y.Z` on GitHub Releases)     | Signed Tauri auto-update, after the user agrees in a native prompt |
| **Release** Android APK                               | Manual: install the next signed APK over the old one               |
| **Pre-alpha** test builds                             | Manual: download the next pre-alpha build                          |
| **Source** (`pnpm tauri dev/build`, `start-main.cmd`) | Through git (`start-main.cmd` pulls `origin/main` and rebuilds)    |
| **Server / Pi** runtime                               | The [Pi](pi.md) / [VDS](vds.md) update process                     |

User-facing install and update steps live in [`install.md`](install.md).

## Release builds: signed auto-update

Only builds made by the `Release` workflow (`.github/workflows/release.yml`) carry the updater. The workflow merges
`src-tauri/tauri.release.conf.json` over `tauri.conf.json`. That overlay is the only place with `plugins.updater` and
`bundle.createUpdaterArtifacts`, and `pnpm check:security-policy` fails if either shows up anywhere else.

- **Endpoint:** `https://github.com/The-Koi-Pond/De-Koi/releases/latest/download/latest.json`, so the updater follows
  whichever release is marked **Latest**. Pre-alpha releases are never marked Latest.
- **Signatures:** every updater bundle (the Windows NSIS installer, the Linux AppImage and `.deb`) has a minisign
  signature. The app has the public key built in and refuses any download that doesn't match it.
- **Prompt:** about five seconds after start, release builds check `latest.json`. If it's newer, a native OS dialog asks
  "Install and restart?" / "Later". A failed background check (for example offline) is logged and changes nothing.
- **Install:** the app downloads and verifies the bundle, flushes pending storage writes, stops the local model, then
  hands off to the installer (Windows) or replaces the AppImage/package (Linux) and restarts. The data folder is never
  touched.
- **Failure:** a download, signature or install failure shows "Update failed" with a link to GitHub Releases. The app
  stays on its current version.
- `update_check` reports `updateMechanism: "tauri-updater"` and `applyAvailable` for release builds, and `update_apply`
  installs the signed update. Settings > Advanced still offers **Check for Updates** and **Open Release**.

## Keys and secrets

| Purpose                    | Public half (in the repo)                                       | Private half (GitHub secrets)                                                                       |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Desktop updater signatures | `plugins.updater.pubkey` in `src-tauri/tauri.release.conf.json` | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                                   |
| Android APK signing        | `.github/release/android-signing-cert.sha256`                   | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |

- Keys and keystores never go in the repo. `.gitignore` blocks `*.jks`, `*.keystore`, `*.p12` and `*.pfx`.
- Keep an offline backup of both private keys (for example in a password manager). **If the updater key is lost,
  installed apps can never auto-update again**, and users have to reinstall by hand. **If the Android keystore is lost,
  no later APK can install over the existing app**, and users have to uninstall (losing app data) first.
- Real secrets reach only manual `Release` runs from `main`. Pull-request dry runs use throwaway keys.
- Before it creates the release, the workflow checks every updater signature against the committed public key and the
  APK certificate against the committed fingerprint. A wrong or missing secret fails the run.

## Cutting a release

1. Bump the version to `X.Y.Z` in `package.json`, `src-tauri/Cargo.toml` (and `Cargo.lock`) and
   `src-tauri/tauri.conf.json`. The workflow fails if they disagree, if the version isn't plain `x.y.z`, or if tag
   `vX.Y.Z` already exists.
2. Merge that to `main`.
3. Run **Actions > Release > Run workflow** on `main`. Pick the channel (Beta or Stable) and paste the "what's new"
   notes.
4. The workflow builds Windows, Linux and Android, signs and verifies everything, and creates a **draft** release with
   the files, `latest.json`, `SHA256SUMS.txt` and notes from `.github/release/notes-template.md`.
5. Review the draft against [`release-readiness-checklist.md`](release-readiness-checklist.md), then **Publish**.
   Publishing creates the tag and marks the release Latest. Installed release builds see it on their next start.

To pull a bad release, mark an older release as Latest (or delete the bad one) so `latest.json` points back. Apps that
already updated stay on the bad version until a newer release ships, so fix forward with a higher version number.

## Pre-alpha, source and server builds

- Pre-alpha builds (`prealpha-platform-builds.yml`) use their own identity (`com.de-koi.prealpha`), are unsigned, are
  published as non-latest pre-releases, and never include updater metadata. Their update check opens the release page.
- Source builds never auto-update. `start-main.cmd` updates the checkout to `origin/main` and rebuilds. It uses the same
  data folder as the release app (`com.de-koi.app`).
- The server runtime compares its build commit with `main` and points to the Pi/VDS update process.

## Windows code signing

Release installers are **not Authenticode-signed yet**, so Windows SmartScreen warns on first install. Updates
installed through the in-app updater are still verified with De-Koi's update signature. Release notes must say the
installer is unsigned until Authenticode signing ships.
