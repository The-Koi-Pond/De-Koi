# De-Koi {{VERSION}} ({{CHANNEL}})

{{OPERATOR_NOTES}}

## Before you install

- **Back up first.** Open Settings > Privacy & Data > Backups & exports and create a backup. Beta builds can still have bugs that touch your data.
- This is a **{{CHANNEL_LOWER}}** release. Real chats are fine, but keep that backup until you're sure everything still works.

## Downloads

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (x64) | `De-Koi_{{VERSION}}_windows-x64-setup.exe` | Installer. {{WINDOWS_SIGNING}} |
| Linux (x64) | `De-Koi_{{VERSION}}_linux-x64.AppImage` | Portable app. Make it executable, then run it. |
| Linux (x64, Debian/Ubuntu) | `De-Koi_{{VERSION}}_linux-x64.deb` | Install with your package manager. |
| All | `SHA256SUMS.txt` | Checksums for every file above. |
| Updater | `latest.json` and `*.sig` | Used by the app's auto-updater. You don't need to download these. |

Android and macOS are not part of this release yet.

## Updating

- **Windows and Linux:** De-Koi checks for updates when it starts. When a new release is out it asks "Install and restart?". Choose it and De-Koi downloads the update, checks its signature, installs it and opens again. Your chats and settings stay where they are.
- Every update is signed with De-Koi's update key, and the app refuses any download whose signature doesn't match.
- **If an update fails:** come back to this page (GitHub Releases), download the file for your platform and install it over the old version.
- Settings > Advanced > Check for Updates still works, and Open Release brings you to this page.

## Build identity

- Version: `{{VERSION}}`
- Tag: `{{TAG}}`
- Source commit: [`{{COMMIT}}`](https://github.com/{{REPOSITORY}}/tree/{{COMMIT}})

## License and source

De-Koi is an unofficial modified fork of Marinara Engine. It is a separate project and is not an official Marinara Engine release, support channel, or distribution. It is not sponsored by, endorsed by, or released on behalf of Marinara Engine, Spicy Marinara, Pasta Devs, or the Marinara Engine project.

De-Koi is licensed under the GNU Affero General Public License version 3. The complete corresponding source for every file in this release is the source commit above. See [`LICENSE.txt`](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/LICENSE.txt) and [`NOTICE.md`](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/NOTICE.md).
