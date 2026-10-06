/**
 * DATI STRUTTURATI DA FOTMOB PER IL DOSSIER DI UNA PARTITA (06/10/2026).
 *
 * Al posto di tre ricerche Tavily (6 crediti) per sapere formazioni, assenze,
 * forma e xG, qui si leggono gli stessi fatti da FotMob, gratis e gia' in
 * numeri. Tre richieste, due delle quali condivise fra tutte le partite:
 *  1. elenco partite del giorno (una volta per giorno, in memoria 30 min);
 *  2. dettagli della partita (assenti, formazioni, forma, precedenti, meteo);
 *  3. classifica del campionato con xG e xPoints (una volta per campionato,
 *     in memoria 6 ore: e' la richiesta piu' pesante, ~700 KB).
 *
 * Provato il 06/10 dal PC di casa: elenco, dettagli e classifica rispondono.
 * SofaScore invece risponde 403 a qualunque programma (anche da casa) e
 * ClubElo era giu' (502): per ora non si usano. La classifica xG di FotMob
 * copre anche le seconde divisioni, quindi fa il lavoro di Understat/ClubElo.
 *
 * Abbinamento delle squadre: stessa regola di sync-results (somiglianza media
 * >= 0.72, nessuna delle due sotto 0.45, bonus orario). Due candidati quasi
 * uguali = non si sceglie: meglio niente dati che i dati di un'altra partita.
 */
import { fotmob, type PartitaFonte } from "./resultSources";
import { simil } from "./teamMatch";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SOGLIA = 0.72;

async function getJson(url: string, timeoutMs = 20000): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`FotMob HTTP ${res.status}`);
  return res.json();
}

const giorni = new Map<string, { quando: number; elenco: PartitaFonte[] }>();
const classifiche = new Map<number, { quando: number; dati: any }>();

async function elencoDelGiorno(giorno: string): Promise<PartitaFonte[]> {
  const c = giorni.get(giorno);
  if (c && Date.now() - c.quando < 30 * 60_000) return c.elenco;
  const elenco = await fotmob(giorno);
  giorni.set(giorno, { quando: Date.now(), elenco });
  return elenco;
}

async function classifica(legaId: number): Promise<any | null> {
  const c = classifiche.get(legaId);
  if (c && Date.now() - c.quando < 6 * 3600_000) return c.dati;
  try {
    const j = await getJson(`https://www.fotmob.com/api/data/leagues?id=${legaId}`, 30000);
    // Coppe e gironi: piu' tabelle. Si tengono tutte, la squadra si cerca dentro.
    const tabelle = (Array.isArray(j?.table) ? j.table : [])
      .flatMap((t: any) => t?.data?.table ? [t.data.table] : (t?.data?.tables || []).map((x: any) => x?.table))
      .filter(Boolean);
    classifiche.set(legaId, { quando: Date.now(), dati: tabelle });
    return tabelle;
  } catch {
    classifiche.set(legaId, { quando: Date.now(), dati: null });
    return null;
  }
}

/** Trova la partita del database nell'elenco FotMob del giorno. */
export function trovaPartita(elenco: PartitaFonte[], casa: string, ospite: string, oraMs: number | null): PartitaFonte | null {
  const cand: { punt: number; m: PartitaFonte }[] = [];
  for (const m of elenco) {
    if (!m.id) continue;
    const sh = simil(casa, m.casa), sa = simil(ospite, m.ospite);
    if (Math.min(sh, sa) < 0.45) continue;
    let punt = (sh + sa) / 2;
    if (oraMs && m.ora) {
      const diff = Math.abs(m.ora - oraMs) / 3600000;
      punt += diff <= 0.5 ? 0.05 : (diff > 3 ? -0.1 : 0);
    }
    if (punt >= SOGLIA) cand.push({ punt, m });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.punt - a.punt);
  if (cand.length > 1 && cand[0].punt - cand[1].punt < 0.05 && cand[0].m.id !== cand[1].m.id) return null;
  return cand[0].m;
}

export type NumeriFotmob = {
  fotmob_id: string;
  lega: string;
  casa: RigaSquadra | null;
  ospite: RigaSquadra | null;
  assenti_casa: number;
  assenti_ospite: number;
  forma_casa: string;      // es. "PVVNV", dalla piu' vecchia alla piu' recente
  forma_ospite: string;
  precedenti: { casa: number; pari: number; ospite: number; partite: number };
  formazioni: string;      // "ufficiali" | "probabili" | "non disponibili"
};

