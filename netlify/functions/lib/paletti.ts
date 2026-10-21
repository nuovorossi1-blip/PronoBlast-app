/**
 * PALETTI DELLE QUOTE (21/10/2026, Rossi): "le quote tra 1,40 e 1,70 sono nella fascia d'oro, pero' devono
 * essere allineate con le altre quote: se una non lo e', quella quota e' anomala, campanello d'allarme".
 *
 * Si parte SOLO dalle quote (poi vengono dossier e AI, vedi percorso.ts):
 *  1. aggio di ogni famiglia (quanto trattiene il book);
 *  2. distribuzione dei gol che il book ha in testa (scala Under/Over: pavimento, cuore, soffitto);
 *  3. chi segna (gol attesi casa/ospite);
 *  4. per ogni mercato la QUOTA COERENTE = quella che dovrebbe avere secondo le ALTRE quote della partita
 *     (Poisson stimato escludendo la sua famiglia) e lo stato: in linea / protetta (il book l'ha abbassata) /
 *     lasciata alta (il book non ci crede);
 *  5. risultati esatti protetti o lasciati alti (solo con la scheda Sisal);
 *  6. stesso evento pagato diverso in due mercati (es. 0-0 come Under 0,5 e come risultato esatto).
 * Solo calcoli, nessun accesso al DB: lo usano lettura, percorso e prompt dell'AI.
 * Le soglie di scarto sono misurate sull'archivio con scripts/misura-paletti.mts.
 */
import { evaluateMarketOutcome } from "../../../frontend/src/api";
import { quotaMercato } from "./sceltaAI";

export const ZONA_ORO: [number, number] = [1.4, 1.7];

/** Scarto abituale (mediana) e soglia oltre cui la quota e' fuori posto, in punti percentuali di probabilita'.
 *  Linee del file: misurate sull'archivio (misura-paletti.mts). Mercati solo Sisal: provvisorie, da verificare. */
export const SCARTO: Record<string, { med: number; soglia: number; misurata: boolean }> = {
  // Misurate il 21/10/2026 su 13.216 partite concluse (misura-paletti.mts, soglia = 90° percentile).
  "1": { med: 0.16, soglia: 1.68, misurata: true }, X: { med: 1.39, soglia: 1.37, misurata: true }, "2": { med: -1.59, soglia: 1.99, misurata: true },
  "1X": { med: 1.47, soglia: 1.72, misurata: true }, X2: { med: 0, soglia: 1.07, misurata: true }, "12": { med: 0, soglia: 2, misurata: false },
  GG: { med: 0.57, soglia: 2.06, misurata: true },
  U15: { med: 2.31, soglia: 1.65, misurata: true }, U25: { med: 0.41, soglia: 1.46, misurata: true }, U35: { med: -2.24, soglia: 1.77, misurata: true },
  // Multigol, combo, Under/Over 0,5-4,5-5,5: l'archivio non ha queste quote; provvisoria, da rimisurare con le letture Sisal.
  SISAL: { med: 0, soglia: 3.5, misurata: false },
};

/** Cosa e' successo in archivio quando il book ha mosso cosi' quel mercato in zona d'oro (1,40-1,70):
 *  frequenza reale meno probabilita' del book (punti) e resa alla quota. Solo casi con almeno 100 partite.
 *  "In linea" in zona: vince quanto dice il book, resa circa -8% (l'aggio). */
