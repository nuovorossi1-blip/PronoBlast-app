import { pgGet, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { fullDistribution, coverageForMarket, quoteCatalogo } from "./lib/clusterEngine";
import { simil } from "./lib/teamMatch";
import { inizioPartitaMs } from "../../frontend/src/api";
import { consigliatoDi } from "./lib/letturaPartita";
import { rigaNotizia, cambioAllenatore } from "./lib/notizieSquadre";
import { esc, SEP } from "./lib/telegramTabella";

/**
 * POST /analisi-partita — la scheda di UNA partita per il bot Telegram
 * (13/10/2026, Rossi: "se gli chiedo Inter Napoli e la vorrei giocare anche
 * se non la mette nella multipla: consigliato, se e' da lasciare e perche',
 * l'alternativa").
 *
 * Body: { testo: "Inter Napoli" | "Inter - Napoli" | "analizza inter vs napoli" }
 * Cerca la partita fra oggi e i prossimi 3 giorni (anche a squadre invertite).
 * Risponde con: consigliato e archivio, partita da lasciare e perche', cosa
 * giocare se la si vuole giocare lo stesso, alternative, motore (1X2, gol),
 * lettura AI, avvisi, notizie. Non scrive niente.
 * Header: X-Schedina-Segreto (come le altre rotte del bot).
 */

const giorno = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d);
const pct = (p: number | null | undefined) => (p == null ? "n/d" : `${Math.round(p * 100)}%`);
const q2 = (q: number | null | undefined) => (q == null ? "n/d" : Number(q).toFixed(2).replace(".", ","));

/** "analizza Inter - Napoli" -> possibili coppie [casa, ospite]. */
function coppie(testo: string): [string, string][] {
  const t = testo.replace(/^\s*\/?(analizza|analisi|partita|scheda|pronostico|consiglio)\s*(di|su|per)?\s*/i, "").replace(/[?!.]+$/, "").trim();
  const sep = t.split(/\s+(?:-|–|vs\.?|v\.?|contro)\s+|\s*-\s*/i).map((x) => x.trim()).filter(Boolean);
  if (sep.length === 2) return [[sep[0], sep[1]]];
  // senza separatore: ogni taglio fra le parole ("Inter Napoli", "Real Madrid Getafe")
  const parole = t.split(/\s+/);
  const out: [string, string][] = [];
  for (let i = 1; i < parole.length; i++) out.push([parole.slice(0, i).join(" "), parole.slice(i).join(" ")]);
  return out;
}

