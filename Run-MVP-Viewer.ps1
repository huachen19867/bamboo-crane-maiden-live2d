$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewer = Join-Path $workspace 'tools\CUBISM\CubismViewer5.exe'
$model = Join-Path $workspace 'model\cubism\runtime-mvp-v1\bamboo-crane-maiden-mvp.model3.json'

if (-not (Test-Path -LiteralPath $viewer)) { throw "Cubism Viewer was not found: $viewer" }
if (-not (Test-Path -LiteralPath $model)) { throw "MVP model was not found: $model" }

Start-Process -FilePath $viewer -ArgumentList ('"' + $model + '"') -WorkingDirectory (Split-Path -Parent $model)
