/**
 * Le quattro fonti dei risultati, interrogate UNA VOLTA PER GIORNATA.
 *
 * E' la differenza che conta rispetto a come funzionava prima: `fotmobFetch.ts`
 * cerca su FotMob una partita alla volta, per nome squadra. Con 10.000 partite
 * sono 10.000 richieste. Qui si scarica l'elenco completo di una giornata con
 * una sola richiesta e l'abbinamento si fa in locale: quattro giornate sono
 * quattro richieste per fonte, non migliaia.
 *
 * Idea e implementazione vengono dallo script Python di Rossi (27/09/2026), che
 * ha gia' recuperato oltre 7.000 risultati in questo modo.
 *
 * CASCATA: API-Football per prima (piu' completa ma il piano gratuito copre solo
 * i giorni recenti), poi FotMob, ESPN e SofaScore, che sono gratuite, senza
 * chiave e coprono anche le date vecchie.
 *
 * Il punteggio raccolto e' sempre quello dei 90 MINUTI: supplementari e rigori
 * non vengono mai scritti, per decisione di Rossi.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TZ = "Europe/Rome";

export type PartitaFonte = {
  fonte: string;
  lega: string;
  paese?: string;
  casa: string;
  ospite: string;
  gc: number | null;
  go: number | null;
  finita: boolean;
  supplementari: boolean;
  stato: string;
  /** Data e ora di inizio, in millisecondi. null quando la fonte non la da'. */
  ora: number | null;
  /** Id della partita e del campionato nella fonte (per ora solo FotMob: serve
   *  al dossier per chiedere i dettagli, vedi fotmobDossier.ts). */
  id?: string;
  legaId?: number;
};

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const gg = (d: string) => d.replace(/-/g, "");

export async function fotmob(day: string): Promise<PartitaFonte[]> {
  const url = `https://www.fotmob.com/api/data/matches?date=${gg(day)}&timezone=${encodeURIComponent(TZ)}&includeNextDayLateNight=true`;
  const dati = await getJson(url);
  const out: PartitaFonte[] = [];
  for (const lg of dati?.leagues || []) {
    for (const m of lg?.matches || []) {
      const st = m?.status || {};
      const reason = st?.reason?.short || "";
      // "22.09.2026 20:45" -> millisecondi
      let ora: number | null = null;
      const p = String(m?.time || "").match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/);
      if (p) ora = Date.parse(`${p[3]}-${p[2]}-${p[1]}T${p[4]}:${p[5]}:00`);
      out.push({
        fonte: "FotMob", lega: lg?.name || "",
        casa: m?.home?.name || "", ospite: m?.away?.name || "",
        gc: typeof m?.home?.score === "number" ? m.home.score : null,
        go: typeof m?.away?.score === "number" ? m.away.score : null,
        finita: !!st?.finished && !st?.cancelled,
        supplementari: ["AET", "Pen", "AP"].includes(reason),
        stato: reason, ora: Number.isNaN(ora) ? null : ora,
        id: m?.id != null ? String(m.id) : undefined,
        legaId: Number(lg?.primaryId ?? lg?.id) || undefined,
      });
    }
  }
  return out;
}

export async function espn(day: string): Promise<PartitaFonte[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${gg(day)}&limit=1000`;
  const dati = await getJson(url);
  const out: PartitaFonte[] = [];
  for (const e of dati?.events || []) {
    try {
      const c = e.competitions[0].competitors;
      const h = c.find((x: any) => x.homeAway === "home");
      const a = c.find((x: any) => x.homeAway === "away");
      const st = e?.status?.type || {};
      const nome = String(st?.name || "");
      out.push({
        fonte: "ESPN", lega: e?.season?.slug || "",
        casa: h?.team?.displayName || "", ospite: a?.team?.displayName || "",
        gc: /^\d+$/.test(String(h?.score)) ? parseInt(h.score, 10) : null,
        go: /^\d+$/.test(String(a?.score)) ? parseInt(a.score, 10) : null,
        finita: !!st?.completed && !nome.includes("CANCEL") && !nome.includes("POSTP"),
        supplementari: nome.includes("AET") || nome.includes("PEN") || nome.includes("EXTRA"),
        stato: st?.shortDetail || nome, ora: Date.parse(e?.date) || null,
      });
    } catch {
      continue;
    }
  }
  return out;
}

export async function sofascore(day: string): Promise<PartitaFonte[]> {
  const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${day}`;
  const dati = await getJson(url, { Referer: "https://www.sofascore.com/" });
  const out: PartitaFonte[] = [];
  for (const e of dati?.events || []) {
    const hs = e?.homeScore || {}, as_ = e?.awayScore || {};
    out.push({
      fonte: "SofaScore", lega: e?.tournament?.name || "",
      casa: e?.homeTeam?.name || "", ospite: e?.awayTeam?.name || "",
      // `normaltime` e' il punteggio ai 90': se manca si ripiega su `current`
      gc: typeof hs.normaltime === "number" ? hs.normaltime : (typeof hs.current === "number" ? hs.current : null),
      go: typeof as_.normaltime === "number" ? as_.normaltime : (typeof as_.current === "number" ? as_.current : null),
      finita: e?.status?.type === "finished",
      supplementari: false,
      stato: e?.status?.description || "", ora: e?.startTimestamp ? e.startTimestamp * 1000 : null,
    });
  }
  return out;
}

