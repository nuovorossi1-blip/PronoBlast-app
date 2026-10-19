/**
 * LA LETTURA DELLA PARTITA (07/10/2026, Rossi).
 *
 * Due letture, una sopra l'altra:
 *  1. del PROGRAMMA (letturaProgramma.ts): subito, gratis, sempre uguale;
 *  2. dell'AI GRATIS (Nemotron 3 Super su OpenRouter, riserva Nemotron 3.5
 *     Lightning): fatta in automatico con il dossier delle 6 e delle 13 e
 *     salvata in `dossier_web.numeri.lettura_ai`. I modelli a pagamento
 *     restano solo sul tasto "Genera pronostico AI" (Rossi).
 *
 * Test del 07/10 sulle 9 partite del 06/10: Nemotron Super da solo ripeteva le
 * quote (diceva "d'accordo" in 9 casi su 9); con i calcoli del programma nel
 * testo ha letto Bielorussia-Finlandia ("nessun netto favorito", fini' 1-0) ed
 * Estonia-Islanda ("partita chiusa, Under 2.5 e NoGol plausibili", fini' 0-0).
 * Quindi l'AI riceve i calcoli gia' fatti e li spiega; non li rifa'.
 */
import { pgGet, pgGetAll, pgPatch, pgPost, rowToOdds } from "./supabaseRest";
import { structuralAnalysis, quoteCatalogo, contraddice } from "./clusterEngine";
import { getScenarioNote, chiaveScenario, inizioPartitaMs, analizzaGiocate, letturaGol, normalizeMarket, isVerdictMarket, isMercatoAmmesso, isMercatoVietato, MERCATI_VIETATI, mercatoAIValido, coerenteConGol, controRisultatiAI, esitiDelSegno, QUOTA_MAX_AI, mgFavoritaEsclusa, type RigaGiocata, QuoteFirma, firmaQuote, quoteCambiate, ConsigliatoSalvato } from "../../../frontend/src/api";
import { formaGol, type FormaGol } from "./formaGol";
import { letturaProgramma, type LetturaProgramma } from "./letturaProgramma";
import { tabellaScenari, versioneTabellaCorrente } from "./tabellaScenari";
import { callLlm } from "./llmProviders";
import { opzioneDaId, modelloScelto } from "./llmScelta";
import { notiziaVerificata } from "./predictionPrompt";
import { testoScelta, testoFatti, SISTEMA_SCELTA, opzioniGiocabili, giocataValida, controllaScelta } from "./sceltaAI";

export { QuoteFirma, firmaQuote, quoteCambiate };

export const MODELLI_GRATIS = ["nvidia/nemotron-3-super-120b-a12b:free", "nvidia/nemotron-3.5-lightning:free"];
export type LetturaAI = {
  modello: string; quando: string;
  /** Le quote con cui e' stata fatta: se cambiano, si rifa' (07/10/2026). */
  quote?: QuoteFirma;
  /** Solo la lettura "Pronostico AI" (modello scelto): la giocata che la
   *  notizia giustifica, e se la notizia c'e' davvero nei dati. */
  mercato?: string; notizia_verificata?: boolean; pro?: boolean;
  direzione: string; gol_casa: string; gol_ospite: string; gol_totali: string;
  forma_e_quote: string; notizia: string; risultati_probabili: string[]; lettura: string;
  /** Scelta ragionata (19/10/2026, "ok AI"): la giocata fra le opzioni giocabili e i passi del ragionamento. */
  giocata?: string; ragionamento?: { book?: string; direzione?: string; segnano?: string; scelta?: string };
  come_stanno?: string;
};

const SISTEMA = `Sei un analista di calcio che spiega la partita a uno scommettitore, in italiano semplice.
Hai SOLO i dati qui sotto, raccolti PRIMA della partita. Non inventare niente.
Regole:
- I CALCOLI DEL PROGRAMMA sono affidabili: usali e spiegali, non rifarli.
- Le quote sono la lettura piu' precisa dei gol attesi; la forma conta solo pesata con la forza degli avversari (lo fa gia' il programma).
- Se il programma dice che forma e quote NON sono d'accordo, o che ci sono assenze pesanti, la lettura deve spiegarlo e tenerne conto nella direzione e nei gol (anche "nessuna" direzione).
- Direzione, gol e risultati probabili devono essere coerenti fra loro.
Rispondi SOLO con questo JSON:
{"direzione":"1|X|2|nessuna","gol_casa":"min-max","gol_ospite":"min-max","gol_totali":"min-max","forma_e_quote":"d'accordo|non d'accordo","notizia":"l'assenza o il fatto che conta, o stringa vuota","risultati_probabili":["a-b","a-b","a-b"],"come_stanno":"2 frasi, una per squadra: come sta andando nelle ultime 5 partite fra campionato e coppa (vinte, pareggiate, perse) e quanti gol ha fatto e subito, con i numeri copiati dai dati","lettura":"3-4 frasi semplici: chi e' favorita, chi segna, chi prende gol, che partita aspettarsi"}`;

const MERCATI_AMMESSI_PRO = "1, 2, 1X, X2, GG, O2.5, MG 2-4 totali, MG 3-6 totali, MG 2-4 casa, MG 2-4 ospite, GG + O2.5, DC 1X + O1.5, DC X2 + O1.5, DC 1X + O2.5, DC X2 + O2.5, DC 1X + U3.5, DC X2 + U3.5, DC 1X + GG, DC X2 + GG, 1 + U4.5, MG 1-3 casa, MG 1-3 ospite, U3.5, X oppure GG";

const SISTEMA_PRO = SISTEMA.replace(
  `"lettura":"3-4 frasi semplici: chi e' favorita, chi segna, chi prende gol, che partita aspettarsi"}`,
  `"lettura":"3-4 frasi semplici: chi e' favorita, chi segna, chi prende gol, che partita aspettarsi","mercato":"SOLO se la notizia cambia la giocata dei numeri: UN solo mercato scelto ESCLUSIVAMENTE da questo elenco (${MERCATI_AMMESSI_PRO}), scritto esattamente così; altrimenti stringa vuota"}
Regola sul mercato: se indicato, deve essere UN solo mercato di questo elenco, scritto esattamente così: mai due mercati insieme, mai varianti, mai mercati fuori elenco.
La "notizia" e' UNA frase con il fatto che conta (al massimo 3 giocatori, con i nomi copiati dai dati): non l'elenco intero degli assenti. Il codice controlla che ci sia davvero.`,
);

