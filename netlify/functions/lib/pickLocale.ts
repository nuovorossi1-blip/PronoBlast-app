import { evaluateMarketStrict, comboOdd, estimateMarketOdd, type Odds } from "./clusterEngine";

/**
 * PICK LOCALE — il metodo a sei passi di Rossi (28/09/2026).
 *
 * Sostituisce `quickPredictionFamily`, che era una scaletta di soglie fisse
 * sulle quote ("se la favorita e' sotto 1,85 allora...") senza nessun modello
 * sotto. Qui invece: si depurano le quote, si cercano i lambda che riproducono
 * meglio le probabilita' del book, si costruisce il cluster dei risultati
 * attesi, si misura quanto ciascun pattern lo copre, si scartano le quote sotto
 * soglia e si ordina.
 *
 * DUE CLUSTER, NON UNO. Quello TEORICO viene da Poisson; quello REALE dai
 * punteggi visti davvero nelle partite con quote simili. Stessa domanda — "cosa
 * mi aspetto che succeda" — con una risposta dalla teoria e una dalla storia.
 * Dove divergono c'e' informazione: su Sparta - Slavia il GG risultava 52,6%
 * teorico contro 59,6% reale, perche' Poisson assume i due attacchi
 * indipendenti e nella realta' non lo sono.
 *
 * PERCENTUALE ASSOLUTA E PERCENTUALE DI CLUSTER, tutte e due. La seconda e'
 * condizionata: "dato che il risultato cade nell'85% piu' probabile". Ma il 15%
 * tagliato si gioca lo stesso, e li' vivono i mercati larghi. Tenerle entrambe
 * permette di misurare piu' avanti quale delle due ordina meglio, invece di
 * deciderlo a priori.
 */

/** I 15 pattern scelti da Rossi. Tutto il resto — Under, NG, 12, X secco,
 *  O1.5, O3.5 — e' escluso a priori e non compare nemmeno. */
export const PATTERN_LOCALI = [
  "1", "2", "1X", "X2", "GG", "O2.5",
  "MG 2-4 totali", "MG 3-6 totali",
  "DC 1X + GG", "DC X2 + GG", "GG + O2.5",
  "DC 1X + O2.5", "DC X2 + O2.5",
  "1 + U4.5", "2 + U4.5",
] as const;

/** Soglia minima: sotto non si gioca, per decisione di Rossi. */
export const SOGLIA_MINIMA = 1.35;

/** Fasce di quota per la classifica finale. */
export const FASCE: { da: number; a: number; etichetta: string }[] = [
  { da: 1.35, a: 1.50, etichetta: "1,35 – 1,49" },
  { da: 1.50, a: 1.60, etichetta: "1,50 – 1,59" },
  { da: 1.60, a: 1.70, etichetta: "1,60 – 1,69" },
  { da: 1.70, a: 99, etichetta: "1,70 e oltre" },
];

/** Massa di probabilita' da coprire con il cluster. Adattivo: quanti risultati
 *  servano dipende dalla partita, non e' un numero fisso di 8 o 12. */
const MASSA = 0.85;

/** Sotto questo campione il cluster reale non e' affidabile: si usa il teorico. */
export const MIN_SIMILI = 20;

const num = (o: any, ...k: string[]) => {
  for (const x of k) {
    const v = o?.[x];
    if (typeof v === "number" && v > 1) return v;
  }
  return 0;
};

export type ProbDepurate = {
  p1: number; pX: number; p2: number;
  o15: number; o25: number; o35: number; gg: number;
  aggio1x2: number;
};

