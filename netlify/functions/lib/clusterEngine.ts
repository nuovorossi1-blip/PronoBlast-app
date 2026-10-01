/**
 * Motore di Inferenza Strutturale Quote — porting TypeScript di cluster_engine.py
 * ================================================================================
 * Score Cluster Simulator (Poisson) + Market Coverage + Fragility + Family Classifier
 *
 * Porting 1:1 dalla versione Python originale (backend/cluster_engine.py).
 * Nessuna dipendenza esterna: solo Math nativo.
 */
import { underAmmessiATettoAperto, inFascia } from "../../../frontend/src/api";

export type Odds = Record<string, number | string[] | undefined>;

// ============================================================
// Poisson helpers
// ============================================================

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k: number, lam: number): number {
  if (lam <= 0) return k === 0 ? 1.0 : 0.0;
  return (Math.pow(lam, k) * Math.exp(-lam)) / factorial(k);
}

function impliedProb(odd: number | undefined | null): number {
  if (!odd || odd <= 1.0) return 0.0;
  return 1.0 / odd;
}

function num(odds: Odds, key: string): number {
  const v = odds[key];
  return typeof v === "number" ? v : 0;
}

// ============================================================
// derive_lambdas
// ============================================================

/**
 * LAMBDA CERCATI, non calcolati con una formula (28/09/2026).
 *
 * Prima qui c'era `2.0 + (pOver2.5 - 0.3) * 3.5` piu' una ripartizione fra casa
 * e ospite basata sull'1X2. Misurata contro le probabilita' depurate del
 * bookmaker su due partite reali, sbagliava QUATTRO VOLTE tanto della ricerca:
 *
 *   casa favorita 1@1.15 -> formula 2.87/0.49 errore 0.326
 *                           cercati  2.67/0.71 errore 0.072
 *   ospite favorito 2@1.36 -> formula 0.82/2.45 errore 0.279
 *                             cercati  1.04/2.34 errore 0.085
 *
 * Sull'esempio 1 la formula dava all'ospite 0,49 gol attesi invece di 0,70:
 * sottostima del 30% la probabilita' che l'ospite segni. E' il difetto "GG e NG
 * appaiati mentre il book prezza 59/41" segnalato nell'audit di settembre.
 * Non e' sistematico — sulle partite equilibrate la formula azzecca — ma sulle
 * sbilanciate va fuori strada, e da qui dipendono cluster, coverage dei 54
 * mercati, ranking e verdetto.
 *
 * COME: si cercano i lambda che riproducono meglio 1, X, 2, O1.5, O2.5, O3.5 e
 * GG depurati dall'aggio. Due fasi (passo 0,10 su tutta la griglia 0,30-3,20,
 * poi 0,01 attorno al minimo): ~1.100 valutazioni invece di 84.000, stesso
 * risultato. La formula vecchia resta come punto di partenza della ricerca e
 * come ripiego se le quote 1X2 mancano.
 *
 * CACHE OBBLIGATORIA: questa funzione e' chiamata da fullDistribution,
 * structuralAnalysis, estimateMarketOdd e comboOdd, quindi decine di volte per
 * partita. Senza memoria, su una lista di 300 partite sarebbe insostenibile.
 */
const cacheLambda = new Map<string, [number, number]>();
const CHIAVI_LAMBDA = ["odd_1", "odd_X", "odd_2", "odd_O15", "odd_U15", "odd_O25", "odd_U25", "odd_O35", "odd_U35", "odd_GG", "odd_NG"];

function quotaDi(odds: Odds, nome: string): number {
  return num(odds, nome) || num(odds, nome.toLowerCase());
}

/** Probabilita' depurate: due esiti complementari, tolto l'aggio. */
function coppiaDepurata(a: number, b: number, dflt: number): number {
  if (!a || !b) return dflt;
  const pa = impliedProb(a), pb = impliedProb(b);
  const t = pa + pb;
  return t > 0 ? pa / t : dflt;
}

function probabilitaPoisson(lh: number, la: number, max = 8) {
  let p1 = 0, pX = 0, p2 = 0, o15 = 0, o25 = 0, o35 = 0, gg = 0;
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const p = poisson(h, lh) * poisson(a, la);
      if (h > a) p1 += p; else if (h === a) pX += p; else p2 += p;
      if (h + a > 1) o15 += p;
      if (h + a > 2) o25 += p;
      if (h + a > 3) o35 += p;
      if (h > 0 && a > 0) gg += p;
    }
  }
  return { p1, pX, p2, o15, o25, o35, gg };
}

export function deriveLambdas(odds: Odds): [number, number] {
  const chiave = CHIAVI_LAMBDA.map((k) => quotaDi(odds, k) || 0).join("|");
  const memo = cacheLambda.get(chiave);
  if (memo) return memo;

  const q1 = quotaDi(odds, "odd_1"), qX = quotaDi(odds, "odd_X"), q2 = quotaDi(odds, "odd_2");
  if (!q1 || !qX || !q2) {
    const ripiego = deriveLambdasFormula(odds);
    cacheLambda.set(chiave, ripiego);
    return ripiego;
  }
  const sTot = impliedProb(q1) + impliedProb(qX) + impliedProb(q2);
  const fair = {
    p1: impliedProb(q1) / sTot, pX: impliedProb(qX) / sTot, p2: impliedProb(q2) / sTot,
    o15: coppiaDepurata(quotaDi(odds, "odd_O15"), quotaDi(odds, "odd_U15"), 0.75),
    o25: coppiaDepurata(quotaDi(odds, "odd_O25"), quotaDi(odds, "odd_U25"), 0.5),
    o35: coppiaDepurata(quotaDi(odds, "odd_O35"), quotaDi(odds, "odd_U35"), 0.3),
    gg: coppiaDepurata(quotaDi(odds, "odd_GG"), quotaDi(odds, "odd_NG"), 0.5),
  };
  const errore = (lh: number, la: number) => {
    const p = probabilitaPoisson(lh, la);
    return Math.abs(p.p1 - fair.p1) + Math.abs(p.pX - fair.pX) + Math.abs(p.p2 - fair.p2)
      + Math.abs(p.o15 - fair.o15) + Math.abs(p.o25 - fair.o25) + Math.abs(p.o35 - fair.o35)
      + Math.abs(p.gg - fair.gg);
  };

  let bh = 1, ba = 1, be = Infinity;
  for (let lh = 0.3; lh <= 3.2001; lh += 0.1) {
    for (let la = 0.3; la <= 3.2001; la += 0.1) {
      const e = errore(lh, la);
      if (e < be) { be = e; bh = lh; ba = la; }
    }
  }
  const h0 = bh, a0 = ba;
  for (let lh = Math.max(0.3, h0 - 0.1); lh <= Math.min(3.2, h0 + 0.1001); lh += 0.01) {
    for (let la = Math.max(0.3, a0 - 0.1); la <= Math.min(3.2, a0 + 0.1001); la += 0.01) {
      const e = errore(lh, la);
      if (e < be) { be = e; bh = lh; ba = la; }
    }
  }
  const out: [number, number] = [round3(bh), round3(ba)];
  cacheLambda.set(chiave, out);
  return out;
}

/** La vecchia formula lineare. Tenuta come ripiego quando manca l'1X2, e come
 *  termine di paragone quando si vorra' rimisurare la differenza. */
