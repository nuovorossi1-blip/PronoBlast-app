# ticket/ — Round 2 (attivo dal 02/10/2026)

> **Questo è l'unico file da eseguire.** Il round 1 è chiuso e archiviato in
> [`ticket/storia/round-1.md`](storia/round-1.md): i suoi ticket 1→10 e 8-bis
> sono tutti a posto nel codice. Vale la stessa disciplina: un ticket = un
> commit, messaggio in italiano, verifiche incollate in chat.
>
> **Per il proprietario:** apri Claude Code e digli: *«Leggi `ticket/ticket.md`
> ed esegui i ticket in ordine, uno per commit, rispettando le REGOLE in testa al
> file»*. Questa frase vale per sempre: **`ticket/ticket.md` è sempre il round
> attivo**, i round chiusi finiscono in `ticket/storia/`.
>
> **Per Claude Code:** leggi TUTTO il file prima di toccare codice. I numeri che
> trovi qui NON sono opinioni: sono misure fatte il 02/10/2026 in sola lettura sul
> database di produzione. Servono a impedirti di riaprire domande già chiuse — e
> a farti vedere dove invece la domanda è ancora aperta.

---

## 1. LE DOMANDE CHE CI SIAMO POSTI (e perché)

Il round 1 è nato da due partite sbagliate. Il round 2 nasce da **quattro partite
guardate una per una** (Malta-Gibilterra 1-1, Germania-Serbia 2-0, Galles-Norvegia
2-1, Grecia-Olanda 2-2) e da una domanda del proprietario:

> «Come faccio far sì che il sistema confermi con tutti i dati a disposizione —
> info web, dati storici — qual è la giocata migliore nelle partite di GAP TECNICO
> con la favorita sotto 1,40? Lì possono uscire 5-2, 1-1, 2-0.»

Da qui le domande, in ordine. **Le risposte sono già dentro questo file: non
rifarle, non contestarle senza un numero nuovo che le smentisca.**

| # | Domanda | Risposta (misurata) |
|---|---|---|
| D1 | La soglia 1,40 è troppo alta? Alzarla aiuta? | **No.** La fascia 1,40 è la MIGLIORE: 63,4% su 5.227 partite. Alzare la soglia costa: 1,50→60,3%, 1,60→57,9%, 1,75→50,4%. |
| D2 | Il sistema batte il bookmaker? | **No, alla fascia 1,40 è al prezzo esatto del book** (63,4% misurato contro ~64,7% equo). Il vantaggio cresce solo alzando la quota (+3,7 pt a 1,75+) — cioè dove si vince meno. |
| D3 | La concordanza fra i tre sistemi è un segnale? | **No.** 0/3 → 59,7% · 1/3 → 60,7% · 2/3 → 64,6% · 3/3 → **58,5%** su 588 verdetti. χ² = 0,80 (soglia 7,81): indistinguibile dal caso. E il bonus in punteggio è il più alto della fusione (+8). |
| D4 | La fusione batte i suoi ingredienti? | **Non si vede.** Per scenario: Equilibrio Verdetto 57,7% contro AI 65,1%; Progressione 59,1% contro PRE 64,2%; Gap Tecnico 65,0% contro AI 67,3%. Suggerisce, non dimostra (n piccoli, insiemi diversi). |
| D5 | Perché due partite GAP identiche hanno pick dal lato gol opposto? | **Non è un bug**: lo scenario legge solo l'1X2, il lato gol lo decide profilo+tetto del motore. La regola è una sola (`classifyFamily`) ed è applicata bene. |
| D6 | Quale mercato rende davvero nel GAP TECNICO? | Vedere la tabella §2.3. Il migliore giocabile è **64,0-64,6%** con la favorita sotto 1,40 e **61,8%** sopra. `GG + Over 2,5` è il **peggiore in ogni gruppo** (32,6-48,9%). |
| D7 | Perché l'app sembra "rumorosa" e non si capisce di chi fidarsi? | Perché **numeri misurati e numeri decorativi hanno lo stesso aspetto**. Vedi §3 e il TICKET 1. |