/** PASSO 1 — probabilita' implicite, tolto l'aggio del bookmaker. */
export function depura(odds: Odds): ProbDepurate | null {
  const q1 = num(odds, "odd_1"), qX = num(odds, "odd_X", "odd_x"), q2 = num(odds, "odd_2");
  if (!q1 || !qX || !q2) return null;
  const s = 1 / q1 + 1 / qX + 1 / q2;
  const coppia = (a: number, b: number, dflt: number) => {
    if (!a || !b) return dflt;
    const t = 1 / a + 1 / b;
    return 1 / a / t;
  };
  return {
    p1: 1 / q1 / s, pX: 1 / qX / s, p2: 1 / q2 / s,
    o15: coppia(num(odds, "odd_O15", "odd_o15"), num(odds, "odd_U15", "odd_u15"), 0.75),
    o25: coppia(num(odds, "odd_O25", "odd_o25"), num(odds, "odd_U25", "odd_u25"), 0.5),
    o35: coppia(num(odds, "odd_O35", "odd_o35"), num(odds, "odd_U35", "odd_u35"), 0.3),
    gg: coppia(num(odds, "odd_GG", "odd_gg"), num(odds, "odd_NG", "odd_ng"), 0.5),
    aggio1x2: s - 1,
  };
}

function fattoriale(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
const poisson = (k: number, l: number) => (Math.exp(-l) * Math.pow(l, k)) / fattoriale(k);

function probabilitaDa(lh: number, la: number, max = 8) {
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

function errore(lh: number, la: number, f: ProbDepurate): number {
  const p = probabilitaDa(lh, la);
  return Math.abs(p.p1 - f.p1) + Math.abs(p.pX - f.pX) + Math.abs(p.p2 - f.p2)
    + Math.abs(p.o15 - f.o15) + Math.abs(p.o25 - f.o25) + Math.abs(p.o35 - f.o35)
    + Math.abs(p.gg - f.gg);
}

/**
 * PASSO 2 — i lambda che riproducono meglio le probabilita' depurate.
 *
 * Due fasi: prima passo grosso su tutta la griglia 0,30-3,20, poi passo fine
 * attorno al minimo. La ricerca completa a passo 0,01 sarebbe 84.000
 * combinazioni per partita — troppo per una lista di 300; cosi' sono circa
 * 1.100 e il risultato e' lo stesso.
 *
 * Sostituisce `deriveLambdas`, che usa la formula lineare
 * `2.0 + (probOver2.5 - 0.3) * 3.5`: misurata sugli esempi di Rossi sbagliava
 * quattro volte tanto, e sulle partite sbilanciate sottostimava del 30% i gol
 * attesi dell'ospite — il difetto "GG e NG appaiati" gia' segnalato a settembre.
 */
export function cercaLambda(f: ProbDepurate): { casa: number; ospite: number; errore: number } {
  let best = { casa: 1, ospite: 1, errore: Infinity };
  for (let lh = 0.3; lh <= 3.2001; lh += 0.1) {
    for (let la = 0.3; la <= 3.2001; la += 0.1) {
      const e = errore(lh, la, f);
      if (e < best.errore) best = { casa: lh, ospite: la, errore: e };
    }
  }
  const c0 = best.casa, o0 = best.ospite;
  for (let lh = Math.max(0.3, c0 - 0.1); lh <= Math.min(3.2, c0 + 0.1001); lh += 0.01) {
    for (let la = Math.max(0.3, o0 - 0.1); la <= Math.min(3.2, o0 + 0.1001); la += 0.01) {
      const e = errore(lh, la, f);
      if (e < best.errore) best = { casa: lh, ospite: la, errore: e };
    }
  }
  return {
    casa: Math.round(best.casa * 100) / 100,
    ospite: Math.round(best.ospite * 100) / 100,
    errore: Math.round(best.errore * 1000) / 1000,
  };
}

export type VoceCluster = { punteggio: string; pct: number };

/** PASSO 3a — cluster teorico: gli score piu' probabili fino all'85% di massa. */
export function clusterTeorico(lh: number, la: number, max = 9): VoceCluster[] {
  const celle: [string, number][] = [];
  let tot = 0;
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const p = poisson(h, lh) * poisson(a, la);
      celle.push([`${h}-${a}`, p]);
      tot += p;
    }
  }
  celle.sort((x, y) => y[1] - x[1]);
  const out: VoceCluster[] = [];
  let cum = 0;
  for (const [punteggio, p] of celle) {
    const pct = p / tot;
    out.push({ punteggio, pct });
    cum += pct;
    if (cum >= MASSA) break;
  }
  return out;
}

