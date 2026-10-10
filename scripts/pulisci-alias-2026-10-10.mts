/**
 * Pulizia di team_alias (10/10/2026): copia completa in docs/, poi via le 10
 * coppie sbagliate o incerte trovate dal controllo una per una (es. Atletico
 * Madrid -> Atlético Madrileño: la prima squadra abbinata alle riserve).
 * Senza --scrivi stampa soltanto.
 */
import { writeFileSync } from "node:fs";
import { pgGetAll, pgDelete } from "../netlify/functions/lib/supabaseRest.ts";

const DA_TOGLIERE = [
  "Atletico Madrid",        // -> Atlético Madrileño (riserve)
  "Kerho 07",               // -> SJK Akatemia (altra squadra)
  "Sundsvall",              // -> Sandvikens IF
  "Atletico Astorga Fc",    // -> CD Arenteiro
  "Lokomotiva Zvolen",      // -> MFK Zvolen
  "Malut United",           // -> Java United F.C.
  "Muangkhon United Fc",    // -> Muang Thong United
  "Farmel Fc",              // -> Isenmulang Kalteng
  "Kfc Oosterzonen",        // -> K. Lierse SK
  "Suzhou Jinfu",           // -> Suzhou Dongwu
];

const tutte = await pgGetAll("team_alias?select=*", "da.asc");
writeFileSync(new URL("../docs/team_alias_backup_2026-10-10.json", import.meta.url), JSON.stringify(tutte, null, 1));
console.log(`copia salvata: ${tutte.length} coppie in docs/team_alias_backup_2026-10-10.json`);
const presenti = tutte.filter((r: any) => DA_TOGLIERE.includes(r.da));
for (const r of presenti) console.log(`  da togliere: ${r.da} -> ${r.a} (${r.conferme} conferme)`);
if (process.argv.includes("--scrivi")) {
  for (const r of presenti) await pgDelete(`team_alias?da=eq.${encodeURIComponent(r.da)}`);
  const dopo = await pgGetAll("team_alias?select=da", "da.asc");
  console.log(`tolte ${presenti.length}; coppie attive ora: ${dopo.length}`);
}
