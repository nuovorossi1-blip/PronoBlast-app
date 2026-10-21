import { pgGet, pgPatch } from "./supabaseRest";
import { inizioPartitaMs } from "../../../frontend/src/api";
import { chiaveMercato } from "./clusterEngine";

/**
 * QUOTE DELLA SCHEDA PARTITA SISAL (21/10/2026, Rossi: "quando clicco analisi AI prende e salva
 * le quote dal sito Sisal, cosi' non sono piu' stimate ma disponibili").
 *
 * Il PDF del palinsesto ha solo 1X2, DC, U/O 1,5-3,5 e GG/NG. Multigol, combo, Under 4,5 e
 * risultati esatti stanno nella pagina della partita su sisal.it: li legge l'agente del PC
 * (pc-quote-sisal, POST /scheda, Edge vero). Qui:
 *  - le 14 quote del PDF vengono sovrascritte con quelle della scheda (piu' recenti);
 *  - gli altri mercati si salvano in matches.quote_sisal con i NOMI DEL CATALOGO del motore
 *    (chiaveMercato), cosi' comboOdd/quoteCatalogo li usano come quote vere al posto della stima.
 * Solo per partite non ancora iniziate: una quota letta dopo il via non e' prepartita.
 */

const AGENTE = (process.env.PC_AGENTE_URL || "").replace(/\/$/, "");
const SEGRETO = process.env.PC_AGENTE_SEGRETO || "";

export type QuoteSisal = { at: string; codice: string; quote: Record<string, number>; esatti: Record<string, number>; esatti_aggio?: number | null; esatti_altro?: number | null; mercati: number };
type MercatoScheda = { cs: number; nome: string; desc: string; soglia: string; esiti: [string, number][] };

const BASE_COL: Record<string, string> = {
  "1": "odd_1", X: "odd_x", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "12": "odd_12",
  "U1.5": "odd_u15", "O1.5": "odd_o15", "U2.5": "odd_u25", "O2.5": "odd_o25", "U3.5": "odd_u35", "O3.5": "odd_o35",
  GG: "odd_gg", NG: "odd_ng",
};
// Colonna del DB -> chiave dell'array `estimated` (stimate dall'import Excel).
const EST_KEY: Record<string, string> = {
  odd_1: "odd_1", odd_x: "odd_X", odd_2: "odd_2", odd_1x: "odd_1X", odd_x2: "odd_X2", odd_12: "odd_12",
  odd_u15: "odd_U15", odd_o15: "odd_O15", odd_u25: "odd_U25", odd_o25: "odd_O25", odd_u35: "odd_U35", odd_o35: "odd_O35",
  odd_gg: "odd_GG", odd_ng: "odd_NG",
};

