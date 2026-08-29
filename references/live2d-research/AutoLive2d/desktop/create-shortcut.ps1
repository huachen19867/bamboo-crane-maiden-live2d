param(
  [string]$ShortcutName = "Auto Live2D Studio Desktop"
)

$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $desktopDir
$targetPath = Join-Path $projectRoot "start-desktop.bat"
$iconPath = Join-Path $desktopDir "icon.ico"
$shortcutPath = Join-Path $projectRoot "$ShortcutName.lnk"

if (!(Test-Path -LiteralPath $targetPath)) {
  throw "Missing target batch file: $targetPath"
}
if (!(Test-Path -LiteralPath $iconPath)) {
  throw "Missing icon file: $iconPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Start Auto Live2D Studio in the desktop WebView shell."
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