export const EFFETTO: Record<string, Partial<Record<"protetta" | "lasciata_alta", { n: number; punti: number; resa: number }>>> = {
  "1": { protetta: { n: 172, punti: 11.7, resa: 10.1 } },
  "2": { protetta: { n: 113, punti: 7.7, resa: 3.6 } },
  "1X": { protetta: { n: 164, punti: -0.9, resa: -9.5 } },
  X2: { lasciata_alta: { n: 259, punti: -3.7, resa: -15.1 } },
  "O1.5": { lasciata_alta: { n: 117, punti: 4.4, resa: -3.2 } },
  "O2.5": { protetta: { n: 308, punti: 3.2, resa: -3.6 }, lasciata_alta: { n: 168, punti: -1.6, resa: -11 } },
  "U2.5": { protetta: { n: 198, punti: -7.6, resa: -20.3 }, lasciata_alta: { n: 181, punti: 8.1, resa: 3.7 } },
  "O3.5": { protetta: { n: 102, punti: -8.3, resa: -22.6 } },
  "U3.5": { protetta: { n: 119, punti: 0.2, resa: -7.4 }, lasciata_alta: { n: 182, punti: 2.6, resa: -5.9 } },
  GG: { protetta: { n: 232, punti: 4.3, resa: -1.9 }, lasciata_alta: { n: 237, punti: 2.7, resa: -4.3 } },
  NG: { protetta: { n: 176, punti: -1.9, resa: -11.8 }, lasciata_alta: { n: 154, punti: -2.1, resa: -11.9 } },
};
/** Lettura dell'anomalia secondo l'archivio: conferma (vince piu' del book), trappola (vince meno), o da verificare. */
export function significato(codice: string, stato: StatoQuota): { tipo: "conferma" | "trappola" | "neutra" | "da_verificare"; testo: string } {
  if (stato !== "protetta" && stato !== "lasciata_alta") return { tipo: "neutra", testo: "" };
  const e = EFFETTO[codice]?.[stato];
  if (!e) return { tipo: "da_verificare", testo: "effetto non ancora misurato in archivio" };
  const f1 = (x: number) => x.toFixed(1).replace(".", ",");
  const testo = `in archivio ${e.punti >= 0 ? "vince" : "perde"} ${f1(Math.abs(e.punti))} punti ${e.punti >= 0 ? "più" : "più spesso"} di quanto dice il book (resa ${e.resa > 0 ? "+" : ""}${f1(e.resa)}%, ${e.n} partite)`;
  return { tipo: e.punti >= 2 ? "conferma" : e.punti <= -2 ? "trappola" : "neutra", testo };
}
/** Chiave della soglia: per segno nell'1X2 e nella doppia chance, per linea negli Under/Over e in GG/NG
 *  (Over e Under, GG e NG sono speculari: lo scarto dell'uno e' quello dell'altro cambiato di segno). */
function chiaveSoglia(codice: string, fam: string | null): { k: string; segno: 1 | -1 } {
  if (fam === "1X2" || fam === "DC") return { k: codice.toUpperCase(), segno: 1 };
  if (fam === "GG") return { k: "GG", segno: codice.toUpperCase() === "NG" ? -1 : 1 };
  if (fam?.startsWith("U")) return { k: fam, segno: codice.toUpperCase().startsWith("O") ? -1 : 1 };
  return { k: "SISAL", segno: 1 };
}

// ---------------------------------------------------------------- Poisson su griglia (precalcolata una volta)
const PASSO = 0.05, LMIN = 0.2, LMAX = 3.6, MAXG = 10;
const fatt = [1]; for (let i = 1; i <= 20; i++) fatt[i] = fatt[i - 1] * i;
const pmf = (k: number, l: number) => Math.exp(-l) * l ** k / fatt[k];
type Riga = { lh: number; la: number; p1: number; pX: number; gg: number; cdf: number[] };
let GRIGLIA: Riga[] | null = null;
function griglia(): Riga[] {
  if (GRIGLIA) return GRIGLIA;
  const out: Riga[] = [];
  const lam: number[] = []; for (let l = LMIN; l <= LMAX + 1e-9; l += PASSO) lam.push(+l.toFixed(2));
  const P = lam.map((l) => Array.from({ length: MAXG + 1 }, (_, k) => pmf(k, l)));
  for (let a = 0; a < lam.length; a++) for (let b = 0; b < lam.length; b++) {
    let p1 = 0, pX = 0, gg = 0; const tot = new Array(2 * MAXG + 1).fill(0);
    for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) {
      const p = P[a][i] * P[b][j];
      if (i > j) p1 += p; else if (i === j) pX += p;
      if (i > 0 && j > 0) gg += p;
      tot[i + j] += p;
    }
    const cdf: number[] = []; let c = 0; for (let k = 0; k <= 7; k++) { c += tot[k]; cdf.push(c); }
    out.push({ lh: lam[a], la: lam[b], p1, pX, gg, cdf });
  }
  return (GRIGLIA = out);
}

