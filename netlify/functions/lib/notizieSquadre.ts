/**
 * NOTIZIE DELLE SQUADRE DA GOOGLE NEWS (13/10/2026, punto A).
 *
 * Arouca - Estrela (11/10): l'Arouca debuttava con un allenatore nuovo e il
 * dossier non lo sapeva. Cercando "Arouca treinador" su Google News la
 * notizia c'era dal 4/10 (A Bola, Record, Maisfutebol, RTP). I feed dei
 * giornali per paese coprono poco le squadre piccole; la ricerca per squadra
 * copre ogni campionato, nella lingua del paese (anche Champions, Nations
 * League, USA, Svezia, Norvegia, Danimarca...).
 *
 * Per ogni squadra: titoli degli ultimi 7 giorni PRIMA del calcio d'inizio
 * con parole su allenatore, infortuni, squalifiche. Si tengono solo i titoli
 * che nominano la squadra e sono di uno di questi tre tipi. Gratis, nessuna
 * chiave. Richieste in fila (una ogni ~1,2 s) e in cache 6 ore per squadra.
 */

export type NotiziaSquadra = { squadra: string; tipo: "allenatore" | "infortunio" | "squalifica"; titolo: string; fonte: string; data: string; url: string };

type Lingua = { hl: string; gl: string; ceid: string; parole: string[] };
const L = (hl: string, gl: string, parole: string[]): Lingua => ({ hl, gl, ceid: `${gl}:${hl.split("-")[0]}`, parole });
const IT = L("it", "IT", ["allenatore", "esonerato", "infortunio", "squalificato"]);
const EN = L("en-GB", "GB", ["manager", "sacked", "injury", "suspended"]);
const ES = L("es", "ES", ["entrenador", "destituido", "lesión", "sancionado"]);
const PT = L("pt-PT", "PT", ["treinador", "demitido", "lesão", "castigado"]);
const BR = L("pt-BR", "BR", ["técnico", "demitido", "lesão", "suspenso"]);
const DE = L("de", "DE", ["Trainer", "entlassen", "Verletzung", "gesperrt"]);
const FR = L("fr", "FR", ["entraîneur", "limogé", "blessure", "suspendu"]);
const NL = L("nl", "NL", ["trainer", "ontslagen", "blessure", "geschorst"]);
const BE = L("nl", "BE", ["trainer", "ontslagen", "blessure", "geschorst"]);
const SV = L("sv", "SE", ["tränare", "sparkad", "skada", "avstängd"]);
const NO = L("no", "NO", ["trener", "sparket", "skade", "utestengt"]);
const DA = L("da", "DK", ["træner", "fyret", "skade", "karantæne"]);
const US = L("en-US", "US", ["coach", "fired", "injury", "suspended"]);
const ARG = L("es-419", "AR", ["entrenador", "técnico", "lesión", "suspendido"]);
const MX = L("es-419", "MX", ["entrenador", "técnico", "lesión", "suspendido"]);

/** Lingua delle notizie dal prefisso del campionato (ITA1 -> ITA). Coppe e nazionali: inglese. */
function linguaDi(campionato: string): Lingua {
  const p = (campionato || "").toUpperCase().replace(/[0-9].*$/, "");
  if (/^ITA/.test(p)) return IT;
  if (/^(ING|SCO|GAL|IRL|IRLN|AUS)/.test(p)) return EN;
  if (/^SPA/.test(p)) return ES;
  if (/^POR/.test(p)) return PT;
  if (/^BRA/.test(p)) return BR;
  if (/^(GER|AUT|SVI)/.test(p)) return DE;
  if (/^FRA/.test(p)) return FR;
  if (/^OLA/.test(p)) return NL;
  if (/^BEL/.test(p)) return BE;
  if (/^SVE/.test(p)) return SV;
  if (/^NOR/.test(p)) return NO;
  if (/^DAN/.test(p)) return DA;
  if (/^USA/.test(p)) return US;
  if (/^(ARG|URU|PAR|CIL|COL|PER|ECU|BOL)/.test(p)) return ARG;
  if (/^(MEX|GUAT|CRC|PNM|ELS)/.test(p)) return MX;
  return EN;
}

