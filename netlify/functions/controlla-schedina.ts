import { pgGet, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { fullDistribution, coverageForMarket, evaluateMarketStrict, quoteCatalogo, CANDIDATE_MARKETS } from "./lib/clusterEngine";
import { simil } from "./lib/teamMatch";
import { inizioPartitaMs, normalizeMarket } from "../../frontend/src/api";

/**
 * POST /controlla-schedina — "controlla la mia schedina" (13/10/2026, Rossi).
 *
 * Rossi manda la foto (o il testo) di una schedina fatta a mano, es. Goldbet,
 * di solito dal bot Telegram (n8n). Per ogni partita:
 *   1. un modello che legge le immagini (OpenRouter) trascrive squadre,
 *      giocata e quota, con i nomi dei mercati di PronoBlast;
 *   2. la partita si cerca nel DB (giorni vicini, nomi simili);
 *   3. probabilita' della giocata dal motore (Poisson sulle quote della
 *      partita), consigliato salvato, avvisi della lettura (assenze, forma);
 *   4. giudizio: ok / cambia (con la giocata consigliata) / togli (con una
 *      partita del giorno al posto suo) / non valutabile.
 * Le quote restano QUELLE DELLA SCHEDINA: e' quello che Rossi giochera'.
 * Non scrive niente nel database.
 *
 * Body JSON: { immagine?: base64 o data URL, testo?: string }
 * Header: X-Schedina-Segreto = env SCHEDINA_SEGRETO (la rotta e' pubblica e
 * la lettura dell'immagine costa credito OpenRouter).
 */

const MODELLO_VISIONE = "google/gemini-2.5-flash";
// Giudizio (prima versione, da misurare con le schedine vere). "Valore" =
// probabilita' del motore x quota della schedina: 1 = quota giusta, sotto 1
// il bookmaker paga meno del rischio. Con il margine normale (~5-8%) una
// giocata corretta sta intorno a 0,93-0,95.
const P_MIN = 0.50;         // sotto: piu' facile perdere che vincere
const P_TOGLI = 0.45;       // sotto: da togliere
const V_OK = 0.93;          // valore minimo per "ok"
const V_TOGLI = 0.85;       // sotto: paga troppo poco per il rischio
const P_IN_PIU = 0.05;      // l'alternativa deve essere almeno 5 punti piu' probabile

type Gamba = { casa: string; ospite: string; giocata: string; giocata_originale: string; quota: number | null; data?: string | null };

const MERCATI_NOTI = [
  ...new Set([...CANDIDATE_MARKETS, "O0.5", "U0.5", "O3.5", "O4.5", "U4.5", "DC 1X + U2.5", "DC X2 + U2.5", "DC 12 + U2.5", "1 + O1.5", "2 + O1.5", "1 + O2.5", "2 + O2.5", "1 + GG", "2 + GG", "X + U2.5"]),
];

const PROMPT = `Trascrivi la schedina di scommesse calcio nell'immagine (o nel testo).
Per OGNI partita restituisci: squadra di casa, squadra ospite, la giocata, la quota, la data se c'e'.
La giocata va tradotta nel formato di questo elenco (scrivila esattamente cosi'):
${MERCATI_NOTI.join(", ")}
Regole di traduzione: "Under 2,5"/"U 2.5"/"Meno di 2,5" -> U2.5; "Over" -> O; "Goal"/"Entrambe segnano Si" -> GG; "No Goal" -> NG;
"Doppia chance 1X" -> 1X; "Multigol 2-4" -> MG 2-4 totali; "Multigol casa 1-3" -> MG 1-3 casa; combo "1X + Over 1,5" -> DC 1X + O1.5.
Se una giocata non ha un equivalente nell'elenco, scrivi "ALTRO".
Rispondi SOLO con JSON: {"gambe":[{"casa":"...","ospite":"...","giocata":"...","giocata_originale":"come scritta sulla schedina","quota":1.45,"data":"YYYY-MM-DD o null"}]}`;

async function leggiSchedina(immagine: string | undefined, testo: string | undefined): Promise<Gamba[]> {
  const key = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("OPENROUTER_API_KEY mancante");
  const content: any[] = [{ type: "text", text: PROMPT + (testo ? `\n\nTESTO DELLA SCHEDINA:\n${testo}` : "") }];
  if (immagine) {
    const url = immagine.startsWith("data:") ? immagine : `data:image/jpeg;base64,${immagine}`;
    content.push({ type: "image_url", image_url: { url } });
  }
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "PronoBlast controlla schedina" },
    body: JSON.stringify({ model: MODELLO_VISIONE, temperature: 0, messages: [{ role: "user", content }], response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`lettura schedina: OpenRouter ${r.status}`);
  const j: any = await r.json();
  const s: string = j?.choices?.[0]?.message?.content || "";
  const dati = JSON.parse((s.match(/\{[\s\S]*\}/) || ["{}"])[0]);
  return (Array.isArray(dati.gambe) ? dati.gambe : [])
    .filter((g: any) => g?.casa && g?.ospite)
    .map((g: any) => ({
      casa: String(g.casa).trim(), ospite: String(g.ospite).trim(),
      giocata: String(g.giocata || "ALTRO").trim(), giocata_originale: String(g.giocata_originale || g.giocata || "").trim(),
      quota: Number(String(g.quota ?? "").replace(",", ".")) || null,
      data: /^\d{4}-\d{2}-\d{2}$/.test(g.data || "") ? g.data : null,
    }));
}

const giorno = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d);

