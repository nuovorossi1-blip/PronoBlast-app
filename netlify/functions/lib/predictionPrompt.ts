import { detectLeagueContext, parseLeagueLabel } from "./leagueContext";

export const PREDICTION_SYSTEM = `Sei un analista esperto di scommesse calcistiche. Leggi le quote di una partita come un SISTEMA (non una alla volta) e dici quali mercati conviene giocare.

IMPORTANTE — da dove scegli
I mercati che puoi proporre sono SOLO quelli elencati nel CATALOGO che trovi nel
messaggio utente, copiati con il nome esatto. Quella lista contiene gia' i soli
mercati che possono diventare la giocata consigliata, filtrati per la soglia di
quota dell'utente. Qualsiasi mercato fuori da quella lista viene scartato dal
codice e la tua scelta va persa: in particolare NON proporre mai NG, X secco,
U1.5, U2.5, O3.5, né combo segno secco 1 o 2 con Over (1 + O1.5, 2 + O1.5, 1 + O2.5, 2 + O2.5...), né combo con DC 12.
Proponi UN solo mercato per volta, con il nome ESATTO del catalogo.
Le probabilita' sono gia' calcolate dal motore: non stimarne di tue.

═══════════════════════════════════════
FASE 1 — LEGGI LA FAMIGLIA (descrittiva: serve a spiegare, non a scegliere)
═══════════════════════════════════════
Classifica la partita in UNA delle 6 famiglie:

• OFFENSIVA_PULITA: O2.5 < 1.65, O3.5 < 2.50, GG < 1.70, NG > 1.90, U1.5 > 4.50.
  → Tante reti, attacchi netti, partita scoperta.

• OFFENSIVA_SPORCA: O2.5 < 1.85, O3.5 < 3.00, GG vicino a NG (1.80-2.00 entrambe), 1X2 senza favorita chiara.
  → Tanti gol probabili ma chi segna e' incerto.

• RANGE_CONTROLLATO: O1.5 < 1.40, O2.5 tra 1.70-2.10, O3.5 > 3.20, U3.5 < 1.30.
  → Pavimento minimo 2 gol, tetto massimo 3-4 gol. Il classico 2-4 gol.

• CHIUSA_PROTETTA: O2.5 > 2.10, U2.5 < 1.65, U3.5 < 1.15, NG < 1.85, GG > 1.95.
  → Difese forti, pochi gol, partita tattica.

• DOMINANZA_CON_TETTO: 1 < 1.55 OPPURE 2 < 1.55 (favorita netta), O3.5 > 3.50, U3.5 < 1.25.
  → Favorita vince ma senza goleada. 1-0, 2-0, 2-1.

• INSTABILE: Quote 1X2 tutte > 2.40, GG/NG entrambe 1.70-1.95, U/O quasi simmetrici.
  → Nessun segnale forte: scegli con fiducia Bassa, oppure lascia
    "playable_markets" vuoto se davvero nessun mercato del catalogo convince.

La famiglia serve a raccontare la partita nell'"analysis". NON detta un ordine di
preferenza fra i mercati: quello lo decidono i numeri del catalogo.

═══════════════════════════════════════
FASE 2 — SEI TU A STILARE LA CLASSIFICA E IL VERDETTO
═══════════════════════════════════════
Tu hai il web, il motore Poisson e il PRE no: la classifica la decidi tu.
Motore (prob, "motore #n") e PRE sono DATI e CONTROLLI, non voti da seguire.
Gerarchia della decisione, in quest'ordine:
  1. QUALITA' DEI DATI WEB: sono prepartita? riguardano proprio queste squadre
     e questa competizione? sono confermati da fonti affidabili? Un dato va
     sempre qualificato: "xG 1,8" non dice niente se non dici a cosa si
     riferisce (a partita? stagione? torneo?), in che periodo e da che fonte.
     I precedenti con tanti gol pesano POCO: non devono prevalere su dati piu'
     recenti e pertinenti solo perche' confermano l'Over.
  2. CONTESTO TATTICO: una favorita netta puo' vincere controllando la partita
     oppure dilagare. Profilo (DIFENSIVA/neutra/offensiva) e notizie (moduli,
     assenze, motivazioni) servono a distinguere i due casi.
  3. POISSON E QUOTE: misure di probabilita' e di controllo, non verdetto
     automatico. Il mercato con la prob piu' alta NON e' primo per forza.
  4. IL MERCATO che meglio esprime la lettura:
     - direzione forte ma gol incerti o contenuti → combinazione direzione +
       limite ai gol (1 + U4.5, DC 1X + U3.5 e speculari) o la sola direzione;
     - evidenze di partita aperta → O2.5 / MG 3-6 possono stare in cima.
REGOLA DIREZIONALE (vincolante, la controlla anche il codice): con favorita
netta (scenario GAP TECNICO) e profilo DIFENSIVA, al primo posto di ogni fascia
NON puo' stare un mercato che scommette sui gol (O2.5, MG 3-6, GG, GG + O2.5,
DC 1X + O2.5...): se lo metti, il codice lo scarta.
Il risultato della partita non esiste per te: ragiona SOLO con le informazioni
disponibili prima del calcio d'inizio.

PUNTA SU QUESTO — campo "main_prediction":
il mercato del CATALOGO su cui punteresti DI PIU' per questa partita, a
QUALUNQUE quota. Misurato sullo storico (07/10/2026): quote e motore leggono
gol e direzione MEGLIO di te; tu batti i numeri solo quando sai una NOTIZIA
che le quote non contengono ancora. Quindi:
- senza una notizia concreta, scegli il mercato che i numeri (motore, quote,
  forma gol) indicano come piu' probabile e solido;
- solo con una notizia concreta dai DATI SULLA PARTITA (un'assenza pesante con
  il nome del giocatore, una formazione ufficiale con riserve, una squadra gia'
  qualificata o senza motivazioni) puoi ribaltare il motore, e la scrivi nel
  campo "consiglio.notizia".
Non sceglierlo per la quota e non inventare notizie: il codice controlla che
la notizia sia davvero nei dati, e se non c'e' il tuo consiglio non vale.

IL CONSIGLIO VA MOTIVATO — campo "consiglio" (caso Irlanda-Austria: l'AI ha
consigliato GG al 47% come "veicolo" di X oppure GG, che era giocabile col suo
nome al 57%, senza un solo fatto dal web a sostegno):
  "mercato": uguale a main_prediction;
  "perche": 1-2 frasi, perche' e' il migliore per QUESTA partita;
  "web": cosa dicono le fonti web che il motore e le quote NON sanno (assenze,
         forma, moduli, motivazioni) e come sposta la scelta; se il web non
         aggiunge niente scrivi esattamente "niente di nuovo dal web: decidono i
         numeri";
  "notizia": il fatto concreto che ti fa cambiare la scelta dei numeri,
         COPIATO dai DATI SULLA PARTITA con i nomi (es. "Iceland: Albert
         Gudmundsson (infortunio)"); stringa vuota "" se non c'e' una notizia
         cosi'. Forma, classifica, xG e precedenti NON sono notizie: le quote
         li conoscono gia';
  "alternative": per OGNUNO di questi mercati, perche' NON lo preferisci:
         il piu' probabile del CATALOGO, il primo del PRE, ogni mercato del
         manuale ammesso in questa partita e gli altri mercati che tu stesso
         proponi nelle fasce o in playable_markets (cambiano di partita in
         partita).
REGOLE VINCOLANTI:
- Se il consiglio ha una probabilita' PIU' BASSA di un'alternativa, "web" deve
  citare un fatto preciso che lo giustifica. Senza un fatto cosi', consiglia il
  piu' probabile e solido.
- Un mercato del manuale ammesso nel CATALOGO (es. "X oppure GG", "1 AH -0,75")
  si propone CON IL SUO NOME: vietato scegliere un "veicolo piu' vicino" o un
  surrogato quando il mercato vero e' giocabile.

CLASSIFICA PER FASCIA DI QUOTA — campo "fasce":
le fasce sono INTERVALLI CHIUSI: "1.40" = quote da 1.40 a 1.49, "1.50" = da
1.50 a 1.59, "1.60" = da 1.60 a 1.74, "1.75" = da 1.75 in su. Una quota 1.48
sta SOLO nella fascia 1.40; una 1.62 SOLO nella 1.60. Per ciascuna fascia una
classifica di 1-5 mercati del CATALOGO con quota DENTRO quella fascia, dal piu'
PROBABILE al meno — mai dal piu' pagato: se 1, O2.5 e GG pagano 1.47, 1.48 e
1.49, decide quale e' piu' probabile in questa partita. Un "perche" di 1-2
frasi per fascia: perche' QUELLA scelta e dove sta nel ranking del motore. Se a
una fascia la scelta migliore e' sotto il 58% di probabilita', dillo nel
"perche" ("non affidabile a questa quota"). Se a una fascia non c'e' niente di
coerente con la tua lettura, lascia la classifica vuota: meglio nessuna giocata
che una giocata contro la lettura.
I mercati del manuale ammessi stanno nelle fasce con la loro probabilita',
come gli altri.
"playable_markets" = i mercati delle tue classifiche, dal piu' solido.

ORDINE FISSO DEL CAMPO "analysis" (due parti, in quest'ordine):
  (1) LETTURA DELLA PARTITA — 2-3 frasi: le quote lette come SISTEMA (non
      singole), gap rilevanti, scenario e manuale quando pertinenti.
  (2) PERCHE' QUESTA SCELTA — 2-3 frasi: perche' il main_prediction e gli
      altri mercati proposti.
VIETATO ripetere il PIN (pavimento, tetto, range, lambda): e' gia' a schermo
nella sezione STRUTTURA MATCH. I dati delle squadre — numeri (attacco, difesa,
xG, forma) E fatti tattici (modulo, assenze, precedenti) — vanno nel campo
"statistiche_squadre" (i fatti in "note_chiave"), NON in prosa: la scheda li
mostra in una tabella casa | ospite.

Come stabilire PAVIMENTO e TETTO (servono a "min_goals"/"max_goals", non all'analysis):
- PAVIMENTO = gol minimo probabili. Es. O1.5 <= 1.30 ⇒ pavimento 2. O1.5 1.31-1.60 ⇒ pavimento "0 (probabile 2)". O1.5 > 1.60 ⇒ pavimento 0.
- TETTO = gol massimo probabili. Es. U3.5 <= 1.40 ⇒ tetto 3. U2.5 <= 1.40 ⇒ tetto 2. U3.5 > 1.85 ⇒ tetto "aperto".
- Quando trovi gap forte O/U (es. U3.5 1.30 vs O3.5 3.20) usalo come segnale di tetto chiaro.

REGOLA DI COERENZA (assoluta): i mercati che proponi non devono contraddirsi fra
loro. Mai GG insieme a un mercato che implica NG, mai O2.5 con U2.5, mai "1" con
"X2" o "2" con "1X". Se la partita ha una direzione, tutti i mercati proposti
devono stare da quella parte.

═══════════════════════════════════════
OUTPUT (SOLO JSON, niente markdown)
═══════════════════════════════════════
{
  "family": "RANGE_CONTROLLATO",
  "analysis": "LETTURA DELLA PARTITA: O1.5 1.30 e U3.5 1.40 disegnano un range chiuso; GG 1.85 contro NG 1.95 dice partita simmetrica. PERCHE' QUESTA SCELTA: il multigol copre tutto il range senza dipendere da chi segna; la direzione casa e' confermata dalle assenze ospiti.",
  "playable_markets": [
    {"market": "MG 2-4 totali", "reasoning": "Pavimento 2, tetto 4: copertura range completo"},
    {"market": "DC 1X + O1.5", "reasoning": "Direzione casa rafforzata dal pavimento"},
    {"market": "GG + O2.5", "reasoning": "Entrambe segnano in una partita da almeno 3 gol"}
  ],
  "main_prediction": "MG 2-4 totali",
  "confidence": "Media",
  "min_goals": 2,
  "max_goals": 4,
  "xg_casa": 1.15,
  "xg_ospite": 1.25,
  "h2h_over_pct": 33.3,
  "consiglio": {
    "mercato": "MG 2-4 totali",
    "perche": "Range chiuso 2-4 e la probabilita' piu' alta del catalogo (64%).",
    "web": "Niente di nuovo dal web: decidono i numeri.",
    "notizia": "",
    "alternative": [
      {"mercato": "DC 1X + O1.5", "perche_no": "Dipende dalla direzione casa, che il web non conferma (formazioni incerte)."},
      {"mercato": "GG + O2.5", "perche_no": "47%: troppo sotto per una partita a range chiuso."}
    ]
  },
  "fasce": {
    "1.40": {"classifica": ["DC 1X + O1.5"], "perche": "Quota 1.45, la piu' probabile fra quelle da 1.40 a 1.49 (motore #2, 63%)."},
    "1.50": {"classifica": ["MG 2-4 totali"], "perche": "Stessa lettura, quota 1.54 (fascia 1.50-1.59): ancora sopra il 58%."},
    "1.60": {"classifica": ["GG + O2.5"], "perche": "Unica coerente fra 1.60 e 1.74, ma al 47%: non affidabile, non superare 1.50."},
    "1.75": {"classifica": [], "perche": "Niente di coerente con la lettura a questa quota."}
  },
  "statistiche_squadre": {
    "casa":   {"attacco": "1,8 gol/partita in casa", "difesa": "0,9 subiti", "xg": "1,15", "xga": "", "forma": "V V P N V", "proiezione_gol": "", "note_chiave": "attaccante titolare squalificato"},
    "ospite": {"attacco": "1,1 gol/partita fuori", "difesa": "", "xg": "1,25", "xga": "", "forma": "P N V P P", "proiezione_gol": "", "note_chiave": ""}
  }
}

REGOLA SUI TRE CAMPI FINALI — vale solo se nel messaggio utente c'e' il blocco
"DATI DAL WEB":
- "xg_casa" e "xg_ospite": gli expected goals delle due squadre, SOLO se
  compaiono letteralmente in quel blocco. Se ci sono solo xG stagionali o di
  altre partite, mettili lo stesso ma dillo nell'analisi.
- "h2h_over_pct": percentuale di Over 2.5 negli scontri diretti, SOLO se
  scritta nel blocco.
- Se un numero non c'e', metti null. NON dedurlo, NON stimarlo, NON ricavarlo
  dalle quote: quei campi finiscono in un confronto con i numeri del motore, e
  un valore inventato varrebbe meno di zero.

REGOLA SU "statistiche_squadre" (tabella casa | ospite mostrata a Rossi):
- Schema FISSO: "casa" e "ospite", ognuna con le chiavi attacco, difesa, xg,
  xga, forma, proiezione_gol, note_chiave. Valori brevi, in testo.
- SOLO dati realmente trovati nel blocco "DATI DAL WEB". Dato assente =
  stringa vuota "", MAI inventato, MAI ricavato dalle quote.
- Senza blocco web puoi lasciare tutti i campi vuoti o omettere il campo.`;

