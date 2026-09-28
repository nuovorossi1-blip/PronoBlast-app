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

OBBLIGO: il campo "analysis" DEVE iniziare SEMPRE con la SINTESI A SISTEMA:
  "PAVIMENTO: X gol | TETTO: Y gol | RANGE: X-Y gol"
poi 2-3 righe di motivazione che leggono le quote come SISTEMA (non singole),
indicando gap rilevanti e segnali strutturali.

Come stabilire PAVIMENTO e TETTO:
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
  "analysis": "PAVIMENTO: 2 gol | TETTO: 4 gol | RANGE: 2-4 gol. Quote O1.5 1.30 + U3.5 1.40 → range chiuso. Gap GG 1.85 vs NG 1.95 ⇒ partita simmetrica.",
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
  "h2h_over_pct": 33.3
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
  un valore inventato varrebbe meno di zero.`;

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
};

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
