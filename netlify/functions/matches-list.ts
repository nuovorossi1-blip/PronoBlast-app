import { pgGetAll, jsonResponse, rowToMatch } from "./lib/supabaseRest";

/**
 * GET /matches-list?day=YYYY-MM-DD&q=testo
 * Porting di GET /matches (server.py) — lista partite, ordinate per giorno/ora.
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  const q = url.searchParams.get("q");

  let filter = "";
  if (day) filter += `&day=eq.${encodeURIComponent(day)}`;
  if (q) {
    const like = `*${q}*`;
    const enc = encodeURIComponent(like);
    filter += `&or=(squadra1.ilike.${enc},squadra2.ilike.${enc},manifestazione.ilike.${enc})`;
  }

  try {
    // pgGetAll: con `limit=5000` PostgREST rispondeva comunque al massimo 1000
    // righe, troncando in silenzio (27/09/2026).
    const rows = await pgGetAll(`matches?select=*${filter}`, "day.asc,time.asc");
    return jsonResponse(rows.map(rowToMatch));
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
