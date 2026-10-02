# ticket/ — come funziona questa cartella

Qui stanno le istruzioni per **Claude Code**, divise per *round* (un giro di
lavoro). **Solo un file è attivo alla volta: `ticket.md`, sempre.**

| file | cos'è | stato |
|---|---|---|
| **[`ticket.md`](ticket.md)** | **Round 2** (02/10/2026) — scheda essenziale, lista GAP TECNICO, backtest-fusione, archivio nel calcolo, 2 decisioni del proprietario | 🟢 **ATTIVO** |
| [`storia/round-1.md`](storia/round-1.md) | **Round 1** (28-30/09/2026) — i 10 ticket + 6-bis e 8-bis, tutti nel codice | 📜 chiuso |

## La regola (vale per sempre)

1. Un round = un file. Il round attivo si chiama **`ticket/ticket.md`**, senza
   numeri nel nome.
2. Quando un round si chiude, il suo file diventa `ticket/storia/round-N.md`
   (N = numero del round) e il round nuovo prende il nome `ticket.md`.
3. Così la frase da dare a Claude Code **non cambia mai**:

   > «Leggi `ticket/ticket.md` ed esegui i ticket in ordine, uno per commit,
   > rispettando le REGOLE in testa al file.»

4. I file in `storia/` **non si eseguono**: sono memoria delle decisioni (perché
   una cosa è stata fatta così). Servono quando fra sei mesi ci si chiede
   "perché questa regola esiste?".

## Cosa c'è dentro un round

Ogni file di round segue lo stesso schema, così si legge in fretta:

- **le domande** che ci siamo posti (il *perché* delle modifiche);
- **le misure** che le hanno chiuse (i numeri, con data e ampiezza del campione);
- **i ticket**, in ordine: per ognuno il file dice dove intervenire, il sintomo
  osservabile, il suggerimento, gli esempi e il test di accettazione;
- **cosa NON fare** (i vincoli: soglie intoccabili, un ticket = un commit,
  niente scritture sul database se non richiesto);
- **i ticket che decidono il proprietario**, non Claude Code.

## Nota sul deploy

La cartella `ticket/` è **solo documentazione**: non entra in nessuna build e non
attiva il workflow dell'APK (che parte solo da `main` e solo per `android/**`).
I commit che toccano solo questi file portano `[skip ci]` nel messaggio, perché
ogni build costa ~15 crediti.

---

*Ultimo riordino: 02/10/2026 — il round 1 (prima `ticket/ticket.md`) è stato
archiviato in `storia/round-1.md`; il round 2 (prima `ticket/ticket-2.md`) è
diventato `ticket/ticket.md`.*