type RigaSquadra = {
  nome: string; pos: number | null; pt: number | null; giocate: number | null; gol: string | null;
  pos_casa_o_fuori: number | null; gol_casa_o_fuori: string | null;
  xg: number | null; xg_subiti: number | null; xpt: number | null;
};

export type DatiFotmob = {
  blocchi: { etichetta: string; righe: string[] }[];
  fonti: { titolo: string; url: string }[];
  numeri: NumeriFotmob;
};

const tondo = (x: unknown) => (typeof x === "number" ? Math.round(x * 100) / 100 : null);
const FORMA: Record<string, string> = { W: "V", D: "N", L: "P" };

function rigaSquadra(tabelle: any[] | null, idSquadra: number, nome: string, inCasa: boolean): RigaSquadra | null {
  if (!tabelle?.length) return null;
  const cerca = (lista: any[] | undefined) => (lista || []).find((r: any) => Number(r?.id ?? r?.teamId) === idSquadra);
  for (const t of tabelle) {
    const all = cerca(t?.all);
    if (!all) continue;
    const parz = cerca(inCasa ? t?.home : t?.away);
    const xg = cerca(t?.xg);
    return {
      nome,
      pos: all.idx ?? null, pt: all.pts ?? null, giocate: all.played ?? null, gol: all.scoresStr ?? null,
      pos_casa_o_fuori: parz?.idx ?? null, gol_casa_o_fuori: parz?.scoresStr ?? null,
      xg: tondo(xg?.xg), xg_subiti: tondo(xg?.xgConceded), xpt: tondo(xg?.xPoints),
    };
  }
  return null;
}

function testoSquadra(r: RigaSquadra | null, inCasa: boolean): string | null {
  if (!r || r.pos == null) return null;
  let s = `${r.nome}: ${r.pos}° con ${r.pt} pt in ${r.giocate} gare (gol ${r.gol})`;
  if (r.pos_casa_o_fuori != null) s += `; ${inCasa ? "in casa" : "in trasferta"} ${r.pos_casa_o_fuori}° (gol ${r.gol_casa_o_fuori})`;
  // A PARTITA (07/10/2026): "xG 9.65 fatti" erano i TOTALI del girone (3
  // gare) e l'AI li leggeva come numeri di una partita.
  if (r.xg != null) {
    const g = r.giocate && r.giocate > 0 ? r.giocate : null;
    const ap = (x: number | null) => (g && x != null ? (x / g).toFixed(2) : "n/d");
    s += `; xG a partita ${ap(r.xg)} fatti / ${ap(r.xg_subiti)} subiti (totali in ${g ?? "?"} gare: ${r.xg} / ${r.xg_subiti})`;
  }
  return s;
}

function assenti(lista: any[] | undefined): string[] {
  return (lista || []).map((p: any) => {
    const u = p?.unavailability || {};
    const tipo = u.type === "injury" ? "infortunio" : u.type === "suspension" ? "squalifica" : (u.type || "assente");
    const rientro = u.expectedReturn && u.expectedReturn !== "Unknown" ? `, rientro ${u.expectedReturn}` : "";
    return `${p?.name} (${tipo}${rientro})`;
  });
}

/**
 * I fatti FotMob di una partita, oppure null se FotMob non la trova o non
 * risponde. Non lancia mai: e' una fonte, non un requisito.
 */
