import { pgGetAll, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { classifyFamily, VERDICT_WHITELIST, isVerdictMarket, type Odds } from "./lib/clusterEngine";
import { esitoMercato, FASCE_AI, chiaveFascia, type EsitoMercato } from "../../frontend/src/api";
import { verdettoRicalcolato, applicaRisultato, type StoricoCronologico, type VarianteFusione } from "./ricalcolo";

/**
 * GET /backtest-fusione?from=0&limit=400&minOdd=1.40&split=AAAA-MM-GG&variante=base
 *
 * BACKTEST DELLA FUSIONE (round 2, TICKET 3). SOLA LETTURA: nessuna scrittura,
 * ne' su `matches` ne' su `settings`.
 *
 * /backtest rigioca solo il motore. Quello che decide davvero e' la fusione
 * (`buildFinalVerdict`), e finora nessuno l'aveva mai rigiocata: ogni giudizio
 * su di lei si appoggiava ai verdetti congelati, presi sotto regole vecchie.
 * Qui si rigioca il codice di OGGI su tutte le partite concluse:
 *   structuralAnalysis -> preHeuristicRanking -> buildFinalVerdict (con i
 *   mercati del manuale dello scenario) -> esito.
 *
 * Il verdetto di una partita e' quello di `verdettoRicalcolato` (ricalcolo.ts):
 * la stessa funzione del "Ricalcolo storico", non una copia. Quindi valgono le
 * sue regole: niente pronostico AI (rigenerarlo oggi sarebbe contaminato dal
 * risultato) e SENZA SBIRCIARE IL FUTURO — correzione per scenario e misura del
 * manuale contano solo le partite precedenti, in ordine di data.
 *
 * Per non scrivere uno stato fra un blocco e l'altro, ogni blocco ricostruisce
 * lo storico delle partite che lo precedono (solo conteggi, pochi ms a partita)
 * e poi rigioca le sue. Due chiamate sugli stessi indici esaminano quindi le
 * stesse partite qualunque sia la variante.
 *
 * VARIANTI (stesse partite, cambia solo il calcolo):
 *   base            il codice di oggi
 *   no-concordanza  senza il bonus di concordanza nel punteggio (+8 / +4 / +2,5)
 *   archivio-calcolo  la misura d'archivio del manuale entra nel calcolo
 *                   (TICKET 4, spento nell'app: si accende solo se questa
 *                   variante batte "base" e il proprietario decide)
 *
 * L'esito si valuta con `esitoMercato`, come il ricalcolo: conosce anche i
 * mercati del manuale (AH -0,75, X oppure GG, MG casa/ospite).
 *
 * A blocchi come /backtest: il client cicla su `prossimo` e somma.
 */

const MAX_BLOCCO = 500;

const VARIANTI: Record<string, VarianteFusione> = {
  "base": {},
  "no-concordanza": { senzaConcordanza: true },
  "archivio-calcolo": { archivioNelCalcolo: true },
};

type Tasso = { vinte: number; perse: number };

function conta(t: Tasso, e: EsitoMercato | null) {
  if (e === "vinta") t.vinte++;
  else if (e === "persa") t.perse++;
}

/** "2-1" -> [2, 1]; null se illeggibile. */
function punteggio(risultato: string): [number, number] | null {
  const p = risultato.split("-").map((x) => parseInt(x.trim(), 10));
  return p.length === 2 && !p.some((n) => isNaN(n)) ? [p[0], p[1]] : null;
}

/** Partita utilizzabile: risultato leggibile e quote 1X2 presenti. */
function utilizzabile(r: any): { odds: Odds; risultato: string; gol: [number, number] } | null {
  const risultato = String(r.result || "");
  const gol = punteggio(risultato);
  if (!gol) return null;
  const odds = rowToOdds(r) as Odds;
  if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) return null;
  return { odds, risultato, gol };
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const from = Math.max(0, parseInt(url.searchParams.get("from") || "0", 10) || 0);
    const limit = Math.max(1, Math.min(MAX_BLOCCO, parseInt(url.searchParams.get("limit") || "400", 10) || 400));
    const minOdd = parseFloat(url.searchParams.get("minOdd") || "1.40") || 1.4;
    const fasciaPrincipale = FASCE_AI.find((f) => Math.abs(f - minOdd) < 0.001);
    if (fasciaPrincipale === undefined) {
      return jsonResponse({ error: `minOdd deve essere una delle fasce: ${FASCE_AI.map(chiaveFascia).join(", ")}` }, 400);
    }
    const nomeVariante = url.searchParams.get("variante") || "base";
    const variante = VARIANTI[nomeVariante];
    if (!variante) {
      return jsonResponse({ error: `variante sconosciuta: ${nomeVariante} (ammesse: ${Object.keys(VARIANTI).join(", ")})` }, 400);
    }
    const split = url.searchParams.get("split") || "";

    // Ordine di DATA (e ora), poi id: come il ricalcolo. E' il cuore della
    // regola "senza sbirciare il futuro".
    const righe = await pgGetAll(
      "matches?result=not.is.null&select=id,day,time,result,odd_1,odd_x,odd_2,odd_1x,odd_x2,odd_12,odd_u15,odd_o15,odd_u25,odd_o25,odd_u35,odd_o35,odd_gg,odd_ng",
      "day.asc,time.asc,id.asc",
    );
    // Con la divisione temporale si MISURA solo dopo la data indicata; lo
    // storico pero' comprende anche le partite prima (sono il passato).
    const inizioMisura = split ? righe.findIndex((r: any) => String(r.day || "") > split) : 0;
    const misurabili = inizioMisura < 0 ? [] : righe.slice(inizioMisura);
    const totale = misurabili.length;
    const fetta = misurabili.slice(from, from + limit);

    // Storico cronologico di tutte le partite PRIMA del blocco.
    const storico: StoricoCronologico = { scen: {}, man: {} };
    const primaDelBlocco = (inizioMisura < 0 ? righe.length : inizioMisura) + from;
    for (const r of righe.slice(0, primaDelBlocco)) {
      const u = utilizzabile(r);
      if (u) applicaRisultato(storico, u.odds, u.gol[0], u.gol[1], u.risultato);
    }

    const perFascia: Record<string, Tasso & { pick: number; senza_pick: number }> = {};
    for (const f of FASCE_AI) perFascia[chiaveFascia(f)] = { vinte: 0, perse: 0, pick: 0, senza_pick: 0 };
    const kPrinc = chiaveFascia(fasciaPrincipale);
    /** famiglia del motore -> totali (fascia principale) */
    const perFamiglia: Record<string, Tasso & { partite: number; senza_pick: number }> = {};
    /** famiglia -> mercato scelto -> vinte/perse (fascia principale) */
    const pickPerFamiglia: Record<string, Record<string, Tasso & { scelte: number }>> = {};
    /** famiglia -> mercato della whitelist che avrebbe vinto senza essere scelto */
    const occasioni: Record<string, Record<string, number>> = {};
    let esaminate = 0, scartate = 0;

    for (const r of fetta) {
      const u = utilizzabile(r);
      if (!u) { scartate++; continue; }
      let ric;
      try {
        ric = verdettoRicalcolato(u.odds, u.risultato, storico, variante);
      } catch (e) {
        console.error("[backtest-fusione] partita", r.id, e);
        scartate++;
        // Anche se il verdetto fallisce il risultato e' passato: entra nello
        // storico, come farebbe il ricalcolo con la partita successiva.
        applicaRisultato(storico, u.odds, u.gol[0], u.gol[1], u.risultato);
        continue;
      }
      esaminate++;

      for (const f of FASCE_AI) {
        const k = chiaveFascia(f);
        const v = ric.fasce[k];
        if (!v) { perFascia[k].senza_pick++; continue; }
        perFascia[k].pick++;
        conta(perFascia[k], v.esito);
      }

      const famiglia = classifyFamily(u.odds).family || "SCONOSCIUTA";
      const tot = perFamiglia[famiglia] = perFamiglia[famiglia] || { partite: 0, vinte: 0, perse: 0, senza_pick: 0 };
      tot.partite++;
      const pick = ric.fasce[kPrinc];
      if (!pick) tot.senza_pick++;
      else {
        conta(tot, pick.esito);
        const pf = pickPerFamiglia[famiglia] = pickPerFamiglia[famiglia] || {};
        const c = pf[pick.market] = pf[pick.market] || { scelte: 0, vinte: 0, perse: 0 };
        c.scelte++;
        conta(c, pick.esito);
      }
      const occ = occasioni[famiglia] = occasioni[famiglia] || {};
      for (const m of VERDICT_WHITELIST) {
        if (!isVerdictMarket(m)) continue;
        if (pick && m === pick.market) continue;
        if (esitoMercato(m, u.risultato) === "vinta") occ[m] = (occ[m] || 0) + 1;
      }

      // SOLO DOPO, il risultato entra nello storico.
      applicaRisultato(storico, u.odds, u.gol[0], u.gol[1], u.risultato);
    }

    const pct = (t: Tasso) => {
      const n = t.vinte + t.perse;
      return n ? Math.round((t.vinte / n) * 1000) / 10 : null;
    };
    const prossimo = from + fetta.length;
    return jsonResponse({
      ok: true,
      variante: nomeVariante,
      split: split || null,
      minOdd: fasciaPrincipale,
      totale_concluse: totale,
      da: from, elaborate: fetta.length,
      prossimo: prossimo < totale ? prossimo : null,
      finito: prossimo >= totale,
      esaminate, scartate,
      // Fascia principale (minOdd): i numeri da sommare blocco per blocco.
      con_pick: perFascia[kPrinc].pick,
      senza_pick: perFascia[kPrinc].senza_pick,
      vinte: perFascia[kPrinc].vinte,
      perse: perFascia[kPrinc].perse,
      pct: pct(perFascia[kPrinc]),
      per_fascia: Object.fromEntries(Object.entries(perFascia).map(([k, t]) => [k, { ...t, pct: pct(t) }])),
      per_famiglia: perFamiglia,
      pick_per_famiglia: pickPerFamiglia,
      occasioni_perse: occasioni,
    });
  } catch (e: any) {
    console.error("[backtest-fusione]", e);
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
