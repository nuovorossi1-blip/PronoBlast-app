import { jsonResponse } from "./lib/supabaseRest";

/**
 * GET /apif-probe
 * Sonda temporanea su API-Football, per rispondere a due domande PRIMA che
 * Rossi paghi i 19 dollari del piano Pro:
 *   1. le statistiche partita contengono davvero gli "expected goals"?
 *   2. i campionati che Rossi ha davvero nel database sono coperti per
 *      formazioni e infortuni, o quei dati non esistono proprio?
 * Da togliere una volta risposto.
 */
const KEY = () => (process.env.APIFOOTBALL_KEY || "").trim();

async function chiama(path: string): Promise<any> {
  const res = await fetch(`https://v3.football.api-sports.io/${path}`, {
    headers: { "x-apisports-key": KEY(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (!KEY()) return jsonResponse({ errore: "chiave assente" }, 500);
  try {
    // 1) statistiche di una partita conclusa: cerchiamo "expected goals"
    if (url.searchParams.get("modo") === "xg") {
      const giorno = url.searchParams.get("giorno") || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const fx = await chiama(`fixtures?date=${giorno}&league=135&season=2026`);   // Serie A
      const prima = (fx?.response || []).find((x: any) => ["FT", "AET", "PEN"].includes(x?.fixture?.status?.short));
      if (!prima) return jsonResponse({ nota: "nessuna partita conclusa di Serie A in quel giorno", giorno, trovate: fx?.response?.length || 0, errors: fx?.errors });
      const st = await chiama(`fixtures/statistics?fixture=${prima.fixture.id}`);
      const tipi = (st?.response?.[0]?.statistics || []).map((s: any) => s.type);
      return jsonResponse({
        partita: `${prima.teams.home.name} - ${prima.teams.away.name}`,
        tipi_statistica: tipi,
        contiene_expected_goals: tipi.some((t: string) => /expected/i.test(String(t))),
        errors: st?.errors,
      });
    }
    // 2) copertura dei campionati: si passano i nomi da cercare
    const cerca = (url.searchParams.get("leghe") || "Serie A,Primera B Metropolitana,National League North").split(",");
    const out: any[] = [];
    for (const nome of cerca) {
      const r = await chiama(`leagues?search=${encodeURIComponent(nome.trim())}`);
      const primo = r?.response?.[0];
      const stag = (primo?.seasons || []).slice(-1)[0];
      out.push({
        cercato: nome.trim(),
        trovato: primo ? `${primo.country?.name} - ${primo.league?.name}` : null,
        stagione: stag?.year,
        copertura: stag?.coverage ? {
          formazioni: stag.coverage.fixtures?.lineups,
          statistiche_partita: stag.coverage.fixtures?.statistics_fixtures,
          infortuni: stag.coverage.injuries,
          pronostici: stag.coverage.predictions,
          quote: stag.coverage.odds,
        } : null,
      });
    }
    return jsonResponse({ leghe: out });
  } catch (e: any) {
    return jsonResponse({ errore: String(e?.message || e) }, 502);
  }
};
