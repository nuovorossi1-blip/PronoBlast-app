import { pgGet, pgPost, pgPatch, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import {
  structuralAnalysis, CANDIDATE_MARKETS, fullDistribution, coverageForMarket,
  comboOdd, estimateMarketOdd, isVerdictMarket, type Odds,
} from "./lib/clusterEngine";
import { classifyScenario } from "./lib/scenario";
import { readMinOdd } from "./odd-settings";
import { buildMatchPrompt, PREDICTION_SYSTEM, parseAiJson, bloccoScenarioManuale, type VoceManuale } from "./lib/predictionPrompt";
import { calcolaManualeStats, type ManualeStats } from "./lib/manuale";
import { LLM_OPTIONS, DEFAULT_LLM, callLlm, type LlmOption } from "./lib/llmProviders";
import { contestoPartita, blocoTesto } from "./lib/webSearch";
import { underAmmessiATettoAperto, getScenarioNote, chiaveScenario } from "../../frontend/src/api";

/**
 * POST /ai-predict?matchId=<uuid>&force=true
 * Porting di POST /matches/{id}/predict (server.py) — genera il pronostico AI,
 * iniettando il PIN strutturale calcolato dal motore Poisson (clusterEngine.ts)
 * e lo storico dei mercati (market_scores) come feedback, poi salva su Supabase.
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (e: any) {
    return jsonResponse({ error: `Errore interno: ${e?.message || String(e)}` }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);

  const url = new URL(req.url);
  const matchId = url.searchParams.get("matchId");
  const force = url.searchParams.get("force") === "true";
  if (!matchId) return jsonResponse({ error: "Parametro 'matchId' mancante" }, 400);

  const matches = await pgGet(`matches?id=eq.${encodeURIComponent(matchId)}&select=*`);
  if (!matches.length) return jsonResponse({ error: "Match not found" }, 404);
  const match = matches[0];

  if (!force) {
    const existing = await pgGet(
      `predictions?match_id=eq.${encodeURIComponent(matchId)}&select=*&order=created_at.desc&limit=1`
    );
    if (existing.length) return jsonResponse(existing[0]);
  }

  const llmOption = await getSelectedLlm();

  const feedback = await getAllFamiliesStats(match.manifestazione);
  let prompt = buildMatchPrompt({
    manifestazione: match.manifestazione,
    time: match.time,
    squadra1: match.squadra1,
    squadra2: match.squadra2,
    odds: rowToOdds(match),
  });
  if (feedback) {
    prompt =
      feedback +
      "\n\nUSA QUESTO STORICO per aggiustare il ranking: dai priorità a mercati che hanno vinto più volte nella stessa famiglia, e considera anche i mercati con tanti 'persi opportunità' (avrebbero vinto ma non li avevi previsti).\n\n" +
      prompt;
  }

  // PIN strutturale: iniettiamo pavimento/tetto/famiglia calcolati dal motore Poisson,
  // cosi' l'AI li usa come input fisso invece di ricalcolarli (vedi note in cluster_engine.py originale).
  try {
    const sa = structuralAnalysis(rowToOdds(match));
    const s = sa.structure;
    const ceilingStr = s.goal_ceiling_open ? "APERTO (no max)" : String(s.goal_ceiling);
    const rangeStr = s.goal_range || `${s.goal_floor}-${ceilingStr}`;
    const pin = `\n\n============================================================
🔒 PIN STRUTTURALE (calcolato dal Motore Poisson — usa QUESTI valori, NON ricalcolarli):
============================================================
- PAVIMENTO: ${s.goal_floor} gol minimi attesi
- TETTO: ${ceilingStr} gol massimi attesi
- RANGE: ${rangeStr}
- FAMIGLIA STRUTTURALE: ${s.family}
- PROFILO OFFENSIVO: ${s.offensive_profile}${underAmmessiATettoAperto(s) ? " (DIFENSIVA)" : ""}
- λ Poisson Casa: ${s.lambda_home.toFixed(2)}
- λ Poisson Ospite: ${s.lambda_away.toFixed(2)}

REGOLE OBBLIGATORIE basate sul PIN:
1. Il "PAVIMENTO" e "TETTO" sopra sono CALCOLATI MATEMATICAMENTE con
   "borderline buffer" (zona incerta → step verso sicurezza). USALI ESATTAMENTE.
2. NON proporre mercati incoerenti col PIN:
   - Se PAVIMENTO=0 → NON proporre MG che inizia da 2+ (es. "MG 2-4 totali" VIETATO)
   - Se TETTO=APERTO → NON proporre U2.5 / "MG 2-4" (range chiuso VIETATO);
     U3.5 e le combo con U3.5/U4.5 (es. "DC 1X + U3.5", "1 + U4.5") SOLO se il
     PROFILO OFFENSIVO qui sotto e' "defensive" (DIFENSIVA), altrimenti VIETATI
   - Se TETTO=4 e PAVIMENTO=2 → NON proporre "MG 1-3" (lo=1≠2 VIETATO)
   - MG range valido: lo ≤ pavimento+1 AND (aperto: hi≥6 ; chiuso: hi≥tetto)
3. Nel campo "analysis" devi SCRIVERE LETTERALMENTE: "PAVIMENTO: ${s.goal_floor} gol | TETTO: ${ceilingStr} gol | RANGE: ${rangeStr}"
4. Il PIN serve a giudicare la COERENZA di un mercato, non a escluderlo a
   priori: l'elenco di cosa e' proponibile e' il CATALOGO COMPLETO piu' sotto.
   Se un mercato del catalogo ha numeri ottimi ma sembra in contrasto col PIN,
   puoi comunque proporlo spiegando il perche' nel "reasoning".
============================================================\n`;
    prompt = prompt + pin;
  } catch {
    // se il PIN fallisce, procediamo comunque senza (come nell'originale)
  }

  // SCENARIO DI QUOTE E MANUALE (Ticket 9): prima del catalogo, cosi' l'IA lo
  // legge come prima lettura. Non dipende dal web: c'e' anche senza Tavily.
  const minOdd = await readMinOdd();
  try {
    prompt = prompt + await scenarioManuale(rowToOdds(match), minOdd);
  } catch (e) {
    console.error("[ai-predict] scenario manuale", e);
  }

  // Catalogo completo con i numeri gia' calcolati.
  // Prima l'IA proponeva 3-5 mercati scegliendoli a memoria: i multigol non li
  // nominava quasi mai, e nella fusione risultavano "poco condivisi" solo
  // perche' nessuno li aveva mai messi sul tavolo. Ora li vede tutti e 54, con
  // probabilita', quota e storico dello scenario, e sceglie da quella lista.
  try {
    prompt = prompt + buildMarketTable(
      rowToOdds(match),
      await scenarioRates(rowToOdds(match)),
      minOdd,
    );
  } catch (e) {
    // se la tabella fallisce si procede senza: il pronostico resta possibile
    console.error("[ai-predict] catalogo", e);
  }

  // DATI DAL WEB (27/09/2026). Fino a ieri il modello riceveva SOLO quote,
  // probabilita' del motore e storico: niente xG, niente formazioni, niente
  // assenze. Non era un analista, era un lettore di tabelle. Qui Tavily
  // aggiunge i fatti, con le fonti.
  //
  // Il formato della risposta NON cambia: resta JSON rigido, perche' quel JSON
  // alimenta la fusione, il verdetto e l'apprendimento. Tavily aggiunge cosa il
  // modello SA, non come risponde.
  let fontiWeb: { titolo: string; url: string }[] = [];
  let webDisponibile = false;
  try {
    const ctx = await contestoPartita(
      match.squadra1, match.squadra2, match.manifestazione || "",
      (process.env.TAVILY_API_KEY || "").trim(),
    );
    fontiWeb = ctx.fonti;
    webDisponibile = ctx.disponibile;
    prompt = prompt + blocoTesto(ctx);
  } catch {
    // La ricerca web non deve MAI impedire un pronostico: senza, si lavora
    // come prima.
  }

  let prediction;
  try {
    const text = await callLlm(llmOption, PREDICTION_SYSTEM, prompt);
    prediction = parseAiJson(text);
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }

  // Traccia il costo stimato (0 per i provider gratuiti come Groq)
  try {
    await incrementSetting("ai_spent", llmOption.cost_per_pred);
    await incrementSetting("ai_count", 1);
  } catch {
    /* non bloccante */
  }

  // Le fonti si accodano all'analisi invece di finire in una colonna nuova:
  // `predictions` ha colonne fisse e una migrazione, per mostrare dei link,
  // non vale il rischio. Cosi' Rossi le vede nel dettaglio partita e restano
  // salvate insieme al pronostico che hanno contribuito a formare.
  const analisiConFonti = webDisponibile && fontiWeb.length
    ? `${prediction.analysis}\n\nFonti web consultate: ${fontiWeb.map((f) => f.url).join(" | ")}`
    : prediction.analysis;

  // I tre campi nuovi (28/09/2026) esistono solo se Rossi ha aggiunto le colonne
  // con la ALTER TABLE. Se non ci sono, PostgREST rifiuta TUTTA la riga: si
  // riprova senza, cosi' il pronostico si salva comunque. Meglio perdere gli xG
  // che perdere il pronostico.
  const numero = (v: any) => (typeof v === "number" && isFinite(v) ? v : null);
  const extra = {
    xg_casa: numero(prediction.xg_casa),
    xg_ospite: numero(prediction.xg_ospite),
    h2h_over_pct: numero(prediction.h2h_over_pct),
  };

  const riga = {
    match_id: matchId,
    family: prediction.family,
    analysis: analisiConFonti,
    playable_markets: prediction.playable_markets,
    main_prediction: prediction.main_prediction,
    confidence: prediction.confidence,
    min_goals: prediction.min_goals ?? null,
    max_goals: prediction.max_goals ?? null,
  };

  let saved;
  let xgSalvati = true;
  try {
    saved = await pgPost("predictions", { ...riga, ...extra }, "return=representation");
  } catch {
    // Colonne non ancora create: si salva il pronostico senza gli xG.
    xgSalvati = false;
    saved = await pgPost("predictions", riga, "return=representation");
  }

  await pgPatch(`matches?id=eq.${encodeURIComponent(matchId)}`, {
    family: prediction.family,
    main_prediction: prediction.main_prediction,
    updated_at: new Date().toISOString(),
  });

  const uscita = Array.isArray(saved) ? saved[0] : saved;
  return jsonResponse({ ...uscita, ...extra, xg_salvati: xgSalvati, web_disponibile: webDisponibile, web_fonti: fontiWeb });
}

