import { pgGetAll, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { parseResult } from "./lib/marketEval";
import {
  structuralAnalysis, selezionaPick, evaluateMarketStrict, isVerdictMarket,
  VERDICT_WHITELIST, type Odds,
} from "./lib/clusterEngine";

/**
 * GET /backtest?from=0&limit=400&minOdd=1.40&lambda=nuovi|vecchi
 *
 * TRACCIA, NON MOTORE. Non influenza niente: rigioca il motore sulle partite
 * gia' concluse e riporta cosa avrebbe scelto e come sarebbe andata. Serve a
 * rispondere a domande che oggi non hanno risposta:
 *  - su questa famiglia quali pronostici sceglie, e quanti ne azzecca?
 *  - quali occasioni si e' perso, cioe' quali mercati della whitelist avrebbero
 *    vinto senza essere scelti?
 *  - i lambda cercati (28/09/2026) fanno uscire il mercato giusto piu' spesso
 *    della vecchia formula lineare?
 *
 * Si usa il pick del MOTORE (`selezionaPick`), non il verdetto della fusione:
 * la fusione ha bisogno del pronostico AI, che esiste solo su ~600 partite
 * delle 8.251 concluse. Il motore invece e' deterministico a partire dalle
 * quote, quindi il confronto e' pulito e copre tutto l'archivio.
 *
 * A BLOCCHI, perche' con i lambda cercati ogni partita costa circa 12 ms: 8.000
 * partite in una sola richiesta sforerebbero il limite di tempo. Il client
 * cicla e somma.
 */

const MAX_BLOCCO = 500;

type Conteggio = { scelte: number; vinte: number; perse: number };

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const from = Math.max(0, parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const limit = Math.max(1, Math.min(MAX_BLOCCO, parseInt(url.searchParams.get("limit") || "400", 10) || 400));
    const minOdd = Math.max(1, parseFloat(url.searchParams.get("minOdd") || "1.40") || 1.4);
    const vecchi = url.searchParams.get("lambda") === "vecchi";

    // Con `lambda=vecchi` si sostituisce temporaneamente la derivazione dei
    // lambda con la formula lineare di prima, per confrontare i due motori
    // sulle STESSE partite. Nessuna scrittura, nessun effetto permanente.
    const righe = await pgGetAll(
      "matches?result=not.is.null&select=id,day,manifestazione,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
      "id.asc",
    );
    const totale = righe.length;
    const fetta = righe.slice(from, from + limit);

    /** famiglia -> mercato -> conteggi */
    const perFamiglia: Record<string, Record<string, Conteggio>> = {};
    /** famiglia -> mercato -> quante volte avrebbe vinto senza essere scelto */
    const occasioni: Record<string, Record<string, number>> = {};
    const perFamigliaTot: Record<string, { partite: number; vinte: number; perse: number; senzaPick: number }> = {};
    let esaminate = 0, conPick = 0, vinte = 0, perse = 0, senzaPick = 0, scartate = 0;

    for (const r of fetta) {
      const punteggio = parseResult(r.result);
      if (!punteggio) { scartate++; continue; }
      const [casa, ospite] = punteggio;
      const odds = rowToOdds(r) as Odds;
      if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) { scartate++; continue; }

      let analisi;
      try {
        // `deriveLambdas` e' usata internamente da structuralAnalysis: per il
        // confronto con la formula vecchia si passa dal parametro dedicato.
        analisi = structuralAnalysis(odds, minOdd, null, vecchi);
      } catch {
        scartate++; continue;
      }
      esaminate++;
      const famiglia = analisi?.structure?.family || "SCONOSCIUTA";
      perFamigliaTot[famiglia] = perFamigliaTot[famiglia] || { partite: 0, vinte: 0, perse: 0, senzaPick: 0 };
      perFamigliaTot[famiglia].partite++;
      perFamiglia[famiglia] = perFamiglia[famiglia] || {};
      occasioni[famiglia] = occasioni[famiglia] || {};

      const pick = selezionaPick(analisi.ranking, odds, minOdd);
      if (!pick) {
        senzaPick++;
        perFamigliaTot[famiglia].senzaPick++;
      } else {
        conPick++;
        const esito = evaluateMarketStrict(pick.market, casa, ospite);
        const c = perFamiglia[famiglia][pick.market] || { scelte: 0, vinte: 0, perse: 0 };
        c.scelte++;
        if (esito === true) { c.vinte++; vinte++; perFamigliaTot[famiglia].vinte++; }
        else if (esito === false) { c.perse++; perse++; perFamigliaTot[famiglia].perse++; }
        perFamiglia[famiglia][pick.market] = c;
      }

      // OCCASIONI PERSE: mercati della whitelist che avrebbero vinto e che non
      // sono stati scelti. E' la domanda "cosa mi sono perso".
      for (const m of VERDICT_WHITELIST) {
        if (!isVerdictMarket(m)) continue;
        if (pick && m === pick.market) continue;
        if (evaluateMarketStrict(m, casa, ospite) === true) {
          occasioni[famiglia][m] = (occasioni[famiglia][m] || 0) + 1;
        }
      }
    }

    const prossimo = from + fetta.length;
    return jsonResponse({
      ok: true,
      lambda: vecchi ? "vecchi (formula lineare)" : "nuovi (ricerca sulla griglia)",
      minOdd,
      totale_concluse: totale,
      da: from, elaborate: fetta.length,
      prossimo: prossimo < totale ? prossimo : null,
      finito: prossimo >= totale,
      esaminate, con_pick: conPick, senza_pick: senzaPick, scartate,
      vinte, perse,
      per_famiglia: perFamigliaTot,
      pick_per_famiglia: perFamiglia,
      occasioni_perse: occasioni,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
