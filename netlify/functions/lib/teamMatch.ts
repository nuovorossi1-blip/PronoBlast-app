import { STOP, EXONIMI, NAZIONI_RAW, SIGLE, GENERICHE, DISTINTIVE } from "./teamTables";

/**
 * Confronto fra nomi di squadra. Traduzione fedele di `norm`, `traduci` e
 * `simil` dallo script Python di Rossi (27/09/2026).
 *
 * Perche' fedele e non "riscritta meglio": quello script ha gia' abbinato oltre
 * 10.000 partite vere, e ogni soglia qui dentro e' il risultato di un errore
 * trovato a mano. Una versione "equivalente ma piu' pulita" produrrebbe
 * abbinamenti diversi, e un risultato sbagliato non e' un difetto estetico:
 * finisce nell'apprendimento e avvelena i pronostici di tutte le partite con
 * quote simili.
 *
 * La regola generale: nel dubbio NON si scrive.
 */

const cacheNorm = new Map<string, string>();

export function norm(input: string): string {
  const chiave = String(input);
  const memo = cacheNorm.get(chiave);
  if (memo !== undefined) return memo;

  // NFKD + rimozione dei segni diacritici = l'equivalente di
  // unicodedata.normalize("NFKD").encode("ascii", "ignore")
  let s = chiave.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^\x00-\x7F]/g, "").toLowerCase();
  s = s.replace(/[^a-z0-9 ]/g, " ");
  s = s.replace(/aa/g, "a");                                   // Vaag = Vag
  s = s.replace(/\bres\b|\breserve\b|\briserve\b/g, "reserves");
  s = s.replace(/\bwfc\b|\blfc\b|\bladies\b|\bfemenino\b|\bfeminin\b|\bfemm\b|\bfem\b|\bfemminile\b|\bdff\b/g, "women");
  s = s.replace(/\bdeportes\b/g, "deportivo");
  s = s.replace(/\bst\b|\bsanta\b(?= lucia)/g, "saint");
  s = s.split(/\s+/).map((t) => EXONIMI[t] ?? t).join(" ");

  const tok = s
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^(18|19|20)\d\d$/.test(t))
    .map((t) => (t === "ii" || t === "2" ? "b" : t));

  const out = tok.join(" ");
  cacheNorm.set(chiave, out);
  return out;
}

/** NAZIONI con chiavi e valori gia' normalizzati, dalla piu' lunga alla piu' corta. */
let nazioniNorm: [string, string][] | null = null;
function chiaviNazioni(): [string, string][] {
  if (!nazioniNorm) {
    nazioniNorm = Object.entries(NAZIONI_RAW)
      .map(([k, v]) => [norm(k), norm(v)] as [string, string])
      .sort((a, b) => b[0].length - a[0].length);
  }
  return nazioniNorm;
}

export function traduci(n: string): string {
  for (const [k, v] of chiaviNazioni()) {
    if (n === k || n.startsWith(k + " ")) return v + n.slice(k.length);
  }
  return n;
}

/** Alias caricati dal database (nome nel foglio -> nome nella fonte). */
let ALIAS: Record<string, string> = {};
export function impostaAlias(coppie: { da: string; a: string }[]) {
  ALIAS = {};
  for (const c of coppie) ALIAS[norm(c.da)] = c.a;
}

/**
 * Ratcliff/Obershelp, cioe' esattamente cio' che calcola
 * `difflib.SequenceMatcher(None, a, b).ratio()` in Python.
 * L'euristica "autojunk" di difflib scatta solo oltre i 200 caratteri: i nomi
 * di squadra sono molto piu' corti, quindi qui i due risultati coincidono.
 */
function ratio(a: string, b: string): number {
  const totale = a.length + b.length;
  if (!totale) return 1;
  return (2 * corrispondenze(a, b)) / totale;
}

function corrispondenze(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let bestI = 0, bestJ = 0, bestLen = 0;
  // blocco comune piu' lungo, con la stessa preferenza di difflib per il primo
  let prec = new Array<number>(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        const k = prec[j] + 1;
        cur[j + 1] = k;
        if (k > bestLen) { bestLen = k; bestI = i - k + 1; bestJ = j - k + 1; }
      }
    }
    prec = cur;
  }
  if (!bestLen) return 0;
  return bestLen
    + corrispondenze(a.slice(0, bestI), b.slice(0, bestJ))
    + corrispondenze(a.slice(bestI + bestLen), b.slice(bestJ + bestLen));
}

const MARKER = /\bu\d\d\b|\bii\b|\bb\b|\bwomen\b|\bw\b|\breserves?\b/g;
export function marker(x: string): string {
  return (String(x).toLowerCase().match(MARKER) || []).slice().sort().join("|");
}

