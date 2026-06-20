[CmdletBinding()]
param(
  [string]$Remote = "origin",
  [string]$Branch = "main",
  [switch]$NoUpdate,
  [switch]$NoBuild,
  [switch]$NoLaunch,
  [switch]$NoAutoStash,
  [switch]$InstallDesktopShortcut,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LauncherCmd = Join-Path $RepoRoot "start-main.cmd"
$ReleaseExe = Join-Path $RepoRoot "src-tauri\target\release\de-koi.exe"
$IsWindowsHost = [System.IO.Path]::DirectorySeparatorChar -eq "\"

function Write-Step {
  param([string]$Message)
  Write-Host "[de-koi] $Message"
}

function Format-CommandArgument {
  param([string]$Argument)

  if ($Argument -match '[\s"]') {
    return '"' + ($Argument -replace '"', '\"') + '"'
  }

  return $Argument
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [switch]$Capture,
    [switch]$AllowFailure
  )

  $display = (@($FilePath) + $Arguments | ForEach-Object { Format-CommandArgument $_ }) -join " "

  $dryRunReadOnlyCapture =
    $DryRun -and
    $Capture -and
    $FilePath -eq "git" -and
    $Arguments.Count -gt 0 -and
    @("rev-parse", "status", "symbolic-ref") -contains $Arguments[0]

  if ($DryRun -and -not $dryRunReadOnlyCapture) {
    Write-Step "DRY RUN: $display"
    return [pscustomobject]@{
      ExitCode = 0
      Output = ""
    }
  }

  if ($dryRunReadOnlyCapture) {
    Write-Step "DRY RUN read: $display"
  }

  if ($Capture) {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).Trim()

    if ($exitCode -ne 0 -and -not $AllowFailure) {
      if ($text) {
        throw "Command failed ($exitCode): $display`n$text"
      }
      throw "Command failed ($exitCode): $display"
    }

    return [pscustomobject]@{
      ExitCode = $exitCode
      Output = $text
    }
  }

  & $FilePath @Arguments
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "Command failed ($exitCode): $display"
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = ""
  }
}

function Invoke-Git {
  param(
    [string[]]$Arguments,
    [switch]$Capture,
    [switch]$AllowFailure
  )

  return Invoke-External "git" $Arguments -Capture:$Capture -AllowFailure:$AllowFailure
}

function Invoke-Pnpm {
  param([string[]]$Arguments)

  if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
    Invoke-External "pnpm" $Arguments | Out-Null
    return
  }

  if (Get-Command "corepack" -ErrorAction SilentlyContinue) {
    Invoke-External "corepack" (@("pnpm") + $Arguments) | Out-Null
    return
  }

  throw "Missing pnpm. Install pnpm or enable Corepack before using the main-channel launcher."
}

function Get-GitOutput {
  param([string[]]$Arguments)
  return (Invoke-Git $Arguments -Capture).Output
}

function Get-CurrentGitBranch {
  $result = Invoke-Git @("symbolic-ref", "--quiet", "--short", "HEAD") -Capture -AllowFailure
  if ($result.ExitCode -ne 0) {
    return ""
  }

  return $result.Output.Trim()
}

function Install-DesktopShortcut {
  if (-not $IsWindowsHost) {
    throw "Desktop shortcut installation is only supported on Windows."
  }

  $desktop = [Environment]::GetFolderPath("DesktopDirectory")
  $shortcutPath = Join-Path $desktop "De-Koi Main Channel.lnk"

  if ($DryRun) {
    Write-Step "DRY RUN: create desktop shortcut $shortcutPath -> $LauncherCmd"
    return
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $LauncherCmd
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.Description = "Update De-Koi from origin/main, rebuild when needed, and launch the desktop app."

  if (Test-Path $ReleaseExe) {
    $shortcut.IconLocation = "$ReleaseExe,0"
  }

  $shortcut.Save()
  Write-Step "Desktop shortcut created: $shortcutPath"
}

function Assert-GitCheckout {
  if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
    throw "Missing git. Install Git before using the main-channel launcher."
  }

  $root = Get-GitOutput @("rev-parse", "--show-toplevel")
  if ((Resolve-Path $root).Path -ne $RepoRoot) {
    throw "Launcher must run inside the De-Koi git checkout at $RepoRoot."
  }
}

