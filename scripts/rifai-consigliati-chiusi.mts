/**
 * RIFA' UNA VOLTA I PRONOSTICI DELLE PARTITE CHIUSE (19/10/2026, Rossi: "voglio vedere le partite
 * passate chiuse come sarebbero state pronosticate con queste regole, almeno quelle con il dossier: il
 * pronostico cambia solo ora e poi non cambia, e si aggiornano vinte e perse").
 *
 * Per ogni partita con risultato e dossier: consigliatoDi(..., { rifai: true }) con la lettura AI salvata
 * prima del via. Il consigliato vero di prima del via resta in numeri.consigliato_prima_del_via.
 * Le partite gia' rifatte si saltano (si puo' rilanciare). pick_finale non si tocca.
 * Nota: le percentuali d'archivio comprendono gia' i risultati di queste partite (un po' ottimiste).
 *
 * Uso (dalla cartella server-locale, per avere le variabili):
 *   npx tsx --env-file=.env ../scripts/rifai-consigliati-chiusi.mts [--max=N] [--id=<uuid>]
 */
import { pgGetAll } from "../netlify/functions/lib/supabaseRest";
import { consigliatoDi } from "../netlify/functions/lib/letturaPartita";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const max = Number(arg("max") || Infinity);
const soloId = arg("id");
// --ancora: rifa' anche quelle gia' rifatte (19/10/2026, regola "la piu' facile"); l'originale di prima del via resta.
const ancora = process.argv.includes("--ancora");

async function main() {
  const dossier = await pgGetAll("dossier_web?select=match_id,rif:numeri->consigliato->>rifatto,prog:numeri->programma->>accordo,haprog:numeri->programma&numeri->programma=not.is.null", "match_id.asc");
  const daFare = new Set(dossier.filter((d: any) => (ancora || !d.rif) && d.haprog).map((d: any) => d.match_id));
  const chiuse = await pgGetAll("matches?select=id,day,squadra1,squadra2,result&result=not.is.null", "day.asc");
  let lista = chiuse.filter((m: any) => daFare.has(m.id) && /^\d+-\d+$/.test(String(m.result).trim()));
  if (soloId) lista = lista.filter((m: any) => m.id === soloId);
  lista = lista.slice(0, max);
  console.log(`Da rifare: ${lista.length} partite chiuse con dossier.`);
  let fatte = 0, errori = 0, lasciate = 0;
  const lavora = async (m: any) => {
    try {
      const c = await consigliatoDi(m.id, undefined, true, { rifai: true });
      if (!c?.market) lasciate++;
      fatte++;
      if (lista.length <= 10) console.log(`  ${m.day} ${m.squadra1}-${m.squadra2} ${m.result}: ${c?.market ?? `da lasciare (${c?.daLasciare ?? "-"})`}`);
    } catch (e: any) { errori++; console.log(`  errore ${m.squadra1}-${m.squadra2}: ${String(e?.message || e).slice(0, 120)}`); }
    if (fatte % 100 === 0) console.log(`  ... ${fatte}/${lista.length}`);
  };
  for (let i = 0; i < lista.length; i += 4) await Promise.all(lista.slice(i, i + 4).map(lavora));
  console.log(`Fatto: ${fatte} rifatte (${lasciate} da lasciare), ${errori} errori.`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
