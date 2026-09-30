# ticket/ — Istruzioni di correzione per Claude Code

> **CARTELLA TEMPORANEA.** Va eliminata (o spostata fuori dal repo) quando l'ultimo ticket è chiuso.
>
> **Per il proprietario:** apri Claude Code e digli solo: *«Leggi `ticket/ticket.md` ed esegui i ticket in ordine, uno per commit, rispettando le REGOLE in testa al file»*.
>
> **Per Claude Code:** leggi TUTTO il file prima di toccare codice. Un ticket = un commit, in ordine 1→7. Non saltare i test di accettazione. Non "migliorare" nulla oltre quanto scritto. La cartella `ticket/` non si tocca e non si include in nessun commit di codice.

---

## COSA ABBIAMO SCOPERTO — i punti, in sintesi

Indagando due partite reali (Belgio-Francia 0-1 e Turchia-Italia 1-4 del 28/09/2026) e leggendo il codice, sono emersi questi problemi, tutti verificati a livello di riga di codice:

1. **Import mancante** (`build-multipla.ts`): `pgGetAll` usato a riga ~310 ma non importato → `ReferenceError` ingoiato da un `catch` muto → storico lega sempre "—" nella multipla. Silenzioso al 100%.
2. **`win_rate` dal DB senza ricalcolo** (`verdettoServer.ts`): la colonna viene passata grezza ma nessuno nel repo la scrive mai (scala sconosciuta, può essere `null`) → la correzione storico del verdetto server può divergere dal telefono o penalizzare tutto con "promette troppo".
3. **Doppione senza filtro** (`preHeuristic.ts`): `preHeuristicPick` può registrare NG/U2.5 in `pick_pre` (il filtro MAI_GIOCATI esiste solo in `preHeuristicRanking`) → la futura pagella del PRE misurerebbe un PRE diverso da quello che vota.
4. **Soglia disallineata nel backtest**: PRE taglia a 1.40 hardcodato mentre Motore e Max-prob giocano da 1.35 → confronto a tre non alla pari.
5. **Scheda congelata**: placeholder con "totale 0.0" finto + caption che spiega la regola di ordinamento ESATTAMENTE al contrario (fraintesa sia su Belgio-Francia sia su Turchia-Italia).
6. **Filtro strutturale applicato tardi** (`violatesStructure`): MG 2-4 passava tutta la fusione ed era il primo ammesso (Belgio-Francia, 62%) venendo eliminato SOLO in coda → contatori "n/3" e ordine calcolati su un mercato fantasma. La regola del tetto aperto (MG 2-4 escluso) è **confermata dal proprietario e non si tocca** — va solo applicata anche in ingresso e nel PRE; e quando un MG cade per il tetto, O2.5 deve stare subito dopo come "lettura gol".
7. **1X e X2 trattate come "esiti opposti"**: si sovrappongono sul pareggio (0-0/1-1 le vince ENTRAMBI) → la tabella dell'ambiguità le ha dichiarate "opposti ravvicinati" e ha cancellato ENTRAMBE dal verdetto di Turchia-Italia, nonostante X2 fosse pick dell'euristica, #3 del ranking, whitelist sì, quota 1.45, storico 81%. La tabella esiste in TRE copie. Regola del proprietario: le doppie chance sono **concorrenti di direzione** — uno solo sopravvive (il dominante), l'altro si ritira COME il 2 col pick 1; ma non si annientano a vicenda.
8. **Osservazioni NON-bug** (da non "correggere"): MG 1-3 casa/ospite alti nel ranking ma esclusi = whitelist del proprietario ("non fra i tuoi mercati", giusto così); il "12" a 76% nascosto = sotto soglia 1.40, giusto così.
9. **Il manuale per scenario NON è misurato** (segnalato dal proprietario il 29/09: "quando lo scenario si verifica, i mercati del manuale sono corretti"): il banner usa EQUILIBRIO/GAP TECNICO/PROGRESSIONE (`getScenarioNote`), ma l'apprendimento per scenario (`updateScenarioScores` → `scenario_market_scores`) misura una tassonomia DIVERSA (netta/chiara/leggera di `lib/scenario.ts`). In più il valutatore `evaluateMarketOutcome` non sa valutare AH −0,75/+0,75, DNB e MC casa/ospite — metà dei mercati del manuale. → Ticket 8: misurare il manuale con la sua tassonomia.

---

## COSA ASPETTARSI DOPO LE MODIFICHE

**Cambia subito (visibile senza attendere dati):**
- Storico per campionato nella multipla: percentuali reali al posto di "—".
- Le doppie chance non spariscono più: vedi la direzione dominante (X2 se domina X2, 1X se domina 1X) come pick o come prima alternativa; il rivale resta fuori come il "2" col pick "1".
- Niente più "totale 0.0" finto sulle partite finite; la caption del "PERCHÉ" descrive la regola vera (ordine = ranking, punteggio solo sui quasi-pari ±5 pt).
- Quando un MG di range cade per il tetto, O2.5 compare subito dopo il pick con la nota "lettura gol".
- Contatori "ALTERNATIVE CONCORDI n/3" onesti: calcolati solo su mercati ammissibili.
- `/verdetto` (server) e telefono danno lo stesso verdetto; `pick_pre` mai più NG/U1.5/U2.5.

**In qualche partita il pick può CAMBIARE** (quella era la voce che era stata cancellata): è il fix che lavora, non un regresso. Riferimenti per controllare:
- **Turchia-Italia (1-4)**: pick atteso MG 2-4 (perso, tetto 4 scoppia a 5), ma **X2 @1.45 deve essere l'alternativa #1** (2/3 fonti) e 1X assente.
- **Belgio-Francia (0-1)**: nessun MG 2-4 fantasma; O2.5 in vista come lettura gol.

**Non cambia NULLA di strategico:** soglie (1.35/1.40), whitelist dei mercati, regole MG, regola del tetto aperto (confermata), pesi della fusione, congelamento dei verdetti finiti.

**La % di hit NON si valuta il giorno dopo:** servono partite. Subito dopo il deploy si può: (a) far girare il backtest in Traccia — le tre regole ora sono confrontate alla pari anche sotto 1.40; (b) verificare le due partite-riferimento sopra. Per la pagella della fusione servono ~2-4 settimane di `pick_finale` registrati post-fix.

**A lavori finiti:** eliminare questa cartella.

---

## REGOLE VALIDE PER TUTTI I TICKET

