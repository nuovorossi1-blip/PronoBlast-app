import { pgGetAll, jsonResponse } from "./lib/supabaseRest";

/**
 * GET /db-stats
 *
 * Fotografia dello STORICO nel database: quante partite ci sono, quante sono
 * concluse, e di quelle concluse quante hanno davvero le quote complete e un
 * risultato leggibile. Serve a rispondere senza scaricare l'intero database
 * (27/09/2026: l'export tornava troncato a 1000 righe e non ce ne si accorgeva).
 *
 * E' la base per lo storico "per quote simili": una partita e' utilizzabile solo
 * se ha SIA le quote SIA il risultato.
 *
 * Solo lettura, nessuna scrittura.
 */

/** Le quote che servono per confrontare due partite come "simili". */
const QUOTE_1X2 = ["odd_1", "odd_x", "odd_2"] as const;
const QUOTE_GOL = ["odd_o25", "odd_gg"] as const;
const QUOTE_TUTTE = [
  "odd_1", "odd_x", "odd_2", "odd_1x", "odd_x2", "odd_12",
  "odd_u15", "odd_o15", "odd_u25", "odd_o25", "odd_u35", "odd_o35",
  "odd_gg", "odd_ng",
] as const;

function haQuote(r: any, cols: readonly string[]): boolean {
  return cols.every((c) => {
    const v = r[c];
    return v !== null && v !== undefined && v !== "" && Number(v) > 1;
  });
}

/** "2-1", "2:1", "2.1" -> [2, 1]; tutto il resto -> null. */
function leggiRisultato(v: any): [number, number] | null {
  const m = String(v ?? "").match(/^\s*(\d+)\s*[-:.]\s*(\d+)\s*$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

export default async (): Promise<Response> => {
  try {
    const rows = await pgGetAll(
      "matches?select=id,day,manifestazione,result,scenario," + QUOTE_TUTTE.join(","),
    );

    const conclusi = rows.filter((r: any) => r.result !== null && r.result !== undefined && String(r.result).trim() !== "");

    let risultatoLeggibile = 0;
    let con1x2 = 0;
    let conGol = 0;
    let utilizzabili = 0;      // quote 1X2 + Over 2.5 + GG, e risultato leggibile
    let complete = 0;          // tutte e 14 le quote
    const perCampionato: Record<string, number> = {};
    const perAnno: Record<string, number> = {};
    const risultatiStrani: string[] = [];

    for (const r of conclusi) {
      const punteggio = leggiRisultato(r.result);
      if (punteggio) risultatoLeggibile++;
      else if (risultatiStrani.length < 10) risultatiStrani.push(String(r.result));

      const a = haQuote(r, QUOTE_1X2);
      const b = haQuote(r, QUOTE_GOL);
      if (a) con1x2++;
      if (b) conGol++;
      if (haQuote(r, QUOTE_TUTTE)) complete++;
      if (a && b && punteggio) {
        utilizzabili++;
        perCampionato[r.manifestazione || "N/D"] = (perCampionato[r.manifestazione || "N/D"] || 0) + 1;
        perAnno[String(r.day || "").slice(0, 7) || "N/D"] = (perAnno[String(r.day || "").slice(0, 7) || "N/D"] || 0) + 1;
      }
    }

    const topCampionati = Object.entries(perCampionato)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 25)
      .map(([campionato, partite]) => ({ campionato, partite }));

    return jsonResponse({
      partite_totali: rows.length,
      concluse: conclusi.length,
      da_giocare: rows.length - conclusi.length,
      fra_le_concluse: {
        risultato_leggibile: risultatoLeggibile,
        con_quote_1x2: con1x2,
        con_quote_over25_e_gg: conGol,
        con_tutte_le_14_quote: complete,
        // Questo e' il numero che conta: le partite su cui si puo' costruire
        // uno storico per quote simili.
        utilizzabili_per_storico: utilizzabili,
      },
      risultati_non_leggibili: risultatiStrani,
      campionati_piu_ricchi: topCampionati,
      campionati_distinti: Object.keys(perCampionato).length,
      per_mese: Object.fromEntries(Object.entries(perAnno).sort()),
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