const n1 = (x: any) => (x == null ? "n/d" : Number(x).toFixed(1));

/** La lettura gratis va fatta (o rifatta)? */
export function letturaDaRifare(numeri: any, match: any): boolean {
  const l = numeri?.lettura_ai;
  // 19/10/2026: le letture senza scelta ragionata (formato vecchio) si rifanno.
  return !l || !l.ragionamento || quoteCambiate(l.quote, firmaQuote(match));
}

// LIMITE DEI MODELLI GRATIS: OpenRouter ne concede 1000 al giorno all'account
// (riserva compresa). Ci si ferma a 900 per lasciare margine al resto.
const CHIAVE_CONTO = "letture_gratis";
export const LIMITE_GRATIS = 900;
const oggi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
export async function letturePossibili(): Promise<boolean> {
  try {
    const v = (await pgGet(`settings?key=eq.${CHIAVE_CONTO}&select=value`))[0]?.value;
    return !(v?.giorno === oggi() && (v?.n ?? 0) >= LIMITE_GRATIS);
  } catch { return true; }
}
async function contaLettura() {
  try {
    const v = (await pgGet(`settings?key=eq.${CHIAVE_CONTO}&select=value`))[0]?.value;
    const n = v?.giorno === oggi() ? (v.n ?? 0) + 1 : 1;
    await pgPost("settings", { key: CHIAVE_CONTO, value: { giorno: oggi(), n } }, "resolution=merge-duplicates,return=minimal");
  } catch { /* il conto non deve fermare la lettura */ }
}

/**
 * Tutti i dati di una partita, la lettura del programma e il testo per l'AI.
 * `completo`: ricalcola sempre forma e programma. Il programma salvato non ha
 * ne' la forma ne' il testo per l'AI: senza ricalcolo il modello riceveva
 * "n/d" e "undefined" (12/10/2026, test su 61 partite: resa -17% contro -1%).
 */