**Il punto di D7, in una riga.** Le percentuali d'archivio per scenario (62,9% ·
64,6% · 65,1%) sono misurate su centinaia di partite e hanno detto cose vere su
Malta e Germania. Il badge "CONCORDANZA 3/3" e le "opportunità non sfruttate"
hanno la stessa grafica — e non valgono niente. Quando due segnali che *sembrano*
forti si rivelano rumore, si finisce per non fidarsi nemmeno di quelli buoni.

---

## 2. LE MISURE (sola lettura, 02/10/2026)

### 2.1 Pagella per fascia — ricalcolo `2026-10-01b`, 8.420 partite

| fascia | indovinati | n | % | IC 95% |
|---|---|---|---|---|
| **1,40-1,49** | 3.312 | 5.227 | **63,4%** | 62,1-64,7 |
| 1,50-1,59 | 3.323 | 5.513 | 60,3% | 59,0-61,6 |
| 1,60-1,74 | 3.602 | 6.222 | 57,9% | 56,7-59,1 |
| 1,75+ | 3.257 | 6.456 | 50,4% | 49,2-51,7 |

Confronto sulle stesse partite, regole di oggi vs verdetto congelato: fascia 1,40
**197 vs 184** (+4,4 pt); fascia 1,75 **181 vs 208** (−7,6 pt).

### 2.2 Concordanza — 588 verdetti congelati

| concordanza | % | n |
|---|---|---|
| 0/3 | 59,7% | 288 |
| 1/3 | 60,7% | 163 |
| 2/3 | 64,6% | 96 |
| 3/3 | **58,5%** | 41 |

χ² = 0,80 su 3 gradi di libertà (soglia 7,81) → **nessun segnale**.

> ⚠️ Questi 588 verdetti sono stati congelati sotto regole vecchie (maggio→oggi,
> cinque cambi di regola). Non misurano il codice di oggi. Servono al TICKET 3,
> che rigioca il codice ATTUALE: fino ad allora nessuna conclusione definitiva.

### 2.3 GAP TECNICO, per gruppo di partita (fasce di quota stimate con `(1/p)/1,07`)

**Favorita sotto 1,40 · altro profilo · tetto aperto (579)**
`DC favorita + O1.5 81,7%` (no) · `favorita fisso 80,5%` (no) · **`DC favorita + O2.5` 65,1% ≈1,44** · MG favorita 1-3 64,4% ≈1,45 · MG favorita 2-4 63,6% ≈1,47 · MG 3-6 62,3% ≈1,50 · MG 2-4 totali 56,0% · `GG + O2.5` **48,9%**

**Favorita sotto 1,40 · DIFENSIVA · tetto aperto (165)**
`favorita fisso 88,5%` (no) · `DC favorita + O1.5 87,3%` (no, ~1,07) · **`DC favorita + O2.5` 66,7% ≈1,40** · MG favorita 2-4 64,2% ≈1,45 · favorita + U4.5 61,2% ≈1,53 · MG 2-4 totali 60,6% · `GG + O2.5` **33,9%**

**Favorita sotto 1,40 · DIFENSIVA · tetto chiuso (175)**
`MG favorita 1-3 78,3%` (no, ~1,19) · favorita fisso 75,4% (no) · **`MG 2-4 totali` 64,6% ≈1,45** · favorita + U4.5 62,9% ≈1,49 · MG favorita 2-4 57,7% · `GG + O2.5` **31,4%**

**Favorita sotto 1,40 · altro profilo · tetto chiuso (94)**
`MG favorita 1-3 78,7%` (no) · MG 2-4 totali 76,6% (no, ~1,22) · **`MG favorita 2-4` 66,0% ≈1,42** · favorita + U4.5 58,5% · `GG + O2.5` **39,4%**

**Favorita da 1,40 in su · altro profilo (1.148)**
`MG favorita 1-3 70,0%` (no, ~1,31) · `DC favorita + O1.5 67,9%` (no) · **`X oppure GG` 61,8% ≈1,48** · `favorita fisso 61,5%` (quota reale, giocabile) · MG 2-4 totali 59,4% · MG 3-6 59,0% · MG favorita 2-4 55,1% · `GG + O2.5` **48,4%**

**Favorita da 1,40 in su · DIFENSIVA (35)** → **campione troppo piccolo, non usabile.**

