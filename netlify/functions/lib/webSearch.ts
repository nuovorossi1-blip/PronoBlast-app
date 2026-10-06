/**
 * Ricerca web con Tavily, per dare al pronostico AI i fatti che oggi non ha.
 *
 * COSA CAMBIA E COSA NO (27/09/2026). Non cambia il formato della risposta del
 * modello: resta JSON rigido, perche' quel JSON alimenta la fusione, il
 * verdetto e l'apprendimento. Cambia solo cosa il modello SA: oggi riceve
 * quote, probabilita' del motore e storico, e nient'altro — niente xG, niente
 * formazioni, niente assenze. Qui si aggiunge un blocco di fatti, con le fonti.
 *
 * TRE RICERCHE MIRATE, non una sola generica. Una query tipo
 * "Banfield Newells pronostico" restituisce i siti di pronostici altrui: si
 * finirebbe a copiare l'opinione di qualcun altro invece di usare i dati.
 *
 * IL SILENZIO E' UNA RISPOSTA. Per le leghe minori (ARG1F, ING7, terze
 * divisioni) non ci sara' niente di serio. In quel caso il blocco dice
 * "nessun dato attendibile" e il modello lavora come prima. E' la stessa regola
 * dei risultati: nel dubbio non si scrive.
 */

import { pgGet, pgPost } from "./supabaseRest";

const ENDPOINT = "https://api.tavily.com/search";

export type RisultatoWeb = { titolo: string; url: string; testo: string; punteggio: number };

/** AAAA-MM-GG di un istante UTC spostato di `giorni`. */
function dataIso(ms: number, giorni = 0): string {
  return new Date(ms + giorni * 86400000).toISOString().slice(0, 10);
}

/**
 * `inizioMs`: ora di inizio della partita. Se la ricerca e' fatta DOPO il
 * calcio d'inizio, si chiede a Tavily solo cio' che e' uscito fino al giorno
 * prima e si scarta ogni risultato datato dopo l'inizio: altrimenti il modello
 * legge il risultato (Belgio-Galles, 30/09: "reduce da 1-0 sul Galles").
 */
async function cerca(query: string, key: string, max = 4, inizioMs: number | null = null): Promise<RisultatoWeb[]> {
  const dopoInizio = inizioMs !== null && Date.now() >= inizioMs;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: max,
        include_answer: false,
        topic: "general",
        days: 14,          // notizie vecchie su formazioni e infortuni non servono
        ...(dopoInizio ? { start_date: dataIso(inizioMs!, -15), end_date: dataIso(inizioMs!, -1) } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const dati = await res.json();
    return (dati?.results || [])
      .filter((r: any) => {
        if (!dopoInizio || !r.published_date) return true;
        const pubblicato = Date.parse(r.published_date);
        return !isFinite(pubblicato) || pubblicato < inizioMs!;
      })
      .map((r: any) => ({
        titolo: String(r.title || ""),
        url: String(r.url || ""),
        testo: String(r.content || "").replace(/\s+/g, " ").trim(),
        punteggio: Number(r.score) || 0,
      }));
  } finally {
    clearTimeout(t);
  }
}

/** Le tre domande che servono davvero, nell'ordine in cui contano. */
export function queryPerPartita(casa: string, ospite: string, campionato: string): { etichetta: string; query: string }[] {
  return [
    { etichetta: "Formazioni e assenze", query: `${casa} ${ospite} probable lineups injuries team news` },
    { etichetta: "Forma recente", query: `${casa} vs ${ospite} last 5 matches form results ${campionato}` },
    { etichetta: "xG e statistiche", query: `${casa} ${ospite} expected goals xG stats season` },
  ];
}

export type ContestoWeb = {
  disponibile: boolean;
  blocchi: { etichetta: string; righe: string[] }[];
  fonti: { titolo: string; url: string }[];
  motivo?: string;
  /** Ricerche Tavily andate a buon fine (ognuna "advanced" = 2 crediti). */
  ricerche?: number;
  /** Il contesto viene dall'archivio `dossier_web`, non da una ricerca nuova. */
  da_archivio?: boolean;
  /** Quando e' stata fatta la ricerca (solo se da archivio). */
  cercato_il?: string;
};

