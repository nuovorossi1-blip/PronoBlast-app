import { pgGetAll, jsonResponse, rowToMatch, rowToOdds } from "./lib/supabaseRest";
import { preHeuristicRanking } from "./lib/preHeuristic";

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
    // Anteprima della card: il primo mercato del PRE del server, lo stesso che
    // la scheda mostra (prima la card usava un'euristica diversa, e card e
    // scheda si contraddicevano: MG 2-4 contro X2 su Santos-Cruzeiro).
    return jsonResponse(rows.map((r: any) => {
      const m: any = rowToMatch(r);
      if (!r.pick_finale) {
        try {
          m.anteprima_pre = preHeuristicRanking(rowToOdds(r))[0]?.market ?? null;
        } catch (e) {
          console.error("[matches-list] anteprima", r.id, e);
        }
      }
      return m;
    }));
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
