import { pgGetAll, rowToOdds, jsonResponse } from "./lib/supabaseRest";
import { getScenarioNote, esitoMercato, chiaveScenario } from "../../frontend/src/api";

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
 *
 * Per ogni partita conclusa con quote: scenario = getScenarioNote(quote), e
 * ogni mercato del manuale restituito viene valutato con `esitoMercato`.
 * La percentuale e' vinte / (vinte + perse): i rimborsi (DNB col pareggio) e le
 * mezze (AH -0,75 vinto di un gol) sono contati a parte, non entrano nel %.
 */

type Conteggio = { vinte: number; perse: number; rimborsi: number; mezze: number; non_valutabili: number };

export default async (_req: Request): Promise<Response> => {
  try {
    const righe = await pgGetAll(
      "matches?result=not.is.null&select=id,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
      "id.asc",
    );

    const scenari: Record<string, {
      scenario: string; favorita: string | null; partite: number;
      mercati: Record<string, Conteggio & { pct: number | null }>;
    }> = {};
    let valutate = 0;

    for (const r of righe) {
      const risultato = String(r.result || "");
      if (esitoMercato("1", risultato) === null) continue;   // risultato illeggibile
      const nota = getScenarioNote(rowToOdds(r) as any);
      if (!nota) continue;                                     // quote 1X2 mancanti
      const chiave = chiaveScenario(nota);
      const s = scenari[chiave] = scenari[chiave] || {
        scenario: nota.scenario, favorita: nota.favorita ?? null, partite: 0, mercati: {},
      };
      s.partite++;
      valutate++;
      for (const market of nota.markets) {
        const esito = esitoMercato(market, risultato);
        const c = s.mercati[market] = s.mercati[market] || { vinte: 0, perse: 0, rimborsi: 0, mezze: 0, non_valutabili: 0, pct: null };
        if (esito === "vinta") c.vinte++;
        else if (esito === "persa") c.perse++;
        else if (esito === "rimborso") c.rimborsi++;
        else if (esito === "mezza") c.mezze++;
        else c.non_valutabili++;
      }
    }

    for (const s of Object.values(scenari)) {
      for (const c of Object.values(s.mercati)) {
        const n = c.vinte + c.perse;
        c.pct = n > 0 ? Math.round((c.vinte / n) * 1000) / 10 : null;
      }
    }

    return jsonResponse({
      ok: true,
      partite_valutate: valutate,
      metodo: "vinte / (vinte + perse) sulle partite concluse con quello scenario; rimborsi (DNB col pareggio) e mezze (AH -0,75 vinto di un gol) contati a parte, fuori dalla percentuale",
      scenari,
    });
  } catch (e) {
    console.error("[manuale-stats]", e);
    return jsonResponse({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
};
