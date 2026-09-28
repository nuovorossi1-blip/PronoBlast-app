import { pgGetAll, jsonResponse } from "./lib/supabaseRest";

/**
 * GET /af-probe
 * Sonda temporanea (28/09/2026), due domande prima che Rossi paghi il piano Pro:
 *  1. API-Football restituisce gli EXPECTED GOALS fra le statistiche partita?
 *     Nella documentazione pubblica non compaiono, ma va verificato sul campo.
 *  2. Per i SUOI campionati (non per la Premier) esistono davvero formazioni,
 *     infortuni e statistiche? L'abbonamento sblocca il volume, non fa comparire
 *     dati che nessuno raccoglie.
 * Da togliere quando la decisione e' presa.
 */
const BASE = "https://v3.football.api-sports.io";

async function af(path: string, key: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default async (): Promise<Response> => {
  const key = (process.env.APIFOOTBALL_KEY || "").trim();
  if (!key) return jsonResponse({ errore: "chiave assente" }, 400);
  const out: any = { xg: null, copertura: [], campionati_piu_frequenti: [] };

  // --- 1. xG nelle statistiche di una partita conclusa di Serie A ---
  try {
    const ieri = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const fx = await af(`/fixtures?date=${ieri}&status=FT`, key);
    const primo = (fx?.response || [])[0];
    if (!primo) out.xg = { esito: "nessuna partita conclusa da provare" };
    else {
      const st = await af(`/fixtures/statistics?fixture=${primo.fixture.id}`, key);
      const tipi = new Set<string>();
      for (const squadra of st?.response || []) {
        for (const s of squadra?.statistics || []) tipi.add(String(s.type));
      }
      out.xg = {
        partita: `${primo.teams?.home?.name} - ${primo.teams?.away?.name}`,
        tipi_disponibili: [...tipi],
        expected_goals_presente: [...tipi].some((t) => /expected/i.test(t)),
      };
    }
  } catch (e: any) {
    out.xg = { errore: String(e?.message) };
  }

  // --- 2. copertura dei campionati piu' frequenti di Rossi ---
  try {
    const righe = await pgGetAll("matches?select=manifestazione", "id.asc");
    const conta = new Map<string, number>();
    for (const r of righe) {
      const k = String(r.manifestazione || "").trim();
      if (k) conta.set(k, (conta.get(k) || 0) + 1);
    }
    const top = [...conta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    out.campionati_piu_frequenti = top.map(([c, n]) => ({ campionato: c, partite: n }));

    // La copertura si legge su /leagues: l'oggetto `coverage` dice, stagione per
    // stagione, cosa esiste davvero.
    const leghe = await af(`/leagues?current=true`, key);
    const elenco = (leghe?.response || []).map((l: any) => {
      const s = (l.seasons || []).find((x: any) => x.current) || (l.seasons || [])[0];
      return {
        nome: `${l.country?.name} - ${l.league?.name}`,
        formazioni: !!s?.coverage?.fixtures?.lineups,
        statistiche: !!s?.coverage?.fixtures?.statistics_fixtures,
        infortuni: !!s?.coverage?.injuries,
        pronostici: !!s?.coverage?.predictions,
      };
    });
    out.leghe_totali = elenco.length;
    out.con_formazioni = elenco.filter((x: any) => x.formazioni).length;
    out.con_infortuni = elenco.filter((x: any) => x.infortuni).length;
    out.con_statistiche = elenco.filter((x: any) => x.statistiche).length;
    out.esempi = elenco.slice(0, 5);
  } catch (e: any) {
    out.copertura = { errore: String(e?.message) };
  }
  return jsonResponse(out);
};