export function deriveLambdasFormula(odds: Odds): [number, number] {

  const o25 = num(odds, "odd_O25") || num(odds, "odd_o25");
  const u25 = num(odds, "odd_U25") || num(odds, "odd_u25");

  let pOver25: number;
  if (o25 && u25) {
    const pO = impliedProb(o25);
    const pU = impliedProb(u25);
    const s = pO + pU;
    pOver25 = s > 0 ? pO / s : 0.5;
  } else {
    pOver25 = 0.5;
  }

  let lamTotal = 2.0 + (pOver25 - 0.3) * 3.5;
  lamTotal = Math.max(1.5, Math.min(4.5, lamTotal));

  const o1 = num(odds, "odd_1");
  const o2 = num(odds, "odd_2");
  const oX = num(odds, "odd_X");
  const p1 = impliedProb(o1);
  const p2 = impliedProb(o2);
  const pX = impliedProb(oX);
  const homeStrength = p1 + pX * 0.5;
  const awayStrength = p2 + pX * 0.5;
  const s = homeStrength + awayStrength || 1.0;
  let homeShare = homeStrength / s;
  let awayShare = awayStrength / s;

  const pGG = impliedProb(num(odds, "odd_GG"));
  const pNG = impliedProb(num(odds, "odd_NG"));
  if (pGG + pNG > 0) {
    const ggFactor = pGG / (pGG + pNG);
    if (ggFactor > 0.5) {
      const blend = (ggFactor - 0.5) * 0.5;
      homeShare = homeShare * (1 - blend) + 0.5 * blend;
      awayShare = 1.0 - homeShare;
    }
  }

  const lamHome = lamTotal * homeShare;
  const lamAway = lamTotal * awayShare;
  return [round3(lamHome), round3(lamAway)];
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ============================================================
// simulate_cluster
// ============================================================

export type ClusterEntry = {
  score: string;
  home: number;
  away: number;
  p: number;
  compatibility: "high" | "medium" | "low";
};

export function simulateCluster(odds: Odds, maxGoals = 6, topK = 12): ClusterEntry[] {
  const [lamH, lamA] = deriveLambdas(odds);
  const grid: [number, number, number][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      grid.push([h, a, poisson(h, lamH) * poisson(a, lamA)]);
    }
  }
  const total = grid.reduce((s, g) => s + g[2], 0) || 1.0;
  const normalized = grid.map(([h, a, p]) => [h, a, p / total] as [number, number, number]);
  normalized.sort((x, y) => y[2] - x[2]);

  const out: ClusterEntry[] = [];
  for (const [h, a, p] of normalized.slice(0, topK)) {
    if (p < 0.005) break;
    const compatibility = p >= 0.1 ? "high" : p >= 0.06 ? "medium" : "low";
    out.push({ score: `${h}-${a}`, home: h, away: a, p: round4(p), compatibility });
  }
  return out;
}

// ============================================================
// full_distribution — FASE 1
// ============================================================

/**
 * Restituisce TUTTA la distribuzione dei risultati (49 celle con maxGoals=6),
 * normalizzata, senza tagli.
 *
 * Perché esiste. `simulateCluster` restituisce solo i primi K risultati: è
 * giusto per MOSTRARE all'utente i punteggi più probabili, ma è sbagliato per
 * CALCOLARE la probabilità di un mercato. Gli 8 risultati del cluster centrale
 * coprono in media il 60-75% della probabilità totale, e il pezzo tagliato non
 * è neutro: i risultati con uno zero (1-0, 2-0, 0-1) sono pochi e concentrati,
 * quindi finiscono quasi tutti dentro il taglio, mentre i risultati da GG/Over
 * sono tanti e piccoli e restano quasi tutti fuori.
 *
 * L'effetto misurato sulle 5.160 partite storiche era una distorsione
 * sistematica: NG dato al 55,6% quando la realtà era il 46,2%, O2.5 dato al
 * 34,8% quando la realtà era il 51,2%. Sulla distribuzione completa lo stesso
 * modello dà 49,5% e 51,0% — praticamente centrato.
 */
export function fullDistribution(odds: Odds, maxGoals = 6, lambdaEspliciti?: [number, number]): ClusterEntry[] {
  // `lambdaEspliciti` serve solo al backtest, per rigiocare le stesse partite
  // con la formula lineare vecchia e confrontare. In tutti gli altri casi i
  // lambda si ricavano come sempre.
  const [lamH, lamA] = lambdaEspliciti ?? deriveLambdas(odds);
  const cells: [number, number, number][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(h, lamH) * poisson(a, lamA);
      cells.push([h, a, p]);
      total += p;
    }
  }
  if (total <= 0) return [];
  return cells.map(([h, a, p]) => ({
    score: `${h}-${a}`,
    home: h,
    away: a,
    p: p / total,
    compatibility: (p / total >= 0.1 ? "high" : p / total >= 0.06 ? "medium" : "low") as ClusterEntry["compatibility"],
  }));
}

// ============================================================
// evaluate_market_strict
// ============================================================

export function evaluateMarketStrict(market: string, home: number, away: number): boolean | null {
  const total = home + away;
  const m = market.trim().toUpperCase().replace(/ {2}/g, " ");

  // BUG CORRETTO (25/07/2026): questo blocco stava IN FONDO alla funzione,
  // dopo il controllo sui multigol. Risultato: "MG 1-2 casa + MG 0-2 ospite"
  // veniva intercettato da `m.includes("MG")`, che prendeva il primo range
  // trovato (1-2) e, trovando la parola CASA nella stringa, valutava solo i
  // gol di casa ignorando tutto quello che veniva dopo il "+". Su un 2-4
  // rispondeva "vinto" quando l'ospite era fuori range.
  // Le combo vanno spezzate PRIMA di qualunque controllo su un singolo
  // mercato, altrimenti ogni combo che contiene un multigol è sbagliata.
  if (m.includes("+")) {
    const parts = market.split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const results = parts.map((p) => evaluateMarketStrict(p, home, away));
      if (results.some((r) => r === null)) return null;
      return results.every((r) => r === true);
    }
  }

  if (m === "1") return home > away;
  if (m === "X") return home === away;
  if (m === "2") return away > home;
  if (m === "1X" || m === "DC 1X") return home >= away;
  if (m === "X2" || m === "DC X2") return away >= home;
  if (m === "12" || m === "DC 12") return home !== away;
  if (m === "GG") return home > 0 && away > 0;
  if (m === "NG") return home === 0 || away === 0;
  // Combo bookmaker "X oppure GG" (manuale EQUILIBRIO): pareggio (0-0
  // compreso) oppure entrambe a segno; perde solo sulle vittorie a rete
  // inviolata. Stessa regola di esitoMercato nel frontend.
  if (m === "X OPPURE GG" || m === "X O GG") return home === away || (home > 0 && away > 0);

  for (const o of ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]) {
    if (m === `O${o}`) return total > parseFloat(o);
    if (m === `U${o}`) return total < parseFloat(o);
  }

  if (m.includes("MG")) {
    const rng = m.match(/(\d+)\s*-\s*(\d+)/);
    if (rng) {
      const lo = parseInt(rng[1], 10);
      const hi = parseInt(rng[2], 10);
      if (m.includes("CASA")) return lo <= home && home <= hi;
      if (m.includes("OSPITE")) return lo <= away && away <= hi;
      return lo <= total && total <= hi;
    }
  }

  return null;
}

// ============================================================
// coverage_for_market / fragility_score
// ============================================================

export function coverageForMarket(
  market: string,
  cluster: ClusterEntry[]
): { coverage: number; covered: string[]; broken: string[] } {
  if (!cluster.length) return { coverage: 0, covered: [], broken: [] };
  const totalP = cluster.reduce((s, c) => s + c.p, 0) || 1.0;
  const covered: string[] = [];
  const broken: string[] = [];
  let covP = 0;
  for (const c of cluster) {
    const outcome = evaluateMarketStrict(market, c.home, c.away);
    if (outcome === true) {
      covered.push(c.score);
      covP += c.p;
    } else if (outcome === false) {
      broken.push(c.score);
    }
  }
  return { coverage: round4(covP / totalP), covered, broken };
}

export function fragilityScore(market: string, cluster: ClusterEntry[]): number {
  if (!cluster.length) return 0;
  const totalP = cluster.reduce((s, c) => s + c.p, 0) || 1.0;
  let failP = 0;
  for (const c of cluster) {
    if (evaluateMarketStrict(market, c.home, c.away) === false) failP += c.p;
  }
  return round4(failP / totalP);
}

// ============================================================
// classify_family
// ============================================================

export type FamilyStructure = {
  family: string;
  dominance: string;
  offensive_profile: string;
  goal_compression: "high" | "medium" | "low";
  goal_floor: number;
  goal_ceiling: number;
  goal_ceiling_open: boolean;
  goal_range: string;
  lambda_home: number;
  lambda_away: number;
};

