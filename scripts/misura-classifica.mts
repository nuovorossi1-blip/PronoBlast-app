/**
 * VERIFICA DELLA CLASSIFICA PER SCENARIO (19/10/2026, Rossi). SOLA LETTURA sul database.
 *
 * Regola da verificare: nella cella dello scenario (fascia Over 3,5 x lato/forza della favorita) si gioca
 * il primo mercato per percentuale d'archivio che entra almeno il 55% ed e' pagato almeno la quota minima
 * (1 / percentuale) e almeno 1,40. Le percentuali si misurano sulle partite piu' vecchie (70%) e la regola
 * si prova sulle piu' recenti (30%), che la misura non ha visto: cosi' non si misura sugli stessi dati.
 * Multigol e combo non hanno la quota del bookmaker: si usa quella stimata dall'app (quoteCatalogo).
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   npx tsx --env-file=.env ../scripts/misura-classifica.mts
 */
import { pgGetAll, rowToOdds } from "../netlify/functions/lib/supabaseRest";
import { quoteCatalogo, quotaXoppureGG, estimateMarketOdd } from "../netlify/functions/lib/clusterEngine";
import { vinceRegole } from "../netlify/functions/lib/regolePronostico";

const COLONNE = "squadra1,squadra2,day,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_o15,odd_u15,odd_o25,odd_u25,odd_o35,odd_u35,odd_gg,odd_ng,result";
const REALI: Record<string, string> = { "1": "odd_1", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "O2.5": "odd_o25", GG: "odd_gg" };

type Riga = { day: string; h: number; a: number; row: any; odds: any; cat: Record<string, { odd: number }> };
type Cella = { scenario: string; chiave: string; banda: string; mercati: string[] };

function cella(r: any): Cella | null {
  const q1 = +r.odd_1, qx = +r.odd_x, q2 = +r.odd_2, gg = +r.odd_gg, o25 = +r.odd_o25, o35 = +r.odd_o35;
  if (!(q1 > 1 && qx > 1 && q2 > 1 && o35 > 1)) return null;
  if (q1 >= 2 && q2 >= 2) {
    if (!(gg > 1 && o25 > 1) || !(gg < 1.8 && o25 < 1.8) || (gg < 1.5 && o25 < 1.5) || o35 < 2) return null;
    const banda = o35 < 2.3 ? "2,00-2,29" : o35 < 2.6 ? "2,30-2,59" : o35 < 3 ? "2,60-2,99" : "da 3,00";
    const dir = q1 < q2 - 0.5 ? "casa" : q2 < q1 - 0.5 ? "ospite" : "vicine";
    return { scenario: "Equilibrio", chiave: `${banda} ${dir}`, banda, mercati: ["GG", "O2.5", "1X", "X2", "X oppure GG"] };
  }
  const fav = q1 <= q2 ? "1" : "2", lato = fav === "1" ? "casa" : "ospite", altro = fav === "1" ? "ospite" : "casa";
  const qf = Math.min(q1, q2), qs = Math.max(q1, q2);
  const dc = fav === "1" ? "DC 1X" : "DC X2";
  if (qx >= 4) {
    if (qs < 4) return null; // Gap falso
    const banda = o35 < 1.6 ? "sotto 1,60" : o35 < 2 ? "1,60-1,99" : o35 < 2.3 ? "2,00-2,29" : "da 2,30";
    const forza = qf < 1.4 ? "fav<1,40" : qf < 1.6 ? "fav 1,40-1,59" : "fav 1,60-1,99";
    return { scenario: "Gap", chiave: `${banda} ${forza}`, banda, mercati: [fav, `${dc} + GG`, `MG 2-4 ${lato}`, `MG 1-3 ${lato}`, "O2.5", "GG"] };
  }
  const banda = o35 < 2 ? "sotto 2,00" : o35 < 2.3 ? "2,00-2,29" : o35 < 2.6 ? "2,30-2,59" : "da 2,60";
  const forza = qf < 1.6 ? "fav<1,60" : qf < 1.8 ? "fav 1,60-1,79" : "fav 1,80-1,99";
  const combo = fav === "1" ? "MG 1-3 casa + MG 0-2 ospite" : "MG 0-2 casa + MG 1-3 ospite";
  void altro;
  return { scenario: "Progressione", chiave: `${banda} ${forza}`, banda, mercati: [combo, `MG 1-3 ${lato}`, fav, `${dc} + O1.5`] };
}

function quota(r: Riga, mk: string): number | null {
  if (REALI[mk]) { const v = +r.row[REALI[mk]]; return v > 1 ? v : null; }
  if (mk === "X oppure GG") return quotaXoppureGG(r.odds);
  return r.cat[mk]?.odd ?? estimateMarketOdd(mk, r.odds) ?? null;
}

