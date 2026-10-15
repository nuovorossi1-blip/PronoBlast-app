/**
 * TEST DELLE REGOLE PER SCENARIO + LETTURA AI (14/10/2026, Rossi). SOLA LETTURA sul database.
 *
 * Prova sulle partite future del metodo deciso il 14/10 (vedi Desktop\report-analisi pronosblast\
 * regole-per-scenario.md), senza toccare l'app:
 *  - "fotografa": poco prima del via salva, una volta sola per partita, scenario, lettura AI,
 *    semaforo, scelta per fascia e scelta principale secondo le regole, e cosa propone l'app
 *    (consigliato e Schedina). Le foto non si riscrivono: sono quello che si sapeva prima.
 *  - "valuta": il giorno dopo confronta con i risultati (regole contro app) e aggiorna il riepilogo.
 *
 * La decisione e' in netlify/functions/lib/regolePronostico.ts (la stessa della scheda partita).
 * Le foto hanno 'versione': dalla 2 (15/10) favorita forte in coppa e campionati da pochi gol.
 * Semaforo (misure del 14/10 su 1.435 partite con dossier):
 *  - verde: lettura AI coerente e con la stessa direzione del bookmaker -> direzione (tabella scenario);
 *  - giallo: lettura senza direzione -> Equilibrio: X o GG; altrimenti doppia chance (+ O1.5);
 *  - rosso: lettura incoerente (direzione diversa dai suoi 3 risultati) o contro il bookmaker ->
 *    niente favorita, solo gol (O2.5, GG), altrimenti esclusa;
 *  - avviso gol: favorita con 5+ assenti -> niente GG/Over (GG -9, O2.5 -8 sul motore).
 * Il contrasto forma/quote NON esclude (la favorita va meglio, +4,8). Mai mercati larghi di ripiego.
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   npx tsx --env-file=.env ../scripts/test-regole.mts fotografa [--ore=3]
 *   npx tsx --env-file=.env ../scripts/test-regole.mts valuta [--giorno=AAAA-MM-GG]
 *   npx tsx --env-file=.env ../scripts/test-regole.mts gemini [--forza]   (una volta al giorno, vedi gemini())
 * Uscita: server-locale/test-regole/ (foto-AAAA-MM-GG.jsonl, report-AAAA-MM-GG.md, riepilogo.md).
 */
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pgGet } from "../netlify/functions/lib/supabaseRest";
import { spawn } from "node:child_process";
import { inizioPartitaMs, normalizeMarket } from "../frontend/src/api";
import { leagueTier, isPartitaMinore } from "../netlify/functions/lib/leagueTier";
import { parseLeagueLabel } from "../netlify/functions/lib/leagueContext";
import { decidi, vinceRegole as vince } from "../netlify/functions/lib/regolePronostico";
export { decidi };