const TIPI: [NotiziaSquadra["tipo"], RegExp][] = [
  // Solo il CAMBIO di allenatore: "l'allenatore ha detto" non conta.
  // "appointed" da solo no (13/10/2026: "Referee Observer Appointed for Sabah
  // vs Slavia" diventava un cambio di allenatore e la partita veniva scartata).
  ["allenatore", /(esoner|nuovo allenatore|nuovo tecnico|panchina a|dimission|sacked|appointed (as )?(the )?(new )?(head )?(manager|coach|boss)|(manager|coach|boss) appointed|new (head )?(manager|coach)|parts? ways|caretaker|interim (manager|coach)|leaves? (the )?club|destitu|despedid|nuevo (entrenador|t[eé]cnico)|cesad|demit|novo (treinador|t[eé]cnico)|mudan[cç]a de treinador|deixa o|j[aá] n[aã]o [eé] treinador|sucede|assume o comando|entlass|neuer trainer|trennt sich|limog|nouvel entra[iî]neur|remerci|ontslagen|nieuwe trainer|stapt op|sparkad|ny tr[aä]nare|sparket|ny trener|fyret|ny tr[aæ]ner|fired|new head coach)/i],
  ["squalifica", /(squalific|suspen|sancionad|castigad|gesperrt|sperre|geschorst|avst[aä]ng|utestengt|karant[aæ]ne|red card|cartellino rosso)/i],
  ["infortunio", /(infortun|injur|ruled out|lesi[oó]n|lesionad|les[aã]o|verletz|bless[eé]|geblesseerd|blessure|skad|\bout for\b)/i],
];

// Altri sport e falsi amici: "blessuretijd" (NL) = recupero, "Torino" = ATP Finals...
const NON_CALCIO = /(tennis|atp|wta|wwe|wrestling|formula ?1|f1|motogp|nba|basket|volley|pallavolo|ciclis|cycling|rugby|nfl|nhl|hockey|handball|pallamano|blessuretijd|injury[- ]time|tempo di recupero|tiempo de descuento)/i;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Il nome "di ricerca": senza sigle (FC, CF, SC...) e senza U19/U23/Women. */
function nomeRicerca(squadra: string): string {
  return squadra.replace(/\b(FC|CF|SC|AC|AS|SSC|SS|US|CD|UD|SD|CA|AFC|BK|IF|FK|SK|IK|KV|KRC|RSC|SV|VfL|VfB|TSG|1\.)\b/gi, " ")
    .replace(/\b(U\d\d|Women|Femminile|II|B)\b/gi, " ").replace(/\s+/g, " ").trim() || squadra;
}
/** Il titolo nomina la squadra? Serve la parola piu' lunga del nome (>= 4 lettere), come parola intera. */
function nomina(titolo: string, squadra: string): boolean {
  const t = ` ${norm(titolo).replace(/[^a-z0-9]+/g, " ")} `;
  const parole = norm(nomeRicerca(squadra)).split(/[^a-z0-9]+/).filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
  return t.includes(` ${parole.length ? parole[0] : norm(squadra)} `);
}

/**
 * NOTIZIA PERTINENTE (13/10/2026, Rossi: notizie che non c'entrano).
 *  1. Niente titoli chiaramente non sportivi: "Girl escapes injury after city
 *     truck crashes into Birmingham house" passava perche' nomina Birmingham.
 *  2. La squadra e' il soggetto, non l'avversaria: se il nome compare solo
 *     dopo "vs", "against", "ahead of"... la notizia e' dell'altra squadra
 *     ("Former Real Madrid manager defends Vinicius following red card vs
 *     Villarreal", "Urbig set to start for Bayern against Viking").
 */
