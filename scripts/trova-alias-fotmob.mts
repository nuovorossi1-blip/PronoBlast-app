/**
 * TROVA ALIAS FOTMOB (scripts/trova-alias-fotmob.mts)
 *
 * Analizza le partite di PronoBlast e FotMob degli ultimi 60 giorni + i prossimi 3.
 * 1. Mappa manifestazione -> legaId FotMob per le partite abbinate con certezza
 *    (entrambe le squadre con simil >= 0.9 e orario +-30 min, legaId prevalente).
 * 2. Cerca nelle partite non abbinate della stessa lega e orario la partita FotMob
 *    in cui una squadra coincide (simil >= 0.9): l'altra diventa coppia candidata.
 * 3. Conta le conferme, scarta le contraddittorie.
 * 4. Elenca sicure (conferme >= 2 oppure 1 conferma con orario esatto e unica in fascia) e dubbie.
 * 5. Se invocato con --scrivi, inserisce le sicure in team_alias su Supabase (upsert).
 *
 * Uso:
 *   tsx --env-file=server-locale/.env scripts/trova-alias-fotmob.mts
 *   tsx --env-file=server-locale/.env scripts/trova-alias-fotmob.mts --scrivi
 */

import { pgGetAll, pgPost } from "../netlify/functions/lib/supabaseRest";
import { fotmob, type PartitaFonte } from "../netlify/functions/lib/resultSources";
import { simil, norm, squadreIncompatibili } from "../netlify/functions/lib/teamMatch";
import { inizioPartitaMs } from "../frontend/src/api";
import { impostaMappaLeghe } from "../netlify/functions/lib/fotmobLeghe";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, "..");

const scrivi = process.argv.includes("--scrivi");

