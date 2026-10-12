import { pgGet, jsonResponse, rowToOdds } from "./lib/supabaseRest";
import { fullDistribution, coverageForMarket, evaluateMarketStrict, quoteCatalogo, CANDIDATE_MARKETS } from "./lib/clusterEngine";
import { simil } from "./lib/teamMatch";
import { inizioPartitaMs, normalizeMarket, PROB_AFFIDABILE } from "../../frontend/src/api";
import { consigliatoDi } from "./lib/letturaPartita";
import { rigaNotizia } from "./lib/notizieSquadre";
import { esc, pre, partita, giocataCorta, q as qt, SEP } from "./lib/telegramTabella";

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
const P_TOGLI = 0.45;       // senza consigliato: sotto questa probabilita' del motore si toglie

type Gamba = { casa: string; ospite: string; giocata: string; giocata_originale: string; quota: number | null; data?: string | null };

const MERCATI_NOTI = [
  ...new Set([...CANDIDATE_MARKETS, "O0.5", "U0.5", "O3.5", "O4.5", "U4.5", "DC 1X + U2.5", "DC X2 + U2.5", "DC 12 + U2.5", "1 + O1.5", "2 + O1.5", "1 + O2.5", "2 + O2.5", "1 + GG", "2 + GG", "X + U2.5"]),
];

const PROMPT = `Trascrivi la schedina di scommesse calcio nell'immagine (o nel testo). Puo' essere di qualsiasi bookmaker (Sisal, Goldbet, Eurobet, Snai, Fastbet, Bet365, Lottomatica, Planetwin...): leggi ogni riga di partita, ignora pubblicita', importi e bonus.
Per OGNI partita restituisci: squadra di casa, squadra ospite, la giocata, la quota, la data se c'e'.
La giocata va tradotta nel formato di questo elenco (scrivila esattamente cosi'):
${MERCATI_NOTI.join(", ")}
Regole di traduzione: "Under 2,5"/"U 2.5"/"Meno di 2,5" -> U2.5; "Over" -> O; "Goal"/"Entrambe segnano Si" -> GG; "No Goal" -> NG;
"Doppia chance 1X" -> 1X; "Multigol 2-4" -> MG 2-4 totali; "Multigol casa 1-3" -> MG 1-3 casa; combo "1X + Over 1,5" -> DC 1X + O1.5.
Se una giocata non ha un equivalente nell'elenco, scrivi "ALTRO".
Rispondi SOLO con JSON: {"gambe":[{"casa":"...","ospite":"...","giocata":"...","giocata_originale":"come scritta sulla schedina","quota":1.45,"data":"YYYY-MM-DD o null"}]}`;

/**
 * Traduce i nomi delle giocate dei vari bookmaker (Sisal, Goldbet, Eurobet,
 * Fastbet, Snai, Bet365...) nei mercati di PronoBlast. Il modello di solito
 * lo fa gia', ma non sempre ("Multigol casa 2-4" restava cosi'): qui le
 * regole fisse, una volta per tutte.
 */