async function getSelectedLlm(): Promise<LlmOption> {
  try {
    const rows = await pgGet(`settings?key=eq.llm_model&select=value`);
    const id = rows.length ? rows[0].value : DEFAULT_LLM;
    return LLM_OPTIONS.find((o) => o.id === id) || LLM_OPTIONS[0];
  } catch {
    return LLM_OPTIONS[0];
  }
}

async function incrementSetting(key: string, delta: number) {
  const rows = await pgGet(`settings?key=eq.${key}&select=*`);
  const current = rows.length ? Number(rows[0].value) || 0 : 0;
  await pgPost(
    "settings",
    { key, value: current + delta },
    "resolution=merge-duplicates,return=minimal"
  );
}

/** Porting di get_all_families_stats — costruisce il testo di feedback dallo storico market_scores. */
async function getAllFamiliesStats(league?: string): Promise<string> {
  const globalDocs = await pgGet(`market_scores?league=is.null&select=*&order=total.desc&limit=200`);
  if (!globalDocs.length && !league) return "";

  function renderBlock(items: any[], title: string): string {
    const lines = [title];
    for (const d of items.slice(0, 8)) {
      const total = d.total || 0;
      const wins = d.wins || 0;
      const missed = d.missed_wins || 0;
      if (total === 0 && missed === 0) continue;
      const rate = total > 0 ? (wins / total) * 100 : 0;
      const extra = missed ? ` | persi ${missed}` : "";
      lines.push(`  - ${d.market}: ${wins}W/${total} (${rate.toFixed(0)}%)${extra}`);
    }
    return lines.length > 1 ? lines.join("\n") : "";
  }

  const blocks: string[] = [];
  const byFamily: Record<string, any[]> = {};
  for (const d of globalDocs) (byFamily[d.family] ||= []).push(d);
  for (const [fam, items] of Object.entries(byFamily)) {
    const b = renderBlock(items, `STORICO GLOBALE ${fam}:`);
    if (b) blocks.push(b);
  }

  if (league) {
    const leagueDocs = await pgGet(
      `market_scores?league=eq.${encodeURIComponent(league)}&select=*&order=total.desc&limit=200`
    );
    if (leagueDocs.length) {
      const byLf: Record<string, any[]> = {};
      for (const d of leagueDocs) (byLf[d.family] ||= []).push(d);
      for (const [fam, items] of Object.entries(byLf)) {
        const b = renderBlock(items, `STORICO ${league} ${fam}:`);
        if (b) blocks.push(b);
      }
    }
  }

  return blocks.join("\n\n");
}

