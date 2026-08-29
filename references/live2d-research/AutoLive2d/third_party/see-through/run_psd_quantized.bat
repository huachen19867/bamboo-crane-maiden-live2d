@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="" (
  echo Usage: run_psd_quantized.bat path\to\image.png [extra args]
  echo Example: run_psd_quantized.bat assets\test_image.png --resolution 1024
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Python environment not found. Run setup_windows.ps1 first.
  exit /b 1
)

set "SRC=%~1"
shift

".venv\Scripts\python.exe" inference\scripts\inference_psd_quantized.py ^
  --srcp "%SRC%" ^
  --save_to_psd ^
  %*
