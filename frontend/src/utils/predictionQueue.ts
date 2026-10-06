/**
 * Module-level prediction queue.
 * Tracks which match IDs are currently awaiting an AI prediction so the UI
 * can keep them "in progress" even when the user navigates away.
 *
 * When the user clicks "Genera Pronostico AI", the call is fired and
 * registered here. Subscribers (any component that wants to display a spinner
 * on those matches) call `subscribe()` to get notified on changes.
 */

import { api } from "@/src/api";

type Listener = () => void;

const pending = new Set<string>();
const listeners = new Set<Listener>();
/** Ultimo errore per partita (06/10/2026): prima si scriveva solo nel registro
 *  del browser e Rossi vedeva soltanto tornare il tasto "Rigenera". */
const errori = new Map<string, string>();

/** "502 {"error":"Errore openrouter (404): ..."}" -> il messaggio leggibile. */
function messaggio(e: any): string {
  const t = String(e?.message || e || "");
  const m = t.match(/^\d{3}\s+(\{[\s\S]*\})$/);
  if (m) {
    try { const j = JSON.parse(m[1]); if (j?.error) return String(j.error); } catch { /* testo grezzo */ }
  }
  if (/failed to fetch|network/i.test(t)) return "Il server non risponde: controlla la connessione o che il PC di casa sia acceso.";
  return t || "Errore sconosciuto";
}

function notify() {
  for (const l of listeners) {
    try { l(); } catch {}
  }
}

export const predictionQueue = {
  /**
   * Add a match ID to the in-flight queue and start the prediction in background.
   * Returns the promise so callers can optionally await it.
   */
  enqueue(matchId: string, forceRegen: boolean = false): Promise<any> {
    pending.add(matchId);
    errori.delete(matchId);
    notify();
    return api.predict(matchId, forceRegen)
      .catch((e) => {
        console.warn("Background prediction failed for", matchId, e);
        errori.set(matchId, messaggio(e));
        return null;
      })
      .finally(() => {
        pending.delete(matchId);
        notify();
      });
  },

  /** Perche' l'ultimo pronostico di questa partita non e' arrivato (o null). */
  lastError(matchId: string): string | null {
    return errori.get(matchId) ?? null;
  },

  isPending(matchId: string): boolean {
    return pending.has(matchId);
  },

  size(): number {
    return pending.size;
  },

  pendingIds(): string[] {
    return Array.from(pending);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
