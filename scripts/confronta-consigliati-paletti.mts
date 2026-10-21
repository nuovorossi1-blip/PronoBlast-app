/**
 * Passo 4 dei paletti (21/10/2026): Consigliati delle partite NON ancora iniziate, prima (salvato) e dopo
 * (regola nuova). Default SOLA STAMPA; con --scrivi salva il nuovo consigliato. Le partite iniziate non si toccano.
 * Uso (da server-locale): node --env-file=.env --import tsx ../scripts/confronta-consigliati-paletti.mts [--scrivi]
 */
import { pgGetAll } from "../netlify/functions/lib/supabaseRest";
import { consigliatoDi } from "../netlify/functions/lib/letturaPartita";
import { tabellaScenari } from "../netlify/functions/lib/tabellaScenari";
import { inizioPartitaMs } from "../frontend/src/api";

const scrivi = process.argv.includes("--scrivi");
await tabellaScenari().catch(() => {});
const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const partite = (await pgGetAll(`matches?result=is.null&day=gte.${oggi}&select=id,day,time,manifestazione,squadra1,squadra2`, "day.asc,time.asc"))
  .filter((m: any) => { const t = inizioPartitaMs(m.day, m.time); return t === null || t > Date.now() + 5 * 60_000; });
const dossier = new Map((await pgGetAll("dossier_web?select=match_id,numeri", "match_id.asc")).map((d: any) => [d.match_id, d.numeri]));
const lab = (c: any) => (c?.market ? `${c.market} @${c.quota ?? "?"}` : c ? "Da lasciare" : "—");
const righe: string[] = []; let uguali = 0, cambiate = 0, nuove = 0, errori = 0;
let i = 0;
async function lavora() {
  while (i < partite.length) {
    const m = partite[i++];
    const prima = dossier.get(m.id)?.consigliato;
    if (!prima) continue;   // senza dossier: si calcolera' all'apertura della scheda
    try {
      const dopo = await consigliatoDi(m.id, undefined, scrivi);
      if (lab(prima) === lab(dopo)) uguali++;
      else { cambiate++; righe.push(`${m.day} ${m.time} ${m.manifestazione.padEnd(8)} ${`${m.squadra1} - ${m.squadra2}`.slice(0, 44).padEnd(44)} ${lab(prima).padEnd(32)} -> ${lab(dopo)}`); }
    } catch (e: any) { errori++; }
  }
}
await Promise.all(Array.from({ length: 4 }, lavora));
console.log(righe.sort().join("\n"));
console.log(`\nPartite non iniziate con consigliato: ${uguali + cambiate + errori} · invariate ${uguali} · cambiate ${cambiate} · errori ${errori} · ${scrivi ? "SALVATE" : "solo stampa"}`);
