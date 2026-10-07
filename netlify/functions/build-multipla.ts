import { consigliatoDi, consigliatoValido } from "./lib/letturaPartita";
import {
  structuralAnalysis, giocateAmmissibili, evaluateMarketStrict,
  type Odds, type MlScoreEntry, type RankedMarket,
} from "./lib/clusterEngine";
import { parseResult } from "./lib/marketEval";
import { classifyScenario } from "./lib/scenario";
import { leagueTier, tierLabel, type LeagueTier } from "./lib/leagueTier";
import { pgGet, pgGetAll, pgPatch, pgPost, rowToOdds, jsonResponse } from "./lib/supabaseRest";
import { readMinOdd } from "./odd-settings";

/**
 * POST /build-multipla — multipla automatica (18/09/2026, richiesta di Rossi).
 *
 * Rossi dice quante partite vuole (N) e la quota totale minima (Q). Il motore
 * sceglie da solo le N partite del giorno con la giocata piu' probabile
 * ciascuna, in modo che il prodotto delle quote arrivi a Q, e le mette in
 * Schedina. Regola dei campionati "a scalare": si riempie prima dal livello
 * 1 (le sette leghe principali), si scende al 2 e poi al 3 solo quando il
 * livello sopra e' finito (vedi lib/leagueTier.ts).
 *
 * Body:
 *  {
 *    day: "YYYY-MM-DD",          giorno (obbligatorio)
 *    events: 5,                  N partite, 1-8
 *    minTotalOdd: 13,            Q, quota totale minima
 *    minOdd?: 1.5,               soglia per gamba (default: impostazione utente)
 *    minProb?: 0.45,             pavimento di probabilita' per gamba (default 45%)
 *    maxPerLeague?: 2,           massimo partite dello stesso campionato
 *    locked?: [{ matchId, market }],   gambe che Rossi tiene (non si toccano)
 *    excludeMatches?: [matchId], partite scartate da Rossi
 *    excludeLeagues?: ["ITA2"],  campionati esclusi per oggi
 *    apply?: false,              true = scrive la Schedina (selected + pick_finale)
 *    replaceSelection?: true     con apply: svuota prima la Schedina attuale
 *  }
 *
 * Perche' e' deterministico e non chiede all'IA: "le piu' probabili dato N e
 * Q" e' un problema di numeri, e i numeri il motore li ha gia' (probabilita'
 * Poisson corretta dallo storico, quota vera del bookmaker). L'IA, se mai,
 * entrera' in una fase successiva a scegliere dentro una rosa gia' valida
 * (vedi CHANGELOG 18/09). Lezioni gia' pagate: l'IA ignora le soglie se le si
 * dice solo di rispettarle, e inventa quote.
 *
 * Le giocate per partita vengono da `giocateAmmissibili` (la stessa funzione
 * che da' il pick del motore nel dettaglio partita): whitelist, coerenza col
 * ranking, quota sopra soglia. In piu', qui, quota REALE del bookmaker (una
 * quota stimata non si puo' giocare) e probabilita' >= pavimento.
 */

type Leg = {
  match_id: string;
  squadra1: string;
  squadra2: string;
  manifestazione: string;
  tier: LeagueTier;
  tier_label: string;
  time: string;
  market: string;
  prob: number;      // 0-1
  odd: number;
  /** true se la quota e' una stima del motore (multigol/combo che il file
   *  Sisal non fornisce): a schermo va con la tilde, come nel dettaglio partita */
  odd_estimated: boolean;
  locked: boolean;
  alternatives: { market: string; prob: number; odd: number; odd_estimated: boolean }[];
  /** Quante volte quel mercato e' uscito davvero, nel database di Rossi.
   *  `scenario`: partite con la stessa lettura di quote (scenario_market_scores).
   *  `campionato`: partite concluse dello stesso campionato, calcolate al volo.
   *  null quando il campione e' troppo piccolo per dire qualcosa. */
  storico_scenario: { pct: number; total: number } | null;
  storico_campionato: { pct: number; total: number } | null;
};

type Option = { market: string; prob: number; odd: number; odd_estimated: boolean };

type Candidate = {
  match_id: string;
  squadra1: string;
  squadra2: string;
  manifestazione: string;
  tier: LeagueTier;
  time: string;
  options: Option[];   // ordinate come il ranking: la prima e' il pick del motore
  ranking: RankedMarket[];
  scenario: string;
};

const MAX_EVENTS = 8;
const MAX_ALTERNATIVES = 4;