1. **Fix minimo.** Vietato refactorare oltre quanto richiesto dal ticket. Un ticket = un commit, messaggio in italiano.
2. **Commenti e test in italiano**, come nel resto del progetto.
3. **Vietato ingoiare errori.** Ogni `catch` nuovo o toccato deve loggare: `catch (e) { console.error("[contesto]", e); ... }`. (Un `catch` muto è il modo in cui il Ticket 1 è passato inosservato per settimane.)
4. **Due filtri che devono dare lo stesso verdetto = una sola funzione condivisa.** Non duplicare mai una regola in due posti. (Eccezione voluta: Ticket 7 — due semantiche DIVERSE, da documentare.)
5. **Soglie intoccabili salvo indicazione esplicita**: 1.35/1.40, ±5 pt di tie-break, −15% di tolleranza storico. Sono calibrate.
6. **Metrica unica**: % di pronostici indovinati entro soglia. Il ROI non è un obiettivo.
7. **NG / U1.5 / U2.5 restano veto-only** nel motore: mai proposti, mai giocati.
8. **Verifica obbligatoria a fine ticket** (da eseguire e incollare in chat):
   ```bash
   cd frontend && npm ci
   node_modules/.bin/tsc --noEmit                      # frontend: deve dare 0 errori
   cd ..
   frontend/node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
     --target es2022 --module esnext --moduleResolution bundler --types node \
     'netlify/functions/api/[route].ts'                # catena funzioni: deve dare 0 errori
   ```
   ⚠️ Il normale typecheck copre SOLO `frontend/`: la catena `netlify/functions` va compilata a parte, con il secondo comando. È esattamente il buco per cui è passato il Ticket 1.

---

## TICKET 1 🔴 — `pgGetAll` usato ma non importato (storico lega sempre "—")

**Dove:** `netlify/functions/build-multipla.ts` — riga 8 (import) e riga ~310 (uso).
**Sintomo osservabile:** nella pagina multipla, lo storico per campionato è **sempre "—"**, su tutti i campionati, anche quelli con decine di partite concluse.
**Causa (una riga):** alla riga ~310 si chiama `pgGetAll(...)` ma la riga 8 **non** lo importa → `ReferenceError` a runtime → il `catch` circostante lo ingoia e imposta storico vuoto → "—".
**Perché è subdolo:** silenzioso al 100%: nessun crash, nessun log, solo un dato che sembra "non disponibile".

**Fix minimo:** alla riga 8, aggiungere una parola:
```ts
import { pgGet, pgGetAll, pgPatch, rowToOdds, jsonResponse } from "./lib/supabaseRest";
```
(`pgGetAll` è già esportato: `netlify/functions/lib/supabaseRest.ts` riga 54.)
Consigliato (coerente con la Regola 3): nel `catch` della riga ~315 aggiungere `console.error("storico lega:", e);`.

**Non fare:** non toccare la query, né la logica della mappa `storicoLega`.

**Test di accettazione:**
```bash
grep -n "pgGetAll" netlify/functions/build-multipla.ts   # deve apparire SIA all'import SIA all'uso
# + i due comandi tsc della Regola 8: il secondo, prima del fix, dava:
#   error TS2304: Cannot find name 'pgGetAll'
```
Più verifica a runtime: aprire una multipla con campionati che hanno partite concluse → lo storico lega mostra percentuali, non "—".

---

## TICKET 2 🟡 — `win_rate` passata grezza dal server: scale sconosciuta, null = "promette troppo" su tutto

**Dove:** `netlify/functions/lib/verdettoServer.ts`, funzione `storicoPartita` (select a righe ~49-51). Consumatori in `frontend/src/api.ts`: righe **674**, **896**, **901** (tutti fanno `win_rate / 100`, quindi si aspettano una scala **0-100**) e **1175** (penalità "promette troppo").
**Sintomo osservabile (potenziale):** il verdetto calcolato dal server (`/verdetto`) può divergere da quello calcolato dal telefono sulla stessa partita, perché la "correzione storico" usa percentuali sbagliate. Caso peggiore: se la colonna è `null`, `null/100 = 0` → **ogni mercato risulta "promette troppo" e prende penalità**.
**Causa (una riga):** `verdettoServer` passa la colonna DB `win_rate` così com'è, ma **nel repo non esiste alcun codice che scriva quella colonna** (`applyResult.ts` aggiorna solo `wins/total`): scala e freschezza sono sconosciute, quindi inaffidabili.
**Perché è subdolo:** funziona "a volte" — dipende da cosa c'è nel DB, non dal codice.

**Fix minimo:** in `storicoPartita`, mappando le righe, **ricalcolare** il tasso dalla fonte di verità:
```ts
win_rate: r.total > 0 ? (r.wins / r.total) * 100 : 0,
```
Così il server usa la stessa fonte di `match-history`/`stats` (wins/total) e le divisioni `/100` dei consumatori restano corrette.

**Non fare:** non cambiare i consumatori (`/100` resta), non migrare la colonna DB.

**Test di accettazione:** prendere una partita con archivio noto (famiglia GG globale: `wins`/`total` leggibili a mano dalla pagina Stats). Poi:
```bash
curl 'https://<dominio>/api/verdetto?id=<ID_PARTITA>&dry=1'
```
- il dettaglio storico deve dire `storico <wins/total>% su <total>`;
- il pick del server deve coincidere con il verdetto mostrato dal telefono sulla stessa partita.

---

## TICKET 3 🟡 — `preHeuristicPick` senza filtro MAI_GIOCATI: la pagella misurerebbe un PRE diverso da quello che vota

**Dove:** `netlify/functions/lib/preHeuristic.ts` — `preHeuristicPick`, il `push()` a righe ~113-117 (che spinge attivamente `U2.5`, `NG`, `U3.5` in CHIUSA_PROTETTA a righe ~139-141). Consumatore: `netlify/functions/predict.ts` riga ~127 (`patch.pick_pre`).
**Sintomo osservabile:** `pick_pre` su DB può contenere **NG / U2.5** — mercati esclusi per scelta dal PRE (il filtro `MAI_GIOCATI` esiste SOLO in `preHeuristicRanking`, riga 44). Quando farai la pagella del PRE, misurerai un PRE che include mercati che hai deciso di non giocare mai → percentuali non comparabili con nulla.
**Causa (una riga):** la stessa logica è duplicata in due funzioni e solo una ha il filtro.

