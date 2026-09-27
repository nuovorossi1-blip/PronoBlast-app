import { pgGet, pgPatch, pgRpc, rowToOdds } from "./supabaseRest";
import { evaluateMarket, STANDARD_MARKETS } from "./marketEval";
import { classifyScenario } from "./scenario";

/**
 * Applica un risultato a una partita e aggiorna market_scores/family_counters
 * (stessa logica di match-result.ts, estratta qui per essere riusata anche
 * da results-apply.ts e results-bulk.ts senza duplicare/rischiare di rompere
 * match-result.ts che è già in produzione).
 */
export async function applyMatchResult(
  matchId: string,
  result: string,
  home: number,
  away: number,
): Promise<{ applied: boolean; main_prediction?: string; result_ok?: boolean | null }> {
  const matches = await pgGet(`matches?id=eq.${encodeURIComponent(matchId)}&select=*`);
  if (!matches.length) throw new Error("Match not found");
  const match = matches[0];

  // CORREZIONE DI UN RISULTATO GIA' SALVATO.
  // Prima non c'era nessun controllo: risalvare la stessa partita contava
  // tutto una seconda volta, e correggere un risultato sbagliato lasciava i
  // conteggi vecchi al loro posto sommandoci sopra quelli nuovi. Con
  // l'apprendimento per scenario attivo (Fase 3) questo avvelena i pronostici
  // futuri di tutte le partite con quote simili.
  const precedente: string | null = match.result || null;
  if (precedente === result) {
    // Stesso risultato risalvato: la partita e' gia' stata contata.
    return { applied: false, result_ok: null };
  }
  if (precedente) {
    // Risultato diverso da quello gia' registrato: prima si ANNULLANO i
    // conteggi del vecchio, poi si applicano quelli del nuovo.
    const m = precedente.replace(/\s/g, "").match(/^(\d+)-(\d+)$/);
    if (m) await revertCounters(match, parseInt(m[1], 10), parseInt(m[2], 10));
  }

  await pgPatch(`matches?id=eq.${encodeURIComponent(matchId)}`, {
    result,
    updated_at: new Date().toISOString(),
  });

  // FASE 0 — pagella dei tre sistemi. Va aggiornata PRIMA dell'uscita
  // anticipata qui sotto: oggi, se l'utente non ha mai premuto "Pronostico
  // AI", la partita non insegna niente a nessuno. Questo blocco invece conta
  // sempre, anche senza IA.
  await updateSystemScorecard(match, home, away);
  await updateScenarioScores(match, home, away);

  const preds = await pgGet(
    `predictions?match_id=eq.${encodeURIComponent(matchId)}&select=*&order=created_at.desc&limit=1`,
  );
  if (!preds.length) return { applied: false };

  const prediction = preds[0];
  const family: string = prediction.family || "INSTABILE";
  const manif: string | null = match.manifestazione || null;
  const playable: { market: string }[] = prediction.playable_markets || [];
  const marketsToUpdate = playable.map((m) => m.market).filter(Boolean);
  if (prediction.main_prediction && !marketsToUpdate.includes(prediction.main_prediction)) {
    marketsToUpdate.unshift(prediction.main_prediction);
  }

  // UN SOLO GIRO invece di un centinaio.
  // Qui prima c'erano tre cicli di chiamate HTTP verso Supabase: 2 per i
  // contatori di famiglia, 2 per ogni mercato proposto dall'IA e 2 per ognuno
  // dei 54 mercati standard per le "occasioni mancate". Fino a ~110 richieste
  // in sequenza, ognuna con la sua latenza: era li' che se ne andava il tempo di
  // esecuzione della function — cioe' i crediti di calcolo — ed era anche il
  // motivo per cui salvare molti risultati dalla Schedina rischiava il timeout.
  //
  // Ora il ciclo vive dentro il database (`apply_family_result`), dove i dati
  // gia' sono. Nessuna logica riscritta: la funzione SQL richiama le stesse
  // increment_* di prima, solo senza attraversare la rete cinquanta volte.
  await pgRpc("apply_family_result", {
    p_family: family,
    p_league: manif,
    p_proposti: marketsToUpdate,
    p_home: home,
    p_away: away,
  });

  const mainPred = prediction.main_prediction;
  return mainPred
    ? { applied: true, main_prediction: mainPred, result_ok: evaluateMarket(mainPred, home, away) }
    : { applied: false };
}

