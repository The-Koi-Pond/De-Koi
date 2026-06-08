# Release Update Strategy

De-Koi refactor desktop builds use a manual GitHub Releases update handoff.

The in-app update check may tell the user that a newer release exists and open
the matching GitHub Release page, but the app must not silently download or
install desktop updates. Stable refactor releases keep this manual-release
behavior until maintainers explicitly add signed Tauri updater support.

## Current Policy

- GitHub Releases in `The-Koi-Pond/De-Koi` are the source of truth for desktop release downloads.
- The app update UI should describe updates as manual installs.
- `update_check` may compare the current version against GitHub Releases.
- `update_apply` should open the release page or return a manual-update result.
- Pre-alpha builds must not publish or advertise updater metadata.
- Failed update handoff recovery is to download the latest release manually from
  GitHub Releases.

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
