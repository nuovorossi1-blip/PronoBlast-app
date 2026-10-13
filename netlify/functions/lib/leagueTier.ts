/**
 * Livelli di campionato per la multipla automatica (build-multipla.ts).
 *
 * Decisi da Rossi il 18/09/2026:
 *  - LIVELLO 1: le sette leghe principali (ING1, ITA1, SPA1, GER1, FRA1,
 *    OLA1, POR1). NON e' la lista del tasto PRINCIPALI dell'app
 *    (frontend/src/utils/leagues.ts, che ha anche NOR1/USA1/SVE1/DAN1): per
 *    la multipla vale la lista stretta.
 *    Dal 13/10/2026 anche Champions, Europa e Conference League e le nazionali.
 *  - LIVELLO 2: le altre prime divisioni (Belgio, Turchia, Norvegia, USA...),
 *    le seconde divisioni dei paesi di livello 1 (Serie B, Championship,
 *    2. Bundesliga, Liga 2, Ligue 2...) e le altre coppe europee per club.
 *  - LIVELLO 3: tutto il resto (altre seconde divisioni, coppe nazionali,
 *    riserve, femminili, giovanili, amichevoli).
 *
 * Il codice del campionato e' `manifestazione` della tabella `matches`
 * (es. "ITA1", "ING2", "EUCHL", "BRA1RS"). Le funzioni del frontend non sono
 * importabili dalle function: la logica e' ricopiata qui, tenuta minima.
 */

export const TIER1_CODES = ["ING1", "ITA1", "SPA1", "GER1", "FRA1", "OLA1", "POR1"];

/** Paesi di livello 1: la loro seconda divisione vale come livello 2. */
const TIER1_COUNTRIES = TIER1_CODES.map((c) => c.slice(0, -1));

export type LeagueTier = 1 | 2 | 3;

/** Nazionali (qualificazioni mondiali/europee, Nations League...): livello 1. */
export function isNazionale(c: string): boolean {
  return /^(EURONL|EURQ|MOND|WCQ|AMINAZ|EURO$|COPAM|AFCNAZ|CONCAF)/.test(c);
}

/**
 * Riserve, femminili, giovanili, amichevoli: il bot Telegram non le usa mai,
 * neanche come ultimo livello (13/10/2026, Rossi: "principali, poi seconde,
 * poi terze divisioni, poi ti fermi"; il bot proponeva ARG1RS e OLIMFQ).
 */
export function isMinore(manifestazione: string | null | undefined): boolean {
  const c = (manifestazione || "").toUpperCase().trim();
  if (!c || /^\d+$/.test(c)) return true;                 // codici numerici senza nome
  if (/^AMI/.test(c) && !/^AMINAZ/.test(c)) return true;  // amichevoli (non le nazionali)
  // F solo dopo la cifra (ITA1F): MONDQF sono le qualificazioni mondiali maschili.
  if (/U\d{2}|YL$|JP$|RS\d*$|^OLIMF|^[A-Z]{2,6}\d+F\d*$/.test(c)) return true;
  // Dalla quarta divisione in giu' (ING6, CIL4...): ci si ferma alla terza.
  if (/^[A-Z]{2,4}[4-9]/.test(c)) return true;
  return false;
}

/** Partita da escludere per il bot: campionato minore o squadre femminili
 *  dentro un codice misto (MONDQF ha anche "Scozia - Repubblica Ceca F"). */
export function isPartitaMinore(manifestazione: string | null | undefined, squadra1?: string | null, squadra2?: string | null): boolean {
  if (isMinore(manifestazione)) return true;
  const femminile = (s?: string | null) => /\s(F|W|Women|Femminile)$/i.test(String(s || "").trim());
  return femminile(squadra1) || femminile(squadra2);
}

export function leagueTier(manifestazione: string | null | undefined): LeagueTier {
  const c = (manifestazione || "").toUpperCase().trim();
  if (!c) return 3;
  if (TIER1_CODES.includes(c)) return 1;
  // Champions, Europa e Conference League e nazionali: livello 1 (13/10/2026,
  // Rossi: "prima le principali: Champions, Europa, Mondiali, Serie A...").
  if (/^EU(CHL|EL|CONFL)$/.test(c) || isNazionale(c)) return 1;
  // Altre coppe europee per club (supercoppa, ...)
  if (/^EU/.test(c)) return 2;
  // Prima divisione "pulita": 2-4 lettere di paese + "1", niente suffissi
  // (ITA1F femminile, BRA1RS riserve e simili restano fuori).
  if (/^[A-Z]{2,4}1$/.test(c)) return 2;
  // Seconda divisione dei paesi di livello 1 (ITA2, ING2, GER2, ...).
  if (/^[A-Z]{2,4}2$/.test(c) && TIER1_COUNTRIES.includes(c.slice(0, -1))) return 2;
  return 3;
}

export function tierLabel(t: LeagueTier): string {
  return t === 1 ? "principale" : t === 2 ? "secondario" : "minore";
}