export async function apifootball(day: string, key: string): Promise<PartitaFonte[]> {
  const url = `https://v3.football.api-sports.io/fixtures?date=${day}&timezone=${encodeURIComponent(TZ)}`;
  const dati = await getJson(url, { "x-apisports-key": key }, 25000);
  const err = dati?.errors;
  if (err && (Array.isArray(err) ? err.length : Object.keys(err).length)) {
    // Il piano gratuito copre solo alcune date: non e' un errore da far esplodere,
    // si scende semplicemente alle fonti gratuite.
    throw new Error(`API-Football: ${JSON.stringify(err).slice(0, 200)}`);
  }
  const out: PartitaFonte[] = [];
  for (const x of dati?.response || []) {
    const fx = x.fixture, lg = x.league, tm = x.teams, sc = x.score;
    const stato = fx?.status?.short || "";
    const ft = sc?.fulltime || {};     // fulltime = risultato ai 90 minuti
    out.push({
      fonte: "API-Football", lega: `${lg?.country} - ${lg?.name}`, paese: lg?.country,
      casa: tm?.home?.name || "", ospite: tm?.away?.name || "",
      gc: typeof ft.home === "number" ? ft.home : null,
      go: typeof ft.away === "number" ? ft.away : null,
      finita: ["FT", "AET", "PEN", "AWD", "WO"].includes(stato),
      supplementari: ["AET", "PEN"].includes(stato),
      stato, ora: Date.parse(fx?.date) || null,
    });
  }
  return out;
}

/** Prefisso del campionato Sisal -> paese in API-Football. Solo un aiuto in
 *  caso di dubbio, non un requisito. */
export const PAESI: Record<string, string> = {
  AUT: "Austria", SVE: "Sweden", GER: "Germany", UZB: "Uzbekistan", NOR: "Norway", ITA: "Italy",
  ING: "England", SPA: "Spain", FRA: "France", BRA: "Brazil", ARG: "Argentina", USA: "USA",
  AUS: "Australia", FIN: "Finland", LIT: "Lithuania", PAR: "Paraguay", SCO: "Scotland",
  ECU: "Ecuador", BOL: "Bolivia", DEN: "Denmark", DAN: "Denmark", OLA: "Netherlands",
  BEL: "Belgium", POR: "Portugal", SVI: "Switzerland", POL: "Poland", CZE: "Czech-Republic",
  CRO: "Croatia", IRL: "Ireland", ISL: "Iceland", GIA: "Japan", JAP: "Japan", COR: "South-Korea",
  CIN: "China", CHN: "China", MES: "Mexico", CIL: "Chile", CHI: "Chile", COL: "Colombia",
  URU: "Uruguay", PER: "Peru", TUR: "Turkey", GRE: "Greece", UCR: "Ukraine", ROM: "Romania",
  BUL: "Bulgaria", SER: "Serbia", UNG: "Hungary", SLO: "Slovenia", SVK: "Slovakia",
  EST: "Estonia", LET: "Latvia", CAN: "Canada", ALG: "Algeria", EGI: "Egypt", MAR: "Morocco",
  KAZ: "Kazakhstan", GEO: "Georgia", ARM: "Armenia", AZE: "Azerbaijan", ISR: "Israel",
  CIP: "Cyprus", GAL: "Wales", CRC: "Costa-Rica", DOM: "Dominican-Republic",
};
