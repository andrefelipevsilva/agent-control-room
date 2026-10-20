@echo off
rem Agent Control Room: starts Habblaud and Agent Flow when needed and opens both on one screen.
cd /d "%~dp0"
node server.mjs %*
if errorlevel 1 pause
