import { jsonResponse } from "./lib/supabaseRest";
import { contestoPartita, blocoTesto } from "./lib/webSearch";

/**
 * GET /web-probe?casa=...&ospite=...&lega=...
 * Sonda temporanea: serve a verificare che Tavily risponda DA QUESTO SERVER e
 * che i dati che restituisce siano utilizzabili, prima di collegarlo al
 * pronostico. Va tolta quando il collegamento e' stabile.
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const casa = url.searchParams.get("casa") || "Inter";
  const ospite = url.searchParams.get("ospite") || "Milan";
  const lega = url.searchParams.get("lega") || "Serie A";
  const t0 = Date.now();
  try {
    const ctx = await contestoPartita(casa, ospite, lega, (process.env.TAVILY_API_KEY || "").trim());
    return jsonResponse({
      ms: Date.now() - t0,
      chiave: process.env.TAVILY_API_KEY ? "presente" : "assente",
      disponibile: ctx.disponibile,
      motivo: ctx.motivo,
      blocchi: ctx.blocchi.map((b) => ({ etichetta: b.etichetta, righe: b.righe.length, anteprima: b.righe[0]?.slice(0, 220) })),
      fonti: ctx.fonti,
      testo_lunghezza: blocoTesto(ctx).length,
    });
  } catch (e: any) {
    return jsonResponse({ errore: String(e?.message || e), ms: Date.now() - t0 }, 502);
  }
};
