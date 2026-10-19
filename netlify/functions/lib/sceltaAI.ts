/**
 * LA SCELTA RAGIONATA DELL'AI (19/10/2026, Rossi: "ok AI").
 *
 * Il ragionamento fatto insieme sulle partite del 18/10, passo per passo:
 *  1. SCENARIO -> solo i pronostici di quello scenario, pagati da 1,40 a 1,60 (+ GG se il book lo paga
 *     sotto 1,60, + quelli dell'incertezza se l'AI non vede un vincitore);
 *  2. IL BOOK -> Over 1,5, Under/Over 2,5 e 3,5, GG/NG dicono quanti gol si aspetta e se segnano entrambe
 *     ("capire se il book ci sta ingannando");
 *  3. DIREZIONE -> quote, risultati e notizie;
 *  4. CHI SEGNA E CHI PRENDE GOL -> ultime 5 dello STESSO tipo di competizione, con gli assenti;
 *  5. SCELTA -> fra le opzioni coerenti, quella che copre piu' risultati realistici (l'1 copre l'1-0, il
 *     GG no; X2 + Over 1,5 copre lo 0-2 che il GG perde).
 * L'elenco delle opzioni lo prepara il programma: l'AI sceglie, non inventa mercati.
 */
import { rowToOdds } from "./supabaseRest";
import { quoteCatalogo, quotaXoppureGG, estimateMarketOdd, structuralAnalysis } from "./clusterEngine";
import { getScenarioNote, pronosticiDelloScenario, chiavePronostico, mgFavoritaEsclusa, isMercatoVietato, evaluateMarketOutcome } from "../../../frontend/src/api";

export type OpzioneGiocabile = { codice: string; nome: string; quota: number; stimata: boolean; soloIncertezza?: boolean };

const REALI: Record<string, string> = { "1": "odd_1", "2": "odd_2", "1X": "odd_1x", X2: "odd_x2", "O2.5": "odd_o25", "U3.5": "odd_u35", GG: "odd_gg" };
const q2 = (x: number | null | undefined) => (x == null || !(Number(x) > 1) ? "n/d" : Number(x).toFixed(2).replace(".", ","));

/** Le opzioni giocabili di una partita (riga di `matches`), con la direzione dell'AI se c'e' gia'. */
export function opzioniGiocabili(m: any, direzioneAI?: string | null, perIlPrompt = false, assenti?: { casa?: number | null; ospite?: number | null } | null): { scenario: string; opzioni: OpzioneGiocabile[] } {
  const odds: any = rowToOdds(m);
  const st: any = (structuralAnalysis(odds, 1.4) as any).structure;
  const nota = getScenarioNote(odds, st);
  const scenario = nota?.scenario ?? "senza scenario";
  const dir = String(direzioneAI || "").trim().toLowerCase();
  // Per il prompt l'AI vede anche i pronostici dell'incertezza (segnati): la direzione la decide lei.
  const chiavi = pronosticiDelloScenario(scenario, odds, perIlPrompt || dir === "nessuna" || dir === "x");
  const delloScenario = pronosticiDelloScenario(scenario, odds, false);
  // GG in ogni scenario quando il book lo paga sotto 1,60 (19/10/2026: "segnano tutte e due").
  if (Number(m.odd_gg) > 1 && Number(m.odd_gg) <= 1.6) chiavi.add(chiavePronostico("GG"));
  // GAP CON LA FAVORITA SENZA 3+ GIOCATORI (19/10/2026, Rossi: "si"; Copenhagen-Aarhus 1-1 senza tre
  // attaccanti): anche la doppia chance + Over 1,5. Archivio con dossier: pareggi 20% contro 15%,
  // 1X/X2 + Over 1,5 77% contro il fisso 73% (128 partite).
  const favCasa = Number(m.odd_1) <= Number(m.odd_2);
  const assFav = Number(favCasa ? assenti?.casa : assenti?.ospite);
  if (scenario.startsWith("Gap Tecnico") && assFav >= 3) {
    const dcO15 = chiavePronostico(favCasa ? "DC 1X + O1.5" : "DC X2 + O1.5");
    chiavi.add(dcO15); delloScenario.add(dcO15);
  }
  const cat: any = quoteCatalogo(odds);
  const nomeDi = (c: string) => c.replace(/\bcasa\b/gi, m.squadra1).replace(/\bospite\b/gi, m.squadra2)
    .replace(/^1$/, `1 (vince ${m.squadra1})`).replace(/^2$/, `2 (vince ${m.squadra2})`)
    .replace(/^1X$/, `1X (${m.squadra1} non perde)`).replace(/^X2$/, `X2 (${m.squadra2} non perde)`);
  const codici = ["1", "2", "1X", "X2", "GG", "O2.5", "U3.5", "X oppure GG", "GG + O2.5",
    "MG 1-3 casa", "MG 2-4 casa", "MG 1-3 ospite", "MG 2-4 ospite", "MG 1-3 totali", "MG 2-4 totali", "MG 3-6 totali",
    "MG 1-3 casa + MG 0-2 ospite", "MG 0-2 casa + MG 1-3 ospite", "DC 1X + O1.5", "DC X2 + O1.5", "DC 1X + GG", "DC X2 + GG"];
  const opzioni: OpzioneGiocabile[] = [];
  for (const c of codici) {
    if (!chiavi.has(chiavePronostico(c)) || isMercatoVietato(c) || mgFavoritaEsclusa(c, scenario, odds)) continue;
    const reale = REALI[c] ? Number(m[REALI[c]]) : null;
    const quota = reale && reale > 1 ? reale : c === "X oppure GG" ? quotaXoppureGG(odds) : cat[c]?.odd ?? estimateMarketOdd(c, odds);
    if (!quota || quota < 1.4 || quota > 1.6 + 1e-9) continue;
    const soloIncertezza = !delloScenario.has(chiavePronostico(c)) && chiavePronostico(c) !== chiavePronostico("GG");
    opzioni.push({ codice: c, nome: nomeDi(c), quota, stimata: !(reale && reale > 1), ...(soloIncertezza ? { soloIncertezza } : {}) });
  }
  return { scenario, opzioni };
}

