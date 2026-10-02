import { pgGet, pgGetAll, pgPatch, pgPost, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import {
  structuralAnalysis, classifyFamily, quoteCatalogo, evaluateMarketStrict, CANDIDATE_MARKETS,
  type Odds, type MlScoreEntry,
} from "./lib/clusterEngine";
import { preHeuristicRanking, preEligibleMarkets } from "./lib/preHeuristic";
import { classifyScenario } from "./lib/scenario";
import {
  buildFinalVerdict, rankPicks, fusioneInIngresso, ammessoDallaStruttura, candidatiManuale,
  getScenarioNote, chiaveScenario, esitoMercato, FASCE_AI, chiaveFascia,
  type StructuralAnalysis, type ManualeStatsResponse, type EsitoMercato,
} from "../../frontend/src/api";

/**
 * POST /ricalcolo?from=N[&reset=1]   GET /ricalcolo  (stato: curva e pagella)
 *
 * RICALCOLO STORICO CON LE REGOLE DI OGGI (01/10/2026, richiesta di Rossi).
 *
 * Rigioca TUTTE le partite concluse, in ordine di data, e per ognuna salva in
 * `matches.ricalcolo` cosa direbbero le regole di adesso, fascia per fascia
 * (1.40 / 1.50 / 1.60 / 1.75), con l'esito.
 *
 * DUE REGOLE, concordate con Rossi:
 *  1. SENZA SBIRCIARE IL FUTURO. Ogni partita usa solo lo storico delle partite
 *     precedenti: correzione per scenario del motore e misura del manuale sono
 *     tenute qui, cumulative, e il risultato della partita entra nei conteggi
 *     solo DOPO il suo verdetto. Le tabelle vive di apprendimento NON si
 *     toccano (contengono gia' tutti i risultati): il ricalcolo tiene la sua
 *     copia cronologica nello stato (`settings.ricalcolo_stato`).
 *  2. IL CONGELATO NON SI TOCCA. `pick_finale` e' la prova di cosa l'app ha
 *     consigliato davvero; il ricalcolo va solo in `ricalcolo`.
 *
 * Fuori dal ricalcolo, detto chiaro: il pronostico AI (rigenerarlo oggi
 * sarebbe contaminato dal risultato) e lo storico per famiglia dei mercati
 * AI (`market_scores`), che senza pronostici non ha senso ricostruire.
 *
 * Si lavora a blocchi (l'app cicla con l'avanzamento): lo stato fra un blocco
 * e l'altro sta in `settings`, e `from` deve coincidere con dove si era
 * rimasti, altrimenti si riparte da capo (reset=1).
 */

export const VERSIONE_RICALCOLO = "2026-10-01b"; // fasce a intervalli chiusi
const BLOCCO = 150;

type Tasso = { v: number; p: number };
type Stato = {
  versione: string;
  iniziato: string;
  pos: number;
  totale: number;
  finito: boolean;
  /** correzione per scenario del motore: scenario -> mercato -> vinte/totali */
  scen: Record<string, Record<string, { w: number; t: number }>>;
  /** misura del manuale: chiaveScenario -> mercato del manuale -> vinte/perse */
  man: Record<string, Record<string, Tasso>>;
  /** curva: "AAAA-MM" -> fascia -> vinte/perse (regole di oggi) */
  curva: Record<string, Record<string, Tasso>>;
  /** pagella per fascia: regole di oggi su tutte le partite, e confronto col
   *  congelato sulle stesse partite (dove c'e' un congelato valutabile). */
  pagella: Record<string, { oggi: Tasso; stesse: number; oggiStesse: number; congelatoStesse: number }>;
};

function statoNuovo(totale: number): Stato {
  return {
    versione: VERSIONE_RICALCOLO, iniziato: new Date().toISOString(), pos: 0, totale, finito: false,
    scen: {}, man: {}, curva: {}, pagella: {},
  };
}

async function leggiStato(): Promise<Stato | null> {
  const r = await pgGet(`settings?key=eq.ricalcolo_stato&select=value`);
  return r.length ? (r[0].value as Stato) : null;
}

async function scriviStato(s: Stato): Promise<void> {
  await pgPost("settings", { key: "ricalcolo_stato", value: s }, "resolution=merge-duplicates,return=minimal");
}

/** Misura del manuale nel formato che candidatiManuale si aspetta. */
function manualeComeStats(man: Stato["man"]): ManualeStatsResponse["scenari"] {
  const out: any = {};
  for (const [k, mercati] of Object.entries(man)) {
    out[k] = { mercati: {} as any };
    for (const [m, t] of Object.entries(mercati)) {
      const n = t.v + t.p;
      out[k].mercati[m] = { vinte: t.v, perse: t.p, rimborsi: 0, mezze: 0, non_valutabili: 0, pct: n ? Math.round((t.v / n) * 1000) / 10 : null };
    }
  }
  return out;
}

export type RicalcoloFascia = { market: string; odd: number | null; stimata: boolean; prob: number | null; esito: EsitoMercato | null } | null;
export type Ricalcolo = { versione: string; data: string; fasce: Record<string, RicalcoloFascia> };

/** Lo storico cronologico che serve a un verdetto: correzione per scenario e
 *  misura del manuale, solo delle partite gia' passate. */
export type StoricoCronologico = Pick<Stato, "scen" | "man">;

/** Varianti di misura per /backtest-fusione: l'app e il ricalcolo non le
 *  passano mai, quindi per loro il comportamento non cambia. */
export type VarianteFusione = { senzaConcordanza?: boolean; archivioNelCalcolo?: boolean };

/**
 * Verdetto con le regole di oggi per UNA partita, usando solo lo storico
 * passato (`scen`, `man`). Nessuna scrittura: e' la parte pura del ricalcolo.
 * La usa anche /backtest-fusione: una sola implementazione della fusione
 * rigiocata.
 */
export function verdettoRicalcolato(odds: Odds, risultato: string, stato: StoricoCronologico, variante: VarianteFusione = {}): Ricalcolo {
  const scenario = classifyScenario(odds);
  const ml: Record<string, MlScoreEntry> = {};
  for (const [m, c] of Object.entries(stato.scen[scenario] || {})) {
    if (c.t > 0) ml[m] = { win_rate: Math.round((c.w / c.t) * 1000) / 10, total: c.t, wins: c.w, losses: c.t - c.w };
  }
  const sa = structuralAnalysis(odds, FASCE_AI[0], ml);
  const marketOdds = quoteCatalogo(odds);
  const pre = preHeuristicRanking(odds);
  const structural = {
    ...(sa as any),
    market_odds: marketOdds,
    pre_ranking: pre.map((c) => ({ market: c.market, odd: c.odd })),
    pre_eligible: preEligibleMarkets(odds),
  } as StructuralAnalysis;
  const ingresso = fusioneInIngresso(structural, pre.map((c) => ({ market: c.market, odd: c.odd, family: c.family })), []);
  const preRanked = rankPicks(ingresso.pre as any, [], []);
  const stats = manualeComeStats(stato.man);

  const fasce: Record<string, RicalcoloFascia> = {};
  for (const f of FASCE_AI) {
    const manuale = candidatiManuale(odds as any, stats, f, marketOdds, false, sa.structure);
    const v = buildFinalVerdict(ingresso.structural, preRanked, [], odds, null, { minOdd: f, manuale, ...variante })
      .filter((x) => ammessoDallaStruttura(x.market, sa.structure));
    const top = v[0];
    fasce[chiaveFascia(f)] = top
      ? { market: top.market, odd: top.odd ?? null, stimata: !!top.oddEstimated, prob: top.coverage ?? null, esito: esitoMercato(top.market, risultato) }
      : null;
  }
  return { versione: VERSIONE_RICALCOLO, data: new Date().toISOString(), fasce };
}

/** Dopo il verdetto: il risultato entra nello storico cronologico. */
export function applicaRisultato(stato: StoricoCronologico, odds: Odds, home: number, away: number, risultato: string): void {
  const scenario = classifyScenario(odds);
  if (scenario && scenario !== "sconosciuto") {
    const s = stato.scen[scenario] = stato.scen[scenario] || {};
    for (const m of CANDIDATE_MARKETS) {
      const e = evaluateMarketStrict(m, home, away);
      if (e === null) continue;
      const c = s[m] = s[m] || { w: 0, t: 0 };
      c.t++;
      if (e) c.w++;
    }
  }
  const nota = getScenarioNote(odds as any, classifyFamily(odds));
  if (nota) {
    const k = chiaveScenario(nota);
    const s = stato.man[k] = stato.man[k] || {};
    for (const m of nota.markets) {
      const e = esitoMercato(m, risultato);
      if (e !== "vinta" && e !== "persa") continue;
      const c = s[m] = s[m] || { v: 0, p: 0 };
      if (e === "vinta") c.v++; else c.p++;
    }
  }
}

function conta(t: Tasso, e: EsitoMercato | null) {
  if (e === "vinta") t.v++;
  else if (e === "persa") t.p++;
}

async function inParallelo<T>(lista: T[], n: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < lista.length; i += n) await Promise.all(lista.slice(i, i + n).map(fn));
}

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method === "GET") {
      const s = await leggiStato();
      if (!s) return jsonResponse({ ok: true, stato: null });
      // Allo schermo servono avanzamento, curva e pagella, non i contatori.
      const { scen: _scen, man: _man, ...riassunto } = s;
      return jsonResponse({ ok: true, stato: riassunto });
    }
    if (req.method !== "POST") return jsonResponse({ error: "Usa GET o POST" }, 405);

    const url = new URL(req.url);
    const from = Math.max(0, parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const reset = url.searchParams.get("reset") === "1";

    // Ordine di DATA (e ora), poi id per stabilita': e' il cuore della regola
    // "senza sbirciare il futuro".
    const tutte = await pgGetAll("matches?result=not.is.null&select=id", "day.asc,time.asc,id.asc");
    const totale = tutte.length;

    let stato: Stato;
    if (reset) {
      if (from !== 0) return jsonResponse({ error: "reset=1 va usato solo con from=0" }, 400);
      stato = statoNuovo(totale);
    } else {
      const s = await leggiStato();
      if (!s || s.pos !== from || s.versione !== VERSIONE_RICALCOLO) {
        return jsonResponse({ error: "Stato del ricalcolo non allineato: ripartire da capo (reset=1)", pos: s?.pos ?? null }, 409);
      }
      stato = s;
    }

    const fetta: string[] = tutte.slice(from, from + BLOCCO).map((r: any) => r.id);
    let scritte = 0, saltate = 0;
    if (fetta.length) {
      const lista = fetta.map((i) => `"${i}"`).join(",");
      const righe = await pgGet(`matches?id=in.(${lista})&select=*`);
      const perId = new Map<string, any>(righe.map((r: any) => [r.id, r]));
      const aggiornamenti: { id: string; ricalcolo: Ricalcolo }[] = [];

      for (const id of fetta) {
        const row = perId.get(id);
        if (!row) { saltate++; continue; }
        const risultato = String(row.result || "");
        const parti = risultato.split("-").map((x: string) => parseInt(x.trim(), 10));
        if (parti.length !== 2 || parti.some((n: number) => isNaN(n))) { saltate++; continue; }
        const odds = rowToOdds(row) as Odds;
        if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) { saltate++; continue; }

        // 1) verdetto con lo storico FINO A IERI
        let ric: Ricalcolo;
        try {
          ric = verdettoRicalcolato(odds, risultato, stato);
        } catch (e) {
          console.error("[ricalcolo] partita", id, e);
          saltate++;
          continue;
        }
        aggiornamenti.push({ id, ricalcolo: ric });

        // curva e pagella
        const mese = String(row.day || "").slice(0, 7) || "senza data";
        const congelato = row.pick_finale ? esitoMercato(row.pick_finale, risultato) : null;
        for (const f of FASCE_AI) {
          const k = chiaveFascia(f);
          const e = ric.fasce[k]?.esito ?? null;
          const c = (stato.curva[mese] = stato.curva[mese] || {});
          conta(c[k] = c[k] || { v: 0, p: 0 }, e);
          const p = stato.pagella[k] = stato.pagella[k] || { oggi: { v: 0, p: 0 }, stesse: 0, oggiStesse: 0, congelatoStesse: 0 };
          conta(p.oggi, e);
          if ((congelato === "vinta" || congelato === "persa") && (e === "vinta" || e === "persa")) {
            p.stesse++;
            if (e === "vinta") p.oggiStesse++;
            if (congelato === "vinta") p.congelatoStesse++;
          }
        }

        // 2) SOLO DOPO, il risultato entra nello storico
        applicaRisultato(stato, odds, parti[0], parti[1], risultato);
      }

      // Scrittura: solo la colonna `ricalcolo`, mai pick_finale.
      await inParallelo(aggiornamenti, 10, async (a) => {
        try {
          await pgPatch(`matches?id=eq.${encodeURIComponent(a.id)}`, { ricalcolo: a.ricalcolo });
          scritte++;
        } catch (e) {
          console.error("[ricalcolo] scrittura", a.id, e);
          throw e;   // colonna mancante o errore vero: meglio fermarsi che contare male
        }
      });
    }

    stato.pos = from + fetta.length;
    stato.totale = totale;
    stato.finito = stato.pos >= totale;
    await scriviStato(stato);

    return jsonResponse({
      ok: true,
      totale_concluse: totale,
      da: from,
      elaborate: fetta.length,
      scritte, saltate,
      prossimo: stato.finito ? null : stato.pos,
      finito: stato.finito,
    });
  } catch (e: any) {
    console.error("[ricalcolo]", e);
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