export async function datiLettura(matchId: string, opzioni: { completo?: boolean } = {}): Promise<{
  match: any; forma: FormaGol | null; programma: LetturaProgramma; testo: string; numeri: any;
} | null> {
  const m = (await pgGet(`matches?id=eq.${encodeURIComponent(matchId)}&select=*`))[0];
  if (!m) return null;
  const odds: any = rowToOdds(m);
  if (!odds.odd_1 || !odds.odd_X || !odds.odd_2) return null;
  const st: any = structuralAnalysis(odds, 1.4).structure;
  const d = (await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}&select=contesto,numeri`))[0];
  let forma: FormaGol | null = null;
  const qAtt = firmaQuote(m);
  const prSalvato = d?.numeri?.programma;
  let programma: LetturaProgramma;
  if (!opzioni.completo && prSalvato && !quoteCambiate(prSalvato.quote, qAtt)) {
    programma = prSalvato;
  } else {
    forma = await formaGol(
      { giorno: m.day, casa: m.squadra1, ospite: m.squadra2, inizioMs: inizioPartitaMs(m.day, m.time) },
      d?.numeri?.fotmob_id,
    );
    programma = await letturaProgramma(
      forma, { casa: m.squadra1, ospite: m.squadra2 }, { casa: st.lambda_home, ospite: st.lambda_away },
      { casa: d?.numeri?.assenti_casa ?? 0, ospite: d?.numeri?.assenti_ospite ?? 0 },
    );
  }
  const nota = getScenarioNote(odds, st);
  let scenario = nota?.scenario || "n/d";
  try {
    const t = nota ? (await tabellaScenari()).scenari[chiaveScenario(nota)] : null;
    if (t) {
      scenario += " · mercati che reggono in archivio: " + Object.entries(t)
        .map(([f, v]) => `fascia ${f}: ${v[0].market} ${Math.round(v[0].pA * 100)}%/${Math.round(v[0].pB * 100)}%`).join("; ");
    }
  } catch { /* senza tabella va bene lo stesso */ }
  const sq = (s: any, sede: string) => !s ? "  n/d" :
    `  ${s.nome}: ultime ${s.totale.n} fa ${n1(s.totale.fatti)} prende ${n1(s.totale.subiti)}: ` +
    s.totale.partite.map((p: any) => `${p.in_casa ? "vs" : "@"} ${p.avversario} ${p.fatti}-${p.subiti}`).join("; ") +
    `\n  ultime ${s.sede.n} ${sede}: fa ${n1(s.sede.fatti)} prende ${n1(s.sede.subiti)}`;
  const blocchi = (d?.contesto?.blocchi || [])
    .filter((b: any) => /FotMob|Google News/.test(b.etichetta) && !/Classifica/.test(b.etichetta))
    .map((b: any) => `- ${b.etichetta}: ${b.righe.join(" | ")}`).join("\n");
  const testo = `PARTITA: ${m.squadra1} - ${m.squadra2} (${m.manifestazione}, ${m.day} ${m.time})
QUOTE: 1 ${m.odd_1} · X ${m.odd_x} · 2 ${m.odd_2} · Over2.5 ${m.odd_o25} · Under2.5 ${m.odd_u25} · GG ${m.odd_gg} · NG ${m.odd_ng}
SCENARIO: ${scenario}
FORMA (FotMob, solo 90 minuti, ${forma?.tipo ? `SOLO partite di ${forma.tipo} come questa${forma.casa?.stesso_tipo && forma.ospite?.stesso_tipo ? "" : " (poche: aggiunte le altre ufficiali)"}` : "tutte le competizioni"}):
${sq(forma?.casa, "in casa")}
${sq(forma?.ospite, "fuori casa")}
ALTRI DATI (FotMob):
${blocchi || "nessuno"}
${programma.testo}`;
  return { match: m, forma, programma, testo, numeri: d?.numeri ?? null };
}

/**
 * Lettura AI salvata nel dossier. Gratis (Nemotron, `lettura_ai`) oppure
 * "Pronostico AI" con il modello scelto in LLM & Budget (`lettura_pro`, con
 * il controllo della notizia che puo' cambiare "Punta su questo").
 * null se non riesce.
 */
export async function generaLetturaAI(
  matchId: string,
  dati?: Awaited<ReturnType<typeof datiLettura>>,
  opzioni: { pro?: boolean } = {},
): Promise<LetturaAI | null> {
  // L'AI vuole il testo completo: se i dati vengono dal programma salvato
  // (forma assente), si ricalcolano.
  const x = dati?.forma ? dati : await datiLettura(matchId, { completo: true });
  if (!x) return null;
  const pro = !!opzioni.pro;
  if (!pro && !(await letturePossibili())) return null;
  const modelli: any[] = pro ? [await modelloScelto()] : await Promise.all(MODELLI_GRATIS.map((m) => opzioneDaId("or:" + m)));
  for (const opt of modelli) {
    if (!opt) continue;
    try {
      if (!pro) await contaLettura();
      // Scelta ragionata (19/10/2026, "ok AI"): stesse istruzioni per la gratis e per il Pronostico AI,
      // con la lettura del book e le opzioni giocabili della partita.
      const scelta = testoScelta(x.match, x.numeri?.lettura_ai?.direzione ?? null, { casa: x.programma?.assenti_casa, ospite: x.programma?.assenti_ospite });
      const risposta = await callLlm(opt, SISTEMA_SCELTA, x.testo + testoFatti(x.forma, { casa: x.match.squadra1, ospite: x.match.squadra2 }) + "\n" + scelta.testo);
      const j = JSON.parse((risposta.match(/\{[\s\S]*\}/) || [""])[0]);
      if (!j?.lettura || String(j.lettura).replace(/[^a-z]/gi, "").length < 40) continue;   // vuota o a puntini
      const str = (v: any, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const l: LetturaAI = {
        modello: opt.label, quando: new Date().toISOString(), quote: firmaQuote(x.match),
        direzione: str(j.direzione, 10), gol_casa: str(j.gol_casa, 10), gol_ospite: str(j.gol_ospite, 10), gol_totali: str(j.gol_totali, 10),
        forma_e_quote: str(j.forma_e_quote, 30), notizia: str(j.notizia, 300), come_stanno: str(j.come_stanno, 500),
        risultati_probabili: (Array.isArray(j.risultati_probabili) ? j.risultati_probabili : []).map((r: any) => str(r, 8)).filter(Boolean).slice(0, 4),
        lettura: str(j.lettura, 900),
        giocata: str(j.giocata, 40),
        ragionamento: {
          book: str(j.ragionamento?.book, 400), direzione: str(j.ragionamento?.direzione, 400),
          segnano: str(j.ragionamento?.segnano, 600), scelta: str(j.ragionamento?.scelta, 600),
        },
      };
      if (pro) {
        l.pro = true;
        l.mercato = str(j.giocata || j.mercato, 40);
        l.notizia_verificata = !!l.mercato && notiziaVerificata(l.notizia, x.testo);
      }
      // Rilegge i numeri: un'altra lettura puo' averli cambiati nel frattempo.
      const numeri = (await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}&select=numeri`))[0]?.numeri ?? x.numeri;
      if (numeri) {
        await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}`, { numeri: { ...numeri, [pro ? "lettura_pro" : "lettura_ai"]: l } });
      } else {
        // Dossier non ancora fatto (16/10/2026, Rossi: "esco e rientro e la lettura scompare"): si crea la
        // riga con la sola lettura; `contesto` "compattato" (obbligatorio, senza testo) fa rifare il dossier
        // vero al giro, che tiene le letture (webSearch).
        await pgPost("dossier_web", { match_id: matchId, contesto: { compattato: true, solo_letture: true }, numeri: { [pro ? "lettura_pro" : "lettura_ai"]: l } }, "resolution=merge-duplicates,return=minimal");
      }
      return l;
    } catch (e) {
      console.error("[letturaAI]", opt?.id, (e as any)?.message || e);
      if (pro) throw e;
    }
  }
  return null;
}


/**
 * IL CONSIGLIATO lato server (07/10/2026): la stessa regola della scheda
 * (analizzaGiocate in api.ts), per schedina e "Genera multipla". Se il
 * Pronostico AI (lettura_pro) ha una notizia verificata con le quote di
 * adesso, il consigliato diventa il suo mercato ("cambiato").
 * Salvato in `dossier_web.numeri.consigliato`.
 */
export type ConsigliatoSalvato = {
  market: string | null; nome: string | null; quota: number | null; stimata: boolean;
  pA: number | null; pB: number | null; n: number | null;
  daLasciare: string | null; avvisi: string[];
  alternative: { market: string; nome: string; quota: number; stimata: boolean; p: number }[];
  ai: "confermato" | "cambiato" | "scelta" | null; notizia: string | null;
  /** Se l'AI ha cambiato: la giocata dei numeri, per tornare indietro e per
   *  misurare chi ha ragione (pagella, Rossi 07/10/2026). */
  numeri_market?: string | null; numeri_nome?: string | null; numeri_quota?: number | null;
  /** Se "da lasciare": cosa si sarebbe giocato (pagella: lasciarle e' giusto?). */
  lasciata_market?: string | null; lasciata_quota?: number | null;
  /** Se proposta AI scartata: motivo e mercato */
  proposta_scartata?: { mercato: string; motivo: string } | null;
  quote: QuoteFirma; quando: string;
  perche?: string | null;
  regole_versione?: string;
  /** Rifatto a partita chiusa con le regole nuove (19/10/2026): quando. */
  rifatto?: string;
};

/** Cosa va in pick_finale per questo consigliato: il mercato, oppure (partita
 *  "da lasciare") quello che si giocherebbe lo stesso. null = nessuno. */
export function giocataDelConsigliato(c: ConsigliatoSalvato | null | undefined): { pick_finale: string; pick_finale_prob: number | null } | null {
  if (!c) return null;
  const market = c.market || c.lasciata_market;
  if (!market) return null;
  // Dal 13/10/2026 pA/pB sono quelli della giocata scelta anche quando l'AI cambia.
  const prob = c.market && c.pA != null && c.pA > 0 ? Math.min(c.pA, c.pB ?? c.pA) : null;
  return { pick_finale: market, pick_finale_prob: prob };
}

/** "1-3" -> [1, 3] */
const forchetta = (s: unknown): [number, number] | null => {
  const r = /^(\d+)\s*-\s*(\d+)$/.exec(String(s ?? "").trim());
  return r ? [Number(r[1]), Number(r[2])] : null;
};

/**
 * La giocata piu' solida coerente con la lettura del Pronostico AI, quando il
 * suo mercato e' sotto 1,40. Coerente vuol dire: quota da 1,40, non contro la
 * sua direzione ne' contro il suo mercato, gol nella sua forchetta.
 * Solida: la probabilita' piu' bassa fra archivio (se misurata) e motore.
 */
/** Multigol stretta della favorita (fino a 4 gol): con il rischio goleada si rompe (19/10/2026). */
export const mgStrettaFavorita = (mk: string, fav: "1" | "2" | null | undefined) => {
  const m = /^MG (?:(casa|ospite) (\d)-(\d)|(\d)-(\d) (casa|ospite))$/i.exec(mk.trim());
  if (!m || !fav) return false;
  const lato = (m[1] || m[6]).toLowerCase(), alto = Number(m[3] || m[5]);
  return lato === (fav === "1" ? "casa" : "ospite") && alto <= 4;
};

/**
 * 19/10/2026 (Rossi, "sistema alzata"): la giocata presa al posto della proposta AI sta fra 1,40 e 1,60
 * (prima fino a QUOTA_MAX_AI) e, con il rischio goleada, mai una Multigol stretta della favorita.
 */
export function salitaDaProposta(pro: any, a: ReturnType<typeof analizzaGiocate>, opz: { goleadaFav?: "1" | "2" | null; mgEsclusa?: (mk: string) => string | null } = {}): RigaGiocata | null {
  const dir = String(pro?.direzione || "");
  const gol = forchetta(pro?.gol_totali);
  const totAI = gol ? (gol[0] + gol[1]) / 2 : null;
  // Esiti 1/X/2 ammessi dal mercato dell'AI (13/10/2026, Inter-Brugge: da
  // "DC 1X + O1.5" si saliva a "DC 12 + O2.5", che toglie la X e aggiunge il 2).
  const esitiAI = pro?.mercato ? esitiDelSegno(String(pro.mercato)) : null;
  let best: RigaGiocata | null = null, bestP = -1;
  for (const r of a.righe) {
    if (!(r.quota >= 1.40) || r.quota > 1.60 + 1e-9 || isMercatoVietato(r.market)) continue;
    if (opz.goleadaFav && mgStrettaFavorita(r.market, opz.goleadaFav)) continue;
    if (opz.mgEsclusa?.(r.market)) continue;
    if (a.esclusa?.(r.market)) continue; // regole inderogabili anche per l'AI (15/10/2026)
    const seg = r.market.trim().toUpperCase().replace(/^DC\s+/, "");
    if (dir === "2" && /^(1|1X)(\s|$|\+)|^1 (DNB|AH)/.test(seg)) continue;
    if (dir === "1" && /^(2|X2)(\s|$|\+)|^2 (DNB|AH)/.test(seg)) continue;
    const esiti = esitiDelSegno(r.market);
    if (esitiAI && esiti && [...esiti].some((e) => !esitiAI.has(e))) continue;
    if (pro?.mercato && contraddice(String(pro.mercato), r.market)) continue;
    if (!coerenteConGol(r.market, totAI)) continue;
    if (controRisultatiAI(r.market, pro?.risultati_probabili)) continue;
    const ps = [r.stima, r.misurata ? Math.min(r.misurata.pA, r.misurata.pB) : null].filter((x): x is number => typeof x === "number");
    if (!ps.length) continue;
    const p = Math.min(...ps);
    if (p > bestP + 1e-9 || (Math.abs(p - bestP) <= 1e-9 && best && r.quota > best.quota)) { best = r; bestP = p; }
  }
  return best;
}

/** Partita con risultato o con l'orario d'inizio gia' passato. */
export function partitaIniziata(m: { result?: string | null; day?: string | null; time?: string | null }): boolean {
  if (m.result) return true;
  const inizio = inizioPartitaMs(m.day, m.time);
  return inizio !== null && inizio <= Date.now();
}

/**
 * La lettura AI (Pronostico AI se c'e', altrimenti la gratis) dice che la favorita delle quote
 * non perde: vince o pareggia in tutti e 3 i suoi risultati (15/10/2026, Roma-Real 1-2, 1-1, 2-2).
 */
export function favoritaNonPerde(m: any, numeri: any): boolean {
  const l = numeri?.lettura_pro?.risultati_probabili?.length ? numeri.lettura_pro : numeri?.lettura_ai;
  const ris = (l?.risultati_probabili || []).map((r: string) => String(r).replace(/\s/g, "").split("-").map(Number))
    .filter((r: number[]) => r.length === 2 && r.every(Number.isFinite));
  const q1 = Number(m?.odd_1), q2 = Number(m?.odd_2);
  if (ris.length !== 3 || !(q1 > 1 && q2 > 1) || q1 === q2) return false;
  return ris.every((r: number[]) => (q1 < q2 ? r[0] >= r[1] : r[1] >= r[0]));
}

/** Il Pronostico AI propone X oppure GG e i suoi 3 risultati probabili sono tutti pareggi o gol di
 *  tutte e due: X oppure GG entra nell'elenco della partita (16/10/2026, Rossi). */
export function xoggDaAI(numeri: any): boolean {
  const l = numeri?.lettura_pro;
  if (!l?.mercato || !/^x\s+(oppure|o)\s+gg$/i.test(String(l.mercato).trim())) return false;
  const ris = (l.risultati_probabili || []).map((r: string) => String(r).replace(/\s/g, "").split("-").map(Number))
    .filter((r: number[]) => r.length === 2 && r.every(Number.isFinite));
  return ris.length === 3 && ris.every(([c, o]: number[]) => c === o || (c > 0 && o > 0));
}

/**
 * rifai (19/10/2026, Rossi: "le partite chiuse, come sarebbero state pronosticate con queste regole: il
 * pronostico cambia solo ora e poi non cambia"): ricalcola anche a partita iniziata o finita. Il
 * consigliato vero di prima del via resta in numeri.consigliato_prima_del_via (non si perde).
 */
export async function consigliatoDi(matchId: string, dati?: Awaited<ReturnType<typeof datiLettura>>, salva = true, opz: { rifai?: boolean } = {}): Promise<ConsigliatoSalvato | null> {
  const x = dati ?? (await datiLettura(matchId));
  if (!x) return null;
  const m = x.match;
  const rifai = !!opz.rifai;
  // PARTITA INIZIATA O FINITA (10/10/2026, Rossi: niente interferenze): il
  // consigliato salvato e' quello che si e' giocato e non cambia piu', ne'
  // per un Excel caricato dopo l'inizio, ne' per i risultati che aggiornano
  // la tabella scenari, ne' per un Pronostico AI. Si calcola solo se non
  // c'era (prima volta), con le quote della partita.
  if (!rifai && partitaIniziata(m) && x.numeri?.consigliato) return x.numeri.consigliato as ConsigliatoSalvato;
  // ULTIMA ORA (15/10/2026 sera, Rossi: "un'ora prima dell'inizio e' l'ultima volta che puo' cambiare"):
  // da 60 minuti prima del via il pronostico salvato resta, qualunque cosa venga lanciata (AI, giri,
  // tabella); cambia ancora solo se cambiano le quote, fino al calcio d'inizio.
  const salvatoPrima = x.numeri?.consigliato as ConsigliatoSalvato | undefined;
  const inizioM = inizioPartitaMs(m.day, m.time);
  if (!rifai && salvatoPrima && inizioM !== null && Date.now() >= inizioM - 60 * 60 * 1000 && !quoteCambiate(salvatoPrima.quote, firmaQuote(m))) return salvatoPrima;
  const odds: any = rowToOdds(m);
  const s: any = structuralAnalysis(odds, 1.4);
  const st = s.structure;
  const pr = x.programma;
  const nota = getScenarioNote(odds, st);
  const tab = await tabellaScenari().catch(() => null);
  const tabVersione = tab ? `${tab.aggiornata}|${tab.partite}` : null;
  let voci: any = null;
  try { voci = (nota && tab) ? tab.scenari[chiaveScenario(nota)] ?? null : null; } catch { /* senza tabella niente consigliato */ }
  const totAtteso = (pr.forma_casa != null ? (st.lambda_home + pr.forma_casa) / 2 : st.lambda_home)
    + (pr.forma_ospite != null ? (st.lambda_away + pr.forma_ospite) / 2 : st.lambda_away);
  const coppaEuropea = /^(EUCHL|EUEL|EUCONFL)/.test(String(m.manifestazione || "").toUpperCase());
  const marketOdds: Record<string, { odd: number; estimated: boolean }> = quoteCatalogo(odds);
  const a = analizzaGiocate({
    odds, marketOdds, coppaEuropea,
    ranking: (s.ranking || []).map((r: any) => ({ market: r.market, coverage: r.coverage })),
    voci, manuali: nota?.markets || [], totAtteso,
    direzione: letturaGol(st.lambda_home, st.lambda_away).direzione,
    casa: m.squadra1, ospite: m.squadra2,
    pesataCasa: pr.pesata_casa, pesataOspite: pr.pesata_ospite, accordo: pr.accordo,
    assentiCasa: pr.assenti_casa, assentiOspite: pr.assenti_ospite,
    favNonPerde: favoritaNonPerde(m, x.numeri),
    scenario: nota?.scenario ?? null,
    xoggAI: xoggDaAI(x.numeri),
    risultatiAI: (x.numeri?.lettura_pro?.risultati_probabili?.length && !quoteCambiate(x.numeri.lettura_pro.quote, firmaQuote(m)) ? x.numeri.lettura_pro : x.numeri?.lettura_ai)?.risultati_probabili ?? null,
    direzioneAI: (x.numeri?.lettura_pro?.risultati_probabili?.length && !quoteCambiate(x.numeri.lettura_pro.quote, firmaQuote(m)) ? x.numeri.lettura_pro : x.numeri?.lettura_ai)?.direzione ?? null,
  });
  const c = a.consigliato;
  const out: ConsigliatoSalvato = {
    market: c?.market ?? null, nome: c?.nome ?? null, quota: c?.quota ?? null, stimata: !!c?.stimata,
    pA: c?.misurata?.pA ?? (c?.punteggio != null ? c.punteggio / c.quota : null), pB: c?.misurata?.pB ?? (c?.punteggio != null ? c.punteggio / c.quota : null), n: c?.misurata?.n ?? null,
    daLasciare: a.daLasciare, avvisi: a.avvisi,
    alternative: a.righe.filter((r) => r.punteggio != null && !r.consigliato && !isMercatoVietato(r.market)).slice(0, 8)
      .map((r) => ({ market: r.market, nome: r.nome, quota: r.quota, stimata: r.stimata, p: r.punteggio! / r.quota })),
    ai: null, notizia: null, quote: firmaQuote(m), quando: new Date().toISOString(),
    lasciata_market: a.seNonLasciata?.market ?? null, lasciata_quota: a.seNonLasciata?.quota ?? null,
    tabella_versione: tabVersione,
    tradotto_da: null,
    perche: c?.perche ? c.perche.replace(/^★ consigliato:\s*/, "") : null,
    regole_versione: VERSIONE_CONSIGLIATO,
  };
  // SCELTA RAGIONATA DELL'AI (19/10/2026, Rossi: "ok AI"): se la valutazione AI (Pro se c'e', altrimenti
  // la gratis) e' del formato nuovo e fatta con le quote di adesso, la scelta finale e' la sua giocata,
  // purche' sia fra le opzioni giocabili; "nessuna" -> la partita si lascia con il suo motivo.
  const recente = (l: any) => l?.ragionamento && !quoteCambiate(l.quote, out.quote) ? l : null;
  const lAI = recente(x.numeri?.lettura_pro) ?? recente(x.numeri?.lettura_ai);
  if (lAI) {
    // Le opzioni come le ha viste l'AI (anche quelle dell'incertezza, segnate), poi il controllo.
    const { opzioni } = opzioniGiocabili(m, lAI.direzione, true, { casa: pr?.assenti_casa, ospite: pr?.assenti_ospite });
    // "nessuna" scritta dall'AI = si lascia (Rossi 19/10/2026, Lorient-Monaco: "lascia andare"); il controllo
    // sceglie al suo posto solo se la giocata manca o non e' fra le opzioni.
    const aiLascia = /^\s*nessuna\s*$/i.test(String(lAI.giocata || ""));
    const controllo = aiLascia ? { giocata: null, corretta: false } : controllaScelta(giocataValida(lAI.giocata, opzioni), opzioni, lAI.risultati_probabili, lAI.direzione);
    // GAP, FAVORITA CON 3+ ASSENTI (19/10/2026, Rossi: "si"): il segno secco diventa doppia chance + Over 1,5
    // (pareggi 20% contro 15%; 1X/X2 + Over 1,5 77% contro il fisso 73%), se e' fra le opzioni e vince in
    // almeno 2 dei risultati attesi dell'AI.
    const favCasa = Number(m.odd_1) <= Number(m.odd_2);
    const assFav = Number(favCasa ? pr?.assenti_casa : pr?.assenti_ospite);
    const dcO15 = opzioni.find((o) => o.codice === (favCasa ? "DC 1X + O1.5" : "DC X2 + O1.5"));
    const sceltaSegno = controllo.giocata && controllo.giocata.codice === (favCasa ? "1" : "2");
    const risAI = (lAI.risultati_probabili || []).map((r: string) => String(r).replace(/\s/g, ""));
    const dcViteAI = dcO15 ? risAI.filter((r: string) => { const [h, a] = r.split("-").map(Number); const f = favCasa ? h : a, s2 = favCasa ? a : h; return f >= s2 && h + a >= 2; }).length : 0;
    const versoDc = !!(sceltaSegno && dcO15 && assFav >= 3 && dcViteAI >= 2);
    const g = versoDc ? dcO15! : controllo.giocata;
    out.numeri_market = out.market; out.numeri_nome = out.nome; out.numeri_quota = out.quota;
    out.ai = "scelta";
    const attesi = (lAI.risultati_probabili || []).join(", ");
    const aiNessuna = !lAI.giocata || /^nessuna$/i.test(String(lAI.giocata).trim());
    out.perche = versoDc
      ? `l'AI sceglieva il segno, ma la favorita ha ${assFav} assenti: con tanti assenti il pareggio sale (20% contro 15%), quindi ${g!.nome}`
      : controllo.corretta && g
      ? (aiNessuna
        ? `l'AI non ha scelto una giocata, ma i suoi risultati attesi (${attesi}) li copre meglio ${g.nome}`
        : `l'AI aveva scelto ${lAI.giocata}, che non va d'accordo con i suoi risultati attesi (${attesi}): vale ${g.nome}, che li copre meglio`)
      : lAI.ragionamento?.scelta || null;
    if (g) {
      const r = a.righe.find((rr) => normalizeMarket(rr.market) === normalizeMarket(g.codice));
      out.market = g.codice; out.nome = g.nome; out.quota = g.quota; out.stimata = g.stimata; out.daLasciare = null;
      out.pA = r?.misurata?.pA ?? r?.stima ?? null; out.pB = r?.misurata?.pB ?? r?.stima ?? null; out.n = r?.misurata?.n ?? null;
    } else {
      out.market = null; out.quota = null;
      out.daLasciare = `per la valutazione AI nessuna giocata è coerente${lAI.ragionamento?.scelta ? `: ${lAI.ragionamento.scelta}` : ""}`;
    }
  }
  const pro = lAI ? null : x.numeri?.lettura_pro;
  if (pro && !quoteCambiate(pro.quote, out.quote)) {
    if (pro.notizia_verificata && pro.mercato) {
      const v0 = mercatoAIValido(pro.mercato, a, [...(nota?.markets || []), ...(xoggDaAI(x.numeri) ? ["X oppure GG"] : [])], pro.risultati_probabili);
      // Regole inderogabili anche per l'AI (15/10/2026, audit difetto C): una giocata esclusa
      // dalle regole non torna per la notizia; si prova la salita, altrimenti decidono i numeri.
      const goleadaFav = nota?.scenario === "Gap Tecnico" && Number(m.odd_o35) > 1 && Number(m.odd_o35) < 1.6 ? nota.favorita ?? null : null;
      const fuoriFascia = v0.ok && v0.quota != null && (v0.quota < 1.4 || v0.quota > 1.6 + 1e-9);
      const esclusaAI = v0.ok && v0.market
        ? a.esclusa?.(v0.market) ?? mgFavoritaEsclusa(v0.market, nota?.scenario, odds)
          ?? (fuoriFascia ? `quota ${v0.quota!.toFixed(2).replace(".", ",")} fuori da 1,40-1,60` : null)
        : null;
      const v = esclusaAI ? { ...v0, ok: false, motivo: `esclusa dalle regole: ${esclusaAI}` } : v0;
      // Probabilita' della giocata nuova (13/10/2026): prima restavano quelle
      // della giocata dei numeri, o 0 se i numeri dicevano "da lasciare".
      const probDi = (market: string) => {
        const r = a.righe.find((x) => normalizeMarket(x.market) === normalizeMarket(market));
        out.pA = r?.misurata?.pA ?? r?.stima ?? null; out.pB = r?.misurata?.pB ?? r?.stima ?? null; out.n = r?.misurata?.n ?? null;
      };
      if (v.ok && v.market && v.quota != null) {
        if (!out.market || normalizeMarket(v.market) !== normalizeMarket(out.market)) {
          out.numeri_market = out.market; out.numeri_nome = out.nome; out.numeri_quota = out.quota;
          out.ai = "cambiato"; out.notizia = pro.notizia || null;
          out.market = v.market; out.nome = v.market.replace(/\bcasa\b/gi, m.squadra1).replace(/\bospite\b/gi, m.squadra2);
          out.quota = v.quota; out.stimata = v.stimata; out.daLasciare = null;
          probDi(v.market);
          out.tradotto_da = v.tradotto_da || null;
          out.proposta_scartata = null;
        } else if (out.market) {
          out.ai = "confermato";
          out.tradotto_da = v.tradotto_da || null;
          out.proposta_scartata = null;
        }
      } else {
        // SALITA (13/10/2026, Rossi, Troyes-Marsiglia): una proposta giusta ma
        // sotto 1,40 (X2 a 1,30) non si butta. Si prende la giocata piu'
        // solida coerente con la lettura dell'AI: stessa direzione, non in
        // contrasto con il suo mercato, dentro i suoi gol. Se non c'e', scarto.
        // Stessa salita sopra QUOTA_MAX_AI (13/10/2026). Se la proposta perde
        // con i suoi stessi risultati probabili l'AI si contraddice: niente
        // salita guidata da lei, decidono i numeri (Viking-Bayern: la sua
        // lettura "pochi gol" portava a MG 1-3 Bayern).
        const salita = v.motivo === "fuori scala" || esclusaAI ? salitaDaProposta(pro, a, { goleadaFav, mgEsclusa: (mk) => mgFavoritaEsclusa(mk, nota?.scenario, odds) }) : null;
        const perche = esclusaAI ? `esclusa dalle regole: ${esclusaAI}`
          : v.quota != null && v.quota > QUOTA_MAX_AI ? `sopra ${QUOTA_MAX_AI.toFixed(2).replace(".", ",")}` : "sotto 1,40";
        if (salita && (!out.market || normalizeMarket(salita.market) !== normalizeMarket(out.market))) {
          out.numeri_market = out.market; out.numeri_nome = out.nome; out.numeri_quota = out.quota;
          out.ai = "cambiato"; out.notizia = pro.notizia || null;
          out.market = salita.market; out.nome = salita.nome; out.quota = salita.quota; out.stimata = salita.stimata;
          out.daLasciare = null;
          probDi(salita.market);
          out.tradotto_da = `${pro.mercato} (${perche})`;
          out.proposta_scartata = null;
        } else if (salita && out.market) {
          out.ai = "confermato";
          out.tradotto_da = `${pro.mercato} (${perche})`;
          out.proposta_scartata = null;
        } else {
          // Proposta AI scartata: non ammessa, senza quota o fuori scala
          out.ai = null;
          out.proposta_scartata = { mercato: pro.mercato, motivo: v.motivo ?? "non ammesso" };
          out.tradotto_da = null;
        }
      }
    } else if (out.market) {
      out.ai = "confermato";
    }
  }
  if (salva) {
    try {
      const numeri = (await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}&select=numeri`))[0]?.numeri;
      // Anche la lettura del programma, per mostrarla subito alla prossima
      // apertura senza ricalcolare (Rossi 07/10/2026: "una volta calcolato
      // deve salvarlo; se variano le quote puo' cambiare").
      const { testo: _t, ...programma } = pr;
      if (rifai) out.rifatto = new Date().toISOString();
      if (numeri) await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}`, {
        numeri: {
          ...numeri, consigliato: out, programma: { ...programma, quote: out.quote },
          // Il vero pronostico di prima del via non si perde: si tiene la prima volta che si rifa'.
          ...(rifai && numeri.consigliato && !numeri.consigliato_prima_del_via ? { consigliato_prima_del_via: numeri.consigliato } : {}),
        },
      });
      // UN SOLO CONSIGLIATO (13/10/2026, Rossi): la giocata in lista e in
      // Schedina (pick_finale) e' questa, la stessa della scheda e del bot.
      const giocata = giocataDelConsigliato(out);
      // Senza giocata si svuota (15/10/2026): prima restava la vecchia (Benfica-Celtic MG 1-3 casa).
      if (!partitaIniziata(m)) {
        await pgPatch(`matches?id=eq.${encodeURIComponent(matchId)}&result=is.null`, giocata ?? { pick_finale: null, pick_finale_prob: null });
      }
    } catch (e) {
      console.error("[consigliato] salvataggio", e);
    }
  }
  return out;
}