export async function datiFotmob(giorno: string, casa: string, ospite: string, oraMs: number | null): Promise<DatiFotmob | null> {
  try {
    const m = trovaPartita(await elencoDelGiorno(giorno), casa, ospite, oraMs);
    if (!m?.id) return null;
    const d = await getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${m.id}`);
    const c = d?.content || {};
    const [tc, to] = d?.header?.teams || [];
    const nomeC = tc?.name || m.casa, nomeO = to?.name || m.ospite;
    const idC = Number(tc?.id), idO = Number(to?.id);
    const legaId = Number(c?.table?.parentLeagueId ?? c?.table?.leagueId) || m.legaId;

    const blocchi: { etichetta: string; righe: string[] }[] = [];

    // Classifica e xG
    const tabelle = legaId ? await classifica(legaId) : null;
    const rc = rigaSquadra(tabelle, idC, nomeC, true), ro = rigaSquadra(tabelle, idO, nomeO, false);
    const righeTab = [testoSquadra(rc, true), testoSquadra(ro, false)].filter(Boolean) as string[];
    if (righeTab.length) blocchi.push({ etichetta: "Classifica e xG (FotMob)", righe: righeTab });

    // Assenti
    const ac = assenti(c?.lineup?.homeTeam?.unavailable), ao = assenti(c?.lineup?.awayTeam?.unavailable);
    blocchi.push({
      etichetta: "Assenti (FotMob)",
      righe: [
        `${nomeC}: ${ac.length ? ac.join("; ") : "nessun assente segnalato"}`,
        `${nomeO}: ${ao.length ? ao.join("; ") : "nessun assente segnalato"}`,
      ],
    });

    // Formazioni: ci sono solo vicino al calcio d'inizio
    const tipoForm = String(c?.lineup?.lineupType || "");
    const formazioni = tipoForm === "standard" || tipoForm === "confirmed" ? "ufficiali"
      : tipoForm === "predicted" ? "probabili" : "non disponibili";
    if (formazioni !== "non disponibili") {
      const riga = (t: any) => {
        const nomi = (t?.starters || []).map((p: any) => p?.name).filter(Boolean);
        return nomi.length ? `${t?.name}${t?.formation ? ` (${t.formation})` : ""}: ${nomi.join(", ")}` : null;
      };
      const r = [riga(c.lineup.homeTeam), riga(c.lineup.awayTeam)].filter(Boolean) as string[];
      if (r.length) blocchi.push({ etichetta: `Formazioni ${formazioni} (FotMob)`, righe: r });
    }

    // Forma: ultime 5, dalla piu' vecchia alla piu' recente
    const tf = c?.matchFacts?.teamForm || [];
    const forma = (lista: any[]) => (lista || []).map((x: any) => FORMA[x?.resultString] || "?").join("");
    const formaC = forma(tf[0]), formaO = forma(tf[1]);
    const dettaglio = (lista: any[]) => (lista || []).map((x: any) => {
      const t = x?.tooltipText || {};
      return `${FORMA[x?.resultString] || "?"} ${t.homeTeam} ${t.homeScore}-${t.awayScore} ${t.awayTeam}`;
    }).join(" | ");
    if (formaC || formaO) {
      blocchi.push({
        etichetta: "Forma recente, ultime 5 dalla piu' vecchia (FotMob)",
        righe: [`${nomeC}: ${dettaglio(tf[0])}`, `${nomeO}: ${dettaglio(tf[1])}`],
      });
    }

    // Precedenti: calcolati sulle partite finite, non sul riassunto (che non
    // dice da che parte conta). Anche le amichevoli sono escluse.
    const prec = { casa: 0, pari: 0, ospite: 0, partite: 0 };
    for (const p of c?.h2h?.matches || []) {
      if (!p?.status?.finished || /friendl/i.test(p?.league?.name || "")) continue;
      const g = String(p?.status?.scoreStr || "").match(/(\d+)\s*-\s*(\d+)/);
      if (!g) continue;
      const [gh, ga] = [Number(g[1]), Number(g[2])];
      const casaInCasa = Number(p?.home?.id) === idC;
      const gc = casaInCasa ? gh : ga, go = casaInCasa ? ga : gh;
      prec.partite++;
      if (gc > go) prec.casa++; else if (gc < go) prec.ospite++; else prec.pari++;
    }
    if (prec.partite) {
      blocchi.push({
        etichetta: "Precedenti ufficiali (FotMob)",
        righe: [`ultimi ${prec.partite}: ${nomeC} ${prec.casa} vittorie, ${prec.pari} pareggi, ${nomeO} ${prec.ospite} vittorie`],
      });
    }

    // Curiosita' statistiche e meteo
    const curiosita = (c?.matchFacts?.insights || [])
      .slice(0, 6)
      .map((x: any) => {
        const chi = Number(x?.teamId) === idC ? nomeC : Number(x?.teamId) === idO ? nomeO : "";
        return x?.text ? `${chi ? `${chi}: ` : ""}${x.text}` : null;
      })
      .filter(Boolean) as string[];
    const w = c?.weather;
    if (w?.temperature != null) curiosita.push(`Meteo previsto: ${w.temperature}°C, ${w.description || ""}, pioggia ${w.precipChance ?? "?"}%`);
    if (curiosita.length) blocchi.push({ etichetta: "Statistiche e meteo (FotMob)", righe: curiosita });

    return {
      blocchi,
      fonti: [{ titolo: `FotMob: ${nomeC} - ${nomeO}`, url: `https://www.fotmob.com/match/${m.id}` }],
      numeri: {
        fotmob_id: m.id, lega: m.lega,
        casa: rc, ospite: ro,
        assenti_casa: ac.length, assenti_ospite: ao.length,
        forma_casa: formaC, forma_ospite: formaO,
        precedenti: prec, formazioni,
      },
    };
  } catch (e) {
    console.error("[fotmobDossier]", casa, ospite, e);
    return null;
  }
}
