/**
 * POISSON BIVARIATA — porting TypeScript del metodo del proprietario
 * (ISTRUZIONI_LLM_QUOTE_CALCIO.md, versione 1.0; round 2, TICKET 6).
 *
 * SOLO MISURA. Non entra nel motore, nel verdetto ne' nella scheda: la usa
 * /misura-stime per confrontarla con il motore dell'app (Poisson indipendente a
 * 2 parametri, `deriveLambdas`). Un eventuale passaggio al motore bivariato
 * va dietro un interruttore e lo decide il proprietario sui numeri.
 *
 * Il modello: X~Pois(a), Y~Pois(b), Z~Pois(c) indipendenti; gol casa H = X+Z,
 * gol ospiti V = Y+Z. Il termine comune Z da' correlazione positiva (il
 * "surplus di pareggi" che il book prezza e due parametri indipendenti no).
 *
 * Calibrazione VINCOLANTE (sezione 5 del documento): minimi quadrati sui 7
 * target normalizzati [P(1), P(X), P(2), P(U1,5), P(U2,5), P(U3,5), P(GG)],
 * peso 1, vincoli 0.001<=a,b<=8, 0<=c<=4, cinque punti di partenza fissi, si
 * tiene la soluzione con errore minore. Il documento usa
 * scipy.optimize.least_squares (trf): qui non c'e' SciPy, quindi un
 * Levenberg-Marquardt con proiezione sui vincoli, con le stesse tolleranze.
 * La verifica e' il benchmark della sezione 11, che questo codice riproduce
 * (vedi `BENCHMARK` e il CHANGELOG del 02/10/2026).
 */

export type QuoteBivariata = {
  q1: number; qx: number; q2: number;
  u15: number; o15: number; u25: number; o25: number; u35: number; o35: number;
  gg: number; ng: number;
};

export type StimaBivariata = {
  a: number; b: number; c: number;
  /** i 7 target normalizzati e i 7 del modello, nello stesso ordine */
  target: number[];
  modello: number[];
  rmse_pp: number;
  scarto_massimo_pp: number;
  /** probabilita' dei 12 mercati della sezione 6 */
  mercati: Record<IdMercato, number>;
};

export type IdMercato =
  | "1_U45" | "2_U45" | "O25_GG" | "MG_H_1_3" | "MG_A_1_3" | "MG_H_2_4" | "MG_A_2_4"
  | "MG_H_1_3_A_0_2" | "MG_H_0_2_A_1_3" | "MG_T_2_4" | "MG_T_3_6" | "X_OR_GG";

/** I 12 mercati (sezione 6), con la condizione sui gol h,v e il nome nell'app. */
export const MERCATI_BIVARIATA: { id: IdMercato; app: string; vince: (h: number, v: number) => boolean }[] = [
  { id: "1_U45", app: "1 + U4.5", vince: (h, v) => h > v && h + v <= 4 },
  { id: "2_U45", app: "2 + U4.5", vince: (h, v) => v > h && h + v <= 4 },
  { id: "O25_GG", app: "GG + O2.5", vince: (h, v) => h >= 1 && v >= 1 && h + v >= 3 },
  { id: "MG_H_1_3", app: "MG 1-3 casa", vince: (h) => h >= 1 && h <= 3 },
  { id: "MG_A_1_3", app: "MG 1-3 ospite", vince: (_h, v) => v >= 1 && v <= 3 },
  { id: "MG_H_2_4", app: "MG 2-4 casa", vince: (h) => h >= 2 && h <= 4 },
  { id: "MG_A_2_4", app: "MG 2-4 ospite", vince: (_h, v) => v >= 2 && v <= 4 },
  { id: "MG_H_1_3_A_0_2", app: "MG 1-3 casa + MG 0-2 ospite", vince: (h, v) => h >= 1 && h <= 3 && v <= 2 },
  { id: "MG_H_0_2_A_1_3", app: "MG 0-2 casa + MG 1-3 ospite", vince: (h, v) => h <= 2 && v >= 1 && v <= 3 },
  { id: "MG_T_2_4", app: "MG 2-4 totali", vince: (h, v) => h + v >= 2 && h + v <= 4 },
  { id: "MG_T_3_6", app: "MG 3-6 totali", vince: (h, v) => h + v >= 3 && h + v <= 6 },
  { id: "X_OR_GG", app: "X oppure GG", vince: (h, v) => h === v || (h >= 1 && v >= 1) },
];

/** Fattore di prezzo standard del documento (sezione 7): quota = 1 / (p * f). */
export const FATTORE_PREZZO = 1.08;

// Le code oltre i 40 gol sono trascurabili anche al limite a,b = 8.
const MAX_GOL = 40;
const fatt: number[] = [1];
for (let i = 1; i <= MAX_GOL * 2 + 2; i++) fatt[i] = fatt[i - 1] * i;

function pmf(n: number, rate: number): number {
  if (n < 0) return 0;
  if (rate <= 0) return n === 0 ? 1 : 0;
  return Math.exp(-rate) * Math.pow(rate, n) / fatt[n];
}