// ---------------------------------------------------------------- quote della partita, aggio tolto
type Fam = { p: Record<string, number>; aggio: number };
const num = (v: unknown) => (Number(v) > 1 ? Number(v) : null);
function famiglia(q: Record<string, number | null>): Fam | null {
  const v = Object.entries(q); if (v.some(([, x]) => !x)) return null;
  const s = v.reduce((t, [, x]) => t + 1 / x!, 0);
  return { p: Object.fromEntries(v.map(([k, x]) => [k, 1 / x! / s])), aggio: s };
}
export type QuoteLette = { fam: Record<string, Fam>; linee: number[]; sisal: Record<string, number> | null; esatti: Record<string, number> | null };
export function quoteLette(m: any): QuoteLette {
  const sx: Record<string, number> | null = m?.quote_sisal?.quote ?? null;
  const fam: Record<string, Fam> = {};
  const f1 = famiglia({ "1": num(m.odd_1), X: num(m.odd_x), "2": num(m.odd_2) }); if (f1) fam["1X2"] = f1;
  // Doppia chance: i tre esiti coprono ognuno due segni, le probabilita' sommano a 2 (aggio = somma / 2).
  const fd = famiglia({ "1X": num(m.odd_1x), X2: num(m.odd_x2), "12": num(m.odd_12) });
  if (fd) fam.DC = { p: Object.fromEntries(Object.entries(fd.p).map(([k, v]) => [k, v * 2])), aggio: fd.aggio / 2 };
  const fg = famiglia({ GG: num(m.odd_gg), NG: num(m.odd_ng) }); if (fg) fam.GG = fg;
  const col: Record<string, [string, string]> = { "1.5": ["odd_u15", "odd_o15"], "2.5": ["odd_u25", "odd_o25"], "3.5": ["odd_u35", "odd_o35"] };
  const linee: number[] = [];
  for (const s of ["0.5", "1.5", "2.5", "3.5", "4.5", "5.5"]) {
    const u = num(sx?.[`U${s}`]) ?? (col[s] ? num(m[col[s][0]]) : null);
    const o = num(sx?.[`O${s}`]) ?? (col[s] ? num(m[col[s][1]]) : null);
    const f = famiglia({ U: u, O: o });
    if (f) { fam[`U${s.replace(".", "")}`] = f; linee.push(Number(s)); }
  }
  return { fam, linee, sisal: sx, esatti: m?.quote_sisal?.esatti ?? null };
}

