@echo off
rem One-step launcher: installs dependencies and builds the UI on first run, then starts Studio H3.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
if not exist dist\web\index.html (
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8787"
call npm start
pause
