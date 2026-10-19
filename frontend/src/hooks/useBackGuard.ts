import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * TASTO INDIETRO DI ANDROID (19/10/2026, Rossi: "se clicco indietro deve andare indietro, non chiudersi
 * l'app"; vale con i gesti e con i tre pulsanti).
 *
 * Nel guscio Capacitor il tasto indietro fa "pagina precedente" finche' ce n'e' una, poi chiude l'app.
 * Sulla prima pagina aperta (di solito le Partite) non c'e' niente prima: si chiudeva subito.
 * All'avvio si aggiunge una voce "di guardia" uguale alla pagina: il primo indietro sulla prima pagina
 * consuma la guardia e mostra "Premi di nuovo indietro per uscire"; un secondo indietro entro 2,5 secondi
 * chiude l'app; altrimenti la guardia torna al suo posto.
 */
const BASE = "__pronoBase";
const GUARDIA = "__pronoGuardia";

function avviso(testo: string) {
  const el = document.createElement("div");
  el.textContent = testo;
  el.setAttribute("style", "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:99999;" +
    "background:rgba(30,30,30,.95);color:#fff;padding:10px 16px;border-radius:20px;font:600 14px system-ui,sans-serif;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

/** Una volta sola per tutta la vita della pagina: il layout si ricrea a ogni ritorno alla prima pagina e,
 *  con un ascoltatore legato al suo ciclo di vita, il tasto indietro arrivava proprio mentre veniva tolto. */
function installa() {
  const w = window as any;
  if (w.__pronoBackGuard) return;
  w.__pronoBackGuard = true;
  const h = window.history;
  // Il navigatore dell'app riscrive lo stato della pagina (replaceState): i segni BASE/GUARDIA della voce
  // in cui si e' devono restare, e le pagine nuove (pushState) non devono ereditarli.
  const segni = (st: any) => { const m: Record<string, boolean> = {}; for (const k of [BASE, GUARDIA]) if (st?.[k]) m[k] = true; return m; };
  const senza = (st: any) => { if (!st || typeof st !== "object") return st; const { [BASE]: _b, [GUARDIA]: _g, ...resto } = st; return resto; };
  const pushOrig = h.pushState.bind(h), replaceOrig = h.replaceState.bind(h);
  h.replaceState = (st: any, t: string, u?: string | URL | null) => replaceOrig({ ...(senza(st) || {}), ...segni(h.state) }, t, u);
  h.pushState = (st: any, t: string, u?: string | URL | null) => pushOrig(senza(st), t, u);
  const metti = () => pushOrig({ ...(senza(h.state) || {}), [GUARDIA]: true }, "", window.location.href);
  if (!h.state?.[GUARDIA] && !h.state?.[BASE]) {
    replaceOrig({ ...(h.state || {}), [BASE]: true }, "", window.location.href);
    metti();
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  // In cattura: prima del navigatore dell'app.
  window.addEventListener("popstate", () => {
    if (!h.state?.[BASE]) return;
    // Sulla prima pagina: niente guardia per 2,5 secondi, cosi' il secondo indietro chiude l'app.
    avviso("Premi di nuovo indietro per uscire");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (h.state?.[BASE]) metti(); }, 2500);
  }, true);
}

export function useBackGuard() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !window.history?.pushState) return;
    installa();
  }, []);
}