export function classifyFamily(odds: Odds): FamilyStructure {
  const o1 = num(odds, "odd_1") || 99;
  const o2 = num(odds, "odd_2") || 99;
  const oGG = num(odds, "odd_GG") || 99;
  const oNG = num(odds, "odd_NG") || 99;
  const oO15 = num(odds, "odd_O15") || 99;
  const oU15 = num(odds, "odd_U15") || 99;
  const oO25 = num(odds, "odd_O25") || 99;
  const oU25 = num(odds, "odd_U25") || 99;
  const oU35 = num(odds, "odd_U35") || 99;
  const oO35 = num(odds, "odd_O35") || 99;

  let dominance: string;
  if (o1 <= 1.5) dominance = "strong_home";
  else if (o1 <= 1.85) dominance = "light_home";
  else if (o2 <= 1.5) dominance = "strong_away";
  else if (o2 <= 1.85) dominance = "light_away";
  else dominance = "none";

  let offensiveProfile: string;
  if (oGG <= 1.65) offensiveProfile = "reciprocity_high";
  else if (oGG <= 1.85) offensiveProfile = "moderate";
  else if (oNG <= 1.7) offensiveProfile = "defensive";
  else offensiveProfile = "neutral";

  // GOAL FLOOR
  let goalFloor: number;
  if (oO15 <= 1.2 && oU15 >= 4.0) goalFloor = 2;
  else if (oO15 <= 1.3 && oU15 >= 3.0) goalFloor = 2;
  else goalFloor = 0;

  // GOAL CEILING
  let goalCeiling: number;
  let goalCeilingOpen: boolean;
  if (oU25 <= 1.4) {
    goalCeiling = 2;
    goalCeilingOpen = false;
  } else if (oU35 <= 1.15) {
    goalCeiling = 3;
    goalCeilingOpen = false;
  } else if (oU35 <= 1.4 && oO35 >= 3.0) {
    goalCeiling = 4;
    goalCeilingOpen = false;
  } else if (oU35 <= 1.85 && oO35 >= 2.5) {
    goalCeiling = 4;
    goalCeilingOpen = false;
  } else if (oU35 <= 1.85 && oO35 >= 2.2) {
    goalCeiling = 7;
    goalCeilingOpen = true;
  } else {
    goalCeiling = 7;
    goalCeilingOpen = true;
  }

  const goalCompression: "high" | "medium" | "low" =
    oU35 <= 1.4 && oO35 >= 2.8 ? "high" : oU35 <= 1.7 ? "medium" : "low";

  const extremeFav = o1 <= 1.35 || o2 <= 1.35;
  const hasFavorite = o1 <= 1.85 || o2 <= 1.85;
  const isOffensive = oO25 <= 1.85 || oGG <= 1.85;
  const isClosed = oU25 <= 1.7 || oNG <= 1.7;

  let family: string;
  if (goalCeilingOpen && hasFavorite) family = "DOMINANZA_OVER";
  else if (goalCeilingOpen && isOffensive) family = "EQUILIBRATA_OFFENSIVA";
  else if (!hasFavorite && isOffensive && goalCeiling <= 4) family = "EQUILIBRATA_OFFENSIVA";
  else if (!hasFavorite && isClosed) family = "EQUILIBRATA_CHIUSA";
  else if (extremeFav && oNG <= 1.95 && oU35 <= 1.65) family = "DOMINANZA_CHIUSA";
  else if (hasFavorite && goalCeiling <= 4 && !goalCeilingOpen) family = "DOMINANZA_CON_TETTO";
  else if (hasFavorite && oO25 <= 1.65) family = "DOMINANZA_OVER";
  else if (goalCeiling <= 2) family = "BLOCCATA";
  else family = "INSTABILE";

  const [lamHome, lamAway] = deriveLambdas(odds);

  return {
    family,
    dominance,
    offensive_profile: offensiveProfile,
    goal_compression: goalCompression,
    goal_floor: goalFloor,
    goal_ceiling: goalCeiling,
    goal_ceiling_open: goalCeilingOpen,
    goal_range: `${goalFloor}-${goalCeilingOpen ? "∞" : goalCeiling}`,
    lambda_home: lamHome,
    lambda_away: lamAway,
  };
}

// ============================================================
// Coherence filter
// ============================================================

const INCOHERENCE_PAIRS: [string, string][] = [
  ["1", "2"], ["1", "X"], ["1", "X2"],
  ["2", "X"], ["2", "1X"],
  ["1X", "X2"],
  ["GG", "NG"],
  ["O1.5", "U1.5"], ["O2.5", "U2.5"], ["O3.5", "U3.5"],
  ["O2.5", "U3.5"], ["O1.5", "U2.5"],
];

function normMarket(m: string): string {
  return (m || "").trim().toUpperCase().replace(/DC /g, "").replace(/ {2}/g, " ");
}

export function areIncoherent(a: string, b: string): boolean {
  const na = normMarket(a);
  const nb = normMarket(b);
  if (na === nb) return false;
  for (const [x, y] of INCOHERENCE_PAIRS) {
    if ((na.includes(x) && nb.includes(y)) || (na.includes(y) && nb.includes(x))) {
      if ((na.startsWith(x) && nb.startsWith(y)) || (na.startsWith(y) && nb.startsWith(x))) {
        return true;
      }
    }
  }
  if (na.includes("+") && nb.includes("+")) {
    if ((na.includes("O") && nb.includes("U")) || (na.includes("U") && nb.includes("O"))) {
      return true;
    }
  }
  return false;
}

export function filterCoherent<T extends { market?: string }>(pick: string, candidates: T[]): T[] {
  return candidates.filter((c) => !areIncoherent(pick, c.market || ""));
}

// ============================================================
// Candidate markets
// ============================================================

export const CANDIDATE_MARKETS: string[] = [
  "1", "X", "2", "1X", "X2", "12",
  "O1.5", "U1.5", "O2.5", "U2.5", "U3.5",
  "GG", "NG",
  "MG 1-2 totali", "MG 1-3 totali", "MG 1-4 totali",
  "MG 2-3 totali", "MG 2-4 totali", "MG 2-5 totali",
  "MG 3-4 totali", "MG 3-5 totali",
  // Sostituisce O3.5 su richiesta di Rossi: stesso territorio (partita da molti
  // gol) ma con un tetto sopra, quindi non si perde su una goleada da 7+.
  "MG 3-6 totali",
  "MG 1-2 casa", "MG 1-3 casa", "MG 2-3 casa", "MG 2-4 casa",
  "MG 1-2 ospite", "MG 1-3 ospite", "MG 2-3 ospite", "MG 2-4 ospite",
  // Combo multigol casa + ospite. Aggiunte SIMMETRICHE: per ogni combinazione
  // esiste il suo specchio, così una partita dove domina l'ospite è coperta
  // esattamente come una dove domina la casa.
  // Frequenze reali sulle 5.160 partite storiche (quota stimata col margine
  // medio del book): 1-3+0-2 59,9% @1,53 | 1-2+0-3 55,2% @1,66 |
  // 0-2+1-3 53,9% @1,70 | 0-3+1-2 53,0% @1,73 | 1-2+0-2 50,0% @1,83.
  // Le altre combinazioni proposte sono state scartate: o non superano mai la
  // soglia di quota (0-3 + 0-3 vale 1,03), o stanno sotto il 40% di riuscita
  // (2-4 casa + 1-2 ospite: 23,4%).
  "MG 1-3 casa + MG 0-2 ospite",
  "MG 0-2 casa + MG 1-3 ospite",
  "MG 1-2 casa + MG 0-3 ospite",
  "MG 0-3 casa + MG 1-2 ospite",
  "MG 1-2 casa + MG 0-2 ospite",
  "1 + O1.5", "2 + O1.5", "1 + O2.5", "2 + O2.5",
  "1 + U4.5", "2 + U4.5",
  "GG + O2.5",
  // Manuale EQUILIBRIO (01/10/2026, decisione di Rossi): giocabile, quota
  // stimata GG x 0,90 (vedi estimateMarketOdd).
  "X oppure GG",
  "DC 1X + O1.5", "DC X2 + O1.5", "DC 12 + O1.5",
  "DC 1X + O2.5", "DC X2 + O2.5", "DC 12 + O2.5",
  "DC 1X + U3.5", "DC X2 + U3.5", "DC 12 + U3.5",
  "DC 1X + GG", "DC X2 + GG", "DC 12 + GG",
];

