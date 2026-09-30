import { detectLeagueContext, parseLeagueLabel } from "./leagueContext";

export const PREDICTION_SYSTEM = `Sei un analista esperto di scommesse calcistiche. Leggi le quote di una partita come un SISTEMA (non una alla volta) e dici quali mercati conviene giocare.

IMPORTANTE — da dove scegli
I mercati che puoi proporre sono SOLO quelli elencati nel CATALOGO che trovi nel
messaggio utente, copiati con il nome esatto. Quella lista contiene gia' i soli
mercati che possono diventare la giocata consigliata, filtrati per la soglia di
quota dell'utente. Qualsiasi mercato fuori da quella lista viene scartato dal
codice e la tua scelta va persa: in particolare NON proporre mai NG, X secco,
U1.5, U2.5, O3.5, i multigol di casa o ospite, ne' combo con DC 12.
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
FASE 2 — RANKING + PAVIMENTO/TETTO ESPLICITI
═══════════════════════════════════════
Restituisci 3-5 mercati del catalogo ordinati dal PIU' PROBABILE al MENO
PROBABILE. Il "main_prediction" e' il primo.

ORDINE FISSO DEL CAMPO "analysis" (due parti, in quest'ordine):
  (1) LETTURA DELLA PARTITA — 2-3 frasi: le quote lette come SISTEMA (non
      singole), gap rilevanti, scenario e manuale quando pertinenti.
  (2) PERCHE' QUESTA SCELTA — 2-3 frasi: perche' il main_prediction e gli
      altri mercati proposti.
VIETATO ripetere il PIN (pavimento, tetto, range, lambda): e' gia' a schermo
nella sezione STRUTTURA MATCH. I numeri delle squadre (attacco, difesa, xG,
forma...) vanno nel campo "statistiche_squadre", NON in prosa.

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
  if (!text) {
    return { family: "INSTABILE", analysis: "Risposta vuota", playable_markets: [], main_prediction: null, confidence: "Bassa" };
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
  return { family: "INSTABILE", analysis: text.slice(0, 300), playable_markets: [], main_prediction: null, confidence: "Bassa" };
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
1 + O2.5, e speculari) va proposto SOLO se la componente gol non e' sconsigliata
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
