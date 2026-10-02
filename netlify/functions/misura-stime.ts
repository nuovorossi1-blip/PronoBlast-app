import { pgGetAll, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { deriveLambdas, quotaXoppureGG, type Odds } from "./lib/clusterEngine";
import {
  stimaBivariata, eventi, mercatiDaParametri, targetNormalizzati, MERCATI_BIVARIATA,
  type QuoteBivariata, type IdMercato,
} from "./lib/bivariata";

/**
 * GET /misura-stime?from=0&limit=400
 *
 * MISURA DELLE STIME DELLE QUOTE (round 2, TICKET 6, primo tempo). SOLA
 * LETTURA: nessuna scrittura, nessun cambio al motore o alla scheda.
 *
 * Confronta, sulle partite concluse con tutte le 11 quote, il motore dell'app
 * (Poisson INDIPENDENTE a 2 parametri, `deriveLambdas`) con il metodo del
 * proprietario (Poisson BIVARIATA a 3 parametri, lib/bivariata.ts, che
 * riproduce il benchmark del documento ISTRUZIONI_LLM_QUOTE_CALCIO.md).
 *
 * Due tabelle, tenute separate come chiede il documento (sezione 9):
 *  (a) FEDELTA' AI PREZZI: scarto fra le 7 probabilita' del modello e quelle
 *      normalizzate del bookmaker (1, X, 2, U1.5, U2.5, U3.5, GG).
 *  (b) RISULTATI: per i 12 mercati che il bookmaker non prezza, probabilita'
 *      media di ciascun modello contro la frequenza reale, con n dichiarato.
 *
 * Per l'app si usano le stesse formule con c = 0 (e' esattamente la Poisson
 * indipendente) sui lambda di `deriveLambdas`; per "X oppure GG" la
 * probabilita' implicita della SUA quota, che e' una regola di prezzo
 * (quota GG x 0,90), non P(GG) + P(0-0).
 *
 * ATTENZIONE nel leggere (b): per distinguere due stime che differiscono di
 * 1,5 punti su un mercato al 60% servono ~16.600 partite per metodo. Scarti
 * sotto i ~5 punti fra i due modelli NON sono risolvibili con l'archivio di
 * oggi: questa tabella li mostra, non li giudica.
 *
 * Sono escluse le partite senza tutte le 11 quote e quelle con Under
 * normalizzati non crescenti (il documento dice di fermarsi, non di stimare).
 * A blocchi come /backtest: il client cicla su `prossimo` e somma i campi
 * `somma_*` e i conteggi.
 */

const MAX_BLOCCO = 500;

function quoteBivariata(o: Odds): QuoteBivariata | null {
  const n = (k: string) => (typeof o[k] === "number" && (o[k] as number) > 1 ? (o[k] as number) : null);
  const q = {
    q1: n("odd_1"), qx: n("odd_X"), q2: n("odd_2"),
    u15: n("odd_U15"), o15: n("odd_O15"), u25: n("odd_U25"), o25: n("odd_O25"),
    u35: n("odd_U35"), o35: n("odd_O35"), gg: n("odd_GG"), ng: n("odd_NG"),
  };
  return Object.values(q).every((x) => x !== null) ? (q as QuoteBivariata) : null;
}

type Fedelta = { coppie: number; somma_quadrati: number; massimo_pp: number };
type Mercato = { n: number; vinte: number; somma_p_app: number; somma_p_bivariata: number };

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const from = Math.max(0, parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const limit = Math.max(1, Math.min(MAX_BLOCCO, parseInt(url.searchParams.get("limit") || "400", 10) || 400));

    const righe = await pgGetAll(
      "matches?result=not.is.null&select=id,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
      "id.asc",
    );
    const totale = righe.length;
    const fetta = righe.slice(from, from + limit);

    const fedelta: Record<"app" | "bivariata", Fedelta> = {
      app: { coppie: 0, somma_quadrati: 0, massimo_pp: 0 },
      bivariata: { coppie: 0, somma_quadrati: 0, massimo_pp: 0 },
    };
    const mercati = {} as Record<IdMercato, Mercato>;
    for (const m of MERCATI_BIVARIATA) mercati[m.id] = { n: 0, vinte: 0, somma_p_app: 0, somma_p_bivariata: 0 };
    let esaminate = 0, senzaQuote = 0, scartate = 0;

    const accumula = (f: Fedelta, modello: number[], target: number[]) => {
      for (let i = 0; i < target.length; i++) {
        const d = modello[i] - target[i];
        f.coppie++;
        f.somma_quadrati += d * d;
        f.massimo_pp = Math.max(f.massimo_pp, Math.abs(d) * 100);
      }
    };

    for (const r of fetta) {
      const gol = String(r.result || "").split("-").map((x) => parseInt(x.trim(), 10));
      if (gol.length !== 2 || gol.some((x) => isNaN(x))) { scartate++; continue; }
      const odds = rowToOdds(r) as Odds;
      const q = quoteBivariata(odds);
      if (!q) { senzaQuote++; continue; }
      const target = targetNormalizzati(q);
      if (!target) { scartate++; continue; }
      let biv;
      try {
        biv = stimaBivariata(q);
      } catch (e) {
        console.error("[misura-stime] bivariata", r.id, e);
        biv = null;
      }
      if (!biv) { scartate++; continue; }
      esaminate++;

      // Motore dell'app: lambda cercati, Poisson indipendente (c = 0).
      const [lh, la] = deriveLambdas(odds);
      accumula(fedelta.app, eventi(lh, la, 0), target);
      accumula(fedelta.bivariata, biv.modello, target);

      const pApp = mercatiDaParametri(lh, la, 0);
      // "X oppure GG" nell'app e' un PREZZO (quota GG x 0,90): la sua
      // probabilita' implicita, tolto l'aggio 1X2 come fa estimateMarketOdd.
      const xg = quotaXoppureGG(odds);
      const aggio = 1 / q.q1 + 1 / q.qx + 1 / q.q2;
      pApp.X_OR_GG = xg ? 1 / (xg * aggio) : pApp.X_OR_GG;

      for (const m of MERCATI_BIVARIATA) {
        const c = mercati[m.id];
        c.n++;
        if (m.vince(gol[0], gol[1])) c.vinte++;
        c.somma_p_app += pApp[m.id];
        c.somma_p_bivariata += biv.mercati[m.id];
      }
    }

    const pp = (x: number) => Math.round(x * 1000) / 10;
    const prossimo = from + fetta.length;
    return jsonResponse({
      ok: true,
      totale_concluse: totale,
      da: from, elaborate: fetta.length,
      prossimo: prossimo < totale ? prossimo : null,
      finito: prossimo >= totale,
      esaminate, senza_tutte_le_quote: senzaQuote, scartate,
      // (a) fedelta' ai prezzi del book: somme da accumulare + RMSE del blocco
      fedelta_prezzi: Object.fromEntries(Object.entries(fedelta).map(([k, f]) => [k, {
        ...f,
        rmse_pp: f.coppie ? Math.round(Math.sqrt(f.somma_quadrati / f.coppie) * 10000) / 100 : null,
        massimo_pp: Math.round(f.massimo_pp * 100) / 100,
      }])),
      // (b) mercati che il book non prezza: frequenza reale contro le due stime
      mercati: Object.fromEntries(MERCATI_BIVARIATA.map((m) => {
        const c = mercati[m.id];
        return [m.app, {
          ...c,
          reale_pct: c.n ? pp(c.vinte / c.n) : null,
          app_pct: c.n ? pp(c.somma_p_app / c.n) : null,
          bivariata_pct: c.n ? pp(c.somma_p_bivariata / c.n) : null,
        }];
      })),
    });
  } catch (e: any) {
    console.error("[misura-stime]", e);
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
