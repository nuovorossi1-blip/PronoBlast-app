/**
 * Ricalcolo dei mercati consigliati per le partite future non ancora giocate.
 * Default: SOLA STAMPA (nessuna scrittura su DB).
 * Con flag --scrivi: salva il nuovo consigliato su dossier_web.
 */
import { pgGetAll } from "../netlify/functions/lib/supabaseRest";
import { consigliatoDi } from "../netlify/functions/lib/letturaPartita";
import { tabellaScenari } from "../netlify/functions/lib/tabellaScenari";
import { isMercatoVietato } from "../frontend/src/api";

const scrivi = process.argv.includes("--scrivi");

function ottieniDataOggi(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
}

function etichettaMercato(c: any): string {
  if (!c) return "Nessuno";
  if (c.market) return c.market;
  if (c.daLasciare) return "Da lasciare";
  return "Nessuno";
}

async function main() {
  const oggi = ottieniDataOggi();
  console.log("============================================================");
  console.log("=== RICALCOLO CONSIGLIATI PARTITE FUTURE ===");
  console.log("============================================================");
  console.log(`Data filtro (oggi): ${oggi}`);
  console.log(`Modalità: ${scrivi ? "SCRITTURA SU DB ABILITATA (--scrivi)" : "SOLA STAMPA (default, nessuna scrittura sul DB)"}`);

  console.log("Inizializzazione tabella scenari in memoria...");
  await tabellaScenari().catch((e) => console.warn("Avviso tabella scenari:", e));

  const matches: any[] = await pgGetAll(
    `matches?result=is.null&day=gte.${oggi}&select=id,day,time,squadra1,squadra2,odd_1,odd_x,odd_2,odd_o25,odd_u25,odd_gg,odd_ng`,
    "day.asc,time.asc"
  ).catch((e) => {
    console.error("Errore caricamento matches:", e);
    return [];
  });

  console.log(`Partite future (result nullo, day >= ${oggi}): ${matches.length}`);
  if (matches.length === 0) {
    console.log("Nessuna partita da ricalcolare.");
    return;
  }

  // Carica dossier_web per estrarre il consigliato attuale (prima)
  const dossiers = await pgGetAll("dossier_web?select=match_id,numeri", "match_id.asc").catch((e) => {
    console.warn("Attenzione nel caricamento dossier_web:", e);
    return [];
  });
  const dossierMap = new Map<string, any>();
  for (const d of dossiers) {
    dossierMap.set(d.match_id, d.numeri);
  }

  const conteggiPrima: Record<string, number> = {};
  const conteggiDopo: Record<string, number> = {};
  let invariate = 0;
  let cambiate = 0;
  let errori = 0;
  const vietatiTrovati: { id: string; market: string }[] = [];

  const t0 = Date.now();
  const CONCURRENCY = 5;
  let cursor = 0;
  let completate = 0;

  async function worker() {
    while (cursor < matches.length) {
      const idx = cursor++;
      const m = matches[idx];
      const numeri = dossierMap.get(m.id);
      const cPrima = numeri?.consigliato;
      const keyPrima = etichettaMercato(cPrima);

      try {
        const cDopo = await consigliatoDi(m.id, undefined, scrivi);
        const keyDopo = etichettaMercato(cDopo);

        conteggiPrima[keyPrima] = (conteggiPrima[keyPrima] || 0) + 1;
        conteggiDopo[keyDopo] = (conteggiDopo[keyDopo] || 0) + 1;

        if (keyPrima === keyDopo) {
          invariate++;
        } else {
          cambiate++;
        }

        if (cDopo?.market && isMercatoVietato(cDopo.market)) {
          vietatiTrovati.push({ id: m.id, market: cDopo.market });
        }
      } catch (err: any) {
        errori++;
        if (errori <= 5) {
          console.error(`\nErrore match ${m.id} (${m.squadra1} vs ${m.squadra2}):`, err?.message || err);
        }
        conteggiPrima[keyPrima] = (conteggiPrima[keyPrima] || 0) + 1;
        conteggiDopo["(errore)"] = (conteggiDopo["(errore)"] || 0) + 1;
      }

      completate++;
      if (completate % 50 === 0 || completate === matches.length) {
        process.stdout.write(`\rAvanzamento: ${completate}/${matches.length} partite (${Math.round((completate / matches.length) * 100)}%)...`);
      }
    }
  }

  console.log(`Avvio ricalcolo con concorrenza ${CONCURRENCY}...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log("\n");

  const durataSec = ((Date.now() - t0) / 1000).toFixed(1);

  // Tabella comparativa prima / dopo
  const tuttiMercati = Array.from(new Set([...Object.keys(conteggiPrima), ...Object.keys(conteggiDopo)]));
  tuttiMercati.sort((a, b) => {
    const totA = (conteggiDopo[a] || 0) + (conteggiPrima[a] || 0);
    const totB = (conteggiDopo[b] || 0) + (conteggiPrima[b] || 0);
    return totB - totA;
  });

  console.log("----------------------------------------------------------------------");
  console.log(
    "MERCATO".padEnd(32) +
    "PRIMA".padStart(10) +
    "DOPO".padStart(10) +
    "DELTA".padStart(10)
  );
  console.log("----------------------------------------------------------------------");

  for (const m of tuttiMercati) {
    const p = conteggiPrima[m] || 0;
    const d = conteggiDopo[m] || 0;
    const diff = d - p;
    const deltaStr = (diff > 0 ? `+${diff}` : `${diff}`).padStart(10);
    console.log(m.padEnd(32) + String(p).padStart(10) + String(d).padStart(10) + deltaStr);
  }

  console.log("----------------------------------------------------------------------");
  console.log(`Totale partite esaminate: ${matches.length}`);
  console.log(`Partite invariate:        ${invariate}`);
  console.log(`Partite cambiate:         ${cambiate}`);
  console.log(`Errori:                   ${errori}`);
  console.log(`Tempo totale:             ${durataSec} s`);
  console.log("----------------------------------------------------------------------");

  if (vietatiTrovati.length > 0) {
    console.error(`[ERRORE CRITICO] Rilevati ${vietatiTrovati.length} mercati vietati nel risultato DOPO:`);
    for (const v of vietatiTrovati.slice(0, 10)) {
      console.error(`  - Match ${v.id}: ${v.market}`);
    }
  } else {
    console.log("✓ Nessun mercato vietato presente nei consigliati post-ricalcolo.");
  }

  if (!scrivi) {
    console.log("\n[NOTA] Esecuzione in SOLA STAMPA completata. Nessuna modifica salvata su Supabase.");
    console.log("Per salvare i consigliati ricalcolati, rilanciare con: --scrivi");
  } else {
    console.log("\n[NOTA] Esecuzione con --scrivi completata. Modifiche salvate su Supabase.");
  }
}

main().catch((err) => {
  console.error("Errore irreversibile nello script:", err);
  process.exit(1);
});