/** PASSO 3b — cluster reale: i punteggi visti nelle partite con quote simili. */
export function clusterReale(punteggi: [number, number][]): VoceCluster[] {
  if (!punteggi.length) return [];
  const conta = new Map<string, number>();
  for (const [h, a] of punteggi) {
    const k = `${h}-${a}`;
    conta.set(k, (conta.get(k) || 0) + 1);
  }
  const ordinati = [...conta.entries()]
    .map(([punteggio, n]) => ({ punteggio, pct: n / punteggi.length }))
    .sort((x, y) => y.pct - x.pct);
  const out: VoceCluster[] = [];
  let cum = 0;
  for (const v of ordinati) {
    out.push(v);
    cum += v.pct;
    if (cum >= MASSA) break;
  }
  return out;
}

/** Quanta parte del cluster un pattern copre: in assoluto e sul totale del cluster. */
function copertura(pattern: string, cluster: VoceCluster[]): { ass: number; clu: number } {
  let coperta = 0, totale = 0;
  for (const v of cluster) {
    totale += v.pct;
    const [h, a] = v.punteggio.split("-").map(Number);
    if (evaluateMarketStrict(pattern, h, a)) coperta += v.pct;
  }
  return {
    ass: Math.round(coperta * 1000) / 10,
    clu: totale ? Math.round((coperta / totale) * 1000) / 10 : 0,
  };
}

export type VocePattern = {
  pattern: string;
  quota: number | null;
  quota_reale: boolean;
  teorico_ass: number; teorico_clu: number;
  reale_ass: number | null; reale_clu: number | null;
  scarto: number | null;
  ammesso: boolean;
  motivo_scarto?: string;
};

/** PASSI 4 e 5 — copertura dei 15 pattern e imbuto. */
export function coperturaPattern(
  odds: Odds, teo: VoceCluster[], rea: VoceCluster[],
): VocePattern[] {
  const conReale = rea.length > 0;
  return PATTERN_LOCALI.map((pattern) => {
    let quota = comboOdd(pattern, odds);
    const quota_reale = quota != null;
    if (quota == null) quota = estimateMarketOdd(pattern, odds);
    const t = copertura(pattern, teo);
    const r = conReale ? copertura(pattern, rea) : null;
    const ammesso = quota != null && quota >= SOGLIA_MINIMA;
    return {
      pattern, quota: quota != null ? Math.round(quota * 100) / 100 : null, quota_reale,
      teorico_ass: t.ass, teorico_clu: t.clu,
      reale_ass: r ? r.ass : null, reale_clu: r ? r.clu : null,
      scarto: r ? Math.round((r.clu - t.clu) * 10) / 10 : null,
      ammesso,
      motivo_scarto: ammesso ? undefined
        : quota == null ? "quota non calcolabile"
          : `quota ${quota.toFixed(2)} sotto la soglia ${SOGLIA_MINIMA.toFixed(2)}`,
    };
  });
}

/** PASSO 6 — classifica per fasce di quota. Dentro ogni fascia, ordinati per
 *  probabilita' decrescente: si sceglie la fascia e si prende il primo. */
export function perFasce(voci: VocePattern[]): { etichetta: string; voci: VocePattern[] }[] {
  const chiave = (v: VocePattern) => (v.reale_clu ?? v.teorico_clu);
  return FASCE.map((f) => ({
    etichetta: f.etichetta,
    voci: voci
      .filter((v) => v.ammesso && v.quota != null && v.quota >= f.da && v.quota < f.a)
      .sort((a, b) => chiave(b) - chiave(a)),
  })).filter((f) => f.voci.length > 0);
}
