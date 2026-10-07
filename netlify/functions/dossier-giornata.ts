import { pgGet, pgGetAll, pgPatch, pgPost, jsonResponse } from "./lib/supabaseRest";
import { contestoPartitaSalvato, DOSSIER_VALIDO_ORE } from "./lib/webSearch";
import { generaLetturaAI } from "./lib/letturaPartita";
import { impostaAlias } from "./lib/teamMatch";
import { inizioPartitaMs } from "../../frontend/src/api";

/**
 * DOSSIER AUTOMATICO DI TUTTE LE PARTITE DEL GIORNO (06/10/2026, passo 4).
 *
 * Ogni partita del giorno non ancora iniziata riceve il suo dossier (FotMob +
 * notizie SearXNG, vedi webSearch.ts) PRIMA che qualcuno la apra: chi la apre
 * trova i dati gia' pronti e il pronostico AI parte subito. Tavily qui NON si
 * usa mai (solo quando una partita viene aperta e il resto non ha trovato
 * niente), quindi il lavoro costa zero crediti.
 *
 * CHI LO AVVIA. L'orologio in Supabase (pg_cron, docs/database.sql sez. 7):
 *  - alle 6 per tutte le partite del giorno;
 *  - alle 13, dopo l'aggiornamento quote automatico delle 12, per quelle
 *    caricate nel frattempo (le altre hanno gia' un dossier fresco e si saltano);
 *  - ogni minuto, SOLO mentre il lavoro e' in corso e nessun passo sta
 *    lavorando, per farlo avanzare.
 *
 *   GET  /dossier-giornata                -> stato del lavoro
 *   POST /dossier-giornata?avvia=1[&giorno=AAAA-MM-GG]
 *   POST /dossier-giornata?passo=1        -> lavora ~4 minuti e salva dove e' arrivato
 *   POST /dossier-giornata?ids=a,b,c[&nuovo=1] -> prova su partite scelte, subito, con il dettaglio
 *
 * LENTEZZA VOLUTA: una partita ogni PAUSA_MS. 500 partite in ~1 ora sono
 * traffico normale per FotMob e per i motori dietro SearXNG; 500 in un minuto
 * sembrerebbero un robot e verrebbero bloccate.
 */

const CHIAVE = "dossier_giornata";
const TEMPO_PASSO_MS = 240_000;
const DURATA_LUCCHETTO_MS = 300_000;
const PAUSA_MS = 2_000;

type Conteggi = { fotmob: number; notizie: number; nessun_dato: number; gia_pronto: number; errori: number };
type Stato = {
  giorno: string; stato: "in_corso" | "finito"; ids: string[]; pos: number; totale: number;
  conteggi: Conteggi; avviato: string; aggiornato: string; lucchetto_fino?: string | null;
};