function fmt(o: any, k: string, label: string): string {
  const v = o?.[k];
  if (v === null || v === undefined) return `${label} N/D`;
  const est = (o?.estimated || []).includes(k) ? " (stima)" : "";
  return `${label} ${v}${est}`;
}

export function buildMatchPrompt(match: {
  manifestazione: string;
  time: string;
  squadra1: string;
  squadra2: string;
  odds: any;
}): string {
  const manif = match.manifestazione || "";
  const context = detectLeagueContext(manif);
  const parsedComp = parseLeagueLabel(manif);
  const o = match.odds || {};
  const parts = [
    fmt(o, "odd_1", "1"), fmt(o, "odd_X", "X"), fmt(o, "odd_2", "2"),
    fmt(o, "odd_1X", "1X"), fmt(o, "odd_X2", "X2"), fmt(o, "odd_12", "12"),
    fmt(o, "odd_U15", "U1.5"), fmt(o, "odd_O15", "O1.5"),
    fmt(o, "odd_U25", "U2.5"), fmt(o, "odd_O25", "O2.5"),
    fmt(o, "odd_U35", "U3.5"), fmt(o, "odd_O35", "O3.5"),
    fmt(o, "odd_GG", "GG"), fmt(o, "odd_NG", "NG"),
  ];
  const ctxBlock = context ? `\nCONTESTO CAMPIONATO: ${context}\n` : "";
  const compLine = parsedComp ? ` (${parsedComp})` : "";
  return (
    `PARTITA: ${manif}${compLine} · ${match.time} ${match.squadra1} vs ${match.squadra2}\n` +
    `Quote: ${parts.join(" | ")}` +
    `${ctxBlock}` +
    `\nUsa il contesto del campionato (DNA gol, partita di coppa) come modulatore: se DNA Over alto privilegia O2.5/O1.5; se DNA conservativo o partita di coppa privilegia U3.5/MG 2-4 e tatticismi.\n` +
    `Analizza e restituisci SOLO JSON.`
  );
}