function Test-DeKoiRunning {
  if (-not $IsWindowsHost) {
    return $false
  }

  return [bool](Get-Process -Name "de-koi" -ErrorAction SilentlyContinue)
}

Push-Location $RepoRoot
try {
  Assert-GitCheckout

  if ($InstallDesktopShortcut) {
    Install-DesktopShortcut
  }

  $beforeCommit = Get-GitOutput @("rev-parse", "HEAD")
  $trackedChanges = Get-GitOutput @("status", "--porcelain", "--untracked-files=no")
  $stashed = $false

  try {
    if (-not $NoUpdate) {
      if ($trackedChanges) {
        if ($NoAutoStash) {
          throw "Tracked local changes exist. Commit, stash, or rerun without -NoAutoStash to let the launcher temporarily stash and reapply them."
        }

        $message = "de-koi-main-launcher-autostash $(Get-Date -Format o)"
        Write-Step "Temporarily stashing tracked local changes."
        Invoke-Git @("stash", "push", "--quiet", "--message", $message) | Out-Null
        $stashed = $true
      }

      Write-Step "Fetching $Remote/$Branch."
      Invoke-Git @("fetch", "--prune", $Remote, "+refs/heads/${Branch}:refs/remotes/${Remote}/${Branch}") | Out-Null
      Invoke-Git @("rev-parse", "--verify", "${Remote}/${Branch}^{commit}") -Capture | Out-Null

      $currentBranch = Get-CurrentGitBranch
      if ($currentBranch -eq $Branch) {
        Write-Step "Fast-forwarding $Branch to $Remote/$Branch."
        Invoke-Git @("merge", "--ff-only", "$Remote/$Branch") | Out-Null
      } else {
        Write-Step "Checking out $Remote/$Branch as a detached main-channel build."
        Invoke-Git @("checkout", "--detach", "$Remote/$Branch") | Out-Null
      }
    }
  } finally {
    if ($stashed) {
      Write-Step "Reapplying tracked local changes."
      Invoke-Git @("stash", "pop", "--index", "--quiet") | Out-Null
    }
  }

  $afterCommit = Get-GitOutput @("rev-parse", "HEAD")
  $checkoutChanged = $beforeCommit -ne $afterCommit
  $exeMissing = -not (Test-Path $ReleaseExe)
  $needsBuild = $checkoutChanged -or $exeMissing

  if ($NoBuild) {
    $needsBuild = $false
  }

  if ($needsBuild -and (Test-DeKoiRunning)) {
    throw "De-Koi is already running. Close it before rebuilding from main."
  }

  if ($needsBuild) {
    Write-Step "Installing dependencies."
    Invoke-Pnpm @("install")

    Write-Step "Building release executable."
    Invoke-Pnpm @("tauri", "build", "--no-bundle")
  } elseif ($NoBuild) {
    Write-Step "Build skipped."
  } else {
    Write-Step "Release executable is current."
  }

  if (-not $NoLaunch) {
    if (-not (Test-Path $ReleaseExe)) {
      throw "Release executable is missing: $ReleaseExe"
    }

    if (Test-DeKoiRunning) {
      Write-Step "De-Koi is already running."
    } elseif ($DryRun) {
      Write-Step "DRY RUN: launch $ReleaseExe"
    } else {
      Write-Step "Launching De-Koi."
      Start-Process -FilePath $ReleaseExe -WorkingDirectory (Split-Path $ReleaseExe)
    }
  }
} finally {
  Pop-Location
}
