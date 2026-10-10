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
import { structuralAnalysis, quoteCatalogo } from "./clusterEngine";
import { getScenarioNote, chiaveScenario, inizioPartitaMs, analizzaGiocate, letturaGol, normalizeMarket, isVerdictMarket, isMercatoAmmesso, isMercatoVietato, MERCATI_VIETATI, mercatoAIValido, QuoteFirma, firmaQuote, quoteCambiate, ConsigliatoSalvato } from "../../../frontend/src/api";
import { formaGol, type FormaGol } from "./formaGol";
import { letturaProgramma, type LetturaProgramma } from "./letturaProgramma";
import { tabellaScenari, versioneTabellaCorrente } from "./tabellaScenari";
import { callLlm } from "./llmProviders";
import { opzioneDaId, modelloScelto } from "./llmScelta";
import { notiziaVerificata } from "./predictionPrompt";

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
};

const SISTEMA = `Sei un analista di calcio che spiega la partita a uno scommettitore, in italiano semplice.
Hai SOLO i dati qui sotto, raccolti PRIMA della partita. Non inventare niente.
Regole:
- I CALCOLI DEL PROGRAMMA sono affidabili: usali e spiegali, non rifarli.
- Le quote sono la lettura piu' precisa dei gol attesi; la forma conta solo pesata con la forza degli avversari (lo fa gia' il programma).
- Se il programma dice che forma e quote NON sono d'accordo, o che ci sono assenze pesanti, la lettura deve spiegarlo e tenerne conto nella direzione e nei gol (anche "nessuna" direzione).
- Direzione, gol e risultati probabili devono essere coerenti fra loro.
Rispondi SOLO con questo JSON:
{"direzione":"1|X|2|nessuna","gol_casa":"min-max","gol_ospite":"min-max","gol_totali":"min-max","forma_e_quote":"d'accordo|non d'accordo","notizia":"l'assenza o il fatto che conta, o stringa vuota","risultati_probabili":["a-b","a-b","a-b"],"lettura":"3-4 frasi semplici: chi e' favorita, chi segna, chi prende gol, che partita aspettarsi"}`;

const MERCATI_AMMESSI_PRO = "1, 2, 1X, X2, GG, O2.5, MG 2-4 totali, MG 3-6 totali, MG 2-4 casa, MG 2-4 ospite, GG + O2.5, DC 1X + O1.5, DC X2 + O1.5, DC 1X + O2.5, DC X2 + O2.5, DC 1X + U3.5, DC X2 + U3.5, DC 1X + GG, DC X2 + GG, 1 + U4.5";

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
  return !l || quoteCambiate(l.quote, firmaQuote(match));
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