/**
 * Pattern di mercato selezionabili (19/09/2026, scelti da Rossi).
 * Sono tutti gia' dentro la whitelist del verdetto: nessuna eccezione da fare.
 * La chiave e' quella che arriva dal frontend, il valore il nome esatto del
 * mercato nel motore.
 */
const PATTERN_MARKETS: Record<string, string> = {
  "1": "1",
  "2": "2",
  "O2.5": "O2.5",
  "GG": "GG",
  "1X": "1X",
  "X2": "X2",
};

/** Campione minimo sotto il quale una percentuale storica non significa niente. */
const MIN_CAMPIONE = 20;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body JSON non valido" }, 400);
  }

  const day = String(body?.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return jsonResponse({ error: "'day' deve essere YYYY-MM-DD" }, 400);

  const events = clampInt(body?.events, 1, MAX_EVENTS, 5);
  const minTotalOdd = Number(body?.minTotalOdd);
  if (!isFinite(minTotalOdd) || minTotalOdd < 1) return jsonResponse({ error: "'minTotalOdd' deve essere un numero >= 1" }, 400);

  const minOdd = isFinite(Number(body?.minOdd)) && Number(body.minOdd) > 1 ? Number(body.minOdd) : await readMinOdd();
  const minProb = isFinite(Number(body?.minProb)) && Number(body.minProb) > 0 && Number(body.minProb) < 1 ? Number(body.minProb) : 0.45;
  const maxPerLeague = clampInt(body?.maxPerLeague, 1, MAX_EVENTS, 2);
  const locked: { matchId: string; market: string }[] = Array.isArray(body?.locked) ? body.locked.filter((l: any) => l?.matchId && l?.market) : [];
  const excludeMatches = new Set<string>(Array.isArray(body?.excludeMatches) ? body.excludeMatches.map(String) : []);
  const excludeLeagues = new Set<string>(Array.isArray(body?.excludeLeagues) ? body.excludeLeagues.map((l: string) => String(l).toUpperCase().trim()) : []);
  // Pattern di mercato: lista vuota o assente = comportamento di sempre (il
  // motore prende la giocata piu' probabile di ogni partita). Con uno o piu'
  // pattern, per ogni partita si guardano SOLO quei mercati e si tiene il
  // migliore: la multipla si compone dalle partite dove quei pattern reggono
  // di piu'. Non c'e' una quota fissa per tipo: se in un giorno l'1 e' piu'
  // affidabile dell'Over, escono piu' "1", e viceversa.
  const patternsIn: string[] = Array.isArray(body?.patterns) ? body.patterns.map((x: any) => String(x).toUpperCase().trim()) : [];
  const patterns: string[] = [];
  for (const p of patternsIn) {
    const m = PATTERN_MARKETS[p];
    if (!m) return jsonResponse({ error: `Pattern non riconosciuto: "${p}". Ammessi: ${Object.keys(PATTERN_MARKETS).join(", ")}` }, 400);
    if (!patterns.includes(m)) patterns.push(m);
  }
  const patternSet = new Set(patterns.map((m) => m.toUpperCase()));

  // SOLO I CONSIGLIATI (07/10/2026, Rossi: "punta dove tutti i dati sono
  // d'accordo e la percentuale e' misurata, lascia le partite incerte"):
  // ogni gamba e' il consigliato della partita (o una sua alternativa
  // stabile), le partite "da lasciare" non entrano. consigliati:false =
  // il comportamento di prima (giocata piu' probabile del motore).
  // Anche con i filtri ("solo 1", "solo Over 2.5"...): le gambe restano
  // giocate SICURE, filtrate per tipo (07/10/2026, Rossi).
  const soloConsigliati = body?.consigliati !== false;
  const apply = !!body?.apply;
  const replaceSelection = body?.replaceSelection !== false;

  if (locked.length > events) return jsonResponse({ error: `Hai bloccato ${locked.length} gambe ma ne chiedi ${events}` }, 400);

  // 1) Partite del giorno senza risultato. `limit` esplicito: PostgREST tronca a
  //    1000 righe senza errore (trappola nota).
  let rows: any[];
  try {
    rows = await pgGet(`matches?day=eq.${encodeURIComponent(day)}&result=is.null&select=*&order=time.asc&limit=1000`);
  } catch (e: any) {
    return jsonResponse({ error: `Errore Supabase: ${e.message}` }, 502);
  }

  const nowRome = romeNow(); // "YYYY-MM-DD HH:MM"
  const lockedIds = new Set(locked.map((l) => l.matchId));

  // 2) Candidati: una riga per partita, con tutte le giocate ammissibili.
  //    Lo storico per scenario si legge una volta per scenario, non per partita.
  const mlCache = new Map<string, Record<string, MlScoreEntry>>();
  const candidates: Candidate[] = [];
  let skippedStarted = 0, skippedExcluded = 0, skippedNoPlay = 0, skippedNoPattern = 0;

  for (const row of rows) {
    const id = String(row.id);
    const league = String(row.manifestazione || "").toUpperCase().trim();
    const isLocked = lockedIds.has(id);
    if (!isLocked && (excludeMatches.has(id) || excludeLeagues.has(league))) { skippedExcluded++; continue; }
    if (!isLocked && hasStarted(day, row.time, nowRome)) { skippedStarted++; continue; }

    const odds: Odds = rowToOdds(row);
    const scenario = classifyScenario(odds);
    let ml = mlCache.get(scenario);
    if (!ml) { ml = await scenarioScores(scenario); mlCache.set(scenario, ml); }

    let ranking: RankedMarket[];
    try {
      ranking = structuralAnalysis(odds, minOdd, ml).ranking;
    } catch {
      continue; // quote inutilizzabili: la partita non entra
    }
    // Le quote stimate (multigol, combo) RESTANO: sono i pick che il motore
    // da' anche nel dettaglio partita e che Rossi gioca. Vengono marcate, e la
    // quota totale della multipla e' "circa" finche' contiene una stima.
    const options: Option[] = giocateAmmissibili(ranking, odds, minOdd)
      .filter((r) => r.odd !== null && r.odd !== undefined)
      .filter((r) => r.coverage >= minProb)
      // Con i pattern attivi restano solo quei mercati. `giocateAmmissibili` ha
      // gia' tolto i mercati che contraddicono la lettura della partita, quindi
      // un pattern che va contro la direzione qui non c'e' proprio: la partita
      // viene scartata invece di produrre una gamba incoerente.
      .filter((r) => !patternSet.size || patternSet.has(r.market.toUpperCase().trim()))
      .slice(0, MAX_ALTERNATIVES)
      .map((r) => ({ market: r.market, prob: round4(r.coverage), odd: r.odd as number, odd_estimated: !!r.odd_estimated }));

    // Coi consigliati la giocata non viene dal motore: la partita resta in gara.
    if (!options.length && !isLocked && !soloConsigliati) {
      if (patternSet.size) skippedNoPattern++; else skippedNoPlay++;
      continue;
    }
    candidates.push({
      match_id: id,
      squadra1: row.squadra1,
      squadra2: row.squadra2,
      manifestazione: league,
      tier: leagueTier(league),
      time: String(row.time || ""),
      options,
      ranking,
      scenario,
    });
  }

  // 2-bis) I consigliati: quelli salvati dal giro automatico (dossier) con le
  //    quote di adesso; quelli che mancano si calcolano qui, in ordine di
  //    priorita' e fino a un tetto, per non far aspettare troppo.
  let skippedLasciare = 0, skippedSenzaConsigliato = 0;
  const sicure = new Map<string, Option[]>();   // tutte le giocate sicure della partita (senza filtro)
  const motore = new Map<string, Option[]>();   // le giocate del motore (per la "gamba meno sicura")
  if (soloConsigliati && candidates.length) {
    const numeri: Record<string, any> = {};
    const tutti = candidates.map((c) => c.match_id);
    for (let i = 0; i < tutti.length; i += 80) {
      const pezzo = tutti.slice(i, i + 80).map((x) => `"${x}"`).join(",");
      try {
        for (const d of await pgGet(`dossier_web?match_id=in.(${pezzo})&select=match_id,numeri`)) numeri[d.match_id] = d.numeri;
      } catch (e) { console.error("[build-multipla] dossier", e); }
    }
    const riga = (id: string) => rows.find((r) => String(r.id) === id);
    // Priorita': nazionali e campionati maggiori, poi chi ha piu' notizie
    // (dossier FotMob con assenti/formazioni), poi l'orario.
    const notizie = (id: string) => {
      const n = numeri[id];
      if (!n) return 0;
      return (n.fotmob_id ? 1 : 0) + ((n.assenti_casa ?? 0) + (n.assenti_ospite ?? 0) > 0 ? 1 : 0) + (n.formazioni && n.formazioni !== "non disponibili" ? 1 : 0);
    };
    for (const c of candidates) { if (isNazionale(c.manifestazione)) c.tier = 1; }
    candidates.sort((a, b) => a.tier - b.tier || notizie(b.match_id) - notizie(a.match_id) || a.time.localeCompare(b.time));
    const tetto = Math.min(80, Math.max(30, events * 8));
    let calcolati = 0;
    for (const c of candidates) {
      // Anche le gambe bloccate (Altro pronostico, Altra partita, No
      // campionato, Metti in Schedina): servono le loro giocate sicure per
      // ritrovare il mercato scelto (07/10/2026: prima la richiesta falliva
      // con "X oppure GG" e i multigol del consigliato).
      let cons = consigliatoValido(numeri[c.match_id], riga(c.match_id));
      if (!cons && calcolati < tetto) {
        calcolati++;
        try { cons = await consigliatoDi(c.match_id); } catch (e) { console.error("[build-multipla] consigliato", c.match_id, e); }
      }
      if (!cons) { motore.set(c.match_id, c.options); if (!lockedIds.has(c.match_id)) c.options = []; skippedSenzaConsigliato++; continue; }
      if (cons.daLasciare) { motore.set(c.match_id, c.options); if (!lockedIds.has(c.match_id)) c.options = []; skippedLasciare++; continue; }
      const opts: Option[] = [];
      if (cons.market && cons.quota && cons.pA != null && cons.pB != null) {
        opts.push({ market: cons.market, prob: round4(Math.min(cons.pA, cons.pB)), odd: cons.quota, odd_estimated: cons.stimata });
      }
      for (const a of cons.alternative || []) opts.push({ market: a.market, prob: round4(a.p), odd: a.quota, odd_estimated: a.stimata });
      // Il consigliato e' "da 1,40 in su", indipendente dalla fascia scelta
      // (Rossi: "indipendentemente dalla quota, ma non sotto 1,40").
      sicure.set(c.match_id, opts.filter((o) => o.odd >= 1.4));
      motore.set(c.match_id, c.options);
      c.options = opts.filter((o) => o.odd >= 1.4)
        .filter((o) => !patternSet.size || patternSet.has(nomeTipo(o.market)));
      if (!c.options.length) skippedSenzaConsigliato++;
    }
  }

  // 3) Gambe bloccate da Rossi: si prendono cosi' come sono, anche se il
  //    mercato scelto non passa i filtri (e' una sua decisione).
  const legs: Leg[] = [];
  const usedIds = new Set<string>();
  for (const l of locked) {
    const c = candidates.find((x) => x.match_id === l.matchId);
    if (!c) return jsonResponse({ error: `Gamba bloccata non trovata fra le partite del giorno: ${l.matchId}` }, 400);
    const stesso = (o: Option) => o.market.toUpperCase() === l.market.toUpperCase();
    const fromOptions = c.options.find(stesso) ?? (sicure.get(c.match_id) || []).find(stesso) ?? (motore.get(c.match_id) || []).find(stesso);
    const fromRanking = c.ranking.find((r) => r.market.toUpperCase() === l.market.toUpperCase());
    const opt: Option | null = fromOptions
      ?? (fromRanking && fromRanking.odd ? { market: fromRanking.market, prob: round4(fromRanking.coverage), odd: fromRanking.odd, odd_estimated: !!fromRanking.odd_estimated } : null);
    if (!opt) return jsonResponse({ error: `Mercato "${l.market}" senza quota per la partita ${c.squadra1} - ${c.squadra2}` }, 400);
    legs.push(toLeg(c, opt, true));
    usedIds.add(c.match_id);
  }

  // 4) Riempimento a scalare: livello 1, poi 2, poi 3. Dentro un livello, la
  //    partita con la giocata piu' probabile prima. Max K per campionato.
  const pool = candidates
    .filter((c) => !usedIds.has(c.match_id) && c.options.length > 0)
    .sort((a, b) => soloConsigliati
      ? 0   // gia' in ordine: livello, notizie, orario
      : a.tier - b.tier || b.options[0].prob - a.options[0].prob || a.time.localeCompare(b.time));

  const leagueCount = () => {
    const m = new Map<string, number>();
    for (const l of legs) m.set(l.manifestazione, (m.get(l.manifestazione) || 0) + 1);
    return m;
  };

  for (const c of pool) {
    if (legs.length >= events) break;
    if ((leagueCount().get(c.manifestazione) || 0) >= maxPerLeague) continue;
    legs.push(toLeg(c, c.options[0], false));
    usedIds.add(c.match_id);
  }

  // 5) Se la quota totale non basta, si alza una gamba alla volta scegliendo
  //    sempre lo scambio che costa MENO probabilita'. Prima le alternative
  //    sulla stessa partita (non cambia campionato ne' livello), poi la
  //    sostituzione della gamba con un'altra partita, a scalare.
  const totalOdd = () => legs.reduce((p, l) => p * l.odd, 1);
  let guard = 0;
  while (totalOdd() < minTotalOdd && guard++ < 200) {
    let best: { i: number; opt: Option; cost: number } | null = null;
    legs.forEach((leg, i) => {
      if (leg.locked) return;
      const c = candidates.find((x) => x.match_id === leg.match_id)!;
      for (const opt of c.options) {
        if (opt.odd <= leg.odd) continue;
        const cost = leg.prob - opt.prob;   // probabilita' persa
        if (!best || cost < best.cost) best = { i, opt, cost };
      }
    });
    if (best) {
      const b = best as { i: number; opt: Option; cost: number };
      const c = candidates.find((x) => x.match_id === legs[b.i].match_id)!;
      legs[b.i] = toLeg(c, b.opt, false);
      continue;
    }
    // Nessuna alternativa sulla stessa partita: si cambia partita. Esce la
    // gamba libera con la quota piu' bassa, entra la migliore non usata che
    // paga di piu', cercata livello per livello.
    const weakest = legs
      .map((l, i) => ({ l, i }))
      .filter((x) => !x.l.locked)
      .sort((a, b) => a.l.odd - b.l.odd)[0];
    if (!weakest) break;
    const counts = leagueCount();
    counts.set(weakest.l.manifestazione, (counts.get(weakest.l.manifestazione) || 1) - 1);
    const replacement = pool
      .filter((c) => !usedIds.has(c.match_id))
      .filter((c) => (counts.get(c.manifestazione) || 0) < maxPerLeague)
      .map((c) => ({ c, opt: bestOptionAbove(c, weakest.l.odd) }))
      .filter((x) => !!x.opt)
      .sort((a, b) => a.c.tier - b.c.tier || b.opt!.prob - a.opt!.prob)[0];
    if (!replacement) break;
    usedIds.delete(weakest.l.match_id);
    legs[weakest.i] = toLeg(replacement.c, replacement.opt!, false);
    usedIds.add(replacement.c.match_id);
  }

  // 5-bis) Storico REALE di ogni gamba, dal database di Rossi. Due numeri:
  //   - per SCENARIO: quante volte quel mercato e' uscito in partite lette allo
  //     stesso modo dalle quote. E' il dato che il motore usa gia' internamente
  //     per correggere le probabilita': qui viene solo mostrato.
  //   - per CAMPIONATO: quante volte quel mercato e' uscito nelle partite
  //     concluse di quel campionato. Non esiste una tabella pronta, si calcola
  //     al volo — una query per campionato (al massimo 8), solo la colonna
  //     `result`, e il conteggio con la stessa funzione che assegna gli esiti.
  const storicoLega = new Map<string, string[]>();
  for (const leg of legs) {
    if (!storicoLega.has(leg.manifestazione)) {
      try {
        const done = await pgGetAll(`matches?manifestazione=eq.${encodeURIComponent(leg.manifestazione)}&result=not.is.null&select=id,result`);
        storicoLega.set(leg.manifestazione, done.map((r: any) => String(r.result || "")));
      } catch (e) {
        console.error("storico lega:", e);
        storicoLega.set(leg.manifestazione, []);   // senza storico si mostra "—"
      }
    }
  }
  for (const leg of legs) {
    const c = candidates.find((x) => x.match_id === leg.match_id);
    const ml = c ? mlCache.get(c.scenario) : undefined;
    const voce = ml?.[leg.market];
    leg.storico_scenario = voce && voce.total >= MIN_CAMPIONE
      ? { pct: Math.round(voce.win_rate * 10) / 10, total: voce.total }
      : null;

    let vinte = 0, valutate = 0;
    for (const res of storicoLega.get(leg.manifestazione) || []) {
      const parsed = parseResult(res);
      if (!parsed) continue;
      const esito = evaluateMarketStrict(leg.market, parsed[0], parsed[1]);
      if (esito === null) continue;      // mercato non valutabile su quel punteggio
      valutate++;
      if (esito) vinte++;
    }
    leg.storico_campionato = valutate >= MIN_CAMPIONE
      ? { pct: Math.round((vinte / valutate) * 1000) / 10, total: valutate }
      : null;
  }

  legs.sort((a, b) => a.tier - b.tier || a.time.localeCompare(b.time));
  const total = round2(totalOdd());
  const probAll = round4(legs.reduce((p, l) => p * l.prob, 1));
  const ok = legs.length === events && total >= minTotalOdd;

  let reason: string | null = null;
  if (legs.length < events && soloConsigliati) {
    reason = `Oggi ci sono solo ${legs.length} partite sicure${patterns.length ? ` con ${patterns.join(" / ")}` : ""} (dati d'accordo, percentuale misurata). Guarda le proposte qui sotto.`;
  } else if (legs.length < events) {
    reason = `Trovate solo ${legs.length} partite giocabili su ${events}`
      + (patterns.length ? ` con i pattern ${patterns.join(", ")}` : "")
      + ` (probabilita' >= ${Math.round(minProb * 100)}%, quota >= ${minOdd.toFixed(2)}, max ${maxPerLeague} per campionato).`
      + (patterns.length && skippedNoPattern ? ` ${skippedNoPattern} partite scartate perche' nessuno dei pattern scelti regge.` : "");
  } else if (total < minTotalOdd) {
    reason = `Con ${events} partite sicure arrivo a quota ${total.toFixed(2)}, non a ${minTotalOdd}${soloConsigliati ? ": guarda le proposte qui sotto" : ": abbassa la quota minima o aumenta le partite"}.`;
  }

  // 5-ter) PROPOSTE (07/10/2026, Rossi): con i consigliati la multipla non
  //    alza la quota con giocate rischiose ne' inventa: propone e decide lui.
  //    - poche partite sicure del tipo scelto -> completa con altre sicure /
  //      solo quelle del tipo / un evento in meno;
  //    - quota non raggiunta -> tieni / un evento in piu' / una gamba meno sicura;
  //    - tante partite -> 2-3 varianti con partite diverse.
  const proposte: Proposta[] = [];
  if (soloConsigliati && !locked.length) {
    const tutteSicure = candidates.filter((c) => (sicure.get(c.match_id) || []).length);
    const conTipo = (c: Candidate) => c.options.length > 0;
    const misto = tutteSicure.map((c) => ({ ...c, options: sicure.get(c.match_id)! }));
    const nuova = (titolo: string, legsX: Leg[], descrizione: string, avviso?: string): void => {
      if (!legsX.length) return;
      const firma = legsX.map((l) => l.match_id + l.market).sort().join("|");
      if (proposte.some((p) => p.firma === firma) || firma === legs.map((l) => l.match_id + l.market).sort().join("|")) return;
      proposte.push({ titolo, descrizione, avviso: avviso ?? null, firma, legs: legsX, total_odd: round2(legsX.reduce((p, l) => p * l.odd, 1)), total_prob: round4(legsX.reduce((p, l) => p * l.prob, 1)) });
    };
    const quanteTipo = candidates.filter(conTipo).length;
    if (patternSet.size && quanteTipo < events) {
      // Completa con altre giocate sicure: prima tutte quelle del tipo, poi le altre.
      const tipo = candidates.filter(conTipo);
      const altre = misto.filter((c) => !tipo.some((t) => t.match_id === c.match_id));
      const legsTipo = componi(tipo, quanteTipo, 1, maxPerLeague, "prob");
      const resto = componi(altre, events - legsTipo.length, Math.max(1, minTotalOdd / Math.max(1, legsTipo.reduce((p, l) => p * l.odd, 1))), maxPerLeague, "prob", legsTipo);
      const totC = round2([...legsTipo, ...resto].reduce((p, l) => p * l.odd, 1));
      nuova(`Completa con altre giocate sicure (${events} eventi)`, [...legsTipo, ...resto], `Ci sono solo ${quanteTipo} partite sicure con ${patterns.join(" / ")}: le altre ${events - legsTipo.length} sono consigliati di altro tipo${totC < minTotalOdd ? ` (quota ${totC}, sotto ${minTotalOdd})` : ""}.`);
      if (legsTipo.length) nuova(`Solo ${patterns.join(" / ")} (${legsTipo.length} eventi)`, legsTipo, `Tutte le partite sicure di oggi con questo tipo.`);
      if (events - 1 > legsTipo.length) {
        const resto1 = componi(altre, events - 1 - legsTipo.length, 1, maxPerLeague, "prob", legsTipo);
        nuova(`Un evento in meno (${events - 1} eventi)`, [...legsTipo, ...resto1], `${legsTipo.length} con ${patterns.join(" / ")} e il resto con altre giocate sicure.`);
      }
    } else if (legs.length && totalOdd() < minTotalOdd) {
      nuova(`Tieni ${legs.length} eventi a quota ${round2(totalOdd())}`, legs.slice(), "Tutte giocate sicure; quota sotto quella chiesta.");
      // Le stesse gambe + la partita sicura che paga di piu'.
      const una = componi(candidates.filter(conTipo), 1, 1, maxPerLeague, "quota", legs);
      if (una.length) {
        const piu = [...legs, ...una];
        const tq = round2(piu.reduce((p, l) => p * l.odd, 1));
        nuova(`Un evento in più (${events + 1} eventi)`, piu, `Le stesse partite più ${una[0].squadra1} - ${una[0].squadra2} (${una[0].market} @${una[0].odd})${tq < minTotalOdd ? `: quota ${tq}, ancora sotto ${minTotalOdd}` : ""}.`);
      }
      // Una gamba meno sicura: la giocata del motore piu' pagata (prob >= 50%).
      const conRischio = legs.slice();
      let meglio: { i: number; o: Option } | null = null;
      conRischio.forEach((l, i) => {
        for (const o of motore.get(l.match_id) || []) {
          if (o.odd > l.odd && o.prob >= 0.5 && (!meglio || o.odd / l.odd > meglio.o.odd / conRischio[meglio.i].odd)) meglio = { i, o };
        }
      });
      if (meglio) {
        const mm = meglio as { i: number; o: Option };
        const c = candidates.find((x) => x.match_id === conRischio[mm.i].match_id)!;
        conRischio[mm.i] = toLeg(c, mm.o, false);
        nuova(`Una gamba meno sicura`, conRischio, `${c.squadra1} - ${c.squadra2}: ${mm.o.market} @${mm.o.odd} invece di ${legs[mm.i].market}.`, `⚠ ${mm.o.market} vince circa il ${Math.round(mm.o.prob * 100)}%: è meno sicura delle altre.`);
      }
    } else if (legs.length === events && quanteTipo > events + 1) {
      const pool2 = candidates.filter(conTipo);
      nuova("Variante: più quota", componi(pool2, events, minTotalOdd, maxPerLeague, "quota"), "Le partite sicure che pagano di più.");
      nuova("Variante: altre partite", componi(pool2.filter((c) => !legs.some((l) => l.match_id === c.match_id)), events, minTotalOdd, maxPerLeague, "prob"), "Le stesse regole, senza le partite della prima proposta.");
    }
  }

  // 6) Scrittura della Schedina, solo su richiesta.
  let applied = false;
  if (apply && legs.length) {
    try {
      if (replaceSelection) await pgPatch(`matches?selected=eq.true`, { selected: false });
      const idList = legs.map((l) => `"${l.match_id}"`).join(",");
      await pgPatch(`matches?id=in.(${idList})`, { selected: true });
      // Il pick della gamba diventa il verdetto della partita (come save-verdict):
      // cosi' la pagella misura anche le multiple. Mai su partite concluse.
      for (const l of legs) {
        await pgPatch(`matches?id=eq.${encodeURIComponent(l.match_id)}&result=is.null`, {
          pick_finale: l.market,
          pick_finale_prob: l.prob,
        });
      }
      applied = true;
      // Pagella (07/10/2026): ogni multipla messa in Schedina si ricorda.
      try {
        const prima = (await pgGet("settings?key=eq.multiple_giocate&select=value"))[0]?.value || [];
        const nuova = { quando: new Date().toISOString(), day, total_odd: round2(legs.reduce((p, l) => p * l.odd, 1)), legs: legs.map((l) => ({ match_id: l.match_id, market: l.market, odd: l.odd })) };
        await pgPost("settings", { key: "multiple_giocate", value: [...prima, nuova].slice(-300) }, "resolution=merge-duplicates,return=minimal");
      } catch (e) { console.error("[build-multipla] storico multiple", e); }
    } catch (e: any) {
      return jsonResponse({ ok: false, error: `Multipla calcolata ma non salvata: ${e.message}`, legs, total_odd: total }, 502);
    }
  }

  return jsonResponse({
    ok,
    reason,
    applied,
    day,
    requested: { events, minTotalOdd, minOdd, minProb, maxPerLeague, patterns },
    total_odd: total,
    total_estimated: legs.some((l) => l.odd_estimated),
    total_prob: probAll,
    legs,
    proposte: proposte.map(({ firma: _f, ...p }) => p),
    tiers_used: Array.from(new Set(legs.map((l) => l.tier))).sort(),
    pool: { matches: rows.length, candidates: candidates.length, skipped_started: skippedStarted, skipped_excluded: skippedExcluded, skipped_no_play: skippedNoPlay, skipped_no_pattern: skippedNoPattern, solo_consigliati: soloConsigliati, skipped_da_lasciare: skippedLasciare, skipped_senza_consigliato: skippedSenzaConsigliato },
  });
};

