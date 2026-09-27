/**
 * Piccolo helper per parlare con Supabase via REST diretto (PostgREST),
 * senza dipendenze npm — solo fetch nativo. Usato da tutte le funzioni.
 */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

export function supabaseConfig() {
  return {
    url: env("VITE_SUPABASE_URL"),
    key: env("VITE_SUPABASE_ANON_KEY"),
  };
}

function headers(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Tetto di righe che PostgREST restituisce per richiesta, qualunque `limit`
 *  si chieda. Non e' un errore e non c'e' nessun avviso: la risposta arriva
 *  semplicemente troncata. */
const PG_MAX_ROWS = 1000;

export async function pgGet(path: string): Promise<any> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: headers(key) });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Come pgGet, ma recupera DAVVERO tutte le righe.
 *
 * 27/09/2026 — Trovato analizzando l'export di Rossi: `matches?select=*&limit=100000`
 * restituiva esattamente 1000 righe. PostgREST ha un tetto per richiesta
 * (`db-max-rows`) e tronca in silenzio: nessun errore, nessuna avvertenza, solo
 * dati mancanti. L'export del database era quindi incompleto da sempre, e
 * qualunque conto fatto su quel file era sbagliato senza che si vedesse.
 *
 * Qui si pagina con offset finche' una pagina torna piu' corta del tetto.
 * `path` NON deve contenere `limit` o `offset`: li mette questa funzione.
 * `ordine` serve a rendere la paginazione stabile — senza un ordinamento,
 * PostgREST non garantisce che pagine diverse non si sovrappongano.
 */
export async function pgGetAll(path: string, ordine = "id.asc", max = 100000): Promise<any[]> {
  const sep = path.includes("?") ? "&" : "?";
  const out: any[] = [];
  for (let offset = 0; offset < max; offset += PG_MAX_ROWS) {
    const pagina = await pgGet(`${path}${sep}order=${ordine}&limit=${PG_MAX_ROWS}&offset=${offset}`);
    if (!Array.isArray(pagina)) break;
    out.push(...pagina);
    if (pagina.length < PG_MAX_ROWS) break;
  }
  return out;
}

export async function pgPost(path: string, body: unknown, prefer = "return=representation"): Promise<any> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "POST",
    headers: headers(key, { Prefer: prefer }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path}: ${res.status} ${await res.text()}`);
  if (prefer.includes("return=minimal")) return null;
  return res.json();
}

export async function pgPatch(path: string, body: unknown): Promise<any> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: headers(key, { Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function pgRpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function pgDelete(path: string): Promise<void> {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "DELETE",
    headers: headers(key, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${path}: ${res.status} ${await res.text()}`);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Converte una riga della tabella `matches` (colonne minuscole) nel formato Odds atteso da clusterEngine. */
export function rowToOdds(row: any) {
  return {
    odd_1: row.odd_1,
    odd_X: row.odd_x,
    odd_2: row.odd_2,
    odd_1X: row.odd_1x,
    odd_X2: row.odd_x2,
    odd_12: row.odd_12,
    odd_O15: row.odd_o15,
    odd_U15: row.odd_u15,
    odd_O25: row.odd_o25,
    odd_U25: row.odd_u25,
    odd_O35: row.odd_o35,
    odd_U35: row.odd_u35,
    odd_GG: row.odd_gg,
    odd_NG: row.odd_ng,
  };
}

/**
 * Converte una riga piatta della tabella `matches` nella forma { ...match, odds: {...} }
 * che il frontend (api.ts / Match type) si aspetta — con le quote annidate in "odds"
 * e le chiavi con le maiuscole originali (odd_X, odd_1X, odd_O15, ...).
 */
export function rowToMatch(row: any) {
  return {
    id: row.id,
    day: row.day,
    time: row.time,
    manifestazione: row.manifestazione,
    squadra1: row.squadra1,
    squadra2: row.squadra2,
    result: row.result,
    family: row.family,
    main_prediction: row.main_prediction,
    // Verdetto della fusione salvato: e' quello che deve comparire anche sulla
    // card nell'elenco partite, altrimenti card e dettaglio mostrano due pick
    // diversi per la stessa partita.
    pick_finale: row.pick_finale,
    selected: row.selected,
    created_at: row.created_at,
    updated_at: row.updated_at,
    odds: { ...rowToOdds(row), estimated: row.estimated || [] },
  };
}