export type AiPrediction = {
  family: string;
  analysis: string;
  playable_markets: { market: string; reasoning?: string }[];
  main_prediction: string | null;
  confidence: string;
  min_goals?: number;
  max_goals?: number;
  /** xG letti LETTERALMENTE nel blocco web, mai dedotti (28/09/2026).
   *  null quando il blocco non li contiene: un xG inventato e' peggio di
   *  nessun xG, perche' verrebbe confrontato con i lambda del motore come se
   *  fosse un dato. */
  xg_casa?: number | null;
  xg_ospite?: number | null;
  h2h_over_pct?: number | null;
  /** Ticket 10: statistiche trovate sul web, casa | ospite. Opzionale: le
   *  vecchie predictions non ce l'hanno. */
  statistiche_squadre?: StatisticheSquadre | null;
};

export const CHIAVI_STATISTICHE = ["attacco", "difesa", "xg", "xga", "forma", "proiezione_gol", "note_chiave"] as const;
export type StatisticheSquadra = Partial<Record<(typeof CHIAVI_STATISTICHE)[number], string>>;
export type StatisticheSquadre = { casa: StatisticheSquadra; ospite: StatisticheSquadra };

/**
 * Normalizza "fasce" della risposta del modello: solo le quattro fasce, solo
 * nomi di mercato in testo, al massimo 5 per fascia. null se manca: il
 * pronostico non si blocca mai per questo campo (e il verdetto torna alla
 * fusione).
 */
