import { jsonResponse, pgGet } from "./lib/supabaseRest";
import { datiLettura, generaLetturaAI, letturaDaRifare, quoteCambiate, firmaQuote, consigliatoDi, consigliatoValido, applicaCambioInSchedina } from "./lib/letturaPartita";
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
    // STRADA VELOCE (07/10/2026): lettura del programma e consigliato gia'
    // salvati e quote invariate -> si risponde subito, senza ricalcolare
    // (prima ogni apertura rifaceva forma FotMob e calcoli: qualche secondo
    // senza consigliato). Se le quote sono cambiate si passa al calcolo.
    if (req.method === "GET") {
      try {
        const [m] = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=id,day,time,result,odd_1,odd_x,odd_2,odd_o25,odd_u25,odd_gg,odd_ng`);
        const [d] = m ? await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(id)}&select=numeri`) : [];
        const n = d?.numeri;
        const ora = m ? firmaQuote(m) : null;
        const auto = url.searchParams.get("auto") === "1";
        const inizio = m ? inizioPartitaMs(m.day, m.time) : null;
        const daGiocareV = !!m && !m.result && (inizio === null || inizio > Date.now());
        const pronta = !!n?.programma && !!ora && !quoteCambiate(n.programma.quote, ora) && !!consigliatoValido(n, m);
        const manca = auto && daGiocareV && letturaDaRifare(n, m);
        if (pronta && !manca) {
          const ai = n.lettura_ai ?? null, pro = n.lettura_pro ?? null;
          return jsonResponse({
            programma: n.programma, ai, pro, consigliato: n.consigliato, dossier: true, salvata: true,
            ai_vecchia: !!ai?.quote && quoteCambiate(ai.quote, ora!),
            pro_vecchia: !!pro?.quote && quoteCambiate(pro.quote, ora!),
          });
        }
      } catch { /* si va al calcolo completo */ }
    }
    // Se era richiesto solo il salvato in background (preload), non bloccare il server con fonti esterne
    if (url.searchParams.get("savedOnly") === "1") {
      return jsonResponse({ programma: null, ai: null, pro: null, salvata: false });
    }
    const dati = await datiLettura(id);
    if (!dati) return jsonResponse({ programma: null, ai: null, pro: null });
    let ai = dati.numeri?.lettura_ai ?? null;
    let pro = dati.numeri?.lettura_pro ?? null;
    const inizio = inizioPartitaMs(dati.match.day, dati.match.time);
    const daGiocare = !dati.match.result && (inizio === null || inizio > Date.now());
    if (req.method === "GET" && url.searchParams.get("auto") === "1" && daGiocare && dati.numeri && letturaDaRifare(dati.numeri, dati.match)) {
      ai = (await generaLetturaAI(id, dati)) ?? ai;
    }
    // Il consigliato e la lettura del programma si salvano (anche per partite
    // gia' iniziate: si salvano con le quote della partita, che non cambiano piu').
    let consigliato = dati.numeri ? consigliatoValido(dati.numeri, dati.match) : null;
    if (dati.numeri && (!consigliato || !dati.numeri.programma)) {
      try { consigliato = await consigliatoDi(id, dati); } catch { /* lo rifa' il giro */ }
    }
    if (req.method === "POST" && url.searchParams.get("genera") === "1") {
      if (url.searchParams.get("pro") === "1") {
        if (!daGiocare) return jsonResponse({ error: "Partita gia' iniziata: il pronostico e' bloccato e non si cambia piu'." }, 409);
        pro = await generaLetturaAI(id, dati, { pro: true });
        if (!pro) return jsonResponse({ error: "Il modello scelto non ha dato una lettura valida: riprova o cambia modello in LLM & Budget." }, 502);
        // Il consigliato salvato (schedina, multipla) segue il Pronostico AI.
        try {
          const c = await consigliatoDi(id, { ...dati, numeri: { ...(dati.numeri || {}), lettura_pro: pro } });
          await applicaCambioInSchedina(id, c);
        } catch { /* si rifa' col giro */ }
      } else {
        ai = (await generaLetturaAI(id, dati)) ?? ai;
        if (!ai) return jsonResponse({ error: "I modelli gratis non hanno risposto (sovraccarichi o limite del giorno): riprova fra poco." }, 502);
      }
    }
    const { testo: _t, ...programma } = dati.programma;
    const ora = firmaQuote(dati.match);
    return jsonResponse({
      programma, ai, pro, consigliato, dossier: !!dati.numeri,
      // Le letture fatte prima del 07/10 non hanno le quote salvate: non si sa.
      ai_vecchia: !!ai?.quote && quoteCambiate(ai.quote, ora),
      pro_vecchia: !!pro?.quote && quoteCambiate(pro.quote, ora),
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
