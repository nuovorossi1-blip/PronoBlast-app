import { pgGet, pgPatch } from "./supabaseRest";
import { structuralAnalysis, quoteCatalogo, type Odds } from "./clusterEngine";
import { preHeuristicRanking } from "./preHeuristic";
import {
  buildFinalVerdict, rankPicks, ammessoDallaStruttura, fusioneInIngresso, verdettoDaAI, pronosticoPostPartita,
  type VerdictPick, type MatchHistory,
} from "../../../frontend/src/api";

/**
 * IL VERDETTO CALCOLATO DAL SERVER (29/09/2026, fase 0 del piano).
 *
 * PERCHE'. Finora la fusione girava SOLO nel telefono, dentro la scheda
 * partita. Conseguenza: una partita mai aperta non aveva `pick_finale`, e la
 * card della lista mostrava un pick di un vecchio algoritmo — senza soglia,
 * senza Poisson, senza regole di coerenza. E' il motivo per cui Rossi vedeva
 * `MG 2-4` in lista e `MG 3-6` nel dettaglio: due calcoli diversi.
 *
 * UNA SOLA IMPLEMENTAZIONE, NON DUE. `buildFinalVerdict` e le sue undici
 * funzioni di supporto NON sono state riscritte qui: si importano da
 * `frontend/src/api.ts`, che e' TypeScript puro senza dipendenze da React
 * Native o dal browser. Copiarle avrebbe creato la stessa trappola delle due
 * `VERDICT_WHITELIST` tenute allineate a mano, che e' gia' costata un bug.
 *
 * Gli ingredienti sono gli stessi che usa la scheda:
 *   STRUTT = structuralAnalysis(odds)      (motore Poisson)
 *   PRE    = preHeuristicRanking(odds)     (terza voce)
 *   AI     = playable_markets dell'ultimo pronostico salvato, se c'e'
 *   storico = /match-history per campionato e famiglia
 */

export type EsitoVerdetto = {
  match_id: string;
  verdetto: VerdictPick[];
  pick: VerdictPick | null;
  aveva_ai: boolean;
  salvato: boolean;
  motivo?: string;
};

/** Lo storico che la fusione usa per correggere le probabilita'. */
async function storicoPartita(matchId: string): Promise<MatchHistory | null> {
  try {
    const righe = await pgGet(
      `matches?id=eq.${encodeURIComponent(matchId)}&select=manifestazione,squadra1,squadra2`,
    );
    const m = righe[0];
    if (!m) return null;
    const [globali, perLega] = await Promise.all([
      pgGet("market_scores?select=market,wins,total,win_rate,missed,family&limit=1000").catch(() => []),
      pgGet(
        `market_scores?league=eq.${encodeURIComponent(m.manifestazione || "")}&select=market,wins,total,win_rate,missed,family&limit=1000`,
      ).catch(() => []),
    ]);
    const perFamiglia = (righe: any[]) => {
      const out: Record<string, any[]> = {};
      for (const r of righe) {
        const f = r.family || "";
        // win_rate ricalcolato dalla fonte di verita' (wins/total), scala 0-100:
        // la colonna DB non la scrive nessuno nel repo (scala e freschezza ignote).
        (out[f] = out[f] || []).push({ ...r, win_rate: r.total > 0 ? (r.wins / r.total) * 100 : 0 });
      }
      return out;
    };
    return {
      league: m.manifestazione || "",
      global: perFamiglia(globali),
      league_specific: perFamiglia(perLega),
    } as MatchHistory;
  } catch {
    return null;
  }
}

/**
 * Calcola il verdetto di una partita e, se richiesto, lo salva in
 * `pick_finale`. Non tocca le partite gia' concluse: il verdetto di una partita
 * finita resta quello dato PRIMA, altrimenti la pagella misurerebbe pronostici
 * ricostruiti dopo (regola del 28/09).
 */
