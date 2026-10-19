/**
 * Chiamate alle Netlify Functions "proprie" (stesso dominio, niente Emergent).
 * Usata per gli endpoint gia' migrati su Supabase.
 */
async function netlifyReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t}`);
  }
  return res.json();
}


export type MultiplaRequest = {
  day: string;
  events: number;
  minTotalOdd: number;
  minOdd?: number;
  minProb?: number;
  maxPerLeague?: number;
  /** Pattern di mercato ammessi: "1" "2" "O2.5" "GG" "1X" "X2".
   *  Vuoto o assente = nessun vincolo, il motore prende la giocata piu'
   *  probabile di ogni partita (comportamento fino al 19/09/2026). */
  patterns?: string[];
  locked?: { matchId: string; market: string }[];
  excludeMatches?: string[];
  excludeLeagues?: string[];
  apply?: boolean;
  replaceSelection?: boolean;
};

export type MultiplaLeg = {
  match_id: string;
  squadra1: string;
  squadra2: string;
  manifestazione: string;
  tier: 1 | 2 | 3;
  tier_label: string;
  time: string;
  market: string;
  prob: number;
  odd: number;
  odd_estimated: boolean;
  locked: boolean;
  alternatives: { market: string; prob: number; odd: number; odd_estimated: boolean }[];
  /** Quante volte quel mercato e' uscito davvero nel database: su partite con la
   *  stessa lettura di quote e su partite concluse dello stesso campionato.
   *  null quando il campione e' troppo piccolo (meno di 20 partite). */
  storico_scenario?: { pct: number; total: number } | null;
  storico_campionato?: { pct: number; total: number } | null;
};

export type MultiplaResponse = {
  ok: boolean;
  reason: string | null;
  error?: string;
  applied: boolean;
  day: string;
  requested: { events: number; minTotalOdd: number; minOdd: number; minProb: number; maxPerLeague: number };
  total_odd: number;
  total_estimated: boolean;
  total_prob: number;
  legs: MultiplaLeg[];
  /** Con i consigliati (07/10/2026): completamenti, varianti, un evento in piu'... */
  proposte?: { titolo: string; descrizione: string; avviso: string | null; legs: MultiplaLeg[]; total_odd: number; total_prob: number }[];
  tiers_used: number[];
  pool: { matches: number; candidates: number; skipped_started: number; skipped_excluded: number; skipped_no_play: number };
};

export type OddsKey =
  | "odd_1" | "odd_X" | "odd_2"
  | "odd_1X" | "odd_X2" | "odd_12"
  | "odd_U15" | "odd_O15"
  | "odd_U25" | "odd_O25"
  | "odd_U35" | "odd_O35"
  | "odd_GG" | "odd_NG";

export type Odds = Partial<Record<OddsKey, number>> & { estimated?: OddsKey[] };

export type Match = {
  id: string;
  day: string;
  time: string;
  manifestazione: string;
  squadra1: string;
  squadra2: string;
  odds: Odds;
  result?: string | null;
  family?: string | null;
  main_prediction?: string | null;
  /** verdetto finale della fusione, salvato su Supabase: card e dettaglio devono mostrarlo entrambi */
  pick_finale?: string | null;
  pick_finale_prob?: number | null;
  playable_markets?: { market: string; reasoning?: string }[] | null;
  selected?: boolean;
  /** Ricalcolo storico con le regole di oggi (tasto in Strumenti): solo per
   *  le partite concluse, accanto al congelato che NON viene toccato. */
  ricalcolo?: RicalcoloPartita | null;
  /** Primo mercato del PRE del server (lo stesso della scheda): anteprima della
   *  card finche' non c'e' un verdetto. */
  anteprima_pre?: string | null;
};

export type RicalcoloFasciaPartita = {
  market: string; odd: number | null; stimata: boolean; prob: number | null;
  esito: "vinta" | "persa" | "rimborso" | "mezza" | null;
} | null;
export type RicalcoloPartita = { versione: string; data: string; fasce: Record<string, RicalcoloFasciaPartita> };

export type RicalcoloStato = {
  versione: string; iniziato: string; pos: number; totale: number; finito: boolean;
  curva: Record<string, Record<string, { v: number; p: number }>>;
  pagella: Record<string, { oggi: { v: number; p: number }; stesse: number; oggiStesse: number; congelatoStesse: number }>;
};

export type Prediction = {
  id?: string;
  match_id: string;
  created_at?: string;
  /** true se generato DOPO il calcio d'inizio: puo' essere contaminato dal
   *  risultato (ricerca web), quindi non conta per verdetto e pagella. */
  post_partita?: boolean | null;
  family?: string;
  analysis?: string;
  playable_markets?: { market: string; reasoning: string }[];
  main_prediction?: string;
  confidence?: string;
  min_goals?: number;
  max_goals?: number;
  /** xG letti dal web al momento del pronostico (28/09/2026). null quando le
   *  fonti non li contenevano: non vengono mai dedotti. */
  xg_casa?: number | null;
  xg_ospite?: number | null;
  h2h_over_pct?: number | null;
  /** Ticket 10: statistiche trovate sul web, casa | ospite. Assente nei
   *  pronostici vecchi: la scheda mostra allora solo il testo. */
  statistiche_squadre?: {
    casa?: Record<string, string>;
    ospite?: Record<string, string>;
  } | null;
  /** Classifica dell'AI per fascia di quota (1.40 / 1.50 / 1.60 / 1.75).
   *  Assente nei pronostici vecchi: allora il verdetto resta la fusione. */
  fasce?: Record<string, FasciaAI> | null;
  /** Fonti web consultate, tenute fuori dal testo dell'analisi. */
  fonti_web?: { titolo?: string; url: string }[] | null;
};

/** Una fascia della classifica AI, cosi' come la restituisce il modello. */
export type FasciaAI = { classifica: string[]; perche?: string };

/**
 * Divide l'analysis dell'AI nei due riquadri della scheda (LETTURA DELLA
 * PARTITA / PERCHE' QUESTA SCELTA) e separa le fonti web che i pronostici
 * vecchi avevano in coda al testo. Senza marcatori tutto va in "lettura".
 */
export function dividiAnalisi(testo: string | null | undefined): { lettura: string; perche: string; fonti: string[] } {
  let t = String(testo || "");
  let fonti: string[] = [];
  const f = t.search(/Fonti web consultate:/i);
  if (f >= 0) {
    fonti = t.slice(f).replace(/Fonti web consultate:/i, "").split("|").map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x));
    t = t.slice(0, f);
  }
  const p = t.search(/PERCH(?:E'|É|E)\s+QUESTA\s+SCELTA\s*:?/i);
  const lettura = (p >= 0 ? t.slice(0, p) : t).replace(/^\s*\(?1?\)?\s*LETTURA DELLA PARTITA\s*:?\s*/i, "").trim();
  const perche = p >= 0 ? t.slice(p).replace(/^PERCH(?:E'|É|E)\s+QUESTA\s+SCELTA\s*:?\s*/i, "").trim() : "";
  return { lettura, perche, fonti };
}

/** Righe della tabella casa | ospite del pronostico AI (Ticket 10), in ordine. */
export const RIGHE_STATISTICHE: { chiave: string; etichetta: string }[] = [
  { chiave: "attacco", etichetta: "Attacco" },
  { chiave: "difesa", etichetta: "Difesa" },
  { chiave: "xg", etichetta: "xG" },
  { chiave: "xga", etichetta: "xGA" },
  { chiave: "forma", etichetta: "Forma" },
  { chiave: "proiezione_gol", etichetta: "Proiezione gol" },
  { chiave: "note_chiave", etichetta: "Note" },
];

export type StructuralCluster = {
  score: string;
  home: number;
  away: number;
  p: number;
  compatibility: "high" | "medium" | "low";
};

export type MLAdjustment = {
  type: "boost" | "malus" | "neutral";
  win_rate: number;
  total: number;
  delta: string;  // e.g. "+10%", "-10%", "0%"
};

export type StructuralMarketRank = {
  market: string;
  coverage: number;
  fragility: number;
  fragility_label: "bassa" | "media" | "alta";
  covered_scores: string[];
  broken_by: string[];
  score: number;
  /** quota del mercato: reale se il bookmaker la fornisce, altrimenti stimata */
  odd?: number | null;
  /** true se `odd` è una stima del motore e non un prezzo del bookmaker */
  odd_estimated?: boolean;
  ml_adjustment?: MLAdjustment;
};

export type StructuralStructure = {
  family: string;
  dominance: string;
  offensive_profile: string;
  goal_compression: "high" | "medium" | "low";
  goal_floor: number;
  goal_ceiling: number;
  goal_ceiling_open?: boolean;
  goal_range: string;
  lambda_home: number;
  lambda_away: number;
};

export type StructuralAnalysis = {
  /** soglia di quota minima con cui è stato costruito questo ranking (Fase 2) */
  min_odd?: number;
  /** classifica dell'euristica PRE, calcolata lato server su tutto il catalogo */
  pre_ranking?: { market: string; odd: number }[];
  /** mercati su cui l'euristica PRE ha potuto esprimersi (hanno un prezzo reale) */
  pre_eligible?: string[];
  /** quota di OGNI mercato del catalogo, reale o stimata: serve a non lasciare mai un pick senza prezzo */
  market_odds?: Record<string, { odd: number; estimated: boolean }>;
  /** fino a che soglia di quota conviene spingersi SU QUESTA partita (null = nemmeno la piu' bassa) */
  soglia_consigliata?: number | null;
  /** cosa uscirebbe a ogni soglia: serve a spiegare il consiglio invece di imporlo */
  soglie_dettaglio?: { soglia: number; market: string; prob: number }[];
  structure: StructuralStructure;
  cluster: StructuralCluster[];
  central_cluster: StructuralCluster[];
  ranking: StructuralMarketRank[];
  pick: StructuralMarketRank | null;
  explanation: string;
};

export type PendingMatch = {
  id: string; day: string; time: string | null; manifestazione: string;
  squadra1: string; squadra2: string;
  odd_1: number | null; odd_x: number | null; odd_2: number | null;
  odd_1x: number | null; odd_x2: number | null; odd_12: number | null;
  odd_u15: number | null; odd_o15: number | null;
  odd_u25: number | null; odd_o25: number | null;
  odd_u35: number | null; odd_o35: number | null;
  odd_gg: number | null; odd_ng: number | null;
};

export type ResultsImportResponse = {
  ricevute: number;
  applicate: number;
  sovrascritte: number;
  gia_presenti: number;
  saltate_perche_diverse: number;
  illeggibili: number;
  non_trovate: number;
  esempi_illeggibili: string[];
  esempi_diverse: { id: string; nel_database: string; nel_file: string }[];
};

export type SyncResultsResponse = {
  ok: boolean; prova: boolean; dal: string; al: string; giorni: number;
  partite_esaminate: number;
  scritte: number; da_verificare: number; ambigue: number;
  non_trovate: number; non_finite: number; supplementari: number; incerte: number;
  per_fonte: Record<string, number>;
  fonti_non_raggiungibili: string[];
  da_controllare: { id: string; partita: string; giorno: string; motivo: string; risultato?: string; fonte?: string; somiglianza?: number }[];
  /** Solo con `ids` (Schedina): cosa e' successo a ogni partita scelta. */
  esiti?: { id: string; partita: string; giorno: string; esito: string; risultato?: string; fonte?: string }[];
  error?: string;
};

export type RebuildResponse = {
  ok: boolean; totale_concluse: number; da: number; elaborate: number;
  prossimo: number | null; finito: boolean;
  scenari_aggiornati: number; pagelle_aggiornate: number; famiglie_aggiornate: number;
  saltate_risultato_illeggibile: number;
  error?: string;
};

export type SimilarOddsResponse = {
  ok: boolean;
  motivo?: string;
  tolleranza: number;
  allargata?: boolean;
  partite_simili: number;
  storico_totale: number;
  media_gol?: number;
  punteggi_frequenti?: { punteggio: string; volte: number; pct: number }[];
  mercati?: { market: string; giocabile: boolean; vinte: number; valutate: number; pct: number | null }[];
  error?: string;
};

export type BacktestResponse = {
  ok: boolean;
  lambda: string;
  regola?: string;
  split?: string | null;
  minOdd: number;
  totale_concluse: number;
  da: number; elaborate: number; prossimo: number | null; finito: boolean;
  esaminate: number; con_pick: number; senza_pick: number; scartate: number;
  vinte: number; perse: number;
  per_famiglia: Record<string, { partite: number; vinte: number; perse: number; senzaPick: number }>;
  pick_per_famiglia: Record<string, Record<string, { scelte: number; vinte: number; perse: number }>>;
  occasioni_perse: Record<string, Record<string, number>>;
  error?: string;
};

/** Totale della pagella (Traccia) sommato blocco per blocco. Condiviso: lo
 *  somma il server nel lavoro "pagella" (`/lavori`), lo legge l'app. */
export type SommaBacktest = {
  esaminate: number; con_pick: number; senza_pick: number; vinte: number; perse: number;
  per_famiglia: Record<string, { partite: number; vinte: number; perse: number; senzaPick: number }>;
  pick_per_famiglia: Record<string, Record<string, { scelte: number; vinte: number; perse: number }>>;
  occasioni_perse: Record<string, Record<string, number>>;
};

export const sommaBacktestVuota = (): SommaBacktest => ({
  esaminate: 0, con_pick: 0, senza_pick: 0, vinte: 0, perse: 0,
  per_famiglia: {}, pick_per_famiglia: {}, occasioni_perse: {},
});

/** Somma un blocco nel totale: il server ne restituisce uno per volta. */
export function accumulaBacktest(t: SommaBacktest, r: BacktestResponse): SommaBacktest {
  t.esaminate += r.esaminate; t.con_pick += r.con_pick;
  t.senza_pick += r.senza_pick; t.vinte += r.vinte; t.perse += r.perse;
  for (const [fam, v] of Object.entries(r.per_famiglia || {})) {
    const f = t.per_famiglia[fam] || { partite: 0, vinte: 0, perse: 0, senzaPick: 0 };
    f.partite += v.partite; f.vinte += v.vinte; f.perse += v.perse; f.senzaPick += v.senzaPick;
    t.per_famiglia[fam] = f;
  }
  for (const [fam, mercati] of Object.entries(r.pick_per_famiglia || {})) {
    t.pick_per_famiglia[fam] = t.pick_per_famiglia[fam] || {};
    for (const [m, c] of Object.entries(mercati)) {
      const x = t.pick_per_famiglia[fam][m] || { scelte: 0, vinte: 0, perse: 0 };
      x.scelte += c.scelte; x.vinte += c.vinte; x.perse += c.perse;
      t.pick_per_famiglia[fam][m] = x;
    }
  }
  for (const [fam, mercati] of Object.entries(r.occasioni_perse || {})) {
    t.occasioni_perse[fam] = t.occasioni_perse[fam] || {};
    for (const [m, n] of Object.entries(mercati)) {
      t.occasioni_perse[fam][m] = (t.occasioni_perse[fam][m] || 0) + n;
    }
  }
  return t;
}

// --- LAVORI IN BACKGROUND (01/10/2026) -------------------------------------
// I lavori lunghi girano sul server (`/lavori`), non piu' in un ciclo dentro
// l'app: continuano anche a schermo spento o in un'altra app. Uno alla volta.
export type TipoLavoro = "ricalcolo" | "ricostruzione" | "pagella" | "import_risultati" | "sync_risultati" | "ai_schedina";

export const NOMI_LAVORO: Record<TipoLavoro, string> = {
  ricalcolo: "Ricalcolo con le regole di oggi",
  ricostruzione: "Ricostruzione dell'apprendimento",
  pagella: "Pagella dei pronostici",
  import_risultati: "Caricamento risultati dal foglio",
  sync_risultati: "Aggiornamento risultati dal server",
  ai_schedina: "Pronostici AI della Schedina",
};

export type Lavoro = {
  id: string;
  tipo: TipoLavoro;
  /** Parametri del lavoro (per l'import, senza l'elenco delle righe). */
  parametri: Record<string, any>;
  stato: "in_corso" | "completato" | "annullato" | "errore";
  /** Partite/righe fatte e totale (0 finche' il primo blocco non l'ha contato). */
  pos: number;
  totale: number;
  /** Somme dei blocchi: dipendono dal tipo (per "pagella" e' una SommaBacktest). */
  parziale: Record<string, any>;
  errore?: string | null;
  avviato: string;
  aggiornato: string;
  finito_il?: string | null;
  /** true se e' in corso ma nessuno ci sta lavorando da un po': l'app da' una spinta. */
  fermo?: boolean;
};

/** Aggiorna quote dal PC di casa (/quote-pc): una richiesta alla volta. */
export type QuotePcRichiesta = {
  id: string;
  stato: "in_attesa" | "in_corso" | "fatto" | "errore";
  creata: string;
  aggiornato: string;
  /** Cosa sta facendo il PC adesso, in parole ("Scarico il PDF da Sisal"...). */
  fase: string;
  esito: {
    partite_pdf: number;
    pdf: string;
    excel: string;
    inserted: number;
    updated: number;
    unchanged?: number;
    skipped: number;
    total_parsed: number;
    rows_seen?: number;
  } | null;
  errore: string | null;
};

export type QuotePcStato = {
  /** false = nessun battito dal PC nell'ultimo minuto: "server spento". */
  acceso: boolean;
  ultimo_battito: string | null;
  richiesta: QuotePcRichiesta | null;
};

export const api = {
  matches: (day?: string, q?: string) => {
    const p = new URLSearchParams();
    if (day) p.set("day", day);
    if (q) p.set("q", q);
    const qs = p.toString();
    return netlifyReq<Match[]>(`/matches-list${qs ? `?${qs}` : ""}`);
  },
  days: () => netlifyReq<string[]>("/matches-days"),

  /** Fa calcolare al server i verdetti mancanti di una giornata (fase 0). */
  verdettiDelGiorno: (day: string) =>
    netlifyReq<{ ok: boolean; calcolati: number; salvati: number; senza_pick: number }>(
      `/verdetto?day=${encodeURIComponent(day)}`,
    ),

  /** Fa calcolare e salvare al server il consigliato di UNA partita: il piu'
   *  solido fra tutte le fasce, qualunque fascia si stia guardando (13/10/2026). */
  verdettoPartita: (matchId: string) =>
    netlifyReq<{ ok: boolean; pick: VerdictPick | null; fascia?: number | null; salvato: boolean }>(
      `/verdetto?id=${encodeURIComponent(matchId)}`,
    ),

  /** Traccia: rigioca il motore sulle partite concluse. Non influenza niente. */
  backtest: (
    from: number, minOdd: number, lambdaVecchi: boolean,
    regola: "motore" | "maxprob" | "pre" = "motore", split = "", limit = 400,
  ) =>
    netlifyReq<BacktestResponse>(
      `/backtest?from=${from}&limit=${limit}&minOdd=${minOdd}&regola=${regola}`
      + `${lambdaVecchi ? "&lambda=vecchi" : ""}${split ? `&split=${split}` : ""}`,
    ),

  /** Storico delle partite concluse con quote vicine a quelle di questa. */
  similarOdds: (matchId: string, tol = 0.15) =>
    netlifyReq<SimilarOddsResponse>(`/similar-odds?id=${encodeURIComponent(matchId)}&tol=${tol}`),
  /** Ticket 8: quanto ha risposto il manuale per scenario (sola lettura). */
  manualeStats: () => netlifyReq<ManualeStatsResponse>("/manuale-stats"),

  // --- MANUTENZIONE (27/09/2026) ---
  /** Partite gia' giocate ma ancora senza risultato. `count` evita di scaricare
   *  migliaia di righe quando serve solo sapere quante sono. */
  pendingMatches: (soloConteggio = false) =>
    netlifyReq<{
      da_completare: number;
      prima_data?: string | null;
      ultima_data?: string | null;
      per_mese?: Record<string, number>;
      matches?: PendingMatch[];
    }>(`/pending-matches${soloConteggio ? "?count=1" : ""}`),

  /** Recupero automatico dei risultati via FotMob per gli id indicati. */
  resultsFetch: (ids: string[]) =>
    netlifyReq<{ results: any[]; applied: number; skipped: number; not_found: number }>(
      "/results-fetch", { method: "POST", body: JSON.stringify({ ids, apply: true }) },
    ),

  /** "Aggiorna risultati": una richiesta per giornata, cascata API-Football ->
   *  FotMob. Scrive solo quando e' sicuro. */
  syncResults: (days = 3, dry = false) =>
    netlifyReq<SyncResultsResponse>(`/sync-results?days=${days}${dry ? "&dry=1" : ""}`),
  /** Stessa ricerca, ma solo sulle partite indicate (tasto RISULTATI della Schedina). */
  syncResultsScelte: (ids: string[]) =>
    netlifyReq<SyncResultsResponse>("/sync-results", { method: "POST", body: JSON.stringify({ ids }) }),

  /** Ricostruisce l'apprendimento rigiocando le partite concluse, a blocchi. */
  rebuildLearning: (from = 0, reset = false) =>
    netlifyReq<RebuildResponse>(`/rebuild-learning?from=${from}${reset ? "&reset=1" : ""}`, { method: "POST" }),

  /** Ricalcolo storico con le regole di oggi, in ordine di data, a blocchi. */
  ricalcolo: (from = 0, reset = false) =>
    netlifyReq<{ ok: boolean; totale_concluse: number; elaborate: number; scritte: number; saltate: number; prossimo: number | null; finito: boolean; error?: string }>(
      `/ricalcolo?from=${from}${reset ? "&reset=1" : ""}`, { method: "POST" }),
  ricalcoloStato: () => netlifyReq<{ ok: boolean; stato: RicalcoloStato | null }>("/ricalcolo"),

  /** Lavori in background: avvio, stato, spinta, annullamento. */
  lavoroAvvia: (tipo: TipoLavoro, parametri: Record<string, any> = {}) =>
    netlifyReq<{ ok: boolean; lavoro: Lavoro }>("/lavori", { method: "POST", body: JSON.stringify({ tipo, parametri }) }),
  lavoroStato: () => netlifyReq<{ ok: boolean; lavoro: Lavoro | null }>("/lavori"),
  /** Fa lavorare il server subito, senza aspettare l'orologio. Non si aspetta
   *  la risposta: se il telefono si addormenta, il server va avanti lo stesso. */
  lavoroSpinta: () => { fetch("/lavori?passo=1", { method: "POST" }).catch(() => {}); },
  lavoroAnnulla: () => netlifyReq<{ ok: boolean }>("/lavori?annulla=1", { method: "POST" }),

  /** Caricamento massivo dei risultati dal foglio compilato. */
  resultsImport: (items: { id: string; result: string }[], overwrite = false) =>
    netlifyReq<ResultsImportResponse>(
      "/results-import", { method: "POST", body: JSON.stringify({ items, overwrite }) },
    ),
  match: (id: string) => netlifyReq<Match & { prediction?: Prediction }>(`/match-detail?id=${encodeURIComponent(id)}`),
  tabellaScenari: () => netlifyReq<TabellaScenari>(`/tabella-scenari`),
  pagellaConsigliato: () => netlifyReq<PagellaConsigliato>(`/pagella-consigliato`),
  /** GET con auto=1 (la lettura gratis si fa da sola se manca); genera = POST; pro = modello scelto; savedOnly = non calcola se manca. */
  lettura: (id: string, opz: { genera?: boolean; pro?: boolean; auto?: boolean; savedOnly?: boolean; rifai?: boolean } = {}) =>
    netlifyReq<RispostaLettura>(
      `/lettura?matchId=${encodeURIComponent(id)}${opz.genera ? "&genera=1" : ""}${opz.pro ? "&pro=1" : ""}${opz.auto ? "&auto=1" : ""}${opz.savedOnly ? "&savedOnly=1" : ""}${opz.rifai ? "&rifai=1" : ""}`,
      opz.genera ? { method: "POST" } : undefined,
    ),
  formaGol: (id: string) => netlifyReq<{ forma: FormaGol | null }>(`/forma-gol?matchId=${encodeURIComponent(id)}`),
  predict: (id: string, force?: boolean) =>
    netlifyReq<Prediction>(`/ai-predict?matchId=${encodeURIComponent(id)}${force ? "&force=true" : ""}`, { method: "POST" }),
  setResult: (id: string, result: string) =>
    netlifyReq<{ ok: boolean; learning?: { applied: boolean; main_prediction?: string; result_ok?: boolean } }>(`/match-result`, {
      method: "POST",
      body: JSON.stringify({ matchId: id, result }),
    }),
  bulkResults: (items: { id: string; result: string }[]) =>
    netlifyReq<{ updated: number; learnings?: any[] }>(`/results-bulk`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  // FASE 0 — registra il verdetto finale della fusione, che prima viveva solo
  // nel browser. Serve sia a ritrovare il pick riaprendo la partita, sia a
  // misurare la precisione della fusione a risultato inserito.
  saveVerdict: (matchId: string, market: string, prob?: number) =>
    netlifyReq<{ ok: boolean }>(`/save-verdict`, {
      method: "POST",
      body: JSON.stringify({ matchId, market, prob }),
    }),
  // 18/09/2026 — multipla automatica (vedi netlify/functions/build-multipla.ts).
  // Il motore sceglie N partite del giorno con la giocata piu' probabile
  // ciascuna, fino alla quota totale minima, campionati a scalare (1 -> 2 -> 3).
  buildMultipla: (body: MultiplaRequest) =>
    netlifyReq<MultiplaResponse>(`/build-multipla`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  statsScores: () => netlifyReq<Record<string, any[]>>("/stats-scores"),
  statsReset: () => netlifyReq<{ ok: boolean }>("/stats-reset", { method: "POST" }),
  updateSelection: (ids: string[], selected: boolean) =>
    netlifyReq<{ ok: boolean }>(`/selection-update`, {
      method: "POST",
      body: JSON.stringify({ ids, selected }),
    }),
  selectedList: () => netlifyReq<Match[]>("/selected-list"),
  clearSelection: () => netlifyReq<{ ok: boolean }>(`/selection-clear`, { method: "POST" }),
  exportDb: () => netlifyReq<any>("/export-db"),
  importDb: (payload: any) =>
    netlifyReq<any>(`/import-db`, { method: "POST", body: JSON.stringify(payload) }),
  deleteAll: () => netlifyReq<{ ok: boolean }>(`/delete-all`, { method: "DELETE" }),
  aiStudioPrompt: () => netlifyReq<{ csv: string; count: number }>(`/aistudio-prompt`),
  getLlmSettings: () => netlifyReq<{ options: any[]; selected_id: string; selected: any;
    openrouter: { configurato: boolean; economico: boolean;
      credito: { caricato: number; usato: number; residuo: number; gratis_oggi: { used: number; limit: number; remaining: number } | null } | null } }>("/llm-settings"),
  /** Tutti i modelli OpenRouter dal vivo, gia' ordinati dal piu' economico (06/10/2026). */
  getCatalogoOpenRouter: () => netlifyReq<{ modelli: { id: string; nome: string; gratis: boolean; strumenti: boolean;
    contesto: number | null; in_m: number | null; out_m: number | null; costo: number | null }[] }>("/llm-settings?catalogo=openrouter"),
  setOpenRouterEconomico: (economico: boolean) => netlifyReq<{ ok: boolean }>("/llm-settings", { method: "POST", body: JSON.stringify({ economico }) }),
  setLlmSettings: (id: string) => netlifyReq<{ ok: boolean; selected_id: string }>("/llm-settings", { method: "POST", body: JSON.stringify({ id }) }),
  getBudget: () => netlifyReq<{ estimated_spent_usd: number; predictions_made: number; current_model: string; cost_per_prediction_usd: number; topup_url: string;
    tavily: { usati: number; limite: number | null; piano: string; tetto: number } | null }>("/budget"),
  resetBudget: () => netlifyReq<{ ok: boolean }>("/budget?reset=true", { method: "POST" }),
  marketStats: () => netlifyReq<{ markets: { family: string; market: string; wins: number; losses: number; total: number; missed: number; family_total: number; miss_rate: number; win_rate: number }[]; family_totals: Record<string, number> }>("/ml-stats"),
  fetchResultsAuto: (ids: string[], apply = true, apply_threshold = 80) => netlifyReq<{ results: any[]; applied: number; not_found: number; skipped: number }>("/results-fetch", { method: "POST", body: JSON.stringify({ ids, apply, apply_threshold }) }),
  applyResultManual: (id: string, score: string) => netlifyReq<{ ok: boolean; result: string }>("/results-apply", { method: "POST", body: JSON.stringify({ id, score }) }),
  matchCandidates: (id: string) => netlifyReq<{ candidates: { market: string; family: string; missed: number; family_total: number; miss_rate: number }[]; family: string | null; family_total: number }>(`/match-candidates?id=${encodeURIComponent(id)}`),
  matchHistory: (id: string) => netlifyReq<MatchHistory>(`/match-history?id=${encodeURIComponent(id)}`),
  matchStructural: (id: string, minOdd?: number) =>
    netlifyReq<StructuralAnalysis>(
      `/predict?matchId=${encodeURIComponent(id)}${minOdd ? `&minOdd=${minOdd}` : ""}`,
    ),
  // FASE 2 — soglia di quota minima scelta dall'utente
  getMinOdd: () => netlifyReq<{ min_odd: number; options: number[] }>("/odd-settings"),
  setMinOdd: (minOdd: number) =>
    netlifyReq<{ ok: boolean; min_odd: number }>("/odd-settings", {
      method: "POST",
      body: JSON.stringify({ min_odd: minOdd }),
    }),
  uploadExcel: async (uri: string, name: string, mimeType?: string) => {
    const form = new FormData();
    if (typeof window !== "undefined" && uri.startsWith("blob:")) {
      // Web: fetch the blob URL and append as Blob
      const r = await fetch(uri);
      const blob = await r.blob();
      form.append("file", blob, name);
    } else if (typeof window !== "undefined" && uri.startsWith("data:")) {
      // Web data: URI
      const r = await fetch(uri);
      const blob = await r.blob();
      form.append("file", blob, name);
    } else {
      // Native (iOS/Android): use uri reference
      // @ts-ignore - RN FormData file shape
      form.append("file", { uri, name, type: mimeType || "application/octet-stream" });
    }
    const res = await fetch(`/upload-excel`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<{ inserted: number; updated: number; unchanged?: number; skipped: number; total_parsed: number; rows_seen?: number }>;
  },
  uploadSkipped: () => netlifyReq<UploadSkippedReport>(`/upload-skipped`),
  quotePcStato: () => netlifyReq<{ ok: boolean } & QuotePcStato>("/quote-pc"),
  /** Non usa netlifyReq: il 409 "server spento" porta un messaggio da mostrare
   *  cosi' com'e', non un errore tecnico. */
  quotePcAvvia: async (): Promise<{ ok: true; richiesta: QuotePcRichiesta } | { ok: false; spento: boolean; error: string }> => {
    const res = await fetch("/quote-pc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ azione: "avvia" }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.richiesta) return { ok: true, richiesta: j.richiesta };
    return { ok: false, spento: !!j?.spento, error: j?.error || `Errore ${res.status}` };
  },
};

export type SkippedRow = {
  row: number;
  time?: string;
  sq1?: string;
  sq2?: string;
  manif?: string;
  reason: string;
  odds_read?: Partial<Record<OddsKey, number>>;
  missing?: OddsKey[];
};

export type UploadSkippedReport = {
  filename: string | null;
  uploaded_at: string | null;
  rows_seen: number;
  valid_matches: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped_count: number;
  skipped: SkippedRow[];
};

export const ODD_LABELS: Record<OddsKey, string> = {
  odd_1: "1",
  odd_X: "X",
  odd_2: "2",
  odd_1X: "1X",
  odd_X2: "X2",
  odd_12: "12",
  odd_U15: "U1.5",
  odd_O15: "O1.5",
  odd_U25: "U2.5",
  odd_O25: "O2.5",
  odd_U35: "U3.5",
  odd_O35: "O3.5",
  odd_GG: "GG",
  odd_NG: "NG",
};

export const MARKET_FAMILIES: { name: string; keys: OddsKey[] }[] = [
  { name: "Esito Finale", keys: ["odd_1", "odd_X", "odd_2"] },
  { name: "Doppia Chance", keys: ["odd_1X", "odd_X2", "odd_12"] },
  { name: "Under/Over 1.5", keys: ["odd_U15", "odd_O15"] },
  { name: "Under/Over 2.5", keys: ["odd_U25", "odd_O25"] },
  { name: "Under/Over 3.5", keys: ["odd_U35", "odd_O35"] },
  { name: "Goal/NoGoal", keys: ["odd_GG", "odd_NG"] },
];

export type Candidate = { market: string; odd: number; family: string };

/**
 * Generate a FAMILY of pre-prediction candidates (multiple markets, not just one),
 * applying the rules:
 *  - "1" valido solo se odd_1 ≤ 1.85
 *  - "2" valido solo se odd_2 ≤ 1.85
 *  - "X"/"1X"/"X2"/"12" disponibili solo se almeno una tra 1 e 2 è ≤ 1.85 (favorita esistente)
 *  - Mercati con quota < 1.40 vengono ESCLUSI (non credibili / payout troppo basso)
 *  - Mercati con quota > 2.00 considerati "poco credibili" e ricevono priorità minore
 */
export function quickPredictionFamily(odds: Odds): Candidate[] {
  const o = odds || {};
  const get = (k: OddsKey, def = Infinity) => (o[k] ?? def) as number;
  const o1 = get("odd_1"), o2 = get("odd_2");
  const o1X = get("odd_1X"), oX2 = get("odd_X2"), o12 = get("odd_12");
  const oO15 = get("odd_O15");
  const oO25 = get("odd_O25"), oU25 = get("odd_U25");
  const oO35 = get("odd_O35"), oU35 = get("odd_U35");
  const oGG = get("odd_GG"), oNG = get("odd_NG");

  const out: Candidate[] = [];
  const push = (market: string, odd: number, family: string) => {
    if (!isFinite(odd)) return;
    // Filtro: scarta quote < 1.40 (non credibili come puntata)
    if (odd < 1.40) return;
    // Evita duplicati
    if (out.find((c) => c.market === market)) return;
    out.push({ market, odd, family });
  };

  // ============================================================
  // 1X2 family — applichiamo la regola 1.85
  // ============================================================
  const oneValid = o1 <= 1.85;
  const twoValid = o2 <= 1.85;
  const hasFavorita = oneValid || twoValid; // se nessuna favorita, blocco tutto 1X2

  if (oneValid) push("1", o1, "DOMINANZA");
  if (twoValid) push("2", o2, "DOMINANZA");
  if (hasFavorita) {
    if (oneValid && o1X <= 1.60) push("1X", o1X, "DOMINANZA_TETTO");
    if (twoValid && oX2 <= 1.60) push("X2", oX2, "DOMINANZA_TETTO");
    if (o12 <= 1.40) push("12", o12, "ANTI_X"); // raro, solo equilibri
  }

  // ============================================================
  // GOL family
  // ============================================================
  // RANGE_CONTROLLATO: pavimento + tetto
  if (oO15 <= 1.40 && oU35 <= 1.40) {
    push("MG 2-4 totali", Math.max(1.40, (oO15 + oU35) / 2), "RANGE_CONTROLLATO");
  }
  // NOTE: "GG + O1.5" rimosso perché ridondante: GG ⇒ O1.5 (entrambe segnano ≥1 → totale ≥2)
  // O2.5 secco
  if (oO25 <= 1.85) push("O2.5", oO25, "OFFENSIVA");
  // GG secco
  if (oGG <= 1.85) push("GG", oGG, "OFFENSIVA");
  // O1.5
  if (oO15 <= 1.50) push("O1.5", oO15, "RANGE_CONTROLLATO");
  // O3.5 alto-rendimento
  if (oO35 <= 1.85) push("O3.5", oO35, "OFFENSIVA_PULITA");

  // ============================================================
  // UNDER / NoGoal family
  // ============================================================
  if (oU25 <= 1.85) push("U2.5", oU25, "CHIUSA_PROTETTA");
  if (oU35 <= 1.40) push("U3.5", oU35, "CHIUSA_PROTETTA");
  if (oNG <= 1.85) push("NG", oNG, "CHIUSA_PROTETTA");

  // ============================================================
  // DC + OVER/UNDER combos quando applicabili
  // ============================================================
  if (hasFavorita) {
    if (oneValid && oO15 <= 1.50) push("DC 1X + O1.5", Math.max(o1X, oO15), "DOMINANZA_GOL");
    if (twoValid && oO15 <= 1.50) push("DC X2 + O1.5", Math.max(oX2, oO15), "DOMINANZA_GOL");
    if (oneValid && oU35 <= 1.40) push("DC 1X + U3.5", Math.max(o1X, oU35), "DOMINANZA_TETTO");
    if (twoValid && oU35 <= 1.40) push("DC X2 + U3.5", Math.max(oX2, oU35), "DOMINANZA_TETTO");
  }

  // Ordinamento default: dalla quota più bassa (più sicura) alla più alta
  out.sort((a, b) => a.odd - b.odd);
  // NG, U1.5 e U2.5 non li gioca e non li giocherà mai (28/09/2026): fuori
  // anche da qui, che è il ripiego quando il server non manda `pre_ranking`.
  const maiGiocati = new Set(["NG", "U1.5", "U2.5"]);
  return out.filter((c) => !maiGiocati.has(String(c.market).trim().toUpperCase().replace(/\s+/g, "")));
}

/**
 * Backward-compatible single-market pre-prediction (returns the TOP candidate).
 */
export function quickPrediction(odds: Odds): Candidate | null {
  const fam = quickPredictionFamily(odds);
  return fam[0] || null;
}

/**
 * Normalize market labels so concordance matching is reliable.
 * "Ov2.5", "Over 2.5", "O2.5" all map to "O2.5"
 */
export function normalizeMarket(m: string): string {
  if (!m) return "";
  return m.trim()
    .replace(/Over\s*/i, "O")
    .replace(/Under\s*/i, "U")
    .replace(/Ov(\d)/i, "O$1")
    .replace(/Un(\d)/i, "U$1")
    .replace(/\bGoal\b/i, "GG")
    .replace(/\bNo\s?Goal\b/i, "NG")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two markets are DISCORDANT (impossible to both win on the same match).
 * Returns true if discordant, false otherwise.
 */
export function areDiscordant(a: string, b: string): boolean {
  const na = normalizeMarket(a);
  const nb = normalizeMarket(b);
  if (na === nb) return false;
  const PAIRS: [RegExp, RegExp][] = [
    [/^1$/, /^2$/], [/^1$/, /^X$/], [/^1$/, /^X2$/],
    [/^2$/, /^X$/], [/^2$/, /^1X$/],
    [/^1X$/, /^X2$/],   // technically both can win if X
    [/^GG$/, /^NG$/],
    [/^O1\.5$/, /^U1\.5$/], [/^O2\.5$/, /^U2\.5$/], [/^O3\.5$/, /^U3\.5$/],
    [/MG 2-4.*CASA/, /MG 2-4.*OSPITE/],
  ];
  for (const [p1, p2] of PAIRS) {
    if ((p1.test(na) && p2.test(nb)) || (p1.test(nb) && p2.test(na))) return true;
  }
  // O ≥ X.5 conflicts with U ≤ X.5 (e.g. O2.5 + U2.5, O3.5 + U2.5)
  const overMatch = /^O(\d\.\d)/.exec(na) || /^O(\d\.\d)/.exec(nb);
  const underMatch = /^U(\d\.\d)/.exec(na) || /^U(\d\.\d)/.exec(nb);
  if (overMatch && underMatch) {
    const oN = parseFloat(overMatch[1]);
    const uN = parseFloat(underMatch[1]);
    if (oN >= uN) return true;
  }
  return false;
}

export type RankedPick = {
  market: string;
  odd: number;
  family: string;
  win_rate: number | null;   // null = no historical data
  total: number;             // sample size
  missed: number;            // missed opportunities (won but not predicted)
  source: "pre+ai" | "pre" | "ai";  // concordance flag
  boost: number;             // score for ranking
  isCandidate: boolean;      // YELLOW prediction: 0 W/L + ≥5 missed, sample reliable
};

const MIN_RELIABLE_SAMPLE = 5;   // win-rate considered usable from this many results
const CANDIDATE_MIN_MISSED = 5;  // yellow flag threshold

/**
 * Build the FINAL ranked list combining pre-pronostic family + LLM markets,
 * with win-rate (when sample is reliable) and concordance BOOST.
 *
 * Rules applied:
 *  - quote < 1.40 → escluso (filtered at family level)
 *  - concordanza pre+AI = boost massimo (+0.30)
 *  - win_rate aggiunge fino a +1.00 (se ≥5 risultati storici)
 *  - quote più "sicure" (1.40-1.85) leggermente favorite
 *  - quote alte (>2.00) penalizzate (-0.15 per ogni unità sopra)
 *  - sample size bias: confidence = wr * (1 - 1/sqrt(total))  → poche valutazioni = meno peso
 */
export function rankPicks(
  preFamily: Candidate[],
  llmMarkets: string[],
  stats: { market: string; win_rate: number; total: number; missed?: number; family: string }[] = [],
): RankedPick[] {
  const norm = (m: string) => normalizeMarket(m);
  const statsByMarket = new Map<string, { rate: number; total: number; missed: number }>();
  const safeStats = Array.isArray(stats) ? stats : [];
  for (const s of safeStats) {
    statsByMarket.set(norm(s.market), { rate: s.win_rate, total: s.total, missed: s.missed || 0 });
  }
  const llmSet = new Set(llmMarkets.map(norm));

  // Build candidates from both sources (union)
  const map = new Map<string, RankedPick>();
  for (const c of preFamily) {
    const k = norm(c.market);
    const st = statsByMarket.get(k);
    const reliable = st && st.total >= MIN_RELIABLE_SAMPLE;
    map.set(k, {
      market: c.market,
      odd: c.odd,
      family: c.family,
      win_rate: reliable ? st!.rate : null,
      total: st?.total || 0,
      missed: st?.missed || 0,
      source: llmSet.has(k) ? "pre+ai" : "pre",
      boost: 0,
      isCandidate: !!st && st.total === 0 && st.missed >= CANDIDATE_MIN_MISSED,
    });
  }
  for (const lm of llmMarkets) {
    const k = norm(lm);
    if (map.has(k)) continue;
    const st = statsByMarket.get(k);
    const reliable = st && st.total >= MIN_RELIABLE_SAMPLE;
    map.set(k, {
      market: lm,
      odd: 0,
      family: "AI_ONLY",
      win_rate: reliable ? st!.rate : null,
      total: st?.total || 0,
      missed: st?.missed || 0,
      source: "ai",
      boost: 0,
      isCandidate: !!st && st.total === 0 && st.missed >= CANDIDATE_MIN_MISSED,
    });
  }

  // Calculate boost score
  const out: RankedPick[] = [];
  for (const p of map.values()) {
    let score = 0;
    // NIENTE bonus per la concordanza con l'IA (era `+= 0.30` quando
    // source === "pre+ai"). Motivo: la fusione conta il pre-pronostico come
    // TERZO parere indipendente, ma con quel bonus la sua classifica veniva
    // riordinata dai mercati proposti dall'IA — cioe' in parte ne era un'eco.
    // Risultato: "CONCORDANZA 2/3 = AI + PRE" contava spesso due volte lo
    // stesso parere. Si vedeva a occhio nudo: su Vasco Da Gama - Mirassol il
    // pick PRE era X2 prima del click sul Pronostico AI e diventava GG dopo,
    // pur non essendo cambiata nessuna quota.
    // L'etichetta "pre+ai" resta, come informazione a schermo: e' solo
    // l'ORDINAMENTO che non deve piu' dipenderne. Il pre-pronostico ora si
    // regge unicamente sulle quote reali del bookmaker e sullo storico —
    // l'unica cosa che sa davvero, e l'unica che il motore Poisson non guarda.
    if (p.win_rate !== null && p.total >= MIN_RELIABLE_SAMPLE) {
      // Sample-size weighted confidence
      const weight = 1 - 1 / Math.sqrt(p.total);
      score += (p.win_rate / 100) * weight;
    }
    // Quote band bonuses/penalties
    if (p.odd > 0) {
      if (p.odd >= 1.40 && p.odd <= 1.85) score += 0.15;      // sweet spot
      else if (p.odd > 1.85 && p.odd < 2.00) score += 0.05;
      else if (p.odd >= 2.00) score -= 0.15 * (p.odd - 1.85); // penalize high odds
    }
    p.boost = score;
    out.push(p);
  }
  // Ordina per boost desc, poi per quota asc (più sicura prima)
  out.sort((a, b) => b.boost - a.boost || (a.odd || 99) - (b.odd || 99));
  return out;
}

/**
 * Pick the FINAL bet from a ranked list, applying:
 *  - "no bet" if top of pre family and top of AI family are DISCORDANT
 *  - cascade: if top has odd < 1.40, descend to next
 */
export function pickFinal(ranked: RankedPick[], aiMarkets: string[] = []): {
  pick: RankedPick | null;
  isNoBet: boolean;
  reason?: string;
} {
  if (ranked.length === 0) return { pick: null, isNoBet: false };

  // Check discordance: top concordant pick vs any AI suggestion
  const topPre = ranked.find((r) => r.source !== "ai");
  const aiList = aiMarkets.length > 0 ? aiMarkets : ranked.filter((r) => r.source !== "pre").map((r) => r.market);
  if (topPre && aiList.length > 0) {
    // If TOP of pre is discordant with TOP of AI → NO BET
    const topAi = ranked.find((r) => r.source !== "pre");
    if (topAi && areDiscordant(topPre.market, topAi.market)) {
      return { pick: null, isNoBet: true, reason: `${topPre.market} vs ${topAi.market} discordanti` };
    }
  }

  // Cascade: skip picks with odd < 1.40 (already filtered) — apply as belt-and-braces
  for (const p of ranked) {
    if (p.odd === 0 || p.odd >= 1.40) return { pick: p, isNoBet: false };
  }
  return { pick: ranked[0], isNoBet: false };
}

// ============================================================
// VERDETTO FINALE — fonde i 3 sistemi (Strutturale, AI, Pre)
// ============================================================
/**
 * Mercati ammessi nel VERDETTO FINALE, decisi da Rossi.
 * Il ranking strutturale continua a mostrarli tutti — serve a capire cosa pensa
 * il motore — ma la giocata consigliata esce solo da qui, perche' e' quello che
 * lui gioca davvero. Fuori per scelta esplicita: tutte le combo con DC 12, i
 * multigol, il segno secco, U1.5 / U2.5 / O3.5.
 * Deve restare allineata a VERDICT_WHITELIST in netlify/functions/lib/clusterEngine.ts.
 */
export const VERDICT_WHITELIST = new Set([
  "1", "2",
  "1x", "x2",
  // NG tolto il 18/09/2026 su decisione di Rossi: non lo gioca. Resta nel
  // ranking strutturale, ma non puo' piu' diventare la giocata.
  "gg",
  "o2.5",
  "mg 2-4 totali", "mg 3-6 totali",
  "mg 2-4 casa", "mg 2-4 ospite",
  "gg + o2.5",
  "dc 1x + o1.5", "dc x2 + o1.5",
  "dc 1x + o2.5", "dc x2 + o2.5",
  "dc 1x + u3.5", "dc x2 + u3.5",
  "dc 1x + gg", "dc x2 + gg",
  // Ticket 6-bis (decisione C di Rossi, 30/09): direzione secca + pochi gol,
  // per i gap tecnici contro un avversario murato. Solo la casa: e' la voce
  // chiesta ("1 fisso + difesa ospite chiusa").
  "1 + u4.5",
  // Mercati dell'incertezza (19/10/2026, Rossi: "nell'incertezza i mercati sono MG casa, MG ospite, MG
  // totali, Under 3,5, X o GG"; Twente-Utrecht: MG 1-3 casa 69% @1,40 scartata perche' fuori elenco).
  "mg 1-3 casa", "mg 1-3 ospite", "u3.5", "x oppure gg",
]);

/**
 * OPPOSTI VERI: mercati che raccontano la partita in modo OPPOSTO, cioe' senza
 * nessun esito in comune. Non devono mai sostituirsi a vicenda solo perche' uno
 * e' sotto soglia, e se sono ravvicinati non c'e' lettura: la famiglia va fuori
 * (famiglieAmbigue).
 *
 * 1X e X2 NON sono qui (Ticket 7, 30/09/2026): si sovrappongono sul pareggio
 * (0-0 e 1-1 le vincono entrambe). Sono CONCORRENTI DI DIREZIONE, una semantica
 * DIVERSA che vive in `_OPPOSITES` (sotto) e in OPPOSTI di clusterEngine.ts:
 * vince la dominante e l'altra si ritira, come il "2" col pick "1". Su
 * Turchia-Italia la coppia qui dentro aveva cancellato ENTRAMBE dal verdetto.
 * Questa tabella NON va riallineata a quelle due: divergono per scelta.
 */
const OPPOSTI: [string, string][] = [
  ["1", "2"], ["1", "x2"], ["2", "1x"],
  ["gg", "ng"],
  ["o2.5", "u2.5"], ["o1.5", "u1.5"], ["o2.5", "ng"],
];

function pezzi(market: string): string[] {
  return market.split("+").map((p) => p.trim().replace(/^dc /i, "").toLowerCase());
}

/** true se `candidato` contraddice la lettura espressa da `direzione`. */
function contraddice(direzione: string, candidato: string): boolean {
  const a = pezzi(direzione), b = pezzi(candidato);
  return a.some((x) => b.some((y) =>
    OPPOSTI.some(([p, q]) => (p === x && q === y) || (q === x && p === y))));
}

/** A quale famiglia appartiene un mercato: esito, gol, oppure totali. */
function famiglia(market: string): "esito" | "gol" | "totali" | null {
  const p = pezzi(market).map((x) => x.toUpperCase());
  if (p.some((x) => ["1", "2", "1X", "X2"].includes(x))) return "esito";
  if (p.some((x) => ["GG", "NG"].includes(x))) return "gol";
  if (p.some((x) => x.startsWith("O") || x.startsWith("U") || x.startsWith("MG"))) return "totali";
  return null;
}

/**
 * Famiglie su cui il motore non ha una lettura: i due mercati OPPOSTI VERI piu'
 * alti sono separati da pochi punti (1 contro 2 entro 5 punti, GG contro NG
 * testa a testa). Si salta la famiglia e si scende dove il motore ha qualcosa da
 * dire. Le doppie chance (X2 65% / 1X 62%, caso Zaglebie - Piast) non rendono
 * piu' ambigua la famiglia esito: sono rivali di direzione, vince la dominante
 * (Ticket 7). Per questo NON e' piu' allineata a famiglieAmbigue di clusterEngine.
 */
function famiglieAmbigue(lista: VerdictPick[], prob: (b: VerdictPick) => number): Set<string> {
  const out = new Set<string>();
  for (const fam of ["esito", "gol", "totali"]) {
    const della = lista.filter((r) => famiglia(r.market) === fam);
    if (della.length < 2) continue;
    const primo = della[0];
    const opposto = della.find((r) => contraddice(primo.market, r.market));
    if (opposto && Math.abs(prob(primo) - prob(opposto)) <= 0.05) out.add(fam);
  }
  return out;
}

/**
 * Mercati tolti dalla whitelist che restano una LETTURA della partita: non si
 * giocano, ma vietano i mercati opposti piu' in basso e rendono ambigua la loro
 * famiglia quando sono appaiati al proprio contrario.
 * Deve restare allineata a VETO_ONLY_MARKETS in clusterEngine.ts.
 */
const VETO_ONLY = new Set(["ng"]);

function isVetoOnly(market: string): boolean {
  return VETO_ONLY.has(market.trim().toLowerCase().replace(/\s{2,}/g, " "));
}

export function isVerdictMarket(market: string): boolean {
  return VERDICT_WHITELIST.has(market.trim().toLowerCase().replace(/\s{2,}/g, " "));
}

export const CANONICAL_VERDICT: Record<string, string> = {
  "1": "1",
  "2": "2",
  "1x": "1X",
  "x2": "X2",
  "gg": "GG",
  "o2.5": "O2.5",
  "mg 2-4 totali": "MG 2-4 totali",
  "mg 3-6 totali": "MG 3-6 totali",
  "mg 2-4 casa": "MG 2-4 casa",
  "mg 2-4 ospite": "MG 2-4 ospite",
  "gg + o2.5": "GG + O2.5",
  "dc 1x + o1.5": "DC 1X + O1.5",
  "dc x2 + o1.5": "DC X2 + O1.5",
  "dc 1x + o2.5": "DC 1X + O2.5",
  "dc x2 + o2.5": "DC X2 + O2.5",
  "dc 1x + u3.5": "DC 1X + U3.5",
  "dc x2 + u3.5": "DC X2 + U3.5",
  "dc 1x + gg": "DC 1X + GG",
  "dc x2 + gg": "DC X2 + GG",
  "1 + u4.5": "1 + U4.5",
};

/**
 * Mercati vietati SEMPRE (per numeri, AI e alternative).
 * Decisione dell'utente (10/10/2026): SOLO le combo segno secco 1/2 + Over
 * (1 + O1.5, 2 + O2.5, 1 + O3.5...), sostituite da MG 2-4 casa / ospite.
 * Tutto il resto resta come prima (Rossi: "non doveva cambiare niente del
 * resto, andava bene"): DC 12, U2.5, U3.5, i multigol del catalogo ecc.
 */
export const MERCATI_VIETATI = new Set<string>([]);

export function isMercatoVietato(market: string | null | undefined): boolean {
  if (!market || !market.trim()) return true;
  const m = market.trim().toLowerCase().replace(/\s+/g, " ");

  if (MERCATI_VIETATI.has(m)) return true;

  // 12 + Over (es. "DC 12 + O1.5", "12 + O2.5"): mai giocata (19/10/2026, Rossi: "12 + Over 1,5 non la
  // giochero' mai"); ne' giocata ne' opzione sulla scheda.
  if (/^(?:dc\s+)?12\s*\+\s*(?:over|ov|o)\s*\d/i.test(m)) return true;

  // Combo segno secco 1 o 2 + Over (es. "1 + O1.5", "2 + Over 2.5", ecc.)
  if (/^(?:1|2)\s*\+\s*(?:over|ov|o)\s*(?:1[.,]5|2[.,]5|3[.,]5)(?:\s*totali)?$/i.test(m)) {
    return true;
  }

  return false;
}

/**
 * Un mercato puo' essere consigliato (numeri) o alternativa se:
 * - e' nella whitelist OPPURE e' tra i mercati del manuale di quello scenario (manuali / nota.markets),
 * - MA MAI se e' vietato (isMercatoVietato).
 */
export function isMercatoAmmesso(
  market: string | null | undefined,
  manuali?: string[] | null
): boolean {
  if (!market || isMercatoVietato(market)) return false;
  if (isVerdictMarket(market)) return true;
  if (manuali && manuali.some((m) => normalizeMarket(m) === normalizeMarket(market))) {
    return true;
  }
  return false;
}

/**
 * Traduzione delle combo vietate proposte dall'AI PRIMA della validazione (decisione utente):
 * - "1 + O1.5", "1 + O2.5", "1 + O3.5" (in qualunque scrittura Over/Ov/O) -> "MG 2-4 casa"
 * - "2 + O1.5/O2.5/O3.5" -> "MG 2-4 ospite"
 * Se il primo mercato è una combo 1/2+Over traducibile e il resto è solo un'alternativa tra parentesi
 * (es. "1 + Over 1.5 (o GG)"), usa la traduzione del primo.
 * Registra da cosa è stata tradotta (tradottoDa).
 */
export function traduciMercatoAI(raw: string | null | undefined): { mercato: string; tradottoDa?: string } | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();

  // Se c'è un'alternativa tra parentesi tipo "(o GG)", "(o ...)", "(oppure ...)"
  let primo = t;
  const mParen = t.match(/^([^(]+?)\s*\(\s*(?:o|oppure)\b[^)]*\)$/i);
  if (mParen) {
    primo = mParen[1].trim();
  }

  // Combo 1 / 2 + Over 1.5 / 2.5 / 3.5 (supporta Over, Ov, O, spaziature, virgola o punto)
  if (/^1\s*\+\s*(?:Over|Ov|O)\s*(?:1[.,]5|2[.,]5|3[.,]5)(?:\s*totali)?$/i.test(primo)) {
    return { mercato: "MG 2-4 casa", tradottoDa: t };
  }
  if (/^2\s*\+\s*(?:Over|Ov|O)\s*(?:1[.,]5|2[.,]5|3[.,]5)(?:\s*totali)?$/i.test(primo)) {
    return { mercato: "MG 2-4 ospite", tradottoDa: t };
  }

  return { mercato: t };
}

/**
 * Normalizza varianti di testo dei mercati AI prima del confronto:
 * "Over 1.5" -> "O1.5", "1X + Over 1.5" -> "DC 1X + O1.5", ecc.
 */
export function normalizzaMercatoAI(mercato: string | null | undefined): string {
  if (!mercato) return "";
  let m = mercato.trim()
    .replace(/Over\s*/gi, "O")
    .replace(/Under\s*/gi, "U")
    .replace(/Ov(\d)/gi, "O$1")
    .replace(/Un(\d)/gi, "U$1")
    .replace(/\bGoal\b/gi, "GG")
    .replace(/\bNo\s?Goal\b/gi, "NG")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(1X|X2|12)\s*\+/i.test(m) && !/^DC\s+/i.test(m)) {
    m = `DC ${m}`;
  }
  return m;
}

export type EsitoMercatoAI = {
  ok: boolean;
  market: string | null;
  quota: number | null;
  stimata: boolean;
  motivo: "non ammesso" | "senza quota" | "fuori scala" | "contro i risultati" | `esclusa dalle regole: ${string}` | null;
  tradotto_da?: string | null;
};

/**
 * Validazione rigida della proposta del Pronostico AI per il Consigliato.
 * L'AI puo' cambiare il consigliato SOLO se il suo mercato:
 *  1. e' un mercato singolo (senza "oppure", "(o ...)", doppi mercati,
 *     oppure combo 1/2+Over traducibile con alternativa tra parentesi);
 *  2. e' presente nella VERDICT_WHITELIST (o tradotto in un mercato in whitelist)
 *     OPPURE e' tra i mercati del manuale di quello scenario, MA MAI se vietato;
 *  3. ha una quota vera reperibile nel catalogo o nell'analisi (anche quota stimata se prevista);
 *  4. e' dentro la scala ammessa (quota >= 1.40 e fasciaDellaQuota(quota) != null).
 * Altrimenti viene scartata col motivo appropriato ("non ammesso", "senza quota", "fuori scala").
 */
export function mercatoAIValido(
  mercato: string | null | undefined,
  analisiOrCatalogo: AnalisiGiocate | Record<string, { odd: number; estimated?: boolean; stimata?: boolean }> | RigaGiocata[] | null | undefined,
  manuali?: string[] | null,
  /** risultati_probabili della lettura AI: la giocata non deve perdere con nessuno */
  risultati?: string[] | null,
): EsitoMercatoAI {
  if (!mercato || !mercato.trim()) {
    return { ok: false, market: null, quota: null, stimata: false, motivo: "non ammesso" };
  }
  const raw = mercato.trim();
  const trad = traduciMercatoAI(raw);
  if (!trad) {
    return { ok: false, market: null, quota: null, stimata: false, motivo: "non ammesso" };
  }

  // Testo con "oppure", "(o ...)", o combinazioni disgiuntive/multiple:
  // Se non e' una combo traducibile con alternativa tra parentesi e non e' il mercato "X oppure GG", resta scartato
  const eMercatoXoGG = /^x\s+(?:oppure|o)\s+gg$/i.test(trad.mercato);
  if (!trad.tradottoDa && !eMercatoXoGG) {
    if (/\boppure\b/i.test(raw) || /\(\s*o\b/i.test(raw) || /\(\s*oppure\b/i.test(raw) || /\s+o\s+/i.test(raw) || /[\/;]/.test(raw)) {
      return { ok: false, market: null, quota: null, stimata: false, motivo: "non ammesso" };
    }
  }

  const norm = normalizzaMercatoAI(trad.mercato);
  const key = norm.toLowerCase().replace(/\s{2,}/g, " ");

  // Controllo mercati vietati sempre (sia su norm che su trad.mercato)
  if (isMercatoVietato(norm) || isMercatoVietato(trad.mercato)) {
    return { ok: false, market: null, quota: null, stimata: false, motivo: "non ammesso" };
  }

  // Manuali dello scenario ricavati da parametro o da analisiOrCatalogo.manuali
  const manualiLista = manuali ?? (analisiOrCatalogo && "manuali" in analisiOrCatalogo ? (analisiOrCatalogo as any).manuali : undefined);

  // Ammissibilita': in whitelist OPPURE nel manuale dello scenario, MA MAI se vietato
  if (!isMercatoAmmesso(norm, manualiLista) && !isMercatoAmmesso(trad.mercato, manualiLista)) {
    return { ok: false, market: null, quota: null, stimata: false, motivo: "non ammesso" };
  }

  const canonico = CANONICAL_VERDICT[key] || norm || trad.mercato;

  // Ricerca della quota nel catalogo o nell'analisi
  let quota: number | null = null;
  let stimata = false;
  let marketTrovato: string | null = null;

  if (analisiOrCatalogo) {
    const cercaInRiga = (x: { market: string; quota?: number; odd?: number; stimata?: boolean; estimated?: boolean }) => {
      const nm = normalizeMarket(x.market);
      return nm === normalizeMarket(canonico) || nm === normalizeMarket(norm) || nm === normalizeMarket(trad.mercato);
    };

    if ("righe" in analisiOrCatalogo && Array.isArray((analisiOrCatalogo as AnalisiGiocate).righe)) {
      const r = (analisiOrCatalogo as AnalisiGiocate).righe.find(cercaInRiga);
      if (r && r.quota != null && r.quota > 0) {
        quota = r.quota;
        stimata = !!r.stimata;
        marketTrovato = r.market;
      }
    } else if (Array.isArray(analisiOrCatalogo)) {
      const r = (analisiOrCatalogo as any[]).find(cercaInRiga);
      if (r && (r.quota ?? r.odd) != null && (r.quota ?? r.odd) > 0) {
        quota = r.quota ?? r.odd;
        stimata = !!(r.stimata ?? r.estimated);
        marketTrovato = r.market;
      }
    } else if (typeof analisiOrCatalogo === "object") {
      const direct = (analisiOrCatalogo as Record<string, any>)[canonico]
        || (analisiOrCatalogo as Record<string, any>)[norm]
        || (analisiOrCatalogo as Record<string, any>)[trad.mercato];
      if (direct && (direct.odd ?? direct.quota) != null && (direct.odd ?? direct.quota) > 0) {
        quota = direct.odd ?? direct.quota;
        stimata = !!(direct.estimated ?? direct.stimata);
        marketTrovato = canonico;
      } else {
        for (const [k, v] of Object.entries(analisiOrCatalogo as Record<string, any>)) {
          if (
            normalizeMarket(k) === normalizeMarket(canonico) ||
            normalizeMarket(k) === normalizeMarket(norm) ||
            normalizeMarket(k) === normalizeMarket(trad.mercato)
          ) {
            if (v && (v.odd ?? v.quota) != null && (v.odd ?? v.quota) > 0) {
              quota = v.odd ?? v.quota;
              stimata = !!(v.estimated ?? v.stimata);
              marketTrovato = k;
              break;
            }
          }
        }
      }
    }
  }

  if (quota === null || quota === undefined || !isFinite(quota) || quota <= 1.0) {
    return { ok: false, market: null, quota: null, stimata: false, motivo: "senza quota", tradotto_da: trad.tradottoDa || null };
  }

  // Coerenza con la stessa lettura dell'AI (13/10/2026, Viking-Bayern: U3.5
  // con 1-3 fra i suoi risultati probabili). Prima della scala: un'AI che si
  // contraddice non deve guidare neanche la salita, la proposta si scarta.
  const marketFinale = marketTrovato || canonico;
  if (controRisultatiAI(marketFinale, risultati)) {
    return { ok: false, market: null, quota, stimata, motivo: "contro i risultati", tradotto_da: trad.tradottoDa || null };
  }

  // Scala: quota da 1.40 a QUOTA_MAX_AI e fasciaDellaQuota(quota) != null.
  // Tetto (13/10/2026, Champions): l'AI portava 1 @1,95 e DC X2 + U3.5 @2,57.
  if (quota < 1.40 || quota > QUOTA_MAX_AI + 1e-9 || fasciaDellaQuota(quota) === null) {
    return { ok: false, market: null, quota, stimata, motivo: "fuori scala", tradotto_da: trad.tradottoDa || null };
  }

  return { ok: true, market: marketFinale, quota, stimata, motivo: null, tradotto_da: trad.tradottoDa || null };
}

/** Quota massima con cui il Pronostico AI puo' cambiare il consigliato
 *  (13/10/2026): oltre si sale alla giocata piu' solida coerente. 1,85 e' gia'
 *  il limite alto della zona preferita nel punteggio dei pick. */
export const QUOTA_MAX_AI = 1.85;

/** La giocata perde con almeno uno dei risultati probabili dati dall'AI? */
export function controRisultatiAI(market: string, risultati?: string[] | null): boolean {
  if (!risultati?.length) return false;
  return risultati.some((r) => /^\s*\d+\s*-\s*\d+\s*$/.test(r) && evaluateMarketOutcome(market, r.replace(/\s/g, "")) === false);
}

/** Esiti 1/X/2 coperti dal segno di una giocata ("DC 1X + O1.5" -> 1,X);
 *  null se la giocata non ha segno (solo gol). */
export function esitiDelSegno(market: string): Set<string> | null {
  const m = market.trim().toUpperCase().replace(/^DC\s+/, "");
  const r = /^(1X|X2|12|1|X|2)(?=\s|$|\+)/.exec(m);
  if (!r) return null;
  return new Set(r[1].split(""));
}

export type VerdictSource = "structural" | "ai" | "pre";

export type VerdictPick = {
  market: string;
  score: number;
  sources: VerdictSource[];     // sistemi in cui appare
  ranks: Partial<Record<VerdictSource, number>>; // posizione nel rispettivo top-N
  odd?: number;                  // se reperibile da pre-pronostico o quote
  oddEstimated?: boolean;        // true se la quota è stimata dal motore (mercati senza prezzo, es. multigol)
  coverage?: number;             // dal motore strutturale
  fragility?: number;            // dal motore strutturale
  family?: string;
  concordance: number;           // numero di sistemi in cui appare (1-3)
  agreementLabel: "piena" | "forte" | "parziale" | "divergente";
  vetoed?: boolean;              // true se il motore strutturale ha posto veto
  ambiguousPair?: boolean;       // true se questo pick forma una coppia opposta ravvicinata col #1/#2 (es. GG vs NG testa a testa)
  /** Da dove viene ogni punto del punteggio, nell'ordine in cui e' stato
   *  assegnato. Alimenta il riquadro "perche' questo pick" nel dettaglio
   *  partita: il verdetto nasce da una somma di undici correttivi, e senza
   *  questa traccia non e' ricostruibile guardando lo schermo. */
  dettaglio?: { voce: string; punti: number }[];
  /** "ai" = verdetto dalla classifica AI per fascia (niente punteggio di fusione) */
  origine?: "ai" | "fusione";
};

const SRC_WEIGHTS: Record<VerdictSource, { top: number; decay: number; bonus: number }> = {
  structural: { top: 10, decay: 1.6, bonus: 1.5 }, // motore matematico = priorità
  ai:         { top: 8,  decay: 1.4, bonus: 1.2 }, // AI semantica = supporto
  pre:        { top: 5,  decay: 0.7, bonus: 0.6 }, // euristica locale = filtro debole
};

const MIN_VALUE_ODD = 1.40; // sotto 1.40 il pick è solo rischio, niente valore

const MARKET_TO_ODD_KEY: Record<string, string> = {
  "1": "odd_1", "X": "odd_X", "2": "odd_2",
  "1X": "odd_1X", "X2": "odd_X2", "12": "odd_12",
  "U1.5": "odd_U15", "O1.5": "odd_O15",
  "U2.5": "odd_U25", "O2.5": "odd_O25",
  "U3.5": "odd_U35", "O3.5": "odd_O35",
  "GG": "odd_GG", "NG": "odd_NG",
};

/** Ritorna la quota canonica per un mercato dato (anche DC combo o "X + Y"). undefined se non derivabile. */
export function getMarketOdd(market: string, odds: any): number | undefined {
  if (!market || !odds) return undefined;
  const m = market.trim().toUpperCase().replace(/\s+/g, "");
  const direct = MARKET_TO_ODD_KEY[m];
  if (direct && typeof odds[direct] === "number" && odds[direct] > 0) return odds[direct];
  // Combo X + Y  (es. "DC 1X + U3.5", "2 + O1.5", "1 + O1.5")
  if (m.includes("+")) {
    const rest = market.replace(/^dc\s*/i, "").trim();
    const parts = rest.split("+").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) {
      const o1 = getMarketOdd(parts[0], odds);
      const o2 = getMarketOdd(parts[1], odds);
      if (o1 && o2) return Math.round(o1 * o2 * 100) / 100;
    }
  }
  return undefined;
}

export type MatchHistoryStat = { market: string; wins: number; total: number; win_rate: number; missed: number };
export type TeamForm = { matches: number; avg_scored: number; avg_conceded: number } | null;
export type MatchHistory = {
  league: string | null;
  global: Record<string, MatchHistoryStat[]>;
  league_specific: Record<string, MatchHistoryStat[]>;
  team_form?: { home: TeamForm; away: TeamForm };
};

// Numero minimo di partite perché il dato per-campionato sia considerato
// affidabile abbastanza da rifinire quello globale (che invece è sempre
// ben popolato per famiglia, quindi usato come base di default).
const MIN_LEAGUE_SAMPLE = 30;

function getHistoricalRate(
  history: MatchHistory | null | undefined,
  family: string | undefined,
  market: string,
): { rate: number; total: number } | undefined {
  if (!history || !family) return undefined;
  const key = normalizeMarket(market);
  const leagueStats = history.league_specific?.[family];
  const leagueStat = leagueStats?.find((s) => normalizeMarket(s.market) === key);
  if (leagueStat && leagueStat.total >= MIN_LEAGUE_SAMPLE) {
    return { rate: leagueStat.win_rate / 100, total: leagueStat.total };
  }
  const globalStats = history.global?.[family];
  const globalStat = globalStats?.find((s) => normalizeMarket(s.market) === key);
  if (globalStat && globalStat.total > 0) {
    return { rate: globalStat.win_rate / 100, total: globalStat.total };
  }
  return undefined;
}

/** TICKET 4 (spento): sotto questo numero di partite d'archivio la misura del
 *  manuale non entra nel calcolo, comportamento identico a oggi. */
export const ARCHIVIO_N_MIN = 100;
/** Stesso SHRINK della FASE 3 del motore (clusterEngine): k = n / (n + 80). */
const ARCHIVIO_SHRINK = 80;

export function buildFinalVerdict(
  structural: StructuralAnalysis | null,
  preRanked: RankedPick[],
  aiMarkets: { market: string; reasoning?: string }[] | string[] | undefined,
  odds?: any,
  history?: MatchHistory | null,
  options?: {
    minOdd?: number;
    manuale?: CandidatoManuale[];
    /** SOLO per /backtest-fusione (variante "no-concordanza", round 2 TICKET 3):
     *  niente bonus di concordanza nel punteggio. L'app non lo passa mai. */
    senzaConcordanza?: boolean;
    /** Round 2, TICKET 4 — SPENTO: solo /backtest-fusione (variante
     *  "archivio-calcolo") lo passa. Si accende nell'app solo se il backtest
     *  misura un guadagno e il proprietario decide. Vedi ARCHIVIO_N_MIN. */
    archivioNelCalcolo?: boolean;
  },
): VerdictPick[] {
  const minOdd = options?.minOdd ?? MIN_VALUE_ODD;
  // Mercati del manuale ammessi SOLO in questa partita (candidatiManuale).
  const manuale = options?.manuale || [];
  const ammessoQui = (m: string) => isVerdictMarket(m) || manuale.some((c) => normalizeMarket(c.market) === normalizeMarket(m));
  const norm = normalizeMarket;
  type Bucket = {
    market: string;            // canonical display name (first seen)
    score: number;
    sources: Set<VerdictSource>;
    ranks: Partial<Record<VerdictSource, number>>;
    odd?: number;
    coverage?: number;
    fragility?: number;
    family?: string;
    oddEstimated?: boolean;
    /** quanti sistemi potevano esprimersi su questo mercato (2 o 3) */
    eligibleSystems?: number;
    /** Da dove arriva ogni punto del punteggio. Serve al riquadro "perche'
     *  questo pick": senza, il verdetto e' una somma di undici correttivi che
     *  nessuno puo' ricostruire guardando lo schermo. */
    dettaglio: { voce: string; punti: number }[];
  };
  const buckets = new Map<string, Bucket>();

  /** Somma punti e li annota. Un delta zero non viene annotato: la traccia
   *  deve restare leggibile. */
  const punti = (b: Bucket, voce: string, delta: number) => {
    b.score += delta;
    if (Math.abs(delta) >= 0.005) b.dettaglio.push({ voce, punti: Math.round(delta * 100) / 100 });
  };
  /** Moltiplicatore: annotato come la differenza che produce davvero. */
  const fattore = (b: Bucket, voce: string, k: number) => {
    const prima = b.score;
    b.score *= k;
    const delta = b.score - prima;
    if (Math.abs(delta) >= 0.005) b.dettaglio.push({ voce, punti: Math.round(delta * 100) / 100 });
  };

  const ensure = (raw: string): Bucket => {
    const k = norm(raw);
    let b = buckets.get(k);
    if (!b) {
      b = { market: raw, score: 0, sources: new Set(), ranks: {}, dettaglio: [] };
      buckets.set(k, b);
    }
    return b;
  };

  // === Source 1: Structural ranking (top 6) ===
  if (structural?.ranking) {
    structural.ranking.slice(0, 6).forEach((r, i) => {
      const b = ensure(r.market);
      const w = SRC_WEIGHTS.structural;
      punti(b, `motore, ${i + 1}\u00b0 nel ranking`, Math.max(w.top - i * w.decay, 0));
      b.sources.add("structural");
      b.ranks.structural = i + 1;
      b.coverage = r.coverage;
      b.fragility = r.fragility;
    });
  }

  // === Source 2: AI playable markets (top 4) ===
  const aiList: string[] = Array.isArray(aiMarkets)
    ? (aiMarkets as any[]).map((x: any) => (typeof x === "string" ? x : x?.market)).filter(Boolean)
    : [];
  aiList.slice(0, 4).forEach((m, i) => {
    const b = ensure(m);
    const w = SRC_WEIGHTS.ai;
    punti(b, `IA, ${i + 1}\u00b0 fra i mercati proposti`, Math.max(w.top - i * w.decay, 0));
    b.sources.add("ai");
    b.ranks.ai = i + 1;
  });

  // === Source 3: Pre-pronostico rankPicks (top 6) ===
  // `preRanked` contiene anche i mercati proposti SOLO dall'IA (rankPicks li
  // unisce alla lista). Contarli come voto del pre-pronostico significa contare
  // due volte lo stesso parere: e' cosi' che "MG 1-4 totali" e' arrivato a
  // "AI #1 + PRE #1 = concordanza 2/3" pur essendo stato proposto da un sistema
  // solo. Qui li saltiamo: il voto "pre" lo danno solo i mercati che il
  // pre-pronostico ha davvero in classifica per conto suo.
  preRanked.filter((p) => p.source !== "ai").slice(0, 6).forEach((p, i) => {
    const b = ensure(p.market);
    const w = SRC_WEIGHTS.pre;
    punti(b, `pre-pronostico, ${i + 1}\u00b0`, Math.max(w.top - i * w.decay, 0));
    b.sources.add("pre");
    b.ranks.pre = i + 1;
    if (p.odd > 0 && !b.odd) b.odd = p.odd;
    if (!b.family) b.family = p.family;
  });

  // === Compute canonical odds (per bucket) and concordance bonus ===
  // Build "whitelist" of markets approved by the structural engine (Poisson).
  // Any market proposed by AI/PRE but NOT in this list is structurally suspect.
  const structuralWhitelist = new Set<string>();
  if (structural?.ranking) {
    structural.ranking.forEach((r) => structuralWhitelist.add(norm(r.market)));
  }

  // TUTTI i mercati ammessi al verdetto entrano fra i candidati, anche quelli
  // che nessuno dei tre sistemi ha nominato nei suoi primi posti. Prima i
  // candidati erano solo i top-N di ciascun sistema, quindi un mercato come
  // `DC 1X + O2.5` — dodicesimo nel ranking strutturale — non veniva mai
  // considerato: su Colo Colo - Limache a soglia 1,60 la fusione ripiegava su
  // `NG` @2,20 al 48% mentre il motore aveva gia' individuato `DC 1X + O2.5`
  // al 54%, coerente con la lettura della partita.
  if (structural?.ranking) {
    for (const r of structural.ranking) {
      if (!isVerdictMarket(r.market)) continue;
      const k = norm(r.market);
      if (buckets.has(k)) continue;
      // La quota si risolve SUBITO, con tutte le strade disponibili: dalla voce
      // del ranking, dalla mappa completa market_odds, o dalle quote grezze.
      // Se restasse indefinita il mercato verrebbe scartato dal filtro di
      // soglia e il verdetto scivolerebbe piu' in basso — e' cosi' che su
      // Zaglebie - Piast usciva `O2.5` al 45% invece di `MG 2-4 totali` al 60%.
      const daMappa = structural?.market_odds?.[norm(r.market)] || structural?.market_odds?.[r.market];
      const quota = r.odd ?? daMappa?.odd ?? (odds ? getMarketOdd(r.market, odds) : undefined);
      buckets.set(k, {
        market: r.market, score: 0, sources: new Set(), ranks: {}, dettaglio: [],
        coverage: r.coverage, fragility: r.fragility,
        odd: quota ?? undefined,
        oddEstimated: r.odd_estimated ?? daMappa?.estimated ?? false,
      } as any);
    }
  }

  // MERCATI DEL MANUALE (01/10/2026): candidati come gli altri, con la
  // probabilita' misurata in archivio sullo scenario al posto del Poisson.
  /** probabilita' mescolata archivio+motore, per mercato (solo archivioNelCalcolo) */
  const mescolata = new Map<string, number>();
  for (const c of manuale) {
    const b = ensure(c.market);
    const delMotore = structural?.ranking?.find((r) => norm(r.market) === norm(c.market));
    if (options?.archivioNelCalcolo && delMotore && c.valutate >= ARCHIVIO_N_MIN) {
      // TICKET 4: l'archivio ENTRA nel calcolo, mescolato al motore con lo
      // stesso shrinkage della FASE 3 dell'engine: con poche partite vince il
      // modello, con centinaia vince l'archivio.
      const k = c.valutate / (c.valutate + ARCHIVIO_SHRINK);
      const p = k * (c.pct / 100) + (1 - k) * delMotore.coverage;
      b.coverage = p;
      mescolata.set(norm(c.market), p);
      b.dettaglio.push({ voce: `archivio nel calcolo: ${Math.round(p * 1000) / 10}% (motore ${Math.round(delMotore.coverage * 1000) / 10}%, archivio ${c.pct.toFixed(1)}% su ${c.valutate}, peso ${Math.round(k * 100)}%)`, punti: 0 });
    }
    if (b.coverage === undefined) b.coverage = delMotore ? delMotore.coverage : c.pct / 100;
    if (b.fragility === undefined && delMotore) b.fragility = delMotore.fragility;
    if (b.odd === undefined || b.odd === null) { b.odd = c.odd; b.oddEstimated = c.stimata; }
    b.dettaglio.push({ voce: `manuale dello scenario: ${c.pct.toFixed(1).replace(".", ",")}% in archivio (${c.vinte}/${c.valutate})`, punti: 0 });
  }

  // Mercati su cui l'euristica PRE ha potuto esprimersi. Se il backend non
  // manda la lista (versione vecchia), si assume che potesse su tutto: il
  // comportamento torna quello di prima, senza sorprese.
  const preEligible: Set<string> | null = structural?.pre_eligible
    ? new Set(structural.pre_eligible.map((m) => norm(m)))
    : null;

  for (const b of buckets.values()) {
    // PRIMA la mappa del motore, POI la moltiplicazione (round 2, TICKET 7).
    // `getMarketOdd` prezza le combo MOLTIPLICANDO le due quote, giusto solo
    // per eventi indipendenti: "DC 1X" e "O2.5" non lo sono. Prima la
    // moltiplicazione veniva per prima, e una combo della top-6 del motore
    // (che qui arriva senza quota) prendeva il prodotto anche quando
    // `market_odds` aveva la stima congiunta: DC 1X + O2.5 a 1,32 invece di
    // 1,41, e quindi fuori dalla fascia 1,40 senza che nessuno lo vedesse.
    // `market_odds` copre l'intero catalogo, con la quota reale quando il
    // bookmaker la da' (stesso numero di getMarketOdd per i mercati singoli).
    if (b.odd === undefined || b.odd === null) {
      const fromMap = structural?.market_odds?.[norm(b.market)]
        || structural?.market_odds?.[b.market];
      if (fromMap?.odd) {
        b.odd = fromMap.odd;
        b.oddEstimated = !!fromMap.estimated;
      }
    }
    if (odds && (b.odd === undefined || b.odd === null)) {
      const computed = getMarketOdd(b.market, odds);
      if (computed) b.odd = computed;
    }
    // Ultimo ripiego: la quota della voce del ranking (TOP 20).
    if (b.odd === undefined || b.odd === null) {
      const fromEngine = structural?.ranking?.find((r) => norm(r.market) === norm(b.market));
      if (fromEngine?.odd) {
        b.odd = fromEngine.odd;
        b.oddEstimated = !!fromEngine.odd_estimated;
      }
    }
    // La concordanza fra sistemi INDIPENDENTI è il segnale più forte che
    // abbiamo (metodi diversi che arrivano alla stessa conclusione).
    //
    // CORREZIONE: prima si contavano i sistemi che avevano scelto quel
    // mercato, senza chiedersi se gli altri POTEVANO sceglierlo. L'euristica
    // PRE ragiona sulle quote reali del bookmaker, e per i 16 multigol
    // semplici un prezzo non esiste: quei mercati risultavano "poco condivisi"
    // non perché l'euristica li bocciasse, ma perché non aveva modo di
    // esprimersi. Era una penalità sistematica contro i multigol.
    //
    // Ora la concordanza si misura solo fra i sistemi che potevano votare.
    // Unanimità fra tre vale più di unanimità fra due: nel secondo caso i
    // pareri indipendenti sono comunque meno.
    const eligible = eligibleSystemsFor(b.market, preEligible);
    const agree = b.sources.size;
    if (options?.senzaConcordanza) { /* variante di misura: nessun bonus */ }
    else if (agree >= 2 && agree >= eligible) punti(b, `concordanza ${agree}/${eligible} sistemi`, eligible >= 3 ? 8 : 4);
    else if (agree === 2) punti(b, "concordanza 2 sistemi", 2.5);
    b.eligibleSystems = eligible;
  }

  // === Segnale strutturale debole: lieve penalità (non veto) per i mercati
  // che il motore Poisson non ha messo nella sua top-6. Non è più un "rifiuto"
  // (-60%), solo un fattore in meno nel punteggio: i 3 sistemi competono ad
  // armi pari, non c'è più un vincitore garantito a priori.
  const vetoedKeys = new Set<string>();
  if (structural?.ranking && structural.ranking.length > 0) {
    for (const b of buckets.values()) {
      const key = norm(b.market);
      const inStructural = structuralWhitelist.has(key);
      const onlyStructural = b.sources.size === 1 && b.sources.has("structural");
      if (!inStructural && !onlyStructural) {
        fattore(b, "coppia opposta ravvicinata", 0.85); // lieve penalità, non più eliminazione di fatto
        vetoedKeys.add(key);
      }
    }
  }

  // === Contributo strutturale ===
  // Il motore Poisson resta un input autorevole (è l'unico con base matematica
  // sui gol attesi), quindi il suo pick #1 riceve un bonus additivo — ma da
  // solo non deve poter superare una concordanza piena a 3 sistemi indipendenti
  // (vedi bonus concordanza sopra, ora più alto di questo).
  if (structural?.ranking && structural.ranking.length > 0) {
    const top = structural.ranking[0];
    const robust = top.coverage >= 0.60 && top.fragility <= 0.35;
    for (const b of buckets.values()) {
      const rank = b.ranks.structural;
      if (!rank) continue;
      if (rank === 1) {
        punti(b, robust ? "1\u00b0 del motore, cluster solido" : "1\u00b0 del motore", robust ? 3 : 1.5);
      } else if (rank === 2) {
        punti(b, "2\u00b0 del motore", 1);
      } else if (rank === 3) {
        punti(b, "3\u00b0 del motore", 0.5);
      }
    }
  }

  // === CORRETTIVO COVERAGE REALE: verifica di realtà per ogni mercato ===
  // Caso Colorado Springs-Miami FC: AI e PRE concordavano su O2.5 (coverage
  // reale 47%, sotto la metà) contro NG proposto solo dal motore Poisson
  // (coverage 64%). O2.5 vinceva comunque, perché il blocco sopra guarda solo
  // la top-6 del motore strutturale — O2.5 era 7°, quindi la sua coverage non
  // veniva mai controllata da nessuno. Qui recuperiamo la coverage reale per
  // OGNI mercato che il motore ha calcolato (fino al 20° posto, non solo i
  // primi 6) e la usiamo come correttivo indipendente da chi propone il
  // mercato o da quanti sistemi sono d'accordo: sopra il 50% = bonus,
  // sotto il 50% = penalità, proporzionale alla distanza.
  if (structural?.ranking) {
    for (const r of structural.ranking) {
      const b = buckets.get(norm(r.market));
      if (b && b.coverage === undefined) {
        b.coverage = r.coverage;
        b.fragility = r.fragility;
      }
    }
  }
  const COVERAGE_WEIGHT = 30;
  for (const b of buckets.values()) {
    if (b.coverage !== undefined) {
      punti(b, `probabilit\u00e0 reale ${Math.round(b.coverage * 100)}%`, (b.coverage - 0.5) * COVERAGE_WEIGHT);
    }
  }

  // === CORRETTIVO STORICO REALE: divario tra coverage dichiarata e win-rate
  // vero della famiglia ===
  // Caso reale San Jose-Orlando: "1" aveva coverage 78% (motore Poisson),
  // ma lo storico reale di DOMINANZA_OVER dice che "1" vince solo il 48%
  // delle volte — un divario enorme che nessuno controllava. Qui, quando
  // sia la coverage che lo storico sono disponibili per lo stesso mercato,
  // penalizziamo il divario in eccesso oltre una soglia di tolleranza
  // (15 punti — differenze piccole sono normali rumore statistico, non un
  // allarme). Se la coverage promette molto più di quanto lo storico
  // conferma, il pick viene ridimensionato proporzionalmente all'eccesso.
  // Se non c'è coverage (mercato proposto solo da AI/PRE) usiamo lo storico
  // da solo, con un peso più leggero perché è l'unico segnale disponibile.
  const matchFamily = structural?.structure?.family;
  const HIST_GAP_WEIGHT = 45;   // penalità per punto di divario in eccesso
  const HIST_GAP_TOLERANCE = 0.15;
  const HIST_ONLY_WEIGHT = 15;  // più leggero: unico segnale disponibile
  for (const b of buckets.values()) {
    const hist = getHistoricalRate(history, matchFamily, b.market);
    if (!hist) continue;
    if (b.coverage !== undefined) {
      const gap = b.coverage - hist.rate;
      if (gap > HIST_GAP_TOLERANCE) {
        punti(b, `storico ${Math.round(hist.rate * 100)}% su ${hist.total}: promette troppo`, -(gap - HIST_GAP_TOLERANCE) * HIST_GAP_WEIGHT);
      }
    } else {
      punti(b, `storico ${Math.round(hist.rate * 100)}% su ${hist.total}`, (hist.rate - 0.5) * HIST_ONLY_WEIGHT);
    }
  }

  // === Combo ridondanti: penalità se il segno singolo ha già valore da solo ===
  // Una combo "1X + O2.5" ha senso SOLO se il segno secco (1X) è sotto soglia
  // di valore (quota troppo bassa). Se il segno singolo ha già una quota
  // giocabile (≥ minOdd), la combo è ridondante e va proposta come pick
  // principale solo la versione singola.
  for (const b of buckets.values()) {
    if (b.market.includes("+")) {
      const baseSign = b.market.split("+")[0].replace(/^dc\s*/i, "").trim();
      const baseOdd = getMarketOdd(baseSign, odds);
      if (baseOdd !== undefined && inFascia(baseOdd, minOdd)) {
        fattore(b, "combo ridondante: il segno singolo paga gi\u00e0", 0.5);
      }
    }
  }

  // === COERENZA STRUTTURALE: Penalità Under quando pavimento ≥ 2 ===
  // Se il motore Poisson conferma un pavimento ≥ 2 (gol minimi attesi),
  // i mercati Under con soglia troppo bassa sono strutturalmente fragili.
  // Esempio: pavimento=2 + U3.5 → si vince solo per 2 o 3 gol totali,
  // ma con λ_max alto è facile vedere il 3°/4° gol.
  if (structural?.structure) {
    const floor = structural.structure.goal_floor;
    if (floor >= 2) {
      for (const b of buckets.values()) {
        const m = norm(b.market);
        // Match U(N).5 con N <= floor + 1 → soglia troppo vicina al pavimento
        const underMatch = m.match(/^U(\d+(?:\.\d+)?)/);
        if (underMatch) {
          const n = parseFloat(underMatch[1]);
          if (n - floor <= 1.5) {
            // Penalità: -25% allo score
            fattore(b, "Under troppo vicino al pavimento", 0.75);
          }
        }
        // Anche per combo "DC X + U(N).5"
        const comboUnder = m.match(/\+U(\d+(?:\.\d+)?)/);
        if (comboUnder) {
          const n = parseFloat(comboUnder[1]);
          if (n - floor <= 1.5) {
            fattore(b, "combo con Under vicino al pavimento", 0.85); // penalità più lieve sui combo
          }
        }
      }
    }
  }

  // === Build output ===
  const out: VerdictPick[] = Array.from(buckets.values())
    // Filter out picks below value threshold (sotto soglia = solo rischio, niente valore)
    // Solo i mercati che Rossi gioca davvero (vedi VERDICT_WHITELIST), piu'
    // i mercati del manuale candidati in questa partita.
    .filter((b) => ammessoQui(b.market))
    .filter((b) => {
      // Nessun pick senza prezzo. Prima i mercati di cui non si riusciva a
      // determinare la quota passavano il filtro: e' cosi' che "MG 1-4 totali"
      // (quota stimata 1,17, sotto qualsiasi soglia) e' finito come giocata
      // consigliata senza nemmeno una quota accanto. Un pick che non si sa
      // quanto paga non e' giocabile, quindi non deve arrivare a schermo.
      // La soglia NON si applica qui: se togliessimo subito i mercati sotto
      // soglia perderemmo la "direzione" della partita, che e' il mercato piu'
      // probabile a prescindere dal prezzo. La soglia entra dopo, nella
      // selezione finale.
      return b.odd !== undefined && b.odd !== null && b.odd > 0;
    })
    .map((b) => {
      const c = b.sources.size;
      const eligible = b.eligibleSystems ?? 3;
      const agreementLabel: VerdictPick["agreementLabel"] =
        c >= 2 && c >= eligible ? "piena" : c === 2 ? "forte" : c === 1 ? "parziale" : "divergente";
      return {
        market: b.market,
        score: Math.round(b.score * 100) / 100,
        dettaglio: b.dettaglio,
        sources: Array.from(b.sources),
        ranks: b.ranks,
        odd: b.odd,
        oddEstimated: b.oddEstimated,
        coverage: b.coverage,
        fragility: b.fragility,
        family: b.family,
        concordance: c,
        agreementLabel,
        vetoed: vetoedKeys.has(norm(b.market)),
      };
    });
  // ORDINAMENTO FINALE — coerente con il criterio del motore (ordina per
  // probabilita' vera, non per punteggio).
  //
  // Il punteggio della fusione da' bonus in base alla POSIZIONE che un mercato
  // occupa nelle tre classifiche. Ma alzando la soglia di quota si rimuovono i
  // mercati piu' economici e tutti gli altri salgono di posizione, quindi il
  // punteggio cambia anche se la loro probabilita' e' rimasta identica. Da qui
  // l'oscillazione vista su Nacional Potosi - Real Tomayapo: NG a soglia 1,40,
  // GG a 1,50, di nuovo NG a 1,60, senza che nulla fosse cambiato nei mercati.
  // E soprattutto: a 1,40 la fusione sceglieva NG al 50% scavalcando un mercato
  // al 64%, cioe' il contrario dell'obiettivo "massima probabilita' sopra la
  // soglia".
  //
  // Regola: comanda la probabilita'. Il punteggio della fusione (concordanza
  // fra i sistemi compresa) decide solo fra mercati vicini, entro 5 punti di
  // probabilita': li' e' un vero spareggio, non un ribaltamento.
  // ORDINE = quello del ranking strutturale, punto.
  // La regola concordata e' "si scorre il ranking dall'alto e si prende il primo
  // ammesso che paga abbastanza": se qui riordinassimo con criteri nostri,
  // scorreremmo una lista diversa da quella che l'utente vede a schermo.
  // Succedeva su Atletico Ottawa - Pacific: `1` era quarto nel ranking con 63% e
  // quota 1,57, `O2.5` settimo con 59% e 1,52; il vecchio spareggio "entro 5
  // punti vince la quota piu' bassa" faceva vincere O2.5, cioe' il secondo.
  // Lo spareggio sulla quota resta, ma solo a probabilita' DAVVERO pari (entro
  // un punto), che e' il caso GG/NG per cui era nato.
  const posizione = new Map<string, number>();
  structural?.ranking?.forEach((r, i) => posizione.set(norm(r.market), i));
  // Un mercato del manuale fuori dal ranking del motore (AH -0,75) si mette
  // dove lo porta la sua probabilita' d'archivio: subito prima del primo
  // mercato del ranking con copertura piu' bassa.
  for (const c of manuale) {
    const k = norm(c.market);
    // Con l'archivio nel calcolo (TICKET 4, spento) anche un mercato del
    // manuale GIA' nel ranking si sposta dove lo porta la probabilita'
    // mescolata: senza, l'archivio cambierebbe solo un numero e non l'ordine.
    const pm = mescolata.get(k);
    if (posizione.has(k) && pm === undefined) continue;
    const r = (structural?.ranking || []).filter((x) => norm(x.market) !== k);
    const soglia = pm ?? c.pct / 100;
    const i = r.findIndex((x) => x.coverage < soglia);
    const dove = i >= 0 ? (structural?.ranking || []).findIndex((x) => norm(x.market) === norm(r[i].market)) : (structural?.ranking || []).length;
    posizione.set(k, dove - 0.5);
  }
  out.sort((a, b) => {
    const ia = posizione.get(norm(a.market)), ib = posizione.get(norm(b.market));
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return b.score - a.score;
  });


  // === Mercati opposti ravvicinati (es. NG vs GG testa a testa) ===
  // Se il #1 e il #2 sono mercati mutuamente esclusivi con punteggio vicino
  // (entro il 20%), nessuno dei due è un pick affidabile da solo: si passa
  // al primo mercato successivo che non è in conflitto con nessuno dei due.
  // I due mercati ambigui restano visibili in lista, solo marcati.
  if (out.length >= 3) {
    const [first, second] = out;
    if (areMarketsContradictory(first.market, second.market)) {
      const gap = first.score > 0 ? (first.score - second.score) / first.score : 0;
      if (gap < 0.20) {
        const fallbackIdx = out.findIndex((v, i) =>
          i >= 2 &&
          !areMarketsContradictory(v.market, first.market) &&
          !areMarketsContradictory(v.market, second.market),
        );
        if (fallbackIdx !== -1) {
          first.ambiguousPair = true;
          second.ambiguousPair = true;
          const [fallback] = out.splice(fallbackIdx, 1);
          out.unshift(fallback);
        }
      }
    }
  }

  // ============================================================
  // SELEZIONE FINALE — regole decise con Rossi il 27/07/2026
  // ============================================================
  // 1. La direzione della partita e' il mercato ammesso piu' probabile, quota o
  //    non quota: e' la lettura del motore e non si tocca.
  // 2. Se paga abbastanza, e' lui.
  // 3. Altrimenti si prova a RAFFORZARLO con una combo coerente: aggiungere una
  //    condizione alza la quota senza cambiare lettura.
  // 4. Altrimenti si scende, saltando tutto cio' che contraddice la direzione.
  // 5. Se non resta niente si dichiara valore nullo: meglio nessuna giocata che
  //    una giocata contro la propria analisi.
  if (!out.length) return out;
  const probOf = (b: VerdictPick) =>
    b.coverage ?? structural?.ranking?.find((r) => norm(r.market) === norm(b.market))?.coverage ?? 0;
  // I mercati "solo veto" (NG) non sono piu' candidati, ma restano la lettura
  // della partita: entrano nel calcolo delle famiglie ambigue e vietano i
  // mercati opposti che stanno sotto di loro nel ranking. Senza questo, in una
  // partita difensiva il verdetto poteva scivolare su GG appena le alternative
  // finivano sotto soglia.
  const vetoPicks: VerdictPick[] = (structural?.ranking || [])
    .filter((r) => isVetoOnly(r.market))
    .map((r) => ({
      market: r.market, score: 0, sources: [], ranks: {},
      odd: r.odd ?? undefined, coverage: r.coverage,
      concordance: 0, agreementLabel: "divergente",
    }));
  const lettura = [...out, ...vetoPicks].sort((a, b) => probOf(b) - probOf(a));

  const ambigue = famiglieAmbigue(lettura, probOf);
  const leggibili = out.filter((b) => {
    const f = famiglia(b.market);
    return !f || !ambigue.has(f);
  });
  if (!leggibili.length) return [];      // nessuna famiglia leggibile: si sta fuori

  const sopra = (b: VerdictPick) => inFascia(b.odd, minOdd);
  // Un mercato e' valido solo se non contraddice NESSUNO di quelli piu' in alto,
  // non solo la direzione: se un mercato piu' probabile dice il contrario,
  // quello sotto non si gioca. Senza questo, alzando la soglia il pick poteva
  // passare da `NG` a `GG` perche' entrambi erano compatibili con la direzione.
  const vietatoDaVeto = (b: VerdictPick) =>
    vetoPicks.some((v) => probOf(v) > probOf(b) && contraddice(v.market, b.market));
  const coerenti = leggibili.filter(
    (b, i) =>
      !leggibili.slice(0, i).some((sopra) => contraddice(sopra.market, b.market)) &&
      !vietatoDaVeto(b),
  );
  const scelto = coerenti.find(sopra);
  if (!scelto) return [];                    // valore nullo: nessuna giocata
  return [scelto, ...coerenti.filter((b) => sopra(b) && b.market !== scelto.market)];

}

// ============================================================
// WARNING AMICHEVOLE + QUOTA ESTREMA
// ============================================================
// In amichevole le squadre spesso schierano riserve: una quota estrema
// (favorita nettissima) è meno affidabile che nello stesso scenario in
// campionato. Non cambia il pick calcolato, ma avvisa l'utente di
// abbassare la fiducia — è il caso Napoli-Arezzo (quota 1 a 1.16, finita
// 1-3 per l'Arezzo).
// ============================================================
const EXTREME_ODD_THRESHOLD = 1.25;

export function getMatchCautionWarning(
  manifestazione: string | null | undefined,
  odds: Odds | null | undefined,
): string | null {
  if (!manifestazione || !odds) return null;
  const isFriendly = /^AMI\b/i.test(manifestazione.trim());
  if (!isFriendly) return null;
  const o1 = odds.odd_1 ?? 99;
  const o2 = odds.odd_2 ?? 99;
  const minOdd = Math.min(o1, o2);
  if (minOdd < EXTREME_ODD_THRESHOLD) {
    return `Amichevole con favorita nettissima (quota ${minOdd.toFixed(2)}): le squadre spesso schierano riserve, affidabilità del pronostico ridotta rispetto a un campionato ufficiale.`;
  }
  return null;
}

// ============================================================
// VALUTAZIONE MERCATO (vinto/perso) — per colorare i risultati in Schedina
// ============================================================
/**
 * Esito di un mercato dato il risultato. Oltre a vinta/persa conosce i due
 * casi che non sono ne' l'uno ne' l'altro (Ticket 8, mercati del manuale):
 *  - "rimborso": DNB con pareggio (la puntata torna indietro)
 *  - "mezza":    AH -0,75 vinto di un solo gol (meta' vinta, meta' rimborsata)
 * Nelle percentuali questi due casi vanno contati a parte.
 */
export type EsitoMercato = "vinta" | "persa" | "rimborso" | "mezza";

export function esitoMercato(market: string, result: string): EsitoMercato | null {
  const parts = result.split("-").map((n) => parseInt(n.trim(), 10));
  if (parts.length !== 2 || parts.some((n) => isNaN(n))) return null;
  const [home, away] = parts;
  const total = home + away;
  // Virgola decimale ("Over 2,5", "AH -0,75") e "fisso" ("1 fisso" = segno secco).
  const pulito = market.replace(/,/g, ".").replace(/\bfisso\b/i, "").trim();
  const m = pulito.toUpperCase().replace(/\s+/g, "");
  const bool = (v: boolean): EsitoMercato => (v ? "vinta" : "persa");

  // Combo bookmaker "X oppure GG" (fallback equilibrio): vince col pareggio
  // (0-0 compreso) OPPURE se segnano entrambe; perde solo sulle vittorie a
  // rete inviolata. Va riconosciuta prima delle combo con "+".
  if (m === "XOGG" || m === "XOPPUREGG") return bool(home === away || (home > 0 && away > 0));

  if (m.includes("+")) {
    const esiti = pulito.split("+").map((p) => esitoMercato(p.trim(), result));
    if (esiti.some((r) => r === null)) return null;
    if (esiti.some((r) => r === "persa")) return "persa";
    if (esiti.every((r) => r === "vinta")) return "vinta";
    return null;   // combo con rimborsi/mezze: non valutabile in modo netto
  }

  if (m === "1") return bool(home > away);
  if (m === "X") return bool(home === away);
  if (m === "2") return bool(away > home);
  if (m === "1X" || m === "DC1X") return bool(home >= away);
  if (m === "X2" || m === "DCX2") return bool(away >= home);
  if (m === "12" || m === "DC12") return bool(home !== away);

  // DNB: pareggio rimborsato.
  const dnb = m.match(/^([12])DNB$/);
  if (dnb) {
    const d = dnb[1] === "1" ? home - away : away - home;
    return d > 0 ? "vinta" : d === 0 ? "rimborso" : "persa";
  }
  // AH -0,75 sulla favorita: piena con 2+ gol di scarto, mezza con 1.
  const ah = m.match(/^([12])AH-0\.75$/);
  if (ah) {
    const d = ah[1] === "1" ? home - away : away - home;
    return d >= 2 ? "vinta" : d === 1 ? "mezza" : "persa";
  }

  const overMatch = m.match(/^O(?:VER)?(\d+(?:\.\d+)?)/);
  if (overMatch) return bool(total > parseFloat(overMatch[1]));
  const underMatch = m.match(/^U(?:NDER)?(\d+(?:\.\d+)?)/);
  if (underMatch) return bool(total < parseFloat(underMatch[1]));

  if (m === "GG" || m === "BTTS") return bool(home > 0 && away > 0);
  if (m === "NG" || m === "NOBTTS") return bool(home === 0 || away === 0);

  // Multigol generico: "MG 2-4 totali", "MG casa 1-3", "MG 0-2 ospite", "MG 2-4".
  const mg = m.match(/^MG(CASA|OSPITE|TOTALI)?(\d+)-(\d+)(CASA|OSPITE|TOTALI)?$/);
  if (mg) {
    const lato = mg[1] || mg[4] || "TOTALI";
    const gol = lato === "CASA" ? home : lato === "OSPITE" ? away : total;
    return bool(gol >= +mg[2] && gol <= +mg[3]);
  }

  return null;
}

export function evaluateMarketOutcome(market: string, result: string): boolean | null {
  const e = esitoMercato(market, result);
  return e === "vinta" ? true : e === "persa" ? false : null;
}


// ============================================================
// ============================================================
// FILTRO ANTI-CONTRADDIZIONE per ALTERNATIVE CONCORDI
// ============================================================
// Date una giocata principale (PICK) e una lista di alternative, ritorna
// le alternative COERENTI fra loro e col PICK. Una alternativa viene
// scartata se:
//   1. Contraddice il PICK o un'alternativa già accettata
//   2. Viola i vincoli strutturali (floor/ceiling)
//
// Regole di contraddizione:
//   • Esiti opposti: 1↔X, 1↔2, 1↔X2, 2↔X, 2↔1X, 1X↔X2, 1X↔12, X2↔12, X↔12
//   • GG ↔ NG (e qualsiasi combo con GG vs combo con NG)
//   • Any Under ↔ Any Over (direzioni opposte)
//   • MG con range diversi sulla stessa categoria (TOTALI/CASA/OSPITE)
//   • DC + Over ↔ DC + Under (combo direzionali opposte)
//
// Vincoli strutturali:
//   • floor=0 → no MG che parte da 2+ (es. MG 2-4 totali)
//   • ceiling_open → no Under ≤ 3.5 puri o combo
// ============================================================

const _hasUnderRegex = /\bU\d(?:\.\d)?\b|\+\s*U\d(?:\.\d)?/i;
const _hasOverRegex = /\bO\d(?:\.\d)?\b|\+\s*O\d(?:\.\d)?/i;
const _hasGGRegex = /\bGG\b|\+\s*GG/i;
const _hasNGRegex = /\bNG\b|\+\s*NG/i;
const _mgRangeRegex = /MG\s+(\d+)\s*-\s*(\d+)(?:\s+(TOTALI|CASA|OSPITE))?/i;

function _hasUnder(m: string) { return _hasUnderRegex.test(m); }
function _hasOver(m: string) { return _hasOverRegex.test(m); }
function _hasGG(m: string) { return _hasGGRegex.test(m); }
function _hasNG(m: string) { return _hasNGRegex.test(m); }

/**
 * CONCORRENTI DI DIREZIONE (Ticket 7): stesso slot tattico, vince il dominante
 * e l'altro non torna come alternativa (il "2" col pick "1", X2 col pick 1X).
 * Deve restare allineata a OPPOSTI in netlify/functions/lib/clusterEngine.ts
 * (stessa semantica). NON e' la tabella OPPOSTI VERI di famiglieAmbigue.
 */
const _OPPOSITES: [string, string][] = [
  ["1", "X"], ["1", "2"], ["1", "X2"],
  ["2", "X"], ["2", "1X"],
  ["1X", "X2"], ["1X", "12"], ["X2", "12"], ["X", "12"],
  ["GG", "NG"],
  ["O1.5", "U1.5"], ["O2.5", "U2.5"], ["O3.5", "U3.5"],
];

/** Estrae il segno base (1/X/2/1X/X2/12) dal mercato, undefined se non trovato. */
function _extractSign(m: string): string | undefined {
  const norm = m.trim().toUpperCase().replace(/\s+/g, " ");
  // "X oppure GG" non e' il segno X: vince anche con 2-1 o 1-2.
  if (/^X (OPPURE|O) GG$/.test(norm)) return undefined;
  // Mercato secco
  if (/^(1X|X2|12|1|X|2)$/.test(norm.split(" ")[0])) return norm.split(" ")[0];
  // Combo "X + Y" o "DC X + Y"
  const m2 = norm.match(/^(DC\s+)?(1X|X2|12|1|X|2)\s*\+/);
  if (m2) return m2[2];
  return undefined;
}

export function areMarketsContradictory(a: string, b: string): boolean {
  const A = a.trim().toUpperCase();
  const B = b.trim().toUpperCase();
  if (A === B) return false;

  // 1) Opposti diretti (puri)
  for (const [x, y] of _OPPOSITES) {
    if ((A === x && B === y) || (A === y && B === x)) return true;
  }

  // 2) Segni base incompatibili (anche dentro combo)
  const sA = _extractSign(A);
  const sB = _extractSign(B);
  if (sA && sB && sA !== sB) {
    for (const [x, y] of _OPPOSITES.slice(0, 9)) {
      if ((sA === x && sB === y) || (sA === y && sB === x)) return true;
    }
  }

  // 3) Direzioni Under vs Over (qualsiasi soglia → direzioni opposte)
  if (_hasUnder(A) && _hasOver(B)) return true;
  if (_hasOver(A) && _hasUnder(B)) return true;

  // 4) GG vs NG (incluse combo)
  if (_hasGG(A) && _hasNG(B)) return true;
  if (_hasNG(A) && _hasGG(B)) return true;

  // 5) MG con range diversi sulla stessa categoria
  const mA = A.match(_mgRangeRegex);
  const mB = B.match(_mgRangeRegex);
  if (mA && mB) {
    const catA = (mA[3] || "TOTALI").toUpperCase();
    const catB = (mB[3] || "TOTALI").toUpperCase();
    if (catA === catB) {
      const aLo = +mA[1], aHi = +mA[2];
      const bLo = +mB[1], bHi = +mB[2];
      if (aLo !== bLo || aHi !== bHi) return true;
    }
  }

  return false;
}

/** Verifica se un mercato VIOLA i vincoli strutturali (floor/ceiling).
 * Regole STRETTE (richiesta utente):
 *   • MG [lo-hi]: valido solo se `lo ≤ floor + 1` AND (open ? hi ≥ 6 : hi ≥ ceiling)
 *     - es. floor=0,ceiling=3: "MG 2-4" → lo=2 > 1 → INVALIDO
 *     - es. floor=2,ceiling=4: "MG 1-3" → hi=3 < 4 → INVALIDO
 *     - es. floor=2,open=true: "MG 2-4" → ceiling aperto ma hi=4 < 6 → INVALIDO
 *   • U(N.5): valido solo se ceiling chiuso e N == ceiling (es. U3.5 ok con ceiling=3)
 *     - se ceiling_open: tutti gli Under sono invalidi, salvo U3.5/U4.5 col
 *       profilo DIFENSIVA (`underAperti`, Ticket 6-bis)
 *   • O(N.5): valido solo se ceiling > N (es. O3.5 ok solo se tetto ≥ 4 o aperto)
 *     - se floor ≤ N AND ceiling ≤ N AND non-open → ridondante/incoerente
 *   • Combo (DC + U/O o 1/X/2 + U/O) seguono le stesse regole sulla parte U/O
 */
export function violatesStructure(
  market: string, floor: number, ceiling: number, ceilingOpen: boolean,
  /** Ticket 6-bis: a tetto aperto U3.5/U4.5 (puri e combo) restano ammessi.
   *  Si calcola con `underAmmessiATettoAperto`, mai a mano. */
  underAperti: boolean = false,
): boolean {
  const M = market.trim().toUpperCase();

  // ============ MG RANGE ============
  const mg = M.match(_mgRangeRegex);
  if (mg) {
    const mgLo = +mg[1];
    const mgHi = +mg[2];
    // Lower bound: MG deve includere il floor (lo ≤ floor+1)
    if (mgLo > floor + 1) return true;
    // Upper bound:
    if (ceilingOpen) {
      // ceiling aperto: serve un upper alto (≥ 6) o open
      if (mgHi <= 5) return true;
    } else {
      // ceiling chiuso: MG deve includere il ceiling (hi ≥ ceiling)
      if (mgHi < ceiling) return true;
    }
  }

  // ============ UNDER ============
  // U(N.5) - estrae N dal mercato (puro o combo)
  const underMatch = M.match(/U\s*(\d+)\.5/);
  if (underMatch) {
    const u = +underMatch[1];
    if (ceilingOpen) {
      // Ceiling aperto: gli under sono incoerenti, TRANNE U3.5/U4.5 (puri e
      // combo) quando il profilo e' DIFENSIVO (Ticket 6-bis, decisione C di
      // Rossi del 30/09). U1.5/U2.5 restano sempre fuori.
      return !(underAperti && u >= 3 && u <= 4);
    }
    // U(N.5) valido se N >= ceiling - 1 (es. U3.5 ok con ceiling=3 o 4)
    // Più stretto: U deve essere ESATTAMENTE al ceiling chiuso
    if (u < ceiling - 1) return true; // troppo stretto rispetto al ceiling
    if (u > ceiling) return true; // U non taglia (es. U3.5 quando ceiling=2: già garantito, no value)
  }

  // ============ OVER ============
  const overMatch = M.match(/O\s*(\d+)\.5/);
  if (overMatch) {
    const o = +overMatch[1];
    // Over valido se floor potrebbe superare la soglia
    if (!ceilingOpen) {
      // Ceiling chiuso a C: O(N.5) richiede C > N (altrimenti impossibile)
      if (o >= ceiling) return true;
      // E richiede floor ≤ N (altrimenti già garantito, no value)
      if (floor > o) return true;
    }
    // Ceiling aperto: O sempre validi
  }

  return false;
}

/**
 * Filtra le alternative scartando quelle in contraddizione col PICK
 * o tra loro, o che violano i vincoli strutturali.
 * Ritorna max `limit` alternative coerenti.
 */
export function filterCoherentAlternatives(
  pick: VerdictPick,
  alternatives: VerdictPick[],
  structure?: StrutturaGol,
  limit: number = 3,
): VerdictPick[] {
  const accepted: VerdictPick[] = [];
  const floor = structure?.goal_floor ?? 0;
  const ceiling = structure?.goal_ceiling ?? 7;
  const open = !!structure?.goal_ceiling_open;
  const underAperti = underAmmessiATettoAperto(structure);

  for (const alt of alternatives) {
    if (accepted.length >= limit) break;
    // Skip se viola vincoli strutturali (floor/ceiling)
    if (violatesStructure(alt.market, floor, ceiling, open, underAperti)) continue;
    // Skip se contraddice il PICK principale
    if (areMarketsContradictory(pick.market, alt.market)) continue;
    // Skip se contraddice un'alternativa già accettata
    let conflicts = false;
    for (const acc of accepted) {
      if (areMarketsContradictory(acc.market, alt.market)) {
        conflicts = true;
        break;
      }
    }
    if (conflicts) continue;
    accepted.push(alt);
  }
  return accepted;
}

export type StrutturaGol = {
  goal_floor: number; goal_ceiling: number; goal_ceiling_open?: boolean;
  offensive_profile?: string;
} | null | undefined;

/**
 * UNDER A TETTO APERTO (Ticket 6-bis, caso Belgio-Galles 1-0, decisione C di
 * Rossi del 30/09). Il tetto aperto vietava TUTTI gli under, ma la famiglia
 * DOMINANZA_OVER ha tetto aperto per costruzione: l'under moriva proprio nei
 * profili DIFENSIVA, dove ha piu' senso (DC 1X + U3.5 proposto dall'IA e mai
 * arrivato a schermo). Ora, se il profilo e' DIFENSIVA, U3.5/U4.5 puri e le
 * combo con U3.5/U4.5 (DC 1X + U3.5, 1 + U4.5) restano ammessi.
 * Criterio deterministico sul profilo delle quote, mai sui risultati.
 * I RANGE MG a tetto aperto restano vietati (regola confermata da Rossi).
 * Unica sede della regola: la usano verdetto (telefono e server), motore e
 * catalogo dell'IA.
 */
export function underAmmessiATettoAperto(s: { offensive_profile?: string } | null | undefined): boolean {
  return s?.offensive_profile === "defensive";
}

/** true se il mercato e' strutturalmente giocabile (stessa regola di violatesStructure). */
export function ammessoDallaStruttura(market: string, s: StrutturaGol): boolean {
  return !s || !violatesStructure(market, s.goal_floor, s.goal_ceiling, !!s.goal_ceiling_open, underAmmessiATettoAperto(s));
}

/** true se e' un MG di range escluso per il TETTO (non per il pavimento). */
function mgScartatoPerTetto(market: string, s: StrutturaGol): boolean {
  if (!s) return false;
  const mg = market.trim().toUpperCase().match(_mgRangeRegex);
  if (!mg) return false;
  const hi = +mg[2];
  return s.goal_ceiling_open ? hi <= 5 : hi < s.goal_ceiling;
}

/**
 * FILTRO STRUTTURALE IN INGRESSO ALLA FUSIONE (Ticket 6, 30/09/2026).
 *
 * `violatesStructure` veniva applicato solo in CODA al verdetto: su
 * Belgio-Francia (tetto aperto) MG 2-4 totali era primo nella fusione al 62% e
 * veniva tolto solo alla fine, quindi posizioni, punteggi e "n/3" erano
 * calcolati su una lista che conteneva un mercato inammissibile. Qui si
 * filtrano il ranking del motore e la voce PRE PRIMA di rankPicks /
 * buildFinalVerdict. La regola NON cambia (tetto aperto => MG 2-4 escluso,
 * confermata da Rossi il 29/09): cambia solo il punto in cui si applica.
 *
 * `letturaGol` = un MG di range del verdetto e' caduto per il tetto: il tetto
 * non garantisce il range, e la lettura gol (O2.5) va mostrata subito dopo il
 * pick (vedi conLetturaGol).
 */
export function fusioneInIngresso<P extends { market: string }>(
  structural: StructuralAnalysis,
  pre: P[],
  aiMarkets: string[] = [],
): { structural: StructuralAnalysis; pre: P[]; letturaGol: boolean } {
  const s = structural?.structure;
  if (!s) return { structural, pre, letturaGol: false };
  const candidati = [...(structural.ranking || []).map((r) => r.market), ...pre.map((p) => p.market), ...aiMarkets];
  const letturaGol = candidati.some((m) => isVerdictMarket(m) && mgScartatoPerTetto(m, s));
  return {
    structural: { ...structural, ranking: (structural.ranking || []).filter((r) => ammessoDallaStruttura(r.market, s)) },
    pre: pre.filter((p) => ammessoDallaStruttura(p.market, s)),
    letturaGol,
  };
}

export const NOTA_LETTURA_GOL = "il tetto non garantisce il range → lettura gol";

/**
 * Se un MG di range e' caduto per il tetto, O2.5 (se ammissibile, sopra soglia
 * e non in contraddizione col pick) va subito dopo il pick fra le alternative.
 * `verdetto` contiene gia' solo mercati sopra soglia e ammessi dalla struttura.
 */
export function conLetturaGol(
  pick: VerdictPick,
  alts: VerdictPick[],
  verdetto: VerdictPick[],
  letturaGol: boolean,
  limit: number = 3,
): { alts: VerdictPick[]; letturaGolMarket: string | null } {
  if (!letturaGol || normalizeMarket(pick.market) === "O2.5") return { alts, letturaGolMarket: null };
  const o25 = verdetto.find((v) => normalizeMarket(v.market) === "O2.5");
  if (!o25 || areMarketsContradictory(pick.market, o25.market)) return { alts, letturaGolMarket: null };
  const resto = alts.filter((a) => normalizeMarket(a.market) !== "O2.5" && !areMarketsContradictory(o25.market, a.market));
  return { alts: [o25, ...resto].slice(0, limit), letturaGolMarket: o25.market };
}


// ============================================================
// MERCATI DEL MANUALE COME CANDIDATI (01/10/2026, decisione di Rossi)
// ============================================================
/**
 * I mercati del manuale dello scenario della partita (getScenarioNote) che
 * NON sono gia' giocabili (whitelist) diventano candidati del verdetto, SOLO in
 * quella partita, se:
 *  - hanno risposto oltre il 50% in archivio su partite con lo stesso
 *    scenario (misura del Ticket 8, /manuale-stats);
 *  - hanno una quota >= Quota minima.
 * Poi sono "candidati come gli altri": nessuna corsia preferenziale.
 * Esempi: "X oppure GG" nell'EQUILIBRIO di fallback; "1 AH -0,75" nel GAP
 * TECNICO. Fuori dal loro scenario non entrano mai (Belgio-Galles, 01/10:
 * "X oppure GG" compariva in un GAP TECNICO).
 *
 * Quote (regole di Rossi): X oppure GG = GG x 0,90; AH -0,75 favorita = quota
 * della doppia chance della favorita (1X per "1 AH", X2 per "2 AH"); i
 * multigol casa/ospite = quota stimata dal motore (market_odds). DNB: nessuna
 * regola di quota, quindi non candidabile.
 */
export type CandidatoManuale = {
  /** nome da giocare (catalogo del motore se esiste, altrimenti quello del manuale) */
  market: string;
  manuale: string;
  odd: number;
  stimata: boolean;
  /** % in archivio sullo scenario (0-100) */
  pct: number;
  vinte: number;
  valutate: number;
};

/** Nome nel catalogo di un mercato scritto come nel manuale ("1 fisso" -> "1", "MG casa 1-3" -> "MG 1-3 casa"). */
export function nomeCatalogoManuale(market: string): string {
  return market
    .split("+")
    .map((p) => p
      .replace(/\bfisso\b/i, "")
      .replace(/Over\s*(\d),(\d)/gi, "O$1.$2")
      .replace(/Under\s*(\d),(\d)/gi, "U$1.$2")
      .replace(/^\s*MG\s+(casa|ospite)\s+(\d+-\d+)\s*$/i, "MG $2 $1")
      .replace(/\s{2,}/g, " ")
      .trim())
    .join(" + ");
}

/** Quota di un mercato del manuale secondo le regole di Rossi; null se non ha regola. */
export function quotaManuale(
  market: string, odds: Odds, marketOdds?: Record<string, { odd: number; estimated: boolean }> | null,
): { odd: number; stimata: boolean } | null {
  const m = market.trim();
  const numero = (v: any) => (typeof v === "number" && v > 1 ? v : null);
  if (/^X\s+(oppure|o)\s+GG$/i.test(m)) {
    const gg = numero((odds as any)?.odd_GG ?? (odds as any)?.odd_gg ?? (odds as any)?.GG);
    return gg ? { odd: Math.round(gg * 0.9 * 100) / 100, stimata: true } : null;
  }
  const ah = m.match(/^([12])\s+AH\s+-0[.,]75$/i);
  if (ah) {
    const k1 = ah[1] === "1" ? "odd_1X" : "odd_X2";
    const k2 = ah[1] === "1" ? "odd_1x" : "odd_x2";
    const dc = numero((odds as any)?.[k1] ?? (odds as any)?.[k2]);
    return dc ? { odd: dc, stimata: true } : null;
  }
  const nome = nomeCatalogoManuale(m);
  const chiave = Object.keys(marketOdds || {}).find((k) => normalizeMarket(k) === normalizeMarket(nome));
  if (chiave) return { odd: marketOdds![chiave].odd, stimata: marketOdds![chiave].estimated };
  const reale = getMarketOdd(nome, odds);
  return reale ? { odd: reale, stimata: false } : null;
}

export function candidatiManuale(
  odds: Odds | null | undefined,
  stats: ManualeStatsResponse["scenari"] | null | undefined,
  minOdd: number,
  marketOdds?: Record<string, { odd: number; estimated: boolean }> | null,
  /** true = tutte le quote da `minOdd` in su (per le fasce AI, che poi dividono
   *  per fascia in validaFasce); false = solo dentro la fascia di `minOdd`. */
  tutteLeFasce = false,
  /** Struttura del motore: vedi `getScenarioNote`. */
  profilo?: { offensive_profile?: string } | null,
): CandidatoManuale[] {
  if (!odds || !stats) return [];
  const nota = getScenarioNote(odds, profilo);
  if (!nota) return [];
  const misure = stats[chiaveScenario(nota)]?.mercati || {};
  const out: CandidatoManuale[] = [];
  for (const manuale of nota.markets) {
    const nome = nomeCatalogoManuale(manuale);
    if (isVerdictMarket(nome)) continue;          // gia' giocabile per conto suo
    const c = misure[manuale];
    if (!c || c.pct === null || c.pct <= 50) continue;
    const q = quotaManuale(manuale, odds, marketOdds);
    if (!q || (tutteLeFasce ? q.odd < minOdd : !inFascia(q.odd, minOdd))) continue;
    // Il nome da giocare: quello del catalogo del motore se lo conosce
    // (i multigol casa/ospite), altrimenti quello del manuale (AH, X oppure GG).
    const market = /AH|oppure/i.test(manuale) ? manuale : nome;
    out.push({ market, manuale, odd: q.odd, stimata: q.stimata, pct: c.pct, vinte: c.vinte, valutate: c.vinte + c.perse });
  }
  return out;
}

// ============================================================
// PRONOSTICO GENERATO DOPO LA PARTITA (01/10/2026)
// ============================================================
/**
 * Ora di inizio della partita in millisecondi UTC. `day` (AAAA-MM-GG) e `time`
 * (HH:MM) sono l'ora italiana del palinsesto: si converte col fuso
 * Europe/Rome, ora legale compresa. null se la data manca o e' illeggibile.
 */
export function inizioPartitaMs(day?: string | null, time?: string | null): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [h, m] = String(time || "00:00").split(":").map((x) => parseInt(x, 10));
  const hh = String(isFinite(h) ? h : 0).padStart(2, "0");
  const mm = String(isFinite(m) ? m : 0).padStart(2, "0");
  const comeUtc = Date.parse(`${day}T${hh}:${mm}:00Z`);
  if (!isFinite(comeUtc)) return null;
  try {
    const parti = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Rome", hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).formatToParts(new Date(comeUtc)).map((p) => [p.type, p.value]),
    );
    const romaComeUtc = Date.UTC(+parti.year, +parti.month - 1, +parti.day, +parti.hour % 24, +parti.minute);
    return comeUtc - (romaComeUtc - comeUtc);
  } catch (e) {
    console.error("[inizioPartitaMs]", e);
    return comeUtc;
  }
}

/**
 * true se il pronostico AI e' stato generato dopo il calcio d'inizio: la
 * ricerca web puo' aver trovato il risultato (successo su Belgio-Galles: "reduce
 * da 1-0 sul Galles"). Vale anche per i pronostici vecchi senza il flag: si
 * confronta la data di creazione con l'ora della partita.
 */
export function pronosticoPostPartita(
  prediction: { post_partita?: boolean | null; created_at?: string } | null | undefined,
  match: { day?: string | null; time?: string | null } | null | undefined,
): boolean {
  if (!prediction) return false;
  if (prediction.post_partita === true) return true;
  const inizio = inizioPartitaMs(match?.day, match?.time);
  const creato = prediction.created_at ? Date.parse(prediction.created_at) : NaN;
  return inizio !== null && isFinite(creato) && creato >= inizio;
}

// ============================================================
// L'AI STILA LA CLASSIFICA PER FASCIA DI QUOTA (01/10/2026)
// ============================================================
/**
 * Decisione di Rossi del 30/09: l'AI e' la fonte piu' forte (ha il web) e
 * stila classifica e verdetto; motore Poisson e PRE sono dati e controlli, non
 * voti alla pari. Il caso che l'ha motivata e' Belgio-Galles (1-0): favorita
 * netta, profilo DIFENSIVA, e il verdetto era O2.5 come in Spagna-Croazia (4-1).
 *
 * L'AI restituisce una classifica per ciascuna fascia. Il codice NON si fida:
 * `validaFasce` tiene per ogni fascia solo i mercati giocabili davvero
 * (whitelist, quota >= fascia, struttura) e applica la regola di coerenza
 * `letturaDirezionale`. Il paletto di affidabilita' e' lo stesso 58% misurato
 * per la soglia consigliata (predict.ts): sotto, la fascia e' segnalata.
 */
export const FASCE_AI = [1.40, 1.50, 1.60, 1.75];

/** Probabilita' minima di un pick "affidabile": misurata su 583 partite di
 *  test (dentro il 58% si vince il 59,7%, oltre il 55,7%). */
export const PROB_AFFIDABILE = 0.58;

export const chiaveFascia = (s: number) => s.toFixed(2);

/**
 * FASCE A INTERVALLI CHIUSI (01/10/2026, decisione di Rossi). Prima "fascia
 * 1,50" voleva dire "quota da 1,50 in su" (ci entrava anche un 1,80). Ora ogni
 * fascia e' un intervallo: 1,40-1,49 · 1,50-1,59 · 1,60-1,74 · 1,75 e oltre.
 * Dentro la fascia vince il mercato PIU' PROBABILE, non il piu' pagato: se 1,
 * O2.5 e GG pagano 1,47, 1,48 e 1,49, decide la probabilita'.
 * Una soglia che non e' una fascia (es. 1,35) resta "da X in su".
 * Unica sede della regola: verdetto (scheda, server, ricalcolo), fasce AI,
 * pick del motore. Multipla e backtest restano "da X in su".
 */
export function limitiFascia(soglia: number): { da: number; a: number } {
  const i = FASCE_AI.findIndex((f) => Math.abs(f - soglia) < 0.001);
  if (i < 0) return { da: soglia, a: Infinity };
  return { da: FASCE_AI[i], a: i + 1 < FASCE_AI.length ? FASCE_AI[i + 1] : Infinity };
}

/** La quota sta dentro la fascia? (`da` <= quota < `a`). */
export function inFascia(odd: number | null | undefined, soglia: number): boolean {
  if (odd === null || odd === undefined || !isFinite(odd)) return false;
  const { da, a } = limitiFascia(soglia);
  // Si confronta la quota come appare a schermo (due decimali): 1,4999 da
  // calcolo e' 1,50 e sta nella fascia 1,50.
  const q = Math.round(odd * 100) / 100;
  return q >= da - 1e-9 && q < a - 1e-9;
}

/** "1,50–1,59" · "1,75 e oltre" · "da 1,35" (soglia libera). */
export function etichettaFascia(soglia: number): string {
  const { da, a } = limitiFascia(soglia);
  const f = (x: number) => x.toFixed(2).replace(".", ",");
  if (!FASCE_AI.some((x) => Math.abs(x - soglia) < 0.001)) return `da ${f(da)}`;
  return a === Infinity ? `${f(da)} e oltre` : `${f(da)}–${f(a - 0.01)}`;
}

/**
 * IL CONSIGLIATO SALVATO (13/10/2026, Rossi): "deve essere il piu' solido, e se
 * li' non c'e' niente si prende quello sotto". Prima si salvava il primo della
 * fascia aperta nella scheda: guardando la 1,75 il consigliato diventava la
 * giocata piu' rischiosa (Aarhus GG+O2.5 51%, Famalicao 1 51%). Ora si prende
 * il primo di OGNI fascia e vince il piu' probabile; a parita' la quota piu'
 * alta. Il calcolo di ogni fascia resta quello di sempre.
 */
export function consigliatoTraFasce(
  verdettoDellaFascia: (soglia: number) => VerdictPick[],
): { pick: VerdictPick; fascia: number } | null {
  let best: { pick: VerdictPick; fascia: number } | null = null;
  for (const f of FASCE_AI) {
    const top = verdettoDellaFascia(f)[0];
    if (!top || typeof top.coverage !== "number") continue;
    if (!best || top.coverage >= (best.pick.coverage ?? 0)) best = { pick: top, fascia: f };
  }
  return best;
}

/** La fascia in cui cade una quota (null se sotto la prima). */
export function fasciaDellaQuota(odd: number | null | undefined): number | null {
  for (const f of FASCE_AI) if (inFascia(odd, f)) return f;
  return null;
}

/** Probabilita' in % con un decimale ("57,8%"): arrotondata all'intero,
 *  57,8% diventava "58%" accanto a "sotto il 58%", una contraddizione. */
export const pctProb = (p: number) => `${(p * 100).toFixed(1).replace(".", ",")}%`;

/**
 * LETTURA DIREZIONALE: GAP TECNICO (favorita netta, X alta) + profilo
 * DIFENSIVA. La direzione e' forte ma i gol sono incerti o contenuti: il
 * primo posto va a un mercato di sola direzione o direzione + limite ai gol
 * (1, 1X, 1 + U4.5, DC 1X + U3.5 e speculari), mai a un mercato che scommette
 * sui gol (O2.5, MG 3-6, GG, GG + O2.5, DC 1X + O2.5...).
 * Criterio sulle quote e sul profilo, mai sui risultati.
 */
export function letturaDirezionale(odds: Odds | null | undefined, s: StrutturaGol): "1" | "2" | null {
  if (!odds || !s) return null;
  const nota = getScenarioNote(odds, s);
  if (!nota || nota.scenario !== "Gap Tecnico" || !nota.favorita) return null;
  return underAmmessiATettoAperto(s) ? (nota.favorita as "1" | "2") : null;
}

/** true se il mercato esprime la direzione `fav` senza scommettere sui gol. */
export function coerenteConDirezione(market: string, fav: "1" | "2"): boolean {
  const m = normalizeMarket(market).replace(/^DC /, "");
  const dir = fav === "1" ? ["1", "1X"] : ["2", "X2"];
  const [segno, resto] = m.split("+").map((x) => x.trim());
  if (!dir.includes(segno)) return false;
  if (!resto) return true;
  return /^U\d/.test(resto);
}

export type VoceFascia = {
  market: string;
  odd: number | null;
  stimata: boolean;
  /** probabilita' Poisson del motore, se il mercato e' nel suo ranking */
  prob: number | null;
  rankAI: number;
  rankMotore: number | null;
  rankPre: number | null;
  /** aggiunto dal controllo di coerenza, non proposto dall'AI */
  aggiunto?: boolean;
};

export type FasciaValidata = {
  soglia: number;
  perche: string;
  voci: VoceFascia[];
  scartati: { market: string; motivo: string }[];
  pick: VoceFascia | null;
  affidabile: boolean;
  /** favorita della lettura direzionale, se attiva */
  direzionale: "1" | "2" | null;
};

type ContestoFasce = {
  odds: Odds;
  structural: StructuralAnalysis | null | undefined;
  /** mercati del manuale ammessi in questa partita (candidatiManuale a 1.40) */
  manuale?: CandidatoManuale[];
};

function quotaMercato(market: string, ctx: ContestoFasce): { odd: number | null; stimata: boolean } {
  const man = (ctx.manuale || []).find((c) => normalizeMarket(c.market) === normalizeMarket(market));
  if (man) return { odd: man.odd, stimata: man.stimata };
  const mappa = ctx.structural?.market_odds || {};
  const chiave = Object.keys(mappa).find((k) => normalizeMarket(k) === normalizeMarket(market));
  if (chiave) return { odd: mappa[chiave].odd, stimata: mappa[chiave].estimated };
  const reale = getMarketOdd(market, ctx.odds);
  return { odd: reale ?? null, stimata: false };
}

/**
 * Valida la classifica AI di ogni fascia. Per ogni mercato proposto:
 * whitelist, quota >= fascia, ammesso dalla struttura, coerente con la lettura
 * direzionale. Se la lettura direzionale lascia la fascia vuota, il controllo
 * aggiunge i mercati coerenti del catalogo (per probabilita' del motore),
 * marcati come "aggiunto": la regola e' una garanzia, non un suggerimento.
 */
export function validaFasce(
  fasce: Record<string, FasciaAI> | null | undefined,
  ctx: ContestoFasce,
): FasciaValidata[] | null {
  if (!fasce || typeof fasce !== "object") return null;
  const s = ctx.structural?.structure;
  const ranking = ctx.structural?.ranking || [];
  const pre = ctx.structural?.pre_ranking || [];
  const pos = <T extends { market: string }>(lista: T[], m: string) => {
    const i = lista.findIndex((r) => normalizeMarket(r.market) === normalizeMarket(m));
    return i >= 0 ? i + 1 : null;
  };
  const manuale = ctx.manuale || [];
  const delManuale = (m: string) => manuale.find((c) => normalizeMarket(c.market) === normalizeMarket(m));
  const probDi = (m: string) => {
    const r = ranking.find((x) => normalizeMarket(x.market) === normalizeMarket(m));
    if (r) return r.coverage;
    const c = delManuale(m);
    return c ? c.pct / 100 : null;
  };
  const dir = letturaDirezionale(ctx.odds, s);
  const out: FasciaValidata[] = [];

  for (const soglia of FASCE_AI) {
    const f = fasce[chiaveFascia(soglia)];
    if (!f) continue;
    const voci: VoceFascia[] = [];
    const scartati: { market: string; motivo: string }[] = [];
    const lista = Array.isArray(f.classifica) ? f.classifica.map(String) : [];
    lista.forEach((market, i) => {
      if (voci.some((v) => normalizeMarket(v.market) === normalizeMarket(market))) return;
      const { odd, stimata } = quotaMercato(market, ctx);
      let motivo = "";
      const man = delManuale(market);
      const delManualeQui = !!man || mercatoDelManualeQui(market, ctx);
      if (!isVerdictMarket(market) && !delManualeQui) motivo = "fuori dai mercati giocati";
      else if (!inFascia(odd, soglia)) motivo = `quota ${odd?.toFixed(2) ?? "n/d"} fuori dalla fascia ${etichettaFascia(soglia)}`;
      else if (!ammessoDallaStruttura(market, s)) motivo = "incoerente con pavimento/tetto";
      else if (!man && ranking.length && pos(ranking, market) === null) motivo = "escluso dal motore (struttura della partita)";
      else if (dir && !coerenteConDirezione(market, dir)) motivo = "scommette sui gol: favorita netta con profilo DIFENSIVA";
      if (motivo) { scartati.push({ market, motivo }); return; }
      voci.push({ market, odd, stimata, prob: probDi(market), rankAI: i + 1, rankMotore: pos(ranking, market), rankPre: pos(pre, market) });
    });

    if (dir && voci.length === 0) {
      // Garanzia della regola: se l'AI non ha proposto nulla di coerente, si
      // prendono i mercati coerenti giocabili a questa fascia, per probabilita'.
      const candidati = ranking
        .filter((r) => isVerdictMarket(r.market) && coerenteConDirezione(r.market, dir) && ammessoDallaStruttura(r.market, s))
        .map((r) => ({ r, q: quotaMercato(r.market, ctx) }))
        .filter(({ q }) => inFascia(q.odd, soglia))
        .sort((a, b) => b.r.coverage - a.r.coverage);
      for (const { r, q } of candidati.slice(0, 3)) {
        voci.push({ market: r.market, odd: q.odd, stimata: q.stimata, prob: r.coverage, rankAI: 0, rankMotore: pos(ranking, r.market), rankPre: pos(pre, r.market), aggiunto: true });
      }
    }

    const pick = voci[0] || null;
    out.push({
      soglia,
      perche: typeof f.perche === "string" ? f.perche : "",
      voci, scartati, pick,
      affidabile: !!pick && pick.prob !== null && pick.prob >= PROB_AFFIDABILE,
      direzionale: dir,
    });
  }
  return out.length ? out : null;
}

/**
 * "PUNTA SU QUESTO" (01/10/2026): il main_prediction dell'AI, a qualunque
 * quota. Non e' il verdetto (quello e' il pick della fascia scelta): qui si dice
 * a che quota sta, in quale fascia cade e se un controllo lo scarterebbe.
 */
/**
 * Il mercato e' del manuale di QUESTA partita (scenario delle quote) e il motore
 * lo conosce? (01/10/2026, Irlanda-Austria: mentre la misura dell'archivio
 * carica, `ctx.manuale` e' vuoto e "X oppure GG" risultava "fuori dai mercati
 * giocati".) Vale anche senza misura: quota e % vengono dal motore.
 */
export function mercatoDelManualeQui(market: string, ctx: ContestoFasce): boolean {
  if ((ctx.manuale || []).some((c) => normalizeMarket(c.market) === normalizeMarket(market))) return true;
  const nota = getScenarioNote(ctx.odds, ctx.structural?.structure);
  if (!nota) return false;
  const ranking = ctx.structural?.ranking || [];
  return nota.markets.some((m) => normalizeMarket(nomeCatalogoManuale(m)) === normalizeMarket(market))
    && ranking.some((r) => normalizeMarket(r.market) === normalizeMarket(market));
}

export function valutaPuntaSu(
  market: string | null | undefined,
  ctx: ContestoFasce,
): { market: string; odd: number | null; stimata: boolean; prob: number | null; fascia: number | null; problema: string | null } | null {
  if (!market) return null;
  const s = ctx.structural?.structure;
  const ranking = ctx.structural?.ranking || [];
  const man = (ctx.manuale || []).find((c) => normalizeMarket(c.market) === normalizeMarket(market));
  const r = ranking.find((x) => normalizeMarket(x.market) === normalizeMarket(market));
  const { odd, stimata } = quotaMercato(market, ctx);
  const dir = letturaDirezionale(ctx.odds, s);
  let problema: string | null = null;
  if (!isVerdictMarket(market) && !mercatoDelManualeQui(market, ctx)) problema = "fuori dai mercati giocati";
  else if (!ammessoDallaStruttura(market, s)) problema = "incoerente con pavimento/tetto";
  else if (dir && !coerenteConDirezione(market, dir)) problema = "scommette sui gol con favorita netta e profilo DIFENSIVA";
  else if (odd !== null && fasciaDellaQuota(odd) === null) problema = `quota ${odd.toFixed(2)} sotto la prima fascia (1,40)`;
  return {
    market, odd, stimata,
    prob: r ? r.coverage : man ? man.pct / 100 : null,
    fascia: fasciaDellaQuota(odd),
    problema,
  };
}

/** Il consiglio motivato dell'AI (01/10/2026), salvato dentro `fasce.consiglio`. */
export type ConsiglioAI = {
  mercato: string;
  perche: string;
  web: string;
  /** Dal 07/10/2026: la notizia concreta che giustifica il cambio, e se c'e' davvero nei dati. */
  notizia?: string;
  notizia_verificata?: boolean;
  alternative: { mercato: string; perche_no: string }[];
};

/**
 * SCELTA B (07/10/2026, con Rossi): l'AI decide il verdetto e il "Punta su
 * questo" SOLO se il suo consiglio cita una notizia concreta trovata davvero
 * nei dati della partita (assenza, formazione, motivazioni). Senza, decide il
 * motore (fusione di motore Poisson e PRE, senza l'AI). Motivo, misurato sullo
 * storico: stesse partite indovinate, ma il consiglio dell'AI gioca quote piu'
 * basse (1,44, resa -10%) e sbaglia piu' spesso la direzione (51% contro 66%).
 * Il ricalcolo senza AI alle fasce 1,60 e 1,75 va in pari o in attivo.
 * Pronostici dopo il calcio d'inizio: mai.
 */
export function aiDecide(prediction: { fasce?: any; post_partita?: boolean | null; created_at?: string } | null | undefined, match?: { day?: string | null; time?: string | null } | null): boolean {
  if (!prediction || pronosticoPostPartita(prediction, match)) return false;
  return prediction.fasce?.consiglio?.notizia_verificata === true;
}

export function consiglioDi(prediction: { fasce?: any } | null | undefined): ConsiglioAI | null {
  const c = prediction?.fasce?.consiglio;
  return c && typeof c === "object" && typeof c.mercato === "string" ? c as ConsiglioAI : null;
}

export type AlternativaConsiglio = {
  market: string;
  motivo: string;
  odd: number | null;
  stimata: boolean;
  prob: number | null;
  rankMotore: number | null;
  pctManuale: number | null;
};

/**
 * LE ALTERNATIVE DEL CONSIGLIO (01/10/2026, caso Irlanda-Austria): calcolate
 * dal codice, non dall'AI, cosi' compaiono anche se l'AI se ne dimentica:
 * il piu' probabile del catalogo (quota >= 1,40), il primo del PRE, i mercati
 * del manuale ammessi in questa partita e gli altri mercati che l'AI stessa ha
 * proposto per QUESTA partita (playable_markets e classifiche delle fasce):
 * cambiano di partita in partita. Il consiglio stesso e' escluso.
 */
export function alternativeDelConsiglio(
  consigliato: string | null | undefined,
  ctx: ContestoFasce,
  proposteAI: string[] = [],
): AlternativaConsiglio[] {
  const ranking = ctx.structural?.ranking || [];
  const pre = ctx.structural?.pre_ranking || [];
  const out: AlternativaConsiglio[] = [];
  const nota = getScenarioNote(ctx.odds, ctx.structural?.structure);
  const manuali = [
    ...(ctx.manuale || []).map((c) => c.market),
    ...(nota?.markets || []),
  ];
  const presente = (m: string) =>
    (consigliato && normalizeMarket(m) === normalizeMarket(consigliato)) || out.some((a) => normalizeMarket(a.market) === normalizeMarket(m));
  const aggiungi = (market: string, motivo: string) => {
    if (isMercatoVietato(market) || presente(market)) return;
    const { odd, stimata } = quotaMercato(market, ctx);
    const i = ranking.findIndex((r) => normalizeMarket(r.market) === normalizeMarket(market));
    const man = (ctx.manuale || []).find((c) => normalizeMarket(c.market) === normalizeMarket(market));
    out.push({
      market, motivo, odd, stimata,
      prob: i >= 0 ? ranking[i].coverage : null,
      rankMotore: i >= 0 ? i + 1 : null,
      pctManuale: man ? man.pct : null,
    });
  };
  const migliore = ranking
    .filter((r) => isVerdictMarket(r.market))
    .map((r) => ({ r, q: quotaMercato(r.market, ctx) }))
    .filter(({ q }) => q.odd !== null && fasciaDellaQuota(q.odd) !== null)
    .sort((a, b) => b.r.coverage - a.r.coverage)[0];
  if (migliore) aggiungi(migliore.r.market, "il più probabile del catalogo");
  if (pre[0]) aggiungi(pre[0].market, "il primo del PRE");
  for (const c of ctx.manuale || []) aggiungi(c.market, "dal manuale dello scenario");
  // Anche senza la misura dell'archivio (non ancora caricata): i mercati del
  // manuale dello scenario che il motore conosce, con la sua quota e la sua %.
  for (const m of nota?.markets || []) {
    const nome = nomeCatalogoManuale(m);
    if (ranking.some((r) => normalizeMarket(r.market) === normalizeMarket(nome))) aggiungi(nome, "dal manuale dello scenario");
  }
  for (const m of proposteAI) if (m) aggiungi(m, "proposto anche dall'AI");
  return out.slice(0, 6);
}

/** Il consiglio e' meno probabile di un'alternativa e il web non porta un
 *  motivo: va mostrato con cautela. */
export function consiglioDaCautela(
  probConsiglio: number | null,
  web: string | null | undefined,
  alternative: AlternativaConsiglio[],
): AlternativaConsiglio | null {
  if (probConsiglio === null) return null;
  const senzaWeb = !web || !web.trim() || /niente di nuovo/i.test(web);
  if (!senzaWeb) return null;
  const meglio = alternative
    .filter((a) => a.prob !== null && a.prob - probConsiglio >= 0.02)
    .sort((a, b) => (b.prob ?? 0) - (a.prob ?? 0))[0];
  return meglio || null;
}

/** La fascia piu' alta con un pick affidabile (>= 58%): oltre, "non superare". */
export function sogliaMassimaAffidabile(fasce: FasciaValidata[] | null): number | null {
  let max: number | null = null;
  for (const f of fasce || []) if (f.affidabile) max = f.soglia;
  return max;
}

/**
 * VERDETTO DALL'AI: se il pronostico ha le fasce, il verdetto e' la classifica
 * validata della fascia pari alla Quota minima scelta. Motore e PRE diventano
 * badge di accordo (STRUTT #n, PRE #n), non voti. null = niente fasce (o
 * fascia vuota): il chiamante usa la fusione di sempre.
 * Unica sede della regola: la usano scheda e verdettoServer.
 */
export function verdettoDaAI(
  prediction: { fasce?: Record<string, FasciaAI> | null; post_partita?: boolean | null; created_at?: string } | null | undefined,
  structural: StructuralAnalysis | null | undefined,
  odds: Odds,
  minOdd: number,
  match?: { day?: string | null; time?: string | null } | null,
  manuale?: CandidatoManuale[],
): { picks: VerdictPick[]; fascia: FasciaValidata } | null {
  // Un pronostico generato dopo il calcio d'inizio non decide mai il verdetto,
  // e dal 07/10/2026 nemmeno uno senza una notizia verificata (scelta B).
  if (!aiDecide(prediction, match)) return null;
  const fasce = validaFasce(prediction?.fasce, { odds, structural, manuale });
  const fascia = fasce?.find((f) => Math.abs(f.soglia - minOdd) < 0.001);
  // Senza fasce (o senza questa fascia) decide la fusione. Con la fascia ma
  // senza pick: nessuna giocata, NON la fusione, che riproporrebbe proprio
  // cio' che l'AI e il controllo di coerenza hanno scartato.
  if (!fascia) return null;
  const ranking = structural?.ranking || [];
  const picks: VerdictPick[] = fascia.voci.map((v, i) => {
    const r = ranking.find((x) => normalizeMarket(x.market) === normalizeMarket(v.market));
    const sources: VerdictSource[] = ["ai"];
    const ranks: Partial<Record<VerdictSource, number>> = {};
    if (v.rankAI) ranks.ai = v.rankAI;
    if (v.rankMotore !== null && v.rankMotore <= 6) { sources.push("structural"); ranks.structural = v.rankMotore; }
    if (v.rankPre !== null) { sources.push("pre"); ranks.pre = v.rankPre; }
    const concordance = sources.length;
    return {
      market: v.market,
      score: 0,
      sources, ranks,
      odd: v.odd ?? undefined,
      oddEstimated: v.stimata,
      coverage: v.prob ?? undefined,
      fragility: r?.fragility,
      concordance,
      agreementLabel: concordance === 3 ? "piena" : concordance === 2 ? "forte" : "parziale",
      origine: "ai",
      dettaglio: [
        { voce: v.aggiunto ? "Aggiunto dal controllo di coerenza (favorita netta + profilo DIFENSIVA)" : `AI #${v.rankAI} nella fascia ${fascia.soglia.toFixed(2)}`, punti: 0 },
        { voce: v.rankMotore !== null ? `Motore Poisson #${v.rankMotore}${v.prob !== null ? ` (${pctProb(v.prob)})` : ""}` : "Motore Poisson: fuori dal suo ranking", punti: 0 },
        { voce: v.rankPre !== null ? `PRE #${v.rankPre}` : "PRE: non lo propone", punti: 0 },
        ...(i === 0 && !fascia.affidabile ? [{ voce: `Sotto il ${Math.round(PROB_AFFIDABILE * 100)}%: a questa quota non e' affidabile`, punti: 0 }] : []),
      ],
    } as VerdictPick;
  });
  return { picks, fascia };
}

