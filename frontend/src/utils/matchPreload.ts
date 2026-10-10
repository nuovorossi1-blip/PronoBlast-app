import { api, Match, Prediction, RispostaLettura } from "@/src/api";
import {
  matchesCache,
  daysCache,
  marketStatsCache,
  selectedListCache,
  matchDetailCache,
  MatchBundle,
  oddSettingsCache,
} from "./cache";

type MatchRecord = Match & { prediction?: Prediction };
type PendingBundle = { match: Promise<MatchRecord>; bundle: Promise<MatchBundle> };
const bundles = new Map<string, PendingBundle>();
const readings = new Map<string, { data: RispostaLettura; ts: number; odds: string }>();
const pendingReadings = new Map<string, Promise<RispostaLettura>>();
const readingTTL = 30_000;
const oddsOf = (id: string) => JSON.stringify(matchesCache.find(id)?.odds ?? null);
export const ODD_FALLBACK = { min_odd: 1.40, options: [1.40, 1.50, 1.60, 1.75] };
let pendingOddSettings: Promise<{ min_odd: number; options: number[] }> | null = null;

const pendingMatches = new Map<string, Promise<Match[]>>();
let pendingDays: Promise<string[]> | null = null;
let pendingMarketStats: Promise<any[]> | null = null;
let pendingSelectedList: Promise<Match[]> | null = null;
const pendingVerdetti = new Map<string, Promise<any>>();

export function requestOddSettings() {
  const cached = oddSettingsCache.get();
  if (cached) return Promise.resolve(cached);
  if (!pendingOddSettings) {
    pendingOddSettings = api.getMinOdd().then((r) => {
      const settings = { min_odd: r?.min_odd || ODD_FALLBACK.min_odd,
        options: r?.options?.length ? r.options : ODD_FALLBACK.options };
      oddSettingsCache.set(settings);
      return settings;
    }).catch(() => { pendingOddSettings = null; return ODD_FALLBACK; });
  }
  return pendingOddSettings;
}

export function requestMatches(day: string, force = false): Promise<Match[]> {
  const cached = matchesCache.get(day);
  if (!force && cached && !matchesCache.isStale(day)) {
    return Promise.resolve(cached);
  }
  const pending = pendingMatches.get(day);
  if (pending && !force) return pending;
  const req = api.matches(day).then((ms) => {
    matchesCache.set(day, ms);
    return ms;
  }).finally(() => {
    pendingMatches.delete(day);
  });
  pendingMatches.set(day, req);
  return req;
}

export function requestDays(force = false): Promise<string[]> {
  const cached = daysCache.get();
  if (!force && cached && !daysCache.isStale()) {
    return Promise.resolve(cached);
  }
  if (pendingDays && !force) return pendingDays;
  pendingDays = api.days().then((ds) => {
    daysCache.set(ds);
    return ds;
  }).finally(() => {
    pendingDays = null;
  });
  return pendingDays;
}

export function requestMarketStats(force = false): Promise<any[]> {
  const cached = marketStatsCache.get();
  if (!force && cached && !marketStatsCache.isStale()) {
    return Promise.resolve(cached);
  }
  if (pendingMarketStats && !force) return pendingMarketStats;
  pendingMarketStats = api.marketStats().then((s) => {
    const list = s?.markets || [];
    marketStatsCache.set(list);
    return list;
  }).catch(() => {
    return marketStatsCache.get() || [];
  }).finally(() => {
    pendingMarketStats = null;
  });
  return pendingMarketStats;
}

export function requestSelectedList(force = false): Promise<Match[]> {
  const cached = selectedListCache.get();
  if (!force && cached && !selectedListCache.isStale()) {
    return Promise.resolve(cached);
  }
  if (pendingSelectedList && !force) return pendingSelectedList;
  pendingSelectedList = api.selectedList().then((list) => {
    selectedListCache.set(list);
    return list;
  }).catch(() => {
    return selectedListCache.get() || [];
  }).finally(() => {
    pendingSelectedList = null;
  });
  return pendingSelectedList;
}

export function requestVerdetti(day: string): Promise<any> {
  const pending = pendingVerdetti.get(day);
  if (pending) return pending;
  const req = api.verdettiDelGiorno(day).finally(() => {
    pendingVerdetti.delete(day);
  });
  pendingVerdetti.set(day, req);
  return req;
}

export function avviaRichiesteIniziali(day: string) {
  const pMatches = requestMatches(day, true);
  const pVerdetti = requestVerdetti(day);
  const pDays = requestDays(true);
  const pStats = requestMarketStats(true);
  const pSelected = requestSelectedList(true);
  const pOdds = requestOddSettings();
  return { pMatches, pVerdetti, pDays, pStats, pSelected, pOdds };
}

