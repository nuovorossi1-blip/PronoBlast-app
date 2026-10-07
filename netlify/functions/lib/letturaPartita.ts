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
import { pgGet, pgPatch, rowToOdds } from "./supabaseRest";
import { structuralAnalysis } from "./clusterEngine";
import { getScenarioNote, chiaveScenario, inizioPartitaMs } from "../../../frontend/src/api";
import { formaGol, type FormaGol } from "./formaGol";
import { letturaProgramma, type LetturaProgramma } from "./letturaProgramma";
import { tabellaScenari } from "./tabellaScenari";
import { callLlm } from "./llmProviders";
import { opzioneDaId } from "./llmScelta";

export const MODELLI_GRATIS = ["nvidia/nemotron-3-super-120b-a12b:free", "nvidia/nemotron-3.5-lightning:free"];

export type LetturaAI = {
  modello: string; quando: string;
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

const n1 = (x: any) => (x == null ? "n/d" : Number(x).toFixed(1));

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
  const forma = await formaGol(
    { giorno: m.day, casa: m.squadra1, ospite: m.squadra2, inizioMs: inizioPartitaMs(m.day, m.time) },
    d?.numeri?.fotmob_id,
  );
  const programma = await letturaProgramma(
    forma, { casa: m.squadra1, ospite: m.squadra2 }, { casa: st.lambda_home, ospite: st.lambda_away },
    { casa: d?.numeri?.assenti_casa ?? 0, ospite: d?.numeri?.assenti_ospite ?? 0 },
  );
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

/** Lettura AI con un modello gratis; salvata nel dossier. null se non riesce. */
export async function generaLetturaAI(matchId: string, dati?: Awaited<ReturnType<typeof datiLettura>>): Promise<LetturaAI | null> {
  const x = dati ?? (await datiLettura(matchId));
  if (!x) return null;
  for (const mod of MODELLI_GRATIS) {
    try {
      const opt: any = await opzioneDaId("or:" + mod);
      if (!opt) continue;
      const risposta = await callLlm(opt, SISTEMA, x.testo);
      const j = JSON.parse((risposta.match(/\{[\s\S]*\}/) || [""])[0]);
      if (!j?.lettura || String(j.lettura).replace(/[^a-z]/gi, "").length < 40) continue;   // vuota o a puntini
      const str = (v: any, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const l: LetturaAI = {
        modello: opt.label, quando: new Date().toISOString(),
        direzione: str(j.direzione, 10), gol_casa: str(j.gol_casa, 10), gol_ospite: str(j.gol_ospite, 10), gol_totali: str(j.gol_totali, 10),
        forma_e_quote: str(j.forma_e_quote, 30), notizia: str(j.notizia, 300),
        risultati_probabili: (Array.isArray(j.risultati_probabili) ? j.risultati_probabili : []).map((r: any) => str(r, 8)).filter(Boolean).slice(0, 4),
        lettura: str(j.lettura, 900),
      };
      if (x.numeri) {
        await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(matchId)}`, { numeri: { ...x.numeri, lettura_ai: l } });
      }
      return l;
    } catch (e) {
      console.error("[letturaAI]", mod, (e as any)?.message || e);
    }
  }
  return null;
}
