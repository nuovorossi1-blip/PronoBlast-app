import { pgGetAll, jsonResponse } from "./lib/supabaseRest";
import { applyMatchResult } from "./lib/applyResult";
import { simil, impostaAlias } from "./lib/teamMatch";
import { MARK } from "./lib/teamTables";
import { fotmob, espn, sofascore, apifootball, PAESI, type PartitaFonte } from "./lib/resultSources";
import { inizioPartitaMs } from "../../frontend/src/api";
import { aggiornaTabellaERicalcolaConsigliati } from "./lib/tabellaScenari";

/**
 * GET|POST /sync-results
 *
 * "Aggiorna risultati": riempie i risultati mancanti delle ultime giornate,
 * senza PC acceso, senza Python e senza passare da un file Excel.
 *
 * COME FUNZIONA (schema dello script Python di Rossi, 27/09/2026)
 *  1. prende dal database le partite senza risultato da oggi fino a N giorni
 *     indietro (3 di default: la finestra scorre da sola giorno per giorno);
 *  2. per OGNI GIORNATA scarica l'elenco completo delle partite una volta sola;
 *  3. cascata: API-Football, poi FotMob, ESPN, SofaScore. Si scende solo se la
 *     fonte precedente non trova la partita o non la da' per finita;
 *  4. abbina per nome squadra, orario e paese;
 *  5. SCRIVE SOLO QUANDO E' SICURO. Ambigua, incerta, non trovata, rinviata,
 *     supplementari o rigori: non scrive niente e passa alla successiva.
 *
 * Perche' "solo quando e' sicuro": un risultato sbagliato non resta li' fermo,
 * entra nell'apprendimento e sposta le probabilita' di tutte le partite con
 * quote simili. Una partita senza risultato invece non fa danno.
 *
 * Parametri: `days` (1-30, default 3), `dry=1` per provare senza scrivere,
 * `probe=1` per sapere solo quali fonti rispondono da questo server.
 *
 * SOLO ALCUNE PARTITE (01/10/2026, tasto RISULTATI della Schedina): `ids=a,b,c`
 * (in query o nel corpo POST `{ ids: [...] }`). Stessa ricerca, stesse regole
 * di sicurezza, ma solo su quelle partite, qualunque giorno sia; nella risposta
 * `esiti` dice per ognuna cosa e' successo: scritta, gia' presente, non
 * iniziata, non conclusa, non trovata, ambigua...
 */

const SOGLIA = 0.72;          // quanto devono somigliare i nomi, come nello script
const MAX_GIORNI = 30;