function oggiRoma(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function generaGiorni(oggiStr: string, indietro = 60, avanti = 3): string[] {
  const base = new Date(`${oggiStr}T12:00:00Z`);
  const giorni: string[] = [];
  for (let i = -indietro; i <= avanti; i++) {
    giorni.push(new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return giorni;
}

async function main() {
  const oggi = oggiRoma();
  const giorni = generaGiorni(oggi, 60, 3);
  const dal = giorni[0];
  const al = giorni[giorni.length - 1];

  console.log(`=== RICERCA ALIAS FOTMOB ===`);
  console.log(`Periodo: dal ${dal} al ${al} (totale ${giorni.length} giorni, oggi: ${oggi})`);
  console.log(`Modalita': ${scrivi ? "SCRITTURA (--scrivi attivo: salvera' le sicure in team_alias)" : "SOLA LETTURA (dry-run)"}`);

  // 1. Caricamento partite PronoBlast dal DB
  console.log(`\n1. Caricamento partite da Supabase...`);
  const tutte: any[] = await pgGetAll(
    `matches?day=gte.${dal}&day=lte.${al}&select=id,day,time,manifestazione,squadra1,squadra2`,
    "day.asc,time.asc"
  );
  console.log(`Trovate ${tutte.length} partite nel database.`);

  const partitePerGiorno = new Map<string, any[]>();
  for (const p of tutte) {
    if (!partitePerGiorno.has(p.day)) partitePerGiorno.set(p.day, []);
    partitePerGiorno.get(p.day)!.push(p);
  }

  // 2. Scaricamento elenchi FotMob per ogni giorno (con cache su disco per velocita')
  const CACHE_DIR = path.join(RADICE, "server-locale", "tmp-test");
  const CACHE_FILE = path.join(CACHE_DIR, "fotmob-cache.json");
  let cacheDisco: Record<string, PartitaFonte[]> = {};
  if (fs.existsSync(CACHE_FILE)) {
    try { cacheDisco = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { cacheDisco = {}; }
  }

  console.log(`\n2. Scaricamento elenchi FotMob (${giorni.length} giorni, cache: ${Object.keys(cacheDisco).length} giorni presenti)...`);
  const fotmobPerGiorno = new Map<string, PartitaFonte[]>();

  let chiamateFatte = 0;
  for (let i = 0; i < giorni.length; i++) {
    const g = giorni[i];
    if (cacheDisco[g]) {
      fotmobPerGiorno.set(g, cacheDisco[g]);
      continue;
    }
    try {
      const list = await fotmob(g);
      fotmobPerGiorno.set(g, list);
      cacheDisco[g] = list;
      chiamateFatte++;
      process.stdout.write(`  [${String(i + 1).padStart(2)}/${giorni.length}] ${g}: ${list.length} gare FotMob\n`);
    } catch (e: any) {
      console.warn(`  [${String(i + 1).padStart(2)}/${giorni.length}] ${g}: ERRORE FotMob (${e?.message || e})`);
      fotmobPerGiorno.set(g, []);
    }
    if (i < giorni.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (chiamateFatte > 0 || !fs.existsSync(CACHE_FILE)) {
    try {
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheDisco), "utf8");
    } catch {}
  }

  // 3. Mappatura manifestazione -> legaId FotMob da partite abbinate con certezza
  console.log(`\n3. Costruzione corrispondenza manifestazione -> legaId FotMob...`);
  const votiLeghe: Record<string, Record<number, { voti: number; nomeLega: string }>> = {};
  const abbinateConCertezza = new Set<string>();
  let partiteCerte = 0;

  for (const g of giorni) {
    const pList = partitePerGiorno.get(g) || [];
    const fmList = fotmobPerGiorno.get(g) || [];

    for (const p of pList) {
      const oraDb = inizioPartitaMs(p.day, p.time);
      if (!oraDb) continue;

      for (const m of fmList) {
        if (!m.id || !m.ora || !m.legaId) continue;
        const diffMin = Math.abs(m.ora - oraDb) / 60000;
        if (diffMin > 30) continue;

        const sh = simil(p.squadra1, m.casa);
        const sa = simil(p.squadra2, m.ospite);

        if (sh >= 0.9 && sa >= 0.9) {
          abbinateConCertezza.add(p.id);
          partiteCerte++;
          const man = String(p.manifestazione || "").trim().toUpperCase();
          if (man) {
            const entry = (votiLeghe[man] ||= {});
            const v = (entry[m.legaId] ||= { voti: 0, nomeLega: m.lega || "" });
            v.voti++;
            if (!v.nomeLega && m.lega) v.nomeLega = m.lega;
          }
          break;
        }
      }
    }
  }

  console.log(`Partite abbinate con certezza (entrambe simil >= 0.9, orario +-30m): ${partiteCerte}`);

  // Seleziona il legaId prevalente per ciascuna manifestazione
  const mappaLeghe: Record<string, number> = {};
  const nomiLeghe: Record<string, string> = {};

  for (const [man, voti] of Object.entries(votiLeghe)) {
    const entries = Object.entries(voti).map(([k, v]) => ({
      legaId: Number(k),
      voti: v.voti,
      nomeLega: v.nomeLega,
    }));
    entries.sort((a, b) => b.voti - a.voti);
    const tot = entries.reduce((acc, x) => acc + x.voti, 0);
    const top = entries[0];
    // Coerente: top ha almeno il 60% dei voti totali (legaId prevalente)
    if (top.voti / tot >= 0.6) {
      mappaLeghe[man] = top.legaId;
      nomiLeghe[man] = top.nomeLega;
    }
  }

  console.log(`Manifestazioni coerentemente mappate: ${Object.keys(mappaLeghe).length}`);
  for (const [man, lid] of Object.entries(mappaLeghe).sort()) {
    console.log(`  ${man.padEnd(10)} -> legaId ${String(lid).padStart(5)} (${nomiLeghe[man]})`);
  }

  impostaMappaLeghe(mappaLeghe);

  function haMarkerIncompatibile(prono: string, fotmobNome: string): boolean {
    const wordsF = fotmobNome.toLowerCase().split(/[^a-z0-9àèéìòùáéíóúñ]+/i).filter(Boolean);
    const wordsP = new Set(prono.toLowerCase().split(/[^a-z0-9àèéìòùáéíóúñ]+/i).filter(Boolean));
    for (const w of wordsF) {
      if (/^(madrileno|madrileño|b|ii|u19|u21|u23|women|akatemia|reserves?)$/i.test(w)) {
        if (!wordsP.has(w)) return true;
      }
    }
    return false;
  }

  // 4. Ricerca candidati alias sulle partite NON abbinate
  console.log(`\n4. Ricerca coppie candidate (una squadra simil >= 0.9 nello stesso campionato/orario)...`);
  type Candidato = {
    da: string;
    a: string;
    partitaId: string;
    partitaStr: string;
    giorno: string;
    manifestazione: string;
    time: string;
    fotmobId: string;
    legaId: number;
    oraDiffMin: number;
    unicaInFascia: boolean;
  };

  const candidati: Candidato[] = [];

  for (const g of giorni) {
    const pList = partitePerGiorno.get(g) || [];
    const fmList = fotmobPerGiorno.get(g) || [];

    for (const p of pList) {
      if (abbinateConCertezza.has(p.id)) continue;

      const man = String(p.manifestazione || "").trim().toUpperCase();
      const legaId = mappaLeghe[man];
      if (!legaId) continue;

      const oraDb = inizioPartitaMs(p.day, p.time);
      if (!oraDb) continue;

      const fmStessaLega = fmList.filter((m) => m.legaId === legaId && m.ora);
      const fmFascia = fmStessaLega.filter((m) => Math.abs(m.ora! - oraDb) <= 30 * 60_000);

      for (const m of fmFascia) {
        const sh = simil(p.squadra1, m.casa);
        const sa = simil(p.squadra2, m.ospite);
        const diffMin = Math.abs(m.ora! - oraDb) / 60000;
        const unicaInFascia = fmFascia.length === 1;

        // Casa coincide (>= 0.9) -> ospite candidata
        if (sh >= 0.9 && sa < 0.9) {
          if (!squadreIncompatibili(p.squadra2, m.ospite) && !haMarkerIncompatibile(p.squadra2, m.ospite)) {
            candidati.push({
              da: p.squadra2,
              a: m.ospite,
              partitaId: p.id,
              partitaStr: `${p.squadra1} vs ${p.squadra2} (FotMob: ${m.casa} vs ${m.ospite})`,
              giorno: p.day,
              manifestazione: man,
              time: p.time,
              fotmobId: m.id!,
              legaId,
              oraDiffMin: diffMin,
              unicaInFascia,
            });
          }
        }

        // Ospite coincide (>= 0.9) -> casa candidata
        if (sa >= 0.9 && sh < 0.9) {
          if (!squadreIncompatibili(p.squadra1, m.casa) && !haMarkerIncompatibile(p.squadra1, m.casa)) {
            candidati.push({
              da: p.squadra1,
              a: m.casa,
              partitaId: p.id,
              partitaStr: `${p.squadra1} vs ${p.squadra2} (FotMob: ${m.casa} vs ${m.ospite})`,
              giorno: p.day,
              manifestazione: man,
              time: p.time,
              fotmobId: m.id!,
              legaId,
              oraDiffMin: diffMin,
              unicaInFascia,
            });
          }
        }
      }
    }
  }

  console.log(`Candidature totali individuate: ${candidati.length}`);

  // 5. Raggruppamento per coppia (da -> a)
  const perCoppia = new Map<string, { da: string; a: string; partite: Set<string>; dettagli: Candidato[] }>();

  for (const c of candidati) {
    if (norm(c.da) === norm(c.a)) continue;

    const k = `${c.da}|||${c.a}`;
    let item = perCoppia.get(k);
    if (!item) {
      item = { da: c.da, a: c.a, partite: new Set(), dettagli: [] };
      perCoppia.set(k, item);
    }
    item.partite.add(c.partitaId);
    item.dettagli.push(c);
  }

  // Controllo contraddittori: stesso PronoBlast a due FotMob diversi, o viceversa
  const mappaDa = new Map<string, Set<string>>();
  const mappaA = new Map<string, Set<string>>();

  for (const item of perCoppia.values()) {
    if (!mappaDa.has(item.da)) mappaDa.set(item.da, new Set());
    mappaDa.get(item.da)!.add(item.a);

    if (!mappaA.has(item.a)) mappaA.set(item.a, new Set());
    mappaA.get(item.a)!.add(item.da);
  }

  const daContraddittori = new Set<string>();
  for (const [da, targets] of mappaDa.entries()) {
    if (targets.size > 1) daContraddittori.add(da);
  }

  const aContraddittori = new Set<string>();
  for (const [a, sources] of mappaA.entries()) {
    if (sources.size > 1) aContraddittori.add(a);
  }

  type CoppiaRisultato = {
    da: string;
    a: string;
    conferme: number;
    motivo: string;
    dettagli: Candidato[];
  };

  const sicure: CoppiaRisultato[] = [];
  const dubbie: CoppiaRisultato[] = [];
  const scartate: { da: string; a: string; motivo: string }[] = [];

  for (const item of perCoppia.values()) {
    if (daContraddittori.has(item.da)) {
      scartate.push({
        da: item.da,
        a: item.a,
        motivo: `PronoBlast '${item.da}' punta a ${mappaDa.get(item.da)!.size} nomi FotMob: ${[...mappaDa.get(item.da)!].join(", ")}`,
      });
      continue;
    }
    if (aContraddittori.has(item.a)) {
      scartate.push({
        da: item.da,
        a: item.a,
        motivo: `FotMob '${item.a}' riceve da ${mappaA.get(item.a)!.size} nomi PronoBlast: ${[...mappaA.get(item.a)!].join(", ")}`,
      });
      continue;
    }

    const conferme = item.partite.size;
    const haUnicaEsatta = item.dettagli.some((d) => d.oraDiffMin === 0 && d.unicaInFascia);

    if (conferme >= 2) {
      sicure.push({ da: item.da, a: item.a, conferme, motivo: `${conferme} conferme da partite distinte`, dettagli: item.dettagli });
    } else if (conferme === 1 && haUnicaEsatta) {
      sicure.push({ da: item.da, a: item.a, conferme: 1, motivo: `1 conferma con lega e orario esatti, unica in fascia`, dettagli: item.dettagli });
    } else {
      dubbie.push({ da: item.da, a: item.a, conferme, motivo: `1 conferma senza orario esatto o non unica in fascia`, dettagli: item.dettagli });
    }
  }

  sicure.sort((a, b) => b.conferme - a.conferme || a.da.localeCompare(b.da));
  dubbie.sort((a, b) => b.conferme - a.conferme || a.da.localeCompare(b.da));

  console.log(`\n=== RISULTATO ANALISI ===`);
  console.log(`Coppie SICURE identificate: ${sicure.length}`);
  for (const s of sicure) {
    console.log(`  [SICURA] "${s.da}" -> "${s.a}" (${s.motivo})`);
    for (const d of s.dettagli) {
      console.log(`      • ${d.giorno} ${d.time} [${d.manifestazione}] ${d.partitaStr}`);
    }
  }

  console.log(`\nCoppie DUBBIE identificate: ${dubbie.length}`);
  for (const d of dubbie) {
    console.log(`  [DUBBIA] "${d.da}" -> "${d.a}" (${d.motivo})`);
    for (const det of d.dettagli) {
      console.log(`      • ${det.giorno} ${det.time} [${det.manifestazione}] ${det.partitaStr}`);
    }
  }

  if (scartate.length) {
    console.log(`\nCoppie SCARTATE per contraddizione: ${scartate.length}`);
    for (const sc of scartate) {
      console.log(`  [SCARTATA] "${sc.da}" -> "${sc.a}": ${sc.motivo}`);
    }
  }

  // 6. Salvataggio / aggiornamento in team_alias DISABILITATO
  if (scrivi) {
    console.log(`\n5. ATTENZIONE: scrittura su team_alias DISABILITATA da istruzioni dell'utente (10/10/2026).`);
    console.log(`   Nessun dato scritto nel database.`);
  } else {
    console.log(`\nNota: esecuzione in sola lettura (dry-run).`);
  }

  // 7. Aggiorna file delle leghe con le corrispondenze trovate
  try {
    const fileLeghe = path.join(RADICE, "netlify", "functions", "lib", "fotmobLeghe.ts");
    const codici = Object.entries(mappaLeghe)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${v}, // ${nomiLeghe[k] || ""}`)
      .join("\n");
    const tsContenuto = `/**
 * Corrispondenza fra le manifestazioni PronoBlast (codici Sisal come "POR1", "ITA1", ...)
 * e i legaId numerici di FotMob (es. 61 = Liga Portugal, etc.).
 *
 * Generato automaticamente da scripts/trova-alias-fotmob.mts.
 */

let MAPPA_LEGHE: Record<string, number> = {
${codici}
};

export function impostaMappaLeghe(mappa: Record<string, number>) {
  MAPPA_LEGHE = { ...MAPPA_LEGHE, ...mappa };
}

export function dammiMappaLeghe(): Record<string, number> {
  return { ...MAPPA_LEGHE };
}

export function legaIdPerManifestazione(manifestazione: string): number | null {
  if (!manifestazione) return null;
  const k = manifestazione.trim().toUpperCase();
  return MAPPA_LEGHE[k] ?? null;
}

export function legaCopertaDaFotmob(manifestazione: string): boolean {
  return legaIdPerManifestazione(manifestazione) !== null;
}
`;
    fs.writeFileSync(fileLeghe, tsContenuto, "utf8");
    console.log(`Aggiornato netlify/functions/lib/fotmobLeghe.ts con ${Object.keys(mappaLeghe).length} leghe.`);
  } catch (e) {
    console.warn("Impossibile aggiornare fotmobLeghe.ts:", e);
  }

  console.log(`\n=== FINE ESECUZIONE ===`);
}

main().catch((e) => {
  console.error("Errore fatale nello script:", e);
  process.exit(1);
});
