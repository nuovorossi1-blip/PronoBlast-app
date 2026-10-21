/**
 * MISURA DEI PALETTI DELLE QUOTE (21/10/2026, Rossi). SOLA LETTURA.
 *
 * Domande:
 *  1. Quanto si scosta di solito ogni linea del file (1, X, 2, DC, Under/Over, GG) dalla quota che dovrebbe
 *     avere secondo le ALTRE quote? (mediana e 90°/95° percentile -> costanti SCARTO di lib/paletti.ts)
 *  2. Nella zona d'oro 1,40-1,70, i mercati "allineati" vincono piu' di quelli "protetti" o "lasciati alti"?
 *     (frequenza reale contro probabilita' del book senza aggio, e resa alla quota)
 * Dati: partite concluse della tabella matches (le 14 quote del file + risultato).
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   node --env-file=.env --import tsx ../scripts/misura-paletti.mts [--da=2025-01-01] [--soglia=p90|p95]
 */
import { pgGetAll } from "../netlify/functions/lib/supabaseRest";
import { quoteLette, stima, matrice } from "../netlify/functions/lib/paletti";
import { evaluateMarketOutcome } from "../frontend/src/api";

const da = process.argv.find((a) => a.startsWith("--da="))?.slice(5) || "2000-01-01";
const quale = process.argv.find((a) => a.startsWith("--soglia="))?.slice(9) || "p90";

const MERCATI: [string, string, string, string][] = [
  // codice, famiglia, colonna, chiave nella famiglia
  ["1", "1X2", "odd_1", "1"], ["X", "1X2", "odd_x", "X"], ["2", "1X2", "odd_2", "2"],
  ["1X", "DC", "odd_1x", "1X"], ["X2", "DC", "odd_x2", "X2"],
  ["O1.5", "U15", "odd_o15", "O"], ["U1.5", "U15", "odd_u15", "U"],
  ["O2.5", "U25", "odd_o25", "O"], ["U2.5", "U25", "odd_u25", "U"],
  ["O3.5", "U35", "odd_o35", "O"], ["U3.5", "U35", "odd_u35", "U"],
  ["GG", "GG", "odd_gg", "GG"], ["NG", "GG", "odd_ng", "NG"],
];
type Riga = { codice: string; fam: string; quota: number; pBook: number; pCoer: number; d: number; vinto: boolean };

const righe = await pgGetAll(
  `matches?result=not.is.null&day=gte.${da}&select=id,day,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng`,
);
console.log(`Partite concluse: ${righe.length} (dal ${da})`);
const dati: Riga[] = [];
let k = 0;
for (const m of righe) {
  if (++k % 500 === 0) console.error(`  ${k}/${righe.length}`);
  const res = String(m.result || "").replace(/\s/g, "");
  if (!/^\d+-\d+$/.test(res)) continue;
  const ql = quoteLette(m);
  if (!ql.fam["1X2"] || !ql.fam.U25) continue;
  const cache: Record<string, ReturnType<typeof matrice>> = {};
  for (const [codice, fam, col, chiave] of MERCATI) {
    const F = ql.fam[fam]; const quota = Number(m[col]);
    if (!F || !(quota > 1)) continue;
    const escl = fam === "DC" ? "1X2" : fam;
    const M = cache[escl] ??= (() => { const s = stima(ql, escl); return matrice(s.lh, s.la); })();
    const pCoer = M.reduce((s, c) => s + (evaluateMarketOutcome(codice, `${c.i}-${c.j}`) === true ? c.p : 0), 0);
    const pBook = F.p[chiave];
    const vinto = evaluateMarketOutcome(codice, res);
    if (vinto === null) continue;
    dati.push({ codice, fam, quota, pBook, pCoer, d: (pBook - pCoer) * 100, vinto });
  }
}

const perc = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (x: number) => x.toFixed(1).replace(".", ",");
console.log("\n1) SCARTO DALLE ALTRE QUOTE (punti di probabilita'): mediana, 90° e 95° percentile dello scarto dalla mediana");
// Stessa chiave di chiaveSoglia in lib/paletti.ts: per segno in 1X2/DC, la parte "Under"/"GG" per le coppie.
const chiave = (r: Riga) => r.fam === "1X2" || r.fam === "DC" ? r.codice : r.fam;
const soglie: Record<string, { med: number; p90: number; p95: number }> = {};
for (const key of ["1", "X", "2", "1X", "X2", "GG", "U15", "U25", "U35"]) {
  const v = dati.filter((r) => chiave(r) === key && (r.fam === "1X2" || r.fam === "DC" || r.codice === "GG" || r.codice.startsWith("U")));
  if (!v.length) continue;
  const fam = key;
  const med = perc(v.map((r) => r.d), 0.5);
  const scost = v.map((r) => Math.abs(r.d - med));
  soglie[fam] = { med, p90: perc(scost, 0.9), p95: perc(scost, 0.95) };
  console.log(`  ${fam.padEnd(4)} n=${v.length}  mediana ${f1(med)}  p90 ${f1(soglie[fam].p90)}  p95 ${f1(soglie[fam].p95)}`);
}

console.log(`\n2) ZONA D'ORO 1,40-1,70 (soglia ${quale}): frequenza reale contro book senza aggio, e resa alla quota`);
const stato = (r: Riga) => {
  const s = soglie[chiave(r)]; if (!s) return "in_linea";
  const speculare = r.codice === "NG" || r.codice.startsWith("O");
  const d = r.d - (speculare ? -s.med : s.med), t = quale === "p95" ? s.p95 : s.p90;
  return d > t ? "protetta" : d < -t ? "lasciata_alta" : "in_linea";
};
const zona = dati.filter((r) => r.quota >= 1.4 && r.quota <= 1.7 + 1e-9);
const tab = (lista: Riga[]) => {
  const n = lista.length; if (!n) return "—";
  const v = lista.filter((r) => r.vinto).length;
  const book = lista.reduce((s, r) => s + r.pBook, 0) / n;
  const resa = lista.reduce((s, r) => s + (r.vinto ? r.quota - 1 : -1), 0) / n;
  return `n=${String(n).padStart(5)}  vinte ${f1(100 * v / n)}%  book ${f1(100 * book)}%  scarto ${f1(100 * (v / n - book))}  resa ${f1(100 * resa)}%`;
};
for (const st of ["in_linea", "protetta", "lasciata_alta"]) console.log(`  TUTTI ${st.padEnd(14)} ${tab(zona.filter((r) => stato(r) === st))}`);
for (const [codice] of MERCATI) {
  const z = zona.filter((r) => r.codice === codice); if (z.length < 100) continue;
  console.log(`  ${codice}`);
  for (const st of ["in_linea", "protetta", "lasciata_alta"]) {
    const l = z.filter((r) => stato(r) === st); if (l.length) console.log(`     ${st.padEnd(14)} ${tab(l)}`);
  }
}
console.log("\nCostanti per lib/paletti.ts (SCARTO):");
console.log(JSON.stringify(Object.fromEntries(Object.entries(soglie).map(([f, s]) => [f, { med: +s.med.toFixed(2), soglia: +(quale === "p95" ? s.p95 : s.p90).toFixed(2), misurata: true }]))));
