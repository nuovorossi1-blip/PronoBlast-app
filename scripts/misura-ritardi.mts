/**
 * MONITORAGGIO DEI RITARDI (13/10/2026, Rossi). SOLA LETTURA.
 *
 * Domanda: un esito "in ritardo" nelle ultime 5 partite delle due squadre
 * (Over 2.5, GG, vittoria della casa, vittoria dell'ospite) esce piu' spesso di
 * quanto dice il bookmaker? E il suo contrario (Under, NG, X2, 1X)?
 *
 * Dati: le ultime 10 partite di ogni squadra salvate PRIMA del via nel dossier
 * (numeri.programma.pesata_casa/ospite.contro, in ordine di data: si usano le
 * ultime 5). Quote e risultato dalla tabella matches.
 *
 * Prima misura (13/10, una settimana, 964 partite): Over in ritardo 35,3%
 * contro 45,6% del book (resa -28,8%); Under nello stesso caso +10,6% su 119.
 * Da rifare con 3-4 settimane di dossier prima di usarlo nel consigliato.
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   npx tsx --env-file=.env ../scripts/misura-ritardi.mts [--da=2026-10-06]
 */
import { pgGetAll, pgGet } from "../netlify/functions/lib/supabaseRest";

const da = process.argv.find((a) => a.startsWith("--da="))?.slice(5) || "2026-10-06";

type Partita = { fatti: number; subiti: number };
type Voce = { n: number; esce: number; resa: number; equo: number };

const ultime5 = (l: Partita[]) => l.slice(-5);
const conta = (l: Partita[], f: (p: Partita) => boolean) => ultime5(l).filter(f).length;
const fascia = (k: number) => (k <= 3 ? "IN RITARDO (0-3 su 10)" : k <= 6 ? "normale (4-6 su 10)" : "FREQUENTE (7-10 su 10)");
const fasciaSquadra = (k: number) => (k <= 1 ? "IN RITARDO (0-1 su 5)" : k <= 3 ? "normale (2-3 su 5)" : "FREQUENTE (4-5 su 5)");

async function main() {
  const dossier = await pgGetAll(
    "dossier_web?select=match_id,pc:numeri->programma->pesata_casa->contro,po:numeri->programma->pesata_ospite->contro",
    "match_id.asc",
  );
  const validi = dossier.filter((x: any) => Array.isArray(x.pc) && Array.isArray(x.po) && x.pc.length >= 5 && x.po.length >= 5);
  const partite = new Map<string, any>();
  const ids = validi.map((x: any) => x.match_id);
  for (let i = 0; i < ids.length; i += 150) {
    const righe = await pgGet(
      `matches?id=in.(${ids.slice(i, i + 150).join(",")})&result=not.is.null&day=gte.${da}` +
      "&select=id,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_o25,odd_u25,odd_gg,odd_ng",
    );
    for (const m of righe) partite.set(m.id, m);
  }

  const acc: Record<string, Voce> = {};
  const add = (k: string, esce: boolean, quota: number | null, equo: number) => {
    if (!quota) return;
    const a = (acc[k] ||= { n: 0, esce: 0, resa: 0, equo: 0 });
    a.n++; a.esce += +esce; a.resa += esce ? quota - 1 : -1; a.equo += equo;
  };

  for (const x of validi as any[]) {
    const m = partite.get(x.match_id);
    if (!m) continue;
    const r = /^(\d+)-(\d+)$/.exec(String(m.result).trim());
    if (!r) continue;
    const h = Number(r[1]), a = Number(r[2]);
    const pc: Partita[] = x.pc, po: Partita[] = x.po;

    if (m.odd_o25 && m.odd_u25) {
      const e = (1 / m.odd_o25) / (1 / m.odd_o25 + 1 / m.odd_u25);
      const f = fascia(conta(pc, (p) => p.fatti + p.subiti >= 3) + conta(po, (p) => p.fatti + p.subiti >= 3));
      add(`Over 2.5 · Over ${f} -> gioco Over`, h + a >= 3, m.odd_o25, e);
      add(`Over 2.5 · Over ${f} -> gioco Under`, h + a <= 2, m.odd_u25, 1 - e);
    }
    if (m.odd_gg && m.odd_ng) {
      const e = (1 / m.odd_gg) / (1 / m.odd_gg + 1 / m.odd_ng);
      const f = fascia(conta(pc, (p) => p.fatti > 0 && p.subiti > 0) + conta(po, (p) => p.fatti > 0 && p.subiti > 0));
      add(`GG · GG ${f} -> gioco GG`, h > 0 && a > 0, m.odd_gg, e);
      add(`GG · GG ${f} -> gioco NG`, !(h > 0 && a > 0), m.odd_ng, 1 - e);
    }
    if (m.odd_1 && m.odd_x && m.odd_2) {
      const t = 1 / m.odd_1 + 1 / m.odd_x + 1 / m.odd_2;
      const e1 = 1 / m.odd_1 / t, ex = 1 / m.odd_x / t, e2 = 1 / m.odd_2 / t;
      // "1 in ritardo": la casa ha vinto poco nelle sue ultime 5; "2": idem l'ospite.
      const f1 = fasciaSquadra(conta(pc, (p) => p.fatti > p.subiti));
      const f2 = fasciaSquadra(conta(po, (p) => p.fatti > p.subiti));
      add(`1 · vittorie casa ${f1} -> gioco 1`, h > a, m.odd_1, e1);
      add(`1 · vittorie casa ${f1} -> gioco X2`, h <= a, m.odd_x2, ex + e2);
      add(`2 · vittorie ospite ${f2} -> gioco 2`, a > h, m.odd_2, e2);
      add(`2 · vittorie ospite ${f2} -> gioco 1X`, a <= h, m.odd_1x, e1 + ex);
    }
  }

  console.log(`Ritardi nelle ultime 5 partite · partite finite dal ${da}\n`);
  for (const [k, v] of Object.entries(acc).sort()) {
    const pct = (x: number) => `${((100 * x) / v.n).toFixed(1)}%`;
    console.log(`${k.padEnd(52)} n ${String(v.n).padStart(4)} · esce ${pct(v.esce).padStart(6)} · il book diceva ${pct(v.equo).padStart(6)} · resa ${pct(v.resa).padStart(7)}`);
  }
  console.log("\nResa positiva su poche partite puo' essere fortuna: fidarsi solo se regge su piu' settimane.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
