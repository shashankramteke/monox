# ObserveX Windows Startup Script
# Run this in PowerShell to start the dashboard

$ErrorActionPreference = "SilentlyContinue"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ObserveX Dashboard - Windows Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- [1] Kill any existing processes on ports 8000 and 5173 ---
Write-Host "[1/3] Stopping any existing instances..." -ForegroundColor Yellow

$backendPids = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
foreach ($pid in $backendPids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped old backend (PID $pid)" -ForegroundColor Gray
}

$frontendPids = (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue).OwningProcess
foreach ($pid in $frontendPids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Write-Host "  Stopped old frontend (PID $pid)" -ForegroundColor Gray
}

Start-Sleep -Milliseconds 500

# --- [2] Delete stale database so it is freshly created on startup ---
Write-Host "[2/3] Clearing stale database..." -ForegroundColor Yellow
$dbPath = Join-Path $ProjectDir "dashboard\backend\telemetry.db"
if (Test-Path $dbPath) {
    Remove-Item $dbPath -Force
    Write-Host "  Deleted telemetry.db" -ForegroundColor Gray
}

# --- [3] Start Backend ---
Write-Host "[3/3] Starting Backend (port 8000) and Frontend (port 5173)..." -ForegroundColor Yellow

$backendDir = Join-Path $ProjectDir "dashboard\backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; python main.py" -WindowStyle Normal

Start-Sleep -Seconds 2

# --- [4] Start Frontend ---
$frontendDir = Join-Path $ProjectDir "dashboard\frontend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ObserveX is starting up!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:   http://localhost:5173" -ForegroundColor White
Write-Host "  Backend API: http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "  Two new terminal windows have opened." -ForegroundColor Gray
Write-Host "  Close them (or press Ctrl+C inside) to stop." -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
