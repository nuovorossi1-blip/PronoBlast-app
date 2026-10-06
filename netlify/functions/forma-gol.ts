import { pgGet, jsonResponse } from "./lib/supabaseRest";
import { formaGol } from "./lib/formaGol";
import { inizioPartitaMs } from "../../frontend/src/api";

/**
 * GET /forma-gol?matchId=<uuid>
 * Ultime 5 partite delle due squadre (totali e casa/fuori) da FotMob, per la
 * scheda "Cosa aspettarsi dai gol" (07/10/2026). Sola lettura, in memoria 6
 * ore. `{ forma: null }` se FotMob non trova la partita.
 */
export default async (req: Request): Promise<Response> => {
  const id = new URL(req.url).searchParams.get("matchId");
  if (!id) return jsonResponse({ error: "Parametro 'matchId' mancante" }, 400);
  try {
    const rows = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=day,time,squadra1,squadra2`);
    if (!rows.length) return jsonResponse({ error: "Partita non trovata" }, 404);
    const m = rows[0];
    let fotmobId: string | null = null;
    try {
      const d = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(id)}&select=numeri`);
      fotmobId = d[0]?.numeri?.fotmob_id || null;
    } catch { /* senza dossier si cerca nell'elenco del giorno */ }
    const forma = await formaGol(
      { giorno: m.day, casa: m.squadra1, ospite: m.squadra2, inizioMs: inizioPartitaMs(m.day, m.time) },
      fotmobId,
    );
    return jsonResponse({ forma });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
