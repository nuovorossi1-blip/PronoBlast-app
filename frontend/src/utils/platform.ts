import { Platform, Alert, Linking } from "react-native";

/**
 * Avviso a un solo pulsante, funzionante ovunque.
 *
 * ATTENZIONE, motivo per cui esiste: in react-native-web `Alert.alert` e' una
 * funzione VUOTA (`class Alert { static alert() {} }`). Su web - cioe' nel
 * browser, nella PWA installata e dentro il guscio Android, che carica il sito -
 * ogni `Alert.alert` spariva nel nulla: esiti, conferme ed ERRORI compresi.
 * Era il caso dell'import Excel, che funzionava ma non diceva niente, e
 * sembrava quindi non caricare il file.
 */
export function notify(title: string, message?: string) {
  const testo = `${title}${message ? "\n\n" + message : ""}`;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(testo);
    else console.log(testo);
    return;
  }
  Alert.alert(title, message);
}

/**
 * Cross-platform confirm dialog. On web uses window.confirm,
 * on native uses Alert.alert with two buttons.
 */
export function confirmAction(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const { title, message = "", confirmText = "OK", cancelText = "Annulla", destructive, onConfirm } = opts;
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${title}${message ? "\n\n" + message : ""}`);
    if (ok) Promise.resolve(onConfirm()).catch(() => {});
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: "cancel" },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: () => { Promise.resolve(onConfirm()).catch(() => {}); },
    },
  ]);
}

/**
 * Cross-platform open URL. On web uses window.open in new tab,
 * on native uses Linking.openURL. Falls back gracefully.
 */
/**
 * true quando l'app gira dentro il guscio Android (Capacitor), non in un
 * browser normale.
 *
 * ATTENZIONE: dentro la WebView `Platform.OS` vale "web", perche' l'app E' il
 * sito caricato dal guscio. Trattarla come un browser qualsiasi e' l'errore che
 * ha rotto i tasti di analisi esterna il 19/09/2026: `window.open` li' non apre
 * una scheda, consegna l'indirizzo al browser di sistema e restituisce null.
 * Il codice leggeva quel null come "popup bloccato" e mostrava un avviso
 * sbagliato, mentre Edge si apriva davvero.
 */
export function isCapacitorApp(): boolean {
  if (typeof window === "undefined") return false;
  const c = (window as any).Capacitor;
  if (!c) return false;
  return typeof c.isNativePlatform === "function" ? !!c.isNativePlatform() : !!c.isNative;
}

/**
 * Copia SINCRONA negli appunti, senza await.
 *
 * Serve perche' i due vincoli sono in conflitto: `navigator.clipboard` va usata
 * mentre il documento ha il fuoco (quindi PRIMA di aprire il sito), ma
 * `window.open` va chiamata dentro il gesto dell'utente (quindi senza await in
 * mezzo). `document.execCommand("copy")` e' sincrona: copia e apre restano
 * nello stesso gesto e nessuno dei due vincoli viene violato. Funziona anche
 * nella WebView Android, dove scrive negli appunti di sistema.
 */
export function copiaSincrono(testo: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = testo;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, testo.length);   // senza questo iOS non seleziona
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copia un prompt negli appunti e apre il sito esterno. Unico punto per tutti e
 * quattro i tasti di analisi esterna: browser, PWA installata e guscio Android
 * si comportano diversamente e tenere tre varianti sparse era garanzia di
 * romperne due su tre.
 *
 * Restituisce cosa e' andato davvero a buon fine, cosi' il messaggio all'utente
 * dice la verita' invece di dare per scontato il successo.
 */
export async function apriConPrompt(url: string, testo: string): Promise<{ copiato: boolean; aperto: boolean }> {
  if (Platform.OS !== "web") {
    openExternalUrl(url);
    return { copiato: false, aperto: true };
  }

  // 1) Copia, sincrona, finche' il documento ha ancora il fuoco.
  let copiato = copiaSincrono(testo);

  // 2) Apertura, nello stesso gesto.
  let aperto = true;
  if (isCapacitorApp()) {
    // Nel guscio Android "_system" e' il modo documentato per mandare
    // l'indirizzo al browser di sistema. Niente ripiego su location.href:
    // farebbe navigare via l'app stessa.
    try { window.open(url, "_system"); } catch { aperto = false; }
  } else {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    aperto = !!w;
  }

  // 3) Se execCommand ha fallito, si riprova con l'API moderna. Qui un await ci
  //    puo' stare: la scheda e' gia' stata aperta.
  if (!copiato && typeof navigator !== "undefined" && (navigator as any).clipboard) {
    try {
      await (navigator as any).clipboard.writeText(testo);
      copiato = true;
    } catch {}
  }
  return { copiato, aperto };
}

export function openExternalUrl(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      // Popup blocked: assign location directly
      window.location.href = url;
    }
    return;
  }
  Linking.openURL(url).catch((e) => console.warn("openURL err", e));
}
