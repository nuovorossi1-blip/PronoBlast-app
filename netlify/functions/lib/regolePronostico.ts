/**
 * PRONOSTICO REGOLE: scenario + lettura AI (14/10/2026, Rossi). Nessun effetto collaterale.
 *
 * Il metodo deciso il 14/10 (Desktop\report-analisi pronosblast\regole-per-scenario.md). Lo usano
 * il test giornaliero (scripts/test-regole.mts) e la scheda partita (funzione /regole), accanto al
 * consigliato SENZA sostituirlo: si decide dopo il test quale dei due vale.
 *
 * Semaforo (misure del 14/10 su 1.435 partite con dossier):
 *  - verde: lettura AI coerente e con la stessa direzione del bookmaker -> direzione (tabella scenario);
 *  - giallo: lettura senza direzione -> Equilibrio: X o GG; altrimenti doppia chance (+ O1.5);
 *    anche "la favorita non perde" (risultati con vittorie e pareggi) -> doppia chance;
 *  - rosso: lettura incoerente (direzione diversa dai suoi 3 risultati) o contro il bookmaker ->
 *    niente favorita, solo gol (O2.5, GG), altrimenti esclusa;
 *  - avviso gol: favorita con 5+ assenti -> niente GG/Over (GG -11, O2.5 -9 sulle quote), TRANNE
 *    favorita forte (quota 1,50 o meno) nelle coppe europee: segna quasi 3 gol a partita anche
 *    senza titolari (versione 2, 15/10: Liverpool 6 assenti, 3-6 a Linz);
 *  - campionato da pochi gol (media 2,5 o meno nell'archivio): niente "la favorita segna 2+"
 *    (MG 2-4 favorita) ne' Over 2,5: favorita 2+ gol -9,4, Over -3,7 sulle quote (versione 2).
 * Il contrasto forma/quote NON esclude (la favorita va meglio, +4,8). Mai mercati larghi di ripiego.
 */
import { rowToOdds } from "./supabaseRest";
import { fullDistribution, deriveLambdas, quoteCatalogo, quotaXoppureGG, structuralAnalysis, estimateMarketOdd } from "./clusterEngine";
import { evaluateMarket } from "./marketEval";
import { getScenarioNote } from "../../../frontend/src/api";

export const VERSIONE_REGOLE = 4;

/** Campionati con media 2,5 gol o meno (almeno 40 partite nell'archivio, misura del 15/10/2026). */
export const LEGHE_POCHI_GOL = new Set([
  "ARG1", "ARG2", "ARG3", "URU1", "URU2", "FIN1", "SCO2", "PAR1", "EGI1", "POR2", "FRA3",
  "COL1", "COL2", "ING4", "CIL2", "TUR2", "BRA2", "BRA3", "EURONLG", "ECU1",
]);
const COPPE_EUROPEE = /^(EUCHL|EUEL|EUCONFL)/;

export const FASCE = [{ nome: "1,40", da: 1.40, a: 1.50 }, { nome: "1,50", da: 1.50, a: 1.60 }, { nome: "1,60", da: 1.60, a: 1.75 }, { nome: "1,75", da: 1.75, a: 1.96 }];
const REALI: Record<string, string> = { "1": "odd_1", X: "odd_x", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "12": "odd_12", "O1.5": "odd_o15", "O2.5": "odd_o25", "U2.5": "odd_u25", "U3.5": "odd_u35", GG: "odd_gg", NG: "odd_ng" };

export const vinceRegole = (mk: string, h: number, a: number): boolean | null =>
  /^x\s+(oppure|o)\s+gg$/i.test(mk.trim()) ? h === a || (h > 0 && a > 0) : evaluateMarket(mk, h, a);

const risultati = (l: any): number[][] => (l?.risultati_probabili || [])
  .map((r: string) => String(r).replace(/\s/g, "").split("-").map(Number)).filter((x: number[]) => x.length === 2 && x.every(Number.isFinite));

export type VoceRegole = { mk: string; quota: number; stimata: boolean; p: number };
export type Semaforo = "verde" | "giallo" | "rosso" | "grigio";

/**
 * m = riga di `matches` (con squadra1/2, manifestazione e quote);
 * d = { ai: numeri.lettura_ai, pro: numeri.lettura_pro, prog: numeri.programma }.
 */
