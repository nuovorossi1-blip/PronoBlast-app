# Installa il server locale di PronoBlast (06/10/2026): operazione pianificata
# all'accesso, finestra nascosta, registro in server.log. Poi lo pubblica su
# internet con Tailscale Funnel: https://<nome-pc>.<tailnet>.ts.net:8443
# Per toglierlo:  Unregister-ScheduledTask "PronoBlast - Server locale" -Confirm:$false
#                 tailscale funnel --https=8443 off
$ErrorActionPreference = "Stop"
$cartella = $PSScriptRoot
Push-Location $cartella
if (-not (Test-Path node_modules)) { npm install }
Pop-Location
if (-not (Test-Path (Join-Path $cartella ".env"))) { throw "Manca server-locale\.env (variabili copiate da Vercel)" }
if (-not (Test-Path (Join-Path $cartella "..\frontend\dist\index.html"))) { throw "Manca frontend\dist: cd frontend; npm ci; npm run build:web" }

$node = (Get-Command node).Source
$comando = "`"$node`" node_modules\tsx\dist\cli.mjs --env-file=.env server.ts >> server.log 2>&1"
$azione = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless cmd /c `"$comando`"" -WorkingDirectory $cartella
$quando = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$regole = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "PronoBlast - Server locale" -Action $azione -Trigger $quando -Settings $regole -Force | Out-Null
Start-ScheduledTask -TaskName "PronoBlast - Server locale"

tailscale funnel --bg --https=8443 http://127.0.0.1:3000
tailscale funnel status
