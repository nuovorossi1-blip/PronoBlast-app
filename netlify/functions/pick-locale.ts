import { pgGet, pgGetAll, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { parseResult } from "./lib/marketEval";
import {
  depura, cercaLambda, clusterTeorico, clusterReale, coperturaPattern, perFasce,
  MIN_SIMILI, SOGLIA_MINIMA, PATTERN_LOCALI,
} from "./lib/pickLocale";

/**
 * GET /pick-locale?id=<match>&tol=0.15
 *
 * I sei passi di Rossi su una partita: depura le quote, cerca i lambda,
 * costruisce i due cluster dei risultati attesi (teorico e reale), misura
 * quanto ognuno dei 15 pattern li copre, scarta sotto 1,35 e ordina per fasce
 * di quota.
 *
 * Non tocca il verdetto della fusione ne' il pronostico AI: e' il sostituto
 * dell'euristica rapida, che era una scaletta di soglie fisse senza modello.
 */
const CHIAVI = ["odd_1", "odd_x", "odd_2", "odd_o25", "odd_gg"] as const;

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse({ error: "Manca il parametro id" }, 400);
    const tolIn = Math.max(0.05, Math.min(1, parseFloat(url.searchParams.get("tol") || "0.15") || 0.15));

    const righe = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=*`);
    const match = righe[0];
    if (!match) return jsonResponse({ error: "Partita non trovata" }, 404);
    const odds = rowToOdds(match);

    // PASSO 1
    const fair = depura(odds);
    if (!fair) return jsonResponse({ ok: false, motivo: "Quote 1X2 incomplete: il metodo non si puo' applicare." });

    // PASSO 2
    const lam = cercaLambda(fair);

    // PASSO 3a
    const teo = clusterTeorico(lam.casa, lam.ospite);

    // PASSO 3b — punteggi delle partite con quote simili
    let rea: ReturnType<typeof clusterReale> = [];
    let simili = 0;
    let tolUsata = tolIn;
    const haTutte = CHIAVI.every((k) => typeof (match as any)[k] === "number");
    if (haTutte) {
      const storiche = await pgGetAll(
        `matches?result=not.is.null&select=id,result,${CHIAVI.join(",")}`, "id.asc",
      );
      for (const tol of [tolIn, 0.20, 0.30, 0.40].filter((t, i) => i === 0 || t > tolIn)) {
        const vicine = storiche.filter((r: any) =>
          r.id !== match.id && CHIAVI.every((k) => typeof r[k] === "number" && Math.abs((match as any)[k] - r[k]) <= tol));
        tolUsata = tol;
        if (vicine.length >= MIN_SIMILI) {
          const punteggi = vicine.map((r: any) => parseResult(r.result)).filter(Boolean) as [number, number][];
          simili = punteggi.length;
          rea = clusterReale(punteggi);
          break;
        }
        simili = vicine.length;
      }
    }

    // PASSI 4, 5, 6
    const voci = coperturaPattern(odds, teo, rea);
    const fasce = perFasce(voci);
    const ammessi = voci.filter((v) => v.ammesso).sort((a, b) => (b.reale_clu ?? b.teorico_clu) - (a.reale_clu ?? a.teorico_clu));

    return jsonResponse({
      ok: true,
      partita: `${match.squadra1} - ${match.squadra2}`,
      soglia: SOGLIA_MINIMA,
      passo1_depurate: {
        "1": Math.round(fair.p1 * 1000) / 10, X: Math.round(fair.pX * 1000) / 10, "2": Math.round(fair.p2 * 1000) / 10,
        "O1.5": Math.round(fair.o15 * 1000) / 10, "O2.5": Math.round(fair.o25 * 1000) / 10,
        "O3.5": Math.round(fair.o35 * 1000) / 10, GG: Math.round(fair.gg * 1000) / 10,
        aggio_1x2: Math.round(fair.aggio1x2 * 1000) / 10,
      },
      passo2_lambda: { casa: lam.casa, ospite: lam.ospite, totale: Math.round((lam.casa + lam.ospite) * 100) / 100, errore: lam.errore },
      passo3_cluster_teorico: { risultati: teo.length, massa: Math.round(teo.reduce((s, v) => s + v.pct, 0) * 1000) / 10, voci: teo.map((v) => ({ ...v, pct: Math.round(v.pct * 1000) / 10 })) },
      passo3_cluster_reale: rea.length
        ? { risultati: rea.length, partite_simili: simili, tolleranza: tolUsata, voci: rea.map((v) => ({ ...v, pct: Math.round(v.pct * 1000) / 10 })) }
        : { risultati: 0, partite_simili: simili, tolleranza: tolUsata, motivo: `Meno di ${MIN_SIMILI} partite con quote simili: si usa il solo cluster teorico.` },
      passo4_copertura: voci,
      passo5_scartati: voci.filter((v) => !v.ammesso).map((v) => ({ pattern: v.pattern, quota: v.quota, motivo: v.motivo_scarto })),
      passo6_per_fascia: fasce,
      pick: ammessi[0] || null,
      pattern_considerati: PATTERN_LOCALI.length,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
