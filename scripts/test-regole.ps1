# Lancia scripts/test-regole.mts (sola lettura sul database) con le variabili di server-locale/.env.
# Usato dalle attivita' pianificate "PronoBlast - Test regole (foto)" e "(valuta)". Registro: server-locale/test-regole/test-regole.log
param([string]$Modo = "fotografa")
$repo = Split-Path -Parent $PSScriptRoot
$sl = Join-Path $repo "server-locale"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
$dir = Join-Path $sl "test-regole"
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $sl
& $node node_modules\tsx\dist\cli.mjs --env-file=.env ..\scripts\test-regole.mts $Modo *>> (Join-Path $dir "test-regole.log")