> ⚠️ Due cautele da non dimenticare mai leggendo queste tabelle:
> 1. le righe `O2.5`, `GG`, `NG`, `U3.5` sono contate **solo dove la quota reale
>    era ≥1,40**, quindi su un sottoinsieme selezionato e schiacciato verso il 50%
>    (es. O2.5 61,0% è su 264 partite, non 579). I MG e le combo non hanno questo
>    difetto: la loro quota è sempre stimata.
> 2. guadagno della nuova lista, se il verdetto scegliesse il migliore del gruppo:
>    **+0,1 pt** (sotto 1,40 · altro) · **+1,7 pt** (sotto 1,40 · DIFENSIVA) ·
>    **+0,3 pt** (da 1,40 in su). La lista cambia *quale* mercato giochi, non
>    *quanto* vinci: il tetto di questo scenario è ~62-64%.

### 2.4 Equilibrio, per ramo del manuale

| ramo | partite | migliore giocabile | più debole |
|---|---|---|---|
| 1 · gol fortissimo (GG<1,5) | 367 | MG 3-6 60,5% | combo non giocabile (70,3% ma sotto fascia) |
| 2 · normale (GG<1,8) | 1.149 | **X oppure GG 64,8%** (677 giocabili) | GG 60,3% · O2,5 57,8% · MG 3-6 55,2% |
| 3 · fallback (≥1,8) | 2.262 | **X oppure GG 62,3%** | Over 2,5 45,3% · MG 3-6 43,8% |

La combo rende uguale nei rami 2 e 3 (z = −1,19): la regola del 30/09 che la
vieta nel ramo normale **non è sostenuta dai dati**. Ma è una decisione del
proprietario: **non toccarla in questo round** (vedi TICKET 2-bis).

### 2.5 Il manuale per scenario — 8.554 partite concluse

`GAP 1 · 1 fisso 70,3%` · `GAP 1 · 1 AH -0,75 61,4%` (58,7% contando le mezze) ·
`GAP 1 · GG + O2,5 46,4%` · `PROG 1 · MG casa 1-3 73,4%` · `PROG 1 · combo 67,3%` ·
`EQ · X oppure GG 62,3%`.

**Il nodo**: i mercati del manuale più precisi (70-74%) sono tutti **sotto la
soglia**; i sostituti giocabili stanno al 60-65%. La fascia 1,40 obbliga a
lasciare a terra i mercati che il manuale indovina di più. È lì il margine.

---

## 3. PERCHÉ L'APP SEMBRA RUMOROSA (diagnosi, non opinione)

Contando la scheda di Malta (partita conclusa con AI): **≈250 numeri a schermo,
≈18 utili alla decisione.** Ma il danno non è la fatica di leggere: è che due
segnali **finti** hanno lo stesso aspetto dei due **veri**.

