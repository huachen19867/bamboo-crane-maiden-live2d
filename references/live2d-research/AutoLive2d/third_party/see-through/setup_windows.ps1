param(
    [switch]$SkipTorch,
    [switch]$SkipBitsAndBytes
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE"
    }
}

Push-Location $PSScriptRoot
try {
    if (!(Test-Path ".venv\Scripts\python.exe")) {
        py -V:Astral/CPython3.12 -m venv .venv
    }

    $python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

    Invoke-Checked { & $python -m pip install --upgrade pip setuptools wheel }

    if (!$SkipTorch) {
        Invoke-Checked { & $python -m pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128 }
    }

    $tmpReq = Join-Path $env:TEMP "see-through-requirements-no-git.txt"
    Get-Content "requirements.txt" |
        Where-Object {
            $_ -notmatch "pytorch-image-models" -and
            $_ -notmatch "convnext_perceptual_loss"
        } |
        Set-Content -Encoding UTF8 $tmpReq

    Invoke-Checked { & $python -m pip install "timm @ https://github.com/huggingface/pytorch-image-models/archive/6e3fdda39508db30766f9d9e6ec32380ebee8b8c.zip" }
    Invoke-Checked { & $python -m pip install -r $tmpReq }
    Invoke-Checked { & $python -m pip install "convnext_perceptual_loss @ https://github.com/sypsyp97/convnext_perceptual_loss/archive/967cd172dfcc6407f6b8e5ea489cfd2f4fba51ba.zip" }

    if (!$SkipBitsAndBytes) {
        Invoke-Checked { & $python -m pip install -r requirements-inference-bnb.txt }
    }

    if (!(Test-Path "assets")) {
        New-Item -ItemType Junction -Path "assets" -Target "common\assets" | Out-Null
    }

    Write-Host ""
    Write-Host "Setup complete. Try:" -ForegroundColor Green
    Write-Host "  .\run_psd_quantized.bat assets\test_image.png"
}
finally {
    Pop-Location
}