// Prima prova con "deve contenere una parola di calcio": scartava
// "Haji Wright injury: Lampard reveals earliest return as Coventry...". Si
// scartano invece i titoli chiaramente non sportivi.
const NON_SPORT = /(newborn|neonat|baby|liver|study finds|patient|hospital|ospedale|truck|camion|crash(es|ed)? into|\bhouse\b|property owner|police|polizia|arrest|court\b|tribunale|government|\bgovt\b|governo|agency|minister|ministro|election|elezion|school|scuola|student|weather|\bfire\b|incendio|shooting|traffic|\broad\b|driving|airport|aeroporto|flight|stock market|\bbank\b|concert|movie|\bfilm\b|singer|actor|actress|theft|furto|robbery|rapina|cannabis|\bdrugs?\b|factory|fabbrica|bomb|murder|omicidio)/i;
const PREPOSIZIONI_AVVERSARIO = /(\bvs?\.?|versus|against|contro|contra|gegen|tegen|mot|ahead of|before|prima di|antes de|vor|voor|following|after|dopo|despu[eé]s de|depois de|nach|clash with|trip to|visit of|visit to|face|faces|facing|host|hosts|beat|beats|lose to|loss to|draw with|win over|victory over|defeat to|sfida|ante|frente a)\s+(the\s+|il\s+|lo\s+|la\s+|el\s+|o\s+|a\s+|den\s+|de\s+)?$/i;

export function notiziaPertinente(titolo: string, squadra: string): boolean {
  if (NON_SPORT.test(titolo)) return false;
  const t = norm(titolo);
  const parole = norm(nomeRicerca(squadra)).split(/[^a-z0-9]+/).filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
  const nome = parole[0] || norm(squadra);
  const i = t.search(new RegExp(`(^|[^a-z0-9])${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`));
  if (i < 0) return true;   // nominata in altro modo: decide nomina()
  // "after Burnley's win", "ahead of Orlando Pirates' final": col genitivo
  // la squadra e' il soggetto.
  const dopo = t.slice(i, i + 40);
  if (new RegExp(`${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z ]{0,20}?['’‘](s\\b|\\s|$)`).test(dopo)) return true;
  const prima = t.slice(Math.max(0, i - 30), i + 1);
  return !PREPOSIZIONI_AVVERSARIO.test(prima);
}

/** Filtro per le notizie gia' salvate nel dossier con le regole vecchie. */
export function notiziePertinenti<T extends { titolo: string; squadra: string }>(voci: T[] | undefined | null): T[] {
  return (voci || []).filter((v) => notiziaPertinente(v.titolo, v.squadra));
}

const cache = new Map<string, { quando: number; voci: NotiziaSquadra[] }>();
let coda: Promise<unknown> = Promise.resolve();
/** Una richiesta alla volta, con una pausa: Google News risponde 429 se si esagera. */
function inFila<T>(f: () => Promise<T>): Promise<T> {
  const p = coda.then(f, f);
  coda = p.then(() => new Promise((r) => setTimeout(r, 1200)), () => new Promise((r) => setTimeout(r, 1200)));
  return p;
}

const testo = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
};

