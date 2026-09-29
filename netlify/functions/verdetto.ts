import { pgGetAll, pgGet, jsonResponse } from "./lib/supabaseRest";
import { verdettoDiPartita } from "./lib/verdettoServer";
import { readMinOdd } from "./odd-settings";

/**
 * GET /verdetto?id=<match>            un singolo verdetto
 * GET /verdetto?day=YYYY-MM-DD        tutta la giornata, e li salva
 * &dry=1 per calcolare senza scrivere.
 *
 * Fase 0 del piano "verdetto trasparente": ogni partita deve avere il suo
 * `pick_finale` senza che Rossi debba aprire la scheda. Finora il verdetto
 * nasceva solo nel telefono, e la lista mostrava un pick diverso.
 */
export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const day = url.searchParams.get("day");
    const dry = url.searchParams.get("dry") === "1";
    if (!id && !day) return jsonResponse({ error: "Serve id oppure day" }, 400);

    const minOdd = await readMinOdd().catch(() => 1.4);

    if (id) {
      const righe = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=*`);
      if (!righe.length) return jsonResponse({ error: "Partita non trovata" }, 404);
      const out = await verdettoDiPartita(righe[0], minOdd, !dry);
      return jsonResponse({ ok: true, minOdd, ...out });
    }

    // Giornata intera: solo le partite senza risultato e senza pick salvato,
    // per non rifare lavoro gia' fatto a ogni apertura della lista.
    const righe = await pgGetAll(
      `matches?day=eq.${day}&result=is.null&select=*`, "time.asc",
    );
    const daFare = righe.filter((r: any) => !r.pick_finale);
    let calcolati = 0, salvati = 0, senzaPick = 0;
    const errori: string[] = [];
    for (const m of daFare) {
      try {
        const e = await verdettoDiPartita(m, minOdd, !dry);
        calcolati++;
        if (e.salvato) salvati++;
        if (!e.pick) senzaPick++;
      } catch (err: any) {
        if (errori.length < 5) errori.push(`${m.id}: ${String(err?.message).slice(0, 80)}`);
      }
    }
    return jsonResponse({
      ok: true, giorno: day, minOdd, prova: dry,
      partite_del_giorno: righe.length,
      gia_con_verdetto: righe.length - daFare.length,
      calcolati, salvati, senza_pick: senzaPick, errori,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