/** Partite dei giorni vicini (o del giorno scritto sulla schedina). */
async function partiteCandidate(gambe: Gamba[]): Promise<any[]> {
  const oggi = new Date();
  const giorni = new Set<string>();
  for (let d = -1; d <= 3; d++) giorni.add(giorno(new Date(oggi.getTime() + d * 86400000)));
  for (const g of gambe) if (g.data) giorni.add(g.data);
  const lista = [...giorni].map((d) => `"${d}"`).join(",");
  return pgGet(`matches?day=in.(${lista})&select=*`);
}

function trovaPartita(g: Gamba, partite: any[]): { m: any; punteggio: number } | null {
  let best: any = null, bestP = 0;
  for (const m of partite) {
    if (g.data && m.day !== g.data) continue;
    const p = Math.min(simil(g.casa, m.squadra1), simil(g.ospite, m.squadra2));
    if (p > bestP) { best = m; bestP = p; }
  }
  return best && bestP >= 0.6 ? { m: best, punteggio: bestP } : null;
}

async function dossierDi(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const lista = ids.slice(i, i + 50).map((x) => `"${x}"`).join(",");
    const righe = await pgGet(`dossier_web?match_id=in.(${lista})&select=match_id,numeri`).catch(() => []);
    for (const r of righe) out.set(r.match_id, r.numeri || {});
  }
  return out;
}

const pct = (p: number | null | undefined) => (p == null ? "n/d" : `${Math.round(p * 100)}%`);
const q2 = (q: number | null | undefined) => (q == null ? "n/d" : q.toFixed(2).replace(".", ","));

