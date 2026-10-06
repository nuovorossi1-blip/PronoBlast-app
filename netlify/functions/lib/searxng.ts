/**
 * NOTIZIE DAL WEB CON SEARXNG (06/10/2026): il motore di ricerca installato sul
 * PC (Docker in WSL, /opt/searxng, solo su 127.0.0.1:8888). Interroga Google,
 * DuckDuckGo, Bing e altri insieme, e non ha crediti: e' la ricerca di tutti i
 * giorni, Tavily resta di riserva.
 *
 * Differenza da Tavily: SearXNG restituisce link e un estratto corto, non il
 * testo della pagina. Per questo le prime pagine si scaricano e se ne tengono
 * solo le frasi che nominano una delle due squadre.
 *
 * Si scartano i siti di pronostici e scommesse: copiare il parere di un altro
 * non e' un dato (stessa regola di webSearch.ts).
 */
import { norm } from "./teamMatch";

const URL_BASE = (process.env.SEARXNG_URL || "http://127.0.0.1:8888").replace(/\/$/, "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SITI_PRONOSTICI = /pronostic|prediction|predictz|tips|tipster|betting|bettingexpert|scommess|quote|odds|forebet|windrawwin|sportsgambler|oddspedia|scores24|footystats|vitibet|statarea|zulubet|betensured|sportytrader|bettingodds|freesupertips|footballpredictions/i;

export type RisultatoSearx = { titolo: string; url: string; testo: string; motori: string[] };

export async function searxCerca(query: string, tempo: "day" | "week" | "month" = "week"): Promise<RisultatoSearx[]> {
  const url = `${URL_BASE}/search?q=${encodeURIComponent(query)}&format=json&time_range=${tempo}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const j = await res.json();
  return (j?.results || []).map((r: any) => ({
    titolo: String(r?.title || ""),
    url: String(r?.url || ""),
    testo: String(r?.content || "").replace(/\s+/g, " ").trim(),
    motori: Array.isArray(r?.engines) ? r.engines : [],
  }));
}

/** Parole che identificano una squadra nel testo: "FC Heidenheim" -> ["heidenheim"]. */
function parole(squadra: string): string[] {
  return norm(squadra).split(" ").filter((p) => p.length >= 4);
}

function nomina(testo: string, chiavi: string[]): boolean {
  const t = norm(testo);
  return chiavi.some((p) => t.includes(p));
}

/** Scarica una pagina e tiene solo le frasi che nominano una delle squadre. */
async function frasiDallaPagina(url: string, chiavi: string[], max = 700): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok || !String(res.headers.get("content-type") || "").includes("html")) return "";
    const html = (await res.text()).slice(0, 600_000);
    const testo = html
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ");
    const frasi = testo.split(/(?<=[.!?])\s+/).filter((f) => f.length > 40 && f.length < 400 && nomina(f, chiavi));
    let out = "";
    for (const f of frasi) {
      if (out.length + f.length > max) break;
      out += (out ? " " : "") + f.trim();
    }
    return out;
  } catch {
    return "";
  }
}

export type NotizieWeb = { righe: string[]; fonti: { titolo: string; url: string }[] };

/**
 * Notizie recenti (ultima settimana) su una partita: due ricerche, poi le prime
 * due pagine utili lette per intero. null se SearXNG non risponde.
 */
export async function notiziePartita(casa: string, ospite: string): Promise<NotizieWeb | null> {
  const chiavi = [...parole(casa), ...parole(ospite)];
  if (!chiavi.length) return null;
  const domande = [`${casa} ${ospite} team news injuries`, `${casa} vs ${ospite} preview`];
  const visti = new Set<string>();
  const buoni: RisultatoSearx[] = [];
  let risposto = false;
  for (const q of domande) {
    try {
      const ris = await searxCerca(q, "week");
      risposto = true;
      for (const r of ris) {
        if (!r.url || visti.has(r.url) || SITI_PRONOSTICI.test(r.url) || SITI_PRONOSTICI.test(r.titolo)) continue;
        if (!nomina(`${r.titolo} ${r.testo}`, chiavi)) continue;
        visti.add(r.url);
        buoni.push(r);
      }
    } catch (e) {
      console.error("[searxng]", q, e);
    }
  }
  if (!risposto) return null;
  if (!buoni.length) return { righe: [], fonti: [] };

  const scelti = buoni.slice(0, 5);
  const righe: string[] = [];
  // Le prime due pagine si leggono per intero (le frasi che contano);
  // per le altre basta l'estratto del motore.
  const pagine = await Promise.all(scelti.slice(0, 2).map((r) => frasiDallaPagina(r.url, chiavi)));
  scelti.forEach((r, i) => {
    const testo = (i < 2 && pagine[i]) || r.testo;
    if (testo.length > 60) righe.push(`${r.titolo}: ${testo.slice(0, 700)}`);
  });
  return { righe, fonti: scelti.map((r) => ({ titolo: r.titolo, url: r.url })) };
}