/**
 * I FATTI GIA' CONTATI (19/10/2026, Rossi: "deve farlo l'AI, senno' a che serve"): il modello gratis
 * sbagliava a contare (Paris FC "3 gol nelle ultime 3" elencandone 4). Il programma conta, l'AI ragiona.
 * Ultime 5 dello stesso tipo di competizione (formaGol), per squadra.
 */
export function testoFatti(forma: any, nomi: { casa: string; ospite: string }): string {
  if (!forma?.casa?.totale?.partite || !forma?.ospite?.totale?.partite) return "";
  const riga = (s: any, nome: string) => {
    const p: any[] = s.totale.partite || [];
    if (!p.length) return `  - ${nome}: nessuna partita`;
    const segn = p.filter((x) => x.fatti > 0).length, sub = p.filter((x) => x.subiti > 0).length;
    const gg = p.filter((x) => x.fatti > 0 && x.subiti > 0).length, o25 = p.filter((x) => x.fatti + x.subiti >= 3).length;
    const fatti = p.reduce((a, x) => a + x.fatti, 0), subiti = p.reduce((a, x) => a + x.subiti, 0);
    const v = p.filter((x) => x.fatti > x.subiti).length, n = p.filter((x) => x.fatti === x.subiti).length;
    return `  - ${nome} (ultime ${p.length}): ha segnato in ${segn}/${p.length}, ha preso gol in ${sub}/${p.length}, GG in ${gg}/${p.length}, almeno 3 gol in ${o25}/${p.length}; ` +
      `${fatti} gol fatti e ${subiti} subiti; ${v} vinte, ${n} pari, ${p.length - v - n} perse (${p.map((x) => `${x.in_casa ? "" : "@"}${x.avversario} ${x.fatti}-${x.subiti}`).join(", ")})`;
  };
  const tipo = forma.tipo ? `partite di ${forma.tipo} come questa` : "tutte le competizioni";
  return `\nFATTI GIA' CONTATI DAL PROGRAMMA (${tipo}; usali cosi', non ricontare):\n${riga(forma.casa, nomi.casa)}\n${riga(forma.ospite, nomi.ospite)}`;
}

