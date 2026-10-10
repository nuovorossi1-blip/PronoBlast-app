import fs from "node:fs";
import path from "node:path";
import { pgGetAll } from "./supabaseRest";
import { verdettoDiPartita } from "./verdettoServer";
import { readMinOdd } from "../odd-settings";

/**
 * VERDETTI DI UNA GIORNATA, CALCOLATI IN ANTICIPO (10/10/2026).
 *
 * Prima li faceva calcolare l'apertura della home (/verdetto?day=): dopo ogni
 * riavvio del server la prima apertura aspettava 150-185 s di calcoli (le
 * partite "senza pick" si ricordavano solo in memoria). Rossi: "non si
 * possono gia' calcolare e salvare nel db cosi' quando apro l'app e' gia'
 * calcolato?". Il calcolo e' IDENTICO (verdettoDiPartita), cambia solo il
 * quando: all'avvio del server, ogni 30 minuti, dopo quote ed Excel.
 */
const SENZA_PICK_VALIDO_MS = 6 * 3600_000;
const senzaPickRecenti = new Map<string, { quando: number; firma: string }>();

// Le partite senza pick giocabile non salvano niente: si ricordano su file
// per non ricalcolarle a ogni riavvio, finche' quote e soglia non cambiano.
const CACHE_FILE = path.resolve(process.cwd(), ".cache-senza-pick.json");
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    const ora = Date.now();
    for (const [id, val] of Object.entries(raw)) {
      if (val && typeof val === "object" && ora - (val as any).quando < SENZA_PICK_VALIDO_MS) {
        senzaPickRecenti.set(id, val as any);
      }
    }
  }
} catch { /* senza file si ricalcola */ }

function salvaSenzaPickRecenti() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(senzaPickRecenti.entries())), "utf8");
  } catch { /* su un disco in sola lettura (Vercel) resta la memoria */ }
}

/** Quote + soglia: se cambiano (aggiornamento quote, soglia diversa) si ricalcola. */
function firma(m: any, minOdd: number): string {
  return [minOdd, m.odd_1, m.odd_x, m.odd_2, m.odd_1x, m.odd_x2, m.odd_12, m.odd_o15, m.odd_u15,
    m.odd_o25, m.odd_u25, m.odd_o35, m.odd_u35, m.odd_gg, m.odd_ng, m.updated_at].join("|");
}

export type EsitoGiornata = {
  giorno: string; minOdd: number; partite_del_giorno: number; gia_con_verdetto: number;
  calcolati: number; salvati: number; senza_pick: number; errori: string[]; ms: number;
};

/** Calcola (e salva, se non dry) i verdetti mancanti di una giornata. */
export async function calcolaVerdettiGiornata(day: string, dry = false): Promise<EsitoGiornata> {
  const minOdd = await readMinOdd().catch(() => 1.4);
  const inizio = Date.now();
  // Solo le partite senza risultato e senza pick salvato.
  const righe = await pgGetAll(`matches?day=eq.${day}&result=is.null&select=*`, "time.asc");
  const daFare = righe.filter((r: any) => {
    if (r.pick_finale) return false;
    const v = senzaPickRecenti.get(r.id);
    return !(v && v.firma === firma(r, minOdd) && inizio - v.quando < SENZA_PICK_VALIDO_MS);
  });
  let calcolati = 0, salvati = 0, senzaPick = 0;
  const errori: string[] = [];
  for (const m of daFare) {
    try {
      const e = await verdettoDiPartita(m, minOdd, !dry);
      calcolati++;
      if (e.salvato) salvati++;
      if (!e.pick) { senzaPick++; senzaPickRecenti.set(m.id, { quando: inizio, firma: firma(m, minOdd) }); }
    } catch (err: any) {
      if (errori.length < 5) errori.push(`${m.id}: ${String(err?.message).slice(0, 80)}`);
    }
  }
  if (senzaPick > 0) salvaSenzaPickRecenti();
  return {
    giorno: day, minOdd, partite_del_giorno: righe.length, gia_con_verdetto: righe.length - daFare.length,
    calcolati, salvati, senza_pick: senzaPick, errori, ms: Date.now() - inizio,
  };
}

/** Oggi e i giorni seguenti, ora di Roma ("2026-10-10"). */
export function prossimiGiorni(quanti = 3): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  return Array.from({ length: quanti }, (_, i) => fmt.format(new Date(Date.now() + i * 86400_000)));
}

let giroInCorso: Promise<void> | null = null;
let altroGiroRichiesto = false;

/**
 * Calcola in sottofondo i verdetti dei prossimi giorni, un giorno alla volta.
 * Un solo giro per volta: se ne viene chiesto un altro mentre lavora (es.
 * quote nuove), si rifa' una volta alla fine, senza accumularne.
 */
export function precalcolaVerdetti(motivo: string, giorni = prossimiGiorni()): Promise<void> {
  if (giroInCorso) { altroGiroRichiesto = true; return giroInCorso; }
  giroInCorso = (async () => {
    try {
      for (const g of giorni) {
        const e = await calcolaVerdettiGiornata(g);
        if (e.calcolati || e.errori.length) {
          console.log(`[verdetti] ${motivo} ${g}: calcolati ${e.calcolati}, salvati ${e.salvati}, senza pick ${e.senza_pick}, errori ${e.errori.length}, ${e.ms} ms`);
        }
      }
    } catch (e) {
      console.error("[verdetti] giro", motivo, e);
    } finally {
      giroInCorso = null;
      if (altroGiroRichiesto) { altroGiroRichiesto = false; void precalcolaVerdetti(`${motivo} (ripetuto)`); }
    }
  })();
  return giroInCorso;
}

export function verdettiInCalcolo(): boolean {
  return giroInCorso !== null;
}