/** Gol attesi che spiegano meglio le quote, ESCLUDENDO una famiglia (null = tutte). */
export function stima(ql: QuoteLette, escludi: string | null = null): { lh: number; la: number } {
  const f = ql.fam;
  // Chi vince: dall'1X2; per giudicare l'1X2 si usa la doppia chance (mercato a parte), e viceversa.
  // Senza nessuna delle due il modello non saprebbe piu' chi e' la favorita (Under/Over e GG sono simmetrici).
  let p1: number | undefined, pX: number | undefined;
  if (escludi !== "1X2" && f["1X2"]) { p1 = f["1X2"].p["1"]; pX = f["1X2"].p.X; }
  else if (f.DC) { const d1 = f.DC.p["1X"], d2 = f.DC.p.X2; pX = Math.max(0.05, d1 + d2 - 1); p1 = d1 - pX; }
  const gg = escludi !== "GG" ? f.GG?.p.GG : undefined;
  const lin = ql.linee.filter((s) => `U${String(s).replace(".", "")}` !== escludi).map((s) => [Math.floor(s), f[`U${String(s).replace(".", "")}`].p.U] as const);
  let best = { e: Infinity, lh: 1.3, la: 1.1 };
  for (const r of griglia()) {
    let e = 0;
    if (p1 != null) e += 2 * (r.p1 - p1) ** 2;
    if (pX != null) e += 1.5 * (r.pX - pX) ** 2;
    if (gg != null) e += 2 * (r.gg - gg) ** 2;
    for (const [k, pu] of lin) e += (r.cdf[k] - pu) ** 2;
    if (e < best.e) best = { e, lh: r.lh, la: r.la };
  }
  return { lh: best.lh, la: best.la };
}
export function matrice(lh: number, la: number): { i: number; j: number; p: number }[] {
  const out: { i: number; j: number; p: number }[] = []; let t = 0;
  for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) { const p = pmf(i, lh) * pmf(j, la); out.push({ i, j, p }); t += p; }
  return out.map((c) => ({ ...c, p: c.p / t }));
}
const probDi = (M: { i: number; j: number; p: number }[], codice: string) => M.reduce((s, c) => s + (evaluateMarketOutcome(codice, `${c.i}-${c.j}`) === true ? c.p : 0), 0);

// ---------------------------------------------------------------- valutazione dei mercati
export type StatoQuota = "in_linea" | "protetta" | "lasciata_alta" | "non_verificabile";
export type MercatoPaletti = {
  codice: string; quota: number | null; stimata: boolean; inZona: boolean;
  pBook: number | null; pCoerente: number; quotaCoerente: number | null; scarto: number | null;
  stato: StatoQuota; logica: boolean | null; perdeCon: { ris: string; protetto: boolean | null }[];
};
export type Paletti = {
  aggio: { nome: string; pct: number }[];
  gol: { attesiCasa: number; attesiOspite: number; distribuzione: { gol: string; p: number }[]; almeno2: number; massimo3: number; massimo4: number | null; fonte: "sisal" | "file" };
  mercati: MercatoPaletti[];
  esatti: { ris: string; quota: number; pBook: number; pCoerente: number; quotaCoerente: number; stato: StatoQuota }[];
  anomalie: string[];
  incroci: string[];
  righe: string[];
};

const famDi = (c: string): string | null => {
  const k = c.trim().toUpperCase();
  if (["1", "X", "2"].includes(k)) return "1X2";
  if (["1X", "X2", "12"].includes(k)) return "DC";
  if (k === "GG" || k === "NG") return "GG";
  const u = /^([UO])(\d)\.5$/.exec(k); if (u) return `U${u[2]}5`;
  return null;
};
const pc = (x: number) => `${Math.round(x * 100)}%`;
const q2 = (x: number) => x.toFixed(2).replace(".", ",");
const NOMI: Record<string, string> = { "O2.5": "Over 2,5", "U2.5": "Under 2,5", "O1.5": "Over 1,5", "U1.5": "Under 1,5", "O3.5": "Over 3,5", "U3.5": "Under 3,5", "GG + O2.5": "GG + Over 2,5", "X oppure GG": "X o GG" };
export const nomeMercato = (c: string) => NOMI[c] ?? c;

const COLONNA: Record<string, string> = {
  "1": "odd_1", X: "odd_x", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "12": "odd_12", "O1.5": "odd_o15", "U1.5": "odd_u15",
  "O2.5": "odd_o25", "U2.5": "odd_u25", "O3.5": "odd_o35", "U3.5": "odd_u35", GG: "odd_gg", NG: "odd_ng",
};
/** Quota del mercato: dal file per le linee base, altrimenti scheda Sisal o stima (quotaMercato). */
function quotaDi(m: any, codice: string): { quota: number; stimata: boolean } | null {
  const col = COLONNA[codice];
  if (col) { const v = num(m[col]); return v ? { quota: v, stimata: false } : null; }
  return quotaMercato(m, codice);
}