type Proposta = { titolo: string; descrizione: string; avviso: string | null; firma: string; legs: Leg[]; total_odd: number; total_prob: number };

/** "1 fisso" -> "1", "DC 1X" -> "1X": per i filtri della multipla. */
function nomeTipo(m: string): string {
  return m.toUpperCase().replace(/\s+FISSO$/, "").replace(/^DC\s+/, "").replace(/\s+/g, "").trim();
}

/**
 * Compone n gambe da un elenco di partite, una giocata ciascuna, rispettando
 * il massimo per campionato; se la quota non basta, alza la gamba che perde
 * meno probabilita' (fra le opzioni della stessa partita).
 * ordine: "prob" (la piu' sicura), "quota" (la piu' pagata), "livello" (nazionali e livello 1).
 */
function componi(pool: Candidate[], n: number, minTot: number, maxPerLeague: number, ordine: "prob" | "quota" | "livello", gia: Leg[] = []): Leg[] {
  if (n <= 0) return [];
  const conta = new Map<string, number>();
  for (const l of gia) conta.set(l.manifestazione, (conta.get(l.manifestazione) || 0) + 1);
  const usati = new Set(gia.map((l) => l.match_id));
  const ordinati = pool.filter((c) => c.options.length && !usati.has(c.match_id)).slice().sort((a, b) =>
    ordine === "quota" ? b.options[0].odd - a.options[0].odd
      : ordine === "livello" ? a.tier - b.tier || b.options[0].prob - a.options[0].prob
        : b.options[0].prob - a.options[0].prob);
  const out: Leg[] = [];
  for (const c of ordinati) {
    if (out.length >= n) break;
    if ((conta.get(c.manifestazione) || 0) >= maxPerLeague) continue;
    out.push(toLeg(c, c.options[0], false));
    conta.set(c.manifestazione, (conta.get(c.manifestazione) || 0) + 1);
  }
  const tot = () => out.reduce((p, l) => p * l.odd, 1) * gia.reduce((p, l) => p * l.odd, 1);
  let giri = 0;
  while (tot() < minTot && giri++ < 50) {
    let best: { i: number; o: Option; cost: number } | null = null;
    out.forEach((l, i) => {
      const c = pool.find((x) => x.match_id === l.match_id)!;
      for (const o of c.options) {
        if (o.odd <= l.odd) continue;
        const cost = l.prob - o.prob;
        if (!best || cost < best.cost) best = { i, o, cost };
      }
    });
    if (!best) break;
    const b = best as { i: number; o: Option; cost: number };
    out[b.i] = toLeg(pool.find((x) => x.match_id === out[b.i].match_id)!, b.o, false);
  }
  return out;
}