/**
 * Quanti sistemi POTEVANO esprimersi su questo mercato.
 *
 * Il motore strutturale e l'IA ricevono l'intero catalogo, quindi valutano
 * tutto. L'euristica PRE no: ragiona sulle quote reali del bookmaker, e per i
 * multigol semplici un prezzo non esiste. Su quei mercati si astiene, e non
 * deve pesare come un voto contrario.
 */
function eligibleSystemsFor(market: string, preEligible: Set<string> | null): number {
  if (!preEligible) return 3;                       // nessuna informazione: come prima
  return preEligible.has(normalizeMarket(market)) ? 3 : 2;
}

// ============================================================================
// NOTA SCENARIO 1X2 — richiesta da Rossi il 09/09.
// Calcolo SEPARATO e di sola lettura: non tocca ne' alimenta il verdetto
// finale, il motore, l'IA o lo storico. Serve solo a mostrare in alto, come
// promemoria, lo scenario 1X2 della partita e i mercati "da manuale" indicati
// per quello scenario, usando le quote gia' presenti a sistema.
// Classificazione per FORMA (ordine tra le tre quote), non per soglie fisse:
// vedi conversazione del 09/09 per la derivazione completa.
// ============================================================================
export type ScenarioNote = {
  scenario: "Equilibrio" | "Progressione" | "Gap Tecnico" | "Gap falso";
  favorita?: "1" | "2";
  markets: string[];
  /** Indicazione in parole per la scheda (Gap falso, Gap Tecnico con goleada o pochi gol). */
  avviso?: string;
};

