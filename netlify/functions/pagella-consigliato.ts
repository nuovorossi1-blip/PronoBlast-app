import { pgGet, pgGetAll, jsonResponse } from "./lib/supabaseRest";
import { esitoMercato } from "../../frontend/src/api";

/**
 * GET /pagella-consigliato — STIAMO ANDANDO NELLA DIREZIONE GIUSTA?
 * (07/10/2026, Rossi: "fra 2-3 settimane vediamo nella pagella").
 *
 * Sola lettura, sulle partite FINITE che hanno i dati salvati dal 07/10
 * (`dossier_web.numeri`): il consigliato e' congelato al calcio d'inizio (dopo
 * nessuno lo ricalcola), cosi' si misura cio' che l'app diceva PRIMA.
 *  1. Consigliato: vinte, perse, resa con la sua quota.
 *  2. Cambi del Pronostico AI: chi aveva ragione, l'AI o i numeri.
 *  3. Partite "da lasciare": la giocata che si sarebbe fatta, avrebbe vinto?
 *  4. Lettura AI gratis e Pronostico AI: direzione, gol totali, risultato.
 *  5. Multiple messe in Schedina dalla multipla.
 */
type Conto = { n: number; vinte: number; resa: number | null };
const conto = (): Conto & { _q: number; _nq: number } => ({ n: 0, vinte: 0, resa: null, _q: 0, _nq: 0 });

export default async (_req: Request): Promise<Response> => {
  try {
    const dossier: any[] = await pgGetAll("dossier_web?select=match_id,numeri&numeri->consigliato=not.is.null", "match_id.asc");
    const ids = dossier.map((d) => d.match_id);
    const partite: Record<string, any> = {};
    for (let i = 0; i < ids.length; i += 80) {
      const pezzo = ids.slice(i, i + 80).map((x) => `"${x}"`).join(",");
      for (const m of await pgGet(`matches?id=in.(${pezzo})&result=not.is.null&select=id,day,squadra1,squadra2,result`)) partite[m.id] = m;
    }
    const esito = (m: string | null | undefined, r: string) => (m ? esitoMercato(m, r) : null);
    const segna = (c: ReturnType<typeof conto>, e: string | null, quota?: number | null) => {
      if (e !== "vinta" && e !== "persa") return;
      c.n++;
      if (e === "vinta") c.vinte++;
      if (quota) { c._nq++; if (e === "vinta") c._q += quota; }
    };
    const cons = conto(), confermati = conto(), lasciate = conto();
    const cambi = { n: 0, ai_vinte: 0, numeri_vinte: 0, esempi: [] as string[] };
    const letture: Record<string, { n: number; dir_date: number; dir_ok: number; tot_ok: number; ris_ok: number }> = {};
    const leggi = (chi: string, l: any, h: number, a: number) => {
      if (!l) return;
      const x = letture[chi] ||= { n: 0, dir_date: 0, dir_ok: 0, tot_ok: 0, ris_ok: 0 };
      x.n++;
      const vinc = h > a ? "1" : h === a ? "X" : "2";
      if (["1", "X", "2"].includes(String(l.direzione))) { x.dir_date++; if (l.direzione === vinc) x.dir_ok++; }
      const r = String(l.gol_totali || "").split("-").map(Number);
      if (r.length === 2 && r[0] <= h + a && h + a <= r[1]) x.tot_ok++;
      if ((l.risultati_probabili || []).map((s: string) => s.replace(/\s/g, "")).includes(`${h}-${a}`)) x.ris_ok++;
    };
    let partiteMisurate = 0;
    for (const d of dossier) {
      const m = partite[d.match_id];
      if (!m) continue;
      const r = String(m.result);
      const [h, a] = r.split("-").map(Number);
      if (isNaN(h) || isNaN(a)) continue;
      partiteMisurate++;
      const c = d.numeri.consigliato;
      if (c.market) {
        segna(cons, esito(c.market, r), c.quota);
        if (c.ai === "confermato") segna(confermati, esito(c.market, r), c.quota);
        if (c.ai === "cambiato" && c.numeri_market) {
          const eAi = esito(c.market, r), eNum = esito(c.numeri_market, r);
          if ((eAi === "vinta" || eAi === "persa") && (eNum === "vinta" || eNum === "persa")) {
            cambi.n++;
            if (eAi === "vinta") cambi.ai_vinte++;
            if (eNum === "vinta") cambi.numeri_vinte++;
            if (cambi.esempi.length < 10) cambi.esempi.push(`${m.squadra1}-${m.squadra2} ${r}: AI ${c.market} ${eAi === "vinta" ? "✓" : "✗"}, numeri ${c.numeri_market} ${eNum === "vinta" ? "✓" : "✗"}`);
          }
        }
      }
      if (c.daLasciare && c.lasciata_market) segna(lasciate, esito(c.lasciata_market, r), c.lasciata_quota);
      leggi("Lettura AI gratis", d.numeri.lettura_ai, h, a);
      if (d.numeri.lettura_pro) leggi(`Pronostico AI · ${String(d.numeri.lettura_pro.modello || "").replace(" (OpenRouter)", "")}`, d.numeri.lettura_pro, h, a);
    }
    // Multiple messe in Schedina
    const multiple = { n: 0, vinte: 0, finite: 0, quote_vinte: [] as number[] };
    try {
      const st = (await pgGet("settings?key=eq.multiple_giocate&select=value"))[0]?.value || [];
      const tutteGambe = Array.from(new Set(st.flatMap((x: any) => x.legs.map((l: any) => l.match_id))));
      const risultati: Record<string, string> = {};
      for (let i = 0; i < tutteGambe.length; i += 80) {
        const pezzo = tutteGambe.slice(i, i + 80).map((x) => `"${x}"`).join(",");
        for (const m of await pgGet(`matches?id=in.(${pezzo})&result=not.is.null&select=id,result`)) risultati[m.id] = m.result;
      }
      for (const mu of st) {
        multiple.n++;
        if (!mu.legs.every((l: any) => risultati[l.match_id])) continue;
        multiple.finite++;
        if (mu.legs.every((l: any) => esitoMercato(l.market, risultati[l.match_id]) === "vinta")) { multiple.vinte++; multiple.quote_vinte.push(mu.total_odd); }
      }
    } catch (e) {
      console.error("[pagella-consigliato] multiple", e);
    }
    const fine = (c: ReturnType<typeof conto>): Conto => ({ n: c.n, vinte: c.vinte, resa: c._nq ? Math.round(((c._q - c._nq) / c._nq) * 1000) / 10 : null });
    return jsonResponse({
      partite_misurate: partiteMisurate,
      consigliato: fine(cons),
      confermati_ai: fine(confermati),
      cambi_ai: cambi,
      da_lasciare: fine(lasciate),
      letture,
      multiple,
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 502);
  }
};
