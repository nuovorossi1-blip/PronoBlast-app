import { pgGetAll, pgGet, pgDelete, pgRpc, jsonResponse } from "./lib/supabaseRest";
import { parseResult } from "./lib/marketEval";
import { updateSystemScorecard, updateScenarioScores } from "./lib/applyResult";
import { aggiornaTabellaERicalcolaConsigliati } from "./lib/tabellaScenari";

/**
 * POST /rebuild-learning
 *
 * Ricostruisce l'apprendimento rigiocando TUTTE le partite concluse.
 *
 * PERCHE' ESISTE (27/09/2026). Il tasto "Azzera apprendimento" cancella le
 * tabelle e basta. I risultati pero' sono gia' dentro `matches`, quindi non
 * arriva nessun evento nuovo da contare e le tabelle restano vuote per sempre:
 * dopo un azzeramento Rossi si e' ritrovato con 3 partite contate su 7.855
 * concluse, e il motore ha smesso di correggere le probabilita' di Poisson con
 * lo storico. Non era un difetto visibile da nessuna parte: i numeri erano solo
 * spariti.
 *
 * COSA SI PUO' DAVVERO RICOSTRUIRE, detto chiaro:
 *  - `scenario_market_scores` e `system_scorecard`: TUTTE le partite concluse,
 *    perche' servono solo quote e risultato, che ci sono;
 *  - `market_scores` e `family_counters`: solo le partite che hanno un
 *    pronostico AI salvato in `predictions`. Senza un pronostico non c'e'
 *    niente da valutare. Sono molte meno, e non e' un limite di questa
 *    funzione: e' quello che il database contiene.
 *
 * Si lavora a blocchi (`from`/`limit`) perche' 7.855 partite non stanno nel
 * limite di tempo di una function: l'app cicla mostrando l'avanzamento.
 * `reset=1` sul PRIMO blocco svuota le tabelle prima di ricominciare, altrimenti
 * i conteggi si sommerebbero a quelli gia' presenti.
 */

const BLOCCO = 300;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);

  const url = new URL(req.url);
  const from = Math.max(0, parseInt(url.searchParams.get("from") || "0", 10) || 0);
  const limit = Math.max(1, Math.min(BLOCCO, parseInt(url.searchParams.get("limit") || String(BLOCCO), 10) || BLOCCO));
  const reset = url.searchParams.get("reset") === "1";

  try {
    if (reset) {
      if (from !== 0) return jsonResponse({ error: "reset=1 va usato solo sul primo blocco (from=0)" }, 400);
      // Si svuota tutto e si riparte: sommare a conteggi esistenti darebbe
      // numeri gonfiati senza che si veda.
      await pgDelete("market_scores?id=not.is.null");
      await pgDelete("family_counters?id=not.is.null");
      await pgDelete("scenario_market_scores?id=not.is.null").catch(() => {});
      await pgDelete("system_scorecard?id=not.is.null").catch(() => {});
    }

    // Ordine stabile per id: cosi' i blocchi non si sovrappongono fra una
    // chiamata e l'altra.
    const tutte = await pgGetAll("matches?result=not.is.null&select=id", "id.asc");
    const totale = tutte.length;
    const fetta = tutte.slice(from, from + limit).map((r: any) => r.id);

    let scenari = 0, pagelle = 0, famiglie = 0, saltate = 0;

    if (fetta.length) {
      const lista = fetta.map((i: string) => `"${i}"`).join(",");
      const righe = await pgGet(`matches?id=in.(${lista})&select=*`);
      const preds = await pgGet(`predictions?match_id=in.(${lista})&select=*&order=created_at.asc`);
      // Un pronostico per partita: l'ultimo salvato, come fa applyMatchResult.
      const perPartita = new Map<string, any>();
      for (const p of preds) perPartita.set(p.match_id, p);

      for (const match of righe) {
        const parsed = parseResult(match.result);
        if (!parsed) { saltate++; continue; }
        const [home, away] = parsed;

        await updateSystemScorecard(match, home, away);
        pagelle++;
        await updateScenarioScores(match, home, away);
        scenari++;

        const pred = perPartita.get(match.id);
        if (!pred) continue;
        const playable: { market: string }[] = pred.playable_markets || [];
        const mercati = playable.map((m) => m.market).filter(Boolean);
        if (pred.main_prediction && !mercati.includes(pred.main_prediction)) mercati.unshift(pred.main_prediction);
        try {
          await pgRpc("apply_family_result", {
            p_family: pred.family || "INSTABILE",
            p_league: match.manifestazione || null,
            p_proposti: mercati,
            p_home: home,
            p_away: away,
          });
          famiglie++;
        } catch {
          // un problema su una partita non deve fermare la ricostruzione
        }
      }
    }

    const prossimo = from + fetta.length;
    if (prossimo >= totale) {
      if (typeof setImmediate !== "undefined") {
        setImmediate(() => {
          aggiornaTabellaERicalcolaConsigliati().catch((e) => console.error("[rebuild-learning] ricalcolo tabella", e));
        });
      }
    }
    return jsonResponse({
      ok: true,
      totale_concluse: totale,
      da: from,
      elaborate: fetta.length,
      prossimo: prossimo < totale ? prossimo : null,
      finito: prossimo >= totale,
      scenari_aggiornati: scenari,
      pagelle_aggiornate: pagelle,
      famiglie_aggiornate: famiglie,
      saltate_risultato_illeggibile: saltate,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
