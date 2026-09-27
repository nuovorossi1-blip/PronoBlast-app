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

const ENDPOINT = "https://api.tavily.com/search";

export type RisultatoWeb = { titolo: string; url: string; testo: string; punteggio: number };

async function cerca(query: string, key: string, max = 4): Promise<RisultatoWeb[]> {
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
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const dati = await res.json();
    return (dati?.results || []).map((r: any) => ({
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
};

/**
 * Raccoglie il contesto per una partita. Non lancia mai: se Tavily non risponde
 * o non trova niente di rilevante, torna `disponibile: false` e il pronostico
 * viene generato come prima.
 */
export async function contestoPartita(
  casa: string, ospite: string, campionato: string, key: string,
): Promise<ContestoWeb> {
  if (!key) return { disponibile: false, blocchi: [], fonti: [], motivo: "chiave Tavily assente" };

  const domande = queryPerPartita(casa, ospite, campionato);
  const blocchi: { etichetta: string; righe: string[] }[] = [];
  const fonti = new Map<string, string>();
  let erroriDiFila = 0;

  for (const d of domande) {
    try {
      const risultati = await cerca(d.query, key);
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
    } catch {
      erroriDiFila++;
      if (erroriDiFila >= 2) break;   // Tavily giu' o quota finita: si smette
    }
  }

  if (!blocchi.length) {
    return {
      disponibile: false, blocchi: [], fonti: [],
      motivo: erroriDiFila ? "Tavily non ha risposto" : "nessun dato attendibile trovato per questa partita",
    };
  }
  return {
    disponibile: true,
    blocchi,
    fonti: [...fonti.entries()].slice(0, 8).map(([url, titolo]) => ({ url, titolo })),
  };
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
    `\n🌐 DATI DAL WEB (ultimi 14 giorni, ricerca automatica)\n${corpo}\n` +
    `Fonti: ${ctx.fonti.map((f) => f.url).join(" | ")}\n` +
    `Usali per confermare o smentire la lettura delle quote, e citali nel campo "analysis". ` +
    `Se un dato manca o e' contraddittorio, dillo invece di riempire il vuoto.\n`
  );
}
