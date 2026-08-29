@echo off
setlocal

cd /d "%~dp0"

echo.
echo Auto Live2D Studio Desktop
echo ==========================
echo Starting the desktop WebView shell with background throttling disabled.
echo.

if not exist node_modules (
  echo node_modules was not found. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm run desktop

echo.
echo Desktop app stopped.
pause
