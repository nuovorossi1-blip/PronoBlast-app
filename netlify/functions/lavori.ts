import { generaLetturaAI, consigliatoDi } from "./lib/letturaPartita";
import { pgGet, pgPatch, pgPost, jsonResponse } from "./lib/supabaseRest";
import {
  accumulaBacktest, sommaBacktestVuota,
  type Lavoro, type TipoLavoro, type BacktestResponse, type RebuildResponse,
  type ResultsImportResponse, type SommaBacktest, inizioPartitaMs,
} from "../../frontend/src/api";
import ricalcolo from "./ricalcolo";
import rebuildLearning from "./rebuild-learning";
import backtest from "./backtest";
import resultsImport from "./results-import";
import syncResults from "./sync-results";
import aiPredict from "./ai-predict";
import { verdettoDiPartita } from "./lib/verdettoServer";
import { readMinOdd } from "./odd-settings";

/**
 * LAVORI IN BACKGROUND (01/10/2026) — /lavori
 *
 * PERCHE'. Fino a oggi i lavori lunghi (ricalcolo storico, ricostruzione
 * dell'apprendimento, pagella di Traccia, caricamento del foglio risultati)
 * erano un ciclo DENTRO L'APP che chiamava il server blocco per blocco: a
 * schermo spento, in un'altra app o su un'altra pagina il ciclo si fermava e
 * il lavoro restava a meta'. Rossi: "una volta lanciato deve continuare fino
 * al completamento, qualunque cosa faccia col telefono".
 *
 * COME. Il lavoro vive in `settings.lavoro_corrente` (uno alla volta). Ogni
 * chiamata di `POST /lavori?passo=1` prende il LUCCHETTO, lavora blocco dopo
 * blocco per ~4 minuti (Vercel taglia a 5), salva dopo OGNI blocco, rilascia.
 * A chiamarla sono:
 *  - l'OROLOGIO in Supabase (pg_cron + pg_net, ogni minuto: docs/database.sql).
 *    E' lui che garantisce che il lavoro arrivi in fondo senza il telefono.
 *    Il cron di Vercel non basta: sul piano Hobby gira una volta al giorno;
 *  - l'app, subito dopo l'avvio e quando vede il lavoro "fermo" (spinta).
 *
 * LUCCHETTO = confronta-e-scambia su PostgREST: la PATCH passa solo se il
 * lucchetto e' ancora quello letto (`value->>lucchetto=eq.<vecchio>`), quindi
 * due passi insieme non lavorano mai sullo stesso lavoro. Ogni salvataggio
 * richiede il PROPRIO lucchetto: l'annullamento lo toglie, e il passo in
 * corso se ne accorge al blocco successivo e si ferma.
 *
 * Ogni tipo RIUSA il gestore che esiste gia', chiamato dall'interno con una
 * Request costruita: nessuna logica duplicata.
 *
 * REGOLA: un nuovo lavoro lungo diventa un tipo qui, non un ciclo nell'app.
 */

const CHIAVE = "lavoro_corrente";
/** Tempo utile di un passo: un blocco nuovo parte solo se, stimato sulla
 *  durata del blocco precedente (con margine), finisce entro questo tempo.
 *  Vercel taglia a 300 s. */
const TEMPO_LAVORO_MS = 240_000;
/** Durata del lucchetto: oltre il limite di Vercel (300 s), cosi' scade solo
 *  se il passo e' morto davvero. */
const DURATA_LUCCHETTO_MS = 320_000;
/** Senza aggiornamenti da tanto, e senza lucchetto: l'app da' una spinta. */
const FERMO_DOPO_MS = 75_000;
/** Errori di fila prima di dichiarare il lavoro fallito (i singoli errori di
 *  rete si riprovano al passo successivo). */
const MAX_ERRORI_DI_FILA = 5;
const BLOCCO_IMPORT = 300;

const TIPI: TipoLavoro[] = ["ricalcolo", "ricostruzione", "pagella", "import_risultati", "sync_risultati", "ai_schedina"];

