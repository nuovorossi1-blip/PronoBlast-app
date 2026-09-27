import { pgGetAll, jsonResponse } from "./lib/supabaseRest";

/**
 * GET /pending-matches
 *
 * Le partite GIA' GIOCATE che nel database non hanno ancora un risultato.
 * Serve a due cose, entrambe nella sezione MANUTENZIONE di Strumenti:
 *  - dare l'elenco di id al recupero automatico (`/results-fetch`);
 *  - costruire il foglio Excel che Rossi compila a mano.
 *
 * Perche' esiste (27/09/2026): nel database c'erano 11.997 partite ma solo 432
 * concluse. Tutte le altre avevano le quote e nessun esito, quindi non
 * insegnavano niente al motore e lo storico per quote simili era inutilizzabile
 * (con 432 partite, tre quarti non trovano nemmeno una partita simile).
 *
 * Solo partite con data ANTERIORE a oggi: quelle di oggi o future non sono
 * ancora finite e non avrebbe senso chiederne il risultato.
 *
 * `?count=1` restituisce solo il conteggio, senza le righe: serve a scrivere
 * sul tasto quante partite verranno toccate prima che Rossi lo prema.
 */

const QUOTE = [
  "odd_1", "odd_x", "odd_2", "odd_1x", "odd_x2", "odd_12",
  "odd_u15", "odd_o15", "odd_u25", "odd_o25", "odd_u35", "odd_o35",
  "odd_gg", "odd_ng",
];

/** Oggi a Roma, in formato YYYY-MM-DD. */
function oggiRoma(): string {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return f.format(new Date());
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const soloConteggio = url.searchParams.get("count") === "1";
    const oggi = oggiRoma();

    const rows = await pgGetAll(
      `matches?result=is.null&day=lt.${oggi}&select=id,day,time,manifestazione,squadra1,squadra2,${QUOTE.join(",")}`,
      "day.asc,time.asc",
    );

    if (soloConteggio) {
      const perMese: Record<string, number> = {};
      for (const r of rows) {
        const k = String(r.day || "").slice(0, 7);
        perMese[k] = (perMese[k] || 0) + 1;
      }
      return jsonResponse({
        da_completare: rows.length,
        prima_data: rows.length ? rows[0].day : null,
        ultima_data: rows.length ? rows[rows.length - 1].day : null,
        per_mese: Object.fromEntries(Object.entries(perMese).sort()),
      });
    }

    return jsonResponse({ da_completare: rows.length, oggi, matches: rows });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