/** Notizie di una squadra prima della partita. [] se non c'e' niente o Google non risponde. */
export async function notizieSquadra(squadraDb: string, campionato: string, inizioMs: number | null, nomeCompleto?: string | null): Promise<NotiziaSquadra[]> {
  const lingua = linguaDi(campionato);
  // Il nome FotMob e' piu' preciso ("Estrela da Amadora", non "Estrela" = stella)
  const squadra = nomeCompleto && nomeCompleto.length > squadraDb.length ? nomeCompleto : squadraDb;
  const chiave = `${norm(squadra)}|${lingua.gl}`;
  const c = cache.get(chiave);
  const limite = inizioMs ?? Date.now();
  const filtra = (voci: NotiziaSquadra[]) => voci.filter((v) => Date.parse(v.data) <= limite && Date.parse(v.data) >= limite - 7 * 86400000);
  if (c && Date.now() - c.quando < 6 * 3600_000) return filtra(c.voci);

  const q = `"${nomeRicerca(squadra)}" (${lingua.parole.join(" OR ")}) when:7d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lingua.hl}&gl=${lingua.gl}&ceid=${lingua.ceid}`;
  let voci: NotiziaSquadra[] = [];
  try {
    const xml = await inFila(async () => {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (PronoBlast dossier)" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Google News ${r.status}`);
      return r.text();
    });
    const visti = new Set<string>();
    for (const item of xml.split(/<item>/i).slice(1)) {
      const completo = testo(item, "title");
      const fonte = testo(item, "source");
      const titolo = fonte && completo.endsWith(` - ${fonte}`) ? completo.slice(0, -(fonte.length + 3)) : completo;
      const ms = Date.parse(testo(item, "pubDate"));
      if (!titolo || !isFinite(ms) || !nomina(titolo, squadra) || NON_CALCIO.test(titolo) || !notiziaPertinente(titolo, squadra)) continue;
      const data = new Date(ms).toISOString();
      const tipo = TIPI.find(([t, re]) => re.test(titolo) && (t !== "allenatore" || eCambioAllenatore(titolo)))?.[0];
      if (!tipo) continue;
      const firma = norm(titolo).slice(0, 60);
      if (visti.has(firma)) continue;
      visti.add(firma);
      voci.push({ squadra: squadraDb, tipo, titolo, fonte, data, url: testo(item, "link") });
    }
    voci.sort((a, b) => Date.parse(b.data) - Date.parse(a.data));
    voci = voci.slice(0, 6);
    cache.set(chiave, { quando: Date.now(), voci });
  } catch (e) {
    console.error("[notizieSquadre]", squadra, (e as any)?.message || e);
    return [];
  }
  return filtra(voci);
}

/** Le due squadre di una partita, in fila. */
export async function notiziePartitaSquadre(
  casa: string, ospite: string, campionato: string, inizioMs: number | null,
  nomiFotmob?: { casa?: string | null; ospite?: string | null },
): Promise<NotiziaSquadra[]> {
  const a = await notizieSquadra(casa, campionato, inizioMs, nomiFotmob?.casa);
  const b = await notizieSquadra(ospite, campionato, inizioMs, nomiFotmob?.ospite);
  // lo stesso articolo ("Team news: A vs B") vale per tutte e due: una volta sola
  const visti = new Set<string>();
  return [...a, ...b].filter((v) => !visti.has(v.titolo) && visti.add(v.titolo));
}

const ETICHETTA = { allenatore: "🧑‍💼 allenatore", infortunio: "🚑 infortunio", squalifica: "🟥 squalifica" } as const;
const giornoMese = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" });
/** Una riga leggibile: "[04/10] 🧑‍💼 allenatore · Arouca: Vítor Severino è il nuovo... (A Bola)". */
export function rigaNotizia(v: NotiziaSquadra): string {
  return `[${giornoMese(v.data)}] ${ETICHETTA[v.tipo]} · ${v.squadra}: ${v.titolo}${v.fonte ? ` (${v.fonte})` : ""}`;
}
/** Cambio di allenatore negli ultimi 10 giorni: l'avviso piu' forte (Arouca - Estrela). */
export function cambioAllenatore(voci: NotiziaSquadra[] | undefined): NotiziaSquadra | null {
  // Si ricontrolla il titolo con la regola di adesso: le notizie gia' salvate
  // nel dossier possono essere state classificate con quella vecchia.
  return (voci || []).find((v) => v.tipo === "allenatore" && eCambioAllenatore(v.titolo)) ?? null;
}

const ARBITRI = /(referee|arbitr|[aá]rbitro|schiedsrichter|scheidsrechter|observer|osservatore|var\b)/i;
// Ipotesi, non fatti (13/10/2026: "'Expects to be sacked!' Body language
// expert..." su Carrick faceva scartare Atletico - Manchester United).
const IPOTESI = /(expects? to be|could be|set to be|facing (the )?sack|odds|rumou?r|future|under pressure|on the brink|verge|in line|would|might|may be|close to|signs|potrebbe|rischia|in bilico|verso l'esonero|podr[ií]a|pode ser|k[oö]nnte)/i;
export function eCambioAllenatore(titolo: string): boolean {
  return TIPI[0][1].test(titolo) && !ARBITRI.test(titolo) && !IPOTESI.test(titolo);
}
