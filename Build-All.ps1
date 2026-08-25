$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonCandidates = @(
    'C:\Users\陈化\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
    (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $pythonCandidates) { throw '未找到 Python 3。请安装 Python 3 后重试。' }
$python = $pythonCandidates[0]
Push-Location $root
try {
    & $python 'tools\build_assets.py'
    if ($LASTEXITCODE -ne 0) { throw '素材构建失败。' }
    & $python 'tools\build_model.py'
    if ($LASTEXITCODE -ne 0) { throw '模型构建失败。' }
} finally {
    Pop-Location
}