// ============================================================
// combo odd estimation
// ============================================================

/**
 * Stima teorica della quota di un mercato per cui il bookmaker NON ci ha dato
 * un prezzo (nel nostro caso: tutti i multigol e diverse combo, che il file
 * Sisal non contiene).
 *
 * Come funziona: probabilità dalla distribuzione di Poisson, quota equa = 1/p,
 * poi si applica il margine del bookmaker preso DA QUESTA STESSA PARTITA
 * (la somma delle probabilità implicite di 1/X/2, tipicamente 1,09). Non è un
 * margine inventato: è quello che il book sta applicando in quel momento.
 *
 * Verificato sulle 5.160 partite storiche: la probabilità stimata così
 * coincide con la frequenza reale entro 1-2 punti
 * (MG 2-4 totali 60,8% stimato / 59,9% reale; MG 1-2 casa 55,7% / 57,5%;
 * MG 2-4 ospite 32,0% / 33,2%).
 *
 * ATTENZIONE: una quota stimata NON va usata per calcolare l'Expected Value.
 * Sarebbe circolare — la quota deriva dalla stessa probabilità con cui si
 * calcolerebbe l'EV, quindi l'EV verrebbe sempre pari al margine cambiato di
 * segno (circa -9%) per ogni mercato stimato. L'EV resta calcolato solo sulle
 * quote reali.
 */
/** Quota di "X oppure GG": il bookmaker non la da' nel palinsesto; regola di
 *  Rossi (01/10/2026) = quota GG meno il 10%. null senza quota GG. */
export function quotaXoppureGG(odds: Odds): number | null {
  const gg = num(odds, "odd_GG");
  return gg ? Math.round(gg * 0.9 * 100) / 100 : null;
}

export function estimateMarketOdd(market: string, odds: Odds): number | null {
  if (/^X\s+(OPPURE|O)\s+GG$/i.test(market.trim())) return quotaXoppureGG(odds);
  try {
    const [lamH, lamA] = deriveLambdas(odds);
    const maxGoals = 8;
    let totalP = 0;
    let matchP = 0;
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = poisson(h, lamH) * poisson(a, lamA);
        totalP += p;
        if (evaluateMarketStrict(market, h, a) === true) matchP += p;
      }
    }
    if (totalP <= 0 || matchP <= 0) return null;
    const prob = matchP / totalP;
    const p1 = impliedProb(num(odds, "odd_1"));
    const px = impliedProb(num(odds, "odd_X"));
    const p2 = impliedProb(num(odds, "odd_2"));
    let overround = p1 && px && p2 ? p1 + px + p2 : 1.06;
    if (overround <= 0) overround = 1.06;
    const fairOdd = 1.0 / prob;
    const est = fairOdd / overround;
    return est >= 1.01 ? round2(est) : null;
  } catch {
    return null;
  }
}

const ODD_MAP: Record<string, string> = {
  "1": "odd_1", X: "odd_X", "2": "odd_2",
  "1X": "odd_1X", X2: "odd_X2", "12": "odd_12",
  "O1.5": "odd_O15", "U1.5": "odd_U15",
  "O2.5": "odd_O25", "U2.5": "odd_U25",
  "O3.5": "odd_O35", "U3.5": "odd_U35",
  GG: "odd_GG", NG: "odd_NG",
};

/** true se il bookmaker fornisce davvero un prezzo per QUESTO mercato esatto. */
export function ODD_MAP_HAS(market: string): boolean {
  const m = market.trim().toUpperCase().replace(/DC /g, "").replace(/ {2}/g, " ");
  return !!ODD_MAP[m];
}

/**
 * Combo "mista": unisce un mercato 1X2/doppia-chance/GG a un Over-Under.
 * Le combo di soli multigol NON sono miste e restano in gioco.
 */
export function isMixedCombo(market: string): boolean {
  if (!market.includes("+")) return false;
  return !market.split("+").every((p) => p.trim().toUpperCase().startsWith("MG"));
}

/**
 * Mercati ammessi nel VERDETTO FINALE, decisi da Rossi.
 *
 * Il ranking strutturale continua a mostrare tutto: serve a capire cosa pensa
 * il motore. Ma la giocata consigliata deve uscire solo da questa lista, che e'
 * quella che lui gioca davvero.
 *
 * Fuori per scelta esplicita: tutte le combo con **DC 12** (copre due esiti su
 * tre e non ha senso come giocata), i multigol semplici e le combo di multigol,
 * il segno secco, U1.5/U2.5/O3.5.
 */
export const VERDICT_WHITELIST = [
  "1", "2",
  "1X", "X2",
  // NG tolto il 18/09/2026 su decisione di Rossi: non lo gioca. Resta nel
  // catalogo e nel ranking strutturale, ma non puo' piu' diventare la giocata.
  "GG",
  "O2.5",
  "MG 2-4 totali", "MG 3-6 totali",
  "GG + O2.5",
  "DC 1X + O1.5", "DC X2 + O1.5",
  "DC 1X + O2.5", "DC X2 + O2.5",
  "DC 1X + U3.5", "DC X2 + U3.5",
  "DC 1X + GG", "DC X2 + GG",
  // Ticket 6-bis (decisione C di Rossi, 30/09): direzione secca + pochi gol.
  "1 + U4.5",
  // "X oppure GG" NON e' qui: e' un mercato del manuale EQUILIBRIO e diventa
  // giocabile solo nelle partite di quello scenario (candidatiManuale, api.ts).
];

/**
 * Mercati tolti dalla whitelist ma che restano una LETTURA della partita.
 * Non possono diventare la giocata, pero' continuano a: (a) vietare i mercati
 * che li contraddicono e stanno piu' in basso nel ranking, (b) rendere ambigua
 * la loro famiglia quando sono appaiati al proprio opposto.
 *
 * Senza questo, togliendo NG dalla whitelist (18/09/2026) si perdeva la lettura
 * difensiva: in una partita con NG al 61% il verdetto poteva scivolare su GG al
 * 39% appena le alternative andavano sotto soglia. Cioe' l'esatto contrario di
 * quello che Rossi ha chiesto, e la stessa incoerenza gia' corretta il 27/07.
 */
export const VETO_ONLY_MARKETS = ["NG"];

function isVetoOnly(market: string): boolean {
  const n = market.trim().toUpperCase().replace(/ {2,}/g, " ");
  return VETO_ONLY_MARKETS.some((m) => m.toUpperCase() === n);
}

/** true se il mercato puo' comparire come giocata consigliata. */
export function isVerdictMarket(market: string): boolean {
  const n = market.trim().toUpperCase().replace(/ {2,}/g, " ");
  return VERDICT_WHITELIST.some((m) => m.toUpperCase() === n);
}

/** Quota di ogni mercato del catalogo: reale se il bookmaker la fornisce,
 *  altrimenti stimata. Una sola sede: la usano /predict (market_odds per la
 *  scheda) e il verdetto server (validazione delle fasce AI). */
export function quoteCatalogo(odds: Odds): Record<string, { odd: number; estimated: boolean }> {
  const out: Record<string, { odd: number; estimated: boolean }> = {};
  for (const m of CANDIDATE_MARKETS) {
    const reale = comboOdd(m, odds);
    const q = reale ?? estimateMarketOdd(m, odds);
    if (q && q > 1) out[m] = { odd: Math.round(q * 100) / 100, estimated: reale === null };
  }
  return out;
}