/** Chiave dello scenario per le statistiche del manuale: Progressione e Gap
 *  Tecnico hanno mercati diversi a seconda della favorita, quindi si separano. */
export function chiaveScenario(nota: ScenarioNote): string {
  return nota.favorita ? `${nota.scenario} ${nota.favorita}` : nota.scenario;
}

export type ManualeStatsResponse = {
  ok: boolean;
  partite_valutate: number;
  metodo: string;
  scenari: Record<string, {
    scenario: string; favorita: string | null; partite: number;
    mercati: Record<string, { vinte: number; perse: number; rimborsi: number; mezze: number; non_valutabili: number; pct: number | null }>;
  }>;
  /** Pagella dei sistemi sulle partite concluse (01/10/2026). */
  pagella?: {
    sistemi: Record<string, { vinte: number; perse: number; pct: number | null; partite: number }>;
    stesse_partite: { partite: number; sistemi: Record<string, { vinte: number; perse: number; pct: number | null }> };
  };
  /** GAP TECNICO diviso per profilo (DIFENSIVA / altro). */
  confronto_profilo?: Record<string, { partite: number; mercati: Record<string, { vinte: number; perse: number; pct: number | null }> }>;
};

/**
 * `profilo` = la struttura del motore (`structural.structure`, oppure
 * `classifyFamily(odds)` sul server: e' la stessa cosa, dipende solo dalle
 * quote). Serve SOLO al GAP TECNICO con favorita sotto 1,40 per scegliere il
 * sostituto (round 2, TICKET 2). Se manca vale "non difensivo": tutti i
 * chiamanti che hanno la struttura DEVONO passarla, altrimenti scheda, server e
 * misura dell'archivio direbbero mercati diversi.
 */
