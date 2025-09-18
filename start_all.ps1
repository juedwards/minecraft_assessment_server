<#
Start all development services for Minecraft Assessment Server.
This script will:
 - start the Python backend using .venv\Scripts\python.exe if present, otherwise system python
 - start the UI (either Electron desktop or Vite dev server)
 - write PID files under .tmp/ so stop_all.ps1 can stop them later
#>

param([switch]$Desktop, [switch]$Vite)

# Default: run Electron desktop unless user explicitly asked for Vite
if ($PSBoundParameters.ContainsKey('Vite')) {
    $Desktop = $false
} elseif (-not $PSBoundParameters.ContainsKey('Desktop')) {
    $Desktop = $true
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root

$tmpDir = Join-Path $root '.tmp'
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }

# Start Python backend
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    Write-Host "Starting Python backend from virtualenv..."
    $pyProc = Start-Process -FilePath $venvPython -ArgumentList 'app.py' -PassThru
} else {
    Write-Host "Virtualenv python not found; attempting system python..."
    $pyProc = Start-Process -FilePath 'python' -ArgumentList 'app.py' -PassThru
}

if ($pyProc) { Set-Content -Path (Join-Path $tmpDir 'backend.pid') -Value $pyProc.Id }

# Start UI (either Electron desktop or Vite dev server)
if ($Desktop) {
    Write-Host "Launching Electron desktop app..."
    # Install electron deps if not present
    $electronNodeModules = Join-Path $root 'electron\node_modules'
    if (-not (Test-Path $electronNodeModules)) {
        Write-Host "Installing electron dependencies in electron/ (this may take a moment)..."
        Push-Location (Join-Path $root 'electron')
        npm install
        Pop-Location
    }
    # Prefer the locally-installed electron binary (Windows .cmd) so we capture the correct process.
    $electronCmd = Join-Path $root 'electron\node_modules\.bin\electron.cmd'
    if (Test-Path $electronCmd) {
        $electronProc = Start-Process -FilePath $electronCmd -ArgumentList '.' -WorkingDirectory (Join-Path $root 'electron') -PassThru
    } else {
        # Fall back to npx (will pull electron if necessary)
        $electronProc = Start-Process -FilePath 'npx' -ArgumentList 'electron', './electron' -WorkingDirectory $root -PassThru
    }
    if ($electronProc) { Set-Content -Path (Join-Path $tmpDir 'electron.pid') -Value $electronProc.Id }
} else {
    Write-Host "Starting UI dev server (Vite) in ui/ (this will open a new window)..."
    $npmProc = Start-Process -FilePath 'npm' -ArgumentList 'run','dev','--prefix','ui' -PassThru
    if ($npmProc) { Set-Content -Path (Join-Path $tmpDir 'ui.pid') -Value $npmProc.Id }
}

# Give services a moment to boot and then open the browser to the UI (only for Vite)
Start-Sleep -Seconds 2
if (-not $Desktop) {
    try { Start-Process 'http://localhost:5173' } catch { }
}

Pop-Location
Write-Host "Started services. Use .\stop_all.ps1 to stop them and clean up PID files."