/** Il consigliato salvato, se c'e' ed e' fatto con le quote di adesso e la versione corrente della tabella scenari. */
// UN UNICO PRONOSTICO (15/10/2026 sera, Rossi): il consigliato salvato resta finche' non cambiano le
// quote o non arriva una lettura AI nuova; la tabella scenari aggiornata non lo cambia piu' (prima:
// Salisburgo-Milan scheda MG 2-4 totali, elenco GG). Fino a quando puo' cambiare: consigliatoDi.
/** Versione delle regole del consigliato: se cambia, i salvati delle partite non iniziate si rifanno
 *  (19/10/2026: classifica dell'Equilibrio; prima restavano finche' non cambiavano le quote). */
export const VERSIONE_CONSIGLIATO = "2026-10-19-scelta-ai-4";

export function consigliatoValido(numeri: any, match?: any, _versioneAttesa?: string | null): ConsigliatoSalvato | null {
  const c = numeri?.consigliato;
  if (!c) return null;
  if (match && quoteCambiate(c.quote, firmaQuote(match))) return null;
  if (match && c.regole_versione !== VERSIONE_CONSIGLIATO && !partitaIniziata(match)) return null;
  return c;
}


/**
 * Se l'AI ha cambiato il consigliato e la partita e' in Schedina, la giocata
 * salvata (pick_finale) diventa quella dell'AI (Rossi: "se l'ha cambiata ci
 * sara' un motivo"). Si torna indietro dalla Schedina.
 */
