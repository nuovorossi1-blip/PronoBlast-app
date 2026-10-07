import { pgGet, jsonResponse, rowToMatch } from "./lib/supabaseRest";
import { consigliatoValido } from "./lib/letturaPartita";

/**
 * GET /selected-list
 * Porting di GET /matches/selected/list (server.py) — tutte le partite
 * attualmente selezionate (Schedina), con il pronostico piu' recente allegato.
 */
export default async (): Promise<Response> => {
  try {
    const rows = await pgGet(`matches?selected=eq.true&select=*&order=day.asc,time.asc`);
    const matches = rows.map(rowToMatch);

    if (matches.length) {
      const ids = matches.map((m: any) => `"${m.id}"`).join(",");
      const preds = await pgGet(
        `predictions?match_id=in.(${ids})&select=*&order=created_at.desc`
      );
      const latestByMatch: Record<string, any> = {};
      for (const p of preds) {
        if (!latestByMatch[p.match_id]) latestByMatch[p.match_id] = p;
      }
      for (const m of matches) (m as any).prediction = latestByMatch[m.id] || null;
      // IL CONSIGLIATO di ogni partita (07/10/2026): lo stesso della scheda,
      // salvato dal giro automatico o dal Pronostico AI della schedina.
      try {
        const dossier = await pgGet(`dossier_web?match_id=in.(${ids})&select=match_id,numeri`);
        const perId: Record<string, any> = {};
        for (const d of dossier) perId[d.match_id] = d.numeri;
        for (const m of matches as any[]) {
          const riga = rows.find((r: any) => r.id === m.id);
          m.consigliato = consigliatoValido(perId[m.id], riga);
        }
      } catch (e) {
        console.error("[selected-list] consigliato", e);
      }
    }

    return jsonResponse(matches);
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