export type ConsiglioAI = {
  mercato: string;
  perche: string;
  web: string;
  /** La notizia concreta che giustifica il cambio rispetto ai numeri (07/10/2026). */
  notizia: string;
  /** Messo dal codice: la notizia c'e' davvero nei dati della partita. */
  notizia_verificata?: boolean;
  alternative: { mercato: string; perche_no: string }[];
};

/** Normalizza "consiglio" della risposta del modello. null se manca. */
export function normalizzaConsiglio(v: any, mainPrediction?: string | null): ConsiglioAI | null {
  if (!v || typeof v !== "object") return null;
  const str = (x: any, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const mercato = str(v.mercato, 60) || str(mainPrediction, 60);
  if (!mercato) return null;
  const alternative = (Array.isArray(v.alternative) ? v.alternative : [])
    .map((a: any) => ({ mercato: str(a?.mercato ?? a?.market, 60), perche_no: str(a?.perche_no ?? a?.perche, 300) }))
    .filter((a: { mercato: string }) => a.mercato)
    .slice(0, 5);
  return { mercato, perche: str(v.perche, 500), web: str(v.web, 500), notizia: str(v.notizia, 400), alternative };
}

export function normalizzaFasce(v: any): Record<string, { classifica: string[]; perche: string }> | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, { classifica: string[]; perche: string }> = {};
  for (const k of ["1.40", "1.50", "1.60", "1.75"]) {
    const f = v[k] ?? v[String(Number(k))];
    if (!f || typeof f !== "object") continue;
    const classifica = (Array.isArray(f.classifica) ? f.classifica : [])
      .map((m: any) => (typeof m === "string" ? m : m?.market))
      .filter((m: any) => typeof m === "string" && m.trim())
      .map((m: string) => m.trim())
      .slice(0, 5);
    out[k] = { classifica, perche: typeof f.perche === "string" ? f.perche.trim() : "" };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Normalizza "statistiche_squadre" della risposta del modello: solo le chiavi
 * dello schema, solo stringhe. null se manca o se e' tutto vuoto (il
 * pronostico non si blocca mai per questo campo).
 */
export function normalizzaStatistiche(v: any): StatisticheSquadre | null {
  if (!v || typeof v !== "object") return null;
  const lato = (x: any): StatisticheSquadra => {
    const out: StatisticheSquadra = {};
    for (const k of CHIAVI_STATISTICHE) {
      const val = x?.[k];
      out[k] = val === null || val === undefined ? "" : String(val).trim();
    }
    return out;
  };
  const casa = lato(v.casa), ospite = lato(v.ospite);
  const pieni = [...Object.values(casa), ...Object.values(ospite)].filter((x) => x).length;
  return pieni ? { casa, ospite } : null;
}

/** Porting 1:1 di parse_ai_json — estrazione robusta di JSON dalla risposta del modello. */
export function parseAiJson(text: string): AiPrediction {
  if (!text?.trim()) {
    // `illeggibile` (06/10/2026): prima una risposta vuota si SALVAVA come
    // pronostico ("INSTABILE", "Risposta vuota") e la scheda proponeva
    // Rigenera all'infinito. Ora ai-predict la scarta e dice perche'.
    return { family: "INSTABILE", analysis: "Risposta vuota", playable_markets: [], main_prediction: null, confidence: "Bassa", illeggibile: true } as AiPrediction;
  }
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/i.exec(text);
  if (fence) candidates.push(fence[1]);

  for (let s = 0; s < text.length; s++) {
    if (text[s] !== "{") continue;
    let depth = 0;
    for (let i = s; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(s, i + 1));
          break;
        }
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && "family" in obj) return obj as AiPrediction;
    } catch {
      continue;
    }
  }
  // RISPOSTA TRONCATA (01/10/2026, Israele-Kosovo): il modello ha finito i
  // token a meta' JSON. Si prova a chiuderlo e si recupera quello che c'e'.
  const riparato = riparaJsonTroncato(text);
  if (riparato && typeof riparato === "object" && "family" in riparato) {
    return { ...(riparato as AiPrediction), troncato: true } as AiPrediction;
  }
  return { family: "INSTABILE", analysis: text.slice(0, 300), playable_markets: [], main_prediction: null, confidence: "Bassa", illeggibile: true } as AiPrediction;
}

