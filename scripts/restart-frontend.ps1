# PowerShell script to safely restart yard-frontend PM2 process
# Kills any process on port 3000, removes PM2 app if exists, starts fresh

param(
    [int]$Port = 3000
)

Write-Host "=== Safe Restart for yard-frontend (Port $Port) ===" -ForegroundColor Cyan

# Change to repo root
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# Function to kill process on specified port
function Stop-ProcessOnPort {
    param([int]$PortNum)
    
    Write-Host "Checking for processes on port $PortNum..." -ForegroundColor Yellow
    
    try {
        $connections = netstat -ano | Select-String ":$PortNum\s"
        if ($connections) {
            $pids = @()
            foreach ($conn in $connections) {
                if ($conn -match '\s+(\d+)$') {
                    $pid = $matches[1]
                    if ($pid -ne "0") {
                        $pids += $pid
                    }
                }
            }
            $pids = $pids | Select-Object -Unique
            
            foreach ($procId in $pids) {
                Write-Host "Killing process PID $procId on port $PortNum..." -ForegroundColor Red
                try {
                    taskkill /PID $procId /F 2>&1 | Out-Null
                }
                catch {
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Seconds 3
            Write-Host "Processes killed." -ForegroundColor Green
        }
        else {
            Write-Host "No processes found on port $PortNum." -ForegroundColor Green
        }
    }
    catch {
        Write-Host "Error checking port: $_" -ForegroundColor Red
    }
}

# Kill any process on port 3000
Stop-ProcessOnPort -PortNum $Port

# Wait a bit more to ensure port is released
Start-Sleep -Seconds 2

# Delete PM2 app if exists
Write-Host "Removing yard-frontend from PM2 if exists..." -ForegroundColor Yellow
pm2 delete yard-frontend 2>&1 | Out-Null
Start-Sleep -Seconds 2

# Ensure port is free one more time
Stop-ProcessOnPort -PortNum $Port
Start-Sleep -Seconds 2

# Start fresh from ecosystem
Write-Host "Starting yard-frontend from ecosystem.config.js..." -ForegroundColor Yellow
pm2 start ecosystem.config.js --only yard-frontend

Start-Sleep -Seconds 10

# Check status
Write-Host "`n=== Status ===" -ForegroundColor Cyan
pm2 list | Select-String -Pattern "yard-frontend|yard-backend|cost-approval|csd-picker-server|production-picker|drawingshare"

# Test if port is listening
Write-Host "`n=== Port Check ===" -ForegroundColor Cyan
netstat -ano | Select-String ":$Port\s" | Select-Object -First 2

Write-Host "`n=== Done ===" -ForegroundColor Green
