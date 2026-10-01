import { pgGet, pgPost, pgPatch, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import {
  structuralAnalysis, CANDIDATE_MARKETS, fullDistribution, coverageForMarket,
  comboOdd, estimateMarketOdd, isVerdictMarket, quoteCatalogo, type Odds,
} from "./lib/clusterEngine";
import { classifyScenario } from "./lib/scenario";
import { readMinOdd } from "./odd-settings";
import { buildMatchPrompt, PREDICTION_SYSTEM, parseAiJson, bloccoScenarioManuale, normalizzaStatistiche, normalizzaFasce, normalizzaConsiglio, type VoceManuale } from "./lib/predictionPrompt";
import { manualeStatsRecenti, type ManualeStats } from "./lib/manuale";
import { preHeuristicRanking, preEligibleMarkets } from "./lib/preHeuristic";
import { LLM_OPTIONS, DEFAULT_LLM, callLlm, type LlmOption } from "./lib/llmProviders";
import { contestoPartita, blocoTesto } from "./lib/webSearch";
import { underAmmessiATettoAperto, getScenarioNote, chiaveScenario, FASCE_AI, chiaveFascia, inizioPartitaMs,
  candidatiManuale, quotaManuale, nomeCatalogoManuale, type CandidatoManuale } from "../../frontend/src/api";

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
3. NON ripetere il PIN nel campo "analysis": e' gia' a schermo (STRUTTURA MATCH).
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
  // Il catalogo parte dalla fascia piu' bassa (1.40): l'AI stila una classifica
  // per OGNI fascia 1.40 / 1.50 / 1.60 / 1.75, non solo per la soglia scelta.
  const minOdd = Math.min(await readMinOdd(), FASCE_AI[0]);
  // Mercati del manuale candidati in QUESTA partita (scenario, >50% in
  // archivio, quota >= 1.40): entrano nel catalogo dell'AI solo qui.
  let manualeQui: CandidatoManuale[] = [];
  try {
    const stats = await manualeStatsRecenti();
    manualeQui = candidatiManuale(rowToOdds(match) as any, stats.scenari as any, minOdd, quoteCatalogo(rowToOdds(match)), true);
  } catch (e) {
    console.error("[ai-predict] candidati manuale", e);
  }
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
      manualeQui,
    );
  } catch (e) {
    // se la tabella fallisce si procede senza: il pronostico resta possibile
    console.error("[ai-predict] catalogo", e);
  }

  // PARERE DEL PRE (01/10/2026): la classifica dell'euristica sulle sole quote
  // reali, come dato di confronto. Prima l'AI non la vedeva affatto.
  try {
    prompt = prompt + bloccoPre(rowToOdds(match));
  } catch (e) {
    console.error("[ai-predict] blocco PRE", e);
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
  // PARTITA GIA' INIZIATA (01/10/2026): la ricerca web potrebbe trovare il
  // risultato. Si cerca solo fino al giorno prima, si avvisa il modello e il
  // pronostico viene marcato post_partita: non conta per verdetto e pagella.
  const inizio = inizioPartitaMs(match.day, match.time);
  const postPartita = !!match.result || (inizio !== null && Date.now() >= inizio);
  try {
    const ctx = await contestoPartita(
      match.squadra1, match.squadra2, match.manifestazione || "",
      (process.env.TAVILY_API_KEY || "").trim(),
      inizio,
    );
    fontiWeb = ctx.fonti;
    webDisponibile = ctx.disponibile;
    prompt = prompt + blocoTesto(ctx);
  } catch (e) {
    // La ricerca web non deve MAI impedire un pronostico: senza, si lavora
    // come prima.
    console.error("[ai-predict] ricerca web", e);
  }
  if (postPartita) {
    prompt += `\n⚠ Questa partita e' GIA' INIZIATA o finita. Ragiona come se fossi prima del calcio d'inizio: ignora qualsiasi informazione su risultato, marcatori o andamento di QUESTA partita, anche se compare nei dati web.\n`;
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

  // Le fonti vanno nella colonna `fonti_web` (riga compatta in scheda), non
  // piu' in coda al testo. Se la colonna non esiste ancora, si torna a
  // accodarle all'analisi, come prima, per non perderle.
  const fonti = webDisponibile && fontiWeb.length ? fontiWeb : null;
  const analisiConFonti = fonti
    ? `${prediction.analysis}\n\nFonti web consultate: ${fonti.map((f) => f.url).join(" | ")}`
    : prediction.analysis;

  // Classifica per fascia (01/10/2026). main_prediction e' il "PUNTA SU QUESTO"
  // dell'AI, a qualunque quota; solo se manca si ripiega sul primo della fascia
  // 1.40, per chi legge ancora i campi vecchi.
  const fasceAI = normalizzaFasce((prediction as any).fasce);
  if (fasceAI && !prediction.main_prediction) prediction.main_prediction = fasceAI[chiaveFascia(FASCE_AI[0])]?.classifica[0] ?? null;
  // Il consiglio motivato (01/10/2026) viaggia DENTRO la colonna `fasce`
  // (chiave "consiglio"): nessuna colonna nuova. validaFasce legge solo le
  // chiavi 1.40/1.50/1.60/1.75, quindi non lo vede.
  const consiglio = normalizzaConsiglio((prediction as any).consiglio, prediction.main_prediction);
  if (consiglio && prediction.main_prediction) consiglio.mercato = prediction.main_prediction;
  const fasce = fasceAI || consiglio ? { ...(fasceAI || {}), ...(consiglio ? { consiglio } : {}) } : null;

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

  // Ticket 10: tabella casa | ospite. Colonna jsonb `statistiche_squadre` in
  // `predictions`: se non esiste ancora si salva senza (come gli xG), ma la
  // risposta la riporta comunque, cosi' la scheda la mostra subito.
  const statistiche = normalizzaStatistiche((prediction as any).statistiche_squadre);

  const riga = {
    match_id: matchId,
    family: prediction.family,
    analysis: prediction.analysis,
    playable_markets: prediction.playable_markets,
    main_prediction: prediction.main_prediction,
    confidence: prediction.confidence,
    min_goals: prediction.min_goals ?? null,
    max_goals: prediction.max_goals ?? null,
  };

  // Colonne facoltative: esistono solo se Rossi ha lanciato la ALTER TABLE.
  // PostgREST rifiuta TUTTA la riga se ne manca una e nell'errore la nomina:
  // la si toglie e si riprova, cosi' il pronostico si salva sempre.
  const facoltative: Record<string, unknown> = {
    ...extra,
    ...(statistiche ? { statistiche_squadre: statistiche } : {}),
    ...(fonti ? { fonti_web: fonti } : {}),
    ...(fasce ? { fasce } : {}),
    post_partita: postPartita,
  };
  let saved;
  for (let tentativo = 0; ; tentativo++) {
    try {
      const analysis = fonti && !("fonti_web" in facoltative) ? analisiConFonti : prediction.analysis;
      saved = await pgPost("predictions", { ...riga, analysis, ...facoltative }, "return=representation");
      break;
    } catch (e: any) {
      console.error("[ai-predict] salvataggio", e);
      const manca = String(e?.message || "").match(/'([a-z_0-9]+)' column/)?.[1];
      if (tentativo < 8 && manca && manca in facoltative) { delete facoltative[manca]; continue; }
      if (tentativo < 8 && Object.keys(facoltative).length) {
        // Errore senza nome di colonna: si riprova con la sola riga base.
        for (const k of Object.keys(facoltative)) delete facoltative[k];
        continue;
      }
      throw e;
    }
  }
  const xgSalvati = "xg_casa" in facoltative;
  const statisticheSalvate = "statistiche_squadre" in facoltative;
  const fasceSalvate = "fasce" in facoltative;

  await pgPatch(`matches?id=eq.${encodeURIComponent(matchId)}`, {
    family: prediction.family,
    main_prediction: prediction.main_prediction,
    updated_at: new Date().toISOString(),
  });

  const uscita = Array.isArray(saved) ? saved[0] : saved;
  return jsonResponse({
    ...uscita, ...extra,
    statistiche_squadre: statistiche, statistiche_salvate: statisticheSalvate,
    fasce, fasce_salvate: fasceSalvate,
    fonti_web: fonti,
    post_partita: postPartita,
    xg_salvati: xgSalvati, web_disponibile: webDisponibile, web_fonti: fontiWeb,
  });
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
  manuale: CandidatoManuale[] = [],
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
  // Posizione nel ranking del motore Poisson: e' un controllo, non un voto.
  const rankingMotore = structuralAnalysis(odds).ranking.map((r) => r.market);
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

  // Mercati del manuale ammessi SOLO in questa partita: la probabilita' e'
  // quella misurata in archivio sullo scenario (AH -0,75 il Poisson non la sa).
  const righeManuale = manuale.map((c) =>
    `${c.market} | storico scenario ${c.pct.toFixed(1).replace(".", ",")}% (${c.vinte}/${c.valutate}) | ` +
    `quota ${c.odd.toFixed(2)}${c.stimata ? "~" : ""} | DA MANUALE, giocabile solo in questa partita`,
  );

  const righe = voci.map((v) => {
    const h = hist[v.m];
    // Sotto la soglia scelta dall'utente il mercato verrebbe scartato a valle:
    // segnalarlo evita che l'IA sprechi la sua prima scelta su qualcosa che
    // non arrivera' mai allo schermo (successo con O1.5 @1.33 su Vasco-Mirassol).
    const pos = rankingMotore.indexOf(v.m);
    return (
      `${v.m} | prob ${Math.round(v.p * 100)}% | ` +
      `quota ${v.quota ? v.quota.toFixed(2) + (v.stimata ? "~" : "") : "n/d"}` +
      ` | motore ${pos >= 0 ? "#" + (pos + 1) : "fuori ranking"}` +
      (h ? ` | storico ${h.rate}% su ${h.total} partite simili` : "")
    );
  });

  return `

============================================================
📊 CATALOGO — i ${AMMESSI.length} mercati giocabili con i numeri gia' calcolati
============================================================
Legenda: "prob" e' la probabilita' calcolata dal motore Poisson sulla
distribuzione completa dei risultati. "quota" con la tilde (~) e' stimata da
noi perche' il bookmaker non la fornisce. "motore #n" e' la posizione nel
ranking del motore Poisson (controllo, non verdetto). "storico" e' quante volte quel
mercato ha vinto in partite con lo stesso profilo di favorita (tassonomia del
motore); il manuale dello scenario 1X2 e' la sezione dedicata sopra.

${righe.join("\n")}
${righeManuale.length ? `\nMERCATI DEL MANUALE AMMESSI IN QUESTA PARTITA (oltre il 50% in archivio sullo scenario):\n${righeManuale.join("\n")}\n` : ""}
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
    misura = (await manualeStatsRecenti()).scenari[chiaveScenario(nota)];
  } catch (e) {
    console.error("[ai-predict] misura manuale", e);
  }
  const voci: VoceManuale[] = nota.markets.map((m) => {
    const c = misura?.mercati[m];
    const nome = nomeCatalogoManuale(m);
    const base = { manuale: m, vinte: c?.vinte, valutate: c ? c.vinte + c.perse : undefined, pct: c?.pct };
    // Gia' giocabile per conto suo (whitelist): conta solo la soglia.
    if (isVerdictMarket(nome)) {
      const { quota } = quotaCatalogo(nome, odds);
      const stato = quota !== null && quota >= minOdd ? "catalogo" as const : "soglia" as const;
      return { ...base, stato, nomeCatalogo: nome, quota };
    }
    // Mercato del manuale: giocabile in questa partita solo oltre il 50% in
    // archivio e con una quota (regole di Rossi) sopra la soglia.
    const q = quotaManuale(m, odds as any, quoteCatalogo(odds));
    if (!q) return { ...base, stato: "fuori" as const };
    const nomeGioco = /AH|oppure/i.test(m) ? m : nome;
    if (c?.pct == null || c.pct <= 50) return { ...base, stato: "fuori" as const };
    const stato = q.odd >= minOdd ? "catalogo" as const : "soglia" as const;
    return { ...base, stato, nomeCatalogo: nomeGioco, quota: q.odd };
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

/**
 * Parere del PRE (euristica sulle sole quote reali) come dato di confronto
 * per l'AI: la sua classifica e i mercati su cui non puo' esprimersi.
 */
function bloccoPre(odds: Odds): string {
  const ranking = preHeuristicRanking(odds);
  const eleggibili = new Set(preEligibleMarkets(odds));
  const muti = CANDIDATE_MARKETS.filter((m) => isVerdictMarket(m) && !eleggibili.has(m));
  return `

============================================================
⚡ PARERE DEL PRE (euristica sulle sole quote reali del bookmaker)
============================================================
${ranking.length ? ranking.map((c, i) => `${i + 1}. ${c.market} @${c.odd.toFixed(2)} (${c.family})`).join("\n") : "Nessun mercato proposto."}
Non puo' esprimersi (manca una quota reale): ${muti.join(", ") || "nessuno"}.
E' un parere indipendente: non conosce profilo, web ne' Poisson. Usalo come
confronto, non come decisione.
============================================================
`;
}