export async function applicaCambioInSchedina(matchId: string, c: ConsigliatoSalvato | null): Promise<void> {
  if (!c || c.ai !== "cambiato" || !c.market) return;
  const [m] = await pgGet(`matches?id=eq.${encodeURIComponent(matchId)}&select=day,time,result`).catch(() => []);
  if (!m || partitaIniziata(m)) return;
  try {
    await pgPatch(`matches?id=eq.${encodeURIComponent(matchId)}&selected=eq.true&result=is.null`, { pick_finale: c.market, pick_finale_prob: null });
  } catch (e) {
    console.error("[consigliato] schedina", e);
  }
}

/**
 * Ricalcola in sequenza e salva consigliatoDi per tutte le partite future / non concluse
 * le cui quote sono cambiate (quoteCambiate(c.quote, firmaQuote(match)) === true o c assente).
 * Eseguito in background senza bloccare la risposta HTTP.
 */
export async function ricalcolaConsigliatiQuoteCambiate(giornoDa?: string): Promise<{
  esaminate: number;
  ricalcolate: number;
  invariate: number;
  errori: number;
}> {
  const da = giornoDa || oggi();
  let esaminate = 0, ricalcolate = 0, invariate = 0, errori = 0;
  try {
    const matches: any[] = await pgGetAll(
      `matches?result=is.null&day=gte.${da}&select=id,day,time,squadra1,squadra2,odd_1,odd_x,odd_2,odd_o25,odd_u25,odd_gg,odd_ng`,
      "day.asc,time.asc"
    ).catch(() => []);
    if (!matches.length) return { esaminate: 0, ricalcolate: 0, invariate: 0, errori: 0 };
    esaminate = matches.length;

    const ids = matches.map((m) => m.id);
    const dossierMap = new Map<string, any>();
    const BLOCCO = 50;
    for (let i = 0; i < ids.length; i += BLOCCO) {
      const fetta = ids.slice(i, i + BLOCCO);
      const lista = fetta.map((id) => `"${id}"`).join(",");
      const dRows = await pgGet(`dossier_web?match_id=in.(${lista})&select=match_id,numeri`).catch(() => []);
      for (const d of dRows) dossierMap.set(d.match_id, d.numeri);
    }

    for (const m of matches) {
      if (partitaIniziata(m)) { invariate++; continue; }
      const numeri = dossierMap.get(m.id);
      const c = numeri?.consigliato;
      const ora = firmaQuote(m);
      // Si rifa' se manca o se le quote sono cambiate (fino al via: consigliatoDi).
      const cambiate = !c || quoteCambiate(c.quote, ora);
      if (!cambiate) {
        invariate++;
        continue;
      }
      try {
        await consigliatoDi(m.id, undefined, true);
        ricalcolate++;
      } catch (e) {
        errori++;
        console.error(`[consigliato] ricalcolo quote ${m.id}`, e);
      }
    }
  } catch (e) {
    console.error("[ricalcolaConsigliatiQuoteCambiate] errore generale", e);
  }
  return { esaminate, ricalcolate, invariate, errori };
}

