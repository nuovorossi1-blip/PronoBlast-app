# Aggiorna Quote — agente del PC di casa

Il tasto **Aggiorna Quote** (Strumenti → Import dati) fa da solo quello che prima
si faceva con tre tasti: scarica il PDF Sisal, lo converte in Excel e lo carica.
Il lavoro lo fa questo programma, sul PC di casa, perché Sisal blocca qualsiasi
download che non venga da un browser vero (risponde 403 ai server).

## Come funziona

```
app (tasto) ──POST /quote-pc avvia──▶ Vercel ──settings.pc_quote_richiesta──▶ Supabase
                                                          ▲
PC di casa: agente.py ──ogni 15 s POST /quote-pc battito──┘
            └─ richiesta trovata → Edge scarica il PDF → converti.py → POST /upload-excel
```

- Il PC chiama il server, mai il contrario: nessuna porta aperta sul router.
- Nessun battito da 60 secondi = **"Server spento"** nell'app.
- Edge si apre con la finestra **fuori dallo schermo**: senza finestra
  (headless) la protezione di Sisal chiude la connessione.
- La conversione **non usa OCR**: il PDF contiene testo vero, e ogni quota viene
  assegnata alla colonna in base alla posizione sotto l'intestazione. Se
  l'intestazione del PDF cambia (`1 X 2 | H 1 X 2 | 1X X2 12 | U O U O U O | G NG | SI NO SI NO`,
  con `1,5 2,5 3,5` sopra le coppie U/O) il programma si ferma e non carica niente.
- Le colonne SI/NO (segna goal) vengono lette ma non scritte nell'Excel: l'app non le usa.

## File sul PC

`Documenti\Quote Sisal\`
- `Quote PDF Sisal\Quote Sisal AAAA-MM-GG HH-MM.pdf` — il PDF scaricato
- `Quote Excel convertite\Quote Sisal AAAA-MM-GG HH-MM.xlsx` — l'Excel caricato
- `registro.txt` — cosa ha fatto l'agente e gli eventuali errori

Non vengono mai cancellati.

## Installare / togliere

```powershell
powershell -ExecutionPolicy Bypass -File installa.ps1     # una volta sola
powershell -ExecutionPolicy Bypass -File disinstalla.ps1  # per toglierlo
```

L'installazione crea l'operazione pianificata **"PronoBlast - Aggiorna Quote"**
(all'accesso a Windows, riavvio automatico). Deve girare con l'utente collegato,
perché Edge apre una finestra: sul PC di casa c'è l'accesso automatico.

## Prove a mano

```powershell
python agente.py --prova       # scarica e converte, NON carica
python agente.py --una-volta   # scarica, converte e carica subito, senza app
```

`converti.py` e `parseExcelBytes` (in `netlify/functions/upload-excel.mjs` e
`lib/excelParser.ts`) devono restare d'accordo sul layout delle colonne.
