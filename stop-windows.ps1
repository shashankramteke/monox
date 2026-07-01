# ObserveX Windows Stop Script
# Run this in PowerShell to cleanly stop the dashboard

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Red
Write-Host "  ObserveX Dashboard - Stopping..." -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

# Kill backend (port 8000)
$backendPids = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
foreach ($pid in $backendPids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped backend (PID $pid)" -ForegroundColor Gray
}

# Kill frontend (port 5173)
$frontendPids = (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue).OwningProcess
foreach ($pid in $frontendPids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped frontend (PID $pid)" -ForegroundColor Gray
}

# Delete telemetry database
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dbPath = Join-Path $ProjectDir "dashboard\backend\telemetry.db"
if (Test-Path $dbPath) {
    Remove-Item $dbPath -Force
    Write-Host "  Deleted telemetry.db" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All services stopped. DB cleared." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