export function comboOdd(market: string, odds: Odds): number | null {
  const m = market.trim().toUpperCase().replace(/DC /g, "").replace(/ {2}/g, " ");
  if (ODD_MAP[m]) {
    const v = num(odds, ODD_MAP[m]);
    return v || null;
  }
  // GG + O2.5 (formula di Rossi, 01/10/2026): l'unico risultato con GG ma
  // senza Over 2,5 e' l'1-1, quindi P(combo) = P(GG) - P(1-1) e
  //   quota = 1 / (1/quota GG - 1/quota 1-1).
  // Il palinsesto non ha la quota del risultato esatto: P(1-1) viene dal
  // Poisson del motore (stessi lambda del ranking). Senza quota GG, o con un
  // risultato assurdo, si torna alla stima Poisson pura qui sotto.
  if (m === "GG + O2.5") {
    const gg = num(odds, "odd_GG");
    if (gg) {
      const [lamH, lamA] = deriveLambdas(odds);
      const p11 = poisson(1, lamH) * poisson(1, lamA);
      const pCombo = 1 / gg - p11;
      if (pCombo > 0.02) return Math.round((1 / pCombo) * 100) / 100;
    }
  }
  if (m.includes("+")) {
    // BUG CORRETTO (26/07/2026). Qui si moltiplicavano le due quote:
    // `DC 12 + O2.5` diventava 1,18 x 1,48 = 1,746. Moltiplicare vale solo per
    // eventi INDIPENDENTI, e "non finisce in pareggio" e "almeno 3 gol" non lo
    // sono affatto: crescono insieme. Il prodotto sovrastima quindi la quota,
    // e il numero veniva anche mostrato con la "@" come se fosse un prezzo
    // letto dal bookmaker, mentre nel file Sisal quella combo non esiste.
    //
    // La stima di Poisson tiene conto della correlazione perche' conta i
    // risultati esatti in cui ENTRAMBI gli eventi si verificano: sulla stessa
    // partita da 1,66 invece di 1,746.
    const est = estimateMarketOdd(market, odds);
    if (est) return est;
  }
  return null;
}

// ============================================================
// structural_analysis — main entry
// ============================================================

export type MlScoreEntry = { win_rate: number; total: number; wins?: number; losses?: number };

export type RankedMarket = {
  market: string;
  coverage: number;
  fragility: number;
  fragility_label: "alta" | "media" | "bassa";
  covered_scores: string[];
  broken_by: string[];
  score: number;
  odd: number | null;
  /** true se `odd` è una stima nostra e non un prezzo letto dal bookmaker */
  odd_estimated?: boolean;
  /** probabilità grezza di Poisson, prima della correzione con lo storico */
  coverage_poisson?: number;
  ev: number | null;
  ml_adjustment?: { type: "boost" | "malus" | "neutral"; win_rate: number; total: number; delta: string };
  opposes_pick?: boolean;
};

export type StructuralAnalysisResult = {
  structure: FamilyStructure;
  cluster: ClusterEntry[];
  central_cluster: ClusterEntry[];
  ranking: RankedMarket[];
  pick: RankedMarket | null;
  explanation: string;
};

