import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";

/**
 * SWIPE INDIETRO (01/10/2026, richiesta di Rossi): un trascinamento da
 * sinistra a destra fa come il tasto indietro.
 *
 * L'app Android e' l'app web dentro un guscio (Capacitor), quindi il gesto si
 * ascolta sul documento con gli eventi touch del browser. Per non rubare i
 * trascinamenti che servono ad altro:
 *  - il movimento deve essere deciso e orizzontale (almeno 90 px, poco
 *    spostamento verticale, entro 700 ms);
 *  - non parte se il dito era su qualcosa che scorre in orizzontale (righe di
 *    tasti come le fasce di quota, le barre in Schedina);
 *  - torna indietro solo se c'e' una pagina precedente;
 *  - durante il gesto si blocca il "torna indietro" nativo del browser (Chrome
 *    lo fa da solo con lo stesso gesto): senza, si tornava indietro due volte.
 */
const MIN_DX = 90;
const MAX_MS = 700;

function scorreInOrizzontale(el: Element | null): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const st = window.getComputedStyle(n);
    if ((st.overflowX === "auto" || st.overflowX === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}

export function useSwipeBack() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let x0 = 0, y0 = 0, t0 = 0, valido = false;

    const inizio = (e: TouchEvent) => {
      if (e.touches.length !== 1) { valido = false; return; }
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
      valido = !scorreInOrizzontale(e.target as Element);
    };
    const muovi = (e: TouchEvent) => {
      if (!valido || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      // Anche verso sinistra: il "vai avanti" nativo del browser porterebbe
      // di nuovo alla pagina appena lasciata.
      if (Math.abs(dx) > 15 && dy < Math.abs(dx) / 3 && e.cancelable) e.preventDefault();
    };
    const fine = (e: TouchEvent) => {
      if (!valido) return;
      valido = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
      if (dx >= MIN_DX && dy < dx / 3 && Date.now() - t0 <= MAX_MS && router.canGoBack()) router.back();
    };

    document.addEventListener("touchstart", inizio, { passive: true });
    document.addEventListener("touchmove", muovi, { passive: false });
    document.addEventListener("touchend", fine, { passive: true });
    return () => {
      document.removeEventListener("touchstart", inizio);
      document.removeEventListener("touchmove", muovi);
      document.removeEventListener("touchend", fine);
    };
  }, []);
}
