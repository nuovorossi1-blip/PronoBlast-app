import { pgGetAll, jsonResponse } from "./lib/supabaseRest";

/**
 * GET /export-db
 * Porting di GET /export (server.py) — export completo matches + predictions.
 */
export default async (): Promise<Response> => {
  try {
    // pgGetAll e non pgGet: con `limit=100000` PostgREST rispondeva comunque
    // 1000 righe e basta, troncando l'export in silenzio (27/09/2026).
    const matches = await pgGetAll("matches?select=*");
    const predictions = await pgGetAll("predictions?select=*");
    return jsonResponse({
      version: 1,
      exported_at: new Date().toISOString(),
      counts: { matches: matches.length, predictions: predictions.length },
      matches,
      predictions,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