export function getScenarioNote(odds: Odds, profilo?: { offensive_profile?: string } | null): ScenarioNote | null {
  const q1 = odds.odd_1, qx = odds.odd_X, q2 = odds.odd_2;
  if (q1 == null || qx == null || q2 == null) return null;

  const gg = odds.odd_GG;
  const o25 = odds.odd_O25;

  // ==========================================================================
  // 15/09/2026 — RISCRITTA SU PALETTI ASSOLUTI (specifica di Rossi).
  //
  // Prima classificava per POSIZIONE RELATIVA: "Equilibrio" se la X era la piu'
  // alta delle tre, altrimenti Progressione/Gap secondo l'ordine
  // favorita < X < sfavorita. Conseguenza: una partita con 1=2,62 X=3,27
  // 2=3,91 finiva in "Progressione" pur non avendo nessuna favorita vera.
  //
  // La discriminante ora e' UNA SOLA: esiste una favorita sotto quota 2,00?
  //
  //   NO  -> EQUILIBRIO. Valgono le regole di equilibrio anche con 1 e 2 a 4:
  //          se nessuno e' favorito, la partita e' in equilibrio, punto.
  //   SI  -> conta dove sta la X:
  //            X da 4,00 in su  -> GAP TECNICO   (es. 1=1,80 X=4,00 2=4,30)
  //            X sotto 4,00     -> PROGRESSIONE  (es. 1=1,95 X=3,40 2=3,80)
  //
  // Cosi' non restano buchi (ogni partita cade in una categoria) ne'
  // sovrapposizioni (le condizioni si escludono a vicenda). La versione
  // descritta a voce ne aveva entrambi: 1=4,93 X=4,08 2=2,02 rientrava sia in
  // Equilibrio sia in Gap, e una quota di esattamente 2,00 non rientrava in
  // nessuna delle tre.
  //
  // DUE SCELTE CHE HO PRESO IO, segnalate a Rossi il 15/09:
  //  - equilibrio non controlla la X. Con entrambe sopra 2,00 e X sotto 2,99
  //    (partita bloccata, pareggio molto probabile) resta equilibrio: e' il
  //    caso piu' equilibrato che esista.
  //  - favorita sotto 2,00 con X sotto 3,00 -> Progressione. Combinazione che
  //    in pratica non si verifica (una favorita a 1,50 implica un pareggio
  //    intorno a 4), ma meglio coperta che lasciata scoperta.
  //
  // Resta un calcolo di sola lettura: non tocca il verdetto, il motore, l'IA
  // o lo storico.
  // ==========================================================================
  const SOGLIA_FAVORITA = 2.00;
  const SOGLIA_GAP = 4.00;

  const favorita: "1" | "2" | null =
    q1 < SOGLIA_FAVORITA && q1 <= q2 ? "1" :
    q2 < SOGLIA_FAVORITA && q2 < q1 ? "2" :
    null;

  // --------------------------------------------------------------------------
  // IL MANUALE (Ticket 8, specifica finale di Rossi del 29/09, seconda stesura).
  // I nomi dei mercati sono scritti in modo che `esitoMercato` li sappia
  // valutare: e' cosi' che /manuale-stats misura quante volte hanno risposto.
  // --------------------------------------------------------------------------
  if (!favorita) {
    // EQUILIBRIO (Ticket 8-bis, 30/09): tre rami con le SOGLIE della vecchia
    // regola. Rispetto a prima cambiano solo due cose: nell'equilibrio normale
    // torna MG 3-6 totali (tre mercati SEPARATI, non la combo GG + Over 2,5),
    // e nel fallback "X oppure GG" prende il posto di MG 2-4 totali. La combo
    // non compare in NESSUN altro ramo.
    let markets: string[];
    if (gg != null && o25 != null && gg < 1.5 && o25 < 1.5) {
      // Ramo gol fortissimo: invariato.
      markets = ["MG 3-6 totali"];
    } else if (gg != null && o25 != null && gg < 1.8 && o25 < 1.8) {
      markets = ["GG", "Over 2,5", "MG 3-6 totali"];
    } else {
      // GG e Over fuori soglia: combo bookmaker "X oppure GG" (vince col
      // pareggio, 0-0 compreso, o se segnano entrambe; perde solo sulle
      // vittorie a rete inviolata), al posto del vecchio MG 2-4 totali.
      markets = ["X oppure GG"];
    }
    return { scenario: "Equilibrio", markets };
  }

  // GAP FALSO (18/10/2026, Rossi): favorita sotto 2,00 e X da 4,00 in su, ma l'avversario sta
  // sotto 4,00: non c'e' un divario vero. Archivio (263 partite): la favorita vince 53%, perde 29%,
  // fisso -6% di resa, GG -24%, Over 2,5 -13%; Under 3,5 56% @1,85 circa in pari. Rossi: "non
  // giocarla oppure Under 3,5" (es. NY Red Bulls-Toronto 1,90 / 4,25 / 3,25, finita 0-2).
  const quotaSfavorita = favorita === "1" ? q2 : q1;
  if (qx >= SOGLIA_GAP && quotaSfavorita < SOGLIA_GAP) {
    return { scenario: "Gap falso", favorita, markets: ["U3.5"], avviso: "Non è un gap vero: l'avversario sta sotto 4. Meglio non giocarla, oppure Under 3,5." };
  }

  if (qx >= SOGLIA_GAP) {
    // GAP TECNICO. AH -0,75 non e' giocabile al palinsesto: il sostituto
    // giocabile proposto da Rossi e' MG favorita 2-4 (decidera' la pagella).
    // La voce AH resta com'e' (TICKET 5: decisione del proprietario, 02/10).
    //
    // Round 2, TICKET 2: "GG + Over 2,5" tolto in ogni caso, era il PEGGIORE in
    // tutti e quattro i gruppi del GAP TECNICO (32,6 / 33,9 / 39,4 / 48,9%).
    // Con la favorita sotto 1,40 il fisso non e' giocabile: al suo posto UN
    // sostituto scelto dal profilo del motore (misure del 02/10/2026):
    //   DIFENSIVA -> MG 2-4 totali        (62,6-64,6%)
    //   altro     -> DC favorita + O2.5   (64,0-65,1%)
    // Da 1,40 in su il fisso e' giocabile (61,5%, il migliore del gruppo) e la
    // lista resta quella.
    // 18/10/2026 (Rossi): l'AH -0,75 non c'e' nei bookmaker europei -> al suo posto MG favorita 2-4
    // (archivio, Gap vero: 62% con favorita sotto 1,40, 56% a 1,40-1,59, 52% a 1,60-1,79).
    // 18/10/2026 (Rossi, Bayern-Lipsia 6-1 e Betis-Barcellona 2-5): la MG favorita 2-4 dipende dai
    // gol attesi. Archivio Gap vero per quota Over 3,5: sotto 1,60 la favorita fa 5+ gol il 30% (MG 2-4
    // 56%) -> DC favorita + GG (Rossi: 1X + GG / X2 + GG; 60%, conviene da quota 1,66); 1,60-1,99 MG 2-4 64%; da 2,00 la favorita
    // resta a 0-1 gol un terzo delle volte (MG 2-4 56-58%) -> solo il fisso. Senza quota Over 3,5: MG 2-4.
    const o35 = (odds as any).odd_O35 ?? (odds as any).odd_o35 ?? null;
    const mg = `MG ${favorita === "1" ? "casa" : "ospite"} 2-4`;
    let avviso: string | undefined;
    const markets = [`${favorita} fisso`];
    if (o35 != null && o35 < 1.60) {
      markets.push(favorita === "1" ? "DC 1X + GG" : "DC X2 + GG");
      avviso = `Rischio goleada (Over 3,5 sotto 1,60): niente Multigol 2-4 della favorita. ${favorita === "1" ? "1X" : "X2"} + GG solo se il bookmaker la paga almeno 1,66.`;
    } else if (o35 == null || o35 < 2.00) {
      markets.push(mg);
    } else {
      avviso = "Pochi gol attesi (Over 3,5 da 2,00): la favorita può fermarsi a 0-1 gol, niente Multigol 2-4.";
    }
    const quotaFavorita = favorita === "1" ? q1 : q2;
    if (quotaFavorita < 1.40) {
      markets.push(underAmmessiATettoAperto(profilo)
        ? "MG 2-4 totali"
        : favorita === "1" ? "DC 1X + O2.5" : "DC X2 + O2.5");
    }
    return { scenario: "Gap Tecnico", favorita, markets, ...(avviso ? { avviso } : {}) };
  }

  // PROGRESSIONE (casa o ospite, speculare). DNB non e' giocabile: il
  // sostituto e' MG favorita 1-3 (equivalenza di Rossi, +-7 pt su Poisson).
  const fav = favorita === "1" ? "casa" : "ospite";
  const sfav = favorita === "1" ? "ospite" : "casa";
  return {
    scenario: "Progressione",
    favorita,
    markets: [
      `MG ${fav} 1-3 + MG ${sfav} 0-2`,
      `MG ${fav} 1-3`,
      `${favorita} DNB`,
    ],
  };
}

