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

export type OpzioneGiocabile = { codice: string; nome: string; quota: number; stimata: boolean; soloIncertezza?: boolean; soloCopertura?: boolean };

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
    // X o GG e' la giocata "di sicurezza": vale solo se il book la paga almeno 1,62 (Rossi 19/10/2026,
    // Paris FC-Rennes: "per X o GG serve la quota 1,62, senno' ripiega in GG"). Le altre da 1,40 a 1,60.
    const xogg = c === "X oppure GG";
    if (!quota || (xogg ? quota < 1.62 || quota > 1.9 : quota < 1.4 || quota > 1.6 + 1e-9)) continue;
    const soloIncertezza = !delloScenario.has(chiavePronostico(c)) && chiavePronostico(c) !== chiavePronostico("GG");
    // Nel Gap la doppia chance + Over 1,5 c'e' solo per gli assenti: e' una copertura, non un pick principale (Rossi 19/10).
    const soloCopertura = scenario.startsWith("Gap Tecnico") && /^DC (1X|X2) \+ O1\.5$/.test(c);
    opzioni.push({ codice: c, nome: nomeDi(c), quota, stimata: !(reale && reale > 1), ...(soloIncertezza ? { soloIncertezza } : {}), ...(soloCopertura ? { soloCopertura } : {}) });
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
COME SI LEGGONO LE QUOTE (regole del proprietario):
- Doppia chance: quella piu' bassa (1X o X2) indica da che parte pende la partita; se e' sotto 1,40 non ha valore, non rischiarla.
- Over 1,5 basso = almeno 2 gol. Over 2,5 = via di mezzo. Under 3,5 sotto 1,50 = partita non troppo esplosiva, da 2 a 4 (forse 5) gol.
- Over 1,5 e Under 3,5 molto simili, e Over/Under 2,5 vicini = il book NON sa quanti gol: non si gioca sulla quantita' di gol, si guarda chi puo' segnare.
- GG basso (sotto 1,60) e AI/numeri che dicono "segnano entrambe" = GG. GG a 1,70 o piu' = il book non e' sicuro; GG a 1,80 o piu' = il book dice NO al GG: anche se le notizie o la tua impressione dicono GG, vale il book.
- Partita complicata (notizie contro la favorita, direzione non precisa, gol nella fascia 2-4): si ripiega sulla giocata che copre piu' risultati, di solito MG 2-4 totali.
- Partita a ritmi bassi (il book dice che non segnano entrambe: GG alto e NG basso; e anche i numeri/l'AI dicono che la sfavorita segna poco): MG favorita 1-3.
- X oppure GG e' la scelta di sicurezza (copre pareggio e GG): compare tra le opzioni solo quando e' pagata almeno 1,62; altrimenti si ripiega sul GG.
- LASCIARE ("nessuna") e' una scelta giusta quando: la quantita' di gol non si legge, il GG non e' sicuro e la direzione non ha valore (quota troppo bassa). Meglio lasciare che giocare senza valore.
ESEMPI DI RAGIONAMENTO:
- Paris FC-Rennes (Equilibrio; 1X 1,33, X2 1,67; Over 1,5 1,18; Over 2,5 1,65; Under 3,5 1,45; GG 1,52): 1X piu' basso = pende per il Paris FC, ma 1,33 e' troppo bassa. Over 1,5 basso e Under 3,5 sotto 1,50 = da 2 a 4-5 gol. GG basso e segnano entrambe = GG. X o GG solo se pagato 1,62, altrimenti GG. GIOCATA: GG.
- Juventus-Lazio (Progressione; 1 a 1,57; Under 3,5 1,30, Over 3,5 3,10; Over/Under 2,5 1,85; GG 1,85; Juve con 7 assenti): partita chiusa, fra 2 e 4 gol; sui gol non c'e' una direzione precisa (2,5 a 1,85 tutte e due). Si valutano 1, MG 2-4 totali, MG casa 1-3 e la combo. Le notizie direbbero GG ma il book a 1,85 dice no. Partita complicata: si ripiega su MG 2-4 totali, dove rientrano piu' risultati. GIOCATA: MG 2-4 totali.
- Lorient-Monaco (Equilibrio; Over 1,5 e Under 3,5 entrambi 1,27; Over 2,5 1,90 e Under 2,5 1,80; GG 1,72; X2 1,28): il book non sa se saranno meno o piu' di 2,5 gol; GG a 1,72 non e' sicuro; la direzione (Monaco vince o pareggia) ha solo X2 a 1,28, senza valore. Partita troppo rischiosa: GIOCATA: nessuna.
Regole sulla giocata: SOLO un codice dell'elenco OPZIONI GIOCABILI, scritto esattamente (mai mercati fuori elenco, anche se ti sembrano migliori). Le quote "stimate" sono affidabili: non scartare un'opzione perche' la quota e' stimata. Le opzioni del gruppo A valgono sempre, con o senza vincitore. Quelle del gruppo B si aggiungono solo se al passo 3 non trovi un vincitore. Una giocata NON deve coprire tutti i risultati possibili: basta che vinca con i risultati piu' probabili della tua lettura (es. MG 2-4 totali va bene se ti aspetti 2-3 gol, anche se comprende il 4). "nessuna" quando ogni opzione perde con il risultato piu' probabile, oppure nel caso LASCIARE descritto sopra.
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

/**
 * BOOK, AI E STORICO (19/10/2026, Rossi: "devono essere coerenti book, AI e storico: se 2 su 3 saltano non si
 * gioca, se 2 su 3 sono coerenti si valuta, se 3 su 3 sono coerenti si prende").
 *  - book: la quota conferma la lettura del mercato (regole di lettura del proprietario);
 *  - AI: la giocata vince in almeno 2 dei 3 risultati attesi;
 *  - storico: nelle partite simili in archivio entra almeno il 60% (pStorico).
 */
export type Coerenza = { book: boolean; ai: boolean | null; storico: boolean | null; n: number; su: number };
export function bookConferma(codice: string, m: any): boolean {
  const q = (k: string) => Number(m[k]) > 1 ? Number(m[k]) : null;
  const q1 = q("odd_1"), q2 = q("odd_2"), d1 = q("odd_1x"), d2 = q("odd_x2");
  const o15 = q("odd_o15"), o25 = q("odd_o25"), u35 = q("odd_u35"), o35 = q("odd_o35"), gg = q("odd_gg");
  const fav = q1 != null && q2 != null ? (q1 <= q2 ? "1" : "2") : null;
  const qFav = fav === "1" ? q1 : q2;
  const lato = fav === "1" ? "casa" : "ospite";
  const c = codice.trim();
  if (c === "1" || c === "2") return c === fav && qFav != null && qFav < 2;
  if (c === "1X" || c === "X2" || /^DC (1X|X2) \+/.test(c)) {
    const lungo = c.includes("1X") ? "1X" : "X2";
    const alto = lungo === "1X" ? d1 : d2, altro = lungo === "1X" ? d2 : d1;
    return alto != null && (altro == null || alto <= altro);
  }
  if (c === "GG") return gg != null && gg < 1.7;
  if (c === "GG + O2.5") return gg != null && gg < 1.6 && o25 != null && o25 < 1.6;
  if (c === "O2.5") return o25 != null && o25 < 1.7;
  if (c === "U3.5") return u35 != null && u35 < 1.55;
  if (c === "X oppure GG") return gg != null && gg < 1.7;
  if (c === "MG 2-4 totali") return o15 != null && o15 < 1.35 && u35 != null && u35 < 1.6;
  if (c === "MG 1-3 totali") return u35 != null && u35 < 1.5;
  if (c === "MG 3-6 totali") return o25 != null && o25 < 1.55;
  const mg = /^MG (\d)-(\d) (casa|ospite)$/.exec(c);
  if (mg) {
    if (mg[3] !== lato) return u35 != null && u35 < 1.6; // MG della sfavorita: partita non esplosiva
    return qFav != null && qFav < 2 && (mg[2] === "4" ? o35 != null && o35 < 2.3 : u35 != null && u35 < 1.7);
  }
  if (/^MG \d-\d (casa|ospite) \+ MG \d-\d (casa|ospite)$/.test(c)) return qFav != null && qFav < 2 && u35 != null && u35 < 1.7;
  return false;
}
export function coerenza(codice: string, m: any, risultatiAI: unknown, pStorico: number | null): Coerenza {
  const ris = (Array.isArray(risultatiAI) ? risultatiAI : []).map((r) => String(r).replace(/\s/g, "")).filter((r) => /^\d+-\d+$/.test(r));
  const book = bookConferma(codice, m);
  const ai = ris.length >= 3 ? ris.filter((r) => evaluateMarketOutcome(codice, r) === true).length >= 2 : null;
  const storico = pStorico == null ? null : pStorico >= 0.6;
  const voci = [book, ai, storico].filter((v) => v !== null) as boolean[];
  return { book, ai, storico, n: voci.filter(Boolean).length, su: voci.length };
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
