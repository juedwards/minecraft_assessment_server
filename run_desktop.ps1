# Launch the Python backend (from .venv if available) and then start the Electron desktop app
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root

$venvPython = Join-Path $root ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    Write-Host "Starting Python backend from virtualenv..."
    Start-Process -NoNewWindow -FilePath $venvPython -ArgumentList 'app.py'
} else {
    Write-Host "Virtualenv python not found; attempting system python..."
    Start-Process -NoNewWindow -FilePath 'python' -ArgumentList 'app.py'
}

Write-Host "Starting Electron UI..."
# Launch Electron using the electron/ subfolder so the correct package.json/main.js are used
npx electron ./electron

Pop-Location