export function structuralAnalysis(
  odds: Odds,
  minOdd = 1.4,
  mlScores?: Record<string, MlScoreEntry> | null,
  /** Solo per il backtest: `true` rigioca la partita con la vecchia formula
   *  lineare invece della ricerca sulla griglia. Non usato in produzione. */
  lambdaVecchi = false,
): StructuralAnalysisResult {
  const structure = classifyFamily(odds);
  const cluster = simulateCluster(odds, 6, 12);
  const central = cluster.slice(0, 8);
  // FASE 1 — `central` resta la vista da mostrare all'utente (i risultati più
  // probabili). Il CALCOLO di coverage e fragilità usa invece la distribuzione
  // completa: vedi il commento su `fullDistribution` per il perché.
  const distribution = fullDistribution(odds, 6, lambdaVecchi ? deriveLambdasFormula(odds) : undefined);
  const lamH = structure.lambda_home;
  const lamA = structure.lambda_away;
  const lamMin = Math.min(lamH, lamA);
  const lamMax = Math.max(lamH, lamA);

  // --- basic odds-rule filter ---
  let validMarkets: string[] = [];
  for (const m of CANDIDATE_MARKETS) {
    // A) Combo "miste" escluse su richiesta di Rossi: sono quelle che uniscono
    // un segno/doppia chance/GG a un Over-Under (es. DC 12 + O2.5). Non hanno
    // un prezzo nel file Sisal, e finche' si moltiplicavano le due quote reali
    // il numero mostrato era pure sbagliato. Misurato su 583 partite di test:
    // toglierle non cambia la precisione di un solo decimo a nessuna soglia,
    // perche' non vincevano quasi mai il primo posto. Le combo di soli
    // multigol restano: quelle le aveva chieste lui e hanno numeri buoni.
    // Fuori solo le combo costruite sul DC 12: coprono due esiti su tre e
    // Rossi non le gioca. Le combo con 1X / X2 restano (le ha chieste lui).
    if (/\b12\b/.test(m) && m.includes("+")) continue;
    if (m === "1" && (num(odds, "odd_1") || 99) > 1.85) continue;
    if (m === "2" && (num(odds, "odd_2") || 99) > 1.85) continue;
    if (m === "X" && (num(odds, "odd_X") || 99) > 3.5) continue;
    if (m === "1X" && (num(odds, "odd_1X") || 99) > 1.85) continue;
    if (m === "X2" && (num(odds, "odd_X2") || 99) > 1.85) continue;
    if (m === "12" && (num(odds, "odd_12") || 99) > 1.85) continue;
    if (m === "1 + O1.5" && (num(odds, "odd_1") || 99) > 1.85) continue;
    if (m === "2 + O1.5" && (num(odds, "odd_2") || 99) > 1.85) continue;
    // Fino a prima di questa modifica i mercati senza quota nota (tutti i
    // multigol) saltavano il filtro e restavano in gara "per forfait": erano
    // il 70-90% dei pick proposti. Ora, se il bookmaker non ci dà un prezzo,
    // lo stimiamo e il filtro vale anche per loro.
    const realOdd = comboOdd(m, odds);
    // IL RANKING NON DIPENDE PIU' DALLA SOGLIA.
    // Prima i mercati sotto la quota minima venivano scartati qui, quindi
    // spostando il selettore da 1,40 a 1,75 cambiava l'intera classifica e con
    // essa le posizioni, i bonus e il pick. Ma la lettura della partita non
    // cambia perche' l'utente vuole una quota piu' alta: il ranking e' l'analisi,
    // la soglia e' solo un filtro sulla SCELTA finale (vedi selezionaPick).
    void realOdd;
    validMarkets.push(m);
  }

  const floor = structure.goal_floor;
  const ceiling = structure.goal_ceiling;
  const ceilingOpen = structure.goal_ceiling_open;
  const underAperti = underAmmessiATettoAperto(structure);

  // NOTE: `mu` is intentionally declared ONCE at function scope and reused
  // (not re-declared per market) to faithfully replicate a real quirk present
  // in the original Python engine: in the scoring loop below, the
  // "dominanza+tetto" boost reads `mu` BEFORE it's refreshed for the current
  // market, so it can carry over the previous market's value. This is kept
  // deliberately (Opzione A) so migrated predictions match production exactly.
  let mu = "";

  // --- structural floor/ceiling exclusions ---
  const filtered: string[] = [];
  for (const m of validMarkets) {
    mu = m.toUpperCase().trim();

    if (mu === "U0.5") continue;
    if (mu === "U1.5" && floor >= 1) continue;
    if (mu === "U2.5" && floor >= 2) continue;
    if (mu === "U3.5" && floor >= 2) continue;

    if (floor >= 2) {
      if (mu === "O1.5") continue;
      if (mu.includes("+ O1.5")) continue;
      if (mu === "1 + O1.5" || mu === "2 + O1.5") continue;
    }
    if (floor >= 3) {
      if (mu === "O2.5") continue;
      if (mu.includes("+ O2.5")) continue;
    }

    if (mu.includes("MG") && mu.includes("TOTALI")) {
      const rng = m.match(/(\d+)\s*-\s*(\d+)/);
      if (rng && parseInt(rng[1], 10) < floor) continue;
    }
    // Combo "DC X + Under N" ammesse come mercati standard book.
    // Regola "banda >= 2 gol totali per essere ammessa" (Fase A):
    //   banda_under = N - floor  (dove N.5 -> N gol max, floor = min gol)
    //   Se banda_under < 2 -> banda troppo stretta -> escludi
    if (mu.startsWith("DC ") && mu.includes("+ U1.5") && (1 - floor) < 2) continue;
    if (mu.startsWith("DC ") && mu.includes("+ U2.5") && (2 - floor) < 2) continue;
    if (mu.startsWith("DC ") && mu.includes("+ U3.5") && (3 - floor) < 2) continue;
    if (mu.startsWith("DC ") && mu.includes("+ U4.5") && (4 - floor) < 2) continue;

    const odd1 = num(odds, "odd_1") || 99;
    const odd2 = num(odds, "odd_2") || 99;
    if (mu === "1 + U4.5") {
      // Tetto aperto: ammesso solo col profilo DIFENSIVA (Ticket 6-bis, stessa
      // regola condivisa di violatesStructure).
      if (ceilingOpen ? !underAperti : ceiling > 4) continue;
      if (odd1 >= 1.4) continue;
    } else if (mu === "2 + U4.5") {
      if (ceilingOpen ? !underAperti : ceiling > 4) continue;
      if (odd2 >= 1.4) continue;
    }

    if (!ceilingOpen) {
      if (mu === "O3.5" && ceiling <= 3) continue;
      if (mu === "O2.5" && ceiling <= 3) continue;
      if (mu === "O1.5" && ceiling <= 2) continue;
      if (ceiling <= 3) {
        if (mu === "U3.5") continue;
        if (mu.includes("+ U3.5")) continue;
      }
      if (ceiling <= 2) {
        if (mu === "U2.5") continue;
        if (mu.includes("+ U2.5")) continue;
      }
      if (mu.includes("MG") && mu.includes("TOTALI")) {
        const rng = m.match(/(\d+)\s*-\s*(\d+)/);
        if (rng && parseInt(rng[2], 10) > ceiling) continue;
      }
      if (mu.includes("+ O3.5") && ceiling <= 3) continue;
      if (mu.includes("+ O2.5") && ceiling <= 3) continue;
      if (mu.includes("+ O1.5") && ceiling <= 2) continue;
      if ((mu === "1 + O1.5" || mu === "2 + O1.5") && ceiling <= 2) continue;
    }

    filtered.push(m);
  }
  validMarkets = filtered;

  const ranked: RankedMarket[] = [];
  for (const m of validMarkets) {
    const { coverage: cov } = coverageForMarket(m, distribution);
    const frag = fragilityScore(m, distribution);
    // Le liste mostrate a schermo ("coperto da" / "rotto da") restano quelle
    // del cluster centrale: sulla distribuzione completa sarebbero elenchi di
    // 40+ punteggi, illeggibili e inutili. I NUMERI (coverage e fragilità)
    // vengono invece dalla distribuzione completa, che è il punto della Fase 1.
    const { covered, broken } = coverageForMarket(m, central);
    // Non scartiamo piu' i mercati con coverage bassa: restano calcolati e
    // visibili (col loro score reale, quindi in fondo alla classifica) invece
    // di sparire senza che l'utente possa vedere PERCHE' sono deboli.

    let score = cov * (1 - frag * 0.3);
    const rng = m.match(/(\d+)\s*-\s*(\d+)/);

    // --- MG "perfetto" boost/penalty ---
    if (m.toUpperCase().includes("MG") && rng) {
      const lo = parseInt(rng[1], 10);
      const hi = parseInt(rng[2], 10);
      const span = hi - lo;
      const MU = m.toUpperCase();
      const isTotali = MU.includes("TOTALI");
      const isCasa = MU.includes("CASA");
      const isOspite = MU.includes("OSPITE");

      if (isTotali) {
        if (lo === floor && hi === ceiling) score *= 1.3;
        else if (Math.abs(lo - floor) <= 1 && Math.abs(hi - ceiling) <= 1) score *= 1.1;
        if (lo < floor) score *= 0.55;
      } else if (isCasa) {
        const lam = lamH;
        if (lo === 1 && lam >= 2.0) score *= 0.45;
        else if (lo === 1 && lam >= 1.6 && floor >= 2) score *= 0.65;
        else if (lo <= lam && lam <= hi && span <= 3) score *= 1.25;
        else if (lo > 0 && span <= 3) score *= 1.05;
      } else if (isOspite) {
        const lam = lamA;
        if (lo === 1 && lam >= 2.0) score *= 0.45;
        else if (lo === 1 && lam >= 1.6 && floor >= 2) score *= 0.65;
        else if (lo <= lam && lam <= hi && span <= 3) score *= 1.25;
        else if (lo > 0 && span <= 3) score *= 1.05;
      }

      if (isTotali) {
        if (span >= 4 && cov >= 0.85) score *= 0.55;
        else if (span >= 3 && cov >= 0.9) score *= 0.7;
      }
    }

    // --- dominanza+tetto combo boost --- (reads mu BEFORE it's refreshed below — intentional, see note above)
    if (mu === "1 + U4.5" && lamH >= lamA + 0.8) score *= 1.35;
    else if (mu === "2 + U4.5" && lamA >= lamH + 0.8) score *= 1.35;
    else if (mu === "1 + U4.5" && lamH - lamA < 0.3) score *= 0.55;
    else if (mu === "2 + U4.5" && lamA - lamH < 0.3) score *= 0.55;

    // --- mercati secchi boost ---
    const lamTot = lamH + lamA;
    mu = m.toUpperCase().replace(/ {2}/g, " ");
    if (mu === "O2.5" && lamTot >= 2.8) score *= 1.3;
    else if (mu === "O1.5" && lamH >= 0.9 && lamA >= 0.9) score *= 1.2;
    else if (mu === "GG" && lamH >= 1.2 && lamA >= 1.2) score *= 1.25;
    else if (mu === "NG" && Math.min(lamH, lamA) <= 0.75) score *= 1.05;

    const LAMBDA_GAP_DIR = 0.3;
    const lambdaGap = Math.abs(lamH - lamA);
    const isBalanced = lambdaGap < LAMBDA_GAP_DIR;
    if (mu === "1X") {
      if (lamH - lamA >= LAMBDA_GAP_DIR) score *= 1.2;
      else if (isBalanced) score *= 0.5;
    } else if (mu === "X2") {
      if (lamA - lamH >= LAMBDA_GAP_DIR) score *= 1.2;
      else if (isBalanced) score *= 0.5;
    } else if (mu === "12" && isBalanced && lamMax < 2.2) {
      score *= 0.45;
    } else if (
      ["DC 1X + O1.5", "DC X2 + O1.5", "DC 1X + O2.5", "DC X2 + O2.5", "DC 1X + GG", "DC X2 + GG", "DC 1X + U3.5", "DC X2 + U3.5"].includes(mu) &&
      isBalanced
    ) {
      score *= 0.65;
    }

    // --- extreme lambda gap boosts ---
    const isExtreme = lamMin <= 0.7 && lamMax >= 2.2;
    if (isExtreme) {
      mu = m.toUpperCase().replace(/ {2}/g, " ");
      if (mu === "NG") score *= 1.05;
      if (lamA >= lamH && (mu === "2 + O1.5" || mu === "DC X2 + O1.5")) score *= 1.25;
      if (lamH >= lamA && (mu === "1 + O1.5" || mu === "DC 1X + O1.5")) score *= 1.25;
      if (lamA >= lamH && (mu === "2 + O2.5" || mu === "DC X2 + O2.5")) score *= 1.3;
      if (lamH >= lamA && (mu === "1 + O2.5" || mu === "DC 1X + O2.5")) score *= 1.3;
      const lamTot2 = lamH + lamA;
      if (mu === "O2.5" && lamTot2 >= 2.8) score *= 1.2;
      if (lamH >= lamA && mu === "1 + U4.5") score *= 1.3;
      if (lamA >= lamH && mu === "2 + U4.5") score *= 1.3;
      if (mu === "U3.5") score *= 0.8;
      if (mu.includes("MG 2-4 CASA") && lamH < 1.0) score *= 0.5;
      if (mu.includes("MG 2-4 OSPITE") && lamA < 1.0) score *= 0.5;
    }

    // --- open ceiling adjustments ---
    if (ceilingOpen) {
      const muOpen = m.toUpperCase();
      if (muOpen === "U3.5" || muOpen === "U2.5") score *= 0.55;
      if (muOpen.includes("MG") && muOpen.includes("TOTALI")) {
        const rngO = m.match(/(\d+)\s*-\s*(\d+)/);
        if (rngO) {
          const hiO = parseInt(rngO[2], 10);
          if (hiO <= 4) score *= 0.65;
          else if (hiO === 5) score *= 0.85;
        }
      }
      if (muOpen.includes("MG 2-3") || muOpen.includes("MG 1-3")) score *= 0.7;
      if (m.includes("+ U3.5") || m.includes("+ U2.5")) score *= 0.65;
      if (["O2.5", "O3.5", "GG"].includes(muOpen)) score *= 1.3;
      if (m.includes("+ O2.5") || m.includes("+ O1.5")) score *= 1.25;
      if (muOpen.includes("MG") && muOpen.includes("TOTALI")) {
        const rngO2 = m.match(/(\d+)\s*-\s*(\d+)/);
        if (rngO2) {
          const hiO2 = parseInt(rngO2[2], 10);
          if (hiO2 >= 6) score *= 1.2;
        }
      }
    }

    // === EXPECTED VALUE (EV) — misura la reale convenienza del pick (Fase A) ===
    // EV = coverage (probabilita' Poisson) x quota - 1
    //   EV >= +0.10 -> value bet forte (+25% score)
    //   EV >= +0.03 -> value bet moderato (+10% score)
    //   EV <= -0.05 -> rischio negativo forte (-35% score)
    //   EV <= -0.02 -> rischio negativo marginale (-20% score)
    const comboOddVal = comboOdd(m, odds);
    let ev: number | null = null;
    if (comboOddVal && comboOddVal >= 1.01) {
      ev = Math.round((cov * comboOddVal - 1.0) * 1000) / 1000;
      if (ev >= 0.1) score *= 1.25;
      else if (ev >= 0.03) score *= 1.1;
      else if (ev <= -0.05) score *= 0.65;
      else if (ev <= -0.02) score *= 0.8;
    }

    // Se il bookmaker non dà un prezzo, mostriamo la stima — segnalata come
    // tale, così a schermo si vede che è un valore calcolato e non letto dal
    // file. L'EV qui sopra resta volutamente null: vedi il commento su
    // estimateMarketOdd (sarebbe circolare).
    // Una quota e' "reale" solo se il bookmaker la fornisce per quel mercato
    // esatto: le combo non ci sono nel file, quindi vanno sempre marcate come
    // stimate anche quando comboOdd restituisce un numero.
    const soloReale = ODD_MAP_HAS(m);
    const estimated = comboOddVal === null ? estimateMarketOdd(m, odds) : null;

    ranked.push({
      market: m,
      coverage: cov,
      fragility: frag,
      fragility_label: frag >= 0.45 ? "alta" : frag >= 0.25 ? "media" : "bassa",
      covered_scores: covered.slice(0, 6),
      broken_by: broken.slice(0, 5),
      score: round4(score),
      odd: comboOddVal ?? estimated,
      odd_estimated: !soloReale,
      ev,
    });
  }

  // --- FASE 3: correttivo storico per scenario ---
  // Sostituisce il vecchio "ML boost" (±10% solo per win-rate >=70% o <=30%,
  // quindi inattivo sul 71% delle righe storiche e cieco su tutto il resto).
  //
  // Come funziona ora: la probabilita' del modello viene MESCOLATA con quella
  // osservata davvero in partite dello stesso scenario, con un peso che cresce
  // col numero di partite viste:
  //     k    = n / (n + SHRINK)
  //     mista = coverage * (1 - k) + win_rate_storico * k
  //     score = score * (mista / coverage)
  // Con poche partite lo storico conta poco e vince il modello; con centinaia
  // di partite lo storico prende il sopravvento. Nessuna soglia secca: ogni
  // mercato riceve la correzione che i suoi dati meritano.
  //
  // Verificato su un test set VERO (583 partite tenute fuori dal calcolo delle
  // statistiche storiche, per non misurarsi su se' stesso):
  //   soglia 1.40: 62,3% -> 63,6%   soglia 1.60: 54,0% -> 57,1%
  // Il risultato non e' sensibile alla costante: con SHRINK 30, 80 o 200 il
  // miglioramento resta, quindi non e' un artefatto di taratura.
  const SHRINK = 80;
  if (mlScores) {
    for (const r of ranked) {
      const sc = mlScores[r.market];
      if (!sc || !sc.total) continue;
      const total = sc.total;
      const wr = sc.win_rate || 0;
      const k = total / (total + SHRINK);
      const cov = Math.max(0.05, r.coverage);
      const mixed = r.coverage * (1 - k) + (wr / 100) * k;
      const factor = mixed / cov;
      r.score = round4(r.score * factor);
      // La probabilita' MOSTRATA diventa quella corretta dallo storico, non
      // piu' quella grezza di Poisson. Prima il motore ordinava usando la
      // correzione ma a schermo scriveva il numero non corretto: si leggeva
      // 65% su un mercato che il sistema stava gia' trattando come meno
      // affidabile. Il valore grezzo resta in `coverage_poisson`.
      r.coverage_poisson = r.coverage;
      r.coverage = round4(mixed);
      r.fragility = round4(1 - mixed);
      r.fragility_label = r.fragility >= 0.45 ? "alta" : r.fragility >= 0.25 ? "media" : "bassa";
      const deltaPct = Math.round((factor - 1) * 100);
      r.ml_adjustment = {
        type: deltaPct > 1 ? "boost" : deltaPct < -1 ? "malus" : "neutral",
        win_rate: wr,
        total,
        delta: `${deltaPct >= 0 ? "+" : ""}${deltaPct}%`,
      };
    }
  }

  // C) Ordine per PROBABILITA' VERA, non piu' per punteggio.
  // Il punteggio mescolava coverage, fragilita', bonus strutturali e correttivo
  // storico, e finiva per mettere primo un mercato meno probabile di quello
  // sotto: su Hjk - Tps era primo "MG 2-4 casa" al 59% mentre "1" stava secondo
  // al 69% con quota reale 1,48 — ed e' finita 1-0.
  // Misurato su 583 partite: a soglia 1,50 la precisione sale da 61,4% a 63,5%
  // e a 1,60 da 54,0% a 56,1%; a soglia 1,40 invece SCENDE da 62,1% a 58,0%.
  // Il punteggio resta calcolato e resta nel campo `score`: e' solo il criterio
  // di ordinamento a essere cambiato, cosi' e' facile tornare indietro.
  ranked.sort((a, b) => {
    if (Math.abs(a.coverage - b.coverage) > 0.01) return b.coverage - a.coverage;
    // A probabilita' davvero pari decide il bookmaker: la quota piu' bassa e'
    // l'evento che il mercato ritiene piu' probabile, e il mercato sa cose che
    // noi non sappiamo. E' il caso GG/NG dati entrambi al 50% ma prezzati 1,57
    // e 2,20.
    const qa = a.odd ?? 99, qb = b.odd ?? 99;
    if (Math.abs(qa - qb) > 0.02) return qa - qb;
    return b.score - a.score;
  });

  const pickMarket = ranked.length ? ranked[0].market : "";
  // Non nascondiamo piu' i mercati incoerenti col pick #1 (es. GG quando NG
  // e' il pick): l'utente deve poter vedere coverage/fragility di TUTTI i
  // mercati validi calcolati, anche quelli opposti al pick principale. Li
  // marchiamo solo per trasparenza (il frontend puo' segnalarli visivamente).
  for (const r of ranked) {
    r.opposes_pick = pickMarket ? areIncoherent(pickMarket, r.market) : false;
  }
  const top20 = ranked.slice(0, 20);

  return {
    structure,
    cluster,
    central_cluster: central,
    // Il ranking mostra i primi 20 PIU' tutti i mercati ammessi al verdetto,
    // anche se cadono sotto il ventesimo posto: sono quelli fra cui si sceglie
    // la giocata, quindi devono essere sempre visibili e sempre disponibili
    // alla fusione. (Rossi aveva notato l'assenza di `DC 1X + GG`, che stava
    // appena fuori dalla ventesima posizione.)
    ranking: [...top20, ...ranked.filter((r) => isVerdictMarket(r.market) && !top20.includes(r))],
    pick: selezionaPick(ranked, odds, minOdd, true),
    explanation: buildExplanation(structure, top20),
  };
}