/** Il blocco da aggiungere al testo della partita: lettura del book e opzioni giocabili. */
export function testoScelta(m: any, direzioneAI?: string | null, assenti?: { casa?: number | null; ospite?: number | null } | null): { testo: string; opzioni: OpzioneGiocabile[]; scenario: string } {
  const { scenario, opzioni } = opzioniGiocabili(m, direzioneAI, true, assenti);
  const riga = (l: OpzioneGiocabile[]) => l.length
    ? l.map((o) => `     - ${o.codice} = ${o.nome} @${q2(o.quota)}${o.stimata ? " (quota stimata)" : ""}`).join("\n")
    : "     (nessuna)";
  const testo = `
LETTURA DEL BOOK (quote dei gol):
  Over 1,5 ${q2(m.odd_o15)} · Under 2,5 ${q2(m.odd_u25)} / Over 2,5 ${q2(m.odd_o25)} · Under 3,5 ${q2(m.odd_u35)} / Over 3,5 ${q2(m.odd_o35)} · GG ${q2(m.odd_gg)} / NG ${q2(m.odd_ng)}
  1X2: 1 ${q2(m.odd_1)} · X ${q2(m.odd_x)} · 2 ${q2(m.odd_2)} · 1X ${q2(m.odd_1x)} · X2 ${q2(m.odd_x2)}
SCENARIO DEL PROGRAMMA: ${scenario}
OPZIONI GIOCABILI (pagate da 1,40 a 1,60; scegli SOLO fra queste, scrivendo il codice esatto):
  A) SEMPRE GIOCABILI (pronostici dello scenario):
${riga(opzioni.filter((o) => !o.soloIncertezza))}
  B) IN PIU', SOLO SE AL PASSO 3 NON C'E' UN VINCITORE:
${riga(opzioni.filter((o) => o.soloIncertezza))}`;
  return { testo, opzioni, scenario };
}

export const SISTEMA_SCELTA = `Sei un analista di calcio che sceglie UNA giocata per uno scommettitore, in italiano semplice.
Hai SOLO i dati qui sotto, raccolti PRIMA della partita. Non inventare niente: se un numero non c'e', non scriverlo.
Ragiona in questi 5 passi, nell'ordine:
1. SCENARIO: e' gia' scritto (Gap Tecnico, Gap falso, Progressione, Equilibrio). Le opzioni sono gia' solo quelle dello scenario.
2. IL BOOK: leggi la LETTURA DEL BOOK. Over 1,5 molto basso = almeno 2 gol quasi sicuri. Under 3,5 basso o Under e Over 3,5 vicini = il book NON crede a 4 o piu' gol. Over 3,5 sotto 1,60 = goleada possibile. GG basso (sotto 1,60) = segnano tutte e due. Scrivi la fascia di gol che il book si aspetta (es. "2-4 gol, segnano entrambe").
3. DIREZIONE: chi non perde secondo quote, ultime partite e notizie. Se non e' chiara, dillo.
4. CHI SEGNA E CHI PRENDE GOL, usando i FATTI GIA' CONTATI DAL PROGRAMMA (se la favorita ha assenti pesanti in ATTACCO, il pareggio diventa piu' probabile: se fra le opzioni c'e' la doppia chance + Over 1,5, preferiscila al segno secco): per OGNUNA delle due squadre, dalle ultime partite DELLO STESSO TIPO (campionato, coppa...) scrivi in quante ha segnato, in quante ha preso gol, e i gol fatti/subiti, copiando i numeri dai dati. Assenti in attacco = segna meno; assenti in difesa = prende di piu'. Se un'impressione va contro i numeri o contro il book, valgono i numeri e il book.
5. SCELTA: fra le OPZIONI GIOCABILI tieni quelle coerenti con i passi 2, 3 e 4, e scegli quella che COPRE PIU' RISULTATI realistici (esempi: "1" copre anche l'1-0, il GG no; "X2 + Over 1,5" copre lo 0-2 che il GG perde; senza direzione si gioca la fascia di gol del book). Se nessuna e' coerente rispondi "nessuna".
Regole sulla giocata: SOLO un codice dell'elenco OPZIONI GIOCABILI, scritto esattamente (mai mercati fuori elenco, anche se ti sembrano migliori). Le quote "stimate" sono affidabili: non scartare un'opzione perche' la quota e' stimata. Le opzioni del gruppo A valgono sempre, con o senza vincitore. Quelle del gruppo B si aggiungono solo se al passo 3 non trovi un vincitore. Una giocata NON deve coprire tutti i risultati possibili: basta che vinca con i risultati piu' probabili della tua lettura (es. MG 2-4 totali va bene se ti aspetti 2-3 gol, anche se comprende il 4). "nessuna" SOLO se ogni opzione perde con il risultato che ritieni piu' probabile.
Direzione, gol, risultati probabili e giocata devono essere coerenti fra loro.
La "giocata" e' OBBLIGATORIA: scrivi sempre un codice dell'elenco (o "nessuna" solo nel caso detto sopra), mai vuota.
Rispondi SOLO con questo JSON:
{"direzione":"1|X|2|nessuna","gol_casa":"min-max","gol_ospite":"min-max","gol_totali":"min-max","forma_e_quote":"d'accordo|non d'accordo","notizia":"l'assenza o il fatto che conta, o stringa vuota","risultati_probabili":["a-b","a-b","a-b"],"come_stanno":"2 frasi, una per squadra, con i numeri delle ultime partite dello stesso tipo","ragionamento":{"book":"passo 2 in una frase","direzione":"passo 3 in una frase","segnano":"passo 4 con i numeri","scelta":"passo 5: perche' questa e non le altre"},"giocata":"codice esatto dall'elenco, oppure nessuna","lettura":"3-4 frasi semplici: chi e' favorita, chi segna, chi prende gol, che partita aspettarsi"}`;

