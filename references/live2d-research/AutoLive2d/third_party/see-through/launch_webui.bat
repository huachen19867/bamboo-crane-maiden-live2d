@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Python environment not found. Run setup_windows.ps1 first.
  exit /b 1
)

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8:replace
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
rem 可选：如果你配置了可用的 HuggingFace 镜像/代理，可以在启动前手动设置 HF_ENDPOINT。

".venv\Scripts\python.exe" webui\server.py
