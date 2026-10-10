/**
 * Cache globale a livello modulo: persiste finché l'app vive,
 * anche quando le schermate vengono smontate dall'expo-router.
 *
 * Strategia: stale-while-revalidate.
 *  - getCachedMatches(): ritorna immediatamente la cache se presente (fresca o stale)
 *  - isStale(): indica se serve rifetchare in background
 *  - setCachedMatches(): aggiorna dopo il fetch
 *
 * TTL "fresh" = 5 minuti (dopo serve refresh in background, ma la UI mostra subito i dati cached)
 */
import { Match, QuoteFirma, firmaQuote, quoteCambiate } from "../api";

const FRESH_TTL_MS = 5 * 60 * 1000; // 5 minuti

const matchesByDay = new Map<string, { matches: Match[]; ts: number }>();
let daysSnapshot: { days: string[]; ts: number } | null = null;
let marketStatsSnapshot: { stats: any[]; ts: number } | null = null;

export const matchesCache = {
  find(id: string): Match | null {
    for (const entry of matchesByDay.values()) {
      const match = entry.matches.find((m) => m.id === id);
      if (match) return match;
    }
    return null;
  },
  get(day: string): Match[] | null {
    const entry = matchesByDay.get(day);
    return entry ? entry.matches : null;
  },
  isStale(day: string): boolean {
    const entry = matchesByDay.get(day);
    if (!entry) return true;
    return Date.now() - entry.ts > FRESH_TTL_MS;
  },
  set(day: string, matches: Match[]) {
    matchesByDay.set(day, { matches, ts: Date.now() });
  },
  invalidate(day?: string) {
    if (day) matchesByDay.delete(day);
    else matchesByDay.clear();
  },
};

export const daysCache = {
  get(): string[] | null {
    return daysSnapshot ? daysSnapshot.days : null;
  },
  isStale(): boolean {
    if (!daysSnapshot) return true;
    return Date.now() - daysSnapshot.ts > FRESH_TTL_MS;
  },
  set(days: string[]) {
    daysSnapshot = { days, ts: Date.now() };
  },
  invalidate() {
    daysSnapshot = null;
  },
};

export const marketStatsCache = {
  get(): any[] | null {
    return marketStatsSnapshot ? marketStatsSnapshot.stats : null;
  },
  isStale(): boolean {
    if (!marketStatsSnapshot) return true;
    return Date.now() - marketStatsSnapshot.ts > FRESH_TTL_MS;
  },
  set(stats: any[]) {
    marketStatsSnapshot = { stats, ts: Date.now() };
  },
  invalidate() {
    marketStatsSnapshot = null;
  },
};

let mlStatsSnapshot: { data: any; ts: number } | null = null;
let selectedListSnapshot: { list: any[]; ts: number } | null = null;

export const mlStatsCache = {
  get(): any | null { return mlStatsSnapshot ? mlStatsSnapshot.data : null; },
  isStale(): boolean {
    if (!mlStatsSnapshot) return true;
    return Date.now() - mlStatsSnapshot.ts > FRESH_TTL_MS;
  },
  set(data: any) { mlStatsSnapshot = { data, ts: Date.now() }; },
  invalidate() { mlStatsSnapshot = null; },
};

export const selectedListCache = {
  get(): any[] | null { return selectedListSnapshot ? selectedListSnapshot.list : null; },
  isStale(): boolean {
    if (!selectedListSnapshot) return true;
    return Date.now() - selectedListSnapshot.ts > 30_000; // 30s (cambia frequentemente)
  },
  set(list: any[]) { selectedListSnapshot = { list, ts: Date.now() }; },
  invalidate() { selectedListSnapshot = null; },
};

// ============================================================
// 10/09/2026 — CACHE DEL DETTAGLIO PARTITA
// ============================================================
// Aprire una partita faceva partire SEI richieste (match-detail, ml-stats,
// match-candidates, predict, match-history, odd-settings) e nessuna era in
// cache: riaprire la stessa partita rifaceva tutto da capo, motore compreso.
// Qui teniamo il "pacchetto" completo di una partita, con la stessa strategia
// stale-while-revalidate della home.
//
// La chiave include la soglia di quota perche' l'analisi strutturale dipende
// da quella: cambiando soglia serve un pacchetto diverso, non un aggiornamento
// di quello vecchio.
export type MatchBundle = {
  match: any;
  cands: any;
  struct: any;
  hist: any;
};

const matchBundles = new Map<string, { data: MatchBundle; ts: number }>();
const BUNDLE_TTL_MS = 5 * 60 * 1000;

function bundleKey(id: string, minOdd: number) {
  return `${id}|${minOdd}`;
}

const MAX_LOCAL_SCHEDE = 40;
const MAX_LOCAL_ETA_MS = 3 * 24 * 3600_000; // 3 giorni

/**
 * Pulisce la cache del dispositivo (localStorage):
 * - Rimuove voci con età > 3 giorni
 * - Mantiene al massimo le ultime 40 schede (sia per bundle che per lettura),
 *   eliminando le più vecchie in base al timestamp.
 */