/** Percentuali storiche dello scenario di questa partita, mercato per mercato. */
async function scenarioRates(odds: Odds): Promise<Record<string, { rate: number; total: number }>> {
  const out: Record<string, { rate: number; total: number }> = {};
  const scenario = classifyScenario(odds);
  if (!scenario || scenario === "sconosciuto") return out;
  try {
    const rows = await pgGet(
      `scenario_market_scores?scenario=eq.${encodeURIComponent(scenario)}&select=market,wins,total`,
    );
    for (const r of rows) {
      if (r.total > 0) out[r.market] = { rate: Math.round((r.wins / r.total) * 100), total: r.total };
    }
  } catch {
    /* senza storico si procede lo stesso */
  }
  return out;
}

/**
 * Tabella di tutti i mercati del catalogo con i numeri gia' calcolati dal
 * motore, cosi' l'IA non deve stimarli (cosa che non sa fare) ma solo
 * giudicarli (cosa che sa fare).
 */
function buildMarketTable(
  odds: Odds,
  hist: Record<string, { rate: number; total: number }>,
  minOdd: number,
): string {
  const dist = fullDistribution(odds, 6);

  // Ordinati per probabilita' decrescente, non in ordine di catalogo: cosi' i
  // mercati migliori stanno in cima e non finiscono sepolti a meta' elenco.
  // Prima, con l'ordine di catalogo, i multigol restavano nel mezzo e l'IA
  // continuava a proporre i soliti Over/GG anche quando avevano numeri peggiori.
  // Solo i mercati che possono davvero diventare la giocata consigliata.
  // Le istruzioni al modello sono un suggerimento, il filtro nel codice e' la
  // garanzia: e' la stessa lezione del 18/09 su NG, che il prompt continuava a
  // proporre perche' glielo suggeriva una vecchia sezione del testo.
  const AMMESSI = CANDIDATE_MARKETS.filter((m) => isVerdictMarket(m));
  const voci = AMMESSI.map((m) => {
    const { quota, stimata } = quotaCatalogo(m, odds);
    return { m, p: coverageForMarket(m, dist).coverage, quota, stimata };
  })
    // I mercati sotto la soglia dell'utente vengono TOLTI, non marcati.
    // Marcarli non bastava: su Vasco Da Gama - Mirassol l'IA ha scelto lo
    // stesso "MG 1-4 totali" (quota stimata 1,17) ignorando l'avviso. Se un
    // mercato non e' selezionabile, il modo sicuro per non farlo scegliere e'
    // non mostrarglielo.
    .filter((v) => v.quota !== null && v.quota >= minOdd)
    .sort((a, b) => b.p - a.p);

  const righe = voci.map((v) => {
    const h = hist[v.m];
    // Sotto la soglia scelta dall'utente il mercato verrebbe scartato a valle:
    // segnalarlo evita che l'IA sprechi la sua prima scelta su qualcosa che
    // non arrivera' mai allo schermo (successo con O1.5 @1.33 su Vasco-Mirassol).
    return (
      `${v.m} | prob ${Math.round(v.p * 100)}% | ` +
      `quota ${v.quota ? v.quota.toFixed(2) + (v.stimata ? "~" : "") : "n/d"}` +
      (h ? ` | storico ${h.rate}% su ${h.total} partite simili` : "")
    );
  });

  return `

============================================================
📊 CATALOGO — i ${AMMESSI.length} mercati giocabili con i numeri gia' calcolati
============================================================
Legenda: "prob" e' la probabilita' calcolata dal motore Poisson sulla
distribuzione completa dei risultati. "quota" con la tilde (~) e' stimata da
noi perche' il bookmaker non la fornisce. "storico" e' quante volte quel
mercato ha vinto in partite con lo stesso profilo di favorita (tassonomia del
motore); il manuale dello scenario 1X2 e' la sezione dedicata sopra.

${righe.join("\n")}

REGOLE PER LA SCELTA:
1. Scegli i "playable_markets" ESCLUSIVAMENTE da questa lista, copiando il nome
   del mercato ESATTAMENTE come scritto sopra. Questa lista contiene GIA' solo
   i mercati che l'utente gioca davvero, e solo quelli sopra la sua soglia di
   quota (${minOdd.toFixed(2)}): qualsiasi cosa scegli fuori da qui verrebbe
   scartata dal codice e la tua scelta andrebbe persa.
2. NON stimare probabilita' tue: quelle sopra sono gia' calcolate. Il tuo
   compito e' giudicare quali conviene giocare, non ricalcolarle.
3. Considerali tutti, multigol totali e combo compresi. Sono giocabili quanto
   gli altri: se hanno i numeri migliori, proponili senza esitare.
4. Quando probabilita' e storico divergono molto, spiega nel "reasoning" a
   quale dei due dai piu' peso e perche'.
============================================================
`;
}