function oggiRoma(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function leggi(): Promise<Stato | null> {
  const r = await pgGet(`settings?key=eq.${CHIAVE}&select=value`);
  return (Array.isArray(r) && r[0]?.value) || null;
}
async function scrivi(s: Stato) {
  await pgPost("settings", { key: CHIAVE, value: s }, "resolution=merge-duplicates,return=minimal");
}

const vuoti = (): Conteggi => ({ fotmob: 0, notizie: 0, nessun_dato: 0, gia_pronto: 0, errori: 0 });

/** Il dossier di una partita. Ritorna una riga di esito leggibile. */
async function dossierDi(m: any, conteggi: Conteggi, nuovo = false): Promise<string> {
  try {
    const ctx = await contestoPartitaSalvato(
      {
        id: m.id, giorno: m.day, casa: m.squadra1, ospite: m.squadra2,
        campionato: m.manifestazione || "", inizioMs: inizioPartitaMs(m.day, m.time),
      },
      "", { tavily: false, nuovo },
    );
    if (!ctx.disponibile) { conteggi.nessun_dato++; return ctx.motivo || "nessun dato"; }
    // LETTURA AI GRATIS (07/10/2026): con il dossier pronto, se manca, la fa
    // Nemotron (gratis). Chi apre la partita la trova gia' scritta.
    let lettura = "";
    try {
      const r = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(m.id)}&select=numeri`);
      if (r[0]?.numeri && !r[0].numeri.lettura_ai) lettura = (await generaLetturaAI(m.id)) ? " + lettura AI" : " (lettura AI non riuscita)";
    } catch { lettura = " (lettura AI non riuscita)"; }
    if (ctx.da_archivio) { conteggi.gia_pronto++; return "gia' pronto" + lettura; }
    if (ctx.fonti_dati?.includes("FotMob")) conteggi.fotmob++;
    if (ctx.fonti_dati?.includes("SearXNG")) conteggi.notizie++;
    return `${ctx.fonti_dati?.join(" + ")}: ${ctx.blocchi.map((b) => `${b.etichetta} (${b.righe.length})`).join(", ")}${lettura}`;
  } catch (e: any) {
    conteggi.errori++;
    return `errore: ${String(e?.message || e).slice(0, 120)}`;
  }
}

async function caricaAlias() {
  const alias = await pgGetAll("team_alias?select=da,a").catch(() => []);
  impostaAlias(alias as { da: string; a: string }[]);
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") return jsonResponse({ ok: true, stato: await leggi(), valido_ore: DOSSIER_VALIDO_ORE });
    if (req.method !== "POST") return jsonResponse({ error: "Metodo non supportato" }, 405);

    // --- prova su partite scelte, con il dettaglio di ognuna ---
    const ids = (url.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (ids.length) {
      await caricaAlias();
      const righe: any[] = await pgGetAll(`matches?id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id,day,time,manifestazione,squadra1,squadra2`);
      const conteggi = vuoti();
      const esiti = [];
      for (const m of righe) {
        const t0 = Date.now();
        const esito = await dossierDi(m, conteggi, url.searchParams.get("nuovo") === "1");
        esiti.push({ partita: `${m.squadra1} - ${m.squadra2}`, campionato: m.manifestazione, giorno: m.day, ms: Date.now() - t0, esito });
      }
      return jsonResponse({ ok: true, conteggi, esiti });
    }

    // --- avvio del lavoro del giorno ---
    if (url.searchParams.get("avvia") === "1") {
      const attuale = await leggi();
      const occupato = attuale?.stato === "in_corso" && attuale.lucchetto_fino && Date.parse(attuale.lucchetto_fino) > Date.now();
      if (occupato) return jsonResponse({ ok: false, motivo: "un passo sta gia' lavorando", stato: attuale }, 409);
      const giorno = url.searchParams.get("giorno") || oggiRoma();
      const tutte: any[] = await pgGetAll(`matches?day=eq.${giorno}&result=is.null&select=id,day,time`, "time.asc,id.asc");
      const ora = Date.now();
      const daFare = tutte.filter((m) => { const i = inizioPartitaMs(m.day, m.time); return i === null || i > ora; });
      const adesso = new Date().toISOString();
      const s: Stato = {
        giorno, stato: daFare.length ? "in_corso" : "finito", ids: daFare.map((m) => m.id), pos: 0, totale: daFare.length,
        conteggi: vuoti(), avviato: adesso, aggiornato: adesso, lucchetto_fino: null,
      };
      await scrivi(s);
      // Spazio: il testo dei dossier si tiene 60 giorni, i numeri (`numeri`)
      // per sempre. Supabase gratuito ha 500 MB in tutto.
      try {
        const limite = new Date(Date.now() - 60 * 86400_000).toISOString();
        await pgPatch(`dossier_web?created_at=lt.${limite}&contesto->>compattato=is.null`, { contesto: { compattato: true } });
      } catch (e) {
        console.error("[dossier-giornata] compattazione", e);
      }
      return jsonResponse({ ok: true, giorno, partite: s.totale });
    }

    // --- un passo: ~4 minuti di lavoro, poi si salva e si lascia il posto ---
    if (url.searchParams.get("passo") === "1") {
      const s = await leggi();
      if (!s || s.stato !== "in_corso") return jsonResponse({ ok: true, niente_da_fare: true });
      if (s.lucchetto_fino && Date.parse(s.lucchetto_fino) > Date.now()) return jsonResponse({ ok: false, motivo: "un passo sta gia' lavorando" });
      s.lucchetto_fino = new Date(Date.now() + DURATA_LUCCHETTO_MS).toISOString();
      await scrivi(s);
      await caricaAlias();

      const fine = Date.now() + TEMPO_PASSO_MS;
      while (s.pos < s.totale && Date.now() < fine) {
        const id = s.ids[s.pos];
        const righe = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=id,day,time,manifestazione,squadra1,squadra2,result`);
        const m = righe?.[0];
        const inizio = m ? inizioPartitaMs(m.day, m.time) : null;
        // partita cancellata o gia' iniziata nel frattempo: si salta
        if (m && !m.result && (inizio === null || inizio > Date.now())) await dossierDi(m, s.conteggi);
        s.pos++;
        s.aggiornato = new Date().toISOString();
        await scrivi(s);
        if (s.pos < s.totale) await new Promise((r) => setTimeout(r, PAUSA_MS));
      }
      if (s.pos >= s.totale) s.stato = "finito";
      s.lucchetto_fino = null;
      s.aggiornato = new Date().toISOString();
      await scrivi(s);
      return jsonResponse({ ok: true, stato: s.stato, pos: s.pos, totale: s.totale, conteggi: s.conteggi });
    }

    return jsonResponse({ error: "Usa ?avvia=1, ?passo=1 oppure ?ids=..." }, 400);
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
};