// ============================================================================
// CLASSIFICA DELL'EQUILIBRIO (19/10/2026, Rossi: "lasciare la nota cosi' e sotto la classifica dello
// scenario, chi scegliere prima se e' pagato il minimo"). Solo per il ramo Equilibrio con GG e Over 2,5
// sotto 1,80 (non entrambi sotto 1,50). Percentuali misurate in archivio (matches + match_results_training,
// 1.970 partite) per fascia della quota Over 3,5 e per chi e' avanti nelle quote 1-2 (quota piu' bassa
// di almeno 0,50). Celle con meno di 40 partite -> media della fascia Over 3,5.
// Dal 19/10/2026 (Rossi) decide anche consigliato e Pronostico prima del via (vedi analizzaGiocate e
// regolePronostico); i mercati della nota dello scenario e i prompt restano come sono.
// ============================================================================
export type MercatoClassifica = string;
export type VoceClassifica = {
  mercato: MercatoClassifica;
  codice: string;           // nome del mercato per consigliato e regole (O2.5 per Over 2,5)
  pct: number;              // % di volte che entra, in archivio
  quotaMinima: number;      // quota da cui conviene (1 / pct)
  quota: number | null;     // quota del bookmaker per questa partita, se c'e'
  pagata: boolean | null;   // quota >= minima (null = quota non disponibile)
  daEvitare: boolean;       // entra meno del 55%
  stimata?: boolean;        // quota stimata dall'app (Multigol, combo): da controllare sul bookmaker
};
export type ClassificaScenario = {
  tipo: "equilibrio" | "gap";
  fascia: string;
  /** Equilibrio: chi e' avanti nelle quote 1-2. Gap: lato della favorita. */
  direzione: "casa" | "vicine" | "ospite";
  /** Gap: fascia della quota della favorita. */
  fasciaFavorita?: string;
  partite: number;
  voci: VoceClassifica[];
  /** Il primo della classifica pagato almeno la quota minima. */
  scelta: MercatoClassifica | null;
};

