import { pgGet, jsonResponse } from "./lib/supabaseRest";
import { parseResult } from "./lib/marketEval";
import { applyMatchResult } from "./lib/applyResult";

/**
 * POST /results-import
 * Body: { items: [{ id, result }, ...], overwrite?: boolean }
 *
 * Caricamento massivo dei risultati dal foglio Excel compilato da Rossi
 * (sezione MANUTENZIONE). Diverso da `/results-bulk`, che serve alla Schedina e
 * non va toccato: qui il caso d'uso e' migliaia di righe caricate a pezzi, con
 * un resoconto dettagliato di cosa e' entrato e cosa no.
 *
 * DOPPIO CARICAMENTO: innocuo. `applyMatchResult` riconosce un risultato
 * identico a quello gia' salvato e non conta niente una seconda volta; se
 * invece il risultato e' DIVERSO, annulla prima i conteggi vecchi. Quindi
 * ricaricare lo stesso file due volte non sporca l'apprendimento.
 *
 * `overwrite` (falso di default) decide cosa fare quando la partita ha gia' un
 * risultato diverso: senza, la riga viene saltata e segnalata, cosi' un errore
 * di compilazione non riscrive dati buoni senza che Rossi se ne accorga.
 *
 * L'app manda blocchi da qualche centinaio di righe: applicare un risultato
 * significa aggiornare pagella, punteggi per scenario e contatori di famiglia,
 * quindi mille righe in una sola richiesta sforerebbero il limite di tempo.
 */

const MAX_ITEMS = 500;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return jsonResponse({ error: "Usa POST" }, 405);

  let body: { items?: { id?: string; result?: string }[]; overwrite?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body JSON non valido" }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const overwrite = body.overwrite === true;
  if (!items.length) return jsonResponse({ error: "Nessuna riga da caricare" }, 400);
  if (items.length > MAX_ITEMS) {
    return jsonResponse({ error: `Troppe righe in una volta (${items.length}): il massimo e' ${MAX_ITEMS}. L'app deve spezzare il file in blocchi.` }, 400);
  }

  // Stato attuale delle partite citate: serve a distinguere "gia' a posto" da
  // "sovrascritta" senza interrogare il database una volta per riga.
  const ids = items.map((i) => String(i.id || "")).filter(Boolean);
  const esistenti = new Map<string, string | null>();
  if (ids.length) {
    const lista = ids.map((i) => `"${i}"`).join(",");
    const rows = await pgGet(`matches?id=in.(${lista})&select=id,result`);
    for (const r of rows) esistenti.set(r.id, r.result || null);
  }

  let applicate = 0;
  let gia_presenti = 0;
  let sovrascritte = 0;
  let saltate_diverse = 0;
  let illeggibili = 0;
  let non_trovate = 0;
  const esempi_illeggibili: string[] = [];
  const esempi_diverse: { id: string; nel_database: string; nel_file: string }[] = [];

  for (const item of items) {
    const id = String(item.id || "").trim();
    const grezzo = String(item.result || "").trim();
    if (!id || !grezzo) continue;                 // riga non compilata: si ignora

    if (!esistenti.has(id)) { non_trovate++; continue; }

    const parsed = parseResult(grezzo);
    if (!parsed) {
      illeggibili++;
      if (esempi_illeggibili.length < 10) esempi_illeggibili.push(`${id}: "${grezzo}"`);
      continue;
    }
    const [casa, ospite] = parsed;
    const normalizzato = `${casa}-${ospite}`;
    const precedente = esistenti.get(id) || null;

    if (precedente) {
      const p = parseResult(precedente);
      const precNorm = p ? `${p[0]}-${p[1]}` : precedente;
      if (precNorm === normalizzato) { gia_presenti++; continue; }
      if (!overwrite) {
        saltate_diverse++;
        if (esempi_diverse.length < 10) esempi_diverse.push({ id, nel_database: precNorm, nel_file: normalizzato });
        continue;
      }
    }

    try {
      await applyMatchResult(id, normalizzato, casa, ospite);
      if (precedente) sovrascritte++; else applicate++;
    } catch {
      non_trovate++;
    }
  }

  return jsonResponse({
    ricevute: items.length,
    applicate,
    sovrascritte,
    gia_presenti,
    saltate_perche_diverse: saltate_diverse,
    illeggibili,
    non_trovate,
    esempi_illeggibili,
    esempi_diverse,
  });
};
