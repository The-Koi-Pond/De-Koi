@echo off
setlocal

set "REPO_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%scripts\update-and-launch.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo De-Koi main-channel launcher failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