/** P(T = n) con T = X + Y + 2Z (sezione 4). */
function totalePmf(n: number, a: number, b: number, c: number): number {
  let s = 0;
  for (let k = 0; k <= Math.floor(n / 2); k++) s += pmf(k, c) * pmf(n - 2 * k, a + b);
  return s;
}

function totaleCdf(n: number, a: number, b: number, c: number): number {
  let s = 0;
  for (let j = 0; j <= n; j++) s += totalePmf(j, a, b, c);
  return s;
}

/** P(H = h, V = v). */
export function punteggio(h: number, v: number, a: number, b: number, c: number): number {
  let s = 0;
  for (let k = 0; k <= Math.min(h, v); k++) {
    s += Math.pow(a, h - k) * Math.pow(b, v - k) * Math.pow(c, k) / (fatt[h - k] * fatt[v - k] * fatt[k]);
  }
  return Math.exp(-(a + b + c)) * s;
}

/** 1/X/2 dalla differenza X - Y (Skellam di parametri a, b). */
function esito1X2(a: number, b: number): [number, number, number] {
  const px: number[] = [], py: number[] = [];
  for (let i = 0; i <= MAX_GOL; i++) { px[i] = pmf(i, a); py[i] = pmf(i, b); }
  let p1 = 0, pX = 0, p2 = 0;
  for (let i = 0; i <= MAX_GOL; i++) {
    for (let j = 0; j <= MAX_GOL; j++) {
      const p = px[i] * py[j];
      if (i > j) p1 += p; else if (i === j) pX += p; else p2 += p;
    }
  }
  return [p1, pX, p2];
}

/** I 7 eventi del fit, nell'ordine vincolante. Con c = 0 e' la Poisson
 *  indipendente del motore dell'app: /misura-stime la usa cosi' per confrontare
 *  i due modelli con le STESSE formule. */
export function eventi(a: number, b: number, c: number): number[] {
  const [p1, pX, p2] = esito1X2(a, b);
  const p00 = Math.exp(-(a + b + c));
  const pgg = 1 - Math.exp(-(a + c)) - Math.exp(-(b + c)) + p00;
  return [p1, pX, p2, totaleCdf(1, a, b, c), totaleCdf(2, a, b, c), totaleCdf(3, a, b, c), pgg];
}

/** Normalizzazione proporzionale per famiglia (sezione 3). null se gli Under
 *  normalizzati non crescono: il documento dice di fermarsi, non di stimare. */
export function targetNormalizzati(q: QuoteBivariata): number[] | null {
  const norm = (...qs: number[]) => {
    const r = qs.map((x) => 1 / x);
    const t = r.reduce((s, x) => s + x, 0);
    return r.map((x) => x / t);
  };
  const [p1, pX, p2] = norm(q.q1, q.qx, q.q2);
  const u15 = norm(q.u15, q.o15)[0], u25 = norm(q.u25, q.o25)[0], u35 = norm(q.u35, q.o35)[0];
  const gg = norm(q.gg, q.ng)[0];
  if (u15 > u25 + 1e-10 || u25 > u35 + 1e-10) return null;
  return [p1, pX, p2, u15, u25, u35, gg];
}

const LIM_BASSI = [0.001, 0.001, 0];
const LIM_ALTI = [8, 8, 4];
const proietta = (t: number[]) => t.map((x, i) => Math.min(LIM_ALTI[i], Math.max(LIM_BASSI[i], x)));
const sse = (r: number[]) => r.reduce((s, x) => s + x * x, 0);

/** Risolve un sistema 3x3 (Cramer). null se singolare. */
function risolvi3(A: number[][], y: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!isFinite(D) || Math.abs(D) < 1e-300) return null;
  return [0, 1, 2].map((col) => det(A.map((riga, i) => riga.map((x, j) => (j === col ? y[i] : x)))) / D);
}

/** Minimi quadrati vincolati da UN punto di partenza (Levenberg-Marquardt
 *  proiettato; ftol = xtol = 1e-12, al massimo 2000 valutazioni). */
