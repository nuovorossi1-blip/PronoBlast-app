/**
 * TABELLA SCENARI (07/10/2026, Rossi): per ogni scenario del manuale e ogni
 * fascia di quota, i mercati che la prendono piu' spesso IN MODO STABILE.
 *
 * Perche' "stabile": guardando 30-40 mercati e prendendo il migliore si
 * premia anche il caso. Misurato sull'archivio (9.325 partite, divise al
 * 01/09/2026): il "migliore" delle partite vecchie vinceva il 64,6% nelle
 * vecchie e il 58,4% nelle recenti. Quindi l'archivio si divide in due meta'
 * (vecchie e recenti, per data) e un mercato vale per il suo PEGGIORE dei due
 * risultati, con almeno 50 partite per meta'. Es. Equilibrio, fascia 1,60:
 * X oppure GG 63% / 65%.
 *
 * Uso: "Punta su questo" nella fascia scelta da Rossi; l'AI la riceve nella
 * lettura. Si salva in `settings.tabella_scenari` e si ricalcola in
 * sottofondo dopo 7 giorni (il calcolo costa minuti: classifyFamily su tutto
 * l'archivio, a pezzetti per non bloccare il server).
 */
import { pgGet, pgGetAll, pgPost, rowToOdds } from "./supabaseRest";
import { classifyFamily, quoteCatalogo } from "./clusterEngine";
import { getScenarioNote, chiaveScenario, esitoMercato, quotaManuale, fasciaDellaQuota } from "../../../frontend/src/api";

export type VoceTabella = {
  market: string; manuale: boolean;
  pA: number; nA: number; pB: number; nB: number;
  /** il peggiore dei due: e' il numero su cui si sceglie */
  p: number;
};
export type TabellaScenari = {
  aggiornata: string;
  divisione: string;          // data che separa le due meta'
  partite: number;
  /** scenario ("Gap Tecnico 1", "Equilibrio"...) -> fascia ("1.40"...) -> migliori 3 */
  scenari: Record<string, Record<string, VoceTabella[]>>;
};

const CHIAVE_DB = "tabella_scenari_v2";   // v2: 8 mercati per fascia invece di 3
const VALIDA_MS = 7 * 24 * 3600_000;
const MIN_PER_META = 50;

export async function calcolaTabellaScenari(): Promise<TabellaScenari> {
  const righe = await pgGetAll(
    "matches?result=not.is.null&select=id,day,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
    "day.asc,id.asc",
  );
  const meta = Math.floor(righe.length / 2);
  type Conta = { A: { n: number; v: number }; B: { n: number; v: number }; manuale: boolean };
  const conta: Record<string, Record<string, Record<string, Conta>>> = {};
  let i = 0;
  for (const r of righe) {
    if (i % 10 === 0) await new Promise((ok) => setImmediate(ok));   // non bloccare il server
    const meta_ = i++ < meta ? "A" : "B";
    const odds: any = rowToOdds(r);
    const nota = getScenarioNote(odds, classifyFamily(odds) as any);
    if (!nota) continue;
    const sc = chiaveScenario(nota);
    const cat = quoteCatalogo(odds);
    const mercati: [string, number, boolean][] = Object.entries(cat).map(([m, q]) => [m, q.odd, false]);
    for (const man of nota.markets) {
      const q = quotaManuale(man, odds, cat);
      if (q && !cat[man]) mercati.push([man, q.odd, true]);
    }
    for (const [m, q, manuale] of mercati) {
      const f = fasciaDellaQuota(q);
      if (f === null) continue;
      const e = esitoMercato(m, String(r.result));
      if (e !== "vinta" && e !== "persa") continue;
      const fk = f.toFixed(2);
      const c = ((conta[sc] ||= {})[fk] ||= {})[m] ||= { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, manuale };
      c[meta_].n++;
      if (e === "vinta") c[meta_].v++;
    }
  }
  const scenari: TabellaScenari["scenari"] = {};
  for (const [sc, fasce] of Object.entries(conta)) {
    for (const [fk, mercati] of Object.entries(fasce)) {
      const voci: VoceTabella[] = Object.entries(mercati)
        .filter(([, c]) => c.A.n >= MIN_PER_META && c.B.n >= MIN_PER_META)
        .map(([market, c]) => {
          const pA = c.A.v / c.A.n, pB = c.B.v / c.B.n;
          return { market, manuale: c.manuale, pA, nA: c.A.n, pB, nB: c.B.n, p: Math.min(pA, pB) };
        })
        .sort((a, b) => b.p - a.p)
        .slice(0, 8);   // anche le alternative (MG 2-4 Spagna, 07/10/2026)
      if (voci.length) (scenari[sc] ||= {})[fk] = voci;
    }
  }
  return { aggiornata: new Date().toISOString(), divisione: String(righe[meta]?.day || ""), partite: righe.length, scenari };
}

let ultima: TabellaScenari | null = null;
let inCorso: Promise<TabellaScenari> | null = null;

function ricalcola(): Promise<TabellaScenari> {
  if (!inCorso) {
    inCorso = calcolaTabellaScenari()
      .then(async (t) => {
        ultima = t;
        try {
          await pgPost("settings", { key: CHIAVE_DB, value: t, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");
        } catch (e) {
          console.error("[tabellaScenari] salvataggio", e);
        }
        return t;
      })
      .finally(() => { inCorso = null; });
  }
  return inCorso;
}

/** L'ultima tabella (memoria o database); oltre i 7 giorni si ricalcola in sottofondo. */
export async function tabellaScenari(): Promise<TabellaScenari> {
  if (!ultima) {
    try {
      const v = (await pgGet(`settings?key=eq.${CHIAVE_DB}&select=value`))[0]?.value;
      if (v?.scenari && !ultima) ultima = v;
    } catch (e) {
      console.error("[tabellaScenari] lettura", e);
    }
  }
  if (!ultima) return ricalcola();
  if (Date.now() - Date.parse(ultima.aggiornata) > VALIDA_MS) ricalcola().catch((e) => console.error("[tabellaScenari]", e));
  return ultima;
}
