import { pgGet, pgGetAll } from "../netlify/functions/lib/supabaseRest";
import { consigliatoDi } from "../netlify/functions/lib/letturaPartita";
import { isVerdictMarket } from "../frontend/src/api";

const TARGET_IDS = [
  "e2c0fc06-2b93-4795-aca1-7cf4bbad6e29",
  "88b9e5e9-7510-4361-8d55-e3827f76a49a",
  "22c9bc3c-7dad-4ffe-9885-9eea34a1378e",
  "f9ef93f5-b99c-4c5e-a5b3-8b8a3551127c",
  "73f1da34-8ebf-41a8-9f1d-040ef5486cbf",
];

async function main() {
  console.log("=== RICALCOLO CONSIGLIATI CON ai='cambiato' O proposta_scartata NON NULLA ===");

  // Trova tutti i match_id rilevanti
  const idSet = new Set<string>(TARGET_IDS);
  const rows = await pgGetAll("dossier_web?select=match_id,numeri").catch(() => []);
  for (const r of rows) {
    const c = r.numeri?.consigliato;
    if (c && (c.ai === "cambiato" || c.proposta_scartata != null)) {
      idSet.add(r.match_id);
    }
  }

  const ids = Array.from(idSet);
  console.log(`Trovate ${ids.length} partite da ricalcolare.\n`);

  for (const id of ids) {
    const mRows = await pgGet(`matches?id=eq.${encodeURIComponent(id)}&select=id,squadra1,squadra2,day`).catch(() => []);
    const match = mRows[0] || { squadra1: "Casa", squadra2: "Ospite", day: "" };

    const prev = await pgGet(`dossier_web?match_id=eq.${encodeURIComponent(id)}&select=match_id,numeri`);
    const num = prev[0]?.numeri;
    const consPrima = num?.consigliato;
    const pro = num?.lettura_pro;

    console.log(`------------------------------------------------------------`);
    console.log(`Match: ${match.squadra1} vs ${match.squadra2} (${match.day}) [ID: ${id}]`);
    console.log(`Proposta AI: "${pro?.mercato || 'Nessuna'}" (notizia: "${pro?.notizia || ''}")`);
    console.log(`PRIMA:`);
    console.log(`  - ai: ${consPrima?.ai}`);
    console.log(`  - market: ${consPrima?.market} (nome: ${consPrima?.nome})`);
    console.log(`  - quota: ${consPrima?.quota} (stimata: ${consPrima?.stimata})`);
    console.log(`  - daLasciare: ${consPrima?.daLasciare}`);
    console.log(`  - tradotto_da: ${consPrima?.tradotto_da || null}`);
    console.log(`  - proposta_scartata:`, consPrima?.proposta_scartata || null);
    console.log(`  - alternative:`, (consPrima?.alternative || []).map((a: any) => `${a.market} (@${a.quota}${a.stimata ? ' stim' : ''})`).join(", ") || "nessuna");

    // Ricalcola con codice nuovo e salva su Supabase
    const dopo = await consigliatoDi(id, undefined, true);

    console.log(`DOPO:`);
    console.log(`  - ai: ${dopo?.ai}`);
    console.log(`  - market: ${dopo?.market} (nome: ${dopo?.nome})`);
    console.log(`  - quota: ${dopo?.quota} (stimata: ${dopo?.stimata})`);
    console.log(`  - daLasciare: ${dopo?.daLasciare}`);
    console.log(`  - tradotto_da: ${dopo?.tradotto_da || null}`);
    console.log(`  - proposta_scartata:`, dopo?.proposta_scartata || null);
    console.log(`  - alternative:`, (dopo?.alternative || []).map((a: any) => `${a.market} (@${a.quota}${a.stimata ? ' stim' : ''})`).join(", ") || "nessuna");

    // Controllo whitelist su tutte le alternative
    const altFuori = (dopo?.alternative || []).filter((a: any) => !isVerdictMarket(a.market));
    if (altFuori.length > 0) {
      console.error(`  [ERRORE] Alternative fuori whitelist trovate:`, altFuori);
    } else {
      console.log(`  ✓ Tutte le alternative rispettano la whitelist.`);
    }
  }
  console.log(`\n=== RICALCOLO E VERIFICA DB COMPLETATI CON SUCCESSO ===`);
}

main().catch((e) => {
  console.error("Errore ricalcolo:", e);
  process.exit(1);
});