/**
 * Ricalcola in sequenza e salva il consigliato per tutte le partite non ancora giocate
 * (result is null e orario d'inizio non passato), ad esempio dopo l'aggiornamento della tabella scenari.
 */
export async function ricalcolaConsigliatiNonGiocate(giornoDa?: string): Promise<{
  esaminate: number;
  ricalcolate: number;
  errori: number;
}> {
  const da = giornoDa || oggi();
  let esaminate = 0, ricalcolate = 0, errori = 0;
  try {
    const matches: any[] = await pgGetAll(
      `matches?result=is.null&day=gte.${da}&select=id,day,time,squadra1,squadra2,odd_1,odd_x,odd_2,odd_o25,odd_u25,odd_gg,odd_ng`,
      "day.asc,time.asc"
    ).catch(() => []);
    const now = Date.now();
    const nonGiocate = matches.filter((m) => {
      const inizio = inizioPartitaMs(m.day, m.time);
      return inizio === null || inizio > now;
    });
    esaminate = nonGiocate.length;
    // Pronostico unico (15/10/2026): la tabella scenari aggiornata non cambia i consigliati gia' fatti.
    const conC = new Set<string>();
    for (let i = 0; i < nonGiocate.length; i += 50) {
      const lista = nonGiocate.slice(i, i + 50).map((m) => `"${m.id}"`).join(",");
      for (const d of await pgGet(`dossier_web?match_id=in.(${lista})&select=match_id,c:numeri->consigliato`).catch(() => [])) if (d.c) conC.add(d.match_id);
    }
    for (const m of nonGiocate) {
      if (conC.has(m.id)) continue;
      try {
        await consigliatoDi(m.id, undefined, true);
        ricalcolate++;
      } catch (e) {
        errori++;
        console.error(`[consigliato] ricalcolo non giocata ${m.id}`, e);
      }
    }
  } catch (e) {
    console.error("[ricalcolaConsigliatiNonGiocate] errore generale", e);
  }
  return { esaminate, ricalcolate, errori };
}