/**
 * Esportate (27/09/2026) perche' servono anche alla ricostruzione
 * dell'apprendimento: li' i risultati sono gia' nel database, quindi
 * `applyMatchResult` uscirebbe subito senza contare niente.
 *
 * FASE 0 — aggiorna `system_scorecard` con l'esito dei pick registrati dai tre
 * sistemi per questa partita, separatamente per scenario.
 *
 * Registra solo i sistemi che avevano effettivamente espresso un pick prima
 * del risultato: una casella vuota resta vuota, non viene contata come errore.
 * Best effort — un problema qui non deve impedire il salvataggio del risultato.
 */
export async function updateSystemScorecard(match: any, home: number, away: number): Promise<void> {
  try {
    const scenario: string = match.scenario || classifyScenario(rowToOdds(match) as any);
    if (!scenario || scenario === "sconosciuto") return;

    const picks: [string, string | null][] = [
      ["strutturale", match.pick_strutturale || null],
      ["pre", match.pick_pre || null],
      ["fusione", match.pick_finale || null],
    ];

    for (const [system, market] of picks) {
      if (!market) continue;
      const outcome = evaluateMarket(market, home, away);
      if (outcome === null) continue;
      await pgRpc("increment_system_score", {
        p_system: system,
        p_scenario: scenario,
        p_win: outcome,
      });
    }
  } catch {
    // La misurazione non deve mai bloccare l'inserimento di un risultato.
  }
}

/**
 * FASE 3 — aggiorna lo storico per scenario con TUTTI i mercati standard.
 *
 * È il pezzo che rende l'apprendimento davvero incrementale: ogni risultato
 * inserito sposta le statistiche dello scenario di quella partita, e quindi i
 * pronostici futuri delle partite con quote simili. Diversamente da
 * `market_scores`, che si aggiorna solo per i mercati proposti dall'IA, qui si
 * contano tutti i 49 mercati: la statistica resta imparziale e non riflette
 * quello che il sistema aveva scelto di proporre.
 */
export async function updateScenarioScores(match: any, home: number, away: number): Promise<void> {
  try {
    const scenario: string = match.scenario || classifyScenario(rowToOdds(match) as any);
    if (!scenario || scenario === "sconosciuto") return;

    // Una sola chiamata invece di 49: con il salvataggio multiplo dalla
    // Schedina, 49 round-trip per partita farebbero scadere la function.
    await pgRpc("apply_scenario_result", {
      p_scenario: scenario,
      p_home: home,
      p_away: away,
    });
  } catch {
    // La misurazione non deve mai bloccare l'inserimento di un risultato.
  }
}

/**
 * Annulla i conteggi di un risultato precedente (stessa logica di
 * updateSystemScorecard + updateScenarioScores, ma con segno -1).
 * Serve quando si corregge un risultato inserito per errore: senza questo,
 * quello sbagliato resterebbe nello storico per sempre.
 */
async function revertCounters(match: any, home: number, away: number): Promise<void> {
  try {
    const scenario: string = match.scenario || classifyScenario(rowToOdds(match) as any);
    if (!scenario || scenario === "sconosciuto") return;

    const picks: [string, string | null][] = [
      ["strutturale", match.pick_strutturale || null],
      ["pre", match.pick_pre || null],
      ["fusione", match.pick_finale || null],
    ];
    for (const [system, market] of picks) {
      if (!market) continue;
      const outcome = evaluateMarket(market, home, away);
      if (outcome === null) continue;
      await pgRpc("increment_system_score", {
        p_system: system, p_scenario: scenario, p_win: outcome, p_sign: -1,
      });
    }

    await pgRpc("apply_scenario_result", {
      p_scenario: scenario, p_home: home, p_away: away, p_sign: -1,
    });
  } catch {
    // Best effort: non deve impedire la correzione del risultato.
  }
}
