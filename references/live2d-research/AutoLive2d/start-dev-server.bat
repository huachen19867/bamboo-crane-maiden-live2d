@echo off
setlocal

cd /d "%~dp0"

echo.
echo Auto Live2D Studio
echo ==================
echo Starting local web service from:
echo %CD%
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

echo.
echo Opening Vite dev server. The URL is usually:
echo   http://127.0.0.1:5173/
echo If that port is busy, Vite will print the next available URL.
echo.

call npm run dev -- --host 127.0.0.1

echo.
echo Server stopped.
pause