export function giocataCanonica(s: string): string {
  if (!s) return "ALTRO";
  const pezzi = s.replace(/\s+e\s+|\s*&\s*|\s*\+\s*/gi, "+").split("+").map((x) => x.trim()).filter(Boolean);
  const uno = (x0: string): string | null => {
    let x = x0.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/,/g, ".").replace(/\s+/g, " ").trim();
    // via le intestazioni del mercato, anche piu' di una ("Esito Finale 1X2: 2")
    for (let i = 0; i < 3; i++) x = x.replace(/^(esito finale|1x2|finale|risultato finale|doppia chance|dc|double chance|u\/o|under\/over|over\/under|goal\/no goal|gg\/ng|multigol|multigoal)\s*[:\-]?\s*(?=\S)/, (m) => (/multi/.test(m) ? "multigol " : ""));
    // "3.5: under" / "2.5 over" (soglia prima del lato)
    const inv = x.match(/^(\d(?:\.5)?)\s*[:\-]?\s*(under|over)$/);
    if (inv) x = `${inv[2]} ${inv[1]}`;
    let m: RegExpMatchArray | null;
    if ((m = x.match(/^multi\s*go?a?l\s*(casa|ospite|home|away|squadra 1|squadra 2)?\s*(\d)\s*-\s*(\d)\s*(casa|ospite|home|away|totali?)?$/))) {
      const chi = m[1] || m[4] || "totali";
      const lato = /casa|home|squadra 1/.test(chi) ? "casa" : /ospite|away|squadra 2/.test(chi) ? "ospite" : "totali";
      return `MG ${m[2]}-${m[3]} ${lato}`;
    }
    if ((m = x.match(/^(?:o|over|piu di)\s*(\d(?:\.5)?)$/))) return `O${m[1].includes(".") ? m[1] : m[1] + ".5"}`;
    if ((m = x.match(/^(?:u|under|meno di)\s*(\d(?:\.5)?)$/))) return `U${m[1].includes(".") ? m[1] : m[1] + ".5"}`;
    if (/^(gg|goal|gol|si|entrambe segnano( si)?|btts( yes)?)$/.test(x)) return "GG";
    if (/^(ng|no ?goal|no ?gol|entrambe segnano no|btts no)$/.test(x)) return "NG";
    if (/^(1|x|2|1x|x2|12)$/.test(x)) return x.toUpperCase();
    if (/^x (oppure|o) gg$/.test(x)) return "X oppure GG";
    return null;
  };
  const tradotti = pezzi.map(uno);
  if (tradotti.some((x) => !x)) return "ALTRO";
  if (tradotti.length === 1) return tradotti[0]!;
  // combo: il segno doppio prende "DC" come nel catalogo ("DC 1X + O1.5")
  return tradotti.map((x, i) => (i === 0 && /^(1X|X2|12)$/.test(x!) ? `DC ${x}` : x)).join(" + ");
}

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