/** Tutti i dati di una partita, la lettura del programma e il testo per l'AI. */
export async function datiLettura(matchId: string): Promise<{
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
  if (prSalvato && !quoteCambiate(prSalvato.quote, qAtt)) {
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
    .filter((b: any) => /FotMob/.test(b.etichetta) && !/Classifica/.test(b.etichetta))
    .map((b: any) => `- ${b.etichetta}: ${b.righe.join(" | ")}`).join("\n");
  const testo = `PARTITA: ${m.squadra1} - ${m.squadra2} (${m.manifestazione}, ${m.day} ${m.time})
QUOTE: 1 ${m.odd_1} · X ${m.odd_x} · 2 ${m.odd_2} · Over2.5 ${m.odd_o25} · Under2.5 ${m.odd_u25} · GG ${m.odd_gg} · NG ${m.odd_ng}
SCENARIO: ${scenario}
FORMA (FotMob, solo 90 minuti):
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
  const x = dati ?? (await datiLettura(matchId));
  if (!x) return null;
  const pro = !!opzioni.pro;
  if (!pro && !(await letturePossibili())) return null;
  const modelli: any[] = pro ? [await modelloScelto()] : await Promise.all(MODELLI_GRATIS.map((m) => opzioneDaId("or:" + m)));
  for (const opt of modelli) {
    if (!opt) continue;
    try {
      if (!pro) await contaLettura();
      const risposta = await callLlm(opt, pro ? SISTEMA_PRO : SISTEMA, x.testo);
      const j = JSON.parse((risposta.match(/\{[\s\S]*\}/) || [""])[0]);
      if (!j?.lettura || String(j.lettura).replace(/[^a-z]/gi, "").length < 40) continue;   // vuota o a puntini
      const str = (v: any, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const l: LetturaAI = {
        modello: opt.label, quando: new Date().toISOString(), quote: firmaQuote(x.match),
        direzione: str(j.direzione, 10), gol_casa: str(j.gol_casa, 10), gol_ospite: str(j.gol_ospite, 10), gol_totali: str(j.gol_totali, 10),
        forma_e_quote: str(j.forma_e_quote, 30), notizia: str(j.notizia, 300),
        risultati_probabili: (Array.isArray(j.risultati_probabili) ? j.risultati_probabili : []).map((r: any) => str(r, 8)).filter(Boolean).slice(0, 4),
        lettura: str(j.lettura, 900),
      };
      if (pro) {
        l.pro = true;
        l.mercato = str(j.mercato, 40);
        l.notizia_verificata = !!l.mercato && notiziaVerificata(l.notizia, x.testo);
      }
      // Rilegge i numeri: un'altra lettura puo' averli cambiati nel frattempo.
      const numeri = (await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}&select=numeri`))[0]?.numeri ?? x.numeri;
      if (numeri) {
        await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}`, { numeri: { ...numeri, [pro ? "lettura_pro" : "lettura_ai"]: l } });
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
  ai: "confermato" | "cambiato" | null; notizia: string | null;
  /** Se l'AI ha cambiato: la giocata dei numeri, per tornare indietro e per
   *  misurare chi ha ragione (pagella, Rossi 07/10/2026). */
  numeri_market?: string | null; numeri_nome?: string | null; numeri_quota?: number | null;
  /** Se "da lasciare": cosa si sarebbe giocato (pagella: lasciarle e' giusto?). */
  lasciata_market?: string | null; lasciata_quota?: number | null;
  /** Se proposta AI scartata: motivo e mercato */
  proposta_scartata?: { mercato: string; motivo: string } | null;
  quote: QuoteFirma; quando: string;
};

export async function consigliatoDi(matchId: string, dati?: Awaited<ReturnType<typeof datiLettura>>, salva = true): Promise<ConsigliatoSalvato | null> {
  const x = dati ?? (await datiLettura(matchId));
  if (!x) return null;
  const m = x.match;
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
  const a = analizzaGiocate({
    odds, marketOdds: quoteCatalogo(odds),
    ranking: (s.ranking || []).map((r: any) => ({ market: r.market, coverage: r.coverage })),
    voci, manuali: nota?.markets || [], totAtteso,
    direzione: letturaGol(st.lambda_home, st.lambda_away).direzione,
    casa: m.squadra1, ospite: m.squadra2,
    pesataCasa: pr.pesata_casa, pesataOspite: pr.pesata_ospite, accordo: pr.accordo,
    assentiCasa: pr.assenti_casa, assentiOspite: pr.assenti_ospite,
  });
  const c = a.consigliato;
  const out: ConsigliatoSalvato = {
    market: c?.market ?? null, nome: c?.nome ?? null, quota: c?.quota ?? null, stimata: !!c?.stimata,
    pA: c?.misurata?.pA ?? null, pB: c?.misurata?.pB ?? null, n: c?.misurata?.n ?? null,
    daLasciare: a.daLasciare, avvisi: a.avvisi,
    alternative: a.righe.filter((r) => r.punteggio != null && !r.consigliato && isMercatoAmmesso(r.market, nota?.markets)).slice(0, 8)
      .map((r) => ({ market: r.market, nome: r.nome, quota: r.quota, stimata: r.stimata, p: Math.min(r.misurata!.pA, r.misurata!.pB) })),
    ai: null, notizia: null, quote: firmaQuote(m), quando: new Date().toISOString(),
    lasciata_market: a.seNonLasciata?.market ?? null, lasciata_quota: a.seNonLasciata?.quota ?? null,
    tabella_versione: tabVersione,
    tradotto_da: null,
  };
  const pro = x.numeri?.lettura_pro;
  if (pro && !quoteCambiate(pro.quote, out.quote)) {
    if (pro.notizia_verificata && pro.mercato) {
      const v = mercatoAIValido(pro.mercato, a, nota?.markets);
      if (v.ok && v.market && v.quota != null) {
        if (!out.market || normalizeMarket(v.market) !== normalizeMarket(out.market)) {
          out.numeri_market = out.market; out.numeri_nome = out.nome; out.numeri_quota = out.quota;
          out.ai = "cambiato"; out.notizia = pro.notizia || null;
          out.market = v.market; out.nome = v.market.replace(/\bcasa\b/gi, m.squadra1).replace(/\bospite\b/gi, m.squadra2);
          out.quota = v.quota; out.stimata = v.stimata; out.daLasciare = null;
          out.tradotto_da = v.tradotto_da || null;
          out.proposta_scartata = null;
        } else if (out.market) {
          out.ai = "confermato";
          out.tradotto_da = v.tradotto_da || null;
          out.proposta_scartata = null;
        }
      } else {
        // Proposta AI scartata: non ammessa, senza quota o fuori scala
        out.ai = null;
        out.proposta_scartata = { mercato: pro.mercato, motivo: v.motivo ?? "non ammesso" };
        out.tradotto_da = null;
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
      if (numeri) await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}`, {
        numeri: { ...numeri, consigliato: out, programma: { ...programma, quote: out.quote } },
      });
    } catch (e) {
      console.error("[consigliato] salvataggio", e);
    }
  }
  return out;
}

/** Il consigliato salvato, se c'e' ed e' fatto con le quote di adesso e la versione corrente della tabella scenari. */
export function consigliatoValido(numeri: any, match: any, versioneAttesa?: string | null): ConsigliatoSalvato | null {
  const c = numeri?.consigliato;
  if (!c) return null;
  if (quoteCambiate(c.quote, firmaQuote(match))) return null;
  const currentV = versioneAttesa !== undefined ? versioneAttesa : versioneTabellaCorrente();
  if (currentV && (!c.tabella_versione || c.tabella_versione !== currentV)) return null;
  return c;
}


/**
 * Se l'AI ha cambiato il consigliato e la partita e' in Schedina, la giocata
 * salvata (pick_finale) diventa quella dell'AI (Rossi: "se l'ha cambiata ci
 * sara' un motivo"). Si torna indietro dalla Schedina.
 */
export async function applicaCambioInSchedina(matchId: string, c: ConsigliatoSalvato | null): Promise<void> {
  if (!c || c.ai !== "cambiato" || !c.market) return;
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
      const numeri = dossierMap.get(m.id);
      const c = numeri?.consigliato;
      const ora = firmaQuote(m);
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
    for (const m of nonGiocate) {
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
