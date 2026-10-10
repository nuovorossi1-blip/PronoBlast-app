import { pgGet, jsonResponse } from "./lib/supabaseRest";
import { calcolaVerdettiGiornata, precalcolaVerdetti } from "./lib/verdettiGiornata";
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

    // Giornata intera (10/10/2026): i verdetti si calcolano in anticipo sul
    // server (lib/verdettiGiornata.ts). Aprire la home non deve aspettarli:
    // si avvia il giro in sottofondo e si risponde subito. Con attendi=1, con
    // dry=1 o su Vercel (dove il lavoro in sottofondo verrebbe interrotto)
    // si calcola e si risponde alla fine, come prima.
    if (dry || url.searchParams.get("attendi") === "1" || process.env.VERCEL) {
      const e = await calcolaVerdettiGiornata(day!, dry);
      return jsonResponse({ ok: true, prova: dry, ...e });
    }
    void precalcolaVerdetti(`richiesta ${day}`, [day!]);
    return jsonResponse({ ok: true, giorno: day, in_sottofondo: true, calcolati: 0, salvati: 0, senza_pick: 0 });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