function oggiRoma(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function giorniIndietro(da: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${da}T12:00:00Z`);
  for (let i = 0; i <= n; i++) {
    out.push(new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

type Esito =
  | { tipo: "trovata"; gc: number; go: number; fonte: string; punteggio: number; verifica: boolean }
  | { tipo: "ambigua" | "incerta" | "non_trovata" | "non_finita" | "supplementari" };

/**
 * Cerca una partita del database nell'elenco di una fonte.
 * Riproduce `_trova` dello script: punteggio medio delle due squadre, tentativo
 * di inversione casa/ospite, bonus per orario vicino e paese coerente, e stop
 * quando due partite diverse sono quasi ugualmente simili.
 */
function cerca(
  elenco: PartitaFonte[],
  casaDb: string, ospiteDb: string, oraDb: number | null, campionato: string,
): Esito {
  // se solo una delle due ha il marcatore U21/Women (nome troncato da Sisal),
  // lo aggiungo anche all'altra, altrimenti il confronto fallisce sempre
  let casa = casaDb, ospite = ospiteDb;
  const mc = casaDb.toLowerCase().match(MARK), mo = ospiteDb.toLowerCase().match(MARK);
  if (mc && !mo) ospite = `${ospite} ${mc[0]}`;
  else if (mo && !mc) casa = `${casa} ${mo[0]}`;

  const paese = PAESI[String(campionato || "").slice(0, 3).toUpperCase()];
  const cand: { punt: number; invertita: boolean; m: PartitaFonte }[] = [];

  for (const m of elenco) {
    let sh = simil(casa, m.casa), sa = simil(ospite, m.ospite), invertita = false;
    if (Math.min(sh, sa) < 0.5) {
      const sh2 = simil(casa, m.ospite), sa2 = simil(ospite, m.casa);
      if (Math.min(sh2, sa2) >= 0.5 && sh2 + sa2 > sh + sa) { sh = sh2; sa = sa2; invertita = true; }
    }
    let punt = (sh + sa) / 2;
    if (oraDb && m.ora) {
      const diff = Math.abs(m.ora - oraDb) / 3600000;
      punt += diff <= 0.5 ? 0.05 : (diff > 3 ? -0.1 : 0);
    }
    if (paese && m.paese) punt += m.paese === paese ? 0.05 : -0.05;
    if (Math.min(sh, sa) >= 0.45 && punt >= SOGLIA) cand.push({ punt, invertita, m });
  }

  if (!cand.length) return { tipo: "non_trovata" };
  cand.sort((a, b) => b.punt - a.punt);

  const ris = (c: typeof cand[0]) => (c.invertita ? [c.m.go, c.m.gc] : [c.m.gc, c.m.go]);
  const primo = cand[0];
  const p0 = ris(primo);
  // due partite diverse quasi ugualmente simili: non si rischia
  const diversi = cand.filter((c) => {
    const p = ris(c);
    return (p[0] !== p0[0] || p[1] !== p0[1]) && c.m.finita && primo.m.finita
      && simil(c.m.casa, primo.m.casa) < 0.999;
  });
  if (diversi.length && primo.punt - diversi[0].punt < 0.05) return { tipo: "ambigua" };

  const finite = cand.filter((c) => c.m.finita);
  const scelto = finite[0] || primo;
  if (scelto.m.supplementari) return { tipo: "supplementari" };
  if (!scelto.m.finita) return { tipo: "non_finita" };
  const [gc, go] = ris(scelto);
  if (typeof gc !== "number" || typeof go !== "number") return { tipo: "incerta" };
  return { tipo: "trovata", gc, go, fonte: scelto.m.fonte, punteggio: scelto.punt, verifica: scelto.punt < 0.85 };
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const key = (process.env.APIFOOTBALL_KEY || "").trim();
  const oggi = oggiRoma();

  // --- modalita' sonda: quali fonti rispondono da QUESTO server? ---
  if (url.searchParams.get("probe") === "1") {
    const giorno = giorniIndietro(oggi, 1)[1];
    const prova = async (nome: string, f: () => Promise<PartitaFonte[]>) => {
      const t0 = Date.now();
      try {
        const r = await f();
        return { fonte: nome, ok: true, partite: r.length, finite: r.filter((x) => x.finita).length, ms: Date.now() - t0 };
      } catch (e: any) {
        return { fonte: nome, ok: false, errore: String(e?.message || e).slice(0, 160), ms: Date.now() - t0 };
      }
    };
    const esiti = [
      await prova("API-Football", () => key ? apifootball(giorno, key) : Promise.reject(new Error("chiave assente"))),
      await prova("FotMob", () => fotmob(giorno)),
      await prova("ESPN", () => espn(giorno)),
      await prova("SofaScore", () => sofascore(giorno)),
    ];
    return jsonResponse({ giorno_provato: giorno, chiave_apifootball: key ? "presente" : "assente", fonti: esiti });
  }

  const days = Math.max(1, Math.min(MAX_GIORNI, parseInt(url.searchParams.get("days") || "3", 10) || 3));
  const dry = url.searchParams.get("dry") === "1";

  // Partite scelte (Schedina): dalla query o dal corpo.
  let ids: string[] = (url.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!ids.length && req.method === "POST") {
    try { const b: any = await req.json(); if (Array.isArray(b?.ids)) ids = b.ids.map(String).filter(Boolean); } catch { /* corpo vuoto */ }
  }
  const soloScelte = ids.length > 0;
  type EsitoPartita = { id: string; partita: string; giorno: string; esito: string; risultato?: string; fonte?: string };
  const esiti: EsitoPartita[] = [];

  let giorni = giorniIndietro(oggi, days);
  let dal = giorni[giorni.length - 1];

  try {
    let daFare: any[];
    if (soloScelte) {
      const lista = ids.map((i) => `"${i}"`).join(",");
      const righe: any[] = await pgGetAll(`matches?id=in.(${lista})&select=id,day,time,manifestazione,squadra1,squadra2,result`, "day.asc,time.asc");
      const trovate = new Set(righe.map((r) => r.id));
      for (const id of ids) if (!trovate.has(id)) esiti.push({ id, partita: "?", giorno: "", esito: "non nel database" });
      const ora = Date.now();
      daFare = [];
      for (const r of righe) {
        const partita = `${r.squadra1} - ${r.squadra2}`;
        if (r.result) { esiti.push({ id: r.id, partita, giorno: r.day, esito: "gia' presente", risultato: r.result }); continue; }
        const inizio = inizioPartitaMs(r.day, r.time);
        if (inizio !== null && inizio > ora) { esiti.push({ id: r.id, partita, giorno: r.day, esito: "non iniziata" }); continue; }
        daFare.push(r);
      }
      giorni = [...new Set(daFare.map((r) => r.day as string))].sort().reverse();
      dal = giorni[giorni.length - 1] || oggi;
    } else {
      daFare = await pgGetAll(
        `matches?result=is.null&day=gte.${dal}&day=lte.${oggi}&select=id,day,time,manifestazione,squadra1,squadra2`,
        "day.asc,time.asc",
      );
    }

    const alias = await pgGetAll("team_alias?select=da,a", "da.asc").catch(() => []);
    impostaAlias(alias as { da: string; a: string }[]);

    const conteggi = { scritte: 0, da_verificare: 0, ambigue: 0, non_trovate: 0, non_finite: 0, supplementari: 0, incerte: 0 };
    const perFonte: Record<string, number> = {};
    const daControllare: any[] = [];
    const fontiKo: string[] = [];

    for (const giorno of giorni) {
      const righe = daFare.filter((r: any) => r.day === giorno);
      if (!righe.length) continue;

      // Le fonti si scaricano una volta per giornata. Se una fallisce si va
      // avanti con le altre: meglio una copertura parziale che zero.
      let api: PartitaFonte[] = [];
      if (key) {
        try { api = await apifootball(giorno, key); }
        catch (e: any) { if (!fontiKo.includes("API-Football")) fontiKo.push(`API-Football (${String(e?.message).slice(0, 80)})`); }
      }
      const gratuite: PartitaFonte[] = [];
      for (const [nome, f] of [["FotMob", fotmob], ["ESPN", espn], ["SofaScore", sofascore]] as const) {
        try { gratuite.push(...(await f(giorno))); }
        catch (e: any) { if (!fontiKo.includes(nome)) fontiKo.push(`${nome} (${String(e?.message).slice(0, 80)})`); }
      }

      for (const r of righe) {
        const oraDb = r.time ? Date.parse(`${r.day}T${String(r.time).slice(0, 5)}:00`) : null;
        // CASCATA: prima API-Football, e solo se non basta le gratuite
        let e = api.length ? cerca(api, r.squadra1, r.squadra2, oraDb, r.manifestazione) : { tipo: "non_trovata" as const };
        if (e.tipo !== "trovata" && e.tipo !== "ambigua" && gratuite.length) {
          e = cerca(gratuite, r.squadra1, r.squadra2, oraDb, r.manifestazione);
        }

        if (e.tipo !== "trovata") {
          if (soloScelte) {
            esiti.push({
              id: r.id, partita: `${r.squadra1} - ${r.squadra2}`, giorno,
              esito: e.tipo === "non_finita" ? "non conclusa" : e.tipo === "non_trovata" ? "non trovata"
                : e.tipo === "supplementari" ? "ai supplementari, non scritta" : e.tipo === "ambigua" ? "ambigua, non scritta" : "incerta, non scritta",
            });
          }
          conteggi[e.tipo === "ambigua" ? "ambigue" : e.tipo === "non_finita" ? "non_finite"
            : e.tipo === "supplementari" ? "supplementari" : e.tipo === "incerta" ? "incerte" : "non_trovate"]++;
          if (e.tipo === "ambigua" && daControllare.length < 50) {
            daControllare.push({ id: r.id, partita: `${r.squadra1} - ${r.squadra2}`, giorno, motivo: "ambigua" });
          }
          continue;
        }

        const risultato = `${e.gc}-${e.go}`;
        if (!dry) {
          try { await applyMatchResult(r.id, risultato, e.gc, e.go); }
          catch {
            conteggi.non_trovate++;
            if (soloScelte) esiti.push({ id: r.id, partita: `${r.squadra1} - ${r.squadra2}`, giorno, esito: "errore di scrittura" });
            continue;
          }
        }
        conteggi.scritte++;
        perFonte[e.fonte] = (perFonte[e.fonte] || 0) + 1;
        if (soloScelte) esiti.push({ id: r.id, partita: `${r.squadra1} - ${r.squadra2}`, giorno, esito: e.verifica ? "scritta (da controllare: nomi poco simili)" : "scritta", risultato, fonte: e.fonte });
        if (e.verifica) {
          conteggi.da_verificare++;
          if (daControllare.length < 50) {
            daControllare.push({
              id: r.id, partita: `${r.squadra1} - ${r.squadra2}`, giorno,
              motivo: "nomi poco simili", risultato, fonte: e.fonte, somiglianza: Math.round(e.punteggio * 100) / 100,
            });
          }
        }
      }
    }

    if (!dry && conteggi.scritte > 0) {
      if (typeof setImmediate !== "undefined") {
        setImmediate(() => {
          aggiornaTabellaERicalcolaConsigliati().catch((e) => console.error("[sync-results] ricalcolo tabella", e));
        });
      }
    }

    return jsonResponse({
      ok: true, prova: dry, dal, al: oggi, giorni: giorni.length,
      partite_esaminate: daFare.length,
      ...conteggi,
      per_fonte: perFonte,
      fonti_non_raggiungibili: fontiKo,
      da_controllare: daControllare,
      ...(soloScelte ? { esiti } : {}),
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