/**
 * CONTROLLO DELLA SCELTA (19/10/2026, Rossi: "ok"; Lorient-Monaco: l'AI diceva "vince il Monaco" 0-2,
 * 1-2, 1-3 e sceglieva X o GG, che perde lo 0-2). La giocata deve vincere in almeno 2 dei 3 risultati
 * attesi dell'AI; le opzioni "solo incertezza" valgono solo se l'AI non vede un vincitore. Se la scelta
 * non passa, si prende fra le opzioni quella che vince in piu' risultati attesi (a parita', la quota
 * piu' bassa, cioe' la piu' probabile per il book). null se nessuna passa.
 */
export function controllaScelta(
  scelta: OpzioneGiocabile | null, opzioni: OpzioneGiocabile[], risultati: unknown, direzione: unknown,
): { giocata: OpzioneGiocabile | null; corretta: boolean } {
  const ris = (Array.isArray(risultati) ? risultati : []).map((r) => String(r).replace(/\s/g, "")).filter((r) => /^\d+-\d+$/.test(r));
  if (ris.length < 3) return { giocata: scelta, corretta: false };
  const dir = String(direzione || "").trim().toLowerCase();
  const senzaVincitore = dir === "nessuna" || dir === "x";
  const vite = (o: OpzioneGiocabile) => ris.filter((r) => evaluateMarketOutcome(o.codice, r) === true).length;
  const ammessa = (o: OpzioneGiocabile) => (senzaVincitore || !o.soloIncertezza) && vite(o) >= 2;
  if (scelta && ammessa(scelta)) return { giocata: scelta, corretta: false };
  const migliore = opzioni.filter(ammessa).sort((a, b) => vite(b) - vite(a) || a.quota - b.quota)[0] ?? null;
  return { giocata: migliore, corretta: true };
}

/** La giocata dell'AI e' valida solo se e' una delle opzioni giocabili. */
export function giocataValida(giocata: unknown, opzioni: OpzioneGiocabile[]): OpzioneGiocabile | null {
  // Il modello a volte ricopia la riga intera ("X oppure GG = X oppure GG @1,55 (quota stimata)"): conta il codice.
  const g = String(giocata || "").split(/\s=\s|\s@|\s\(/)[0].trim();
  if (!g || /^nessuna$/i.test(g)) return null;
  // Anche scritta con il nome ("MG 1-3 Lorient" invece di "MG 1-3 casa").
  const semplice = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  return opzioni.find((o) => chiavePronostico(o.codice) === chiavePronostico(g) || semplice(o.nome) === semplice(g)) ?? null;
}