type LavoroInterno = Lavoro & {
  lucchetto: string | null;
  lucchetto_fino: string | null;
  errori_di_fila: number;
  /** false finche' il primo blocco (quello che azzera) non e' andato. */
  partito: boolean;
};

async function leggi(): Promise<LavoroInterno | null> {
  const r = await pgGet(`settings?key=eq.${CHIAVE}&select=value`);
  return (Array.isArray(r) && r[0]?.value) || null;
}

/** PATCH condizionata: passa solo se il lucchetto e' ancora `atteso`. */
async function scriviSe(atteso: string | null, l: LavoroInterno): Promise<boolean> {
  const filtro = atteso ? `value->>lucchetto=eq.${atteso}` : "value->>lucchetto=is.null";
  const r = await pgPatch(`settings?key=eq.${CHIAVE}&${filtro}`, { value: l });
  return Array.isArray(r) && r.length > 0;
}

/** Quello che vede lo schermo: niente righe del foglio, niente lucchetto. */
function perSchermo(l: LavoroInterno | null): Lavoro | null {
  if (!l) return null;
  const { lucchetto, lucchetto_fino, errori_di_fila: _e, partito: _p, parametri, ...resto } = l;
  const { items: _items, ...par } = parametri || {};
  const ora = Date.now();
  const libero = !lucchetto || !lucchetto_fino || Date.parse(lucchetto_fino) < ora;
  return {
    ...resto,
    parametri: par,
    fermo: l.stato === "in_corso" && libero && ora - Date.parse(l.aggiornato) > FERMO_DOPO_MS,
  };
}