export async function verdettoDiPartita(
  match: any, minOdd: number, salva = true,
): Promise<EsitoVerdetto> {
  const base: EsitoVerdetto = {
    match_id: match.id, verdetto: [], pick: null, aveva_ai: false, salvato: false,
  };

  const odds: Odds = {
    odd_1: match.odd_1, odd_X: match.odd_x, odd_2: match.odd_2,
    odd_1X: match.odd_1x, odd_X2: match.odd_x2, odd_12: match.odd_12,
    odd_U15: match.odd_u15, odd_O15: match.odd_o15,
    odd_U25: match.odd_u25, odd_O25: match.odd_o25,
    odd_U35: match.odd_u35, odd_O35: match.odd_o35,
    odd_GG: match.odd_gg, odd_NG: match.odd_ng,
  };
  if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) {
    return { ...base, motivo: "quote 1X2 incomplete" };
  }

  const structural = structuralAnalysis(odds, minOdd);

  // Ultimo pronostico AI salvato, se esiste. La maggior parte delle partite non
  // ce l'ha: la fusione funziona lo stesso, con due voci invece di tre.
  let aiMarkets: { market: string; reasoning?: string }[] | undefined;
  let fasceAI: any = null;
  try {
    // select=* e non l'elenco dei campi: `fasce` esiste solo se la colonna e'
    // stata creata, e chiederla per nome farebbe fallire tutta la lettura.
    const preds = await pgGet(
      `predictions?match_id=eq.${encodeURIComponent(match.id)}&select=*&order=created_at.desc&limit=1`,
    );
    // Un pronostico generato dopo il calcio d'inizio non entra nel verdetto
    // (potrebbe conoscere il risultato): si procede come senza AI.
    if (preds.length && !pronosticoPostPartita(preds[0], match)) {
      fasceAI = preds[0].fasce || null;
      aiMarkets = preds[0].playable_markets || [];
      if (preds[0].main_prediction && !(aiMarkets || []).some((x: any) => x.market === preds[0].main_prediction)) {
        aiMarkets = [{ market: preds[0].main_prediction }, ...(aiMarkets || [])];
      }
      base.aveva_ai = true;
    }
  } catch (e) {
    // senza pronostico AI si procede con due voci
    console.error("[verdettoServer] pronostico AI", e);
  }

  const history = await storicoPartita(match.id);
  // Filtro strutturale IN INGRESSO (Ticket 6): motore e PRE vengono ripuliti
  // dai mercati inammissibili PRIMA della fusione, come nella scheda partita.
  const ingresso = fusioneInIngresso(
    structural as any,
    preHeuristicRanking(odds).map((c) => ({ market: c.market, odd: c.odd, family: c.family })),
    (aiMarkets || []).map((x) => x.market),
  );
  const preRanked = rankPicks(ingresso.pre as any, [], []);

  // Se il pronostico AI ha le fasce, il verdetto e' la sua classifica validata
  // per la fascia della soglia (stessa funzione della scheda); altrimenti la
  // fusione di sempre.
  const daAI = verdettoDaAI(
    { fasce: fasceAI },
    {
      ...(structural as any),
      market_odds: quoteCatalogo(odds),
      pre_ranking: preHeuristicRanking(odds).map((c) => ({ market: c.market, odd: c.odd })),
    },
    odds, minOdd,
  );
  const grezzo = daAI ? daAI.picks : buildFinalVerdict(
    ingresso.structural, preRanked, aiMarkets, odds, history, { minOdd },
  );
  // Stesso filtro pavimento/tetto che applica la scheda partita (ora formalita':
  // motore e PRE sono gia' filtrati in ingresso; resta per i mercati dell'IA).
  const s: any = (structural as any)?.structure;
  const verdetto = s
    ? grezzo.filter((v) => ammessoDallaStruttura(v.market, s))
    : grezzo;

  const pick = verdetto[0] || null;
  let salvato = false;
  if (salva && pick && !match.result) {
    try {
      await pgPatch(`matches?id=eq.${encodeURIComponent(match.id)}`, {
        pick_finale: pick.market,
        pick_finale_prob: pick.coverage ?? null,
      });
      salvato = true;
    } catch {
      // il salvataggio non deve far fallire il calcolo
    }
  }
  return { ...base, verdetto, pick, salvato };
}