/** Mercati della scheda -> quote con i nomi del catalogo (MG 2-4 totali, DC 1X + O1.5, 1 + U4.5, ...). */
export function mappaScheda(mercati: MercatoScheda[]): { quote: Record<string, number>; esatti: Record<string, number>; esatti_aggio: number | null; esatti_altro: number | null } {
  const quote: Record<string, number> = {}, esatti: Record<string, number> = {};
  let esatti_aggio: number | null = null, esatti_altro: number | null = null;
  const metti = (nome: string, q: unknown) => { if (typeof q === "number" && q > 1) quote[chiaveMercato(nome)] = q; };
  const sp = (s: string) => s.replace(/\s/g, "");
  for (const m of mercati || []) {
    const E: Record<string, number> = {};
    for (const [d, q] of m.esiti) E[d.toUpperCase().replace(/\s+/g, " ").trim()] = q;
    const s = m.soglia;
    switch (m.cs) {
      case 3: case 28319: case 18:
        for (const [d, q] of Object.entries(E)) metti(d === "GOAL" ? "GG" : d === "NOGOAL" ? "NG" : d, q);
        break;
      case 7989: metti(`U${s}`, E.UNDER); metti(`O${s}`, E.OVER); break;
      case 99989: for (const dc of ["1X", "X2", "12"]) { metti(`${dc} + O${s}`, E[`${dc} + OVER`]); metti(`${dc} + U${s}`, E[`${dc} + UNDER`]); } break;
      case 12192: for (const r of ["1", "X", "2"]) { metti(`${r} + O${s}`, E[`${r} + O`]); metti(`${r} + U${s}`, E[`${r} + U`]); } break;
      case 12562: metti(`GG + O${s}`, E["GOAL + OVER"]); metti(`GG + U${s}`, E["GOAL + UNDER"]); metti(`NG + O${s}`, E["NO GOAL + OVER"]); metti(`NG + U${s}`, E["NO GOAL + UNDER"]); break;
      case 99990: case 425:
        for (const r of ["1", "X", "2", "1X", "X2", "12"]) { metti(`${r} + GG`, E[`${r} + GOAL`]); metti(`${r} + NG`, E[`${r} + NOGOAL`]); }
        break;
      case 9493: metti("X oppure GG", E["X O GOAL"]); break;
      case 30562: for (const [d, q] of m.esiti) if (/^\d-\d$/.test(sp(d))) metti(`MG ${sp(d)} totali`, q); break;
      case 30362: {
        const t = /SQUADRA 1/i.test(m.desc) ? "casa" : /SQUADRA 2/i.test(m.desc) ? "ospite" : null;
        if (t) for (const [d, q] of m.esiti) if (/^\d-\d$/.test(sp(d))) metti(`MG ${sp(d)} ${t}`, q);
        break;
      }
      case 30394:
        for (const [d, q] of m.esiti) { const k = sp(d).match(/^(\d-\d)\/(\d-\d)$/); if (k) metti(`MG ${k[1]} casa + MG ${k[2]} ospite`, q); }
        break;
      // Risultato esatto: prima il mercato a 26 esiti (con ALTRO: da qui l'aggio vero), il 75 esiti completa.
      case 21605: case 7:
        for (const [d, q] of m.esiti) { const k = sp(d); if (/^\d+-\d+$/.test(k) && q > 1 && (m.cs === 7 || !esatti[k])) esatti[k] = q; }
        if (m.cs === 7) {
          esatti_aggio = m.esiti.reduce((t, [, q]) => t + (q > 1 ? 1 / q : 0), 0);
          esatti_altro = m.esiti.find(([d]) => /ALTRO/i.test(d))?.[1] ?? null;   // tutti i risultati non elencati
        }
        break;
    }
  }
  return { quote, esatti, esatti_aggio, esatti_altro };
}

/** Chiede all'agente del PC le schede Sisal (una sola apertura di Edge per tutte). null = agente non configurato o spento. */
async function chiediSchede(partite: { id: string; day: string; squadra1: string; squadra2: string }[], fresca = false): Promise<Record<string, any> | null> {
  if (!AGENTE || !SEGRETO) return null;
  try {
    const r = await fetch(`${AGENTE}/scheda`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Segreto": SEGRETO },
      body: JSON.stringify({ partite, fresca }),
      signal: AbortSignal.timeout(60_000 + partite.length * 5_000),
    });
    const j: any = await r.json().catch(() => null);
    return r.ok && j?.ok ? j.partite : null;
  } catch {
    return null;
  }
}

/** L'agente ne legge al massimo 20 per volta. */
const LOTTO = 20;
export type EsitoSisal = { ok: boolean; errore?: string; mercati?: number; cambiate?: number; fresca?: boolean; at?: string };
/** Quote scaricate da meno di cosi' (da PronoBlast o da Jupiter) non si riscaricano col Pronostico AI (21/10/2026). */
export const VALIDA_MS = 3 * 3600_000;

