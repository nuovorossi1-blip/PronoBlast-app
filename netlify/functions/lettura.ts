import { jsonResponse } from "./lib/supabaseRest";
import { datiLettura, generaLetturaAI } from "./lib/letturaPartita";

/**
 * GET  /lettura?matchId=<uuid>          -> lettura del programma + lettura AI salvata (se c'e')
 * POST /lettura?matchId=<uuid>&genera=1 -> fa ora la lettura AI con un modello GRATIS e la salva
 * (07/10/2026, vedi lib/letturaPartita.ts)
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const id = url.searchParams.get("matchId");
  if (!id) return jsonResponse({ error: "Parametro 'matchId' mancante" }, 400);
  try {
    const dati = await datiLettura(id);
    if (!dati) return jsonResponse({ programma: null, ai: null });
    let ai = dati.numeri?.lettura_ai ?? null;
    if (req.method === "POST" && url.searchParams.get("genera") === "1") {
      ai = (await generaLetturaAI(id, dati)) ?? ai;
      if (!ai) return jsonResponse({ error: "I modelli gratis non hanno risposto (sovraccarichi?): riprova fra poco.", programma: dati.programma }, 502);
    }
    const { testo: _t, ...programma } = dati.programma;
    return jsonResponse({ programma, ai, dossier: !!dati.numeri });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
