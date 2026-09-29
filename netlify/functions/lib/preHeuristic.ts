import { CANDIDATE_MARKETS, type Odds } from "./clusterEngine";

export type PreCandidate = { market: string; odd: number; family: string };

/**
 * FASE 0 — porto lato server dell'euristica "pre-pronostico" che oggi vive
 * SOLO nel frontend (frontend/src/api.ts -> quickPredictionFamily) e che
 * partecipa alla fusione con peso 5.
 *
 * Serve per poter registrare, a ogni partita, quale pick avrebbe proposto
 * questo sistema — altrimenti non è misurabile e non sapremo mai se merita
 * il peso che ha.
 *
 * ATTENZIONE: questa funzione deve restare identica a quella del frontend.
 * Se un giorno si toccano le regole, vanno cambiate in entrambi i posti,
 * altrimenti la pagella misura un sistema diverso da quello che vota.
 */
/**
 * Valuta TUTTI i mercati del catalogo per cui il bookmaker fornisce un prezzo
 * reale, e restituisce la classifica dell'euristica.
 *
 * Perche' solo quelli con prezzo reale. L'euristica PRE serve nella fusione
 * come voce INDIPENDENTE dal motore Poisson: guarda quanto il bookmaker fa
 * pagare un esito, che e' informazione che il motore non ha. Sui mercati senza
 * prezzo (i multigol semplici) l'unica quota disponibile e' quella che
 * stimiamo noi dalla distribuzione di Poisson: ordinarli con quella
 * significherebbe riordinarli per la stessa probabilita' del motore, cioe'
 * fabbricare un secondo voto identico al primo. La concordanza diventerebbe
 * finta. Su quei mercati l'euristica ASTIENE, e chi calcola la concordanza
 * deve contare solo i sistemi che potevano davvero esprimersi.
 */
export function preHeuristicRanking(odds: Odds): PreCandidate[] {
  const out: PreCandidate[] = [];
  for (const market of CANDIDATE_MARKETS) {
    const odd = realOddFor(market, odds);
    if (odd === null) continue;          // astensione: nessun prezzo indipendente
    if (odd < 1.40) continue;            // sotto 1.40 e' solo rischio, niente valore
    out.push({ market, odd, family: "" });
  }
  out.sort((a, b) => a.odd - b.odd);
  return out;
}

/**
 * Mercati su cui l'euristica PRE PUO' esprimersi, cioe' quelli con un prezzo
 * reale del bookmaker — a prescindere dal fatto che poi li scarti perche' la
 * quota e' troppo bassa.
 *
 * Serve a distinguere "l'euristica lo boccia" da "l'euristica non ha modo di
 * dire niente": la concordanza fra sistemi va calcolata solo fra chi poteva
 * davvero votare, altrimenti i multigol vengono puniti per un voto che non
 * poteva esistere.
 */
export function preEligibleMarkets(odds: Odds): string[] {
  return CANDIDATE_MARKETS.filter((m) => realOddFor(m, odds) !== null);
}

/**
 * Quota REALE del mercato, cioe' quella LETTA dal file del bookmaker.
 * Restituisce null per tutto il resto — combo comprese.
 *
 * BUG CORRETTO (26/07/2026). Prima questa funzione ricavava la quota di una
 * combo prendendo il MASSIMO fra i componenti. E' sbagliato di netto: su
 * New York RB - Charlotte dava "GG + O2.5 @ 1.40" quando la quota vera e'
 * 1.90, "DC 1X + O2.5 @ 1.40" invece di 1.96, "1 + O2.5 @ 2.20" invece di
 * 3.08. Il massimo fra due quote e' la quota dell'evento PIU' PROBABILE dei
 * due, mentre una combo richiede che si verifichino ENTRAMBI: la sua quota e'
 * sempre piu' alta di tutti i componenti, mai uguale al maggiore.
 * (La formula sbagliata veniva dall'euristica originale nel frontend, dove il
 * numero serviva solo a ordinare una lista; da quando alimenta anche la quota
 * mostrata sulla giocata consigliata e il filtro di quota minima, l'errore e'
 * diventato visibile e dannoso.)
 *
 * Per le combo la quota corretta la calcola gia' il motore con
 * `estimateMarketOdd` sulla distribuzione di Poisson, che tiene conto della
 * correlazione fra i due eventi. Qui non si stima niente: se il bookmaker non
 * da' un prezzo, l'euristica si astiene, ed e' anche cio' che le lascia la sua
 * indipendenza dal motore.
 */
