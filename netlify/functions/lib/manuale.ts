import { pgGetAll, rowToOdds } from "./supabaseRest";
import { getScenarioNote, esitoMercato, chiaveScenario, underAmmessiATettoAperto, inizioPartitaMs } from "../../../frontend/src/api";
import { classifyFamily } from "./clusterEngine";

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

type Tasso = { vinte: number; perse: number; pct: number | null };

export type ManualeStats = {
  partite_valutate: number;
  /** Pagella dei sistemi (01/10/2026): % di pick indovinati sulle partite
   *  concluse. "stesse_partite" = solo le partite in cui tutti e quattro
   *  avevano un pick, cosi' il confronto e' alla pari. */
  pagella: {
    sistemi: Record<string, Tasso & { partite: number }>;
    stesse_partite: { partite: number; sistemi: Record<string, Tasso> };
  };
  /** GAP TECNICO diviso per profilo: la regola direzionale regge oltre il
   *  singolo 1-0 di Belgio-Galles? Mercati riferiti alla favorita. */
  confronto_profilo: Record<string, { partite: number; mercati: Record<string, Tasso> }>;
  scenari: Record<string, {
    scenario: string; favorita: string | null; partite: number;
    mercati: Record<string, Conteggio & { pct: number | null }>;
  }>;
};

export const METODO_MANUALE = "vinte / (vinte + perse) sulle partite concluse con quello scenario; rimborsi (DNB col pareggio) e mezze (AH -0,75 vinto di un gol) contati a parte, fuori dalla percentuale";

/**
 * Stessa misura, ricordata per 10 minuti nell'istanza della funzione: il
 * verdetto server la chiede per ogni partita della giornata e l'archivio
 * intero non cambia fra una partita e l'altra. /manuale-stats resta viva.
 */
let memo: { at: number; valore: Promise<ManualeStats> } | null = null;
export function manualeStatsRecenti(): Promise<ManualeStats> {
  if (!memo || Date.now() - memo.at > 10 * 60 * 1000) {
    const valore = calcolaManualeStats();
    memo = { at: Date.now(), valore };
    valore.catch((e) => { console.error("[manuale] misura", e); memo = null; });
  }
  return memo.valore;
}

export async function calcolaManualeStats(): Promise<ManualeStats> {
  const righe = await pgGetAll(
    "matches?result=not.is.null&select=id,day,time,result,pick_finale,pick_strutturale,pick_pre,main_prediction,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
    "id.asc",
  );

  // Pagella dell'AI: vale solo se l'ULTIMO pronostico della partita (quello
  // che ha scritto main_prediction) e' nato prima del calcio d'inizio. Un
  // pronostico rigenerato dopo puo' conoscere il risultato.
  const ultimoPronostico = new Map<string, number>();
  let pronosticiLetti = true;
  try {
    const preds = await pgGetAll("predictions?select=match_id,created_at", "created_at.asc");
    for (const p of preds) {
      const t = Date.parse(p.created_at);
      if (isFinite(t)) ultimoPronostico.set(String(p.match_id), Math.max(t, ultimoPronostico.get(String(p.match_id)) ?? 0));
    }
  } catch (e) {
    console.error("[manuale] pronostici AI", e);
    pronosticiLetti = false;
  }
  const aiValido = (r: any) => {
    if (!pronosticiLetti) return false;
    const creato = ultimoPronostico.get(String(r.id));
    const inizio = inizioPartitaMs(r.day, r.time);
    return creato !== undefined && inizio !== null && creato < inizio;
  };

  const scenari: ManualeStats["scenari"] = {};
  let valutate = 0;

  const SISTEMI: Record<string, string> = {
    "AI": "main_prediction", "Verdetto": "pick_finale", "Motore": "pick_strutturale", "PRE": "pick_pre",
  };
  const conta = (t: Tasso, e: string | null) => { if (e === "vinta") t.vinte++; else if (e === "persa") t.perse++; };
  const nuovo = (): Tasso => ({ vinte: 0, perse: 0, pct: null });
  const pagella: ManualeStats["pagella"] = { sistemi: {}, stesse_partite: { partite: 0, sistemi: {} } };
  for (const k of Object.keys(SISTEMI)) {
    pagella.sistemi[k] = { ...nuovo(), partite: 0 };
    pagella.stesse_partite.sistemi[k] = nuovo();
  }
  const confronto: ManualeStats["confronto_profilo"] = {};

  // A PEZZETTI (07/10/2026): classifyFamily costa ~17 ms a partita e
  // l'archivio ne ha 9.000+: tutto di fila erano ~2,5 minuti in cui il server
  // del PC non rispondeva a nessuno (l'app "non si apriva" dopo ogni
  // riavvio). Ogni 10 partite si cede il passo alle altre richieste.
  let giro = 0;
  for (const r of righe) {
    if (++giro % 10 === 0) await new Promise((ok) => setImmediate(ok));
    const risultato = String(r.result || "");
    if (esitoMercato("1", risultato) === null) continue;   // risultato illeggibile
    // Pagella dei sistemi: ogni pick registrato prima della partita.
    const esitiSistemi: Record<string, string | null> = {};
    for (const [k, col] of Object.entries(SISTEMI)) {
      const pick = r[col];
      if (!pick) continue;
      if (k === "AI" && !aiValido(r)) continue;
      const e = esitoMercato(String(pick), risultato);
      esitiSistemi[k] = e;
      if (e === "vinta" || e === "persa") { conta(pagella.sistemi[k], e); pagella.sistemi[k].partite++; }
    }
    if (Object.keys(SISTEMI).every((k) => esitiSistemi[k] === "vinta" || esitiSistemi[k] === "persa")) {
      pagella.stesse_partite.partite++;
      for (const k of Object.keys(SISTEMI)) conta(pagella.stesse_partite.sistemi[k], esitiSistemi[k]);
    }

    const odds = rowToOdds(r) as any;
    const nota = getScenarioNote(odds, classifyFamily(odds));
    if (!nota) continue;                                     // quote 1X2 mancanti

    // GAP TECNICO per profilo: direzione + pochi gol contro O2.5.
    if (nota.scenario === "Gap Tecnico" && nota.favorita) {
      const f = nota.favorita;
      const profilo = underAmmessiATettoAperto(classifyFamily(odds)) ? "GAP TECNICO · DIFENSIVA" : "GAP TECNICO · altro profilo";
      const g = confronto[profilo] = confronto[profilo] || { partite: 0, mercati: {} };
      g.partite++;
      const mercati: Record<string, string> = {
        "O2.5": "O2.5",
        "favorita + U4.5": `${f} + U4.5`,
        "DC favorita + U3.5": `DC ${f === "1" ? "1X" : "X2"} + U3.5`,
        "favorita fisso": f,
      };
      for (const [etichetta, m] of Object.entries(mercati)) {
        const t = g.mercati[etichetta] = g.mercati[etichetta] || nuovo();
        conta(t, esitoMercato(m, risultato));
      }
    }
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

  const pct = (t: Tasso) => { const n = t.vinte + t.perse; t.pct = n > 0 ? Math.round((t.vinte / n) * 1000) / 10 : null; };
  Object.values(pagella.sistemi).forEach(pct);
  Object.values(pagella.stesse_partite.sistemi).forEach(pct);
  Object.values(confronto).forEach((g) => Object.values(g.mercati).forEach(pct));

  return { partite_valutate: valutate, scenari, pagella, confronto_profilo: confronto };
}