export function valutaMercato(m: any, codice: string, ql = quoteLette(m), Mtutte?: { i: number; j: number; p: number }[]): MercatoPaletti {
  const q = quotaDi(m, codice);
  const fam = famDi(codice);
  const xogg = codice === "X oppure GG";
  const inZona = !!q && q.quota >= ZONA_ORO[0] && q.quota <= (xogg ? 1.9 : ZONA_ORO[1]) + 1e-9;
  // La doppia chance nasce dall'1X2: per giudicarla si tolgono entrambe.
  const s = stima(ql, fam === "DC" ? "1X2" : fam);
  const M = fam ? matrice(s.lh, s.la) : (Mtutte ?? matrice(s.lh, s.la));
  const pCoerente = probDi(M, codice);
  // Probabilita' del book senza aggio: dalla sua famiglia, oppure con l'aggio medio delle linee della partita.
  const linee = Object.entries(ql.fam).filter(([k]) => /^U\d5$/.test(k)).map(([, f]) => f.aggio);
  const aggioRif = linee.length ? linee.reduce((a, b) => a + b, 0) / linee.length : 1.08;
  let pBook: number | null = null, aggio = aggioRif;
  if (q && !q.stimata) {
    const F = fam ? ql.fam[fam] : null;
    const chiave = fam?.startsWith("U") ? (codice.startsWith("U") ? "U" : "O") : codice.toUpperCase();
    if (F && F.p[chiave] != null) { pBook = F.p[chiave]; aggio = F.aggio; }
    else pBook = 1 / q.quota / aggioRif;
  }
  const cs = chiaveSoglia(codice, fam);
  const soglia = SCARTO[cs.k] ?? SCARTO.SISAL;
  const scarto = pBook == null ? null : (pBook - pCoerente) * 100 - cs.segno * soglia.med;
  const stato: StatoQuota = scarto == null ? "non_verificabile" : scarto > soglia.soglia ? "protetta" : scarto < -soglia.soglia ? "lasciata_alta" : "in_linea";
  // Dove perde: i 3 risultati piu' probabili che lo battono, e se il book li protegge (esatti Sisal).
  const Mall = Mtutte ?? M;
  const perdeCon = Mall.filter((c) => evaluateMarketOutcome(codice, `${c.i}-${c.j}`) === false)
    .sort((a, b) => b.p - a.p).slice(0, 3).map((c) => {
      const k = `${c.i}-${c.j}`, qe = ql.esatti?.[k];
      const tot = ql.esatti ? Object.values(ql.esatti).reduce((t, v) => t + 1 / v, 0) : 0;
      return { ris: k, protetto: qe && tot ? (1 / qe / tot) > c.p * 1.1 : null };
    });
  return {
    codice, quota: q?.quota ?? null, stimata: !!q?.stimata, inZona, pBook, pCoerente,
    quotaCoerente: pCoerente > 0.01 ? Math.round(100 / (pCoerente * aggio)) / 100 : null,
    scarto: scarto == null ? null : Math.round(scarto * 10) / 10, stato,
    logica: stato === "non_verificabile" ? null : inZona && stato === "in_linea",
    perdeCon,
  };
}

const BASE = ["1", "X", "2", "1X", "X2", "O1.5", "U1.5", "O2.5", "U2.5", "O3.5", "U3.5", "GG", "NG"];