// Home e scheda condividono le richieste gia' in corso. Il pacchetto completo
// entra in cache solo quando storico e motore sono arrivati.
export function requestMatchBundle(id: string, minOdd: number, force = false): PendingBundle {
  const key = `${id}|${minOdd}`;
  const cached = matchDetailCache.get(id, minOdd);
  if (!force && cached && !matchDetailCache.isStale(id, minOdd)) {
    return { match: Promise.resolve(cached.match), bundle: Promise.resolve(cached) };
  }
  const pending = bundles.get(key);
  if (pending && !force) return pending;
  const match = api.match(id);
  const bundle: Promise<MatchBundle> = Promise.all([
    match,
    api.matchStructural(id, minOdd).catch(() => null),
    api.matchHistory(id).catch(() => null),
  ]).then(([m, struct, hist]) => {
    const data = { match: m, cands: null, struct, hist };
    if (bundles.get(key)?.bundle === bundle) matchDetailCache.set(id, minOdd, data);
    return data;
  }).finally(() => {
    if (bundles.get(key)?.bundle === bundle) bundles.delete(key);
  });
  const result = { match, bundle };
  bundles.set(key, result);
  return result;
}

export const matchReadingCache = {
  get(id: string): RispostaLettura | null {
    const entry = readings.get(id);
    return entry && entry.odds === oddsOf(id) ? entry.data : null;
  },
  set(id: string, data: RispostaLettura) {
    readings.delete(id);
    readings.set(id, { data, ts: Date.now(), odds: oddsOf(id) });
    while (readings.size > 32) readings.delete(readings.keys().next().value!);
  },
};

export function requestSavedReading(id: string): Promise<RispostaLettura> {
  const cached = readings.get(id);
  if (cached && cached.odds === oddsOf(id) && Date.now() - cached.ts < readingTTL) {
    return Promise.resolve(cached.data);
  }
  const pending = pendingReadings.get(id);
  if (pending) return pending;
  const odds = oddsOf(id);
  const request = api.lettura(id, { savedOnly: true }).then((data) => {
    // Non etichettare con quote nuove una risposta partita con quote vecchie.
    if (odds === oddsOf(id)) matchReadingCache.set(id, data);
    return data;
  }).finally(() => { pendingReadings.delete(id); });
  pendingReadings.set(id, request);
  return request;
}

export async function preloadMatch(id: string) {
  // Solo dati e analisi numerica: mai auto=1 o generazioni AI speculative.
  const minOdd = (await requestOddSettings()).min_odd;
  const request = requestMatchBundle(id, minOdd);
  return Promise.all([request.bundle, requestSavedReading(id)]).then(() => {}).catch(() => {});
}

/** Precarica poche schede visibili, una coppia alla volta dopo una pausa.
 *  Restituisce la pulizia per useFocusEffect; su reti a risparmio dati si
 *  mantiene solo il precaricamento esplicito al tocco della card. */
export function observeMatchCards(ids: string[]): () => void {
  const connection = typeof navigator !== "undefined"
    ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    : undefined;
  if (connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType ?? "")) return () => {};
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const warmed = new Set<string>();
  const visible = new Map<string, Element>();
  let busy = false;
  const warm = (candidates: string[]) => {
    if (busy || !active) return;
    const jobs: Promise<void>[] = [];
    for (const id of candidates.filter((candidate) => !warmed.has(candidate)).slice(0, 2)) {
      if (!active || warmed.size >= 8) break;
      warmed.add(id);
      jobs.push(preloadMatch(id));
    }
    if (jobs.length) {
      busy = true;
      void Promise.all(jobs).finally(() => {
        busy = false;
        if (active) warm([...visible.keys()]);
      });
    }
  };
  if (typeof document === "undefined" || typeof IntersectionObserver === "undefined") {
    timer = setTimeout(() => warm(ids.slice(0, 2)), 2000);
    return () => { active = false; clearTimeout(timer); };
  }
  const allowed = new Set(ids);
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.getAttribute("data-testid")?.slice(6);
      if (!id || !allowed.has(id)) continue;
      if (entry.isIntersecting) visible.set(id, entry.target);
      else visible.delete(id);
    }
    clearTimeout(timer);
    timer = setTimeout(() => warm(
      [...visible.entries()].sort((a, b) => a[1].getBoundingClientRect().top - b[1].getBoundingClientRect().top)
        .map(([id]) => id),
    ), 2000);
  }, { threshold: 0.3 });
  document.querySelectorAll('[data-testid^="match-"]').forEach((card) => observer.observe(card));
  return () => { active = false; clearTimeout(timer); observer.disconnect(); };
}