/** Nazionali maggiori (07/10/2026): contano come i campionati di livello 1. */
function isNazionale(c: string): boolean {
  return /^(EURONL|EURQ|MOND|WCQ|AMINAZ|EURO$|COPAM|AFCNAZ|CONCAF)/.test(c);
}

function toLeg(c: Candidate, opt: Option, locked: boolean): Leg {
  return {
    // Lo storico si riempie dopo, quando le gambe sono decise: calcolarlo per
    // ogni candidato scartato sarebbe lavoro buttato.
    storico_scenario: null,
    storico_campionato: null,
    match_id: c.match_id,
    squadra1: c.squadra1,
    squadra2: c.squadra2,
    manifestazione: c.manifestazione,
    tier: c.tier,
    tier_label: tierLabel(c.tier),
    time: c.time,
    market: opt.market,
    prob: opt.prob,
    odd: opt.odd,
    odd_estimated: opt.odd_estimated,
    locked,
    alternatives: c.options.filter((o) => o.market !== opt.market),
  };
}

/** La giocata piu' probabile della partita che paga piu' di `odd`. */
function bestOptionAbove(c: Candidate, odd: number): Option | null {
  return c.options.filter((o) => o.odd > odd).sort((a, b) => b.prob - a.prob)[0] ?? null;
}

async function scenarioScores(scenario: string): Promise<Record<string, MlScoreEntry>> {
  const map: Record<string, MlScoreEntry> = {};
  if (!scenario || scenario === "sconosciuto") return map;
  try {
    const rows = await pgGet(`scenario_market_scores?scenario=eq.${encodeURIComponent(scenario)}&select=market,wins,losses,total&limit=1000`);
    for (const r of rows) {
      if (!r.total) continue;
      map[r.market] = { win_rate: Math.round((r.wins / r.total) * 1000) / 10, total: r.total, wins: r.wins, losses: r.losses };
    }
  } catch {
    // senza storico il motore funziona comunque
  }
  return map;
}

/** Ora italiana come "YYYY-MM-DD HH:MM": le partite sono in ora italiana. */
function romeNow(): string {
  try {
    return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" }).slice(0, 16);
  } catch {
    return new Date().toISOString().slice(0, 16).replace("T", " ");
  }
}

function hasStarted(day: string, time: any, nowRome: string): boolean {
  const t = String(time || "").slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  return `${day} ${t}` <= nowRome;
}

function clampInt(v: any, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