1. **Il blocco "EURISTICA RAPIDA" con le "opportunità non sfruttate"** mostra
   numeri che sono **costanti di famiglia**, non di questa partita: su Malta e su
   Galles la lista è identica (`189/227 83.3% · 177/227 78% · 161/227 70.9%`…).
   Fonte: `netlify/functions/match-candidates.ts`, che legge `market_scores`
   filtrato per famiglia e `family_counters` per il totale.
   Peggio: la famiglia usata lì viene da `predictions.family` (**la risposta
   dell'AI**), non da `structural.structure.family` (**il motore**). Per questo su
   Galles i tile dicono `DOMINANZA OVER` e la lista dice `DOMINANZA_CON_TETTO`:
   due nomi diversi per "la famiglia", nella stessa schermata.
2. **Il badge "CONCORDANZA PIENA 3/3"** è il titolo del verdetto — ed è il numero
   con meno contenuto informativo che l'app mostri (§2.2).
3. **La caption dell'euristica promette** che la lista "NON tiene conto del
   pronostico AI" — ma la riga sotto mostra il tag `PRE+AI`, e nel codice della
   fusione c'è scritto che `rankPicks` unisce anche i mercati proposti solo
   dall'IA. La caption contraddice il contenuto.
4. Altri due rumori minori: il **ranking a 17 righe** (con `rotto da: 0-0, 1-1`
   ripetuto su ognuna) e la sezione **"STORICO QUOTE SIMILI"** con il titolo e il
   vuoto sotto, quando non ci sono dati.

---

## 4. REGOLE (come round 1) + VERIFICA OBBLIGATORIA

1. **Fix minimo.** Vietato refactorare oltre il ticket. Un ticket = un commit.
2. **Commenti e test in italiano**, come nel resto del progetto.
3. **Vietato ingoiare errori**: ogni `catch` nuovo o toccato logga con contesto.
4. **Una regola in due posti = una funzione condivisa** (o, se divergono di
   proposito, va scritto perché).
5. **Soglie intoccabili**: 1,35 / 1,40 / 1,50 / 1,60 / 1,75, fasce a intervalli
   chiusi, ±5 pt di tie-break, −15% di tolleranza storico.
6. **Metrica unica**: % di pronostici indovinati entro soglia. Il ROI non è un
   obiettivo.
7. **NG / U1.5 / U2.5 restano veto-only**: mai proposti, mai giocati.
8. **Questo round NON scrive sul database.** Solo letture, tranne il ricalcolo che
   esiste già. Se un ticket pensa di dover scrivere, si ferma e lo chiede.

**Verifica obbligatoria a fine ticket** (da eseguire e incollare in chat):

```bash
cd frontend && npm ci
node_modules/.bin/tsc --noEmit                        # frontend: 0 errori
cd ..
frontend/node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
  --target es2022 --module esnext --moduleResolution bundler --types node \
  --typeRoots frontend/node_modules/@types \
  'api/[route].ts'                                    # catena funzioni: 0 errori
```

⚠️ **La riga `--typeRoots` è una correzione al comando del round 1**: senza,
in un checkout pulito il comando muore con `error TS2688: Cannot find type
definition file for 'node'`, perché `@types/node` vive in `frontend/node_modules`
e il typecheck parte dalla radice. Il buco è lo stesso del Ticket 1 del round 1:
la catena `netlify/functions` va compilata a parte.

⚠️ **Trappola del repo**: `backend/` Python **non esiste più**. Il codice vero è
in `netlify/functions/` e `frontend/src/`. E ogni nuova funzione server va
registrata in **TRE** posti: `api/[route].ts`, `vercel.json`, `netlify.toml`.

---

## TICKET 1 🟢 — Scheda essenziale (solo presentazione; il verdetto NON cambia)

**Perché.** §3. Il proprietario deve poter distinguere a colpo d'occhio un numero
misurato da uno decorativo. Nessuna modifica a motore, fusione, soglie o DB.

**Dove:** `frontend/app/match/[id].tsx` (la scheda), più il ritocco di cui al
punto 4. Il file ha ~2.288 righe: tocca solo i blocchi indicati.

1. **Blocco "EURISTICA RAPIDA (solo quote)"** (riga ~1360, più la lista
   `yellowCandidates.map` a riga ~1406): sostituirlo con **una riga** — il pick
   del PRE con la sua quota, etichettato "terzo parere (solo quote)". Il riquadro
   `★ PICK CONSIGLIATO` non è più un blocco a sé: è quella riga.
   **NON** toccare `rankPicks` (riga ~1284): serve alla fusione. Si toglie solo la
   visualizzazione. Non eliminare l'endpoint `match-candidates`: resta in piedi,
   inutilizzato.
2. **Badge concordanza** (riga ~726, `concLabel`): da titolo del verdetto a **nota
   piccola** accanto al pick. Il numero resta visibile.
   **NON** toccare i punti nel punteggio (+8 / +2,5): quello è materia del TICKET
   3 e 4, non di un ticket di presentazione.
3. **Ranking strutturale**: 3 righe + "mostra tutti"; `rotto da:` solo sulla riga
   del pick.
4. **Una sola tassonomia di famiglia**: in tutta la scheda si usa
   `structural.structure.family` (il motore). La famiglia dell'AI
   (`predictions.family`) non viene più mostrata come se fosse quella del motore.
   *(Con il punto 1 il problema si riduce già molto: era quello il posto dove le
   due convivevano.)*
5. **"STORICO QUOTE SIMILI"** (riga ~1298): se la sezione è vuota, niente titolo.
6. **Etichette di fonte**: distinguere `Poisson` da `in archivio (n)`. Es.:
   `63,4% Poisson` e `64,6% in archivio (113/175)`. Piccola legenda a un tocco.

**Test di accettazione:**
- Screenshot prima/dopo su un giorno con partite già pronosticate: **il pick del
  verdetto è identico**, cambia solo cosa si vede attorno.
- Nessuna riga della scheda mostra due nomi diversi di famiglia.
- Sezioni senza dati non mostrano il titolo.
- I due comandi di verifica di §4: 0 errori.

**Cosa NON fare:** cambiare il verdetto, il motore, la fusione, le soglie; toccare
`rankPicks`, `buildFinalVerdict`, `structuralAnalysis`; eliminare endpoint.

---

## TICKET 2 🟡 — Lista del manuale GAP TECNICO (pratico, basso rischio)

**Perché.** §2.3: nel GAP TECNICO il manuale propone `GG + Over 2,5`, che è il
**peggiore in tutti e quattro i gruppi** (32,6 · 33,9 · 39,4 · 48,9%), mentre i
due mercati migliori *giocabili* — `DC favorita + O2.5` (64,0-65,1%) e
`MG 2-4 totali` (62,6-64,6%) — non vengono indicati.

**Dove:** `frontend/src/api.ts`, `getScenarioNote`, ramo GAP TECNICO (righe
~2674-2693).

**Fix minimo** (attenzione: la sostituzione serve **solo quando la favorita paga
sotto 1,40**, perché sopra è il `fisso` stesso a essere giocabile — 61,5% nel
gruppo da 1.148 partite, il migliore giocabile di quel gruppo):

- togliere `GG + Over 2,5` dalla lista del GAP TECNICO, in ogni caso;
- **se la quota della favorita è sotto 1,40** (il `fisso` non è giocabile):
  mettere al suo posto **un solo sostituto scelto dal profilo** del motore
  (`structural.structure.offensive_profile`, la stessa cosa che
  `underAmmessiATettoAperto` legge già):
  - profilo `defensive` → `MG 2-4 totali` (62,6% sotto 1,40 · DIFENSIVA);
  - altrimenti → `DC favorita + O2.5` (64,0-65,1%);
- **se la quota della favorita è 1,40 o più**: la lista resta `favorita fisso`
  (+ eventualmente `X oppure GG`, 61,8% nello stesso gruppo: statisticamente
  pari al fisso, quindi non è obbligatorio aggiungerla). Qui il manuale
  funziona già: era l'altra metà del prezzo a essere scoperta.

**Non fare:**
- NON toccare la whitelist: `DC 1X + O2.5` e `MG 2-4 totali` sono **già**
  giocabili (`VERDICT_WHITELIST`). Non serve aggiungere niente.
- NON toccare gli altri scenari (Equilibrio, Progressione) né le soglie.
- NON toccare la regola del 30/09 sul ramo normale dell'Equilibrio: §2.4 mostra
  che la combo rende bene anche lì, ma è una decisione del proprietario →
  TICKET 2-bis, separato e subordinato al suo via.
- NON aggiungere `MG favorita 1-3`: fuori fascia in 3 gruppi su 4 (quota stimata
  ~1,19-1,38). Decisione del proprietario → TICKET 5.

**Misura di verifica:** `/manuale-stats` ricalcola l'archivio sulla lista ATTUALE
(`lib/manuale.ts` rigioca `getScenarioNote` su tutte le concluse): dopo il
deploy la voce nuova ha subito lo storico di TUTTI i GAP TECNICI passati — nessuna
migrazione, nessun azzeramento. Attendersi, per `MG 2-4 totali` in GAP TECNICO,
circa 58,8-62,6% con n ~1.013 — **lo stesso ordine dei numeri di §2.3**, che sono
stati misurati con query indipendenti da `getScenarioNote`.

**Test di accettazione:**
- Una partita GAP TECNICO, profilo non difensivo: la riga dello scenario elenca
  `favorita fisso` + `DC favorita + O2.5`.
- Una partita GAP TECNICO con profilo `defensive`: elenca `MG 2-4 totali`.
- Nessuna partita mostra più `GG + Over 2,5` nello scenario GAP TECNICO.
- Equilibrio e Progressione: identici a prima.
- I due comandi di verifica: 0 errori.

---

## TICKET 3 🟡 — Backtest della fusione (lo strumento che oggi non esiste)

**Perché.** `netlify/functions/backtest.ts` rigioca **solo il motore** (regole
`motore` / `maxprob` / `pre`). La cosa che decide davvero — `buildFinalVerdict`,
la fusione — **non è mai stata rigiocata**. Perciò ogni giudizio su di lei si
appoggia a verdetti congelati sotto regole vecchie (§2.2) e resta debole. Senza
questo strumento il TICKET 4 non si può attivare: si tornerebbe a decidere a
occhio, che è esattamente l'errore che questo round vuole evitare.

**Cosa:** nuova funzione `netlify/functions/backtest-fusione.ts`, **sola lettura**,
a blocchi (stessa impostazione di `backtest.ts`, `MAX_BLOCCO = 500`).

- Rigioca per ogni partita conclusa: `structuralAnalysis` → `preHeuristicRanking`
  → `buildFinalVerdict` (con `manuale` dai mercati del manuale dello scenario) →
  esito con `evaluateMarketStrict`.
- Parametri: `from`, `limit`, `minOdd`, `split` (misura solo dopo una data), e
  **`variante`**, con almeno:
  - `base` = codice di oggi;
  - `no-concordanza` = senza il bonus di concordanza nel punteggio (±8 / 2,5);
  - `archivio-calcolo` = con l'archivio dentro il calcolo (serve dopo il TICKET 4).
- Risposta: conteggi aggregati (vinte/perse, per fascia, per famiglia, quanti
  pick, occasioni perse), **mai scritture** su `matches`.
- Registrarla nei tre posti (§4).

**Test di accettazione:**
- Due chiamate con varianti diverse sugli stessi indici elaborano **le stesse
  partite** (stesso numero di esaminate/scartate), con totali diversi.
- La somma dei blocchi copre il totale dichiarato (come fa `backtest.ts`).
- Nessuna PATCH al database (verificabile: nessun `pgPatch` nel file).
- I due comandi di verifica: 0 errori.

---

## TICKET 4 🟡 — L'archivio entra nel calcolo (BLOCCATO finché il TICKET 3 non mostra un guadagno)

**Perché.** È la risposta alla domanda del proprietario («come faccio far sì che
il sistema confermi con tutti i dati»). Oggi la misura d'archivio entra nella
fusione **come nota a 0 punti**:

```ts
// frontend/src/api.ts, riga ~1238
b.dettaglio.push({ voce: `manuale dello scenario: ...% in archivio (...)`, punti: 0 });
```

Conseguenza: l'ordinamento del verdetto resta quello del ranking del motore. Su
Galles-Norvegia si vede tutto: `MG favorita 1-3` vale **64,4% in archivio**
(→ quota ~1,45, giocabile) ma il **motore** lo stima 71,2% (→ 1,31) e lo scarta.
Stesso mercato, giudizio opposto — perché l'archivio non entra nel conto.

**Cosa:** in `buildFinalVerdict`, per i mercati del manuale che hanno una misura
d'archivio dello scenario, la probabilità dell'archivio **entra nel calcolo**
mescolata a quella del motore, con la stessa idea di shrinkage già usata dalla
FASE 3 dell'engine (`k = n / (n + SHRINK)`, SHRINK = 80): con poche partite vince
il modello, con centinaia vince l'archivio.

**Vincoli:**
- **n minimo esplicito** (proposta: ≥100) e **n mostrato a schermo**. Sotto
  soglia, comportamento identico a oggi.
- Nessuna soglia toccata (§4, regola 5).
- Una sola sede: il server importa già `buildFinalVerdict`, quindi telefono e
  `/verdetto` restano allineati per costruzione.
- Se l'archivio deve spostare l'**ordine**, va cambiata anche la chiave di
  ordinamento: farlo solo se il TICKET 3 misura un guadagno.
- **La decisione di attivarlo è del proprietario**, con il numero del TICKET 3 in
  mano.

**Test di accettazione:**
- Malta-Gibilterra: il pick passa da `1 + U4.5` (62,9% d'archivio) a
  `MG 2-4 totali` (64,6%) — **solo se** il TICKET 3 mostra guadagno complessivo.
- Day-check su un giorno di partite: il delta misurato dalla `variante`
  `archivio-calcolo` è positivo; se è negativo o nullo, **non si attiva** e si
  scrive il risultato nel CHANGELOG.
- Telefono e server danno lo stesso verdetto sulla stessa partita.
- I due comandi di verifica: 0 errori.

---

## TICKET 5 🟡 — Decisione del proprietario: `1 AH -0,75` (nessun codice finché non decide)

**Stato.** Già convertito in `MG casa/ospite 2-4` (commit `9df2161`, branch di
sessione, **non pushato**). Nato dal Ticket 8 del round 1 ("sostituto giocabile
MG favorita 2-4, la pagella deciderà").

**Cosa dice la pagella adesso** (§2.3):

| gruppo | MG favorita 2-4 | MG 2-4 totali | MG favorita 1-3 |
|---|---|---|---|
| sotto 1,40 · DIFENSIVA · chiuso | 57,7% | **64,6%** | 78,3% (~1,19 → fuori) |
| sotto 1,40 · DIFENSIVA · aperto | 64,2% | 60,6% | 57,6% |
| sotto 1,40 · altro · aperto | 63,6% | 56,0% | 64,4% (~1,45) |
| sotto 1,40 · altro · chiuso | **66,0%** (~1,42) | 76,6% (~1,22 → fuori) | 78,7% (~1,19 → fuori) |

Letta bene: **`MG favorita 2-4` è decoroso ma non è mai il migliore**, e
`MG 2-4 totali` lo batte in due gruppi su tre. Il TICKET 2 già mette `MG 2-4
totali` (gruppi difensivi) e `DC favorita + O2.5` (gli altri) nella lista dello
scenario: quella è la parte che si può fare. **La sorte della voce `AH -0,75` /
`MG favorita 2-4` va decisa dal proprietario** fra: tenerla così, sostituirla con
`MG favorita 1-3`, o toglierla del tutto (lo scenario avrebbe già i suoi
candidati misurati).

**Nota tecnica:** il valutatore `esitoMercato` conosce l'AH e le sue "mezze":
**non va toccato**, serve alle righe storiche anche se il mercato esce dalla
lista.

---

## TICKET 2-bis 🟡 — Equilibrio, ramo normale: rimettere `X oppure GG`? (decisione del proprietario)

**Perché.** §2.4: la combo rende **64,8%** nel ramo normale (giocabile in 677
casi) contro **57,8%** di media dei tre mercati oggi proposti lì (GG 60,3%,
Over 2,5 57,8%, MG 3-6 55,2%), e rende uguale nel ramo di fallback (62,3%:
z = −1,19). La regola del 30/09 ("combo SOLO nel fallback") **non è sostenuta dai
dati**.

**Cosa (solo se il proprietario dice sì):** nel ramo normale, aggiungere
`X oppure GG` come candidato accanto a GG, Over 2,5 e MG 3-6 — oppure sostituire
`MG 3-6 totali` (il più debole). **Nessuna soglia toccata.** La fusione sceglie,
come per gli altri.

**Perché è separato:** è una decisione esplicita del proprietario del 30/09. Non
si applica di iniziativa, e non si applica in questo round senza il suo via.

---

## 5. ESEMPI DI ACCETTAZIONE (da usare come riferimento nei test)

Le percentuali d'archivio sono quelle di §2.3.

### Malta-Gibilterra 1-1 · GAP TECNICO · DIFENSIVA · tetto chiuso
```
ARCHIVIO  GAP · favorita <1,40 · DIFENSIVA · chiuso (175)
          MG favorita 1-3    78,3%   ~1,19   non giocabile
          favorita fisso     75,4%    1,27   non giocabile
          MG 2-4 totali      64,6%   ~1,45   <- miglior giocabile
          favorita + U4.5    62,9%   ~1,49   (giocato oggi)
          GG + Over 2,5      31,4%   ~2,97   (peggiore)
OGGI      verdetto: 1 + U4.5 @1,47  -> PERSO
DOPO      (solo con TICKET 4 attivo): MG 2-4 totali ~1,45 -> VINTO (2 gol nel range)
```

### Germania-Serbia 2-0 · GAP TECNICO · altro profilo · tetto aperto
```
ARCHIVIO  GAP · favorita <1,40 · altro · aperto (579)
          DC favorita + O1.5  81,7%   1,14   non giocabile
          favorita fisso      80,5%   1,20   non giocabile
          DC favorita + O2.5  65,1%  ~1,44   <- miglior giocabile
          MG favorita 1-3     64,4%  ~1,45
          GG + Over 2,5       48,9%  ~1,91   (peggiore)
OGGI      verdetto: DC 1X + O2.5 @1,42 = DC favorita + O2.5 -> 65,1% = GIÀ il migliore
ESITO     2-0 -> PERSO. Non c'era niente da correggere: persa per rumore
          (serve il 3° gol, succede nel 35% dei casi).
```
Questo esempio serve a **impedire "migliorie" retroattive**: su Germania scelta
giusta e risultato sbagliato convivono, ed è normale.

### Irlanda-Austria · EQUILIBRIO · ramo di fallback
```
ARCHIVIO  EQUILIBRIO · fallback (2.262)
          X oppure GG   62,3%   1,67   <- miglior giocabile
          MG 2-4 totali 59,5%  ~1,55
          GG            52,5%   1,85   (consigliato dall'AI)
          Over 2,5      45,3%  ~2,06
OGGI      l'AI consigliava GG @1,85 (52,5%): -9,8 pt contro la combo, senza un
          fatto dal web che lo giustificasse.
ATTESO    (TICKET 2-bis, se il proprietario dice sì) la combo entra fra i candidati.
```

### Guardrail di non-regressione
Su un giorno qualunque, con il solo TICKET 1 attivo, **il pick del verdetto non
cambia**. Con il TICKET 2 attivo, cambia **solo nelle partite GAP TECNICO**.
Con il TICKET 4 attivo, cambia dove l'archivio ha n ≥ 100 e solo se il TICKET 3
mostra guadagno complessivo.

---

## 6. COSA NON FARE (le tentazioni da cui questo round vuole proteggersi)

- **Non cambiare le soglie** per far vincere le partite già viste. Le soglie sono
  calibrate e §2.1 dice che la 1,40 è la migliore delle quattro.
- **Non aggiungere mercati alla whitelist** senza il proprietario.
- **Non toccare il bonus di concordanza** in un ticket di presentazione: la sua
  eventuale rimozione passa dal TICKET 3, con il numero in mano.
- **Non estendere** Equilibrio e Progressione in questo round: si fa il GAP
  TECNICO, si misura, poi si decide.
- **Non "migliorare" oltre il ticket.** Ogni riga non richiesta è una regressione
  futura difficile da trovare (è così che è nato il Ticket 1 del round 1).
- **Non scrivere sul database** in questo round.
- **Non fidarsi dei numeri di questo file come se fossero eterni**: sono misure
  del 02/10/2026, in sola lettura, con i campioni indicati. Prima di rivedere una
  decisione serve una misura nuova, non un'impressione.
- **Non eliminare la cartella `ticket/`** finché questo round non è chiuso. A
  lavori finiti non si elimina: questo file viene rinominato in
  `ticket/storia/round-2.md` e il round 3 prende il nome `ticket/ticket.md`
  (regola nuova del 02/10, sostituisce "cartella temporanea" del round 1).

---

## 7. IN UNA RIGA (per chi apre il file fra sei mesi)

Il round 1 ha corretto i bug. Il round 2 ha scoperto che **il sistema non è
rumoroso perché ha troppe funzioni, ma perché i numeri misurati e quelli
decorativi hanno lo stesso aspetto** — e che, nello scenario più difficile (GAP
TECNICO con favorita corta), la lista dei mercati propone il peggiore e non
indica i due migliori, che sono già giocabili. Tre ticket di presentazione e
lista (1, 2), uno strumento di misura (3), una modifica al calcolo da attivare
solo se lo strumento la promuove (4), due decisioni del proprietario (5, 2-bis).
