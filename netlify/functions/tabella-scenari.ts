import { jsonResponse } from "./lib/supabaseRest";
import { tabellaScenari } from "./lib/tabellaScenari";

/**
 * GET /tabella-scenari — per scenario e fascia di quota, i mercati che la
 * prendono piu' spesso in modo stabile (vedi lib/tabellaScenari.ts). Sola
 * lettura; la prima volta in assoluto il calcolo richiede qualche minuto.
 */
export default async (_req: Request): Promise<Response> => {
  try {
    return jsonResponse(await tabellaScenari());
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
