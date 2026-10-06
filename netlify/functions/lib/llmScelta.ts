import { pgGet } from "./supabaseRest";
import { LLM_OPTIONS, DEFAULT_LLM, type LlmOption } from "./llmProviders";

/**
 * MODELLI OPENROUTER DAL VIVO (06/10/2026).
 *
 * Prima si poteva scegliere solo fra i modelli scritti in LLM_OPTIONS. Ora in
 * `settings.llm_model` puo' esserci anche "or:<id OpenRouter>" (es.
 * "or:deepseek/deepseek-v4-flash"): QUALSIASI modello del catalogo OpenRouter,
 * letto dal vivo con prezzi e costo stimato a pronostico.
 *
 * "Piu' economico automatico" (`settings.openrouter_economico`, predefinito
 * si'): a ogni chiamata OpenRouter sceglie il fornitore piu' conveniente del
 * momento (`provider.sort = "price"`), fra quelli che l'account puo' usare.
 * Provato il 06/10 su un pronostico vero: 0,08 cent invece di 0,13. Un ordine
 * calcolato da noi sui prezzi (sconti compresi) finiva invece sulle riserve:
 * con la "conservazione zero dei dati" dell'account i fornitori piu' scontati
 * (StreamLake -70%, DeepInfra, GMI) rifiutano, e solo OpenRouter lo sa.
 */

export const PREFISSO_OR = "or:";

/** Token di un pronostico tipico: prompt (quote, catalogo, storico, dossier) + risposta JSON. */
const TOKEN_IN = 12_000;
const TOKEN_OUT = 2_500;

export type ModelloOr = {
  id: string; nome: string; gratis: boolean; strumenti: boolean; contesto: number | null;
  in_m: number | null; out_m: number | null;   // $ per milione di token
  costo: number | null;                        // $ stimati a pronostico
};

let catalogo: { quando: number; modelli: ModelloOr[] } | null = null;

export async function catalogoOpenRouter(): Promise<ModelloOr[]> {
  if (catalogo && Date.now() - catalogo.quando < 6 * 3600_000) return catalogo.modelli;
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenRouter: elenco modelli non disponibile (${res.status})`);
  const dati = await res.json();
  const modelli: ModelloOr[] = (dati?.data || [])
    // :batch non risponde subito (API apposita, differita): inutile per un pronostico a schermo
    .filter((m: any) => m?.id && !String(m.id).endsWith(":batch"))
    .map((m: any) => {
      // I "router" (es. openrouter/auto) hanno prezzo variabile, scritto come -1: prezzo ignoto.
      const prezzo = (p: any) => (p != null && Number(p) >= 0 ? Number(p) * 1e6 : null);
      const pin = prezzo(m?.pricing?.prompt);
      const pout = prezzo(m?.pricing?.completion);
      const gratis = String(m.id).endsWith(":free") || (pin === 0 && pout === 0);
      return {
        id: m.id, nome: m.name || m.id, gratis,
        strumenti: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
        contesto: m.context_length ?? null,
        in_m: pin != null ? Math.round(pin * 1000) / 1000 : null,
        out_m: pout != null ? Math.round(pout * 1000) / 1000 : null,
        costo: gratis ? 0 : pin != null && pout != null ? Math.round(((pin * TOKEN_IN + pout * TOKEN_OUT) / 1e6) * 100000) / 100000 : null,
      };
    })
    .sort((a: ModelloOr, b: ModelloOr) => (a.costo ?? 99) - (b.costo ?? 99));
  catalogo = { quando: Date.now(), modelli };
  return modelli;
}

/** Credito della chiave OpenRouter dell'app (null se manca o non risponde). */
export async function creditoOpenRouter(): Promise<{ caricato: number; usato: number; residuo: number; gratis_oggi: any } | null> {
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) return null;
  try {
    const h = { Authorization: `Bearer ${key}` };
    const [c, k] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/credits", { headers: h, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()),
      fetch("https://openrouter.ai/api/v1/key", { headers: h, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()),
    ]);
    const caricato = Number(c?.data?.total_credits) || 0, usato = Number(c?.data?.total_usage) || 0;
    return {
      caricato: Math.round(caricato * 100) / 100, usato: Math.round(usato * 100) / 100,
      residuo: Math.round((caricato - usato) * 100) / 100,
      gratis_oggi: k?.data?.free_model_daily_requests ?? null,
    };
  } catch {
    return null;
  }
}

async function leggiSetting(chiave: string): Promise<any> {
  const rows = await pgGet(`settings?key=eq.${chiave}&select=value`);
  return Array.isArray(rows) && rows.length ? rows[0].value : null;
}

export async function economicoAttivo(): Promise<boolean> {
  try { return (await leggiSetting("openrouter_economico")) !== false; } catch { return true; }
}

/** L'opzione per un id: quelle fisse di LLM_OPTIONS oppure "or:<id>" dal catalogo. */
export async function opzioneDaId(id: string): Promise<LlmOption | null> {
  const fissa = LLM_OPTIONS.find((o) => o.id === id);
  if (fissa) return fissa;
  if (!id?.startsWith(PREFISSO_OR)) return null;
  const modello = id.slice(PREFISSO_OR.length);
  let m: ModelloOr | undefined;
  try { m = (await catalogoOpenRouter()).find((x) => x.id === modello); } catch { /* catalogo giu': si usa lo stesso */ }
  return {
    id, provider: "openrouter", model: modello,
    label: m ? `${m.nome} (OpenRouter)` : `${modello} (OpenRouter)`,
    cost_per_pred: m?.costo ?? 0,
    speed: "—", quality: "—",
    desc: m ? (m.gratis ? "Gratuito" : `~$${m.costo} a pronostico`) + (m.strumenti ? "" : " · non usa strumenti") : "Modello OpenRouter",
  };
}

/** Il modello scelto in Strumenti, con l'interruttore "piu' economico" applicato. */
export async function modelloScelto(): Promise<LlmOption> {
  let id = DEFAULT_LLM;
  try { id = (await leggiSetting("llm_model")) || DEFAULT_LLM; } catch { /* predefinito */ }
  const o = (await opzioneDaId(id)) || LLM_OPTIONS[0];
  return o.provider === "openrouter" ? { ...o, economico: await economicoAttivo() } : o;
}
