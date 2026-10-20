# Source Main-Channel Launcher

De-Koi's release installers are fixed desktop artifacts. They never pull
commits from `main`; they update only to signed GitHub releases, after the user
agrees (see [`release-update-strategy.md`](release-update-strategy.md)).

For source users who intentionally want a moving `main` channel, use the
launcher from a git checkout:

```powershell
.\start-main.cmd
```

The launcher:

1. Fetches `origin/main`.
2. Fast-forwards a local `main` checkout, or checks out `origin/main` detached
   when started from another branch or detached release checkout.
3. Temporarily stashes tracked local changes only when fast-forwarding local
   `main`, then reapplies them.
4. Runs `pnpm install` and `pnpm tauri build --no-bundle` when the commit changed
   or the release executable is missing.
5. Starts `src-tauri\target\release\de-koi.exe`.

When started from another branch or a detached checkout, tracked local changes
must be committed or stashed first. The launcher will not apply feature-branch
edits onto the detached `origin/main` build.

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

This is a developer/source workflow, not a release update channel. Source
builds don't carry the signed updater; release builds from the `Release`
workflow do. Both use the same data folder (`com.de-koi.app`).
