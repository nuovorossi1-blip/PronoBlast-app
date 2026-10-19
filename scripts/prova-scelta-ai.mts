/**
 * PROVA DELLA SCELTA RAGIONATA DELL'AI (19/10/2026, Rossi: "ok AI"). Non salva niente: stampa il
 * ragionamento e la giocata per le partite indicate. All'AI non arriva il risultato.
 *
 * Uso (dalla cartella server-locale): npx tsx --env-file=.env ../scripts/prova-scelta-ai.mts <id> [<id> ...] [--pro]
 */
import { datiLettura, MODELLI_GRATIS } from "../netlify/functions/lib/letturaPartita";
import { testoScelta, SISTEMA_SCELTA, giocataValida } from "../netlify/functions/lib/sceltaAI";
import { callLlm } from "../netlify/functions/lib/llmProviders";
import { opzioneDaId, modelloScelto } from "../netlify/functions/lib/llmScelta";

const pro = process.argv.includes("--pro");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modelli: any[] = pro ? [await modelloScelto()] : await Promise.all(MODELLI_GRATIS.map((m) => opzioneDaId("or:" + m)));

for (const id of ids) {
  const x: any = await datiLettura(id, { completo: true });
  if (!x) { console.log(`${id}: partita non trovata`); continue; }
  const m = x.match;
  const { testo, opzioni, scenario } = testoScelta(m, x.numeri?.lettura_ai?.direzione ?? null);
  console.log(`\n==== ${m.squadra1} - ${m.squadra2} (${m.manifestazione}) · ${scenario} · forma: ${x.forma?.tipo ?? "?"}`);
  console.log(`opzioni: ${opzioni.map((o) => `${o.codice} @${o.quota.toFixed(2)}`).join(" | ") || "nessuna"}`);
  let fatto = false;
  for (const opt of modelli) {
    if (!opt || fatto) continue;
    try {
      const r = await callLlm(opt, SISTEMA_SCELTA, x.testo + "\n" + testo);
      const j = JSON.parse((r.match(/\{[\s\S]*\}/) || [""])[0]);
      const g = giocataValida(j.giocata, opzioni);
      console.log(`[${opt.label}] direzione ${j.direzione} · risultati ${JSON.stringify(j.risultati_probabili)}`);
      console.log(`  book: ${j.ragionamento?.book}`);
      console.log(`  direzione: ${j.ragionamento?.direzione}`);
      console.log(`  segnano: ${j.ragionamento?.segnano}`);
      console.log(`  scelta: ${j.ragionamento?.scelta}`);
      console.log(`  GIOCATA: ${j.giocata}${g ? ` -> valida @${g.quota.toFixed(2)}` : " -> NON valida / nessuna"}`);
      fatto = true;
    } catch (e: any) { console.log(`  [${opt?.label}] errore: ${String(e?.message || e).slice(0, 120)}`); }
  }
}
