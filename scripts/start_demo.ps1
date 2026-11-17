# RetailFlow - start everything for an offline demo:
#   Docker PostgreSQL (5434) + FastAPI (8020) + Next.js (3000), then open the browser.
# Safe to re-run: anything already running is left alone.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path "$root/logs" | Out-Null

function Test-Http($url) {
  try { return ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url).StatusCode -eq 200) } catch { return $false }
}
function Wait-Http($url, $secs) {
  for ($i = 0; $i -lt $secs; $i++) { if (Test-Http $url) { return $true }; Start-Sleep 1 }
  return $false
}
function Test-Docker { docker info *> $null; return ($LASTEXITCODE -eq 0) }

Write-Host '[1/4] Docker Desktop'
if (-not (Test-Docker)) {
  $dd = @("$env:LOCALAPPDATA/Programs/DockerDesktop/Docker Desktop.exe", 'C:/Program Files/Docker/Docker/Docker Desktop.exe') |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($dd) { Start-Process $dd } else { Write-Host 'Docker Desktop.exe not found' -ForegroundColor Red }
  for ($i = 0; $i -lt 120; $i++) { Start-Sleep 3; if (Test-Docker) { break } }
}
if (-not (Test-Docker)) { Write-Host 'Docker Desktop did not start. Open it manually, then re-run.' -ForegroundColor Red; exit 1 }

Write-Host '[2/4] PostgreSQL  (container retailflow-postgres, port 5434)'
docker compose up -d postgres
for ($i = 0; $i -lt 60; $i++) {
  if ((docker inspect --format '{{.State.Health.Status}}' retailflow-postgres) -eq 'healthy') { break }
  Start-Sleep 2
}

Write-Host '[3/4] API  http://127.0.0.1:8020/api/v1'
if (-not (Test-Http 'http://127.0.0.1:8020/api/v1/health')) {
  Start-Process -WindowStyle Hidden -WorkingDirectory "$root/backend" -FilePath "$root/backend/.venv/Scripts/python.exe" `
    -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8020' `
    -RedirectStandardOutput "$root/logs/api.out.log" -RedirectStandardError "$root/logs/api.err.log"
  if (-not (Wait-Http 'http://127.0.0.1:8020/api/v1/health' 60)) { Write-Host 'API did not start - see logs/api.err.log' -ForegroundColor Red; exit 1 }
}

Write-Host '[4/4] Web  http://localhost:3000'
# Port 3000 is shared with other local projects: if something else answers there, stop it.
$isRf = $false
try { $isRf = ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3000/').Content -match 'RetailFlow') } catch {}
if (-not $isRf) {
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "  port 3000 is used by another app ($($proc.ProcessName) pid $($_.OwningProcess)) - stopping it"
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep 2
}
if (-not $isRf) {
  if (-not (Test-Path "$root/frontend/.next/BUILD_ID")) { Push-Location "$root/frontend"; npm run build; Pop-Location }
  Start-Process -WindowStyle Hidden -WorkingDirectory "$root/frontend" -FilePath 'cmd.exe' `
    -ArgumentList '/c','set NODE_ENV=production&& node_modules\.bin\next.cmd start -p 3000 > ..\logs\web.log 2>&1'
  if (-not (Wait-Http 'http://127.0.0.1:3000/' 90)) { Write-Host 'Web did not start - see logs/web.log' -ForegroundColor Red; exit 1 }
}

Write-Host ''
Write-Host 'RetailFlow is up:  http://localhost:3000' -ForegroundColor Green
Write-Host 'API health:        http://127.0.0.1:8020/api/v1/health'
if (-not $NoBrowser) { Start-Process 'http://localhost:3000' }