async function trova(testo: string): Promise<{ m: any; punteggio: number } | null> {
  const giorni = [0, 1, 2, 3].map((d) => `"${giorno(new Date(Date.now() + d * 86400000))}"`).join(",");
  const partite: any[] = await pgGet(`matches?day=in.(${giorni})&select=*&order=day.asc,time.asc&limit=3000`);
  let best: any = null, bestP = 0;
  for (const [a, b] of coppie(testo)) {
    for (const m of partite) {
      const p = Math.max(Math.min(simil(a, m.squadra1), simil(b, m.squadra2)), Math.min(simil(a, m.squadra2), simil(b, m.squadra1)) - 0.02);
      // a parita' la partita piu' vicina nel tempo (sono ordinate per giorno e ora)
      if (p > bestP + 1e-9) { best = m; bestP = p; }
    }
  }
  return best && bestP >= 0.6 ? { m: best, punteggio: bestP } : null;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);
  const segreto = (process.env.SCHEDINA_SEGRETO || "").trim();
  if (!segreto || req.headers.get("x-schedina-segreto") !== segreto) return jsonResponse({ error: "Non autorizzato" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Body JSON non valido" }, 400); }
  const testo = String(body?.testo || "").trim();
  if (testo.length < 3) return jsonResponse({ trovata: false, html: "Scrivi le due squadre, per esempio: <b>Inter Napoli</b>" });

  const t = await trova(testo);
  if (!t) return jsonResponse({ trovata: false, html: `Non trovo <b>${esc(testo)}</b> fra le partite di oggi e dei prossimi 3 giorni in PronoBlast. Controlla i nomi (es. <b>Inter - Napoli</b>).` });
  const m = t.m;
  const [d] = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(m.id)}&select=numeri`).catch(() => []);
  const n = d?.numeri || {};
  let c = n.consigliato;
  if (!c || (!c.market && !c.daLasciare)) c = await consigliatoDi(m.id, undefined, false).catch(() => null);
  const odds: any = rowToOdds(m);
  const haQuote = !!(odds.odd_1 && odds.odd_X && odds.odd_2);
  const dist = haQuote ? fullDistribution(odds) : [];
  const cat: any = haQuote ? quoteCatalogo(odds) : {};
  const pm = (mk: string) => (haQuote ? coverageForMarket(mk, dist).coverage : null);
  const inizio = inizioPartitaMs(m.day, m.time);
  const stato = m.result ? `finita ${m.result}` : inizio !== null && inizio <= Date.now() ? "gia' iniziata" : null;
  const ai = n.lettura_pro || n.lettura_ai;
  const nomeDir = (x: string) => (x === "1" ? m.squadra1 : x === "2" ? m.squadra2 : x === "X" ? "pareggio" : "nessuna");

  const h: string[] = [];
  h.push(`⚽ <b>${esc(m.squadra1)} - ${esc(m.squadra2)}</b>`);
  h.push(`${esc(m.day.split("-").reverse().join("/"))} · ${esc(m.time)} · ${esc(m.manifestazione)}${stato ? ` · ⏱ ${esc(stato)}` : ""}`);
  if (haQuote) h.push(`Quote: 1 <b>${q2(odds.odd_1)}</b> · X <b>${q2(odds.odd_X)}</b> · 2 <b>${q2(odds.odd_2)}</b> · O2.5 ${q2(odds.odd_O25)} · GG ${q2(odds.odd_GG)}`);
  h.push(SEP);

  // Il verdetto: consigliato o "da lasciare"
  if (c?.daLasciare) {
    h.push(`🚫 <b>DA LASCIARE</b>: ${esc(c.daLasciare)}`);
    if (c.lasciata_market) h.push(`Se vuoi giocarla lo stesso: <b>${esc(c.lasciata_market)}</b> @${q2(c.lasciata_quota)} · motore ${pct(pm(c.lasciata_market))}`);
  }
  if (c?.market) {
    const arch = c.pA != null ? Math.min(c.pA, c.pB ?? c.pA) : null;
    h.push(`🎯 <b>CONSIGLIATO: ${esc(c.nome || c.market)}</b> @${q2(c.quota)}${c.stimata ? " (stimata)" : ""}`);
    h.push(`   archivio ${pct(arch)}${c.n ? ` su ${c.n} partite simili` : ""} · motore ${pct(pm(c.market))}`);
    if (c.ai === "cambiato") h.push(`   🧠 scelto dal Pronostico AI per la notizia: ${esc(c.notizia || "")}${c.numeri_market ? ` (i numeri dicevano ${esc(c.numeri_market)})` : ""}`);
  } else if (!c?.daLasciare) h.push("🎯 Nessun consigliato: in archivio non ci sono abbastanza partite simili per misurarlo.");
  for (const a of c?.avvisi || []) h.push(`⚠ ${esc(a)}`);

  const alt = (c?.alternative || []).slice(0, 3);
  if (alt.length) {
    h.push("", "<b>Alternative</b> (archivio)");
    for (const x of alt) h.push(`• ${esc(x.nome || x.market)} @${q2(x.quota)}${x.stimata ? "~" : ""} · ${pct(x.p)}`);
  }

  if (haQuote) {
    h.push("", "<b>Motore</b> (probabilita' dalle quote)");
    h.push(`1 ${pct(pm("1"))} · X ${pct(pm("X"))} · 2 ${pct(pm("2"))}`);
    h.push(`Over 2.5 ${pct(pm("O2.5"))} · Under 2.5 ${pct(pm("U2.5"))} · GG ${pct(pm("GG"))} · NG ${pct(pm("NG"))}`);
  }
  if (ai) {
    h.push("", `<b>Lettura AI</b> (${esc(ai.modello || "")})`);
    h.push(`favorita ${esc(nomeDir(ai.direzione))} · gol ${esc(ai.gol_casa || "?")} / ${esc(ai.gol_ospite || "?")} (totale ${esc(ai.gol_totali || "?")}) · risultati ${esc((ai.risultati_probabili || []).join(", "))}`);
    if (ai.lettura) { const l = String(ai.lettura); const corto = l.length > 500 ? l.slice(0, 500).replace(/[^.!?]*$/, "") || l.slice(0, 500) : l; h.push(`<i>${esc(corto)}</i>`); }
  }
  const frasi: string[] = n.programma?.frasi || [];
  if (frasi.length) { h.push("", "<b>Numeri del programma</b>"); for (const f of frasi.slice(0, 4)) h.push(`• ${esc(f)}`); }
  const voci: any[] = n.notizie_squadre || [];
  const coach = cambioAllenatore(voci);
  if (voci.length) {
    h.push("", "<b>Notizie</b> (ultimi 7 giorni)");
    if (coach) h.push(`⚠️ ${esc(rigaNotizia(coach))}`);
    for (const v of voci.filter((v) => v !== coach).slice(0, 4)) h.push(`📰 ${esc(rigaNotizia(v).slice(0, 170))}`);
  }
  h.push(SEP, "<i>Come la scheda partita di PronoBlast. Un parere, non una garanzia.</i>");
  // Limite Telegram 4096: si tolgono le righe piu' lunghe (mai le prime 3), senza tagliare i tag HTML
  while (h.join("\n").length > 4000) {
    let i = 3;
    for (let k = 3; k < h.length - 1; k++) if (h[k].length > h[i].length) i = k;
    h.splice(i, 1);
  }
  const html = h.join("\n");
  return jsonResponse({ trovata: true, match_id: m.id, partita: `${m.squadra1} - ${m.squadra2}`, html });
};