export function decidi(m: any, d: any) {
  const odds: any = rowToOdds(m);
  const st: any = (structuralAnalysis(odds, 1.4) as any).structure;
  const nota = getScenarioNote(odds, st);
  const casaFav = Number(m.odd_1) <= Number(m.odd_2), favQ = Math.min(Number(m.odd_1), Number(m.odd_2));
  let scenario = nota?.scenario || "senza scenario";
  if (scenario === "Gap Tecnico") scenario += favQ <= 1.35 ? " - favorita fortissima" : " - favorita netta";
  const g = fullDistribution({} as any, 10, deriveLambdas(odds) as [number, number]);
  const cat = quoteCatalogo(odds);
  const voce = (mk: string): VoceRegole | null => {
    const reale = REALI[mk] ? Number(m[REALI[mk]]) || null : null;
    const quota = mk === "X oppure GG" ? quotaXoppureGG(odds) : reale ?? cat[mk]?.odd ?? estimateMarketOdd(mk, odds) ?? null;
    if (!quota) return null;
    const p = g.reduce((s: number, c: any) => s + (vinceRegole(mk, c.home, c.away) ? c.p : 0), 0);
    return { mk, quota, stimata: mk === "X oppure GG" || !reale, p: +p.toFixed(4) };
  };
  const F = casaFav
    ? { segnoO15: "1 + O1.5", segnoO25: "1 + O2.5", segno: "1", dc: "1X", dcO15: "DC 1X + O1.5", mg13: "MG 1-3 casa", mg24: "MG 2-4 casa", mg12: "MG 1-2 casa", combo: "MG 1-3 casa + MG 0-2 ospite", u45: "1 + U4.5" }
    : { segnoO15: "2 + O1.5", segnoO25: "2 + O2.5", segno: "2", dc: "X2", dcO15: "DC X2 + O1.5", mg13: "MG 1-3 ospite", mg24: "MG 2-4 ospite", mg12: "MG 1-2 ospite", combo: "MG 0-2 casa + MG 1-3 ospite", u45: "2 + U4.5" };
  const favDir = casaFav ? "1" : "2";
  // Lettura AI: quella "Pro" se c'e', altrimenti la gratis
  const l = d?.pro?.direzione ? d.pro : d?.ai;
  const dir = String(l?.direzione || "").trim().toLowerCase();
  const ris = risultati(l);
  const vC = ris.filter((r) => r[0] > r[1]).length, vO = ris.filter((r) => r[1] > r[0]).length;
  const dirRis = vC >= 2 ? "1" : vO >= 2 ? "2" : "nessuna";
  const coerente = !l ? null : ris.length < 3 ? null : (dir === "nessuna" || dir === "" ? dirRis === "nessuna" : dir === dirRis);
  const assFav = Number(casaFav ? d?.prog?.assenti_casa : d?.prog?.assenti_ospite);
  const lega = String(m.manifestazione || "").toUpperCase().trim();
  const fortInCoppa = favQ <= 1.5 && COPPE_EUROPEE.test(lega);
  const avvisoGol = Number.isFinite(assFav) && assFav >= 5 && !fortInCoppa;
  const pochiGol = LEGHE_POCHI_GOL.has(lega);
  let semaforo: Semaforo, motivo: string, candidati: string[];
  // "Non perde" (14/10/2026, Roma-Real: direzione 2 ma risultati 1-2, 1-1, 2-2): la squadra della
  // direzione non perde in nessuno dei 3 risultati -> lettura coerente con la doppia chance, non incoerente.
  const nonPerde = ["1", "2"].includes(dir) && ris.length === 3 && ris.every((r) => (dir === "1" ? r[0] >= r[1] : r[1] >= r[0]));
  if (!l) { semaforo = "grigio"; motivo = "senza lettura AI: solo scenario"; candidati = scenario === "Equilibrio" ? [F.dc, "X oppure GG"] : [F.dcO15, F.segno, F.combo]; }
  else if (coerente === false && nonPerde && dir === favDir) {
    semaforo = "giallo"; motivo = "lettura 'la favorita non perde' (vince o pareggia nei suoi risultati)"; candidati = [F.dcO15, F.dc, F.combo];
  }
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
  const avvisi: string[] = [];
  // VERSIONE 3 (15/10/2026, Rossi: "dipende dallo scenario e dalla forma: quanti gol possono fare e
  // subire"). Forma pesata del programma: golFav = (fatti favorita + subiti sfavorita)/2, golSfav al
  // contrario; partite finite con dossier, campioni da 24 a 160 (da confermare con il test):
  //  - Equilibrio molto aperta (forma 3,4+ gol): Over 65% contro 60% delle quote -> O2.5 / MG 3-6;
  //    chiusa (sotto 2,2): X o GG 65%, GG 60% contro 48% delle quote.
  //  - Gap: favorita tanto (2,2+) e sfavorita segna (1,2+) -> GG 72%; favorita tanto e sfavorita poco
  //    -> segno + U4.5 63% @1,90; favorita poco (<1,6) e sfavorita poco -> segno 84%; favorita poco e
  //    sfavorita segna -> MG 1-3 favorita 81%, GG 63%; favorita media -> niente GG ne' MG 2-4 favorita.
  //  - Progressione: favorita tanto -> segno 76% @1,75; media e sfavorita segna -> MG 2-4 favorita 61%
  //    @1,87; media e sfavorita poco -> segno 63%; favorita poco e sfavorita poco -> GG 59%, DC + O1.5
  //    67% (il segno 45%).
  const pc = d?.prog?.pesata_casa, po = d?.prog?.pesata_ospite;
  if (semaforo !== "rosso" && pc && po) {
    const pF = casaFav ? pc : po, pS = casaFav ? po : pc;
    const golFav = (pF.fatti + pS.subiti) / 2, golSfav = (pS.fatti + pF.subiti) / 2, golTot = golFav + golSfav;
    const tanto = golFav >= 2.2, poco = golFav < 1.6, sfSegna = golSfav >= 1.2;
    let mappa: string[] | null = null, perche = "";
    if (scenario === "Equilibrio") {
      if (golTot >= 3.4) { mappa = ["O2.5", "MG 3-6 totali", "X oppure GG"]; perche = `partita aperta: la forma dice ${golTot.toFixed(1)} gol`; }
      else if (golTot < 2.2) { mappa = ["X oppure GG", "GG"]; perche = `partita chiusa: la forma dice ${golTot.toFixed(1)} gol`; }
    } else if (scenario.startsWith("Gap Tecnico")) {
      if (tanto && sfSegna) { mappa = ["GG", F.dcO15]; perche = "la favorita segna tanto e la sfavorita segna"; }
      else if (tanto) { mappa = [F.u45, F.segno]; perche = "la favorita segna tanto, la sfavorita poco"; }
      else if (poco && !sfSegna) { mappa = [F.segno, F.u45]; perche = "partita bloccata: vince la favorita di misura"; }
      else if (poco) { mappa = [F.mg13, "GG"]; perche = "la favorita segna poco, la sfavorita segna"; }
      else { mappa = candidati.filter((c) => c !== "GG" && c !== F.mg24); perche = "forma media: niente GG né MG 2-4 della favorita"; }
    } else if (scenario === "Progressione") {
      if (tanto) { mappa = [F.segno, F.dcO15]; perche = "la favorita segna tanto"; }
      else if (!poco && sfSegna) { mappa = [F.mg24, F.segno]; perche = "la favorita segna, la sfavorita anche"; }
      else if (!poco) { mappa = [F.segno, F.dcO15]; perche = "la favorita segna, la sfavorita poco"; }
      else if (!sfSegna) { mappa = ["GG", F.dcO15]; perche = "segnano poco tutte e due: niente segno"; }
    }
    if (mappa?.length) { candidati = mappa; avvisi.push(`forma: ${perche}`); }
  }
  // VERSIONE 4: COPPE EUROPEE (15/10/2026, Rossi: "considera che sono partite di coppa"). Archivio
  // Champions/Europa/Conference, alle quote GIOCABILI (da 1,40, quote stimate dall'app): favorita a 1,35
  // o meno: segno + O2.5 56% @1,72 (resa -6%), segno + O1.5 57%, segno + U4.5 53%, MG 1-3 favorita 54%:
  // niente conviene davvero (le grandi fanno goleada); 1,36-1,55: segno + O1.5 59% @1,76 (+2%), segno 64%
  // @1,49; 1,56-1,85: segno 63% @1,71 (+8%), segno + Over 33-42%, MG 1-3 favorita sempre sotto 1,40.
  if (COPPE_EUROPEE.test(lega) && semaforo !== "rosso" && favQ <= 1.85) {
    // La mappa della forma (v3) non vale qui: la sostituisce la misura sulle coppe.
    for (let i = avvisi.length - 1; i >= 0; i--) if (avvisi[i].startsWith("forma: ")) avvisi.splice(i, 1);
    if (favQ <= 1.35) { candidati = [F.segnoO25, F.segnoO15]; avvisi.push("coppa europea, favorita fortissima: 1 + Over, ma nelle coppe a queste quote niente ha vantaggio (1 + Over 2,5 al 56%)"); }
    else if (favQ <= 1.55) { candidati = [F.segnoO15, F.segno, F.mg13]; avvisi.push("coppa europea, favorita forte: 1 + Over 1,5 (coppe: 59% a 1,76)"); }
    else { candidati = [F.segno, F.mg13]; avvisi.push("coppa europea, favorita leggera: segno secco (coppe: 63% a 1,71; 1 + Over solo 33-42%)"); }
  }
  if (avvisoGol) { candidati = candidati.filter((c) => !["GG", "O2.5", "MG 3-6 totali", "GG + O2.5"].includes(c)); avvisi.push(`favorita con ${assFav} assenti: niente GG e Over`); }
  else if (fortInCoppa && Number.isFinite(assFav) && assFav >= 5) avvisi.push(`favorita forte in coppa: ${assFav} assenti ma l'Over resta (segnano comunque)`);
  if (pochiGol) { candidati = candidati.filter((c) => c !== F.mg24 && c !== "O2.5"); avvisi.push("campionato da pochi gol: niente MG 2-4 della favorita né Over 2,5"); }
  const voci = candidati.map(voce).filter((v): v is VoceRegole => !!v);
  const fasce: Record<string, VoceRegole | null> = {};
  for (const f of FASCE) {
    const dentro = voci.filter((v) => v.quota >= f.da && v.quota < f.a);
    fasce[f.nome] = dentro.sort((a, b) => b.p - a.p || candidati.indexOf(a.mk) - candidati.indexOf(b.mk))[0] ?? null;
  }
  const centrali = [fasce["1,50"], fasce["1,60"]].filter((v): v is VoceRegole => !!v).sort((a, b) => b.p - a.p);
  const scelta = centrali[0] ?? fasce["1,40"] ?? fasce["1,75"] ?? null;
  // Le ragioni in parole semplici per il riquadro "Cosa giocare" della scheda (15/10/2026).
  const risTxt = l?.risultati_probabili?.length ? ` (${l.risultati_probabili.join(", ")})` : "";
  const nomeFav = casaFav ? m.squadra1 : m.squadra2;
  const ragioni: { ok: boolean; t: string }[] = [{ ok: true, t: `Favorita per le quote: ${nomeFav} a ${favQ.toFixed(2).replace(".", ",")}` }];
  if (semaforo === "verde") ragioni.push({ ok: true, t: `La lettura AI è d'accordo${risTxt}` });
  else if (semaforo === "giallo" && motivo.startsWith("lettura 'la favorita non perde'")) ragioni.push({ ok: true, t: `La lettura AI: ${nomeFav} non perde${risTxt}` });
  else if (semaforo === "giallo") ragioni.push({ ok: false, t: `La lettura AI non dà un vincitore${risTxt}: giocata prudente` });
  else if (semaforo === "rosso") ragioni.push({ ok: false, t: `${motivo === "lettura contro il bookmaker" ? "La lettura AI va contro le quote" : "La lettura AI si contraddice"}${risTxt}: solo gol` });
  else ragioni.push({ ok: false, t: "Senza lettura AI: solo scenario" });
  for (const a of avvisi) {
    const t = a.replace(/^forma: /, "Forma: ");
    ragioni.push({ ok: !/niente/.test(a) || /resta/.test(a), t: t.charAt(0).toUpperCase() + t.slice(1) });
  }
  return {
    versione: VERSIONE_REGOLE,
    scenario, favorita: casaFav ? m.squadra1 : m.squadra2, favQ,
    lettura: l ? { modello: l.modello ?? null, dir: dir || "n/d", ris: l.risultati_probabili ?? [] } : null,
    coerente, assentiFavorita: Number.isFinite(assFav) ? assFav : null, avvisoGol, pochiGol, avvisi,
    semaforo, motivo: scelta ? motivo : `${motivo}; nessuna giocata delle regole fra 1,40 e 1,95 -> esclusa`,
    candidati, fasce, scelta, ragioni,
  };
}

export type DecisioneRegole = ReturnType<typeof decidi>;