const DIR = fileURLToPath(new URL("../server-locale/test-regole/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const giornoRoma = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
const fotoFile = (giorno: string) => `${DIR}foto-${giorno}.jsonl`;
const leggiFoto = (giorno: string): any[] => existsSync(fotoFile(giorno))
  ? readFileSync(fotoFile(giorno), "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r)) : [];

async function fotografa() {
  const ore = Number(arg("ore", "3"));
  const ora = Date.now();
  const giorni = [giornoRoma(ora), giornoRoma(ora + 86_400_000)];
  const partite = await pgGet(`matches?day=in.(${giorni.join(",")})&result=is.null&select=*`);
  const giaFatte = new Set(giorni.flatMap((g) => leggiFoto(g).map((f) => f.id)));
  let nuove = 0;
  for (const m of partite) {
    if (giaFatte.has(m.id) || !m.odd_1 || !m.odd_x || !m.odd_2) continue;
    const inizio = inizioPartitaMs(m.day, m.time);
    if (inizio === null || inizio <= ora || inizio > ora + ore * 3_600_000) continue;
    const [d] = await pgGet(`dossier_web?match_id=eq.${m.id}&select=ai:numeri->lettura_ai,pro:numeri->lettura_pro,c:numeri->consigliato,prog:numeri->programma`);
    // Senza lettura AI si aspetta il giro dopo, finche' mancano almeno 45 minuti
    if (!d?.ai && !d?.pro && inizio - ora > 45 * 60_000) continue;
    let dec: any;
    try { dec = decidi(m, { ai: d?.ai, pro: d?.pro, prog: d?.prog }); } catch (e: any) { console.error("[test-regole]", m.squadra1, m.squadra2, e?.message); continue; }
    const c = d?.c ?? null;
    const riga = {
      foto: new Date(ora).toISOString(), id: m.id, day: m.day, time: m.time, lega: m.manifestazione, casa: m.squadra1, ospite: m.squadra2,
      quote: { "1": m.odd_1, X: m.odd_x, "2": m.odd_2, "1X": m.odd_1x, X2: m.odd_x2, O25: m.odd_o25, GG: m.odd_gg },
      ...dec,
      accordoFormaQuote: d?.prog?.accordo ?? null,
      app: { consigliato: c?.market ?? null, quota: c?.quota ?? null, daLasciare: c?.daLasciare ?? null, lasciata: c?.lasciata_market ?? null, schedina: m.pick_finale ?? null, selezionata: !!m.selected },
    };
    appendFileSync(fotoFile(m.day), JSON.stringify(riga) + "\n");
    nuove++;
  }
  console.log(`[test-regole] ${new Date(ora).toISOString()} fotografate ${nuove} partite (finestra ${ore} ore)`);
}

type Conto = { n: number; v: number; q: number };
const nuovoConto = (): Conto => ({ n: 0, v: 0, q: 0 });
const conta = (c: Conto, ok: boolean | null, quota?: number | null) => { if (ok === null) return; c.n++; if (ok) c.v++; if (quota) c.q += quota; };
const pc = (c: Conto) => (c.n ? `${c.v}/${c.n} = ${(c.v / c.n * 100).toFixed(1)}%` : "-");
const qm = (c: Conto) => (c.n && c.q ? (c.q / c.n).toFixed(2) : "-");

async function valuta() {
  const giorno = arg("giorno", giornoRoma(Date.now() - 86_400_000));
  const foto = leggiFoto(giorno);
  if (!foto.length) { console.log(`[test-regole] nessuna foto per ${giorno}`); }
  else {
    const ris = new Map<string, string>();
    for (let i = 0; i < foto.length; i += 150) {
      const ids = foto.slice(i, i + 150).map((f) => f.id).join(",");
      for (const r of await pgGet(`matches?id=in.(${ids})&select=id,result`)) if (/^\d+-\d+$/.test(String(r.result ?? "").trim())) ris.set(r.id, r.result.trim());
    }
    const righe: string[] = [`# Test regole · ${giorno}`, "", `Partite fotografate prima del via: ${foto.length} · con risultato: ${ris.size}`, "",
      "| Ora | Partita | Ris. | Scenario | Semaforo | Regole | | App consigliato | | Schedina | |", "|---|---|---|---|---|---|---|---|---|---|---|"];
    for (const f of foto.sort((a, b) => String(a.time).localeCompare(String(b.time)))) {
      const r = ris.get(f.id); const [h, a] = r ? r.split("-").map(Number) : [NaN, NaN];
      const es = (mk?: string | null) => (!r || !mk ? "" : vince(mk, h, a) ? "✅" : "❌");
      const s = f.scelta ? `${f.scelta.mk} @${f.scelta.quota}${f.scelta.stimata ? "*" : ""}` : "esclusa";
      righe.push(`| ${f.time} | ${f.casa} - ${f.ospite} (${f.lega}) | ${r ?? "?"} | ${f.scenario} | ${f.semaforo} | ${s} | ${es(f.scelta?.mk)} | ${f.app.consigliato ?? (f.app.daLasciare ? "da lasciare" : "-")} | ${es(f.app.consigliato)} | ${f.app.schedina ?? "-"} | ${es(f.app.schedina)} |`);
    }
    righe.push("", "\\* quota stimata dal programma: va controllata sul bookmaker.");
    writeFileSync(`${DIR}report-${giorno}.md`, righe.join("\n"));
    console.log(`[test-regole] report ${giorno}: ${foto.length} partite, ${ris.size} con risultato`);
  }
  // Riepilogo su tutti i giorni valutabili
  const tot = { regole: nuovoConto(), consigliato: nuovoConto(), schedina: nuovoConto(), escluse: nuovoConto(), dalasciare: nuovoConto() };
  const perSem: Record<string, Conto> = {}, perScen: Record<string, Conto> = {}, perFascia: Record<string, Conto> = {};
  let giorniN = 0;
  for (const file of readdirSync(DIR).filter((x) => /^foto-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
    const g = file.slice(5, 15); const fs = leggiFoto(g); if (!fs.length) continue;
    const ris = new Map<string, string>();
    for (let i = 0; i < fs.length; i += 150) for (const r of await pgGet(`matches?id=in.(${fs.slice(i, i + 150).map((f) => f.id).join(",")})&select=id,result`)) if (/^\d+-\d+$/.test(String(r.result ?? "").trim())) ris.set(r.id, r.result.trim());
    if (!ris.size) continue; giorniN++;
    for (const f of fs) {
      const r = ris.get(f.id); if (!r) continue; const [h, a] = r.split("-").map(Number);
      if (f.scelta) {
        const ok = vince(f.scelta.mk, h, a);
        conta(tot.regole, ok, f.scelta.quota); conta((perSem[f.semaforo] ??= nuovoConto()), ok, f.scelta.quota); conta((perScen[f.scenario] ??= nuovoConto()), ok, f.scelta.quota);
      } else if (f.app.schedina) conta(tot.escluse, vince(f.app.schedina, h, a));
      for (const [nome, v] of Object.entries(f.fasce || {})) if (v) conta((perFascia[nome] ??= nuovoConto()), vince((v as any).mk, h, a), (v as any).quota);
      if (f.app.consigliato) conta(tot.consigliato, vince(f.app.consigliato, h, a), f.app.quota);
      if (f.app.daLasciare && f.app.lasciata) conta(tot.dalasciare, vince(f.app.lasciata, h, a));
      if (f.app.schedina) conta(tot.schedina, vince(f.app.schedina, h, a));
    }
  }
  // Gemini (dal 15/10): tutte le sue scelte e, sulle stesse partite, Gemini contro le regole.
  // "gemini-" = agy da riga di comando (11:30); "gemini-chat-" = la chat dell'utente (versione piu' recente),
  // incollata a mano con gli stessi soli nomi delle partite.
  const fotoPerId = new Map<string, any>();
  for (const file of readdirSync(DIR).filter((x) => /^foto-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x))) for (const f of leggiFoto(file.slice(5, 15))) fotoPerId.set(f.id, f);
  const valutaGemini = async (re: RegExp) => {
    const gem = nuovoConto(), stesseGem = nuovoConto(), stesseReg = nuovoConto(); let gemSalta = 0;
    for (const file of readdirSync(DIR).filter((x) => re.test(x)).sort()) {
      const gs = readFileSync(`${DIR}${file}`, "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r));
      const ris = new Map<string, string>();
      if (gs.length) for (const r of await pgGet(`matches?id=in.(${gs.map((g) => g.id).join(",")})&select=id,result`)) if (/^\d+-\d+$/.test(String(r.result ?? "").trim())) ris.set(r.id, r.result.trim());
      for (const g of gs) {
        const r = ris.get(g.id); if (!r) continue; const [h, a] = r.split("-").map(Number);
        if (!g.mk) { gemSalta++; continue; }
        const ok = vince(g.mk, h, a); conta(gem, ok, g.quota);
        const f = fotoPerId.get(g.id);
        if (f?.scelta) { conta(stesseGem, ok, g.quota); conta(stesseReg, vince(f.scelta.mk, h, a), f.scelta.quota); }
      }
    }
    return { gem, stesseGem, stesseReg, gemSalta };
  };
  const ga = await valutaGemini(/^gemini-\d{4}-\d{2}-\d{2}\.jsonl$/), gc = await valutaGemini(/^gemini-chat-\d{4}-\d{2}-\d{2}\.jsonl$/);
  const t = (o: Record<string, Conto>) => Object.entries(o).sort().map(([k, c]) => `| ${k} | ${pc(c)} | ${qm(c)} |`).join("\n");
  writeFileSync(`${DIR}riepilogo.md`, [
    `# Test regole · riepilogo (${giorniN} giorni con risultati, aggiornato ${new Date().toISOString().slice(0, 16)})`, "",
    "| Chi sceglie | Vinte | Quota media |", "|---|---|---|",
    `| **Regole (scelta principale)** | ${pc(tot.regole)} | ${qm(tot.regole)} |`,
    `| App: consigliato | ${pc(tot.consigliato)} | ${qm(tot.consigliato)} |`,
    `| App: Schedina (pick_finale) | ${pc(tot.schedina)} | - |`,
    `| Escluse dalle regole: come e' andata la Schedina | ${pc(tot.escluse)} | - |`,
    `| App "da lasciare": se giocate | ${pc(tot.dalasciare)} | - |`,
    `| Gemini Flash da agy (solo i nomi, ricerca web) | ${pc(ga.gem)} | ${qm(ga.gem)} |`,
    `| Gemini chat dell'utente (solo i nomi) | ${pc(gc.gem)} | ${qm(gc.gem)} |`, "",
    `Sulle stesse partite · Gemini agy ${pc(ga.stesseGem)} (quota ${qm(ga.stesseGem)}) contro regole ${pc(ga.stesseReg)} (quota ${qm(ga.stesseReg)}), saltate ${ga.gemSalta} · Gemini chat ${pc(gc.stesseGem)} (quota ${qm(gc.stesseGem)}) contro regole ${pc(gc.stesseReg)} (quota ${qm(gc.stesseReg)}).`,
    "Quote di Gemini: quelle che dice di aver trovato lui. Per guadagnare alla quota media 1,60 serve vincere almeno il 63%.", "",
    "## Regole per semaforo", "| Semaforo | Vinte | Quota media |", "|---|---|---|", t(perSem), "",
    "## Regole per scenario", "| Scenario | Vinte | Quota media |", "|---|---|---|", t(perScen), "",
    "## Regole per fascia (la migliore di ogni fascia)", "| Fascia | Vinte | Quota media |", "|---|---|---|", t(perFascia), "",
  ].join("\n"));
  console.log(`[test-regole] riepilogo: regole ${pc(tot.regole)}, consigliato ${pc(tot.consigliato)}, schedina ${pc(tot.schedina)}`);
}

/**
 * GEMINI NEL TEST (15/10/2026, Rossi: "ho dato a Gemini solo i nomi delle partite e le ha prese tutte").
 * Una volta al giorno si passano a Gemini 3.8 Flash (agy, abbonamento dell'utente: nessun costo API)
 * SOLO i nomi delle partite principali di oggi non iniziate, come ha fatto l'utente; lui cerca sul web
 * e sceglie un mercato semplice da 1,40 a 1,80. Le sue scelte si salvano prima del via e si valutano
 * con le altre. Il testo mandato contiene solo squadre, campionato e ora (niente dati privati).
 */
const MAX_GEMINI = 10;
async function gemini() {
  const ora = Date.now(), oggi = giornoRoma(ora);
  const file = `${DIR}gemini-${oggi}.jsonl`;
  if (existsSync(file) && !process.argv.includes("--forza")) { console.log(`[test-regole] gemini: ${oggi} gia' fatto`); return; }
  const partite = (await pgGet(`matches?day=eq.${oggi}&result=is.null&select=id,day,time,manifestazione,squadra1,squadra2,odd_1,odd_x,odd_2`))
    .filter((m: any) => { const i = inizioPartitaMs(m.day, m.time); return i !== null && i > ora + 30 * 60_000 && m.odd_1 && !isPartitaMinore(m.manifestazione, m.squadra1, m.squadra2); })
    .map((m: any) => ({ ...m, livello: leagueTier(m.manifestazione) }))
    .filter((m: any) => m.livello <= 2)
    .sort((a: any, b: any) => a.livello - b.livello || String(a.time).localeCompare(String(b.time)))
    .slice(0, MAX_GEMINI);
  if (!partite.length) { console.log(`[test-regole] gemini: nessuna partita principale da giocare oggi`); return; }
  const elenco = partite.map((m: any, i: number) => `${i + 1}. ${m.squadra1} - ${m.squadra2} (${parseLeagueLabel(m.manifestazione) || m.manifestazione}), ore ${m.time}`).join("\n");
  const prompt = `Partite di calcio di oggi ${oggi.split("-").reverse().join("/")}:\n${elenco}\n\n`
    + "Usa SOLO la ricerca web: non eseguire comandi, non leggere ne' creare file. Analizza ogni partita con la ricerca web (forma, assenti, notizie, quote) e dammi un pronostico per ciascuna, con un mercato semplice da quota 1,40 a 1,80. "
    + "Se una partita non ti convince scrivi \"salta\" come mercato.\n"
    + "Rispondi SOLO con JSON: [{\"n\":1,\"mercato\":\"...\",\"quota\":1.55,\"motivo\":\"una frase\"}]. "
    + "Mercati ammessi, scritti cosi': 1, X, 2, 1X, X2, 12, O1.5, O2.5, O3.5, U2.5, U3.5, GG, NG, combinazioni con + (es. \"X2 + O2.5\", \"1 + GG\"), Multigol (es. \"MG 2-4 ospite\", \"MG 1-3 casa\", \"MG 2-4 totali\").";
  const cwd = `${DIR}agy`; mkdirSync(cwd, { recursive: true });
  const agy = `${process.env.LOCALAPPDATA}\\agy\\bin\\agy.exe`;
  const t0 = Date.now();
  const testo: string = await new Promise((ok) => {
    const p = spawn(agy, ["--model", "gemini-3.8-flash-high", "--output-format", "text", "--print-timeout", "1500s", "--sandbox", "-p", prompt], { cwd });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.stdin.end();
    p.on("close", (c) => { if (c || !out.trim()) console.error(`[test-regole] gemini: agy uscito con ${c}: ${err.slice(-500)}`); ok(out); });
    p.on("error", (e) => { console.error("[test-regole] gemini:", e.message); ok(""); });
  });
  const json = testo.match(/\[[\s\S]*\]/)?.[0];
  let scelte: any[] = [];
  try { scelte = json ? JSON.parse(json) : []; } catch { /* sotto */ }
  if (!Array.isArray(scelte) || !scelte.length) { console.error(`[test-regole] gemini: risposta non leggibile: ${testo.slice(0, 300)}`); return; }
  const pulisci = (mk: string) => String(mk || "").trim().replace(/\bno\s*gol\b/i, "NG").replace(/^gol$/i, "GG").replace(/\bmultigol\b/i, "MG").replace(/\s+-\s+(?=GG|NG|O\d|U\d)/i, " + ");
  for (const s of scelte) {
    const m = partite[Number(s?.n) - 1]; if (!m) continue;
    const grezzo = String(s?.mercato ?? "");
    const mk = /^salta$/i.test(grezzo.trim()) ? null : normalizeMarket(pulisci(grezzo));
    const valutabile = mk ? vince(mk, 1, 1) !== null : false;
    appendFileSync(file, JSON.stringify({
      foto: new Date(ora).toISOString(), id: m.id, day: m.day, time: m.time, lega: m.manifestazione, casa: m.squadra1, ospite: m.squadra2,
      modello: "gemini-3.8-flash-high (agy)", mercato_scritto: grezzo, mk: valutabile ? mk : null, quota: Number(s?.quota) || null, motivo: String(s?.motivo ?? "").slice(0, 300),
    }) + "\n");
  }
  console.log(`[test-regole] gemini ${oggi}: ${scelte.length} scelte su ${partite.length} partite in ${Math.round((Date.now() - t0) / 1000)} s`);
}

/** Controllo a mano su partite gia' giocate: la decisione (con i dati salvati ora) e il risultato. Non salva niente. */
async function prova() {
  for (const id of arg("ids", "").split(",").filter(Boolean)) {
    const [m] = await pgGet(`matches?id=eq.${id}&select=*`);
    const [d] = await pgGet(`dossier_web?match_id=eq.${id}&select=ai:numeri->lettura_ai,pro:numeri->lettura_pro,prog:numeri->programma`);
    const dec = decidi(m, d);
    const fin = /^\d+-\d+$/.test(String(m.result ?? "").trim());
    const [h, a] = fin ? String(m.result).trim().split("-").map(Number) : [NaN, NaN];
    const es = dec.scelta && fin ? (vince(dec.scelta.mk, h, a) ? "VINTA" : "persa") : "da giocare";
    console.log(`${m.squadra1}-${m.squadra2} ${m.result ?? ""} | ${dec.scenario} | ${dec.semaforo} (${dec.motivo}) | scelta ${dec.scelta ? `${dec.scelta.mk} @${dec.scelta.quota} ${(dec.scelta.p * 100).toFixed(0)}%` : "esclusa"} -> ${es} | fasce ${Object.entries(dec.fasce).map(([k, v]: any) => `${k}: ${v ? v.mk + " @" + v.quota : "-"}`).join("; ")}`);
  }
}

const modo = process.argv[2];
if (modo === "fotografa") await fotografa();
else if (modo === "valuta") await valuta();
else if (modo === "prova") await prova();
else if (modo === "gemini") await gemini();
else { console.log("uso: test-regole.mts fotografa [--ore=3] | valuta [--giorno=AAAA-MM-GG] | prova --ids=id1,id2 | gemini [--forza]"); }
process.exit(0);