/**
 * Chiude un JSON tagliato a meta': dal primo "{" tiene traccia di stringhe e
 * parentesi; alla fine chiude la stringa aperta, toglie l'ultima voce rimasta a
 * meta' (chiave senza valore, virgola finale) e chiude parentesi e graffe.
 * Prova piu' tagli all'indietro finche' JSON.parse accetta. null se non riesce.
 */
export function riparaJsonTroncato(text: string): any | null {
  const inizio = text.indexOf("{");
  if (inizio < 0) return null;
  const t = text.slice(inizio);
  // Punti "sicuri" dove tagliare: subito dopo una virgola o un'apertura fuori
  // dalle stringhe, con la pila delle parentesi aperte in quel momento.
  const tagli: { pos: number; pila: string[] }[] = [];
  const pila: string[] = [];
  let inStringa = false, escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStringa) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inStringa = false;
      continue;
    }
    if (c === '"') inStringa = true;
    else if (c === "{" || c === "[") { pila.push(c); tagli.push({ pos: i + 1, pila: [...pila] }); }
    else if (c === "}" || c === "]") { pila.pop(); tagli.push({ pos: i + 1, pila: [...pila] }); }
    else if (c === ",") tagli.push({ pos: i, pila: [...pila] });
  }
  // Dal taglio piu' lungo al piu' corto: il primo che si legge vince.
  for (let k = tagli.length - 1; k >= 0 && k >= tagli.length - 400; k--) {
    const { pos, pila: aperte } = tagli[k];
    if (!aperte.length) continue;
    const chiusura = aperte.slice().reverse().map((p) => (p === "{" ? "}" : "]")).join("");
    try {
      return JSON.parse(t.slice(0, pos) + chiusura);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * SCENARIO DI QUOTE E MANUALE NEL PROMPT (Ticket 9, richiesta di Rossi del
 * 29/09: "in base alla partita e al tipo di scenario l'AI deve prendere in
 * considerazione anche i relativi pronostici presenti nello scenario").
 *
 * Solo orientamento: il formato JSON non cambia e il filtro post-AI resta la
 * garanzia. Un mercato del manuale fuori catalogo (fuori whitelist o sotto
 * soglia) puo' essere solo CITATO nell'analysis, mai proposto.
 */
export type VoceManuale = {
  /** nome come lo scrive il manuale (es. "1 fisso", "Over 2,5") */
  manuale: string;
  /** misura dall'archivio: vinte / (vinte + perse) sulle partite con questo scenario */
  vinte?: number;
  valutate?: number;
  pct?: number | null;
  /** "catalogo" = proponibile; "soglia" = in whitelist ma quota sotto la soglia; "fuori" = fuori whitelist */
  stato: "catalogo" | "soglia" | "fuori";
  /** nome del mercato nel catalogo, se esiste */
  nomeCatalogo?: string;
  quota?: number | null;
};

const pct1 = (v: number) => v.toFixed(1).replace(".", ",");

export function bloccoScenarioManuale(args: {
  scenario: string;
  favorita?: string | null;
  voci: VoceManuale[];
  minOdd: number;
  profiloDifensivo: boolean;
  /** % da manuale di "GG + Over 2,5" in questo scenario (solo GAP TECNICO) */
  ggO25Manuale?: number | null;
}): string {
  const nomeScenario = args.scenario.toUpperCase() + (args.favorita ? ` (favorita: ${args.favorita})` : "");
  const righe = args.voci.map((v) => {
    const misura = v.valutate
      ? ` — ${pct1(v.pct ?? 0)}% (${v.vinte}/${v.valutate})`
      : " — nessuna partita misurata in archivio";
    const stato =
      v.stato === "catalogo" ? ` [nel CATALOGO come "${v.nomeCatalogo}"]` :
      v.stato === "soglia" ? ` [SOTTO SOGLIA: "${v.nomeCatalogo}" quota ${v.quota?.toFixed(2) ?? "n/d"} < ${args.minOdd.toFixed(2)}]` :
      " [fuori dai mercati giocabili: solo lettura]";
    return `• ${v.manuale}${misura}${stato}`;
  });

  const gapTecnico = args.scenario.toLowerCase().startsWith("gap");
  const clausola = gapTecnico
    ? `
CLAUSOLA DI COERENZA (caso Belgio-Galles 1-0): il veicolo deve preservare la
NATURA della lettura del manuale. Il manuale del GAP TECNICO e' direzione pura
(favorita fisso, AH -0,75): un veicolo che aggiunge rischio gol (DC 1X + O2.5,
1 + O2.5, e speculari) — E ALLO STESSO MODO un mercato di soli gol (O2.5,
MG 3-6, GG) — va messo primo SOLO se la componente gol non e' sconsigliata
dallo scenario stesso (GG + Over 2,5 da manuale >= 50%: qui ${args.ggO25Manuale != null ? pct1(args.ggO25Manuale) + "%" : "non misurato"}) ne' dal
profilo strutturale (qui: ${args.profiloDifensivo ? "DIFENSIVA → componente gol SCONSIGLIATA" : "non DIFENSIVA"}).
Se la direzione pura e' tutta sotto soglia E il gol e' sconsigliato: l'analysis
dichiara "nessuna giocata coerente col manuale sopra soglia" e playable_markets
resta vuoto o ridotto — meglio nessun endorsement che un surrogato goloso
(casi-specchio: Spagna-Croazia 4-1, veicolo ok e vincente; Belgio-Galles 1-0,
veicolo perso: la differenza stava nel profilo, leggilo PRIMA di proporre).`
    : "";

  return `

============================================================
🎯 SCENARIO DI QUOTE (manuale del proprietario)
============================================================
Questa partita e' di scenario: ${nomeScenario}
Mercati da manuale per questo scenario, con quanto hanno risposto
storicamente in partite con questo stesso scenario (dall'archivio):
${righe.join("\n")}

Istruzione: se un mercato del manuale e' presente nel CATALOGO, valutalo
con priorita' e motivalo nell'analysis. Se NON e' nel catalogo (fuori
whitelist o sotto soglia), NON proporlo come playable_market: nominalo
solo nell'analysis come "lettura da manuale non giocabile oggi".
Se e' escluso SOLO dalla soglia, l'analysis deve dirlo esplicitamente:
"lettura da manuale non giocabile con la soglia attuale: si sblocca
abbassando la Quota minima" — e poi valutare il veicolo piu' vicino DENTRO
il catalogo.${clausola}
L'analysis puo' aprirsi citando lo scenario (es. "scenario ${args.scenario.toUpperCase()}: il manuale
indica ..."): i mercati del manuale con storico forte sono la prima lettura.
============================================================
`;
}

/**
 * LA NOTIZIA C'E' DAVVERO? (07/10/2026, scelta B con Rossi). Il consiglio
 * dell'AI vale piu' dei numeri solo se cita un fatto presente nei dati della
 * partita. Si confrontano le parole "pesanti" della notizia (5+ lettere, senza
 * le parole comuni): almeno 2, e almeno il 60% deve comparire nel dossier.
 * Forma, classifica e xG non sono notizie (le quote li conoscono).
 */
const PAROLE_COMUNI = new Set([
  "della", "delle", "degli", "dello", "nella", "nelle", "sulla", "sulle", "dalla", "dalle", "questa", "questo",
  "partita", "squadra", "contro", "anche", "senza", "ultime", "ultimi", "sempre", "perche", "quindi", "molto",
  "rientro", "early", "late", "october", "november", "december", "september", "infortunio", "squalifica",
]);
const NON_NOTIZIE = /\b(forma|classifica|xg|xpoints|precedent|statistic|media gol|gol fatti|gol subiti)\b/i;
// ð/þ/ø/æ/ß/ł non si scompongono con NFD: "Guðmundsson" deve valere "Gudmundsson".
const senzaAccenti = (t: string) => t
  .replace(/[ðÐ]/g, "d").replace(/[þÞ]/g, "th").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").replace(/[łŁ]/g, "l")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PAROLE_NOTIZIA = /manca|mancano|assen|infortun|squalific|formazion|riserv|turnover|qualificat|motivaz|\bout\b|indisponibil|fuori per|senza/;

export function notiziaVerificata(notizia: string | null | undefined, datiPartita: string): boolean {
  // MIRATA (07/10/2026, Botafogo-Vasco): l'elenco intero degli infortunati
  // di tutte e due le squadre e' "vero" ma non e' una notizia. Una frase,
  // al massimo 3 giocatori, niente elenchi copiati ("|").
  const grezza = String(notizia || "");
  if (grezza.length > 220 || grezza.includes("|") || (grezza.match(/\(/g) || []).length > 3) return false;
  const n = senzaAccenti(grezza).trim();
  if (n.length < 12 || NON_NOTIZIE.test(n) && !PAROLE_NOTIZIA.test(n)) return false;
  const testo = senzaAccenti(datiPartita);
  // (a) copiata dai dati: almeno 2 parole pesanti e il 60% presenti.
  const parole = Array.from(new Set(n.match(/[a-z]{5,}/g) || [])).filter((w) => !PAROLE_COMUNI.has(w));
  const trovate = parole.filter((w) => testo.includes(w)).length;
  if (parole.length >= 2 && trovate >= 2 && trovate / parole.length >= 0.6) return true;
  // (b) detta a parole sue ("Manca Gudmundsson, il miglior attaccante"): basta
  // una parola da notizia e un NOME (maiuscola, 4+ lettere) presente nei dati.
  if (!PAROLE_NOTIZIA.test(n)) return false;
  const nomi = (String(notizia).match(/(?<!\p{L})\p{Lu}[\p{L}'-]{3,}/gu) || []).map(senzaAccenti)
    .filter((w) => !PAROLE_COMUNI.has(w) && !/^(manca|mancano|assente|assenti|infortunato|squalificato)$/.test(w));
  // I nomi delle squadre compaiono ovunque nel dossier: un nome di giocatore
  // compare una o due volte (nella riga degli assenti o delle formazioni).
  const volte = (w: string) => testo.split(w).length - 1;
  // "Iceland:" e' l'etichetta di una squadra, non un giocatore.
  return nomi.some((w) => { const k = volte(w); return k >= 1 && k <= 2 && !testo.includes(`${w}:`); });
}
