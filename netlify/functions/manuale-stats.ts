import { jsonResponse } from "./lib/supabaseRest";
import { calcolaManualeStats, METODO_MANUALE } from "./lib/manuale";

/**
 * GET /manuale-stats — quanto ha risposto finora il MANUALE per scenario
 * (Ticket 8, richiesta di Rossi del 29/09).
 *
 * Il banner in cima alla scheda mostra lo scenario (Equilibrio / Progressione /
 * Gap Tecnico) e i mercati "da manuale" di `getScenarioNote`. Finora nessuno
 * misurava se quei mercati escono davvero: l'apprendimento per scenario
 * (`updateScenarioScores`) usa un'altra tassonomia (netta/chiara/leggera di
 * lib/scenario.ts), e i mercati del manuale non avevano statistiche.
 *
 * SOLA LETTURA E SOLO MISURA: una query, nessuna scrittura, nessun effetto sul
 * verdetto o sul PRE. Conta solo l'esito, non la quota (il ROI non e' un
 * obiettivo). Calcolata VIVA sull'archivio intero a ogni richiesta: ogni
 * risultato inserito, o riscaricato in blocco, entra da solo nelle percentuali.
 * Il calcolo sta in lib/manuale.ts (lo usa anche il pronostico AI, Ticket 9).
 */
export default async (_req: Request): Promise<Response> => {
  try {
    const stats = await calcolaManualeStats();
    return jsonResponse({ ok: true, partite_valutate: stats.partite_valutate, metodo: METODO_MANUALE, scenari: stats.scenari });
  } catch (e) {
    console.error("[manuale-stats]", e);
    return jsonResponse({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
};
