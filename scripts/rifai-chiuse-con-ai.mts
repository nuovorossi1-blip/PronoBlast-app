/**
 * LE PARTITE CHIUSE RIFATTE CON LA SCELTA RAGIONATA DELL'AI (19/10/2026, Rossi: "e le vecchie, quelle
 * concluse?"). Per ogni partita chiusa con dossier e lettura del formato vecchio, dalla piu' recente:
 *  1. la lettura AI di prima del via si conserva in numeri.lettura_ai_prima_del_via (una volta sola);
 *  2. nuova lettura AI gratis con la scelta ragionata (all'AI NON arriva il risultato; la forma usa solo
 *     le partite giocate prima di questa);
 *  3. consigliato rifatto (rifai) e giocata della Schedina (pick_finale) allineata.
 * Il limite giornaliero delle letture gratis vale anche qui: --max=N (consigliato 500/giorno).
 *
 * Uso (dalla cartella server-locale): npx tsx --env-file=.env ../scripts/rifai-chiuse-con-ai.mts --max=500
 */
import { pgGet, pgGetAll, pgPatch } from "../netlify/functions/lib/supabaseRest";
import { generaLetturaAI, consigliatoDi, giocataDelConsigliato, letturePossibili } from "../netlify/functions/lib/letturaPartita";

const max = Number(process.argv.find((a) => a.startsWith("--max="))?.split("=")[1] || 500);

const dossier = await pgGetAll("dossier_web?select=match_id,rag:numeri->lettura_ai->ragionamento&numeri->programma=not.is.null", "match_id.asc");
const daFare = new Set(dossier.filter((d: any) => !d.rag).map((d: any) => d.match_id));
const chiuse = await pgGetAll("matches?select=id,day,time,squadra1,squadra2,result&result=not.is.null", "day.desc");
const lista = chiuse.filter((m: any) => daFare.has(m.id)).slice(0, max);
console.log(`Da rifare con l'AI: ${lista.length} partite chiuse (su ${chiuse.filter((m: any) => daFare.has(m.id)).length}).`);

let fatte = 0, giocate = 0, lasciate = 0, senzaAI = 0;
const lavora = async (m: any) => {
  if (!(await letturePossibili())) { senzaAI++; return; }
  try {
    const n = (await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(m.id)}&select=numeri`))[0]?.numeri;
    if (n?.lettura_ai && !n.lettura_ai_prima_del_via) {
      await pgPatch(`dossier_web?match_id=eq.${encodeURIComponent(m.id)}`, { numeri: { ...n, lettura_ai_prima_del_via: n.lettura_ai } });
    }
    const l = await generaLetturaAI(m.id);
    if (!l) { senzaAI++; return; }
    const c = await consigliatoDi(m.id, undefined, true, { rifai: true });
    const g = giocataDelConsigliato(c) ?? { pick_finale: null, pick_finale_prob: null };
    await pgPatch(`matches?id=eq.${encodeURIComponent(m.id)}`, g);
    fatte++; if (c?.market) giocate++; else lasciate++;
  } catch (e: any) { senzaAI++; console.log(`  errore ${m.squadra1}-${m.squadra2}: ${String(e?.message || e).slice(0, 100)}`); }
  if ((fatte + senzaAI) % 25 === 0) console.log(`  ... ${fatte + senzaAI}/${lista.length} (giocate ${giocate}, lasciate ${lasciate}, senza AI ${senzaAI})`);
};
for (let i = 0; i < lista.length; i += 3) await Promise.all(lista.slice(i, i + 3).map(lavora));
console.log(`Fatto: ${fatte} rifatte con l'AI (giocate ${giocate}, lasciate ${lasciate}); ${senzaAI} senza lettura AI (limite del giorno o modello non disponibile).`);