/** Quota di un mercato del catalogo: reale se il bookmaker la da', altrimenti stimata. */
function quotaCatalogo(m: string, odds: Odds): { quota: number | null; stimata: boolean } {
  const reale = comboOdd(m, odds);
  return { quota: reale ?? estimateMarketOdd(m, odds), stimata: reale === null };
}

/** Nome nel catalogo di un mercato scritto come nel manuale ("1 fisso" -> "1"). */
function nomeCatalogoManuale(market: string): string {
  return market
    .replace(/\bfisso\b/i, "")
    .replace(/Over\s*(\d),(\d)/gi, "O$1.$2")
    .replace(/Under\s*(\d),(\d)/gi, "U$1.$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Sezione "SCENARIO DI QUOTE" del prompt (Ticket 9): scenario 1X2 della
 * partita, mercati del manuale con la misura dall'archivio (stessa
 * aggregazione di /manuale-stats) e, per ciascuno, se e' nel catalogo, sotto
 * soglia o fuori dai mercati giocabili. Senza archivio si mostra lo scenario
 * senza percentuali.
 */
export async function scenarioManuale(odds: Odds, minOdd: number): Promise<string> {
  const nota = getScenarioNote(odds as any);
  if (!nota) return "";
  let misura: ManualeStats["scenari"][string] | undefined;
  try {
    misura = (await calcolaManualeStats()).scenari[chiaveScenario(nota)];
  } catch (e) {
    console.error("[ai-predict] misura manuale", e);
  }
  const voci: VoceManuale[] = nota.markets.map((m) => {
    const c = misura?.mercati[m];
    const nome = nomeCatalogoManuale(m);
    const base = { manuale: m, vinte: c?.vinte, valutate: c ? c.vinte + c.perse : undefined, pct: c?.pct };
    if (!isVerdictMarket(nome)) return { ...base, stato: "fuori" as const };
    const { quota } = quotaCatalogo(nome, odds);
    const stato = quota !== null && quota >= minOdd ? "catalogo" as const : "soglia" as const;
    return { ...base, stato, nomeCatalogo: nome, quota };
  });
  const ggO25 = nota.markets.find((m) => nomeCatalogoManuale(m) === "GG + O2.5");
  return bloccoScenarioManuale({
    scenario: nota.scenario,
    favorita: nota.favorita ?? null,
    voci,
    minOdd,
    profiloDifensivo: underAmmessiATettoAperto(structuralAnalysis(odds).structure),
    ggO25Manuale: ggO25 ? misura?.mercati[ggO25]?.pct ?? null : null,
  });
}
