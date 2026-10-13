/**
 * PROVA DI JEV (TypeSafe, via OpenRouter /api/alpha/decisions) su partite gia'
 * giocate, 13/10/2026. SOLA LETTURA sul DB; costa ~0,00005 $ a partita.
 * Allo stato vengono passati SOLO dati salvati prima del via (quote, forma,
 * frasi del programma, notizie, lettura AI gratis) e i candidati della scheda,
 * SENZA le percentuali d'archivio (con le percentuali Jev le copiava).
 * Domande: "da giocare?" (noul) e "quale candidato vince piu' probabilmente?" (choice).
 *
 * Esito del 13/10 (562 partite): scelta di Jev 63,0% resa -7,8% contro il piu'
 * solido 63,5% -5,8%; probabilita' non calibrate (con l'archivio: "95-100%"
 * vinceva il 63,6%). Non usato nell'app. Rifare con piu' dati.
 *
 * Uso (dalla cartella server-locale; chiave in OR_KEY_JEV, mai stampata):
 *   $env:OR_KEY_JEV = [Environment]::GetEnvironmentVariable("OPENROUTER_KEY_NUOVOROSSI1_GMAIL_COM","User")
 *   npx tsx --env-file=.env ../scripts/prova-jev.mts <quante> <file-uscita.json>
 */
import fs from "node:fs";
import { pgGetAll, pgGet } from "../netlify/functions/lib/supabaseRest";
import { inizioPartitaMs, evaluateMarketOutcome, normalizeMarket } from "../frontend/src/api";
const LIMITE = Number(process.argv[2] || 3), OUT = process.argv[3];
const KEY = process.env.OR_KEY_JEV || "";
if (!KEY) { console.log("chiave assente"); process.exit(1); }
const d = await pgGetAll("dossier_web?select=match_id,numeri", "match_id.asc");
const ids = d.map((x: any) => x.match_id);
const M = new Map<string, any>();
for (let i = 0; i < ids.length; i += 150) for (const m of await pgGet(`matches?id=in.(${ids.slice(i, i + 150).join(",")})&result=not.is.null&select=*`)) M.set(m.id, m);
const casi: any[] = [];
for (const x of d as any[]) {
  const m = M.get(x.match_id); const n = x.numeri || {}; const c = n.consigliato;
  if (!m || !c || !/^\d+-\d+$/.test(String(m.result).trim())) continue;
  const t0 = inizioPartitaMs(m.day, m.time); if (!t0 || !c.quando || Date.parse(c.quando) >= t0) continue;
  const cand = [c.market ? { market: c.market, quota: c.quota, p: c.pA != null ? Math.min(c.pA, c.pB ?? c.pA) : null } : null, ...(c.alternative || []).map((a: any) => ({ market: a.market, quota: a.quota, p: a.p }))]
    .filter((z: any) => z && z.market && z.quota >= 1.4);
  const visti = new Set<string>(); const lista = cand.filter((z: any) => { const k = normalizeMarket(z.market); if (visti.has(k)) return false; visti.add(k); return true; }).slice(0, 6);
  if (lista.length < 2) continue;
  const lettura = n.lettura_ai && n.lettura_ai.quando && Date.parse(n.lettura_ai.quando) < t0 ? n.lettura_ai : null;
  const notizie = (n.notizie_squadre || []).filter((v: any) => !v.data || Date.parse(v.data) < t0).slice(0, 5).map((v: any) => v.titolo || v.title || "").filter(Boolean);
  const state = {
    partita: `${m.squadra1} - ${m.squadra2} (${m.manifestazione}, ${m.day} ${m.time})`,
    quote: { "1": m.odd_1, X: m.odd_x, "2": m.odd_2, "1X": m.odd_1x, X2: m.odd_x2, GG: m.odd_gg, NG: m.odd_ng, "Over 2.5": m.odd_o25, "Under 2.5": m.odd_u25 },
    gol_attesi_dalle_quote: { casa: n.programma?.quote_casa, ospite: n.programma?.quote_ospite },
    gol_attesi_dalla_forma: { casa: n.programma?.forma_casa, ospite: n.programma?.forma_ospite },
    forma_ultime5: { casa: n.forma_casa, ospite: n.forma_ospite },
    programma: n.programma?.frasi || [],
    assenti: { casa: n.assenti_casa, ospite: n.assenti_ospite },
    notizie,
    lettura_ai: lettura ? { direzione: lettura.direzione, gol_totali: lettura.gol_totali, testo: String(lettura.lettura || "").slice(0, 600) } : null,
    candidati: lista.map((z: any) => ({ mercato: z.market, quota: z.quota })),
  };
  casi.push({ m, c, lista, state });
}
console.log("partite utilizzabili", casi.length);
const scelte = casi.slice(0, LIMITE);
const out: any[] = []; let costo = 0, k = 0;
async function una(x: any) {
  const criteria: any = {}; for (const z of x.lista) criteria[z.mercato ?? z.market] = `Giocata ${z.market} a quota ${z.quota}`;
  const body = { model: "typesafe/jev-1.13", state: x.state, questions: {
    gioca: { type: "noul", instructions: "Questa partita di calcio e' da giocare? Si' se fra i candidati c'e' una giocata con buone probabilita' di vincere e coerente con quote, forma e notizie; no se la partita e' incerta o i dati non sono d'accordo.", criteria: { true: "da giocare", false: "da lasciare" } },
    giocata: { type: "choice", instructions: "Fra le giocate candidate, quale ha la probabilita' piu' alta di vincere in questa partita?", criteria },
  } };
  for (let t = 0; t < 4; t++) {
    const r = await fetch("https://openrouter.ai/api/alpha/decisions", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (t + 1))); continue; }
    const j: any = await r.json();
    if (!r.ok) { console.log("errore", r.status, JSON.stringify(j).slice(0, 300)); return; }
    costo += j.usage?.cost || 0;
    const res = String(x.m.result).trim();
    out.push({ id: x.m.id, day: x.m.day, partita: x.state.partita, result: res,
      consigliato: x.c.market ? { market: x.c.market, quota: x.c.quota, ai: x.c.ai, esito: evaluateMarketOutcome(x.c.market, res) } : null,
      daLasciare: x.c.daLasciare || null,
      gioca: j.answers?.gioca?.noul ?? null,
      scelta: j.answers?.giocata?.choice ?? null, confidence: j.answers?.giocata?.confidence ?? null, probabilita: j.answers?.giocata?.probabilities ?? null,
      candidati: x.lista.map((z: any) => ({ ...z, esito: evaluateMarketOutcome(z.market, res) })), usage: j.usage, modello: j.model });
    if (++k % 50 === 0) console.log("fatte", k, "costo", costo.toFixed(4));
    return;
  }
  console.log("rinunciato", x.m.id);
}
const coda = [...scelte];
await Promise.all([0, 1, 2, 3].map(async () => { while (coda.length) { try { await una(coda.shift()); } catch (e: any) { console.log("eccezione", e.message); } } }));
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("FINE", out.length, "costo $", costo.toFixed(5));
if (LIMITE <= 3) for (const o of out) console.log(JSON.stringify({ p: o.partita, r: o.result, gioca: o.gioca, scelta: o.scelta, conf: o.confidence, prob: o.probabilita, usage: o.usage, modello: o.modello }));
process.exit(0);