/** Applica una scheda letta alla riga: sovrascrive le 14 quote del file e salva gli altri mercati. */
async function salvaScheda(m: any, s: any): Promise<EsitoSisal> {
  const { quote, esatti, esatti_aggio, esatti_altro } = mappaScheda(s.mercati);
  const patch: Record<string, unknown> = {
    quote_sisal: { at: s.at, codice: s.codice, quote, esatti, esatti_aggio, esatti_altro, mercati: s.mercati.length } satisfies QuoteSisal,
  };
  let cambiate = 0;
  let est: string[] = Array.isArray(m.estimated) ? [...m.estimated] : [];
  for (const [mk, col] of Object.entries(BASE_COL)) {
    const q = quote[chiaveMercato(mk)];
    if (!q) continue;
    if (Number(m[col]) !== q) { patch[col] = q; cambiate++; }
    est = est.filter((k) => k !== EST_KEY[col]);
  }
  if (est.length !== (m.estimated || []).length) patch.estimated = est;
  await pgPatch(`matches?id=eq.${encodeURIComponent(m.id)}`, patch);
  return { ok: true, mercati: s.mercati.length, cambiate };
}

/**
 * Legge le schede Sisal di piu' partite insieme e aggiorna le quote (21/10/2026, Rossi: "una volta scaricate
 * vengono salvate e non si ricaricano, solo se decido io con l'analisi AI").
 *  - forza = false (selezione in Schedina): solo le partite che le quote complete non le hanno ancora;
 *  - forza = true (Pronostico AI, Pronostici AI della Schedina): se l'ultima lettura (di PronoBlast o di Jupiter,
 *    cartella condivisa dell'agente) ha meno di 3 ore si usa quella, altrimenti si riscarica e si aggiorna.
 * Salta sempre le partite iniziate. Non lancia mai: un problema (PC spento, partita non trovata) lascia le
 * quote com'erano e le stime restano stime.
 */
export async function aggiornaQuoteSisalLotto(ids: string[], forza = false): Promise<Record<string, EsitoSisal>> {
  const esito: Record<string, EsitoSisal> = {};
  const unici = [...new Set(ids.filter(Boolean))];
  if (!unici.length) return esito;
  try {
    const righe: any[] = await pgGet(`matches?id=in.(${unici.map((x) => `"${encodeURIComponent(x)}"`).join(",")})&select=*`);
    const daLeggere: any[] = [];
    for (const id of unici) {
      const m = righe.find((r) => r.id === id);
      if (!m) { esito[id] = { ok: false, errore: "partita non trovata" }; continue; }
      const inizio = inizioPartitaMs(m.day, m.time);
      if (m.result || (inizio !== null && inizio <= Date.now())) { esito[id] = { ok: false, errore: "partita gia' iniziata" }; continue; }
      const at = Date.parse(m.quote_sisal?.at || "");
      if (m.quote_sisal && (!forza || (Number.isFinite(at) && Date.now() - at < VALIDA_MS))) {
        esito[id] = { ok: true, fresca: true, mercati: m.quote_sisal.mercati, cambiate: 0, at: m.quote_sisal.at }; continue;
      }
      daLeggere.push(m);
    }
    for (let k = 0; k < daLeggere.length; k += LOTTO) {
      const parte = daLeggere.slice(k, k + LOTTO);
      const schede = await chiediSchede(parte.map((m) => ({ id: m.id, day: m.day, squadra1: m.squadra1, squadra2: m.squadra2 })));
      for (const m of parte) {
        const s = schede?.[m.id];
        if (!schede) esito[m.id] = { ok: false, errore: "PC di casa non raggiungibile" };
        else if (!s?.ok) esito[m.id] = { ok: false, errore: s?.errore || "scheda Sisal non disponibile" };
        else {
          try { esito[m.id] = await salvaScheda(m, s); }
          catch (e: any) { esito[m.id] = { ok: false, errore: String(e?.message || e).slice(0, 200) }; }
        }
      }
    }
  } catch (e: any) {
    for (const id of unici) esito[id] ??= { ok: false, errore: String(e?.message || e).slice(0, 200) };
  }
  return esito;
}

/** Una partita sola, col Pronostico AI della scheda: riscarica se l'ultima lettura ha 3 ore o piu'. */
export async function aggiornaQuoteSisal(matchId: string): Promise<EsitoSisal> {
  return (await aggiornaQuoteSisalLotto([matchId], true))[matchId] ?? { ok: false, errore: "partita non trovata" };
}
