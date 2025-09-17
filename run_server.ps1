# run_server.ps1
# PowerShell helper to create a virtual environment, install dependencies, and run the server
# Usage: In PowerShell (pwsh) run: .\run_server.ps1

# Create virtual environment if it doesn't exist
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment .venv..."
    python -m venv .venv
}

# Resolve venv python path
$venvPython = Join-Path (Resolve-Path ".venv") "Scripts\python.exe"

# Upgrade pip and install requirements
Write-Host "Upgrading pip and installing requirements..."
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements.txt

# Run the application using the venv python executable
Write-Host "Starting server using venv python..."
& $venvPython .\app.py