/** Una partita del giorno al posto di quella da togliere: consigliato piu' solido a quota simile. */
async function sostituto(m: any, quota: number | null, escluse: Set<string>): Promise<any | null> {
  const delGiorno = await pgGet(`matches?day=eq.${m.day}&result=is.null&select=id,day,time,manifestazione,squadra1,squadra2`).catch(() => []);
  const ora = Date.now();
  const libere = delGiorno.filter((x: any) => !escluse.has(x.id) && (inizioPartitaMs(x.day, x.time) ?? 0) > ora);
  const dossier = await dossierDi(libere.map((x: any) => x.id));
  let best: any = null;
  for (const x of libere) {
    const c = dossier.get(x.id)?.consigliato;
    if (!c?.market || !c.quota || c.pA == null) continue;
    if (quota && Math.abs(c.quota - quota) > 0.3) continue;
    const p = Math.min(c.pA, c.pB ?? c.pA);
    if (!best || p > best.p) best = { p, partita: `${x.squadra1} - ${x.squadra2}`, ora: x.time, campionato: x.manifestazione, giocata: c.nome || c.market, quota: c.quota };
  }
  return best;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST con {immagine} o {testo}" }, 405);
  const segreto = (process.env.SCHEDINA_SEGRETO || "").trim();
  if (!segreto || req.headers.get("x-schedina-segreto") !== segreto) return jsonResponse({ error: "Non autorizzato" }, 401);

  let body: any;
  const tipo = (req.headers.get("content-type") || "").toLowerCase();
  if (tipo.startsWith("image/")) {
    // la foto cosi' com'e' (n8n la inoltra da Telegram senza convertirla)
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return jsonResponse({ error: "Immagine troppo grande (max 8 MB)" }, 413);
    body = { immagine: `data:${tipo.split(";")[0]};base64,${buf.toString("base64")}` };
  } else {
    try { body = await req.json(); } catch { return jsonResponse({ error: "Body JSON non valido" }, 400); }
  }
  if (!body?.immagine && !body?.testo) return jsonResponse({ error: "Serve {immagine} (base64) o {testo}" }, 400);

  let gambe: Gamba[];
  try { gambe = await leggiSchedina(body.immagine, body.testo); }
  catch (e: any) { return jsonResponse({ error: `Non riesco a leggere la schedina: ${e.message}` }, 502); }
  if (!gambe.length) return jsonResponse({ gambe: [], testo: "Non ho trovato partite nella schedina. Prova con una foto piu' nitida." });
  // Sulle schedine la data e' spesso senza anno ("12/10") e il modello lo
  // inventa: si tiene l'anno di oggi, e se la data e' lontana piu' di una
  // settimana si ignora (la partita si cerca nei giorni vicini).
  for (const g of gambe) {
    if (!g.data) continue;
    const d = `${giorno(new Date()).slice(0, 4)}${g.data.slice(4)}`;
    g.data = Math.abs(Date.parse(d) - Date.now()) <= 7 * 86400000 ? d : null;
  }

  const partite = await partiteCandidate(gambe);
  const trovate = gambe.map((g) => trovaPartita(g, partite));
  const dossier = await dossierDi(trovate.filter(Boolean).map((t) => t!.m.id));
  const nellaSchedina = new Set(trovate.filter(Boolean).map((t) => t!.m.id));

  const risultati: any[] = [];
  for (let i = 0; i < gambe.length; i++) {
    const g = gambe[i], t = trovate[i];
    const r: any = { schedina: `${g.casa} - ${g.ospite}`, giocata: g.giocata, giocata_originale: g.giocata_originale, quota: g.quota };
    if (!t) { r.esito = "non_valutabile"; r.motivo = "partita non trovata in PronoBlast"; risultati.push(r); continue; }
    const m = t.m, n = dossier.get(m.id) || {};
    r.partita = `${m.squadra1} - ${m.squadra2}`; r.giorno = m.day; r.ora = m.time; r.campionato = m.manifestazione; r.match_id = m.id;
    const inizio = inizioPartitaMs(m.day, m.time);
    if (m.result || (inizio !== null && inizio <= Date.now())) r.avviso_inizio = m.result ? `finita ${m.result}` : "gia' iniziata";

    const odds: any = rowToOdds(m);
    const mercato = g.giocata === "ALTRO" ? null : g.giocata;
    if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) { r.esito = "non_valutabile"; r.motivo = "senza quote 1X2 in PronoBlast"; risultati.push(r); continue; }
    if (!mercato || evaluateMarketStrict(mercato, 1, 1) === null) { r.esito = "non_valutabile"; r.motivo = `giocata "${g.giocata_originale}" non calcolabile dal motore`; risultati.push(r); continue; }

    const dist = fullDistribution(odds);
    const p = coverageForMarket(mercato, dist).coverage;
    const implicita = g.quota ? 1 / g.quota : null;
    r.prob = p; r.prob_quota = implicita;
    const c = n.consigliato;
    if (c?.market) r.consigliato = { giocata: c.nome || c.market, market: c.market, quota: c.quota, prob: coverageForMarket(c.market, dist).coverage, archivio: c.pA };
    const avvisi: string[] = [];
    for (const f of n.programma?.frasi || []) if (/⚠|NON d'accordo/i.test(f)) avvisi.push(String(f).replace(/^⚠\s*/, ""));
    const notizia = n.lettura_pro?.notizia || n.lettura_ai?.notizia;
    if (notizia) avvisi.push(`Notizia: ${notizia}`);
    r.avvisi = avvisi;

    const valore = g.quota ? p * g.quota : null;
    r.valore = valore;
    if (p < P_TOGLI || (valore != null && valore < V_TOGLI)) r.esito = "togli";
    else if (p >= P_MIN && (valore == null || valore >= V_OK)) r.esito = "ok";
    else r.esito = "cambia";

    if (r.esito === "cambia") {
      // Alternativa nella stessa partita: piu' probabile E con valore non
      // peggiore (quote del catalogo PronoBlast), quota almeno 1,30. Il
      // consigliato vince a parita'.
      const cat = quoteCatalogo(odds);
      const vMin = valore ?? 0;
      let best: any = null;
      const prova = (mk: string, quota: number | null | undefined, nome?: string, stimata = false) => {
        if (!quota || quota < 1.3 || normalizeMarket(mk) === normalizeMarket(mercato)) return;
        const pp = coverageForMarket(mk, dist).coverage, vv = pp * quota;
        if (pp >= p + P_IN_PIU && vv >= vMin && (!best || vv > best.valore)) best = { giocata: nome || mk, quota, prob: pp, valore: vv, stimata };
      };
      if (r.consigliato) prova(r.consigliato.market, r.consigliato.quota, r.consigliato.giocata);
      const dalConsigliato = best;
      for (const [mk, v] of Object.entries(cat)) prova(mk, v?.odd, undefined, !!v?.estimated);
      r.al_posto = dalConsigliato || best;
      if (!r.al_posto) r.esito = "debole";
    }
    if (r.esito === "togli") r.al_posto_partita = await sostituto(m, g.quota, nellaSchedina);
    risultati.push(r);
  }

  // Quote: totale della schedina e totale dopo le modifiche proposte
  const totale = risultati.reduce((t, r) => t * (r.quota || 1), 1);
  let nuova = 1;
  for (const r of risultati) {
    if (r.esito === "cambia" && r.al_posto?.quota) nuova *= r.al_posto.quota;
    else if (r.esito === "togli") nuova *= r.al_posto_partita?.quota || 1;
    else nuova *= r.quota || 1;
  }

  const righe: string[] = [`📋 Letta: ${risultati.length} partite, quota ${q2(totale)}`, ""];
  risultati.forEach((r, i) => {
    const testa = `${i + 1}. ${r.partita || r.schedina} · ${r.giocata_originale || r.giocata} @${q2(r.quota)}`;
    const extra = r.avviso_inizio ? ` (⏱ ${r.avviso_inizio})` : "";
    const conti = `motore ${pct(r.prob)}, la quota ne chiede ${pct(r.prob_quota)}`;
    if (r.esito === "ok") righe.push(`✅ ${testa}${extra}\n   ok: ${conti}`);
    else if (r.esito === "cambia") righe.push(`🔄 ${testa}${extra}\n   ${conti}: CAMBIA in ${r.al_posto.giocata} @${q2(r.al_posto.quota)}${r.al_posto.stimata ? " (quota stimata)" : ""}, motore ${pct(r.al_posto.prob)}`);
    else if (r.esito === "debole") righe.push(`⚠️ ${testa}${extra}\n   da valutare: ${conti}; nessuna alternativa migliore in questa partita`);
    else if (r.esito === "togli") righe.push(`❌ ${testa}${extra}\n   TOGLI: ${conti}` +(r.al_posto_partita ? `\n   al suo posto: ${r.al_posto_partita.partita} (${r.al_posto_partita.ora}) · ${r.al_posto_partita.giocata} @${q2(r.al_posto_partita.quota)}, in archivio ${pct(r.al_posto_partita.p)}` : "\n   nessuna partita di oggi a quota simile"));
    else righe.push(`❓ ${testa}\n   ${r.motivo}: decidi tu`);
    for (const a of r.avvisi || []) righe.push(`   ⚠ ${a}`);
  });
  righe.push("", `Quota con le modifiche: ${q2(nuova)} (era ${q2(totale)})`);
  righe.push("Probabilita' del motore dalle quote della partita in PronoBlast; e' un parere, non una garanzia.");

  return jsonResponse({ gambe: risultati, quota_totale: totale, quota_nuova: nuova, modello: MODELLO_VISIONE, testo: righe.join("\n") });
};
