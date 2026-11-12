# De-Koi {{VERSION}} ({{CHANNEL}})

## Get De-Koi

- **Android phone:** [download De-Koi for Android](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/De-Koi_{{VERSION}}_android-arm64.apk)
- **Windows:** [download the installer](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/De-Koi_{{VERSION}}_windows-x64-setup.exe)
- **Linux:** [AppImage](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/De-Koi_{{VERSION}}_linux-x64.AppImage) or [.deb](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/De-Koi_{{VERSION}}_linux-x64.deb)

**Installing on Android.** De-Koi isn't in the Play Store, so Android shows a few warnings. They're normal for any app installed this way:

1. Chrome says **"File might be harmful"**. Tap **Download anyway**.
2. Open the file: tap **Open** when the download finishes, or find it in Chrome's menu (⋮) under **Downloads**.
3. Android says it **isn't allowed to install unknown apps from this source**. Tap **Settings**, turn on **Allow from this source**, then go back. If the install screen doesn't come back, open the file again.
4. Tap **Install**, then **Open**. In De-Koi, choose **Log in with OpenRouter** to get a free AI model.

{{OPERATOR_NOTES}}

## Before you install

- **Back up first.** Open Settings > Privacy & Data > Backups & exports and create a backup. Beta builds can still have bugs that touch your data.
- This is a **{{CHANNEL_LOWER}}** release. Real chats are fine, but keep that backup until you're sure everything still works.

## Downloads

| Platform                   | File                                       | Notes                                                                                                                 |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Windows 10/11 (x64)        | `De-Koi_{{VERSION}}_windows-x64-setup.exe` | Installer. {{WINDOWS_SIGNING}}                                                                                        |
| Linux (x64)                | `De-Koi_{{VERSION}}_linux-x64.AppImage`    | Portable app. Make it executable, then run it.                                                                        |
| Linux (x64, Debian/Ubuntu) | `De-Koi_{{VERSION}}_linux-x64.deb`         | Install with your package manager.                                                                                    |
| Android (64-bit ARM)       | `De-Koi_{{VERSION}}_android-arm64.apk`     | Signed with De-Koi's release key. Open it on your phone and allow installs from your browser or files app when asked. |
| All                        | `SHA256SUMS.txt`                           | Checksums for every file above.                                                                                       |
| Updater                    | `latest.json` and `*.sig`                  | Used by the app's auto-updater. You don't need to download these.                                                     |

macOS and iOS are not part of this release yet.

## Updating

- **Windows and Linux:** De-Koi checks for updates when it starts. When a new release is out it asks "Install and restart?". Choose it and De-Koi downloads the update, checks its signature, installs it and opens again. Your chats and settings stay where they are.
- **Android:** download the new APK from this page and install it over the old one. Android only accepts it when it's signed with the same key, and your data stays.
- Every desktop update is signed with De-Koi's update key, and the app refuses any download whose signature doesn't match.
- **If an update fails:** come back to this page (GitHub Releases), download the file for your platform and install it over the old version.
- Settings > Advanced > Check for Updates still works, and Open Release brings you to this page.

## Build identity

- Version: `{{VERSION}}`
- Tag: `{{TAG}}`
- Source commit: [`{{COMMIT}}`](https://github.com/{{REPOSITORY}}/tree/{{COMMIT}})

## License and source

De-Koi is an unofficial project that began as a fork of Marinara Engine. It is a separate project and is not an official Marinara Engine release, support channel, or distribution. It is not sponsored by, endorsed by, or released on behalf of Marinara Engine, Spicy Marinara, Pasta Devs, or the Marinara Engine project.

De-Koi is licensed under the GNU Affero General Public License version 3. The complete corresponding source for every file in this release is the source commit above. See [`LICENSE.txt`](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/LICENSE.txt) and [`NOTICE.md`](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/NOTICE.md).