// [partite, GG, Over 2,5, 1X, X2, X oppure GG]
const TABELLA_EQUILIBRIO: Record<string, Record<"casa" | "vicine" | "ospite", number[]>> = {
  "2,00-2,29": { casa: [53, 72, 66, 75, 51, 75], vicine: [62, 60, 63, 56, 65, 66], ospite: [146, 66, 63, 64, 61, 71] },
  "2,30-2,59": { casa: [239, 56, 53, 70, 56, 62], vicine: [328, 63, 61, 60, 65, 66], ospite: [174, 61, 64, 55, 68, 67] },
  "2,60-2,99": { casa: [371, 59, 52, 71, 58, 64], vicine: [422, 59, 56, 63, 63, 66], ospite: [231, 55, 53, 51, 73, 61] },
  "da 3,00": { casa: [59, 42, 42, 70, 56, 54], vicine: [59, 42, 42, 70, 56, 54], ospite: [59, 42, 42, 70, 56, 54] },
};

export function classificaEquilibrio(odds: Odds): ClassificaScenario | null {
  const o = odds as any;
  const q1 = o.odd_1, q2 = o.odd_2, gg = o.odd_GG, o25 = o.odd_O25, o35 = o.odd_O35 ?? o.odd_o35 ?? null;
  if (q1 == null || q2 == null || gg == null || o25 == null || o35 == null) return null;
  if (q1 < 2 || q2 < 2) return null;                       // c'e' una favorita: non e' Equilibrio
  if (!(gg < 1.8 && o25 < 1.8) || (gg < 1.5 && o25 < 1.5)) return null;
  if (o35 < 2) return null;                                // fascia mai vista in archivio
  const fascia = o35 < 2.3 ? "2,00-2,29" : o35 < 2.6 ? "2,30-2,59" : o35 < 3 ? "2,60-2,99" : "da 3,00";
  const direzione = q1 < q2 - 0.5 ? "casa" : q2 < q1 - 0.5 ? "ospite" : "vicine";
  const [partite, ...pcts] = TABELLA_EQUILIBRIO[fascia][direzione];
  const mercati: MercatoClassifica[] = ["GG", "Over 2,5", "1X", "X2", "X oppure GG"];
  const codici = ["GG", "O2.5", "1X", "X2", "X oppure GG"];
  const quote: (number | null)[] = [gg, o25, o.odd_1X ?? null, o.odd_X2 ?? null, null];
  const voci = mercati.map((mercato, i): VoceClassifica => {
    const pct = pcts[i];
    const quotaMinima = Math.ceil((100 / pct) * 100) / 100;
    const quota = quote[i];
    return { mercato, codice: codici[i], pct, quotaMinima, quota, pagata: quota == null ? null : quota >= quotaMinima, daEvitare: pct < 55 };
  }).sort((a, b) => b.pct - a.pct);
  const scelta = voci.find((v) => !v.daEvitare && v.pagata === true)?.mercato ?? null;
  return { tipo: "equilibrio", fascia, direzione, partite, voci, scelta };
}

