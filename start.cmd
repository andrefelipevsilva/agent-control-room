@echo off
rem Agent Control Room: runs Habblaud and Agent Flow (bundled in vendor\) and opens both on one screen.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22.12 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node server.mjs %*
if errorlevel 1 pause
