<#
Stop services started by start_all.ps1
 - Reads PID files in .tmp/ and attempts to stop processes
 - Removes PID files afterwards
#>
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root

$tmpDir = Join-Path $root '.tmp'
if (-not (Test-Path $tmpDir)) { Write-Host "No .tmp directory; nothing to stop."; Pop-Location; return }

function Stop-ByPidFile($name) {
    $f = Join-Path $tmpDir $name
    if (Test-Path $f) {
        try {
            $pid = Get-Content $f | Select-Object -First 1
            if ($pid) {
                Write-Host "Stopping process $pid (from $name)..."
                Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Write-Host "Failed to stop process recorded in ${name}: $_"
        }
        Remove-Item $f -ErrorAction SilentlyContinue
    } else {
        Write-Host "$name not found"
    }
}

Stop-ByPidFile 'backend.pid'
Stop-ByPidFile 'ui.pid'
Stop-ByPidFile 'electron.pid'

# Optionally remove the tmp dir if empty
try {
    if ((Get-ChildItem $tmpDir -Force | Measure-Object).Count -eq 0) { Remove-Item $tmpDir -Force -Confirm:$false }
} catch {}

Pop-Location
Write-Host "Stop sequence complete."