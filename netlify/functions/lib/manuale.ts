import { pgGetAll, rowToOdds } from "./supabaseRest";
import { getScenarioNote, esitoMercato, chiaveScenario } from "../../../frontend/src/api";

/**
 * Misura del MANUALE per scenario (Ticket 8): per ogni partita conclusa con
 * quote, scenario = getScenarioNote(quote), e ogni mercato del manuale
 * restituito viene valutato con `esitoMercato`.
 * La percentuale e' vinte / (vinte + perse): i rimborsi (DNB col pareggio) e le
 * mezze (AH -0,75 vinto di un gol) sono contati a parte, non entrano nel %.
 *
 * Unica sede dell'aggregazione (Regola 4): la usano GET /manuale-stats e il
 * prompt del pronostico AI (Ticket 9). Sola lettura, nessuna scrittura.
 */

export type Conteggio = { vinte: number; perse: number; rimborsi: number; mezze: number; non_valutabili: number };

export type ManualeStats = {
  partite_valutate: number;
  scenari: Record<string, {
    scenario: string; favorita: string | null; partite: number;
    mercati: Record<string, Conteggio & { pct: number | null }>;
  }>;
};

export const METODO_MANUALE = "vinte / (vinte + perse) sulle partite concluse con quello scenario; rimborsi (DNB col pareggio) e mezze (AH -0,75 vinto di un gol) contati a parte, fuori dalla percentuale";

export async function calcolaManualeStats(): Promise<ManualeStats> {
  const righe = await pgGetAll(
    "matches?result=not.is.null&select=id,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
    "id.asc",
  );

  const scenari: ManualeStats["scenari"] = {};
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

  return { partite_valutate: valutate, scenari };
}