function buildExplanation(structure: FamilyStructure, ranking: RankedMarket[]): string {
  if (!ranking.length) return "Nessun mercato con coverage sufficiente.";
  const p = ranking[0];
  const fam = structure.family;
  const floor = structure.goal_floor;
  const ceil = structure.goal_ceiling;
  const pick = p.market;
  const cov = Math.round(p.coverage * 100);
  return (
    `Famiglia ${fam}. Pavimento ${floor} · Tetto ${ceil} · Range ${floor}-${ceil}. ` +
    `PICK: ${pick} con coverage ${cov}% sul cluster centrale. ` +
    `Fragility ${p.fragility_label} (${Math.round(p.fragility * 100)}% del cluster lo batte).`
  );
}

// ============================================================
// selezione del pick — regole decise con Rossi il 27/07/2026
// ============================================================

/**
 * Mercati che raccontano la partita in modo OPPOSTO l'uno all'altro.
 * Non devono mai sostituirsi a vicenda solo perche' uno e' sotto soglia:
 * sarebbe ribaltare la lettura della partita per una ragione di prezzo.
 *
 * Semantica: CONCORRENTI DI DIREZIONE (Ticket 7). 1X e X2 restano qui di
 * proposito: la direzione dominante vince e la rivale non diventa pick.
 * Deve restare allineata a `_OPPOSITES` in frontend/src/api.ts (stessa
 * semantica); NON alla tabella OPPOSTI di api.ts, che contiene solo gli
 * opposti veri e da cui 1X/X2 e' stata tolta volutamente.
 */
