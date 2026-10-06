import type { CapacitorConfig } from '@capacitor/cli'

// Guscio Android di PronoBlast, stesso schema di GymBuilder: l'APK non contiene
// l'app, la carica dal sito Vercel. Gli aggiornamenti web arrivano da soli;
// solo le modifiche a questo guscio (android/, questo file) richiedono un APK nuovo.
const config: CapacitorConfig = {
  appId: 'app.pronoblast.mobile',
  appName: 'PronoBlast',
  webDir: 'capacitor-web',
  server: {
    // 06/10/2026: Vercel e' in pausa (402) e l'app restava bloccata sul logo.
    // Finche' l'app gira sul PC di casa il guscio carica da li'. Al ritorno su
    // Vercel rimettere 'https://pronoblast.vercel.app' (promemoria del 5/11).
    url: 'https://pc-claude.tailcad625.ts.net:8443',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    // Android 15 disegna le app a tutto schermo (edge-to-edge) quando targetSdk
    // e' 35, e la pagina finisce SOTTO la barra di stato e la barra dei gesti:
    // l'intestazione col tasto indietro sparisce in alto e la barra di
    // navigazione dell'app resta coperta in basso. Il valore predefinito di
    // Capacitor 7 e' "disable" (nessuna compensazione). Con "auto" il guscio
    // applica i margini di sistema solo dove servono davvero, quindi il
    // risultato e' lo stesso su Android 15 e sui telefoni piu' vecchi.
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
