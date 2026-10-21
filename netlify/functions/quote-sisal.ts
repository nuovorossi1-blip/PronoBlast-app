import { jsonResponse } from "./lib/supabaseRest";
import { aggiornaQuoteSisalLotto } from "./lib/quoteSisal";

/**
 * POST /quote-sisal  Body: { "ids": ["uuid", ...] }
 * Quote della scheda partita Sisal lette appena le partite vanno in Schedina (21/10/2026, Rossi), senza
 * aspettare il Pronostico AI. A lotti (una sola apertura di Edge sul PC), solo le partite che le quote
 * complete non le hanno ancora (si ricaricano solo col Pronostico AI). Vedi lib/quoteSisal.ts.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = (Array.isArray(body?.ids) ? body.ids : []).map(String).slice(0, 60);
    if (!ids.length) return jsonResponse({ error: "'ids' mancante o vuoto" }, 400);
    return jsonResponse({ ok: true, partite: await aggiornaQuoteSisalLotto(ids) });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
};
