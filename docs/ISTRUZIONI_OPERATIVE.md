# Istruzioni operative

## Progetto

**PronoBlast** (repository `emergent-app`) — app di analisi partite e pronostici
calcio. Per ogni partita mostra un ranking di mercati con la probabilità stimata
dal motore, la quota reale del bookmaker e un verdetto finale che fonde tre voci:
motore statistico (Poisson), IA e pre-pronostico letto dalle quote.

Prima di modificare qualsiasi cosa leggere [`CHANGELOG.md`](../CHANGELOG.md)
(decisioni, regole del pick, trappole note: `backend/` non esiste più, la logica
vera è in `netlify/functions/`). Il lavoro in corso per Claude Code è descritto in
[`ticket/ticket.md`](../ticket/ticket.md) (vedi [`ticket/README.md`](../ticket/README.md)).

## Stack tecnologico

| Parte | Tecnologia | Dove |
|---|---|---|
| Frontend | Expo 54 + Expo Router 6, React 19, React Native 0.81 / React Native Web, TypeScript 5.9 | `frontend/` (export statico in `frontend/dist`) |
| Server | Funzioni TypeScript (stile Netlify Functions) | `netlify/functions/` |
| Dispatcher Vercel | Un'unica Serverless Function che smista tutte le rotte | `api/[route].ts` (+ `api/upload-excel.mjs`) |
| Database | Supabase (PostgREST via `fetch` + funzioni SQL) | schema in `docs/database.sql` |
| Hosting | Vercel (produzione, `https://pronoblast.vercel.app`), Netlify in parallelo | `vercel.json`, `netlify.toml` |
| Android | Guscio Capacitor 7 che carica l'app di produzione | `android/`, `capacitor.config.ts` — vedi [`android-apk.md`](android-apk.md) |
| CI | GitHub Actions: build APK, aggiornamento risultati giornaliero, keep-alive Supabase | `.github/workflows/` |
| Runtime | Node.js **22.x** | `package.json` (`engines`), `netlify.toml` |

Variabili d'ambiente richieste dalle funzioni server: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (obbligatorie), `APIFOOTBALL_KEY`, `TAVILY_API_KEY`.
I file `.env` sono esclusi da git.

Ogni nuova funzione server va registrata in **tre** posti: `api/[route].ts`,
`vercel.json` (rewrite) e `netlify.toml` (redirect). Saltarne uno la fa finire
sul fallback SPA senza errori visibili.

## Installare le dipendenze

```bash
cd frontend
npm ci
```

Solo se si lavora sul guscio Android (Capacitor), dalla radice del repository:

```bash
npm ci
```

## Avviare l'app in locale

Solo frontend (server di sviluppo Expo, web):

```bash
cd frontend
npx expo start --web
```

URL: **http://localhost:8081** (porta predefinita di Expo/Metro).

> Attenzione: il frontend chiama le API sullo **stesso dominio** (`/predict`,
> `/matches-list`, …). Il server di sviluppo Expo non serve quelle rotte, quindi
> in locale le schermate che leggono dati restano vuote o vanno in errore. Per
> avere anche le funzioni server serve un ambiente che le esegua (es.
> `npx vercel dev`, porta predefinita 3000, oppure `npx netlify dev`, porta
> predefinita 8888) con le variabili d'ambiente sopra configurate. Questa
> modalità non è documentata altrove nel repo e non è stata verificata.

Build di produzione (la stessa che eseguono Vercel e Netlify):

```bash
cd frontend
npm run build:web     # export web in frontend/dist + iniezione delle meta PWA
```

## Test automatici

Nel repository **non esiste una suite di test automatici** (nessuno script `test`
in `package.json`; i file in `android/app/src/test` e `androidTest` sono gli esempi
generati da Capacitor). I controlli in uso, che devono restare a 0 errori:

```bash
cd frontend
npx tsc --noEmit -p .   # controllo dei tipi
npx eslint .            # lint
npm run build:web       # la build deve essere verde
```

Il CHANGELOG cita inoltre "test a runtime del motore/verdetto": sono verifiche
manuali su partite di riferimento, non script versionati.

## Convenzioni di branch e commit

- **Branch principale**: `main`. Il merge su `main` fa partire il deploy di
  produzione su Vercel (e la build APK se cambiano `android/**`,
  `capacitor.config.ts`, `capacitor-web/**`, `package.json`/`package-lock.json`).
- **Branch di lavoro**: le modifiche arrivano tramite Pull Request da branch
  dedicati; quelli creati da Claude Code seguono lo schema `claude/<nome>`
  (es. `claude/lucid-planck-nardcv`).
- **PR**: squash-merge (dalla #7 in poi; le #2–#6 erano merge commit); il titolo diventa il messaggio del commit su `main` con il
  numero della PR in fondo, es. `Scheda: ranking strutturale con la posizione vera
  nel motore, niente doppioni (#13)`.
- **Messaggi di commit**: in **italiano**, descrittivi del comportamento
  osservabile (non del codice), una riga di sintesi. Per i ticket: `Ticket N:
  <descrizione>`, **un ticket = un commit**, nell'ordine del file `ticket/ticket.md`.
- **`[skip ci]`** in fondo al messaggio per tutto ciò che non deve andare online
  subito (documentazione, testi, commenti, CHANGELOG, refactoring parziali): ogni
  deploy costa ~15 crediti di build.
- **Traccia**: ogni PR aggiunge la sua voce nel Log di `CHANGELOG.md` (cosa,
  perché, file, SQL, decisioni del proprietario) e, se tocca il database, la riga
  in `docs/database.sql`.
- La cartella `ticket/` non si include nei commit di codice.

## Regole operative
- Mai commit diretti su main
- Prima di ogni merge: installare dipendenze, avviare l'app in locale, verificare che parta senza errori, eseguire i test se presenti
- Un solo tentativo di auto-fix su errori CI, poi fermarsi e riportare
- Il merge finale lo decide sempre l'utente dopo revisione

## Regola di avvio obbligatoria
Prima di qualsiasi azione su questo progetto, se esiste il file /PIANO_ESECUTIVO.md, leggilo per intero. Se esiste e contiene uno step assegnato a te non ancora completato, esegui quello step seguendo esattamente quanto scritto. Se non esiste, procedi normalmente.