// ============================================================================
// RISULTATI DEL CAMPIONATO (19/10/2026, Rossi: vista semplice "scenario + campionato"). Gli ultimi
// risultati dello stesso campionato giocati PRIMA della partita: la scheda calcola da sola quante volte
// ogni opzione sarebbe entrata. Solo un dato da leggere: non decide il pronostico (prova del 19/10:
// scenario + campionato non migliorava il consigliato). In memoria per un'ora per campionato e giorno.
// ============================================================================
export type RisultatiCampionato = { lega: string; n: number; media: number | null; ris: string[] };
const cacheCampionato = new Map<string, { quando: number; dati: RisultatiCampionato }>();

export async function risultatiCampionato(lega: string | null | undefined, prima: string | null | undefined): Promise<RisultatiCampionato | null> {
  const l = String(lega || "").trim();
  if (!l || !prima) return null;
  const k = `${l}|${prima}`;
  const c = cacheCampionato.get(k);
  if (c && Date.now() - c.quando < 60 * 60 * 1000) return c.dati;
  const righe: any[] = await pgGet(`matches?manifestazione=eq.${encodeURIComponent(l)}&day=lt.${encodeURIComponent(prima)}&result=not.is.null&select=result&order=day.desc&limit=300`).catch(() => []);
  const ris = righe.map((r) => String(r.result || "").replace(/\s/g, "")).filter((r) => /^\d+-\d+$/.test(r));
  const gol = ris.map((r) => r.split("-").reduce((a, b) => a + Number(b), 0));
  const dati = { lega: l, n: ris.length, media: ris.length ? +(gol.reduce((a, b) => a + b, 0) / ris.length).toFixed(2) : null, ris };
  cacheCampionato.set(k, { quando: Date.now(), dati });
  return dati;
}