**Fix minimo:** nel `push()` di `preHeuristicPick`, aggiungere la stessa riga del ranking:
```ts
const push = (market: string, odd: number, family: string) => {
  if (!isFinite(odd)) return;
  if (odd < minOdd) return;                                   // (vale per il Ticket 4)
  if (MAI_GIOCATI.has(market.trim().toUpperCase().replace(/\s+/g, ""))) return;  // <— QUESTA
  if (out.find((c) => c.market === market)) return;
  out.push({ market, odd, family });
};
```
(Alternativa migliore se vuoi fare ora quanto richiederà il Ticket 4: far derivare `preHeuristicPick` dal primo elemento di `preHeuristicRanking`, eliminando del tutto il doppione.)

**Non fare:** non cambiare le soglie delle regole interne (1.85 / 1.60 / 1.50 / 1.40 di DOMINANZA ecc.): sono strategia, non soglia di giocabilità.

**Test di accettazione:** con quote dove passano solo le CHIUSE, es. `odd_U25=1.60, odd_NG=1.70, odd_GG=2.10, odd_O25=2.10, nessuna favorita ≤1.85` → `preHeuristicPick` deve restituire **null** (o un mercato non in MAI_GIOCATI), mentre prima restituiva `U2.5`. E dopo il deploy, su DB: nessuna riga nuova con `pick_pre` ∈ {NG, U1.5, U2.5}.

---

## TICKET 4 🟡 — Backtest: PRE taglia a 1.40 mentre le altre regole giocano da 1.35 (confronto squilibrato)

**Dove:** `netlify/functions/lib/preHeuristic.ts` — tagli di giocabilità `odd < 1.40` a **riga 40** (`preHeuristicRanking`) e **riga 114** (`preHeuristicPick`). Consumatore: `netlify/functions/backtest.ts` (regola `pre`, min odd 1.35 come le altre regole).
**Sintomo osservabile:** nel confronto a tre regole di Traccia, la colonna PRE **non ha mai** pick con quota 1.35-1.39, mentre Motore e Max-probabilità sì → il confronto non è alla pari, e la pagella di Fase 1 misura cose diverse.
**Causa (una riga):** soglia hardcodata in preHeuristic, parametro 1.35 nel backtest.

**Fix minimo:** aggiungere parametro opzionale `minOdd = 1.40` a `preHeuristicRanking` e `preHeuristicPick`; usare `minOdd` SOLO nei due tagli di giocabilità (righe 40 e 114); il backtest passa `1.35` per la regola `pre`. Le soglie strategiche interne (1.85/1.60/1.50/1.40 di DOMINANZA_TETTO, ANTI_X, RANGE_CONTROLLATO…) **restano com'erano**.

> **DECISIONE DEL PROPRIETARIO (rispondere in una riga prima di fare il ticket):**
> la soglia canonica di PRE diventa 1.35 **ovunque** (anche nella fusione del verdetto), oppure 1.35 **solo nel backtest** per parità di confronto? Il fix sopra è neutro: se non rispondi, si applica solo al backtest.

**Test di accettazione:** `GET /api/backtest?regola=pre&split=2026-08-31` → ora esistono pick PRE con quota in [1.35, 1.39) (prima: zero); le colonne `motore` e `maxprob` non cambiano.

---

## TICKET 5 🟢 — Scheda partita congelata: "totale 0.0" finto + caption che spiega la regola SBAGLIATA

