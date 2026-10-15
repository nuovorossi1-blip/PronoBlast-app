import { jsonResponse, pgGet } from "./lib/supabaseRest";
import { decidi } from "./lib/regolePronostico";
import { tabellaScenari } from "./lib/tabellaScenari";

/**
 * GET /regole?matchId=<uuid> -> "Pronostico regole" (scenario + lettura AI, semaforo, scelta per
 * fascia) per la scheda partita. Sola lettura: non salva niente e non cambia il consigliato.
 * (15/10/2026, vedi lib/regolePronostico.ts)
 */
export default async (req: Request): Promise<Response> => {
  const id = new URL(req.url).searchParams.get("matchId");
  if (!id) return jsonResponse({ error: "Parametro 'matchId' mancante" }, 400);
  try {
    const [m] = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!m) return jsonResponse({ error: "Partita non trovata" }, 404);
    if (!(Number(m.odd_1) > 1 && Number(m.odd_x) > 1 && Number(m.odd_2) > 1)) return jsonResponse({ regole: null, motivo: "quote 1X2 mancanti" });
    const [d] = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(id)}&select=ai:numeri->lettura_ai,pro:numeri->lettura_pro,prog:numeri->programma`);
    return jsonResponse({ regole: decidi(m, { ai: d?.ai, pro: d?.pro, prog: d?.prog, tab: await tabellaScenari().catch(() => null) }) });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
