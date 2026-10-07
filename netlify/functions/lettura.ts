import { jsonResponse } from "./lib/supabaseRest";
import { datiLettura, generaLetturaAI, letturaDaRifare, quoteCambiate, firmaQuote } from "./lib/letturaPartita";
import { inizioPartitaMs } from "../../frontend/src/api";

/**
 * GET  /lettura?matchId=<uuid>[&auto=1]  -> lettura del programma + letture AI salvate.
 *      Con auto=1, se la lettura gratis manca o le quote sono cambiate e la
 *      partita non e' iniziata, la fa ora (Rossi: "se e' automatica falla e
 *      basta, senza cliccarci").
 * POST /lettura?matchId=<uuid>&genera=1[&pro=1] -> la fa ora; pro=1 = "Pronostico AI"
 *      con il modello scelto in LLM & Budget (a pagamento se lo e' il modello).
 * (07/10/2026, vedi lib/letturaPartita.ts)
 */
export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const id = url.searchParams.get("matchId");
  if (!id) return jsonResponse({ error: "Parametro 'matchId' mancante" }, 400);
  try {
    const dati = await datiLettura(id);
    if (!dati) return jsonResponse({ programma: null, ai: null, pro: null });
    let ai = dati.numeri?.lettura_ai ?? null;
    let pro = dati.numeri?.lettura_pro ?? null;
    const inizio = inizioPartitaMs(dati.match.day, dati.match.time);
    const daGiocare = !dati.match.result && (inizio === null || inizio > Date.now());
    if (req.method === "GET" && url.searchParams.get("auto") === "1" && daGiocare && dati.numeri && letturaDaRifare(dati.numeri, dati.match)) {
      ai = (await generaLetturaAI(id, dati)) ?? ai;
    }
    if (req.method === "POST" && url.searchParams.get("genera") === "1") {
      if (url.searchParams.get("pro") === "1") {
        pro = await generaLetturaAI(id, dati, { pro: true });
        if (!pro) return jsonResponse({ error: "Il modello scelto non ha dato una lettura valida: riprova o cambia modello in LLM & Budget." }, 502);
      } else {
        ai = (await generaLetturaAI(id, dati)) ?? ai;
        if (!ai) return jsonResponse({ error: "I modelli gratis non hanno risposto (sovraccarichi o limite del giorno): riprova fra poco." }, 502);
      }
    }
    const { testo: _t, ...programma } = dati.programma;
    const ora = firmaQuote(dati.match);
    return jsonResponse({
      programma, ai, pro, dossier: !!dati.numeri,
      // Le letture fatte prima del 07/10 non hanno le quote salvate: non si sa.
      ai_vecchia: !!ai?.quote && quoteCambiate(ai.quote, ora),
      pro_vecchia: !!pro?.quote && quoteCambiate(pro.quote, ora),
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
