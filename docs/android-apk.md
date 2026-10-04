# PronoBlast — APK Android e aggiornamenti

Schema identico a GymBuilder (`nuovorossi1-blip/gymbuilder`), con l'APK
pubblicato su GitHub Release invece che dentro `public/`.

## Come funziona

- `android/` e' un guscio **Capacitor** che carica l'app da
  `https://pronoblast.vercel.app` (`capacitor.config.ts` -> `server.url`).
  L'APK non contiene il frontend: **ogni deploy Vercel arriva subito
  nell'app installata**, senza reinstallare.
- Serve un APK nuovo solo quando cambia il guscio (`android/**`,
  `capacitor.config.ts`, `capacitor-web/**`, dipendenze Capacitor in
  `package.json`). Il workflow `.github/workflows/build-apk.yml` parte da solo
  in quei casi, oppure a mano dalla tab Actions ("Run workflow").
- Il workflow compila l'APK debug firmato con `android/app/debug.keystore`
  (firma FISSA, committata) e lo pubblica come Release `apk-v1.0.<N>` con due
  file: `PronoBlast.apk` e `version.json`.
- Link fisso all'ultima versione:
  `https://github.com/nuovorossi1-blip/PronoBlast-app/releases/latest/download/PronoBlast.apk`
- Nel frontend, `frontend/src/utils/androidApp.ts` e
  `frontend/src/components/NativeUpdater.tsx`: dentro l'APK, all'avvio, si
  confronta la versione installata (plugin nativo `ApkUpdater`, in
  `android/app/src/main/java/app/pronoblast/mobile/`) con l'ultima Release
  (API pubblica GitHub). Se e' piu' nuova, compare il riquadro "Aggiorna app":
  scarica con DownloadManager e apre l'installatore Android.
- Nel browser Android, in **Strumenti -> APP ANDROID** c'e' il tasto
  "Installa App Android" che scarica l'APK. Su desktop lo stesso tasto apre la
  pagina della Release.

## Cose da sapere

- La prima installazione richiede di autorizzare **"Installa app sconosciute"**
  per Chrome (o per PronoBlast stessa, al primo aggiornamento dall'app).
  Android lo chiede da solo.
- Android accetta un aggiornamento sopra l'app installata SOLO se ha la stessa
  firma: **non cancellare ne' rigenerare `android/app/debug.keystore`**.
  Perderla vorrebbe dire disinstallare e reinstallare l'app a mano.
- `versionCode`/`versionName` li scrive il workflow (numero di esecuzione):
  non vanno toccati a mano in `build.gradle`.
- L'API GitHub senza login concede 60 richieste/ora per indirizzo IP: per un
  controllo all'avvio e' piu' che sufficiente. Se fallisce, l'app parte lo
  stesso senza avviso.
- `capacitor-web/index.html` NON e' l'app: e' la pagina che Capacitor esige
  di impacchettare, e si vede solo se manca la connessione al primo avvio.
- Firma release "vera" (facoltativa, mai usata finora): segreti GitHub
  `PRONOBLAST_STORE_FILE` ecc. letti da `android/app/build.gradle`.

## Dipendenze del guscio

`package.json` nella radice: `@capacitor/core`, `@capacitor/android`,
`@capacitor/cli`. Vercel non le installa (usa `cd frontend && yarn install`),
le usa solo il workflow con `npm ci` + `npx cap sync android`. Toolchain del
workflow: Node 22, Java 21, Gradle 8.11 (wrapper nel repo).