async function main() {
  const tutte: any[] = [];
  for (const t of ["matches", "match_results_training"]) {
    const righe = await pgGetAll(`${t}?select=${COLONNE}&result=not.is.null&odd_o35=not.is.null`, "day.asc").catch((e) => { console.log(`(${t} non leggibile: ${String(e.message).slice(0, 60)})`); return []; });
    tutte.push(...righe);
  }
  const visti = new Set<string>();
  const dati: (Riga & { c: Cella })[] = [];
  for (const row of tutte.sort((x, y) => String(x.day).localeCompare(String(y.day)))) {
    const m = /^(\d+)-(\d+)$/.exec(String(row.result || "").trim());
    if (!m) continue;
    const k = `${String(row.squadra1).toLowerCase()}|${String(row.squadra2).toLowerCase()}|${row.day}`;
    if (visti.has(k)) continue;
    visti.add(k);
    const c = cella(row);
    if (!c) continue;
    const odds = rowToOdds(row);
    dati.push({ day: row.day, h: +m[1], a: +m[2], row, odds, cat: quoteCatalogo(odds as any), c });
  }
  const taglio = Math.floor(dati.length * 0.7);
  console.log(`Partite: ${dati.length} (misura fino al ${dati[taglio - 1]?.day}, prova dal ${dati[taglio]?.day})\n`);

  for (const scen of ["Equilibrio", "Gap", "Progressione"]) {
    const misura = dati.slice(0, taglio).filter((d) => d.c.scenario === scen);
    const prova = dati.slice(taglio).filter((d) => d.c.scenario === scen);
    // percentuali per cella (posizione del mercato nell'elenco), con ripiego sulla banda sotto 40 partite
    const conta = (lista: typeof misura) => {
      const out = new Map<string, { n: number; v: number[] }>();
      for (const d of lista) for (const k of [d.c.chiave, `banda ${d.c.banda}`]) {
        const e = out.get(k) ?? { n: 0, v: d.c.mercati.map(() => 0) };
        e.n++;
        d.c.mercati.forEach((mk, i) => { if (vinceRegole(mk, d.h, d.a)) e.v[i]++; });
        out.set(k, e);
      }
      return out;
    };
    const tab = conta(misura);
    const pct = (d: Riga & { c: Cella }) => {
      const e = tab.get(d.c.chiave);
      const usa = e && e.n >= 40 ? e : tab.get(`banda ${d.c.banda}`);
      return usa ? usa.v.map((x) => x / usa.n) : null;
    };
    const perMercato = new Map<string, { n: number; v: number; r: number }>();
    let n = 0, giocate = 0, vinte = 0, resa = 0;
    for (const d of prova) {
      n++;
      const p = pct(d);
      if (!p) continue;
      const ordine = d.c.mercati.map((mk, i) => ({ mk, p: p[i], i })).sort((x, y) => y.p - x.p);
      const s = ordine.find((o) => { const q = quota(d, o.mk); return o.p >= 0.55 && q != null && q >= 1.4 && q >= 1 / o.p; });
      if (!s) continue;
      const q = quota(d, s.mk)!;
      const ok = vinceRegole(s.mk, d.h, d.a) === true;
      giocate++; if (ok) vinte++; resa += ok ? q - 1 : -1;
      const nome = s.mk.replace(/ (casa|ospite)/g, " fav").replace(/^[12]$/, "fisso").replace(/^DC (1X|X2)/, "DC fav");
      const e = perMercato.get(nome) ?? { n: 0, v: 0, r: 0 };
      e.n++; if (ok) e.v++; e.r += ok ? q - 1 : -1;
      perMercato.set(nome, e);
    }
    // riferimento: ogni mercato giocato sempre (alla sua quota, da 1,40)
    const sempre = (prova[0]?.c.mercati ?? []).map((_, i) => {
      let g = 0, v = 0, r = 0, nome = "";
      for (const d of prova) {
        const mk = d.c.mercati[i]; const q = quota(d, mk);
        nome = mk.replace(/ (casa|ospite)/g, " fav").replace(/^[12]$/, "fisso").replace(/^DC (1X|X2)/, "DC fav").replace("MG 1-3 fav + MG 0-2 fav", "combo").replace("MG 0-2 fav + MG 1-3 fav", "combo");
        if (q == null || q < 1.4) continue;
        const ok = vinceRegole(mk, d.h, d.a) === true; g++; if (ok) v++; r += ok ? q - 1 : -1;
      }
      return `${nome}: ${g} giocate, ${g ? Math.round(100 * v / g) : 0}%, resa ${g ? (100 * r / g).toFixed(1) : "0"}%`;
    });
    console.log(`== ${scen}: misura ${misura.length}, prova ${n}`);
    console.log(`   REGOLA: ${giocate} giocate (${n ? Math.round(100 * giocate / n) : 0}%), vinte ${giocate ? (100 * vinte / giocate).toFixed(1) : 0}%, resa ${giocate ? (100 * resa / giocate).toFixed(1) : 0}%`);
    for (const [k, e] of perMercato) console.log(`     ${k}: ${e.n} giocate, ${Math.round(100 * e.v / e.n)}%, resa ${(100 * e.r / e.n).toFixed(1)}%`);
    console.log(`   SEMPRE (da 1,40): ${sempre.join(" | ")}\n`);
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