function minimizza(target: number[], start: number[]): { theta: number[]; r: number[]; ok: boolean } {
  const residui = (t: number[]) => eventi(t[0], t[1], t[2]).map((p, i) => p - target[i]);
  let theta = proietta(start);
  let r = residui(theta);
  let costo = sse(r);
  let mu = 1e-3;
  let valutazioni = 1;
  for (let iter = 0; iter < 500 && valutazioni < 2000; iter++) {
    // Jacobiano numerico (differenze centrali, rispettando i vincoli).
    const J: number[][] = r.map(() => [0, 0, 0]);
    for (let j = 0; j < 3; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(theta[j]));
      const su = theta.slice(), giu = theta.slice();
      su[j] = Math.min(LIM_ALTI[j], theta[j] + h);
      giu[j] = Math.max(LIM_BASSI[j], theta[j] - h);
      const rs = residui(su), rg = residui(giu);
      valutazioni += 2;
      const dx = su[j] - giu[j];
      for (let i = 0; i < r.length; i++) J[i][j] = dx > 0 ? (rs[i] - rg[i]) / dx : 0;
    }
    const JtJ = [0, 1, 2].map((p) => [0, 1, 2].map((q) => J.reduce((s, riga) => s + riga[p] * riga[q], 0)));
    const Jtr = [0, 1, 2].map((p) => J.reduce((s, riga, i) => s + riga[p] * r[i], 0));
    let migliorato = false;
    for (let tent = 0; tent < 30 && valutazioni < 2000; tent++) {
      const A = JtJ.map((riga, p) => riga.map((x, q) => (p === q ? x + mu * Math.max(x, 1e-12) : x)));
      const d = risolvi3(A, Jtr.map((x) => -x));
      if (!d) { mu *= 10; continue; }
      const nuovo = proietta(theta.map((x, i) => x + d[i]));
      const rn = residui(nuovo);
      valutazioni++;
      const cn = sse(rn);
      if (cn < costo) {
        const passo = Math.max(...nuovo.map((x, i) => Math.abs(x - theta[i]) / Math.max(1e-12, Math.abs(theta[i]) + 1e-12)));
        const calo = (costo - cn) / Math.max(costo, 1e-300);
        theta = nuovo; r = rn; costo = cn;
        mu = Math.max(mu / 10, 1e-15);
        migliorato = true;
        if (calo < 1e-12 || passo < 1e-12) return { theta, r, ok: true };
        break;
      }
      mu *= 10;
    }
    if (!migliorato) return { theta, r, ok: true };   // nessun passo migliora: minimo raggiunto
  }
  return { theta, r, ok: r.every((x) => isFinite(x)) };
}

const PARTENZE = [[1.0, 1.4, 0.2], [1.4, 1.0, 0.2], [2.6, 0.5, 0.25], [0.5, 2.6, 0.25], [1.2, 1.2, 0.01]];

/** Calibra a, b, c e calcola i 12 mercati. null se gli Under non crescono o
 *  nessuna partenza converge (il documento: non inventare numeri). */
export function stimaBivariata(q: QuoteBivariata): StimaBivariata | null {
  const target = targetNormalizzati(q);
  if (!target) return null;
  let migliore: { theta: number[]; r: number[] } | null = null;
  for (const s of PARTENZE) {
    const f = minimizza(target, s);
    if (f.ok && (!migliore || sse(f.r) < sse(migliore.r))) migliore = f;
  }
  if (!migliore) return null;
  const [a, b, c] = migliore.theta;
  const modello = eventi(a, b, c);
  const scarti = modello.map((p, i) => p - target[i]);
  return {
    a, b, c, target, modello,
    rmse_pp: 100 * Math.sqrt(scarti.reduce((s, x) => s + x * x, 0) / scarti.length),
    scarto_massimo_pp: 100 * Math.max(...scarti.map(Math.abs)),
    mercati: mercatiDaParametri(a, b, c),
  };
}

/** I 12 mercati della sezione 6 per parametri dati (c = 0: Poisson indipendente). */
export function mercatiDaParametri(a: number, b: number, c: number): Record<IdMercato, number> {
  const pgg = 1 - Math.exp(-(a + c)) - Math.exp(-(b + c)) + Math.exp(-(a + b + c));
  const lh = a + c, lv = b + c;
  const somma = (punti: [number, number][]) => punti.reduce((s, [h, v]) => s + punteggio(h, v, a, b, c), 0);
  const vittCasaUnder: [number, number][] = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]];
  const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const griglia = (hs: number[], vs: number[]) => hs.flatMap((h) => vs.map((v) => [h, v] as [number, number]));
  return {
    "1_U45": somma(vittCasaUnder),
    "2_U45": somma(vittCasaUnder.map(([h, v]) => [v, h] as [number, number])),
    "O25_GG": pgg - punteggio(1, 1, a, b, c),
    "MG_H_1_3": range(1, 3).reduce((s, k) => s + pmf(k, lh), 0),
    "MG_A_1_3": range(1, 3).reduce((s, k) => s + pmf(k, lv), 0),
    "MG_H_2_4": range(2, 4).reduce((s, k) => s + pmf(k, lh), 0),
    "MG_A_2_4": range(2, 4).reduce((s, k) => s + pmf(k, lv), 0),
    "MG_H_1_3_A_0_2": somma(griglia(range(1, 3), range(0, 2))),
    "MG_H_0_2_A_1_3": somma(griglia(range(0, 2), range(1, 3))),
    "MG_T_2_4": totaleCdf(4, a, b, c) - totaleCdf(1, a, b, c),
    "MG_T_3_6": totaleCdf(6, a, b, c) - totaleCdf(2, a, b, c),
    "X_OR_GG": pgg + punteggio(0, 0, a, b, c),
  };
}

/** Benchmark della sezione 11 del documento: input e valori attesi. */
export const BENCHMARK = {
  quote: { q1: 3.60, qx: 3.20, q2: 2.15, u15: 2.90, o15: 1.36, u25: 1.60, o25: 2.20, u35: 1.20, o35: 3.75, gg: 1.85, ng: 1.85 } as QuoteBivariata,
  a: 0.86381150, b: 1.21015706, c: 0.17486598, rmse_pp: 0.48771615, scarto_massimo_pp: 0.91798268,
};