/**
 * Raccoglie il contesto per una partita. Non lancia mai: se Tavily non risponde
 * o non trova niente di rilevante, torna `disponibile: false` e il pronostico
 * viene generato come prima.
 */
export async function contestoPartita(
  casa: string, ospite: string, campionato: string, key: string, inizioMs: number | null = null,
): Promise<ContestoWeb> {
  if (!key) return { disponibile: false, blocchi: [], fonti: [], motivo: "chiave Tavily assente" };

  const domande = queryPerPartita(casa, ospite, campionato);
  const blocchi: { etichetta: string; righe: string[] }[] = [];
  const fonti = new Map<string, string>();
  let erroriDiFila = 0;
  let ricerche = 0;

  for (const d of domande) {
    try {
      const risultati = await cerca(d.query, key, 4, inizioMs);
      ricerche++;
      // Soglia sulla rilevanza: Tavily restituisce comunque qualcosa, anche
      // quando non c'entra niente. Sotto 0.5 e' rumore, e dare rumore al
      // modello e' peggio che non dargli niente.
      const buoni = risultati.filter((r) => r.punteggio >= 0.5 && r.testo.length > 80);
      if (!buoni.length) continue;
      blocchi.push({
        etichetta: d.etichetta,
        righe: buoni.slice(0, 3).map((r) => r.testo.slice(0, 500)),
      });
      for (const r of buoni) fonti.set(r.url, r.titolo);
    } catch (e) {
      console.error("[webSearch]", d.etichetta, e);
      erroriDiFila++;
      if (erroriDiFila >= 2) break;   // Tavily giu' o quota finita: si smette
    }
  }

  if (!blocchi.length) {
    return {
      disponibile: false, blocchi: [], fonti: [], ricerche,
      motivo: erroriDiFila ? "Tavily non ha risposto" : "nessun dato attendibile trovato per questa partita",
    };
  }
  return {
    disponibile: true,
    blocchi,
    fonti: [...fonti.entries()].slice(0, 8).map(([url, titolo]) => ({ url, titolo })),
    ricerche,
  };
}

/**
 * CREDITI TAVILY (06/10/2026). L'endpoint /usage dice quanti crediti del piano
 * sono gia' usati, e non ne consuma. E' il dato vero, non una stima: conta
 * anche le ricerche fatte da web-probe o da altri programmi con la stessa
 * chiave. Si tiene in memoria un minuto, cosi' "AI Schedina" non lo chiede a
 * ogni partita.
 */
export type CreditiTavily = { usati: number; limite: number | null; piano: string };
let creditiInMemoria: { quando: number; dato: CreditiTavily } | null = null;

