import { pgGet, pgGetAll, jsonResponse } from "./lib/supabaseRest";
import { parseResult } from "./lib/marketEval";
import { evaluateMarketStrict, isVerdictMarket, CANDIDATE_MARKETS } from "./lib/clusterEngine";

/**
 * GET /similar-odds?id=<match>&tol=0.15
 *
 * "Partendo da queste quote, nelle partite passate con quote vicine com'e'
 * andata a finire?"
 *
 * Le cinque quote si confrontano INSIEME, in blocco: 1, X, 2, Over 2.5 e GG
 * devono cadere tutte dentro la tolleranza. Confrontarle una alla volta darebbe
 * partite che somigliano su un aspetto e non sull'altro, cioe' niente.
 *
 * PERCHE' SOLO ORA (27/09/2026). Misurato prima che Rossi caricasse i suoi
 * risultati: con 432 partite concluse il 76% non trovava nemmeno UNA partita
 * simile, mediana zero. Con 7.855 la mediana e' 52. La stessa funzione, un mese
 * fa, avrebbe restituito quasi sempre il vuoto.
 *
 * ALLARGAMENTO AUTOMATICO: se alla tolleranza chiesta le partite simili sono
 * meno di 20, si riprova piu' larghi. Una percentuale su 4 partite non e'
 * un'informazione, e' rumore travestito da numero: meglio dire "ho dovuto
 * allargare a 0,30" che stampare "75% (3 su 4)".
 */

const CHIAVI = ["odd_1", "odd_x", "odd_2", "odd_o25", "odd_gg"] as const;
const MIN_CAMPIONE = 20;
const SCALA = [0.15, 0.20, 0.30, 0.40];

type Riga = Record<string, any>;

function vicina(a: Riga, b: Riga, tol: number): boolean {
  for (const k of CHIAVI) {
    const x = a[k], y = b[k];
    if (typeof x !== "number" || typeof y !== "number") return false;
    if (Math.abs(x - y) > tol) return false;
  }
  return true;
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse({ error: "Manca il parametro id" }, 400);
    const tolChiesta = Math.max(0.05, Math.min(1, parseFloat(url.searchParams.get("tol") || "0.15") || 0.15));

    const righe = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=id,squadra1,squadra2,${CHIAVI.join(",")}`);
    const partita = righe[0];
    if (!partita) return jsonResponse({ error: "Partita non trovata" }, 404);
    if (CHIAVI.some((k) => typeof partita[k] !== "number")) {
      return jsonResponse({ ok: false, motivo: "Questa partita non ha tutte e cinque le quote: il confronto non si puo' fare." });
    }

    const storiche = await pgGetAll(
      `matches?result=not.is.null&select=id,result,manifestazione,${CHIAVI.join(",")}`,
      "id.asc",
    );

    // Si parte dalla tolleranza chiesta e si allarga solo se serve.
    const scala = [tolChiesta, ...SCALA.filter((t) => t > tolChiesta)];
    let simili: Riga[] = [];
    let tolUsata = tolChiesta;
    for (const tol of scala) {
      simili = storiche.filter((r: Riga) => r.id !== partita.id && vicina(partita, r, tol));
      tolUsata = tol;
      if (simili.length >= MIN_CAMPIONE) break;
    }

    if (simili.length < MIN_CAMPIONE) {
      return jsonResponse({
        ok: false,
        motivo: `Anche allargando a ±${tolUsata.toFixed(2)} ho trovato solo ${simili.length} partite con quote simili: troppo poche per dire qualcosa.`,
        partite_simili: simili.length,
        tolleranza: tolUsata,
        storico_totale: storiche.length,
      });
    }

    // Esiti veri, mercato per mercato. Si guardano tutti i mercati del catalogo,
    // non solo quelli giocabili: sapere che U3.5 esce l'80% delle volte serve a
    // leggere la partita anche se U3.5 non e' fra i mercati che Rossi gioca.
    const esiti: { casa: number; ospite: number }[] = [];
    for (const r of simili) {
      const p = parseResult(r.result);
      if (p) esiti.push({ casa: p[0], ospite: p[1] });
    }

    const mercati = CANDIDATE_MARKETS.map((m) => {
      let vinte = 0, valutate = 0;
      for (const e of esiti) {
        const ok = evaluateMarketStrict(m, e.casa, e.ospite);
        if (ok === null) continue;
        valutate++;
        if (ok) vinte++;
      }
      return {
        market: m,
        giocabile: isVerdictMarket(m),
        vinte, valutate,
        pct: valutate ? Math.round((vinte / valutate) * 1000) / 10 : null,
      };
    })
      .filter((x) => x.valutate >= MIN_CAMPIONE)
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

    // Punteggi piu' frequenti: dicono a colpo d'occhio che partita e' stata.
    const conta = new Map<string, number>();
    for (const e of esiti) {
      const k = `${e.casa}-${e.ospite}`;
      conta.set(k, (conta.get(k) || 0) + 1);
    }
    const punteggi = [...conta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([punteggio, n]) => ({ punteggio, volte: n, pct: Math.round((n / esiti.length) * 1000) / 10 }));

    const gol = esiti.reduce((s, e) => s + e.casa + e.ospite, 0) / (esiti.length || 1);

    return jsonResponse({
      ok: true,
      partita: { id: partita.id, squadre: `${partita.squadra1} - ${partita.squadra2}` },
      quote: Object.fromEntries(CHIAVI.map((k) => [k, partita[k]])),
      tolleranza: tolUsata,
      allargata: tolUsata > tolChiesta,
      partite_simili: esiti.length,
      storico_totale: storiche.length,
      media_gol: Math.round(gol * 100) / 100,
      punteggi_frequenti: punteggi,
      mercati,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 502);
  }
};