export function paletti(m: any, codici: string[] = []): Paletti {
  const ql = quoteLette(m);
  const tutte = stima(ql, null);
  const M = matrice(tutte.lh, tutte.la);
  const lista = [...new Set([...codici, ...BASE])];
  const mercati = lista.map((c) => valutaMercato(m, c, ql, M)).filter((x) => x.quota != null);

  const aggio = Object.entries(ql.fam).map(([k, f]) => ({ nome: k === "1X2" ? "1X2" : k === "DC" ? "Doppia chance" : k === "GG" ? "GG/NG" : `Under/Over ${k[1]},5`, pct: Math.round((f.aggio - 1) * 1000) / 10 }));
  const aggEs = Number(m?.quote_sisal?.esatti_aggio) || (ql.esatti ? Object.values(ql.esatti).reduce((t, v) => t + 1 / v, 0) : 0);
  if (aggEs > 1) aggio.push({ nome: "Risultato esatto", pct: Math.round((aggEs - 1) * 1000) / 10 });

  // Distribuzione dei gol: dalla scala del book (aggio tolto) se completa, altrimenti dal Poisson.
  const fonte: "sisal" | "file" = ql.linee.includes(0.5) && ql.linee.includes(4.5) ? "sisal" : "file";
  const cdf = (k: number) => {
    const f = ql.fam[`U${k}5`];
    return fonte === "sisal" && f ? f.p.U : M.reduce((s, c) => s + (c.i + c.j <= k ? c.p : 0), 0);
  };
  const distribuzione: { gol: string; p: number }[] = []; let prima = 0;
  for (let k = 0; k <= 5; k++) { const c = cdf(k); distribuzione.push({ gol: String(k), p: Math.max(0, c - prima) }); prima = c; }
  distribuzione.push({ gol: "6+", p: Math.max(0, 1 - prima) });
  const gol = { attesiCasa: tutte.lh, attesiOspite: tutte.la, distribuzione, almeno2: 1 - cdf(1), massimo3: cdf(3), massimo4: ql.fam.U45 ? cdf(4) : null, fonte };

  // Risultati esatti (scheda Sisal): book senza aggio contro le altre quote.
  const esatti: Paletti["esatti"] = [];
  if (ql.esatti) {
    // Aggio vero dal mercato a 26 esiti (con ALTRO) quando c'e'; la somma dei soli risultati elencati e' un ripiego.
    const tot = Number(m?.quote_sisal?.esatti_aggio) || Object.values(ql.esatti).reduce((t, v) => t + 1 / v, 0);
    for (const [k, quota] of Object.entries(ql.esatti)) {
      const [i, j] = k.split("-").map(Number); const c = M.find((x) => x.i === i && x.j === j); if (!c) continue;
      const pBook = 1 / quota / tot, r = pBook / c.p;
      esatti.push({ ris: k, quota, pBook, pCoerente: c.p, quotaCoerente: Math.round(100 / (c.p * tot)) / 100, stato: r > 1.15 ? "protetta" : r < 0.85 ? "lasciata_alta" : "in_linea" });
    }
    esatti.sort((a, b) => b.pCoerente - a.pCoerente);
  }

  // Anomalie: mercati in zona ma fuori linea, ordine dei risultati esatti, segnali del book.
  const anomalie: string[] = [];
  for (const x of mercati) {
    if ((x.stato !== "protetta" && x.stato !== "lasciata_alta") || x.quota! > 2.5) continue;
    const s = significato(x.codice, x.stato);
    anomalie.push(`${nomeMercato(x.codice)} ${q2(x.quota!)}: con le altre quote sarebbe ~${q2(x.quotaCoerente!)}, ` +
      (x.stato === "protetta" ? "il book l'ha abbassata (la protegge)" : "il book la lascia alta (non ci crede)") +
      `${s.testo ? `; ${s.testo}` : ""}${s.tipo === "conferma" ? " → CONFERMA" : s.tipo === "trappola" ? " → TRAPPOLA" : ""}.`);
  }
  const eq = (k: string) => ql.esatti?.[k];
  for (const [basso, alto, lato] of [["2-1", "3-1", "casa"], ["1-0", "2-0", "casa"], ["1-2", "1-3", "ospite"], ["0-1", "0-2", "ospite"]] as const) {
    const a = eq(basso), b = eq(alto); if (!a || !b) continue;
    const lam = lato === "casa" ? tutte.lh : tutte.la;
    if (b < a && lam < 3) anomalie.push(`Il ${alto} (${q2(b)}) è quotato sotto il ${basso} (${q2(a)}) con solo ${q2(lam)} gol attesi per la ${lato}: il book protegge la goleada.`);
  }

  // Stesso evento, prezzi diversi.
  const incroci: string[] = [];
  const conf = (a: number | undefined | null, b: number | undefined | null, testo: (x: number, y: number) => string) => {
    if (a && b && Math.abs(a - b) / Math.min(a, b) >= 0.15) incroci.push(testo(a, b));
  };
  conf(ql.sisal?.["U0.5"], eq("0-0"), (u, e) => `0-0: Under 0,5 a ${q2(u)}, risultato esatto a ${q2(e)}: conviene ${u > e ? "l'Under 0,5" : "il risultato esatto"}.`);
  conf(ql.sisal?.["GG + U2.5"], eq("1-1"), (g, e) => `1-1: GG + Under 2,5 a ${q2(g)}, risultato esatto a ${q2(e)}: conviene ${g > e ? "GG + Under 2,5" : "il risultato esatto"}.`);

  // Righe di sintesi (scheda e prompt dell'AI).
  const top = [...distribuzione].sort((a, b) => b.p - a.p).slice(0, 2).map((d) => d.gol).sort();
  const righe = [
    `Aggio del book: ${aggio.map((a) => `${a.nome} ${String(a.pct).replace(".", ",")}%`).join(" · ")}.`,
    `Gol attesi: casa ${q2(gol.attesiCasa)}, ospite ${q2(gol.attesiOspite)}. Il book si aspetta soprattutto ${top.join("-")} gol; almeno 2 gol nel ${pc(gol.almeno2)}, massimo 3 nel ${pc(gol.massimo3)}${gol.massimo4 != null ? `, massimo 4 nel ${pc(gol.massimo4)}` : ""}.`,
    chiSegna(mercati),
    ...mercati.filter((x) => codici.includes(x.codice)).map((x) => `${nomeMercato(x.codice)} ${q2(x.quota!)}${x.stimata ? "*" : ""}: ${x.inZona ? "in zona d'oro" : "fuori zona"}, ${x.stato === "non_verificabile" ? "quota stimata, allineamento non verificabile" : x.stato === "in_linea" ? `allineata (coerente ~${q2(x.quotaCoerente!)})` : x.stato === "protetta" ? `protetta (coerente ~${q2(x.quotaCoerente!)})` : `lasciata alta (coerente ~${q2(x.quotaCoerente!)})`}. Perde con ${x.perdeCon.map((r) => r.ris + (r.protetto ? " (protetto)" : "")).join(", ")}.`),
  ];
  return { aggio, gol, mercati, esatti, anomalie, incroci, righe };
}

/** Chi segna: pareggio e GG/NG protetti o lasciati alti dal book. */
function chiSegna(mercati: MercatoPaletti[]): string {
  const st = (c: string) => mercati.find((x) => x.codice === c);
  const voce = (c: string, nome: string) => {
    const x = st(c); if (!x || x.stato === "non_verificabile") return null;
    return `${nome} ${x.stato === "protetta" ? `protetto (${q2(x.quota!)}, con le altre quote ~${q2(x.quotaCoerente!)})` : x.stato === "lasciata_alta" ? `lasciato alto (${q2(x.quota!)}, ~${q2(x.quotaCoerente!)})` : "in linea"}`;
  };
  return `Chi segna: ${[voce("X", "pareggio"), voce("GG", "GG"), voce("NG", "NG")].filter(Boolean).join(", ")}.`;
}

/** Il book conferma il mercato? In zona d'oro e allineato alle altre quote. null = non verificabile (stima). */
export function logicaDi(p: Paletti | null, codice: string): boolean | null {
  return p?.mercati.find((x) => x.codice === codice)?.logica ?? null;
}