**Dove:** `frontend/app/match/[id].tsx` — (a) oggetto di riserva del verdetto congelato ~righe 528-545 (`score: 0, sources: [], concordance: 0`); (b) caption ~righe 792-794.
**Sintomo osservabile:**
(a) su una partita finita il riquadro mostra righe con **"totale 0.0"** e nessuna componente: sembra un errore di calcolo, ma è un placeholder;
(b) la caption dice: *"Vince il punteggio più alto, non la posizione nel ranking strutturale. A parità entro 5 punti decide la quota più bassa."* — è **il contrario** della regola implementata (l'ordine segue la posizione nel ranking; il punteggio decide solo fra proposte quasi pari, entro ±5 pt, e lì vince la quota più bassa). Questa caption ha frainteso l'ordine delle alternative su Belgio-Francia 28/09 (il "2" terzo con punteggio negativo) e su Turchia–Italia.

**Fix minimo:**
(a) quando `congelato` è vero e si usa l'oggetto di riserva, NON renderizzare le righe delle componenti; mostrare invece: *"Verdetto congelato prima della partita: componenti non salvate."* + quota e copertura salvate. (Salvare le componenti al momento del save sarebbe meglio ma richiede nuove colonne: NON farlo ora.)
(b) sostituire la caption con:
> *"L'ordine segue la classifica della fusione (quante fonti lo mettono in alto). Il punteggio decide solo fra proposte quasi pari (±5 pt): allora vince la quota più bassa."*

**Non fare:** non cambiare la logica di congelamento (è corretta e voluta: evita il verdetto riscritto col risultato già noto).

**Test di accettazione:** aprire una partita finita con `pick_finale` → nessuna riga "totale 0.0"; leggere la caption: deve descrivere il ranking, non il punteggio.

---

## TICKET 6 🟡 — Regola del tetto aperto CONFERMATA dal proprietario; applicarla in ingresso, non in coda + O2.5 come lettura gol

**DECISIONE DEL PROPRIETARIO (29/09, testuale):** *"quando il tetto è aperto non posso giocare MG 2-4: probabilmente ci saranno più di 4 gol… il tetto non garantisce che c'è un range di goal, e questo mi ha salvato tante volte"*. → **La regola è GIUSTA e non si tocca**: tetto aperto ⇒ MG 2-4 escluso, nessun ripescaggio. (E anche col tetto chiuso il range può scoppire — Turchia-Italia, tetto 4, finita 1-4: per questo serve anche il punto 3 sotto.)

**Dove:** la regola finale è `violatesStructure` in `frontend/src/api.ts` (definizione riga 1555, **unico** uso a riga 1626 dentro `filterCoherentAlternatives`) + applicata post-fusione in `netlify/functions/lib/verdettoServer.ts` righe ~122-127. L'ammissione in ingresso invece è del motore (`clusterEngine`) + PRE (`preHeuristic.ts`, regola RANGE_CONTROLLATO), che **non conoscono il tetto aperto**.
**Sintomo osservabile (Belgio-Francia, 28/09/2026, finita 0-1):** la fusione interna aveva **MG 2-4 totali al 62% come prima scelta**; `violatesStructure` (tetto aperto) lo ha eliminato **solo alla fine** → pick salvato GG. Conseguenze: i contatori "ALTERNATIVE CONCORDI n/3" e i punteggi d'ordine sono calcolati su una lista che conteneva ancora un mercato inammissibile.
**Causa:** stesso concetto ("quale mercato è strutturalmente giocabile") implementato due volte con regole diverse, applicate in punti diversi della catena.

**Fix minimo:**
1. Applicare `violatesStructure` **in ingresso** alla fusione: filtrare `preFamily` e i mercati del motore in `verdettoServer` e in `match/[id].tsx` PRIMA di `rankPicks`/`buildFinalVerdict`, così contatori e ordine sono calcolati solo su mercati ammissibili. Il filtro in coda resta come formalità. La regola NON cambia: tetto aperto ⇒ MG esclusi (confermato sopra).
2. **Allineare il PRE**: la regola RANGE_CONTROLLATO di `preHeuristic` (MG 2-4 da O1.5+U3.5) non deve proporre MG 2-4 quando il tetto è aperto (stessa funzione condivisa `violatesStructure`, importata da preHeuristic).
3. **O2.5 come lettura gol** (richiesta esplicita: *"bisogna vedere anche il fatto dell'over 2.5, perché over 2.5 è un buon pick"*): quando un MG di range viene scartato per ragioni di tetto, se O2.5 è ammissibile e sopra soglia deve comparire **subito dopo il pick** fra le alternative, con nota: *"il tetto non garantisce il range → lettura gol"*. (In Turchia-Italia O2.5 era alternativa e ha VINTO; in Belgio-Francia la fusione, dopo l'esclusione di MG 2-4, è scivolata su GG — persa — mentre la lettura gol era O2.5.)

**Non fare:** NON allentare `violatesStructure` sul tetto aperto; NON ripescare MG 2-4 in nessun caso col tetto aperto.

**Test di accettazione:**
- Belgio-Francia (tetto aperto): la lista della fusione NON contiene MG 2-4 **prima** dell'ordinamento; "ALTERNATIVE CONCORDI n/3" riflette la lista filtrata; il pick salvato coincide col primo mostrato in scheda; O2.5 compare fra le alternative con la nota lettura-gol.
- Turchia-Italia (tetto chiuso 2-4): MG 2-4 resta giocabile (nessun cambio); O2.5 resta fra le alternative.
- Regressione: nessun altro mercato cambia ammissione.

---

## TICKET 7 🔴 — 1X e X2 non sono "esiti opposti": sono CONCORRENTI DI DIREZIONE (caso Turchia–Italia 28/09/2026, finita 1-4)

**La regola del proprietario (testuale):** *"1X e X2: uno esclude l'altro se la direzione è giusta. In questo caso X2 era presente in tutti i pick e superava sempre 1X → la direzione giusta è X2. Speculare: se 1X avesse superato sempre X2, la direzione giusta sarebbe 1X. Quindi uno esclude l'altro come 1 e 2: l'1 esclude il 2, il 2 esclude l'1."*
Cioè: **come pick (e come alternative) ne sopravvive uno solo — il dominante; ma non si annientano fra loro** (il pareggio le vince entrambe: non sono opposti).

**Dove:** tre tabelle, due semantiche DIVERSE (da documentare, non da unificare — deroga alla Regola 4):
1. `frontend/src/api.ts` ~riga 752, `OPPOSTI` → usata da `famiglieAmbigue` (e dalla catena `contraddice`). **QUI sta il bug**: contiene `["1x","x2"]`, quindi X2 62% e 1X 62% ("ravvicinate") hanno dichiarato ambigua tutta la famiglia "esito" → **X2 e 1X sparite ENTRAMBE** dal verdetto di Turchia-Italia (anche dalla penalità ×0.85 "coppia opposta ravvicinata", ~righe 1100 e 1302-1319).
2. `frontend/src/api.ts` ~riga 1478, `_OPPOSITES` → usata da `areMarketsContradictory` (ALTERNATIVE CONCORDI). Contiene `["1X","X2"]`, `["1X","12"]`, `["X2","12"]`: **tenute** — sono la regola di direzione del proprietario (il rivale battuto non torna come alternativa, come il "2" col pick "1").
3. `netlify/functions/lib/clusterEngine.ts` ~riga 1153, `OPPOSTI` → selezione del pick nel motore. **Tenuta** per la stessa ragione: la direzione domina, il rivale non diventa pick.

**Fix minimo:**
1. In `api.ts` ~752 rimuovere SOLO la coppia `["1x", "x2"]`. Le opposte VERE restano: `1↔2`, `1↔x2`, `2↔1x`, `gg↔ng`, `o↔u`, `o2.5↔ng` (insiemi di esiti disgiunti: 1X={casa,pareggio}, X2={pareggio,ospite} si sovrappongono sul pareggio).
2. NON toccare `_OPPOSITES` (~1478) né `OPPOSTI` di clusterEngine (~1153): la rivalità 1X↔X2 come pick/alternative è VOLUTA (regola del proprietario).
3. Documentare le due semantiche e correggere i commenti: la tabella di `famiglieAmbigue` = **"OPPOSTI VERI"** (nessun esito in comune; se ravvicinati → non c'è lettura → famiglia fuori); le altre due = **"CONCORRENTI DI DIREZIONE"** (stesso slot tattico; vince il dominante, l'altro si ritira). Cancellare i commenti "deve restare allineata a OPPOSTI in clusterEngine" fra la tabella 1 e le altre (ora divergono VOLUTAMENTE); mantenere l'allineamento fra clusterEngine `OPPOSTI` e api `_OPPOSITES` (stessa semantica).
4. Effetto collaterale corretto: la penalità ×0.85 "coppia opposta ravvicinata" (~1100/1302-1319) smette di colpire le doppie chance (sono rivali, non letture opposte). Verificarlo in scheda.

**Non fare:** NON togliere il veto "famiglie ambigue" per gli opposti VERI ravvicinati (1 vs 2 entro 5 pt → niente segno; GG vs NG testa a testa; caso Zaglebie–Piast nel commento): quel veto è giusto, sbagliata era solo la definizione di "opposto".

**Test di accettazione:**
- Unitari (funzione ambiguità): X2 vs 1X → NON opposti; 1 vs 2, 1 vs X2, 2 vs 1X, GG vs NG, O2.5 vs U2.5 → opposti.
- Unitari (`areMarketsContradictory`, invariata): X2 vs 1X → true (rivali), 1 vs 2 → true.
- Integrazione **Turchia–Italia** (quote: 2.70/3.50/2.50, X2 1.45, 1X 1.52, GG 1.48, NG 2.50, O2.5 1.60, U2.5 2.20, O1.5 1.18, U3.5 1.45): pick **MG 2-4 totali @1.54 invariato** (la fusione lo preferisce: strutt+IA); fra le ALTERNATIVE CONCORDI deve comparire **X2 @1.45 (2/3: strutturale+PRE)**; **1X NON deve comparire** (rivalità di direzione); nessuna marcatura "famiglia esito ambigua"; nessuna penalità ×0.85 sulle DC.
- Integrazione **Belgio-Francia** (tetto aperto): nessuna doppia chance in cima; nessuna regressione.
- Regressione chiave (caso Zaglebie): ranking con X2 65% / 1X 62% e nessun candidato non-esito più alto → famiglia esito LEGGIBILE, pick = la doppia chance dominante (non niente).

**Risultato già verificato con simulazione (29/09, repo locale, fix = solo coppia rimossa dalla tabella 1):**
- ATTUALE: pick MG 2-4 17.5 (strutt+IA), alternative GG, O2.5, GG+O2.5 — **X2 e 1X ovunque assenti** (riproduce la scheda).
- FIX: pick MG 2-4 invariato; alternative = **X2 @1.45 (16.4, strutt+pre, 2/3)**, GG, O2.5; 1X esclusa dalla catena delle alternative per rivalità (`areMarketsContradictory("X2","1X")=true` tenuto); opposti veri intatti (`("1","2")=true`).
- Esito reale 1-4: pick MG 2-4 perso; **X2 alternativa vincente** (+ visibile invece che sparita); 1X persa ma correttamente ritirata; O2.5 e GG vincenti.

---

## TICKET 8 🟡 — Misurare il MANUALE per scenario (solo lettura: il proprietario vuole sapere se i suoi mercati da manuale rispondono davvero)

**Contesto (richiesta del proprietario, 29/09):** *"all'inizio della scheda c'è lo scenario (Equilibrio / Progressione / Gap) con i pronostici che ho messo io; ho notato che quando si verifica quello scenario i pronostici sono corretti"*. Oggi questa impressione NON è misurata da nessuna parte: il banner usa `getScenarioNote` (frontend/src/api.ts, ~1660: EQUILIBRIO/GAP TECNICO/PROGRESSIONE), ma l'apprendimento per scenario (`netlify/functions/lib/applyResult.ts`, `updateScenarioScores` → `scenario_market_scores`) usa `classifyScenario` di `lib/scenario.ts` (netta/chiara/leggera) — **due tassonomie che non si parlano**. I mercati del manuale non hanno statistiche.

**Obiettivo:** una misura, NON una nuova voce del verdetto. Output = tabella scenario × mercato del manuale: quante volte si è verificato lo scenario, quante volte ogni mercato del manuale è uscito, %. Poi il proprietario decide se il manuale merita un ruolo (es. quarta voce etichettata): QUESTO ticket non tocca il verdetto.

**Dove (file da creare/modificare):**
0. **Riscrivere il manuale in `getScenarioNote`** (~1690-1760) secondo la SPECIFICA FINALE del proprietario (29/09, seconda stesura — sostituisce la proposta precedente):
   - **EQUILIBRIO** (SPECIFICA CORRETTA, 2ª stesura del 29/09 + correzione 30/09 — tre rami con le SOGLIE INVARIATE della vecchia regola):
     • ramo gol fortissimo (GG < 1.5 e O2.5 < 1.5): **MG 3-6 totali** (come la vecchia regola);
     • equilibrio normale (GG < 1.8 e O2.5 < 1.8): **GG · Over 2,5 · MG 3-6 totali** (il terzo torna: richiesta esplicita del proprietario). ATTENZIONE: tre mercati SEPARATI in lista, ognuno considerato e misurato da solo — NON la combo "GG + Over 2,5";
     • fallback (GG e O2.5 fuori soglia, ≥1.8): **"X oppure GG"** SOLO QUI, al posto del vecchio MG 2-4. MAI negli altri rami (vincolo 30/09: "XoGG solo quando compariva MG tot 2-4").
   - **GAP TECNICO**: **favorita fisso** · **AH −0,75 favorita** · **GG + Over 2,5**. Nota a commento: AH −0,75 non giocabile al palinsesto → sostituto giocabile **MG favorita 2-4** (conversione proposta dal proprietario, pagella deciderà).
   - **PROGRESSIONE CASA**: **combo MG casa 1-3 + MG ospite 0-2** · **MG casa 1-3** · **1 DNB**. Nota: DNB non giocabile → sostituto **MG casa 1-3** (equivalenza del proprietario, ±7 pt su Poisson).
   - **PROGRESSIONE OSPITE** (speculare): **combo MG ospite 1-3 + MG casa 0-2** · **MG ospite 1-3** · **2 DNB** (sostituto: MG ospite 1-3).
1. **Estendere `evaluateMarketOutcome`** (frontend/src/api.ts ~1418) per i mercati del manuale oggi NON valutabili:
   - **MG generico**: regex `MG (\d+)-(\d+)( casa| ospite)?` → vince se i gol (della squadra o totali) cadono nel range (oggi è hardcoded SOLO "MG 2-4" totali).
   - **"X oppure GG"** (combo bookmaker, fallback equilibrio): vince se `home === away` (pareggio, 0-0 compreso) OPPURE `home > 0 && away > 0` (entrambe segnano); perde solo su vittorie a rete inviolata (1-0, 2-0, 0-1, 0-3…). Accettare le diciture "X o GG" / "X oppure GG".
   - **DNB** ("1 DNB"/"2 DNB"): vince se la favorita non pareggia; il pareggio è rimborsato → conteggiato a parte (né vinto né perso), e segnalarlo nel metodo.
   - **AH −0,75 favorita** ("1 AH -0,75"/"2 AH -0,75"): vinta piena se vince di 2+, metà se vince di 1 (per la % contare solo vinta/persa, mezze escluse e segnalate).
   - **Normalizzare la virgola**: `market.replace(",", ".")` prima dei parse (oggi "Over 2,5" funziona solo per un caso fortunato dei totali interi).
2. **Nuova aggregazione** (server, read-only): per OGNI partita conclusa con quote (`matches?result=not.is.null`), calcolare `getScenarioNote(odds)` (importabile da `frontend/src/api.ts`, stessa strada di verdettoServer), valutare OGNI mercato del manuale restituito con `evaluateMarketOutcome`, aggregare per (scenario, mercato): vinte, totali, pct. Una sola query, nessuna scrittura.
3. **Esposizione — NEL BANNER DELLO SCENARIO, in cima alla scheda (richiesta esplicita e corretta del proprietario: "se io apro una partita vedo lo scenario, accanto allo scenario ci stanno le proposte; accanto ai pronostici di quello scenario ci devono essere le percentuali con i numeri di quante volte è uscito quel pronostico relativo a quel scenario sullo storico; una volta inserito il risultato deve diventare verde il pronostico indovinato"):**
   a. **Banner SCENARIO** (`match/[id].tsx` ~448-479, il blocco "SCENARIO: EQUILIBRIO / Mercati da considerare"): accanto a OGNI mercato del manuale aggiungere la misura dallo storico: `• GG — 64,1% (88/137)` dove 137 = partite concluse in archivio con QUESTO scenario e 88 = quante volte GG è uscito. Il dato arriva da `/api/manuale-stats` (scelto lo scenario della partita, una riga); per le partite FUTURE mostra solo le percentuali; per le partite CON RISULTATO valutare ogni mercato del manuale con `evaluateMarketOutcome(market, result)` e **colorare in VERDE i pronostici indovinati** (gli altri restano neutri). ATTENZIONE: la valutazione è PER MERCATO — PIÙ pronostici possono essere verdi insieme (es. 1-4: GG ✅ E Over 2,5 ✅ entrambi verdi); non va colorato solo il migliore. NON va messo nella sezione STORICO QUOTE SIMILI: sta nel banner, accanto ai pronostici.
   b. **Traccia**, sotto i chip REGOLE: "MANUALE PER SCENARIO — quanto ha risposto finora", tabella globale scenario → mercato → % su n.
   Endpoint unico GET `/api/manuale-stats` (registrarlo nelle 3 sedi: `api/[route].ts`, `vercel.json`, `netlify.toml`).
   **Aggiornamento automatico** (parole del proprietario: "si aggiorna in base a più lo storico è ampio"; archivio attuale ~8.000+ partite concluse): la misura è calcolata VIVA sull'archivio intero (nessun contatore incrementale da tenere al passo): ogni risultato inserito — o riscaricato in blocco — entra da solo nelle percentuali alla successiva apertura.

**Non fare:** NON toccare `classifyScenario`/`lib/scenario.ts` (alimenta altra cosa), NON toccare `updateScenarioScores`, NON usare i risultati per cambiare il verdetto o il PRE, NON usare quote dei mercati (qui conta solo l'esito; il ROI non è un obiettivo).

**Test di accettazione:**
- Unitari valutatore: ("MG casa 1-3", "2-1")→true, ("MG casa 1-3", "0-0")→false, ("MG ospite 1-3", "1-4")→true, ("MG 0-2 ospite", "2-1")→true, ("MG 2-4 totali", "3-2")→true, ("MG 2-4 totali", "3-3")→false, ("MG 3-6 totali", "4-1")→true, ("MG 3-6 totali", "2-1")→false; combo ("MG casa 1-3 + MG ospite 0-2", "2-1")→true, ("…", "3-1")→false; ("X o GG", "0-0")→true, ("X o GG", "1-1")→true, ("X o GG", "2-1")→true, ("X o GG", "1-0")→false, ("X o GG", "0-2")→false; ("1 DNB", "1-1")→rimborso a parte, ("1 DNB", "2-1")→true; ("1 AH -0,75", "2-0")→true, ("1 AH -0,75", "1-0")→mezza a parte, ("1 AH -0,75", "0-0")→false; ("Over 2,5" con virgola, "2-1")→true.
- Il manuale aggiornato NON contiene più MG 2-4 in EQUILIBRIO; contiene MG 3-6 nel ramo gol fortissimo e la combo "X oppure GG" come fallback.
- Sanity check sul noto: sulle partite di profilo EQUILIBRIO simili a Turchia-Italia (1 e 2 entrambe ~2.55-2.85), GG e O2.5 devono uscire intorno al 60-66% (coerente con lo storico quote-simili: GG 62,3% e O2.5 66% su 53 partite).
- L'endpoint non scrive nulla (solo GET, nessuna pgPatch/pgRpc).

**Cosa aspettarsi:** la prima tabella reale del manuale. Se uno scenario mostra un mercato stabile ≥65% con n≥50, sarà candidato (decisione del proprietario) a quarta voce etichettata della fusione — con pagella, come sempre. Se scende sotto ~55%, il manuale resta promemoria e lo si dice onestamente.

9. **Il pronostico AI ignora scenario 1X2 e manuale** (segnalato dal proprietario il 29/09: "l'AI deve prendere in considerazione anche i relativi pronostici presenti nello scenario"): il prompt di `ai-predict.ts` contiene quote, PIN del motore, catalogo filtrato per whitelist+soglia e notizie Tavily, ma NESSUN riferimento a EQUILIBRIO/GAP TECNICO/PROGRESSIONE né ai mercati da manuale. In più la riga "storico X% su N partite simili" del catalogo usa la tassonomia netta/chiara/leggera, non quella del proprietario. → Ticket 9.

---

## TICKET 9 🟡 — Scenario e manuale nel prompt del pronostico AI (dipende dal Ticket 8)

**Richiesta del proprietario (29/09):** *"i pronostici devono essere aggiunti in base allo scenario (gap tecnico, progressione, equilibrio): in base alla partita e al tipo di scenario l'AI deve prendere in considerazione anche i relativi pronostici presenti nello scenario"*.

**Stato attuale (verificato nel codice):** `netlify/functions/ai-predict.ts` assembla il prompt con: quote + PIN del motore + CATALOGO (CANDIDATE_MARKETS → whitelist → soglia; per ogni voce prob Poisson, quota, "storico X% su N partite simili" da `scenarioRates` → `scenario_market_scores` con `classifyScenario` = netta/chiara/leggera) + contesto web Tavily. `netlify/functions/lib/predictionPrompt.ts` (PREDICTION_SYSTEM, 6 famiglie) NON contiene lo scenario 1X2 né il manuale. Il filtro post-AI scarta tutto ciò che non è nel catalogo (giusto: lezione NG del 18/09 e Vasco-Mirassol). NB: i MG casa/ospite NON sono in whitelist → oggi non possono essere proposti dall'AI.

**Fix minimo (tutto nel prompt, ZERO cambiamenti al verdetto):**
1. In `buildMatchPrompt` (o in `ai-predict.ts` prima del catalogo), aggiungere una sezione:
   ```
   🎯 SCENARIO DI QUOTE (manuale del proprietario)
   Questa partita è di scenario: EQUILIBRIO
   Mercati da manuale per questo scenario, con quanto hanno risposto
   storicamente in partite con questo stesso scenario (dall'archivio):
   • GG — 64,1% (88/137)
   • Over 2,5 — 60,6% (83/137)
   • X o GG — 58,4% (80/137)
   Istruzione: se un mercato del manuale è presente nel CATALOGO, valutalo
   con priorità e motivalo nell'analysis. Se NON è nel catalogo (fuori
   whitelist o sotto soglia), NON proporilo come playable_market: nominalo
   solo nell'analysis come "lettura da manuale non giocabile oggi".
   ```
   Lo scenario lo dà `getScenarioNote(odds)` (import da frontend/src/api.ts, come fa verdettoServer); le percentuali le dà l'endpoint del Ticket 8 (stessa funzione di aggregazione: dipendenza dura — senza Ticket 8 questo ticket si limita allo scenario senza percentuali).
2. Nell'`analysis` dell'AI (e quindi in scheda) il motivo deve poter citare lo scenario: es. "scenario EQUILIBRIO: il manuale indica GG (64% su 137)". NON cambia il formato JSON (main_prediction, playable_markets, analysis, reasoning invariati).
3. Nella sezione "storico" del catalogo, aggiungere in legenda una riga che spieghi la differenza: "storico" = partite con lo stesso profilo di favorita (tassonomia motore); il manuale dello scenario 1X2 è la sezione dedicata sopra.

**Esempio atteso post-fix (Spagna-Croazia 29/09, GAP TECNICO — il modello del comportamento voluto):**
1. Il prompt contiene: PIN (λ 2.72/0.71, pavimento 2, tetto APERTO), scenario → manuale con misura (**1 fisso 69,9% su 1577 · 1 AH −0,75 61,1% · GG + O2,5 46,2%**), catalogo filtrato (O2.5 66%/1.40 · DC 1X+O2.5 62%/1.43 · MG 3-6 62%/~1.57 · MG 2-4 61%/~1.60 · DC 1X+U3.5 51% · GG 47% · GG+O2.5 41%/2.73), dati web.
2. Ragionamento atteso dell'AI: "1 fisso" (manuale, oro) NON è nel catalogo (quota 1.20 < 1.40) → si cita in analysis, NON si propone. Il catalogo contiene il veicolo della stessa lettura: **DC 1X + O2.5** (casa non perde + pavimento gol, storico 74%) → MAIN. GG + O2,5 è nel manuale di questo scenario al 46,2% (<50%) → RETROCESSO. MG 3-6 coerente col tetto aperto (hi=6) → mantenuto.
3. Risposta: `main_prediction: DC 1X + O2.5`; `playable_markets: [DC 1X+O2.5, O2.5, MG 3-6 totali, MG 2-4 totali, DC 1X+U3.5]`; analysis in ordine fisso che APRE citando lo scenario ("GAP TECNICO: il manuale indica 1 fisso 69,9%, non giocabile oggi → veicolo più vicino nel catalogo: DC 1X + O2.5").
4. Nel VERDETTO la gerarchia non cambia: l'AI è una voce su tre. DC 1X+O2.5 prende il bonus IA; O2.5 raccoglie voci da più sistemi → concordanza sale (da SEGNALE PARZIALE 1/3 verso 2/3-3/3); il pick resta il primo ammesso della classifica (in produzione: O2.5, vinto). Lo scenario orienta COSA L'AI METTE SUL TAVOLO, non il conteggio finale.

**Non fare:** NON toccare il filtro post-AI né la whitelist (un mercato fuori whitelist resta fuori anche se il manuale lo indica — l'AI può solo citarlo nell'analysis); NON cambiare il formato JSON di risposta; NON far scegliere mercati fuori catalogo mai, nemmeno se il manuale li nomina.

**Test di accettazione:**
- Generando il pronostico su una partita EQUILIBRIO (es. profilo Turchia-Italia): nel prompt compare la sezione scenario con i mercati e le percentuali; la risposta resta JSON valido (parseAiJson ok); playable_markets ⊆ catalogo.
- Su una partita PROGRESSIONE: la sezione scenario elenca combo MG casa 1-3 + MG ospite 0-2, MG casa 1-3, 1 DNB; poiché MG casa/ospite e DNB sono fuori whitelist, nessuno compare in playable_markets, ma l'analysis può citarli come lettura da manuale.
- Con TAVILY_API_KEY assente il prompt scenario resta presente (non dipende dal web).
- Regressione: nessun cambio nei verdetti della fusione (il JSON di uscita ha lo stesso schema).

**Nota di onestà (da comunicare al proprietario):** questo ticket orienta l'AI, non le impone nulla — e i mercati non-whitelist del manuale restano NON giocabili dall'AI (scelta del menù del proprietario). Se un giorno vorrà che MG casa/ospite diventino proponibili anche all'AI, è UNA riga di whitelist (decisione sua, non di questo ticket).

10. **Il pronostico AI è un muro di testo, non in ordine** (visto in produzione su Spagna-Croazia 29/09: PIN ripetuto a metà analysis, xG di casa e ospite mescolati nella stessa frase): il campo `analysis` è prosa libera. Richiesta del proprietario: **formato TABELLARE, squadra casa a sinistra e ospite a destra, con tutte le statistiche trovate**, così "è facile da leggere". → Ticket 10.

---

## TICKET 10 🟢 — Pronostico AI in forma TABELLARE (casa | ospite), analysis in ordine fisso, senza ripetere il PIN (dipende dal Ticket 9)

**Richiesta del proprietario (29/09, visto in produzione su Spagna-Croazia):** *"il pronostico AI è confusionario nella spiegazione, non è in ordine… dovrebbe essere in forma tabellare, dove da una parte c'è la squadra casa e dall'altra l'ospite, con tutte le statistiche che ha trovato e che gli sono ricevute, così è facile da leggere"*.

**Stato attuale:** tutto finisce nel campo `analysis` (prosa libera salvata in `predictions`): il PIN viene RIPETUTO dal modello (già mostrato dalla sezione STRUTTURA MATCH), i numeri di casa e ospite sono mescolati nella stessa frase, nessun ordine fisso.

**Fix minimo:**
1. **Nuovo campo JSON OPZIONALE** `statistiche_squadre` nella risposta del modello (PREDICTION_SYSTEM + buildMatchPrompt in `netlify/functions/lib/predictionPrompt.ts`), schema fisso:
   ```json
   {"casa":  {"attacco": "", "difesa": "", "xg": "", "xga": "", "forma": "", "proiezione_gol": "", "note_chiave": ""},
    "ospite":{"attacco": "", "difesa": "", "xg": "", "xga": "", "forma": "", "proiezione_gol": "", "note_chiave": ""}}
   ```
   Regola d'oro: SOLO dati realmente trovati (contesto Tavily); dato assente = stringa vuota, MAI inventato. `parseAiJson` deve tollerare l'assenza del campo (le vecchie predictions restano leggibili).
2. **Frontend** (`match/[id].tsx`, sezione PRONOSTICO AI): se `statistiche_squadre` è presente → TABELLA a due colonne **CASA | OSPITE** con una riga per statistica (attacco, difesa, xG, xGA, forma, proiezione gol, note); sotto, l'analysis. Se assente (vecchi pronostici) → testo com'è oggi, nessun crash.
3. **Ordine fisso dell'analysis nel prompt**: (1) LETTURA DELLA PARTITA (2-3 frasi) → (2) PERCHÉ QUESTA SCELTA (2-3 frasi). **VIETATO ripetere il PIN** (pavimento/tetto/range/λ): è già a schermo in STRUTTURA MATCH. I numeri delle squadre vanno nei campi strutturati, NON in prosa.
4. La sezione "SCENARIO DI QUOTE" del Ticket 9 resta nel prompt come **prima lettura** (parole del proprietario: i mercati del manuale con storico forte "sono oro colato"): l'analysis può aprirsi citando scenario e manuale quando pertinenti.

**Non fare:** NON cambiare i campi esistenti del JSON (main_prediction, playable_markets, analysis, reasoning restano); NON bloccare il pronostico se il modello non popola `statistiche_squadre`; NON eseguire il 10 prima del 9 (dipendenza: il blocco scenario è definito lì).

**Test di accettazione:**
- Nuovo pronostico con Tavily attivo: JSON valido; `statistiche_squadre` presente con almeno 3 righe valorizzate; la scheda mostra la tabella a due colonne; l'analysis NON contiene più pavimento/tetto/range.
- Vecchia prediction senza il campo: scheda identica a oggi (fallback testo), zero errori.
- Tavily assente: `statistiche_squadre` può mancare o avere campi vuoti; il pronostico esce comunque.
- Regressione: fusione e verdetto invariati (il JSON aggiunge SOLO un campo opzionale).

11. **Correzione all'esecuzione del Ticket 8 (30/09)**: in produzione la combo "X oppure GG" compare SEMPRE in ogni equilibrio insieme a GG e O2.5; doveva stare SOLO nel ramo di fallback (al posto del vecchio MG 2-4), e nell'equilibrio normale deve tornare il terzo MG 3-6 totali. → Ticket 8-bis.

---

## TICKET 8-BIS 🔴 — Correzione all'esecuzione del Ticket 8: "X oppure GG" SOLO nel fallback; MG 3-6 torna nell'equilibrio normale

**Dove:** `getScenarioNote` in `frontend/src/api.ts`, i TRE rami di EQUILIBRIO (soglie 1.5/1.8: non si toccano).

**Sintomo in produzione (segnalato dal proprietario il 30/09):** la combo "X oppure GG" compare **sempre** in ogni equilibrio, insieme a GG e Over 2,5. La specifica era: la combo sostituisce MG 2-4 **solo nel ramo di fallback** ("tu dovevi solo modificare il nome da MG 2-4 a XoGG, solo quando veniva applicata la regola a equilibrato").

**Regola vecchia (riferimento — condizioni esatte da preservare):**
- GG < 1.5 E O2.5 < 1.5 → `[MG 3-6 totali]`
- GG < 1.8 E O2.5 < 1.8 → `[GG, Over 2,5]`
- altrimenti → `[MG 2-4 totali]` (il fallback che toglieva tutto)

**Regola nuova (SOLO questi due cambi):**
- ramo gol fortissimo: **INVARIATO** → `[MG 3-6 totali]`;
- equilibrio normale: `[GG, Over 2,5]` → `[GG, Over 2,5, MG 3-6 totali]` (il terzo torna, richiesta del proprietario);
- fallback: `[MG 2-4 totali]` → `["X oppure GG"]` — sola riga, nient'altro. In NESSUN altro ramo deve comparire la combo.

**Non fare:** NON toccare le soglie (1.5/1.8), NON toccare gli altri scenari (GAP/PROGRESSIONE), NON toccare il valutatore né le percentuali del Ticket 8 (MG 3-6 e "X oppure GG" sono già valutabili).

**Test di accettazione:**
- GG 1.60 / O2.5 1.70 (normale) → banner = GG, Over 2,5, MG 3-6 totali. NIENTE "X oppure GG".
- GG 2.00 / O2.5 1.95 (fallback) → banner = SOLO "X oppure GG". NIENTE GG, niente O2.5, niente MG 3-6.
- GG 1.40 / O2.5 1.45 (fortissimo) → banner = SOLO MG 3-6 totali.
- Le percentuali nel banner continuano a funzionare per tutte le righe (inclusi MG 3-6 e la combo).
- GAP TECNICO e PROGRESSIONE: nessun cambiamento.

---

## Allegato — perché questi ticket sono scritti così (nota per il proprietario)

A un assistente che scrive codice non si "spiegano" gli errori: si **trasformano in verifiche**. Tre regole usate qui, riutilizzabili per ogni bug futuro:

1. **Dove esatto + sintomo osservabile**, non la teoria. ("Storico lega sempre —", non "credo ci sia un problema di import").
2. **Un comando che oggi fallisce + output atteso dopo il fix.** L'AI non può capirti: può eseguire. Il test di accettazione È la spiegazione.
3. **Vincolo di fix minimo + cosa NON toccare.** Senza vincolo, un piccolo bug diventa un refactor che sposta altre cose.

E le tre abitudini anti-recidiva (già nella sezione Regole, da mantenere per sempre):
- typecheck rigoroso anche sulla catena `netlify/functions` (il buco del Ticket 1);
- `catch` muto vietato (è così che il Ticket 1 è rimasto invisibile);
- una regola usata in due posti = una funzione condivisa — e quando due regole SONO diverse, documentarlo esplicitamente (è la causa dei Ticket 3, 6 e 7).
