# Toglie l'agente "Aggiorna Quote": ferma l'operazione pianificata e la cancella.
# Le cartelle Documenti\Quote Sisal (PDF, Excel, registro) restano dove sono.
#
#   powershell -ExecutionPolicy Bypass -File disinstalla.ps1

$nome = "PronoBlast - Aggiorna Quote"
Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
# pythonw resta vivo anche dopo lo stop dell'operazione: si chiude quello dell'agente.
Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe'" |
    Where-Object { $_.CommandLine -like "*agente.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Agente tolto. L'app ora dira' 'Server spento'."
