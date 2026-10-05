# Installa l'agente "Aggiorna Quote" sul PC di casa.
#
#   powershell -ExecutionPolicy Bypass -File installa.ps1
#
# - installa i pacchetti Python che servono (playwright, pdfplumber, openpyxl);
# - crea l'operazione pianificata "PronoBlast - Aggiorna Quote", che avvia
#   l'agente in sottofondo (pythonw, nessuna finestra) a ogni accesso a Windows
#   e lo riavvia da solo se si chiude;
# - lo avvia subito.
# Serve Microsoft Edge (c'e' gia' in Windows) e Python 3 nel PATH.
# Per togliere tutto: disinstalla.ps1 (le cartelle in Documenti restano).

$ErrorActionPreference = "Stop"
$cartella = $PSScriptRoot
$nome = "PronoBlast - Aggiorna Quote"

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "Python non trovato: installalo da python.org (spunta 'Add to PATH') e riprova." }
$pythonw = Join-Path (Split-Path $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe non trovato accanto a $python" }

Write-Host "Installo i pacchetti Python..."
& $python -m pip install --quiet --disable-pip-version-check -r (Join-Path $cartella "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip non e' riuscito a installare i pacchetti" }

Write-Host "Creo l'operazione pianificata '$nome'..."
$azione = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$(Join-Path $cartella 'agente.py')`"" -WorkingDirectory $cartella
$avvio = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$impostazioni = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
# Interactive: deve girare nella sessione dell'utente, perche' Edge apre una finestra vera.
$utente = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $nome -Action $azione -Trigger $avvio -Settings $impostazioni -Principal $utente -Force | Out-Null

Start-ScheduledTask -TaskName $nome
Write-Host "Fatto. L'agente e' acceso e ripartira' a ogni accesso a Windows."
Write-Host "Registro e file: $([Environment]::GetFolderPath('MyDocuments'))\Quote Sisal"