const OPPOSTI: [string, string][] = [
  ["1", "2"], ["1", "X2"], ["2", "1X"], ["1X", "X2"],
  ["GG", "NG"],
  ["O2.5", "U2.5"], ["O1.5", "U1.5"], ["O2.5", "NG"],
];

/** Componenti di un mercato, combo spezzate e "DC " tolto. */
function pezzi(market: string): string[] {
  return market.split("+").map((p) => p.trim().replace(/^DC /i, "").toUpperCase());
}

/** true se `candidato` contraddice la lettura espressa da `direzione`. */
export function contraddice(direzione: string, candidato: string): boolean {
  const a = pezzi(direzione), b = pezzi(candidato);
  for (const x of a) {
    for (const y of b) {
      if (OPPOSTI.some(([p, q]) =>
        (p.toUpperCase() === x && q.toUpperCase() === y) ||
        (q.toUpperCase() === x && p.toUpperCase() === y))) return true;
    }
  }
  return false;
}

/**
 * Sceglie la giocata da proporre.
 *
 * 1. La direzione della partita e' il mercato ammesso piu' probabile, quota o
 *    non quota: e' la lettura del motore e non si tocca.
 * 2. Se quel mercato paga abbastanza, e' lui.
 * 3. Altrimenti si prova a RAFFORZARLO con una combo coerente (1X -> 1X+O1.5,
 *    1X+O2.5, 1X+GG, 1X+U3.5...). Aggiungere una condizione alza la quota senza
 *    cambiare lettura.
 * 4. Altrimenti si scende nella classifica, saltando tutto cio' che contraddice
 *    la direzione.
 * 5. Se non resta niente, si dichiara valore nullo e non si propone nulla.
 *    Meglio nessuna giocata che una giocata contro la propria analisi.
 */
/** A quale famiglia appartiene un mercato: esito, gol, oppure totali. */
function famiglia(market: string): "esito" | "gol" | "totali" | null {
  const p = pezzi(market);
  if (p.some((x) => ["1", "2", "1X", "X2"].includes(x))) return "esito";
  if (p.some((x) => ["GG", "NG"].includes(x))) return "gol";
  if (p.some((x) => x.startsWith("O") || x.startsWith("U") || x.startsWith("MG"))) return "totali";
  return null;
}

/**
 * Famiglie su cui il motore NON ha una lettura.
 *
 * Se i due mercati OPPOSTI piu' alti di una famiglia sono separati da pochi
 * punti, vuol dire che il modello non sa da che parte sta la partita. Su
 * Zaglebie - Piast il ranking dava `X2` 65% e `1X` 62%: tre punti fra due
 * scenari opposti non sono una lettura, sono un pareggio. Meglio non giocare
 * quella famiglia e scendere a una dove il motore ha davvero qualcosa da dire —
 * li' c'era `MG 2-4 totali` al 60%, e sul 2-0 avrebbe vinto.
 */
function famiglieAmbigue(ammessi: RankedMarket[], sogliaPunti = 0.05): Set<string> {
  const out = new Set<string>();
  for (const fam of ["esito", "gol", "totali"] as const) {
    const dellaFamiglia = ammessi.filter((r) => famiglia(r.market) === fam);
    if (dellaFamiglia.length < 2) continue;
    const primo = dellaFamiglia[0];
    const opposto = dellaFamiglia.find((r) => contraddice(primo.market, r.market));
    if (opposto && Math.abs(primo.coverage - opposto.coverage) <= sogliaPunti) out.add(fam);
  }
  return out;
}

export function selezionaPick(
  ranked: RankedMarket[],
  odds: Odds,
  minOdd: number,
  /** true = solo quote DENTRO la fascia di minOdd (01/10/2026, pick del motore
   *  nella scheda); false = da minOdd in su (backtest, come prima). */
  fasciaChiusa = false,
): RankedMarket | null {
  // Dal 18/09 la logica vive in `giocateAmmissibili`: il pick e' la PRIMA
  // giocata ammissibile, le altre servono alla multipla automatica
  // (build-multipla.ts) come alternative sulla stessa partita. Stesso
  // risultato di prima, verificato con quote finte alle quattro soglie.
  return giocateAmmissibili(ranked, odds, minOdd, fasciaChiusa)[0] ?? null;
}

/**
 * Tutte le giocate ammissibili di una partita, nell'ordine del ranking:
 * mercati in whitelist, sopra la soglia, che non contraddicono nessun
 * mercato leggibile piu' in alto. La prima e' il pick del motore.
 */
export function giocateAmmissibili(
  ranked: RankedMarket[],
  odds: Odds,
  minOdd: number,
  /** Vedi selezionaPick. La multipla usa "da minOdd in su". */
  fasciaChiusa = false,
): RankedMarket[] {
  const ammessi = ranked.filter((r) => isVerdictMarket(r.market));
  if (!ammessi.length) return [];

  // La DIREZIONE della partita e' il primo mercato ammesso del ranking, quota o
  // non quota: e' la lettura del motore e non si tocca. Nella lettura entrano
  // anche i mercati "solo veto" (vedi VETO_ONLY_MARKETS): non sono giocabili ma
  // dicono da che parte sta la partita.
  const letti = ranked.filter((r) => isVerdictMarket(r.market) || isVetoOnly(r.market));
  const ambigue = famiglieAmbigue(letti);
  const leggibili = letti.filter((r) => {
    const f = famiglia(r.market);
    return !f || !ambigue.has(f);
  });
  if (!leggibili.length) return [];   // nessuna famiglia leggibile: si sta fuori

  // Si scorre il ranking DALL'ALTO e si tiene tutto cio' che paga abbastanza,
  // saltando quello che racconta la partita al contrario. Niente scorciatoie
  // e niente preferenze per le combo: se un mercato sta piu' in alto, ha
  // coverage migliore e quota sufficiente, e' lui.
  const out: RankedMarket[] = [];
  for (let i = 0; i < leggibili.length; i++) {
    const r = leggibili[i];
    // Un mercato e' valido solo se non contraddice NESSUNO di quelli piu' in
    // alto, non solo la direzione. Prima il confronto era con la sola direzione:
    // su Deportivo Riestra - Boca la lettura era `DC X2 + U3.5`, e sia `NG`
    // (57%) sia `GG` (43%) risultavano compatibili con essa, quindi alzando la
    // soglia il pick passava da NG a GG — due mercati opposti fra loro.
    // Se un mercato piu' probabile dice il contrario, quello sotto non si gioca.
    if (leggibili.slice(0, i).some((sopra) => contraddice(sopra.market, r.market))) continue;
    if (!isVerdictMarket(r.market)) continue;   // solo veto: vieta, non si gioca
    if (fasciaChiusa ? inFascia(r.odd, minOdd) : (r.odd ?? 0) >= minOdd) out.push(r);
  }
  return out;
}