/** Chiama un gestore esistente come se arrivasse da fuori. */
async function chiama(
  h: (req: Request) => Promise<Response>, percorso: string, metodo = "POST", corpo?: unknown,
): Promise<any> {
  const res = await h(new Request(`https://interno${percorso}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }));
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `${percorso}: ${res.status}`);
  return j;
}

/** Un blocco di lavoro. Aggiorna `l` e dice se il lavoro e' finito. */
async function blocco(l: LavoroInterno): Promise<boolean> {
  const p = l.parametri || {};
  switch (l.tipo) {
    case "ricalcolo": {
      // La posizione vera la tiene il ricalcolo stesso (walk-forward): si
      // riparte sempre da li', cosi' un passo morto a meta' non disallinea.
      let da = 0;
      if (l.partito) {
        const s = await chiama(ricalcolo, "/ricalcolo", "GET");
        da = s?.stato?.pos ?? 0;
      }
      const r = await chiama(ricalcolo, `/ricalcolo?from=${da}${l.partito ? "" : "&reset=1"}`);
      l.partito = true;
      l.totale = r.totale_concluse;
      l.pos = r.prossimo ?? r.totale_concluse;
      l.parziale.scritte = (l.parziale.scritte || 0) + (r.scritte || 0);
      l.parziale.saltate = (l.parziale.saltate || 0) + (r.saltate || 0);
      return !!r.finito || r.prossimo === null;
    }
    case "ricostruzione": {
      // NB: se un passo muore a meta' blocco, quel blocco viene rigiocato e
      // conta due volte. Il tempo di lavoro, stimato sul blocco
      // precedente, serve a evitarlo.
      const r: RebuildResponse = await chiama(
        rebuildLearning, `/rebuild-learning?from=${l.pos}${l.partito ? "" : "&reset=1"}`,
      );
      l.partito = true;
      l.totale = r.totale_concluse;
      l.pos = r.prossimo ?? r.totale_concluse;
      l.parziale.scenari = (l.parziale.scenari || 0) + r.scenari_aggiornati;
      l.parziale.famiglie = (l.parziale.famiglie || 0) + r.famiglie_aggiornate;
      return !!r.finito || r.prossimo === null;
    }
    case "pagella": {
      const q = `/backtest?from=${l.pos}&limit=400&minOdd=${p.minOdd ?? 1.4}&regola=${p.regola || "motore"}`
        + `${p.lambdaVecchi ? "&lambda=vecchi" : ""}${p.split ? `&split=${p.split}` : ""}`;
      const r: BacktestResponse = await chiama(backtest, q, "GET");
      l.partito = true;
      l.totale = r.totale_concluse;
      l.pos = l.pos + r.elaborate;
      l.parziale = accumulaBacktest((l.parziale as SommaBacktest)?.per_famiglia ? l.parziale as SommaBacktest : sommaBacktestVuota(), r);
      return !!r.finito || r.prossimo === null;
    }
    case "import_risultati": {
      const items: { id: string; result: string }[] = p.items || [];
      l.totale = items.length;
      const fetta = items.slice(l.pos, l.pos + BLOCCO_IMPORT);
      if (fetta.length) {
        const r: ResultsImportResponse = await chiama(resultsImport, "/results-import", "POST", { items: fetta, overwrite: !!p.overwrite });
        for (const k of ["applicate", "sovrascritte", "gia_presenti", "saltate_perche_diverse", "illeggibili", "non_trovate"] as const) {
          l.parziale[k] = (l.parziale[k] || 0) + (r[k] || 0);
        }
      }
      l.partito = true;
      l.pos += fetta.length;
      return l.pos >= items.length;
    }
    case "ai_schedina": {
      // Pronostico AI delle partite in Schedina, una alla volta dalla prima
      // (01/10/2026): quello che Rossi faceva a mano aprendo ogni scheda.
      // Solo partite NON iniziate (dopo il calcio d'inizio il pronostico non
      // conterebbe); se c'e' gia' un pronostico AI non si rigenera. Dopo ogni
      // pronostico si ricalcola e salva il verdetto della partita.
      const ids: string[] = p.ids || [];
      l.totale = ids.length;
      const id = ids[l.pos];
      if (id) {
        const esiti: { id: string; partita: string; esito: string }[] = l.parziale.esiti || [];
        const righe = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=*`);
        const m = righe[0];
        const partita = m ? `${m.squadra1} - ${m.squadra2}` : "?";
        let esito: string;
        if (!m) esito = "partita non trovata";
        else {
          const inizio = inizioPartitaMs(m.day, m.time);
          if (m.result || (inizio !== null && inizio <= Date.now())) esito = "gia' iniziata: saltata";
          else {
            // NUOVO PRONOSTICO AI (07/10/2026, Rossi: "lo stesso della pagina
            // partita"): la lettura col modello scelto in LLM & Budget, poi il
            // consigliato (confermato o cambiato da una notizia verificata).
            try {
              const pro = await generaLetturaAI(id, undefined, { pro: true });
              if (!pro) esito = "errore: il modello non ha dato una lettura valida";
              else {
                const c = await consigliatoDi(id);
                esito = c?.market
                  ? `consigliato ${c.nome ?? c.market}${c.ai === "cambiato" ? " (cambiato dal Pronostico AI)" : c.ai === "confermato" ? " (confermato)" : ""}`
                  : c?.daLasciare ? `da lasciare: ${c.daLasciare}` : "nessuna giocata sicura";
              }
            } catch (e: any) {
              // Un errore su una partita non ferma le altre.
              esito = `errore: ${String(e?.message || e).slice(0, 120)}`;
            }
          }
        }
        esiti.push({ id, partita, esito });
        l.parziale.esiti = esiti;
      }
      l.partito = true;
      l.pos += 1;
      return l.pos >= ids.length;
    }
    case "sync_risultati": {
      const r = await chiama(syncResults, `/sync-results?days=${p.days ?? 3}`, "GET");
      l.partito = true;
      l.totale = 1;
      l.pos = 1;
      l.parziale = r;
      return true;
    }
  }
}