function iniziali(x: string): string {
  return x.split(" ").filter(Boolean).map((t) => t[0]).join("");
}

function meno(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (!b.has(x)) out.add(x);
  return out;
}
function inter(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
function simmetrica(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (!b.has(x)) out.add(x);
  for (const x of b) if (!a.has(x)) out.add(x);
  return out;
}

/** Quanto si somigliano due nomi di squadra, da 0 a 1. */
export function simil(aIn: string, bIn: string, senzaMarker = false): number {
  let a = aIn, b = bIn;
  if (senzaMarker) {
    // confronto solo il nome del club, togliendo U19/Women/II/Riserve
    const tolgo = /\b(u\d\d|women|w|ii|b|reserves?|res)\b/g;
    a = norm(ALIAS[norm(aIn)] ?? aIn).replace(tolgo, " ");
    b = norm(bIn).replace(tolgo, " ");
  }
  a = ALIAS[norm(a)] ?? a;
  a = traduci(norm(a));
  b = traduci(norm(b));
  a = SIGLE[a] ?? a;
  b = SIGLE[b] ?? b;
  if (!a || !b) return 0;
  if (a === b) return 1;

  const ta0 = new Set(a.split(" ").filter(Boolean));
  const tb0 = new Set(b.split(" ").filter(Boolean));
  if (inter(simmetrica(ta0, tb0), DISTINTIVE).size) return 0;

  // sigla: "MP" = "Mikkelin Palloilijat", "UCD" = "University College Dublin"
  for (const [x, y] of [[a, b], [b, a]] as [string, string][]) {
    if (!y.includes(" ") && y.length >= 2 && y.length <= 4 && x.split(" ").length >= 2 && iniziali(x) === y) {
      return 0.9;
    }
  }

  // giovanili e femminili devono corrispondere: mai scambiare la prima squadra
  // con la sua U19
  if (marker(a) !== marker(b)) return 0;

  const r = ratio(a, b);
  const ta = meno(ta0, GENERICHE);
  const tb = meno(tb0, GENERICHE);
  const tok = ta.size && tb.size ? inter(ta, tb).size / Math.min(ta.size, tb.size) : 0;
  const ca = [...ta].sort().join(" ");
  const cb = [...tb].sort().join(" ");
  const contiene = ta.size && tb.size && (ca.includes(cb) || cb.includes(ca)) && Math.min(ca.length, cb.length) >= 4 ? 0.9 : 0;
  const forte = [...ta].some((t) => t.length >= 5 && (tb.has(t) || [...tb].some((u) => u.length >= 5 && u.slice(0, 5) === t.slice(0, 5)))) ? 0.75 : 0;

  const ga = meno(inter(ta0, GENERICHE), new Set(["fc", "b"]));
  const gb = meno(inter(tb0, GENERICHE), new Set(["fc", "b"]));
  if (ga.size && gb.size && !inter(ga, gb).size) return Math.min(0.5, r);   // Manchester United vs Manchester City

  if (!ta.size || !tb.size) {
    // nome fatto solo di parole generiche ("Real Union", "Club Nacional")
    const comuni = meno(inter(inter(ta0, tb0), GENERICHE),
      new Set(["fc", "b", "san", "santa", "saint", "st", "real", "union", "club"]));
    if (r >= 0.9) return r;
    const comuniTutti = meno(inter(ta0, tb0), new Set(["fc", "b"]));
    return comuni.size || comuniTutti.size >= 2 ? 0.7 : r * 0.6;
  }
  return Math.max(r * (tok ? 1 : 0.85), tok * 0.95, contiene, forte);
}

/**
 * Verifica se due squadre sono incompatibili (es. marker giovanili/femminili
 * diversi, parole distintive opposte come North/South, oppure parole generiche
 * in conflitto come Manchester United vs Manchester City).
 */
export function squadreIncompatibili(aIn: string, bIn: string): boolean {
  let a = norm(aIn);
  let b = norm(bIn);
  if (marker(a) !== marker(b)) return true;

  a = traduci(a);
  b = traduci(b);
  a = SIGLE[a] ?? a;
  b = SIGLE[b] ?? b;
  if (!a || !b) return true;
  if (a === b) return false;

  const ta0 = new Set(a.split(" ").filter(Boolean));
  const tb0 = new Set(b.split(" ").filter(Boolean));

  if (inter(simmetrica(ta0, tb0), DISTINTIVE).size > 0) return true;

  const ga = meno(inter(ta0, GENERICHE), new Set(["fc", "b"]));
  const gb = meno(inter(tb0, GENERICHE), new Set(["fc", "b"]));
  if (ga.size > 0 && gb.size > 0 && inter(ga, gb).size === 0) return true;

  return false;
}

