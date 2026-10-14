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
 * Uscita: server-locale/test-regole/ (foto-AAAA-MM-GG.jsonl, report-AAAA-MM-GG.md, riepilogo.md).
 */
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pgGet, rowToOdds } from "../netlify/functions/lib/supabaseRest";
import { fullDistribution, deriveLambdas, quoteCatalogo, quotaXoppureGG, structuralAnalysis } from "../netlify/functions/lib/clusterEngine";
import { evaluateMarket } from "../netlify/functions/lib/marketEval";
import { getScenarioNote, inizioPartitaMs } from "../frontend/src/api";

const DIR = fileURLToPath(new URL("../server-locale/test-regole/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const giornoRoma = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
const FASCE = [{ nome: "1,40", da: 1.40, a: 1.50 }, { nome: "1,50", da: 1.50, a: 1.60 }, { nome: "1,60", da: 1.60, a: 1.75 }, { nome: "1,75", da: 1.75, a: 1.96 }];
const REALI: Record<string, string> = { "1": "odd_1", X: "odd_x", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "12": "odd_12", "O1.5": "odd_o15", "O2.5": "odd_o25", "U2.5": "odd_u25", "U3.5": "odd_u35", GG: "odd_gg", NG: "odd_ng" };
const vince = (mk: string, h: number, a: number): boolean | null =>
  /^x\s+(oppure|o)\s+gg$/i.test(mk.trim()) ? h === a || (h > 0 && a > 0) : evaluateMarket(mk, h, a);
const risultati = (l: any): number[][] => (l?.risultati_probabili || [])
  .map((r: string) => String(r).replace(/\s/g, "").split("-").map(Number)).filter((x: number[]) => x.length === 2 && x.every(Number.isFinite));

type Voce = { mk: string; quota: number; stimata: boolean; p: number };

/** La decisione con le regole del 14/10. Nessun effetto collaterale. */
export function decidi(m: any, d: any) {
  const odds: any = rowToOdds(m);
  const st: any = (structuralAnalysis(odds, 1.4) as any).structure;
  const nota = getScenarioNote(odds, st);
  const casaFav = Number(m.odd_1) <= Number(m.odd_2), favQ = Math.min(Number(m.odd_1), Number(m.odd_2));
  let scenario = nota?.scenario || "senza scenario";
  if (scenario === "Gap Tecnico") scenario += favQ <= 1.35 ? " - favorita fortissima" : " - favorita netta";
  const g = fullDistribution({} as any, 10, deriveLambdas(odds) as [number, number]);
  const cat = quoteCatalogo(odds);
  const voce = (mk: string): Voce | null => {
    const reale = REALI[mk] ? Number(m[REALI[mk]]) || null : null;
    const quota = mk === "X oppure GG" ? quotaXoppureGG(odds) : reale ?? cat[mk]?.odd ?? null;
    if (!quota) return null;
    const p = g.reduce((s: number, c: any) => s + (vince(mk, c.home, c.away) ? c.p : 0), 0);
    return { mk, quota, stimata: mk === "X oppure GG" || !reale, p: +p.toFixed(4) };
  };
  const F = casaFav
    ? { segno: "1", dc: "1X", dcO15: "DC 1X + O1.5", mg13: "MG 1-3 casa", mg24: "MG 2-4 casa", mg12: "MG 1-2 casa", combo: "MG 1-3 casa + MG 0-2 ospite", u45: "1 + U4.5" }
    : { segno: "2", dc: "X2", dcO15: "DC X2 + O1.5", mg13: "MG 1-3 ospite", mg24: "MG 2-4 ospite", mg12: "MG 1-2 ospite", combo: "MG 0-2 casa + MG 1-3 ospite", u45: "2 + U4.5" };
  const favDir = casaFav ? "1" : "2";
  // Lettura AI: quella "Pro" se c'e', altrimenti la gratis
  const l = d?.pro?.direzione ? d.pro : d?.ai;
  const dir = String(l?.direzione || "").trim().toLowerCase();
  const ris = risultati(l);
  const vC = ris.filter((r) => r[0] > r[1]).length, vO = ris.filter((r) => r[1] > r[0]).length;
  const dirRis = vC >= 2 ? "1" : vO >= 2 ? "2" : "nessuna";
  const coerente = !l ? null : ris.length < 3 ? null : (dir === "nessuna" || dir === "" ? dirRis === "nessuna" : dir === dirRis);
  const assFav = Number(casaFav ? d?.prog?.assenti_casa : d?.prog?.assenti_ospite);
  const avvisoGol = Number.isFinite(assFav) && assFav >= 5;
  let semaforo: "verde" | "giallo" | "rosso" | "grigio", motivo: string, candidati: string[];
  if (!l) { semaforo = "grigio"; motivo = "senza lettura AI: solo scenario"; candidati = scenario === "Equilibrio" ? [F.dc, "X oppure GG"] : [F.dcO15, F.segno, F.combo]; }
  else if (coerente === false || (["1", "2"].includes(dir) && dir !== favDir)) {
    semaforo = "rosso"; motivo = coerente === false ? "lettura incoerente (direzione diversa dai suoi risultati)" : "lettura contro il bookmaker"; candidati = ["O2.5", "GG"];
  } else if (dir === "nessuna" || dir === "" || dir === "x") {
    semaforo = "giallo"; motivo = "lettura senza direzione"; candidati = scenario === "Equilibrio" ? ["X oppure GG", "GG", F.dc] : [F.dcO15, F.dc, F.combo];
  } else {
    semaforo = "verde"; motivo = "lettura coerente e d'accordo con il bookmaker";
    candidati = scenario === "Equilibrio" ? [F.dc, "MG 2-4 totali", F.segno]
      : scenario === "Progressione" ? [F.dcO15, F.segno, F.combo, F.mg24]
      : scenario.endsWith("favorita netta") ? [F.segno, F.dcO15, F.mg24, "O2.5"]
      : [F.mg13, F.mg24, F.u45, "NG"];
  }
  if (avvisoGol) candidati = candidati.filter((c) => !["GG", "O2.5", "MG 3-6 totali", "GG + O2.5"].includes(c));
  const voci = candidati.map(voce).filter((v): v is Voce => !!v);
  const fasce: Record<string, Voce | null> = {};
  for (const f of FASCE) {
    const dentro = voci.filter((v) => v.quota >= f.da && v.quota < f.a);
    fasce[f.nome] = dentro.sort((a, b) => b.p - a.p || candidati.indexOf(a.mk) - candidati.indexOf(b.mk))[0] ?? null;
  }
  const centrali = [fasce["1,50"], fasce["1,60"]].filter((v): v is Voce => !!v).sort((a, b) => b.p - a.p);
  const scelta = centrali[0] ?? fasce["1,40"] ?? fasce["1,75"] ?? null;
  return {
    scenario, favorita: casaFav ? m.squadra1 : m.squadra2, favQ,
    lettura: l ? { modello: l.modello ?? null, dir: dir || "n/d", ris: l.risultati_probabili ?? [] } : null,
    coerente, assentiFavorita: Number.isFinite(assFav) ? assFav : null, avvisoGol,
    semaforo, motivo: scelta ? motivo : `${motivo}; nessuna giocata delle regole fra 1,40 e 1,95 -> esclusa`,
    candidati, fasce, scelta,
  };
}

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
  const t = (o: Record<string, Conto>) => Object.entries(o).sort().map(([k, c]) => `| ${k} | ${pc(c)} | ${qm(c)} |`).join("\n");
  writeFileSync(`${DIR}riepilogo.md`, [
    `# Test regole · riepilogo (${giorniN} giorni con risultati, aggiornato ${new Date().toISOString().slice(0, 16)})`, "",
    "| Chi sceglie | Vinte | Quota media |", "|---|---|---|",
    `| **Regole (scelta principale)** | ${pc(tot.regole)} | ${qm(tot.regole)} |`,
    `| App: consigliato | ${pc(tot.consigliato)} | ${qm(tot.consigliato)} |`,
    `| App: Schedina (pick_finale) | ${pc(tot.schedina)} | - |`,
    `| Escluse dalle regole: come e' andata la Schedina | ${pc(tot.escluse)} | - |`,
    `| App "da lasciare": se giocate | ${pc(tot.dalasciare)} | - |`, "",
    "## Regole per semaforo", "| Semaforo | Vinte | Quota media |", "|---|---|---|", t(perSem), "",
    "## Regole per scenario", "| Scenario | Vinte | Quota media |", "|---|---|---|", t(perScen), "",
    "## Regole per fascia (la migliore di ogni fascia)", "| Fascia | Vinte | Quota media |", "|---|---|---|", t(perFascia), "",
  ].join("\n"));
  console.log(`[test-regole] riepilogo: regole ${pc(tot.regole)}, consigliato ${pc(tot.consigliato)}, schedina ${pc(tot.schedina)}`);
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
else { console.log("uso: test-regole.mts fotografa [--ore=3] | valuta [--giorno=AAAA-MM-GG] | prova --ids=id1,id2"); }
process.exit(0);