export function pulisciCacheDispositivo(maxSchede = MAX_LOCAL_SCHEDE, maxEtaMs = MAX_LOCAL_ETA_MS) {
  try {
    if (typeof localStorage === "undefined") return;
    const now = Date.now();
    const bundleEntries: { key: string; ts: number }[] = [];
    const letturaEntries: { key: string; ts: number }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("pb_bundle_")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || "");
          const ts = Number(parsed?.ts) || 0;
          if (now - ts > maxEtaMs) {
            localStorage.removeItem(k);
            i--;
          } else {
            bundleEntries.push({ key: k, ts });
          }
        } catch {
          localStorage.removeItem(k);
          i--;
        }
      } else if (k.startsWith("pb_lettura_")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || "");
          const ts = Number(parsed?.ts) || 0;
          if (now - ts > maxEtaMs) {
            localStorage.removeItem(k);
            i--;
          } else {
            letturaEntries.push({ key: k, ts });
          }
        } catch {
          localStorage.removeItem(k);
          i--;
        }
      }
    }

    if (bundleEntries.length > maxSchede) {
      bundleEntries.sort((a, b) => a.ts - b.ts);
      const daRimuovere = bundleEntries.slice(0, bundleEntries.length - maxSchede);
      for (const e of daRimuovere) localStorage.removeItem(e.key);
    }
    if (letturaEntries.length > maxSchede) {
      letturaEntries.sort((a, b) => a.ts - b.ts);
      const daRimuovere = letturaEntries.slice(0, letturaEntries.length - maxSchede);
      for (const e of daRimuovere) localStorage.removeItem(e.key);
    }
  } catch {}
}

function setItemSafe(key: string, value: string) {
  try {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // In caso di errore (es. quota localStorage superata), esegue pulizia aggressiva e ritenta
      pulisciCacheDispositivo(20, 24 * 3600_000);
      try {
        localStorage.setItem(key, value);
      } catch {}
    }
  } catch {}
}

// Pulizia automatica all'avvio del modulo se siamo nel client
if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
  try { pulisciCacheDispositivo(); } catch {}
}

function loadBundleLocal(key: string): { data: MatchBundle; ts: number } | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`pb_bundle_${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBundleLocal(key: string, entry: { data: MatchBundle; ts: number }) {
  setItemSafe(`pb_bundle_${key}`, JSON.stringify(entry));
  pulisciCacheDispositivo();
}

function removeBundleLocal(prefix: string) {
  try {
    if (typeof localStorage === "undefined") return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`pb_bundle_${prefix}`)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}

export const matchDetailCache = {
  get(id: string, minOdd: number): MatchBundle | null {
    const key = bundleKey(id, minOdd);
    let e = matchBundles.get(key);
    if (!e) {
      const fromLocal = loadBundleLocal(key);
      if (fromLocal) {
        e = fromLocal;
        matchBundles.set(key, fromLocal);
      }
    }
    const preview = matchesCache.find(id);
    if (e && preview && (JSON.stringify(preview.odds) !== JSON.stringify(e.data.match.odds)
      || (preview.result ?? null) !== (e.data.match.result ?? null))) {
      this.invalidate(id);
      return null;
    }
    return e ? e.data : null;
  },
  isStale(id: string, minOdd: number): boolean {
    const key = bundleKey(id, minOdd);
    const e = matchBundles.get(key) ?? loadBundleLocal(key);
    if (!e) return true;
    return Date.now() - e.ts > BUNDLE_TTL_MS;
  },
  set(id: string, minOdd: number, data: MatchBundle) {
    const key = bundleKey(id, minOdd);
    const entry = { data, ts: Date.now() };
    matchBundles.delete(key);
    matchBundles.set(key, entry);
    saveBundleLocal(key, entry);
    while (matchBundles.size > 32) matchBundles.delete(matchBundles.keys().next().value!);
  },
  /** Senza id svuota tutto; con id butta via il pacchetto a TUTTE le soglie. */
  invalidate(id?: string) {
    if (!id) {
      matchBundles.clear();
      removeBundleLocal("");
      return;
    }
    for (const k of Array.from(matchBundles.keys())) {
      if (k.startsWith(`${id}|`)) matchBundles.delete(k);
    }
    removeBundleLocal(`${id}|`);
  },
};

export const persistentLetturaCache = {
  get(id: string, currentOdds?: any): any | null {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(`pb_lettura_${id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (currentOdds && parsed.firma) {
        const ora = firmaQuote(currentOdds);
        if (quoteCambiate(parsed.firma, ora)) {
          return null;
        }
      }
      return parsed.data ?? null;
    } catch {
      return null;
    }
  },
  set(id: string, data: any, odds?: any) {
    try {
      if (typeof localStorage === "undefined") return;
      const firma = odds ? firmaQuote(odds) : (data?.consigliato?.quote ? firmaQuote(data.consigliato.quote) : null);
      setItemSafe(`pb_lettura_${id}`, JSON.stringify({ data, firma, ts: Date.now() }));
      pulisciCacheDispositivo();
    } catch {}
  },
  invalidate(id?: string) {
    try {
      if (typeof localStorage === "undefined") return;
      if (id) localStorage.removeItem(`pb_lettura_${id}`);
    } catch {}
  },
};

export const persistentTabellaCache = {
  get(): any | null {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem("pb_tabella_scenari");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed.ts || 0) > 24 * 60 * 60_000) return null;
      return parsed.data ?? null;
    } catch {
      return null;
    }
  },
  set(data: any) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem("pb_tabella_scenari", JSON.stringify({ data, ts: Date.now() }));
    } catch {}
  },
};

// Soglia di quota minima: e' una preferenza, cambia solo quando la cambia
// l'utente. Veniva riletta dal server ad ogni apertura di partita, e per di
// piu' arrivava DOPO il primo caricamento, facendo ripartire tutte e cinque
// le chiamate quando la soglia salvata non era 1,40. Ora si legge una volta
// per sessione.
let oddSettingsSnapshot: { min_odd: number; options: number[] } | null = null;

export const oddSettingsCache = {
  get(): { min_odd: number; options: number[] } | null { return oddSettingsSnapshot; },
  set(v: { min_odd: number; options: number[] }) { oddSettingsSnapshot = v; },
};
