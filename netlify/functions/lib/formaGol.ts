/**
 * FORMA GOL DELLE DUE SQUADRE (07/10/2026, richiesta di Rossi).
 *
 * "Quando apro una partita voglio capire quanti gol aspettarmi dalla casa e
 * dall'ospite, se segnano, se prendono gol." Le quote dicono quanti gol si
 * aspetta il mercato; qui si legge come stanno andando DAVVERO le squadre:
 * ultime 5 partite in totale, e ultime 5 in casa (per chi gioca in casa) o
 * fuori (per chi gioca fuori), con gol fatti e subiti.
 *
 * Fonte: FotMob, elenco delle partite di ogni squadra nella stagione in corso
 * (coppe e nazionali comprese). Contano solo le partite finite nei 90 minuti
 * ("FT"): supplementari e rigori gonfiano i gol (Francia 4-6 Inghilterra).
 *
 * Misurato sullo storico il 06/10 (450 partite): la forma da sola indovina
 * MENO delle quote (Over/Under 2.5: 55% contro 58%). Quindi qui e' un'informazione
 * e un campanello quando non e' d'accordo con le quote, NON chi decide.
 */
import { fotmob } from "./resultSources";
import { trovaPartita } from "./fotmobDossier";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

import type { PartitaForma, FinestraForma as Finestra, FormaSquadra, FormaGol } from "../../../frontend/src/api";
export type { FormaGol };

async function getJson(url: string, timeoutMs = 20000): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`FotMob HTTP ${res.status}`);
  return res.json();
}

const cache = new Map<string, { quando: number; dati: FormaGol | null }>();

const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

function finestra(partite: PartitaForma[]): Finestra {
  return { n: partite.length, fatti: media(partite.map((p) => p.fatti)), subiti: media(partite.map((p) => p.subiti)), partite };
}

/** Le partite di una squadra (stagione in corso FotMob), in memoria 6 ore. */
const squadre = new Map<number, { quando: number; fx: any[] }>();
async function fixtures(id: number): Promise<any[]> {
  const c = squadre.get(id);
  if (c && Date.now() - c.quando < 6 * 3600_000) return c.fx;
  const t = await getJson(`https://www.fotmob.com/api/data/teams?id=${id}&ccode3=ITA`);
  const fx = t?.fixtures?.allFixtures?.fixtures || [];
  squadre.set(id, { quando: Date.now(), fx });
  return fx;
}

export type PartitaConAvversario = PartitaForma & { id_avversario: number };

/** Partite finite nei 90 minuti prima di `primaMs`, dalla piu' vecchia. */
export async function partiteFinite(id: number, primaMs: number): Promise<PartitaConAvversario[]> {
  const tutte: PartitaConAvversario[] = [];
  for (const f of await fixtures(id)) {
    const st = f?.status || {};
    const quando = Date.parse(st.utcTime);
    if (!st.finished || st.cancelled || st.awarded || st.reason?.short !== "FT") continue;
    if (!(quando < primaMs - 3600_000)) continue;
    const casa = f.home?.id === id;
    const fatti = casa ? f.home?.score : f.away?.score;
    const subiti = casa ? f.away?.score : f.home?.score;
    if (typeof fatti !== "number" || typeof subiti !== "number") continue;
    tutte.push({
      data: String(st.utcTime).slice(0, 10), avversario: casa ? f.away?.name : f.home?.name,
      id_avversario: Number(casa ? f.away?.id : f.home?.id),
      in_casa: casa, fatti, subiti, torneo: f.tournament?.name || "",
    });
  }
  return tutte.sort((a, b) => a.data.localeCompare(b.data));
}

async function formaSquadra(id: number, nome: string, primaMs: number, inCasa: boolean): Promise<FormaSquadra> {
  const tutte: PartitaForma[] = (await partiteFinite(id, primaMs)).map(({ id_avversario, ...p }) => p);
  return {
    nome,
    totale: finestra(tutte.slice(-5)),
    sede: finestra(tutte.filter((p) => p.in_casa === inCasa).slice(-5)),
  };
}

/**
 * La forma gol di una partita. `fotmobId` se gia' noto (dal dossier),
 * altrimenti la partita si cerca nell'elenco FotMob del giorno. null se
 * FotMob non la trova o non risponde: non deve mai bloccare niente.
 */
export async function formaGol(
  p: { giorno: string; casa: string; ospite: string; inizioMs: number | null },
  fotmobId?: string | null,
): Promise<FormaGol | null> {
  const chiave = `${p.giorno}|${p.casa}|${p.ospite}`;
  const c = cache.get(chiave);
  if (c && Date.now() - c.quando < 6 * 3600_000) return c.dati;
  let dati: FormaGol | null = null;
  try {
    let id = fotmobId || null;
    if (!id) id = trovaPartita(await fotmob(p.giorno), p.casa, p.ospite, p.inizioMs)?.id ?? null;
    if (id) {
      const d = await getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${id}`);
      const [tc, to] = d?.header?.teams || [];
      const inizio = Date.parse(d?.general?.matchTimeUTCDate) || p.inizioMs || Date.now();
      if (tc?.id && to?.id) {
        const [casa, ospite] = await Promise.all([
          formaSquadra(Number(tc.id), tc.name, inizio, true),
          formaSquadra(Number(to.id), to.name, inizio, false),
        ]);
        dati = { fotmob_id: String(id), casa, ospite, id_casa: Number(tc.id), id_ospite: Number(to.id), inizio_ms: inizio } as FormaGol;
      }
    }
  } catch (e) {
    console.error("[formaGol]", e);
  }
  cache.set(chiave, { quando: Date.now(), dati });
  return dati;
}

/** Il blocco per il prompt dell'AI: numeri gia' A PARTITA, senza ambiguita'. */
export function testoFormaGol(f: FormaGol | null): string {
  if (!f) return "";
  const n = (x: number | null) => (x == null ? "n/d" : x.toFixed(1).replace(".", ","));
  const riga = (s: FormaSquadra, sede: string) => {
    const ris = s.totale.partite.map((p) => `${p.in_casa ? "" : "@"}${p.avversario} ${p.fatti}-${p.subiti}`).join(", ");
    return `  - ${s.nome}: ultime ${s.totale.n} in totale fa ${n(s.totale.fatti)} e prende ${n(s.totale.subiti)} gol a partita; ` +
      `ultime ${s.sede.n} ${sede} fa ${n(s.sede.fatti)} e prende ${n(s.sede.subiti)} (${ris || "nessuna partita"})`;
  };
  return `\n📊 FORMA GOL (FotMob, solo 90 minuti, numeri A PARTITA):\n${riga(f.casa, "in casa")}\n${riga(f.ospite, "fuori casa")}\n` +
    `Sono gia' nel prezzo delle quote: usali come conferma, non per ribaltare i numeri del motore.\n`;
}