export async function creditiTavily(key: string): Promise<CreditiTavily | null> {
  if (!key) return null;
  if (creditiInMemoria && Date.now() - creditiInMemoria.quando < 60_000) return creditiInMemoria.dato;
  try {
    const res = await fetch("https://api.tavily.com/usage", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const dato: CreditiTavily = {
      usati: Number(j?.account?.plan_usage ?? j?.key?.usage) || 0,
      limite: j?.account?.plan_limit ?? null,
      piano: String(j?.account?.current_plan || ""),
    };
    creditiInMemoria = { quando: Date.now(), dato };
    return dato;
  } catch {
    return null;
  }
}

/** Oltre questo numero di crediti usati nel mese non si cerca piu': il
 *  pronostico si fa lo stesso, senza web. Si cambia in `settings.tavily_tetto`. */
export const TETTO_TAVILY_PREDEFINITO = 900;

export async function tettoTavily(): Promise<number> {
  try {
    const rows = await pgGet(`settings?key=eq.tavily_tetto&select=value`);
    const v = Number(rows?.[0]?.value);
    return isFinite(v) && v > 0 ? v : TETTO_TAVILY_PREDEFINITO;
  } catch {
    return TETTO_TAVILY_PREDEFINITO;
  }
}

/**
 * DOSSIER SALVATO PER PARTITA (06/10/2026). Prima ogni "Rigenera" rifaceva le
 * tre ricerche da capo (6 crediti) anche se il web non era cambiato. Ora il
 * contesto si salva in `dossier_web` e si riusa finche' ha meno di
 * DOSSIER_VALIDO_ORE. Si rifa' la ricerca solo se e' vecchio o se `nuovo`.
 *
 * Si salva anche "nessun dato attendibile": per le leghe minori e' la risposta
 * giusta, e ricercarla a ogni rigenera costerebbe crediti per niente. NON si
 * salva quando Tavily non ha risposto, quando manca la chiave o quando si e'
 * al tetto: sono condizioni del momento, non della partita.
 *
 * Se la tabella non c'e' ancora (SQL non lanciato), tutto funziona come prima:
 * si cerca ogni volta.
 */
export const DOSSIER_VALIDO_ORE = 6;

export async function contestoPartitaSalvato(
  matchId: string,
  casa: string, ospite: string, campionato: string, key: string, inizioMs: number | null,
  opzioni: { nuovo?: boolean } = {},
): Promise<ContestoWeb> {
  if (!opzioni.nuovo) {
    try {
      const rows = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}&select=contesto,created_at&limit=1`);
      const r = rows?.[0];
      if (r?.contesto) {
        const eta = Date.now() - Date.parse(r.created_at);
        // Partita gia' iniziata: un dossier fatto PRIMA del calcio d'inizio e'
        // proprio quello giusto (niente risultato dentro), qualunque eta' abbia.
        const primaDellInizio = inizioMs !== null && Date.now() >= inizioMs && Date.parse(r.created_at) < inizioMs;
        if (eta < DOSSIER_VALIDO_ORE * 3600_000 || primaDellInizio) {
          return { ...(r.contesto as ContestoWeb), da_archivio: true, cercato_il: r.created_at, ricerche: 0 };
        }
      }
    } catch (e) {
      console.error("[webSearch] lettura dossier", e);
    }
  }

  if (!key) return { disponibile: false, blocchi: [], fonti: [], motivo: "chiave Tavily assente" };

  const crediti = await creditiTavily(key);
  const tetto = await tettoTavily();
  if (crediti && crediti.usati >= tetto) {
    return {
      disponibile: false, blocchi: [], fonti: [],
      motivo: `tetto crediti Tavily raggiunto (${crediti.usati}/${crediti.limite ?? "?"}, tetto ${tetto})`,
    };
  }

  const ctx = await contestoPartita(casa, ospite, campionato, key, inizioMs);
  if (creditiInMemoria && ctx.ricerche) creditiInMemoria.dato.usati += ctx.ricerche * 2;

  const daSalvare = ctx.disponibile || ctx.motivo === "nessun dato attendibile trovato per questa partita";
  if (daSalvare) {
    try {
      const { ricerche, da_archivio, cercato_il, ...contesto } = ctx;
      await pgPost("dossier_web", {
        match_id: matchId,
        contesto,
        crediti: (ricerche || 0) * 2,
        created_at: new Date().toISOString(),
      }, "resolution=merge-duplicates,return=minimal");
    } catch (e) {
      console.error("[webSearch] salvataggio dossier", e);
    }
  }
  return ctx;
}

/** Il blocco di testo da infilare nel messaggio utente, prima del catalogo. */
export function blocoTesto(ctx: ContestoWeb): string {
  if (!ctx.disponibile) {
    return `\n🌐 DATI DAL WEB: ${ctx.motivo}. Lavora con le quote, le probabilita' del motore e lo storico: NON inventare formazioni, infortuni o statistiche che non hai.\n`;
  }
  const corpo = ctx.blocchi
    .map((b) => `• ${b.etichetta}:\n${b.righe.map((r) => `  - ${r}`).join("\n")}`)
    .join("\n");
  return (
    `\n🌐 DATI DAL WEB (ultimi 14 giorni, ricerca automatica${ctx.cercato_il ? ` del ${new Date(ctx.cercato_il).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}` : ""})\n${corpo}\n` +
    `Fonti: ${ctx.fonti.map((f) => f.url).join(" | ")}\n` +
    `Usali per confermare o smentire la lettura delle quote, e citali nel campo "analysis". ` +
    `Se un dato manca o e' contraddittorio, dillo invece di riempire il vuoto.\n`
  );
}