const giornoMese = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" });
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
    // la giocata nel formato di PronoBlast: quella del modello, altrimenti le regole fisse
    const valida = (x: string | null) => !!x && x !== "ALTRO" && evaluateMarketStrict(x, 1, 1) !== null;
    let mercato: string | null = g.giocata;
    if (!valida(mercato)) mercato = giocataCanonica(g.giocata);
    if (!valida(mercato)) mercato = giocataCanonica(g.giocata_originale);
    if (!valida(mercato)) mercato = null;
    r.giocata = mercato || g.giocata;
    if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) { r.esito = "non_valutabile"; r.motivo = "senza quote 1X2 in PronoBlast"; risultati.push(r); continue; }
    if (!mercato || evaluateMarketStrict(mercato, 1, 1) === null) { r.esito = "non_valutabile"; r.motivo = `giocata "${g.giocata_originale}" non calcolabile dal motore`; risultati.push(r); continue; }

    const dist = fullDistribution(odds);
    const p = coverageForMarket(mercato, dist).coverage;
    const implicita = g.quota ? 1 / g.quota : null;
    r.prob = p; r.prob_quota = implicita;
    const avvisi: string[] = [];
    for (const f of n.programma?.frasi || []) if (/⚠|NON d'accordo/i.test(f)) avvisi.push(String(f).replace(/^⚠\s*/, ""));
    const notizia = n.lettura_pro?.notizia || n.lettura_ai?.notizia;
    if (notizia) avvisi.push(`Notizia: ${notizia}`);
    // Google News (allenatore, infortuni, squalifiche): le 3 piu' recenti, il cambio di allenatore sempre
    const voci: any[] = n.notizie_squadre || [];
    const scelte = [...voci.filter((v) => v.tipo === "allenatore").slice(0, 1), ...voci.filter((v) => v.tipo !== "allenatore")].slice(0, 3);
    for (const v of scelte) avvisi.push(`📰 ${rigaNotizia(v)}`);
    r.avvisi = avvisi;

    // Lettura AI del giorno (direzione e gol), come nella scheda partita
    const ai = n.lettura_pro || n.lettura_ai;
    if (ai?.direzione || ai?.gol_totali) r.lettura_ai = `favorita ${ai.direzione === "nessuna" || !ai.direzione ? "nessuna" : ai.direzione === "1" ? m.squadra1 : ai.direzione === "2" ? m.squadra2 : "pareggio"}, gol ${ai.gol_totali || "?"}`;

    // GIUDIZIO COME IN PRONOBLAST (13/10/2026, Rossi: "non sceglie il
    // consigliato come in PronoBlast?"). Prima versione: probabilita' del
    // motore x quota della schedina -> con le quote Goldbet piu' basse di
    // Sisal 5 partite su 7 diventavano "cambia". Ora:
    //  1. il CONSIGLIATO di PronoBlast (archivio + notizie): se e' la tua
    //     giocata -> ok; se PronoBlast dice di lasciare la partita -> togli;
    //  2. la tua giocata regge in archivio (>= 58%) -> ok;
    //  3. altrimenti -> cambia, con il consigliato;
    //  4. partite senza consigliato: il motore (ok >= 55%, togli < 45%).
    // La quota della schedina serve solo per l'avviso "piu' bassa di Sisal".
    let c = n.consigliato;
    if (!c?.market && !c?.daLasciare) c = await consigliatoDi(m.id, undefined, false).catch(() => null);
    if (c?.market) r.consigliato = { giocata: c.nome || c.market, market: c.market, quota: c.quota, prob: coverageForMarket(c.market, dist).coverage, archivio: c.pA != null ? Math.min(c.pA, c.pB ?? c.pA) : null, ai: c.ai };
    const archivio: { market: string; nome: string; quota: number; p: number }[] = c?.market
      ? [{ market: c.market, nome: c.nome || c.market, quota: c.quota, p: r.consigliato.archivio ?? 0 }, ...(c.alternative || [])] : (c?.alternative || []);
    const mio = archivio.find((x) => normalizeMarket(x.market) === normalizeMarket(mercato));
    r.archivio = mio?.p ?? null;
    const sisal = (quoteCatalogo(odds) as any)[mercato];
    if (g.quota && sisal?.odd && !sisal.estimated && g.quota < sisal.odd * 0.94) avvisi.push(`quota bassa: su Sisal la stessa giocata paga ${q2(sisal.odd)}`);
    const coach = voci.find((v) => v.tipo === "allenatore");

    if (c?.daLasciare && !c?.market) { r.esito = "togli"; r.motivo = `PronoBlast la lascia: ${c.daLasciare}`; }
    else if (c?.market && normalizeMarket(c.market) === normalizeMarket(mercato)) { r.esito = "ok"; r.motivo = `e' il consigliato di PronoBlast${r.archivio != null ? ` (archivio ${pct(r.archivio)})` : ""}`; }
    else if (mio && mio.p >= PROB_AFFIDABILE) { r.esito = "ok"; r.motivo = `regge in archivio ${pct(mio.p)}`; }
    else if (c?.market && c.quota) { r.esito = "cambia"; r.al_posto = { giocata: r.consigliato.giocata, quota: c.quota, prob: r.consigliato.prob, archivio: r.consigliato.archivio, stimata: !!c.stimata }; r.motivo = mio ? `in archivio solo ${pct(mio.p)}` : "non e' tra le giocate che reggono in archivio"; }
    else if (p >= 0.55) { r.esito = "ok"; r.motivo = `nessun consigliato per questa partita; motore ${pct(p)}`; }
    else if (p < P_TOGLI) { r.esito = "togli"; r.motivo = `nessun consigliato; motore solo ${pct(p)}`; }
    else { r.esito = "debole"; r.motivo = `nessun consigliato; motore ${pct(p)}`; }
    if (coach && r.esito === "ok") { r.esito = "debole"; r.motivo = `${r.motivo}, ma CAMBIO DI ALLENATORE (${giornoMese(coach.data)})`; }

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

  // Una riga di giudizio per partita (testo semplice, senza HTML)
  const giudizio = (r: any): string => {
    if (r.esito === "ok") return `✅ ok: ${r.motivo}`;
    if (r.esito === "cambia") return `🔄 metti ${r.al_posto.giocata} @${q2(r.al_posto.quota)}${r.al_posto.stimata ? " (stimata)" : ""}${r.al_posto.archivio != null ? `, archivio ${pct(r.al_posto.archivio)}` : ""} (la tua: ${r.motivo})`;
    if (r.esito === "togli") return `❌ togli: ${r.motivo}` + (r.al_posto_partita ? `. Al suo posto ${r.al_posto_partita.partita} ${r.al_posto_partita.ora} · ${r.al_posto_partita.giocata} @${q2(r.al_posto_partita.quota)} (archivio ${pct(r.al_posto_partita.p)})` : ". Nessuna partita di oggi a quota simile");
    if (r.esito === "debole") return `⚠️ da valutare: ${r.motivo}`;
    return `❓ ${r.motivo}: decidi tu`;
  };
  const righe: string[] = [`📋 Letta: ${risultati.length} partite, quota ${q2(totale)}`, ""];
  risultati.forEach((r, i) => {
    righe.push(`${i + 1}. ${r.partita || r.schedina} · ${r.giocata_originale || r.giocata} @${q2(r.quota)}${r.avviso_inizio ? ` (⏱ ${r.avviso_inizio})` : ""}`, `   ${giudizio(r)}`);
    if (r.lettura_ai) righe.push(`   🧠 lettura AI: ${r.lettura_ai}`);
    for (const a of r.avvisi || []) righe.push(`   ⚠ ${a}`);
  });
  righe.push("", `Quota con le modifiche: ${q2(nuova)} (era ${q2(totale)})`);

  // Versione per Telegram: tabella + partita per partita (parse_mode HTML, max 4096)
  const ICONA: Record<string, string> = { ok: "✅", cambia: "🔄", togli: "❌", debole: "⚠️", non_valutabile: "❓" };
  const versione = (maxNote: number) => {
    const h: string[] = [`📋 <b>Schedina: ${risultati.length} partite · quota ${esc(q2(totale))}</b>`];
    h.push(pre(["", "#", "Partita", "Gioco", "Quota"],
      risultati.map((r, i) => [ICONA[r.esito] || "❓", String(i + 1), r.partita ? partita(r.partita.split(" - ")[0], r.partita.split(" - ")[1] || "") : r.schedina, giocataCorta(r.giocata === "ALTRO" ? r.giocata_originale : r.giocata), qt(r.quota)]),
      [2, 1, 7, 11, 4]));
    h.push(`Quota con le modifiche: <b>${esc(q2(nuova))}</b> (era ${esc(q2(totale))})`, "", "<b>Partita per partita</b>");
    risultati.forEach((r, i) => {
      h.push(SEP);
      h.push(`<b>${i + 1}. ${esc(r.partita || r.schedina)}</b>${r.ora ? ` · ${esc(r.ora)}` : ""}${r.avviso_inizio ? ` ⏱ ${esc(r.avviso_inizio)}` : ""}`);
      h.push(`   ${esc(giudizio(r))}`);
      if (r.lettura_ai && maxNote > 0) h.push(`   🧠 ${esc(r.lettura_ai)}`);
      for (const x of (r.avvisi || []).slice(0, maxNote)) h.push(`   ${esc((x.startsWith("📰") ? x : `⚠ ${x}`).slice(0, 160))}`);
    });
    h.push(SEP, "<i>Come in PronoBlast: prima il consigliato (archivio + notizie), poi l'archivio, il motore solo se manca il consigliato. Un parere, non una garanzia.</i>");
    return h.join("\n");
  };
  let html = versione(3);
  for (const n of [2, 1, 0]) if (html.length > 4000) html = versione(n);

  return jsonResponse({ gambe: risultati, quota_totale: totale, quota_nuova: nuova, modello: MODELLO_VISIONE, testo: righe.join("\n"), html });
};
