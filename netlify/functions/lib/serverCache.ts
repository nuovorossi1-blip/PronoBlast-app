/**
 * CACHE BREVE SERVER (08/10/2026 - Incarico avvio rapido)
 *
 * Cache in memoria per le letture che cambiano raramente:
 * - matches-days
 * - ml-stats
 * - tabella-scenari
 * - manuale-stats
 * - odd-settings (solo GET)
 *
 * Durata massima: 60 secondi.
 * Invalidazione immediata: da qualunque operazione di scrittura
 * (quote-pc, sync-results, results-*, selection-*, save-verdict, upload-excel,
 * odd-settings POST, rebuild-learning, ricalcolo, match-result, import-db...).
 *
 * NON mette mai in cache:
 * - matches-list (quote, selezioni, risultati live)
 * - verdetto (calcolato e salvato dinamicamente)
 * - lettura (quote, consigliato, AI)
 * - match-detail (dati dinamici di singola partita)
 */

export const CACHE_SERVER_TTL_MS = 60_000; // 60 secondi max

const ROTTE_IN_CACHE = new Set<string>([
  "matches-days",
  "ml-stats",
  "tabella-scenari",
  "manuale-stats",
  "odd-settings",
]);

interface CacheEntry {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
  ts: number;
}

const serverCacheMap = new Map<string, CacheEntry>();

/** Ritorna se la rotta è configurata per la cache breve server in sola lettura */
export function isRottaCacheabile(name: string, method = "GET"): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return ROTTE_IN_CACHE.has(name);
}

/** Verifica se il nome della rotta o il metodo indica una scrittura */
export function isScrittura(name: string, method = "GET"): boolean {
  if (name === "upload-excel") return true;
  if (name === "quote-pc") return true;
  if (name === "sync-results") return true;
  if (name.startsWith("results-")) return true;
  if (name.startsWith("selection-")) return true;
  if (name === "save-verdict") return true;
  if (name === "rebuild-learning") return true;
  if (name === "ricalcolo") return true;
  if (name === "match-result") return true;
  if (name === "delete-all") return true;
  if (name === "import-db") return true;
  if (name === "stats-reset") return true;
  if (name === "odd-settings" && method === "POST") return true;
  if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") return true;
  return false;
}

/** Recupera la risposta dalla cache se ancora fresca (<= 60s) */
export function getServerCachedResponse(name: string, req: Request): Response | null {
  const method = req.method || "GET";
  if (!isRottaCacheabile(name, method)) return null;

  const entry = serverCacheMap.get(name);
  if (!entry) return null;

  if (Date.now() - entry.ts > CACHE_SERVER_TTL_MS) {
    serverCacheMap.delete(name);
    return null;
  }

  const headers = new Headers(entry.headers);
  headers.set("x-server-cache", "HIT");
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers,
  });
}

/** Salva la risposta in cache */
export async function setServerCachedResponse(name: string, req: Request, res: Response): Promise<Response> {
  const method = req.method || "GET";
  if (!isRottaCacheabile(name, method) || res.status !== 200) {
    return res;
  }

  try {
    const clone = res.clone();
    const arrayBuf = await clone.arrayBuffer();
    const headersList: [string, string][] = [];
    res.headers.forEach((v, k) => {
      if (k !== "content-length") headersList.push([k, v]);
    });

    serverCacheMap.set(name, {
      status: res.status,
      statusText: res.statusText,
      headers: headersList,
      body: new Uint8Array(arrayBuf),
      ts: Date.now(),
    });
  } catch {}

  return res;
}

/** Svuota completamente la cache server */
export function svuotaServerCache(motivo?: string): void {
  const size = serverCacheMap.size;
  serverCacheMap.clear();
  if (size > 0 && motivo) {
    // console.log(`[serverCache] svuotata (${size} elementi) da scrittura: ${motivo}`);
  }
}

/** Verifica ed eventualmente svuota la cache in caso di scrittura */
export function controllaInvalidazioneScrittura(name: string, method = "GET"): boolean {
  if (isScrittura(name, method)) {
    svuotaServerCache(`${name} [${method}]`);
    return true;
  }
  return false;
}

/** Ritorna lo stato attuale della cache (per i test) */
export function statoServerCache(): { dim: number; chiavi: string[] } {
  return {
    dim: serverCacheMap.size,
    chiavi: Array.from(serverCacheMap.keys()),
  };
}
