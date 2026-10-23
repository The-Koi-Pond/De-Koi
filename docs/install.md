# Install De-Koi

Download De-Koi from [GitHub Releases](https://github.com/The-Koi-Pond/De-Koi/releases/latest). That page is the
only official download source. Each release lists its files, its source commit and its license notices.

De-Koi is an unofficial project that began as a fork of Marinara Engine. It is not an official Marinara Engine release or support
channel.

## Which file do I need?

| You have                                          | Download                                                       |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Windows 10 or 11 (64-bit)                         | `De-Koi_<version>_windows-x64-setup.exe`                       |
| Linux (64-bit), any distro                        | `De-Koi_<version>_linux-x64.AppImage`                          |
| Debian, Ubuntu or Mint (64-bit)                   | `De-Koi_<version>_linux-x64.deb`                               |
| An Android phone (64-bit, most phones since 2017) | `De-Koi_<version>_android-arm64.apk`                           |
| A Raspberry Pi or a server                        | See the [Pi guide](pi.md) or the [VDS / VPS guide](vds.md)     |
| A Mac                                             | No build yet. [Run from source](../README.md#run-from-source). |

You don't need `latest.json` or the `.sig` files. The app's updater uses them.

## Windows

1. Download `De-Koi_<version>_windows-x64-setup.exe`.
2. Open it. Windows may show **"Windows protected your PC"** because the installer is not Authenticode-signed yet.
   Choose **More info**, check that the app is `De-Koi_<version>_windows-x64-setup.exe`, then choose **Run anyway**.
3. The installer sets De-Koi up for your Windows user. It doesn't need admin rights.

To uninstall, open Windows **Settings > Apps > Installed apps**, find **De-Koi** and choose **Uninstall**. Your chats
and settings stay in `%APPDATA%\com.de-koi.app` unless you tick **Delete the application data** in the uninstaller.

## Linux

**AppImage** (any distro):

```bash
chmod +x De-Koi_<version>_linux-x64.AppImage
./De-Koi_<version>_linux-x64.AppImage
```

**.deb** (Debian, Ubuntu, Mint):

```bash
sudo apt install ./De-Koi_<version>_linux-x64.deb
```

Your chats and settings live in `~/.local/share/com.de-koi.app`.

## Android

1. On your phone, download `De-Koi_<version>_android-arm64.apk` from the release page.
2. Open it. Android asks you to allow installs from your browser or files app. Allow it for that app, then go back and
   choose **Install**.
3. The APK is signed with De-Koi's release key. Android only lets a later De-Koi APK install over this one when it's
   signed with the same key, so a tampered copy can't replace your app or reach your data.

Pre-alpha test builds use a different app id (`com.de_koi.prealpha`), so they install next to the release app and keep
separate data.

## Check a download (optional)

Each release has `SHA256SUMS.txt`. To check a file, put it in the same folder as `SHA256SUMS.txt`, then:

- **Windows (PowerShell):** `Get-FileHash .\De-Koi_<version>_windows-x64-setup.exe` and compare the hash with the
  matching line in `SHA256SUMS.txt`.
- **Linux:** `sha256sum --check --ignore-missing SHA256SUMS.txt`

## Before you update or reinstall: back up

Open **Settings > Privacy & Data > Backups & exports** and create a backup. To be extra safe, close De-Koi and copy the
whole data folder somewhere else:

| Platform | Data folder                     |
| -------- | ------------------------------- |
| Windows  | `%APPDATA%\com.de-koi.app`      |
| Linux    | `~/.local/share/com.de-koi.app` |

That folder holds your chats, characters, settings, saved API keys (`secrets`), images, fonts and local model files.
Copy all of it. The Windows source launcher (`start-main.cmd`) uses the same folder, so it shares data with the
installed app.

## Updating

**Windows and Linux** update themselves. When De-Koi starts and a newer release is out, it asks
**"Install and restart?"**:

1. Choose **Install and restart**.
2. De-Koi downloads the update and checks its signature. It refuses anything that isn't signed with De-Koi's update
   key.
3. De-Koi closes, installs the update and opens again. Your data folder isn't touched. On a `.deb` install, Linux
   first asks for your password so it can install the package.

Choose **Later** to skip it. De-Koi asks again the next time it starts. You can also check any time in
**Settings > Advanced > Check for Updates**, and **Open Release** opens the release page.

**Android** doesn't update itself. Use **Check for Updates** in Settings, open the release, download the new APK and
install it over the old one.

**If an update fails**, De-Koi shows "Update failed" and stays on the version you have. Download the newest file for
your platform from [GitHub Releases](https://github.com/The-Koi-Pond/De-Koi/releases/latest) and install it over the old
version. Your data stays in place.

## Pre-alpha builds

Releases named **"De-Koi Pre-Alpha Test Build"** are team test builds. They are unsigned, never update themselves, can
break badly, and use their own app identity (`De-Koi Pre-Alpha`, `com.de-koi.prealpha`) with separate data. Use them
only with data you don't mind losing.
