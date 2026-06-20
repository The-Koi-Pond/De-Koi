# Source Main-Channel Launcher

De-Koi's release installers are fixed desktop artifacts. They do not silently
pull commits from `main`, and the in-app update check still hands users to
GitHub Releases for manual installer replacement.

For source users who intentionally want a moving `main` channel, use the
launcher from a git checkout:

```powershell
.\start-main.cmd
```

The launcher:

1. Fetches `origin/main`.
2. Fast-forwards a local `main` checkout, or checks out `origin/main` detached
   when started from another branch or detached release checkout.
3. Temporarily stashes tracked local changes when needed, then reapplies them.
4. Runs `pnpm install` and `pnpm tauri build --no-bundle` when the commit changed
   or the release executable is missing.
5. Starts `src-tauri\target\release\de-koi.exe`.

Close De-Koi before launching when an update may need a rebuild; Windows cannot
replace a running executable.

To create a desktop shortcut for this source launcher:

```powershell
.\scripts\update-and-launch.ps1 -InstallDesktopShortcut -NoUpdate -NoBuild -NoLaunch
```

Useful options:

```powershell
.\scripts\update-and-launch.ps1 -NoUpdate
.\scripts\update-and-launch.ps1 -NoBuild
.\scripts\update-and-launch.ps1 -NoLaunch
.\scripts\update-and-launch.ps1 -NoAutoStash
.\scripts\update-and-launch.ps1 -DryRun
```

This is a developer/source workflow, not a stable release update channel. Signed
Tauri auto-updates still require release signing keys, updater metadata,
platform signing/notarization, and a separate publication policy.