/** Un passo: prende il lucchetto, lavora ~4 minuti, rilascia. */
async function passo(): Promise<{ esito: string; lavoro?: Lavoro | null }> {
  const inizio = Date.now();
  let l = await leggi();
  if (!l || l.stato !== "in_corso") return { esito: "niente" };
  if (l.lucchetto && l.lucchetto_fino && Date.parse(l.lucchetto_fino) > inizio) return { esito: "occupato" };

  const vecchio = l.lucchetto;
  const mio = `${inizio.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  l = { ...l, lucchetto: mio, lucchetto_fino: new Date(inizio + DURATA_LUCCHETTO_MS).toISOString() };
  if (!(await scriviSe(vecchio, l))) return { esito: "occupato" };

  let ultimoBlocco = 0;
  while (Date.now() - inizio + ultimoBlocco * 1.5 < TEMPO_LAVORO_MS) {
    let finito = false;
    const t0 = Date.now();
    try {
      finito = await blocco(l);
      ultimoBlocco = Date.now() - t0;
      l.errori_di_fila = 0;
    } catch (e: any) {
      l.errori_di_fila = (l.errori_di_fila || 0) + 1;
      l.errore = e?.message || String(e);
      if (l.errori_di_fila >= MAX_ERRORI_DI_FILA) {
        l.stato = "errore";
        l.finito_il = new Date().toISOString();
      }
      l.aggiornato = new Date().toISOString();
      l.lucchetto = null; l.lucchetto_fino = null;
      await scriviSe(mio, l);
      return { esito: "errore", lavoro: perSchermo(l) };
    }
    l.aggiornato = new Date().toISOString();
    l.errore = null;
    if (finito) {
      l.stato = "completato";
      l.finito_il = l.aggiornato;
      l.lucchetto = null; l.lucchetto_fino = null;
      await scriviSe(mio, l);
      return { esito: "completato", lavoro: perSchermo(l) };
    }
    // Salvataggio dopo OGNI blocco. Se non passa, il lavoro e' stato annullato
    // (o sostituito): ci si ferma senza toccare niente.
    if (!(await scriviSe(mio, l))) return { esito: "annullato" };
  }
  l.lucchetto = null; l.lucchetto_fino = null;
  await scriviSe(mio, l);
  return { esito: "continua", lavoro: perSchermo(l) };
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") return jsonResponse({ ok: true, lavoro: perSchermo(await leggi()) });
    if (req.method !== "POST") return jsonResponse({ error: "Usa GET o POST" }, 405);

    if (url.searchParams.get("passo") === "1") return jsonResponse({ ok: true, ...(await passo()) });

    if (url.searchParams.get("annulla") === "1") {
      const l = await leggi();
      if (!l || l.stato !== "in_corso") return jsonResponse({ ok: true });
      // Senza condizione sul lucchetto: l'annullamento vince sempre. Togliendo
      // il lucchetto, il passo in corso non riesce piu' a salvare e si ferma.
      await pgPatch(`settings?key=eq.${CHIAVE}`, {
        value: { ...l, stato: "annullato", lucchetto: null, lucchetto_fino: null, finito_il: new Date().toISOString() },
      });
      return jsonResponse({ ok: true });
    }

    let body: { tipo?: TipoLavoro; parametri?: Record<string, any> };
    try { body = await req.json(); } catch { return jsonResponse({ error: "Body JSON non valido" }, 400); }
    const tipo = body.tipo as TipoLavoro;
    if (!TIPI.includes(tipo)) return jsonResponse({ error: `Tipo di lavoro sconosciuto: ${tipo}` }, 400);

    const attuale = await leggi();
    if (attuale?.stato === "in_corso") {
      return jsonResponse({ error: "C'e' gia' un lavoro in corso: aspetta che finisca o fermalo.", lavoro: perSchermo(attuale) }, 409);
    }
    const ora = new Date().toISOString();
    const nuovo: LavoroInterno = {
      id: `${Date.now().toString(36)}`,
      tipo,
      parametri: body.parametri || {},
      stato: "in_corso",
      pos: 0,
      totale: tipo === "import_risultati" ? (body.parametri?.items?.length || 0) : 0,
      parziale: {},
      errore: null,
      avviato: ora,
      aggiornato: ora,
      finito_il: null,
      lucchetto: null,
      lucchetto_fino: null,
      errori_di_fila: 0,
      partito: false,
    };
    await pgPost("settings", { key: CHIAVE, value: nuovo }, "resolution=merge-duplicates,return=minimal");
    return jsonResponse({ ok: true, lavoro: perSchermo(nuovo) });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