// ============================================================================
// CLASSIFICA DEL GAP TECNICO (19/10/2026, Rossi: "la stessa cosa per lo scenario Gap"). Gap vero
// (favorita sotto 2,00, X e avversario da 4,00). Archivio per fascia Over 3,5 x quota della favorita;
// celle con meno di 40 partite -> media della fascia Over 3,5. Multigol e combo non hanno la quota del
// bookmaker: si usa quella stimata dall'app (da controllare). Sotto 1,40 una giocata non si sceglie.
// SOLO DA LEGGERE: non decide consigliato ne' Pronostico prima del via (misura 19/10: resa -6,2%).
// ============================================================================
// [partite, fisso, DC fav + GG, MG fav 2-4, MG fav 1-3, Over 2,5, GG, GG + Over 2,5]
const TABELLA_GAP: Record<string, Record<"forte" | "media" | "leggera", number[]>> = {
  "sotto 1,60": { forte: [129, 85, 53, 55, 51, 81, 60, 57], media: [158, 80, 58, 55, 54, 80, 65, 59], leggera: [158, 80, 58, 55, 54, 80, 65, 59] },
  "1,60-1,99": { forte: [508, 81, 48, 63, 61, 73, 53, 46], media: [215, 62, 54, 63, 67, 73, 64, 55], leggera: [61, 61, 56, 64, 61, 74, 66, 64] },
  "2,00-2,29": { forte: [411, 78, 40, 59, 66, 64, 45, 40], media: [337, 64, 41, 50, 71, 59, 52, 42], leggera: [124, 52, 44, 49, 73, 65, 59, 48] },
  "da 2,30": { forte: [660, 75, 41, 60, 73, 55, 45, 37], media: [757, 65, 44, 54, 73, 57, 52, 42], leggera: [156, 59, 43, 53, 73, 61, 56, 47] },
};

/** stimate: quote del catalogo dell'app (quoteCatalogo / market_odds) per Multigol e combo. */
export function classificaGap(odds: Odds, stimate?: Record<string, { odd: number }> | null): ClassificaScenario | null {
  const o = odds as any;
  const q1 = o.odd_1, qx = o.odd_X, q2 = o.odd_2, o35 = o.odd_O35 ?? o.odd_o35 ?? null;
  if (q1 == null || qx == null || q2 == null || o35 == null) return null;
  const fav: "1" | "2" | null = q1 < 2 && q1 <= q2 ? "1" : q2 < 2 && q2 < q1 ? "2" : null;
  if (!fav) return null;
  const qf = fav === "1" ? q1 : q2, qs = fav === "1" ? q2 : q1;
  if (qx < 4 || qs < 4) return null;                       // Progressione o Gap falso
  const fascia = o35 < 1.6 ? "sotto 1,60" : o35 < 2 ? "1,60-1,99" : o35 < 2.3 ? "2,00-2,29" : "da 2,30";
  const forza = qf < 1.4 ? "forte" : qf < 1.6 ? "media" : "leggera";
  const [partite, ...pcts] = TABELLA_GAP[fascia][forza];
  const lato = fav === "1" ? "casa" : "ospite";
  const mercati = [`${fav} fisso`, `${fav === "1" ? "1X" : "X2"} + GG`, `MG ${lato} 2-4`, `MG ${lato} 1-3`, "Over 2,5", "GG", "GG + Over 2,5"];
  const codici = [fav, `DC ${fav === "1" ? "1X" : "X2"} + GG`, `MG 2-4 ${lato}`, `MG 1-3 ${lato}`, "O2.5", "GG", "GG + O2.5"];
  const stima = (k: string) => stimate?.[k]?.odd ?? null;
  const quote: (number | null)[] = [qf, stima(codici[1]), stima(codici[2]), stima(codici[3]), o.odd_O25 ?? null, o.odd_GG ?? null, stima(codici[6])];
  const voci = mercati.map((mercato, i): VoceClassifica => {
    const pct = pcts[i];
    const quotaMinima = Math.ceil((100 / pct) * 100) / 100;
    const quota = quote[i];
    return { mercato, codice: codici[i], pct, quotaMinima, quota, pagata: quota == null ? null : quota >= quotaMinima, daEvitare: pct < 55, stimata: (i >= 1 && i <= 3) || i === 6 };
  }).sort((a, b) => b.pct - a.pct);
  const scelta = voci.find((v) => !v.daEvitare && v.pagata === true && (v.quota ?? 0) >= 1.4)?.mercato ?? null;
  return { tipo: "gap", fascia, direzione: lato, fasciaFavorita: forza === "forte" ? "sotto 1,40" : forza === "media" ? "1,40-1,59" : "1,60-1,99", partite, voci, scelta };
}

/** La classifica dello scenario della partita (Equilibrio o Gap Tecnico), o null. */
export function classificaScenario(odds: Odds, scenario: string | null | undefined, stimate?: Record<string, { odd: number }> | null): ClassificaScenario | null {
  if (scenario === "Equilibrio") return classificaEquilibrio(odds);
  if (scenario && scenario.startsWith("Gap Tecnico")) return classificaGap(odds, stimate);
  return null;
}

/** La voce scelta dalla classifica, in parole per il "perche'" (consigliato e Pronostico prima del via). */
export function perchéClassifica(c: ClassificaScenario): string {
  const v = c.voci.find((x) => x.mercato === c.scelta);
  const qf = (x: number) => x.toFixed(2).replace(".", ",");
  return v
    ? `classifica dello scenario: ${v.mercato} entra il ${v.pct}% (Over 3,5 ${c.fascia}${c.fasciaFavorita ? `, favorita ${c.fasciaFavorita}` : ""}), pagato ${v.stimata ? "circa " : ""}${qf(v.quota!)}, ne serve almeno ${qf(v.quotaMinima)}${v.stimata ? " (quota stimata: controllala)" : ""}`
    : "classifica dello scenario: nessun mercato è pagato il minimo, meglio lasciarla";
}

// ============================================================================
// COSA ASPETTARSI DAI GOL (07/10/2026, richiesta di Rossi)
// "Quando apro una partita voglio capire quanti gol aspettarmi dalla casa e
// dall'ospite, se segnano, se prendono gol, se la partita e' sbilanciata o se
// si mettono paura e finisce 0-0." Due letture affiancate:
//  - QUOTE: gol attesi del motore Poisson (lambda dalle quote). Sono la lettura
//    piu' precisa: sullo storico (450 partite, 06/10) sbagliano di 1,31 gol a
//    partita contro 1,36 della forma, e sull'O/U 2.5 indovinano 58% contro 55%.
//  - FORMA: ultime 5 partite vere da FotMob (forma-gol.ts), solo 90 minuti.
// Quando non sono d'accordo la scheda lo dice: e' un campanello, non decide
// (in disaccordo avevano ragione le quote 60 volte su 104).
// ============================================================================

export type PartitaForma = { data: string; avversario: string; in_casa: boolean; fatti: number; subiti: number; torneo: string };
export type FinestraForma = { n: number; fatti: number | null; subiti: number | null; partite: PartitaForma[] };
export type FormaSquadra = { nome: string; totale: FinestraForma; sede: FinestraForma };
export type FormaGol = {
  fotmob_id: string; casa: FormaSquadra & { stesso_tipo?: boolean }; ospite: FormaSquadra & { stesso_tipo?: boolean };
  id_casa?: number; id_ospite?: number; inizio_ms?: number;
  /** Tipo della partita (19/10/2026): la forma si legge solo con le partite dello stesso tipo. */
  tipo?: "campionato" | "coppa" | "amichevole" | "nazionale" | null; torneo?: string;
};

export type LetturaSquadra = {
  attesi: number;            // gol attesi dalle quote
  segna: number;             // probabilita' di segnare almeno un gol
  prende: number;            // probabilita' di subirne almeno uno
  attesiForma: number | null;
  segnatoIn: number | null;  // in quante delle ultime partite ha segnato
  subitoIn: number | null;   // in quante ne ha preso almeno uno
  n: number;
};
export type LetturaGol = {
  casa: LetturaSquadra;
  ospite: LetturaSquadra;
  totale: number;
  totaleForma: number | null;
  p00: number; gg: number; under25: number; bloccata: number; // bloccata = 0 o 1 gol totali
  /** Risultati esatti piu' probabili (dalle quote), dal piu' probabile. */
  risultati: { casa: number; ospite: number; p: number }[];
  /** Esito 1 X 2 dalle quote (Poisson). */
  p1: number; px: number; p2: number;
  /** "1" / "2" se la favorita vince almeno nel 55% dei casi, altrimenti null. */
  direzione: "1" | "2" | null;
  /** Fascia di gol totali piu' stretta che copre almeno il 75% dei casi. */
  golDa: number; golA: number; pFascia: number;
  tipo: "SBILANCIATA" | "EQUILIBRATA E CHIUSA" | "EQUILIBRATA E APERTA" | "EQUILIBRATA";
  tipoSpiegazione: string;
  avvisi: string[];
};

const poisson = (l: number, k: number) => {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-l) * Math.pow(l, k)) / f;
};
const mediaDi = (...xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const g1 = (x: number) => x.toFixed(1).replace(".", ",");

/** La scheda gol: lambda dalle quote (motore) + forma da FotMob (facoltativa). */
export function letturaGol(lambdaCasa: number, lambdaOspite: number, forma?: FormaGol | null): LetturaGol {
  const lc = Math.max(0.05, lambdaCasa), lo = Math.max(0.05, lambdaOspite);
  let p00 = 0, under25 = 0, bloccata = 0;
  const griglia: { casa: number; ospite: number; p: number }[] = [];
  let p1 = 0, px = 0, p2 = 0;
  const perTotale = new Array(21).fill(0);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = poisson(lc, i) * poisson(lo, j);
    griglia.push({ casa: i, ospite: j, p });
    if (i > j) p1 += p; else if (i === j) px += p; else p2 += p;
    perTotale[i + j] += p;
    if (i + j === 0) p00 += p;
    if (i + j <= 1) bloccata += p;
    if (i + j <= 2) under25 += p;
  }
  const segnaC = 1 - Math.exp(-lc), segnaO = 1 - Math.exp(-lo);

  // Gol attesi dalla forma: stessa formula misurata sullo storico, attacco di
  // uno incrociato con la difesa dell'altro, ultime 5 totali e casa/fuori a
  // pari peso (casa/fuori solo con almeno 2 partite).
  const sede = (w: FinestraForma, k: "fatti" | "subiti") => (w.n >= 2 ? w[k] : null);
  let fc: number | null = null, fo: number | null = null;
  const c = forma?.casa, o = forma?.ospite;
  if (c && o && c.totale.n >= 3 && o.totale.n >= 3) {
    fc = mediaDi(mediaDi(c.totale.fatti, sede(c.sede, "fatti")), mediaDi(o.totale.subiti, sede(o.sede, "subiti")));
    fo = mediaDi(mediaDi(o.totale.fatti, sede(o.sede, "fatti")), mediaDi(c.totale.subiti, sede(c.sede, "subiti")));
  }
  const conta = (s: FormaSquadra | undefined, k: "fatti" | "subiti") =>
    s && s.totale.n ? s.totale.partite.filter((p) => p[k] > 0).length : null;

  const totale = lc + lo;
  const totaleForma = fc !== null && fo !== null ? fc + fo : null;
  const forte = lc >= lo ? "la casa" : "l'ospite";
  const rapporto = Math.max(lc, lo) / Math.min(lc, lo);
  let tipo: LetturaGol["tipo"], tipoSpiegazione: string;
  if (rapporto >= 1.8) {
    tipo = "SBILANCIATA";
    tipoSpiegazione = `Secondo le quote ${forte} segna circa ${g1(rapporto)} volte più dell'altra.`;
  } else if (totale < 2.3) {
    tipo = "EQUILIBRATA E CHIUSA";
    tipoSpiegazione = "Forze simili e pochi gol attesi: partita tattica, il pareggio e i risultati stretti sono in gioco.";
  } else if (totale > 2.9) {
    tipo = "EQUILIBRATA E APERTA";
    tipoSpiegazione = "Forze simili e tanti gol attesi: due squadre che segnano e concedono.";
  } else {
    tipo = "EQUILIBRATA";
    tipoSpiegazione = "Forze simili, gol nella media.";
  }

  const avvisi: string[] = [];
  if (totaleForma !== null) {
    const diff = totaleForma - totale;
    const difesaChiusa = [c?.sede, o?.sede, c?.totale, o?.totale].some((w) => w && w.n >= 2 && (w.subiti ?? 9) <= 0.6);
    if (diff <= -0.7) {
      avvisi.push(
        `Le quote si aspettano ${g1(totale)} gol, la forma solo ${g1(totaleForma)}` +
        // Misurato su 36 partite cosi' (07/10): Under 2.5 47% contro 42% delle
        // quote, ma 0-1 gol NON piu' spesso (14%). Quindi "meno gol", non
        // "partita bloccata": il segnale e' debole, si dice com'e'.
        (difesaChiusa ? ": una delle due difese non prende quasi mai gol, attenzione agli Over (segnale debole)." : ": attenzione agli Over (segnale debole)."),
      );
    } else if (diff >= 0.7) {
      // Su 36 partite cosi' (07/10): Over 2.5 nel 69% contro il 57% delle quote.
      avvisi.push(`Le quote si aspettano ${g1(totale)} gol, la forma ${g1(totaleForma)}: la partita può essere più aperta del previsto.`);
    }
  }
  for (const [s, nome] of [[c, c?.nome], [o, o?.nome]] as const) {
    if (!s || s.totale.n < 4) continue;
    const segnato = s.totale.partite.filter((p) => p.fatti > 0).length;
    if (segnato <= 1) avvisi.push(`${nome} ha segnato solo in ${segnato} delle ultime ${s.totale.n}.`);
  }

  const risultati = griglia.sort((x, y) => y.p - x.p).slice(0, 8);
  let golDa = 0, golA = 20, pFascia = 1;
  for (let da = 0; da <= 10; da++) for (let a = da; a <= 12; a++) {
    let q = 0;
    for (let k = da; k <= a; k++) q += perTotale[k];
    if (q >= 0.75 && (a - da < golA - golDa || (a - da === golA - golDa && q > pFascia))) { golDa = da; golA = a; pFascia = q; }
  }
  // Soglia 55%: e' circa una quota 1,75 sulla favorita. Sotto, la favorita
  // "debole" che poi perde (Siviglia, Alaves, Criciuma: l'1X che finisce X2).
  const direzione = p1 >= 0.55 ? "1" : p2 >= 0.55 ? "2" : null;
  return {
    risultati, golDa, golA, pFascia, p1, px, p2, direzione,
    casa: { attesi: lc, segna: segnaC, prende: segnaO, attesiForma: fc, segnatoIn: conta(c, "fatti"), subitoIn: conta(c, "subiti"), n: c?.totale.n ?? 0 },
    ospite: { attesi: lo, segna: segnaO, prende: segnaC, attesiForma: fo, segnatoIn: conta(o, "fatti"), subitoIn: conta(o, "subiti"), n: o?.totale.n ?? 0 },
    totale, totaleForma, p00, gg: segnaC * segnaO, under25, bloccata, tipo, tipoSpiegazione, avvisi,
  };
}

// ============================================================================
// TABELLA SCENARI (07/10/2026): per scenario e fascia, i mercati che la
// prendono piu' spesso in modo STABILE (partite vecchie e recenti). Calcolata
// dal server (lib/tabellaScenari.ts), usata da "Punta su questo".
// ============================================================================
export type VoceTabella = { market: string; manuale: boolean; pA: number; nA: number; pB: number; nB: number; p: number };
export type TabellaScenari = { aggiornata: string; divisione: string; partite: number; scenari: Record<string, Record<string, VoceTabella[]>> };

// LETTURA DELLA PARTITA (07/10/2026): del programma (frasi) e dell'AI gratis.
export type LetturaAI = {
  modello: string; quando: string; direzione: string; gol_casa: string; gol_ospite: string; gol_totali: string;
  forma_e_quote: string; notizia: string; risultati_probabili: string[]; lettura: string;
  mercato?: string; notizia_verificata?: boolean; pro?: boolean;
  /** Come stanno andando le due squadre (ultime 5 fra campionato e coppa, gol fatti e subiti): dal 19/10/2026. */
  come_stanno?: string;
  /** Scelta ragionata (19/10/2026, "ok AI"). */
  giocata?: string; ragionamento?: { book?: string; direzione?: string; segnano?: string; scelta?: string };
};
export type QuoteFirma = Record<string, number | null>;

/**
 * Le quote che contano per la lettura e per la firma.
 * Supporta sia il formato DB piatto (odd_1, odd_x...) sia il formato annidato odds.
 */
export function firmaQuote(m: any): QuoteFirma {
  if (!m) return {};
  const odds = m.odds || m;
  const q = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  return {
    "1": q(odds["1"] ?? odds.odd_1 ?? m.odd_1),
    X: q(odds.X ?? odds.x ?? odds.odd_x ?? odds.odd_X ?? m.odd_x ?? m.odd_X),
    "2": q(odds["2"] ?? odds.odd_2 ?? m.odd_2),
    O25: q(odds.O25 ?? odds.odd_o25 ?? m.odd_o25),
    U25: q(odds.U25 ?? odds.odd_u25 ?? m.odd_u25),
    GG: q(odds.GG ?? odds.odd_gg ?? m.odd_gg),
    NG: q(odds.NG ?? odds.odd_ng ?? m.odd_ng),
  };
}

/**
 * Le quote sono cambiate abbastanza da rifare la lettura o invalidare la cache?
 * (>= 5% su una quota principale o inversione favorita 1/2).
 */
export function quoteCambiate(prima: QuoteFirma | undefined | null, ora: QuoteFirma): boolean {
  if (!prima) return true;
  for (const k of Object.keys(ora)) {
    const a = prima[k], b = ora[k];
    if (a == null || b == null) continue;
    if (Math.abs(b - a) / a >= 0.05) return true;
  }
  const fav = (q: QuoteFirma) => ((q["1"] ?? 99) < (q["2"] ?? 99) ? "1" : "2");
  return fav(prima) !== fav(ora);
}

export type ConsigliatoSalvato = {
  market: string | null; nome?: string | null; quota?: number | null; stimata?: boolean;
  pA?: number | null; pB?: number | null; n?: number | null;
  daLasciare?: string | null; avvisi?: string[];
  alternative?: { market: string; nome: string; quota: number; stimata: boolean; p: number }[];
  ai?: "confermato" | "cambiato" | "scelta" | null; notizia?: string | null;
  numeri_market?: string | null; numeri_nome?: string | null; numeri_quota?: number | null;
  lasciata_market?: string | null; lasciata_quota?: number | null;
  proposta_scartata?: { mercato: string; motivo: string } | null;
  quote?: QuoteFirma | any; quando?: string;
  tabella_versione?: string | null;
  tradotto_da?: string | null;
  /** Perche' e' stata scelta (19/10/2026); assente nei consigliati salvati prima. */
  perche?: string | null;
  /** Rifatto a partita chiusa con le regole nuove (19/10/2026): quando. */
  rifatto?: string;
};

/** Una giocata del Pronostico regole. p: archivio (n >= 300) o misura delle coppe; se mancano, il modello (15/10/2026). */
export type VoceRegole = { mk: string; quota: number; stimata: boolean; p: number; fonte?: "archivio" | "coppe" | "modello"; n?: number | null; modello?: number };

/** Risposta di /regole (netlify/functions/lib/regolePronostico.ts). */
export type PronosticoRegole = {
  versione: number;
  scenario: string; favorita: string; favQ: number;
  lettura: { modello: string | null; dir: string; ris: string[] } | null;
  semaforo: "verde" | "giallo" | "rosso" | "grigio"; motivo: string; avvisi: string[];
  fasce: Record<string, VoceRegole | null>;
  scelta: VoceRegole | null;
  /** Le ragioni in parole semplici (✓ a favore, ✗ esclusioni o dubbi). */
  ragioni?: { ok: boolean; t: string }[];
};

export type RispostaLettura = {
  programma: {
    frasi: string[]; accordo: boolean | null; motivi: string[];
    forma_casa: number | null; forma_ospite: number | null;
    pesata_casa: { fatti: number; subiti: number } | null; pesata_ospite: { fatti: number; subiti: number } | null;
    assenti_casa: number; assenti_ospite: number;
  } | null;
  ai: LetturaAI | null; pro?: LetturaAI | null; dossier?: boolean; error?: string;
  ai_vecchia?: boolean; pro_vecchia?: boolean;
  /** Il consigliato SALVATO (lo stesso di schedina e multipla). */
  consigliato?: ConsigliatoSalvato | null;
  /** Pronostico regole (in prova dal 15/10/2026): accanto al consigliato, non lo sostituisce. */
  regole?: PronosticoRegole | null;
  /** Ultimi risultati dello stesso campionato prima della partita (vista semplice, 19/10/2026). */
  campionato?: { lega: string; n: number; media: number | null; ris: string[] } | null;
};

/**
 * DA GIOCARE (11/10/2026, Rossi: "nell'app compaiono piu' pronostici: mi serve
 * quello da giocare e perche'"). Non cambia il consigliato: fra la giocata dei
 * numeri e quella del Pronostico AI dice quale giocare, con una regola sola.
 *  - AI che conferma, o nessun AI: il consigliato.
 *  - AI che cambia senza giocata dei numeri: l'AI.
 *  - AI che cambia alzando la quota di piu' di 0,10: i numeri (Ajax-Nec
 *    10/10: 1 + U4.5 @2.03 persa, MG 1-3 Ajax @1.46 vinta).
 *  - AI che cambia con quota simile o piu' bassa: l'AI (non aggiunge rischio).
 */
export const DA_GIOCARE_SCARTO_QUOTA = 0.10;
export type DaGiocare = { market: string; nome: string; quota: number | null; stimata: boolean; fonte: "numeri" | "ai"; perche: string };
export function daGiocare(c: {
  market?: string | null; nome?: string | null; quota?: number | null; stimata?: boolean;
  ai?: "confermato" | "cambiato" | "scelta" | null; daLasciare?: string | null;
  numeri_market?: string | null; numeri_nome?: string | null; numeri_quota?: number | null;
  proposta_scartata?: { mercato: string; motivo: string } | null;
} | null | undefined): DaGiocare | null {
  if (!c?.market) return null;
  const q = (x: number | null | undefined) => (x != null ? Number(x).toFixed(2) : "?");
  const ai = { market: c.market, nome: c.nome || c.market, quota: c.quota ?? null, stimata: !!c.stimata };
  if (c.ai !== "cambiato") {
    const perche = c.ai === "confermato" ? "confermato dal Pronostico AI"
      : c.proposta_scartata ? `dai numeri: la proposta AI (${c.proposta_scartata.mercato}) è stata scartata`
      : "dai numeri";
    return { ...ai, fonte: "numeri", perche };
  }
  if (!c.numeri_market) return { ...ai, fonte: "ai", perche: "dal Pronostico AI: i numeri non hanno una giocata" };
  const qn = c.numeri_quota ?? null, qa = c.quota ?? null;
  if (qn != null && qa != null && qa > qn + DA_GIOCARE_SCARTO_QUOTA) {
    return {
      market: c.numeri_market, nome: c.numeri_nome || c.numeri_market, quota: qn, stimata: false, fonte: "numeri",
      perche: `dai numeri: l'AI alzava la quota da ${q(qn)} a ${q(qa)}, cioè più rischio`,
    };
  }
  const confronto = qn == null || qa == null ? "quota simile a quella dei numeri"
    : qa < qn - 0.005 ? `quota più bassa dei numeri (${q(qa)} contro ${q(qn)}), meno rischio`
    : qa > qn + 0.005 ? `quota appena più alta dei numeri (${q(qa)} contro ${q(qn)}), rischio simile`
    : `stessa quota dei numeri (${q(qa)}), stesso rischio`;
  return { ...ai, fonte: "ai", perche: `dal Pronostico AI: ${confronto}` };
}