function realOddFor(market: string, odds: Odds): number | null {
  const key = SINGLE_MARKET_ODD_KEY[market.trim().toUpperCase()];
  if (!key) return null;
  const v = odds[key];
  return typeof v === "number" && isFinite(v) && v > 1 ? v : null;
}

const SINGLE_MARKET_ODD_KEY: Record<string, keyof Odds> = {
  "1": "odd_1", "X": "odd_X", "2": "odd_2",
  "1X": "odd_1X", "X2": "odd_X2", "12": "odd_12",
  "O1.5": "odd_O15", "U1.5": "odd_U15",
  "O2.5": "odd_O25", "U2.5": "odd_U25",
  "O3.5": "odd_O35", "U3.5": "odd_U35",
  "GG": "odd_GG", "NG": "odd_NG",
};

export function preHeuristicPick(odds: Odds): PreCandidate | null {
  const get = (k: keyof Odds, def = Infinity) => (odds[k] ?? def) as number;
  const o1 = get("odd_1"), o2 = get("odd_2");
  const o1X = get("odd_1X"), oX2 = get("odd_X2"), o12 = get("odd_12");
  const oO15 = get("odd_O15"), oO25 = get("odd_O25"), oU25 = get("odd_U25");
  const oO35 = get("odd_O35"), oU35 = get("odd_U35");
  const oGG = get("odd_GG"), oNG = get("odd_NG");

  const out: PreCandidate[] = [];
  const push = (market: string, odd: number, family: string) => {
    if (!isFinite(odd)) return;
    if (odd < 1.40) return;
    if (out.find((c) => c.market === market)) return;
    out.push({ market, odd, family });
  };

  const oneValid = o1 <= 1.85;
  const twoValid = o2 <= 1.85;
  const hasFavorita = oneValid || twoValid;

  if (oneValid) push("1", o1, "DOMINANZA");
  if (twoValid) push("2", o2, "DOMINANZA");
  if (hasFavorita) {
    if (oneValid && o1X <= 1.60) push("1X", o1X, "DOMINANZA_TETTO");
    if (twoValid && oX2 <= 1.60) push("X2", oX2, "DOMINANZA_TETTO");
    if (o12 <= 1.40) push("12", o12, "ANTI_X");
  }

  if (oO15 <= 1.40 && oU35 <= 1.40) {
    push("MG 2-4 totali", Math.max(1.40, (oO15 + oU35) / 2), "RANGE_CONTROLLATO");
  }
  if (oO25 <= 1.85) push("O2.5", oO25, "OFFENSIVA");
  if (oGG <= 1.85) push("GG", oGG, "OFFENSIVA");
  if (oO15 <= 1.50) push("O1.5", oO15, "RANGE_CONTROLLATO");
  if (oO35 <= 1.85) push("O3.5", oO35, "OFFENSIVA_PULITA");

  if (oU25 <= 1.85) push("U2.5", oU25, "CHIUSA_PROTETTA");
  if (oU35 <= 1.40) push("U3.5", oU35, "CHIUSA_PROTETTA");
  if (oNG <= 1.85) push("NG", oNG, "CHIUSA_PROTETTA");

  if (hasFavorita) {
    if (oneValid && oO15 <= 1.50) push("DC 1X + O1.5", Math.max(o1X, oO15), "DOMINANZA_GOL");
    if (twoValid && oO15 <= 1.50) push("DC X2 + O1.5", Math.max(oX2, oO15), "DOMINANZA_GOL");
    if (oneValid && oU35 <= 1.40) push("DC 1X + U3.5", Math.max(o1X, oU35), "DOMINANZA_TETTO");
    if (twoValid && oU35 <= 1.40) push("DC X2 + U3.5", Math.max(oX2, oU35), "DOMINANZA_TETTO");
  }

  out.sort((a, b) => a.odd - b.odd);
  return out[0] || null;
}