/**
 * Il mercato e' coerente con i gol che la lettura si aspetta? (07/10/2026,
 * Croazia-Spagna: la lettura diceva 3,7 gol e "Punta su questo" a 1,75
 * proponeva MG 1-3 totali, al 46-48%.) Con 3 gol o piu' attesi niente
 * mercati da pochi gol; con 2,2 o meno niente mercati da tanti gol.
 */
export function coerenteConGol(market: string, totaleAtteso: number | null | undefined): boolean {
  if (totaleAtteso == null) return true;
  const m = market.toUpperCase().replace(/\s+/g, " ").trim();
  const pochi = /\bU(1\.5|2\.5)\b|^NG\b|MG (0|1)-(1|2|3) TOTALI|^MG 0-2\b|^MG 1-2\b|^MG 1-3\b/.test(m) && !/CASA|OSPITE/.test(m);
  const tanti = /\bO(2\.5|3\.5)\b|MG (3|4)-\d TOTALI|GG \+ O2\.5/.test(m);
  if (totaleAtteso >= 3 && pochi) return false;
  if (totaleAtteso <= 2.2 && tanti) return false;
  return true;
}

/** Intervallo di gol piu' stretto che copre almeno `soglia` dei casi (Poisson). */
export function intervalloGol(lambda: number, soglia = 0.7): [number, number] {
  const p: number[] = [];
  let f = 1;
  for (let k = 0; k <= 10; k++) { if (k > 1) f *= k; p.push(Math.exp(-lambda) * Math.pow(lambda, k) / f); }
  // Il piu' stretto; a parita' di larghezza quello che copre di piu'
  // (Slovacchia lambda 1,9: 1-3 copre il 72%, 0-2 il 70% -> 1-3).
  let best: [number, number] = [0, 10], larg = 99, copre = 0;
  for (let a = 0; a <= 10; a++) {
    let q = 0;
    for (let b = a; b <= 10; b++) {
      q += p[b];
      if (q >= soglia) {
        if (b - a < larg || (b - a === larg && q > copre)) { larg = b - a; best = [a, b]; copre = q; }
        break;
      }
    }
  }
  return best;
}

// ============================================================================
// IL CONSIGLIATO E TUTTE LE GIOCATE CON IL LORO PERCHE' (07/10/2026, Rossi)
//
// "Punterei dove tutti i dati sono d'accordo e la percentuale e' misurata, e
// lascerei le partite incerte." Regola, uguale per scheda e multipla:
//  - (dal 14/10/2026 forma e quote in contrasto NON rendono piu' la partita
//    "da lasciare": resta un avviso; le assenze sono un avviso dal 07/10);
//  - candidati: quota da 1,40 in su, percentuale MISURATA e stabile nella
//    tabella scenari (peggiore fra partite vecchie e recenti >= 58%),
//    coerenti con i gol attesi e con la direzione;
//  - vince il miglior equilibrio fra probabilita' e quota:
//    min(misurata, Poisson di questa partita) x quota.
//  Esempio Croazia-Spagna: MG 2-4 Spagna (60% x 1,55 = 0,93) batte Over 2.5
//  (piu' sicuro, 64%, ma 1,45) e MG 2-4 totali (Poisson qui 57%: rischio 5+).
// ============================================================================

export type RigaGiocata = {
  market: string;            // nome del catalogo/manuale
  nome: string;              // con i nomi delle squadre al posto di casa/ospite
  quota: number;
  stimata: boolean;
  misurata: { pA: number; pB: number; n: number } | null;
  stima: number | null;      // Poisson di questa partita (motore)
  punteggio: number | null;  // equilibrio probabilita' x quota (solo candidati)
  perche: string;
  consigliato?: boolean;
};

/**
 * Misure delle coppe europee (15/10/2026, prova-coppe.mts, quote da 1,40): mercato -> [probabilita', partite].
 * Le usano il consigliato (analizzaGiocate) e il Pronostico regole. Vuoto fuori dalle coppe o con favorita oltre 1,85.
 */
export function misureCoppaPer(q1: number, q2: number, coppaEuropea: boolean): Record<string, [number, number]> {
  if (!coppaEuropea || !(q1 > 1 && q2 > 1) || q1 === q2) return {};
  const fq = Math.min(q1, q2), s = q1 < q2 ? "1" : "2";
  if (fq > 1.85) return {};
  return fq <= 1.35 ? { [`${s} + O1.5`]: [0.57, 30], [`${s} + O2.5`]: [0.56, 72] }
    : fq <= 1.55 ? { [`${s} + O1.5`]: [0.59, 51], [s]: [0.64, 39] }
    : { [s]: [0.63, 79] };
}

export type AnalisiGiocate = {
  consigliato: RigaGiocata | null; daLasciare: string | null; avvisi: string[]; righe: RigaGiocata[];
  /** La giocata che sarebbe stata consigliata se la partita non fosse "da lasciare" (per la pagella). */
  seNonLasciata: RigaGiocata | null;
  manuali?: string[];
  /** Perche' la giocata e' esclusa dalle regole (vale anche per il Pronostico AI), o null. */
  esclusa?: (market: string) => string | null;
};

const segnoBase = (m: string) => m.trim().toUpperCase().replace(/^DC\s+/, "");
const versoCasaM = (m: string) => /^(1|1X)(\s|$|\+)/.test(segnoBase(m)) || /^1 (DNB|AH)/.test(segnoBase(m));
const versoOspiteM = (m: string) => /^(2|X2)(\s|$|\+)/.test(segnoBase(m)) || /^2 (DNB|AH)/.test(segnoBase(m));
const conSegnoM = (m: string) => versoCasaM(m) || versoOspiteM(m) || /^(X|12)(\s*\+|$)/.test(segnoBase(m));

/**
 * I PRONOSTICI DI OGNI SCENARIO (19/10/2026, Rossi: "in base allo scenario e ai risultati attesi si
 * scelgono e si valutano i pronostici appartenenti a quel tipo di scenario"). Con la valutazione AI senza
 * vincitore si aggiungono quelli dell'incertezza. Restituisce le chiavi normalizzate (MG "2-4 CASA").
 */
export function pronosticiDelloScenario(scenario: string | null | undefined, odds: Odds, aiSenzaVincitore = false): Set<string> {
  const fav: "1" | "2" = Number(odds.odd_1) <= Number(odds.odd_2) ? "1" : "2";
  const lato = fav === "1" ? "casa" : "ospite", altro = fav === "1" ? "ospite" : "casa";
  const dc = fav === "1" ? "1X" : "X2";
  const sc = String(scenario || "");
  let base: string[] = [];
  if (sc.startsWith("Gap Tecnico")) base = [fav, `MG 2-4 ${lato}`, `MG 1-3 ${lato}`, `DC ${dc} + GG`, "GG", "O2.5", "GG + O2.5"];
  else if (sc === "Gap falso") base = ["U3.5"];
  else if (sc === "Progressione") base = [fav === "1" ? "MG 1-3 casa + MG 0-2 ospite" : "MG 0-2 casa + MG 1-3 ospite", `MG 1-3 ${lato}`, fav, `DC ${dc} + O1.5`, "GG"];
  else if (sc === "Equilibrio") base = ["GG", "O2.5", "1X", "X2", "X oppure GG", "MG 2-4 totali", "MG 3-6 totali"];
  const incertezza = aiSenzaVincitore ? ["MG 1-3 casa", "MG 2-4 casa", "MG 1-3 ospite", "MG 2-4 ospite", "MG 1-3 totali", "MG 2-4 totali", "U3.5", "X oppure GG"] : [];
  void altro;
  return new Set([...base, ...incertezza].map(chiavePronostico));
}
/** "MG casa 2-4" e "MG 2-4 casa", "Over 2,5" e "O2.5" diventano la stessa chiave. */
export function chiavePronostico(m: string): string {
  return normalizeMarket(m).replace(/^MG (CASA|OSPITE|TOTALI) (\d)-(\d)$/, "MG $2-$3 $1").replace(/^OVER\s*/, "O").replace(/^UNDER\s*/, "U").replace(",", ".");
}

/**
 * MULTIGOL DELLA FAVORITA NEL GAP TECNICO (19/10/2026, Rossi, Real-Siviglia 4-1 con MG casa 1-3): la
 * sceglie la quota dell'Over 3,5. Archivio, favorita sotto 1,40: sotto 1,60 la favorita fa 5+ gol una
 * volta su tre (MG strette 49-53%) -> nessuna; 1,60-1,99 fa 2,7-3,1 gol di media, 4+ il 31-37% -> MG 2-4
 * (63-65% contro 60-65%); da 2,00 vince di misura -> MG 1-3 (70-74% contro 56-60%).
 * Restituisce il motivo dell'esclusione, o null.
 */
export function mgFavoritaEsclusa(market: string, scenario: string | null | undefined, odds: Odds): string | null {
  if (!scenario || !scenario.startsWith("Gap Tecnico")) return null;
  const o35 = Number((odds as any).odd_O35 ?? (odds as any).odd_o35);
  if (!(o35 > 1)) return null;
  const lato = Number(odds.odd_1) <= Number(odds.odd_2) ? "CASA" : "OSPITE";
  const k = normalizeMarket(market).replace(/^MG (CASA|OSPITE) (\d)-(\d)$/, "MG $2-$3 $1");
  const m = /^MG (\d)-(\d) (CASA|OSPITE)$/.exec(k);
  if (!m || m[3] !== lato || Number(m[2]) > 4) return null;
  const da = Number(m[1]), a = Number(m[2]);
  if (o35 < 1.6) return "rischio goleada (Over 3,5 sotto 1,60): niente Multigol stretta della favorita";
  if (o35 < 2 && da < 2) return "Over 3,5 sotto 2,00: la favorita fa tanti gol, meglio la Multigol 2-4";
  if (o35 >= 2 && a > 3) return "Over 3,5 da 2,00: pochi gol, meglio la Multigol 1-3 della favorita";
  return null;
}

export function analizzaGiocate(x: {
  odds: Odds;
  marketOdds: Record<string, { odd: number; estimated: boolean }> | null | undefined;
  ranking: { market: string; coverage: number }[];
  voci: Record<string, VoceTabella[]> | null | undefined;
  manuali: string[];
  totAtteso: number | null;
  direzione: "1" | "2" | null;
  casa: string; ospite: string;
  pesataCasa: { fatti: number; subiti: number } | null | undefined;
  pesataOspite: { fatti: number; subiti: number } | null | undefined;
  accordo: boolean | null | undefined;
  assentiCasa: number; assentiOspite: number;
  /** La lettura AI dice "la favorita delle quote non perde" (vince o pareggia in tutti e 3 i suoi risultati). */
  favNonPerde?: boolean;
  /** Scenario (getScenarioNote): serve per la partita "molto aperta" (15/10/2026). */
  scenario?: string | null;
  /** Champions, Europa o Conference League (15/10/2026): regole e misure delle coppe. */
  coppaEuropea?: boolean;
  /** Il Pronostico AI propone X oppure GG e i suoi 3 risultati sono pareggi o gol di tutte e due (16/10/2026). */
  xoggAI?: boolean;
  /** I 3 risultati attesi della valutazione AI (Pro se c'e', altrimenti la gratis), "a-b" (19/10/2026). */
  risultatiAI?: string[] | null;
  /** Direzione della stessa valutazione AI: "nessuna"/"X" aggiunge i pronostici dell'incertezza (19/10/2026). */
  direzioneAI?: string | null;
}): AnalisiGiocate {
  const nome = (m: string) => m.replace(/\bcasa\b/gi, x.casa).replace(/\bospite\b/gi, x.ospite);
  const pc = (p: number) => `${Math.round(p * 100)}%`;
  const g1 = (v: number) => v.toFixed(1).replace(".", ",");
  const visti = new Set<string>();
  const righe: RigaGiocata[] = [];
  const aggiungi = (m: string, q: { odd: number; stimata: boolean } | null) => {
    if (!q || !(q.odd > 1)) return;
    const k = normalizeMarket(m.replace(/\s+fisso$/i, ""));
    if (visti.has(k)) return;
    visti.add(k);
    const f = fasciaDellaQuota(q.odd);
    const v = f !== null ? (x.voci?.[f.toFixed(2)] || []).find((t) => normalizeMarket(t.market.replace(/\s+fisso$/i, "")) === k) : undefined;
    const r = x.ranking.find((t) => normalizeMarket(t.market) === k);
    righe.push({
      market: m, nome: nome(m), quota: q.odd, stimata: q.stimata,
      misurata: v ? { pA: v.pA, pB: v.pB, n: v.nA + v.nB } : null,
      stima: r ? r.coverage : null, punteggio: null, perche: "",
    });
  };
  for (const [m, q] of Object.entries(x.marketOdds || {})) aggiungi(m, { odd: q.odd, stimata: q.estimated });
  for (const m of x.manuali) aggiungi(m, quotaManuale(m, x.odds, x.marketOdds || undefined));

  // Partita da lasciare? FORMA E QUOTE NON D'ACCORDO NON BLOCCA PIU' (14/10/2026,
  // Rossi): sulle partite finite con il consigliato salvato prima del via, quelle
  // "da lasciare" per questo motivo avrebbero vinto il 65,2% (253) contro il 59,4%
  // delle giocate (631), alla stessa quota; con il contrasto la favorita delle
  // quote vince di piu' (segno +4,8 punti sul motore, 334 partite): di solito e'
  // la forma a sbagliare. Resta un avviso.
  const daLasciare: string | null = null;
  // Le assenze NON bloccano (07/10/2026, Croazia-Spagna: la Spagna con 4
  // assenti ha vinto lo stesso): il conteggio non dice se sono titolari.
  // Restano un avviso; la notizia vera la valuta il Pronostico AI.
  const avvisi: string[] = [];
  if (x.accordo === false) avvisi.push("forma e quote non sono d'accordo: valgono le quote (in questi casi la favorita delle quote vince più spesso del previsto)");
  const favAssenti = x.direzione === "1" ? x.assentiCasa : x.direzione === "2" ? x.assentiOspite : 0;
  if (favAssenti >= 3) avvisi.push(`la favorita (${x.direzione === "1" ? x.casa : x.ospite}) ha ${favAssenti} assenti: se sono titolari il Pronostico AI può cambiare la giocata`);

  const contraria = (m: string) =>
    x.direzione === null ? conSegnoM(m) && !/OPPURE/i.test(m)
      : x.direzione === "1" ? versoOspiteM(m) : versoCasaM(m);
  // Il punto debole: la squadra che segna meno contro avversari di questo livello.
  const deboleSegna = x.pesataCasa && x.pesataOspite
    ? (x.pesataCasa.fatti <= x.pesataOspite.fatti
        ? { nome: x.casa, contro: x.ospite, f: x.pesataCasa.fatti }
        : { nome: x.ospite, contro: x.casa, f: x.pesataOspite.fatti })
    : null;

  // RITORNO AL CONSIGLIATO DELLE 11 (15/10/2026 sera, Rossi: "voglio il pronostico delle 11, un
  // unico pronostico, niente scarti"): tolte le regole del 15/10 (Multigol della sfavorita, linea dei
  // 2,5 gol, archivio sotto 300 partite, coppe europee), che lasciavano 43 partite su 116 senza giocata.
  // Restano fuori le combo con il segno secco o con 12 + Over (1 + O1.5, 2 + O2.5, 12 + O1.5...);
  // 1 + U4.5 resta (16/10/2026, Rossi).
  const comboVietata = (m: string) => /^(DC )?(1|2|12) \+ O/.test(normalizeMarket(m).toUpperCase());
  // UN SOLO ELENCO PER NUMERI E AI (16/10/2026, Rossi: "perche' esce MG casa 1-2 se non e' fra i mercati
  // ammessi?"): il consigliato sceglie fra elenco generale (VERDICT_WHITELIST) + mercati dello scenario,
  // piu' X oppure GG quando l'AI lo propone e i suoi 3 risultati sono pareggi o gol di tutte e due.
  // Se nessuna giocata dell'elenco passa le soglie, resta la migliore (mai senza pronostico).
  // Prova sulle finite (666): 60,4% -> 60,8%, resa -6,5% -> -6,2%; X oppure GG dall'AI 17, 70,6%.
  const elenco = [...(x.manuali || []), ...(x.xoggAI ? ["X oppure GG"] : [])];
  const nelElenco = (m: string) => isMercatoAmmesso(m, elenco);

  // MULTIGOL DELLA FAVORITA NEL GAP (19/10/2026, Rossi): decide l'Over 3,5 (vedi mgFavoritaEsclusa).
  const mgEsclusa = (m: string) => mgFavoritaEsclusa(m, x.scenario, x.odds);
  // Candidati e punteggio
  // GG e X oppure GG senza partite simili in archivio a quella quota non si scartano: vale la stima
  // (19/10/2026, Rossi, Tromso-KFUM e Twente-Utrecht).
  const famigliaGG = (m: string) => /^(GG|X OPPURE GG)$/.test(normalizeMarket(m));
  // I RISULTATI ATTESI DELL'AI (19/10/2026, Rossi: "Real 2-0, 2-1, 3-1 -> MG casa 2-4, 1, GG, Over 2,5:
  // 2 risultati su 3 rientrano; Malmo-Hacken 0-1, 0-2, 1-1 -> non Over 2,5, X2"). Una giocata vale se vince
  // in almeno 2 dei 3 risultati; quelle che vincono in tutti e 3 vengono prima.
  const risAI = (x.risultatiAI || []).map((r) => String(r).replace(/\s/g, "")).filter((r) => /^\d+-\d+$/.test(r));
  const conAI = risAI.length === 3;
  const viteAI = (m: string) => risAI.filter((r) => evaluateMarketOutcome(m, r) === true).length;
  const dirAI = String(x.direzioneAI || "").trim().toLowerCase();
  const delloScenario = x.scenario ? pronosticiDelloScenario(x.scenario, x.odds, dirAI === "nessuna" || dirAI === "x") : null;
  const fuoriScenario = (m: string) => !!delloScenario && delloScenario.size > 0 && !delloScenario.has(chiavePronostico(m));
  for (const r of righe) {
    if (isMercatoVietato(r.market)) continue;
    if (fuoriScenario(r.market)) continue;
    if (r.quota < 1.4 || contraria(r.market) || !coerenteConGol(r.market, x.totAtteso)) continue;
    if (!r.misurata && !(famigliaGG(r.market) && r.stima != null)) continue;
    if (mgEsclusa(r.market)) continue;
    if (conAI && viteAI(r.market) < 2) continue;
    let p: number;
    if (r.misurata) {
      const pm = Math.min(r.misurata.pA, r.misurata.pB);
      if (pm < 0.58) continue;
      p = r.stima != null ? Math.min(pm, r.stima) : pm;
    } else p = r.stima!;
    if (p < 0.55) continue;
    if (comboVietata(r.market)) continue;
    r.punteggio = p * r.quota;
  }
  // GG e X oppure GG si escludono: resta quella piu' centrata nella fascia (Tromso: GG 1,75 troppo alta ->
  // X o GG 1,58; Twente: X o GG 1,41 troppo bassa -> GG 1,57).
  const coppiaGG = righe.filter((r) => r.punteggio != null && famigliaGG(r.market));
  if (coppiaGG.length === 2) {
    const lontana = (r: RigaGiocata) => Math.abs(r.quota - 1.5);
    coppiaGG.sort((a, b) => lontana(a) - lontana(b))[1].punteggio = null;
  }
  // LA PIU' FACILE (19/10/2026, Rossi: "ti devi basare su cosa e' piu' facile prendere con una quota che
  // paga minimo 1,40-1,60"; Twente-Utrecht: sceglieva MG casa 2-4 @1,52 invece di MG 1-3 @1,40, 68%).
  // Prima le giocate pagate da 1,40 a 1,60, in ordine di probabilita'; poi le altre, sempre per probabilita'.
  // Il punteggio (probabilita' x quota) resta solo per le parole del perche'. Prova del 19/10 sulle partite
  // con dossier: "la piu' probabile fra 1,40 e 1,60" 62,7% contro 60,3% del consigliato a punteggio.
  const probDi = (r: RigaGiocata) => r.punteggio! / r.quota;
  const inFascia = (r: RigaGiocata) => r.quota >= 1.4 && r.quota <= 1.6;
  const candidati = righe.filter((r) => r.punteggio != null)
    .sort((a, b) => Number(inFascia(b)) - Number(inFascia(a)) || (conAI ? viteAI(b.market) - viteAI(a.market) : 0) || probDi(b) - probDi(a) || b.punteggio! - a.punteggio!);
  const primoElenco = candidati.find((r) => nelElenco(r.market)) ?? candidati[0] ?? null;
  // GAP FALSO (18/10/2026, Rossi): solo Under 3,5, se passa le soglie; altrimenti la partita si lascia.
  const gapFalso = x.scenario === "Gap falso";
  // CLASSIFICA DELL'EQUILIBRIO (19/10/2026, Rossi: "mi trovo al bivio tra GG e Over 2,5, l'app mi deve
  // aiutare"): nell'Equilibrio con GG e Over sotto 1,80 decide la classifica dello scenario, il primo
  // mercato pagato almeno il minimo; se nessuno lo e', la partita si lascia.
  // La classifica degli scenari (margine: "il primo pagato il minimo") non decide piu' (19/10/2026, Rossi:
  // "la piu' facile"): resta da leggere nei dettagli tecnici. Prima decideva nell'Equilibrio.
  const classifica: ClassificaScenario | null = null as ClassificaScenario | null;
  const sceltaClassifica = classifica?.scelta
    ? righe.find((r) => normalizeMarket(r.market) === normalizeMarket(classifica.voci.find((v) => v.mercato === classifica.scelta)!.codice)) ?? null
    : null;
  // La probabilita' mostrata e' quella della classifica (misurata proprio su questo tipo di partita).
  if (sceltaClassifica) {
    const vc = classifica!.voci.find((v) => v.mercato === classifica!.scelta)!;
    sceltaClassifica.misurata = { pA: vc.pct / 100, pB: vc.pct / 100, n: classifica!.partite };
  }
  const primo = gapFalso ? candidati.find((r) => normalizeMarket(r.market) === "U3.5") ?? null
    : classifica ? sceltaClassifica : primoElenco;
  const lascia = gapFalso && !primo ? "Gap falso (l'avversario sta sotto 4, nessun divario vero): meglio non giocarla, oppure solo Under 3,5"
    : classifica && !primo ? `${classifica.tipo === "gap" ? "Gap Tecnico" : "Equilibrio"}: nessun mercato della classifica dello scenario è pagato il minimo, meglio lasciarla` : daLasciare;
  const consigliato = lascia ? null : primo;
  if (consigliato) consigliato.consigliato = true;
  const piuSicura = candidati.slice().sort((a, b) => probDi(b) - probDi(a))[0];

  // Il perche' di ogni riga
  for (const r of righe) {
    const pm = r.misurata ? Math.min(r.misurata.pA, r.misurata.pB) : null;
    if (r.consigliato) r.perche = classifica ? `★ consigliato: ${perchéClassifica(classifica)}.`
      : inFascia(r) ? `★ consigliato: la più facile fra quelle pagate da 1,40 a 1,60 (entra il ${pc(probDi(r))})${conAI ? `, vince in ${viteAI(r.market)} dei 3 risultati attesi (${risAI.join(", ")})` : ""}.`
      : `★ consigliato: nessuna giocata solida fra 1,40 e 1,60, questa è la più facile (entra il ${pc(probDi(r))}).`;
    else if (comboVietata(r.market)) r.perche = "combinazione con il segno secco o con 12 + Over: non si gioca.";
    else if (r.punteggio != null && !nelElenco(r.market) && r.quota >= 1.4) r.perche = "non è fra le giocate dell'elenco o dello scenario.";
    else if (r.quota < 1.4) r.perche = "sotto 1,40: vince spesso ma il guadagno è troppo basso.";
    else if (fuoriScenario(r.market)) r.perche = "non è fra i pronostici di questo scenario.";
    else if (mgEsclusa(r.market)) r.perche = `${mgEsclusa(r.market)}.`;
    else if (conAI && viteAI(r.market) < 2 && r.quota >= 1.4) r.perche = `vince solo in ${viteAI(r.market)} dei 3 risultati attesi (${risAI.join(", ")}).`;
    else if (contraria(r.market)) r.perche = x.direzione ? `va contro la favorita (${x.direzione === "1" ? x.casa : x.ospite}).` : "nessuna favorita netta: meglio non giocare il segno.";
    else if (!coerenteConGol(r.market, x.totAtteso)) r.perche = `va contro i gol attesi (circa ${g1(x.totAtteso ?? 0)}).`;
    else if (/^GG\b/i.test(r.market.trim()) && deboleSegna && deboleSegna.f <= 1.1) r.perche = `serve un gol di ${deboleSegna.nome}, che contro squadre come ${deboleSegna.contro} fa ${g1(deboleSegna.f)} a partita: quasi testa o croce.`;
    else if (r === piuSicura && consigliato && r.quota < consigliato.quota) r.perche = `la più sicura (${pc(pm!)}), ma paga meno del consigliato.`;
    else if (pm !== null && pm >= 0.58) r.perche = `buona: ${pc(r.misurata!.pA)} / ${pc(r.misurata!.pB)} in archivio${r.punteggio != null && consigliato ? ", ma rende un po' meno del consigliato" : ""}.`;
    else if (pm !== null) r.perche = `in archivio vince solo il ${pc(r.misurata!.pA)} / ${pc(r.misurata!.pB)}.`;
    else if (r.stima !== null && r.stima < 0.5) r.perche = "probabilità bassa.";
    else r.perche = "nessuna misura in archivio a questa quota: solo stima.";
  }
  // Ordine: il consigliato, poi le giocabili (da 1,40) dalla piu' probabile,
  // in fondo quelle sotto 1,40.
  const prob = (r: RigaGiocata) => (r.misurata ? Math.min(r.misurata.pA, r.misurata.pB) : r.stima ?? 0);
  righe.sort((a, b) => Number(!!b.consigliato) - Number(!!a.consigliato)
    || Number(b.quota >= 1.4) - Number(a.quota >= 1.4)
    || prob(b) - prob(a));
  // Anche il Pronostico AI non puo' proporre le combo con il segno secco o con 12 (15/10/2026).
  const esclusa = (m: string): string | null => (comboVietata(m) ? "combo con il segno secco o con 12 + Over" : null);
  return { consigliato, daLasciare: lascia, avvisi, righe, seNonLasciata: lascia ? primoElenco : null, manuali: x.manuali, esclusa };
}

// PAGELLA DEL CONSIGLIATO (07/10/2026), vedi pagella-consigliato.ts.
export type PagellaConsigliato = {
  partite_misurate: number;
  /** Partite finite con il consigliato salvato dopo il calcio d'inizio: non contano (15/10/2026). */
  escluse_dopo_il_via?: number;
  consigliato: { n: number; vinte: number; resa: number | null };
  confermati_ai: { n: number; vinte: number; resa: number | null };
  cambi_ai: { n: number; ai_vinte: number; numeri_vinte: number; esempi: string[] };
  da_lasciare: { n: number; vinte: number; resa: number | null };
  letture: Record<string, { n: number; dir_date: number; dir_ok: number; tot_ok: number; ris_ok: number }>;
  multiple: { n: number; vinte: number; finite: number; quote_vinte: number[] };
};
